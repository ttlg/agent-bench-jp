"""Tests for lisp.py (Scheme-like interpreter)."""
import pytest

import lisp as L


def ev(src: str, env=None):
    e = env or L.make_root_env()
    return L.eval_string(src, e), e


class TestLiteralsAndTypes:
    def test_numbers_and_bool_nil(self):
        v, _ = ev("#t")
        assert v is True
        v, _ = ev("#f")
        assert v is False
        assert L.eval_string("42") == 42
        assert L.eval_string("3.14") == pytest.approx(3.14)
        assert L.eval_string('"hello"') == "hello"
        assert L.eval_string("nil") is L.NIL
        assert L.eval_string("(quote ())") is L.NIL

    def test_quote_list(self):
        v, _ = ev("(quote (1 2 3))")
        assert L.list_to_py(v) == [1, 2, 3]
        v, _ = ev("(quote (a b))")
        assert isinstance(v, L.Pair)
        assert v.car == L.Symbol("a")


class TestArithmetic:
    def test_ops(self):
        assert L.eval_string("(+ 1 2 3)") == 6
        assert L.eval_string("(- 10 3)") == 7
        assert L.eval_string("(* 2 3 4)") == 24
        assert L.eval_string("(/ 10 3)") == pytest.approx(10 / 3)
        assert L.eval_string("(modulo 10 3)") == 1


class TestCompareLogic:
    def test_compare(self):
        assert L.eval_string("(= 1 1)") is True
        assert L.eval_string("(< 1 2)") is True
        assert L.eval_string("(> 2 1)") is True
        assert L.eval_string("(<= 1 1)") is True
        assert L.eval_string("(>= 2 1)") is True

    def test_logic(self):
        assert L.eval_string("(and #t #f)") is False
        assert L.eval_string("(or #f #t)") is True
        assert L.eval_string("(not #t)") is False


class TestSpecialForms:
    def test_define_lambda_if(self):
        env = L.make_root_env()
        ev("(define x 42)", env)
        assert env.get("x") == 42
        ev("(define (square x) (* x x))", env)
        r, _ = ev("(square 7)", env)
        assert r == 49
        r, _ = ev("(if (> 3 0) 1 2)", env)
        assert r == 1

    def test_cond(self):
        src = """
        (cond
          ((< 3 0) "negative")
          ((= 3 0) "zero")
          (else "positive"))
        """
        assert L.eval_string(src) == "positive"

    def test_let_letstar(self):
        assert L.eval_string("(let ((x 1) (y 2)) (+ x y))") == 3
        assert L.eval_string("(let* ((x 1) (y (+ x 1))) (+ x y))") == 3

    def test_begin_set(self):
        env = L.make_root_env()
        ev("(begin (define x 1) (define y 2) (+ x y))", env)
        env2 = L.make_root_env()
        ev("(define x 0)", env2)
        ev("(set! x 100)", env2)
        assert env2.get("x") == 100


class TestLists:
    def test_list_ops(self):
        env = L.make_root_env()
        ev("(define xs (quote (1 2 3)))", env)
        assert L.list_to_py(ev("(cons 0 xs)", env)[0]) == [0, 1, 2, 3]
        assert L.eval_string("(car (quote (1 2 3)))") == 1
        assert L.list_to_py(L.eval_string("(cdr (quote (1 2 3)))")) == [2, 3]
        assert L.list_to_py(L.eval_string("(list 1 2 3)")) == [1, 2, 3]
        assert L.eval_string("(length (quote (1 2 3)))") == 3
        assert L.list_to_py(L.eval_string("(append (quote (1 2)) (quote (3 4)))")) == [1, 2, 3, 4]
        assert L.eval_string("(null? (quote ()))") is True
        assert L.eval_string("(pair? (quote (1)))") is True
        assert L.eval_string("(list? (quote (1 2)))") is True


class TestMapFilter:
    def test_map_filter(self):
        env = L.make_root_env()
        r, _ = ev("(map (lambda (x) (* x 2)) (quote (1 2 3)))", env)
        assert L.list_to_py(r) == [2, 4, 6]
        r, _ = ev("(filter (lambda (x) (> x 2)) (quote (1 2 3 4)))", env)
        assert L.list_to_py(r) == [3, 4]


class TestStrings:
    def test_string_prims(self):
        assert L.eval_string('(string-length "hello")') == 5
        assert L.eval_string('(string-append "hello" " " "world")') == "hello world"
        assert L.eval_string('(substring "hello" 1 3)') == "el"
        assert L.eval_string('(string->number "42")') == 42
        assert L.eval_string("(number->string 42)") == "42"


class TestClosure:
    def test_make_counter(self):
        src = """
        (define (make-counter)
          (let ((count 0))
            (lambda ()
              (set! count (+ count 1))
              count)))
        (define c (make-counter))
        """
        env = L.make_root_env()
        ev(src, env)
        assert ev("(c)", env)[0] == 1
        assert ev("(c)", env)[0] == 2
        assert ev("(c)", env)[0] == 3


class TestTCO:
    def test_loop_no_stack_overflow(self):
        env = L.make_root_env()
        ev(
            "(define (loop n) (if (= n 0) \"done\" (loop (- n 1))))",
            env,
        )
        r, _ = ev("(loop 1000000)", env)
        assert r == "done"


class TestMacros:
    def test_when_unless(self):
        src = """
        (define-macro (when test . body)
          `(if ,test (begin ,@body)))
        (define-macro (unless test . body)
          `(if (not ,test) (begin ,@body)))
        (define x 0)
        """
        env = L.make_root_env()
        ev(src, env)
        ev("(when #t (set! x (+ x 1)))", env)
        assert env.get("x") == 1
        ev("(unless #f (set! x (+ x 10)))", env)
        assert env.get("x") == 11


class TestErrors:
    def test_bad_expr_raises(self):
        env = L.make_root_env()
        with pytest.raises(Exception):
            L.eval_string("(+ 1 2 3", env)
        with pytest.raises(Exception):
            L.eval_string("(car)", env)
        with pytest.raises(Exception):
            L.eval_string("(no-such-name)", env)


class TestFib:
    def test_fib_repl_example(self):
        env = L.make_root_env()
        ev(
            "(define (fib n) (if (<= n 1) n (+ (fib (- n 1)) (fib (- n 2)))))",
            env,
        )
        assert ev("(fib 10)", env)[0] == 55


def test_list_ops_clean():
    assert L.list_to_py(L.eval_string("(cons 1 (quote (2 3)))")) == [1, 2, 3]
