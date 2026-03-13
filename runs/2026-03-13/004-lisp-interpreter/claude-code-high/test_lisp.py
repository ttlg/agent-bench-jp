"""Tests for the Lisp interpreter."""

import pytest
import sys
from lisp import run, make_global_env, NIL, Pair, Symbol, LispError, lispstr, python_list_to_lisp


# Helper to run with a shared environment
def run_env(sources, env=None):
    """Run multiple expressions in the same environment, return last result."""
    if env is None:
        env = make_global_env()
    result = None
    for src in sources:
        result = run(src, env)
    return result, env


# =========================================================================
# Basic data types and literals
# =========================================================================

class TestDataTypes:
    def test_integer(self):
        assert run("42") == 42

    def test_negative_integer(self):
        assert run("-7") == -7

    def test_float(self):
        assert run("3.14") == pytest.approx(3.14)

    def test_string(self):
        assert run('"hello"') == "hello"

    def test_boolean_true(self):
        assert run("#t") is True

    def test_boolean_false(self):
        assert run("#f") is False

    def test_nil(self):
        assert run("nil") == NIL

    def test_quoted_empty_list(self):
        assert run("'()") == NIL

    def test_quoted_list(self):
        result = run("'(1 2 3)")
        assert isinstance(result, Pair)
        assert result.car == 1
        assert result.cdr.car == 2
        assert result.cdr.cdr.car == 3

    def test_symbol(self):
        result = run("'foo")
        assert isinstance(result, Symbol)
        assert result == "foo"


# =========================================================================
# Arithmetic operations
# =========================================================================

class TestArithmetic:
    def test_add(self):
        assert run("(+ 1 2)") == 3

    def test_add_variadic(self):
        assert run("(+ 1 2 3)") == 6

    def test_add_zero_args(self):
        assert run("(+)") == 0

    def test_subtract(self):
        assert run("(- 10 3)") == 7

    def test_negate(self):
        assert run("(- 5)") == -5

    def test_multiply(self):
        assert run("(* 2 3 4)") == 24

    def test_multiply_zero_args(self):
        assert run("(*)") == 1

    def test_divide(self):
        result = run("(/ 10 3)")
        assert result == pytest.approx(10 / 3)

    def test_modulo(self):
        assert run("(modulo 10 3)") == 1

    def test_nested_arithmetic(self):
        assert run("(+ (* 2 3) (- 10 5))") == 11


# =========================================================================
# Comparison operations
# =========================================================================

class TestComparison:
    def test_equal(self):
        assert run("(= 1 1)") is True

    def test_not_equal(self):
        assert run("(= 1 2)") is False

    def test_less_than(self):
        assert run("(< 1 2)") is True

    def test_greater_than(self):
        assert run("(> 2 1)") is True

    def test_less_equal(self):
        assert run("(<= 1 1)") is True

    def test_greater_equal(self):
        assert run("(>= 2 1)") is True


# =========================================================================
# Logic operations
# =========================================================================

class TestLogic:
    def test_and_true(self):
        assert run("(and #t #t)") is True

    def test_and_false(self):
        assert run("(and #t #f)") is False

    def test_or_true(self):
        assert run("(or #f #t)") is True

    def test_or_false(self):
        assert run("(or #f #f)") is False

    def test_not_true(self):
        assert run("(not #t)") is False

    def test_not_false(self):
        assert run("(not #f)") is True

    def test_and_short_circuit(self):
        # Should not evaluate the second expression
        env = make_global_env()
        run("(define x 0)", env)
        run("(and #f (set! x 1))", env)
        assert run("x", env) == 0

    def test_or_short_circuit(self):
        env = make_global_env()
        run("(define x 0)", env)
        run("(or #t (set! x 1))", env)
        assert run("x", env) == 0


# =========================================================================
# Define, lambda, if, cond, let, let*
# =========================================================================

class TestSpecialForms:
    def test_define_variable(self):
        env = make_global_env()
        run("(define x 42)", env)
        assert run("x", env) == 42

    def test_define_function(self):
        env = make_global_env()
        run("(define (square x) (* x x))", env)
        assert run("(square 5)", env) == 25

    def test_define_recursive(self):
        env = make_global_env()
        run("(define (factorial n) (if (<= n 1) 1 (* n (factorial (- n 1)))))", env)
        assert run("(factorial 5)", env) == 120

    def test_lambda(self):
        assert run("((lambda (x y) (+ x y)) 3 4)") == 7

    def test_lambda_immediate(self):
        assert run("((lambda (x) (* x x)) 5)") == 25

    def test_if_true(self):
        assert run('(if (> 5 0) "positive" "non-positive")') == "positive"

    def test_if_false(self):
        assert run('(if (> 0 5) "positive" "non-positive")') == "non-positive"

    def test_if_no_else(self):
        result = run("(if #f 42)")
        assert result == NIL

    def test_cond(self):
        env = make_global_env()
        run("(define x 0)", env)
        result = run("""
            (cond
              ((< x 0) "negative")
              ((= x 0) "zero")
              (else "positive"))
        """, env)
        assert result == "zero"

    def test_cond_else(self):
        result = run("""
            (cond
              (#f "a")
              (#f "b")
              (else "c"))
        """)
        assert result == "c"

    def test_let(self):
        assert run("(let ((x 1) (y 2)) (+ x y))") == 3

    def test_let_no_leak(self):
        env = make_global_env()
        run("(define x 10)", env)
        assert run("(let ((x 1)) x)", env) == 1
        assert run("x", env) == 10

    def test_let_star(self):
        assert run("(let* ((x 1) (y (+ x 1))) (+ x y))") == 3

    def test_begin(self):
        env = make_global_env()
        result = run("""
            (begin
              (define x 1)
              (define y 2)
              (+ x y))
        """, env)
        assert result == 3

    def test_set_bang(self):
        env = make_global_env()
        run("(define x 1)", env)
        run("(set! x 100)", env)
        assert run("x", env) == 100

    def test_quote(self):
        result = run("(quote (1 2 3))")
        lst = result.to_list()
        assert lst == [1, 2, 3]


# =========================================================================
# List operations
# =========================================================================

class TestListOps:
    def test_cons(self):
        result = run("(cons 1 '(2 3))")
        assert result.to_list() == [1, 2, 3]

    def test_car(self):
        assert run("(car '(1 2 3))") == 1

    def test_cdr(self):
        result = run("(cdr '(1 2 3))")
        assert result.to_list() == [2, 3]

    def test_list(self):
        result = run("(list 1 2 3)")
        assert result.to_list() == [1, 2, 3]

    def test_length(self):
        assert run("(length '(1 2 3))") == 3

    def test_length_empty(self):
        assert run("(length '())") == 0

    def test_append(self):
        result = run("(append '(1 2) '(3 4))")
        assert result.to_list() == [1, 2, 3, 4]

    def test_map(self):
        result = run("(map (lambda (x) (* x 2)) '(1 2 3))")
        assert result.to_list() == [2, 4, 6]

    def test_filter(self):
        result = run("(filter (lambda (x) (> x 2)) '(1 2 3 4))")
        assert result.to_list() == [3, 4]

    def test_null_true(self):
        assert run("(null? '())") is True

    def test_null_false(self):
        assert run("(null? '(1))") is False

    def test_pair_true(self):
        assert run("(pair? '(1 2))") is True

    def test_pair_false(self):
        assert run("(pair? '())") is False

    def test_list_pred_true(self):
        assert run("(list? '(1 2))") is True

    def test_list_pred_empty(self):
        assert run("(list? '())") is True

    def test_list_pred_false(self):
        assert run("(list? 42)") is False


# =========================================================================
# String operations
# =========================================================================

class TestStrings:
    def test_string_length(self):
        assert run('(string-length "hello")') == 5

    def test_string_append(self):
        assert run('(string-append "hello" " " "world")') == "hello world"

    def test_substring(self):
        assert run('(substring "hello" 1 3)') == "el"

    def test_string_to_number(self):
        assert run('(string->number "42")') == 42

    def test_number_to_string(self):
        assert run('(number->string 42)') == "42"


# =========================================================================
# Closures
# =========================================================================

class TestClosures:
    def test_make_counter(self):
        env = make_global_env()
        run("""
            (define (make-counter)
              (let ((count 0))
                (lambda ()
                  (set! count (+ count 1))
                  count)))
        """, env)
        run("(define c (make-counter))", env)
        assert run("(c)", env) == 1
        assert run("(c)", env) == 2
        assert run("(c)", env) == 3

    def test_independent_counters(self):
        env = make_global_env()
        run("""
            (define (make-counter)
              (let ((count 0))
                (lambda ()
                  (set! count (+ count 1))
                  count)))
        """, env)
        run("(define c1 (make-counter))", env)
        run("(define c2 (make-counter))", env)
        assert run("(c1)", env) == 1
        assert run("(c1)", env) == 2
        assert run("(c2)", env) == 1
        assert run("(c1)", env) == 3
        assert run("(c2)", env) == 2

    def test_adder_closure(self):
        env = make_global_env()
        run("(define (make-adder n) (lambda (x) (+ n x)))", env)
        run("(define add5 (make-adder 5))", env)
        assert run("(add5 3)", env) == 8
        assert run("(add5 10)", env) == 15


# =========================================================================
# Tail Call Optimization
# =========================================================================

class TestTCO:
    def test_tco_simple_loop(self):
        env = make_global_env()
        run("""
            (define (loop n)
              (if (= n 0) "done"
                (loop (- n 1))))
        """, env)
        result = run("(loop 1000000)", env)
        assert result == "done"

    def test_tco_tail_recursive_sum(self):
        env = make_global_env()
        run("""
            (define (sum n acc)
              (if (= n 0) acc
                (sum (- n 1) (+ acc n))))
        """, env)
        result = run("(sum 100000 0)", env)
        assert result == 5000050000

    def test_tco_mutual_recursion_begin(self):
        """TCO in begin form."""
        env = make_global_env()
        run("""
            (define (count-down n)
              (if (= n 0) "done"
                (begin
                  (count-down (- n 1)))))
        """, env)
        assert run("(count-down 100000)", env) == "done"

    def test_tco_let(self):
        """TCO in let body."""
        env = make_global_env()
        run("""
            (define (f n)
              (let ((m (- n 1)))
                (if (= m 0) "done"
                  (f m))))
        """, env)
        assert run("(f 100000)", env) == "done"


# =========================================================================
# Macros
# =========================================================================

class TestMacros:
    def test_define_macro_when(self):
        env = make_global_env()
        run("""
            (define-macro (when test . body)
              `(if ,test (begin ,@body)))
        """, env)
        run("(define result 0)", env)
        run("(when #t (set! result 42))", env)
        assert run("result", env) == 42

    def test_when_false(self):
        env = make_global_env()
        run("""
            (define-macro (when test . body)
              `(if ,test (begin ,@body)))
        """, env)
        run("(define result 0)", env)
        run("(when #f (set! result 42))", env)
        assert run("result", env) == 0

    def test_define_macro_unless(self):
        env = make_global_env()
        run("""
            (define-macro (unless test . body)
              `(if (not ,test) (begin ,@body)))
        """, env)
        run("(define result 0)", env)
        run("(unless #f (set! result 99))", env)
        assert run("result", env) == 99

    def test_quasiquote_basic(self):
        env = make_global_env()
        run("(define x 42)", env)
        result = run("`(a ,x b)", env)
        lst = result.to_list()
        assert lst[0] == Symbol('a')
        assert lst[1] == 42
        assert lst[2] == Symbol('b')

    def test_quasiquote_splicing(self):
        env = make_global_env()
        run("(define xs '(1 2 3))", env)
        result = run("`(a ,@xs b)", env)
        lst = result.to_list()
        assert lst == [Symbol('a'), 1, 2, 3, Symbol('b')]

    def test_macro_with_multiple_body(self):
        env = make_global_env()
        run("""
            (define-macro (when test . body)
              `(if ,test (begin ,@body)))
        """, env)
        run("(define x 0)", env)
        run("(define y 0)", env)
        run("""
            (when #t
              (set! x 1)
              (set! y 2))
        """, env)
        assert run("x", env) == 1
        assert run("y", env) == 2


# =========================================================================
# Error handling
# =========================================================================

class TestErrorHandling:
    def test_undefined_variable(self):
        with pytest.raises(LispError, match="Undefined variable"):
            run("undefined_var")

    def test_unbalanced_parens(self):
        with pytest.raises(LispError):
            run("(+ 1 2")

    def test_unexpected_close_paren(self):
        with pytest.raises(LispError):
            run(")")

    def test_wrong_arg_count(self):
        env = make_global_env()
        run("(define (f x) x)", env)
        with pytest.raises(LispError):
            run("(f 1 2)", env)

    def test_not_callable(self):
        with pytest.raises(LispError, match="Not callable"):
            run("(42 1 2)")

    def test_car_on_non_pair(self):
        with pytest.raises(Exception):
            run("(car 42)")

    def test_division_by_zero(self):
        with pytest.raises(ZeroDivisionError):
            run("(/ 1 0)")


# =========================================================================
# Display / print
# =========================================================================

class TestDisplay:
    def test_display(self, capsys):
        run('(display "hello")')
        captured = capsys.readouterr()
        assert captured.out == "hello"

    def test_display_number(self, capsys):
        run('(display 42)')
        captured = capsys.readouterr()
        assert captured.out == "42"

    def test_newline(self, capsys):
        run('(newline)')
        captured = capsys.readouterr()
        assert captured.out == "\n"

    def test_print_list(self, capsys):
        run("(print '(1 2 3))")
        captured = capsys.readouterr()
        assert captured.out.strip() == "(1 2 3)"


# =========================================================================
# Fibonacci (integration test)
# =========================================================================

class TestIntegration:
    def test_fibonacci(self):
        env = make_global_env()
        run("(define (fib n) (if (<= n 1) n (+ (fib (- n 1)) (fib (- n 2)))))", env)
        assert run("(fib 0)", env) == 0
        assert run("(fib 1)", env) == 1
        assert run("(fib 10)", env) == 55

    def test_map_filter_combined(self):
        result = run("""
            (filter (lambda (x) (> x 5))
              (map (lambda (x) (* x x)) '(1 2 3 4)))
        """)
        assert result.to_list() == [9, 16]

    def test_higher_order(self):
        env = make_global_env()
        run("(define (twice f x) (f (f x)))", env)
        run("(define (inc x) (+ x 1))", env)
        assert run("(twice inc 5)", env) == 7

    def test_varargs_function(self):
        env = make_global_env()
        run("(define (my-list . args) args)", env)
        result = run("(my-list 1 2 3)", env)
        assert result.to_list() == [1, 2, 3]

    def test_apply(self):
        assert run("(apply + '(1 2 3))") == 6

    def test_nested_let(self):
        result = run("""
            (let ((x 1))
              (let ((y (+ x 1)))
                (+ x y)))
        """)
        assert result == 3
