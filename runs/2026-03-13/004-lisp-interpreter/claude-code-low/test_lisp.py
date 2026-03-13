"""Tests for the Lisp interpreter."""

import pytest
import sys
from lisp import (
    parse, eval_expr, standard_env, run, lisp_str,
    Env, Symbol, Procedure, NIL, Nil, _make_filter,
)


def make_env():
    env = standard_env()
    env[Symbol('filter')] = _make_filter()
    return env


def ev(source, env=None):
    if env is None:
        env = make_env()
    exprs = parse(source)
    result = None
    for expr in exprs:
        result = eval_expr(expr, env)
    return result


# --- Data types ---

class TestDataTypes:
    def test_integer(self):
        assert ev("42") == 42

    def test_float(self):
        assert ev("3.14") == 3.14

    def test_string(self):
        assert ev('"hello"') == "hello"

    def test_boolean_true(self):
        assert ev("#t") is True

    def test_boolean_false(self):
        assert ev("#f") is False

    def test_symbol(self):
        env = make_env()
        ev("(define x 10)", env)
        assert ev("x", env) == 10

    def test_list(self):
        assert ev("'(1 2 3)") == [1, 2, 3]

    def test_nil(self):
        result = ev("'()")
        assert result == [] or isinstance(result, Nil)


# --- Arithmetic ---

class TestArithmetic:
    def test_add(self):
        assert ev("(+ 1 2 3)") == 6

    def test_sub(self):
        assert ev("(- 10 3)") == 7

    def test_mul(self):
        assert ev("(* 2 3 4)") == 24

    def test_div(self):
        assert abs(ev("(/ 10 3)") - 3.333333) < 0.001

    def test_modulo(self):
        assert ev("(modulo 10 3)") == 1


# --- Comparison ---

class TestComparison:
    def test_eq(self):
        assert ev("(= 1 1)") is True

    def test_lt(self):
        assert ev("(< 1 2)") is True

    def test_gt(self):
        assert ev("(> 2 1)") is True

    def test_le(self):
        assert ev("(<= 1 1)") is True

    def test_ge(self):
        assert ev("(>= 2 1)") is True


# --- Logic ---

class TestLogic:
    def test_and_false(self):
        assert ev("(and #t #f)") is False

    def test_and_true(self):
        assert ev("(and #t #t)") is True

    def test_or(self):
        result = ev("(or #f #t)")
        assert result is True or result is not False

    def test_not(self):
        assert ev("(not #t)") is False
        assert ev("(not #f)") is True


# --- Define, Lambda, If ---

class TestSpecialForms:
    def test_define_variable(self):
        env = make_env()
        ev("(define x 42)", env)
        assert ev("x", env) == 42

    def test_define_function(self):
        env = make_env()
        ev("(define (square x) (* x x))", env)
        assert ev("(square 5)", env) == 25

    def test_lambda(self):
        assert ev("((lambda (x) (* x x)) 5)") == 25

    def test_if_true(self):
        assert ev('(if (> 3 0) "positive" "negative")') == "positive"

    def test_if_false(self):
        assert ev('(if (> 0 3) "positive" "negative")') == "negative"

    def test_cond(self):
        code = """
        (cond
          ((< 5 0) "negative")
          ((= 5 0) "zero")
          (else "positive"))
        """
        assert ev(code) == "positive"

    def test_let(self):
        assert ev("(let ((x 1) (y 2)) (+ x y))") == 3

    def test_let_star(self):
        assert ev("(let* ((x 1) (y (+ x 1))) (+ x y))") == 3

    def test_begin(self):
        env = make_env()
        result = ev("(begin (define x 1) (define y 2) (+ x y))", env)
        assert result == 3

    def test_set_bang(self):
        env = make_env()
        ev("(define x 1)", env)
        ev("(set! x 100)", env)
        assert ev("x", env) == 100


# --- List operations ---

class TestListOps:
    def test_cons(self):
        assert ev("(cons 1 '(2 3))") == [1, 2, 3]

    def test_car(self):
        assert ev("(car '(1 2 3))") == 1

    def test_cdr(self):
        result = ev("(cdr '(1 2 3))")
        assert result == [2, 3]

    def test_list(self):
        assert ev("(list 1 2 3)") == [1, 2, 3]

    def test_length(self):
        assert ev("(length '(1 2 3))") == 3

    def test_append(self):
        assert ev("(append '(1 2) '(3 4))") == [1, 2, 3, 4]

    def test_map(self):
        assert ev("(map (lambda (x) (* x 2)) '(1 2 3))") == [2, 4, 6]

    def test_filter(self):
        assert ev("(filter (lambda (x) (> x 2)) '(1 2 3 4))") == [3, 4]

    def test_null(self):
        assert ev("(null? '())") is True

    def test_pair(self):
        assert ev("(pair? '(1 2))") is True

    def test_list_pred(self):
        assert ev("(list? '(1 2))") is True


# --- String operations ---

class TestStringOps:
    def test_string_length(self):
        assert ev('(string-length "hello")') == 5

    def test_string_append(self):
        assert ev('(string-append "hello" " " "world")') == "hello world"

    def test_substring(self):
        assert ev('(substring "hello" 1 3)') == "el"

    def test_string_to_number(self):
        assert ev('(string->number "42")') == 42

    def test_number_to_string(self):
        assert ev('(number->string 42)') == "42"


# --- Closures ---

class TestClosures:
    def test_make_counter(self):
        env = make_env()
        ev("""
        (define (make-counter)
          (let ((count 0))
            (lambda ()
              (set! count (+ count 1))
              count)))
        """, env)
        ev("(define c (make-counter))", env)
        assert ev("(c)", env) == 1
        assert ev("(c)", env) == 2
        assert ev("(c)", env) == 3

    def test_closure_captures_env(self):
        env = make_env()
        ev("""
        (define (make-adder n)
          (lambda (x) (+ n x)))
        """, env)
        ev("(define add5 (make-adder 5))", env)
        assert ev("(add5 10)", env) == 15


# --- TCO ---

class TestTCO:
    def test_tail_recursion(self):
        env = make_env()
        ev("""
        (define (loop n)
          (if (= n 0) "done"
            (loop (- n 1))))
        """, env)
        assert ev("(loop 1000000)", env) == "done"

    def test_factorial(self):
        env = make_env()
        ev("""
        (define (factorial n)
          (if (<= n 1) 1 (* n (factorial (- n 1)))))
        """, env)
        assert ev("(factorial 10)", env) == 3628800


# --- Macros ---

class TestMacros:
    def test_define_macro_when(self):
        env = make_env()
        ev("""
        (define-macro (when test . body)
          (list 'if test (cons 'begin body)))
        """, env)
        ev("(define result 0)", env)
        ev("(when #t (set! result 42))", env)
        assert ev("result", env) == 42

    def test_define_macro_unless(self):
        env = make_env()
        ev("""
        (define-macro (unless test . body)
          (list 'if (list 'not test) (cons 'begin body)))
        """, env)
        ev("(define result 0)", env)
        ev("(unless #f (set! result 99))", env)
        assert ev("result", env) == 99

    def test_quasiquote(self):
        env = make_env()
        ev("(define x 42)", env)
        result = ev("`(a ,x c)", env)
        assert result == [Symbol('a'), 42, Symbol('c')]

    def test_quasiquote_splicing(self):
        env = make_env()
        ev("(define xs '(1 2 3))", env)
        result = ev("`(a ,@xs b)", env)
        assert result == [Symbol('a'), 1, 2, 3, Symbol('b')]


# --- Error handling ---

class TestErrorHandling:
    def test_undefined_variable(self):
        with pytest.raises(NameError):
            ev("undefined_var")

    def test_not_callable(self):
        with pytest.raises(TypeError):
            ev("(42)")

    def test_missing_paren(self):
        with pytest.raises(SyntaxError):
            ev("(+ 1 2")

    def test_extra_paren(self):
        with pytest.raises(SyntaxError):
            ev(")")


# --- Quote ---

class TestQuote:
    def test_quote(self):
        assert ev("(quote (1 2 3))") == [1, 2, 3]

    def test_quote_shorthand(self):
        assert ev("'(1 2 3)") == [1, 2, 3]

    def test_quote_symbol(self):
        result = ev("'foo")
        assert isinstance(result, Symbol) and result == "foo"
