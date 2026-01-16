export type DistributionType = "atom" | "bin" | "tail";

export interface Atom {
  type: "atom";
  x: number;
  p: number;
}

export interface Bin {
  type: "bin";
  a: number; // start
  b: number; // end. must be a < b
  p: number;
  repr: number; // representative value (e.g. median)
  shape: "uniform" | "linear" | "custom";
}

export interface Tail {
  type: "tail";
  side: "left" | "right";
  x0: number; // start of tail (boundary with body)
  mass: number;
  family: "exp" | "geom" | "pareto" | "lognormal";
  params: Record<string, number>; // e.g. { lambda: 0.5 }
  cap?: number;
}

export type DistComponent = Atom | Bin | Tail;
