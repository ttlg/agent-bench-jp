import math
import operator
import sys
from dataclasses import dataclass


class LispError(Exception):
    pass


class Symbol(str):
    pass


class NilType:
    def __bool__(self):
        return False

    def __repr__(self):
        return "nil"

    __str__ = __repr__


nil = NilType()


TRUE = True
FALSE = False


def is_symbol(value, name=None):
    if not isinstance(value, Symbol):
        return False
    return name is None or value == name


def truthy(value):
    return value is not FALSE and value is not nil


def to_lisp_str(value):
    if value is TRUE:
        return "#t"
    if value is FALSE:
        return "#f"
    if value is nil:
        return "nil"
    if isinstance(value, Symbol):
        return value
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'
    if isinstance(value, list):
        return "(" + " ".join(to_lisp_str(item) for item in value) + ")"
    return str(value)


def tokenize(source):
    tokens = []
    i = 0
    n = len(source)
    while i < n:
        ch = source[i]
        if ch.isspace():
            i += 1
            continue
        if ch == ";":
            while i < n and source[i] != "\n":
                i += 1
            continue
        if ch in ("(", ")"):
            tokens.append(ch)
            i += 1
            continue
        if ch == "'":
            tokens.append("'")
            i += 1
            continue
        if ch == "`":
            tokens.append("`")
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
            i += 1
            buf = []
            while i < n:
                ch = source[i]
                if ch == '"':
                    i += 1
                    break
                if ch == "\\":
                    i += 1
                    if i >= n:
                        raise LispError("unterminated string literal")
                    esc = source[i]
                    mapping = {"n": "\n", "t": "\t", '"': '"', "\\": "\\"}
                    buf.append(mapping.get(esc, esc))
                    i += 1
                    continue
                buf.append(ch)
                i += 1
            else:
                raise LispError("unterminated string literal")
            tokens.append(("STRING", "".join(buf)))
            continue
        start = i
        while i < n and not source[i].isspace() and source[i] not in "()'`,":
            i += 1
        tokens.append(source[start:i])
    return tokens


def atom(token):
    if isinstance(token, tuple) and token[0] == "STRING":
        return token[1]
    if token == "#t":
        return TRUE
    if token == "#f":
        return FALSE
    if token == "nil":
        return nil
    try:
        return int(token)
    except ValueError:
        pass
    try:
        return float(token)
    except ValueError:
        return Symbol(token)


def parse_tokens(tokens, start=0):
    if start >= len(tokens):
        raise LispError("unexpected EOF while reading")
    token = tokens[start]
    if token == "(":
        result = []
        pos = start + 1
        while True:
            if pos >= len(tokens):
                raise LispError("unexpected EOF while reading list")
            if tokens[pos] == ")":
                return result, pos + 1
            expr, pos = parse_tokens(tokens, pos)
            result.append(expr)
    if token == ")":
        raise LispError("unexpected )")
    if token == "'":
        expr, pos = parse_tokens(tokens, start + 1)
        return [Symbol("quote"), expr], pos
    if token == "`":
        expr, pos = parse_tokens(tokens, start + 1)
        return [Symbol("quasiquote"), expr], pos
    if token == ",":
        expr, pos = parse_tokens(tokens, start + 1)
        return [Symbol("unquote"), expr], pos
    if token == ",@":
        expr, pos = parse_tokens(tokens, start + 1)
        return [Symbol("unquote-splicing"), expr], pos
    return atom(token), start + 1


def parse(source):
    tokens = tokenize(source)
    exprs = []
    pos = 0
    while pos < len(tokens):
        expr, pos = parse_tokens(tokens, pos)
        exprs.append(expr)
    return exprs


class Env(dict):
    def __init__(self, params=None, args=(), outer=None):
        super().__init__()
        self.outer = outer
        bind_params(self, params, args)

    def find(self, var):
        if var in self:
            return self
        if self.outer is not None:
            return self.outer.find(var)
        raise LispError(f"undefined symbol: {var}")


@dataclass
class Procedure:
    params: object
    body: list
    env: Env

    def bind(self, args):
        return Env(self.params, args, self.env)


@dataclass
class Macro:
    params: object
    body: list
    env: Env

    def expand(self, args, evaluator):
        call_env = Env(self.params, args, self.env)
        result = nil
        for expr in self.body:
            result = evaluator(expr, call_env)
        return result


def require_args(args, count=None, minimum=None, maximum=None):
    size = len(args)
    if count is not None and size != count:
        raise LispError(f"expected {count} args, got {size}")
    if minimum is not None and size < minimum:
        raise LispError(f"expected at least {minimum} args, got {size}")
    if maximum is not None and size > maximum:
        raise LispError(f"expected at most {maximum} args, got {size}")


def ensure_list(value):
    if not isinstance(value, list):
        raise LispError("expected list")
    return value


def normalize_params(params):
    if isinstance(params, Symbol):
        return params
    if not isinstance(params, list):
        raise LispError("params must be a symbol or list")
    if Symbol(".") in params:
        dot_index = params.index(Symbol("."))
        if dot_index == 0 or dot_index != len(params) - 2:
            raise LispError("invalid dotted parameter list")
        fixed = params[:dot_index]
        rest = params[-1]
        if not isinstance(rest, Symbol) or not all(isinstance(param, Symbol) for param in fixed):
            raise LispError("params must be symbols")
        return (fixed, rest)
    if not all(isinstance(param, Symbol) for param in params):
        raise LispError("params must be symbols")
    return params


def bind_params(target_env, params, args):
    if params is None:
        return
    args = list(args)
    if isinstance(params, Symbol):
        target_env[params] = args
        return
    if isinstance(params, tuple) and len(params) == 2:
        fixed, rest = params
        if len(args) < len(fixed):
            raise LispError(f"expected at least {len(fixed)} args, got {len(args)}")
        for param, arg in zip(fixed, args[: len(fixed)]):
            target_env[param] = arg
        target_env[rest] = args[len(fixed) :]
        return
    params = list(params)
    if len(params) != len(args):
        raise LispError(f"expected {len(params)} args, got {len(args)}")
    for param, arg in zip(params, args):
        target_env[param] = arg


def builtin_add(*args):
    return sum(args)


def builtin_sub(*args):
    require_args(args, minimum=1)
    if len(args) == 1:
        return -args[0]
    result = args[0]
    for arg in args[1:]:
        result -= arg
    return result


def builtin_mul(*args):
    result = 1
    for arg in args:
        result *= arg
    return result


def builtin_div(*args):
    require_args(args, minimum=1)
    if len(args) == 1:
        return 1 / args[0]
    result = args[0]
    for arg in args[1:]:
        result /= arg
    return result


def builtin_modulo(a, b):
    return a % b


def compare_chain(op, *args):
    require_args(args, minimum=2)
    return all(op(a, b) for a, b in zip(args, args[1:]))


def builtin_not(value):
    return not truthy(value)


def builtin_cons(a, b):
    lst = ensure_list(b)
    return [a] + list(lst)


def builtin_car(lst):
    lst = ensure_list(lst)
    if not lst:
        raise LispError("car on empty list")
    return lst[0]


def builtin_cdr(lst):
    lst = ensure_list(lst)
    if not lst:
        raise LispError("cdr on empty list")
    return lst[1:]


def builtin_list(*args):
    return list(args)


def builtin_length(lst):
    return len(ensure_list(lst))


def builtin_append(*lists):
    result = []
    for lst in lists:
        result.extend(ensure_list(lst))
    return result


def builtin_nullp(value):
    return value is nil or value == []


def builtin_pairp(value):
    return isinstance(value, list) and len(value) > 0


def builtin_listp(value):
    return isinstance(value, list) or value is nil


def builtin_string_length(s):
    return len(s)


def builtin_string_append(*parts):
    return "".join(parts)


def builtin_substring(s, start, end):
    return s[start:end]


def builtin_string_to_number(s):
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return FALSE


def builtin_number_to_string(n):
    return str(n)


def builtin_display(value):
    if value is TRUE:
        text = "#t"
    elif value is FALSE:
        text = "#f"
    elif value is nil:
        text = "nil"
    elif isinstance(value, list):
        text = to_lisp_str(value)
    else:
        text = str(value)
    print(text, end="")
    return nil


def builtin_newline():
    print()
    return nil


def builtin_print(*values):
    print(" ".join(to_lisp_str(v) for v in values))
    return nil


def builtin_exit():
    raise EOFError


def standard_env():
    env = Env()
    env.update(
        {
            Symbol("+"): builtin_add,
            Symbol("-"): builtin_sub,
            Symbol("*"): builtin_mul,
            Symbol("/"): builtin_div,
            Symbol("modulo"): builtin_modulo,
            Symbol("="): lambda *args: compare_chain(operator.eq, *args),
            Symbol("<"): lambda *args: compare_chain(operator.lt, *args),
            Symbol(">"): lambda *args: compare_chain(operator.gt, *args),
            Symbol("<="): lambda *args: compare_chain(operator.le, *args),
            Symbol(">="): lambda *args: compare_chain(operator.ge, *args),
            Symbol("and"): lambda *args: all(truthy(arg) for arg in args),
            Symbol("or"): lambda *args: any(truthy(arg) for arg in args),
            Symbol("not"): builtin_not,
            Symbol("cons"): builtin_cons,
            Symbol("car"): builtin_car,
            Symbol("cdr"): builtin_cdr,
            Symbol("list"): builtin_list,
            Symbol("length"): builtin_length,
            Symbol("append"): builtin_append,
            Symbol("null?"): builtin_nullp,
            Symbol("pair?"): builtin_pairp,
            Symbol("list?"): builtin_listp,
            Symbol("string-length"): builtin_string_length,
            Symbol("string-append"): builtin_string_append,
            Symbol("substring"): builtin_substring,
            Symbol("string->number"): builtin_string_to_number,
            Symbol("number->string"): builtin_number_to_string,
            Symbol("display"): builtin_display,
            Symbol("newline"): builtin_newline,
            Symbol("print"): builtin_print,
            Symbol("exit"): builtin_exit,
        }
    )
    env.update(
        {
            Symbol("#t"): TRUE,
            Symbol("#f"): FALSE,
            Symbol("nil"): nil,
        }
    )
    return env


def expand_quasiquote(expr, env, evaluator, depth=1):
    if not isinstance(expr, list):
        return expr
    result = []
    for item in expr:
        if isinstance(item, list) and item:
            head = item[0]
            if is_symbol(head, "unquote") and depth == 1:
                require_args(item[1:], count=1)
                result.append(evaluator(item[1], env))
                continue
            if is_symbol(head, "unquote-splicing") and depth == 1:
                require_args(item[1:], count=1)
                value = evaluator(item[1], env)
                result.extend(ensure_list(value))
                continue
            if is_symbol(head, "quasiquote"):
                result.append(expand_quasiquote(item[1], env, evaluator, depth + 1))
                continue
        result.append(expand_quasiquote(item, env, evaluator, depth))
    return result


def eval_sequence(exprs, env, evaluator):
    result = nil
    for expr in exprs:
        result = evaluator(expr, env)
    return result


def make_global_env():
    env = standard_env()

    def builtin_map(proc, lst):
        lst = ensure_list(lst)
        return [apply_callable(proc, [item], env, evaluate) for item in lst]

    def builtin_filter(proc, lst):
        lst = ensure_list(lst)
        return [item for item in lst if truthy(apply_callable(proc, [item], env, evaluate))]

    env[Symbol("map")] = builtin_map
    env[Symbol("filter")] = builtin_filter
    return env


def apply_callable(proc, args, env, evaluator):
    if isinstance(proc, Procedure):
        return eval_sequence(proc.body, proc.bind(args), evaluator)
    if callable(proc):
        try:
            return proc(*args)
        except TypeError as exc:
            raise LispError(str(exc)) from exc
    raise LispError(f"not callable: {to_lisp_str(proc)}")


def evaluate(expr, env):
    while True:
        if isinstance(expr, Symbol):
            return env.find(expr)[expr]
        if not isinstance(expr, list):
            return expr
        if not expr:
            return []

        head = expr[0]
        args = expr[1:]

        if is_symbol(head, "quote"):
            require_args(args, count=1)
            return args[0]

        if is_symbol(head, "quasiquote"):
            require_args(args, count=1)
            return expand_quasiquote(args[0], env, evaluate)

        if is_symbol(head, "if"):
            require_args(args, minimum=2, maximum=3)
            test = evaluate(args[0], env)
            expr = args[1] if truthy(test) else (args[2] if len(args) == 3 else nil)
            continue

        if is_symbol(head, "begin"):
            if not args:
                return nil
            for subexpr in args[:-1]:
                evaluate(subexpr, env)
            expr = args[-1]
            continue

        if is_symbol(head, "define"):
            require_args(args, minimum=2)
            target = args[0]
            if isinstance(target, list) and target:
                name = target[0]
                params = normalize_params(target[1:])
                proc = Procedure(params, args[1:], env)
                env[name] = proc
                return proc
            if not isinstance(target, Symbol):
                raise LispError("define target must be symbol")
            value = evaluate(args[1], env)
            env[target] = value
            return value

        if is_symbol(head, "set!"):
            require_args(args, count=2)
            name = args[0]
            if not isinstance(name, Symbol):
                raise LispError("set! target must be symbol")
            scope = env.find(name)
            scope[name] = evaluate(args[1], env)
            return scope[name]

        if is_symbol(head, "lambda"):
            require_args(args, minimum=2)
            return Procedure(normalize_params(args[0]), args[1:], env)

        if is_symbol(head, "define-macro"):
            require_args(args, minimum=2)
            target = args[0]
            if not (isinstance(target, list) and target):
                raise LispError("define-macro requires (name args...)")
            name = target[0]
            params = normalize_params(target[1:])
            macro = Macro(params, args[1:], env)
            env[name] = macro
            return macro

        if is_symbol(head, "let"):
            require_args(args, minimum=2)
            bindings = args[0]
            local_env = Env(outer=env)
            for binding in bindings:
                if not isinstance(binding, list) or len(binding) != 2 or not isinstance(binding[0], Symbol):
                    raise LispError("invalid let binding")
                local_env[binding[0]] = evaluate(binding[1], env)
            env = local_env
            if len(args) == 1:
                return nil
            for subexpr in args[1:-1]:
                evaluate(subexpr, env)
            expr = args[-1]
            continue

        if is_symbol(head, "let*"):
            require_args(args, minimum=2)
            local_env = Env(outer=env)
            for binding in args[0]:
                if not isinstance(binding, list) or len(binding) != 2 or not isinstance(binding[0], Symbol):
                    raise LispError("invalid let* binding")
                local_env[binding[0]] = evaluate(binding[1], local_env)
            env = local_env
            for subexpr in args[1:-1]:
                evaluate(subexpr, env)
            expr = args[-1]
            continue

        if is_symbol(head, "cond"):
            if not args:
                return nil
            matched = False
            for clause in args:
                if not isinstance(clause, list) or not clause:
                    raise LispError("invalid cond clause")
                test = clause[0]
                if is_symbol(test, "else") or truthy(evaluate(test, env)):
                    matched = True
                    if len(clause) == 1:
                        return evaluate(test, env)
                    for subexpr in clause[1:-1]:
                        evaluate(subexpr, env)
                    expr = clause[-1]
                    break
            if not matched:
                return nil
            continue

        proc = evaluate(head, env)
        if isinstance(proc, Macro):
            expr = proc.expand(args, evaluate)
            continue

        values = [evaluate(arg, env) for arg in args]
        if isinstance(proc, Procedure):
            env = proc.bind(values)
            for subexpr in proc.body[:-1]:
                evaluate(subexpr, env)
            expr = proc.body[-1]
            continue
        if callable(proc):
            try:
                return proc(*values)
            except TypeError as exc:
                raise LispError(str(exc)) from exc
        raise LispError(f"not callable: {to_lisp_str(proc)}")


def run(source, env=None):
    env = env if env is not None else make_global_env()
    result = nil
    for expr in parse(source):
        result = evaluate(expr, env)
    return result, env


def input_complete(source):
    depth = 0
    in_string = False
    escape = False
    for ch in source:
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
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


def repl():
    env = make_global_env()
    buffer = []
    prompt = "lisp> "
    cont_prompt = "...   "
    while True:
        try:
            line = input(prompt if not buffer else cont_prompt)
        except EOFError:
            print()
            break
        buffer.append(line)
        source = "\n".join(buffer)
        if not input_complete(source):
            continue
        try:
            result, env = run(source, env)
            if result is not nil:
                print(to_lisp_str(result))
        except EOFError:
            break
        except Exception as exc:
            print(f"Error: {exc}", file=sys.stderr)
        buffer = []


def main(argv=None):
    argv = sys.argv if argv is None else argv
    if len(argv) == 1:
        repl()
        return 0
    if len(argv) == 2:
        with open(argv[1], "r", encoding="utf-8") as fh:
            run(fh.read())
        return 0
    print("usage: python lisp.py [file.lisp]", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
