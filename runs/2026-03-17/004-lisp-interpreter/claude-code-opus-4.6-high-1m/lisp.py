#!/usr/bin/env python3
"""A Scheme-like Lisp interpreter with REPL."""

import sys
import math
import operator
from functools import reduce

# ============================================================
# Types
# ============================================================

class Symbol(str):
    pass

class Pair:
    __slots__ = ('car', 'cdr')
    def __init__(self, car, cdr):
        self.car = car
        self.cdr = cdr
    def __eq__(self, other):
        return isinstance(other, Pair) and self.car == other.car and self.cdr == other.cdr
    def __repr__(self):
        return f'Pair({self.car!r}, {self.cdr!r})'

_sym_table = {}

def sym(name):
    if name not in _sym_table:
        _sym_table[name] = Symbol(name)
    return _sym_table[name]

_quote = sym('quote')
_quasiquote = sym('quasiquote')
_unquote = sym('unquote')
_unquote_splicing = sym('unquote-splicing')
_if = sym('if')
_define = sym('define')
_set_bang = sym('set!')
_lambda = sym('lambda')
_begin = sym('begin')
_cond = sym('cond')
_else = sym('else')
_let = sym('let')
_let_star = sym('let*')
_and = sym('and')
_or = sym('or')
_define_macro = sym('define-macro')

# ============================================================
# Tokenizer
# ============================================================

def tokenize(source):
    tokens = []
    i = 0
    n = len(source)
    while i < n:
        c = source[i]
        if c in ' \t\n\r':
            i += 1
        elif c == ';':
            while i < n and source[i] != '\n':
                i += 1
        elif c == '"':
            j = i + 1
            chars = []
            while j < n and source[j] != '"':
                if source[j] == '\\' and j + 1 < n:
                    j += 1
                    chars.append({'n': '\n', 't': '\t', '\\': '\\', '"': '"'}.get(source[j], '\\' + source[j]))
                else:
                    chars.append(source[j])
                j += 1
            if j >= n:
                raise SyntaxError("Unterminated string")
            tokens.append(('STR', ''.join(chars)))
            i = j + 1
        elif c in '()':
            tokens.append(('PAREN', c))
            i += 1
        elif c == "'":
            tokens.append(('Q',))
            i += 1
        elif c == '`':
            tokens.append(('QQ',))
            i += 1
        elif c == ',':
            if i + 1 < n and source[i + 1] == '@':
                tokens.append(('UQS',))
                i += 2
            else:
                tokens.append(('UQ',))
                i += 1
        elif c == '#' and i + 1 < n and source[i + 1] in 'tf':
            tokens.append(('BOOL', source[i + 1] == 't'))
            i += 2
        else:
            j = i
            while j < n and source[j] not in ' \t\n\r()";':
                j += 1
            atom = source[i:j]
            if not atom:
                raise SyntaxError(f"Unexpected character: {c!r}")
            try:
                tokens.append(('NUM', int(atom)))
            except ValueError:
                try:
                    tokens.append(('NUM', float(atom)))
                except ValueError:
                    tokens.append(('SYM', atom))
            i = j
    return tokens

# ============================================================
# Parser
# ============================================================

def parse(source):
    tokens = tokenize(source)
    pos = [0]

    def at_end():
        return pos[0] >= len(tokens)

    def peek():
        return tokens[pos[0]] if not at_end() else None

    def advance():
        t = tokens[pos[0]]
        pos[0] += 1
        return t

    def read_expr():
        if at_end():
            raise SyntaxError("Unexpected end of input")
        t = advance()
        ty = t[0]
        if ty == 'NUM':   return t[1]
        if ty == 'STR':   return t[1]
        if ty == 'BOOL':  return t[1]
        if ty == 'SYM':   return sym(t[1])
        if ty == 'Q':     return [_quote, read_expr()]
        if ty == 'QQ':    return [_quasiquote, read_expr()]
        if ty == 'UQ':    return [_unquote, read_expr()]
        if ty == 'UQS':   return [_unquote_splicing, read_expr()]
        if ty == 'PAREN':
            if t[1] == '(':
                return read_list()
            raise SyntaxError("Unexpected ')'")
        raise SyntaxError(f"Unexpected token: {t}")

    def read_list():
        items = []
        while True:
            if at_end():
                raise SyntaxError("Expected ')'")
            p = peek()
            if p[0] == 'PAREN' and p[1] == ')':
                advance()
                return items
            if p[0] == 'SYM' and p[1] == '.':
                advance()
                cdr = read_expr()
                if at_end() or not (peek()[0] == 'PAREN' and peek()[1] == ')'):
                    raise SyntaxError("Expected ')' after dot")
                advance()
                result = cdr
                for item in reversed(items):
                    result = Pair(item, result)
                return result
            items.append(read_expr())

    exprs = []
    while not at_end():
        exprs.append(read_expr())
    return exprs

# ============================================================
# Environment
# ============================================================

class Env(dict):
    def __init__(self, params=(), args=(), outer=None):
        super().__init__()
        self.outer = outer
        if isinstance(params, Symbol):
            self[params] = list(args)
        elif isinstance(params, Pair):
            p, it = params, iter(args)
            while isinstance(p, Pair):
                self[p.car] = next(it)
                p = p.cdr
            if isinstance(p, Symbol):
                self[p] = list(it)
        elif isinstance(params, list) and params:
            if len(params) != len(args):
                raise TypeError(f"Expected {len(params)} args, got {len(args)}")
            for p, a in zip(params, args):
                self[p] = a

    def find(self, var):
        e = self
        while e is not None:
            if var in e:
                return e
            e = e.outer
        raise LookupError(f"Undefined: {var}")

# ============================================================
# Procedure / Macro
# ============================================================

class Procedure:
    __slots__ = ('params', 'body', 'env')
    def __init__(self, params, body, env):
        self.params = params
        self.body = body
        self.env = env
    def __call__(self, *args):
        env = Env(self.params, args, self.env)
        for e in self.body[:-1]:
            lisp_eval(e, env)
        return lisp_eval(self.body[-1], env)

class Macro:
    __slots__ = ('params', 'body', 'env')
    def __init__(self, params, body, env):
        self.params = params
        self.body = body
        self.env = env
    def expand(self, args):
        env = Env(self.params, args, self.env)
        r = None
        for e in self.body:
            r = lisp_eval(e, env)
        return r

# ============================================================
# Quasiquote
# ============================================================

def qq_expand(expr, env):
    if not isinstance(expr, list):
        return expr
    if not expr:
        return []
    if len(expr) >= 2 and expr[0] is _unquote:
        return lisp_eval(expr[1], env)
    result = []
    for item in expr:
        if isinstance(item, list) and len(item) >= 2 and item[0] is _unquote_splicing:
            val = lisp_eval(item[1], env)
            if not isinstance(val, list):
                raise TypeError(",@ requires a list")
            result.extend(val)
        else:
            result.append(qq_expand(item, env))
    return result

# ============================================================
# Evaluator (with TCO via while loop)
# ============================================================

def lisp_eval(expr, env):
    while True:
        if isinstance(expr, bool):
            return expr
        if isinstance(expr, (int, float)):
            return expr
        if isinstance(expr, str) and not isinstance(expr, Symbol):
            return expr
        if isinstance(expr, Symbol):
            return env.find(expr)[expr]
        if not isinstance(expr, list):
            raise SyntaxError(f"Cannot eval: {expr!r}")
        if not expr:
            return []

        op = expr[0]

        if op is _quote:
            return expr[1]

        if op is _quasiquote:
            return qq_expand(expr[1], env)

        if op is _if:
            if lisp_eval(expr[1], env) is not False:
                expr = expr[2]
            elif len(expr) > 3:
                expr = expr[3]
            else:
                return None
            continue

        if op is _define:
            t = expr[1]
            if isinstance(t, list):
                env[t[0]] = Procedure(t[1:], expr[2:], env)
            elif isinstance(t, Pair):
                env[t.car] = Procedure(t.cdr, expr[2:], env)
            else:
                env[t] = lisp_eval(expr[2], env)
            return None

        if op is _set_bang:
            env.find(expr[1])[expr[1]] = lisp_eval(expr[2], env)
            return None

        if op is _lambda:
            return Procedure(expr[1], expr[2:], env)

        if op is _begin:
            if len(expr) == 1:
                return None
            for e in expr[1:-1]:
                lisp_eval(e, env)
            expr = expr[-1]
            continue

        if op is _cond:
            matched = False
            for clause in expr[1:]:
                if clause[0] is _else:
                    for e in clause[1:-1]:
                        lisp_eval(e, env)
                    expr = clause[-1] if len(clause) > 1 else None
                    matched = True
                    break
                if lisp_eval(clause[0], env) is not False:
                    for e in clause[1:-1]:
                        lisp_eval(e, env)
                    expr = clause[-1] if len(clause) > 1 else True
                    matched = True
                    break
            if not matched:
                return None
            if expr is None:
                return None
            continue

        if op is _let:
            bindings, body = expr[1], expr[2:]
            new_env = Env(outer=env)
            for b in bindings:
                new_env[b[0]] = lisp_eval(b[1], env)
            env = new_env
            for e in body[:-1]:
                lisp_eval(e, env)
            expr = body[-1]
            continue

        if op is _let_star:
            bindings, body = expr[1], expr[2:]
            new_env = Env(outer=env)
            for b in bindings:
                new_env[b[0]] = lisp_eval(b[1], new_env)
            env = new_env
            for e in body[:-1]:
                lisp_eval(e, env)
            expr = body[-1]
            continue

        if op is _and:
            if len(expr) == 1:
                return True
            for e in expr[1:-1]:
                if lisp_eval(e, env) is False:
                    return False
            expr = expr[-1]
            continue

        if op is _or:
            if len(expr) == 1:
                return False
            for e in expr[1:-1]:
                v = lisp_eval(e, env)
                if v is not False:
                    return v
            expr = expr[-1]
            continue

        if op is _define_macro:
            t = expr[1]
            if isinstance(t, list):
                env[t[0]] = Macro(t[1:], expr[2:], env)
            elif isinstance(t, Pair):
                env[t.car] = Macro(t.cdr, expr[2:], env)
            else:
                raise SyntaxError("define-macro requires (name params...) form")
            return None

        # Macro expansion
        if isinstance(op, Symbol):
            try:
                v = env.find(op)[op]
                if isinstance(v, Macro):
                    expr = v.expand(expr[1:])
                    continue
            except LookupError:
                pass

        # Function application
        proc = lisp_eval(op, env)
        args = [lisp_eval(a, env) for a in expr[1:]]

        if isinstance(proc, Procedure):
            env = Env(proc.params, args, proc.env)
            for e in proc.body[:-1]:
                lisp_eval(e, env)
            expr = proc.body[-1]
            continue
        if callable(proc):
            return proc(*args)
        raise TypeError(f"Not a procedure: {lispstr(proc)}")

# ============================================================
# String representation
# ============================================================

def lispstr(val):
    if val is True:  return '#t'
    if val is False: return '#f'
    if val is None:  return ''
    if isinstance(val, Symbol): return str(val)
    if isinstance(val, str):
        return '"' + val.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\t', '\\t') + '"'
    if isinstance(val, list):
        return '(' + ' '.join(lispstr(v) for v in val) + ')' if val else '()'
    if isinstance(val, Pair):
        parts = []
        cur = val
        while isinstance(cur, Pair):
            parts.append(lispstr(cur.car))
            cur = cur.cdr
        if isinstance(cur, list) and not cur:
            return '(' + ' '.join(parts) + ')'
        return '(' + ' '.join(parts) + ' . ' + lispstr(cur) + ')'
    if isinstance(val, Procedure): return '#<procedure>'
    if isinstance(val, Macro):    return '#<macro>'
    return str(val)

# ============================================================
# Standard environment
# ============================================================

def make_global_env():
    env = Env()

    # Arithmetic
    env[sym('+')] = lambda *a: sum(a)
    env[sym('-')] = lambda *a: -a[0] if len(a) == 1 else a[0] - sum(a[1:])
    env[sym('*')] = lambda *a: reduce(operator.mul, a, 1)
    env[sym('/')] = lambda a, b: a / b
    env[sym('modulo')] = lambda a, b: a % b
    env[sym('abs')] = abs
    env[sym('min')] = min
    env[sym('max')] = max
    env[sym('sqrt')] = math.sqrt
    env[sym('expt')] = pow

    # Comparison
    env[sym('=')] = lambda a, b: a == b
    env[sym('<')] = lambda a, b: a < b
    env[sym('>')] = lambda a, b: a > b
    env[sym('<=')] = lambda a, b: a <= b
    env[sym('>=')] = lambda a, b: a >= b
    env[sym('equal?')] = lambda a, b: a == b
    env[sym('eq?')] = lambda a, b: a is b

    # Logic
    env[sym('not')] = lambda x: x is False

    # List ops
    def _cons(a, b):
        return [a] + b if isinstance(b, list) else Pair(a, b)
    def _car(x):
        if isinstance(x, Pair): return x.car
        if isinstance(x, list) and x: return x[0]
        raise TypeError(f"car: not a pair: {lispstr(x)}")
    def _cdr(x):
        if isinstance(x, Pair): return x.cdr
        if isinstance(x, list) and x: return x[1:]
        raise TypeError(f"cdr: not a pair: {lispstr(x)}")

    env[sym('cons')] = _cons
    env[sym('car')] = _car
    env[sym('cdr')] = _cdr
    env[sym('list')] = lambda *a: list(a)
    env[sym('length')] = len
    env[sym('append')] = lambda *a: sum((list(x) for x in a), [])
    env[sym('map')] = lambda f, lst: [f(x) for x in lst]
    env[sym('filter')] = lambda f, lst: [x for x in lst if f(x) is not False]
    env[sym('null?')] = lambda x: isinstance(x, list) and len(x) == 0
    env[sym('pair?')] = lambda x: (isinstance(x, list) and len(x) > 0) or isinstance(x, Pair)
    env[sym('list?')] = lambda x: isinstance(x, list)
    env[sym('symbol?')] = lambda x: isinstance(x, Symbol)
    env[sym('number?')] = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)
    env[sym('string?')] = lambda x: isinstance(x, str) and not isinstance(x, Symbol)
    env[sym('boolean?')] = lambda x: isinstance(x, bool)
    env[sym('procedure?')] = lambda x: callable(x)
    env[sym('integer?')] = lambda x: isinstance(x, int) and not isinstance(x, bool)
    env[sym('zero?')] = lambda x: x == 0
    env[sym('positive?')] = lambda x: x > 0
    env[sym('negative?')] = lambda x: x < 0

    # String ops
    env[sym('string-length')] = len
    env[sym('string-append')] = lambda *a: ''.join(a)
    env[sym('substring')] = lambda s, i, j: s[i:j]
    env[sym('string->number')] = lambda s: int(s) if '.' not in s else float(s)
    env[sym('number->string')] = str
    env[sym('string-ref')] = lambda s, i: s[i]

    # I/O
    def _display(val):
        if isinstance(val, str) and not isinstance(val, Symbol):
            sys.stdout.write(val)
        else:
            sys.stdout.write(lispstr(val))
        sys.stdout.flush()
    def _newline():
        sys.stdout.write('\n')
        sys.stdout.flush()
    def _print(val):
        sys.stdout.write(lispstr(val) + '\n')
        sys.stdout.flush()

    env[sym('display')] = _display
    env[sym('newline')] = _newline
    env[sym('print')] = _print

    # Misc
    env[sym('apply')] = lambda f, a: f(*a)
    def _error(*args):
        raise RuntimeError(' '.join(str(a) for a in args))
    env[sym('error')] = _error
    env[sym('exit')] = lambda *a: sys.exit(0)
    env[sym('nil')] = []

    return env

# ============================================================
# REPL
# ============================================================

def _balanced(source):
    depth = 0
    in_str = False
    i = 0
    n = len(source)
    while i < n:
        c = source[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == ';':
                while i < n and source[i] != '\n':
                    i += 1
                continue
            elif c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
        i += 1
    return depth <= 0 and not in_str

def repl():
    env = make_global_env()
    while True:
        try:
            source = input('lisp> ')
            while not _balanced(source):
                source += '\n' + input('  ... ')
            if not source.strip():
                continue
            for expr in parse(source):
                result = lisp_eval(expr, env)
                if result is not None:
                    print(lispstr(result))
        except EOFError:
            print()
            break
        except KeyboardInterrupt:
            print()
            continue
        except SystemExit:
            break
        except Exception as e:
            print(f"Error: {e}")

def run_file(path):
    env = make_global_env()
    with open(path) as f:
        source = f.read()
    for expr in parse(source):
        lisp_eval(expr, env)

if __name__ == '__main__':
    if len(sys.argv) > 1:
        run_file(sys.argv[1])
    else:
        repl()
