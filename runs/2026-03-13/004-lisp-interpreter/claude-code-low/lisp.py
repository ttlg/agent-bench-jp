#!/usr/bin/env python3
"""Scheme-like Lisp interpreter with REPL, TCO, closures, and macros."""

import sys
import re
import operator
import math

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class Symbol(str):
    """A Lisp symbol."""
    pass

class Nil:
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
        return isinstance(other, Nil) or (isinstance(other, list) and len(other) == 0)
    def __hash__(self):
        return hash(())

NIL = Nil()

class TailCall:
    """Marker for tail-call optimisation."""
    __slots__ = ('func', 'args')
    def __init__(self, func, args):
        self.func = func
        self.args = args

class Procedure:
    """User-defined procedure (lambda)."""
    def __init__(self, params, body, env, name=None):
        self.params = params
        self.body = body
        self.env = env
        self.name = name
    def __repr__(self):
        return f"<procedure {self.name or 'lambda'}>"

class Macro:
    """User-defined macro."""
    def __init__(self, params, body, env, rest_param=None):
        self.params = params
        self.body = body
        self.env = env
        self.rest_param = rest_param

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

class Env(dict):
    """An environment: a dict of {'var': val} pairs, with an outer Env."""
    def __init__(self, params=(), args=(), outer=None):
        super().__init__()
        self.outer = outer
        if isinstance(params, Symbol):
            # rest parameter: (lambda args body)
            self[params] = list(args)
        else:
            params = list(params)
            args = list(args)
            # Handle dotted pair / rest params
            for i, p in enumerate(params):
                if isinstance(p, Symbol) and p == '.':
                    self[params[i + 1]] = list(args[i:])
                    break
                elif i < len(args):
                    self[p] = args[i]
            else:
                pass

    def find(self, var):
        if var in self:
            return self
        if self.outer is not None:
            return self.outer.find(var)
        raise NameError(f"Undefined variable: {var}")

# ---------------------------------------------------------------------------
# Tokeniser / Parser
# ---------------------------------------------------------------------------

def tokenize(source):
    tokens = []
    i = 0
    while i < len(source):
        c = source[i]
        if c == ';':
            while i < len(source) and source[i] != '\n':
                i += 1
            continue
        if c in ' \t\n\r':
            i += 1
            continue
        if c == '(':
            tokens.append('(')
            i += 1
        elif c == ')':
            tokens.append(')')
            i += 1
        elif c == "'":
            tokens.append("'")
            i += 1
        elif c == '`':
            tokens.append('`')
            i += 1
        elif c == ',':
            if i + 1 < len(source) and source[i + 1] == '@':
                tokens.append(',@')
                i += 2
            else:
                tokens.append(',')
                i += 1
        elif c == '"':
            j = i + 1
            s = ''
            while j < len(source) and source[j] != '"':
                if source[j] == '\\' and j + 1 < len(source):
                    nc = source[j + 1]
                    if nc == 'n': s += '\n'
                    elif nc == 't': s += '\t'
                    elif nc == '\\': s += '\\'
                    elif nc == '"': s += '"'
                    else: s += '\\' + nc
                    j += 2
                else:
                    s += source[j]
                    j += 1
            if j >= len(source):
                raise SyntaxError("Unterminated string")
            tokens.append(('STRING', s))
            i = j + 1
        else:
            j = i
            while j < len(source) and source[j] not in ' \t\n\r()";':
                j += 1
            tokens.append(source[i:j])
            i = j
    return tokens

def atom(token):
    if isinstance(token, tuple) and token[0] == 'STRING':
        return token[1]
    if token == '#t':
        return True
    if token == '#f':
        return False
    if token == 'nil':
        return NIL
    try:
        return int(token)
    except (ValueError, TypeError):
        pass
    try:
        return float(token)
    except (ValueError, TypeError):
        pass
    return Symbol(token)

def parse_tokens(tokens, pos=0):
    if pos >= len(tokens):
        raise SyntaxError("Unexpected EOF")
    token = tokens[pos]
    if token == '(':
        lst = []
        pos += 1
        while pos < len(tokens) and tokens[pos] != ')':
            val, pos = parse_tokens(tokens, pos)
            lst.append(val)
        if pos >= len(tokens):
            raise SyntaxError("Missing closing parenthesis")
        return lst, pos + 1
    elif token == ')':
        raise SyntaxError("Unexpected )")
    elif token == "'":
        val, pos = parse_tokens(tokens, pos + 1)
        return [Symbol('quote'), val], pos
    elif token == '`':
        val, pos = parse_tokens(tokens, pos + 1)
        return [Symbol('quasiquote'), val], pos
    elif token == ',':
        val, pos = parse_tokens(tokens, pos + 1)
        return [Symbol('unquote'), val], pos
    elif token == ',@':
        val, pos = parse_tokens(tokens, pos + 1)
        return [Symbol('unquote-splicing'), val], pos
    else:
        return atom(token), pos + 1

def parse(source):
    tokens = tokenize(source)
    results = []
    pos = 0
    while pos < len(tokens):
        val, pos = parse_tokens(tokens, pos)
        results.append(val)
    return results

def brackets_balanced(source):
    depth = 0
    i = 0
    in_string = False
    while i < len(source):
        c = source[i]
        if in_string:
            if c == '\\':
                i += 2
                continue
            if c == '"':
                in_string = False
        else:
            if c == '"':
                in_string = True
            elif c == ';':
                while i < len(source) and source[i] != '\n':
                    i += 1
                continue
            elif c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
        i += 1
    return depth <= 0 and not in_string

# ---------------------------------------------------------------------------
# Quasiquote expansion
# ---------------------------------------------------------------------------

def qq_expand(x):
    if not isinstance(x, list):
        return [Symbol('quote'), x]
    if len(x) == 0:
        return [Symbol('quote'), []]
    if len(x) == 2 and isinstance(x[0], Symbol) and x[0] == 'unquote':
        return x[1]
    # Check for splicing
    result = [Symbol('append')]
    for item in x:
        if isinstance(item, list) and len(item) == 2 and isinstance(item[0], Symbol) and item[0] == 'unquote-splicing':
            result.append(item[1])
        else:
            result.append([Symbol('list'), qq_expand(item)])
    return result

# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

def lisp_str(val):
    if val is True:
        return '#t'
    if val is False:
        return '#f'
    if isinstance(val, Nil):
        return '()'
    if isinstance(val, str) and not isinstance(val, Symbol):
        escaped = val.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\t', '\\t')
        return f'"{escaped}"'
    if isinstance(val, list):
        return '(' + ' '.join(lisp_str(v) for v in val) + ')'
    if isinstance(val, float):
        if val == int(val) and not math.isinf(val):
            return str(val)
        return str(val)
    if isinstance(val, Procedure):
        return repr(val)
    if val is None:
        return '()'
    return str(val)

def display_str(val):
    if isinstance(val, str) and not isinstance(val, Symbol):
        return val
    return lisp_str(val)

# ---------------------------------------------------------------------------
# Eval with TCO
# ---------------------------------------------------------------------------

def eval_expr(x, env):
    while True:
        # Literal
        if isinstance(x, Symbol):
            return env.find(x)[x]
        if not isinstance(x, list):
            if isinstance(x, Nil):
                return NIL
            return x
        if len(x) == 0:
            return NIL

        head = x[0]

        # Special forms
        if isinstance(head, Symbol):
            if head == 'quote':
                return x[1]

            elif head == 'quasiquote':
                x = qq_expand(x[1])
                continue

            elif head == 'if':
                test = eval_expr(x[1], env)
                if test is not False and test is not NIL:
                    x = x[2]
                else:
                    x = x[3] if len(x) > 3 else NIL
                continue

            elif head == 'cond':
                for clause in x[1:]:
                    if isinstance(clause[0], Symbol) and clause[0] == 'else':
                        for expr in clause[1:-1]:
                            eval_expr(expr, env)
                        x = clause[-1]
                        break
                    elif eval_expr(clause[0], env) is not False and eval_expr(clause[0], env) is not NIL:
                        for expr in clause[1:-1]:
                            eval_expr(expr, env)
                        x = clause[-1]
                        break
                else:
                    return NIL
                continue

            elif head == 'define':
                if isinstance(x[1], list):
                    name = x[1][0]
                    params = x[1][1:]
                    # Check for rest param
                    body = x[2:]
                    proc = Procedure(params, body, env, name=str(name))
                    env[name] = proc
                    return None
                else:
                    env[x[1]] = eval_expr(x[2], env)
                    return None

            elif head == 'define-macro':
                if isinstance(x[1], list):
                    name = x[1][0]
                    params_raw = x[1][1:]
                    # Handle rest parameter with dot notation
                    rest_param = None
                    params = []
                    i = 0
                    while i < len(params_raw):
                        p = params_raw[i]
                        if isinstance(p, Symbol) and p == '.':
                            rest_param = params_raw[i + 1]
                            break
                        else:
                            params.append(p)
                        i += 1
                    body = x[2:]
                    env[name] = Macro(params, body, env, rest_param=rest_param)
                    return None

            elif head == 'set!':
                target_env = env.find(x[1])
                target_env[x[1]] = eval_expr(x[2], env)
                return None

            elif head == 'lambda':
                params = x[1]
                body = x[2:]
                return Procedure(params, body, env)

            elif head == 'begin':
                for expr in x[1:-1]:
                    eval_expr(expr, env)
                x = x[-1] if len(x) > 1 else NIL
                continue

            elif head == 'let':
                bindings = x[1]
                body = x[2:]
                new_env = Env(outer=env)
                for b in bindings:
                    new_env[b[0]] = eval_expr(b[1], env)
                for expr in body[:-1]:
                    eval_expr(expr, new_env)
                x = body[-1]
                env = new_env
                continue

            elif head == 'let*':
                bindings = x[1]
                body = x[2:]
                new_env = Env(outer=env)
                for b in bindings:
                    new_env[b[0]] = eval_expr(b[1], new_env)
                for expr in body[:-1]:
                    eval_expr(expr, new_env)
                x = body[-1]
                env = new_env
                continue

            elif head == 'and':
                if len(x) == 1:
                    return True
                for expr in x[1:-1]:
                    val = eval_expr(expr, env)
                    if val is False:
                        return False
                x = x[-1]
                continue

            elif head == 'or':
                if len(x) == 1:
                    return False
                for expr in x[1:-1]:
                    val = eval_expr(expr, env)
                    if val is not False and val is not NIL:
                        return val
                x = x[-1]
                continue

        # Function call / macro expansion
        func = eval_expr(head, env)

        # Macro expansion
        if isinstance(func, Macro):
            args = x[1:]
            macro_env = Env(outer=func.env)
            for i, p in enumerate(func.params):
                if i < len(args):
                    macro_env[p] = args[i]
            if func.rest_param:
                macro_env[func.rest_param] = args[len(func.params):]
            # Evaluate macro body to get expansion
            for expr in func.body[:-1]:
                eval_expr(expr, macro_env)
            expanded = eval_expr(func.body[-1], macro_env)
            x = expanded
            continue

        args = [eval_expr(a, env) for a in x[1:]]

        if isinstance(func, Procedure):
            new_env = Env(outer=func.env)
            params = func.params
            if isinstance(params, Symbol):
                new_env[params] = args
            else:
                for i, p in enumerate(params):
                    if isinstance(p, Symbol) and p == '.':
                        new_env[params[i + 1]] = args[i:]
                        break
                    elif i < len(args):
                        new_env[p] = args[i]
            for expr in func.body[:-1]:
                eval_expr(expr, new_env)
            x = func.body[-1]
            env = new_env
            continue
        elif callable(func):
            return func(*args)
        else:
            raise TypeError(f"Not callable: {lisp_str(func)}")

# ---------------------------------------------------------------------------
# Standard environment
# ---------------------------------------------------------------------------

def standard_env():
    env = Env()

    # Arithmetic
    env[Symbol('+')] = lambda *a: sum(a)
    env[Symbol('-')] = lambda *a: -a[0] if len(a) == 1 else a[0] - sum(a[1:])
    env[Symbol('*')] = lambda *a: eval("1" if not a else "*".join(str(x) for x in a)) if False else _mul(*a)
    env[Symbol('/')] = lambda a, b: a / b
    env[Symbol('modulo')] = lambda a, b: a % b
    env[Symbol('abs')] = abs
    env[Symbol('min')] = min
    env[Symbol('max')] = max

    # Comparison
    env[Symbol('=')] = lambda a, b: a == b
    env[Symbol('<')] = lambda a, b: a < b
    env[Symbol('>')] = lambda a, b: a > b
    env[Symbol('<=')] = lambda a, b: a <= b
    env[Symbol('>=')] = lambda a, b: a >= b
    env[Symbol('equal?')] = lambda a, b: a == b

    # Logic
    env[Symbol('not')] = lambda a: a is False or a is NIL

    # List ops
    env[Symbol('cons')] = lambda a, b: [a] + (b if isinstance(b, list) else [b]) if not isinstance(b, Nil) else [a]
    env[Symbol('car')] = lambda a: a[0]
    env[Symbol('cdr')] = lambda a: a[1:] if len(a) > 1 else NIL if isinstance(a, list) and len(a) == 1 else a[1:]
    env[Symbol('list')] = lambda *a: list(a)
    env[Symbol('length')] = lambda a: len(a) if isinstance(a, list) else 0
    env[Symbol('append')] = _append
    env[Symbol('map')] = lambda f, lst: [_apply(f, [x]) for x in lst]
    env[Symbol('filter')] = lambda f, lst: [x for x in lst if _apply(f, [x]) is not False and _apply(f, [x]) is not NIL]
    env[Symbol('null?')] = lambda a: isinstance(a, Nil) or (isinstance(a, list) and len(a) == 0)
    env[Symbol('pair?')] = lambda a: isinstance(a, list) and len(a) > 0
    env[Symbol('list?')] = lambda a: isinstance(a, list) or isinstance(a, Nil)
    env[Symbol('symbol?')] = lambda a: isinstance(a, Symbol)
    env[Symbol('number?')] = lambda a: isinstance(a, (int, float)) and not isinstance(a, bool)
    env[Symbol('string?')] = lambda a: isinstance(a, str) and not isinstance(a, Symbol)
    env[Symbol('boolean?')] = lambda a: isinstance(a, bool)
    env[Symbol('procedure?')] = lambda a: isinstance(a, Procedure) or callable(a)

    # String ops
    env[Symbol('string-length')] = lambda s: len(s)
    env[Symbol('string-append')] = lambda *a: ''.join(a)
    env[Symbol('substring')] = lambda s, start, end: s[start:end]
    env[Symbol('string->number')] = lambda s: int(s) if '.' not in s else float(s)
    env[Symbol('number->string')] = lambda n: str(n)
    env[Symbol('string->symbol')] = lambda s: Symbol(s)
    env[Symbol('symbol->string')] = lambda s: str(s)

    # I/O
    env[Symbol('display')] = lambda *a: print(display_str(a[0]), end='')
    env[Symbol('newline')] = lambda: print()
    env[Symbol('print')] = lambda *a: print(lisp_str(a[0]))

    # apply
    env[Symbol('apply')] = lambda f, args: _apply(f, args)

    # exit
    env[Symbol('exit')] = lambda *a: sys.exit(0)

    # error
    env[Symbol('error')] = lambda *a: (_ for _ in ()).throw(RuntimeError(' '.join(str(x) for x in a)))

    # Boolean constants
    env[Symbol('#t')] = True
    env[Symbol('#f')] = False
    env[Symbol('nil')] = NIL
    env[Symbol('else')] = True

    return env

def _mul(*a):
    r = 1
    for x in a:
        r *= x
    return r

def _apply(f, args):
    if isinstance(f, Procedure):
        env = Env(outer=f.env)
        params = f.params
        if isinstance(params, Symbol):
            env[params] = list(args)
        else:
            for i, p in enumerate(params):
                if isinstance(p, Symbol) and p == '.':
                    env[params[i + 1]] = list(args[i:])
                    break
                elif i < len(args):
                    env[p] = args[i]
        result = None
        for expr in f.body:
            result = eval_expr(expr, env)
        return result
    elif callable(f):
        return f(*args)

def _append(*lsts):
    result = []
    for l in lsts:
        if isinstance(l, list):
            result.extend(l)
        elif isinstance(l, Nil):
            pass
        else:
            result.append(l)
    return result

# Fix the filter to not double-evaluate
def _make_filter():
    def _filter(f, lst):
        result = []
        for x in lst:
            val = _apply(f, [x])
            if val is not False and not isinstance(val, Nil):
                result.append(x)
        return result
    return _filter

# ---------------------------------------------------------------------------
# REPL and file execution
# ---------------------------------------------------------------------------

def run(source, env=None):
    if env is None:
        env = standard_env()
    exprs = parse(source)
    result = None
    for expr in exprs:
        result = eval_expr(expr, env)
    return result

def repl():
    env = standard_env()
    # Fix filter
    env[Symbol('filter')] = _make_filter()
    print("Lisp REPL (Ctrl+D or (exit) to quit)")
    while True:
        try:
            line = input("lisp> ")
            while not brackets_balanced(line):
                line += '\n' + input("  ... ")
        except EOFError:
            print()
            break
        except KeyboardInterrupt:
            print()
            continue
        if not line.strip():
            continue
        try:
            exprs = parse(line)
            for expr in exprs:
                result = eval_expr(expr, env)
                if result is not None:
                    print(lisp_str(result))
        except SystemExit:
            raise
        except Exception as e:
            print(f"Error: {e}")

def main():
    if len(sys.argv) > 1:
        filename = sys.argv[1]
        with open(filename) as f:
            source = f.read()
        env = standard_env()
        env[Symbol('filter')] = _make_filter()
        try:
            run(source, env)
        except SystemExit:
            pass
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        repl()

if __name__ == '__main__':
    main()
