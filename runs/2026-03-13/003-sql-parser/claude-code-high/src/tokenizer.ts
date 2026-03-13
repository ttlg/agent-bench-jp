export enum TokenType {
  // Keywords
  SELECT = 'SELECT',
  FROM = 'FROM',
  WHERE = 'WHERE',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  JOIN = 'JOIN',
  INNER = 'INNER',
  LEFT = 'LEFT',
  OUTER = 'OUTER',
  ON = 'ON',
  ORDER = 'ORDER',
  BY = 'BY',
  ASC = 'ASC',
  DESC = 'DESC',
  LIMIT = 'LIMIT',
  OFFSET = 'OFFSET',
  GROUP = 'GROUP',
  HAVING = 'HAVING',
  LIKE = 'LIKE',
  AS = 'AS',

  // Aggregate functions
  COUNT = 'COUNT',
  SUM = 'SUM',
  AVG = 'AVG',
  MIN = 'MIN',
  MAX = 'MAX',

  // Literals
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  IDENTIFIER = 'IDENTIFIER',

  // Symbols
  STAR = 'STAR',
  COMMA = 'COMMA',
  DOT = 'DOT',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',

  // Operators
  EQ = 'EQ',
  NEQ = 'NEQ',
  LT = 'LT',
  GT = 'GT',
  LTE = 'LTE',
  GTE = 'GTE',

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
  AND: TokenType.AND,
  OR: TokenType.OR,
  NOT: TokenType.NOT,
  JOIN: TokenType.JOIN,
  INNER: TokenType.INNER,
  LEFT: TokenType.LEFT,
  OUTER: TokenType.OUTER,
  ON: TokenType.ON,
  ORDER: TokenType.ORDER,
  BY: TokenType.BY,
  ASC: TokenType.ASC,
  DESC: TokenType.DESC,
  LIMIT: TokenType.LIMIT,
  OFFSET: TokenType.OFFSET,
  GROUP: TokenType.GROUP,
  HAVING: TokenType.HAVING,
  LIKE: TokenType.LIKE,
  AS: TokenType.AS,
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
    // Skip whitespace
    if (/\s/.test(sql[pos])) {
      pos++;
      continue;
    }

    // Single-line string literal
    if (sql[pos] === "'") {
      const start = pos;
      pos++; // skip opening quote
      let value = '';
      while (pos < sql.length && sql[pos] !== "'") {
        value += sql[pos];
        pos++;
      }
      if (pos >= sql.length) {
        throw new Error(`Unterminated string literal at position ${start}`);
      }
      pos++; // skip closing quote
      tokens.push({ type: TokenType.STRING, value, position: start });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(sql[pos]) || (sql[pos] === '-' && pos + 1 < sql.length && /[0-9]/.test(sql[pos + 1]) && (tokens.length === 0 || [TokenType.LPAREN, TokenType.COMMA, TokenType.EQ, TokenType.NEQ, TokenType.LT, TokenType.GT, TokenType.LTE, TokenType.GTE, TokenType.AND, TokenType.OR, TokenType.NOT].includes(tokens[tokens.length - 1].type)))) {
      const start = pos;
      if (sql[pos] === '-') pos++;
      while (pos < sql.length && /[0-9.]/.test(sql[pos])) {
        pos++;
      }
      tokens.push({ type: TokenType.NUMBER, value: sql.slice(start, pos), position: start });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_\u3000-\u9fff\uf900-\ufaff]/.test(sql[pos])) {
      const start = pos;
      while (pos < sql.length && /[a-zA-Z0-9_\u3000-\u9fff\uf900-\ufaff]/.test(sql[pos])) {
        pos++;
      }
      const word = sql.slice(start, pos);
      const upper = word.toUpperCase();
      const kwType = KEYWORDS[upper];
      if (kwType) {
        tokens.push({ type: kwType, value: upper, position: start });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, value: word, position: start });
      }
      continue;
    }

    // Symbols and operators
    switch (sql[pos]) {
      case '*':
        tokens.push({ type: TokenType.STAR, value: '*', position: pos });
        pos++;
        break;
      case ',':
        tokens.push({ type: TokenType.COMMA, value: ',', position: pos });
        pos++;
        break;
      case '.':
        tokens.push({ type: TokenType.DOT, value: '.', position: pos });
        pos++;
        break;
      case '(':
        tokens.push({ type: TokenType.LPAREN, value: '(', position: pos });
        pos++;
        break;
      case ')':
        tokens.push({ type: TokenType.RPAREN, value: ')', position: pos });
        pos++;
        break;
      case '=':
        tokens.push({ type: TokenType.EQ, value: '=', position: pos });
        pos++;
        break;
      case '!':
        if (pos + 1 < sql.length && sql[pos + 1] === '=') {
          tokens.push({ type: TokenType.NEQ, value: '!=', position: pos });
          pos += 2;
        } else {
          throw new Error(`Unexpected character '!' at position ${pos}`);
        }
        break;
      case '<':
        if (pos + 1 < sql.length && sql[pos + 1] === '=') {
          tokens.push({ type: TokenType.LTE, value: '<=', position: pos });
          pos += 2;
        } else {
          tokens.push({ type: TokenType.LT, value: '<', position: pos });
          pos++;
        }
        break;
      case '>':
        if (pos + 1 < sql.length && sql[pos + 1] === '=') {
          tokens.push({ type: TokenType.GTE, value: '>=', position: pos });
          pos += 2;
        } else {
          tokens.push({ type: TokenType.GT, value: '>', position: pos });
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
