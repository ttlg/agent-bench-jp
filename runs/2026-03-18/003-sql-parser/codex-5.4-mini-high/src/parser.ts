import { tokenize, type Token } from './tokenizer.ts';
import type {
  BinaryOperator,
  Expression,
  JoinClause,
  OrderItem,
  ParsedQuery,
  SelectItem,
  TableSource,
} from './types.ts';

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(sql: string) {
    this.tokens = tokenize(sql);
  }

  parse(): ParsedQuery {
    this.expectKeyword('SELECT');
    const select = this.parseSelectList();
    this.expectKeyword('FROM');
    const from = this.parseTableSource();
    const joins = this.parseJoins();
    const where = this.matchKeyword('WHERE') ? this.parseExpression() : null;
    const groupBy = this.matchKeyword('GROUP') ? this.parseGroupBy() : [];
    const having = this.matchKeyword('HAVING') ? this.parseExpression() : null;
    const orderBy = this.matchKeyword('ORDER') ? this.parseOrderBy() : [];
    const limit = this.matchKeyword('LIMIT') ? this.parseLimitValue() : null;
    const offset = this.matchKeyword('OFFSET') ? this.parseLimitValue() : null;

    this.expect('eof');
    return { select, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    if (this.matchPunctuation('*')) {
      return [{ type: 'star' }];
    }

    while (true) {
      const expr = this.parseExpression();
      let alias: string | null = null;
      if (this.matchKeyword('AS')) {
        alias = this.expectIdentifier().value;
      }
      items.push({ type: 'expr', expr, alias });
      if (!this.matchPunctuation(',')) {
        break;
      }
    }
    return items;
  }

  private parseTableSource(): TableSource {
    const table = this.expectIdentifier().value;
    const alias = this.parseOptionalAlias();
    return { table, alias };
  }

  private parseJoins(): JoinClause[] {
    const joins: JoinClause[] = [];
    while (true) {
      const snapshot = this.index;
      let type: 'inner' | 'left' | null = null;

      if (this.matchKeyword('INNER')) {
        type = 'inner';
      } else if (this.matchKeyword('LEFT')) {
        type = 'left';
        this.matchKeyword('OUTER');
      }

      if (!this.matchKeyword('JOIN')) {
        this.index = snapshot;
        break;
      }

      if (type === null) {
        type = 'inner';
      }

      const table = this.expectIdentifier().value;
      const alias = this.parseOptionalAlias();
      this.expectKeyword('ON');
      const on = this.parseExpression();
      joins.push({ type, table, alias, on });
    }
    return joins;
  }

  private parseGroupBy(): Expression[] {
    this.expectKeyword('BY');
    const expressions: Expression[] = [];
    do {
      expressions.push(this.parseExpression());
    } while (this.matchPunctuation(','));
    return expressions;
  }

  private parseOrderBy(): OrderItem[] {
    this.expectKeyword('BY');
    const items: OrderItem[] = [];
    while (true) {
      const expr = this.parseExpression();
      let direction: 'asc' | 'desc' = 'asc';
      if (this.matchKeyword('ASC')) {
        direction = 'asc';
      } else if (this.matchKeyword('DESC')) {
        direction = 'desc';
      }
      items.push({ expr, direction });
      if (!this.matchPunctuation(',')) {
        break;
      }
    }
    return items;
  }

  private parseLimitValue(): number {
    const token = this.peek();
    if (token.type !== 'number') {
      throw new Error(`Expected numeric LIMIT/OFFSET value at position ${token.position}`);
    }
    this.index += 1;
    return Number(token.value);
  }

  private parseOptionalAlias(): string | null {
    if (this.matchKeyword('AS')) {
      return this.expectIdentifier().value;
    }
    const token = this.peek();
    if (token.type === 'identifier' && !this.isKeyword(token.value)) {
      const upper = token.value.toUpperCase();
      if (!['JOIN', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'ON', 'INNER', 'LEFT', 'OUTER'].includes(upper)) {
        this.index += 1;
        return token.value;
      }
    }
    return null;
  }

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let expr = this.parseAnd();
    while (this.matchKeyword('OR')) {
      expr = { type: 'binary', op: 'OR', left: expr, right: this.parseAnd() };
    }
    return expr;
  }

  private parseAnd(): Expression {
    let expr = this.parseNot();
    while (this.matchKeyword('AND')) {
      expr = { type: 'binary', op: 'AND', left: expr, right: this.parseNot() };
    }
    return expr;
  }

  private parseNot(): Expression {
    if (this.matchKeyword('NOT')) {
      return { type: 'unary', op: 'NOT', expr: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    let expr = this.parsePrimary();
    const token = this.peek();
    if (token.type === 'operator' && ['=', '!=', '<', '>', '<=', '>=', '<>'].includes(token.value)) {
      this.index += 1;
      const right = this.parsePrimary();
      const op = token.value === '<>' ? '!=' : (token.value as BinaryOperator);
      expr = { type: 'binary', op, left: expr, right };
    } else if (this.matchKeyword('LIKE')) {
      expr = { type: 'binary', op: 'LIKE', left: expr, right: this.parsePrimary() };
    }
    return expr;
  }

  private parsePrimary(): Expression {
    const token = this.peek();

    if (token.type === 'punctuation' && token.value === '(') {
      this.index += 1;
      const expr = this.parseExpression();
      this.expectPunctuation(')');
      return { type: 'group', expr };
    }

    if (token.type === 'punctuation' && token.value === '*') {
      this.index += 1;
      return { type: 'star' };
    }

    if (token.type === 'number') {
      this.index += 1;
      return { type: 'literal', value: token.value.includes('.') ? Number(token.value) : Number.parseInt(token.value, 10) };
    }

    if (token.type === 'string') {
      this.index += 1;
      return { type: 'literal', value: token.value };
    }

    if (token.type === 'operator' && token.value === '-') {
      this.index += 1;
      return { type: 'unary', op: '-', expr: this.parsePrimary() };
    }

    if (token.type === 'identifier') {
      const name = token.value;
      this.index += 1;
      if (this.matchPunctuation('(')) {
        const args: Expression[] = [];
        if (!this.matchPunctuation(')')) {
          do {
            args.push(this.parseExpression());
          } while (this.matchPunctuation(','));
          this.expectPunctuation(')');
        }
        return { type: 'function', name, args };
      }
      if (this.matchPunctuation('.')) {
        const column = this.expectIdentifier().value;
        return { type: 'column', table: name, column };
      }
      return { type: 'column', table: null, column: name };
    }

    throw new Error(`Unexpected token "${token.value}" at position ${token.position}`);
  }

  private expectIdentifier(): Token {
    const token = this.peek();
    if (token.type !== 'identifier') {
      throw new Error(`Expected identifier at position ${token.position}`);
    }
    this.index += 1;
    return token;
  }

  private expectPunctuation(value: string): Token {
    const token = this.peek();
    if (token.type !== 'punctuation' || token.value !== value) {
      throw new Error(`Expected "${value}" at position ${token.position}`);
    }
    this.index += 1;
    return token;
  }

  private expectKeyword(keyword: string): Token {
    const token = this.peek();
    if (!this.isKeyword(token.value, keyword)) {
      throw new Error(`Expected ${keyword} at position ${token.position}`);
    }
    this.index += 1;
    return token;
  }

  private matchKeyword(keyword: string): boolean {
    const token = this.peek();
    if (this.isKeyword(token.value, keyword)) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private matchPunctuation(value: string): boolean {
    const token = this.peek();
    if (token.type === 'punctuation' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expect(type: Token['type']): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected ${type} at position ${token.position}`);
    }
    this.index += 1;
    return token;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private isKeyword(value: string, keyword?: string): boolean {
    if (!value) {
      return false;
    }
    const upper = value.toUpperCase();
    if (keyword) {
      return upper === keyword.toUpperCase();
    }
    return [
      'SELECT',
      'FROM',
      'WHERE',
      'AND',
      'OR',
      'NOT',
      'LIKE',
      'ORDER',
      'BY',
      'LIMIT',
      'OFFSET',
      'JOIN',
      'INNER',
      'LEFT',
      'OUTER',
      'ON',
      'GROUP',
      'HAVING',
      'ASC',
      'DESC',
      'AS',
    ].includes(upper);
  }
}

export function parseQuery(sql: string): ParsedQuery {
  return new Parser(sql).parse();
}
