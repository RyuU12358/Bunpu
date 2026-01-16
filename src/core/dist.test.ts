import { describe, it, expect } from "vitest";
import { Dist } from "./dist";
import type { Atom, Bin } from "./types";

describe("Dist", () => {
  it("should normalize correctly", () => {
    const d = new Dist([
      { type: "atom", x: 1, p: 0.2 },
      { type: "atom", x: 2, p: 0.6 },
    ]);
    d.normalize();
    const c0 = d.components[0] as Atom;
    const c1 = d.components[1] as Atom;
    expect(c0.p).toBeCloseTo(0.25);
    expect(c1.p).toBeCloseTo(0.75);
  });

  it("should sort components", () => {
    const d = new Dist([
      { type: "atom", x: 10, p: 0.5 },
      { type: "atom", x: 0, p: 0.5 },
    ]);
    expect((d.components[0] as Atom).x).toBe(0);
    expect((d.components[1] as Atom).x).toBe(10);
  });

  it("should add two atomic distributions", () => {
    // D1 = 0.5@1, 0.5@2
    // D2 = 1.0@10
    // Sum = 0.5@11, 0.5@12
    const d1 = new Dist([
      { type: "atom", x: 1, p: 0.5 },
      { type: "atom", x: 2, p: 0.5 },
    ]);
    const d2 = new Dist([{ type: "atom", x: 10, p: 1.0 }]);

    const sum = d1.add(d2);
    expect(sum.components).toHaveLength(2);
    const s0 = sum.components[0] as Atom;
    const s1 = sum.components[1] as Atom;
    expect(s0.x).toBe(11);
    expect(s0.p).toBe(0.5);
    expect(s1.x).toBe(12);
    expect(s1.p).toBe(0.5);
  });

  it("scroll convolve bin and atom", () => {
    // Bin [0, 2] (width 2, mean 1) + Atom @ 10
    // Result: Bin [10, 12] (mean 11)
    const d1 = new Dist([
      { type: "bin", a: 0, b: 2, p: 1, repr: 1, shape: "uniform" },
    ]);
    const d2 = new Dist([{ type: "atom", x: 10, p: 1 }]);

    const sum = d1.add(d2);
    const res = sum.components[0] as Bin;
    expect(res.type).toBe("bin");
    expect(res.a).toBe(10);
    expect(res.b).toBe(12);
    expect(res.repr).toBe(11);
  });

  it("should convolve two bins (Gaussian approx)", () => {
    // Bin1 [0, 2] (w=2, var=4/12=0.33)
    // Bin2 [0, 2] (w=2, var=0.33)
    // Sum Mean = 1+1=2.
    // Sum Var = 0.66.
    // New Width = sqrt(12 * 0.66) = sqrt(8) approx 2.828
    const d1 = new Dist([
      { type: "bin", a: 0, b: 2, p: 1, repr: 1, shape: "uniform" },
    ]);
    const d2 = new Dist([
      { type: "bin", a: 0, b: 2, p: 1, repr: 1, shape: "uniform" },
    ]);

    const sum = d1.add(d2);
    const res = sum.components[0] as Bin;

    expect(res.a).toBeCloseTo(2 - Math.sqrt(8) / 2);
    expect(res.b).toBeCloseTo(2 + Math.sqrt(8) / 2);
  });
});
