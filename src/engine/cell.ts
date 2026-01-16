import { Dist } from "../core/dist";

export type CellStatus = "pending" | "ok" | "error" | "circular" | "evaluating";

export class Cell {
  id: string;
  rawInput: string = "";
  value: Dist; // We treat scalars as Atom distributions
  status: CellStatus = "ok";
  error: string | null = null;

  dependencies: Set<string> = new Set();
  dependents: Set<string> = new Set(); // Reverse dependencies

  constructor(id: string) {
    this.id = id;
    this.value = new Dist([]); // Empty dist
  }
}
