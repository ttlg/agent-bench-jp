import io
import subprocess
import sys
from pathlib import Path

import lisp


def eval_code(source, out=None):
    env = lisp.standard_env(out or io.StringIO())
    evaluator = lisp.Evaluator(env)
    return lisp.run(source, evaluator=evaluator)


def test_basic_types_and_quote():
    assert eval_code("42") == 42
    assert eval_code("3.5") == 3.5
    assert eval_code('"abc"') == "abc"
    assert eval_code("#t") is True
    assert eval_code("nil") is lisp.nil
    assert eval_code("'(1 2 foo)") == [1, 2, lisp.Symbol("foo")]


def test_special_forms_and_closure():
    source = """
    (begin
      (define (make-counter start)
        (let ((n start))
          (lambda ()
            (begin
              (set! n (+ n 1))
              n))))
      (define c (make-counter 10))
      (list (c) (c) (c)))
    """
    assert eval_code(source) == [11, 12, 13]


def test_cond_let_and_let_star():
    source = """
    (begin
      (define x 3)
      (list
        (cond ((> x 3) 0) ((= x 3) 1) (else 2))
        (let ((a 1) (b 2)) (+ a b))
        (let* ((a 2) (b (+ a 3))) (* a b))))
    """
    assert eval_code(source) == [1, 3, 10]


def test_builtins_and_strings():
    source = """
    (begin
      (list
        (+ 1 2 3)
        (modulo 10 3)
        (and #t 1 2)
        (or #f nil 5)
        (not #f)
        (car (list 7 8))
        (cdr (list 7 8 9))
        (append (list 1 2) (list 3 4))
        (map (lambda (x) (* x 2)) (list 1 2 3))
        (filter (lambda (x) (> x 1)) (list 1 2 3))
        (string-length "abcd")
        (string-append "a" "b" "c")
        (substring "abcdef" 1 4)
        (string->number "12")
        (number->string 34)))
    """
    assert eval_code(source) == [
        6,
        1,
        2,
        5,
        True,
        7,
        [8, 9],
        [1, 2, 3, 4],
        [2, 4, 6],
        [2, 3],
        4,
        "abc",
        "bcd",
        12,
        "34",
    ]


def test_quasiquote_and_macro():
    source = """
    (begin
      (define-macro (when test . body)
        `(if ,test (begin ,@body) nil))
      (define x 0)
      (when #t
        (set! x 7)
        (set! x (+ x 1)))
      x)
    """
    assert eval_code(source) == 8


def test_simple_macro_with_fixed_arity():
    source = """
    (begin
      (define-macro (unless test expr)
        `(if ,test nil ,expr))
      (define x 1)
      (unless #f (set! x 9))
      x)
    """
    assert eval_code(source) == 9


def test_tail_call_optimization():
    source = """
    (begin
      (define (loop n acc)
        (if (= n 0)
            acc
            (loop (- n 1) (+ acc 1))))
      (loop 5000 0))
    """
    assert eval_code(source) == 5000


def test_display_print_and_newline():
    out = io.StringIO()
    eval_code('(begin (display "hi") (newline) (print (list 1 2)))', out)
    assert out.getvalue() == 'hi\n(1 2)\n'


def test_file_execution(tmp_path):
    program = tmp_path / "sample.lisp"
    program.write_text('(begin (print (+ 1 2)) (print "ok"))', encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("lisp.py")), str(program)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert proc.stdout == "3\n\"ok\"\n"


def test_repl_exit():
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("lisp.py"))],
        input="(exit)\n",
        capture_output=True,
        text=True,
        check=True,
    )
    assert "lisp> " in proc.stdout
