"""Tests for the Scheme-like Lisp interpreter."""

import pytest
import sys
from lisp import (
    parse, eval_expr, make_global_env, run, lisp_repr,
    LispError, NIL, Pair, Symbol, Lambda, list_to_pair, pair_to_list
)


def ev(source, env=None):
    """Helper: evaluate source string and return result."""
    if env is None:
        env = make_global_env()
    return run(source, env)


def ev_env(source, env=None):
    """Helper: evaluate source string and return (result, env)."""
    if env is None:
        env = make_global_env()
    result = run(source, env)
    return result, env


# =========================================================================
# Basic data types and literals
# =========================================================================

class TestDataTypes:
    def test_integer(self):
        assert ev("42") == 42
        assert ev("-7") == -7
        assert ev("0") == 0

    def test_float(self):
        assert ev("3.14") == pytest.approx(3.14)
        assert ev("0.5") == pytest.approx(0.5)

    def test_string(self):
        assert ev('"hello"') == "hello"
        assert ev('"hello world"') == "hello world"
        assert ev('""') == ""

    def test_boolean(self):
        assert ev("#t") is True
        assert ev("#f") is False

    def test_nil(self):
        assert ev("'()") is NIL
        assert ev("nil") is NIL

    def test_symbol_quote(self):
        result = ev("'foo")
        assert isinstance(result, Symbol)
        assert result == "foo"

    def test_quoted_list(self):
        result = ev("'(1 2 3)")
        assert isinstance(result, Pair)
        lst = pair_to_list(result)
        assert lst == [1, 2, 3]


# =========================================================================
# Arithmetic operations
# =========================================================================

class TestArithmetic:
    def test_add(self):
        assert ev("(+ 1 2)") == 3
        assert ev("(+ 1 2 3)") == 6
        assert ev("(+)") == 0

    def test_subtract(self):
        assert ev("(- 10 3)") == 7
        assert ev("(- 5)") == -5

    def test_multiply(self):
        assert ev("(* 2 3)") == 6
        assert ev("(* 2 3 4)") == 24
        assert ev("(*)") == 1

    def test_divide(self):
        result = ev("(/ 10 3)")
        assert result == pytest.approx(10 / 3)
        assert ev("(/ 6 2)") == pytest.approx(3.0)

    def test_modulo(self):
        assert ev("(modulo 10 3)") == 1
        assert ev("(modulo 7 2)") == 1


# =========================================================================
# Comparison operations
# =========================================================================

class TestComparison:
    def test_equal(self):
        assert ev("(= 1 1)") is True
        assert ev("(= 1 2)") is False

    def test_less_than(self):
        assert ev("(< 1 2)") is True
        assert ev("(< 2 1)") is False

    def test_greater_than(self):
        assert ev("(> 2 1)") is True
        assert ev("(> 1 2)") is False

    def test_less_equal(self):
        assert ev("(<= 1 1)") is True
        assert ev("(<= 1 2)") is True
        assert ev("(<= 2 1)") is False

    def test_greater_equal(self):
        assert ev("(>= 2 1)") is True
        assert ev("(>= 1 1)") is True
        assert ev("(>= 1 2)") is False


# =========================================================================
# Logic operations
# =========================================================================

class TestLogic:
    def test_and(self):
        assert ev("(and #t #t)") is True
        assert ev("(and #t #f)") is False
        assert ev("(and #f #t)") is False

    def test_or(self):
        assert ev("(or #f #t)") is True
        assert ev("(or #f #f)") is False
        assert ev("(or #t #f)") is True

    def test_not(self):
        assert ev("(not #t)") is False
        assert ev("(not #f)") is True
        assert ev("(not 0)") is False  # 0 is truthy in Lisp

    def test_and_short_circuit(self):
        assert ev("(and #f (/ 1 0))") is False  # should not divide

    def test_or_short_circuit(self):
        assert ev("(or #t (/ 1 0))") is True


# =========================================================================
# Define, lambda, if, cond, let, let*
# =========================================================================

class TestSpecialForms:
    def test_define_variable(self):
        assert ev("(begin (define x 42) x)") == 42

    def test_define_function(self):
        assert ev("(begin (define (square x) (* x x)) (square 5))") == 25

    def test_define_factorial(self):
        code = """
        (begin
          (define (factorial n)
            (if (<= n 1) 1 (* n (factorial (- n 1)))))
          (factorial 10))
        """
        assert ev(code) == 3628800

    def test_lambda_inline(self):
        assert ev("((lambda (x) (* x x)) 5)") == 25

    def test_lambda_multiple_args(self):
        assert ev("((lambda (x y) (+ x y)) 3 4)") == 7

    def test_if_true(self):
        assert ev('(if (> 3 0) "positive" "non-positive")') == "positive"

    def test_if_false(self):
        assert ev('(if (> 0 3) "positive" "non-positive")') == "non-positive"

    def test_if_no_else(self):
        result = ev("(if #f 42)")
        assert result is NIL

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
          ((= 1 2) "a")
          ((= 1 3) "b")
          (else "c"))
        """
        assert ev(code) == "c"

    def test_let(self):
        assert ev("(let ((x 1) (y 2)) (+ x y))") == 3

    def test_let_no_leak(self):
        """let bindings should not be visible outside."""
        env = make_global_env()
        ev("(let ((x 99)) x)", env)
        with pytest.raises(LispError):
            ev("x", env)

    def test_let_star(self):
        assert ev("(let* ((x 1) (y (+ x 1))) (+ x y))") == 3

    def test_begin(self):
        assert ev("(begin 1 2 3)") == 3

    def test_set_bang(self):
        code = """
        (begin
          (define x 1)
          (set! x 42)
          x)
        """
        assert ev(code) == 42

    def test_quote(self):
        result = ev("(quote (1 2 3))")
        assert pair_to_list(result) == [1, 2, 3]


# =========================================================================
# List operations
# =========================================================================

class TestListOps:
    def test_cons(self):
        result = ev("(cons 1 '(2 3))")
        assert pair_to_list(result) == [1, 2, 3]

    def test_car(self):
        assert ev("(car '(1 2 3))") == 1

    def test_cdr(self):
        result = ev("(cdr '(1 2 3))")
        assert pair_to_list(result) == [2, 3]

    def test_list(self):
        result = ev("(list 1 2 3)")
        assert pair_to_list(result) == [1, 2, 3]

    def test_length(self):
        assert ev("(length '(1 2 3))") == 3
        assert ev("(length '())") == 0

    def test_append(self):
        result = ev("(append '(1 2) '(3 4))")
        assert pair_to_list(result) == [1, 2, 3, 4]

    def test_map(self):
        result = ev("(map (lambda (x) (* x 2)) '(1 2 3))")
        assert pair_to_list(result) == [2, 4, 6]

    def test_filter(self):
        result = ev("(filter (lambda (x) (> x 2)) '(1 2 3 4))")
        assert pair_to_list(result) == [3, 4]

    def test_null_check(self):
        assert ev("(null? '())") is True
        assert ev("(null? '(1))") is False

    def test_pair_check(self):
        assert ev("(pair? '(1 2))") is True
        assert ev("(pair? '())") is False

    def test_list_check(self):
        assert ev("(list? '(1 2))") is True
        assert ev("(list? '())") is True

    def test_reverse(self):
        result = ev("(reverse '(1 2 3))")
        assert pair_to_list(result) == [3, 2, 1]


# =========================================================================
# String operations
# =========================================================================

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


# =========================================================================
# Closures
# =========================================================================

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
        result = ev(code)
        assert pair_to_list(result) == [1, 2, 3]

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
        result = ev(code)
        assert pair_to_list(result) == [4, 2]

    def test_closure_over_variable(self):
        code = """
        (begin
          (define (make-adder n)
            (lambda (x) (+ x n)))
          (define add5 (make-adder 5))
          (add5 10))
        """
        assert ev(code) == 15


# =========================================================================
# Tail call optimization
# =========================================================================

class TestTCO:
    def test_tail_recursion_large(self):
        """Tail recursive loop should not overflow the stack."""
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
          (define (sum-iter n acc)
            (if (= n 0) acc
              (sum-iter (- n 1) (+ acc n))))
          (sum-iter 100000 0))
        """
        assert ev(code) == 5000050000

    def test_mutual_tail_calls(self):
        """TCO should handle tail calls through if branches."""
        code = """
        (begin
          (define (countdown n)
            (if (= n 0) 0
              (countdown (- n 1))))
          (countdown 500000))
        """
        assert ev(code) == 0


# =========================================================================
# Macros
# =========================================================================

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
        result = ev(code)
        assert pair_to_list(result) == [2, 1]

    def test_define_macro_unless(self):
        code = """
        (begin
          (define-macro (unless test . body)
            `(if (not ,test) (begin ,@body)))
          (unless #f 42))
        """
        assert ev(code) == 42

    def test_quasiquote_basic(self):
        env = make_global_env()
        ev("(define x 10)", env)
        result = ev("`(a ,x c)", env)
        lst = pair_to_list(result)
        assert lst[0] == Symbol('a')
        assert lst[1] == 10
        assert lst[2] == Symbol('c')

    def test_quasiquote_splicing(self):
        env = make_global_env()
        ev("(define xs '(1 2 3))", env)
        result = ev("`(a ,@xs b)", env)
        lst = pair_to_list(result)
        assert lst == [Symbol('a'), 1, 2, 3, Symbol('b')]

    def test_macro_when_false(self):
        code = """
        (begin
          (define-macro (when test . body)
            `(if ,test (begin ,@body)))
          (when #f 42))
        """
        result = ev(code)
        assert result is NIL


# =========================================================================
# Error handling
# =========================================================================

class TestErrorHandling:
    def test_undefined_variable(self):
        with pytest.raises(LispError, match="Undefined"):
            ev("undefined_var")

    def test_not_callable(self):
        with pytest.raises(LispError, match="Not callable"):
            ev("(42 1 2)")

    def test_division_by_zero(self):
        with pytest.raises(ZeroDivisionError):
            ev("(/ 1 0)")

    def test_car_of_non_pair(self):
        with pytest.raises((LispError, AttributeError)):
            ev("(car 42)")

    def test_unbalanced_parens(self):
        with pytest.raises(LispError):
            ev("(+ 1 2")

    def test_too_few_args(self):
        code = "(begin (define (f x y) (+ x y)) (f 1))"
        with pytest.raises(LispError, match="Too few"):
            ev(code)

    def test_too_many_args(self):
        code = "(begin (define (f x) x) (f 1 2))"
        with pytest.raises(LispError, match="Too many"):
            ev(code)


# =========================================================================
# Integration tests
# =========================================================================

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

    def test_higher_order_functions(self):
        code = """
        (begin
          (define (compose f g)
            (lambda (x) (f (g x))))
          (define inc (lambda (x) (+ x 1)))
          (define double (lambda (x) (* x 2)))
          (define inc-then-double (compose double inc))
          (inc-then-double 3))
        """
        assert ev(code) == 8

    def test_nested_let(self):
        code = """
        (let ((x 1))
          (let ((x 2) (y x))
            (+ x y)))
        """
        assert ev(code) == 3  # y binds to outer x=1, inner x=2

    def test_variadic_lambda(self):
        code = """
        (begin
          (define (f x . rest) rest)
          (f 1 2 3 4))
        """
        result = ev(code)
        assert pair_to_list(result) == [2, 3, 4]

    def test_apply_builtin(self):
        assert ev("(apply + '(1 2 3))") == 6

    def test_apply_lambda(self):
        code = """
        (begin
          (define (add a b) (+ a b))
          (apply add '(3 4)))
        """
        assert ev(code) == 7

    def test_type_predicates(self):
        assert ev("(number? 42)") is True
        assert ev('(string? "hi")') is True
        assert ev("(symbol? 'foo)") is True
        assert ev("(boolean? #t)") is True
        assert ev("(procedure? +)") is True
        assert ev("(integer? 42)") is True
        assert ev("(integer? 3.14)") is False

    def test_display(self, capsys):
        ev('(display "hello")')
        captured = capsys.readouterr()
        assert captured.out == "hello"

    def test_newline(self, capsys):
        ev("(newline)")
        captured = capsys.readouterr()
        assert captured.out == "\n"

    def test_print_func(self, capsys):
        ev("(print '(1 2 3))")
        captured = capsys.readouterr()
        assert captured.out.strip() == "(1 2 3)"
