#!/usr/bin/env python3
"""A Scheme-like Lisp interpreter with REPL, TCO, and macros."""

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
    def __repr__(self):
        return '(' + self._inner() + ')'
    def _inner(self):
        parts = [lisp_repr(self.car)]
        rest = self.cdr
        while isinstance(rest, Pair):
            parts.append(lisp_repr(rest.car))
            rest = rest.cdr
        if rest is not NIL:
            parts.append('.')
            parts.append(lisp_repr(rest))
        return ' '.join(parts)
    def __eq__(self, other):
        if not isinstance(other, Pair):
            return False
        return self.car == other.car and self.cdr == other.cdr
    def __hash__(self):
        return hash((self.car, self.cdr))

def pair_to_list(p):
    """Convert a Pair chain to a Python list."""
    result = []
    while isinstance(p, Pair):
        result.append(p.car)
        p = p.cdr
    if p is not NIL:
        raise LispError("Expected proper list")
    return result

def list_to_pair(lst, tail=None):
    """Convert a Python list to a Pair chain."""
    if tail is None:
        tail = NIL
    result = tail
    for item in reversed(lst):
        result = Pair(item, result)
    return result

class Lambda:
    """A user-defined function (closure)."""
    __slots__ = ('params', 'rest_param', 'body', 'env', 'name')
    def __init__(self, params, body, env, rest_param=None, name=None):
        self.params = params
        self.rest_param = rest_param
        self.body = body
        self.env = env
        self.name = name
    def __repr__(self):
        if self.name:
            return f'#<procedure {self.name}>'
        return '#<lambda>'

class Macro:
    """A macro transformer."""
    __slots__ = ('params', 'rest_param', 'body', 'env', 'name')
    def __init__(self, params, body, env, rest_param=None, name=None):
        self.params = params
        self.rest_param = rest_param
        self.body = body
        self.env = env
        self.name = name
    def __repr__(self):
        if self.name:
            return f'#<macro {self.name}>'
        return '#<macro>'

class TailCall:
    """Sentinel for TCO – represents a deferred call."""
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
    """An environment: a dict of {'var': val} pairs with an outer Env."""
    def __init__(self, params=(), args=(), outer=None):
        super().__init__()
        self.update(zip(params, args))
        self.outer = outer

    def find(self, var):
        """Find the innermost Env where var appears."""
        if var in self:
            return self
        if self.outer is not None:
            return self.outer.find(var)
        raise LispError(f"Undefined variable: {var}")

    def get_val(self, var):
        return self.find(var)[var]

    def set_val(self, var, val):
        self.find(var)[var] = val

# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------

TOKEN_RE = re.compile(
    r"""(\s+|;[^\n]*|"""           # whitespace / comments
    r""""(?:[^"\\]|\\.)*"|"""      # strings
    r""",@|"""                      # splice-unquote
    r"""[()'\`,]|"""               # parens, quote, quasiquote, unquote
    r"""[^\s()'`,";]+)""",         # atoms
    re.VERBOSE
)

def tokenize(source):
    tokens = []
    for m in TOKEN_RE.finditer(source):
        tok = m.group(1)
        if tok[0] in ' \t\n\r' or tok[0] == ';':
            continue
        tokens.append(tok)
    return tokens

# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def parse(source):
    """Parse a source string into a list of AST forms."""
    tokens = tokenize(source)
    results = []
    pos = [0]
    while pos[0] < len(tokens):
        results.append(read_form(tokens, pos))
    return results

def read_form(tokens, pos):
    if pos[0] >= len(tokens):
        raise LispError("Unexpected EOF")
    tok = tokens[pos[0]]
    if tok == '(':
        return read_list(tokens, pos)
    elif tok == "'":
        pos[0] += 1
        form = read_form(tokens, pos)
        return Pair(Symbol('quote'), Pair(form, NIL))
    elif tok == '`':
        pos[0] += 1
        form = read_form(tokens, pos)
        return Pair(Symbol('quasiquote'), Pair(form, NIL))
    elif tok == ',':
        pos[0] += 1
        form = read_form(tokens, pos)
        return Pair(Symbol('unquote'), Pair(form, NIL))
    elif tok == ',@':
        pos[0] += 1
        form = read_form(tokens, pos)
        return Pair(Symbol('unquote-splicing'), Pair(form, NIL))
    else:
        pos[0] += 1
        return read_atom(tok)

def read_list(tokens, pos):
    pos[0] += 1  # skip '('
    items = []
    dot_cdr = None
    while True:
        if pos[0] >= len(tokens):
            raise LispError("Unexpected EOF: missing ')'")
        if tokens[pos[0]] == ')':
            pos[0] += 1
            break
        if tokens[pos[0]] == '.':
            pos[0] += 1
            dot_cdr = read_form(tokens, pos)
            if pos[0] >= len(tokens) or tokens[pos[0]] != ')':
                raise LispError("Expected ')' after dotted pair")
            pos[0] += 1
            break
        items.append(read_form(tokens, pos))
    if dot_cdr is not None:
        return list_to_pair(items, dot_cdr)
    return list_to_pair(items)

def read_atom(token):
    if token == '#t':
        return True
    if token == '#f':
        return False
    if token == 'nil':
        return NIL
    if token.startswith('"') and token.endswith('"'):
        s = token[1:-1]
        s = s.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
        return s
    try:
        return int(token)
    except ValueError:
        pass
    try:
        return float(token)
    except ValueError:
        pass
    return Symbol(token)

def is_complete(source):
    """Check if parentheses are balanced (for multiline REPL input)."""
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

# ---------------------------------------------------------------------------
# Lisp representation
# ---------------------------------------------------------------------------

def lisp_repr(val):
    if val is True:
        return '#t'
    if val is False:
        return '#f'
    if val is NIL:
        return '()'
    if isinstance(val, Pair):
        return repr(val)
    if isinstance(val, str) and not isinstance(val, Symbol):
        escaped = val.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\t', '\\t')
        return f'"{escaped}"'
    if isinstance(val, float):
        if val == int(val) and not (math.isinf(val) or math.isnan(val)):
            return repr(val)
        return repr(val)
    if val is None:
        return '()'
    return str(val)

# ---------------------------------------------------------------------------
# Evaluator with TCO
# ---------------------------------------------------------------------------

def eval_expr(expr, env, tail=False):
    """Evaluate expr in env. If tail=True, may return TailCall for TCO."""
    while True:
        # Self-evaluating
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
            return env.get_val(expr)

        # List forms
        if not isinstance(expr, Pair):
            return expr

        head = expr.car
        args_pair = expr.cdr

        # Special forms
        if isinstance(head, Symbol):
            form = head

            if form == 'quote':
                return args_pair.car

            if form == 'quasiquote':
                return expand_quasiquote(args_pair.car, env)

            if form == 'if':
                args = pair_to_list(args_pair)
                test_val = eval_expr(args[0], env)
                if is_true(test_val):
                    expr = args[1]
                    continue  # TCO
                elif len(args) > 2:
                    expr = args[2]
                    continue  # TCO
                else:
                    return NIL

            if form == 'cond':
                clauses = pair_to_list(args_pair)
                for clause in clauses:
                    clause_parts = pair_to_list(clause)
                    if isinstance(clause_parts[0], Symbol) and clause_parts[0] == 'else':
                        expr = Pair(Symbol('begin'), list_to_pair(clause_parts[1:]))
                        break
                    test_val = eval_expr(clause_parts[0], env)
                    if is_true(test_val):
                        if len(clause_parts) == 1:
                            return test_val
                        expr = Pair(Symbol('begin'), list_to_pair(clause_parts[1:]))
                        break
                else:
                    return NIL
                continue  # TCO for matched clause

            if form == 'define':
                first = args_pair.car
                if isinstance(first, Pair):
                    # (define (name params...) body...)
                    name = first.car
                    params_pair = first.cdr
                    body_pair = args_pair.cdr
                    params, rest_param = parse_params(params_pair)
                    body_list = pair_to_list(body_pair)
                    if len(body_list) == 1:
                        body = body_list[0]
                    else:
                        body = Pair(Symbol('begin'), body_pair)
                    fn = Lambda(params, body, env, rest_param=rest_param, name=str(name))
                    env[name] = fn
                    return None
                else:
                    # (define name value)
                    name = first
                    val = eval_expr(args_pair.cdr.car, env)
                    env[name] = val
                    return None

            if form == 'define-macro':
                first = args_pair.car
                if isinstance(first, Pair):
                    name = first.car
                    params_pair = first.cdr
                    body_pair = args_pair.cdr
                    params, rest_param = parse_params(params_pair)
                    body_list = pair_to_list(body_pair)
                    if len(body_list) == 1:
                        body = body_list[0]
                    else:
                        body = Pair(Symbol('begin'), body_pair)
                    mac = Macro(params, body, env, rest_param=rest_param, name=str(name))
                    env[name] = mac
                    return None
                else:
                    raise LispError("define-macro requires (name params...) form")

            if form == 'set!':
                name = args_pair.car
                val = eval_expr(args_pair.cdr.car, env)
                env.set_val(name, val)
                return None

            if form == 'lambda':
                params_pair = args_pair.car
                body_pair = args_pair.cdr
                params, rest_param = parse_params(params_pair)
                body_list = pair_to_list(body_pair)
                if len(body_list) == 1:
                    body = body_list[0]
                else:
                    body = Pair(Symbol('begin'), body_pair)
                return Lambda(params, body, env, rest_param=rest_param)

            if form == 'begin':
                body = pair_to_list(args_pair)
                if not body:
                    return NIL
                for e in body[:-1]:
                    eval_expr(e, env)
                expr = body[-1]
                continue  # TCO

            if form == 'let':
                bindings_pair = args_pair.car
                body_pair = args_pair.cdr
                bindings = pair_to_list(bindings_pair)
                new_env = Env(outer=env)
                for b in bindings:
                    b_list = pair_to_list(b)
                    new_env[b_list[0]] = eval_expr(b_list[1], env)
                body = pair_to_list(body_pair)
                env = new_env
                if len(body) == 1:
                    expr = body[0]
                else:
                    expr = Pair(Symbol('begin'), body_pair)
                continue  # TCO

            if form == 'let*':
                bindings_pair = args_pair.car
                body_pair = args_pair.cdr
                bindings = pair_to_list(bindings_pair)
                new_env = Env(outer=env)
                for b in bindings:
                    b_list = pair_to_list(b)
                    new_env[b_list[0]] = eval_expr(b_list[1], new_env)
                body = pair_to_list(body_pair)
                env = new_env
                if len(body) == 1:
                    expr = body[0]
                else:
                    expr = Pair(Symbol('begin'), body_pair)
                continue  # TCO

            if form == 'and':
                args = pair_to_list(args_pair)
                if not args:
                    return True
                for a in args[:-1]:
                    val = eval_expr(a, env)
                    if not is_true(val):
                        return val
                expr = args[-1]
                continue  # TCO

            if form == 'or':
                args = pair_to_list(args_pair)
                if not args:
                    return False
                for a in args[:-1]:
                    val = eval_expr(a, env)
                    if is_true(val):
                        return val
                expr = args[-1]
                continue  # TCO

        # Function / macro application
        proc = eval_expr(head, env)

        # Macro expansion
        if isinstance(proc, Macro):
            raw_args = pair_to_list(args_pair)
            expanded = apply_func(proc, raw_args)
            expr = expanded
            continue  # evaluate expanded form

        # Evaluate arguments
        evaled_args = []
        rest = args_pair
        while isinstance(rest, Pair):
            evaled_args.append(eval_expr(rest.car, env))
            rest = rest.cdr

        # Built-in callable
        if callable(proc) and not isinstance(proc, Lambda):
            return proc(*evaled_args)

        # Lambda call – TCO
        if isinstance(proc, Lambda):
            new_env = Env(outer=proc.env)
            bind_args(proc, evaled_args, new_env)
            env = new_env
            expr = proc.body
            continue  # TCO

        raise LispError(f"Not callable: {lisp_repr(proc)}")


def is_true(val):
    return val is not False and val is not NIL


def parse_params(params_pair):
    """Parse parameter list, returning (list_of_params, rest_param_or_None)."""
    params = []
    rest_param = None
    cur = params_pair
    while isinstance(cur, Pair):
        params.append(cur.car)
        cur = cur.cdr
    if cur is not NIL and isinstance(cur, Symbol):
        rest_param = cur
    return params, rest_param


def bind_args(func, args, env):
    """Bind arguments to parameters in env."""
    for i, p in enumerate(func.params):
        if i < len(args):
            env[p] = args[i]
        else:
            raise LispError(f"Too few arguments for {func}")
    if func.rest_param:
        env[func.rest_param] = list_to_pair(args[len(func.params):])
    elif len(args) > len(func.params):
        raise LispError(f"Too many arguments for {func}")


def apply_func(func, args):
    """Apply a Lambda or Macro to args (already evaluated for Lambda)."""
    env = Env(outer=func.env)
    bind_args(func, args, env)
    return eval_expr(func.body, env)


def expand_quasiquote(form, env):
    """Expand quasiquote form."""
    if isinstance(form, Pair):
        if isinstance(form.car, Symbol) and form.car == 'unquote':
            return eval_expr(form.cdr.car, env)
        # Check for splicing
        result = []
        cur = form
        while isinstance(cur, Pair):
            item = cur.car
            if isinstance(item, Pair) and isinstance(item.car, Symbol) and item.car == 'unquote-splicing':
                spliced = eval_expr(item.cdr.car, env)
                if isinstance(spliced, Pair):
                    result.extend(pair_to_list(spliced))
                elif spliced is NIL:
                    pass
                else:
                    raise LispError("unquote-splicing: expected list")
            else:
                result.append(expand_quasiquote(item, env))
            cur = cur.cdr
        if cur is not NIL:
            return list_to_pair(result, expand_quasiquote(cur, env))
        return list_to_pair(result)
    elif isinstance(form, Symbol):
        return form
    else:
        return form

# ---------------------------------------------------------------------------
# Standard environment
# ---------------------------------------------------------------------------

def make_global_env():
    env = Env()

    # Arithmetic
    def add(*args):
        return sum(args)
    def sub(*args):
        if len(args) == 1:
            return -args[0]
        return args[0] - sum(args[1:])
    def mul(*args):
        r = 1
        for a in args:
            r *= a
        return r
    def div(*args):
        if len(args) == 1:
            return 1 / args[0]
        r = args[0]
        for a in args[1:]:
            r = r / a
        return r

    env[Symbol('+')] = add
    env[Symbol('-')] = sub
    env[Symbol('*')] = mul
    env[Symbol('/')] = div
    env[Symbol('modulo')] = lambda a, b: a % b
    env[Symbol('remainder')] = lambda a, b: a % b
    env[Symbol('abs')] = abs
    env[Symbol('max')] = max
    env[Symbol('min')] = min
    env[Symbol('expt')] = pow
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
    env[Symbol('not')] = lambda a: not is_true(a)

    # Pair / List
    env[Symbol('cons')] = lambda a, b: Pair(a, b)
    env[Symbol('car')] = lambda p: p.car if isinstance(p, Pair) else (_ for _ in ()).throw(LispError("car: not a pair"))
    env[Symbol('cdr')] = lambda p: p.cdr if isinstance(p, Pair) else (_ for _ in ()).throw(LispError("cdr: not a pair"))

    def lisp_list(*args):
        return list_to_pair(list(args))
    env[Symbol('list')] = lisp_list

    def length(lst):
        n = 0
        cur = lst
        while isinstance(cur, Pair):
            n += 1
            cur = cur.cdr
        return n
    env[Symbol('length')] = length

    def append_fn(*lsts):
        if not lsts:
            return NIL
        result = []
        for lst in lsts[:-1]:
            cur = lst
            while isinstance(cur, Pair):
                result.append(cur.car)
                cur = cur.cdr
        last = lsts[-1]
        if not result:
            return last
        return list_to_pair(result, last)
    env[Symbol('append')] = append_fn

    def map_fn(func, lst):
        result = []
        cur = lst
        while isinstance(cur, Pair):
            if isinstance(func, Lambda):
                result.append(apply_func(func, [cur.car]))
            else:
                result.append(func(cur.car))
            cur = cur.cdr
        return list_to_pair(result)
    env[Symbol('map')] = map_fn

    def filter_fn(func, lst):
        result = []
        cur = lst
        while isinstance(cur, Pair):
            if isinstance(func, Lambda):
                val = apply_func(func, [cur.car])
            else:
                val = func(cur.car)
            if is_true(val):
                result.append(cur.car)
            cur = cur.cdr
        return list_to_pair(result)
    env[Symbol('filter')] = filter_fn

    def for_each_fn(func, lst):
        cur = lst
        while isinstance(cur, Pair):
            if isinstance(func, Lambda):
                apply_func(func, [cur.car])
            else:
                func(cur.car)
            cur = cur.cdr
        return None
    env[Symbol('for-each')] = for_each_fn

    def reverse_fn(lst):
        result = NIL
        cur = lst
        while isinstance(cur, Pair):
            result = Pair(cur.car, result)
            cur = cur.cdr
        return result
    env[Symbol('reverse')] = reverse_fn

    # Type predicates
    env[Symbol('null?')] = lambda a: a is NIL
    env[Symbol('pair?')] = lambda a: isinstance(a, Pair)
    env[Symbol('list?')] = lambda a: isinstance(a, Pair) or a is NIL
    env[Symbol('number?')] = lambda a: isinstance(a, (int, float)) and not isinstance(a, bool)
    env[Symbol('integer?')] = lambda a: isinstance(a, int) and not isinstance(a, bool)
    env[Symbol('string?')] = lambda a: isinstance(a, str) and not isinstance(a, Symbol)
    env[Symbol('symbol?')] = lambda a: isinstance(a, Symbol)
    env[Symbol('boolean?')] = lambda a: isinstance(a, bool)
    env[Symbol('procedure?')] = lambda a: callable(a) or isinstance(a, Lambda)
    env[Symbol('zero?')] = lambda a: a == 0
    env[Symbol('positive?')] = lambda a: a > 0
    env[Symbol('negative?')] = lambda a: a < 0
    env[Symbol('even?')] = lambda a: a % 2 == 0
    env[Symbol('odd?')] = lambda a: a % 2 != 0

    # String operations
    env[Symbol('string-length')] = lambda s: len(s)
    def string_append(*args):
        return ''.join(args)
    env[Symbol('string-append')] = string_append
    env[Symbol('substring')] = lambda s, start, end: s[start:end]
    env[Symbol('string-ref')] = lambda s, i: s[i]
    def string_to_number(s):
        try:
            return int(s)
        except ValueError:
            try:
                return float(s)
            except ValueError:
                return False
    env[Symbol('string->number')] = string_to_number
    env[Symbol('number->string')] = lambda n: str(n)
    env[Symbol('string->symbol')] = lambda s: Symbol(s)
    env[Symbol('symbol->string')] = lambda s: str(s)

    # I/O
    def display(val):
        if isinstance(val, str) and not isinstance(val, Symbol):
            print(val, end='')
        else:
            print(lisp_repr(val), end='')
        return None
    env[Symbol('display')] = display
    env[Symbol('newline')] = lambda: (print(), None)[-1]
    def lisp_print(val):
        print(lisp_repr(val))
        return None
    env[Symbol('print')] = lisp_print

    # apply
    def lisp_apply(func, *args):
        if not args:
            raise LispError("apply: requires at least two arguments")
        all_args = list(args[:-1])
        last = args[-1]
        if isinstance(last, Pair):
            all_args.extend(pair_to_list(last))
        elif last is NIL:
            pass
        else:
            all_args.append(last)
        if isinstance(func, Lambda):
            return apply_func(func, all_args)
        return func(*all_args)
    env[Symbol('apply')] = lisp_apply

    # error
    env[Symbol('error')] = lambda *args: (_ for _ in ()).throw(LispError(' '.join(str(a) for a in args)))

    # exit
    env[Symbol('exit')] = lambda *args: sys.exit(0)

    return env

# ---------------------------------------------------------------------------
# REPL & file execution
# ---------------------------------------------------------------------------

def run(source, env=None):
    """Parse and evaluate source string, return the last result."""
    if env is None:
        env = make_global_env()
    forms = parse(source)
    result = None
    for form in forms:
        result = eval_expr(form, env)
    return result

def run_file(filename):
    env = make_global_env()
    with open(filename) as f:
        source = f.read()
    forms = parse(source)
    for form in forms:
        eval_expr(form, env)

def repl():
    env = make_global_env()
    print("Lisp REPL (Ctrl+D or (exit) to quit)")
    while True:
        try:
            line = input("lisp> ")
        except (EOFError, KeyboardInterrupt):
            print()
            break

        buf = line
        while not is_complete(buf):
            try:
                buf += '\n' + input("  ... ")
            except (EOFError, KeyboardInterrupt):
                print()
                break

        if not buf.strip():
            continue

        try:
            forms = parse(buf)
            for form in forms:
                result = eval_expr(form, env)
                if result is not None:
                    print(lisp_repr(result))
        except LispError as e:
            print(f"Error: {e}")
        except ZeroDivisionError:
            print("Error: division by zero")
        except SystemExit:
            raise
        except Exception as e:
            print(f"Error: {e}")

def main():
    if len(sys.argv) > 1:
        run_file(sys.argv[1])
    else:
        repl()

if __name__ == '__main__':
    main()
