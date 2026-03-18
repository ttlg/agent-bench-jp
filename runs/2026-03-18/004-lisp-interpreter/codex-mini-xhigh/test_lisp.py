import subprocess
import sys
from pathlib import Path

import pytest

import lisp


SCRIPT = Path(__file__).with_name("lisp.py")


def eval_code(source, env=None):
    return lisp.run_source(source, env=env or lisp.standard_env())


def test_basic_literals_and_strings():
    assert eval_code("42") == 42
    assert eval_code("3.14") == pytest.approx(3.14)
    assert eval_code('"hello"') == "hello"
    assert eval_code("#t") is True
    assert eval_code("#f") is False
    assert eval_code("nil") == []
    assert eval_code("'()") == []
    assert eval_code("'(1 2 3)") == [1, 2, 3]
    assert eval_code('(string-length "hello")') == 5
    assert eval_code('(string-append "hello" " " "world")') == "hello world"
    assert eval_code('(substring "hello" 1 3)') == "el"
    assert eval_code('(string->number "42")') == 42
    assert eval_code('(number->string 42)') == "42"


@pytest.mark.parametrize(
    "source, expected",
    [
        ("(+ 1 2 3)", 6),
        ("(- 10 3)", 7),
        ("(* 2 3 4)", 24),
        ("(/ 10 4)", 2.5),
        ("(modulo 10 3)", 1),
        ("(= 1 1)", True),
        ("(< 1 2)", True),
        ("(> 2 1)", True),
        ("(<= 1 1)", True),
        ("(>= 2 1)", True),
        ("(and #t #f)", False),
        ("(or #f #t)", True),
        ("(not #t)", False),
    ],
)
def test_arithmetic_comparison_and_logic(source, expected):
    assert eval_code(source) == expected


def test_define_lambda_if_cond_let_and_let_star():
    source = """
    (define x 10)
    (define pi 3.14)
    (define (square x) (* x x))
    (define (factorial n)
      (if (<= n 1) 1 (* n (factorial (- n 1)))))
    (list
      x
      pi
      (square 5)
      (factorial 5)
      ((lambda (a b) (+ a b)) 1 2)
      (if (> x 0) "positive" "non-positive")
      (cond
        ((< x 0) "negative")
        ((= x 0) "zero")
        (else "positive"))
      (let ((a 1) (b 2)) (+ a b))
      (let* ((a 1) (b (+ a 1))) (+ a b)))
    """
    assert eval_code(source) == [10, 3.14, 25, 120, 3, "positive", "positive", 3, 3]


def test_list_operations():
    assert eval_code("(cons 1 '(2 3))") == [1, 2, 3]
    assert eval_code("(car '(1 2 3))") == 1
    assert eval_code("(cdr '(1 2 3))") == [2, 3]
    assert eval_code("(list 1 2 3)") == [1, 2, 3]
    assert eval_code("(length '(1 2 3))") == 3
    assert eval_code("(append '(1 2) '(3 4))") == [1, 2, 3, 4]
    assert eval_code("(map (lambda (x) (* x 2)) '(1 2 3))") == [2, 4, 6]
    assert eval_code("(filter (lambda (x) (> x 2)) '(1 2 3 4))") == [3, 4]
    assert eval_code("(null? '())") is True
    assert eval_code("(pair? '(1 2))") is True
    assert eval_code("(list? '(1 2))") is True


def test_closure_counter():
    source = """
    (define (make-counter)
      (let ((count 0))
        (lambda ()
          (set! count (+ count 1))
          count)))
    (define c (make-counter))
    (list (c) (c) (c))
    """
    assert eval_code(source) == [1, 2, 3]


def test_tail_call_optimization_large_n():
    source = """
    (define (loop n)
      (if (= n 0) "done"
        (loop (- n 1))))
    (loop 1000000)
    """
    assert eval_code(source) == "done"


def test_define_macro_and_quasiquote():
    source = """
    (define-macro (when test . body)
      `(if ,test (begin ,@body)))
    (define x 0)
    (when #t
      (set! x (+ x 1))
      (set! x (+ x 41)))
    x
    """
    assert eval_code(source) == 42


def test_error_handling():
    with pytest.raises(lisp.LispError):
        eval_code("(car 1)")

    with pytest.raises(lisp.LispError):
        eval_code("(+ 1 \"a\")")

    with pytest.raises(lisp.LispError):
        eval_code("(define x 1 2)")

    with pytest.raises(lisp.LispError):
        eval_code("(1 2)")

    with pytest.raises(lisp.LispError):
        eval_code("(+ 1 2")


def test_cli_file_execution(tmp_path):
    program = tmp_path / "prog.lisp"
    program.write_text('(display "ok")\n(newline)\n', encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), str(program)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    assert proc.stdout == "ok\n"
    assert proc.stderr == ""


def test_repl_multiline_and_error_recovery():
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input="(define (add2 x)\n  (+ x 2))\n(bad)\n(add2 3)\n(exit)\n",
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    assert "5" in proc.stdout
    assert "Error:" in proc.stderr
