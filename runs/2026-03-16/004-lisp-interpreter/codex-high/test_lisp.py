import io
import subprocess
import sys
from contextlib import redirect_stdout
from pathlib import Path

import lisp


ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "lisp.py"


def run(source):
    return lisp.evaluate_program(source)


def capture_output(source):
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        result = lisp.evaluate_program(source)
    return result, buffer.getvalue()


def test_arithmetic_comparison_and_logic():
    assert run("(+ 1 2 3)") == 6
    assert run("(- 10 3 2)") == 5
    assert run("(* 2 3 4)") == 24
    assert run("(/ 20 2 2)") == 5
    assert run("(modulo 20 6)") == 2
    assert run("(= 3 3 3)") is True
    assert run("(< 1 2 3)") is True
    assert run("(>= 3 3 2)") is True
    assert run("(and #t 1 2)") == 2
    assert run("(or #f #f 7)") == 7
    assert run("(not #f)") is True


def test_special_forms_and_scoping():
    source = """
    (define x 10)
    (define (adder y) (+ x y))
    (define result
      (begin
        (set! x 20)
        (if (> x 10)
            (cond
              ((= x 0) 0)
              ((= x 20) (let ((a 2) (b 3)) (+ a b x)))
              (else -1))
            -2)))
    (list result (adder 5) (let* ((a 1) (b (+ a 4))) b))
    """
    assert run(source) == [25, 25, 5]


def test_list_and_string_builtins():
    assert run("(cons 1 (list 2 3))") == [1, 2, 3]
    assert run("(car (list 9 8 7))") == 9
    assert run("(cdr (list 9 8 7))") == [8, 7]
    assert run("(append (list 1 2) (list 3 4))") == [1, 2, 3, 4]
    assert run("(map (lambda (x) (* x 2)) (list 1 2 3))") == [2, 4, 6]
    assert run("(filter (lambda (x) (> x 1)) (list 1 2 3))") == [2, 3]
    assert run('(string-length "hello")') == 5
    assert run('(string-append "he" "llo")') == "hello"
    assert run('(substring "abcdef" 1 4)') == "bcd"
    assert run('(string->number "42")') == 42
    assert run('(string->number "x")') is False
    assert run("(number->string 12.5)") == "12.5"


def test_display_newline_and_print():
    _, output = capture_output(
        """
        (display "hi")
        (newline)
        (print (list 1 2 3))
        """
    )
    assert output == 'hi\n(1 2 3)\n'


def test_quote_quasiquote_and_splicing():
    assert run("'(1 2 3)") == [1, 2, 3]
    assert run("`(1 ,(+ 1 1) ,@(list 3 4))") == [1, 2, 3, 4]
    assert run("nil") == []


def test_closure_make_counter():
    source = """
    (define (make-counter)
      (let ((n 0))
        (lambda ()
          (begin
            (set! n (+ n 1))
            n))))
    (define counter (make-counter))
    (list (counter) (counter) (counter))
    """
    assert run(source) == [1, 2, 3]


def test_tail_call_optimization():
    source = """
    (define (sum-down n acc)
      (if (= n 0)
          acc
          (sum-down (- n 1) (+ acc n))))
    (sum-down 5000 0)
    """
    assert run(source) == 12502500


def test_define_macro_expands_expression():
    source = """
    (define-macro (unless test body)
      `(if (not ,test) ,body nil))
    (unless #f (+ 1 2))
    """
    assert run(source) == 3


def test_file_execution(tmp_path):
    program = tmp_path / "sample.lisp"
    program.write_text('(print (+ 1 2 3))\n', encoding="utf-8")

    completed = subprocess.run(
        [sys.executable, str(SCRIPT), str(program)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0
    assert completed.stdout == "6\n"
    assert completed.stderr == ""


def test_repl_multiline_and_error_recovery():
    completed = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=ROOT,
        input="(+ 1\n 2)\n(car nil)\n(+ 3 4)\n(exit)\n",
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0
    assert "lisp> " in completed.stdout
    assert "3" in completed.stdout
    assert "7" in completed.stdout
    assert "Error: car expects a non-empty list" in completed.stderr
