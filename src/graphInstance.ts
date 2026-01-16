import { WorkerClient } from "./engine/workerClient";

export const graph = new WorkerClient();

// ==========================================
// P北斗の拳 強敵LT (サミー) - 正確な実機スペック
// 2024年3月導入
// ==========================================

// --- Section 1: 基本スペック ---
graph.setCellInput("A1", "機種名");
graph.setCellInput("B1", "P北斗の拳 強敵LT");

graph.setCellInput("A2", "大当たり確率");
graph.setCellInput("B2", "=1/99.9");

graph.setCellInput("A3", "RUSH突入率");
graph.setCellInput("B3", "=0.50");

graph.setCellInput("A4", "強敵RUSH継続率");
graph.setCellInput("B4", "=0.70");

graph.setCellInput("A5", "HYPER RUSH継続率");
graph.setCellInput("B5", "=0.95");

// --- Section 2: 出玉設定 (振り分け考慮) ---
graph.setCellInput("A7", "通常当たり (4R)");
graph.setCellInput("B7", "=400");

// 強敵RUSH中の振り分け: 10R-LT昇格 10%, 10R 10%, 6R 20%, 3R 60%
graph.setCellInput("A8", "強敵RUSH中出玉");
graph.setCellInput("B8", "=DISCRETE(1000, 0.20, 600, 0.20, 300, 0.60)");

// HYPER RUSH中の振り分け: 10R 20%, 6R 20%, 3R 60%
graph.setCellInput("A9", "HYPER RUSH中出玉");
graph.setCellInput("B9", "=DISCRETE(1000, 0.20, 600, 0.20, 300, 0.60)");

// LT昇格率 = 10R当選(20%)の半分(50%)がLT = 実質10%...ではなく
// 「10R-LT昇格」が10%、これが実質のLT昇格確率
// ただし1回の当たりあたり10%は過大。実際は「全体の10%」を連チャン回数で割る必要
graph.setCellInput("A10", "LT昇格率(当たり毎)");
graph.setCellInput("B10", "=0.05");

// --- Section 3: 計算 (GEOM_SUM使用) ---
// Col C: ラベル, Col D: 数式

// 強敵RUSH期待出玉 (初回も70%抽選なのでADD不要)
graph.setCellInput("C4", "強敵RUSH期待出玉");
graph.setCellInput("D4", "=GEOM_SUM(B8, B4)");

// HYPER RUSH期待出玉 (LT突入時の10Rは確定 + 95%継続)
graph.setCellInput("C5", "HYPER RUSH期待出玉");
graph.setCellInput("D5", "=ADD(CONST(1000), GEOM_SUM(B9, B5))");

// LT突入確率 (RUSH中のどこかでLT行き)
// GEOM_SUM平均 = p/(1-p) = 0.7/0.3 = 2.33回
// 近似: 1 - (1 - B10)^(B4/(1-B4))
graph.setCellInput("C6", "LT突入確率(近似)");
graph.setCellInput("D6", "=1 - POWER(1 - B10, B4 / (1 - B4))");

// RUSH総合出玉 (強敵RUSH + LT突入チャンス)
graph.setCellInput("C7", "RUSH総合期待出玉");
graph.setCellInput("D7", "=ADD(D4, MIX(D6, D5, 0))");

// 大当たり期待出玉 (RUSH突入時 vs 非突入時)
graph.setCellInput("C8", "大当たり期待出玉");
graph.setCellInput("D8", "=MIX(B3, D7, B7)");

// ボーダー (MEAN で期待値を取得)
graph.setCellInput("C9", "ボーダー (回転/1k)");
graph.setCellInput("D9", "=250 / (MEAN(D8) * B2)");

// --- Section 4: 収支シミュレーション ---
graph.setCellInput("A12", "自分の回転数/1k");
graph.setCellInput("B12", "=18.0");

graph.setCellInput("C12", "1回転コスト(玉)");
graph.setCellInput("D12", "=-250 / B12");

// 1回転あたり大当たり分布 (DISCRETEを使用したフル分布)
graph.setCellInput("A13", "1回転大当たり分布");
graph.setCellInput(
  "B13",
  "=MIX(B2, MIX(B3, ADD(GEOM_SUM(B8, B4), MIX(D6, ADD(CONST(1000), GEOM_SUM(B9, B5)), 0)), B7), 0)"
);

// ネット収支 (大当たり分 + コスト)
graph.setCellInput("C13", "1回転ネット収支");
graph.setCellInput("D13", "=ADD(B13, D12)");

// --- Section 5: 破産確率・勝率 ---
graph.setCellInput("A15", "初期資金(玉)");
graph.setCellInput("B15", "=50000");

graph.setCellInput("A16", "目標回転数");
graph.setCellInput("B16", "=1000");

graph.setCellInput("C15", "破産確率");
graph.setCellInput("D15", "=RUIN_PROB(D13, B15, B16)");

graph.setCellInput("C16", "勝率(近似)");
graph.setCellInput(
  "D16",
  "=PROB_GT(NORMAL(MEAN(D13)*B16, STD(D13)*POWER(B16, 0.5)), 0)"
);

// --- Section 6: 期待値情報 ---
graph.setCellInput("A18", "平均出玉/当たり");
graph.setCellInput("B18", "=MEAN(D8)");

graph.setCellInput("C18", "1000回転期待収支");
graph.setCellInput("D18", "=MEAN(D13) * B16");
