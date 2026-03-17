import pytest
from lisp import tokenize, parse, eval_lisp, standard_env

def run_code(code):
    env = standard_env()
    tokens = tokenize(code)
    res = None
    while tokens:
        res = eval_lisp(parse(tokens), env)
    return res

def test_primitives():
    assert run_code("42") == 42
    assert run_code("3.14") == 3.14
    assert run_code('"hello"') == "hello"
    assert run_code("#t") is True
    assert run_code("#f") is False
    assert run_code("'foo") == "foo"

def test_arithmetic():
    assert run_code("(+ 1 2 3)") == 6
    assert run_code("(- 10 3)") == 7
    assert run_code("(* 2 3 4)") == 24
    assert run_code("(/ 10 2)") == 5.0
    assert run_code("(modulo 10 3)") == 1

def test_comparison():
    assert run_code("(= 1 1)") is True
    assert run_code("(< 1 2)") is True
    assert run_code("(> 2 1)") is True
    assert run_code("(<= 1 1)") is True
    assert run_code("(>= 2 1)") is True

def test_logic():
    assert run_code("(and #t #f)") is False
    assert run_code("(or #f #t)") is True
    assert run_code("(not #t)") is False

def test_list_operations():
    assert run_code("(cons 1 '(2 3))") == [1, 2, 3]
    assert run_code("(car '(1 2 3))") == 1
    assert run_code("(cdr '(1 2 3))") == [2, 3]
    assert run_code("(list 1 2 3)") == [1, 2, 3]
    assert run_code("(length '(1 2 3))") == 3
    assert run_code("(append '(1 2) '(3 4))") == [1, 2, 3, 4]
    assert run_code("(null? '())") is True
    assert run_code("(pair? '(1 2))") is True
    assert run_code("(list? '(1 2))") is True

def test_map_filter():
    assert run_code("(map (lambda (x) (* x 2)) '(1 2 3))") == [2, 4, 6]
    assert run_code("(filter (lambda (x) (> x 2)) '(1 2 3 4))") == [3, 4]

def test_define_lambda():
    assert run_code("(begin (define (square x) (* x x)) (square 5))") == 25
    assert run_code("((lambda (x y) (+ x y)) 3 4)") == 7

def test_conditionals():
    assert run_code('(if (> 2 1) "positive" "non-positive")') == "positive"
    assert run_code('(cond ((< 1 0) "negative") ((= 1 0) "zero") (else "positive"))') == "positive"

def test_let():
    assert run_code("(let ((x 1) (y 2)) (+ x y))") == 3
    assert run_code("(let* ((x 1) (y (+ x 1))) (+ x y))") == 3

def test_closure():
    code = """
    (begin
      (define (make-counter)
        (let ((count 0))
          (lambda ()
            (set! count (+ count 1))
            count)))
      (define c (make-counter))
      (c)
      (c)
      (c))
    """
    assert run_code(code) == 3

def test_tco():
    code = """
    (begin
      (define (loop n)
        (if (= n 0) "done"
          (loop (- n 1))))
      (loop 10000))
    """
    assert run_code(code) == "done"

def test_macro():
    code = """
    (begin
      (define-macro (when test . body)
        `(if ,test (begin ,@body)))
      (when #t 1 2 3))
    """
    assert run_code(code) == 3

def test_string_operations():
    assert run_code('(string-length "hello")') == 5
    assert run_code('(string-append "hello" " " "world")') == "hello world"
    assert run_code('(substring "hello" 1 3)') == "el"
    assert run_code('(string->number "42")') == 42
    assert run_code('(number->string 42)') == "42"

def test_error_handling():
    with pytest.raises(Exception):
        run_code("(+ 1 'a)")
