import { Token, TokenType } from './types';

const KEYWORDS: Record<string, TokenType> = {
  SELECT: 'SELECT', FROM: 'FROM', WHERE: 'WHERE', JOIN: 'JOIN',
  INNER: 'INNER', LEFT: 'LEFT', ON: 'ON',
  ORDER: 'ORDER', BY: 'BY', ASC: 'ASC', DESC: 'DESC',
  LIMIT: 'LIMIT', OFFSET: 'OFFSET',
  GROUP: 'GROUP', HAVING: 'HAVING',
  AND: 'AND', OR: 'OR', NOT: 'NOT', LIKE: 'LIKE'
};

export class Lexer {
  private input: string;
  private pos: number = 0;

  constructor(input: string) {
    this.input = input;
  }

  private peek(): string {
    return this.pos < this.input.length ? this.input[this.pos] : '';
  }

  private advance(): string {
    return this.pos < this.input.length ? this.input[this.pos++] : '';
  }

  private skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.peek())) {
      this.advance();
    }
  }

  private isAlpha(c: string): boolean {
    return /^[a-zA-Z_]$/.test(c);
  }

  private isAlphaNumeric(c: string): boolean {
    return /^[a-zA-Z0-9_]$/.test(c);
  }

  private isDigit(c: string): boolean {
    return /^[0-9]$/.test(c);
  }

  public nextToken(): Token {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      return { type: 'EOF', value: '' };
    }

    const c = this.peek();

    if (this.isAlpha(c)) {
      let val = '';
      while (this.pos < this.input.length && this.isAlphaNumeric(this.peek())) {
        val += this.advance();
      }
      const upperVal = val.toUpperCase();
      if (KEYWORDS[upperVal]) {
        return { type: KEYWORDS[upperVal], value: upperVal };
      }
      return { type: 'IDENTIFIER', value: val };
    }

    if (this.isDigit(c)) {
      let val = '';
      while (this.pos < this.input.length && this.isDigit(this.peek())) {
        val += this.advance();
      }
      return { type: 'NUMBER', value: val };
    }

    if (c === "'") {
      this.advance(); // skip quote
      let val = '';
      while (this.pos < this.input.length && this.peek() !== "'") {
        val += this.advance();
      }
      if (this.peek() === "'") {
        this.advance(); // skip closing quote
      }
      return { type: 'STRING', value: val };
    }

    if (c === '*') {
      this.advance();
      return { type: 'STAR', value: '*' };
    }

    if (c === ',') {
      this.advance();
      return { type: 'COMMA', value: ',' };
    }

    if (c === '.') {
      this.advance();
      return { type: 'DOT', value: '.' };
    }

    if (c === '(') {
      this.advance();
      return { type: 'LPAREN', value: '(' };
    }

    if (c === ')') {
      this.advance();
      return { type: 'RPAREN', value: ')' };
    }

    // Operators
    if (c === '=' || c === '<' || c === '>' || c === '!') {
      let val = this.advance();
      if (this.peek() === '=') {
        val += this.advance();
      }
      return { type: 'OPERATOR', value: val };
    }

    if (c === '+' || c === '-' || c === '/') {
      return { type: 'OPERATOR', value: this.advance() };
    }
    
    // Percent wildcard alone isn't used except inside strings for LIKE.

    throw new Error(`Unexpected character: ${c}`);
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    let token = this.nextToken();
    while (token.type !== 'EOF') {
      tokens.push(token);
      token = this.nextToken();
    }
    tokens.push(token);
    return tokens;
  }
}
