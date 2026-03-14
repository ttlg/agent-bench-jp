# タスク: 簡易全銀フォーマット振込データ生成CLI

Pythonで、**簡易版の全銀フォーマット** 振込データを生成するCLIツールを作成してください。

## ゴール

振込依頼のJSONから、ヘッダ・データ・トレーラ・エンドの4種のレコードを持つ**固定長テキストファイル**を生成してください。

これは **学習用の簡易版仕様** であり、実際の全銀協仕様の完全実装は不要です。以下の仕様に正確に従うこと。

## コマンド

```bash
python zengin.py --input transfers.json --output zengin.txt
python zengin.py --input transfers.json --output zengin.txt --encoding shift_jis
python zengin.py --input transfers.json --stdout --format preview
```

オプション:

- `--encoding utf-8|shift_jis`（デフォルト: `shift_jis`）
- `--stdout`: ファイルに書かず標準出力へ出す
- `--format preview`: 固定長レコードそのものではなく、各レコードの分解表示を行う

## 入力JSON

```json
{
  "header": {
    "file_creation_date": "2026-03-10",
    "client_code": "1234567890",
    "client_name_kana": "ｶ)ｵﾗｸﾙ",
    "bank_code": "0001",
    "branch_code": "001",
    "account_type": "ordinary",
    "account_number": "1234567"
  },
  "transfers": [
    {
      "bank_code": "0005",
      "branch_code": "123",
      "account_type": "ordinary",
      "account_number": "7654321",
      "recipient_name_kana": "ｶ)ｻﾝﾌﾟﾙ",
      "amount": 120000,
      "new_code": "1",
      "customer_code": "INV-0001"
    }
  ]
}
```

## 出力仕様

- 1レコード **120文字固定長**
- 改行は `CRLF` (`\r\n`)
- レコード種別は以下の4種類
  - `1`: ヘッダ
  - `2`: データ
  - `8`: トレーラ
  - `9`: エンド

## フィールド仕様

### 1. ヘッダレコード

| 項目 | 長さ | 仕様 |
|---|---:|---|
| record_type | 1 | 固定値 `1` |
| service_code | 2 | 固定値 `21` |
| file_creation_date | 8 | `YYYYMMDD` |
| bank_code | 4 | 数字、左ゼロ埋め |
| branch_code | 3 | 数字、左ゼロ埋め |
| account_type | 1 | `ordinary=1`, `current=2`, `savings=4` |
| account_number | 7 | 数字、左ゼロ埋め |
| client_code | 10 | 右寄せではなくそのまま。足りなければ右空白埋め |
| client_name_kana | 40 | 右空白埋め |
| filler | 44 | 空白 |

合計120文字。

### 2. データレコード

| 項目 | 長さ | 仕様 |
|---|---:|---|
| record_type | 1 | 固定値 `2` |
| bank_code | 4 | 数字、左ゼロ埋め |
| branch_code | 3 | 数字、左ゼロ埋め |
| account_type | 1 | `ordinary=1`, `current=2`, `savings=4` |
| account_number | 7 | 数字、左ゼロ埋め |
| recipient_name_kana | 30 | 右空白埋め |
| amount | 10 | 数字、左ゼロ埋め |
| new_code | 1 | `1` または `0` |
| customer_code | 20 | 右空白埋め |
| filler | 43 | 空白 |

合計120文字。

### 3. トレーラレコード

| 項目 | 長さ | 仕様 |
|---|---:|---|
| record_type | 1 | 固定値 `8` |
| total_count | 6 | データ件数、左ゼロ埋め |
| total_amount | 12 | 金額合計、左ゼロ埋め |
| filler | 101 | 空白 |

### 4. エンドレコード

| 項目 | 長さ | 仕様 |
|---|---:|---|
| record_type | 1 | 固定値 `9` |
| filler | 119 | 空白 |

## カナ項目の仕様

- `client_name_kana` と `recipient_name_kana` は最終的に**半角カタカナ中心の文字列**として出力すること
- 入力には以下が来てもよい
  - 全角カタカナ
  - 半角カタカナ
  - ひらがな
  - ASCII英数字
  - 記号 `(` `)` `-` `.` `&` `/` 空白
- 可能な範囲で次へ正規化すること
  - ひらがな → カタカナ
  - 全角カタカナ → 半角カタカナ
  - 英字 → 大文字ASCII
- 固定長欄に入らない場合はエラー
- 変換不能文字が残る場合はエラー

## バリデーション

- `transfers` は1件以上必須
- `amount` は 1 以上 9,999,999,999 以下
- コード類は数字のみで規定桁数以内
- `new_code` は `0` または `1`
- `account_type` は `ordinary`, `current`, `savings` のみ
- バリデーションエラー時は、どのフィールドが不正か分かるメッセージを出すこと

## previewモード

`--format preview` 指定時は、固定長テキストではなく以下のように表示すること。

```text
[HEADER]
record_type        : 1
service_code       : 21
file_creation_date : 20260310
...

[DATA #1]
record_type        : 2
bank_code          : 0005
...
```

## 実装要件

- レコード組み立てロジックを関数として分離すること
- テキスト出力モードとpreviewモードを切り替えられること
- `pytest` で実行できるテストを作成すること
- 正常系では、各行が必ず120文字であることをテストすること
- `shift_jis` 出力時にPython標準ライブラリのエンコーディングで書き出すこと

## テストで必ずカバーすること

- ヘッダ/データ/トレーラ/エンドの各レコード長
- 左ゼロ埋めと右空白埋め
- `account_type` の変換
- カナ正規化（ひらがな・全角カナ → 半角カナ）
- 金額合計の計算
- 変換不能文字のエラー
- `preview` モードの出力
- `utf-8` と `shift_jis` の書き出し

## 制約

- Python標準ライブラリのみ使用すること
- これは簡易版仕様であり、ここに書かれていない本物の全銀仕様対応は不要
- `python zengin.py ...` で実行できるようにすること
