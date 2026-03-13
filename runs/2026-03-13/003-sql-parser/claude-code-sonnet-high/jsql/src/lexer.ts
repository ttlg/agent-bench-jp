export type TokenType =
  | 'SELECT' | 'FROM' | 'WHERE' | 'AND' | 'OR' | 'NOT'
  | 'JOIN' | 'INNER' | 'LEFT' | 'OUTER' | 'ON'
  | 'ORDER' | 'BY' | 'ASC' | 'DESC'
  | 'LIMIT' | 'OFFSET'
  | 'GROUP' | 'HAVING'
  | 'LIKE'
  | 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
  | 'STAR'       // *
  | 'COMMA'      // ,
  | 'DOT'        // .
  | 'LPAREN'     // (
  | 'RPAREN'     // )
  | 'EQ'         // =
  | 'NEQ'        // !=
  | 'LT'         // <
  | 'GT'         // >
  | 'LTE'        // <=
  | 'GTE'        // >=
  | 'IDENT'      // identifier
  | 'NUMBER'     // numeric literal
  | 'STRING'     // string literal
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
}

const KEYWORDS: Record<string, TokenType> = {
  SELECT: 'SELECT', FROM: 'FROM', WHERE: 'WHERE',
  AND: 'AND', OR: 'OR', NOT: 'NOT',
  JOIN: 'JOIN', INNER: 'INNER', LEFT: 'LEFT', OUTER: 'OUTER', ON: 'ON',
  ORDER: 'ORDER', BY: 'BY', ASC: 'ASC', DESC: 'DESC',
  LIMIT: 'LIMIT', OFFSET: 'OFFSET',
  GROUP: 'GROUP', HAVING: 'HAVING',
  LIKE: 'LIKE',
  COUNT: 'COUNT', SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX',
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) { i++; continue; }

    // String literal
    if (input[i] === "'") {
      let str = '';
      i++;
      while (i < input.length && input[i] !== "'") {
        if (input[i] === '\\' && i + 1 < input.length) { i++; }
        str += input[i++];
      }
      i++; // closing quote
      tokens.push({ type: 'STRING', value: str });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(input[i]) || (input[i] === '-' && /[0-9]/.test(input[i + 1] || ''))) {
      let num = input[i++];
      while (i < input.length && /[0-9.]/.test(input[i])) num += input[i++];
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(input[i])) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) ident += input[i++];
      const upper = ident.toUpperCase();
      const kwType = KEYWORDS[upper];
      tokens.push({ type: kwType ?? 'IDENT', value: ident });
      continue;
    }

    // Operators and punctuation
    if (input[i] === '!' && input[i + 1] === '=') {
      tokens.push({ type: 'NEQ', value: '!=' }); i += 2; continue;
    }
    if (input[i] === '<' && input[i + 1] === '=') {
      tokens.push({ type: 'LTE', value: '<=' }); i += 2; continue;
    }
    if (input[i] === '>' && input[i + 1] === '=') {
      tokens.push({ type: 'GTE', value: '>=' }); i += 2; continue;
    }
    if (input[i] === '<') { tokens.push({ type: 'LT', value: '<' }); i++; continue; }
    if (input[i] === '>') { tokens.push({ type: 'GT', value: '>' }); i++; continue; }
    if (input[i] === '=') { tokens.push({ type: 'EQ', value: '=' }); i++; continue; }
    if (input[i] === '*') { tokens.push({ type: 'STAR', value: '*' }); i++; continue; }
    if (input[i] === ',') { tokens.push({ type: 'COMMA', value: ',' }); i++; continue; }
    if (input[i] === '.') { tokens.push({ type: 'DOT', value: '.' }); i++; continue; }
    if (input[i] === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (input[i] === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }

    throw new Error(`Unexpected character: '${input[i]}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}
