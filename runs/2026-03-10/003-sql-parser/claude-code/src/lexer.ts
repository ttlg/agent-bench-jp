export enum TokenType {
  SELECT = 'SELECT',
  FROM = 'FROM',
  WHERE = 'WHERE',
  JOIN = 'JOIN',
  INNER = 'INNER',
  LEFT = 'LEFT',
  OUTER = 'OUTER',
  ON = 'ON',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  ORDER = 'ORDER',
  BY = 'BY',
  ASC = 'ASC',
  DESC = 'DESC',
  LIMIT = 'LIMIT',
  OFFSET = 'OFFSET',
  GROUP = 'GROUP',
  HAVING = 'HAVING',
  LIKE = 'LIKE',
  COUNT = 'COUNT',
  SUM = 'SUM',
  AVG = 'AVG',
  MIN = 'MIN',
  MAX = 'MAX',
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  IDENTIFIER = 'IDENTIFIER',
  EQ = 'EQ',
  NEQ = 'NEQ',
  LT = 'LT',
  GT = 'GT',
  LTE = 'LTE',
  GTE = 'GTE',
  STAR = 'STAR',
  DOT = 'DOT',
  COMMA = 'COMMA',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const KEYWORDS: Record<string, TokenType> = {
  SELECT: TokenType.SELECT,
  FROM: TokenType.FROM,
  WHERE: TokenType.WHERE,
  JOIN: TokenType.JOIN,
  INNER: TokenType.INNER,
  LEFT: TokenType.LEFT,
  OUTER: TokenType.OUTER,
  ON: TokenType.ON,
  AND: TokenType.AND,
  OR: TokenType.OR,
  NOT: TokenType.NOT,
  ORDER: TokenType.ORDER,
  BY: TokenType.BY,
  ASC: TokenType.ASC,
  DESC: TokenType.DESC,
  LIMIT: TokenType.LIMIT,
  OFFSET: TokenType.OFFSET,
  GROUP: TokenType.GROUP,
  HAVING: TokenType.HAVING,
  LIKE: TokenType.LIKE,
  COUNT: TokenType.COUNT,
  SUM: TokenType.SUM,
  AVG: TokenType.AVG,
  MIN: TokenType.MIN,
  MAX: TokenType.MAX,
};

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < sql.length) {
    if (/\s/.test(sql[pos])) {
      pos++;
      continue;
    }

    if (sql[pos] === "'") {
      const start = pos;
      pos++;
      let value = '';
      while (pos < sql.length && sql[pos] !== "'") {
        if (sql[pos] === "'" && sql[pos + 1] === "'") {
          value += "'";
          pos += 2;
        } else {
          value += sql[pos];
          pos++;
        }
      }
      if (pos >= sql.length) {
        throw new Error(`Unterminated string literal at position ${start}`);
      }
      pos++;
      tokens.push({ type: TokenType.STRING, value, position: start });
      continue;
    }

    if (/\d/.test(sql[pos])) {
      const start = pos;
      while (pos < sql.length && /[\d.]/.test(sql[pos])) {
        pos++;
      }
      tokens.push({ type: TokenType.NUMBER, value: sql.slice(start, pos), position: start });
      continue;
    }

    if (/[a-zA-Z_]/.test(sql[pos])) {
      const start = pos;
      while (pos < sql.length && /[a-zA-Z0-9_]/.test(sql[pos])) {
        pos++;
      }
      const value = sql.slice(start, pos);
      const upper = value.toUpperCase();
      const type = KEYWORDS[upper] || TokenType.IDENTIFIER;
      tokens.push({
        type,
        value: type === TokenType.IDENTIFIER ? value : upper,
        position: start,
      });
      continue;
    }

    const start = pos;
    switch (sql[pos]) {
      case '*':
        tokens.push({ type: TokenType.STAR, value: '*', position: start });
        pos++;
        break;
      case '.':
        tokens.push({ type: TokenType.DOT, value: '.', position: start });
        pos++;
        break;
      case ',':
        tokens.push({ type: TokenType.COMMA, value: ',', position: start });
        pos++;
        break;
      case '(':
        tokens.push({ type: TokenType.LPAREN, value: '(', position: start });
        pos++;
        break;
      case ')':
        tokens.push({ type: TokenType.RPAREN, value: ')', position: start });
        pos++;
        break;
      case '=':
        tokens.push({ type: TokenType.EQ, value: '=', position: start });
        pos++;
        break;
      case '!':
        if (sql[pos + 1] === '=') {
          tokens.push({ type: TokenType.NEQ, value: '!=', position: start });
          pos += 2;
        } else {
          throw new Error(`Unexpected character '!' at position ${pos}`);
        }
        break;
      case '<':
        if (sql[pos + 1] === '=') {
          tokens.push({ type: TokenType.LTE, value: '<=', position: start });
          pos += 2;
        } else {
          tokens.push({ type: TokenType.LT, value: '<', position: start });
          pos++;
        }
        break;
      case '>':
        if (sql[pos + 1] === '=') {
          tokens.push({ type: TokenType.GTE, value: '>=', position: start });
          pos += 2;
        } else {
          tokens.push({ type: TokenType.GT, value: '>', position: start });
          pos++;
        }
        break;
      default:
        throw new Error(`Unexpected character '${sql[pos]}' at position ${pos}`);
    }
  }

  tokens.push({ type: TokenType.EOF, value: '', position: pos });
  return tokens;
}
