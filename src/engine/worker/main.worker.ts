import { Graph } from "../graph";
import type { Cell } from "../cell";
import { setWasmConvolve, setWasmDistFns } from "../../core/dist";
import type { WorkerAction, WorkerEvent, CellUpdateData } from "./types";
import type { DistComponent } from "../../core/types";

const ctx: Worker = self as unknown as Worker;
const graph = new Graph();

// Initialize Wasm Monte Carlo and Convolution
async function initWasm() {
  try {
    const wasm = await import("../../../wasm-bunpu/pkg/wasm_bunpu.js");
    await wasm.default();

    // Create wrapper function for Monte Carlo (converts components to flat array)
    const wasmMonteCarlo = (
      components: DistComponent[],
      initWealth: number,
      steps: number,
      numTrials: number
    ): number => {
      const data: number[] = [];
      for (const c of components) {
        if (c.type === "atom") {
          data.push(0, c.x, c.p);
        } else if (c.type === "bin") {
          data.push(1, c.a, c.b, c.p);
        } else if (c.type === "tail") {
          const lambda = c.params.lambda || 1;
          const isRight = c.side === "right" ? 1 : 0;
          data.push(2, c.x0, c.mass, lambda, isRight);
        }
      }
      return wasm.run_monte_carlo(
        new Float64Array(data),
        initWealth,
        steps,
        numTrials
      );
    };

    graph.wasmMonteCarlo = wasmMonteCarlo;

    // Set Wasm convolution for Dist.add()
    setWasmConvolve((d1: Float64Array, d2: Float64Array) => {
      return wasm.convolve_distributions(d1, d2);
    });

    // Set Wasm Dist functions for mean, variance, std, probGt, mix, scale
    setWasmDistFns({
      mean: (d: Float64Array) => wasm.dist_mean(d),
      variance: (d: Float64Array) => wasm.dist_variance(d),
      std: (d: Float64Array) => wasm.dist_std(d),
      probGt: (d: Float64Array, x: number) => wasm.dist_prob_gt(d, x),
      mix: (d1: Float64Array, d2: Float64Array, p: number) =>
        wasm.dist_mix(d1, d2, p),
      scale: (d: Float64Array, k: number) => wasm.dist_scale(d, k),
    });

    console.log("[Worker] Wasm fully initialized (MC + Conv + Dist ops)");
  } catch (err) {
    console.warn("[Worker] Wasm not available, using JS fallback:", err);
  }
}

// Start Wasm initialization
initWasm();

// Override graph.notifyListeners to post updates
// But Graph currently notifies generic "change".
// We need to know WHAT changed to optimize.
// For now, let's just send the whole Dirty set logic inside Recalculate?
// Graph.recalculate logic currently doesn't expose the dirty set easily outside.
// BUT, we can just intercept the `notifyListeners`.
// However, `recalculate` is async now.
// We should probably modify Graph to emit "cell updated" events or similar.
// Or just piggyback on `subscribe`.
// Problem: `subscribe` takes no args. We don't know what changed.
// Solution: We can diff the state or (Better) modify Graph to expose dirty list.
// MVP: Just send ALL cells? No, too heavy.
// Let's modify Graph to allow subscribing to specific updates or just access dirty set.

// Let's extend Graph or modify it in place.
// Since we own the codebase, modifying Graph is best.
// But for now, let's just implement a dirty tracker here if possible.
// Actually, `Graph` stores state. We can iterate all cells and check a "revision" or "dirty" flag?
// Graph cells don't have revision.
// Let's add a simple "getUpdates()" method to Graph or just traverse?

// BETTER: Modify Graph.recalculate to return the set of updated dirty cells.
// But recalculate is async and yields.
// Maybe we just poll?
// No. The `notifyListeners` is called during and after recalculate.
// Let's rely on the fact that `recalculate` updates status to "evaluating" or "ok".
// We can scan for changes if we assume `notifyListeners` implies changes.
// To avoid scanning 1000 cells every frame:
// We can add a "dirtyList" to Graph?

// Let's just modify Graph to emit updates.
// But first, standard message loop.

ctx.onmessage = async (e: MessageEvent<WorkerAction>) => {
  const action = e.data;

  if (action.type === "SET_INPUT") {
    // This triggers recalculate inside graph.
    // We want to capture updates produced by this.
    graph.setCellInput(
      action.type === "SET_INPUT" ? action.id : "",
      action.val
    );
  } else if (action.type === "SET_CONFIG") {
    graph.setGlobalConfig(action.config);
  } else if (action.type === "LOAD_JSON") {
    graph.fromJSON(action.json);
    postFullUpdate();
  } else if (action.type === "GET_ALL") {
    postFullUpdate();
  }
};

// We need a way to detect changes.
// Monkey-patch graph's setCellInput? No.
// Let's modify Graph to accept a callback that receives updated cells.
// See `graph.ts` modifications later.
// For now, let's assume we can scan or just send all (MVP).
// If MVP size is small (<1000), sending all metadata (status, input) is fast.
// Sending all distributions (arrays) is SLOW.
// So we must only send Changed Dists.

// Temporary solution until Graph refactor:
// Maintain a cache of sent versions/hashes?
// Or just modify Graph to track dirty cells.
// We will modify Graph in the next step.
// Here we assume `graph.getRecentUpdates()` exists or similar.

// Let's define the subscriber to pull updates.
graph.subscribe(() => {
  // This is called periodically by recalculate.
  // We want to find what changed.
  // Accessing private/internal state?
  // Let's iterate all cells and check if they are marked "dirty" (we need to add this property).

  // For now, in this file, we assume we will add `getDirtyAndClear()` to graph.
  const updates = graph.getDirtyAndClear();
  if (updates) {
    postUpdates(updates);
  }
});

function postUpdates(cells: Cell[]) {
  const updates: CellUpdateData[] = cells.map((c) => ({
    id: c.id,
    status: c.status,
    value: c.status === "ok" ? { components: c.value.components } : undefined,
    error: c.error || undefined,
    rawInput: c.rawInput,
  }));
  const msg: WorkerEvent = { type: "UPDATE_CELLS", updates };
  ctx.postMessage(msg);
}

function postFullUpdate() {
  // Send everything
  const cells = Array.from(graph.getAllCells());
  postUpdates(cells);
}

// Signal readiness
const ready: WorkerEvent = { type: "READY" };
ctx.postMessage(ready);
