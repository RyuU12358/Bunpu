export type Language = "en" | "ja";

export const translations = {
  en: {
    title: "Bunpu - Probabilistic Spreadsheet",
    cellError: "Error",
    formulaBar: "Formula:",
    examples: "Examples",
    save: "Save",
    load: "Load",
    maxComps: "Max Comps",
    mean: "Mean",
    variance: "Variance",
    stdDev: "Std Dev",
    median: "Median",
    comps: "Comps",
    distShape: "Distribution Shape",
    selectCell: "Select a cell to view details",
    cellNotFound: "Cell not found",
    empty: "Empty",
    unknownError: "Unknown Error",
    // Function Descriptions
    func_UNIFORM: "Uniform distribution between min and max",
    func_NORMAL: "Normal distribution with mean and std dev",
    func_DISCRETE: "Discrete distribution from value-prob pairs",
    func_EXPONENTIAL: "Exponential distribution (rate)",
    func_POISSON: "Poisson distribution (lambda)",
    func_BINOMIAL: "Binomial distribution (n, p)",
    func_ADD: "Add two distributions or numbers",
    func_SUB: "Subtract two distributions or numbers",
    func_MUL: "Multiply two distributions or numbers",
    func_DIV: "Divide two distributions or numbers",
    func_MIX: "Mixture of two distributions (p, d1, d2)",
    func_CONVOLVE: "Convolve two distributions (sum of random variables)",
    func_RUIN_PROB: "Prob of ruin given step dist, init wealth, steps",
    func_POWER: "Raise distribution to a power (scalar only for now)",
    func_PROB_GT: "Probability that value is greater than x",
    func_MEAN: "Mean (Expected Value) of distribution",
    func_VAR: "Variance of distribution",
    func_STD: "Standard Deviation of distribution",
    func_MEDIAN: "Median of distribution",
    func_MAX_OF: "Distribution of Max(X1, ..., Xn)",
    func_CHOICE: "Create distribution from value-weight pairs",
    func_RESAMPLE: "Resample n items from distribution",
    func_SHIFT: "Shift distribution by k (X + k)",
  },
  ja: {
    title: "Bunpu - 確率的スプレッドシート",
    cellError: "エラー",
    formulaBar: "数式:",
    examples: "例",
    save: "保存",
    load: "読込",
    maxComps: "最大成分数",
    mean: "平均",
    variance: "分散",
    stdDev: "標準偏差",
    median: "中央値",
    comps: "成分数",
    distShape: "分布形状",
    selectCell: "セルを選択して詳細を表示",
    cellNotFound: "セルが見つかりません",
    empty: "空",
    unknownError: "不明なエラー",

    // Function Descriptions
    func_UNIFORM: "最小値と最大値の間の連続一様分布",
    func_NORMAL: "平均と標準偏差による正規分布",
    func_DISCRETE: "値と確率のペアによる離散分布",
    func_EXPONENTIAL: "指数分布（率 rate）",
    func_POISSON: "ポアソン分布（平均発生回数 lambda）",
    func_BINOMIAL: "二項分布（試行回数 n, 確率 p）",
    func_ADD: "分布または数値の足し算",
    func_SUB: "分布または数値の引き算",
    func_MUL: "分布または数値の掛け算",
    func_DIV: "分布または数値の割り算",
    func_MIX: "確率 p で d1、(1-p) で d2 を選ぶ混合分布",
    func_CONVOLVE: "2つの分布の畳み込み（確率変数の和）",
    func_RUIN_PROB: "破産確率（ステップ分布、初期資産、回数）",
    func_POWER: "分布の累乗（現在はスカラーのみ対応）",
    func_PROB_GT: "値が x より大きくなる確率 P(X > x)",
    func_MEAN: "平均値（期待値）",
    func_VAR: "分散",
    func_STD: "標準偏差",
    func_MEDIAN: "中央値",
    func_MAX_OF: "n個の確率変数の最大値の分布",
    func_CHOICE: "値と重みのペアから分布を作成",
    func_RESAMPLE: "分布からn個リサンプリングした分布",
    func_SHIFT: "分布を定数 k だけずらす (X + k)",
  },
};

let currentLang: Language = "ja";
const listeners: (() => void)[] = [];

export const getLang = () => currentLang;

export const setLang = (lang: Language) => {
  currentLang = lang;
  listeners.forEach((l) => l());
};

export const t = (key: keyof (typeof translations)["en"]) => {
  return translations[currentLang][key];
};

export const useTranslation = () => {
  // Basic reactivity for react components
  // In a real app we'd use react Context or proper lib
  // but for MVP this is enough
  const [lang, setL] = useState(currentLang);
  useEffect(() => {
    const l = () => setL(currentLang);
    listeners.push(l);
    return () => {
      const idx = listeners.indexOf(l);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);
  return {
    t: (key: keyof (typeof translations)["en"]) => translations[lang][key],
    lang,
    setLang: (l: Language) => setLang(l),
  };
};

import { useState, useEffect } from "react";
