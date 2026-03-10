# タスク: SQLパーサー＆実行エンジン

TypeScriptで、SQL文をパースしてJSONデータに対してクエリを実行するCLIツールを作成してください。

## 要件

- コマンド名: `jsql`
- 使い方:
  ```
  jsql --data <JSONファイル> --query "<SQL文>"
  ```
- JSONファイルはテーブル名をキー、配列を値とするオブジェクト:
  ```json
  {
    "users": [
      {"id": 1, "name": "田中太郎", "age": 30, "department_id": 1},
      {"id": 2, "name": "佐藤花子", "age": 25, "department_id": 2},
      {"id": 3, "name": "鈴木一郎", "age": 35, "department_id": 1}
    ],
    "departments": [
      {"id": 1, "name": "開発部"},
      {"id": 2, "name": "営業部"},
      {"id": 3, "name": "人事部"}
    ]
  }
  ```

## 対応するSQL構文

### SELECT

```sql
SELECT * FROM users
SELECT name, age FROM users
SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id
```

- `*` によるワイルドカード選択
- カラム名の指定（複数可）
- テーブルエイリアス付きのカラム参照（`u.name`）

### WHERE

```sql
SELECT * FROM users WHERE age > 30
SELECT * FROM users WHERE name = '佐藤花子'
SELECT * FROM users WHERE age >= 25 AND department_id = 1
SELECT * FROM users WHERE age < 30 OR department_id = 2
SELECT * FROM users WHERE NOT age = 30
SELECT * FROM users WHERE name LIKE '%太郎'
```

- 比較演算子: `=`, `!=`, `<`, `>`, `<=`, `>=`
- 論理演算子: `AND`, `OR`, `NOT`
- `LIKE` 演算子（`%` ワイルドカードのみ対応すればよい）
- 文字列リテラルはシングルクォート
- 括弧 `()` による優先順位指定

### ORDER BY

```sql
SELECT * FROM users ORDER BY age ASC
SELECT * FROM users ORDER BY age DESC, name ASC
```

- `ASC`（昇順、デフォルト）/ `DESC`（降順）
- 複数カラムによるソート

### LIMIT / OFFSET

```sql
SELECT * FROM users LIMIT 10
SELECT * FROM users LIMIT 10 OFFSET 5
```

### JOIN

```sql
SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id
SELECT u.name, d.name FROM users u LEFT JOIN departments d ON u.department_id = d.id
```

- `INNER JOIN`（`JOIN` と同義）
- `LEFT JOIN`（`LEFT OUTER JOIN` と同義）
- `ON` による結合条件

### 集約関数

```sql
SELECT COUNT(*) FROM users
SELECT department_id, COUNT(*) FROM users GROUP BY department_id
SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30
```

- `COUNT(*)`, `COUNT(column)`
- `SUM(column)`, `AVG(column)`, `MIN(column)`, `MAX(column)`
- `GROUP BY`
- `HAVING`

## 出力形式

- 結果をテーブル形式で表示:
  ```
  | name       | age |
  |------------|-----|
  | 田中太郎   |  30 |
  | 佐藤花子   |  25 |
  ```
- `--format json` オプションでJSON配列として出力:
  ```json
  [{"name": "田中太郎", "age": 30}, {"name": "佐藤花子", "age": 25}]
  ```

## テスト

- 上記のJSONデータを使ったテストを作成すること
- 各SQL構文（SELECT, WHERE, JOIN, ORDER BY, LIMIT, GROUP BY, HAVING, LIKE）のテストを含めること
- `npm test` で実行できること

## 制約

- 外部のSQLパーサーライブラリを使わず、自前でパーサーを実装すること
- npm script または npx で実行できるようにすること
- SQLキーワードは大文字小文字を区別しないこと（`SELECT` と `select` は同じ）
