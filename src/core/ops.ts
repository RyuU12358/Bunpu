import type { Atom, Bin, DistComponent } from "./types";

export function convolveFn(
  c1: DistComponent,
  c2: DistComponent
): DistComponent[] {
  const isTail = c1.type === "tail" || c2.type === "tail";

  // TODO: Implement Tail convolution. For now, ignoring tails (mass loss).
  if (isTail) {
    return [];
  }

  // Cast to Atom | Bin since we handled Tail
  const a1 = c1 as Atom | Bin;
  const a2 = c2 as Atom | Bin;
  const newP = a1.p * a2.p;

  // Atom + Atom
  if (a1.type === "atom" && a2.type === "atom") {
    return [{ type: "atom", x: a1.x + a2.x, p: newP }];
  }

  // Atom + Bin
  if (a1.type === "atom" && a2.type === "bin") {
    return shiftBin(a2, a1.x, newP);
  }
  if (a1.type === "bin" && a2.type === "atom") {
    return shiftBin(a1, a2.x, newP);
  }

  // Bin + Bin
  if (a1.type === "bin" && a2.type === "bin") {
    // Approximate Convolution of two Uniforms as a single Uniform
    // Matching Mean and Variance
    const w1 = a1.b - a1.a;
    const w2 = a2.b - a2.a;

    // Variance of Uniform(w) = w^2 / 12
    const v1 = (w1 * w1) / 12;
    const v2 = (w2 * w2) / 12;

    const newVar = v1 + v2;
    const newWidth = Math.sqrt(12 * newVar);

    // Mean usually is repr? specialized logic here
    // If repr is not center, this might be off.
    // Let's assume repr tracks the "center of mass" or "median" roughly.
    // For MVP uniform, repr should be (a+b)/2.
    // Let's calculate purely from boundaries to be safe if repr is weird.
    const center1 = (a1.a + a1.b) / 2;
    const center2 = (a2.a + a2.b) / 2;
    const newMean = center1 + center2;

    return [
      {
        type: "bin",
        a: newMean - newWidth / 2,
        b: newMean + newWidth / 2,
        p: newP,
        repr: newMean, // New repr is sum of centers
        shape: "uniform",
      },
    ];
  }

  return [];
}

function shiftBin(b: Bin, x: number, p: number): DistComponent[] {
  return [
    {
      type: "bin",
      a: b.a + x,
      b: b.b + x,
      p,
      repr: b.repr + x,
      shape: b.shape,
    },
  ];
}
