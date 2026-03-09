# JP-Bench

日本語コーディングエージェントベンチマーク。

日本語の指示に対するコーディングエージェント（Claude Code, Codex, etc.）の性能を比較評価する。

## 特徴

- 日本語の依頼文による完全オリジナルのタスクセット
- エージェント製品（モデル単体ではなく）の実力を測定
- LLM-as-a-judge による匿名評価（/tmp パスで匿名性を自然に担保）
- AGI Cockpit によるオーケストレーション

## 評価方法

1. 同一タスクを複数のエージェントに /tmp で実行させる
2. ジャッジエージェントに /tmp の成果物パスを渡して採点（エージェント名は不明）
3. マスターエージェントが結果を集計し、runs/ に整理

## 評価観点（各5点満点、合計25点）

1. 正確性（Correctness）
2. コード品質（Code Quality）
3. 堅牢性（Robustness）
4. 設計判断（Design Decision）
5. 指示理解（Instruction Comprehension）

詳細は [rubric.md](./rubric.md) を参照。
