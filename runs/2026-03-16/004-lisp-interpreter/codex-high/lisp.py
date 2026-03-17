import math
import operator
import sys


class LispError(Exception):
    pass


class ParseError(LispError):
    pass


class EvalError(LispError):
    pass


class LispExit(SystemExit):
    pass


class Symbol(str):
    pass


class Environment:
    def __init__(self, bindings=None, outer=None):
        self.bindings = {} if bindings is None else dict(bindings)
        self.outer = outer

    def find(self, name):
        if name in self.bindings:
            return self
        if self.outer is not None:
            return self.outer.find(name)
        raise EvalError(f"undefined symbol: {name}")

    def get(self, name):
        return self.find(name).bindings[name]

    def set(self, name, value):
        self.find(name).bindings[name] = value

    def define(self, name, value):
        self.bindings[name] = value


class BuiltinFunction:
    def __init__(self, name, func):
        self.name = name
        self.func = func

    def __call__(self, *args):
        return self.func(*args)

    def __repr__(self):
        return f"<builtin {self.name}>"


class Procedure:
    def __init__(self, params, body, env, is_macro=False):
        self.params = params
        self.body = body
        self.env = env
        self.is_macro = is_macro

    def __repr__(self):
        kind = "macro" if self.is_macro else "procedure"
        return f"<{kind}>"


TRUE = True
FALSE = False

S_DEFINE = Symbol("define")
S_LAMBDA = Symbol("lambda")
S_IF = Symbol("if")
S_COND = Symbol("cond")
S_LET = Symbol("let")
S_LET_STAR = Symbol("let*")
S_BEGIN = Symbol("begin")
S_QUOTE = Symbol("quote")
S_SET = Symbol("set!")
S_DEFINE_MACRO = Symbol("define-macro")
S_QUASIQUOTE = Symbol("quasiquote")
S_UNQUOTE = Symbol("unquote")
S_UNQUOTE_SPLICING = Symbol("unquote-splicing")
S_ELSE = Symbol("else")
S_AND = Symbol("and")
S_OR = Symbol("or")
S_EXIT = Symbol("exit")


def is_symbol(value):
    return isinstance(value, Symbol)


def is_list(value):
    return isinstance(value, list)


def is_nil(value):
    return is_list(value) and len(value) == 0


def is_truthy(value):
    return value is not FALSE


def scheme_repr(value):
    if value is TRUE:
        return "#t"
    if value is FALSE:
        return "#f"
    if is_symbol(value):
        return str(value)
    if is_list(value):
        return "(" + " ".join(scheme_repr(item) for item in value) + ")"
    if isinstance(value, str):
        escaped = (
            value.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("\n", "\\n")
            .replace("\t", "\\t")
        )
        return f'"{escaped}"'
    if value is None:
        return "nil"
    return str(value)


def scheme_display(value):
    if isinstance(value, str) and not is_symbol(value):
        return value
    return scheme_repr(value)


def tokenize(source):
    tokens = []
    i = 0
    length = len(source)
    while i < length:
        ch = source[i]
        if ch.isspace():
            i += 1
            continue
        if ch == ";":
            while i < length and source[i] != "\n":
                i += 1
            continue
        if ch in ("(", ")", "'", "`"):
            tokens.append(ch)
            i += 1
            continue
        if ch == ",":
            if i + 1 < length and source[i + 1] == "@":
                tokens.append(",@")
                i += 2
            else:
                tokens.append(",")
                i += 1
            continue
        if ch == '"':
            i += 1
            chars = []
            while i < length:
                curr = source[i]
                if curr == "\\":
                    i += 1
                    if i >= length:
                        raise ParseError("unterminated string literal")
                    escape = source[i]
                    chars.append(
                        {
                            "n": "\n",
                            "t": "\t",
                            '"': '"',
                            "\\": "\\",
                        }.get(escape, escape)
                    )
                    i += 1
                    continue
                if curr == '"':
                    i += 1
                    tokens.append(("STRING", "".join(chars)))
                    break
                chars.append(curr)
                i += 1
            else:
                raise ParseError("unterminated string literal")
            continue
        start = i
        while i < length and not source[i].isspace() and source[i] not in '();\'`,':
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
        return []
    try:
        if token.startswith(("0x", "-0x", "+0x")):
            return int(token, 16)
        return int(token, 10)
    except ValueError:
        pass
    try:
        if any(marker in token for marker in (".", "e", "E")):
            return float(token)
    except ValueError:
        pass
    return Symbol(token)


def read_expression(tokens, index=0):
    if index >= len(tokens):
        raise ParseError("unexpected EOF while reading")
    token = tokens[index]
    if token == "(":
        result = []
        index += 1
        while True:
            if index >= len(tokens):
                raise ParseError("unexpected EOF while reading list")
            if tokens[index] == ")":
                return result, index + 1
            expr, index = read_expression(tokens, index)
            result.append(expr)
    if token == ")":
        raise ParseError("unexpected ')'")
    if token == "'":
        expr, next_index = read_expression(tokens, index + 1)
        return [S_QUOTE, expr], next_index
    if token == "`":
        expr, next_index = read_expression(tokens, index + 1)
        return [S_QUASIQUOTE, expr], next_index
    if token == ",":
        expr, next_index = read_expression(tokens, index + 1)
        return [S_UNQUOTE, expr], next_index
    if token == ",@":
        expr, next_index = read_expression(tokens, index + 1)
        return [S_UNQUOTE_SPLICING, expr], next_index
    return atom(token), index + 1


def parse_program(source):
    tokens = tokenize(source)
    expressions = []
    index = 0
    while index < len(tokens):
        expr, index = read_expression(tokens, index)
        expressions.append(expr)
    return expressions


def validate_params(params):
    if is_symbol(params):
        return
    if not is_list(params):
        raise EvalError("parameter list must be a symbol or list")
    dot_count = sum(1 for item in params if item == Symbol("."))
    if dot_count > 1:
        raise EvalError("invalid dotted parameter list")
    if dot_count == 1:
        dot_index = params.index(Symbol("."))
        if dot_index == len(params) - 1 or dot_index == 0 and len(params) == 2:
            raise EvalError("invalid dotted parameter list")
        if dot_index != len(params) - 2:
            raise EvalError("dot must appear before final rest parameter")
        fixed = params[:dot_index]
        rest = params[-1]
        names = fixed + [rest]
    else:
        names = params
    for name in names:
        if not is_symbol(name):
            raise EvalError("parameters must be symbols")


def bind_params(params, args):
    if is_symbol(params):
        return {params: list(args)}
    params = list(params)
    if Symbol(".") in params:
        dot_index = params.index(Symbol("."))
        fixed = params[:dot_index]
        rest_name = params[dot_index + 1]
        if len(args) < len(fixed):
            raise EvalError("too few arguments")
        bindings = {name: value for name, value in zip(fixed, args[: len(fixed)])}
        bindings[rest_name] = list(args[len(fixed) :])
        return bindings
    if len(params) != len(args):
        raise EvalError(
            f"expected {len(params)} arguments, got {len(args)}"
        )
    return {name: value for name, value in zip(params, args)}


def make_begin(body):
    if not body:
        return []
    if len(body) == 1:
        return body[0]
    return [S_BEGIN] + body


def expect_list(value, name):
    if not is_list(value):
        raise EvalError(f"{name} expects a list")
    return value


def expect_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EvalError(f"{name} expects a number")
    return value


def expect_string(value, name):
    if is_symbol(value) or not isinstance(value, str):
        raise EvalError(f"{name} expects a string")
    return value


def numeric_fold(name, args, initial=None, unary=None, op=None):
    if not args:
        if initial is None:
            raise EvalError(f"{name} expects at least one argument")
        return initial
    values = [expect_number(arg, name) for arg in args]
    if len(values) == 1 and unary is not None:
        return unary(values[0])
    result = values[0]
    for value in values[1:]:
        result = op(result, value)
    return result


def ensure_bool_like_args(name, args):
    if len(args) != 1:
        raise EvalError(f"{name} expects 1 argument")


def compare_chain(name, args, predicate):
    if len(args) < 2:
        raise EvalError(f"{name} expects at least 2 arguments")
    values = [expect_number(arg, name) for arg in args]
    return all(predicate(a, b) for a, b in zip(values, values[1:]))


def call_procedure(proc, args):
    if isinstance(proc, BuiltinFunction):
        try:
            return proc(*args)
        except LispExit:
            raise
        except LispError:
            raise
        except Exception as exc:
            raise EvalError(str(exc)) from exc
    if isinstance(proc, Procedure):
        local_env = Environment(bind_params(proc.params, args), proc.env)
        return eval_sequence(proc.body, local_env)
    raise EvalError(f"attempted to call non-function: {scheme_repr(proc)}")


def eval_quasiquote(expr, env, level=1):
    if not is_list(expr):
        return expr
    result = []
    for item in expr:
        if is_list(item) and item:
            tag = item[0]
            if tag == S_UNQUOTE:
                if len(item) != 2:
                    raise EvalError("unquote expects 1 argument")
                if level == 1:
                    result.append(eval_expr(item[1], env))
                else:
                    result.append([S_UNQUOTE, eval_quasiquote(item[1], env, level - 1)])
                continue
            if tag == S_UNQUOTE_SPLICING:
                if len(item) != 2:
                    raise EvalError("unquote-splicing expects 1 argument")
                if level == 1:
                    spliced = eval_expr(item[1], env)
                    expect_list(spliced, "unquote-splicing")
                    result.extend(spliced)
                else:
                    result.append(
                        [S_UNQUOTE_SPLICING, eval_quasiquote(item[1], env, level - 1)]
                    )
                continue
            if tag == S_QUASIQUOTE:
                if len(item) != 2:
                    raise EvalError("quasiquote expects 1 argument")
                result.append([S_QUASIQUOTE, eval_quasiquote(item[1], env, level + 1)])
                continue
        result.append(eval_quasiquote(item, env, level))
    return result


def eval_sequence(expressions, env):
    result = None
    for index, expr in enumerate(expressions):
        if index == len(expressions) - 1:
            return eval_expr(expr, env)
        eval_expr(expr, env)
    return result


def eval_cond(clauses, env):
    for clause in clauses:
        if not is_list(clause) or not clause:
            raise EvalError("cond clause must be a non-empty list")
        test = clause[0]
        body = clause[1:]
        if test == S_ELSE:
            if not body:
                raise EvalError("else clause requires a body")
            return make_begin(body), env, True
        result = eval_expr(test, env)
        if is_truthy(result):
            if not body:
                return result, env, False
            return make_begin(body), env, True
    return None, env, False


def eval_let(bindings, body, env, sequential):
    if not is_list(bindings):
        raise EvalError("let bindings must be a list")
    local_env = Environment(outer=env)
    if sequential:
        target_env = local_env
        for binding in bindings:
            if not is_list(binding) or len(binding) != 2 or not is_symbol(binding[0]):
                raise EvalError("invalid let* binding")
            local_env.define(binding[0], eval_expr(binding[1], target_env))
            target_env = local_env
        return local_env
    staged = {}
    for binding in bindings:
        if not is_list(binding) or len(binding) != 2 or not is_symbol(binding[0]):
            raise EvalError("invalid let binding")
        staged[binding[0]] = eval_expr(binding[1], env)
    for name, value in staged.items():
        local_env.define(name, value)
    return local_env


def eval_expr(expr, env):
    while True:
        if is_symbol(expr):
            return env.get(expr)
        if not is_list(expr):
            return expr
        if not expr:
            return []

        head = expr[0]
        args = expr[1:]

        if head == S_QUOTE:
            if len(args) != 1:
                raise EvalError("quote expects 1 argument")
            return args[0]

        if head == S_QUASIQUOTE:
            if len(args) != 1:
                raise EvalError("quasiquote expects 1 argument")
            return eval_quasiquote(args[0], env)

        if head == S_IF:
            if len(args) not in (2, 3):
                raise EvalError("if expects 2 or 3 arguments")
            test_value = eval_expr(args[0], env)
            expr = args[1] if is_truthy(test_value) else (args[2] if len(args) == 3 else None)
            if expr is None:
                return None
            continue

        if head == S_BEGIN:
            if not args:
                return None
            for item in args[:-1]:
                eval_expr(item, env)
            expr = args[-1]
            continue

        if head == S_DEFINE:
            if not args:
                raise EvalError("define expects arguments")
            target = args[0]
            body = args[1:]
            if is_list(target):
                if not target or not is_symbol(target[0]):
                    raise EvalError("invalid function definition")
                name = target[0]
                params = target[1:]
                validate_params(params)
                env.define(name, Procedure(params, body, env))
                return None
            if len(body) != 1 or not is_symbol(target):
                raise EvalError("define expects a symbol and value")
            env.define(target, eval_expr(body[0], env))
            return None

        if head == S_SET:
            if len(args) != 2 or not is_symbol(args[0]):
                raise EvalError("set! expects a symbol and value")
            env.set(args[0], eval_expr(args[1], env))
            return None

        if head == S_LAMBDA:
            if len(args) < 2:
                raise EvalError("lambda expects parameters and body")
            params = args[0]
            validate_params(params)
            return Procedure(params, args[1:], env)

        if head == S_DEFINE_MACRO:
            if len(args) < 2:
                raise EvalError("define-macro expects a signature and body")
            signature = args[0]
            if is_list(signature):
                if not signature or not is_symbol(signature[0]):
                    raise EvalError("invalid macro definition")
                name = signature[0]
                params = signature[1:]
            elif is_symbol(signature):
                raise EvalError("define-macro requires parameter list")
            else:
                raise EvalError("invalid macro signature")
            validate_params(params)
            env.define(name, Procedure(params, args[1:], env, is_macro=True))
            return None

        if head == S_COND:
            expr, env, tail = eval_cond(args, env)
            if tail:
                continue
            return expr

        if head == S_LET:
            if len(args) < 2:
                raise EvalError("let expects bindings and body")
            env = eval_let(args[0], args[1:], env, sequential=False)
            expr = make_begin(args[1:])
            continue

        if head == S_LET_STAR:
            if len(args) < 2:
                raise EvalError("let* expects bindings and body")
            env = eval_let(args[0], args[1:], env, sequential=True)
            expr = make_begin(args[1:])
            continue

        if head == S_AND:
            result = TRUE
            for item in args:
                result = eval_expr(item, env)
                if not is_truthy(result):
                    return result
            return result

        if head == S_OR:
            for item in args:
                result = eval_expr(item, env)
                if is_truthy(result):
                    return result
            return FALSE

        proc = eval_expr(head, env)
        if isinstance(proc, Procedure) and proc.is_macro:
            expanded = call_procedure(proc, args)
            expr = expanded
            continue

        evaluated_args = [eval_expr(arg, env) for arg in args]
        if isinstance(proc, Procedure):
            env = Environment(bind_params(proc.params, evaluated_args), proc.env)
            expr = make_begin(proc.body)
            continue
        return call_procedure(proc, evaluated_args)


def standard_env():
    env = Environment()

    def builtin(name, func):
        env.define(Symbol(name), BuiltinFunction(name, func))

    builtin("+", lambda *args: sum(expect_number(arg, "+") for arg in args))
    builtin(
        "-",
        lambda *args: numeric_fold("-", args, unary=lambda x: -x, op=operator.sub),
    )
    builtin(
        "*",
        lambda *args: math.prod(expect_number(arg, "*") for arg in args),
    )
    builtin(
        "/",
        lambda *args: numeric_fold("/", args, unary=lambda x: 1 / x, op=operator.truediv),
    )
    builtin("modulo", lambda a, b: expect_number(a, "modulo") % expect_number(b, "modulo"))
    builtin("=", lambda *args: compare_chain("=", args, operator.eq))
    builtin("<", lambda *args: compare_chain("<", args, operator.lt))
    builtin(">", lambda *args: compare_chain(">", args, operator.gt))
    builtin("<=", lambda *args: compare_chain("<=", args, operator.le))
    builtin(">=", lambda *args: compare_chain(">=", args, operator.ge))
    builtin("not", lambda x: FALSE if is_truthy(x) else TRUE)
    builtin(
        "cons",
        lambda a, b: [a] + list(expect_list(b, "cons")),
    )
    builtin(
        "car",
        lambda lst: expect_list(lst, "car")[0] if expect_list(lst, "car") else _raise("car expects a non-empty list"),
    )
    builtin(
        "cdr",
        lambda lst: expect_list(lst, "cdr")[1:] if expect_list(lst, "cdr") else _raise("cdr expects a non-empty list"),
    )
    builtin("list", lambda *args: list(args))
    builtin("length", lambda lst: len(expect_list(lst, "length")))
    builtin(
        "append",
        lambda *lists: _append_lists(lists),
    )
    builtin("map", lambda proc, lst: [call_procedure(proc, [item]) for item in expect_list(lst, "map")])
    builtin(
        "filter",
        lambda proc, lst: [item for item in expect_list(lst, "filter") if is_truthy(call_procedure(proc, [item]))],
    )
    builtin("null?", lambda x: TRUE if is_nil(x) else FALSE)
    builtin("pair?", lambda x: TRUE if is_list(x) and len(x) > 0 else FALSE)
    builtin("list?", lambda x: TRUE if is_list(x) else FALSE)
    builtin("string-length", lambda s: len(expect_string(s, "string-length")))
    builtin(
        "string-append",
        lambda *parts: "".join(expect_string(part, "string-append") for part in parts),
    )
    builtin(
        "substring",
        lambda s, start, end: _substring(s, start, end),
    )
    builtin("string->number", lambda s: _string_to_number(s))
    builtin("number->string", lambda n: _number_to_string(n))
    builtin(
        "display",
        lambda *values: print("".join(scheme_display(value) for value in values), end=""),
    )
    builtin("newline", lambda: print())
    builtin("print", lambda *values: print(" ".join(scheme_repr(value) for value in values)))
    builtin("exit", lambda: (_raise_exit()))

    env.define(Symbol("nil"), [])
    env.define(Symbol("#t"), TRUE)
    env.define(Symbol("#f"), FALSE)
    return env


def _append_lists(lists):
    result = []
    for value in lists:
        result.extend(expect_list(value, "append"))
    return result


def _substring(s, start, end):
    text = expect_string(s, "substring")
    begin = expect_number(start, "substring")
    finish = expect_number(end, "substring")
    if not isinstance(begin, int) or not isinstance(finish, int):
        raise EvalError("substring expects integer indices")
    if begin < 0 or finish < begin or finish > len(text):
        raise EvalError("substring indices out of range")
    return text[begin:finish]


def _string_to_number(value):
    text = expect_string(value, "string->number").strip()
    try:
        return int(text)
    except ValueError:
        try:
            return float(text)
        except ValueError:
            return FALSE


def _number_to_string(value):
    number = expect_number(value, "number->string")
    return str(number)


def _raise(message):
    raise EvalError(message)


def _raise_exit():
    raise LispExit()


def evaluate_program(source, env=None):
    env = standard_env() if env is None else env
    result = None
    for expr in parse_program(source):
        result = eval_expr(expr, env)
    return result


def source_complete(source):
    depth = 0
    in_string = False
    escape = False
    comment = False
    for ch in source:
        if comment:
            if ch == "\n":
                comment = False
            continue
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == ";":
            comment = True
        elif ch == '"':
            in_string = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
    return depth <= 0 and not in_string


def run_repl():
    env = standard_env()
    buffer = []
    prompt = "lisp> "
    continuation = "... "
    while True:
        try:
            line = input(prompt if not buffer else continuation)
        except EOFError:
            print()
            break
        buffer.append(line)
        source = "\n".join(buffer)
        if not source_complete(source):
            continue
        try:
            result = None
            for expr in parse_program(source):
                result = eval_expr(expr, env)
                if result is not None:
                    print(scheme_repr(result))
        except LispExit:
            break
        except LispError as exc:
            print(f"Error: {exc}", file=sys.stderr)
        finally:
            buffer.clear()


def run_file(path):
    with open(path, "r", encoding="utf-8") as handle:
        evaluate_program(handle.read())


def main(argv=None):
    argv = sys.argv if argv is None else argv
    try:
        if len(argv) == 1:
            run_repl()
            return 0
        if len(argv) == 2:
            run_file(argv[1])
            return 0
        print("Usage: python lisp.py [file.lisp]", file=sys.stderr)
        return 1
    except LispExit:
        return 0
    except (OSError, LispError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
