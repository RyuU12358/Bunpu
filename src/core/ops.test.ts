import { describe, it, expect } from "vitest";
import { Dist } from "./dist";
import type { Atom } from "./types";

describe("Dist Operations", () => {
  it("should scale atoms", () => {
    const d = new Dist([{ type: "atom", x: 2, p: 1 }]);
    const scaled = d.scale(3);
    const s0 = scaled.components[0] as Atom;
    expect(s0.x).toBe(6);
    expect(s0.p).toBe(1);

    const neg = d.scale(-2);
    expect((neg.components[0] as Atom).x).toBe(-4);
  });

  it("should subtract distributions", () => {
    // 5 - 2 = 3
    const d1 = new Dist([{ type: "atom", x: 5, p: 1 }]);
    const d2 = new Dist([{ type: "atom", x: 2, p: 1 }]);
    const sub = d1.sub(d2);
    expect((sub.components[0] as Atom).x).toBe(3);
  });

  it("should mix distributions", () => {
    // 50% of 10, 50% of 20.
    const d1 = new Dist([{ type: "atom", x: 10, p: 1 }]);
    const d2 = new Dist([{ type: "atom", x: 20, p: 1 }]);

    const mixed = d1.mix(d2, 0.5);
    // Should have 10 (p=0.5) and 20 (p=0.5)
    expect(mixed.components).toHaveLength(2);
    const m0 = mixed.components[0] as Atom;
    const m1 = mixed.components[1] as Atom;
    expect(m0.x).toBe(10);
    expect(m0.p).toBe(0.5);
    expect(m1.x).toBe(20);
    expect(m1.p).toBe(0.5);
  });
});
