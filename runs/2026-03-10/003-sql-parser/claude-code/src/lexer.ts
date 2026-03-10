export enum TokenType {
  // Keywords
  SELECT = 'SELECT',
  FROM = 'FROM',
  WHERE = 'WHERE',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  ORDER = 'ORDER',
  BY = 'BY',
  ASC = 'ASC',
  DESC = 'DESC',
  LIMIT = 'LIMIT',
  OFFSET = 'OFFSET',
  JOIN = 'JOIN',
  INNER = 'INNER',
  LEFT = 'LEFT',
  OUTER = 'OUTER',
  ON = 'ON',
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

  // Literals & identifiers
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
}

const KEYWORDS: Record<string, TokenType> = {
  SELECT: TokenType.SELECT,
  FROM: TokenType.FROM,
  WHERE: TokenType.WHERE,
  AND: TokenType.AND,
  OR: TokenType.OR,
  NOT: TokenType.NOT,
  ORDER: TokenType.ORDER,
  BY: TokenType.BY,
  ASC: TokenType.ASC,
  DESC: TokenType.DESC,
  LIMIT: TokenType.LIMIT,
  OFFSET: TokenType.OFFSET,
  JOIN: TokenType.JOIN,
  INNER: TokenType.INNER,
  LEFT: TokenType.LEFT,
  OUTER: TokenType.OUTER,
  ON: TokenType.ON,
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
  let i = 0;

  while (i < sql.length) {
    // Skip whitespace
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }

    // String literal
    if (sql[i] === "'") {
      i++;
      let str = '';
      while (i < sql.length && sql[i] !== "'") {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          str += "'";
          i += 2;
        } else {
          str += sql[i];
          i++;
        }
      }
      i++; // skip closing quote
      tokens.push({ type: TokenType.STRING, value: str });
      continue;
    }

    // Number
    if (/\d/.test(sql[i]) || (sql[i] === '-' && i + 1 < sql.length && /\d/.test(sql[i + 1]))) {
      let num = sql[i];
      i++;
      while (i < sql.length && /[\d.]/.test(sql[i])) {
        num += sql[i];
        i++;
      }
      tokens.push({ type: TokenType.NUMBER, value: num });
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_\u3000-\u9FFF\uF900-\uFAFF]/.test(sql[i])) {
      let id = '';
      while (i < sql.length && /[a-zA-Z0-9_\u3000-\u9FFF\uF900-\uFAFF]/.test(sql[i])) {
        id += sql[i];
        i++;
      }
      const upper = id.toUpperCase();
      if (KEYWORDS[upper]) {
        tokens.push({ type: KEYWORDS[upper], value: upper });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, value: id });
      }
      continue;
    }

    // Symbols and operators
    switch (sql[i]) {
      case '*':
        tokens.push({ type: TokenType.STAR, value: '*' });
        i++;
        break;
      case ',':
        tokens.push({ type: TokenType.COMMA, value: ',' });
        i++;
        break;
      case '.':
        tokens.push({ type: TokenType.DOT, value: '.' });
        i++;
        break;
      case '(':
        tokens.push({ type: TokenType.LPAREN, value: '(' });
        i++;
        break;
      case ')':
        tokens.push({ type: TokenType.RPAREN, value: ')' });
        i++;
        break;
      case '=':
        tokens.push({ type: TokenType.EQ, value: '=' });
        i++;
        break;
      case '!':
        if (sql[i + 1] === '=') {
          tokens.push({ type: TokenType.NEQ, value: '!=' });
          i += 2;
        } else {
          throw new Error(`Unexpected character: ${sql[i]} at position ${i}`);
        }
        break;
      case '<':
        if (sql[i + 1] === '=') {
          tokens.push({ type: TokenType.LTE, value: '<=' });
          i += 2;
        } else {
          tokens.push({ type: TokenType.LT, value: '<' });
          i++;
        }
        break;
      case '>':
        if (sql[i + 1] === '=') {
          tokens.push({ type: TokenType.GTE, value: '>=' });
          i += 2;
        } else {
          tokens.push({ type: TokenType.GT, value: '>' });
          i++;
        }
        break;
      default:
        throw new Error(`Unexpected character: ${sql[i]} at position ${i}`);
    }
  }

  tokens.push({ type: TokenType.EOF, value: '' });
  return tokens;
}
