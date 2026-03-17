import math
import operator
import sys
from dataclasses import dataclass


class LispError(Exception):
    pass


class ParseError(LispError):
    pass


class Symbol(str):
    pass


class NilType:
    def __bool__(self):
        return False

    def __repr__(self):
        return "nil"


nil = NilType()


class Splice:
    def __init__(self, value):
        self.value = value


@dataclass
class Procedure:
    params: list
    body: list
    env: "Env"

    def __call__(self, args, evaluator):
        env = bind_params(self.params, args, self.env)
        return evaluator.eval_sequence(self.body, env)


@dataclass
class Macro:
    params: list
    body: list
    env: "Env"

    def expand(self, raw_args, evaluator, call_env):
        env = bind_params(self.params, raw_args, self.env)
        return evaluator.eval_sequence(self.body, env)


class Builtin:
    def __init__(self, fn, name=None):
        self.fn = fn
        self.name = name or getattr(fn, "__name__", "builtin")

    def __call__(self, args, evaluator):
        return self.fn(*args)

    def __repr__(self):
        return f"<builtin {self.name}>"


class Env(dict):
    def __init__(self, params=(), args=(), outer=None):
        super().__init__(zip(params, args))
        self.outer = outer

    def find(self, name):
        if name in self:
            return self
        if self.outer is not None:
            return self.outer.find(name)
        raise LispError(f"undefined symbol: {name}")


class TailCall:
    def __init__(self, expr, env):
        self.expr = expr
        self.env = env


def truthy(value):
    return value not in (False, nil)


def split_params(params):
    if isinstance(params, Symbol):
        return [], params
    if not isinstance(params, list):
        raise LispError("invalid parameter list")
    if Symbol(".") in params:
        dot = params.index(Symbol("."))
        if dot != len(params) - 2:
            raise LispError("invalid dotted parameter list")
        return params[:dot], params[dot + 1]
    return params, None


def bind_params(params, args, outer):
    positional, rest = split_params(params)
    if rest is None:
        if len(args) != len(positional):
            raise LispError(f"expected {len(positional)} args, got {len(args)}")
        return Env(positional, args, outer)
    if len(args) < len(positional):
        raise LispError(f"expected at least {len(positional)} args, got {len(args)}")
    env = Env(positional, args[: len(positional)], outer)
    env[rest] = list(args[len(positional) :]) or nil
    return env


def to_lisp_str(value):
    if value is True:
        return "#t"
    if value is False:
        return "#f"
    if value is nil:
        return "nil"
    if isinstance(value, Symbol):
        return value
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'
    if isinstance(value, list):
        return "(" + " ".join(to_lisp_str(v) for v in value) + ")"
    return str(value)


def tokenize(source):
    tokens = []
    i = 0
    while i < len(source):
        ch = source[i]
        if ch.isspace():
            i += 1
            continue
        if ch == ";":
            while i < len(source) and source[i] != "\n":
                i += 1
            continue
        if source.startswith(",@", i):
            tokens.append(",@")
            i += 2
            continue
        if ch in "()'`,":
            tokens.append(ch)
            i += 1
            continue
        if ch == '"':
            i += 1
            buf = []
            while i < len(source):
                c = source[i]
                if c == "\\":
                    i += 1
                    if i >= len(source):
                        raise ParseError("unterminated string")
                    esc = source[i]
                    buf.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(esc, esc))
                elif c == '"':
                    i += 1
                    break
                else:
                    buf.append(c)
                i += 1
            else:
                raise ParseError("unterminated string")
            tokens.append(("STRING", "".join(buf)))
            continue
        j = i
        while j < len(source) and not source[j].isspace() and source[j] not in "()'`,":
            j += 1
        tokens.append(source[i:j])
        i = j
    return tokens


def atom(token):
    if isinstance(token, tuple) and token[0] == "STRING":
        return token[1]
    if token == "#t":
        return True
    if token == "#f":
        return False
    if token == "nil":
        return nil
    try:
        return int(token)
    except ValueError:
        try:
            return float(token)
        except ValueError:
            return Symbol(token)


def parse_tokens(tokens):
    pos = 0

    def parse_expr():
        nonlocal pos
        if pos >= len(tokens):
            raise ParseError("unexpected EOF")
        token = tokens[pos]
        pos += 1
        if token == "(":
            items = []
            while True:
                if pos >= len(tokens):
                    raise ParseError("missing ')'")
                if tokens[pos] == ")":
                    pos += 1
                    return items
                items.append(parse_expr())
        if token == ")":
            raise ParseError("unexpected ')'")
        if token == "'":
            return [Symbol("quote"), parse_expr()]
        if token == "`":
            return [Symbol("quasiquote"), parse_expr()]
        if token == ",":
            return [Symbol("unquote"), parse_expr()]
        if token == ",@":
            return [Symbol("unquote-splicing"), parse_expr()]
        return atom(token)

    exprs = []
    while pos < len(tokens):
        exprs.append(parse_expr())
    return exprs


def parse(source):
    return parse_tokens(tokenize(source))


def require_list(value, name):
    if value is nil:
        return []
    if not isinstance(value, list):
        raise LispError(f"{name} expects list")
    return value


def numeric_compare(op):
    def inner(*args):
        if len(args) < 2:
            return True
        for a, b in zip(args, args[1:]):
            if not op(a, b):
                return False
        return True
    return inner


def standard_env(output_stream=None):
    out = output_stream or sys.stdout

    def display(value):
        out.write(value if isinstance(value, str) else to_lisp_str(value))
        return nil

    def newline():
        out.write("\n")
        return nil

    def printer(value):
        out.write(to_lisp_str(value) + "\n")
        return nil

    def cons(a, b):
        if b is nil:
            return [a]
        if not isinstance(b, list):
            raise LispError("cons expects list as second arg")
        return [a] + b

    def car(lst):
        lst = require_list(lst, "car")
        if not lst:
            raise LispError("car on empty list")
        return lst[0]

    def cdr(lst):
        lst = require_list(lst, "cdr")
        if not lst:
            raise LispError("cdr on empty list")
        return lst[1:] or nil

    def make_list(*args):
        return list(args) if args else nil

    def length(lst):
        return len(require_list(lst, "length"))

    def append(*lists):
        result = []
        for lst in lists:
            result.extend(require_list(lst, "append"))
        return result or nil

    env = Env()
    env.update(
        {
            Symbol("+"): Builtin(lambda *a: sum(a), "+"),
            Symbol("-"): Builtin(lambda a, *rest: -a if not rest else a - sum(rest), "-"),
            Symbol("*"): Builtin(lambda *a: math.prod(a) if a else 1, "*"),
            Symbol("/"): Builtin(lambda a, *rest: divide(a, rest), "/"),
            Symbol("modulo"): Builtin(lambda a, b: a % b, "modulo"),
            Symbol("="): Builtin(numeric_compare(operator.eq), "="),
            Symbol("<"): Builtin(numeric_compare(operator.lt), "<"),
            Symbol(">"): Builtin(numeric_compare(operator.gt), ">"),
            Symbol("<="): Builtin(numeric_compare(operator.le), "<="),
            Symbol(">="): Builtin(numeric_compare(operator.ge), ">="),
            Symbol("not"): Builtin(lambda x: not truthy(x), "not"),
            Symbol("cons"): Builtin(cons, "cons"),
            Symbol("car"): Builtin(car, "car"),
            Symbol("cdr"): Builtin(cdr, "cdr"),
            Symbol("list"): Builtin(make_list, "list"),
            Symbol("length"): Builtin(length, "length"),
            Symbol("append"): Builtin(append, "append"),
            Symbol("null?"): Builtin(lambda x: x is nil or x == [], "null?"),
            Symbol("pair?"): Builtin(lambda x: isinstance(x, list) and len(x) > 0, "pair?"),
            Symbol("list?"): Builtin(lambda x: x is nil or isinstance(x, list), "list?"),
            Symbol("string-length"): Builtin(lambda s: len(s), "string-length"),
            Symbol("string-append"): Builtin(lambda *s: "".join(s), "string-append"),
            Symbol("substring"): Builtin(lambda s, start, end: s[start:end], "substring"),
            Symbol("string->number"): Builtin(string_to_number, "string->number"),
            Symbol("number->string"): Builtin(lambda n: str(n), "number->string"),
            Symbol("display"): Builtin(display, "display"),
            Symbol("newline"): Builtin(newline, "newline"),
            Symbol("print"): Builtin(printer, "print"),
            Symbol("exit"): Builtin(lambda: (_raise_eof()), "exit"),
            Symbol("map"): Builtin(lambda fn, lst: builtin_map(fn, lst), "map"),
            Symbol("filter"): Builtin(lambda fn, lst: builtin_filter(fn, lst), "filter"),
        }
    )
    return env


def _raise_eof():
    raise EOFError


def divide(first, rest):
    result = first
    if not rest:
        return 1 / result
    for value in rest:
        result /= value
    return result


def string_to_number(value):
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return False


def builtin_map(fn, lst):
    items = require_list(lst, "map")
    result = []
    evaluator = Evaluator.current()
    for item in items:
        result.append(evaluator.apply(fn, [item]))
    return result or nil


def builtin_filter(fn, lst):
    items = require_list(lst, "filter")
    result = []
    evaluator = Evaluator.current()
    for item in items:
        if truthy(evaluator.apply(fn, [item])):
            result.append(item)
    return result or nil


class Evaluator:
    _active = []

    def __init__(self, env=None):
        self.global_env = env or standard_env()

    @classmethod
    def current(cls):
        if not cls._active:
            raise LispError("no active evaluator")
        return cls._active[-1]

    def eval(self, expr, env=None, tail=False):
        env = self.global_env if env is None else env
        while True:
            if isinstance(expr, Symbol):
                return env.find(expr)[expr]
            if not isinstance(expr, list):
                return expr
            if not expr:
                return nil
            head = expr[0]
            if isinstance(head, Symbol):
                if head == "quote":
                    return expr[1]
                if head == "quasiquote":
                    return self.eval_quasiquote(expr[1], env)
                if head == "if":
                    _, test, conseq, alt = expr
                    expr = conseq if truthy(self.eval(test, env)) else alt
                    continue
                if head == "begin":
                    return self.eval_begin(expr[1:], env, tail)
                if head == "define":
                    return self.eval_define(expr, env)
                if head == "set!":
                    _, name, value_expr = expr
                    value = self.eval(value_expr, env)
                    env.find(name)[name] = value
                    return value
                if head == "lambda":
                    _, params, *body = expr
                    split_params(params)
                    return Procedure(params, body, env)
                if head == "define-macro":
                    return self.eval_define_macro(expr, env)
                if head == "cond":
                    expr = self.expand_cond(expr[1:], env)
                    continue
                if head == "let":
                    expr, env = self.expand_let(expr, env, sequential=False)
                    continue
                if head == "let*":
                    expr, env = self.expand_let(expr, env, sequential=True)
                    continue
                if head == "and":
                    return self.eval_and(expr[1:], env)
                if head == "or":
                    return self.eval_or(expr[1:], env)
            proc = self.eval(head, env)
            if isinstance(proc, Macro):
                expr = proc.expand(expr[1:], self, env)
                continue
            args = [self.eval(arg, env) for arg in expr[1:]]
            if tail and isinstance(proc, Procedure):
                return TailCall((proc, args), env)
            return self.apply(proc, args)

    def apply(self, proc, args):
        if isinstance(proc, Builtin):
            self._active.append(self)
            try:
                return proc(args, self)
            finally:
                self._active.pop()
        if isinstance(proc, Procedure):
            expr = None
            env = bind_params(proc.params, args, proc.env)
            body = proc.body
            while True:
                result = self.eval_sequence(body, env, tail=True)
                if isinstance(result, TailCall):
                    proc, args = result.expr
                    if not isinstance(proc, Procedure):
                        return self.apply(proc, args)
                    env = bind_params(proc.params, args, proc.env)
                    body = proc.body
                    continue
                return result
        raise LispError(f"not callable: {to_lisp_str(proc)}")

    def eval_sequence(self, exprs, env, tail=False):
        if not exprs:
            return nil
        for expr in exprs[:-1]:
            self.eval(expr, env)
        return self.eval(exprs[-1], env, tail=tail)

    def eval_begin(self, exprs, env, tail):
        return self.eval_sequence(exprs, env, tail=tail)

    def eval_define(self, expr, env):
        _, target, *rest = expr
        if isinstance(target, list):
            name = target[0]
            params = target[1:]
            split_params(params)
            value = Procedure(params, rest, env)
            env[name] = value
            return value
        value = self.eval(rest[0], env)
        env[target] = value
        return value

    def eval_define_macro(self, expr, env):
        _, target, *body = expr
        if not isinstance(target, list) or not target:
            raise LispError("define-macro requires (name args...)")
        name = target[0]
        params = target[1:]
        split_params(params)
        macro = Macro(params, body, env)
        env[name] = macro
        return macro

    def expand_cond(self, clauses, env):
        for clause in clauses:
            if not isinstance(clause, list) or not clause:
                raise LispError("invalid cond clause")
            test = clause[0]
            body = clause[1:] or [test]
            if test == Symbol("else") or truthy(self.eval(test, env)):
                if len(body) == 1:
                    return body[0]
                return [Symbol("begin"), *body]
        return nil

    def expand_let(self, expr, env, sequential):
        _, bindings, *body = expr
        if sequential:
            local_env = Env(outer=env)
            for binding in bindings:
                name, value_expr = binding
                local_env[name] = self.eval(value_expr, local_env)
            return [Symbol("begin"), *body], local_env
        names = []
        values = []
        for binding in bindings:
            name, value_expr = binding
            names.append(name)
            values.append(self.eval(value_expr, env))
        return [Symbol("begin"), *body], Env(names, values, env)

    def eval_and(self, exprs, env):
        result = True
        for expr in exprs:
            result = self.eval(expr, env)
            if not truthy(result):
                return result
        return result

    def eval_or(self, exprs, env):
        for expr in exprs:
            result = self.eval(expr, env)
            if truthy(result):
                return result
        return False

    def eval_quasiquote(self, expr, env, level=1):
        if not isinstance(expr, list):
            return expr
        result = []
        for item in expr:
            if isinstance(item, list) and item:
                tag = item[0]
                if tag == Symbol("unquote"):
                    if level == 1:
                        result.append(self.eval(item[1], env))
                        continue
                    result.append([Symbol("unquote"), self.eval_quasiquote(item[1], env, level - 1)])
                    continue
                if tag == Symbol("unquote-splicing"):
                    if level == 1:
                        result.append(Splice(require_list(self.eval(item[1], env), "unquote-splicing")))
                        continue
                    result.append([Symbol("unquote-splicing"), self.eval_quasiquote(item[1], env, level - 1)])
                    continue
                if tag == Symbol("quasiquote"):
                    result.append(self.eval_quasiquote(item, env, level + 1))
                    continue
            result.append(self.eval_quasiquote(item, env, level))
        flat = []
        for item in result:
            if isinstance(item, Splice):
                flat.extend(item.value)
            else:
                flat.append(item)
        return flat or nil


def run(source, evaluator=None, env=None):
    evaluator = evaluator or Evaluator(env)
    result = nil
    for expr in parse(source):
        result = evaluator.eval(expr, evaluator.global_env if env is None else env)
    return result


def repl():
    evaluator = Evaluator()
    buffer = []
    prompt = "lisp> "
    while True:
        try:
            line = input(prompt if not buffer else "... ")
        except EOFError:
            print()
            break
        buffer.append(line)
        source = "\n".join(buffer)
        if not balanced(source):
            continue
        try:
            result = run(source, evaluator=evaluator)
            if result is not nil:
                print(to_lisp_str(result))
        except EOFError:
            break
        except Exception as exc:
            print(f"Error: {exc}", file=sys.stderr)
        buffer.clear()


def balanced(source):
    depth = 0
    in_string = False
    escaped = False
    for ch in source:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
    return depth <= 0 and not in_string


def main(argv=None):
    argv = argv or sys.argv
    if len(argv) > 2:
        print("usage: python lisp.py [file.lisp]", file=sys.stderr)
        return 1
    if len(argv) == 2:
        with open(argv[1], "r", encoding="utf-8") as fh:
            run(fh.read())
        return 0
    repl()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
