import type { CellStatus } from "../cell";
// We transfer minimal data for Dist to avoid overhead
// or just full DistComponent[] array.
import type { DistComponent } from "../../core/types";

export type WorkerAction =
  | { type: "SET_INPUT"; id: string; val: string }
  | { type: "SET_CONFIG"; config: { maxComponents: number } }
  | { type: "GET_ALL" } // Force full refresh
  | { type: "LOAD_JSON"; json: string };

// Dist data for transport
export interface DistData {
  components: DistComponent[];
}

export type CellUpdateData = {
  id: string;
  status: CellStatus;
  value?: DistData;
  error?: string;
  rawInput?: string; // Optional echo
};

export type WorkerEvent =
  | { type: "UPDATE_CELLS"; updates: CellUpdateData[] }
  | { type: "READY" };
