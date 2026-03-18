#!/usr/bin/env python3
"""Scheme-ish Lisp interpreter with REPL and file execution.

Features:
- integers, floats, strings, booleans, symbols, lists, nil
- define, lambda, if, cond, let, let*, begin, quote, quasiquote, set!
- define-macro with backquote/unquote/unquote-splicing
- builtins for arithmetic, comparison, logic, list, string, IO
- tail-call optimized evaluation loop for user procedures
"""

from __future__ import annotations

import ast
import math
import operator
import sys
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Iterator, Optional


class LispError(Exception):
    pass


class ParseError(LispError):
    pass


class Symbol(str):
    """Distinct type for symbols."""

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return self


class NilType:
    __slots__ = ()

    def __bool__(self) -> bool:
        return True

    def __iter__(self) -> Iterator[Any]:
        return iter(())

    def __repr__(self) -> str:
        return "()"


NIL = NilType()


@dataclass
class Pair:
    car: Any
    cdr: Any

    def __iter__(self) -> Iterator[Any]:
        cur: Any = self
        while isinstance(cur, Pair):
            yield cur.car
            cur = cur.cdr
        if cur is not NIL:
            raise LispError("improper list")

    def __repr__(self) -> str:
        return format_value(self)


def is_symbol(value: Any, name: Optional[str] = None) -> bool:
    if not isinstance(value, Symbol):
        return False
    return name is None or value == name


def is_list(value: Any) -> bool:
    cur = value
    while isinstance(cur, Pair):
        cur = cur.cdr
    return cur is NIL


def to_py_list(value: Any) -> list[Any]:
    if value is NIL:
        return []
    if not isinstance(value, Pair):
        raise LispError("expected list")
    items = []
    cur: Any = value
    while isinstance(cur, Pair):
        items.append(cur.car)
        cur = cur.cdr
    if cur is not NIL:
        raise LispError("expected proper list")
    return items


def build_list(items: Iterable[Any], tail: Any = NIL) -> Any:
    result = tail
    for item in reversed(list(items)):
        result = Pair(item, result)
    return result


def first(lst: Any) -> Any:
    if not isinstance(lst, Pair):
        raise LispError("expected non-empty list")
    return lst.car


def second(lst: Any) -> Any:
    return first(lst.cdr)


def rest(lst: Any) -> Any:
    if not isinstance(lst, Pair):
        raise LispError("expected non-empty list")
    return lst.cdr


def truthy(value: Any) -> bool:
    return value is not False


def format_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t")


def format_value(value: Any) -> str:
    if value is None:
        return ""
    if value is NIL:
        return "()"
    if value is True:
        return "#t"
    if value is False:
        return "#f"
    if isinstance(value, Symbol):
        return str(value)
    if isinstance(value, str):
        return '"' + format_string(value) + '"'
    if isinstance(value, Pair):
        parts = []
        cur: Any = value
        while isinstance(cur, Pair):
            parts.append(format_value(cur.car))
            cur = cur.cdr
        if cur is NIL:
            return "(" + " ".join(parts) + ")"
        return "(" + " ".join(parts) + " . " + format_value(cur) + ")"
    if isinstance(value, Procedure):
        kind = "macro" if value.is_macro else "procedure"
        return f"#<{kind} {value.name or 'lambda'}>"
    return str(value)


def stringify_display(value: Any) -> str:
    if isinstance(value, Symbol):
        return str(value)
    if isinstance(value, str):
        return value
    return format_value(value)


class Env:
    def __init__(self, data: Optional[dict[str, Any]] = None, outer: Optional["Env"] = None):
        self.data = data or {}
        self.outer = outer

    def find(self, name: str) -> "Env":
        if name in self.data:
            return self
        if self.outer is not None:
            return self.outer.find(name)
        raise LispError(f"unbound symbol: {name}")

    def get(self, name: str) -> Any:
        if name == "nil":
            return NIL
        return self.find(name).data[name]

    def define(self, name: str, value: Any) -> Any:
        self.data[name] = value
        return value

    def set(self, name: str, value: Any) -> Any:
        self.find(name).data[name] = value
        return value


@dataclass
class Procedure:
    params: list[str]
    rest: Optional[str]
    body: list[Any]
    env: Env
    is_macro: bool = False
    name: Optional[str] = None


def parse_formals(obj: Any) -> tuple[list[str], Optional[str]]:
    if obj is NIL:
        return [], None
    if isinstance(obj, Symbol):
        return [], str(obj)
    if not isinstance(obj, Pair):
        raise LispError("invalid parameter list")
    required: list[str] = []
    cur: Any = obj
    while isinstance(cur, Pair):
        if not isinstance(cur.car, Symbol):
            raise LispError("parameter name must be symbol")
        required.append(str(cur.car))
        cur = cur.cdr
    if cur is NIL:
        return required, None
    if not isinstance(cur, Symbol):
        raise LispError("invalid dotted parameter list")
    return required, str(cur)


def bind_formals(env: Env, params: list[str], rest_name: Optional[str], args: list[Any]) -> None:
    if rest_name is None and len(args) != len(params):
        raise LispError("arity mismatch")
    if rest_name is not None and len(args) < len(params):
        raise LispError("arity mismatch")
    for name, value in zip(params, args):
        env.define(name, value)
    if rest_name is not None:
        env.define(rest_name, build_list(args[len(params) :]))


def tokenize(source: str) -> list[str]:
    tokens: list[str] = []
    i = 0
    n = len(source)
    while i < n:
        ch = source[i]
        if ch in " \t\r\n":
            i += 1
            continue
        if ch == ";":
            while i < n and source[i] != "\n":
                i += 1
            continue
        if ch == "(" or ch == ")" or ch == "'" or ch == "`" or ch == ".":
            tokens.append(ch)
            i += 1
            continue
        if ch == ",":
            if i + 1 < n and source[i + 1] == "@":
                tokens.append(",@")
                i += 2
            else:
                tokens.append(",")
                i += 1
            continue
        if ch == '"':
            buf = ['"']
            i += 1
            escaped = False
            while i < n:
                c = source[i]
                buf.append(c)
                i += 1
                if escaped:
                    escaped = False
                    continue
                if c == "\\":
                    escaped = True
                elif c == '"':
                    break
            else:
                raise EOFError("unterminated string")
            tokens.append("".join(buf))
            continue
        start = i
        while i < n:
            c = source[i]
            if c in " \t\r\n();'`,":
                break
            i += 1
        tokens.append(source[start:i])
    return tokens


def atom(token: str) -> Any:
    if token == "#t":
        return True
    if token == "#f":
        return False
    if token == "nil":
        return NIL
    if token and token[0] == '"':
        try:
            return ast.literal_eval(token)
        except Exception as exc:  # pragma: no cover - defensive
            raise ParseError(f"invalid string literal: {token}") from exc
    try:
        if token.startswith(("0x", "-0x", "+0x")):
            return int(token, 0)
        if any(c in token for c in ".eE"):
            value = float(token)
            if math.isfinite(value):
                return value
        return int(token)
    except ValueError:
        return Symbol(token)


def parse(source: str) -> list[Any]:
    tokens = tokenize(source)
    exprs: list[Any] = []
    pos = 0

    def read_expr() -> Any:
        nonlocal pos
        if pos >= len(tokens):
            raise EOFError("unexpected EOF")
        token = tokens[pos]
        pos += 1
        if token == "(":
            items: list[Any] = []
            while True:
                if pos >= len(tokens):
                    raise EOFError("unexpected EOF")
                if tokens[pos] == ")":
                    pos += 1
                    return build_list(items)
                if tokens[pos] == ".":
                    if not items:
                        raise ParseError("dot cannot appear here")
                    pos += 1
                    tail = read_expr()
                    if pos >= len(tokens) or tokens[pos] != ")":
                        raise ParseError("dotted list must end with )")
                    pos += 1
                    return build_list(items, tail)
                items.append(read_expr())
        if token == ")":
            raise ParseError("unexpected )")
        if token == "'":
            return build_list([Symbol("quote"), read_expr()])
        if token == "`":
            return build_list([Symbol("quasiquote"), read_expr()])
        if token == ",":
            return build_list([Symbol("unquote"), read_expr()])
        if token == ",@":
            return build_list([Symbol("unquote-splicing"), read_expr()])
        return atom(token)

    while pos < len(tokens):
        exprs.append(read_expr())
    return exprs


def eval_quasiquote(expr: Any, env: Env) -> Any:
    if not isinstance(expr, Pair):
        return expr
    if is_symbol(expr.car, "quasiquote"):
        return expr
    if is_symbol(expr.car, "unquote"):
        return eval_expr(first(expr.cdr), env)
    if is_symbol(expr.car, "unquote-splicing"):
        raise LispError("unquote-splicing invalid here")

    items: list[Any] = []
    cur: Any = expr
    tail: Any = NIL
    while isinstance(cur, Pair):
        item = cur.car
        if isinstance(item, Pair) and is_symbol(item.car, "unquote-splicing"):
            seq = eval_expr(first(item.cdr), env)
            items.extend(to_py_list(seq))
        else:
            items.append(eval_quasiquote(item, env))
        cur = cur.cdr
    if cur is not NIL:
        tail = eval_quasiquote(cur, env)
    return build_list(items, tail)


def eval_sequence(exprs: list[Any], env: Env) -> Any:
    if not exprs:
        return None
    result: Any = None
    for expr in exprs[:-1]:
        result = eval_expr(expr, env)
    return eval_expr(exprs[-1], env)


def apply_callable(proc: Any, args: list[Any], env: Env) -> Any:
    if isinstance(proc, Procedure):
        return call_user_procedure(proc, args)
    if callable(proc):
        return proc(args, env)
    raise LispError(f"not callable: {format_value(proc)}")


def call_user_procedure(proc: Procedure, args: list[Any]) -> Any:
    call_env = Env(outer=proc.env)
    bind_formals(call_env, proc.params, proc.rest, args)
    if not proc.body:
        return None
    for form in proc.body[:-1]:
        eval_expr(form, call_env)
    expr = proc.body[-1]
    return eval_expr(expr, call_env)


def eval_expr(expr: Any, env: Env) -> Any:
    while True:
        if isinstance(expr, Symbol):
            return env.get(str(expr))
        if expr is None or expr is NIL or isinstance(expr, (int, float, str, bool)):
            return expr
        if not isinstance(expr, Pair):
            return expr

        op = expr.car
        args = expr.cdr

        if is_symbol(op, "quote"):
            return first(args)
        if is_symbol(op, "quasiquote"):
            return eval_quasiquote(first(args), env)
        if is_symbol(op, "if"):
            forms = to_py_list(args)
            if len(forms) < 2:
                raise LispError("if expects at least 2 arguments")
            test = eval_expr(forms[0], env)
            consequent = forms[1]
            alternate = forms[2] if len(forms) > 2 else None
            expr = consequent if truthy(test) else alternate
            continue
        if is_symbol(op, "begin"):
            forms = to_py_list(args)
            if not forms:
                return None
            for form in forms[:-1]:
                eval_expr(form, env)
            expr = forms[-1]
            continue
        if is_symbol(op, "define"):
            target = first(args)
            if isinstance(target, Pair):
                name = target.car
                if not isinstance(name, Symbol):
                    raise LispError("function name must be symbol")
                params, rest_name = parse_formals(target.cdr)
                body = to_py_list(args.cdr)
                env.define(str(name), Procedure(params, rest_name, body, env, name=str(name)))
                return None
            if not isinstance(target, Symbol):
                raise LispError("define target must be symbol")
            value_expr = second(args)
            value = eval_expr(value_expr, env)
            env.define(str(target), value)
            return None
        if is_symbol(op, "define-macro"):
            target = first(args)
            if not isinstance(target, Pair):
                raise LispError("define-macro requires function-style signature")
            name = target.car
            if not isinstance(name, Symbol):
                raise LispError("macro name must be symbol")
            params, rest_name = parse_formals(target.cdr)
            body = to_py_list(args.cdr)
            env.define(str(name), Procedure(params, rest_name, body, env, is_macro=True, name=str(name)))
            return None
        if is_symbol(op, "set!"):
            target = first(args)
            if not isinstance(target, Symbol):
                raise LispError("set! target must be symbol")
            value = eval_expr(second(args), env)
            env.set(str(target), value)
            return None
        if is_symbol(op, "lambda"):
            formals = first(args)
            params, rest_name = parse_formals(formals)
            body = to_py_list(args.cdr)
            return Procedure(params, rest_name, body, env)
        if is_symbol(op, "cond"):
            clauses = to_py_list(args)
            for clause in clauses:
                if not isinstance(clause, Pair):
                    raise LispError("invalid cond clause")
                test = clause.car
                body = to_py_list(clause.cdr)
                if is_symbol(test, "else") or truthy(eval_expr(test, env)):
                    if not body:
                        return eval_expr(test, env) if not is_symbol(test, "else") else None
                    return eval_sequence(body, env)
            return None
        if is_symbol(op, "let"):
            bindings = to_py_list(first(args))
            body = to_py_list(args.cdr)
            new_env = Env(outer=env)
            bound_names: list[str] = []
            bound_values: list[Any] = []
            for binding in bindings:
                if not isinstance(binding, Pair):
                    raise LispError("invalid let binding")
                var = binding.car
                if not isinstance(var, Symbol):
                    raise LispError("let binding name must be symbol")
                bound_names.append(str(var))
                bound_values.append(eval_expr(first(binding.cdr), env))
            for name, value in zip(bound_names, bound_values):
                new_env.define(name, value)
            expr = build_list([Symbol("begin"), *body]) if body else None
            env = new_env
            continue
        if is_symbol(op, "let*"):
            bindings = to_py_list(first(args))
            body = to_py_list(args.cdr)
            new_env = Env(outer=env)
            for binding in bindings:
                if not isinstance(binding, Pair):
                    raise LispError("invalid let* binding")
                var = binding.car
                if not isinstance(var, Symbol):
                    raise LispError("let* binding name must be symbol")
                value = eval_expr(first(binding.cdr), new_env)
                new_env.define(str(var), value)
            expr = build_list([Symbol("begin"), *body]) if body else None
            env = new_env
            continue
        if is_symbol(op, "and"):
            values = to_py_list(args)
            result: Any = True
            for form in values:
                result = eval_expr(form, env)
                if not truthy(result):
                    return False
            return result
        if is_symbol(op, "or"):
            values = to_py_list(args)
            for form in values:
                result = eval_expr(form, env)
                if truthy(result):
                    return result
            return False

        proc = eval_expr(op, env)
        if isinstance(proc, Procedure) and proc.is_macro:
            raw_args = to_py_list(args)
            macro_env = Env(outer=proc.env)
            bind_formals(macro_env, proc.params, proc.rest, raw_args)
            expr = eval_sequence(proc.body, macro_env)
            continue
        if isinstance(proc, Procedure):
            evaluated_args = [eval_expr(arg, env) for arg in to_py_list(args)]
            call_env = Env(outer=proc.env)
            bind_formals(call_env, proc.params, proc.rest, evaluated_args)
            if not proc.body:
                return None
            for form in proc.body[:-1]:
                eval_expr(form, call_env)
            expr = proc.body[-1]
            env = call_env
            continue
        evaluated_args = [eval_expr(arg, env) for arg in to_py_list(args)]
        result = apply_callable(proc, evaluated_args, env)
        return result


def ensure_list(value: Any) -> list[Any]:
    return to_py_list(value)


def builtin_add(args: list[Any], env: Env) -> Any:
    total = 0
    use_float = False
    for arg in args:
        if isinstance(arg, bool) or not isinstance(arg, (int, float)):
            raise LispError("+ expects numbers")
        if isinstance(arg, float):
            use_float = True
        total += arg
    return float(total) if use_float else total


def builtin_sub(args: list[Any], env: Env) -> Any:
    if not args:
        raise LispError("- expects at least one argument")
    if any(isinstance(arg, bool) or not isinstance(arg, (int, float)) for arg in args):
        raise LispError("- expects numbers")
    if len(args) == 1:
        return -args[0]
    result = args[0]
    for arg in args[1:]:
        result -= arg
    return result


def builtin_mul(args: list[Any], env: Env) -> Any:
    result = 1
    use_float = False
    for arg in args:
        if isinstance(arg, bool) or not isinstance(arg, (int, float)):
            raise LispError("* expects numbers")
        if isinstance(arg, float):
            use_float = True
        result *= arg
    return float(result) if use_float else result


def builtin_div(args: list[Any], env: Env) -> Any:
    if not args:
        raise LispError("/ expects at least one argument")
    if any(isinstance(arg, bool) or not isinstance(arg, (int, float)) for arg in args):
        raise LispError("/ expects numbers")
    result = args[0]
    if len(args) == 1:
        return 1 / result
    for arg in args[1:]:
        result /= arg
    return result


def builtin_modulo(args: list[Any], env: Env) -> Any:
    if len(args) != 2:
        raise LispError("modulo expects 2 arguments")
    if any(isinstance(arg, bool) or not isinstance(arg, int) for arg in args):
        raise LispError("modulo expects integers")
    return args[0] % args[1]


def builtin_numeric_predicate(op: Callable[[Any, Any], bool], args: list[Any], env: Env) -> Any:
    if len(args) < 2:
        return True
    for a, b in zip(args, args[1:]):
        if not op(a, b):
            return False
    return True


def builtin_eq(args: list[Any], env: Env) -> Any:
    return builtin_numeric_predicate(operator.eq, args, env)


def builtin_lt(args: list[Any], env: Env) -> Any:
    if any(isinstance(arg, bool) or not isinstance(arg, (int, float)) for arg in args):
        raise LispError("< expects numbers")
    return builtin_numeric_predicate(operator.lt, args, env)


def builtin_gt(args: list[Any], env: Env) -> Any:
    if any(isinstance(arg, bool) or not isinstance(arg, (int, float)) for arg in args):
        raise LispError("> expects numbers")
    return builtin_numeric_predicate(operator.gt, args, env)


def builtin_le(args: list[Any], env: Env) -> Any:
    if any(isinstance(arg, bool) or not isinstance(arg, (int, float)) for arg in args):
        raise LispError("<= expects numbers")
    return builtin_numeric_predicate(operator.le, args, env)


def builtin_ge(args: list[Any], env: Env) -> Any:
    if any(isinstance(arg, bool) or not isinstance(arg, (int, float)) for arg in args):
        raise LispError(">= expects numbers")
    return builtin_numeric_predicate(operator.ge, args, env)


def builtin_not(args: list[Any], env: Env) -> Any:
    if len(args) != 1:
        raise LispError("not expects 1 argument")
    return not truthy(args[0])


def builtin_cons(args: list[Any], env: Env) -> Any:
    if len(args) != 2:
        raise LispError("cons expects 2 arguments")
    return Pair(args[0], args[1])


def builtin_car(args: list[Any], env: Env) -> Any:
    if len(args) != 1 or not isinstance(args[0], Pair):
        raise LispError("car expects a non-empty list")
    return args[0].car


def builtin_cdr(args: list[Any], env: Env) -> Any:
    if len(args) != 1 or not isinstance(args[0], Pair):
        raise LispError("cdr expects a non-empty list")
    return args[0].cdr


def builtin_list(args: list[Any], env: Env) -> Any:
    return build_list(args)


def builtin_length(args: list[Any], env: Env) -> Any:
    if len(args) != 1:
        raise LispError("length expects 1 argument")
    return len(to_py_list(args[0]))


def builtin_append(args: list[Any], env: Env) -> Any:
    if not args:
        return NIL
    items: list[Any] = []
    for value in args[:-1]:
        items.extend(to_py_list(value))
    last = args[-1]
    if last is NIL:
        return build_list(items)
    if isinstance(last, Pair):
        items.extend(to_py_list(last))
        return build_list(items)
    if last is NIL:
        return build_list(items)
    return build_list(items, last)


def builtin_map(args: list[Any], env: Env) -> Any:
    if len(args) != 2:
        raise LispError("map expects 2 arguments")
    proc, seq = args
    result = []
    for item in to_py_list(seq):
        result.append(apply_callable(proc, [item], env))
    return build_list(result)


def builtin_filter(args: list[Any], env: Env) -> Any:
    if len(args) != 2:
        raise LispError("filter expects 2 arguments")
    proc, seq = args
    result = []
    for item in to_py_list(seq):
        if truthy(apply_callable(proc, [item], env)):
            result.append(item)
    return build_list(result)


def builtin_nullp(args: list[Any], env: Env) -> Any:
    if len(args) != 1:
        raise LispError("null? expects 1 argument")
    return args[0] is NIL


def builtin_pairp(args: list[Any], env: Env) -> Any:
    if len(args) != 1:
        raise LispError("pair? expects 1 argument")
    return isinstance(args[0], Pair)


def builtin_listp(args: list[Any], env: Env) -> Any:
    if len(args) != 1:
        raise LispError("list? expects 1 argument")
    return is_list(args[0])


def builtin_string_length(args: list[Any], env: Env) -> Any:
    if len(args) != 1 or not isinstance(args[0], str):
        raise LispError("string-length expects 1 string")
    return len(args[0])


def builtin_string_append(args: list[Any], env: Env) -> Any:
    if not all(isinstance(a, str) for a in args):
        raise LispError("string-append expects strings")
    return "".join(args)


def builtin_substring(args: list[Any], env: Env) -> Any:
    if len(args) != 3 or not isinstance(args[0], str):
        raise LispError("substring expects string start end")
    start, end = int(args[1]), int(args[2])
    return args[0][start:end]


def builtin_string_to_number(args: list[Any], env: Env) -> Any:
    if len(args) != 1 or not isinstance(args[0], str):
        raise LispError("string->number expects 1 string")
    text = args[0].strip()
    try:
        return int(text)
    except ValueError:
        try:
            return float(text)
        except ValueError:
            raise LispError("invalid numeric string")


def builtin_number_to_string(args: list[Any], env: Env) -> Any:
    if len(args) != 1 or not isinstance(args[0], (int, float)):
        raise LispError("number->string expects 1 number")
    if isinstance(args[0], bool):
        raise LispError("number->string expects 1 number")
    return str(args[0])


def builtin_display(args: list[Any], env: Env) -> Any:
    if len(args) != 1:
        raise LispError("display expects 1 argument")
    sys.stdout.write(stringify_display(args[0]))
    sys.stdout.flush()
    return None


def builtin_newline(args: list[Any], env: Env) -> Any:
    if args:
        raise LispError("newline expects no arguments")
    sys.stdout.write("\n")
    sys.stdout.flush()
    return None


def builtin_print(args: list[Any], env: Env) -> Any:
    if len(args) != 1:
        raise LispError("print expects 1 argument")
    sys.stdout.write(format_value(args[0]) + "\n")
    sys.stdout.flush()
    return None


def builtin_exit(args: list[Any], env: Env) -> Any:
    raise SystemExit(0)


def standard_env() -> Env:
    env = Env()
    builtins: dict[str, Any] = {
        "+": builtin_add,
        "-": builtin_sub,
        "*": builtin_mul,
        "/": builtin_div,
        "modulo": builtin_modulo,
        "=": builtin_eq,
        "<": builtin_lt,
        ">": builtin_gt,
        "<=": builtin_le,
        ">=": builtin_ge,
        "not": builtin_not,
        "cons": builtin_cons,
        "car": builtin_car,
        "cdr": builtin_cdr,
        "list": builtin_list,
        "length": builtin_length,
        "append": builtin_append,
        "map": builtin_map,
        "filter": builtin_filter,
        "null?": builtin_nullp,
        "pair?": builtin_pairp,
        "list?": builtin_listp,
        "string-length": builtin_string_length,
        "string-append": builtin_string_append,
        "substring": builtin_substring,
        "string->number": builtin_string_to_number,
        "number->string": builtin_number_to_string,
        "display": builtin_display,
        "newline": builtin_newline,
        "print": builtin_print,
        "exit": builtin_exit,
    }
    for name, fn in builtins.items():
        env.define(name, fn)
    return env


def eval_program(source: str, env: Optional[Env] = None, *, print_results: bool = False) -> Any:
    if env is None:
        env = standard_env()
    last: Any = None
    for expr in parse(source):
        last = eval_expr(expr, env)
        if print_results and last is not None:
            print(format_value(last))
    return last


def repl() -> None:
    env = standard_env()
    buffer = ""
    while True:
        prompt = "lisp> " if not buffer else "... "
        try:
            line = input(prompt)
        except EOFError:
            break
        if not buffer and line.strip() == "":
            continue
        buffer += line + "\n"
        try:
            exprs = parse(buffer)
        except EOFError:
            continue
        except LispError as exc:
            print(f"error: {exc}", file=sys.stderr)
            buffer = ""
            continue
        buffer = ""
        try:
            for expr in exprs:
                value = eval_expr(expr, env)
                if value is not None:
                    print(format_value(value))
        except SystemExit:
            break
        except Exception as exc:
            print(f"error: {exc}", file=sys.stderr)


def run_file(path: str) -> None:
    with open(path, "r", encoding="utf-8") as fh:
        source = fh.read()
    env = standard_env()
    try:
        eval_program(source, env, print_results=False)
    except SystemExit:
        return


def main(argv: Optional[list[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        if not argv:
            repl()
            return 0
        if len(argv) == 1:
            run_file(argv[0])
            return 0
        print("usage: python lisp.py [file.lisp]", file=sys.stderr)
        return 2
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else 0
        return code
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
