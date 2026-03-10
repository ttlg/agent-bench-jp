# タスク: Lispインタプリタ

Pythonで、Scheme風のLispインタプリタをREPL付きで実装してください。

## 要件

- コマンド: `python lisp.py` でREPLが起動
- ファイル実行: `python lisp.py <ファイル.lisp>` でファイルを実行
- 単一ファイル `lisp.py` で完結させること

## 対応するデータ型

- 整数（`42`）
- 浮動小数点数（`3.14`）
- 文字列（`"hello"`）
- ブーリアン（`#t`, `#f`）
- シンボル（`foo`, `+`, `list?`）
- リスト（`(1 2 3)`）
- nil（`'()` または `nil`）

## 対応する特殊形式

```scheme
;; 変数定義
(define x 42)
(define pi 3.14)

;; 関数定義
(define (square x) (* x x))
(define (factorial n)
  (if (<= n 1) 1 (* n (factorial (- n 1)))))

;; 無名関数
(lambda (x y) (+ x y))
((lambda (x) (* x x)) 5)  ; => 25

;; 条件分岐
(if (> x 0) "positive" "non-positive")
(cond
  ((< x 0) "negative")
  ((= x 0) "zero")
  (else "positive"))

;; 局所束縛
(let ((x 1) (y 2)) (+ x y))
(let* ((x 1) (y (+ x 1))) (+ x y))

;; 逐次実行
(begin
  (define x 1)
  (define y 2)
  (+ x y))

;; クォート
(quote (1 2 3))
'(1 2 3)

;; 代入
(set! x 100)
```

## 組み込み関数

### 算術演算
```scheme
(+ 1 2 3)        ; => 6（可変長引数）
(- 10 3)          ; => 7
(* 2 3 4)         ; => 24
(/ 10 3)          ; => 3.333...
(modulo 10 3)     ; => 1
```

### 比較演算
```scheme
(= 1 1)           ; => #t
(< 1 2)           ; => #t
(> 2 1)           ; => #t
(<= 1 1)          ; => #t
(>= 2 1)          ; => #t
```

### 論理演算
```scheme
(and #t #f)        ; => #f
(or #f #t)         ; => #t
(not #t)           ; => #f
```

### リスト操作
```scheme
(cons 1 '(2 3))    ; => (1 2 3)
(car '(1 2 3))     ; => 1
(cdr '(1 2 3))     ; => (2 3)
(list 1 2 3)       ; => (1 2 3)
(length '(1 2 3))  ; => 3
(append '(1 2) '(3 4))  ; => (1 2 3 4)
(map (lambda (x) (* x 2)) '(1 2 3))  ; => (2 4 6)
(filter (lambda (x) (> x 2)) '(1 2 3 4))  ; => (3 4)
(null? '())        ; => #t
(pair? '(1 2))     ; => #t
(list? '(1 2))     ; => #t
```

### 文字列操作
```scheme
(string-length "hello")           ; => 5
(string-append "hello" " " "world")  ; => "hello world"
(substring "hello" 1 3)           ; => "el"
(string->number "42")             ; => 42
(number->string 42)               ; => "42"
```

### 表示
```scheme
(display "hello")   ; 改行なしで表示
(newline)           ; 改行
(print '(1 2 3))    ; 値を表示して改行
```

## クロージャ

クロージャが正しく動作すること:

```scheme
(define (make-counter)
  (let ((count 0))
    (lambda ()
      (set! count (+ count 1))
      count)))

(define c (make-counter))
(c)  ; => 1
(c)  ; => 2
(c)  ; => 3
```

## 末尾呼び出し最適化（TCO）

末尾位置の再帰呼び出しでスタックオーバーフローしないこと:

```scheme
(define (loop n)
  (if (= n 0) "done"
    (loop (- n 1))))

(loop 1000000)  ; => "done"（スタックオーバーフローしない）
```

## マクロ

`define-macro` による簡易マクロ:

```scheme
(define-macro (when test . body)
  `(if ,test (begin ,@body)))

(when #t
  (display "yes")
  (newline))

(define-macro (unless test . body)
  `(if (not ,test) (begin ,@body)))
```

- 準クォート（quasiquote）: `` ` ``
- アンクォート: `,`
- スプライシング・アンクォート: `,@`

## REPL

```
lisp> (+ 1 2)
3
lisp> (define (fib n) (if (<= n 1) n (+ (fib (- n 1)) (fib (- n 2)))))
lisp> (fib 10)
55
lisp> (exit)
```

- プロンプト: `lisp> `
- 複数行入力: 括弧が閉じるまで入力を待つ
- エラー時はメッセージを表示してREPLを継続（クラッシュしない）
- `(exit)` または Ctrl+D で終了

## テスト

- `pytest` で実行できるテストを作成すること（`test_lisp.py`）
- 以下をカバーするテスト:
  - 基本データ型とリテラル
  - 算術・比較・論理演算
  - define, lambda, if, cond, let, let*
  - リスト操作（cons, car, cdr, map, filter）
  - クロージャ（make-counter パターン）
  - 末尾呼び出し最適化（大きなnでスタックオーバーフローしない）
  - マクロ（define-macro, quasiquote）
  - エラーハンドリング（不正な式でクラッシュしない）

## 制約

- Python標準ライブラリのみ使用すること（外部パッケージ不可）
- `lisp.py` 単一ファイルで実装すること
- `pip install pytest` 後に `pytest test_lisp.py` で全テスト実行できること
