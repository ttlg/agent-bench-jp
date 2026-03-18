#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from dataclasses import dataclass


class LispError(Exception):
    pass


class ExitSignal(Exception):
    pass


class Symbol(str):
    pass


class StringToken(str):
    pass


@dataclass
class DottedList:
    items: list
    tail: object


@dataclass
class ParamSpec:
    required: list
    rest: Symbol | None = None


class Env:
    __slots__ = ("data", "outer")

    def __init__(self, data=None, outer: Env | None = None):
        self.data = {} if data is None else dict(data)
        self.outer = outer

    def find(self, name):
        if name in self.data:
            return self
        if self.outer is None:
            raise LispError(f"unbound symbol: {name}")
        return self.outer.find(name)

    def get(self, name):
        return self.find(name).data[name]

    def set(self, name, value):
        self.find(name).data[name] = value

    def define(self, name, value):
        self.data[name] = value


class Builtin:
    __slots__ = ("name", "func")

    def __init__(self, name, func):
        self.name = name
        self.func = func

    def __repr__(self):
        return f"<builtin {self.name}>"


@dataclass
class Procedure:
    params: ParamSpec
    body: list
    env: Env
    name: str | None = None

    def __repr__(self):
        return f"<procedure {self.name}>" if self.name else "<procedure>"


@dataclass
class Macro:
    params: ParamSpec
    body: list
    env: Env
    name: str | None = None

    def __repr__(self):
        return f"<macro {self.name}>" if self.name else "<macro>"


UNSPECIFIED = object()

_INT_RE = re.compile(r"^[+-]?\d+$")
_FLOAT_RE = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")


def is_symbol(value):
    return isinstance(value, Symbol)


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_string(value):
    return isinstance(value, str) and not isinstance(value, Symbol)


def is_list(value):
    return isinstance(value, list)


def is_dotted_list(value):
    return isinstance(value, DottedList)


def is_pair(value):
    return (isinstance(value, list) and len(value) > 0) or isinstance(value, DottedList)


def is_null(value):
    return isinstance(value, list) and len(value) == 0


def is_true(value):
    return value is not False


def ensure(condition, message):
    if not condition:
        raise LispError(message)


def tokenize(source: str) -> list:
    tokens = []
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
        if ch == '"':
            i += 1
            buf = []
            while i < n:
                cur = source[i]
                if cur == "\\":
                    i += 1
                    if i >= n:
                        raise LispError("unterminated string literal")
                    esc = source[i]
                    buf.append({
                        "n": "\n",
                        "r": "\r",
                        "t": "\t",
                        "\\": "\\",
                        '"': '"',
                    }.get(esc, esc))
                    i += 1
                    continue
                if cur == '"':
                    i += 1
                    break
                buf.append(cur)
                i += 1
            else:
                raise LispError("unterminated string literal")
            tokens.append(StringToken("".join(buf)))
            continue
        if ch in "()'`":
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
        if ch == "." and (i + 1 == n or source[i + 1].isspace() or source[i + 1] in "();'`,"):
            tokens.append(".")
            i += 1
            continue

        start = i
        while i < n and source[i] not in " \t\r\n();'`,\"":
            i += 1
        tokens.append(source[start:i])
    return tokens


def atom(token: str):
    if token == "#t":
        return True
    if token == "#f":
        return False
    if token == "nil":
        return []
    if _INT_RE.fullmatch(token):
        return int(token)
    if _FLOAT_RE.fullmatch(token):
        return float(token)
    return Symbol(token)


def read_expr(tokens, pos):
    if pos >= len(tokens):
        raise LispError("unexpected EOF")

    token = tokens[pos]
    pos += 1

    if token == "(":
        items = []
        while True:
            if pos >= len(tokens):
                raise LispError("unexpected EOF while reading list")
            if tokens[pos] == ")":
                pos += 1
                return items, pos
            if tokens[pos] == ".":
                ensure(items, "dot cannot appear at the start of a list")
                pos += 1
                tail, pos = read_expr(tokens, pos)
                ensure(pos < len(tokens) and tokens[pos] == ")", "dotted list missing closing parenthesis")
                pos += 1
                return DottedList(items, tail), pos
            item, pos = read_expr(tokens, pos)
            items.append(item)

    if token == ")":
        raise LispError("unexpected ')'")
    if token == "'":
        expr, pos = read_expr(tokens, pos)
        return [Symbol("quote"), expr], pos
    if token == "`":
        expr, pos = read_expr(tokens, pos)
        return [Symbol("quasiquote"), expr], pos
    if token == ",":
        expr, pos = read_expr(tokens, pos)
        return [Symbol("unquote"), expr], pos
    if token == ",@":
        expr, pos = read_expr(tokens, pos)
        return [Symbol("unquote-splicing"), expr], pos
    if isinstance(token, StringToken):
        return str(token), pos
    return atom(token), pos


def parse_program(source: str):
    tokens = tokenize(source)
    exprs = []
    pos = 0
    while pos < len(tokens):
        expr, pos = read_expr(tokens, pos)
        exprs.append(expr)
    return exprs


def escape_string(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def scheme_str(value) -> str:
    if value is UNSPECIFIED:
        return ""
    if value is True:
        return "#t"
    if value is False:
        return "#f"
    if isinstance(value, Symbol):
        return str(value)
    if is_string(value):
        return f'"{escape_string(value)}"'
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, list):
        return "(" + " ".join(scheme_str(item) for item in value) + ")"
    if isinstance(value, DottedList):
        items = " ".join(scheme_str(item) for item in value.items)
        if items:
            return f"({items} . {scheme_str(value.tail)})"
        return f"(. {scheme_str(value.tail)})"
    return str(value)


def display_text(value) -> str:
    if is_string(value):
        return value
    return scheme_str(value)


def parse_formals(formals):
    if isinstance(formals, Symbol):
        return ParamSpec([], formals)
    if isinstance(formals, list):
        for item in formals:
            ensure(isinstance(item, Symbol), "parameter names must be symbols")
        return ParamSpec(list(formals), None)
    if isinstance(formals, DottedList):
        required = []
        for item in formals.items:
            ensure(isinstance(item, Symbol), "parameter names must be symbols")
            required.append(item)
        ensure(isinstance(formals.tail, Symbol), "rest parameter must be a symbol")
        return ParamSpec(required, formals.tail)
    raise LispError("invalid parameter list")


def parse_define_target(target):
    if isinstance(target, Symbol):
        return target, None
    if isinstance(target, list):
        ensure(target, "invalid definition target")
        name = target[0]
        ensure(isinstance(name, Symbol), "definition name must be a symbol")
        return name, parse_formals(target[1:])
    if isinstance(target, DottedList):
        ensure(target.items, "invalid definition target")
        name = target.items[0]
        ensure(isinstance(name, Symbol), "definition name must be a symbol")
        return name, parse_formals(DottedList(target.items[1:], target.tail))
    raise LispError("invalid definition target")


def sequence_to_expr(exprs):
    if not exprs:
        return []
    if len(exprs) == 1:
        return exprs[0]
    return [Symbol("begin"), *exprs]


def eval_sequence(exprs, env):
    if not exprs:
        return []
    for expr in exprs[:-1]:
        eval_expr(expr, env)
    return eval_expr(exprs[-1], env)


def eval_quasiquote(expr, env, depth=1):
    if isinstance(expr, DottedList):
        return DottedList(
            [eval_quasiquote(item, env, depth) for item in expr.items],
            eval_quasiquote(expr.tail, env, depth),
        )
    if not isinstance(expr, list):
        return expr
    if not expr:
        return []

    head = expr[0]
    if isinstance(head, Symbol):
        if head == "quasiquote":
            ensure(len(expr) == 2, "quasiquote expects one argument")
            return [Symbol("quasiquote"), eval_quasiquote(expr[1], env, depth + 1)]
        if head == "unquote":
            ensure(len(expr) == 2, "unquote expects one argument")
            if depth == 1:
                return eval_expr(expr[1], env)
            return [Symbol("unquote"), eval_quasiquote(expr[1], env, depth - 1)]
        if head == "unquote-splicing":
            ensure(len(expr) == 2, "unquote-splicing expects one argument")
            if depth == 1:
                raise LispError("unquote-splicing is only valid inside a list")
            return [Symbol("unquote-splicing"), eval_quasiquote(expr[1], env, depth - 1)]

    result = []
    for item in expr:
        if (
            isinstance(item, list)
            and item
            and isinstance(item[0], Symbol)
            and item[0] == "unquote-splicing"
        ):
            ensure(len(item) == 2, "unquote-splicing expects one argument")
            if depth == 1:
                splice = eval_expr(item[1], env)
                ensure(isinstance(splice, list), "unquote-splicing expects a list")
                result.extend(splice)
            else:
                result.append([Symbol("unquote-splicing"), eval_quasiquote(item[1], env, depth - 1)])
            continue
        result.append(eval_quasiquote(item, env, depth))
    return result


def bind_params(env, params: ParamSpec, args):
    if params.rest is None:
        ensure(
            len(args) == len(params.required),
            f"expected {len(params.required)} arguments, got {len(args)}",
        )
        for name, value in zip(params.required, args):
            env.define(name, value)
        return

    ensure(
        len(args) >= len(params.required),
        f"expected at least {len(params.required)} arguments, got {len(args)}",
    )
    for name, value in zip(params.required, args[: len(params.required)]):
        env.define(name, value)
    env.define(params.rest, list(args[len(params.required) :]))


def procedure_body_expr(body):
    return sequence_to_expr(body)


def apply_callable(proc, args):
    if isinstance(proc, Builtin):
        return proc.func(args)
    if isinstance(proc, Procedure):
        new_env = Env(outer=proc.env)
        bind_params(new_env, proc.params, args)
        return eval_sequence(proc.body, new_env)
    if isinstance(proc, Macro):
        raise LispError("macros cannot be used as runtime procedures")
    raise LispError(f"attempt to call non-procedure: {scheme_str(proc)}")


def apply_macro(macro, raw_args):
    new_env = Env(outer=macro.env)
    bind_params(new_env, macro.params, raw_args)
    return eval_sequence(macro.body, new_env)


def eval_expr(expr, env):
    x = expr
    while True:
        if isinstance(x, Symbol):
            return env.get(x)
        if isinstance(x, DottedList):
            return x
        if not isinstance(x, list):
            return x
        if not x:
            return []

        op = x[0]
        if isinstance(op, Symbol):
            if op == "quote":
                ensure(len(x) == 2, "quote expects one argument")
                return x[1]

            if op == "quasiquote":
                ensure(len(x) == 2, "quasiquote expects one argument")
                return eval_quasiquote(x[1], env)

            if op == "if":
                ensure(3 <= len(x) <= 4, "if expects 2 or 3 arguments")
                test = eval_expr(x[1], env)
                x = x[2] if is_true(test) else (x[3] if len(x) == 4 else [])
                continue

            if op == "begin":
                if len(x) == 1:
                    return []
                for expr in x[1:-1]:
                    eval_expr(expr, env)
                x = x[-1]
                continue

            if op == "define":
                ensure(len(x) >= 3, "define expects a name and a value")
                target = x[1]
                if isinstance(target, Symbol):
                    ensure(len(x) == 3, "define expects exactly one value expression")
                    env.define(target, eval_expr(x[2], env))
                    return UNSPECIFIED
                name, params = parse_define_target(target)
                body = x[2:]
                env.define(name, Procedure(params, body, env, name=str(name)))
                return UNSPECIFIED

            if op == "define-macro":
                ensure(len(x) >= 3, "define-macro expects a name and a body")
                target = x[1]
                name, params = parse_define_target(target)
                ensure(params is not None, "macro definition requires parameter list")
                body = x[2:]
                env.define(name, Macro(params, body, env, name=str(name)))
                return UNSPECIFIED

            if op == "set!":
                ensure(len(x) == 3, "set! expects a name and a value")
                name = x[1]
                ensure(isinstance(name, Symbol), "set! target must be a symbol")
                env.set(name, eval_expr(x[2], env))
                return UNSPECIFIED

            if op == "lambda":
                ensure(len(x) >= 3, "lambda expects a parameter list and a body")
                params = parse_formals(x[1])
                body = x[2:]
                return Procedure(params, body, env)

            if op == "cond":
                ensure(len(x) >= 2, "cond expects at least one clause")
                for clause in x[1:]:
                    ensure(isinstance(clause, list), "cond clause must be a list")
                    ensure(clause, "cond clause cannot be empty")
                    head = clause[0]
                    if isinstance(head, Symbol) and head == "else":
                        body = clause[1:]
                        if not body:
                            return []
                        if len(body) == 1:
                            x = body[0]
                            break
                        for expr in body[:-1]:
                            eval_expr(expr, env)
                        x = body[-1]
                        break
                    test = eval_expr(head, env)
                    if is_true(test):
                        body = clause[1:]
                        if not body:
                            return test
                        if len(body) == 1:
                            x = body[0]
                            break
                        for expr in body[:-1]:
                            eval_expr(expr, env)
                        x = body[-1]
                        break
                else:
                    return []
                continue

            if op == "let":
                ensure(len(x) >= 3, "let expects bindings and a body")
                bindings = x[1]
                ensure(isinstance(bindings, list), "let bindings must be a list")
                new_env = Env(outer=env)
                for binding in bindings:
                    ensure(isinstance(binding, list) and len(binding) == 2, "each let binding must have two elements")
                    name = binding[0]
                    ensure(isinstance(name, Symbol), "let binding name must be a symbol")
                    new_env.define(name, eval_expr(binding[1], env))
                body = x[2:]
                if not body:
                    return []
                env = new_env
                x = sequence_to_expr(body)
                continue

            if op == "let*":
                ensure(len(x) >= 3, "let* expects bindings and a body")
                bindings = x[1]
                ensure(isinstance(bindings, list), "let* bindings must be a list")
                new_env = Env(outer=env)
                for binding in bindings:
                    ensure(isinstance(binding, list) and len(binding) == 2, "each let* binding must have two elements")
                    name = binding[0]
                    ensure(isinstance(name, Symbol), "let* binding name must be a symbol")
                    new_env.define(name, eval_expr(binding[1], new_env))
                body = x[2:]
                if not body:
                    return []
                env = new_env
                x = sequence_to_expr(body)
                continue

            if op == "and":
                if len(x) == 1:
                    return True
                for expr in x[1:-1]:
                    value = eval_expr(expr, env)
                    if value is False:
                        return False
                x = x[-1]
                continue

            if op == "or":
                if len(x) == 1:
                    return False
                for expr in x[1:-1]:
                    value = eval_expr(expr, env)
                    if is_true(value):
                        return value
                x = x[-1]
                continue

        proc = eval_expr(op, env)
        if isinstance(proc, Macro):
            x = apply_macro(proc, x[1:])
            continue

        args = [eval_expr(arg, env) for arg in x[1:]]
        if isinstance(proc, Builtin):
            return proc.func(args)
        if isinstance(proc, Procedure):
            new_env = Env(outer=proc.env)
            bind_params(new_env, proc.params, args)
            env = new_env
            x = procedure_body_expr(proc.body)
            continue
        raise LispError(f"attempt to call non-procedure: {scheme_str(proc)}")


def require_arity(name, args, exact=None, min_args=None, max_args=None):
    if exact is not None:
        ensure(len(args) == exact, f"{name} expects {exact} arguments")
        return
    if min_args is not None:
        ensure(len(args) >= min_args, f"{name} expects at least {min_args} arguments")
    if max_args is not None:
        ensure(len(args) <= max_args, f"{name} expects at most {max_args} arguments")


def proper_list(value, name="list"):
    if isinstance(value, list):
        return value
    raise LispError(f"{name} expects a proper list")


def builtin_add(args):
    total = 0
    for value in args:
        ensure(is_number(value), "+ expects numbers")
        total += value
    return total


def builtin_sub(args):
    ensure(args, "- expects at least one argument")
    for value in args:
        ensure(is_number(value), "- expects numbers")
    if len(args) == 1:
        return -args[0]
    result = args[0]
    for value in args[1:]:
        result -= value
    return result


def builtin_mul(args):
    result = 1
    for value in args:
        ensure(is_number(value), "* expects numbers")
        result *= value
    return result


def builtin_div(args):
    ensure(args, "/ expects at least one argument")
    for value in args:
        ensure(is_number(value), "/ expects numbers")
    if len(args) == 1:
        return 1 / args[0]
    result = args[0]
    for value in args[1:]:
        result /= value
    return result


def builtin_modulo(args):
    require_arity("modulo", args, exact=2)
    ensure(all(isinstance(value, int) and not isinstance(value, bool) for value in args), "modulo expects integers")
    return args[0] % args[1]


def chain_compare(args, comparator, name):
    if len(args) < 2:
        return True
    for left, right in zip(args, args[1:]):
        ensure(is_number(left) and is_number(right), f"{name} expects numbers")
        if not comparator(left, right):
            return False
    return True


def builtin_eq(args):
    return chain_compare(args, lambda a, b: a == b, "=")


def builtin_lt(args):
    return chain_compare(args, lambda a, b: a < b, "<")


def builtin_gt(args):
    return chain_compare(args, lambda a, b: a > b, ">")


def builtin_le(args):
    return chain_compare(args, lambda a, b: a <= b, "<=")


def builtin_ge(args):
    return chain_compare(args, lambda a, b: a >= b, ">=")


def builtin_not(args):
    require_arity("not", args, exact=1)
    return False if is_true(args[0]) else True


def builtin_cons(args):
    require_arity("cons", args, exact=2)
    head, tail = args
    if isinstance(tail, list):
        return [head, *tail]
    if isinstance(tail, DottedList):
        return DottedList([head, *tail.items], tail.tail)
    return DottedList([head], tail)


def builtin_car(args):
    require_arity("car", args, exact=1)
    value = args[0]
    if isinstance(value, list):
        ensure(value, "car expects a non-empty list")
        return value[0]
    if isinstance(value, DottedList):
        ensure(value.items, "car expects a non-empty pair")
        return value.items[0]
    raise LispError("car expects a pair")


def builtin_cdr(args):
    require_arity("cdr", args, exact=1)
    value = args[0]
    if isinstance(value, list):
        ensure(value, "cdr expects a non-empty list")
        return value[1:]
    if isinstance(value, DottedList):
        ensure(value.items, "cdr expects a non-empty pair")
        if len(value.items) == 1:
            return value.tail
        return DottedList(value.items[1:], value.tail)
    raise LispError("cdr expects a pair")


def builtin_list(args):
    return list(args)


def builtin_length(args):
    require_arity("length", args, exact=1)
    return len(proper_list(args[0], "length"))


def builtin_append(args):
    if not args:
        return []
    items = []
    for value in args[:-1]:
        ensure(isinstance(value, list), "append expects proper lists except possibly the last argument")
        items.extend(value)
    last = args[-1]
    if isinstance(last, list):
        items.extend(last)
        return items
    if isinstance(last, DottedList):
        return DottedList(items + list(last.items), last.tail)
    return DottedList(items, last)


def builtin_map(args):
    require_arity("map", args, exact=2)
    proc, lst = args
    items = proper_list(lst, "map")
    return [apply_callable(proc, [item]) for item in items]


def builtin_filter(args):
    require_arity("filter", args, exact=2)
    proc, lst = args
    items = proper_list(lst, "filter")
    result = []
    for item in items:
        if is_true(apply_callable(proc, [item])):
            result.append(item)
    return result


def builtin_nullp(args):
    require_arity("null?", args, exact=1)
    return True if is_null(args[0]) else False


def builtin_pairp(args):
    require_arity("pair?", args, exact=1)
    return True if is_pair(args[0]) else False


def builtin_listp(args):
    require_arity("list?", args, exact=1)
    return True if isinstance(args[0], list) else False


def builtin_symbolp(args):
    require_arity("symbol?", args, exact=1)
    return True if isinstance(args[0], Symbol) else False


def builtin_numberp(args):
    require_arity("number?", args, exact=1)
    return True if is_number(args[0]) else False


def builtin_stringp(args):
    require_arity("string?", args, exact=1)
    return True if is_string(args[0]) else False


def builtin_booleanp(args):
    require_arity("boolean?", args, exact=1)
    return True if isinstance(args[0], bool) else False


def builtin_procedurep(args):
    require_arity("procedure?", args, exact=1)
    return True if isinstance(args[0], (Builtin, Procedure)) else False


def builtin_string_length(args):
    require_arity("string-length", args, exact=1)
    ensure(is_string(args[0]), "string-length expects a string")
    return len(args[0])


def builtin_string_append(args):
    for value in args:
        ensure(is_string(value), "string-append expects strings")
    return "".join(args)


def builtin_substring(args):
    require_arity("substring", args, exact=3)
    string, start, end = args
    ensure(is_string(string), "substring expects a string")
    ensure(isinstance(start, int) and not isinstance(start, bool), "substring expects integer indices")
    ensure(isinstance(end, int) and not isinstance(end, bool), "substring expects integer indices")
    return string[start:end]


def builtin_string_to_number(args):
    require_arity("string->number", args, exact=1)
    ensure(is_string(args[0]), "string->number expects a string")
    text = args[0].strip()
    try:
        if _INT_RE.fullmatch(text):
            return int(text)
        if _FLOAT_RE.fullmatch(text):
            return float(text)
    except ValueError:
        pass
    return False


def builtin_number_to_string(args):
    require_arity("number->string", args, exact=1)
    ensure(is_number(args[0]), "number->string expects a number")
    return str(args[0])


def builtin_display(args):
    sys.stdout.write("".join(display_text(value) for value in args))
    sys.stdout.flush()
    return UNSPECIFIED


def builtin_newline(args):
    sys.stdout.write("\n")
    sys.stdout.flush()
    return UNSPECIFIED


def builtin_print(args):
    sys.stdout.write(" ".join(scheme_str(value) for value in args) + "\n")
    sys.stdout.flush()
    return UNSPECIFIED


def builtin_exit(args):
    if args:
        raise LispError("exit expects no arguments")
    raise ExitSignal()


def standard_env():
    env = Env()
    for name, func in [
        ("+", builtin_add),
        ("-", builtin_sub),
        ("*", builtin_mul),
        ("/", builtin_div),
        ("modulo", builtin_modulo),
        ("=", builtin_eq),
        ("<", builtin_lt),
        (">", builtin_gt),
        ("<=", builtin_le),
        (">=", builtin_ge),
        ("not", builtin_not),
        ("cons", builtin_cons),
        ("car", builtin_car),
        ("cdr", builtin_cdr),
        ("list", builtin_list),
        ("length", builtin_length),
        ("append", builtin_append),
        ("map", builtin_map),
        ("filter", builtin_filter),
        ("null?", builtin_nullp),
        ("pair?", builtin_pairp),
        ("list?", builtin_listp),
        ("symbol?", builtin_symbolp),
        ("number?", builtin_numberp),
        ("string?", builtin_stringp),
        ("boolean?", builtin_booleanp),
        ("procedure?", builtin_procedurep),
        ("string-length", builtin_string_length),
        ("string-append", builtin_string_append),
        ("substring", builtin_substring),
        ("string->number", builtin_string_to_number),
        ("number->string", builtin_number_to_string),
        ("display", builtin_display),
        ("newline", builtin_newline),
        ("print", builtin_print),
        ("exit", builtin_exit),
    ]:
        env.define(Symbol(name), Builtin(name, func))
    return env


def run_source(source: str, env: Env | None = None, echo: bool = False):
    env = standard_env() if env is None else env
    result = UNSPECIFIED
    for expr in parse_program(source):
        result = eval_expr(expr, env)
        if echo and result is not UNSPECIFIED:
            print(scheme_str(result))
    return result


def paren_balance(source: str) -> int:
    balance = 0
    i = 0
    n = len(source)
    in_string = False
    while i < n:
        ch = source[i]
        if in_string:
            if ch == "\\":
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == ";":
            while i < n and source[i] != "\n":
                i += 1
            continue
        if ch == '"':
            in_string = True
            i += 1
            continue
        if ch == "(":
            balance += 1
        elif ch == ")":
            balance -= 1
        i += 1
    return balance


def repl():
    env = standard_env()
    buffer = ""
    prompt = "lisp> "
    cont_prompt = "...   "
    while True:
        try:
            line = input(prompt if not buffer else cont_prompt)
        except EOFError:
            print()
            break
        except KeyboardInterrupt:
            print()
            break

        buffer += line + "\n"
        balance = paren_balance(buffer)
        if balance > 0:
            continue

        try:
            run_source(buffer, env=env, echo=True)
        except ExitSignal:
            break
        except LispError as exc:
            print(f"Error: {exc}", file=sys.stderr)
        finally:
            buffer = ""


def main(argv=None):
    argv = sys.argv[1:] if argv is None else list(argv)
    if not argv:
        repl()
        return 0
    if len(argv) == 1:
        path = argv[0]
        try:
            with open(path, "r", encoding="utf-8") as handle:
                source = handle.read()
            run_source(source)
            return 0
        except ExitSignal:
            return 0
        except OSError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        except LispError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
    print("Usage: python lisp.py [file.lisp]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
