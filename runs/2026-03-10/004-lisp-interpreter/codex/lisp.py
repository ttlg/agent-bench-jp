import math
import sys
from dataclasses import dataclass
from typing import Any, Callable, List, Optional, Sequence


class LispError(Exception):
    pass


class LispExit(Exception):
    pass


class Symbol(str):
    pass


@dataclass(frozen=True)
class DottedList:
    items: List[Any]
    tail: Any


@dataclass
class Procedure:
    params: List[Symbol]
    vararg: Optional[Symbol]
    body: List[Any]
    env: "Env"
    is_macro: bool = False

    def bind(self, args: Sequence[Any]) -> "Env":
        if self.vararg is None and len(args) != len(self.params):
            raise LispError(
                f"expected {len(self.params)} argument(s), got {len(args)}"
            )
        if self.vararg is not None and len(args) < len(self.params):
            raise LispError(
                f"expected at least {len(self.params)} argument(s), got {len(args)}"
            )
        call_env = Env(self.env)
        for name, value in zip(self.params, args):
            call_env[name] = value
        if self.vararg is not None:
            call_env[self.vararg] = list(args[len(self.params) :])
        return call_env


class Env(dict):
    def __init__(self, outer: Optional["Env"] = None, **values: Any) -> None:
        super().__init__(values)
        self.outer = outer

    def find(self, name: Symbol) -> "Env":
        if name in self:
            return self
        if self.outer is not None:
            return self.outer.find(name)
        raise LispError(f"undefined symbol: {name}")

    def set_existing(self, name: Symbol, value: Any) -> None:
        env = self.find(name)
        env[name] = value


QUOTE = Symbol("quote")
QUASIQUOTE = Symbol("quasiquote")
UNQUOTE = Symbol("unquote")
UNQUOTE_SPLICING = Symbol("unquote-splicing")


def is_symbol(value: Any, name: str) -> bool:
    return isinstance(value, Symbol) and value == name


def is_self_evaluating(value: Any) -> bool:
    return not isinstance(value, (Symbol, list, DottedList))


def is_truthy(value: Any) -> bool:
    return value is not False


def format_lisp(value: Any) -> str:
    if value is True:
        return "#t"
    if value is False:
        return "#f"
    if value == []:
        return "()"
    if isinstance(value, Symbol):
        return str(value)
    if isinstance(value, str):
        escaped = (
            value.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("\n", "\\n")
            .replace("\t", "\\t")
            .replace("\r", "\\r")
        )
        return f'"{escaped}"'
    if isinstance(value, list):
        return "(" + " ".join(format_lisp(item) for item in value) + ")"
    if isinstance(value, DottedList):
        head = " ".join(format_lisp(item) for item in value.items)
        return "(" + head + " . " + format_lisp(value.tail) + ")"
    return repr(value)


def display_text(value: Any) -> str:
    if isinstance(value, str) and not isinstance(value, Symbol):
        return value
    return format_lisp(value)


def tokenize(source: str) -> List[Any]:
    tokens: List[Any] = []
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
        if ch in ("(", ")", "'", "`"):
            tokens.append(ch)
            i += 1
            continue
        if ch == ",":
            if i + 1 < len(source) and source[i + 1] == "@":
                tokens.append(",@")
                i += 2
            else:
                tokens.append(",")
                i += 1
            continue
        if ch == '"':
            i += 1
            chars: List[str] = []
            while i < len(source):
                current = source[i]
                if current == "\\":
                    i += 1
                    if i >= len(source):
                        raise LispError("unterminated string literal")
                    escaped = source[i]
                    chars.append(
                        {
                            "n": "\n",
                            "t": "\t",
                            "r": "\r",
                            '"': '"',
                            "\\": "\\",
                        }.get(escaped, escaped)
                    )
                    i += 1
                    continue
                if current == '"':
                    tokens.append(("STRING", "".join(chars)))
                    i += 1
                    break
                chars.append(current)
                i += 1
            else:
                raise LispError("unterminated string literal")
            continue
        start = i
        while i < len(source):
            current = source[i]
            if current.isspace() or current in ("(", ")", "'", "`", ",", ";"):
                break
            i += 1
        tokens.append(source[start:i])
    return tokens


def parse_atom(token: Any) -> Any:
    if isinstance(token, tuple) and token[0] == "STRING":
        return token[1]
    if token == "#t":
        return True
    if token == "#f":
        return False
    if token == "nil":
        return []
    try:
        return int(token)
    except ValueError:
        try:
            if any(ch in token for ch in (".", "e", "E")):
                return float(token)
        except ValueError:
            pass
    return Symbol(token)


def parse_expression(tokens: Sequence[Any], index: int = 0) -> tuple[Any, int]:
    if index >= len(tokens):
        raise LispError("unexpected end of input")
    token = tokens[index]
    if token == "(":
        items: List[Any] = []
        dotted_tail: Optional[Any] = None
        index += 1
        while True:
            if index >= len(tokens):
                raise LispError("unexpected end of input")
            current = tokens[index]
            if current == ")":
                index += 1
                if dotted_tail is not None:
                    return DottedList(items, dotted_tail), index
                return items, index
            if current == ".":
                if dotted_tail is not None or not items:
                    raise LispError("invalid dotted list")
                dotted_tail, index = parse_expression(tokens, index + 1)
                if index >= len(tokens) or tokens[index] != ")":
                    raise LispError("dotted list must end before ')'")
                continue
            item, index = parse_expression(tokens, index)
            items.append(item)
    if token == ")":
        raise LispError("unexpected ')'")
    if token == "'":
        expr, next_index = parse_expression(tokens, index + 1)
        return [QUOTE, expr], next_index
    if token == "`":
        expr, next_index = parse_expression(tokens, index + 1)
        return [QUASIQUOTE, expr], next_index
    if token == ",":
        expr, next_index = parse_expression(tokens, index + 1)
        return [UNQUOTE, expr], next_index
    if token == ",@":
        expr, next_index = parse_expression(tokens, index + 1)
        return [UNQUOTE_SPLICING, expr], next_index
    return parse_atom(token), index + 1


def parse_program(source: str) -> List[Any]:
    tokens = tokenize(source)
    expressions: List[Any] = []
    index = 0
    while index < len(tokens):
        expr, index = parse_expression(tokens, index)
        expressions.append(expr)
    return expressions


def expect_list(expr: Any, message: str) -> List[Any]:
    if not isinstance(expr, list):
        raise LispError(message)
    return expr


def parse_params(expr: Any) -> tuple[List[Symbol], Optional[Symbol]]:
    if isinstance(expr, Symbol):
        return [], expr
    if isinstance(expr, list):
        params = expr
        vararg = None
    elif isinstance(expr, DottedList):
        params = expr.items
        if not isinstance(expr.tail, Symbol):
            raise LispError("variadic parameter name must be a symbol")
        vararg = expr.tail
    else:
        raise LispError("parameter list must be a list or symbol")
    parsed: List[Symbol] = []
    for param in params:
        if not isinstance(param, Symbol):
            raise LispError("parameter names must be symbols")
        parsed.append(param)
    return parsed, vararg


def ensure_arity(name: str, args: Sequence[Any], minimum: int, maximum: Optional[int] = None) -> None:
    if len(args) < minimum:
        raise LispError(f"{name} expected at least {minimum} argument(s)")
    if maximum is not None and len(args) > maximum:
        raise LispError(f"{name} expected at most {maximum} argument(s)")


def ensure_list(value: Any, name: str) -> List[Any]:
    if not isinstance(value, list):
        raise LispError(f"{name} expected a list")
    return value


def numeric_chain(name: str, cmp: Callable[[Any, Any], bool], values: Sequence[Any]) -> bool:
    ensure_arity(name, values, 1)
    return all(cmp(left, right) for left, right in zip(values, values[1:]))


def builtin_add(*values: Any) -> Any:
    return sum(values)


def builtin_sub(*values: Any) -> Any:
    ensure_arity("-", values, 1)
    if len(values) == 1:
        return -values[0]
    result = values[0]
    for value in values[1:]:
        result -= value
    return result


def builtin_mul(*values: Any) -> Any:
    result = 1
    for value in values:
        result *= value
    return result


def builtin_div(*values: Any) -> Any:
    ensure_arity("/", values, 1)
    if len(values) == 1:
        return 1 / values[0]
    result = values[0]
    for value in values[1:]:
        result /= value
    return result


def builtin_modulo(a: Any, b: Any) -> Any:
    return a % b


def builtin_not(value: Any) -> bool:
    return not is_truthy(value)


def builtin_cons(first: Any, rest: Any) -> Any:
    if isinstance(rest, list):
        return [first, *rest]
    if isinstance(rest, DottedList):
        return DottedList([first, *rest.items], rest.tail)
    return DottedList([first], rest)


def builtin_car(value: Any) -> Any:
    if isinstance(value, list) and value:
        return value[0]
    if isinstance(value, DottedList) and value.items:
        return value.items[0]
    raise LispError("car expected a non-empty list")


def builtin_cdr(value: Any) -> Any:
    if isinstance(value, list):
        if not value:
            raise LispError("cdr expected a non-empty list")
        return value[1:]
    if isinstance(value, DottedList):
        if not value.items:
            return value.tail
        if len(value.items) == 1:
            return value.tail
        return DottedList(value.items[1:], value.tail)
    raise LispError("cdr expected a non-empty list")


def builtin_list(*values: Any) -> List[Any]:
    return list(values)


def builtin_length(value: Any) -> int:
    return len(ensure_list(value, "length"))


def builtin_append(*values: Any) -> List[Any]:
    result: List[Any] = []
    for value in values:
        result.extend(ensure_list(value, "append"))
    return result


def apply_procedure(proc: Any, args: Sequence[Any]) -> Any:
    if isinstance(proc, Procedure):
        call_env = proc.bind(args)
        return eval_expr([Symbol("begin"), *proc.body], call_env)
    if callable(proc):
        return proc(*args)
    raise LispError(f"attempted to call non-procedure: {format_lisp(proc)}")


def builtin_map(proc: Any, values: Any) -> List[Any]:
    items = ensure_list(values, "map")
    return [apply_procedure(proc, [item]) for item in items]


def builtin_filter(proc: Any, values: Any) -> List[Any]:
    items = ensure_list(values, "filter")
    return [item for item in items if is_truthy(apply_procedure(proc, [item]))]


def builtin_null(value: Any) -> bool:
    return value == []


def builtin_pair(value: Any) -> bool:
    return (isinstance(value, list) and len(value) > 0) or isinstance(value, DottedList)


def builtin_listp(value: Any) -> bool:
    return isinstance(value, list)


def builtin_string_length(value: Any) -> int:
    if not isinstance(value, str) or isinstance(value, Symbol):
        raise LispError("string-length expected a string")
    return len(value)


def builtin_string_append(*values: Any) -> str:
    for value in values:
        if not isinstance(value, str) or isinstance(value, Symbol):
            raise LispError("string-append expected strings")
    return "".join(values)


def builtin_substring(value: Any, start: Any, end: Any) -> str:
    if not isinstance(value, str) or isinstance(value, Symbol):
        raise LispError("substring expected a string")
    return value[start:end]


def builtin_string_to_number(value: Any) -> Any:
    if not isinstance(value, str) or isinstance(value, Symbol):
        raise LispError("string->number expected a string")
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return False


def builtin_number_to_string(value: Any) -> str:
    if not isinstance(value, (int, float)):
        raise LispError("number->string expected a number")
    return str(value)


def builtin_display(value: Any) -> None:
    sys.stdout.write(display_text(value))
    sys.stdout.flush()
    return None


def builtin_newline() -> None:
    sys.stdout.write("\n")
    sys.stdout.flush()
    return None


def builtin_print(value: Any) -> None:
    sys.stdout.write(format_lisp(value) + "\n")
    sys.stdout.flush()
    return None


def builtin_exit() -> None:
    raise LispExit()


def standard_env() -> Env:
    env = Env()
    env.update(
        {
            Symbol("nil"): [],
            Symbol("#t"): True,
            Symbol("#f"): False,
            Symbol("+"): builtin_add,
            Symbol("-"): builtin_sub,
            Symbol("*"): builtin_mul,
            Symbol("/"): builtin_div,
            Symbol("modulo"): builtin_modulo,
            Symbol("="): lambda *xs: numeric_chain("=", lambda a, b: a == b, xs),
            Symbol("<"): lambda *xs: numeric_chain("<", lambda a, b: a < b, xs),
            Symbol(">"): lambda *xs: numeric_chain(">", lambda a, b: a > b, xs),
            Symbol("<="): lambda *xs: numeric_chain("<=", lambda a, b: a <= b, xs),
            Symbol(">="): lambda *xs: numeric_chain(">=", lambda a, b: a >= b, xs),
            Symbol("not"): builtin_not,
            Symbol("cons"): builtin_cons,
            Symbol("car"): builtin_car,
            Symbol("cdr"): builtin_cdr,
            Symbol("list"): builtin_list,
            Symbol("length"): builtin_length,
            Symbol("append"): builtin_append,
            Symbol("map"): builtin_map,
            Symbol("filter"): builtin_filter,
            Symbol("null?"): builtin_null,
            Symbol("pair?"): builtin_pair,
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
            Symbol("pi"): math.pi,
        }
    )
    return env


def eval_quasiquote(expr: Any, env: Env, level: int = 1) -> Any:
    if isinstance(expr, list):
        if expr:
            head = expr[0]
            if is_symbol(head, "unquote"):
                if len(expr) != 2:
                    raise LispError("unquote expects one argument")
                if level == 1:
                    return eval_expr(expr[1], env)
                return [UNQUOTE, eval_quasiquote(expr[1], env, level - 1)]
            if is_symbol(head, "unquote-splicing"):
                if len(expr) != 2:
                    raise LispError("unquote-splicing expects one argument")
                if level == 1:
                    raise LispError("unquote-splicing is only valid inside a list")
                return [UNQUOTE_SPLICING, eval_quasiquote(expr[1], env, level - 1)]
            if is_symbol(head, "quasiquote"):
                if len(expr) != 2:
                    raise LispError("quasiquote expects one argument")
                return [QUASIQUOTE, eval_quasiquote(expr[1], env, level + 1)]
        result: List[Any] = []
        for item in expr:
            if (
                isinstance(item, list)
                and item
                and is_symbol(item[0], "unquote-splicing")
                and level == 1
            ):
                if len(item) != 2:
                    raise LispError("unquote-splicing expects one argument")
                spliced = eval_expr(item[1], env)
                if not isinstance(spliced, list):
                    raise LispError("unquote-splicing expected a list")
                result.extend(spliced)
            else:
                result.append(eval_quasiquote(item, env, level))
        return result
    if isinstance(expr, DottedList):
        return DottedList(
            [eval_quasiquote(item, env, level) for item in expr.items],
            eval_quasiquote(expr.tail, env, level),
        )
    return expr


def make_lambda(parts: Sequence[Any], env: Env, is_macro: bool = False) -> Procedure:
    if len(parts) < 3:
        raise LispError(("define-macro" if is_macro else "lambda") + " expects a parameter list and body")
    params, vararg = parse_params(parts[1])
    body = list(parts[2:])
    return Procedure(params=params, vararg=vararg, body=body, env=env, is_macro=is_macro)


def make_named_procedure(signature: Any, body: Sequence[Any], env: Env, is_macro: bool = False) -> tuple[Symbol, Procedure]:
    if isinstance(signature, list):
        if not signature:
            raise LispError("procedure name is required")
        name = signature[0]
        if not isinstance(name, Symbol):
            raise LispError("procedure name must be a symbol")
        params = signature[1:]
        proc = Procedure(*parse_params(params), body=list(body), env=env, is_macro=is_macro)
        return name, proc
    if isinstance(signature, DottedList):
        if not signature.items:
            raise LispError("procedure name is required")
        name = signature.items[0]
        if not isinstance(name, Symbol):
            raise LispError("procedure name must be a symbol")
        proc_params = DottedList(signature.items[1:], signature.tail)
        proc = Procedure(*parse_params(proc_params), body=list(body), env=env, is_macro=is_macro)
        return name, proc
    raise LispError("invalid procedure definition")


def eval_expr(expr: Any, env: Env) -> Any:
    while True:
        if isinstance(expr, Symbol):
            return env.find(expr)[expr]
        if is_self_evaluating(expr):
            return expr
        if isinstance(expr, DottedList):
            raise LispError("cannot evaluate dotted list directly")
        if not isinstance(expr, list):
            return expr
        if not expr:
            return []

        op = expr[0]
        args = expr[1:]

        if is_symbol(op, "quote"):
            ensure_arity("quote", args, 1, 1)
            return args[0]

        if is_symbol(op, "quasiquote"):
            ensure_arity("quasiquote", args, 1, 1)
            return eval_quasiquote(args[0], env)

        if is_symbol(op, "if"):
            if len(args) not in (2, 3):
                raise LispError("if expects 2 or 3 arguments")
            test = eval_expr(args[0], env)
            expr = args[1] if is_truthy(test) else (args[2] if len(args) == 3 else [])
            continue

        if is_symbol(op, "define"):
            ensure_arity("define", args, 2)
            target = args[0]
            if isinstance(target, (list, DottedList)):
                name, proc = make_named_procedure(target, args[1:], env)
                env[name] = proc
                return None
            if not isinstance(target, Symbol):
                raise LispError("define target must be a symbol")
            env[target] = eval_expr(args[1], env)
            return None

        if is_symbol(op, "define-macro"):
            ensure_arity("define-macro", args, 2)
            signature = args[0]
            name, proc = make_named_procedure(signature, args[1:], env, is_macro=True)
            env[name] = proc
            return None

        if is_symbol(op, "lambda"):
            return make_lambda(expr, env)

        if is_symbol(op, "set!"):
            ensure_arity("set!", args, 2, 2)
            if not isinstance(args[0], Symbol):
                raise LispError("set! target must be a symbol")
            value = eval_expr(args[1], env)
            env.set_existing(args[0], value)
            return None

        if is_symbol(op, "begin"):
            if not args:
                return []
            for part in args[:-1]:
                eval_expr(part, env)
            expr = args[-1]
            continue

        if is_symbol(op, "cond"):
            matched = False
            for clause in args:
                clause_items = expect_list(clause, "cond clauses must be lists")
                if not clause_items:
                    raise LispError("cond clause cannot be empty")
                test_expr = clause_items[0]
                body = clause_items[1:]
                if is_symbol(test_expr, "else"):
                    matched = True
                    expr = [Symbol("begin"), *body] if body else []
                    break
                test_value = eval_expr(test_expr, env)
                if is_truthy(test_value):
                    matched = True
                    if body:
                        expr = [Symbol("begin"), *body]
                    else:
                        return test_value
                    break
            if not matched:
                return []
            continue

        if is_symbol(op, "let") or is_symbol(op, "let*"):
            ensure_arity(str(op), args, 2)
            bindings = expect_list(args[0], f"{op} bindings must be a list")
            if is_symbol(op, "let"):
                values = []
                for binding in bindings:
                    pair = expect_list(binding, "let binding must be a list")
                    if len(pair) != 2 or not isinstance(pair[0], Symbol):
                        raise LispError("let binding must be (name expr)")
                    values.append((pair[0], eval_expr(pair[1], env)))
                new_env = Env(env)
                for name, value in values:
                    new_env[name] = value
            else:
                new_env = Env(env)
                for binding in bindings:
                    pair = expect_list(binding, "let* binding must be a list")
                    if len(pair) != 2 or not isinstance(pair[0], Symbol):
                        raise LispError("let* binding must be (name expr)")
                    new_env[pair[0]] = eval_expr(pair[1], new_env)
            env = new_env
            expr = [Symbol("begin"), *args[1:]]
            continue

        if is_symbol(op, "and"):
            result: Any = True
            for part in args:
                result = eval_expr(part, env)
                if not is_truthy(result):
                    return result
            return result

        if is_symbol(op, "or"):
            for part in args:
                result = eval_expr(part, env)
                if is_truthy(result):
                    return result
            return False

        proc = eval_expr(op, env)
        if isinstance(proc, Procedure) and proc.is_macro:
            expr = apply_procedure(proc, args)
            continue
        evaluated_args = [eval_expr(arg, env) for arg in args]
        if isinstance(proc, Procedure):
            env = proc.bind(evaluated_args)
            expr = [Symbol("begin"), *proc.body]
            continue
        return apply_procedure(proc, evaluated_args)


def eval_program(source: str, env: Optional[Env] = None) -> Any:
    runtime_env = env or standard_env()
    result: Any = None
    for expr in parse_program(source):
        result = eval_expr(expr, runtime_env)
    return result


def paren_balance(source: str) -> int:
    depth = 0
    i = 0
    in_string = False
    escaped = False
    while i < len(source):
        ch = source[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
        elif ch == ";":
            while i < len(source) and source[i] != "\n":
                i += 1
            continue
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        i += 1
    return depth


def needs_more_input(buffer: str) -> bool:
    if not buffer.strip():
        return False
    return paren_balance(buffer) > 0


def repl() -> int:
    env = standard_env()
    buffer = ""
    prompt = "lisp> "
    while True:
        try:
            line = input(prompt if not buffer else "... ")
        except EOFError:
            sys.stdout.write("\n")
            return 0
        except KeyboardInterrupt:
            sys.stdout.write("\n")
            buffer = ""
            continue

        buffer = f"{buffer}\n{line}" if buffer else line
        if needs_more_input(buffer):
            continue
        try:
            result = eval_program(buffer, env)
            if result is not None:
                print(format_lisp(result))
        except LispExit:
            return 0
        except Exception as exc:
            print(f"Error: {exc}")
        buffer = ""


def run_file(path: str) -> int:
    env = standard_env()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            eval_program(handle.read(), env)
        return 0
    except LispExit:
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    if len(args) > 1:
        print("Usage: python lisp.py [file.lisp]", file=sys.stderr)
        return 1
    if args:
        return run_file(args[0])
    return repl()


if __name__ == "__main__":
    raise SystemExit(main())
