import sys
import re
import operator as op
import functools

class Symbol(str): pass

class Procedure:
    def __init__(self, params, body, env):
        self.params = params
        self.body = body
        self.env = env
    def __call__(self, *args):
        env = Env(self.params, args, self.env)
        if not self.body: return None
        res = None
        for exp in self.body:
            res = eval_lisp(exp, env)
        return res

class Macro:
    def __init__(self, params, body, env):
        self.params = params
        self.body = body
        self.env = env
    def __call__(self, *args):
        env = Env(self.params, args, self.env)
        if not self.body: return None
        res = None
        for exp in self.body:
            res = eval_lisp(exp, env)
        return res

class Env(dict):
    def __init__(self, params=(), args=(), outer=None):
        self.outer = outer
        if isinstance(params, Symbol) or isinstance(params, str):
            self.update({params: list(args)})
        else:
            if '.' in params:
                dot_idx = params.index('.')
                normal_params = params[:dot_idx]
                rest_param = params[dot_idx+1]
                if len(args) < len(normal_params):
                    raise TypeError(f"Expected at least {len(normal_params)} args, got {len(args)}")
                self.update(zip(normal_params, args[:dot_idx]))
                self.update({rest_param: list(args[dot_idx:])})
            else:
                if len(params) != len(args):
                    raise TypeError(f"Expected {len(params)} args, got {len(args)}")
                self.update(zip(params, args))
    def find(self, var):
        if var in self:
            return self
        elif self.outer is not None:
            return self.outer.find(var)
        else:
            raise NameError(f"Unbound variable: {var}")

def tokenize(s: str) -> list:
    tokens = re.findall(r'''"(?:\\.|[^"\\])*"|;.*|,@|'|`|,|\(|\)|[^\s\(\)'"`,;]+''', s)
    return [t for t in tokens if not t.startswith(';')]

def atom(token: str):
    if token == '#t': return True
    elif token == '#f': return False
    elif token.startswith('"') and token.endswith('"'):
        s = token[1:-1]
        return s.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
    try:
        return int(token)
    except ValueError:
        try:
            return float(token)
        except ValueError:
            return Symbol(token)

def parse(tokens: list):
    if not tokens:
        raise SyntaxError('unexpected EOF')
    token = tokens.pop(0)
    if token == '(':
        L = []
        while tokens and tokens[0] != ')':
            L.append(parse(tokens))
        if not tokens:
            raise SyntaxError('unexpected EOF while parsing')
        tokens.pop(0)
        return L
    elif token == ')':
        raise SyntaxError('unexpected )')
    elif token == "'":
        return ['quote', parse(tokens)]
    elif token == "`":
        return ['quasiquote', parse(tokens)]
    elif token == ",":
        return ['unquote', parse(tokens)]
    elif token == ",@":
        return ['unquote-splicing', parse(tokens)]
    else:
        return atom(token)

def eval_quasiquote(exp, env):
    if not isinstance(exp, list):
        return exp
    if not exp:
        return []
    if exp[0] == 'unquote':
        return eval_lisp(exp[1], env)
    if isinstance(exp[0], list) and exp[0] and exp[0][0] == 'unquote-splicing':
        return eval_lisp(exp[0][1], env) + eval_quasiquote(exp[1:], env)
    return [eval_quasiquote(exp[0], env)] + eval_quasiquote(exp[1:], env)

def eval_lisp(x, env):
    while True:
        if isinstance(x, Symbol):
            return env.find(x)[x]
        elif not isinstance(x, list):
            return x
        elif not x:
            return x
        
        op = x[0]
        if isinstance(op, Symbol):
            try:
                val = env.find(op)[op]
                if isinstance(val, Macro):
                    args = x[1:]
                    x = val(*args)
                    continue
            except NameError:
                pass
        
        if op == 'quote':
            return x[1]
        elif op == 'quasiquote':
            return eval_quasiquote(x[1], env)
        elif op == 'if':
            _, test, conseq, *alt = x
            test_val = eval_lisp(test, env)
            if test_val is not False:
                x = conseq
            elif alt:
                x = alt[0]
            else:
                return None
            continue
        elif op == 'define':
            _, var, *exp = x
            if isinstance(var, list):
                name, args = var[0], var[1:]
                env[name] = Procedure(args, exp, env)
            else:
                env[var] = eval_lisp(exp[0], env)
            return None
        elif op == 'define-macro':
            _, var, *exp = x
            if isinstance(var, list):
                name, args = var[0], var[1:]
                env[name] = Macro(args, exp, env)
            else:
                env[var] = eval_lisp(exp[0], env)
            return None
        elif op == 'set!':
            _, var, exp = x
            env.find(var)[var] = eval_lisp(exp, env)
            return None
        elif op == 'lambda':
            _, params, *body = x
            return Procedure(params, body, env)
        elif op == 'begin':
            if len(x) == 1: return None
            for exp in x[1:-1]:
                eval_lisp(exp, env)
            x = x[-1]
            continue
        elif op == 'cond':
            for clause in x[1:]:
                test = clause[0]
                test_val = True if test == 'else' else eval_lisp(test, env)
                if test_val is not False:
                    if len(clause) > 1:
                        for exp in clause[1:-1]:
                            eval_lisp(exp, env)
                        x = clause[-1]
                        break
                    else:
                        return test_val
            else:
                return None
            continue
        elif op == 'let':
            bindings = x[1]
            body = x[2:]
            vars_ = [b[0] for b in bindings]
            vals = [eval_lisp(b[1], env) for b in bindings]
            env = Env(vars_, vals, env)
            if not body: return None
            for exp in body[:-1]:
                eval_lisp(exp, env)
            x = body[-1]
            continue
        elif op == 'let*':
            bindings = x[1]
            body = x[2:]
            new_env = Env([], [], env)
            for var, exp in bindings:
                val = eval_lisp(exp, new_env)
                new_env = Env([var], [val], new_env)
            env = new_env
            if not body: return None
            for exp in body[:-1]:
                eval_lisp(exp, env)
            x = body[-1]
            continue
        elif op == 'and':
            if len(x) == 1: return True
            for exp in x[1:-1]:
                val = eval_lisp(exp, env)
                if val is False:
                    return False
            x = x[-1]
            continue
        elif op == 'or':
            if len(x) == 1: return False
            for exp in x[1:-1]:
                val = eval_lisp(exp, env)
                if val is not False:
                    return val
            x = x[-1]
            continue
        else:
            proc = eval_lisp(op, env)
            args = [eval_lisp(arg, env) for arg in x[1:]]
            if isinstance(proc, Procedure):
                env = Env(proc.params, args, proc.env)
                if not proc.body: return None
                for exp in proc.body[:-1]:
                    eval_lisp(exp, env)
                x = proc.body[-1]
                continue
            else:
                return proc(*args)

def to_string(x):
    if x is True:
        return "#t"
    elif x is False:
        return "#f"
    elif isinstance(x, Symbol):
        return str(x)
    elif isinstance(x, str):
        return f'"{x}"'
    elif isinstance(x, list):
        if len(x) == 3 and x[1] == '.':
            return "(" + to_string(x[0]) + " . " + to_string(x[2]) + ")"
        return "(" + " ".join(map(to_string, x)) + ")"
    elif isinstance(x, Procedure):
        return "<procedure>"
    elif isinstance(x, Macro):
        return "<macro>"
    else:
        return str(x)

def standard_env() -> Env:
    env = Env()
    env.update({
        '+': lambda *args: sum(args),
        '-': lambda *args: args[0] - sum(args[1:]) if len(args) > 1 else -args[0],
        '*': lambda *args: functools.reduce(op.mul, args, 1),
        '/': lambda *args: args[0] / functools.reduce(op.mul, args[1:], 1) if len(args) > 1 else 1 / args[0],
        'modulo': op.mod,
        '=': lambda *args: all(args[i] == args[i+1] for i in range(len(args)-1)) if len(args)>0 else True,
        '<': lambda *args: all(args[i] < args[i+1] for i in range(len(args)-1)) if len(args)>0 else True,
        '>': lambda *args: all(args[i] > args[i+1] for i in range(len(args)-1)) if len(args)>0 else True,
        '<=': lambda *args: all(args[i] <= args[i+1] for i in range(len(args)-1)) if len(args)>0 else True,
        '>=': lambda *args: all(args[i] >= args[i+1] for i in range(len(args)-1)) if len(args)>0 else True,
        'not': lambda x: x is False,
        'cons': lambda a, b: [a] + b if isinstance(b, list) else [a, '.', b],
        'car': lambda x: x[0] if isinstance(x, list) and x else None,
        'cdr': lambda x: x[1:] if isinstance(x, list) and len(x) > 0 and '.' not in x else (x[2] if isinstance(x, list) and len(x) == 3 and x[1] == '.' else []),
        'list': lambda *args: list(args),
        'length': len,
        'append': lambda *args: sum((arg for arg in args), []),
        'map': lambda f, lst: list(map(f, lst)),
        'filter': lambda f, lst: list(filter(f, lst)),
        'null?': lambda x: x == [],
        'pair?': lambda x: isinstance(x, list) and len(x) > 0,
        'list?': lambda x: isinstance(x, list),
        'string-length': len,
        'string-append': lambda *args: ''.join(args),
        'substring': lambda s, start, end: s[start:end],
        'string->number': lambda s: float(s) if '.' in s else int(s),
        'number->string': str,
        'display': lambda x: print(x if isinstance(x, str) and not isinstance(x, Symbol) else to_string(x), end=''),
        'newline': lambda: print(),
        'print': lambda x: print(to_string(x)),
        'exit': sys.exit,
    })
    return env

def repl(env=None):
    if env is None:
        env = standard_env()
    while True:
        try:
            line = input('lisp> ')
            if not line.strip():
                continue
            while line.count('(') > line.count(')'):
                line += ' ' + input('')
            tokens = tokenize(line)
            while tokens:
                val = eval_lisp(parse(tokens), env)
                if val is not None:
                    print(to_string(val))
        except EOFError:
            print()
            break
        except SystemExit:
            break
        except Exception as e:
            print(f"Error: {type(e).__name__}: {e}")

if __name__ == '__main__':
    global_env = standard_env()
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            code = f.read()
        tokens = tokenize(code)
        while tokens:
            eval_lisp(parse(tokens), global_env)
    else:
        repl(global_env)