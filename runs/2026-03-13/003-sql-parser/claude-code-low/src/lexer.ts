export type TokenType =
  | 'SELECT' | 'FROM' | 'WHERE' | 'AND' | 'OR' | 'NOT'
  | 'ORDER' | 'BY' | 'ASC' | 'DESC' | 'LIMIT' | 'OFFSET'
  | 'JOIN' | 'INNER' | 'LEFT' | 'OUTER' | 'ON'
  | 'GROUP' | 'HAVING' | 'LIKE' | 'AS'
  | 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
  | 'STAR' | 'COMMA' | 'DOT' | 'LPAREN' | 'RPAREN'
  | 'EQ' | 'NEQ' | 'LT' | 'GT' | 'LTE' | 'GTE'
  | 'NUMBER' | 'STRING' | 'IDENTIFIER' | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
}

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT',
  'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'JOIN', 'INNER', 'LEFT', 'OUTER', 'ON',
  'GROUP', 'HAVING', 'LIKE', 'AS',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
]);

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    // Skip whitespace
    if (/\s/.test(sql[i])) { i++; continue; }

    // Single char tokens
    const charMap: Record<string, TokenType> = {
      '*': 'STAR', ',': 'COMMA', '.': 'DOT',
      '(': 'LPAREN', ')': 'RPAREN',
    };
    if (charMap[sql[i]]) {
      tokens.push({ type: charMap[sql[i]], value: sql[i] });
      i++; continue;
    }

    // Operators
    if (sql[i] === '!' && sql[i + 1] === '=') {
      tokens.push({ type: 'NEQ', value: '!=' }); i += 2; continue;
    }
    if (sql[i] === '<' && sql[i + 1] === '=') {
      tokens.push({ type: 'LTE', value: '<=' }); i += 2; continue;
    }
    if (sql[i] === '>' && sql[i + 1] === '=') {
      tokens.push({ type: 'GTE', value: '>=' }); i += 2; continue;
    }
    if (sql[i] === '<') { tokens.push({ type: 'LT', value: '<' }); i++; continue; }
    if (sql[i] === '>') { tokens.push({ type: 'GT', value: '>' }); i++; continue; }
    if (sql[i] === '=') { tokens.push({ type: 'EQ', value: '=' }); i++; continue; }

    // String literal
    if (sql[i] === "'") {
      let s = '';
      i++;
      while (i < sql.length && sql[i] !== "'") { s += sql[i]; i++; }
      i++; // closing quote
      tokens.push({ type: 'STRING', value: s });
      continue;
    }

    // Number
    if (/\d/.test(sql[i])) {
      let n = '';
      while (i < sql.length && /[\d.]/.test(sql[i])) { n += sql[i]; i++; }
      tokens.push({ type: 'NUMBER', value: n });
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_\u3000-\u9fff]/.test(sql[i])) {
      let id = '';
      while (i < sql.length && /[a-zA-Z0-9_\u3000-\u9fff]/.test(sql[i])) { id += sql[i]; i++; }
      const upper = id.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: upper as TokenType, value: id });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: id });
      }
      continue;
    }

    throw new Error(`Unexpected character: ${sql[i]} at position ${i}`);
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}
