# Runbook

マスターエージェントがベンチマークを実行する手順。

## 1. タスクを選ぶ

`tasks/` から実行するタスクの `instruction.md` を読む。

## 2. ディレクトリを作る

エージェント分だけ `mktemp -d` で作成。パス名がランダムになるため匿名性が担保される。

```bash
mktemp -d  # → /tmp/tmp.x7k2m...
mktemp -d  # → /tmp/tmp.r9f4j...
```

## 3. タスクを実装させる（並列）

各エージェントにタスクを投入する。

```bash
./task create \
  --instruction "<instruction.mdの内容>" \
  --agent-type <agent> \
  --directory <tmpディレクトリ> \
  --name "JP-Bench <taskId> <agent>"
```

- エージェントごとに別の `--directory` を指定する
- `waiting_confirmation` になったら `./task get` で内容を確認し、完了していれば `./task complete`

## 4. 全エージェントの完了を待つ

## 5. 成果物を評価させる（並列）

各成果物に対して、各ジャッジモデルごとに独立したタスクを作成する。

```bash
./task create \
  --instruction "<judge.mdテンプレート + instruction.mdの内容 + tmpパス>" \
  --agent-type <judge> \
  --name "JP-Bench <taskId> Judge"
```

- ジャッジは **1つの成果物のみ** を見る。他の提出物の存在もエージェント名も知らない
- 成果物N個 x ジャッジモデルM個 = N*M タスク

## 6. 全ジャッジの完了を待つ

## 7. 結果を保存する

### 成果物のコピー

各エージェントの成果物を `/tmp/...` から `runs/` に移動する。

```
runs/<date>/<task>/<agent>/   ← /tmp/tmp.x7k2m... の中身をコピー
```

### ジャッジ結果の保存

ジャッジの出力JSONを以下に保存する。

```
runs/<date>/<task>/judgments/<評価対象agent>/<judge>.json
```

例:
```
runs/2026-03-10/001-cli-tool/
  claude-code/          ← claude-code の成果物
  codex/                ← codex の成果物
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
