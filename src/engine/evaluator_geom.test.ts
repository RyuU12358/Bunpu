import { describe, it, expect } from "vitest";
import { evaluate } from "./evaluator";
import { Dist } from "../core/dist";
import type { Atom } from "../core/types";

const mockCtx = {
  getValue: (_id: string) => {
    return new Dist([]);
  },
};

describe("GEOM_SUM Function", () => {
  it("Zero probability handling", () => {
    // p=0 -> Always 0 repetitions. Sum is 0.
    const d = evaluate("GEOM_SUM(CONST(10), 0)", mockCtx);
    expect(d.components.length).toBe(1);
    expect((d.components[0] as Atom).x).toBe(0);
  });

  it("Basic Mean Check (p=0.5)", () => {
    // Base 10. p=0.5.
    // Expected repetitions N ~ Geom(0.5). Mean = p/(1-p) = 1.
    // Expected Sum = 1 * 10 = 10.
    const d = evaluate("GEOM_SUM(CONST(10), 0.5)", mockCtx);
    const mean = d.mean();
    expect(mean).toBeCloseTo(10, 1);
  });

  it("Higher Probability (p=0.8)", () => {
    // Base 10. p=0.8.
    // Mean N = 0.8/0.2 = 4.
    // Expected Sum = 40.
    const d = evaluate("GEOM_SUM(CONST(10), 0.8)", mockCtx);
    const mean = d.mean();
    expect(mean).toBeCloseTo(40, 1);
  });

  it("Distribution check (p=0.5, Base=1)", () => {
    // p=0.5.
    // k=0 (prob 0.5): Sum 0
    // k=1 (prob 0.25): Sum 1
    // k=2 (prob 0.125): Sum 2
    const d = evaluate("GEOM_SUM(CONST(1), 0.5)", mockCtx);
    const atoms = d.components as Atom[];

    const a0 = atoms.find((a) => Math.abs(a.x - 0) < 0.01);
    const a1 = atoms.find((a) => Math.abs(a.x - 1) < 0.01);
    const a2 = atoms.find((a) => Math.abs(a.x - 2) < 0.01);

    expect(a0?.p).toBeCloseTo(0.5, 2);
    expect(a1?.p).toBeCloseTo(0.25, 2);
    expect(a2?.p).toBeCloseTo(0.125, 2);
  });

  it("Integration with Pachinko usage", () => {
    // 1500 payout, 81% loop.
    // Total = First(1500) + Loop(1500, 0.81).
    // Loop Mean = 0.81/0.19 * 1500 = 4.26 * 1500 ~= 6394.
    // Total Mean ~= 7894.
    const formula = "ADD(CONST(1500), GEOM_SUM(CONST(1500), 0.81))";
    const d = evaluate(formula, mockCtx);
    const mean = d.mean();
    expect(mean).toBeGreaterThan(7800);
    expect(mean).toBeLessThan(8000);
  });
});
