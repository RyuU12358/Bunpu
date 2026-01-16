export interface FunctionDef {
  name: string;
  description: string;
  args: string[];
}

export const functionRegistry: FunctionDef[] = [
  {
    name: "UNIFORM",
    description: "Uniform distribution between min and max",
    args: ["min", "max"],
  },
  {
    name: "NORMAL",
    description: "Normal distribution with mean and std dev",
    args: ["mean", "std"],
  },
  {
    name: "DISCRETE",
    description: "Discrete distribution from value-prob pairs",
    args: ["val1", "prob1", "..."],
  },
  {
    name: "EXPONENTIAL",
    description: "Exponential distribution (rate)",
    args: ["rate"],
  },
  {
    name: "POISSON",
    description: "Poisson distribution (lambda)",
    args: ["lambda"],
  },
  {
    name: "BINOMIAL",
    description: "Binomial distribution (n, p)",
    args: ["n", "p"],
  },
  {
    name: "ADD",
    description: "Add two distributions or numbers",
    args: ["a", "b"],
  },
  {
    name: "SUB",
    description: "Subtract two distributions or numbers",
    args: ["a", "b"],
  },
  {
    name: "MUL",
    description: "Multiply two distributions or numbers",
    args: ["a", "b"],
  },
  {
    name: "DIV",
    description: "Divide two distributions or numbers",
    args: ["a", "b"],
  },
  {
    name: "MIX",
    description: "Mixture of two distributions (p, Dist1, Dist2)",
    args: ["p", "d1", "d2"],
  },
  {
    name: "RUIN_PROB",
    description: "Prob of ruin given step dist, init wealth, steps",
    args: ["stepDist", "init", "steps"],
  },
  {
    name: "CONVOLVE",
    description: "Convolve two distributions (sum of random variables)",
    args: ["d1", "d2"],
  },
  {
    name: "POWER",
    description: "Raise distribution to a power (scalar only for now)",
    args: ["d", "exponent"],
  },
  {
    name: "PROB_GT",
    description: "Probability that value is greater than x",
    args: ["Dist", "x"],
  },
  {
    name: "MEAN",
    description: "Mean (Expected Value) of distribution",
    args: ["Dist"],
  },
  {
    name: "VAR",
    description: "Variance of distribution",
    args: ["Dist"],
  },
  {
    name: "STD",
    description: "Standard Deviation of distribution",
    args: ["Dist"],
  },
  {
    name: "MEDIAN",
    description: "Median of distribution",
    args: ["Dist"],
  },
  {
    name: "MAX_OF",
    description: "Distribution of Max(X1, ..., Xn)",
    args: ["Dist", "n"],
  },
  {
    name: "CHOICE",
    description: "Create distribution from value-weight pairs",
    args: ["v1", "w1", "..."],
  },
  {
    name: "RESAMPLE",
    description: "Resample n items from distribution",
    args: ["Dist", "n"],
  },
  {
    name: "SHIFT",
    description: "Shift distribution by k (X + k)",
    args: ["Dist", "k"],
  },
  {
    name: "GEOM_SUM",
    description:
      "Sum of N i.i.d. variables where N is geometric (RUSH calculation)",
    args: ["Dist", "p"],
  },
  {
    name: "REPEAT_ADD",
    description: "Add distribution N times (fixed repetition)",
    args: ["Dist", "N"],
  },
  {
    name: "CONST",
    description: "Create constant (scalar) distribution",
    args: ["value"],
  },
  {
    name: "REDUCE",
    description: "Reduce distribution to N components",
    args: ["Dist", "targetN"],
  },
  {
    name: "CONFIG",
    description: "Set component limit for expression",
    args: ["limit", "expr"],
  },
];
