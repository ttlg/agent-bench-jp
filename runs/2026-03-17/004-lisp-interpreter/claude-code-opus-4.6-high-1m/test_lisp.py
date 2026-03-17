"""Tests for the Scheme-like Lisp interpreter."""

import pytest
from lisp import parse, lisp_eval, make_global_env, lispstr, sym


def ev(source, env=None):
    """Evaluate a Lisp source string and return the result."""
    if env is None:
        env = make_global_env()
    result = None
    for expr in parse(source):
        result = lisp_eval(expr, env)
    return result


def ev_env(source):
    """Evaluate in a fresh env and return (result, env)."""
    env = make_global_env()
    result = None
    for expr in parse(source):
        result = lisp_eval(expr, env)
    return result, env


# ============================================================
# Basic data types and literals
# ============================================================

class TestBasicTypes:
    def test_integer(self):
        assert ev("42") == 42

    def test_negative_integer(self):
        assert ev("-7") == -7

    def test_float(self):
        assert ev("3.14") == 3.14

    def test_string(self):
        assert ev('"hello"') == "hello"

    def test_string_escape(self):
        assert ev(r'"hello\nworld"') == "hello\nworld"

    def test_boolean_true(self):
        assert ev("#t") is True

    def test_boolean_false(self):
        assert ev("#f") is False

    def test_quoted_list(self):
        assert ev("'(1 2 3)") == [1, 2, 3]

    def test_nil_quote(self):
        assert ev("'()") == []

    def test_nil_keyword(self):
        assert ev("nil") == []

    def test_quoted_symbol(self):
        assert ev("'foo") == sym('foo')

    def test_nested_quoted_list(self):
        assert ev("'(1 (2 3) 4)") == [1, [2, 3], 4]


# ============================================================
# Arithmetic
# ============================================================

class TestArithmetic:
    def test_add(self):
        assert ev("(+ 1 2 3)") == 6

    def test_add_no_args(self):
        assert ev("(+)") == 0

    def test_subtract(self):
        assert ev("(- 10 3)") == 7

    def test_unary_minus(self):
        assert ev("(- 5)") == -5

    def test_multiply(self):
        assert ev("(* 2 3 4)") == 24

    def test_multiply_no_args(self):
        assert ev("(*)") == 1

    def test_divide(self):
        assert abs(ev("(/ 10 3)") - 3.333333) < 0.001

    def test_modulo(self):
        assert ev("(modulo 10 3)") == 1

    def test_nested_arithmetic(self):
        assert ev("(+ (* 2 3) (- 10 4))") == 12


# ============================================================
# Comparison
# ============================================================

class TestComparison:
    def test_eq(self):
        assert ev("(= 1 1)") is True

    def test_eq_false(self):
        assert ev("(= 1 2)") is False

    def test_lt(self):
        assert ev("(< 1 2)") is True

    def test_gt(self):
        assert ev("(> 2 1)") is True

    def test_lte(self):
        assert ev("(<= 1 1)") is True

    def test_lte_less(self):
        assert ev("(<= 1 2)") is True

    def test_gte(self):
        assert ev("(>= 2 1)") is True

    def test_gte_equal(self):
        assert ev("(>= 2 2)") is True


# ============================================================
# Logic
# ============================================================

class TestLogic:
    def test_and_true(self):
        assert ev("(and #t #t)") is True

    def test_and_false(self):
        assert ev("(and #t #f)") is False

    def test_and_short_circuit(self):
        # Should not evaluate second arg
        assert ev("(and #f (/ 1 0))") is False

    def test_or_true(self):
        assert ev("(or #f #t)") is True

    def test_or_false(self):
        assert ev("(or #f #f)") is False

    def test_or_short_circuit(self):
        assert ev("(or #t (/ 1 0))") is True

    def test_not_true(self):
        assert ev("(not #t)") is False

    def test_not_false(self):
        assert ev("(not #f)") is True

    def test_and_empty(self):
        assert ev("(and)") is True

    def test_or_empty(self):
        assert ev("(or)") is False


# ============================================================
# Define
# ============================================================

class TestDefine:
    def test_variable(self):
        _, env = ev_env("(define x 42)")
        assert ev("x", env) == 42

    def test_function(self):
        _, env = ev_env("(define (square x) (* x x))")
        assert ev("(square 5)", env) == 25

    def test_recursive_function(self):
        _, env = ev_env("(define (factorial n) (if (<= n 1) 1 (* n (factorial (- n 1)))))")
        assert ev("(factorial 5)", env) == 120
        assert ev("(factorial 10)", env) == 3628800

    def test_multi_body(self):
        env = make_global_env()
        ev("(define (f x) (define y (* x 2)) (+ y 1))", env)
        assert ev("(f 5)", env) == 11


# ============================================================
# Lambda
# ============================================================

class TestLambda:
    def test_immediate_call(self):
        assert ev("((lambda (x y) (+ x y)) 3 4)") == 7

    def test_square(self):
        assert ev("((lambda (x) (* x x)) 5)") == 25

    def test_no_params(self):
        assert ev("((lambda () 42))") == 42

    def test_as_value(self):
        env = make_global_env()
        ev("(define add1 (lambda (x) (+ x 1)))", env)
        assert ev("(add1 10)", env) == 11

    def test_higher_order(self):
        env = make_global_env()
        ev("(define (apply-twice f x) (f (f x)))", env)
        ev("(define (add1 x) (+ x 1))", env)
        assert ev("(apply-twice add1 5)", env) == 7


# ============================================================
# If
# ============================================================

class TestIf:
    def test_true_branch(self):
        assert ev('(if (> 3 0) "positive" "non-positive")') == "positive"

    def test_false_branch(self):
        assert ev('(if (> 0 3) "positive" "non-positive")') == "non-positive"

    def test_no_else(self):
        assert ev("(if #f 42)") is None

    def test_truthy_zero(self):
        # In Scheme, 0 is truthy
        assert ev('(if 0 "yes" "no")') == "yes"

    def test_truthy_empty_string(self):
        assert ev('(if "" "yes" "no")') == "yes"


# ============================================================
# Cond
# ============================================================

class TestCond:
    def test_first_match(self):
        env = make_global_env()
        ev("(define x -1)", env)
        assert ev('(cond ((< x 0) "negative") ((= x 0) "zero") (else "positive"))', env) == "negative"

    def test_second_match(self):
        env = make_global_env()
        ev("(define x 0)", env)
        assert ev('(cond ((< x 0) "negative") ((= x 0) "zero") (else "positive"))', env) == "zero"

    def test_else(self):
        env = make_global_env()
        ev("(define x 5)", env)
        assert ev('(cond ((< x 0) "negative") ((= x 0) "zero") (else "positive"))', env) == "positive"

    def test_no_match(self):
        assert ev("(cond (#f 1))") is None


# ============================================================
# Let and Let*
# ============================================================

class TestLet:
    def test_basic(self):
        assert ev("(let ((x 1) (y 2)) (+ x y))") == 3

    def test_no_leak(self):
        env = make_global_env()
        ev("(define x 10)", env)
        assert ev("(let ((x 1)) x)", env) == 1
        assert ev("x", env) == 10

    def test_parallel_binding(self):
        env = make_global_env()
        ev("(define x 10)", env)
        # In let, bindings see the outer env, not each other
        assert ev("(let ((x 1) (y x)) y)", env) == 10

    def test_let_star(self):
        assert ev("(let* ((x 1) (y (+ x 1))) (+ x y))") == 3

    def test_let_star_sequential(self):
        assert ev("(let* ((x 1) (y (* x 2)) (z (+ y 3))) z)") == 5

    def test_let_multi_body(self):
        assert ev("(let ((x 5)) (define y 3) (+ x y))") == 8


# ============================================================
# List operations
# ============================================================

class TestListOps:
    def test_cons(self):
        assert ev("(cons 1 '(2 3))") == [1, 2, 3]

    def test_cons_empty(self):
        assert ev("(cons 1 '())") == [1]

    def test_car(self):
        assert ev("(car '(1 2 3))") == 1

    def test_cdr(self):
        assert ev("(cdr '(1 2 3))") == [2, 3]

    def test_cdr_single(self):
        assert ev("(cdr '(1))") == []

    def test_list(self):
        assert ev("(list 1 2 3)") == [1, 2, 3]

    def test_list_empty(self):
        assert ev("(list)") == []

    def test_length(self):
        assert ev("(length '(1 2 3))") == 3

    def test_length_empty(self):
        assert ev("(length '())") == 0

    def test_append(self):
        assert ev("(append '(1 2) '(3 4))") == [1, 2, 3, 4]

    def test_append_empty(self):
        assert ev("(append '() '(1 2))") == [1, 2]

    def test_map(self):
        assert ev("(map (lambda (x) (* x 2)) '(1 2 3))") == [2, 4, 6]

    def test_map_empty(self):
        assert ev("(map (lambda (x) x) '())") == []

    def test_filter(self):
        assert ev("(filter (lambda (x) (> x 2)) '(1 2 3 4))") == [3, 4]

    def test_filter_none(self):
        assert ev("(filter (lambda (x) (> x 10)) '(1 2 3))") == []

    def test_null_empty(self):
        assert ev("(null? '())") is True

    def test_null_non_empty(self):
        assert ev("(null? '(1))") is False

    def test_pair(self):
        assert ev("(pair? '(1 2))") is True

    def test_pair_empty(self):
        assert ev("(pair? '())") is False

    def test_list_pred(self):
        assert ev("(list? '(1 2))") is True

    def test_list_pred_empty(self):
        assert ev("(list? '())") is True

    def test_cadr(self):
        assert ev("(car (cdr '(1 2 3)))") == 2


# ============================================================
# Closures
# ============================================================

class TestClosure:
    def test_make_counter(self):
        env = make_global_env()
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

    def test_independent_counters(self):
        env = make_global_env()
        ev("""
        (define (make-counter)
          (let ((count 0))
            (lambda ()
              (set! count (+ count 1))
              count)))
        """, env)
        ev("(define c1 (make-counter))", env)
        ev("(define c2 (make-counter))", env)
        assert ev("(c1)", env) == 1
        assert ev("(c1)", env) == 2
        assert ev("(c2)", env) == 1
        assert ev("(c1)", env) == 3
        assert ev("(c2)", env) == 2

    def test_adder(self):
        env = make_global_env()
        ev("(define (make-adder n) (lambda (x) (+ n x)))", env)
        ev("(define add5 (make-adder 5))", env)
        assert ev("(add5 10)", env) == 15
        assert ev("(add5 20)", env) == 25

    def test_closure_over_set(self):
        env = make_global_env()
        ev("""
        (define (make-accumulator init)
          (let ((total init))
            (lambda (amount)
              (set! total (+ total amount))
              total)))
        """, env)
        ev("(define acc (make-accumulator 100))", env)
        assert ev("(acc 10)", env) == 110
        assert ev("(acc 25)", env) == 135


# ============================================================
# Tail Call Optimization
# ============================================================

class TestTCO:
    def test_simple_tail_recursion(self):
        env = make_global_env()
        ev("""
        (define (loop n)
          (if (= n 0) "done"
            (loop (- n 1))))
        """, env)
        assert ev("(loop 1000000)", env) == "done"

    def test_tail_recursive_sum(self):
        env = make_global_env()
        ev("""
        (define (sum-iter n acc)
          (if (= n 0) acc
            (sum-iter (- n 1) (+ acc n))))
        """, env)
        assert ev("(sum-iter 100000 0)", env) == 5000050000

    def test_begin_tco(self):
        env = make_global_env()
        ev("""
        (define (loop-begin n)
          (if (= n 0) "done"
            (begin
              (loop-begin (- n 1)))))
        """, env)
        assert ev("(loop-begin 500000)", env) == "done"

    def test_cond_tco(self):
        env = make_global_env()
        ev("""
        (define (loop-cond n)
          (cond
            ((= n 0) "done")
            (else (loop-cond (- n 1)))))
        """, env)
        assert ev("(loop-cond 500000)", env) == "done"

    def test_let_tco(self):
        env = make_global_env()
        ev("""
        (define (loop-let n)
          (if (= n 0) "done"
            (let ((m (- n 1)))
              (loop-let m))))
        """, env)
        assert ev("(loop-let 500000)", env) == "done"


# ============================================================
# Macros
# ============================================================

class TestMacro:
    def test_when_true(self):
        env = make_global_env()
        ev("""
        (define-macro (when test . body)
          `(if ,test (begin ,@body)))
        """, env)
        ev("(define result 0)", env)
        ev("(when #t (set! result 42))", env)
        assert ev("result", env) == 42

    def test_when_false(self):
        env = make_global_env()
        ev("""
        (define-macro (when test . body)
          `(if ,test (begin ,@body)))
        """, env)
        ev("(define result 0)", env)
        ev("(when #f (set! result 42))", env)
        assert ev("result", env) == 0

    def test_when_multi_body(self):
        env = make_global_env()
        ev("""
        (define-macro (when test . body)
          `(if ,test (begin ,@body)))
        """, env)
        ev("(define x 0)", env)
        ev("(define y 0)", env)
        ev("(when #t (set! x 1) (set! y 2))", env)
        assert ev("x", env) == 1
        assert ev("y", env) == 2

    def test_unless(self):
        env = make_global_env()
        ev("""
        (define-macro (unless test . body)
          `(if (not ,test) (begin ,@body)))
        """, env)
        ev("(define result 0)", env)
        ev("(unless #f (set! result 42))", env)
        assert ev("result", env) == 42

    def test_unless_no_exec(self):
        env = make_global_env()
        ev("""
        (define-macro (unless test . body)
          `(if (not ,test) (begin ,@body)))
        """, env)
        ev("(define result 0)", env)
        ev("(unless #t (set! result 42))", env)
        assert ev("result", env) == 0

    def test_quasiquote_basic(self):
        env = make_global_env()
        ev("(define x 42)", env)
        assert ev("`(a ,x b)", env) == [sym('a'), 42, sym('b')]

    def test_quasiquote_splicing(self):
        env = make_global_env()
        ev("(define xs '(1 2 3))", env)
        assert ev("`(a ,@xs b)", env) == [sym('a'), 1, 2, 3, sym('b')]

    def test_quasiquote_nested_list(self):
        env = make_global_env()
        ev("(define x 10)", env)
        assert ev("`(a (b ,x) c)", env) == [sym('a'), [sym('b'), 10], sym('c')]

    def test_simple_macro(self):
        env = make_global_env()
        ev("""
        (define-macro (swap! a b)
          `(let ((tmp ,a))
             (set! ,a ,b)
             (set! ,b tmp)))
        """, env)
        ev("(define x 1)", env)
        ev("(define y 2)", env)
        ev("(swap! x y)", env)
        assert ev("x", env) == 2
        assert ev("y", env) == 1


# ============================================================
# String operations
# ============================================================

class TestStringOps:
    def test_string_length(self):
        assert ev('(string-length "hello")') == 5

    def test_string_length_empty(self):
        assert ev('(string-length "")') == 0

    def test_string_append(self):
        assert ev('(string-append "hello" " " "world")') == "hello world"

    def test_string_append_empty(self):
        assert ev('(string-append)') == ""

    def test_substring(self):
        assert ev('(substring "hello" 1 3)') == "el"

    def test_string_to_number(self):
        assert ev('(string->number "42")') == 42

    def test_string_to_number_float(self):
        assert ev('(string->number "3.14")') == 3.14

    def test_number_to_string(self):
        assert ev('(number->string 42)') == "42"


# ============================================================
# Begin
# ============================================================

class TestBegin:
    def test_returns_last(self):
        assert ev("(begin 1 2 3)") == 3

    def test_side_effects(self):
        env = make_global_env()
        assert ev("(begin (define x 1) (define y 2) (+ x y))", env) == 3

    def test_empty_begin(self):
        assert ev("(begin)") is None

    def test_single_expr(self):
        assert ev("(begin 42)") == 42


# ============================================================
# Display / IO
# ============================================================

class TestDisplay:
    def test_display_string(self, capsys):
        ev('(display "hello")')
        assert capsys.readouterr().out == "hello"

    def test_display_number(self, capsys):
        ev("(display 42)")
        assert capsys.readouterr().out == "42"

    def test_display_list(self, capsys):
        ev("(display '(1 2 3))")
        assert capsys.readouterr().out == "(1 2 3)"

    def test_newline(self, capsys):
        ev("(newline)")
        assert capsys.readouterr().out == "\n"

    def test_print_value(self, capsys):
        ev("(print '(1 2 3))")
        assert capsys.readouterr().out == "(1 2 3)\n"

    def test_display_bool(self, capsys):
        ev("(display #t)")
        assert capsys.readouterr().out == "#t"


# ============================================================
# Error handling
# ============================================================

class TestErrors:
    def test_undefined_variable(self):
        with pytest.raises(LookupError):
            ev("undefined_var")

    def test_not_a_procedure(self):
        with pytest.raises(TypeError):
            ev("(42 1 2)")

    def test_wrong_arg_count(self):
        env = make_global_env()
        ev("(define (f x) x)", env)
        with pytest.raises(TypeError):
            ev("(f 1 2)", env)

    def test_car_empty_list(self):
        with pytest.raises(TypeError):
            ev("(car '())")

    def test_cdr_empty_list(self):
        with pytest.raises(TypeError):
            ev("(cdr '())")

    def test_unmatched_paren(self):
        with pytest.raises(SyntaxError):
            ev("(+ 1")

    def test_extra_close_paren(self):
        with pytest.raises(SyntaxError):
            ev(")")

    def test_unterminated_string(self):
        with pytest.raises(SyntaxError):
            ev('"hello')

    def test_division_by_zero(self):
        with pytest.raises(ZeroDivisionError):
            ev("(/ 1 0)")


# ============================================================
# String representation (lispstr)
# ============================================================

class TestLispstr:
    def test_true(self):
        assert lispstr(True) == "#t"

    def test_false(self):
        assert lispstr(False) == "#f"

    def test_integer(self):
        assert lispstr(42) == "42"

    def test_float(self):
        assert lispstr(3.14) == "3.14"

    def test_string(self):
        assert lispstr("hello") == '"hello"'

    def test_empty_list(self):
        assert lispstr([]) == "()"

    def test_list(self):
        assert lispstr([1, 2, 3]) == "(1 2 3)"

    def test_nested_list(self):
        assert lispstr([1, [2, 3]]) == "(1 (2 3))"

    def test_symbol(self):
        assert lispstr(sym('foo')) == "foo"


# ============================================================
# Fibonacci (integration test)
# ============================================================

class TestFibonacci:
    def test_fib_10(self):
        env = make_global_env()
        ev("(define (fib n) (if (<= n 1) n (+ (fib (- n 1)) (fib (- n 2)))))", env)
        assert ev("(fib 0)", env) == 0
        assert ev("(fib 1)", env) == 1
        assert ev("(fib 10)", env) == 55

    def test_fib_iterative_tco(self):
        env = make_global_env()
        ev("""
        (define (fib-iter n a b)
          (if (= n 0) a
            (fib-iter (- n 1) b (+ a b))))
        """, env)
        assert ev("(fib-iter 10 0 1)", env) == 55
        assert ev("(fib-iter 50 0 1)", env) == 12586269025


# ============================================================
# Type predicates
# ============================================================

class TestPredicates:
    def test_number(self):
        assert ev("(number? 42)") is True
        assert ev('(number? "hello")') is False
        assert ev("(number? #t)") is False

    def test_string(self):
        assert ev('(string? "hello")') is True
        assert ev("(string? 42)") is False

    def test_boolean(self):
        assert ev("(boolean? #t)") is True
        assert ev("(boolean? 42)") is False

    def test_symbol(self):
        assert ev("(symbol? 'foo)") is True
        assert ev("(symbol? 42)") is False

    def test_procedure(self):
        assert ev("(procedure? +)") is True
        assert ev("(procedure? 42)") is False

    def test_procedure_lambda(self):
        assert ev("(procedure? (lambda (x) x))") is True


# ============================================================
# Set!
# ============================================================

class TestSetBang:
    def test_basic(self):
        env = make_global_env()
        ev("(define x 1)", env)
        ev("(set! x 42)", env)
        assert ev("x", env) == 42

    def test_in_closure(self):
        env = make_global_env()
        ev("""
        (define x 0)
        (define (inc!) (set! x (+ x 1)))
        """, env)
        ev("(inc!)", env)
        ev("(inc!)", env)
        assert ev("x", env) == 2

    def test_undefined_error(self):
        with pytest.raises(LookupError):
            ev("(set! nonexistent 42)")


# ============================================================
# Comments
# ============================================================

class TestComments:
    def test_line_comment(self):
        assert ev("(+ 1 2) ; this is 3") == 3

    def test_comment_line(self):
        assert ev("; full comment\n(+ 1 2)") == 3

    def test_comment_in_list(self):
        assert ev("(+ 1 ; comment\n 2)") == 3
