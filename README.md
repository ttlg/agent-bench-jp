# Agent Bench JP

https://ttlg.github.io/agent-bench-jp/

日本語コーディングエージェントベンチマーク。

日本語の指示に対するコーディングエージェント（Claude Code, Codex, etc.）の性能を比較評価する。

## How it works

1. 同一タスクを複数のエージェントに `/tmp` の別ディレクトリで実行させる
2. 各成果物を個別のジャッジエージェントに渡して採点（エージェント名は不明）
3. マスターエージェントが結果を集計し `runs/` に整理

## Evaluation criteria (25 points)

| Criteria | Description |
|---|---|
| Correctness | 要求を正しく満たしているか |
| Code Quality | 可読性、構造、命名 |
| Robustness | エラーハンドリング、エッジケース |
| Design | 抽象化、ライブラリ選択 |
| Comprehension | 日本語の指示理解度 |

各5点満点。詳細は [rubric.md](./rubric.md) を参照。

## Key design decisions

- **エージェント製品を測る** — モデル単体ではなく、Claude Code / Codex 等の製品としての実力
- **匿名評価** — `/tmp` のランダムパスで匿名性を自然に担保。ジャッジは相手の存在すら知らない
- **独立ジャッジ** — 各成果物を別々のジャッジエージェントが個別に採点。比較ではなく絶対評価
- **完全日本語** — タスク指示は全て日本語。日本語理解力も評価対象
- **AGI Cockpit** — オーケストレーション基盤として使用
