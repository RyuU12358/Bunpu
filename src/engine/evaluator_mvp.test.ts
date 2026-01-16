import { describe, it, expect } from "vitest";
import { evaluate } from "./evaluator";
import { Dist } from "../core/dist";
import type { Atom, Bin } from "../core/types";

const mockCtx = {
  getValue: (id: string) => {
    if (id === "A1") return new Dist([{ type: "atom", x: 10, p: 1 }]);
    return new Dist([]);
  },
};

describe("Evaluator MVP Functions", () => {
  it("CONST", () => {
    const d = evaluate("CONST(5)", mockCtx);
    expect((d.components[0] as Atom).x).toBe(5);
  });

  it("BIN", () => {
    const d = evaluate("BIN(0, 10, 0.5)", mockCtx);
    expect(d.components[0].type).toBe("bin");
    expect((d.components[0] as Bin).p).toBe(0.5);
  });

  it("ADD", () => {
    const d = evaluate("ADD(CONST(1), CONST(2))", mockCtx);
    expect((d.components[0] as Atom).x).toBe(3);
  });

  it("MIX (p, A, B)", () => {
    // MIX(0.1, 0, 100) -> 0.1 of 0, 0.9 of 100
    const d = evaluate("MIX(0.1, CONST(0), CONST(100))", mockCtx);
    const atoms = d.components as Atom[];
    const a0 = atoms.find((a) => a.x === 0);
    const a100 = atoms.find((a) => a.x === 100);

    expect(a0?.p).toBeCloseTo(0.1);
    expect(a100?.p).toBeCloseTo(0.9);
  });

  it("MEAN", () => {
    // BIN(0, 10) -> Mean 5
    const d = evaluate("MEAN(BIN(0, 10, 1))", mockCtx);
    expect((d.components[0] as Atom).x).toBe(5);
  });

  it("PROB_GT", () => {
    // BIN(0, 10). Prob > 8 is 0.2
    const d = evaluate("PROB_GT(BIN(0, 10, 1), 8)", mockCtx);
    expect((d.components[0] as Atom).x).toBeCloseTo(0.2);
  });

  it("RESAMPLE", () => {
    const d = evaluate("RESAMPLE(BIN(0, 10, 1), 100)", mockCtx);
    expect(d.components.length).toBe(100);
    // reduce needs narrowing
    const totalP = d.components.reduce((s, c) => {
      if (c.type === "tail") return s + c.mass;
      return s + c.p;
    }, 0);
    expect(totalP).toBeCloseTo(1);
  });

  it("REF", () => {
    const d = evaluate("REF(A1)", mockCtx);
    expect((d.components[0] as Atom).x).toBe(10);
  });

  it("Negative Numbers", () => {
    const d = evaluate("CONST(-100)", mockCtx);
    expect((d.components[0] as Atom).x).toBe(-100);
  });
});

describe("Evaluator Safety Mechanism", () => {
  const safeCtx = {
    ...mockCtx,
    maxComponents: 10, // Very low limit for testing
  };

  it("Should auto-reduce when exceeding limit", () => {
    // Create 20 atoms: RESAMPLE(CONST(0), 20) ? No, resample makes normalized dist.
    // Let's use RESAMPLE on invalid bin to get many atoms.
    // BIN(0,1) -> RESAMPLE 20 -> 20 atoms.
    // Default ctx has no limit? mockCtx doesn't. safeCtx has 10.

    const d = evaluate("RESAMPLE(BIN(0, 1), 20)", safeCtx);
    // Should be reduced to ~10 (targetN=10)
    expect(d.components.length).toBeLessThanOrEqual(15); // Reduce is approximate?
    // Greedy reduce usually hits targetN exactly or slightly less/more depending on merge.
    // reduce implementation: while (len > targetN) merge.
    // So result should be <= targetN.
    expect(d.components.length).toBeLessThanOrEqual(10);
  });

  it("CONFIG should override limit", () => {
    // Override limit to 50
    const d = evaluate("CONFIG(50, RESAMPLE(BIN(0, 1), 20))", safeCtx);
    // Should NOT be reduced, as 20 < 50.
    expect(d.components.length).toBe(20);
  });

  it("Explosion Test (Convolution)", () => {
    // 5 atoms * 5 atoms = 25 atoms.
    // Limit 10.
    // A = RESAMPLE(BIN(0,1), 5)
    // B = A + A

    // We can't easily refer to A inside evaluate unless we put it in context.
    // But we can just nested expression.
    // ADD(RESAMPLE(BIN(0,1), 5), RESAMPLE(BIN(0,1), 5))

    // Note: Convolution of independent samples.
    const d = evaluate(
      "ADD(RESAMPLE(BIN(0,1), 5), RESAMPLE(BIN(0,1), 5))",
      safeCtx
    );
    expect(d.components.length).toBeLessThanOrEqual(10);
  });
});
