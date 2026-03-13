#!/usr/bin/env python3
"""A Scheme-like Lisp interpreter with REPL, TCO, closures, and macros."""

import sys
import re
import operator
import math

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

class Symbol(str):
    """A Lisp symbol."""
    pass

class Nil:
    """The nil / empty-list value."""
    _instance = None
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    def __repr__(self):
        return "()"
    def __bool__(self):
        return False
    def __eq__(self, other):
        return isinstance(other, Nil)
    def __hash__(self):
        return hash(())

NIL = Nil()

class Pair:
    """A cons cell."""
    __slots__ = ('car', 'cdr')
    def __init__(self, car, cdr):
        self.car = car
        self.cdr = cdr

    def to_list(self):
        """Convert a proper list to a Python list. Raises if improper."""
        result = []
        cur = self
        while isinstance(cur, Pair):
            result.append(cur.car)
            cur = cur.cdr
        if cur != NIL:
            raise LispError("Not a proper list")
        return result

    def __eq__(self, other):
        if isinstance(other, Pair):
            return self.car == other.car and self.cdr == other.cdr
        return False

    def __hash__(self):
        return hash((self.car, self.cdr))

    def __repr__(self):
        return "(" + _pair_repr_inner(self) + ")"

def _pair_repr_inner(p):
    parts = []
    cur = p
    while isinstance(cur, Pair):
        parts.append(lispstr(cur.car))
        cur = cur.cdr
    if cur == NIL:
        return " ".join(parts)
    else:
        parts.append(".")
        parts.append(lispstr(cur))
        return " ".join(parts)

def python_list_to_lisp(lst):
    """Convert a Python list to a Lisp proper list (chain of Pairs ending in NIL)."""
    result = NIL
    for item in reversed(lst):
        result = Pair(item, result)
    return result

def lisp_list_to_python(val):
    """Convert a Lisp list to a Python list."""
    if val == NIL:
        return []
    if isinstance(val, Pair):
        return val.to_list()
    raise LispError(f"Expected list, got {type(val).__name__}")

class Lambda:
    """A user-defined function (closure)."""
    __slots__ = ('params', 'rest_param', 'body', 'env', 'name')
    def __init__(self, params, body, env, rest_param=None, name=None):
        self.params = params        # list of Symbol
        self.rest_param = rest_param  # Symbol or None (for dotted / variadic)
        self.body = body            # list of expressions
        self.env = env
        self.name = name

    def __repr__(self):
        if self.name:
            return f"#<procedure {self.name}>"
        return "#<lambda>"

class Macro:
    """A user-defined macro."""
    __slots__ = ('params', 'rest_param', 'body', 'env', 'name')
    def __init__(self, params, body, env, rest_param=None, name=None):
        self.params = params
        self.rest_param = rest_param
        self.body = body
        self.env = env
        self.name = name

    def __repr__(self):
        if self.name:
            return f"#<macro {self.name}>"
        return "#<macro>"

class TailCall:
    """Sentinel for tail-call optimisation."""
    __slots__ = ('func', 'args')
    def __init__(self, func, args):
        self.func = func
        self.args = args

class LispError(Exception):
    pass

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

class Env(dict):
    """An environment frame."""
    def __init__(self, params=(), args=(), outer=None):
        super().__init__()
        self.outer = outer
        if isinstance(params, list):
            for p, a in zip(params, args):
                self[p] = a
        else:
            self[params] = args

    def find(self, var):
        """Find the innermost Env where var is defined."""
        if var in self:
            return self
        if self.outer is not None:
            return self.outer.find(var)
        raise LispError(f"Undefined variable: {var}")

    def get_var(self, var):
        return self.find(var)[var]

    def set_var(self, var, val):
        self.find(var)[var] = val

# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------

TOKEN_RE = re.compile(
    r"""(
        ;[^\n]*                   # comment
      | \#t | \#f                 # booleans
      | ,@                        # splice-unquote
      | [('`,)]                   # special chars
      | "(?:[^"\\]|\\.)*"        # string
      | [^\s()'`,";]+            # atom
    )""",
    re.VERBOSE,
)

def tokenize(source):
    """Tokenize a Lisp source string."""
    tokens = []
    for m in TOKEN_RE.finditer(source):
        tok = m.group(1)
        if tok.startswith(';'):
            continue
        tokens.append(tok)
    return tokens

# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def parse(source):
    """Parse source string into a list of Lisp expressions."""
    tokens = tokenize(source)
    results = []
    pos = [0]  # mutable index

    def peek():
        return tokens[pos[0]] if pos[0] < len(tokens) else None

    def advance():
        tok = tokens[pos[0]]
        pos[0] += 1
        return tok

    def read_expr():
        tok = peek()
        if tok is None:
            raise LispError("Unexpected end of input")
        if tok == '(':
            return read_list()
        elif tok == "'":
            advance()
            return Pair(Symbol('quote'), Pair(read_expr(), NIL))
        elif tok == '`':
            advance()
            return Pair(Symbol('quasiquote'), Pair(read_expr(), NIL))
        elif tok == ',@':
            advance()
            return Pair(Symbol('unquote-splicing'), Pair(read_expr(), NIL))
        elif tok == ',':
            advance()
            return Pair(Symbol('unquote'), Pair(read_expr(), NIL))
        elif tok == ')':
            raise LispError("Unexpected )")
        else:
            return read_atom()

    def read_list():
        advance()  # skip '('
        items = []
        rest = None
        while True:
            tok = peek()
            if tok is None:
                raise LispError("Unexpected end of input (unclosed parenthesis)")
            if tok == ')':
                advance()
                break
            if tok == '.':
                advance()  # skip '.'
                rest = read_expr()
                if peek() != ')':
                    raise LispError("Expected ) after dotted pair")
                advance()
                break
            items.append(read_expr())
        # Build Pair chain
        if rest is not None:
            result = rest
        else:
            result = NIL
        for item in reversed(items):
            result = Pair(item, result)
        return result

    def read_atom():
        tok = advance()
        if tok == '#t':
            return True
        if tok == '#f':
            return False
        if tok == 'nil':
            return NIL
        # Try integer
        try:
            return int(tok)
        except ValueError:
            pass
        # Try float
        try:
            return float(tok)
        except ValueError:
            pass
        # String
        if tok.startswith('"') and tok.endswith('"'):
            return tok[1:-1].replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
        return Symbol(tok)

    while pos[0] < len(tokens):
        results.append(read_expr())

    return results

def parse_one(source):
    """Parse a single expression from source."""
    exprs = parse(source)
    if len(exprs) == 0:
        return None
    return exprs[0]

# ---------------------------------------------------------------------------
# Printer
# ---------------------------------------------------------------------------

def lispstr(val):
    """Convert a Python value to its Lisp string representation."""
    if val is True:
        return "#t"
    if val is False:
        return "#f"
    if val is NIL:
        return "()"
    if isinstance(val, Pair):
        return repr(val)
    if isinstance(val, str) and not isinstance(val, Symbol):
        escaped = val.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\t', '\\t')
        return f'"{escaped}"'
    if isinstance(val, Symbol):
        return str(val)
    if isinstance(val, (Lambda, Macro)):
        return repr(val)
    if isinstance(val, float):
        if val == int(val) and not math.isinf(val) and not math.isnan(val):
            return repr(val)
        return repr(val)
    return str(val)

# ---------------------------------------------------------------------------
# Evaluator with TCO
# ---------------------------------------------------------------------------

def eval_expr(expr, env, tail=False):
    """Evaluate a Lisp expression in the given environment.

    If tail=True, may return a TailCall instead of the final value.
    """
    while True:
        # Self-evaluating types
        if isinstance(expr, (int, float)):
            return expr
        if isinstance(expr, bool):
            return expr
        if isinstance(expr, str) and not isinstance(expr, Symbol):
            return expr
        if expr is NIL:
            return NIL

        # Symbol lookup
        if isinstance(expr, Symbol):
            return env.get_var(expr)

        # Must be a Pair (list form)
        if not isinstance(expr, Pair):
            return expr

        head = expr.car
        rest = expr.cdr

        # Special forms
        if isinstance(head, Symbol):
            # quote
            if head == 'quote':
                return rest.car

            # quasiquote
            if head == 'quasiquote':
                return expand_quasiquote(rest.car, env)

            # if
            if head == 'if':
                args = lisp_list_to_python(rest)
                test_val = eval_expr(args[0], env)
                if is_true(test_val):
                    expr = args[1]
                    continue  # TCO
                elif len(args) > 2:
                    expr = args[2]
                    continue  # TCO
                else:
                    return NIL  # no else branch

            # cond
            if head == 'cond':
                clauses = lisp_list_to_python(rest)
                for clause in clauses:
                    clause_parts = lisp_list_to_python(clause)
                    test = clause_parts[0]
                    if (isinstance(test, Symbol) and test == 'else') or is_true(eval_expr(test, env)):
                        # Evaluate body expressions, last in tail position
                        for body_expr in clause_parts[1:-1]:
                            eval_expr(body_expr, env)
                        expr = clause_parts[-1]
                        break  # will continue outer while for TCO
                else:
                    return NIL
                continue  # TCO for the last expr

            # define
            if head == 'define':
                first = rest.car
                if isinstance(first, Pair):
                    # (define (name params...) body...)
                    name = first.car
                    param_names, rest_param = _parse_params(first.cdr)
                    body = lisp_list_to_python(rest.cdr)
                    func = Lambda(param_names, body, env, rest_param=rest_param, name=str(name))
                    env[name] = func
                    return None  # define returns nothing meaningful
                else:
                    # (define x value)
                    name = first
                    val = eval_expr(rest.cdr.car, env)
                    env[name] = val
                    return None

            # define-macro
            if head == 'define-macro':
                first = rest.car
                if isinstance(first, Pair):
                    name = first.car
                    params, rest_param = _parse_params(first.cdr)
                    body = lisp_list_to_python(rest.cdr)
                    macro = Macro(params, body, env, rest_param=rest_param, name=str(name))
                    env[name] = macro
                    return None
                else:
                    raise LispError("define-macro requires (name params...) form")

            # set!
            if head == 'set!':
                name = rest.car
                val = eval_expr(rest.cdr.car, env)
                env.set_var(name, val)
                return None

            # lambda
            if head == 'lambda':
                params_expr = rest.car
                params, rest_param = _parse_params(params_expr)
                body = lisp_list_to_python(rest.cdr)
                return Lambda(params, body, env, rest_param=rest_param)

            # let
            if head == 'let':
                bindings = lisp_list_to_python(rest.car)
                body = lisp_list_to_python(rest.cdr)
                new_env = Env(outer=env)
                for binding in bindings:
                    b = lisp_list_to_python(binding)
                    new_env[b[0]] = eval_expr(b[1], env)
                env = new_env
                for body_expr in body[:-1]:
                    eval_expr(body_expr, env)
                expr = body[-1]
                continue  # TCO

            # let*
            if head == 'let*':
                bindings = lisp_list_to_python(rest.car)
                body = lisp_list_to_python(rest.cdr)
                new_env = Env(outer=env)
                for binding in bindings:
                    b = lisp_list_to_python(binding)
                    new_env[b[0]] = eval_expr(b[1], new_env)
                env = new_env
                for body_expr in body[:-1]:
                    eval_expr(body_expr, env)
                expr = body[-1]
                continue  # TCO

            # begin
            if head == 'begin':
                body = lisp_list_to_python(rest)
                if not body:
                    return NIL
                for body_expr in body[:-1]:
                    eval_expr(body_expr, env)
                expr = body[-1]
                continue  # TCO

            # and (short-circuit)
            if head == 'and':
                args = lisp_list_to_python(rest)
                if not args:
                    return True
                for arg in args[:-1]:
                    val = eval_expr(arg, env)
                    if not is_true(val):
                        return val
                expr = args[-1]
                continue  # TCO

            # or (short-circuit)
            if head == 'or':
                args = lisp_list_to_python(rest)
                if not args:
                    return False
                for arg in args[:-1]:
                    val = eval_expr(arg, env)
                    if is_true(val):
                        return val
                expr = args[-1]
                continue  # TCO

        # ----- Function / macro application -----
        func = eval_expr(head, env)

        # Macro expansion
        if isinstance(func, Macro):
            args = lisp_list_to_python(rest)  # unevaluated args
            expanded = _apply_macro(func, args)
            expr = expanded
            continue  # evaluate the expansion

        # Evaluate arguments
        args = []
        cur = rest
        while isinstance(cur, Pair):
            args.append(eval_expr(cur.car, env))
            cur = cur.cdr

        # Built-in function
        if callable(func) and not isinstance(func, Lambda):
            return func(*args)

        # Lambda call
        if isinstance(func, Lambda):
            new_env = Env(outer=func.env)
            _bind_args(func, args, new_env)
            # Evaluate body with TCO on last expression
            for body_expr in func.body[:-1]:
                eval_expr(body_expr, new_env)
            expr = func.body[-1]
            env = new_env
            continue  # TCO

        raise LispError(f"Not callable: {lispstr(func)}")


def _parse_params(params_expr):
    """Parse a parameter list, possibly with a rest parameter (dotted or symbol)."""
    if isinstance(params_expr, Symbol):
        # (lambda args body) – all args in one list
        return [], params_expr
    if params_expr == NIL:
        return [], None
    params = []
    rest_param = None
    cur = params_expr
    while isinstance(cur, Pair):
        params.append(cur.car)
        cur = cur.cdr
    if cur != NIL:
        rest_param = cur
    return params, rest_param


def _bind_args(func, args, new_env):
    """Bind arguments to a Lambda's parameters in new_env."""
    if func.rest_param:
        if len(args) < len(func.params):
            raise LispError(f"Too few arguments for {func}")
        for p, a in zip(func.params, args[:len(func.params)]):
            new_env[p] = a
        new_env[func.rest_param] = python_list_to_lisp(args[len(func.params):])
    else:
        if len(args) != len(func.params):
            raise LispError(f"Expected {len(func.params)} args, got {len(args)} for {func}")
        for p, a in zip(func.params, args):
            new_env[p] = a


def _apply_macro(macro, args):
    """Expand a macro call by applying it to unevaluated arguments."""
    new_env = Env(outer=macro.env)
    _bind_args_macro(macro, args, new_env)
    result = None
    for body_expr in macro.body:
        result = eval_expr(body_expr, new_env)
    return result


def _bind_args_macro(macro, args, new_env):
    """Bind arguments for macro expansion."""
    if macro.rest_param:
        for p, a in zip(macro.params, args[:len(macro.params)]):
            new_env[p] = a
        new_env[macro.rest_param] = python_list_to_lisp(args[len(macro.params):])
    else:
        if len(args) != len(macro.params):
            raise LispError(f"Macro {macro} expected {len(macro.params)} args, got {len(args)}")
        for p, a in zip(macro.params, args):
            new_env[p] = a


def is_true(val):
    """In Scheme, everything except #f is true."""
    return val is not False


def expand_quasiquote(expr, env):
    """Expand a quasiquote expression."""
    if isinstance(expr, Pair):
        # Check for unquote
        if isinstance(expr.car, Symbol) and expr.car == 'unquote':
            return eval_expr(expr.cdr.car, env)
        # Check for splicing in list elements
        return _qq_list(expr, env)
    return expr


def _qq_list(expr, env):
    """Process a quasiquoted list, handling unquote-splicing."""
    if expr == NIL:
        return NIL
    if not isinstance(expr, Pair):
        return expr

    head = expr.car
    # Check if head is (unquote-splicing ...)
    if isinstance(head, Pair) and isinstance(head.car, Symbol) and head.car == 'unquote-splicing':
        spliced = eval_expr(head.cdr.car, env)
        rest = _qq_list(expr.cdr, env)
        # Append spliced list to rest
        return _lisp_append(spliced, rest)

    # Check for unquote
    if isinstance(head, Symbol) and head == 'unquote':
        return eval_expr(expr.cdr.car, env)

    # Recurse
    return Pair(expand_quasiquote(head, env), _qq_list(expr.cdr, env))


def _lisp_append(a, b):
    """Append two Lisp lists."""
    if a == NIL:
        return b
    if isinstance(a, Pair):
        return Pair(a.car, _lisp_append(a.cdr, b))
    raise LispError(f"Cannot append non-list: {lispstr(a)}")

# ---------------------------------------------------------------------------
# Standard environment (built-in functions)
# ---------------------------------------------------------------------------

def make_global_env():
    env = Env()

    # Arithmetic
    def add(*args):
        result = 0
        for a in args:
            result += a
        return result

    def sub(*args):
        if len(args) == 1:
            return -args[0]
        result = args[0]
        for a in args[1:]:
            result -= a
        return result

    def mul(*args):
        result = 1
        for a in args:
            result *= a
        return result

    def div(*args):
        if len(args) == 1:
            return 1 / args[0]
        result = args[0]
        for a in args[1:]:
            result = result / a
        return result

    env[Symbol('+')] = add
    env[Symbol('-')] = sub
    env[Symbol('*')] = mul
    env[Symbol('/')] = div
    env[Symbol('modulo')] = lambda a, b: a % b
    env[Symbol('remainder')] = lambda a, b: a % b
    env[Symbol('abs')] = abs
    env[Symbol('min')] = min
    env[Symbol('max')] = max
    env[Symbol('floor')] = lambda x: int(math.floor(x))
    env[Symbol('ceil')] = lambda x: int(math.ceil(x))
    env[Symbol('round')] = round
    env[Symbol('expt')] = lambda a, b: a ** b
    env[Symbol('sqrt')] = math.sqrt

    # Comparison
    env[Symbol('=')] = lambda a, b: a == b
    env[Symbol('<')] = lambda a, b: a < b
    env[Symbol('>')] = lambda a, b: a > b
    env[Symbol('<=')] = lambda a, b: a <= b
    env[Symbol('>=')] = lambda a, b: a >= b
    env[Symbol('eq?')] = lambda a, b: a is b
    env[Symbol('equal?')] = lambda a, b: a == b

    # Logic
    env[Symbol('not')] = lambda x: not is_true(x)

    # List operations
    env[Symbol('cons')] = lambda a, b: Pair(a, b)
    env[Symbol('car')] = lambda p: p.car
    env[Symbol('cdr')] = lambda p: p.cdr
    env[Symbol('list')] = lambda *args: python_list_to_lisp(list(args))
    env[Symbol('length')] = lambda lst: len(lisp_list_to_python(lst))

    def append_func(*args):
        if not args:
            return NIL
        result = args[-1]
        for lst in reversed(args[:-1]):
            items = lisp_list_to_python(lst)
            for item in reversed(items):
                result = Pair(item, result)
        return result
    env[Symbol('append')] = append_func

    def map_func(func, lst):
        items = lisp_list_to_python(lst)
        result = []
        for item in items:
            if isinstance(func, Lambda):
                result.append(_call_lambda(func, [item]))
            else:
                result.append(func(item))
        return python_list_to_lisp(result)
    env[Symbol('map')] = map_func

    def filter_func(func, lst):
        items = lisp_list_to_python(lst)
        result = []
        for item in items:
            if isinstance(func, Lambda):
                val = _call_lambda(func, [item])
            else:
                val = func(item)
            if is_true(val):
                result.append(item)
        return python_list_to_lisp(result)
    env[Symbol('filter')] = filter_func

    def for_each_func(func, lst):
        items = lisp_list_to_python(lst)
        for item in items:
            if isinstance(func, Lambda):
                _call_lambda(func, [item])
            else:
                func(item)
        return None
    env[Symbol('for-each')] = for_each_func

    env[Symbol('null?')] = lambda x: x == NIL
    env[Symbol('pair?')] = lambda x: isinstance(x, Pair)
    env[Symbol('list?')] = lambda x: _is_proper_list(x)
    env[Symbol('number?')] = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)
    env[Symbol('string?')] = lambda x: isinstance(x, str) and not isinstance(x, Symbol)
    env[Symbol('symbol?')] = lambda x: isinstance(x, Symbol)
    env[Symbol('boolean?')] = lambda x: isinstance(x, bool)
    env[Symbol('procedure?')] = lambda x: callable(x) or isinstance(x, Lambda)
    env[Symbol('integer?')] = lambda x: isinstance(x, int) and not isinstance(x, bool)
    env[Symbol('zero?')] = lambda x: x == 0

    # String operations
    env[Symbol('string-length')] = lambda s: len(s)
    env[Symbol('string-append')] = lambda *args: "".join(args)
    env[Symbol('substring')] = lambda s, start, end: s[start:end]
    env[Symbol('string->number')] = lambda s: _string_to_number(s)
    env[Symbol('number->string')] = lambda n: str(n)
    env[Symbol('string->symbol')] = lambda s: Symbol(s)
    env[Symbol('symbol->string')] = lambda s: str(s)
    env[Symbol('string-ref')] = lambda s, i: s[i]
    env[Symbol('string=?')] = lambda a, b: a == b

    # I/O
    def display_func(*args):
        for a in args:
            if isinstance(a, str) and not isinstance(a, Symbol):
                print(a, end='')
            else:
                print(lispstr(a), end='')
        return None
    env[Symbol('display')] = display_func
    env[Symbol('newline')] = lambda: print() or None

    def print_func(*args):
        for a in args:
            print(lispstr(a))
        return None
    env[Symbol('print')] = print_func

    # apply
    def apply_func(func, *args):
        if not args:
            raise LispError("apply requires at least 2 arguments")
        # Last arg should be a list
        all_args = list(args[:-1])
        last = args[-1]
        all_args.extend(lisp_list_to_python(last))
        if isinstance(func, Lambda):
            return _call_lambda(func, all_args)
        return func(*all_args)
    env[Symbol('apply')] = apply_func

    # eval
    def eval_func(expr):
        return eval_expr(expr, env)
    env[Symbol('eval')] = eval_func

    # error
    env[Symbol('error')] = lambda *args: (_ for _ in ()).throw(LispError(" ".join(str(a) for a in args)))

    # exit
    env[Symbol('exit')] = lambda *args: sys.exit(args[0] if args else 0)

    return env


def _call_lambda(func, args):
    """Call a Lambda (used by built-in higher-order functions)."""
    new_env = Env(outer=func.env)
    _bind_args(func, args, new_env)
    result = None
    for body_expr in func.body[:-1]:
        eval_expr(body_expr, new_env)
    return eval_expr(func.body[-1], new_env)


def _is_proper_list(x):
    """Check if x is a proper list."""
    if x == NIL:
        return True
    if isinstance(x, Pair):
        return _is_proper_list(x.cdr)
    return False


def _string_to_number(s):
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return False

# ---------------------------------------------------------------------------
# REPL
# ---------------------------------------------------------------------------

def run_repl():
    """Run the interactive REPL."""
    env = make_global_env()
    print("Lisp REPL (Ctrl+D or (exit) to quit)")

    while True:
        try:
            line = input("lisp> ")
        except EOFError:
            print()
            break
        except KeyboardInterrupt:
            print()
            continue

        # Accumulate multi-line input until parens are balanced
        source = line
        while not _balanced(source):
            try:
                more = input("  ... ")
                source += "\n" + more
            except EOFError:
                print()
                return
            except KeyboardInterrupt:
                print()
                source = None
                break

        if source is None:
            continue

        source = source.strip()
        if not source:
            continue

        try:
            exprs = parse(source)
            result = None
            for expr in exprs:
                result = eval_expr(expr, env)
            if result is not None:
                print(lispstr(result))
        except SystemExit:
            break
        except LispError as e:
            print(f"Error: {e}")
        except Exception as e:
            print(f"Error: {e}")


def _balanced(source):
    """Check if parentheses are balanced (for multi-line input)."""
    depth = 0
    in_string = False
    escape = False
    for ch in source:
        if escape:
            escape = False
            continue
        if ch == '\\' and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
    return depth <= 0 and not in_string


def run_file(filename):
    """Execute a Lisp file."""
    env = make_global_env()
    with open(filename, 'r') as f:
        source = f.read()
    try:
        exprs = parse(source)
        result = None
        for expr in exprs:
            result = eval_expr(expr, env)
        if result is not None:
            print(lispstr(result))
    except SystemExit:
        pass
    except LispError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Public API for testing
# ---------------------------------------------------------------------------

def run(source, env=None):
    """Evaluate source code string and return the result. Useful for testing."""
    if env is None:
        env = make_global_env()
    exprs = parse(source)
    result = None
    for expr in exprs:
        result = eval_expr(expr, env)
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) > 1:
        run_file(sys.argv[1])
    else:
        run_repl()
