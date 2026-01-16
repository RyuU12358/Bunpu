import { Dist } from "./dist";
import type { DistComponent } from "./types";

export interface ReduceParams {
  targetN: number; // Max number of bars
  impactCenter?: number; // c in |x-c|
  impactWidthWeight?: number; // w in w*width
  tau?: number; // threshold for valley detection
  boundaries?: number[]; // e.g. [0]
}

export function reduce(dist: Dist, params: ReduceParams): Dist {
  // 1. Normalize
  dist.normalize();

  // 2. Clone components for mutation
  let comps = [...dist.components];

  // 3. Boundary Splitting (ensure no component crosses boundaries)
  const bounds = params.boundaries || [];
  if (bounds.length > 0) {
    comps = splitAtBoundaries(comps, bounds);
  }

  // 4. Calculate Importance & Identify Valleys
  const c = params.impactCenter ?? 0;
  const w = params.impactWidthWeight ?? 0;

  const getImp = (cmp: DistComponent) => {
    let repr = 0;
    let width = 0;
    let p = 0;

    if (cmp.type === "atom") {
      repr = cmp.x;
      p = cmp.p;
    } else if (cmp.type === "bin") {
      repr = cmp.repr;
      width = cmp.b - cmp.a;
      p = cmp.p;
    } else if (cmp.type === "tail") {
      return Number.MAX_VALUE; // Do not merge tails
    }

    const impact = Math.abs(repr - c) + w * width;
    return p * impact;
  };

  // Valley Compression: Merge adjacent components with Importance < tau
  // respecting boundaries.
  if (params.tau !== undefined) {
    comps = mergeValleys(comps, params.tau, bounds, getImp);
  }

  // 5. Hard Limit (TargetN)
  // Greedy merge lowest importance sum pair until count <= targetN

  // OPTIMIZATION: If we have WAY too many components (e.g. > 1000), greedy reduce O(N^2) is too slow.
  // Use a fast bucketing (histogram) approach to reduce N to ~ 2*targetN first.
  if (comps.length > Math.max(1000, params.targetN * 4)) {
    comps = fastBucketReduce(comps, params.targetN * 2, bounds);
  }

  if (comps.length > params.targetN) {
    comps = greedyReduce(comps, params.targetN, bounds, getImp);
  }

  return new Dist(comps);
}

function fastBucketReduce(
  comps: DistComponent[],
  targetN: number,
  bounds: number[]
): DistComponent[] {
  // 1. Determine range
  let min = Infinity;
  let max = -Infinity;
  for (const c of comps) {
    const s = getStart(c);
    const e = getEnd(c);
    if (s < min) min = s;
    if (e > max) max = e;
  }

  if (min >= max) return comps; // Point mass or empty

  // 2. Create buckets
  const bucketSize = (max - min) / targetN;
  const buckets: DistComponent[][] = Array.from({ length: targetN }, () => []);

  // 3. Assign
  for (const c of comps) {
    // Use center of component to decide bucket
    // Or simplified: start?
    const center = (getStart(c) + getEnd(c)) / 2;
    let bIdx = Math.floor((center - min) / bucketSize);
    if (bIdx < 0) bIdx = 0;
    if (bIdx >= targetN) bIdx = targetN - 1;
    buckets[bIdx].push(c);
  }

  // 4. Merge buckets
  const result: DistComponent[] = [];
  for (const bucket of buckets) {
    // If bucket crosses boundary?
    // Naive bucket merge ignoring boundaries might blur them.
    // But this is "Fast" reduce for huge datasets.
    // We should split bucket if it crosses boundary?
    // Or just let greedyReduce fix it later?
    // Let's filter bucket components to respect boundaries is too complex.
    // Just merge.
    if (bucket.length > 0) {
      result.push(mergeComponents(bucket));
    }
  }

  // 5. Need to re-split at boundaries because mergeComponents might have blurred them?
  // splitAtBoundaries is cheap.
  if (bounds.length > 0) {
    return splitAtBoundaries(result, bounds);
  }
  return result;
}

function splitAtBoundaries(
  comps: DistComponent[],
  boundaries: number[]
): DistComponent[] {
  let result = comps;
  for (const b of boundaries) {
    const nextRes: DistComponent[] = [];
    for (const c of result) {
      if (c.type === "bin" && c.a < b && c.b > b) {
        // Split
        const w = c.b - c.a;
        // Avoid division by zero, though a<b<b implies w>0
        const w1 = b - c.a;
        const w2 = c.b - b;
        const p1 = c.p * (w1 / w);
        const p2 = c.p * (w2 / w);

        nextRes.push({
          type: "bin",
          a: c.a,
          b: b,
          p: p1,
          repr: (c.a + b) / 2,
          shape: c.shape,
        });
        nextRes.push({
          type: "bin",
          a: b,
          b: c.b,
          p: p2,
          repr: (b + c.b) / 2,
          shape: c.shape,
        });
      } else {
        nextRes.push(c);
      }
    }
    result = nextRes;
  }
  return result;
}

function mergeValleys(
  comps: DistComponent[],
  tau: number,
  bounds: number[],
  getImp: (c: DistComponent) => number
): DistComponent[] {
  const result: DistComponent[] = [];
  let buffer: DistComponent[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      result.push(buffer[0]);
    } else {
      result.push(mergeComponents(buffer));
    }
    buffer = [];
  };

  for (const c of comps) {
    if (getImp(c) < tau) {
      // Check if we can add to buffer (boundary check)
      if (buffer.length > 0) {
        const last = buffer[buffer.length - 1];
        // Actually, we need to check if ANY boundary is strictly between last and c
        // OR if merging them would cover a boundary.
        // Ideally comps are sorted.
        if (hasBoundaryBetween(getEnd(last), getStart(c), bounds)) {
          flushBuffer();
        }
      }
      buffer.push(c);
    } else {
      flushBuffer();
      result.push(c);
    }
  }
  flushBuffer();
  return result;
}

function greedyReduce(
  comps: DistComponent[],
  targetN: number,
  bounds: number[],
  getImp: (c: DistComponent) => number
): DistComponent[] {
  // Naive O(N^2) or O(N log N) with heap.
  // Given N is small (~100?), O(N^2) per step * (StartN - TargetN) steps might be slow if StartN is huge.
  // MVP: repeatedly find best merge.

  // Optimization: Calculate costs once, update locally?
  const current = [...comps];

  while (current.length > targetN) {
    let bestIdx = -1;
    let minCost = Number.MAX_VALUE;

    // Find best adjacent pair to merge
    for (let i = 0; i < current.length - 1; i++) {
      const c1 = current[i];
      const c2 = current[i + 1];

      // Check boundary
      if (hasBoundaryBetween(getEnd(c1), getStart(c2), bounds)) continue;
      // Don't merge tails
      if (c1.type === "tail" || c2.type === "tail") continue;

      const cost = getImp(c1) + getImp(c2); // Simple cost sum
      if (cost < minCost) {
        minCost = cost;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      // Cannot merge further (likely due to boundaries or tails)
      break;
    }

    // Merge bestIdx and bestIdx+1
    const merged = mergeComponents([current[bestIdx], current[bestIdx + 1]]);
    current.splice(bestIdx, 2, merged);
  }

  return current;
}

function getStart(c: DistComponent): number {
  if (c.type === "atom") return c.x;
  if (c.type === "bin") return c.a;
  if (c.type === "tail") return c.side === "left" ? -Infinity : c.x0;
  return 0;
}

function getEnd(c: DistComponent): number {
  if (c.type === "atom") return c.x;
  if (c.type === "bin") return c.b;
  if (c.type === "tail") return c.side === "left" ? c.x0 : Infinity;
  return 0;
}

function hasBoundaryBetween(
  end1: number,
  start2: number,
  bounds: number[]
): boolean {
  // If end1 < b < start2, it is strictly between.
  // Also if end1 == bound == start2, it implies touching at boundary.
  // Merging would create a bin encompassing boundary -> disallowed.
  // So if any bound exists s.t. End1 <= Bound <= Start2 ?
  // But if End1 < Start2 (gap), bound could be in gap.
  // If End1 == Start2, bound is exactly there.
  // We want to prevent merging if the connected bin crosses bound.
  // Connected bin range: [Start(c1), End(c2)].
  // It crosses bound checking `Start < Bound < End`.
  // Since c1 doesn't cross, End1 <= Bound is possible.
  // Since c2 doesn't cross, Bound <= Start2 is possible.
  // We fail if there is a bound in (Start(c1), End(c2)).
  // But we only care about the "junction".
  // Actually, if we merge, the new bin is [min_start, max_end].
  // We need to check if any bound is in (min_start, max_end).
  // Optimization: Since checked previously, only check range [End1, Start2]?
  // No, if Start1=-1, End1=0. Start2=0, End2=1. Bound=0.
  // Merged: [-1, 1]. Bound 0 is in (-1, 1). Crosses!
  // So we just check if any bound is in (Start1, End2).
  // But wait, `hasBoundaryBetween` is called with (End1, Start2).
  // We should probably pass c1, c2 to be safe or change args.
  // Using (End1, Start2) is insufficient if we want to check strict Crossing.
  // But since we are iterating adjacent sorted components...
  // The "Danger Zone" is indeed around the junction.

  // Simplest: Check if any bound is >= End1 and <= Start2.
  // If so, we have a boundary at the junction or in the gap.
  return bounds.some((b) => b >= end1 && b <= start2);
}

function mergeComponents(comps: DistComponent[]): DistComponent {
  // Valid for merging Atoms and Bins.
  // Result is always a Bin (or Atom if single Atom? No merge implies >=2 or Buffer flush).
  // If buffer has 1 item, we returned it directly.
  // So here >= 2 items.

  let minA = Infinity,
    maxB = -Infinity;
  let totalP = 0;
  let weightedRepr = 0; // expected value calculation?

  for (const c of comps) {
    const p = c.type === "tail" ? c.mass : c.p; // Should not happen for Tail
    totalP += p;

    let start = 0,
      end = 0,
      mean = 0;
    if (c.type === "atom") {
      start = c.x;
      end = c.x;
      mean = c.x;
    } else if (c.type === "bin") {
      start = c.a;
      end = c.b;
      mean = c.repr;
    }

    minA = Math.min(minA, start);
    maxB = Math.max(maxB, end);
    weightedRepr += mean * p;
  }

  const newRepr = totalP > 0 ? weightedRepr / totalP : (minA + maxB) / 2;

  return {
    type: "bin",
    a: minA,
    b: maxB,
    p: totalP,
    repr: newRepr,
    shape: "uniform",
  };
}
