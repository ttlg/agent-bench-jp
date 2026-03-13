"""Tests for the Scheme-style Lisp interpreter."""
import pytest
import sys
import io
from lisp import (
    parse_all, scheme_eval, make_global_env,
    Pair, NIL, Symbol, LispError, lisp_repr,
    python_list_to_lisp
)


def ev(source, env=None):
    """Evaluate a Lisp source string and return the last result."""
    if env is None:
        env = make_global_env()
    exprs = parse_all(source)
    result = NIL
    for expr in exprs:
        result = scheme_eval(expr, env)
    return result


def ev_all(source, env=None):
    """Evaluate and return all results."""
    if env is None:
        env = make_global_env()
    exprs = parse_all(source)
    return [scheme_eval(e, env) for e in exprs]


# ---------------------------------------------------------------------------
# Basic data types
# ---------------------------------------------------------------------------

class TestDataTypes:
    def test_integer(self):
        assert ev("42") == 42

    def test_negative_integer(self):
        assert ev("-7") == -7

    def test_float(self):
        assert abs(ev("3.14") - 3.14) < 1e-10

    def test_string(self):
        assert ev('"hello"') == "hello"

    def test_string_escape(self):
        assert ev(r'"hello\nworld"') == "hello\nworld"

    def test_bool_true(self):
        assert ev("#t") is True

    def test_bool_false(self):
        assert ev("#f") is False

    def test_nil(self):
        assert ev("'()") is NIL

    def test_symbol(self):
        env = make_global_env()
        env.define(Symbol('x'), 42)
        assert ev("x", env) == 42

    def test_list_literal(self):
        result = ev("'(1 2 3)")
        assert isinstance(result, Pair)
        items = list(result)
        assert items == [1, 2, 3]

    def test_quoted_symbol(self):
        result = ev("'foo")
        assert result == Symbol('foo')

    def test_nil_keyword(self):
        assert ev("nil") is NIL


# ---------------------------------------------------------------------------
# Arithmetic
# ---------------------------------------------------------------------------

class TestArithmetic:
    def test_add(self):
        assert ev("(+ 1 2)") == 3

    def test_add_multi(self):
        assert ev("(+ 1 2 3)") == 6

    def test_add_zero_args(self):
        assert ev("(+)") == 0

    def test_sub(self):
        assert ev("(- 10 3)") == 7

    def test_sub_negate(self):
        assert ev("(- 5)") == -5

    def test_mul(self):
        assert ev("(* 2 3 4)") == 24

    def test_mul_zero_args(self):
        assert ev("(*)") == 1

    def test_div(self):
        result = ev("(/ 10 2)")
        assert result == 5

    def test_div_float(self):
        result = ev("(/ 1 3)")
        assert abs(result - 1/3) < 1e-10

    def test_modulo(self):
        assert ev("(modulo 10 3)") == 1

    def test_modulo_negative(self):
        assert ev("(modulo -10 3)") == 2  # Python semantics

    def test_abs(self):
        assert ev("(abs -5)") == 5
        assert ev("(abs 5)") == 5

    def test_expt(self):
        assert ev("(expt 2 10)") == 1024

    def test_sqrt(self):
        assert ev("(sqrt 4)") == 2

    def test_max(self):
        assert ev("(max 1 3 2)") == 3

    def test_min(self):
        assert ev("(min 3 1 2)") == 1

    def test_floor(self):
        assert ev("(floor 3.7)") == 3

    def test_ceiling(self):
        assert ev("(ceiling 3.2)") == 4


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------

class TestComparison:
    def test_eq(self):
        assert ev("(= 1 1)") is True
        assert ev("(= 1 2)") is False

    def test_lt(self):
        assert ev("(< 1 2)") is True
        assert ev("(< 2 1)") is False

    def test_gt(self):
        assert ev("(> 2 1)") is True
        assert ev("(> 1 2)") is False

    def test_le(self):
        assert ev("(<= 1 1)") is True
        assert ev("(<= 2 1)") is False

    def test_ge(self):
        assert ev("(>= 1 1)") is True
        assert ev("(>= 1 2)") is False

    def test_chained(self):
        assert ev("(< 1 2 3)") is True
        assert ev("(< 1 3 2)") is False


# ---------------------------------------------------------------------------
# Logic
# ---------------------------------------------------------------------------

class TestLogic:
    def test_and_true(self):
        assert ev("(and #t #t)") is True

    def test_and_false(self):
        assert ev("(and #t #f)") is False

    def test_and_empty(self):
        assert ev("(and)") is True

    def test_and_returns_last(self):
        assert ev("(and 1 2 3)") == 3

    def test_and_short_circuit(self):
        assert ev("(and #f (error \"should not eval\"))") is False

    def test_or_true(self):
        assert ev("(or #f #t)") is True

    def test_or_false(self):
        assert ev("(or #f #f)") is False

    def test_or_empty(self):
        assert ev("(or)") is False

    def test_or_returns_first_true(self):
        assert ev("(or #f 2 3)") == 2

    def test_or_short_circuit(self):
        assert ev("(or 1 (error \"should not eval\"))") == 1

    def test_not_true(self):
        assert ev("(not #t)") is False

    def test_not_false(self):
        assert ev("(not #f)") is True

    def test_not_non_false(self):
        assert ev("(not 42)") is False


# ---------------------------------------------------------------------------
# Special forms
# ---------------------------------------------------------------------------

class TestDefine:
    def test_define_var(self):
        env = make_global_env()
        ev("(define x 42)", env)
        assert ev("x", env) == 42

    def test_define_function(self):
        env = make_global_env()
        ev("(define (square x) (* x x))", env)
        assert ev("(square 5)", env) == 25

    def test_define_recursive(self):
        env = make_global_env()
        ev("(define (factorial n) (if (<= n 1) 1 (* n (factorial (- n 1)))))", env)
        assert ev("(factorial 5)", env) == 120
        assert ev("(factorial 10)", env) == 3628800


class TestLambda:
    def test_lambda_basic(self):
        assert ev("((lambda (x) (* x x)) 5)") == 25

    def test_lambda_multi_arg(self):
        assert ev("((lambda (x y) (+ x y)) 3 4)") == 7

    def test_lambda_closure(self):
        env = make_global_env()
        ev("(define (add-n n) (lambda (x) (+ x n)))", env)
        ev("(define add5 (add-n 5))", env)
        assert ev("(add5 10)", env) == 15

    def test_lambda_variadic(self):
        env = make_global_env()
        ev("(define (my-list . args) args)", env)
        result = ev("(my-list 1 2 3)", env)
        assert list(result) == [1, 2, 3]

    def test_lambda_rest_args(self):
        env = make_global_env()
        ev("(define (f x . rest) (cons x rest))", env)
        result = ev("(f 1 2 3)", env)
        assert result.car == 1
        assert list(result.cdr) == [2, 3]


class TestIf:
    def test_if_true(self):
        assert ev("(if #t 1 2)") == 1

    def test_if_false(self):
        assert ev("(if #f 1 2)") == 2

    def test_if_no_else(self):
        assert ev("(if #f 1)") is NIL

    def test_if_truthy(self):
        assert ev("(if 42 'yes 'no)") == Symbol('yes')

    def test_if_only_false_is_false(self):
        # 0, nil, empty string are truthy in Scheme
        assert ev("(if 0 'yes 'no)") == Symbol('yes')


class TestCond:
    def test_cond_first(self):
        assert ev("(cond (#t 1) (#t 2))") == 1

    def test_cond_second(self):
        assert ev("(cond (#f 1) (#t 2))") == 2

    def test_cond_else(self):
        assert ev("(cond (#f 1) (else 99))") == 99

    def test_cond_none(self):
        assert ev("(cond (#f 1))") is NIL

    def test_cond_complex(self):
        env = make_global_env()
        ev("(define x -5)", env)
        assert ev("(cond ((< x 0) 'negative) ((= x 0) 'zero) (else 'positive))", env) == Symbol('negative')


class TestLet:
    def test_let_basic(self):
        assert ev("(let ((x 1) (y 2)) (+ x y))") == 3

    def test_let_scope(self):
        env = make_global_env()
        ev("(define x 10)", env)
        assert ev("(let ((x 5)) x)", env) == 5
        assert ev("x", env) == 10  # outer x unchanged

    def test_let_parallel_binding(self):
        env = make_global_env()
        ev("(define x 1)", env)
        # let bindings are parallel, not sequential
        assert ev("(let ((x 2) (y x)) y)", env) == 1

    def test_let_star(self):
        assert ev("(let* ((x 1) (y (+ x 1))) (+ x y))") == 3

    def test_let_star_sequential(self):
        env = make_global_env()
        ev("(define x 1)", env)
        # let* is sequential
        assert ev("(let* ((x 2) (y x)) y)", env) == 2


class TestBegin:
    def test_begin(self):
        assert ev("(begin 1 2 3)") == 3

    def test_begin_empty(self):
        assert ev("(begin)") is NIL

    def test_begin_side_effects(self):
        env = make_global_env()
        ev("(begin (define x 1) (define y 2))", env)
        assert ev("(+ x y)", env) == 3


class TestSetBang:
    def test_set(self):
        env = make_global_env()
        ev("(define x 1)", env)
        ev("(set! x 42)", env)
        assert ev("x", env) == 42

    def test_set_undefined(self):
        env = make_global_env()
        with pytest.raises(LispError):
            ev("(set! undefined-var 1)", env)


class TestQuote:
    def test_quote(self):
        result = ev("(quote (1 2 3))")
        assert list(result) == [1, 2, 3]

    def test_quote_shorthand(self):
        result = ev("'(1 2 3)")
        assert list(result) == [1, 2, 3]

    def test_quote_symbol(self):
        assert ev("'hello") == Symbol('hello')

    def test_quote_nested(self):
        result = ev("'(1 (2 3) 4)")
        assert result.car == 1
        assert list(result.cdr.car) == [2, 3]


# ---------------------------------------------------------------------------
# List operations
# ---------------------------------------------------------------------------

class TestListOps:
    def test_cons(self):
        result = ev("(cons 1 '(2 3))")
        assert list(result) == [1, 2, 3]

    def test_cons_pair(self):
        result = ev("(cons 1 2)")
        assert result.car == 1
        assert result.cdr == 2

    def test_car(self):
        assert ev("(car '(1 2 3))") == 1

    def test_cdr(self):
        result = ev("(cdr '(1 2 3))")
        assert list(result) == [2, 3]

    def test_list(self):
        result = ev("(list 1 2 3)")
        assert list(result) == [1, 2, 3]

    def test_length(self):
        assert ev("(length '(1 2 3))") == 3
        assert ev("(length '())") == 0

    def test_append(self):
        result = ev("(append '(1 2) '(3 4))")
        assert list(result) == [1, 2, 3, 4]

    def test_append_empty(self):
        result = ev("(append '() '(1 2))")
        assert list(result) == [1, 2]

    def test_append_multi(self):
        result = ev("(append '(1) '(2) '(3))")
        assert list(result) == [1, 2, 3]

    def test_reverse(self):
        result = ev("(reverse '(1 2 3))")
        assert list(result) == [3, 2, 1]

    def test_map(self):
        result = ev("(map (lambda (x) (* x 2)) '(1 2 3))")
        assert list(result) == [2, 4, 6]

    def test_filter(self):
        result = ev("(filter (lambda (x) (> x 2)) '(1 2 3 4))")
        assert list(result) == [3, 4]

    def test_null_pred_true(self):
        assert ev("(null? '())") is True

    def test_null_pred_false(self):
        assert ev("(null? '(1))") is False

    def test_pair_pred(self):
        assert ev("(pair? '(1 2))") is True
        assert ev("(pair? '())") is False

    def test_list_pred(self):
        assert ev("(list? '(1 2 3))") is True
        assert ev("(list? '())") is True
        assert ev("(list? 42)") is False

    def test_car_error(self):
        with pytest.raises(LispError):
            ev("(car '())")

    def test_cdr_error(self):
        with pytest.raises(LispError):
            ev("(cdr '())")

    def test_list_ref(self):
        assert ev("(list-ref '(a b c) 1)") == Symbol('b')

    def test_list_tail(self):
        result = ev("(list-tail '(1 2 3 4) 2)")
        assert list(result) == [3, 4]

    def test_cadr(self):
        assert ev("(cadr '(1 2 3))") == 2

    def test_caddr(self):
        assert ev("(caddr '(1 2 3))") == 3

    def test_assoc(self):
        result = ev("(assoc 'b '((a 1) (b 2) (c 3)))")
        assert result.car == Symbol('b')

    def test_assoc_not_found(self):
        assert ev("(assoc 'd '((a 1) (b 2)))") is False

    def test_member(self):
        result = ev("(member 2 '(1 2 3))")
        assert list(result) == [2, 3]

    def test_member_not_found(self):
        assert ev("(member 5 '(1 2 3))") is False


# ---------------------------------------------------------------------------
# String operations
# ---------------------------------------------------------------------------

class TestStringOps:
    def test_string_length(self):
        assert ev('(string-length "hello")') == 5

    def test_string_append(self):
        assert ev('(string-append "hello" " " "world")') == "hello world"

    def test_substring(self):
        assert ev('(substring "hello" 1 3)') == "el"

    def test_string_to_number(self):
        assert ev('(string->number "42")') == 42
        assert ev('(string->number "3.14")') == 3.14

    def test_string_to_number_invalid(self):
        assert ev('(string->number "abc")') is False

    def test_number_to_string(self):
        assert ev('(number->string 42)') == "42"

    def test_string_upcase(self):
        assert ev('(string-upcase "hello")') == "HELLO"

    def test_string_downcase(self):
        assert ev('(string-downcase "HELLO")') == "hello"

    def test_string_eq(self):
        assert ev('(string=? "hello" "hello")') is True
        assert ev('(string=? "hello" "world")') is False

    def test_string_pred(self):
        assert ev('(string? "hello")') is True
        assert ev('(string? 42)') is False

    def test_symbol_to_string(self):
        assert ev("(symbol->string 'foo)") == "foo"

    def test_string_to_symbol(self):
        assert ev('(string->symbol "foo")') == Symbol('foo')


# ---------------------------------------------------------------------------
# Closures
# ---------------------------------------------------------------------------

class TestClosures:
    def test_counter(self):
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

    def test_adder(self):
        env = make_global_env()
        ev("(define (make-adder n) (lambda (x) (+ x n)))", env)
        ev("(define add5 (make-adder 5))", env)
        ev("(define add10 (make-adder 10))", env)
        assert ev("(add5 3)", env) == 8
        assert ev("(add10 3)", env) == 13

    def test_closure_captures_env(self):
        env = make_global_env()
        ev("(define x 10)", env)
        ev("(define (get-x) x)", env)
        ev("(set! x 20)", env)
        assert ev("(get-x)", env) == 20

    def test_multiple_closures_share_state(self):
        env = make_global_env()
        ev("""
        (define (make-bank-account balance)
          (define (deposit amount) (set! balance (+ balance amount)) balance)
          (define (withdraw amount) (set! balance (- balance amount)) balance)
          (define (get-balance) balance)
          (lambda (msg . args)
            (cond ((eq? msg 'deposit) (apply deposit args))
                  ((eq? msg 'withdraw) (apply withdraw args))
                  ((eq? msg 'balance) (get-balance)))))
        """, env)
        ev("(define acct (make-bank-account 100))", env)
        assert ev("(acct 'balance)", env) == 100
        assert ev("(acct 'deposit 50)", env) == 150
        assert ev("(acct 'withdraw 30)", env) == 120


# ---------------------------------------------------------------------------
# Tail call optimization
# ---------------------------------------------------------------------------

class TestTCO:
    def test_tail_recursion(self):
        env = make_global_env()
        ev("(define (loop n) (if (= n 0) 'done (loop (- n 1))))", env)
        result = ev("(loop 1000000)", env)
        assert result == Symbol('done')

    def test_tail_recursion_accumulator(self):
        env = make_global_env()
        ev("""
        (define (sum-iter n acc)
          (if (= n 0)
              acc
              (sum-iter (- n 1) (+ acc n))))
        """, env)
        assert ev("(sum-iter 100 0)", env) == 5050

    def test_mutual_recursion_like(self):
        env = make_global_env()
        ev("""
        (define (count-down n)
          (if (= n 0)
              'done
              (count-down (- n 1))))
        """, env)
        assert ev("(count-down 500000)", env) == Symbol('done')

    def test_named_let_loop(self):
        # Named let is a common TCO pattern (we test via define)
        env = make_global_env()
        ev("""
        (define (factorial-tail n)
          (define (go n acc)
            (if (= n 0) acc (go (- n 1) (* n acc))))
          (go n 1))
        """, env)
        assert ev("(factorial-tail 10)", env) == 3628800


# ---------------------------------------------------------------------------
# Macros
# ---------------------------------------------------------------------------

class TestMacros:
    def test_define_macro_when(self):
        env = make_global_env()
        ev("(define-macro (when test . body) `(if ,test (begin ,@body)))", env)
        assert ev("(when #t 42)", env) == 42
        assert ev("(when #f 42)", env) is NIL

    def test_define_macro_unless(self):
        env = make_global_env()
        ev("(define-macro (unless test . body) `(if (not ,test) (begin ,@body)))", env)
        assert ev("(unless #f 42)", env) == 42
        assert ev("(unless #t 42)", env) is NIL

    def test_macro_with_multiple_body_forms(self):
        env = make_global_env()
        ev("(define-macro (when test . body) `(if ,test (begin ,@body)))", env)
        ev("(define x 0)", env)
        ev("(when #t (set! x 1) (set! x (+ x 1)))", env)
        assert ev("x", env) == 2

    def test_quasiquote_basic(self):
        env = make_global_env()
        ev("(define x 42)", env)
        result = ev("`(a ,x c)", env)
        assert list(result) == [Symbol('a'), 42, Symbol('c')]

    def test_quasiquote_splicing(self):
        env = make_global_env()
        ev("(define lst '(1 2 3))", env)
        result = ev("`(a ,@lst b)", env)
        assert list(result) == [Symbol('a'), 1, 2, 3, Symbol('b')]

    def test_quasiquote_nested(self):
        result = ev("`(1 ,(+ 1 1) 3)")
        assert list(result) == [1, 2, 3]


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

class TestErrors:
    def test_undefined_variable(self):
        with pytest.raises(LispError):
            ev("undefined-xyz")

    def test_wrong_arg_count_lambda(self):
        with pytest.raises((LispError, Exception)):
            ev("((lambda (x y) x) 1)")

    def test_car_non_pair(self):
        with pytest.raises(LispError):
            ev("(car 42)")

    def test_division_by_zero(self):
        with pytest.raises((LispError, ZeroDivisionError)):
            ev("(/ 1 0)")

    def test_error_function(self):
        with pytest.raises(LispError):
            ev('(error "test error")')

    def test_error_with_irritants(self):
        with pytest.raises(LispError) as exc_info:
            ev('(error "bad value" 42)')
        assert "bad value" in str(exc_info.value)

    def test_not_a_procedure(self):
        with pytest.raises((LispError, TypeError, Exception)):
            ev("(42 1 2)")


# ---------------------------------------------------------------------------
# Higher-order functions
# ---------------------------------------------------------------------------

class TestHigherOrder:
    def test_apply(self):
        assert ev("(apply + '(1 2 3))") == 6

    def test_apply_with_prefix(self):
        assert ev("(apply + 1 2 '(3 4))") == 10

    def test_map_multi_list(self):
        result = ev("(map + '(1 2 3) '(10 20 30))")
        assert list(result) == [11, 22, 33]

    def test_for_each(self):
        env = make_global_env()
        ev("(define result '())", env)
        ev("(for-each (lambda (x) (set! result (cons x result))) '(1 2 3))", env)
        assert list(ev("result", env)) == [3, 2, 1]

    def test_reduce(self):
        assert ev("(reduce + 0 '(1 2 3 4 5))") == 15


# ---------------------------------------------------------------------------
# Miscellaneous
# ---------------------------------------------------------------------------

class TestMisc:
    def test_procedure_pred(self):
        assert ev("(procedure? car)") is True
        assert ev("(procedure? (lambda (x) x))") is True
        assert ev("(procedure? 42)") is False

    def test_symbol_pred(self):
        assert ev("(symbol? 'foo)") is True
        assert ev("(symbol? 42)") is False

    def test_number_pred(self):
        assert ev("(number? 42)") is True
        assert ev("(number? 3.14)") is True
        assert ev("(number? \"42\")") is False

    def test_boolean_pred(self):
        assert ev("(boolean? #t)") is True
        assert ev("(boolean? #f)") is True
        assert ev("(boolean? 0)") is False

    def test_equal_pred(self):
        assert ev("(equal? '(1 2 3) '(1 2 3))") is True
        assert ev("(equal? '(1 2) '(1 3))") is False

    def test_nested_define(self):
        env = make_global_env()
        ev("""
        (define (outer x)
          (define (inner y) (+ x y))
          (inner 10))
        """, env)
        assert ev("(outer 5)", env) == 15

    def test_display(self, capsys):
        ev('(display "hello")')
        captured = capsys.readouterr()
        assert captured.out == "hello"

    def test_newline(self, capsys):
        ev('(newline)')
        captured = capsys.readouterr()
        assert captured.out == "\n"

    def test_multiple_expressions(self):
        env = make_global_env()
        results = ev_all("(define x 1) (define y 2) (+ x y)", env)
        assert results[-1] == 3

    def test_letrec(self):
        env = make_global_env()
        result = ev("""
        (letrec ((even? (lambda (n) (if (= n 0) #t (odd? (- n 1)))))
                 (odd?  (lambda (n) (if (= n 0) #f (even? (- n 1))))))
          (even? 10))
        """, env)
        assert result is True

    def test_do_loop(self):
        env = make_global_env()
        result = ev("""
        (do ((i 0 (+ i 1))
             (sum 0 (+ sum i)))
            ((= i 5) sum))
        """, env)
        assert result == 10

    def test_integer_pred(self):
        assert ev("(integer? 42)") is True
        assert ev("(integer? 3.14)") is False

    def test_zero_pred(self):
        assert ev("(zero? 0)") is True
        assert ev("(zero? 1)") is False

    def test_positive_pred(self):
        assert ev("(positive? 1)") is True
        assert ev("(positive? -1)") is False

    def test_negative_pred(self):
        assert ev("(negative? -1)") is True
        assert ev("(negative? 1)") is False


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------

class TestIntegration:
    def test_fibonacci(self):
        env = make_global_env()
        ev("""
        (define (fib n)
          (cond ((= n 0) 0)
                ((= n 1) 1)
                (else (+ (fib (- n 1)) (fib (- n 2))))))
        """, env)
        assert ev("(fib 10)", env) == 55

    def test_flatten(self):
        env = make_global_env()
        ev("""
        (define (flatten lst)
          (cond ((null? lst) '())
                ((pair? (car lst))
                 (append (flatten (car lst)) (flatten (cdr lst))))
                (else (cons (car lst) (flatten (cdr lst))))))
        """, env)
        result = ev("(flatten '(1 (2 3) (4 (5 6))))", env)
        assert list(result) == [1, 2, 3, 4, 5, 6]

    def test_quicksort(self):
        env = make_global_env()
        ev("""
        (define (quicksort lst)
          (if (or (null? lst) (null? (cdr lst)))
              lst
              (let ((pivot (car lst))
                    (rest (cdr lst)))
                (let ((smaller (filter (lambda (x) (< x pivot)) rest))
                      (greater (filter (lambda (x) (>= x pivot)) rest)))
                  (append (quicksort smaller) (list pivot) (quicksort greater))))))
        """, env)
        result = ev("(quicksort '(3 1 4 1 5 9 2 6))", env)
        assert list(result) == [1, 1, 2, 3, 4, 5, 6, 9]

    def test_church_numerals(self):
        env = make_global_env()
        ev("""
        (define zero (lambda (f) (lambda (x) x)))
        (define (succ n) (lambda (f) (lambda (x) (f ((n f) x)))))
        (define (church->int n) ((n (lambda (x) (+ x 1))) 0))
        (define one (succ zero))
        (define two (succ one))
        (define three (succ two))
        """, env)
        assert ev("(church->int three)", env) == 3

    def test_higher_order_composition(self):
        env = make_global_env()
        ev("""
        (define (compose f g) (lambda (x) (f (g x))))
        (define double (lambda (x) (* x 2)))
        (define inc (lambda (x) (+ x 1)))
        (define double-then-inc (compose inc double))
        """, env)
        assert ev("(double-then-inc 5)", env) == 11

    def test_accumulate(self):
        env = make_global_env()
        ev("""
        (define (accumulate op init lst)
          (if (null? lst)
              init
              (op (car lst) (accumulate op init (cdr lst)))))
        """, env)
        assert ev("(accumulate + 0 '(1 2 3 4 5))", env) == 15
        assert ev("(accumulate * 1 '(1 2 3 4 5))", env) == 120
