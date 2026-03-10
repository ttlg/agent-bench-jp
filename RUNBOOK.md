# Runbook

マスターエージェントがベンチマークを実行する手順。

## 0. ユーザーに確認する

ベンチマーク実行前に、以下をユーザーに確認する。

- **実行するタスク**: `tasks/` のどれか、または全タスク
- **対象エージェント**: claude-code, codex など
- **effort レベル**: low / medium / high / xhigh(Codex) / max(Claude)（エージェントごとに指定可能）

## 1. タスクを選ぶ

`tasks/` から実行するタスクの `instruction.md` を読む。

## 2. ディレクトリを作る

エージェント分だけ `mktemp -d` で作成。パス名がランダムになるため匿名性が担保される。

```bash
mktemp -d  # → /tmp/tmp.x7k2m...
mktemp -d  # → /tmp/tmp.r9f4j...
```

## 3. タスクを実装させる（並列）

各エージェントにタスクを投入する。**タスク作成時の時刻を記録しておくこと。**

```bash
./task create \
  --instruction "<instruction.mdの内容>" \
  --agent-type <agent> \
  --directory <tmpディレクトリ> \
  --name "JP-Bench <taskId> <agent>"
```

- エージェントごとに別の `--directory` を指定する
- タスク作成時の時刻を `started_at` として控えておく
- `waiting_confirmation` になったら `./task get` で内容を確認し、完了していれば `./task complete`
- 完了時の時刻を `completed_at` として控え、`duration_seconds`（経過秒数）を算出する

## 4. 全エージェントの完了を待つ

## 5. 成果物を評価させる（並列）

各成果物に対して、各ジャッジモデルごとに独立したタスクを作成する。**タスク作成時の時刻を記録しておくこと。**

```bash
./task create \
  --instruction "<judge.mdテンプレート + instruction.mdの内容 + tmpパス>" \
  --agent-type <judge> \
  --name "JP-Bench <taskId> Judge"
```

- ジャッジは **1つの成果物のみ** を見る。他の提出物の存在もエージェント名も知らない
- 成果物N個 x ジャッジモデルM個 = N*M タスク
- タスク作成時の時刻を控え、完了時の時刻も記録しておく

## 6. 全ジャッジの完了を待つ

## 7. 結果を保存する

### 成果物のコピー

各エージェントの成果物を `/tmp/...` から `runs/` に移動する。

```
runs/<date>/<task>/<agent>/   ← /tmp/tmp.x7k2m... の中身をコピー
```

### メタ情報の保存

各エージェントの成果物ディレクトリに `meta.json` を作成し、タイムスタンプを記録する。

```json
{
  "agent": "claude-code",
  "effort": "medium",
  "started_at": "2026-03-10T09:30:00+09:00",
  "completed_at": "2026-03-10T09:45:00+09:00",
  "duration_seconds": 900
}
```

```
runs/<date>/<task>/<agent>/meta.json
```

### ジャッジ結果の保存

ジャッジの出力JSONに `judged_at` フィールドを追加して保存する。
`judged_at` はジャッジタスクが完了した時刻をマスターエージェントが記録する。

```
runs/<date>/<task>/judgments/<評価対象agent>/<judge>.json
```

```json
{
  "correctness": 5,
  "code_quality": 4,
  "robustness": 4,
  "design": 4,
  "comprehension": 5,
  "total": 22,
  "reasoning": "...",
  "judge": "claude-code (Opus 4.6)",
  "judged_at": "2026-03-10T10:00:00+09:00",
  "duration_seconds": 120
}
```

例:
```
runs/2026-03-10/001-cli-tool/
  claude-code/          ← claude-code の成果物
    meta.json           ← タイムスタンプ
  codex/                ← codex の成果物
    meta.json           ← タイムスタンプ
  judgments/
    claude-code/        ← claude-code を評価した結果
      codex.json        ← codex ジャッジによる評価
      claude-code.json  ← claude-code ジャッジによる評価
    codex/              ← codex を評価した結果
      codex.json
      claude-code.json
```

## 8. リーダーボードを更新する

```bash
npx tsx scripts/leaderboard.ts
```

## 9. コミット＆プッシュ

結果を常にコミットしてプッシュすること。確認は不要。

```bash
cd ~/repos/jp-bench
git add -A
git commit -m "Add <task> results"
git push
```
