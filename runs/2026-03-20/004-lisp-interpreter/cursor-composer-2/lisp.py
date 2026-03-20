#!/usr/bin/env python3
"""
Scheme-like Lisp interpreter (single file).
"""
from __future__ import annotations

import math
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


class NilType:
    __slots__ = ()

    def __repr__(self) -> str:
        return "()"


NIL = NilType()


@dataclass(frozen=True)
class Symbol:
    name: str

    def __repr__(self) -> str:
        return self.name


@dataclass
class Pair:
    car: Any
    cdr: Any

    def __repr__(self) -> str:
        return f"({self._repr_inner()})"

    def _repr_inner(self) -> str:
        parts: List[str] = []
        cur: Any = self
        while isinstance(cur, Pair):
            parts.append(_format_value(cur.car))
            cur = cur.cdr
        if cur is NIL:
            return " ".join(parts)
        return " ".join(parts) + " . " + _format_value(cur)


@dataclass
class Closure:
    params: Any  # list of Symbol, or Symbol for rest
    body: Any
    env: "Env"
    name: str = "lambda"


@dataclass
class Macro:
    """User-defined macro: pattern is (name sym ...) and body is expansion template."""

    pattern: Any  # pair chain
    body: Any
    env: "Env"


@dataclass
class TailCall:
    expr: Any
    env: "Env"


@dataclass
class Primitive:
    name: str
    fn: Callable[..., Any]
    min_args: int = 0
    variadic: bool = False


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------


@dataclass
class Env:
    bindings: Dict[str, Any] = field(default_factory=dict)
    parent: Optional["Env"] = None

    def get(self, sym: str) -> Any:
        e: Optional[Env] = self
        while e is not None:
            if sym in e.bindings:
                return e.bindings[sym]
            e = e.parent
        raise NameError(f"unbound variable: {sym}")

    def set_bang(self, sym: str, val: Any) -> None:
        e: Optional[Env] = self
        while e is not None:
            if sym in e.bindings:
                e.bindings[sym] = val
                return
            e = e.parent
        raise NameError(f"unbound variable in set!: {sym}")

    def define(self, sym: str, val: Any) -> None:
        self.bindings[sym] = val


def make_child_env(parent: Env) -> Env:
    return Env(parent=parent)


# ---------------------------------------------------------------------------
# List helpers
# ---------------------------------------------------------------------------


def cons(a: Any, b: Any) -> Any:
    return Pair(a, b)


def car(x: Any) -> Any:
    if isinstance(x, Pair):
        return x.car
    raise TypeError(f"car: expected pair, got {type(x).__name__}")


def cdr(x: Any) -> Any:
    if isinstance(x, Pair):
        return x.cdr
    raise TypeError(f"cdr: expected pair, got {type(x).__name__}")


def list_to_py(x: Any) -> List[Any]:
    out: List[Any] = []
    cur = x
    while isinstance(cur, Pair):
        out.append(cur.car)
        cur = cur.cdr
    if cur is not NIL:
        raise TypeError("list_to_py: improper list")
    return out


def py_to_list(items: List[Any]) -> Any:
    x: Any = NIL
    for i in reversed(items):
        x = cons(i, x)
    return x


def list_length(x: Any) -> int:
    n = 0
    while isinstance(x, Pair):
        n += 1
        x = x.cdr
    if x is NIL:
        return n
    raise TypeError("length: improper list")


def is_list_obj(x: Any) -> bool:
    cur = x
    while isinstance(cur, Pair):
        cur = cur.cdr
    return cur is NIL


def is_null(x: Any) -> bool:
    return x is NIL


def is_pair(x: Any) -> bool:
    return isinstance(x, Pair)


def append_lists(xs: Any, ys: Any) -> Any:
    if is_null(xs):
        return ys
    return cons(car(xs), append_lists(cdr(xs), ys))


def list_ref_slice(lst: Any, start: int, end: int) -> Any:
    """Return sublist from index start (inclusive) to end (exclusive) as proper list."""
    items = list_to_py(lst)
    return py_to_list(items[start:end])


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def _format_value(v: Any) -> str:
    if v is True:
        return "#t"
    if v is False:
        return "#f"
    if v is NIL:
        return "()"
    if isinstance(v, Symbol):
        return v.name
    if isinstance(v, Pair):
        return str(v)
    if isinstance(v, str):
        return '"' + v.encode("unicode_escape").decode("ascii").replace('"', '\\"') + '"'
    if isinstance(v, (int, float)):
        if isinstance(v, float) and math.isnan(v):
            return "+nan.0"
        if isinstance(v, float) and math.isinf(v):
            return "+inf.0" if v > 0 else "-inf.0"
        if isinstance(v, float) and v == int(v) and abs(v) < 1e15:
            s = str(v)
            if "e" in s.lower():
                return s
            return str(int(v)) if v == int(v) else s
        return str(v)
    if isinstance(v, Closure):
        return f"#<procedure {v.name}>"
    if isinstance(v, Macro):
        return "#<macro>"
    if isinstance(v, Primitive):
        return f"#<primitive {v.name}>"
    return repr(v)


# ---------------------------------------------------------------------------
# Lexer
# ---------------------------------------------------------------------------

TOKEN_SPEC = [
    ("FLOAT", r"-?\d+\.\d+([eE][+-]?\d+)?|-?\d+[eE][+-]?\d+"),
    ("INT", r"-?\d+"),
    ("STRING", r'"([^"\\]|\\.)*"'),
    ("HASH", r"#[tf]"),
    ("COMMA_AT", r",@"),
    ("COMMA", r","),
    ("QUOTE", r"'"),
    ("QUASI", r"`"),
    ("DOT", r"\."),
    ("LPAREN", r"\("),
    ("RPAREN", r"\)"),
    ("SYM", r"[^\s()\[\]{};,'`#]+"),
    ("SKIP", r"[;\s]+"),
]

TOKEN_RE = re.compile("|".join(f"(?P<{n}>{p})" for n, p in TOKEN_SPEC))


def tokenize(text: str) -> List[Tuple[str, str]]:
    tokens: List[Tuple[str, str]] = []
    pos = 0
    while pos < len(text):
        m = TOKEN_RE.match(text, pos)
        if not m:
            raise SyntaxError(f"illegal character at {pos}: {text[pos:pos + 10]!r}")
        kind = m.lastgroup
        assert kind is not None
        val = m.group()
        pos = m.end()
        if kind == "SKIP":
            continue
        if kind == "STRING":
            inner = val[1:-1]
            inner = bytes(inner, "utf-8").decode("unicode_escape")
            tokens.append(("STRING", inner))
        elif kind == "HASH":
            tokens.append(("HASH", val))
        else:
            tokens.append((kind, val))
    return tokens


# ---------------------------------------------------------------------------
# Reader
# ---------------------------------------------------------------------------


class Reader:
    def __init__(self, tokens: List[Tuple[str, str]]):
        self.toks = tokens
        self.i = 0

    def peek(self) -> Optional[Tuple[str, str]]:
        if self.i >= len(self.toks):
            return None
        return self.toks[self.i]

    def get(self) -> Tuple[str, str]:
        t = self.peek()
        if t is None:
            raise EOFError("unexpected EOF")
        self.i += 1
        return t

    def read(self) -> Any:
        return self._read_datum()

    def _read_datum(self) -> Any:
        t = self.get()
        kind, val = t
        if kind == "INT":
            return int(val)
        if kind == "FLOAT":
            return float(val)
        if kind == "STRING":
            return val
        if kind == "HASH":
            if val == "#t":
                return True
            if val == "#f":
                return False
            raise SyntaxError(f"bad hash token {val}")
        if kind == "QUOTE":
            return cons(Symbol("quote"), cons(self._read_datum(), NIL))
        if kind == "QUASI":
            return cons(Symbol("quasiquote"), cons(self._read_datum(), NIL))
        if kind == "COMMA_AT":
            return cons(Symbol("unquote-splicing"), cons(self._read_datum(), NIL))
        if kind == "COMMA":
            return cons(Symbol("unquote"), cons(self._read_datum(), NIL))
        if kind == "LPAREN":
            return self._read_list_tail()
        if kind == "SYM":
            vl = val.lower()
            if vl == "nil":
                return NIL
            return Symbol(val)
        raise SyntaxError(f"unexpected token {t}")

    def _read_list_tail(self) -> Any:
        peek = self.peek()
        if peek is None:
            raise EOFError("EOF in list")
        if peek[0] == "RPAREN":
            self.get()
            return NIL
        first = self._read_datum()
        peek = self.peek()
        if peek is not None and peek[0] == "DOT":
            self.get()
            rest = self._read_datum()
            closing = self.get()
            if closing[0] != "RPAREN":
                raise SyntaxError("expected ) after dotted tail")
            return cons(first, rest)
        rest = self._read_list_tail()
        return cons(first, rest)


def read_string(s: str) -> Any:
    toks = tokenize(s)
    if not toks:
        raise EOFError("empty input")
    r = Reader(toks)
    return r.read()


def read_many(s: str) -> List[Any]:
    toks = tokenize(s)
    out: List[Any] = []
    while True:
        # strip leading skip already done in tokenize
        if not toks:
            break
        r = Reader(toks)
        expr = r.read()
        out.append(expr)
        toks = r.toks[r.i :]
    return out


# ---------------------------------------------------------------------------
# Built-in primitives
# ---------------------------------------------------------------------------


def _num_args(name: str, got: int, expected: int) -> None:
    if got != expected:
        raise TypeError(f"{name}: expected {expected} args, got {got}")


def add_prim(args: List[Any]) -> Any:
    if not args:
        return 0
    if all(isinstance(x, int) and not isinstance(x, bool) for x in args):
        return sum(args)  # type: ignore
    return float(sum(float(x) for x in args))  # type: ignore


def sub_prim(args: List[Any]) -> Any:
    if len(args) == 0:
        raise TypeError("-: needs at least 1 argument")
    if len(args) == 1:
        x = args[0]
        if isinstance(x, int) and not isinstance(x, bool):
            return -x
        return -float(x)
    if all(isinstance(x, int) and not isinstance(x, bool) for x in args):
        a0 = args[0]
        s = a0
        for x in args[1:]:
            s -= x
        return s
    s = float(args[0])
    for x in args[1:]:
        s -= float(x)
    return s


def mul_prim(args: List[Any]) -> Any:
    if not args:
        return 1
    if all(isinstance(x, int) and not isinstance(x, bool) for x in args):
        p = 1
        for x in args:
            p *= x
        return p
    p = 1.0
    for x in args:
        p *= float(x)
    return p


def div_prim(args: List[Any]) -> Any:
    if len(args) == 0:
        raise TypeError("/: needs at least 1 argument")
    if len(args) == 1:
        return 1.0 / float(args[0])
    acc = float(args[0])
    for x in args[1:]:
        acc /= float(x)
    return acc


def modulo_prim(args: List[Any]) -> Any:
    _num_args("modulo", len(args), 2)
    a, b = args
    return int(a) % int(b)


def num_eq_prim(args: List[Any]) -> Any:
    if len(args) < 2:
        return True
    a0 = args[0]
    for x in args[1:]:
        if not _num_equal(a0, x):
            return False
    return True


def _num_equal(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, int) and isinstance(b, int):
        return a == b
    return float(a) == float(b)


def lt_prim(args: List[Any]) -> Any:
    if len(args) < 2:
        return True
    prev = args[0]
    for x in args[1:]:
        if not (float(prev) < float(x)):
            return False
        prev = x
    return True


def gt_prim(args: List[Any]) -> Any:
    if len(args) < 2:
        return True
    prev = args[0]
    for x in args[1:]:
        if not (float(prev) > float(x)):
            return False
        prev = x
    return True


def le_prim(args: List[Any]) -> Any:
    if len(args) < 2:
        return True
    prev = args[0]
    for x in args[1:]:
        if not (float(prev) <= float(x)):
            return False
        prev = x
    return True


def ge_prim(args: List[Any]) -> Any:
    if len(args) < 2:
        return True
    prev = args[0]
    for x in args[1:]:
        if not (float(prev) >= float(x)):
            return False
        prev = x
    return True


def not_prim(args: List[Any]) -> Any:
    _num_args("not", len(args), 1)
    return not is_true(args[0])


def cons_prim(args: List[Any]) -> Any:
    _num_args("cons", len(args), 2)
    return cons(args[0], args[1])


def car_prim(args: List[Any]) -> Any:
    _num_args("car", len(args), 1)
    return car(args[0])


def cdr_prim(args: List[Any]) -> Any:
    _num_args("cdr", len(args), 1)
    return cdr(args[0])


def list_prim(args: List[Any]) -> Any:
    return py_to_list(args)


def length_prim(args: List[Any]) -> Any:
    _num_args("length", len(args), 1)
    return list_length(args[0])


def append_prim(args: List[Any]) -> Any:
    if not args:
        return NIL
    acc = args[-1]
    for xs in reversed(args[:-1]):
        acc = append_lists(xs, acc)
    return acc


def null_q_prim(args: List[Any]) -> Any:
    _num_args("null?", len(args), 1)
    return is_null(args[0])


def pair_q_prim(args: List[Any]) -> Any:
    _num_args("pair?", len(args), 1)
    return is_pair(args[0])


def list_q_prim(args: List[Any]) -> Any:
    _num_args("list?", len(args), 1)
    return is_list_obj(args[0])


def string_length_prim(args: List[Any]) -> Any:
    _num_args("string-length", len(args), 1)
    return len(args[0])


def string_append_prim(args: List[Any]) -> Any:
    return "".join(str(x) for x in args)


def substring_prim(args: List[Any]) -> Any:
    _num_args("substring", len(args), 3)
    s, start, end = args[0], int(args[1]), int(args[2])
    return s[start:end]


def string_to_number_prim(args: List[Any]) -> Any:
    _num_args("string->number", len(args), 1)
    s = args[0]
    try:
        if "." in s or "e" in s.lower():
            return float(s)
        return int(s)
    except ValueError:
        return False


def number_to_string_prim(args: List[Any]) -> Any:
    _num_args("number->string", len(args), 1)
    x = args[0]
    if isinstance(x, bool):
        x = int(x)
    return str(x)


def display_prim(args: List[Any]) -> Any:
    _num_args("display", len(args), 1)
    v = args[0]
    if isinstance(v, str):
        sys.stdout.write(v)
    else:
        sys.stdout.write(_format_value(v))
    return None


def newline_prim(args: List[Any]) -> Any:
    sys.stdout.write("\n")
    return None


def print_prim(args: List[Any]) -> Any:
    _num_args("print", len(args), 1)
    sys.stdout.write(_format_value(args[0]) + "\n")
    return None


def map_prim(args: List[Any]) -> Any:
    _num_args("map", len(args), 2)
    fn, lst = args[0], args[1]
    items = list_to_py(lst)
    out: List[Any] = []
    for item in items:
        out.append(apply_value(fn, [item], None, False))
    return py_to_list(out)


def filter_prim(args: List[Any]) -> Any:
    _num_args("filter", len(args), 2)
    fn, lst = args[0], args[1]
    items = list_to_py(lst)
    out: List[Any] = []
    for item in items:
        if is_true(apply_value(fn, [item], None, False)):
            out.append(item)
    return py_to_list(out)


def make_root_env() -> Env:
    e = Env()
    builtins: Dict[str, Any] = {
        "+": Primitive("+", add_prim, 0, True),
        "-": Primitive("-", sub_prim, 1, True),
        "*": Primitive("*", mul_prim, 0, True),
        "/": Primitive("/", div_prim, 1, True),
        "modulo": Primitive("modulo", modulo_prim, 2, False),
        "=": Primitive("=", num_eq_prim, 2, True),
        "<": Primitive("<", lt_prim, 2, True),
        ">": Primitive(">", gt_prim, 2, True),
        "<=": Primitive("<=", le_prim, 2, True),
        ">=": Primitive(">=", ge_prim, 2, True),
        "not": Primitive("not", not_prim, 1, False),
        "cons": Primitive("cons", cons_prim, 2, False),
        "car": Primitive("car", car_prim, 1, False),
        "cdr": Primitive("cdr", cdr_prim, 1, False),
        "list": Primitive("list", list_prim, 0, True),
        "length": Primitive("length", length_prim, 1, False),
        "append": Primitive("append", append_prim, 0, True),
        "null?": Primitive("null?", null_q_prim, 1, False),
        "pair?": Primitive("pair?", pair_q_prim, 1, False),
        "list?": Primitive("list?", list_q_prim, 1, False),
        "string-length": Primitive("string-length", string_length_prim, 1, False),
        "string-append": Primitive("string-append", string_append_prim, 0, True),
        "substring": Primitive("substring", substring_prim, 3, False),
        "string->number": Primitive("string->number", string_to_number_prim, 1, False),
        "number->string": Primitive("number->string", number_to_string_prim, 1, False),
        "display": Primitive("display", display_prim, 1, False),
        "newline": Primitive("newline", newline_prim, 0, True),
        "print": Primitive("print", print_prim, 1, False),
        "map": Primitive("map", map_prim, 2, False),
        "filter": Primitive("filter", filter_prim, 2, False),
    }
    for k, v in builtins.items():
        e.define(k, v)
    return e


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


def is_true(v: Any) -> bool:
    if v is False:
        return False
    return True


def expr_to_list(expr: Any) -> List[Any]:
    out: List[Any] = []
    cur = expr
    while isinstance(cur, Pair):
        out.append(cur.car)
        cur = cur.cdr
    if cur is not NIL:
        raise SyntaxError("improper list in form")
    return out


def is_symbol(x: Any, name: str) -> bool:
    return isinstance(x, Symbol) and x.name == name


def apply_value(fn: Any, args: List[Any], env: Optional[Env], tail: bool) -> Any:
    del env, tail  # map/filter: callee body is always tail w.r.t. the closure
    if isinstance(fn, Primitive):
        return fn.fn(args)
    if isinstance(fn, Closure):
        new_env = bind_params(fn.params, args, make_child_env(fn.env))
        return trampoline_eval_begin(fn.body, new_env, True)
    raise TypeError(f"call: not a procedure: {fn}")


def bind_params(params: Any, args: List[Any], env: Env) -> Env:
    if isinstance(params, Symbol):
        env.define(params.name, py_to_list(args))
        return env
    if not isinstance(params, Pair) and params is not NIL:
        raise TypeError("lambda: bad parameter list")
    syms: List[Symbol] = []
    rest: Optional[Symbol] = None
    cur = params
    dotted = False
    while isinstance(cur, Pair):
        p = cur.car
        if not isinstance(p, Symbol):
            raise TypeError("lambda: parameter must be symbol")
        syms.append(p)
        nxt = cur.cdr
        if isinstance(nxt, Pair):
            cur = nxt
        elif nxt is NIL:
            cur = nxt
            break
        else:
            if not isinstance(nxt, Symbol):
                raise TypeError("lambda: bad dotted tail")
            rest = nxt
            dotted = True
            break
    if cur is not NIL and not dotted:
        raise TypeError("lambda: bad parameter list")
    if not dotted:
        if len(syms) != len(args):
            raise TypeError(f"lambda: wrong arity: expected {len(syms)}, got {len(args)}")
        for s, a in zip(syms, args):
            env.define(s.name, a)
        return env
    min_args = len(syms)
    if len(args) < min_args:
        raise TypeError("lambda: too few arguments")
    for s, a in zip(syms, args[:min_args]):
        env.define(s.name, a)
    assert rest is not None
    env.define(rest.name, py_to_list(args[min_args:]))
    return env


def cadr_expr(expr: Pair) -> Any:
    return car(cdr(expr))


def eval_quote(expr: Pair) -> Any:
    rest = cdr(expr)
    if rest is NIL or not isinstance(cdr(rest), Pair) or cdr(cdr(rest)) is not NIL:
        if rest is NIL:
            raise SyntaxError("quote: missing argument")
        # allow (quote) wrong
    if isinstance(rest, Pair) and cdr(rest) is NIL:
        return rest.car
    raise SyntaxError("quote: bad syntax")


def eval_quasiquote(expr: Any, env: Env) -> Any:
    return quasiquote_process(expr, env, 0)


def quasiquote_process(expr: Any, env: Env, depth: int) -> Any:
    if depth == 0 and isinstance(expr, Pair):
        if is_symbol(expr.car, "unquote"):
            return trampoline_eval(cadr_expr(expr), env, False)
        if is_symbol(expr.car, "unquote-splicing"):
            raise SyntaxError("unquote-splicing in invalid context")
    if isinstance(expr, Pair):
        if is_symbol(expr.car, "quasiquote"):
            inner = cadr_expr(expr)
            return quasiquote_process(inner, env, depth + 1)
        if depth > 0 and is_symbol(expr.car, "unquote"):
            inner = cadr_expr(expr)
            return quasiquote_process(inner, env, depth - 1)
        if depth > 0 and is_symbol(expr.car, "unquote-splicing"):
            inner = cadr_expr(expr)
            return quasiquote_process(inner, env, depth - 1)
        # list
        return qq_expand_list(expr, env, depth)
    if isinstance(expr, Symbol) or isinstance(expr, (int, float, str)) or expr in (True, False, NIL):
        return expr
    return expr


def qq_expand_list(expr: Pair, env: Env, depth: int) -> Any:
    parts: List[Any] = []
    cur: Any = expr
    while isinstance(cur, Pair):
        elt = cur.car
        if (
            depth == 0
            and isinstance(elt, Pair)
            and is_symbol(elt.car, "unquote-splicing")
        ):
            seq = trampoline_eval(cadr_expr(elt), env, False)
            for x in list_to_py(seq):
                parts.append(x)
            cur = cur.cdr
            continue
        parts.append(quasiquote_process(elt, env, depth))
        cur = cur.cdr
    if cur is not NIL:
        raise SyntaxError("quasiquote: improper list")
    x: Any = NIL
    for p in reversed(parts):
        x = cons(p, x)
    return x


def eval_define(expr: Pair, env: Env) -> Any:
    rest = cdr(expr)
    if rest is NIL:
        raise SyntaxError("define: bad syntax")
    fst = car(rest)
    if isinstance(fst, Symbol):
        # (define name val)
        name = fst.name
        r2 = cdr(rest)
        if r2 is NIL or not isinstance(cdr(r2), Pair) or cdr(cdr(r2)) is not NIL:
            pass
        val_expr = car(cdr(rest))
        val = eval_expr(val_expr, env, False)
        env.define(name, val)
        return None
    if isinstance(fst, Pair):
        fname = car(fst)
        if not isinstance(fname, Symbol):
            raise SyntaxError("define: bad name")
        params = cdr(fst)
        body = cdr(rest)
        clo = Closure(params, body, env, fname.name)
        env.define(fname.name, clo)
        return None
    raise SyntaxError("define: bad syntax")


def eval_set_bang(expr: Pair, env: Env) -> Any:
    parts = expr_to_list(expr)
    if len(parts) != 3:
        raise SyntaxError("set!: bad syntax")
    if not isinstance(parts[1], Symbol):
        raise SyntaxError("set!: variable must be symbol")
    val = eval_expr(parts[2], env, False)
    env.set_bang(parts[1].name, val)
    return val


def eval_lambda(expr: Pair, env: Env) -> Any:
    parts = expr_to_list(expr)
    if len(parts) < 3:
        raise SyntaxError("lambda: bad syntax")
    params = parts[1]
    body = cdr(cdr(expr))
    return Closure(params, body, env, "lambda")


def eval_define_macro(expr: Pair, env: Env) -> Any:
    parts = expr_to_list(expr)
    if len(parts) < 2:
        raise SyntaxError("define-macro: bad syntax")
    pat = parts[1]
    body = cdr(cdr(expr))
    if not isinstance(pat, Pair):
        raise SyntaxError("define-macro: pattern must be list")
    name_sym = car(pat)
    if not isinstance(name_sym, Symbol):
        raise SyntaxError("define-macro: name must be symbol")
    m = Macro(pat, body, env)
    env.define(name_sym.name, m)
    return None


def macro_match(pattern: Any, form: Any) -> Optional[Dict[str, Any]]:
    """Match `form` against `pattern` (nested pairs / symbols). Return bindings or None."""
    if isinstance(pattern, Symbol):
        return {pattern.name: form}
    if pattern is NIL:
        return {} if form is NIL else None
    if isinstance(pattern, Pair):
        if not isinstance(form, Pair):
            return None
        # dotted tail in pattern: (a . rest)
        if isinstance(pattern.cdr, Symbol):
            # bind rest symbol to cdr of form as list? Scheme: (a . rest) matches (1 2 3) with rest=(2 3)
            left = macro_match(pattern.car, form.car)
            if left is None:
                return None
            rest_sym = pattern.cdr
            right = {rest_sym.name: form.cdr}
            return {**left, **right}
        left = macro_match(pattern.car, form.car)
        if left is None:
            return None
        right = macro_match(pattern.cdr, form.cdr)
        if right is None:
            return None
        # merge; duplicate keys must match
        for k, v in right.items():
            if k in left and left[k] != v:
                return None
            if k not in left:
                left[k] = v
        return left
    return None


def eval_and(expr: Pair, env: Env) -> Any:
    cur = cdr(expr)
    if cur is NIL:
        return True
    last = True
    while isinstance(cur, Pair):
        nxt = cur.cdr
        if nxt is NIL:
            return eval_expr(cur.car, env, False)
        v = eval_expr(cur.car, env, False)
        if not is_true(v):
            return False
        cur = nxt
    return last


def eval_or(expr: Pair, env: Env) -> Any:
    cur = cdr(expr)
    if cur is NIL:
        return False
    while isinstance(cur, Pair):
        nxt = cur.cdr
        v = eval_expr(cur.car, env, False)
        if is_true(v):
            return v
        if nxt is NIL:
            return v
        cur = nxt
    return False


def expand_macro_body(m: Macro, form: Pair) -> Any:
    binds = macro_match(m.pattern, form)
    if binds is None:
        raise SyntaxError("macro: pattern match failed")
    menv = make_child_env(m.env)
    for k, v in binds.items():
        menv.define(k, v)
    return eval_begin(m.body, menv, False)


def trampoline_eval(expr: Any, env: Env, tail: bool) -> Any:
    current_expr: Any = expr
    current_env: Env = env
    current_tail: bool = tail
    while True:
        res = eval_expr_tc(current_expr, current_env, current_tail)
        if isinstance(res, TailCall):
            current_expr = res.expr
            current_env = res.env
            current_tail = True
            continue
        return res


def trampoline_eval_begin(body: Any, env: Env, tail: bool) -> Any:
    if body is NIL:
        return None
    if not isinstance(body, Pair):
        return trampoline_eval(body, env, tail)
    cur = body
    while isinstance(cur, Pair):
        nxt = cur.cdr
        is_last = nxt is NIL
        if is_last:
            return trampoline_eval(cur.car, env, tail)
        eval_expr_tc(cur.car, env, False)
        cur = nxt
    return None


def eval_expr_tc(expr: Any, env: Env, tail: bool) -> Any:
    """Used internally: may return TailCall."""
    if isinstance(expr, Symbol):
        return env.get(expr.name)
    if not isinstance(expr, Pair):
        return expr
    head = expr.car
    if isinstance(head, Symbol):
        name = head.name
        if name == "quote":
            return eval_quote(expr)
        if name == "quasiquote":
            return eval_quasiquote(cadr_expr(expr), env)
        if name == "if":
            return eval_if_tc(expr, env, tail)
        if name == "begin":
            return eval_begin_tc(cdr(expr), env, tail)
        if name == "define":
            return eval_define(expr, env)
        if name == "set!":
            return eval_set_bang(expr, env)
        if name == "lambda":
            return eval_lambda(expr, env)
        if name == "define-macro":
            return eval_define_macro(expr, env)
        if name == "cond":
            return eval_cond_tc(expr, env, tail)
        if name == "let":
            return eval_let_tc(expr, env, tail)
        if name == "let*":
            return eval_let_star_tc(expr, env, tail)
        if name == "and":
            return eval_and(expr, env)
        if name == "or":
            return eval_or(expr, env)
    return eval_application_tc(expr, env, tail)


def eval_if_tc(expr: Pair, env: Env, tail: bool) -> Any:
    parts = expr_to_list(expr)[1:]
    if len(parts) < 2 or len(parts) > 3:
        raise SyntaxError("if: bad syntax")
    test_v = eval_expr(parts[0], env, False)
    if is_true(test_v):
        return eval_expr_tc(parts[1], env, tail)
    if len(parts) == 3:
        return eval_expr_tc(parts[2], env, tail)
    return None


def eval_begin_tc(expr: Any, env: Env, tail: bool) -> Any:
    if expr is NIL:
        return None
    cur = expr
    while isinstance(cur, Pair):
        nxt = cur.cdr
        is_last = nxt is NIL
        if is_last:
            return eval_expr_tc(cur.car, env, tail)
        eval_expr(cur.car, env, False)
        cur = nxt
    raise SyntaxError("begin: bad body")


def eval_cond_tc(expr: Pair, env: Env, tail: bool) -> Any:
    cur = cdr(expr)
    while isinstance(cur, Pair):
        clause = cur.car
        cur = cur.cdr
        if not isinstance(clause, Pair):
            raise SyntaxError("cond: bad clause")
        test = clause.car
        if isinstance(test, Symbol) and test.name == "else":
            rest = cdr(clause)
            return eval_begin_tc(rest, env, tail)
        tval = eval_expr(test, env, False)
        if is_true(tval):
            rest = cdr(clause)
            if rest is NIL:
                return tval
            return eval_begin_tc(rest, env, tail)
    return None


def eval_let_tc(expr: Pair, env: Env, tail: bool) -> Any:
    parts = expr_to_list(expr)
    if len(parts) < 2:
        raise SyntaxError("let: bad syntax")
    binds = parts[1]
    body = cdr(cdr(expr))
    names: List[str] = []
    values: List[Any] = []
    bcur: Any = binds
    while isinstance(bcur, Pair):
        b = bcur.car
        if not isinstance(b, Pair) or not isinstance(car(b), Symbol):
            raise SyntaxError("let: bad binding")
        names.append(car(b).name)
        if not isinstance(cdr(b), Pair) or cdr(cdr(b)) is not NIL:
            raise SyntaxError("let: binding needs one value")
        values.append(eval_expr(cadr_expr(b), env, False))
        bcur = bcur.cdr
    if bcur is not NIL:
        raise SyntaxError("let: bad bindings")
    new_env = make_child_env(env)
    for n, v in zip(names, values):
        new_env.define(n, v)
    return eval_begin_tc(body, new_env, tail)


def eval_let_star_tc(expr: Pair, env: Env, tail: bool) -> Any:
    parts = expr_to_list(expr)
    if len(parts) < 2:
        raise SyntaxError("let*: bad syntax")
    binds = parts[1]
    body = cdr(cdr(expr))
    new_env = make_child_env(env)
    bcur: Any = binds
    while isinstance(bcur, Pair):
        b = bcur.car
        if not isinstance(b, Pair) or not isinstance(car(b), Symbol):
            raise SyntaxError("let*: bad binding")
        n = car(b).name
        if not isinstance(cdr(b), Pair) or cdr(cdr(b)) is not NIL:
            raise SyntaxError("let*: binding needs one value")
        v = eval_expr(cadr_expr(b), new_env, False)
        new_env.define(n, v)
        bcur = bcur.cdr
    if bcur is not NIL:
        raise SyntaxError("let*: bad bindings")
    return eval_begin_tc(body, new_env, tail)


def eval_application_tc(expr: Pair, env: Env, tail: bool) -> Any:
    head = expr.car
    if isinstance(head, Symbol):
        op = env.get(head.name)
    else:
        op = eval_expr_tc(head, env, False)

    if isinstance(op, Macro):
        expanded = expand_macro_body(op, expr)
        return eval_expr_tc(expanded, env, tail)

    args_expr = cdr(expr)
    args: List[Any] = []
    cur = args_expr
    while isinstance(cur, Pair):
        args.append(eval_expr_tc(cur.car, env, False))
        cur = cur.cdr
    if cur is not NIL:
        raise SyntaxError("application: improper argument list")

    if isinstance(op, Primitive):
        return op.fn(args)

    if isinstance(op, Closure):
        new_env = bind_params(op.params, args, make_child_env(op.env))
        if tail:
            return tail_call_closure_body(op.body, new_env)
        return trampoline_eval_begin(op.body, new_env, True)

    raise TypeError(f"call: not a procedure: {op}")


def tail_call_closure_body(body: Any, env: Env) -> TailCall:
    """Body is the cdr-chain of lambda/define; last form must run in tail position."""
    if body is NIL:
        return TailCall(NIL, env)
    if not isinstance(body, Pair):
        return TailCall(body, env)
    cur: Any = body
    while isinstance(cur, Pair) and cur.cdr is not NIL:
        eval_expr_tc(cur.car, env, False)
        cur = cur.cdr
    if not isinstance(cur, Pair):
        return TailCall(cur, env)
    return TailCall(cur.car, env)


# Replace eval_expr with thin wrapper that uses TC versions for tail paths
def eval_expr(expr: Any, env: Env, tail: bool) -> Any:  # type: ignore[no-redef]
    return eval_expr_tc(expr, env, tail)


def eval_begin(expr: Any, env: Env, tail: bool) -> Any:  # type: ignore[no-redef]
    return eval_begin_tc(expr, env, tail)


def eval_if(expr: Pair, env: Env, tail: bool) -> Any:  # type: ignore[no-redef]
    return eval_if_tc(expr, env, tail)


def eval_cond(expr: Pair, env: Env, tail: bool) -> Any:  # type: ignore[no-redef]
    return eval_cond_tc(expr, env, tail)


def eval_let(expr: Pair, env: Env, tail: bool) -> Any:  # type: ignore[no-redef]
    return eval_let_tc(expr, env, tail)


def eval_let_star(expr: Pair, env: Env, tail: bool) -> Any:  # type: ignore[no-redef]
    return eval_let_star_tc(expr, env, tail)


def eval_application(expr: Pair, env: Env, tail: bool) -> Any:  # type: ignore[no-redef]
    return eval_application_tc(expr, env, tail)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def eval_string(s: str, env: Optional[Env] = None) -> Any:
    e = env or make_root_env()
    last: Any = None
    for expr in read_many(s):
        last = trampoline_eval(expr, e, False)
    return last


def run_file(path: str) -> None:
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    eval_string(src, make_root_env())


def _exit_prim(args: List[Any]) -> Any:
    del args
    raise SystemExit(0)


def repl() -> None:
    env = make_root_env()
    env.define("exit", Primitive("exit", _exit_prim, 0, True))
    buf: List[str] = []
    depth = 0
    sys.stdout.write("lisp> ")
    sys.stdout.flush()
    while True:
        try:
            line = sys.stdin.readline()
        except KeyboardInterrupt:
            sys.stdout.write("\n")
            buf.clear()
            depth = 0
            sys.stdout.write("lisp> ")
            sys.stdout.flush()
            continue
        if line == "":
            sys.stdout.write("\n")
            break
        buf.append(line)
        text = "".join(buf)
        try:
            toks = tokenize(text)
        except SyntaxError as ex:
            sys.stdout.write(f"read error: {ex}\n")
            buf.clear()
            depth = 0
            sys.stdout.write("lisp> ")
            sys.stdout.flush()
            continue
        # balance parens
        d = 0
        for kind, val in toks:
            if kind == "LPAREN":
                d += 1
            elif kind == "RPAREN":
                d -= 1
        if d > 0:
            sys.stdout.write("... ")
            sys.stdout.flush()
            continue
        buf.clear()
        try:
            exprs = read_many(text)
            for ex in exprs:
                try:
                    out = trampoline_eval(ex, env, False)
                    if out is not None:
                        sys.stdout.write(_format_value(out) + "\n")
                except SystemExit:
                    raise
                except Exception as exn:
                    sys.stdout.write(f"error: {exn}\n")
        except EOFError:
            sys.stdout.write("read error: incomplete expression\n")
        except SystemExit:
            break
        except Exception as exn:
            sys.stdout.write(f"error: {exn}\n")
        sys.stdout.write("lisp> ")
        sys.stdout.flush()


def main(argv: List[str]) -> None:
    if len(argv) == 1:
        repl()
    elif len(argv) == 2:
        run_file(argv[1])
    else:
        sys.stderr.write("usage: python lisp.py [file.lisp]\n")
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)
