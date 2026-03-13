"""Scheme-style Lisp interpreter with REPL, TCO, and macros."""
import sys
import re
import os

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

class Symbol(str):
    """Lisp symbol — a string subclass so it can be used as dict key."""
    pass

class LispError(Exception):
    pass

class Nil:
    """Singleton nil / empty list."""
    _instance = None
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    def __repr__(self): return "()"
    def __bool__(self): return False
    def __iter__(self): return iter([])
    def __len__(self): return 0
    def __eq__(self, other): return isinstance(other, Nil)
    def __hash__(self): return hash(None)

NIL = Nil()

class Pair:
    """Cons cell for proper and improper lists."""
    __slots__ = ("car", "cdr")
    def __init__(self, car, cdr):
        self.car = car
        self.cdr = cdr

    def __iter__(self):
        cur = self
        while isinstance(cur, Pair):
            yield cur.car
            cur = cur.cdr
        if cur is not NIL:
            raise LispError("Cannot iterate improper list")

    def __len__(self):
        n = 0
        cur = self
        while isinstance(cur, Pair):
            n += 1
            cur = cur.cdr
        return n

    def __repr__(self):
        items = []
        cur = self
        while isinstance(cur, Pair):
            items.append(lisp_repr(cur.car))
            cur = cur.cdr
        if cur is NIL:
            return "(" + " ".join(items) + ")"
        else:
            return "(" + " ".join(items) + " . " + lisp_repr(cur) + ")"

    def __eq__(self, other):
        if not isinstance(other, Pair):
            return False
        return self.car == other.car and self.cdr == other.cdr

def make_list(*args):
    result = NIL
    for a in reversed(args):
        result = Pair(a, result)
    return result

def python_list_to_lisp(lst):
    result = NIL
    for item in reversed(lst):
        result = Pair(item, result)
    return result

def lisp_to_python_list(lst):
    result = []
    cur = lst
    while isinstance(cur, Pair):
        result.append(cur.car)
        cur = cur.cdr
    return result

def lisp_repr(val):
    if val is True: return "#t"
    if val is False: return "#f"
    if val is NIL: return "()"
    if isinstance(val, str) and not isinstance(val, Symbol):
        return '"' + val.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'
    if isinstance(val, Procedure):
        return f"#<procedure {val.name or 'lambda'}>"
    if isinstance(val, BuiltinProcedure):
        return f"#<builtin {val.name}>"
    if isinstance(val, Macro):
        return f"#<macro {val.name}>"
    return repr(val) if not isinstance(val, (Pair, Nil)) else str(val)


# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------

TOKEN_RE = re.compile(
    r'"""[\s\S]*?"""'       # triple-quoted string (not standard Scheme but nice to have)
    r'|"(?:[^"\\]|\\.)*"'  # string literal
    r"|;[^\n]*"             # comment
    r"|#[tf]"               # booleans
    r"|#\\[a-zA-Z]+"        # character literals (simplified)
    r"|[()]"                # parens
    r"|`|'|,@|,"            # quote shorthand
    r"|[^\s()\"`,;]+"       # symbol / number
)

def tokenize(s):
    tokens = []
    for m in TOKEN_RE.finditer(s):
        tok = m.group()
        if tok.startswith(';'):
            continue
        tokens.append(tok)
    return tokens


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def parse(tokens, pos=0):
    if pos >= len(tokens):
        raise LispError("Unexpected EOF")
    tok = tokens[pos]

    if tok == '(':
        lst, pos = parse_list(tokens, pos + 1)
        return lst, pos
    elif tok == "'":
        expr, pos = parse(tokens, pos + 1)
        return Pair(Symbol('quote'), Pair(expr, NIL)), pos
    elif tok == '`':
        expr, pos = parse(tokens, pos + 1)
        return Pair(Symbol('quasiquote'), Pair(expr, NIL)), pos
    elif tok == ',@':
        expr, pos = parse(tokens, pos + 1)
        return Pair(Symbol('unquote-splicing'), Pair(expr, NIL)), pos
    elif tok == ',':
        expr, pos = parse(tokens, pos + 1)
        return Pair(Symbol('unquote'), Pair(expr, NIL)), pos
    else:
        return parse_atom(tok), pos + 1

def parse_list(tokens, pos):
    items = []
    dot_item = None
    while pos < len(tokens) and tokens[pos] != ')':
        if tokens[pos] == '.':
            pos += 1
            dot_item, pos = parse(tokens, pos)
        else:
            item, pos = parse(tokens, pos)
            items.append(item)
    if pos >= len(tokens):
        raise LispError("Missing closing ')'")
    pos += 1  # consume ')'
    if dot_item is not None:
        result = dot_item
    else:
        result = NIL
    for item in reversed(items):
        result = Pair(item, result)
    return result, pos

def parse_atom(tok):
    if tok == '#t': return True
    if tok == '#f': return False
    if tok == 'nil': return NIL
    if tok.startswith('"'):
        return parse_string(tok)
    try:
        return int(tok)
    except ValueError:
        pass
    try:
        return float(tok)
    except ValueError:
        pass
    return Symbol(tok)

def parse_string(tok):
    # Remove surrounding quotes and process escape sequences
    s = tok[1:-1]
    result = []
    i = 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s):
            esc = s[i+1]
            if esc == 'n': result.append('\n')
            elif esc == 't': result.append('\t')
            elif esc == 'r': result.append('\r')
            elif esc == '"': result.append('"')
            elif esc == '\\': result.append('\\')
            else: result.append('\\'); result.append(esc)
            i += 2
        else:
            result.append(s[i])
            i += 1
    return ''.join(result)

def parse_all(source):
    tokens = tokenize(source)
    exprs = []
    pos = 0
    while pos < len(tokens):
        expr, pos = parse(tokens, pos)
        exprs.append(expr)
    return exprs

def count_parens(s):
    """Return (open_count - close_count) for unfinished input detection."""
    tokens = tokenize(s)
    depth = 0
    for tok in tokens:
        if tok == '(':
            depth += 1
        elif tok == ')':
            depth -= 1
    return depth


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

class Environment:
    def __init__(self, params=(), args=(), outer=None):
        self.vars = {}
        self.outer = outer
        if isinstance(params, Symbol):
            # variadic: bind all args to single param
            self.vars[params] = python_list_to_lisp(list(args))
        else:
            arg_list = list(args)
            self._bind(params, arg_list)

    def _bind(self, params, args):
        if params is NIL:
            if args:
                raise LispError(f"Too many arguments")
            return
        if isinstance(params, Symbol):
            self.vars[params] = python_list_to_lisp(args)
            return
        if isinstance(params, Pair):
            if not args:
                raise LispError(f"Too few arguments: missing {params.car}")
            self.vars[params.car] = args[0]
            self._bind(params.cdr, args[1:])
        else:
            # plain python list fallback
            for p, a in zip(params, args):
                self.vars[p] = a

    def lookup(self, name):
        if name in self.vars:
            return self.vars[name]
        if self.outer is not None:
            return self.outer.lookup(name)
        raise LispError(f"Undefined variable: {name}")

    def set(self, name, val):
        if name in self.vars:
            self.vars[name] = val
            return
        if self.outer is not None:
            self.outer.set(name, val)
            return
        raise LispError(f"Undefined variable: {name}")

    def define(self, name, val):
        self.vars[name] = val


# ---------------------------------------------------------------------------
# Procedure types
# ---------------------------------------------------------------------------

class Procedure:
    """User-defined lambda."""
    def __init__(self, params, body, env, name=None):
        self.params = params
        self.body = body   # list of expressions (implicit begin)
        self.env = env
        self.name = name

    def __call__(self, *args):
        # called only from Python — normally eval handles TCO
        env = Environment(self.params, args, self.env)
        result = NIL
        for expr in self.body[:-1]:
            result = scheme_eval(expr, env)
        return scheme_eval(self.body[-1], env)

class BuiltinProcedure:
    def __init__(self, fn, name):
        self.fn = fn
        self.name = name
    def __call__(self, *args):
        return self.fn(*args)

class Macro:
    """Scheme macro (define-macro)."""
    def __init__(self, params, body, env, name=None):
        self.params = params
        self.body = body
        self.env = env
        self.name = name


# ---------------------------------------------------------------------------
# Quasiquote expansion
# ---------------------------------------------------------------------------

def expand_quasiquote(expr):
    if not isinstance(expr, Pair):
        return Pair(Symbol('quote'), Pair(expr, NIL))
    if expr.car == Symbol('unquote'):
        return expr.cdr.car
    if isinstance(expr.car, Pair) and expr.car.car == Symbol('unquote-splicing'):
        return Pair(Symbol('append'),
                    Pair(expr.car.cdr.car,
                         Pair(expand_quasiquote(expr.cdr), NIL)))
    return Pair(Symbol('cons'),
                Pair(expand_quasiquote(expr.car),
                     Pair(expand_quasiquote(expr.cdr), NIL)))


# ---------------------------------------------------------------------------
# TCO trampoline
# ---------------------------------------------------------------------------

class TailCall:
    __slots__ = ("expr", "env")
    def __init__(self, expr, env):
        self.expr = expr
        self.env = env


def scheme_eval(expr, env):
    """Evaluate expr in env with TCO via explicit loop."""
    while True:
        # Self-evaluating
        if expr is NIL or expr is True or expr is False:
            return expr
        if isinstance(expr, (int, float)):
            return expr
        if isinstance(expr, str) and not isinstance(expr, Symbol):
            return expr
        if isinstance(expr, Nil):
            return NIL

        # Symbol lookup
        if isinstance(expr, Symbol):
            return env.lookup(expr)

        # Must be a Pair (list form)
        if not isinstance(expr, Pair):
            return expr

        head = expr.car
        tail = expr.cdr

        # ---- Special forms ----

        if head == Symbol('quote'):
            return tail.car

        if head == Symbol('quasiquote'):
            expanded = expand_quasiquote(tail.car)
            expr = expanded
            continue  # TCO

        if head == Symbol('if'):
            args = lisp_to_python_list(tail)
            test = scheme_eval(args[0], env)
            if test is not False:
                expr = args[1]
            else:
                expr = args[2] if len(args) > 2 else NIL
            continue  # TCO

        if head == Symbol('cond'):
            clauses = lisp_to_python_list(tail)
            result = NIL
            for clause in clauses:
                cl = lisp_to_python_list(clause)
                test_expr = cl[0]
                if test_expr == Symbol('else') or scheme_eval(test_expr, env) is not False:
                    if len(cl) == 1:
                        result = scheme_eval(test_expr, env) if test_expr != Symbol('else') else NIL
                        break
                    # TCO: evaluate all but last, then tail-call last
                    for e in cl[1:-1]:
                        scheme_eval(e, env)
                    expr = cl[-1]
                    break
            else:
                return NIL
            if test_expr == Symbol('else') or True:
                continue  # TCO
            return result

        if head == Symbol('and'):
            args = lisp_to_python_list(tail)
            if not args:
                return True
            for a in args[:-1]:
                val = scheme_eval(a, env)
                if val is False:
                    return False
            expr = args[-1]
            continue  # TCO

        if head == Symbol('or'):
            args = lisp_to_python_list(tail)
            if not args:
                return False
            for a in args[:-1]:
                val = scheme_eval(a, env)
                if val is not False:
                    return val
            expr = args[-1]
            continue  # TCO

        if head == Symbol('define'):
            if isinstance(tail.car, Pair):
                # (define (name params...) body...)
                name = tail.car.car
                params = tail.car.cdr
                body = lisp_to_python_list(tail.cdr)
                proc = Procedure(params, body, env, name=str(name))
                env.define(name, proc)
            else:
                name = tail.car
                val = scheme_eval(tail.cdr.car, env) if tail.cdr is not NIL else NIL
                env.define(name, val)
            return Symbol('ok')

        if head == Symbol('define-macro'):
            # (define-macro (name params...) body...)
            # or (define-macro name (lambda ...))
            if isinstance(tail.car, Pair):
                name = tail.car.car
                params = tail.car.cdr
                body = lisp_to_python_list(tail.cdr)
                mac = Macro(params, body, env, name=str(name))
                env.define(name, mac)
            else:
                name = tail.car
                val = scheme_eval(tail.cdr.car, env)
                if isinstance(val, Procedure):
                    mac = Macro(val.params, val.body, val.env, name=str(name))
                else:
                    mac = val
                env.define(name, mac)
            return Symbol('ok')

        if head == Symbol('lambda'):
            params = tail.car
            body = lisp_to_python_list(tail.cdr)
            return Procedure(params, body, env)

        if head == Symbol('begin'):
            forms = lisp_to_python_list(tail)
            if not forms:
                return NIL
            for f in forms[:-1]:
                scheme_eval(f, env)
            expr = forms[-1]
            continue  # TCO

        if head == Symbol('let'):
            # (let ((var val) ...) body...)
            bindings_list = lisp_to_python_list(tail.car)
            body = lisp_to_python_list(tail.cdr)
            new_env = Environment(outer=env)
            for binding in bindings_list:
                b = lisp_to_python_list(binding)
                new_env.define(b[0], scheme_eval(b[1], env))
            for f in body[:-1]:
                scheme_eval(f, new_env)
            expr = body[-1]
            env = new_env
            continue  # TCO

        if head == Symbol('let*'):
            bindings_list = lisp_to_python_list(tail.car)
            body = lisp_to_python_list(tail.cdr)
            new_env = Environment(outer=env)
            for binding in bindings_list:
                b = lisp_to_python_list(binding)
                new_env.define(b[0], scheme_eval(b[1], new_env))
            for f in body[:-1]:
                scheme_eval(f, new_env)
            expr = body[-1]
            env = new_env
            continue  # TCO

        if head == Symbol('letrec'):
            bindings_list = lisp_to_python_list(tail.car)
            body = lisp_to_python_list(tail.cdr)
            new_env = Environment(outer=env)
            for binding in bindings_list:
                b = lisp_to_python_list(binding)
                new_env.define(b[0], NIL)
            for binding in bindings_list:
                b = lisp_to_python_list(binding)
                new_env.set(b[0], scheme_eval(b[1], new_env))
            for f in body[:-1]:
                scheme_eval(f, new_env)
            expr = body[-1]
            env = new_env
            continue  # TCO

        if head == Symbol('set!'):
            name = tail.car
            val = scheme_eval(tail.cdr.car, env)
            env.set(name, val)
            return Symbol('ok')

        if head == Symbol('do'):
            # (do ((var init step) ...) (test result...) body...)
            var_specs = lisp_to_python_list(tail.car)
            finish = lisp_to_python_list(tail.cdr.car)
            do_body = lisp_to_python_list(tail.cdr.cdr)
            loop_env = Environment(outer=env)
            for spec in var_specs:
                s = lisp_to_python_list(spec)
                loop_env.define(s[0], scheme_eval(s[1], env))
            while True:
                test_val = scheme_eval(finish[0], loop_env)
                if test_val is not False:
                    if len(finish) > 1:
                        for r in finish[1:-1]:
                            scheme_eval(r, loop_env)
                        expr = finish[-1]
                        env = loop_env
                        break
                    return NIL
                for b in do_body:
                    scheme_eval(b, loop_env)
                new_vals = []
                for spec in var_specs:
                    s = lisp_to_python_list(spec)
                    if len(s) > 2:
                        new_vals.append((s[0], scheme_eval(s[2], loop_env)))
                    else:
                        new_vals.append((s[0], loop_env.lookup(s[0])))
                for name, val in new_vals:
                    loop_env.define(name, val)
            continue

        if head == Symbol('when'):
            test = scheme_eval(tail.car, env)
            if test is not False:
                forms = lisp_to_python_list(tail.cdr)
                if forms:
                    for f in forms[:-1]:
                        scheme_eval(f, env)
                    expr = forms[-1]
                    continue
            return NIL

        if head == Symbol('unless'):
            test = scheme_eval(tail.car, env)
            if test is False:
                forms = lisp_to_python_list(tail.cdr)
                if forms:
                    for f in forms[:-1]:
                        scheme_eval(f, env)
                    expr = forms[-1]
                    continue
            return NIL

        # ---- Procedure / macro application ----
        proc = scheme_eval(head, env)

        # Macro expansion
        if isinstance(proc, Macro):
            args = lisp_to_python_list(tail)
            mac_env = Environment(proc.params, args, proc.env)
            expanded = NIL
            for f in proc.body[:-1]:
                scheme_eval(f, mac_env)
            expanded = scheme_eval(proc.body[-1], mac_env)
            expr = expanded
            continue  # TCO: eval expanded form

        # Regular call
        args = [scheme_eval(a, env) for a in tail]

        if isinstance(proc, BuiltinProcedure):
            return proc(*args)

        if isinstance(proc, Procedure):
            env = Environment(proc.params, args, proc.env)
            body = proc.body
            for f in body[:-1]:
                scheme_eval(f, env)
            expr = body[-1]
            continue  # TCO

        if callable(proc):
            return proc(*args)

        raise LispError(f"Not a procedure: {lisp_repr(proc)}")


# ---------------------------------------------------------------------------
# Built-in functions
# ---------------------------------------------------------------------------

def _check_args(name, args, n):
    if len(args) != n:
        raise LispError(f"{name}: expected {n} args, got {len(args)}")

def _check_min_args(name, args, n):
    if len(args) < n:
        raise LispError(f"{name}: expected at least {n} args, got {len(args)}")

def make_global_env():
    env = Environment()

    def b(name, fn):
        env.define(Symbol(name), BuiltinProcedure(fn, name))

    # Arithmetic
    def _add(*args):
        if not args: return 0
        result = args[0]
        for a in args[1:]: result += a
        return result

    def _sub(*args):
        _check_min_args('-', args, 1)
        if len(args) == 1: return -args[0]
        result = args[0]
        for a in args[1:]: result -= a
        return result

    def _mul(*args):
        if not args: return 1
        result = args[0]
        for a in args[1:]: result *= a
        return result

    def _div(*args):
        _check_min_args('/', args, 1)
        if len(args) == 1:
            return 1 / args[0]
        result = args[0]
        for a in args[1:]:
            if a == 0: raise LispError("Division by zero")
            result = result / a
        # Return int if result is whole number
        if isinstance(result, float) and result.is_integer():
            return int(result)
        return result

    def _modulo(a, b):
        if b == 0: raise LispError("modulo: division by zero")
        return a % b

    def _quotient(a, b):
        if b == 0: raise LispError("quotient: division by zero")
        return int(a / b)

    def _remainder(a, b):
        if b == 0: raise LispError("remainder: division by zero")
        return int(a - b * int(a / b))

    def _expt(a, b): return a ** b
    def _sqrt(a):
        r = a ** 0.5
        if isinstance(r, float) and r.is_integer():
            return int(r)
        return r
    def _abs(a): return abs(a)
    def _max(*args): return max(args)
    def _min(*args): return min(args)
    def _floor(a): return int(a // 1)
    def _ceiling(a): return int(-(-a // 1))
    def _round(a): return round(a)
    def _truncate(a): return int(a)

    b('+', _add); b('-', _sub); b('*', _mul); b('/', _div)
    b('modulo', _modulo); b('quotient', _quotient); b('remainder', _remainder)
    b('expt', _expt); b('sqrt', _sqrt); b('abs', _abs)
    b('max', _max); b('min', _min)
    b('floor', _floor); b('ceiling', _ceiling)
    b('round', _round); b('truncate', _truncate)

    # Number predicates
    b('number?', lambda a: isinstance(a, (int, float)) and not isinstance(a, bool))
    b('integer?', lambda a: isinstance(a, int) and not isinstance(a, bool))
    b('zero?', lambda a: a == 0)
    b('positive?', lambda a: a > 0)
    b('negative?', lambda a: a < 0)
    b('odd?', lambda a: a % 2 != 0)
    b('even?', lambda a: a % 2 == 0)
    b('exact?', lambda a: isinstance(a, int))
    b('inexact?', lambda a: isinstance(a, float))
    b('exact->inexact', lambda a: float(a))
    b('inexact->exact', lambda a: int(a))

    # Comparison
    def _eq_num(*args):
        return all(args[i] == args[i+1] for i in range(len(args)-1))
    def _lt(*args):
        return all(args[i] < args[i+1] for i in range(len(args)-1))
    def _gt(*args):
        return all(args[i] > args[i+1] for i in range(len(args)-1))
    def _le(*args):
        return all(args[i] <= args[i+1] for i in range(len(args)-1))
    def _ge(*args):
        return all(args[i] >= args[i+1] for i in range(len(args)-1))

    b('=', _eq_num); b('<', _lt); b('>', _gt); b('<=', _le); b('>=', _ge)

    # Logic
    b('not', lambda a: a is False)
    b('boolean?', lambda a: isinstance(a, bool))

    # Equality
    def _equal(a, b):
        if type(a) != type(b):
            if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                return a == b
            return False
        if isinstance(a, Pair):
            while isinstance(a, Pair) and isinstance(b, Pair):
                if not _equal(a.car, b.car): return False
                a, b = a.cdr, b.cdr
            return _equal(a, b)
        return a == b

    b('eq?', lambda a, b: a is b or a == b)
    b('eqv?', lambda a, b: a is b or a == b)
    b('equal?', _equal)

    # List operations
    def _cons(a, b): return Pair(a, b)
    def _car(p):
        if not isinstance(p, Pair): raise LispError(f"car: not a pair: {lisp_repr(p)}")
        return p.car
    def _cdr(p):
        if not isinstance(p, Pair): raise LispError(f"cdr: not a pair: {lisp_repr(p)}")
        return p.cdr
    def _list(*args): return python_list_to_lisp(list(args))
    def _length(lst):
        n = 0
        cur = lst
        while isinstance(cur, Pair):
            n += 1; cur = cur.cdr
        if cur is not NIL: raise LispError("length: improper list")
        return n
    def _append(*args):
        if not args: return NIL
        if len(args) == 1: return args[0]
        result = args[-1]
        for lst in reversed(args[:-1]):
            items = list(lst)
            for item in reversed(items):
                result = Pair(item, result)
        return result
    def _reverse(lst):
        result = NIL
        cur = lst
        while isinstance(cur, Pair):
            result = Pair(cur.car, result)
            cur = cur.cdr
        return result
    def _list_tail(lst, k):
        cur = lst
        for _ in range(k):
            if not isinstance(cur, Pair): raise LispError("list-tail: index out of range")
            cur = cur.cdr
        return cur
    def _list_ref(lst, k):
        cur = _list_tail(lst, k)
        if not isinstance(cur, Pair): raise LispError("list-ref: index out of range")
        return cur.car

    b('cons', _cons); b('car', _car); b('cdr', _cdr); b('list', _list)
    b('length', _length); b('append', _append); b('reverse', _reverse)
    b('list-tail', _list_tail); b('list-ref', _list_ref)

    # cadr, caddr etc.
    b('cadr',   lambda p: _car(_cdr(p)))
    b('caddr',  lambda p: _car(_cdr(_cdr(p))))
    b('cadddr', lambda p: _car(_cdr(_cdr(_cdr(p)))))
    b('caar',   lambda p: _car(_car(p)))
    b('cdar',   lambda p: _cdr(_car(p)))
    b('cddr',   lambda p: _cdr(_cdr(p)))

    # Predicates
    b('null?', lambda a: a is NIL)
    b('pair?', lambda a: isinstance(a, Pair))
    def _list_pred(a):
        cur = a
        while isinstance(cur, Pair):
            cur = cur.cdr
        return cur is NIL
    b('list?', _list_pred)
    b('symbol?', lambda a: isinstance(a, Symbol))
    b('string?', lambda a: isinstance(a, str) and not isinstance(a, Symbol))
    b('procedure?', lambda a: isinstance(a, (Procedure, BuiltinProcedure)) or callable(a))
    b('char?', lambda a: False)  # simplified — no char type

    # Higher-order
    def _map(fn, *lists):
        if len(lists) == 1:
            items = [scheme_eval(Pair(fn if not isinstance(fn, (Procedure, BuiltinProcedure)) else fn,
                                     Pair(scheme_eval(Symbol('quote'), env) if False else item, NIL)), env)
                     for item in lists[0]]
            # Just call fn directly
            result = [fn(item) for item in lists[0]]
            return python_list_to_lisp(result)
        else:
            iters = [list(lst) for lst in lists]
            n = min(len(i) for i in iters)
            result = [fn(*[iters[j][i] for j in range(len(iters))]) for i in range(n)]
            return python_list_to_lisp(result)

    def _for_each(fn, *lists):
        if len(lists) == 1:
            for item in lists[0]:
                fn(item)
        else:
            iters = [list(lst) for lst in lists]
            n = min(len(i) for i in iters)
            for i in range(n):
                fn(*[iters[j][i] for j in range(len(iters))])
        return NIL

    def _filter(fn, lst):
        result = [item for item in lst if fn(item) is not False]
        return python_list_to_lisp(result)

    def _fold_left(fn, init, lst):
        result = init
        for item in lst:
            result = fn(result, item)
        return result

    def _fold_right(fn, init, lst):
        items = list(lst)
        result = init
        for item in reversed(items):
            result = fn(item, result)
        return result

    def _reduce(fn, init, lst):
        items = list(lst)
        if not items: return init
        result = items[0]
        for item in items[1:]:
            result = fn(result, item)
        return result

    def _assoc(key, alist):
        cur = alist
        while isinstance(cur, Pair):
            pair = cur.car
            if isinstance(pair, Pair) and _equal(pair.car, key):
                return pair
            cur = cur.cdr
        return False

    def _assq(key, alist):
        cur = alist
        while isinstance(cur, Pair):
            pair = cur.car
            if isinstance(pair, Pair) and pair.car is key:
                return pair
            cur = cur.cdr
        return False

    def _member(key, lst):
        cur = lst
        while isinstance(cur, Pair):
            if _equal(cur.car, key): return cur
            cur = cur.cdr
        return False

    def _memq(key, lst):
        cur = lst
        while isinstance(cur, Pair):
            if cur.car is key: return cur
            cur = cur.cdr
        return False

    def _sort(lst, cmp):
        items = list(lst)
        items.sort(key=lambda x: x,
                   reverse=False)
        # Use comparison function
        import functools
        def cmp_fn(a, b):
            r = cmp(a, b)
            if r is True: return -1
            if r is False: return 0
            return -1 if r else 1
        items.sort(key=functools.cmp_to_key(cmp_fn))
        return python_list_to_lisp(items)

    b('map', _map); b('for-each', _for_each); b('filter', _filter)
    b('fold-left', _fold_left); b('fold-right', _fold_right)
    b('reduce', _reduce)
    b('assoc', _assoc); b('assq', _assq); b('assv', _assoc)
    b('member', _member); b('memq', _memq); b('memv', _member)
    b('sort', _sort)

    # apply
    def _apply(fn, *args):
        if not args: raise LispError("apply: requires at least 2 args")
        all_args = list(args[:-1]) + list(args[-1])
        return fn(*all_args)
    b('apply', _apply)

    # String operations
    b('string-length', lambda s: len(s))
    b('string-append', lambda *args: ''.join(args))
    b('substring', lambda s, start, end=None: s[start:end] if end is not None else s[start:])
    b('string->number', lambda s, base=10: (
        (lambda: int(s, base) if '.' not in s else float(s))()
        if re.match(r'^[+-]?[\d.]+([eE][+-]?\d+)?$', s) else False
    ))
    b('number->string', lambda n, base=10: (
        format(n, 'b') if base == 2 else
        format(n, 'o') if base == 8 else
        format(n, 'x') if base == 16 else
        str(n)
    ))
    b('string->symbol', lambda s: Symbol(s))
    b('symbol->string', lambda s: str(s))
    b('string->list', lambda s: python_list_to_lisp(list(s)))
    b('list->string', lambda lst: ''.join(list(lst)))
    b('string-upcase', lambda s: s.upper())
    b('string-downcase', lambda s: s.lower())
    b('string-contains', lambda s, sub: sub in s)
    b('string-copy', lambda s: s)
    b('string', lambda *chars: ''.join(chars))
    b('string-ref', lambda s, i: s[i])
    b('make-string', lambda n, c=' ': c * n)
    b('string<?', lambda a, b: a < b)
    b('string>?', lambda a, b: a > b)
    b('string=?', lambda a, b: a == b)
    b('string<=?', lambda a, b: a <= b)
    b('string>=?', lambda a, b: a >= b)
    b('string-ci=?', lambda a, b: a.lower() == b.lower())

    # I/O
    def _display(val, port=None):
        if isinstance(val, str) and not isinstance(val, Symbol):
            print(val, end='')
        else:
            print(lisp_repr(val), end='')
        return NIL

    def _write(val, port=None):
        print(lisp_repr(val), end='')
        return NIL

    def _newline(port=None):
        print()
        return NIL

    def _print(val):
        print(lisp_repr(val))
        return NIL

    def _read_line():
        try:
            return input()
        except EOFError:
            return False

    b('display', _display)
    b('write', _write)
    b('newline', _newline)
    b('print', _print)
    b('read-line', _read_line)

    # Type conversion
    b('list->vector', lambda lst: list(lst))
    b('vector->list', lambda v: python_list_to_lisp(v))
    b('number->string', lambda n, base=10: str(n))

    # Misc
    def _error(msg, *irritants):
        if irritants:
            parts = [lisp_repr(i) for i in irritants]
            raise LispError(f"{msg}: {' '.join(parts)}")
        raise LispError(str(msg))

    def _exit(*args):
        code = args[0] if args else 0
        sys.exit(code)

    b('error', _error)
    b('exit', _exit)
    b('gensym', lambda: Symbol(f"g{id(object())}"))

    # Vectors (simplified as python lists wrapped)
    b('make-vector', lambda n, fill=False: [fill] * n)
    b('vector', lambda *args: list(args))
    b('vector-ref', lambda v, i: v[i])
    b('vector-set!', lambda v, i, val: v.__setitem__(i, val) or NIL)
    b('vector-length', lambda v: len(v))
    b('vector?', lambda v: isinstance(v, list))
    b('vector-fill!', lambda v, val: [v.__setitem__(i, val) for i in range(len(v))] and NIL or NIL)

    # Math
    import math
    b('sin', math.sin); b('cos', math.cos); b('tan', math.tan)
    b('asin', math.asin); b('acos', math.acos); b('atan', math.atan)
    b('exp', math.exp); b('log', lambda x, base=None: math.log(x) if base is None else math.log(x, base))
    b('floor', lambda x: int(math.floor(x)))
    b('ceiling', lambda x: int(math.ceil(x)))
    b('truncate', lambda x: int(math.trunc(x)))
    b('round', lambda x: int(round(x)))

    # Booleans
    env.define(Symbol('#t'), True)
    env.define(Symbol('#f'), False)
    env.define(Symbol('else'), True)
    env.define(Symbol('nil'), NIL)

    return env


# ---------------------------------------------------------------------------
# REPL helpers
# ---------------------------------------------------------------------------

def format_result(val):
    """Format a value for REPL display."""
    if val is NIL: return None  # don't print nothing
    if val == Symbol('ok'): return None
    return lisp_repr(val)


# ---------------------------------------------------------------------------
# REPL
# ---------------------------------------------------------------------------

def repl():
    env = make_global_env()
    print("Lisp interpreter. Type (exit) or Ctrl+D to quit.")
    buffer = ""
    while True:
        try:
            prompt = "lisp> " if not buffer.strip() else "....  "
            line = input(prompt)
        except EOFError:
            print("\nBye!")
            break
        except KeyboardInterrupt:
            print()
            buffer = ""
            continue

        buffer += line + "\n"

        # Check if we have balanced parens
        try:
            depth = count_parens(buffer)
        except Exception:
            depth = 0

        if depth > 0:
            # Need more input
            continue

        if not buffer.strip():
            buffer = ""
            continue

        try:
            exprs = parse_all(buffer)
            for expr in exprs:
                result = scheme_eval(expr, env)
                out = format_result(result)
                if out is not None:
                    print(out)
        except LispError as e:
            print(f"Error: {e}")
        except SystemExit:
            print("Bye!")
            break
        except RecursionError:
            print("Error: Maximum recursion depth exceeded")
        except Exception as e:
            print(f"Error: {e}")

        buffer = ""


# ---------------------------------------------------------------------------
# File execution
# ---------------------------------------------------------------------------

def run_file(filename):
    env = make_global_env()
    try:
        with open(filename, 'r') as f:
            source = f.read()
    except FileNotFoundError:
        print(f"Error: File not found: {filename}", file=sys.stderr)
        sys.exit(1)
    except IOError as e:
        print(f"Error reading file: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        exprs = parse_all(source)
        for expr in exprs:
            scheme_eval(expr, env)
    except LispError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except SystemExit:
        pass
    except RecursionError:
        print("Error: Maximum recursion depth exceeded", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) > 1:
        run_file(sys.argv[1])
    else:
        repl()
