import type { DistComponent } from "./types";
import { convolveFn } from "./ops";

// Global Wasm functions (set by worker after Wasm init)
let wasmConvolve:
  | ((d1: Float64Array, d2: Float64Array) => Float64Array)
  | null = null;
let wasmMean: ((d: Float64Array) => number) | null = null;
let wasmVariance: ((d: Float64Array) => number) | null = null;
let wasmStd: ((d: Float64Array) => number) | null = null;
let wasmProbGt: ((d: Float64Array, x: number) => number) | null = null;
let wasmMix:
  | ((d1: Float64Array, d2: Float64Array, p: number) => Float64Array)
  | null = null;
let wasmScale: ((d: Float64Array, k: number) => Float64Array) | null = null;

export function setWasmConvolve(
  fn: (d1: Float64Array, d2: Float64Array) => Float64Array
) {
  wasmConvolve = fn;
}

export function setWasmDistFns(fns: {
  mean: (d: Float64Array) => number;
  variance: (d: Float64Array) => number;
  std: (d: Float64Array) => number;
  probGt: (d: Float64Array, x: number) => number;
  mix: (d1: Float64Array, d2: Float64Array, p: number) => Float64Array;
  scale: (d: Float64Array, k: number) => Float64Array;
}) {
  wasmMean = fns.mean;
  wasmVariance = fns.variance;
  wasmStd = fns.std;
  wasmProbGt = fns.probGt;
  wasmMix = fns.mix;
  wasmScale = fns.scale;
}

// Helper: convert components to flat array for Wasm
function componentsToFlatArray(components: DistComponent[]): Float64Array {
  const data: number[] = [];
  for (const c of components) {
    if (c.type === "atom") {
      data.push(0, c.x, c.p);
    } else if (c.type === "bin") {
      data.push(1, c.a, c.b, c.p);
    } else if (c.type === "tail") {
      const lambda = c.params.lambda || 1;
      const isRight = c.side === "right" ? 1 : 0;
      data.push(2, c.x0, c.mass, lambda, isRight);
    }
  }
  return new Float64Array(data);
}

// Helper: parse flat array back to components
function parseComponentsFromFlat(data: Float64Array): DistComponent[] {
  const components: DistComponent[] = [];
  let i = 0;
  while (i < data.length) {
    const type = data[i] as number;
    if (type === 0 && i + 2 < data.length) {
      components.push({ type: "atom", x: data[i + 1], p: data[i + 2] });
      i += 3;
    } else if (type === 1 && i + 3 < data.length) {
      components.push({
        type: "bin",
        a: data[i + 1],
        b: data[i + 2],
        p: data[i + 3],
        repr: (data[i + 1] + data[i + 2]) / 2,
        shape: "uniform",
      });
      i += 4;
    } else if (type === 2 && i + 4 < data.length) {
      components.push({
        type: "tail",
        x0: data[i + 1],
        mass: data[i + 2],
        side: data[i + 4] > 0.5 ? "right" : "left",
        family: "exp",
        params: { lambda: data[i + 3] },
      });
      i += 5;
    } else {
      i++;
    }
  }
  return components;
}

export class Dist {
  components: DistComponent[] = [];

  constructor(components: DistComponent[] = []) {
    this.components = [...components];
    this.sort();
  }

  /**
   * Sort components by their position on values axis.
   * Left Tail -> ... -> Right Tail
   */
  sort() {
    this.components.sort((a, b) => {
      const getKey = (c: DistComponent): number => {
        if (c.type === "atom") return c.x;
        if (c.type === "bin") return c.a;
        if (c.type === "tail") {
          // Left tail effectively starts at -Infinity for sorting purposes relative to others
          // but we usually look at x0.
          // If it's a left tail, it ends at x0.
          // If it's a right tail, it starts at x0.
          if (c.side === "left") return Number.NEGATIVE_INFINITY;
          return c.x0;
        }
        return 0;
      };
      return getKey(a) - getKey(b);
    });
  }

  normalize() {
    let totalMass = 0;
    for (const c of this.components) {
      if (c.type === "tail") {
        totalMass += c.mass;
      } else {
        totalMass += c.p;
      }
    }

    if (totalMass === 0 || Math.abs(totalMass - 1) < 1e-9) return;

    const factor = 1 / totalMass;
    for (const c of this.components) {
      if (c.type === "tail") {
        c.mass *= factor;
      } else {
        c.p *= factor;
      }
    }
  }

  add(other: Dist): Dist {
    // Use Wasm convolution if available
    if (
      wasmConvolve &&
      this.components.length > 0 &&
      other.components.length > 0
    ) {
      const flat1 = componentsToFlatArray(this.components);
      const flat2 = componentsToFlatArray(other.components);
      const resultFlat = wasmConvolve(flat1, flat2);
      return new Dist(parseComponentsFromFlat(resultFlat));
    }

    // Fallback to JS version
    const newComps: DistComponent[] = [];
    for (const c1 of this.components) {
      for (const c2 of other.components) {
        newComps.push(...convolveFn(c1, c2));
      }
    }
    return new Dist(newComps);
  }

  sub(other: Dist): Dist {
    return this.add(other.scale(-1));
  }

  scale(k: number): Dist {
    // Use Wasm if available
    if (wasmScale && this.components.length > 0) {
      const flat = componentsToFlatArray(this.components);
      const resultFlat = wasmScale(flat, k);
      return new Dist(parseComponentsFromFlat(resultFlat));
    }

    // Fallback to JS
    const newComps = this.components.map((c) => {
      if (c.type === "atom") {
        return { ...c, x: c.x * k };
      } else if (c.type === "bin") {
        const na = c.a * k;
        const nb = c.b * k;
        return {
          ...c,
          a: Math.min(na, nb),
          b: Math.max(na, nb),
          repr: c.repr * k,
        };
      } else if (c.type === "tail") {
        return c;
      }
      return c;
    });
    return new Dist(newComps);
  }

  /**
   * Returns 1/X distribution.
   * For each component, transform x -> 1/x (values crossing 0 are problematic).
   */
  reciprocal(): Dist {
    const newComps: DistComponent[] = [];

    for (const c of this.components) {
      if (c.type === "atom") {
        if (c.x === 0) {
          // Division by zero - skip or handle as infinity?
          // Skip for now (loses mass)
          continue;
        }
        newComps.push({ ...c, x: 1 / c.x });
      } else if (c.type === "bin") {
        // For bins: 1/[a,b] -> [1/b, 1/a] if both have same sign
        // If bin crosses zero, this is problematic
        if (c.a <= 0 && c.b >= 0) {
          // Bin crosses zero - split into safe parts
          if (c.a < 0 && c.b > 0) {
            // Split: [a, 0) and (0, b]
            const w = c.b - c.a;
            const pNeg = c.p * (-c.a / w);
            const pPos = c.p * (c.b / w);
            // Negative part: [a, ~0) -> (~-inf, 1/a]
            // Approximate as atom at 1/midpoint
            if (c.a < 0) {
              const midNeg = (c.a + Math.min(0, c.a / 2)) / 2;
              newComps.push({ type: "atom", x: 1 / midNeg, p: pNeg });
            }
            // Positive part: (~0, b] -> [1/b, ~inf)
            if (c.b > 0) {
              const midPos = (Math.max(0, c.b / 2) + c.b) / 2;
              newComps.push({ type: "atom", x: 1 / midPos, p: pPos });
            }
          } else if (c.a === 0) {
            // [0, b] -> [1/b, inf) - approximate
            const mid = c.b / 2;
            newComps.push({ type: "atom", x: 1 / mid, p: c.p });
          } else if (c.b === 0) {
            // [a, 0] -> (-inf, 1/a] - approximate
            const mid = c.a / 2;
            newComps.push({ type: "atom", x: 1 / mid, p: c.p });
          }
        } else {
          // Safe: both endpoints same sign
          const newA = 1 / c.b; // Note: 1/b < 1/a if a,b > 0
          const newB = 1 / c.a;
          newComps.push({
            ...c,
            a: Math.min(newA, newB),
            b: Math.max(newA, newB),
            repr: 1 / c.repr,
          });
        }
      } else if (c.type === "tail") {
        // Tail reciprocal is complex - approximate as atom at 1/mean
        const lambda = c.params.lambda || 1;
        const condMean =
          c.side === "right" ? c.x0 + 1 / lambda : c.x0 - 1 / lambda;
        if (condMean !== 0) {
          newComps.push({ type: "atom", x: 1 / condMean, p: c.mass });
        }
      }
    }

    return new Dist(newComps);
  }

  mix(other: Dist, p: number): Dist {
    // Use Wasm if available
    if (wasmMix && this.components.length > 0 && other.components.length > 0) {
      const flat1 = componentsToFlatArray(this.components);
      const flat2 = componentsToFlatArray(other.components);
      const resultFlat = wasmMix(flat1, flat2, p);
      return new Dist(parseComponentsFromFlat(resultFlat));
    }

    // Fallback to JS
    const scaleP = (c: DistComponent, factor: number): DistComponent => {
      if (c.type === "tail") return { ...c, mass: c.mass * factor };
      return { ...c, p: c.p * factor };
    };

    const comps1 = this.components.map((c) => scaleP(c, 1 - p));
    const comps2 = other.components.map((c) => scaleP(c, p));

    return new Dist([...comps1, ...comps2]);
  }

  mean(): number {
    // Use Wasm if available
    if (wasmMean && this.components.length > 0) {
      const flat = componentsToFlatArray(this.components);
      return wasmMean(flat);
    }

    // Fallback to JS
    let m = 0;
    for (const c of this.components) {
      if (c.type === "atom") {
        m += c.p * c.x;
      } else if (c.type === "bin") {
        m += (c.p * (c.a + c.b)) / 2;
      } else if (c.type === "tail") {
        const lambda = c.params.lambda || 1;
        const condMean =
          c.side === "right" ? c.x0 + 1 / lambda : c.x0 - 1 / lambda;
        m += c.mass * condMean;
      }
    }
    return m;
  }

  variance(): number {
    // Use Wasm if available
    if (wasmVariance && this.components.length > 0) {
      const flat = componentsToFlatArray(this.components);
      return wasmVariance(flat);
    }

    // Fallback to JS: E[X^2] - (E[X])^2
    const m = this.mean();
    let e2 = 0;
    for (const c of this.components) {
      if (c.type === "atom") {
        e2 += c.p * c.x * c.x;
      } else if (c.type === "bin") {
        e2 += (c.p * (c.a * c.a + c.a * c.b + c.b * c.b)) / 3;
      } else if (c.type === "tail") {
        const lambda = c.params.lambda || 1;
        const condMean =
          c.side === "right" ? c.x0 + 1 / lambda : c.x0 - 1 / lambda;
        const condVar = 1 / (lambda * lambda);
        e2 += c.mass * (condVar + condMean * condMean);
      }
    }
    return e2 - m * m;
  }

  std(): number {
    // Use Wasm if available
    if (wasmStd && this.components.length > 0) {
      const flat = componentsToFlatArray(this.components);
      return wasmStd(flat);
    }
    return Math.sqrt(this.variance());
  }

  median(): number {
    // Find x where CDF(x) = 0.5
    // Assume components sorted? Yes constructor sorts.
    // BUT checking ensure sort?
    // this.sort(); // Should be sorted but no harm checking if issues arise.

    let cumP = 0;
    const target = 0.5;

    for (const c of this.components) {
      const p = c.type === "tail" ? c.mass : c.p;
      if (cumP + p >= target) {
        // Median is inside this component
        const needed = target - cumP;
        // needed is the prob chunk within this component (0 <= needed <= p)

        if (c.type === "atom") {
          return c.x;
        } else if (c.type === "bin") {
          // Uniform: interpolate
          const ratio = needed / p; // 0..1
          return c.a + ratio * (c.b - c.a);
        } else if (c.type === "tail") {
          // Exp tail.
          // Right: CDF(x|Tail) = 1 - exp(-L(x-x0))
          // Left: opposite.
          const lambda = c.params.lambda || 1;
          // Ratio of mass we need: r = needed / mass
          // We want z in tail such that Mass * P(X < z | Tail) = needed?
          // Wait.
          // Left Tail (start): Accumulates from 0 to mass.
          // Right Tail (end): Accumulates from mass to 0? No, CDF increases.

          if (c.side === "left") {
            // Left Tail (-inf, x0].
            // CDF grows as exp(L(x-x0)) * mass?
            // P(X < x) = p * exp(L(x-x0)) ??
            // At x=x0, P=p. At x=-inf, P=0. Correct.
            // needed = p * exp(L(x-x0))
            // x - x0 = ln(needed/p) / L
            // x = x0 + ln(needed/p) / L
            const ratio = needed / p;
            return c.x0 + Math.log(ratio) / lambda;
          } else {
            // Right Tail [x0, inf).
            // We entered this component with cumP.
            // We need 'needed' more probability.
            // CDF inside component starts at 0.
            // P(X < x | X>=x0) = 1 - exp(-L(x-x0))
            // needed = p * (1 - exp(-L(x-x0)))
            // needed/p = 1 - exp(...)
            // exp(...) = 1 - needed/p
            // -L(x-x0) = ln(1 - needed/p)
            // x = x0 - ln(1 - needed/p) / L
            const ratio = needed / p;
            return c.x0 - Math.log(1 - ratio) / lambda;
          }
        }
      }
      cumP += p;
    }
    // Fallback (e.g. if sum p < 0.5 due to precision or empty)
    return 0;
  }

  probGt(x: number): number {
    // Use Wasm if available
    if (wasmProbGt && this.components.length > 0) {
      const flat = componentsToFlatArray(this.components);
      return wasmProbGt(flat, x);
    }

    // Fallback to JS
    let p = 0;
    for (const c of this.components) {
      if (c.type === "atom") {
        if (c.x > x) p += c.p;
      } else if (c.type === "bin") {
        if (c.a >= x) {
          p += c.p;
        } else if (c.b > x) {
          const width = c.b - c.a;
          const overlap = c.b - x;
          p += c.p * (overlap / width);
        }
      } else if (c.type === "tail") {
        if (c.side === "right") {
          if (x < c.x0) {
            p += c.mass;
          } else {
            const lambda = c.params.lambda || 1;
            p += c.mass * Math.exp(-lambda * (x - c.x0));
          }
        } else {
          if (x < c.x0) {
            const lambda = c.params.lambda || 1;
            p += c.mass * (1 - Math.exp(-lambda * (c.x0 - x)));
          }
        }
      }
    }
    return p;
  }

  sample(n: number): number[] {
    // Use Alias Table for O(1) sampling per sample (vs O(k) linear scan)
    // Alias Table construction is O(k), but sampling is O(1)
    // For large n (e.g., 10000 samples), this is much faster

    const k = this.components.length;
    if (k === 0) return [];

    // Step 1: Normalize probabilities
    const weights: number[] = this.components.map((c) =>
      c.type === "tail" ? c.mass : c.p
    );
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return [];

    const prob: number[] = weights.map((w) => (w / totalWeight) * k);
    const alias: number[] = new Array(k).fill(0);
    const probFinal: number[] = new Array(k).fill(0);

    // Step 2: Separate into small and large
    const small: number[] = [];
    const large: number[] = [];
    for (let i = 0; i < k; i++) {
      if (prob[i] < 1) {
        small.push(i);
      } else {
        large.push(i);
      }
    }

    // Step 3: Build Alias Table
    while (small.length > 0 && large.length > 0) {
      const l = small.pop()!;
      const g = large.pop()!;
      probFinal[l] = prob[l];
      alias[l] = g;
      prob[g] = prob[g] + prob[l] - 1;
      if (prob[g] < 1) {
        small.push(g);
      } else {
        large.push(g);
      }
    }

    // Handle remaining (due to floating point errors)
    while (large.length > 0) {
      probFinal[large.pop()!] = 1;
    }
    while (small.length > 0) {
      probFinal[small.pop()!] = 1;
    }

    // Step 4: Sample using Alias Table - O(1) per sample
    const samples: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = Math.random() * k;
      const idx = Math.floor(u);
      const y = u - idx;
      const chosenIdx = y < probFinal[idx] ? idx : alias[idx];
      const c = this.components[chosenIdx];

      // Sample from the chosen component
      if (c.type === "atom") {
        samples.push(c.x);
      } else if (c.type === "bin") {
        samples.push(c.a + Math.random() * (c.b - c.a));
      } else if (c.type === "tail") {
        const lambda = c.params.lambda || 1;
        const expS = -Math.log(1 - Math.random()) / lambda;
        if (c.side === "right") samples.push(c.x0 + expS);
        else samples.push(c.x0 - expS);
      }
    }
    return samples;
  }

  /**
   * Returns a new distribution representing Max(X1, X2, ..., Xn) where Xi are i.i.d copies of this.
   * Approximation via CDF exponentiation.
   */
  maxOf(n: number, resolution = 200): Dist {
    if (this.components.length === 0) return new Dist([]);
    if (n === 1) return this;

    // 1. Determine range
    let min = Infinity;
    let max = -Infinity;
    for (const c of this.components) {
      if (c.type === "atom") {
        min = Math.min(min, c.x);
        max = Math.max(max, c.x);
      } else if (c.type === "bin") {
        min = Math.min(min, c.a);
        max = Math.max(max, c.b);
      }
      // Tail handling? MVP ignore tail extent for range, or use x0 +- something
      if (c.type === "tail") {
        // For bounds, we just take x0?
        // If Right tail, x0 is start. End is effectively inf.
        // We need practical range.
        // Let's rely on internal atoms/bins for range.
        if (c.side === "right") min = Math.min(min, c.x0);
        if (c.side === "left") max = Math.max(max, c.x0);
      }
    }

    if (min >= max) {
      // Point mass
      return this;
    }

    // 2. Discretize range into buckets
    const step = (max - min) / resolution;
    const newComps: DistComponent[] = [];

    // probGt(x) gives P(X > x).
    // CDF(x) = 1 - probGt(x).

    // We iterate from min to max.
    // At boundary x, CDF is P(X <= x).

    for (let i = 0; i <= resolution; i++) {
      const x = min + i * step;
      const cdf = 1 - this.probGt(x);
      // New CDF = cdf^n
      const newC = Math.pow(cdf, n);

      const p = newC - (i === 0 ? 0 : Math.pow(1 - this.probGt(x - step), n));

      if (p > 1e-9) {
        // Add a bin for this interval [x-step, x]
        // Or Atom?
        // To be smoother, let's use Bin.
        if (i > 0) {
          newComps.push({
            type: "bin",
            a: x - step,
            b: x,
            p: p,
            repr: x - step / 2,
            shape: "uniform",
          });
        } else {
          // First point mass?
          // If P(X <= min) > 0 (Atom at min), it is caught here.
          // Actually first loop i=0. x=min. cdf might be > 0 if atom at min.
          // p = cdf^n - 0.
          if (newC > 1e-9) {
            newComps.push({
              type: "atom",
              x: x,
              p: newC,
            });
          }
        }
      }
    }

    const d = new Dist(newComps);
    d.normalize();
    return d;
  }

  /**
   * Splits distribution at x. Returns [Dist <= x, Dist > x].
   * Mass is preserved (not normalized).
   */
  splitAt(x: number): [Dist, Dist] {
    const lower: DistComponent[] = [];
    const upper: DistComponent[] = [];

    for (const c of this.components) {
      if (c.type === "atom") {
        if (c.x <= x) lower.push(c);
        else upper.push(c);
      } else if (c.type === "bin") {
        if (c.b <= x) {
          lower.push(c);
        } else if (c.a >= x) {
          upper.push(c);
        } else {
          // Split bin
          const w = c.b - c.a;
          const wL = x - c.a;
          const wU = c.b - x;
          const pL = c.p * (wL / w);
          const pU = c.p * (wU / w);

          lower.push({ ...c, b: x, p: pL, repr: (c.a + x) / 2 });
          upper.push({ ...c, a: x, p: pU, repr: (x + c.b) / 2 });
        }
      } else if (c.type === "tail") {
        // Tail split?
        // Right Tail [x0, inf).
        if (c.side === "right") {
          if (x <= c.x0) {
            upper.push(c);
          } else {
            // Tail starts before x.
            // Split into [x0, x] (Bin? General Tail segment?) and [x, inf) (Tail).
            // MVP: If tail is split, we convert lower part to Bin?
            // Or just ignore tail splitting for MVP and assign to dominant side.
            // Let's convert lower part to Bin? No, shape is exponential.
            // Keep it simple: Tail logic is hard.
            // Just assign based on mass majority or x0?
            // Assign whole to upper if x > x0? No.
            // If we are strictly checking ruin prob <= 0, and typical tails are far out...
            // If Right tail [x0, inf) and x0 > 0. It is all upper.
            // If Left tail (-inf, x0] and x0 < 0. It is all lower.
            if (x > c.x0) {
              // Split right tail
              // Part <= x: [x0, x]. Part > x: [x, inf).
              // P(X>x | RightTail) = exp(-L(x-x0))
              const lambda = c.params.lambda || 1;
              const probUpper = c.mass * Math.exp(-lambda * (x - c.x0));
              const probLower = c.mass - probUpper;

              // Approximation: Lower part as Bin? Or just Atom at centroid?
              // Let's use Atom for lower part to avoid headache.
              lower.push({ type: "atom", x: (c.x0 + x) / 2, p: probLower }); // Very rough
              upper.push({ ...c, x0: x, mass: probUpper });
            } else {
              upper.push(c);
            }
          }
        } else {
          // Left Tail (-inf, x0]
          if (x >= c.x0) {
            lower.push(c);
          } else {
            // Split left tail at x
            // Part <= x: (-inf, x]. Part > x: (x, x0].
            const lambda = c.params.lambda || 1;
            // P(X < x | LeftTail) = mass * exp(-L(x0-x)) ??
            // Based on probGt: P(T>x) = mass * (1 - exp).
            // So P(T<x) = mass * exp(-L(x0-x)).
            const probLower = c.mass * Math.exp(-lambda * (c.x0 - x));
            const probUpper = c.mass - probLower;

            lower.push({ ...c, x0: x, mass: probLower });
            upper.push({ type: "atom", x: (x + c.x0) / 2, p: probUpper }); // Rough
          }
        }
      }
    }
    return [new Dist(lower), new Dist(upper)];
  }

  toString() {
    return this.components
      .map((c) => {
        if (c.type === "atom")
          return `Atom(${c.x.toFixed(2)}, p=${c.p.toFixed(3)})`;
        if (c.type === "bin")
          return `Bin([${c.a.toFixed(2)},${c.b.toFixed(2)}], p=${c.p.toFixed(
            3
          )})`;
        if (c.type === "tail")
          return `Tail(${c.side}, x0=${c.x0}, m=${c.mass.toFixed(3)})`;
        return "Unknown";
      })
      .join("\n");
  }
}
