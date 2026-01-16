import { describe, it, expect } from "vitest";
import { evaluate } from "./evaluator";
import { Dist } from "../core/dist";
import type { Atom } from "../core/types";

const mockCtx = {
  getValue: (id: string) => {
    // Mock simple table:
    // A1=10, B1=0.5
    // A2=20, B2=0.5
    if (id === "A1") return new Dist([{ type: "atom", x: 10, p: 1 }]);
    if (id === "B1") return new Dist([{ type: "atom", x: 0.5, p: 1 }]);
    if (id === "A2") return new Dist([{ type: "atom", x: 20, p: 1 }]);
    if (id === "B2") return new Dist([{ type: "atom", x: 0.5, p: 1 }]);

    // C1=100
    if (id === "C1") return new Dist([{ type: "atom", x: 100, p: 1 }]);

    return new Dist([]);
  },
};

describe("Evaluator Range Selection", () => {
  it("Tokenize Colon", () => {
    // Just checking if evaluation works with colon in syntax
    // evaluate uses tokenize internally
    // If tokenize fails, evaluate throws
    // Actually parser expects Expression. A1:B2 is not valid expression top level.
    // Parser will parse A1. Then see COLON.
    // parseExpression -> parseTerm -> ... -> ID(A1).
    // Then loop looks for + - * / ...
    // COLON is not operator. So parseExpression returns A1.
    // Then parser expects EOF? No, evaluate calls parseExpression and returns.
    // If there are leftover tokens, it's ignored by current evaluate implementation?
    // Let's check evaluate:
    // const parser = new Parser(tokens, ctx);
    // return parser.parseExpression();
    // It does not check if all tokens consumed. So A1:B2 returns A1.

    const d = evaluate("A1:B2", mockCtx);
    expect((d.components[0] as Atom).x).toBe(10); // A1
  });

  it("Function Call with Range", () => {
    // DISCRETE(A1:B2) -> DISCRETE(A1, B1, A2, B2)
    // A1=10, B1=0.5, A2=20, B2=0.5
    // -> DISCRETE(10, 0.5, 20, 0.5)

    const d = evaluate("DISCRETE(A1:B2)", mockCtx);
    // Should return dist with values 10 and 20, prob 0.5 each.

    expect(d.components.length).toBe(2);
    const atoms = d.components as Atom[];
    const a10 = atoms.find((a) => a.x === 10);
    const a20 = atoms.find((a) => a.x === 20);

    expect(a10).toBeDefined();
    expect(a10?.p).toBeCloseTo(0.5);
    expect(a20).toBeDefined();
    expect(a20?.p).toBeCloseTo(0.5);
  });

  it("Mixed Ranges and Single Args", () => {
    // CHOICE(A1, B1, C1, 0.1) -> CHOICE(10, 0.5, 100, 0.1)
    // Note: CHOICE weights normalize. 0.5 + 0.1 = 0.6.
    // 10: 0.5/0.6 = 5/6
    // 100: 0.1/0.6 = 1/6

    const d = evaluate("CHOICE(A1:B1, C1, 0.1)", mockCtx);

    const atoms = d.components as Atom[];
    const a10 = atoms.find((a) => a.x === 10);
    const a100 = atoms.find((a) => a.x === 100);

    expect(a10?.p).toBeCloseTo(0.5 / 0.6);
    expect(a100?.p).toBeCloseTo(0.1 / 0.6);
  });

  it("Reverse Range", () => {
    // A2:A1 -> Should be A1, A2 (Row major? Or strictly min to max?)
    // Implementation uses minR..maxR. So order is always Top-Left to Bottom-Right.
    // A2:A1 -> A1, A2.
    // DISCRETE(A1, A2) -> Error? No, DISCRETE needs pairs.
    // Wait, A1=10, A2=20.
    // DISCRETE(10, 20) -> Error (pairs).

    // Let's use B2:A1 -> A1, B1, A2, B2
    const d = evaluate("DISCRETE(B2:A1)", mockCtx);
    expect(d.components.length).toBe(2);
  });

  it("Invalid Range Syntax", () => {
    // DISCRETE(A1:) -> Error
    expect(() => evaluate("DISCRETE(A1:)", mockCtx)).toThrow();
  });
});
