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
      let value = '';
      while (i < sql.length && sql[i] !== "'") {
        value += sql[i];
        i++;
      }
      if (i < sql.length) i++; // skip closing quote
      tokens.push({ type: TokenType.STRING, value });
      continue;
    }

    // Number
    if (/\d/.test(sql[i]) || (sql[i] === '-' && i + 1 < sql.length && /\d/.test(sql[i + 1]))) {
      let value = '';
      if (sql[i] === '-') {
        value += '-';
        i++;
      }
      while (i < sql.length && /[\d.]/.test(sql[i])) {
        value += sql[i];
        i++;
      }
      tokens.push({ type: TokenType.NUMBER, value });
      continue;
    }

    // Symbols and operators
    if (sql[i] === '*') { tokens.push({ type: TokenType.STAR, value: '*' }); i++; continue; }
    if (sql[i] === ',') { tokens.push({ type: TokenType.COMMA, value: ',' }); i++; continue; }
    if (sql[i] === '.') { tokens.push({ type: TokenType.DOT, value: '.' }); i++; continue; }
    if (sql[i] === '(') { tokens.push({ type: TokenType.LPAREN, value: '(' }); i++; continue; }
    if (sql[i] === ')') { tokens.push({ type: TokenType.RPAREN, value: ')' }); i++; continue; }

    if (sql[i] === '!' && sql[i + 1] === '=') {
      tokens.push({ type: TokenType.NEQ, value: '!=' }); i += 2; continue;
    }
    if (sql[i] === '<' && sql[i + 1] === '=') {
      tokens.push({ type: TokenType.LTE, value: '<=' }); i += 2; continue;
    }
    if (sql[i] === '>' && sql[i + 1] === '=') {
      tokens.push({ type: TokenType.GTE, value: '>=' }); i += 2; continue;
    }
    if (sql[i] === '<') { tokens.push({ type: TokenType.LT, value: '<' }); i++; continue; }
    if (sql[i] === '>') { tokens.push({ type: TokenType.GT, value: '>' }); i++; continue; }
    if (sql[i] === '=') { tokens.push({ type: TokenType.EQ, value: '=' }); i++; continue; }

    // Identifier or keyword
    if (/[a-zA-Z_\u3000-\u9FFF]/.test(sql[i])) {
      let value = '';
      while (i < sql.length && /[a-zA-Z0-9_\u3000-\u9FFF]/.test(sql[i])) {
        value += sql[i];
        i++;
      }
      const upper = value.toUpperCase();
      if (KEYWORDS[upper]) {
        tokens.push({ type: KEYWORDS[upper], value: upper });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, value });
      }
      continue;
    }

    throw new Error(`Unexpected character: '${sql[i]}' at position ${i}`);
  }

  tokens.push({ type: TokenType.EOF, value: '' });
  return tokens;
}
