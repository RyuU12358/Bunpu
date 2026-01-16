import { describe, it, expect } from "vitest";
import { Dist } from "./dist";
import { reduce } from "./reducer"; // Should export reduce
import type { Atom, Bin } from "./types";

describe("Reducer", () => {
  it("should split bins at boundaries", () => {
    // Bin [-1, 1], Boundary 0
    const d = new Dist([
      { type: "bin", a: -1, b: 1, p: 1, repr: 0, shape: "uniform" },
    ]);

    const reduced = reduce(d, { targetN: 10, boundaries: [0] });

    expect(reduced.components).toHaveLength(2);
    const b1 = reduced.components[0] as Bin;
    const b2 = reduced.components[1] as Bin;

    expect(b1.a).toBe(-1);
    expect(b1.b).toBe(0);
    expect(b1.p).toBeCloseTo(0.5);

    expect(b2.a).toBe(0);
    expect(b2.b).toBe(1);
    expect(b2.p).toBeCloseTo(0.5);
  });

  it("should merge valley atoms", () => {
    // 3 atoms with low importance, away from center.
    // Center=0, Atoms at 10, 11, 12.
    // Impact ~= 10. p needs to be small for I < tau.
    // Let p=0.0001, impact=10 => I=0.001.
    // Let tau = 0.01.

    const d = new Dist([
      { type: "atom", x: 10, p: 0.0001 },
      { type: "atom", x: 11, p: 0.0001 },
      { type: "atom", x: 12, p: 0.0001 },
      { type: "atom", x: 2, p: 0.9 }, // High importance (impact=|2-0|=2), keep
    ]);

    const reduced = reduce(d, { targetN: 10, tau: 0.01 });

    // The 3 atoms at 10,11,12 should merge into one Bin [10, 12].
    // The atom at 2 should stay.
    // Expected: Atom(2), Bin([10,12])

    expect(reduced.components.length).toBeLessThan(4);

    const checkAtom = reduced.components.find(
      (c) => c.type === "atom" && c.x === 2
    );
    expect(checkAtom).toBeDefined();

    const checkBin = reduced.components.find((c) => c.type === "bin");
    expect(checkBin).toBeDefined();
    if (checkBin && checkBin.type === "bin") {
      expect(checkBin.a).toBe(10);
      expect(checkBin.b).toBe(12);
      expect(checkBin.p).toBeCloseTo(0.0003);
    }
  });

  it("should respect boundaries during merge", () => {
    // Atoms at -1 and 1. Low importance. Boundary at 0.
    // Should NOT merge.
    const d = new Dist([
      { type: "atom", x: -1, p: 0.0001 },
      { type: "atom", x: 1, p: 0.0001 },
    ]);

    const reduced = reduce(d, { targetN: 5, boundaries: [0], tau: 100 });
    // High tau to force merge attempt if ignored boundary

    expect(reduced.components).toHaveLength(2);
    expect((reduced.components[0] as Atom).x).toBe(-1);
    expect((reduced.components[1] as Atom).x).toBe(1);
  });

  it("should greedy reduce to targetN", () => {
    // 10 atoms. targetN = 5. All same importance.
    const atoms = Array.from({ length: 10 }, (_, i) => ({
      type: "atom" as const,
      x: i,
      p: 0.1,
    }));
    const d = new Dist(atoms);

    const reduced = reduce(d, { targetN: 5 });
    expect(reduced.components.length).toBe(5);
  });
});
