"""Tests for the Lisp interpreter."""

import pytest
import sys
from lisp import (
    eval_expr, read, read_all, run_source, to_string,
    _make_global_env, Env, Symbol, NIL, Procedure, tokenize, _parse_expr,
)


def ev(source):
    """Helper: evaluate a source string and return the result."""
    env = _make_global_env()
    exprs = read_all(source)
    result = None
    for expr in exprs:
        result = eval_expr(expr, env)
    return result


def ev_env(source, env=None):
    """Helper: evaluate with a persistent env."""
    if env is None:
        env = _make_global_env()
    exprs = read_all(source)
    result = None
    for expr in exprs:
        result = eval_expr(expr, env)
    return result, env


# ---- Basic data types and literals ----

class TestDataTypes:
    def test_integer(self):
        assert ev("42") == 42

    def test_negative_integer(self):
        assert ev("-7") == -7

    def test_float(self):
        assert ev("3.14") == pytest.approx(3.14)

    def test_string(self):
        assert ev('"hello"') == "hello"

    def test_boolean_true(self):
        assert ev("#t") is True

    def test_boolean_false(self):
        assert ev("#f") is False

    def test_nil(self):
        assert ev("nil") == NIL

    def test_symbol(self):
        r = read("foo")
        assert isinstance(r, Symbol)

    def test_empty_list_quote(self):
        result = ev("'()")
        assert result == [] or result == NIL or result == ()

    def test_list_literal(self):
        assert ev("'(1 2 3)") == [1, 2, 3]


# ---- Arithmetic operations ----

class TestArithmetic:
    def test_add(self):
        assert ev("(+ 1 2 3)") == 6

    def test_add_zero_args(self):
        assert ev("(+ )") == 0

    def test_sub(self):
        assert ev("(- 10 3)") == 7

    def test_sub_negate(self):
        assert ev("(- 5)") == -5

    def test_mul(self):
        assert ev("(* 2 3 4)") == 24

    def test_div(self):
        assert ev("(/ 10 3)") == pytest.approx(3.333333, rel=1e-3)

    def test_modulo(self):
        assert ev("(modulo 10 3)") == 1


# ---- Comparison operations ----

class TestComparison:
    def test_equal(self):
        assert ev("(= 1 1)") is True

    def test_not_equal(self):
        assert ev("(= 1 2)") is False

    def test_less_than(self):
        assert ev("(< 1 2)") is True

    def test_greater_than(self):
        assert ev("(> 2 1)") is True

    def test_less_equal(self):
        assert ev("(<= 1 1)") is True

    def test_greater_equal(self):
        assert ev("(>= 2 1)") is True


# ---- Logical operations ----

class TestLogic:
    def test_and_true(self):
        assert ev("(and #t #t)") is True

    def test_and_false(self):
        assert ev("(and #t #f)") is False

    def test_or_true(self):
        assert ev("(or #f #t)") is True

    def test_or_false(self):
        assert ev("(or #f #f)") is False

    def test_not_true(self):
        assert ev("(not #t)") is False

    def test_not_false(self):
        assert ev("(not #f)") is True

    def test_and_short_circuit(self):
        # (and #f (/ 1 0)) should not error
        assert ev("(and #f (/ 1 0))") is False

    def test_or_short_circuit(self):
        # (or #t (/ 1 0)) should not error
        assert ev("(or #t (/ 1 0))") is True


# ---- Define, Lambda, If, Cond, Let, Let* ----

class TestSpecialForms:
    def test_define_variable(self):
        assert ev("(begin (define x 42) x)") == 42

    def test_define_function(self):
        assert ev("(begin (define (square x) (* x x)) (square 5))") == 25

    def test_define_recursive(self):
        assert ev("""
            (begin
              (define (factorial n)
                (if (<= n 1) 1 (* n (factorial (- n 1)))))
              (factorial 5))
        """) == 120

    def test_lambda(self):
        assert ev("((lambda (x y) (+ x y)) 3 4)") == 7

    def test_lambda_immediate(self):
        assert ev("((lambda (x) (* x x)) 5)") == 25

    def test_if_true(self):
        assert ev('(if (> 5 0) "positive" "non-positive")') == "positive"

    def test_if_false(self):
        assert ev('(if (> 0 5) "positive" "non-positive")') == "non-positive"

    def test_if_no_else(self):
        result = ev("(if #f 42)")
        # Should return nil/None when no else clause and test is false
        assert result is None or result == NIL

    def test_cond(self):
        code = """
            (begin
              (define x 0)
              (cond
                ((< x 0) "negative")
                ((= x 0) "zero")
                (else "positive")))
        """
        assert ev(code) == "zero"

    def test_cond_else(self):
        code = """
            (cond
              ((= 1 2) "nope")
              (else "yes"))
        """
        assert ev(code) == "yes"

    def test_let(self):
        assert ev("(let ((x 1) (y 2)) (+ x y))") == 3

    def test_let_star(self):
        assert ev("(let* ((x 1) (y (+ x 1))) (+ x y))") == 3

    def test_begin(self):
        assert ev("(begin 1 2 3)") == 3

    def test_set_bang(self):
        assert ev("(begin (define x 1) (set! x 100) x)") == 100

    def test_quote_list(self):
        assert ev("(quote (1 2 3))") == [1, 2, 3]

    def test_quote_shorthand(self):
        assert ev("'(1 2 3)") == [1, 2, 3]

    def test_quote_symbol(self):
        result = ev("'foo")
        assert isinstance(result, Symbol) and result == "foo"


# ---- List operations ----

class TestListOps:
    def test_cons(self):
        assert ev("(cons 1 '(2 3))") == [1, 2, 3]

    def test_car(self):
        assert ev("(car '(1 2 3))") == 1

    def test_cdr(self):
        result = ev("(cdr '(1 2 3))")
        assert result == [2, 3]

    def test_cdr_single(self):
        result = ev("(cdr '(1))")
        assert result == NIL or result == []

    def test_list(self):
        assert ev("(list 1 2 3)") == [1, 2, 3]

    def test_length(self):
        assert ev("(length '(1 2 3))") == 3

    def test_append(self):
        assert ev("(append '(1 2) '(3 4))") == [1, 2, 3, 4]

    def test_null_true(self):
        assert ev("(null? '())") is True

    def test_null_false(self):
        assert ev("(null? '(1))") is False

    def test_pair(self):
        assert ev("(pair? '(1 2))") is True

    def test_list_pred(self):
        assert ev("(list? '(1 2))") is True

    def test_map(self):
        assert ev("(map (lambda (x) (* x 2)) '(1 2 3))") == [2, 4, 6]

    def test_filter(self):
        assert ev("(filter (lambda (x) (> x 2)) '(1 2 3 4))") == [3, 4]

    def test_reverse(self):
        assert ev("(reverse '(1 2 3))") == [3, 2, 1]


# ---- String operations ----

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
        assert ev("(number->string 42)") == "42"


# ---- Closures ----

class TestClosures:
    def test_make_counter(self):
        code = """
            (begin
              (define (make-counter)
                (let ((count 0))
                  (lambda ()
                    (set! count (+ count 1))
                    count)))
              (define c (make-counter))
              (list (c) (c) (c)))
        """
        assert ev(code) == [1, 2, 3]

    def test_independent_counters(self):
        code = """
            (begin
              (define (make-counter)
                (let ((count 0))
                  (lambda ()
                    (set! count (+ count 1))
                    count)))
              (define c1 (make-counter))
              (define c2 (make-counter))
              (c1) (c1) (c1)
              (c2)
              (list (c1) (c2)))
        """
        assert ev(code) == [4, 2]

    def test_closure_over_variable(self):
        code = """
            (begin
              (define (make-adder n)
                (lambda (x) (+ x n)))
              (define add5 (make-adder 5))
              (add5 10))
        """
        assert ev(code) == 15


# ---- Tail Call Optimization ----

class TestTCO:
    def test_tail_recursion_no_overflow(self):
        code = """
            (begin
              (define (loop n)
                (if (= n 0) "done"
                  (loop (- n 1))))
              (loop 1000000))
        """
        assert ev(code) == "done"

    def test_tail_recursion_accumulator(self):
        code = """
            (begin
              (define (sum-acc n acc)
                (if (= n 0) acc
                  (sum-acc (- n 1) (+ acc n))))
              (sum-acc 100000 0))
        """
        assert ev(code) == 5000050000

    def test_tco_in_let(self):
        code = """
            (begin
              (define (f n)
                (let ((x n))
                  (if (= x 0) "ok" (f (- x 1)))))
              (f 100000))
        """
        assert ev(code) == "ok"


# ---- Macros ----

class TestMacros:
    def test_define_macro_when(self):
        code = """
            (begin
              (define-macro (when test . body)
                `(if ,test (begin ,@body)))
              (define result '())
              (when #t
                (set! result (cons 1 result))
                (set! result (cons 2 result)))
              result)
        """
        assert ev(code) == [2, 1]

    def test_define_macro_unless(self):
        code = """
            (begin
              (define-macro (unless test . body)
                `(if (not ,test) (begin ,@body)))
              (define x 0)
              (unless #f (set! x 42))
              x)
        """
        assert ev(code) == 42

    def test_quasiquote_basic(self):
        code = """
            (begin
              (define x 42)
              `(a ,x c))
        """
        result = ev(code)
        assert result[1] == 42

    def test_quasiquote_splicing(self):
        code = """
            (begin
              (define xs '(1 2 3))
              `(a ,@xs b))
        """
        result = ev(code)
        assert result == [Symbol('a'), 1, 2, 3, Symbol('b')]

    def test_macro_when_false(self):
        code = """
            (begin
              (define-macro (when test . body)
                `(if ,test (begin ,@body)))
              (define x 0)
              (when #f (set! x 99))
              x)
        """
        assert ev(code) == 0


# ---- Error Handling ----

class TestErrorHandling:
    def test_undefined_variable(self):
        with pytest.raises(LookupError):
            ev("undefined_var")

    def test_not_callable(self):
        with pytest.raises(TypeError):
            ev("(42 1 2)")

    def test_missing_closing_paren(self):
        with pytest.raises(SyntaxError):
            ev("(+ 1 2")

    def test_extra_closing_paren(self):
        with pytest.raises(SyntaxError):
            ev(")")

    def test_division_by_zero(self):
        with pytest.raises(ZeroDivisionError):
            ev("(/ 1 0)")

    def test_car_on_empty(self):
        with pytest.raises((IndexError, TypeError)):
            ev("(car '())")


# ---- Display / Output ----

class TestDisplay:
    def test_display(self, capsys):
        ev('(display "hello")')
        captured = capsys.readouterr()
        assert captured.out == "hello"

    def test_newline(self, capsys):
        ev("(newline)")
        captured = capsys.readouterr()
        assert captured.out == "\n"

    def test_print_list(self, capsys):
        ev("(print '(1 2 3))")
        captured = capsys.readouterr()
        assert "(1 2 3)" in captured.out


# ---- to_string formatting ----

class TestToString:
    def test_int(self):
        assert to_string(42) == "42"

    def test_bool_true(self):
        assert to_string(True) == "#t"

    def test_bool_false(self):
        assert to_string(False) == "#f"

    def test_string(self):
        assert to_string("hello") == '"hello"'

    def test_list(self):
        assert to_string([1, 2, 3]) == "(1 2 3)"

    def test_nil(self):
        assert to_string(NIL) == "()"

    def test_nested_list(self):
        assert to_string([1, [2, 3]]) == "(1 (2 3))"


# ---- Fibonacci (integration) ----

class TestIntegration:
    def test_fibonacci(self):
        code = """
            (begin
              (define (fib n)
                (if (<= n 1) n
                  (+ (fib (- n 1)) (fib (- n 2)))))
              (fib 10))
        """
        assert ev(code) == 55

    def test_higher_order(self):
        code = """
            (begin
              (define (compose f g)
                (lambda (x) (f (g x))))
              (define inc (lambda (x) (+ x 1)))
              (define double (lambda (x) (* x 2)))
              ((compose inc double) 5))
        """
        assert ev(code) == 11

    def test_variadic_lambda(self):
        code = """
            (begin
              (define (my-list . args) args)
              (my-list 1 2 3))
        """
        assert ev(code) == [1, 2, 3]
