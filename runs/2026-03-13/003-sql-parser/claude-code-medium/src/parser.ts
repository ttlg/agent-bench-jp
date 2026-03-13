import { Token, TokenType } from './tokenizer';

// AST node types
export interface ColumnRef {
  table?: string;
  column: string;
  alias?: string;
}

export interface FunctionCall {
  name: string; // COUNT, SUM, AVG, MIN, MAX
  arg: string;  // column name or '*'
  argTable?: string;
}

export type SelectItem = ColumnRef | FunctionCall | { star: true };

export interface JoinClause {
  type: 'INNER' | 'LEFT';
  table: string;
  alias?: string;
  on: Expression;
}

export type Expression =
  | { type: 'binary'; op: string; left: Expression; right: Expression }
  | { type: 'not'; expr: Expression }
  | { type: 'column'; table?: string; column: string }
  | { type: 'literal'; value: string | number }
  | { type: 'like'; left: Expression; pattern: string };

export interface OrderByItem {
  column: ColumnRef;
  direction: 'ASC' | 'DESC';
}

export interface SelectStatement {
  columns: SelectItem[];
  from: { table: string; alias?: string };
  joins: JoinClause[];
  where?: Expression;
  groupBy?: ColumnRef[];
  having?: Expression;
  orderBy?: OrderByItem[];
  limit?: number;
  offset?: number;
}

function isFunctionCall(item: SelectItem): item is FunctionCall {
  return 'name' in item;
}

export { isFunctionCall };

function isColumnRef(item: SelectItem): item is ColumnRef {
  return 'column' in item && !('name' in item);
}

export { isColumnRef };

function isStar(item: SelectItem): item is { star: true } {
  return 'star' in item;
}

export { isStar };

export class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected ${type} but got ${token.type} ('${token.value}') at position ${this.pos}`);
    }
    return this.advance();
  }

  private match(...types: TokenType[]): boolean {
    return types.includes(this.peek().type);
  }

  parse(): SelectStatement {
    this.expect(TokenType.SELECT);
    const columns = this.parseSelectList();
    this.expect(TokenType.FROM);
    const from = this.parseTableRef();
    const joins = this.parseJoins();
    const where = this.parseWhere();
    const groupBy = this.parseGroupBy();
    const having = this.parseHaving();
    const orderBy = this.parseOrderBy();
    const { limit, offset } = this.parseLimitOffset();

    return { columns, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    items.push(this.parseSelectItem());
    while (this.match(TokenType.COMMA)) {
      this.advance();
      items.push(this.parseSelectItem());
    }
    return items;
  }

  private parseSelectItem(): SelectItem {
    // Check for aggregate functions
    if (this.match(TokenType.IDENTIFIER) && this.isAggregateFunction(this.peek().value)) {
      const name = this.advance().value.toUpperCase();
      this.expect(TokenType.LPAREN);
      let arg: string;
      let argTable: string | undefined;
      if (this.match(TokenType.STAR)) {
        this.advance();
        arg = '*';
      } else {
        const ident = this.expect(TokenType.IDENTIFIER);
        if (this.match(TokenType.DOT)) {
          this.advance();
          argTable = ident.value;
          arg = this.expect(TokenType.IDENTIFIER).value;
        } else {
          arg = ident.value;
        }
      }
      this.expect(TokenType.RPAREN);
      const result: FunctionCall = { name, arg };
      if (argTable) result.argTable = argTable;
      return result;
    }

    if (this.match(TokenType.STAR)) {
      this.advance();
      return { star: true };
    }

    return this.parseColumnRef();
  }

  private isAggregateFunction(name: string): boolean {
    return ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(name.toUpperCase());
  }

  private parseColumnRef(): ColumnRef {
    const ident = this.expect(TokenType.IDENTIFIER);
    if (this.match(TokenType.DOT)) {
      this.advance();
      const col = this.expect(TokenType.IDENTIFIER);
      return { table: ident.value, column: col.value };
    }
    return { column: ident.value };
  }

  private parseTableRef(): { table: string; alias?: string } {
    const table = this.expect(TokenType.IDENTIFIER).value;
    let alias: string | undefined;
    if (this.match(TokenType.IDENTIFIER)) {
      alias = this.advance().value;
    } else if (this.match(TokenType.AS)) {
      this.advance();
      alias = this.expect(TokenType.IDENTIFIER).value;
    }
    return { table, alias };
  }

  private parseJoins(): JoinClause[] {
    const joins: JoinClause[] = [];
    while (this.match(TokenType.JOIN, TokenType.INNER, TokenType.LEFT)) {
      let joinType: 'INNER' | 'LEFT' = 'INNER';
      if (this.match(TokenType.LEFT)) {
        this.advance();
        joinType = 'LEFT';
        if (this.match(TokenType.OUTER)) this.advance();
      } else if (this.match(TokenType.INNER)) {
        this.advance();
      }
      this.expect(TokenType.JOIN);
      const tableRef = this.parseTableRef();
      this.expect(TokenType.ON);
      const on = this.parseExpression();
      joins.push({
        type: joinType,
        table: tableRef.table,
        alias: tableRef.alias,
        on,
      });
    }
    return joins;
  }

  private parseWhere(): Expression | undefined {
    if (!this.match(TokenType.WHERE)) return undefined;
    this.advance();
    return this.parseExpression();
  }

  private parseGroupBy(): ColumnRef[] | undefined {
    if (!this.match(TokenType.GROUP)) return undefined;
    this.advance();
    this.expect(TokenType.BY);
    const cols: ColumnRef[] = [];
    cols.push(this.parseColumnRef());
    while (this.match(TokenType.COMMA)) {
      this.advance();
      cols.push(this.parseColumnRef());
    }
    return cols;
  }

  private parseHaving(): Expression | undefined {
    if (!this.match(TokenType.HAVING)) return undefined;
    this.advance();
    return this.parseExpression();
  }

  private parseOrderBy(): OrderByItem[] | undefined {
    if (!this.match(TokenType.ORDER)) return undefined;
    this.advance();
    this.expect(TokenType.BY);
    const items: OrderByItem[] = [];
    items.push(this.parseOrderByItem());
    while (this.match(TokenType.COMMA)) {
      this.advance();
      items.push(this.parseOrderByItem());
    }
    return items;
  }

  private parseOrderByItem(): OrderByItem {
    const column = this.parseColumnRef();
    let direction: 'ASC' | 'DESC' = 'ASC';
    if (this.match(TokenType.ASC)) {
      this.advance();
    } else if (this.match(TokenType.DESC)) {
      this.advance();
      direction = 'DESC';
    }
    return { column, direction };
  }

  private parseLimitOffset(): { limit?: number; offset?: number } {
    let limit: number | undefined;
    let offset: number | undefined;
    if (this.match(TokenType.LIMIT)) {
      this.advance();
      limit = parseInt(this.expect(TokenType.NUMBER).value, 10);
    }
    if (this.match(TokenType.OFFSET)) {
      this.advance();
      offset = parseInt(this.expect(TokenType.NUMBER).value, 10);
    }
    return { limit, offset };
  }

  // Expression parsing with precedence
  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.match(TokenType.OR)) {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'binary', op: 'OR', left, right };
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNot();
    while (this.match(TokenType.AND)) {
      this.advance();
      const right = this.parseNot();
      left = { type: 'binary', op: 'AND', left, right };
    }
    return left;
  }

  private parseNot(): Expression {
    if (this.match(TokenType.NOT)) {
      this.advance();
      const expr = this.parseNot();
      return { type: 'not', expr };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    const left = this.parsePrimary();

    if (this.match(TokenType.LIKE)) {
      this.advance();
      const pattern = this.expect(TokenType.STRING).value;
      return { type: 'like', left, pattern };
    }

    const opMap: Record<string, string> = {
      [TokenType.EQ]: '=',
      [TokenType.NEQ]: '!=',
      [TokenType.LT]: '<',
      [TokenType.GT]: '>',
      [TokenType.LTE]: '<=',
      [TokenType.GTE]: '>=',
    };

    if (this.peek().type in opMap) {
      const op = opMap[this.advance().type];
      const right = this.parsePrimary();
      return { type: 'binary', op, left, right };
    }

    return left;
  }

  private parsePrimary(): Expression {
    if (this.match(TokenType.LPAREN)) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    if (this.match(TokenType.NUMBER)) {
      const value = parseFloat(this.advance().value);
      return { type: 'literal', value };
    }

    if (this.match(TokenType.STRING)) {
      return { type: 'literal', value: this.advance().value };
    }

    // Check for aggregate function in expression (for HAVING)
    if (this.match(TokenType.IDENTIFIER) && this.isAggregateFunction(this.peek().value)) {
      const name = this.advance().value.toUpperCase();
      this.expect(TokenType.LPAREN);
      let arg: string;
      if (this.match(TokenType.STAR)) {
        this.advance();
        arg = '*';
      } else {
        arg = this.expect(TokenType.IDENTIFIER).value;
      }
      this.expect(TokenType.RPAREN);
      // Represent as a special column reference
      return { type: 'column', column: `__agg_${name}_${arg}` };
    }

    if (this.match(TokenType.IDENTIFIER)) {
      const ident = this.advance();
      if (this.match(TokenType.DOT)) {
        this.advance();
        const col = this.expect(TokenType.IDENTIFIER);
        return { type: 'column', table: ident.value, column: col.value };
      }
      return { type: 'column', column: ident.value };
    }

    throw new Error(`Unexpected token: ${this.peek().type} ('${this.peek().value}')`);
  }
}
