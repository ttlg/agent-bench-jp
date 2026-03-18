import io
import subprocess
import sys
import textwrap
from contextlib import redirect_stdout
from pathlib import Path

import pytest

import lisp


def run_expr(source: str, env=None):
    if env is None:
        env = lisp.standard_env()
    return lisp.eval_program(textwrap.dedent(source), env)


def fmt(value):
    return lisp.format_value(value)


def test_basic_literals_and_types():
    env = lisp.standard_env()
    assert fmt(run_expr("42", env)) == "42"
    assert fmt(run_expr("3.14", env)) == "3.14"
    assert fmt(run_expr('"hello"', env)) == '"hello"'
    assert fmt(run_expr("#t", env)) == "#t"
    assert fmt(run_expr("#f", env)) == "#f"
    assert fmt(run_expr("'foo", env)) == "foo"
    assert isinstance(lisp.parse("foo")[0], lisp.Symbol)
    assert fmt(run_expr("'()", env)) == "()"
    assert fmt(run_expr("nil", env)) == "()"
    assert fmt(run_expr("'(1 2 3)", env)) == "(1 2 3)"


def test_arithmetic_comparison_and_logic():
    env = lisp.standard_env()
    assert fmt(run_expr("(+ 1 2 3)", env)) == "6"
    assert fmt(run_expr("(- 10 3)", env)) == "7"
    assert fmt(run_expr("(* 2 3 4)", env)) == "24"
    assert fmt(run_expr("(/ 10 4)", env)) == "2.5"
    assert fmt(run_expr("(modulo 10 3)", env)) == "1"
    assert fmt(run_expr("(= 1 1)", env)) == "#t"
    assert fmt(run_expr("(< 1 2)", env)) == "#t"
    assert fmt(run_expr("(> 2 1)", env)) == "#t"
    assert fmt(run_expr("(<= 1 1)", env)) == "#t"
    assert fmt(run_expr("(>= 2 1)", env)) == "#t"
    assert fmt(run_expr("(and #t #f)", env)) == "#f"
    assert fmt(run_expr("(or #f #t)", env)) == "#t"
    assert fmt(run_expr("(not #t)", env)) == "#f"


def test_define_lambda_if_cond_let_and_let_star():
    env = lisp.standard_env()
    assert run_expr("(define x 42)", env) is None
    assert fmt(run_expr("x", env)) == "42"
    assert run_expr("(define (square x) (* x x))", env) is None
    assert fmt(run_expr("(square 5)", env)) == "25"
    assert fmt(run_expr('(if (> x 0) "positive" "non-positive")', env)) == '"positive"'
    assert fmt(run_expr('(cond ((< x 0) "negative") ((= x 42) "answer") (else "other"))', env)) == '"answer"'
    assert fmt(run_expr("(let ((x 1) (y 2)) (+ x y))", env)) == "3"
    assert fmt(run_expr("(let* ((x 1) (y (+ x 1))) (+ x y))", env)) == "3"


def test_list_operations_and_strings():
    env = lisp.standard_env()
    assert fmt(run_expr("(cons 1 '(2 3))", env)) == "(1 2 3)"
    assert fmt(run_expr("(car '(1 2 3))", env)) == "1"
    assert fmt(run_expr("(cdr '(1 2 3))", env)) == "(2 3)"
    assert fmt(run_expr("(list 1 2 3)", env)) == "(1 2 3)"
    assert fmt(run_expr("(length '(1 2 3))", env)) == "3"
    assert fmt(run_expr("(append '(1 2) '(3 4))", env)) == "(1 2 3 4)"
    assert fmt(run_expr("(map (lambda (x) (* x 2)) '(1 2 3))", env)) == "(2 4 6)"
    assert fmt(run_expr("(filter (lambda (x) (> x 2)) '(1 2 3 4))", env)) == "(3 4)"
    assert fmt(run_expr('(string-length "hello")', env)) == "5"
    assert fmt(run_expr('(string-append "hello" " " "world")', env)) == '"hello world"'
    assert fmt(run_expr('(substring "hello" 1 3)', env)) == '"el"'
    assert fmt(run_expr('(string->number "42")', env)) == "42"
    assert fmt(run_expr("(number->string 42)", env)) == '"42"'


def test_display_newline_and_print():
    env = lisp.standard_env()
    out = io.StringIO()
    with redirect_stdout(out):
        run_expr('(begin (display "hello") (newline) (print \'(1 2 3)))', env)
    assert out.getvalue() == 'hello\n(1 2 3)\n'


def test_closure_counter_pattern():
    env = lisp.standard_env()
    source = """
    (define (make-counter)
      (let ((count 0))
        (lambda ()
          (set! count (+ count 1))
          count)))

    (define c (make-counter))
    (c)
    (c)
    (c)
    """
    assert fmt(run_expr(source, env)) == "3"


def test_tco_large_tail_recursion():
    env = lisp.standard_env()
    source = """
    (define (loop n)
      (if (= n 0) "done"
        (loop (- n 1))))

    (loop 100000)
    """
    assert fmt(run_expr(source, env)) == '"done"'


def test_define_macro_and_quasiquote():
    env = lisp.standard_env()
    source = """
    (define-macro (when test . body)
      `(if ,test (begin ,@body)))

    (define x 0)
    (when #t
      (set! x 7))
    x
    """
    assert fmt(run_expr(source, env)) == "7"


def test_repl_continues_after_error():
    script = Path(__file__).with_name("lisp.py")
    proc = subprocess.run(
        [sys.executable, str(script)],
        input="(car 1)\n(+ 1 2)\n(exit)\n",
        text=True,
        capture_output=True,
        check=False,
    )
    assert proc.returncode == 0
    assert "error:" in proc.stderr
    assert "3" in proc.stdout


def test_file_execution(tmp_path):
    script = Path(__file__).with_name("lisp.py")
    path = tmp_path / "program.lisp"
    path.write_text("(define x 1)\n(print (+ x 41))\n", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(script), str(path)],
        text=True,
        capture_output=True,
        check=False,
    )
    assert proc.returncode == 0
    assert proc.stdout.strip().endswith("42")


def test_invalid_expression_raises_lisp_error():
    env = lisp.standard_env()
    with pytest.raises(lisp.LispError):
        run_expr("(car 1)", env)
