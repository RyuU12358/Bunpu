# 汎用関数 `GEOM_SUM` 実装計画

## 目標

パチンコの RUSH（継続抽選）のような、「ある確率で継続する限り繰り返す」試行の合計値を計算するための汎用関数 `GEOM_SUM` を実装する。
これにより、特定のギャンブルに依存しない汎用的な統計ツールとしての性質を維持しつつ、複雑な継続システムを記述可能にする。

## User Review Required

- **仕様**: `GEOM_SUM(BaseDist, ContinueProb)`
  - これは「成功率 p (`ContinueProb`) のベルヌーイ試行が『失敗』するまでの成功回数」分だけ、`BaseDist` の独立なコピーを足し合わせた分布を返す。
  - **回数の定義**:
    - 0 回（即失敗）の確率は `1-p`。
    - k 回継続する確率は `(1-p) * p^k`。
  - **パチンコへの適用**:
    - パチンコの RUSH は通常「突入時点で 1 回確約」の場合と、「次回継続抽選から」の場合がある。
    - 突入直後（1 回目）も継続抽選があるタイプ（ST など）: `GEOM_SUM(Payout, Rate)` そのまま。
    - 次回まで確約（ループタイプ）: `ADD(Payout, GEOM_SUM(Payout, Rate))` または `REPEAT_ADD` との組み合わせ。
    - ユーザーにはガイドでこの使い分けを説明する。

## Proposed Changes

### `src/engine`

#### [MODIFY] [evaluator.ts](file:///c:/dev_Bunpu/Bunpu/src/engine/evaluator.ts)

- `Parser.parseFunctionCall` に `GEOM_SUM` を追加。
  - 引数チェック: `GEOM_SUM(Dist, p)`
  - ロジック実装:
    - 近似的な実装を行う（無限和は計算不可能なので）。
    - 累積確率が `Limit` (99.9%?) に達するまでループ。
    - `CurrentDist`: 初期 `Probability=1.0` (0 回時点)。
    - `ResultDist`: 0 (`Const(0)`) からスタート。
    - 各ステップ `k (0, 1, 2...)`:
      - `StopProb = (1-p) * p^k`
      - `ResultDist` に、`k`回畳み込んだ分布 `ConvDist_k` を、重み `StopProb` で MIX していく。
      - 実際には:
        - `Accum = Atom(0)`
        - `WeightTotal = 0`
        - Loop k=0 to Max:
          - Weight = `(1-p) * p^k`
          - `Accum` を ResultCollection に追加 (Weight 付き)
          - `Accum = Accum + BaseDist` (各ステップで 1 回分畳み込み)
        - 最後に `Dist(ResultCollection)` を作成して返す。
    - **最適化**:
      - `Accum` がステップごとに肥大化するのを防ぐため、`checkSafety` (reduce) を都度かける。
      - `p` が高い（例 0.95）と連チャン回数が伸びる（平均 20 回、最大 100 回とか）。
      - 毎回畳み込むと遅いので、ある程度まとめて計算するか？
      - いや、まずは素直なループ実装で、あまりに遅ければ `REPEAT_ADD` の倍々ロジックを応用する（が、各回の分布が必要なので難しい）。
      - `p` が高い場合は「正規分布近似」に切り替える手もあるが、今回は正確性重視でループ実装を試みる。

## Verification Plan

### Automated Tests

- `src/engine/evaluator_geom.test.ts` を新規作成
  - **テストケース 1: 継続率 50% (p=0.5)**
    - 平均連チャン回数 `1/(1-0.5) - 1 = 1回`?
    - 幾何分布の定義による。
    - 定義: 失敗までの「成功回数」。
    - p=0.5 -> 0 回(50%), 1 回(25%), 2 回(12.5%)...
    - 平均回数 E[N] = p/(1-p) = 0.5/0.5 = 1 回。
    - `GEOM_SUM(CONST(10), 0.5)` の平均値は 10。
  - **テストケース 2: パチンコ台スペック**
    - 北斗の拳（継続率 84%）
    - 平均 `0.84 / 0.16 = 5.25回`。
    - 平均出玉 `5.25 * Payout` になるか確認。

### Manual Verification

- Bunpu UI で `GEOM_SUM(DISCRETE(1500,1), 0.81)` を入力し、分布の形状（右に長い裾野）を確認する。
