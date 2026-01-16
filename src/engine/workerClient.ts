import { Dist } from "../core/dist";
import { Cell } from "./cell";
import type { CellUpdateData, WorkerAction, WorkerEvent } from "./worker/types";

export class WorkerClient {
  private worker: Worker;
  private cells: Map<string, Cell> = new Map();
  private listeners: Array<() => void> = [];

  constructor() {
    this.worker = new Worker(
      new URL("./worker/main.worker.ts", import.meta.url),
      {
        type: "module",
      }
    );

    this.worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
      const event = e.data;
      if (event.type === "UPDATE_CELLS") {
        this.handleUpdates(event.updates);
      } else if (event.type === "READY") {
        console.log("Worker Ready");
      }
    };

    this.worker.onerror = (e) => {
      console.error("Worker Error:", e);
    };
  }

  // --- Graph Interface ---

  getCell(id: string): Cell {
    if (!this.cells.has(id)) {
      // Return a placeholder? Or create empty.
      // Similar to Graph.ts logic
      const c = new Cell(id);
      this.cells.set(id, c);
      return c;
    }
    return this.cells.get(id)!;
  }

  getAllCells(): IterableIterator<Cell> {
    return this.cells.values();
  }

  setCellInput(id: string, val: string) {
    // Skip if value hasn't changed (prevents double-commit)
    const cell = this.getCell(id);
    if (cell.rawInput === val) {
      return;
    }

    cell.rawInput = val;
    cell.status = "evaluating"; // Show evaluating immediately
    this.notifyListeners();

    // Send to worker
    this.postMessage({ type: "SET_INPUT", id, val });
  }

  setGlobalConfig(config: { maxComponents: number }) {
    this.postMessage({ type: "SET_CONFIG", config });
  }

  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  toJSON(): string {
    // Serialize local state?
    // Or ask worker?
    // UI save functionality needs data.
    // We maintain a mirror of `rawInput` in local cells.
    // So we can serialize local cells.
    const data = {
      version: 1,
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
    // Send to worker
    this.postMessage({ type: "LOAD_JSON", json });

    // Also parse locally to update inputs immediately?
    // Or wait for worker "GET_ALL" / "UPDATE_CELLS"?
    // If we wait, UI might be empty for a split second.
    // But parsing JSON is fast.
    try {
      const data = JSON.parse(json);
      // We can update local inputs
      if (data.cells) {
        for (const [id, val] of Object.entries(data.cells)) {
          const c = this.getCell(id);
          c.rawInput = val as string;
        }
      }
      this.notifyListeners();
    } catch (e) {
      console.error("Local JSON parse error", e);
    }
  }

  // --- Private ---

  private postMessage(action: WorkerAction) {
    this.worker.postMessage(action);
  }

  private handleUpdates(updates: CellUpdateData[]) {
    for (const up of updates) {
      const cell = this.getCell(up.id);
      cell.status = up.status;
      if (up.error !== undefined) cell.error = up.error;
      if (up.value) {
        // Rehydrate Dist
        // We use a constructor that accepts components
        cell.value = new Dist(up.value.components);
      }
      if (up.rawInput !== undefined) {
        cell.rawInput = up.rawInput;
      }
    }
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach((l) => l());
  }
}
