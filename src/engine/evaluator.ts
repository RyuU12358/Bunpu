import { Dist } from "../core/dist";
import type { Atom, DistComponent } from "../core/types";
import { reduce } from "../core/reducer";

export interface EvalContext {
  getValue: (ref: string) => Dist;
  maxComponents?: number;
  // Wasm Monte Carlo function (optional - used when available)
  wasmMonteCarlo?: (
    components: DistComponent[],
    initWealth: number,
    steps: number,
    numTrials: number
  ) => number;
}

type TokenType =
  | "NUMBER"
  | "ID"
  | "PLUS"
  | "MINUS"
  | "MUL"
  | "DIV"
  | "LPAREN"
  | "RPAREN"
  | "RPAREN"
  | "COMMA"
  | "COLON";

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let val = "";
      while (i < input.length && /[0-9.]/.test(input[i])) {
        val += input[i];
        i++;
      }
      tokens.push({ type: "NUMBER", value: val });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let val = "";
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) {
        val += input[i];
        i++;
      }
      tokens.push({ type: "ID", value: val });
      continue;
    }

    switch (char) {
      case "+":
        tokens.push({ type: "PLUS", value: "+" });
        break;
      case "-":
        tokens.push({ type: "MINUS", value: "-" });
        break;
      case "*":
        tokens.push({ type: "MUL", value: "*" });
        break;
      case "/":
        tokens.push({ type: "DIV", value: "/" });
        break;
      case "(":
        tokens.push({ type: "LPAREN", value: "(" });
        break;
      case ")":
        tokens.push({ type: "RPAREN", value: ")" });
        break;
      case ",":
        tokens.push({ type: "COMMA", value: "," });
        break;
      case ":":
        tokens.push({ type: "COLON", value: ":" });
        break;
      default:
        throw new Error(`Unknown character: ${char}`);
    }
    i++;
  }
  return tokens;
}

// Helper to expand A1:B3 -> [A1, B1, A2, B2, A3, B3]
function expandRange(start: string, end: string): string[] {
  // Parsing regex: ([A-Z]+)([0-9]+)
  const parseCell = (cell: string) => {
    const match = cell.toUpperCase().match(/^([A-Z]+)([0-9]+)$/);
    if (!match) throw new Error(`Invalid cell ref in range: ${cell}`);
    return { col: match[1], row: parseInt(match[2], 10) };
  };

  const s = parseCell(start);
  const e = parseCell(end);

  // Helper to convert "A" -> 0, "B" -> 1
  const colToIndex = (col: string) => {
    let sum = 0;
    for (let k = 0; k < col.length; k++) {
      sum *= 26;
      sum += col.charCodeAt(k) - "A".charCodeAt(0) + 1;
    }
    return sum - 1;
  };

  // Helper to convert 0 -> "A", 1 -> "B"
  const indexToCol = (idx: number) => {
    let str = "";
    let n = idx;
    while (n >= 0) {
      str = String.fromCharCode("A".charCodeAt(0) + (n % 26)) + str;
      n = Math.floor(n / 26) - 1;
    }
    return str;
  };

  const c1 = colToIndex(s.col);
  const c2 = colToIndex(e.col);
  const r1 = s.row;
  const r2 = e.row;

  const minC = Math.min(c1, c2);
  const maxC = Math.max(c1, c2);
  const minR = Math.min(r1, r2);
  const maxR = Math.max(r1, r2);

  const result: string[] = [];
  // Row-major order (standard for most range usage like simple lists)
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      result.push(`${indexToCol(c)}${r}`);
    }
  }
  return result;
}

class Parser {
  tokens: Token[];
  pos = 0;
  ctx: EvalContext;
  
  localMaxComponents?: number; // Override for current expression scope

  constructor(tokens: Token[], ctx: EvalContext) {
    this.tokens = tokens;
    this.ctx = ctx;
  }

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  consume(): Token {
    return this.tokens[this.pos++];
  }

  expect(type: TokenType): Token {
    const t = this.consume();
    if (!t || t.type !== type) {
      throw new Error(`Expected ${type}, got ${t?.type}`);
    }
    return t;
  }

  private checkSafety(d: Dist): Dist {
    const limit = this.localMaxComponents ?? this.ctx.maxComponents ?? 200;
    if (d.components.length > limit) {
      // Auto-reduce
      // console.warn(`[Auto-Reduce] Dist size ${d.components.length} > ${limit}. Reducing.`);
      return reduce(d, { targetN: limit });
    }
    return d;
  }

  parseExpression(): Dist {
    let left = this.parseTerm();

    while (this.pos < this.tokens.length) {
      const t = this.peek();
      if (t?.type === "PLUS") {
        this.consume();
        const right = this.parseTerm();
        left = left.add(right);
        left = this.checkSafety(left);
      } else if (t?.type === "MINUS") {
        this.consume();
        const right = this.parseTerm();
        left = left.sub(right);
        left = this.checkSafety(left);
      } else {
        break;
      }
    }
    return left;
  }

  parseTerm(): Dist {
    let left = this.parseFactor();

    while (this.pos < this.tokens.length) {
      const t = this.peek();
      if (t?.type === "MUL") {
        this.consume();
        const right = this.parseFactor();
        // Check if one is Scalar
        if (this.isScalar(right)) {
          left = left.scale(this.getScalar(right));
        } else if (this.isScalar(left)) {
          const k = this.getScalar(left);
          left = right.scale(k);
        } else {
          // Dist * Dist - not supported in MVP
          throw new Error(
            "Multiplication of two Distributions not supported (Scalar required)"
          );
        }
        left = this.checkSafety(left);
      } else if (t?.type === "DIV") {
        this.consume();
        const right = this.parseFactor();
        if (this.isScalar(right)) {
          // Dist / Scalar
          const k = this.getScalar(right);
          if (k === 0) throw new Error("Division by Zero");
          left = left.scale(1 / k);
        } else if (this.isScalar(left)) {
          // Scalar / Dist -> Scalar * (1/Dist)
          const k = this.getScalar(left);
          left = right.reciprocal().scale(k);
        } else {
          throw new Error("Division of two Distributions not supported");
        }
        left = this.checkSafety(left);
      } else {
        break;
      }
    }
    return left;
  }

  parseFactor(): Dist {
    const t = this.peek();
    if (!t) throw new Error("Unexpected end of input");

    if (t.type === "NUMBER") {
      this.consume();
      const val = parseFloat(t.value);
      return new Dist([{ type: "atom", x: val, p: 1 }]);
    }

    if (t.type === "ID") {
      const id = t.value;
      this.consume();
      if (this.peek()?.type === "LPAREN") {
        return this.parseFunctionCall(id);
      } else {
        // Ref
        return this.ctx.getValue(id);
      }
    }

    // Unary Minus
    if (t.type === "MINUS") {
      this.consume();
      const factor = this.parseFactor();
      return factor.scale(-1);
    }

    if (t.type === "LPAREN") {
      this.consume();
      const expr = this.parseExpression();
      this.expect("RPAREN");
      return expr;
    }

    throw new Error(`Unexpected token: ${t.type}`);
  }

  parseFunctionCall(name: string): Dist {
    this.expect("LPAREN");
    const args: Dist[] = [];
    if (this.peek()?.type !== "RPAREN") {
      // CONFIG needs special handling?
      // CONFIG(limit, expr) -> we need to parse expr with NEW limit.
      // But standard args parsing evaluates them first.
      // So CONFIG(1000, A+B) -> A+B evaluated with *outer* limit, then passed to CONFIG.
      // This defeats the purpose if A+B explodes before CONFIG sees it.
      // Special case for CONFIG.
      if (name.toUpperCase() === "CONFIG") {
        // Parse first arg (limit)
        const limitDist = this.parseExpression();
        const limit = this.getScalar(limitDist);

        this.expect("COMMA");

        // Save old limit
        const oldLimit = this.localMaxComponents;
        this.localMaxComponents = limit;

        // Parse second arg (expr)
        const result = this.parseExpression();

        // Restore
        this.localMaxComponents = oldLimit;

        this.expect("RPAREN");
        return result;
      }

      // Check for Range Syntax: arg : arg
      // But standard parsing uses comma separators.
      // We need to support: FUN(A1:B3, C5)
      // parseExpression consumes one expression.
      // If the next token is COLON, we must re-evaluate what we just parsed?
      // Actually, A1 is an ID is an Expression.
      // If we parseExpression, we get the value of A1. We lose the ID string if it was an ID.
      // We need to look ahead before parsing expression?
      // Or we catch it here:

      const tryParseArg = () => {
        // Look ahead for ID : ID pattern
        if (
          this.peek()?.type === "ID" &&
          this.tokens[this.pos + 1]?.type === "COLON"
        ) {
          const startId = this.consume().value; // Consume ID
          this.consume(); // Consume COLON
          const endId = this.expect("ID").value; // Consume 2nd ID

          // Expand
          const cells = expandRange(startId, endId);
          cells.forEach((id) => {
            args.push(this.ctx.getValue(id));
          });
          return;
        }

        // Normal expression
        args.push(this.parseExpression());
      };

      tryParseArg();
      while (this.peek()?.type === "COMMA") {
        this.consume();
        tryParseArg();
      }
    }
    this.expect("RPAREN");

    // Dispatch
    const fn = name.toUpperCase();

    // ... helper to wrap return with safety check for operations that might expand ...
    // Most functions return NEW dists or reduced ones.
    // MIX expands.
    // ADD/SCALE handled in parseExpression/parseTerm.

    // 1. Value Generation
    if (fn === "CONST") {
      if (args.length !== 1) throw new Error("CONST requires 1 arg (x)");
      const x = this.getScalar(args[0]);
      return new Dist([{ type: "atom", x, p: 1 }]);
    } else if (fn === "UNIFORM") {
      if (args.length !== 2)
        throw new Error("UNIFORM requires 2 args (min, max)");
      const min = this.getScalar(args[0]);
      const max = this.getScalar(args[1]);
      if (min >= max) throw new Error("UNIFORM min must be < max");
      return new Dist([
        {
          type: "bin",
          a: min,
          b: max,
          p: 1,
          repr: (min + max) / 2,
          shape: "uniform",
        },
      ]);
    } else if (fn === "NORMAL") {
      if (args.length !== 2)
        throw new Error("NORMAL requires 2 args (mean, std)");
      const mean = this.getScalar(args[0]);
      const std = this.getScalar(args[1]);
      if (std <= 0) throw new Error("NORMAL std must be > 0");

      // Approximate Normal with Bins (Simple approach for MVP)
      // Range: mean +/- 4 std (covers 99.9%)
      // Split into e.g. 20 bins
      const bins: DistComponent[] = [];
      const nBins = 20;
      const start = mean - 4 * std;
      const end = mean + 4 * std;
      const width = (end - start) / nBins;

      // Normal PDF
      const pdf = (x: number) =>
        (1 / (std * Math.sqrt(2 * Math.PI))) *
        Math.exp(-0.5 * Math.pow((x - mean) / std, 2));

      let totalP = 0;
      for (let i = 0; i < nBins; i++) {
        const a = start + i * width;
        const b = a + width;
        const mid = (a + b) / 2;
        const p = pdf(mid) * width;
        totalP += p;
        bins.push({
          type: "bin",
          a,
          b,
          p, // Will normalize
          repr: mid,
          shape: "uniform", // Approx as uniform stacks
        });
      }
      // Add tails? For MVP, just normalize bins
      const factor = 1 / totalP;
      bins.forEach((b) => (b.type === "bin" ? (b.p *= factor) : null));

      return new Dist(bins);
    } else if (fn === "DISCRETE") {
      if (args.length === 0 || args.length % 2 !== 0) {
        throw new Error("DISCRETE requires pairs of args (value, prob, ...)");
      }
      const atoms: DistComponent[] = [];
      let totalP = 0;
      for (let i = 0; i < args.length; i += 2) {
        const val = this.getScalar(args[i]);
        const prob = this.getScalar(args[i + 1]);
        if (prob < 0) throw new Error("Probability must be >= 0");
        atoms.push({ type: "atom", x: val, p: prob });
        totalP += prob;
      }

      if (totalP === 0) throw new Error("Total probability cannot be zero");

      // Normalize
      return new Dist(atoms);
    } else if (fn === "EXPONENTIAL") {
      if (args.length !== 1)
        throw new Error("EXPONENTIAL requires 1 arg (rate)");
      // If arg is distribution, use its mean
      const rate = this.isScalar(args[0])
        ? this.getScalar(args[0])
        : args[0].mean();
      if (rate <= 0) throw new Error("Rate must be > 0");

      // PDF: rate * exp(-rate * x)
      // CDF: 1 - exp(-rate * x)
      // Cutoff at CDF=0.999 -> exp(-rate*x) = 0.001 -> -rate*x = ln(0.001) ~ -6.9
      const cutoff = 7 / rate;
      const nBins = 50;
      const width = cutoff / nBins;
      const bins: DistComponent[] = [];

      for (let i = 0; i < nBins; i++) {
        const a = i * width;
        const b = (i + 1) * width;
        // Exact probability mass in interval [a, b]
        const p = Math.exp(-rate * a) - Math.exp(-rate * b);
        bins.push({
          type: "bin",
          a,
          b,
          p,
          repr: (a + b) / 2, // Midpoint approx
          shape: "uniform",
        });
      }
      // Normalize (slight truncation error)
      const sumP = bins.reduce(
        (acc, b) => acc + (b.type === "tail" ? b.mass : b.p),
        0
      );
      bins.forEach((b) => {
        if (b.type === "bin") b.p /= sumP;
      });

      return new Dist(bins);
    } else if (fn === "POISSON") {
      if (args.length !== 1) throw new Error("POISSON requires 1 arg (lambda)");
      const lambda = this.getScalar(args[0]);
      if (lambda <= 0) throw new Error("Lambda must be > 0");

      // Limit loop for safety
      const limit = this.localMaxComponents ?? 200;
      const atoms: DistComponent[] = [];
      let curP = Math.exp(-lambda); // P(0)
      let sumP = 0;

      for (let k = 0; k < limit; k++) {
        atoms.push({ type: "atom", x: k, p: curP });
        sumP += curP;
        // Iterate: P(k+1) = P(k) * lambda / (k+1)
        const nextP = (curP * lambda) / (k + 1);
        curP = nextP;
        if (sumP > 0.99999) break; // Optimization: stop if tail is negligible
      }
      // Normalize remaining small mass
      atoms.forEach((a) => {
        if (a.type === "atom") a.p /= sumP;
      });
      return new Dist(atoms);
    } else if (fn === "BINOMIAL") {
      if (args.length !== 2) throw new Error("BINOMIAL requires 2 args (n, p)");
      const n = Math.floor(this.getScalar(args[0]));
      const p = this.getScalar(args[1]);
      if (n < 0) throw new Error("n must be >= 0");
      if (p < 0 || p > 1) throw new Error("p must be between 0 and 1");

      const limit = this.localMaxComponents ?? 200;
      if (n > limit)
        throw new Error(`BINOMIAL n=${n} exceeds component limit ${limit}.`);

      // Compute binomial coefs simply? or generate iteratively?
      // Recursive: P(k) = C(n,k) p^k (1-p)^(n-k)
      // P(0) = (1-p)^n
      // P(k+1) = P(k) * (n-k)/(k+1) * p/(1-p)

      const atoms: DistComponent[] = [];
      let curP = Math.pow(1 - p, n);
      let sumP = 0;

      for (let k = 0; k <= n; k++) {
        atoms.push({ type: "atom", x: k, p: curP });
        sumP += curP;
        if (k === n) break; // Avoid calculation for k+1 if done

        const nextP = curP * ((n - k) / (k + 1)) * (p / (1 - p));
        curP = nextP;
      }

      // Normalize for float precision
      if (sumP > 0)
        atoms.forEach((a) => {
          if (a.type === "atom") a.p /= sumP;
        });

      return new Dist(atoms);
    } else if (fn === "ADD") {
      if (args.length !== 2) throw new Error("ADD requires 2 args (A, B)");
      return this.checkSafety(args[0].add(args[1]));
    } else if (fn === "CONVOLVE") {
      if (args.length !== 2)
        throw new Error("CONVOLVE requires 2 args (d1, d2)");
      return this.checkSafety(args[0].add(args[1]));
    } else if (fn === "MUL") {
      if (args.length !== 2) throw new Error("MUL requires 2 args (A, B)");
      // Check for scalars
      if (this.isScalar(args[0])) {
        return this.checkSafety(args[1].scale(this.getScalar(args[0])));
      } else if (this.isScalar(args[1])) {
        return this.checkSafety(args[0].scale(this.getScalar(args[1])));
      } else {
        throw new Error(
          "MUL currently supports only Scalar * Dist or Dist * Scalar"
        );
      }
    } else if (fn === "DIV") {
      if (args.length !== 2) throw new Error("DIV requires 2 args (A, B)");
      if (this.isScalar(args[1])) {
        // Dist / Scalar
        const k = this.getScalar(args[1]);
        if (k === 0) throw new Error("Division by Zero");
        return this.checkSafety(args[0].scale(1 / k));
      } else if (this.isScalar(args[0])) {
        // Scalar / Dist
        const k = this.getScalar(args[0]);
        return this.checkSafety(args[1].reciprocal().scale(k));
      } else {
        throw new Error("DIV of two Distributions not supported");
      }
    } else if (fn === "POWER") {
      if (args.length !== 2)
        throw new Error("POWER requires 2 args (Dist, exponent)");
      const dist = args[0];
      const k = this.getScalar(args[1]);
      // Implement Pow
      const newComps: DistComponent[] = dist.components.map((c) => {
        if (c.type === "atom") {
          return { ...c, x: Math.pow(c.x, k) };
        } else if (c.type === "bin") {
          // Simple approx: Transform endpoints?
          // Only works if monotonic.
          // If k=2 and bin is [-2, 2], wrapping happens.
          // MVP: Transform repr, a, b.
          return {
            ...c,
            a: Math.pow(c.a, k),
            b: Math.pow(c.b, k),
            repr: Math.pow(c.repr, k),
          };
        }
        return c; // Tail?
      });
      // Bins might need sorting or fixing (if a > b after pow)
      // e.g. pow(0.5) on negative? NaN.
      newComps.forEach((c) => {
        if (c.type === "bin" && c.a > c.b) {
          const tmp = c.a;
          c.a = c.b;
          c.b = tmp;
        }
      });
      const d = new Dist(newComps);
      // d.sort(); // Constructor sorts
      return this.checkSafety(d);
    } else if (fn === "BIN") {
      // Original BIN logic
      if (args.length < 2)
        throw new Error("BIN requires at least 2 args (a, b, [p])");
      const a = this.getScalar(args[0]);
      const b = this.getScalar(args[1]);
      const p = args.length > 2 ? this.getScalar(args[2]) : 1;
      return new Dist([
        { type: "bin", a, b, p, repr: (a + b) / 2, shape: "uniform" },
      ]);
    }
    // 2. Operations
    // The ADD case was moved into the new if/else if chain above.
    if (fn === "SCALE") {
      if (args.length !== 2) throw new Error("SCALE requires 2 args (A, k)");
      const k = this.getScalar(args[1]);
      return this.checkSafety(args[0].scale(k));
    }
    if (fn === "MIX") {
      // ... (existing mix code)
      if (args.length !== 3) throw new Error("MIX requires 3 args (A, B, p)");
      let res: Dist;
      // Note: Spec says MIX(p, A, B) in one place but MIX(A, B, p) in another.
      // User's latest spec: MIX(p, A, B).
      // My previous implementation: MIX(A, B, p).
      // Let's support User's spec: MIX(p, A, B).
      // But check if arg 0 is scalar.
      if (this.isScalar(args[0])) {
        // MIX(p, A, B) => p chance of A, 1-p chance of B
        // dist.mix(other, p) assigns p to other.
        // So we want A to have p.
        // We call B.mix(A, p).
        const p = this.getScalar(args[0]);
        res = args[2].mix(args[1], p);
      } else {
        // Fallback or Error? Assume user might use MIX(A, B, p)?
        // Let's stick to spec: MIX(p, A, B).
        const p = this.getScalar(args[0]); // This will throw if A is dist
        res = args[2].mix(args[1], p);
      }
      return this.checkSafety(res);
    }

    // 3. Reduction & Control
    if (fn === "REDUCE") {
      if (args.length < 2)
        throw new Error("REDUCE requires at least 2 args (A, targetN)");
      const dist = args[0];
      const targetN = this.getScalar(args[1]);
      const impactCenter = args.length > 2 ? this.getScalar(args[2]) : 0;
      const tau = args.length > 3 ? this.getScalar(args[3]) : 0.01;
      const boundaries = [0];
      const widthWeight = args.length > 5 ? this.getScalar(args[5]) : 0;

      // If config limit is strictly enforced, we might want to clamp targetN?
      // For now, let's respect the user's explicit Reduce parameters.
      const res = reduce(dist, {
        targetN,
        impactCenter,
        tau,
        boundaries,
        impactWidthWeight: widthWeight,
      });

      // BUT, if safety is paramount, we should clamp.
      // Let's checkSafety anyway? No, that might undo the user's specific reduction.
      return res;
    }

    if (fn === "GEOM_SUM") {
      if (args.length !== 2)
        throw new Error("GEOM_SUM requires 2 args (Dist, p)");
      const baseDist = args[0];
      const p = this.getScalar(args[1]);

      if (p < 0 || p >= 1) throw new Error("p must be in [0, 1)");
      if (p === 0) return new Dist([{ type: "atom", x: 0, p: 1 }]);

      // Implementation:
      // S = \sum_{k=0}^{inf} (1-p)p^k * (Conv^k(Base))
      // Truncate when p^k < 1e-6 (or cumulative prob > 0.999999)

      let resultComps: DistComponent[] = [];
      let currentConv = new Dist([{ type: "atom", x: 0, p: 1 }]);
      let currentProb = 1 - p; // Prob of stopping at exactly k=0
      let cumulativeProb = 0;
      let k = 0;

      // Limit loop to avoid hang if p is very close to 1 (e.g. 0.999)
      const maxLoops = 2000;

      while (k < maxLoops) {
        // Add weighted components of currentConv to result
        // We shouldn't use MIX directly inside loop as it creates new Dists constantly.
        // Instead, scale components manually.
        for (const c of currentConv.components) {
          if (c.type === "atom") {
            resultComps.push({ ...c, p: c.p * currentProb });
          } else if (c.type === "bin") {
            resultComps.push({ ...c, p: c.p * currentProb });
          } else if (c.type === "tail") {
            resultComps.push({ ...c, mass: c.mass * currentProb });
          }
        }
        cumulativeProb += currentProb;

        if (cumulativeProb > 0.9999) break;

        // Prepare next step
        currentProb *= p / (1 - p); // Wait. Next prob is (1-p)p^(k+1) = Prev * p.
        // My definition of currentProb above was (1-p)*p^k.
        // Correct update is currentProb *= p. But wait.
        // Let's re-verify:
        // k=0: (1-p)
        // k=1: (1-p)p
        // So yes, multiply by p.
        // BUT wait, in the loop above I initialized currentProb = 1-p.
        // So I should multiply by p for NEXT loop.

        // Also we need to convolve BaseDist.
        // Convolution can be expensive.
        // Optimize: If BaseDist is scalar 0, just stop.
        // But BaseDist might not be 0.

        // Convolution for next step (k+1)
        currentConv = currentConv.add(baseDist);
        currentConv = this.checkSafety(currentConv);

        // Update prop
        // Wait, I used currentProb for step k.
        // Now update for k+1.
        currentProb = (1 - p) * Math.pow(p, k + 1);
        // Or simpler:
        // prob[k] = (1-p)p^k
        // prob[k+1] = prob[k] * p.
        // Since I derived currentProb from logic, let's just do:
        // currentProb *= p;
        // But doing Math.pow is safer against drift? No, mul is fine.
        // Re-read carefully:
        // Loop start k=0. currentProb = 1-p. Correct.
        // Add to result.
        // Check break.
        // Prepare next: currentConv += base.
        // Update prob: currentProb *= p. Correct.

        currentProb = (1 - p) * Math.pow(p, k + 1); // safe recalculation
        k++;
      }

      const res = new Dist(resultComps);
      // res.normalize(); // Should sum to ~1 if loop completed well.
      // But resultComps might have overlapping bins, Dist constructor handles sort,
      // but not merging? Dist doesn't merge auto.
      // But checkSafety does reduce.
      return this.checkSafety(res);
    }

    if (fn === "REPEAT_ADD") {
      if (args.length !== 2)
        throw new Error("REPEAT_ADD requires 2 args (Dist, N)");
      const baseDist = args[0];
      const n = Math.floor(this.getScalar(args[1]));

      if (n <= 0) return new Dist([{ type: "atom", x: 0, p: 1 }]);
      if (n === 1) return baseDist;

      // Binary Exponentiation for Convolution
      let acc = new Dist([{ type: "atom", x: 0, p: 1 }]);
      let base = baseDist;
      let count = n;

      while (count > 0) {
        if (count % 2 === 1) {
          acc = acc.add(base);
          acc = this.checkSafety(acc);
        }
        base = base.add(base);
        base = this.checkSafety(base);
        count = Math.floor(count / 2);
      }
      return acc;
    }

    // 4. Observation
    if (fn === "MEAN") {
      if (args.length !== 1) throw new Error("MEAN requires 1 arg (A)");
      const m = args[0].mean();
      return new Dist([{ type: "atom", x: m, p: 1 }]);
    }
    if (fn === "PROB_GT") {
      if (args.length !== 2) throw new Error("PROB_GT requires 2 args (A, x)");
      const val = this.getScalar(args[1]);
      const p = args[0].probGt(val);
      return new Dist([{ type: "atom", x: p, p: 1 }]);
    }

    // 5. Utility
    if (fn === "RESAMPLE") {
      if (args.length !== 2) throw new Error("RESAMPLE requires 2 args (A, n)");
      const n = this.getScalar(args[1]);
      const samples = args[0].sample(n);
      const atoms = samples.map((x) => ({ type: "atom", x, p: 1 } as const));
      const d = new Dist(atoms);
      d.normalize();
      // Resample creates N atoms. If N > limit, checkSafety will catch it?
      // Yes, if we apply checkSafety.
      return this.checkSafety(d);
    }
    if (fn === "REF") {
      if (args.length !== 1) throw new Error("REF requires 1 arg");
      return args[0];
    }

    // 6. Standard Library
    if (fn === "SUB") {
      if (args.length !== 2) throw new Error("SUB requires 2 args (A, B)");
      return this.checkSafety(args[0].sub(args[1]));
    }
    if (fn === "VAR") {
      if (args.length !== 1) throw new Error("VAR requires 1 arg (Dist)");
      const v = args[0].variance();
      return new Dist([{ type: "atom", x: v, p: 1 }]);
    }
    if (fn === "STD") {
      if (args.length !== 1) throw new Error("STD requires 1 arg (Dist)");
      const s = args[0].std();
      return new Dist([{ type: "atom", x: s, p: 1 }]);
    }
    if (fn === "MEDIAN") {
      if (args.length !== 1) throw new Error("MEDIAN requires 1 arg (Dist)");
      const m = args[0].median();
      return new Dist([{ type: "atom", x: m, p: 1 }]);
    }
    if (fn === "SHIFT") {
      if (args.length !== 2) throw new Error("SHIFT requires 2 args (Dist, k)");
      const d = args[0];
      const k = this.getScalar(args[1]);
      // Shift is just add scalar: x -> x+k
      // We can use SCALE logic style or simple ADD(CONST(k)).
      // d.add(CONST(k)) is efficient enough.
      const kDist = new Dist([{ type: "atom", x: k, p: 1 }]);
      return this.checkSafety(d.add(kDist));
    }
    if (fn === "CHOICE") {
      // CHOICE(v1, p1, v2, p2, ...)
      if (args.length < 2 || args.length % 2 !== 0) {
        throw new Error("CHOICE requires even args (v1, p1, v2, p2, ...)");
      }
      const atoms: Atom[] = [];
      for (let i = 0; i < args.length; i += 2) {
        const val = this.getScalar(args[i]);
        const weight = this.getScalar(args[i + 1]);
        atoms.push({ type: "atom", x: val, p: weight });
      }
      const d = new Dist(atoms);
      d.normalize();
      return this.checkSafety(d);
    }

    // 7. Advanced Distributions
    if (fn === "MAX_OF") {
      if (args.length !== 2)
        throw new Error("MAX_OF requires 2 args (Dist, N)");
      const dist = args[0];
      const n = this.getScalar(args[1]);
      return this.checkSafety(dist.maxOf(n));
    }

    if (fn === "RUIN_PROB") {
      // RUIN_PROB(StepDist, Init, Steps)
      if (args.length !== 3)
        throw new Error(
          "RUIN_PROB requires 3 args (StepDist, InitWealth, Steps)"
        );
      const stepDist = args[0];
      const initWealth = this.getScalar(args[1]);
      const steps = Math.floor(this.getScalar(args[2]));

      // Optimization: If Steps is large (> 2000? or even 1000), convolution is slow.
      // Use Brownian Motion Approximation (Inverse Gaussian)
      // First Passage Time density for Brownian Motion with drift mu and variance sigma^2:
      // f(t) = (u / sqrt(2*pi*sigma^2*t^3)) * exp( - (u + mu*t)^2 / (2*sigma^2*t) )
      // We need CDF at t=Steps.
      // Actually we have discrete steps.

      // If user forces approx (maybe add 4th arg? or just threshold)
      if (steps > 300) {
        // Monte Carlo Simulation - preserves distribution shape
        // Dynamic trial count: fewer trials for more steps (keeps time ~constant)
        // Target: ~10M total samples for reasonable accuracy vs speed tradeoff
        const targetSamples = 10_000_000;
        const numSimulations = Math.max(
          1000,
          Math.min(10000, Math.floor(targetSamples / steps))
        );
        let ruinCount = 0;

        // Use Wasm version if available (10-50x faster)
        if (this.ctx.wasmMonteCarlo) {
          ruinCount = this.ctx.wasmMonteCarlo(
            stepDist.components,
            initWealth,
            steps,
            numSimulations
          );
        } else {
          // Fallback to JS version with Alias Table
          for (let sim = 0; sim < numSimulations; sim++) {
            let wealth = initWealth;
            const samples = stepDist.sample(steps);

            for (const step of samples) {
              wealth += step;
              if (wealth <= 0) {
                ruinCount++;
                break;
              }
            }
          }
        }

        const ruinProb = ruinCount / numSimulations;
        return new Dist([{ type: "atom", x: ruinProb, p: 1 }]);
      }

      // Exact Convolution Loop (Reduced)
      let current = new Dist([{ type: "atom", x: initWealth, p: 1 }]);
      let ruinedProb = 0;
      let survivalProb = 1;

      for (let i = 0; i < steps; i++) {
        // Convolution
        current = current.add(stepDist);

        // Safety check! Convolution expands size.
        // We must reduce or check safety. But we also normalize in loop below.
        // checkSafety normalizes too? No, checkSafety calls reduce which normalizes.
        current = this.checkSafety(current);

        // Check Ruin (Wealth <= 0)
        const [fail, safe] = current.splitAt(0);

        // Calculate mass of fail
        let failMass = 0;
        for (const c of fail.components)
          failMass += c.type === "tail" ? c.mass : c.p;

        // Update total ruined probability
        ruinedProb += survivalProb * failMass;

        // Update survival probability
        survivalProb *= 1 - failMass;

        if (survivalProb < 1e-9) {
          // Almost everyone ruined
          ruinedProb = 1;
          break;
        }

        // Continue with safe part
        current = safe;
        current.normalize(); // Renormalize surviving population to 1 for next convolution
      }

      return new Dist([{ type: "atom", x: ruinedProb, p: 1 }]);
    }

    throw new Error(`Unknown function: ${name}`);
  }

  isScalar(d: Dist): boolean {
    // Check if Dist is single Atom with p=1?
    // Or if it behaves like a scalar.
    // Ideally we use a Scalar type, but everything is Dist.
    if (
      d.components.length === 1 &&
      d.components[0].type === "atom" &&
      Math.abs(d.components[0].p - 1) < 1e-9
    ) {
      return true;
    }
    return false;
  }

  getScalar(d: Dist): number {
    if (this.isScalar(d)) {
      if (d.components.length === 0) return 0; // Should not happen if isScalar
      if (d.components[0].type === "atom") return d.components[0].x;
    }
    throw new Error("Expected scalar value (single atom with p=1)");
  }
}
export function evaluate(expr: string, ctx: EvalContext): Dist {
  try {
    if (!expr) return new Dist([]);
    const tokens = tokenize(expr);
    const parser = new Parser(tokens, ctx);
    return parser.parseExpression();
  } catch (e: unknown) {
    throw new Error(`Eval Error: ${(e as Error).message}`);
  }
}
