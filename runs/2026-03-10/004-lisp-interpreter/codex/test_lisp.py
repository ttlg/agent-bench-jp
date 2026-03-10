import subprocess
import sys
from pathlib import Path

import pytest

import lisp


ROOT = Path(__file__).resolve().parent
LISP_PY = ROOT / "lisp.py"


def evaluate(source: str, env: lisp.Env | None = None):
    return lisp.eval_program(source, env or lisp.standard_env())


def test_basic_data_types_and_literals():
    env = lisp.standard_env()
    assert evaluate("42", env) == 42
    assert evaluate("3.14", env) == pytest.approx(3.14)
    assert evaluate('"hello"', env) == "hello"
    assert evaluate("#t", env) is True
    assert evaluate("#f", env) is False
    assert evaluate("nil", env) == []
    assert evaluate("'()", env) == []
    assert evaluate("(quote foo)", env) == lisp.Symbol("foo")
    assert evaluate("'(1 2 3)", env) == [1, 2, 3]


def test_arithmetic_comparison_and_logic():
    env = lisp.standard_env()
    assert evaluate("(+ 1 2 3)", env) == 6
    assert evaluate("(- 10 3)", env) == 7
    assert evaluate("(* 2 3 4)", env) == 24
    assert evaluate("(/ 10 4)", env) == pytest.approx(2.5)
    assert evaluate("(modulo 10 3)", env) == 1
    assert evaluate("(= 1 1)", env) is True
    assert evaluate("(< 1 2)", env) is True
    assert evaluate("(> 2 1)", env) is True
    assert evaluate("(<= 1 1)", env) is True
    assert evaluate("(>= 2 1)", env) is True
    assert evaluate("(and #t #t 1)", env) == 1
    assert evaluate("(and #t #f 1)", env) is False
    assert evaluate("(or #f #f 9)", env) == 9
    assert evaluate("(not #t)", env) is False


def test_define_lambda_if_cond_let_and_let_star():
    env = lisp.standard_env()
    program = """
    (begin
      (define x 42)
      (define (square n) (* n n))
      (define y (if (> x 0) "positive" "non-positive"))
      (define z
        (cond
          ((< x 0) "negative")
          ((= x 0) "zero")
          (else "positive")))
      (define a (let ((x 1) (y 2)) (+ x y)))
      (define b (let* ((x 1) (y (+ x 1))) (+ x y)))
      (list x (square 5) y z a b))
    """
    assert evaluate(program, env) == [42, 25, "positive", "positive", 3, 3]


def test_list_operations():
    env = lisp.standard_env()
    assert evaluate("(cons 1 '(2 3))", env) == [1, 2, 3]
    assert evaluate("(car '(1 2 3))", env) == 1
    assert evaluate("(cdr '(1 2 3))", env) == [2, 3]
    assert evaluate("(list 1 2 3)", env) == [1, 2, 3]
    assert evaluate("(length '(1 2 3))", env) == 3
    assert evaluate("(append '(1 2) '(3 4))", env) == [1, 2, 3, 4]
    assert evaluate("(map (lambda (x) (* x 2)) '(1 2 3))", env) == [2, 4, 6]
    assert evaluate("(filter (lambda (x) (> x 2)) '(1 2 3 4))", env) == [3, 4]
    assert evaluate("(null? '())", env) is True
    assert evaluate("(pair? '(1 2))", env) is True
    assert evaluate("(list? '(1 2))", env) is True


def test_string_operations_and_output(capsys):
    env = lisp.standard_env()
    assert evaluate('(string-length "hello")', env) == 5
    assert evaluate('(string-append "hello" " " "world")', env) == "hello world"
    assert evaluate('(substring "hello" 1 3)', env) == "el"
    assert evaluate('(string->number "42")', env) == 42
    assert evaluate("(number->string 42)", env) == "42"
    evaluate('(begin (display "hello") (newline) (print \'(1 2 3)))', env)
    captured = capsys.readouterr()
    assert captured.out == 'hello\n(1 2 3)\n'


def test_closure_make_counter():
    program = """
    (begin
      (define (make-counter)
        (let ((count 0))
          (lambda ()
            (set! count (+ count 1))
            count)))
      (define c (make-counter))
      (list (c) (c) (c)))
    """
    assert evaluate(program) == [1, 2, 3]


def test_tail_call_optimization_handles_large_recursion():
    program = """
    (begin
      (define (loop n)
        (if (= n 0)
            "done"
            (loop (- n 1))))
      (loop 100000))
    """
    assert evaluate(program) == "done"


def test_macro_and_quasiquote():
    program = """
    (begin
      (define-macro (when test . body)
        `(if ,test (begin ,@body)))
      (define-macro (unless test . body)
        `(if (not ,test) (begin ,@body)))
      (define x 0)
      (when #t
        (set! x 10))
      (unless #f
        (set! x (+ x 5)))
      x)
    """
    assert evaluate(program) == 15


def test_file_execution(tmp_path):
    program = tmp_path / "sample.lisp"
    program.write_text('(begin (display "file-ok") (newline))', encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(LISP_PY), str(program)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert result.stdout == "file-ok\n"
    assert result.stderr == ""


def test_repl_recovers_after_error():
    result = subprocess.run(
        [sys.executable, str(LISP_PY)],
        cwd=ROOT,
        input="(car 1)\n(+ 1 2)\n(exit)\n",
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "lisp> " in result.stdout
    assert "Error:" in result.stdout
    assert "3" in result.stdout
