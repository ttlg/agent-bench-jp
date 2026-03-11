# タスク: 適格請求書 消費税計算エンジン

TypeScriptで、日本の適格請求書（インボイス）向けの消費税計算CLIツールを作成してください。

## ゴール

明細行ごとの税区分・税込/税抜・丸め方式の違いを扱える、再利用可能な税計算エンジンを実装してください。

## コマンド

```bash
invoice-tax calc --input invoice.json
invoice-tax calc --input invoice.json --round floor --aggregation per-rate --format json
```

## 入力JSON

以下のようなJSONを受け付けること。

```json
{
  "invoice_number": "T1234567890123",
  "currency": "JPY",
  "items": [
    {
      "description": "おにぎり",
      "quantity": 2,
      "unit_price": 108,
      "amount_type": "inclusive",
      "tax_category": "reduced"
    },
    {
      "description": "文房具",
      "quantity": 3,
      "unit_price": 100,
      "amount_type": "exclusive",
      "tax_category": "standard"
    },
    {
      "description": "値引き",
      "quantity": 1,
      "unit_price": -50,
      "amount_type": "exclusive",
      "tax_category": "standard"
    }
  ]
}
```

## 税区分

次の3種類をサポートすること。

- `standard` = 10%
- `reduced` = 8%
- `exempt` = 0%

## 金額仕様

- すべての金額は円単位の整数で扱うこと
- 浮動小数点の丸め誤差を避けること
- 各行の金額は `quantity * unit_price` で計算すること
- `unit_price` が負の場合は値引きや返品を表せること

## amount_type

各明細行は次のいずれか。

- `exclusive`: 税抜単価
- `inclusive`: 税込単価

計算時は、各行について以下を求めること。

- `line_subtotal_exclusive`
- `line_tax`
- `line_total_inclusive`

## 丸め方式

`--round` で次を選べること。

- `floor`
- `ceil`
- `round`

デフォルトは `floor` とすること。

## 集計方式

`--aggregation` で次を選べること。

- `per-line`: 行ごとに税額を計算・丸めしてから集計
- `per-rate`: 税率ごとに税抜/税込金額を合算し、その合計に対して税額を計算・丸め

デフォルトは `per-line` とすること。

## インボイス番号

- `invoice_number` は省略可
- 存在する場合は `T` + 13桁数字のみ有効
- 不正な場合はエラー

## 出力

### テキスト出力（デフォルト）

次の情報を見やすく表示すること。

- 明細ごとの計算結果
- 税率ごとの税抜合計・税額・税込合計
- 総税抜金額
- 総税額
- 総税込金額

例:

```text
[10%]
税抜 250円  税額 25円  税込 275円

[8%]
税抜 200円  税額 16円  税込 216円

総税抜: 450円
総税額: 41円
総税込: 491円
```

### JSON出力

`--format json` 指定時は、最低限次の構造を持つこと。

```json
{
  "invoice_number": "T1234567890123",
  "rounding": "floor",
  "aggregation": "per-line",
  "lines": [
    {
      "description": "おにぎり",
      "line_subtotal_exclusive": 200,
      "line_tax": 16,
      "line_total_inclusive": 216
    }
  ],
  "totals_by_rate": {
    "standard": {
      "subtotal_exclusive": 250,
      "tax": 25,
      "total_inclusive": 275
    },
    "reduced": {
      "subtotal_exclusive": 200,
      "tax": 16,
      "total_inclusive": 216
    }
  },
  "grand_total": {
    "subtotal_exclusive": 450,
    "tax": 41,
    "total_inclusive": 491
  }
}
```

## 実装要件

- 計算ロジックをライブラリとして分離すること
- CLIはそのライブラリを呼び出すだけにすること
- 入力JSONのスキーマエラーを分かりやすく表示すること
- `npm test` でテスト実行できること

## テストで必ずカバーすること

- 10% / 8% / 0% の各税率
- 税込入力と税抜入力の混在
- 値引き（負の金額）
- `per-line` と `per-rate` で結果が変わるケース
- `floor` / `ceil` / `round` の差が出るケース
- インボイス番号の正常系/異常系
- 浮動小数点誤差を避ける実装であること

## 制約

- 金額計算のためだけに外部マネーライブラリへ依存しないこと
- `npm script` または `npx` で実行できるようにすること
