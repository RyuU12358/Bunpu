import { Cell } from "./cell";
import { Dist } from "../core/dist";
import { evaluate } from "./evaluator";
import type { DistComponent } from "../core/types";

export class Graph {
  cells: Map<string, Cell> = new Map();
  listeners: Array<() => void> = [];
  dirtyTrack: Set<string> = new Set(); // Track cells changed since last flush

  // Wasm Monte Carlo function (set by worker after Wasm init)
  wasmMonteCarlo:
    | ((
        components: DistComponent[],
        initWealth: number,
        steps: number,
        numTrials: number
      ) => number)
    | null = null;

  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  notifyListeners() {
    this.listeners.forEach((l) => l());
  }

  getDirtyAndClear(): Cell[] {
    const res: Cell[] = [];
    for (const id of this.dirtyTrack) {
      const c = this.cells.get(id);
      if (c) res.push(c);
    }
    this.dirtyTrack.clear();
    return res;
  }

  private markDirty(id: string) {
    this.dirtyTrack.add(id);
  }

  getCell(id: string): Cell {
    if (!this.cells.has(id)) {
      this.cells.set(id, new Cell(id));
      // New cell is effectively changed if accessed?
      // Maybe not unless setInput called.
    }
    return this.cells.get(id)!;
  }

  getAllCells(): IterableIterator<Cell> {
    return this.cells.values();
  }

  setCellInput(id: string, input: string) {
    const cell = this.getCell(id);
    if (cell.rawInput === input) return;

    cell.rawInput = input;
    this.markDirty(id);

    // 1. Parse dependencies (naive regex for MVP?)
    // Real dependency detection requires parsing.
    // For MVP structure, let's assume we have a parse function.
    const newDeps = this.detectDependencies(input);

    // 2. Update Graph edges
    this.updateDependencies(cell, newDeps);

    // 3. Mark dirty and propagate
    this.recalculate(id);
  }

  private detectDependencies(input: string): Set<string> {
    // Basic regex for A1, B2 etc.
    // Matches [A-Z]+[0-9]+
    const deps = new Set<string>();
    const regex = /\b([A-Z]+[0-9]+)\b/g;
    let match;
    while ((match = regex.exec(input)) !== null) {
      deps.add(match[1]);
    }
    return deps;
  }

  private updateDependencies(cell: Cell, newDeps: Set<string>) {
    // Remove old deps
    for (const oldDepId of cell.dependencies) {
      if (!newDeps.has(oldDepId)) {
        const depCell = this.getCell(oldDepId);
        depCell.dependents.delete(cell.id);
      }
    }
    // Add new deps
    for (const newDepId of newDeps) {
      if (!cell.dependencies.has(newDepId)) {
        const depCell = this.getCell(newDepId);
        depCell.dependents.add(cell.id);
      }
    }
    cell.dependencies = newDeps;
  }

  async recalculate(startId: string) {
    // Simple topological sort or recursive eval
    // MVP: Depth First traversal with cycle detection
    // MVP: Depth First traversal with cycle detection

    // Queue for processing to avoid deep recursion if needed, but recursive is fine for small depths.
    // However, for async traversal, we want to yield.

    const buildOrder = (id: string): Set<string> => {
      // Step 1: BFS to find all reachable dependents
      const queue = [id];
      const dirty = new Set<string>();

      // If the start node is circular, abort?
      // Or just treat as normal.

      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (dirty.has(curr)) continue;
        dirty.add(curr);

        const cell = this.getCell(curr);
        // Mark as evaluating immediately so UI reflects it
        if (cell.status !== "circular") {
          cell.status = "evaluating";
          this.markDirty(cell.id);
        }

        for (const d of cell.dependents) {
          queue.push(d);
        }
      }
      return dirty;
    };

    const dirtySet = buildOrder(startId);
    this.notifyListeners(); // Update UI to show "Evaluating..."

    // Step 2: Topo sort the dirty set?
    // Or just re-eval iteratively until convergence?
    // Spreadsheets use topo sort.
    // Kahn's algorithm on the subgraph induced by dirtySet.

    // 2a. Build in-degree map for dirty subgraph
    const inDegree = new Map<string, number>();
    for (const id of dirtySet) {
      inDegree.set(id, 0);
    }

    for (const id of dirtySet) {
      const cell = this.getCell(id);
      for (const dep of cell.dependents) {
        if (dirtySet.has(dep)) {
          inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
        }
      }
    }

    // 2b. Queue of Nodes with 0 in-degree (within dirty subgraph)
    const execQueue: string[] = [];
    // The startId is definitely a root of the dirty subgraph (since we followed dependents from it)
    // UNLESS there are cycles.
    // Actually startId might depend on others outside dirty set (constants).
    // In the Dirty Subgraph, startId has in-degree 0 (from other dirty nodes).

    for (const [id, deg] of inDegree) {
      if (deg === 0) execQueue.push(id);
    }

    // 3. Execute
    let processedCount = 0;
    while (execQueue.length > 0) {
      const currId = execQueue.shift()!;
      const cell = this.getCell(currId);

      // Evaluate
      this.evaluateCell(cell);
      processedCount++;

      // Yield every N items or if time elapsed
      if (processedCount % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        this.notifyListeners(); // Incremental update
      }

      // Propagate
      for (const depId of cell.dependents) {
        if (dirtySet.has(depId)) {
          const d = (inDegree.get(depId) || 0) - 1;
          inDegree.set(depId, d);
          if (d === 0) {
            execQueue.push(depId);
          }
        }
      }
    }

    // Check cycles
    if (processedCount < dirtySet.size) {
      // Remaining nodes in cycle
      for (const [id, deg] of inDegree) {
        if (deg > 0) {
          const c = this.getCell(id);
          c.status = "circular";
          this.markDirty(id);
        }
      }
    }

    this.notifyListeners();
  }

  private evaluateCell(cell: Cell) {
    if (cell.status === "circular") return;

    try {
      if (cell.rawInput.startsWith("=")) {
        // Formula
        const expr = cell.rawInput.substring(1);
        // TODO: Real evaluation
        // For now, mock evaluation logic
        // e.g. if A1 + B1, get A1.value and B1.value and add.
        cell.value = this.evaluateExpression(expr);
      } else {
        // Constant Scalar?
        // Use stricter check than parseFloat to avoid "1回転" -> 1
        const trimmed = cell.rawInput.trim();
        // Regex for number: optional -, digits, optional dot digits.
        // But allow scientific notation? Number() handles it.
        // Number("1abc") -> NaN. Number("1") -> 1. Number("") -> 0.
        const num = trimmed === "" ? NaN : Number(trimmed);
        if (!isNaN(num)) {
          cell.value = new Dist([{ type: "atom", x: num, p: 1 }]);
        } else {
          // String or empty?
          cell.value = new Dist([]);
        }
      }
      cell.status = "ok";
      this.markDirty(cell.id); // Value updated
    } catch (e: unknown) {
      cell.status = "error";
      cell.error = (e as Error).message;
      this.markDirty(cell.id); // Error updated
    }
  }

  config = {
    maxComponents: 200,
  };

  setGlobalConfig(config: { maxComponents: number }) {
    this.config = config;
    // Mark all dirty? Or just assume next recalc picks it up?
    // For now, let's just update. User might need to trigger recalc.
  }

  private evaluateExpression(expr: string): Dist {
    return evaluate(expr, {
      getValue: (id) => this.getCell(id).value,
      maxComponents: this.config.maxComponents,
      wasmMonteCarlo: this.wasmMonteCarlo ?? undefined,
    });
  }

  toJSON(): string {
    const data = {
      version: 1,
      config: this.config,
      cells: {} as Record<string, string>,
    };
    for (const [id, cell] of this.cells) {
      if (cell.rawInput) {
        data.cells[id] = cell.rawInput;
      }
    }
    return JSON.stringify(data, null, 2);
  }

  fromJSON(json: string) {
    try {
      const data = JSON.parse(json);
      if (!data || typeof data !== "object")
        throw new Error("Invalid BNPU file");

      // Load Config
      if (data.config) {
        this.setGlobalConfig(data.config);
      }

      // Load Cells
      // Clear existing? or Merge?
      // "Load" usually implies "Open", so clear existing.
      this.cells.clear();

      if (data.cells) {
        // We set inputs. But we need to do it carefully to trigger dependency updates properly.
        // Simplest: just set all, then recalculate all?
        // Or setCellInput one by one.
        for (const [id, input] of Object.entries(data.cells)) {
          // We can use setCellInput, but it triggers individual recalcs.
          // Optimization: Set all inputs, then calc all.
          // For MVP, just reusing setCellInput is fine unless N is huge.
          this.setCellInput(id, input as string);
        }
      }
    } catch (e: unknown) {
      console.error("Failed to load file", e);
      throw e;
    }
  }
}
