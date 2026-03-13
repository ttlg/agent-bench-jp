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
    """The nil / empty list singleton."""
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
    """Marker for tail-call optimization."""
    __slots__ = ('func', 'args')
    def __init__(self, func, args):
        self.func = func
        self.args = args

class Procedure:
    """A user-defined lambda / function."""
    def __init__(self, params, body, env, name=None):
        self.params = params
        self.body = body
        self.env = env
        self.name = name

    def __repr__(self):
        if self.name:
            return f"<procedure {self.name}>"
        return "<lambda>"

class Macro:
    """A user-defined macro (define-macro)."""
    def __init__(self, params, body, env, name=None):
        self.params = params
        self.body = body
        self.env = env
        self.name = name

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

class Env(dict):
    """An environment: a dict with an outer (parent) environment."""
    def __init__(self, params=(), args=(), outer=None):
        super().__init__()
        if isinstance(params, Symbol) or (isinstance(params, str) and not isinstance(params, list)):
            # variadic: (lambda args body)
            self[params] = list(args)
        else:
            params = list(params)
            args = list(args)
            # Handle dotted / rest parameters
            rest_idx = None
            for i, p in enumerate(params):
                if p == '.':
                    rest_idx = i
                    break
            if rest_idx is not None:
                for i in range(rest_idx):
                    self[params[i]] = args[i]
                rest_name = params[rest_idx + 1]
                self[rest_name] = list(args[rest_idx:])
            else:
                for p, a in zip(params, args):
                    self[p] = a
        self.outer = outer

    def find(self, var):
        """Find the innermost Env where var appears."""
        if var in self:
            return self
        if self.outer is not None:
            return self.outer.find(var)
        raise LookupError(f"Undefined variable: {var}")

# ---------------------------------------------------------------------------
# Tokenizer / Parser
# ---------------------------------------------------------------------------

def tokenize(source):
    """Tokenize a Lisp source string."""
    tokens = []
    i = 0
    n = len(source)
    while i < n:
        c = source[i]
        # Skip whitespace
        if c in ' \t\n\r':
            i += 1
            continue
        # Skip comments
        if c == ';':
            while i < n and source[i] != '\n':
                i += 1
            continue
        # String literal
        if c == '"':
            j = i + 1
            s = ''
            while j < n and source[j] != '"':
                if source[j] == '\\' and j + 1 < n:
                    nc = source[j + 1]
                    if nc == 'n':
                        s += '\n'
                    elif nc == 't':
                        s += '\t'
                    elif nc == '\\':
                        s += '\\'
                    elif nc == '"':
                        s += '"'
                    else:
                        s += nc
                    j += 2
                else:
                    s += source[j]
                    j += 1
            if j >= n:
                raise SyntaxError("Unterminated string literal")
            tokens.append(('STRING', s))
            i = j + 1
            continue
        # Parentheses
        if c in '()':
            tokens.append(('PAREN', c))
            i += 1
            continue
        # Quote shorthands
        if c == "'":
            tokens.append(('QUOTE', 'quote'))
            i += 1
            continue
        if c == '`':
            tokens.append(('QUOTE', 'quasiquote'))
            i += 1
            continue
        if c == ',':
            if i + 1 < n and source[i + 1] == '@':
                tokens.append(('QUOTE', 'unquote-splicing'))
                i += 2
            else:
                tokens.append(('QUOTE', 'unquote'))
                i += 1
            continue
        # #t, #f
        if c == '#':
            if i + 1 < n and source[i + 1] in ('t', 'f'):
                tokens.append(('BOOL', source[i + 1] == 't'))
                i += 2
                continue
            # fallthrough
        # Atom (symbol or number)
        j = i
        while j < n and source[j] not in ' \t\n\r()";':
            j += 1
        atom = source[i:j]
        tokens.append(('ATOM', atom))
        i = j
    return tokens


def parse(tokens):
    """Parse tokens into an AST (nested Python lists/atoms)."""
    if not tokens:
        raise SyntaxError("Unexpected EOF")
    results = []
    while tokens:
        results.append(_parse_expr(tokens))
    return results


def _parse_expr(tokens):
    if not tokens:
        raise SyntaxError("Unexpected EOF")
    tok_type, tok_val = tokens.pop(0)

    if tok_type == 'PAREN':
        if tok_val == '(':
            lst = []
            while tokens and not (tokens[0][0] == 'PAREN' and tokens[0][1] == ')'):
                lst.append(_parse_expr(tokens))
            if not tokens:
                raise SyntaxError("Missing closing parenthesis")
            tokens.pop(0)  # consume ')'
            return lst
        else:
            raise SyntaxError("Unexpected )")

    if tok_type == 'QUOTE':
        expr = _parse_expr(tokens)
        return [Symbol(tok_val), expr]

    if tok_type == 'STRING':
        return tok_val

    if tok_type == 'BOOL':
        return tok_val

    if tok_type == 'ATOM':
        return _parse_atom(tok_val)

    raise SyntaxError(f"Unknown token: {tok_type} {tok_val}")


def _parse_atom(atom):
    """Try to parse as int, float, or symbol."""
    if atom == 'nil':
        return NIL
    if atom == '#t':
        return True
    if atom == '#f':
        return False
    try:
        return int(atom)
    except ValueError:
        pass
    try:
        return float(atom)
    except ValueError:
        pass
    return Symbol(atom)


def read(source):
    """Read a single expression from source string."""
    tokens = tokenize(source)
    if not tokens:
        return None
    return _parse_expr(tokens)


def read_all(source):
    """Read all expressions from source string."""
    tokens = tokenize(source)
    exprs = []
    while tokens:
        exprs.append(_parse_expr(tokens))
    return exprs

# ---------------------------------------------------------------------------
# Evaluator (with TCO)
# ---------------------------------------------------------------------------

def eval_expr(expr, env):
    """Evaluate an expression in an environment, with tail-call optimization."""
    while True:
        # Atoms
        if isinstance(expr, Symbol):
            return env.find(expr)[expr]
        if isinstance(expr, str) and not isinstance(expr, Symbol):
            return expr  # string literal
        if not isinstance(expr, list):
            # number, bool, Nil
            return expr
        if len(expr) == 0:
            return NIL

        head = expr[0]

        # Special forms
        if isinstance(head, Symbol):
            # quote
            if head == 'quote':
                return expr[1]

            # quasiquote
            if head == 'quasiquote':
                return _expand_quasiquote(expr[1], env)

            # if
            if head == 'if':
                test = eval_expr(expr[1], env)
                if _is_true(test):
                    expr = expr[2]
                    continue  # TCO
                elif len(expr) > 3:
                    expr = expr[3]
                    continue  # TCO
                else:
                    return NIL

            # cond
            if head == 'cond':
                for clause in expr[1:]:
                    if isinstance(clause[0], Symbol) and clause[0] == 'else':
                        # else clause: evaluate body in tail position
                        if len(clause) == 2:
                            expr = clause[1]
                            break
                        else:
                            for e in clause[1:-1]:
                                eval_expr(e, env)
                            expr = clause[-1]
                            break
                    test = eval_expr(clause[0], env)
                    if _is_true(test):
                        if len(clause) == 1:
                            return test
                        if len(clause) == 2:
                            expr = clause[1]
                        else:
                            for e in clause[1:-1]:
                                eval_expr(e, env)
                            expr = clause[-1]
                        break
                else:
                    return NIL
                continue  # TCO

            # define
            if head == 'define':
                if isinstance(expr[1], list):
                    # (define (name params...) body...)
                    name = expr[1][0]
                    params = expr[1][1:]
                    body = expr[2:] if len(expr) > 3 else [expr[2]]
                    if len(body) > 1:
                        body_expr = [Symbol('begin')] + body
                    else:
                        body_expr = body[0]
                    proc = Procedure(params, body_expr, env, name=str(name))
                    env[name] = proc
                    return None
                else:
                    name = expr[1]
                    val = eval_expr(expr[2], env)
                    env[name] = val
                    return None

            # define-macro
            if head == 'define-macro':
                if isinstance(expr[1], list):
                    name = expr[1][0]
                    params = expr[1][1:]
                    body = expr[2:] if len(expr) > 3 else [expr[2]]
                    if len(body) > 1:
                        body_expr = [Symbol('begin')] + body
                    else:
                        body_expr = body[0]
                    macro = Macro(params, body_expr, env, name=str(name))
                    env[name] = macro
                    return None

            # set!
            if head == 'set!':
                name = expr[1]
                val = eval_expr(expr[2], env)
                target_env = env.find(name)
                target_env[name] = val
                return None

            # lambda
            if head == 'lambda':
                params = expr[1]
                body = expr[2:] if len(expr) > 3 else [expr[2]]
                if len(body) > 1:
                    body_expr = [Symbol('begin')] + body
                else:
                    body_expr = body[0]
                return Procedure(params, body_expr, env)

            # begin
            if head == 'begin':
                for e in expr[1:-1]:
                    eval_expr(e, env)
                if len(expr) > 1:
                    expr = expr[-1]
                    continue  # TCO
                return NIL

            # let
            if head == 'let':
                bindings = expr[1]
                body = expr[2:]
                new_env = Env(outer=env)
                for binding in bindings:
                    var = binding[0]
                    val = eval_expr(binding[1], env)
                    new_env[var] = val
                env = new_env
                if len(body) > 1:
                    for e in body[:-1]:
                        eval_expr(e, env)
                expr = body[-1]
                continue  # TCO

            # let*
            if head == 'let*':
                bindings = expr[1]
                body = expr[2:]
                new_env = Env(outer=env)
                for binding in bindings:
                    var = binding[0]
                    val = eval_expr(binding[1], new_env)
                    new_env[var] = val
                env = new_env
                if len(body) > 1:
                    for e in body[:-1]:
                        eval_expr(e, env)
                expr = body[-1]
                continue  # TCO

            # and (short-circuit)
            if head == 'and':
                if len(expr) == 1:
                    return True
                for e in expr[1:-1]:
                    val = eval_expr(e, env)
                    if not _is_true(val):
                        return val
                expr = expr[-1]
                continue  # TCO

            # or (short-circuit)
            if head == 'or':
                if len(expr) == 1:
                    return False
                for e in expr[1:-1]:
                    val = eval_expr(e, env)
                    if _is_true(val):
                        return val
                expr = expr[-1]
                continue  # TCO

        # Function / macro application
        proc = eval_expr(head, env)

        # Macro expansion: evaluate macro, then eval the result
        if isinstance(proc, Macro):
            expanded = _apply_macro(proc, expr[1:])
            expr = expanded
            continue  # TCO – evaluate the expansion

        # Evaluate arguments
        args = [eval_expr(a, env) for a in expr[1:]]

        # Built-in callable
        if callable(proc) and not isinstance(proc, Procedure):
            return proc(*args)

        # User-defined procedure
        if isinstance(proc, Procedure):
            new_env = Env(proc.params, args, outer=proc.env)
            env = new_env
            expr = proc.body
            continue  # TCO

        raise TypeError(f"Not callable: {proc}")


def _is_true(val):
    """Scheme truth: everything except #f is true."""
    return val is not False


def _apply_macro(macro, raw_args):
    """Apply a macro: bind raw (unevaluated) args, evaluate body to get expansion."""
    params = list(macro.params)
    # Handle dotted/rest params
    rest_idx = None
    for i, p in enumerate(params):
        if isinstance(p, Symbol) and p == '.':
            rest_idx = i
            break
    if rest_idx is not None:
        normal_params = params[:rest_idx]
        rest_param = params[rest_idx + 1]
        bindings = {}
        for p, a in zip(normal_params, raw_args):
            bindings[p] = a
        bindings[rest_param] = list(raw_args[len(normal_params):])
        new_env = Env(outer=macro.env)
        new_env.update(bindings)
    else:
        new_env = Env(params, raw_args, outer=macro.env)
    return eval_expr(macro.body, new_env)


def _expand_quasiquote(expr, env):
    """Expand a quasiquote expression."""
    if isinstance(expr, list):
        if len(expr) == 2 and isinstance(expr[0], Symbol) and expr[0] == 'unquote':
            return eval_expr(expr[1], env)
        result = []
        for item in expr:
            if isinstance(item, list) and len(item) == 2 and isinstance(item[0], Symbol) and item[0] == 'unquote-splicing':
                spliced = eval_expr(item[1], env)
                if isinstance(spliced, list):
                    result.extend(spliced)
                else:
                    result.append(spliced)
            else:
                result.append(_expand_quasiquote(item, env))
        return result
    return expr

# ---------------------------------------------------------------------------
# Standard environment / built-in functions
# ---------------------------------------------------------------------------

def _make_global_env():
    env = Env()

    # Arithmetic
    def add(*args):
        return sum(args)
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
    env[Symbol('ceiling')] = lambda x: int(math.ceil(x))
    env[Symbol('round')] = round
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
    env[Symbol('not')] = lambda x: not _is_true(x)

    # List operations
    env[Symbol('cons')] = lambda a, b: [a] + (b if isinstance(b, list) else [b])
    env[Symbol('car')] = lambda x: x[0]
    env[Symbol('cdr')] = lambda x: x[1:] if len(x) > 1 else NIL if isinstance(x, list) and len(x) == 1 else x[1:]
    env[Symbol('list')] = lambda *args: list(args)
    env[Symbol('length')] = lambda x: len(x)
    env[Symbol('append')] = lambda *args: sum((a if isinstance(a, list) else [a] for a in args), [])
    env[Symbol('reverse')] = lambda x: list(reversed(x))

    def _map(func, lst):
        return [_apply_func(func, [x]) for x in lst]
    def _filter(func, lst):
        return [x for x in lst if _is_true(_apply_func(func, [x]))]
    env[Symbol('map')] = _map
    env[Symbol('filter')] = _filter
    env[Symbol('apply')] = lambda func, args: _apply_func(func, args)
    env[Symbol('for-each')] = lambda func, lst: [_apply_func(func, [x]) for x in lst] and None

    # Type predicates
    env[Symbol('null?')] = lambda x: isinstance(x, Nil) or (isinstance(x, list) and len(x) == 0)
    env[Symbol('pair?')] = lambda x: isinstance(x, list) and len(x) > 0
    env[Symbol('list?')] = lambda x: isinstance(x, list) or isinstance(x, Nil)
    env[Symbol('number?')] = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)
    env[Symbol('integer?')] = lambda x: isinstance(x, int) and not isinstance(x, bool)
    env[Symbol('string?')] = lambda x: isinstance(x, str) and not isinstance(x, Symbol)
    env[Symbol('symbol?')] = lambda x: isinstance(x, Symbol)
    env[Symbol('boolean?')] = lambda x: isinstance(x, bool)
    env[Symbol('procedure?')] = lambda x: callable(x) or isinstance(x, Procedure)
    env[Symbol('zero?')] = lambda x: x == 0

    # String operations
    env[Symbol('string-length')] = lambda s: len(s)
    env[Symbol('string-append')] = lambda *args: ''.join(args)
    env[Symbol('substring')] = lambda s, start, end: s[start:end]
    env[Symbol('string->number')] = lambda s: int(s) if '.' not in s else float(s)
    env[Symbol('number->string')] = lambda n: str(n)
    env[Symbol('string-ref')] = lambda s, i: s[i]
    env[Symbol('string->list')] = lambda s: list(s)
    env[Symbol('list->string')] = lambda lst: ''.join(lst)

    # I/O
    env[Symbol('display')] = lambda x: print(to_string(x, display_mode=True), end='')
    env[Symbol('newline')] = lambda: print()
    env[Symbol('print')] = lambda x: print(to_string(x))

    # Misc
    env[Symbol('exit')] = lambda *args: sys.exit(0)
    env[Symbol('error')] = lambda *args: (_ for _ in ()).throw(RuntimeError(' '.join(str(a) for a in args)))
    env[Symbol('void')] = lambda: None

    # nil
    env[Symbol('nil')] = NIL

    return env


def _apply_func(func, args):
    """Apply a function (builtin or Procedure) to args."""
    if isinstance(func, Procedure):
        new_env = Env(func.params, args, outer=func.env)
        return eval_expr(func.body, new_env)
    return func(*args)

# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

def to_string(val, display_mode=False):
    """Convert a value to its Lisp string representation."""
    if val is None:
        return ""
    if val is True:
        return "#t"
    if val is False:
        return "#f"
    if isinstance(val, Nil):
        return "()"
    if isinstance(val, list):
        if len(val) == 0:
            return "()"
        inner = ' '.join(to_string(x) for x in val)
        return f"({inner})"
    if isinstance(val, str) and not isinstance(val, Symbol):
        if display_mode:
            return val
        return f'"{val}"'
    if isinstance(val, Symbol):
        return str(val)
    if isinstance(val, float):
        if val == int(val) and not (val == float('inf') or val == float('-inf')):
            # Show as e.g. 3.0 not 3
            return str(val)
        return str(val)
    if isinstance(val, Procedure):
        return repr(val)
    return str(val)

# ---------------------------------------------------------------------------
# REPL and file execution
# ---------------------------------------------------------------------------

def run_source(source, env=None):
    """Parse and evaluate all expressions in source. Returns the last result."""
    if env is None:
        env = _make_global_env()
    exprs = read_all(source)
    result = None
    for expr in exprs:
        result = eval_expr(expr, env)
    return result


def run_file(filename):
    """Execute a .lisp file."""
    with open(filename) as f:
        source = f.read()
    env = _make_global_env()
    run_source(source, env)


def repl():
    """Run the REPL."""
    env = _make_global_env()
    print("Lisp Interpreter - Type (exit) or Ctrl+D to quit")
    while True:
        try:
            line = input("lisp> ")
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not line.strip():
            continue

        # Multi-line: wait until parentheses are balanced
        source = line
        while _parens_unbalanced(source):
            try:
                more = input("  ... ")
            except (EOFError, KeyboardInterrupt):
                print()
                break
            source += '\n' + more

        try:
            tokens = tokenize(source)
            while tokens:
                expr = _parse_expr(tokens)
                result = eval_expr(expr, env)
                if result is not None:
                    print(to_string(result))
        except SystemExit:
            break
        except Exception as e:
            print(f"Error: {e}")


def _parens_unbalanced(source):
    """Check if parentheses are unbalanced (more opens than closes)."""
    depth = 0
    in_string = False
    i = 0
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
    return depth > 0 or in_string


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) > 1:
        run_file(sys.argv[1])
    else:
        repl()
