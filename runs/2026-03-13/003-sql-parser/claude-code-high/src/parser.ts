import { Token, TokenType } from './tokenizer';
import {
  SelectStatement,
  SelectItem,
  ColumnRef,
  WhereExpr,
  CompareOp,
  JoinClause,
  OrderByItem,
  AggregateFn,
  CompareExpr,
} from './ast';

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
      throw new Error(`Expected ${type} but got ${token.type} ('${token.value}') at position ${token.position}`);
    }
    return this.advance();
  }

  private match(...types: TokenType[]): boolean {
    return types.includes(this.peek().type);
  }

  parse(): SelectStatement {
    return this.parseSelect();
  }

  private parseSelect(): SelectStatement {
    this.expect(TokenType.SELECT);

    const columns = this.parseSelectItems();

    this.expect(TokenType.FROM);
    const from = this.parseTableRef();

    const joins = this.parseJoins();

    let where: WhereExpr | undefined;
    if (this.match(TokenType.WHERE)) {
      this.advance();
      where = this.parseWhereExpr();
    }

    let groupBy: ColumnRef[] | undefined;
    if (this.match(TokenType.GROUP)) {
      this.advance();
      this.expect(TokenType.BY);
      groupBy = this.parseGroupByColumns();
    }

    let having: WhereExpr | undefined;
    if (this.match(TokenType.HAVING)) {
      this.advance();
      having = this.parseWhereExpr();
    }

    let orderBy: OrderByItem[] | undefined;
    if (this.match(TokenType.ORDER)) {
      this.advance();
      this.expect(TokenType.BY);
      orderBy = this.parseOrderBy();
    }

    let limit: number | undefined;
    if (this.match(TokenType.LIMIT)) {
      this.advance();
      limit = Number(this.expect(TokenType.NUMBER).value);
    }

    let offset: number | undefined;
    if (this.match(TokenType.OFFSET)) {
      this.advance();
      offset = Number(this.expect(TokenType.NUMBER).value);
    }

    return {
      type: 'select',
      columns,
      from,
      joins,
      where,
      groupBy,
      having,
      orderBy,
      limit,
      offset,
    };
  }

  private parseSelectItems(): SelectItem[] {
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
    if (this.isAggregate()) {
      return this.parseAggregate();
    }

    if (this.match(TokenType.STAR)) {
      this.advance();
      return { type: 'star' };
    }

    return this.parseColumnRef();
  }

  private isAggregate(): boolean {
    return this.match(TokenType.COUNT, TokenType.SUM, TokenType.AVG, TokenType.MIN, TokenType.MAX);
  }

  private parseAggregate(): AggregateFn {
    const fn = this.advance().value as AggregateFn['fn'];
    this.expect(TokenType.LPAREN);

    let arg: AggregateFn['arg'];
    if (this.match(TokenType.STAR)) {
      this.advance();
      arg = { type: 'star' };
    } else {
      arg = this.parseColumnRef();
    }

    this.expect(TokenType.RPAREN);

    return { type: 'aggregate', fn, arg };
  }

  private parseColumnRef(): ColumnRef {
    const name = this.expect(TokenType.IDENTIFIER).value;

    if (this.match(TokenType.DOT)) {
      this.advance();
      // table.column
      if (this.match(TokenType.STAR)) {
        this.advance();
        return { type: 'column_ref', table: name, column: '*' };
      }
      const col = this.expect(TokenType.IDENTIFIER).value;
      return { type: 'column_ref', table: name, column: col };
    }

    return { type: 'column_ref', column: name };
  }

  private parseTableRef(): { table: string; alias?: string } {
    const table = this.expect(TokenType.IDENTIFIER).value;
    let alias: string | undefined;

    if (this.match(TokenType.AS)) {
      this.advance();
      alias = this.expect(TokenType.IDENTIFIER).value;
    } else if (this.match(TokenType.IDENTIFIER)) {
      // implicit alias
      alias = this.advance().value;
    }

    return { table, alias };
  }

  private parseJoins(): JoinClause[] {
    const joins: JoinClause[] = [];

    while (this.match(TokenType.JOIN, TokenType.INNER, TokenType.LEFT)) {
      let joinType: 'INNER' | 'LEFT' = 'INNER';

      if (this.match(TokenType.LEFT)) {
        joinType = 'LEFT';
        this.advance();
        if (this.match(TokenType.OUTER)) {
          this.advance();
        }
        this.expect(TokenType.JOIN);
      } else if (this.match(TokenType.INNER)) {
        this.advance();
        this.expect(TokenType.JOIN);
      } else {
        // Just JOIN
        this.advance();
      }

      const tableRef = this.parseTableRef();
      this.expect(TokenType.ON);

      const on = this.parseJoinCondition();

      joins.push({
        type: joinType,
        table: tableRef.table,
        alias: tableRef.alias,
        on,
      });
    }

    return joins;
  }

  private parseJoinCondition(): CompareExpr {
    const left = this.parseColumnRef();
    const op = this.parseCompareOp();
    const right = this.parseColumnRef();

    return {
      type: 'compare',
      left,
      op,
      right,
    };
  }

  private parseWhereExpr(): WhereExpr {
    return this.parseOrExpr();
  }

  private parseOrExpr(): WhereExpr {
    let left = this.parseAndExpr();

    while (this.match(TokenType.OR)) {
      this.advance();
      const right = this.parseAndExpr();
      left = { type: 'or', left, right };
    }

    return left;
  }

  private parseAndExpr(): WhereExpr {
    let left = this.parseNotExpr();

    while (this.match(TokenType.AND)) {
      this.advance();
      const right = this.parseNotExpr();
      left = { type: 'and', left, right };
    }

    return left;
  }

  private parseNotExpr(): WhereExpr {
    if (this.match(TokenType.NOT)) {
      this.advance();
      const expr = this.parseNotExpr();
      return { type: 'not', expr };
    }

    return this.parsePrimaryExpr();
  }

  private parsePrimaryExpr(): WhereExpr {
    // Parenthesized expression
    if (this.match(TokenType.LPAREN)) {
      this.advance();
      const expr = this.parseWhereExpr();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    // Aggregate in HAVING
    if (this.isAggregate()) {
      const agg = this.parseAggregate();
      const op = this.parseCompareOp();
      const right = this.parseLiteral();
      return { type: 'compare', left: agg, op, right };
    }

    // Column comparison or LIKE
    const left = this.parseColumnRef();

    if (this.match(TokenType.LIKE)) {
      this.advance();
      const pattern = this.expect(TokenType.STRING).value;
      return { type: 'like', left, pattern };
    }

    const op = this.parseCompareOp();
    const right = this.parseValue();

    return { type: 'compare', left, op, right };
  }

  private parseCompareOp(): CompareOp {
    const token = this.peek();
    switch (token.type) {
      case TokenType.EQ:
        this.advance();
        return '=';
      case TokenType.NEQ:
        this.advance();
        return '!=';
      case TokenType.LT:
        this.advance();
        return '<';
      case TokenType.GT:
        this.advance();
        return '>';
      case TokenType.LTE:
        this.advance();
        return '<=';
      case TokenType.GTE:
        this.advance();
        return '>=';
      default:
        throw new Error(`Expected comparison operator but got ${token.type} at position ${token.position}`);
    }
  }

  private parseLiteral() {
    const token = this.peek();
    if (token.type === TokenType.NUMBER) {
      this.advance();
      return { type: 'number' as const, value: Number(token.value) };
    }
    if (token.type === TokenType.STRING) {
      this.advance();
      return { type: 'string' as const, value: token.value };
    }
    throw new Error(`Expected literal but got ${token.type} at position ${token.position}`);
  }

  private parseValue() {
    const token = this.peek();
    if (token.type === TokenType.NUMBER) {
      this.advance();
      return { type: 'number' as const, value: Number(token.value) };
    }
    if (token.type === TokenType.STRING) {
      this.advance();
      return { type: 'string' as const, value: token.value };
    }
    // Could be a column reference
    return this.parseColumnRef();
  }

  private parseGroupByColumns(): ColumnRef[] {
    const cols: ColumnRef[] = [];
    cols.push(this.parseColumnRef());
    while (this.match(TokenType.COMMA)) {
      this.advance();
      cols.push(this.parseColumnRef());
    }
    return cols;
  }

  private parseOrderBy(): OrderByItem[] {
    const items: OrderByItem[] = [];

    const col = this.parseColumnRef();
    let direction: 'ASC' | 'DESC' = 'ASC';
    if (this.match(TokenType.ASC)) {
      this.advance();
    } else if (this.match(TokenType.DESC)) {
      this.advance();
      direction = 'DESC';
    }
    items.push({ column: col, direction });

    while (this.match(TokenType.COMMA)) {
      this.advance();
      const c = this.parseColumnRef();
      let dir: 'ASC' | 'DESC' = 'ASC';
      if (this.match(TokenType.ASC)) {
        this.advance();
      } else if (this.match(TokenType.DESC)) {
        this.advance();
        dir = 'DESC';
      }
      items.push({ column: c, direction: dir });
    }

    return items;
  }
}
