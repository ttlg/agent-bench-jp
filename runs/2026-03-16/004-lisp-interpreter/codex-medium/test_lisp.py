import subprocess
import sys
import tempfile
from pathlib import Path

import lisp


def eval_one(source, env=None):
    result, env = lisp.run(source, env)
    return result, env


def test_basic_types_and_quote():
    result, _ = eval_one('(list 1 2.5 "x" #t #f nil \'abc)')
    assert result == [1, 2.5, "x", True, False, lisp.nil, lisp.Symbol("abc")]


def test_define_lambda_and_closure_counter():
    program = """
    (begin
      (define make-counter
        (lambda ()
          (let ((n 0))
            (lambda ()
              (begin
                (set! n (+ n 1))
                n)))))
      (define c (make-counter))
      (list (c) (c) (c)))
    """
    result, _ = eval_one(program)
    assert result == [1, 2, 3]


def test_cond_let_let_star():
    program = """
    (begin
      (define x 3)
      (list
        (cond ((< x 0) "neg")
              ((= x 3) "three")
              (else "other"))
        (let ((a 2) (b 5)) (+ a b))
        (let* ((a 2) (b (+ a 3))) b)))
    """
    result, _ = eval_one(program)
    assert result == ["three", 7, 5]


def test_list_and_string_builtins():
    program = """
    (begin
      (list
        (cons 1 (list 2 3))
        (car (list 4 5))
        (cdr (list 4 5 6))
        (length (append (list 1) (list 2 3)))
        (map (lambda (x) (* x 2)) (list 1 2 3))
        (filter (lambda (x) (> x 1)) (list 1 2 3))
        (string-length "hello")
        (string-append "ab" "cd")
        (substring "hello" 1 4)
        (string->number "12.5")
        (number->string 42)))
    """
    result, _ = eval_one(program)
    assert result == [
        [1, 2, 3],
        4,
        [5, 6],
        3,
        [2, 4, 6],
        [2, 3],
        5,
        "abcd",
        "ell",
        12.5,
        "42",
    ]


def test_define_macro_and_quasiquote():
    program = """
    (begin
      (define-macro (when test . body)
        `(if ,test (begin ,@body) nil))
      (define x 0)
      (when #t
        (set! x 10)
        (set! x (+ x 2)))
      x)
    """
    result, _ = eval_one(program)
    assert result == 12


def test_tail_call_optimization():
    program = """
    (begin
      (define (countdown n acc)
        (if (= n 0)
            acc
            (countdown (- n 1) (+ acc 1))))
      (countdown 5000 0))
    """
    result, _ = eval_one(program)
    assert result == 5000


def test_file_execution():
    program = '(begin (define x 1) (print (+ x 2)))'
    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = Path(tmpdir) / "prog.lisp"
        file_path.write_text(program, encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("lisp.py")), str(file_path)],
            capture_output=True,
            text=True,
            check=True,
        )
    assert proc.stdout.strip() == "3"


def test_repl_exit_command():
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("lisp.py"))],
        input="(exit)\n",
        capture_output=True,
        text=True,
        check=True,
    )
    assert "lisp> " in proc.stdout


def test_error_does_not_break_repl():
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("lisp.py"))],
        input="(car nil)\n(+ 1 2)\n(exit)\n",
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Error:" in proc.stderr
    assert "3" in proc.stdout


if __name__ == "__main__":
    tests = [
        obj
        for name, obj in globals().items()
        if name.startswith("test_") and callable(obj)
    ]
    for test in tests:
        test()
    print(f"{len(tests)} tests passed")
