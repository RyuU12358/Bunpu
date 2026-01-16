import { describe, it, expect } from "vitest";
import { Graph } from "./graph";
import type { Atom, Bin } from "../core/types";

describe("Graph Engine", () => {
  it("should evaluate simple scalar arithmetic", () => {
    const g = new Graph();
    g.setCellInput("A1", "10");
    g.setCellInput("A2", "=A1 * 2");

    const c = g.getCell("A2");
    expect(c.status, `Cell error: ${c.error}`).toBe("ok");
    expect(c.value.components).toHaveLength(1);
    expect((c.value.components[0] as Atom).x).toBe(20);
  });

  it("should add distributions (convolution)", () => {
    // A1 = 0.5@1, 0.5@2 (Using Mix logic to create)
    // Actually we don't have atomic Set syntax yet.
    // Use A1 = Mix(1, 2, 0.5)

    const g = new Graph();
    g.setCellInput("A1", "=MIX(0.5, 1, 2)"); // 50% 1, 50% 2. (Note: Mix(p, A, B) -> (1-p)A + pB? No, Logic is p*A + (1-p)B? Wait.
    // evaluator logic: MIX(p, A, B) => A.mix(B, p).
    // Dist.mix(other, p) => (1-p)This + p*Other.
    // So A.mix(B, p) => (1-p)A + pB.
    // We want 50/50 so it doesn't matter, but syntax does.
    // MIX(0.5, 1, 2) => p=0.5. A=1. B=2.
    // Result: 0.5*1 + 0.5*2. Correct.
    // A2 = 10
    g.setCellInput("A2", "10");
    // A3 = A1 + A2 -> 0.5@11, 0.5@12
    g.setCellInput("A3", "=A1 + A2");

    const a3 = g.getCell("A3");
    expect(a3.status).toBe("ok");
    const comps = a3.value.components;

    const xValues = comps.map((c) => (c as Atom).x).sort();
    expect(xValues).toEqual([11, 12]);
  });

  it("should support Uniform distribution and Bin ops", () => {
    const g = new Graph();
    g.setCellInput("B1", "=UNIFORM(0, 10)"); // Bin [0, 10]
    g.setCellInput("B2", "=B1 + 5"); // Shift -> Bin [5, 15]

    const b2 = g.getCell("B2");
    const bin = b2.value.components[0] as Bin;
    expect(bin.type).toBe("bin");
    expect(bin.a).toBe(5);
    expect(bin.b).toBe(15);
  });

  it("should handle dependencies correctly", () => {
    const g = new Graph();
    g.setCellInput("C1", "1");
    g.setCellInput("C2", "=C1 + 1"); // 2
    g.setCellInput("C3", "=C2 + 1"); // 3

    let c3 = g.getCell("C3");
    expect((c3.value.components[0] as Atom).x).toBe(3);

    // Update C1
    g.setCellInput("C1", "10");
    // Should propagate
    c3 = g.getCell("C3");
    expect((c3.value.components[0] as Atom).x).toBe(12);
  });
});
