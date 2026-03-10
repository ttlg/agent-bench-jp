import { Token, TokenType } from './lexer';

export interface ColumnRef {
  type: 'column_ref';
  table?: string;
  column: string;
}

export interface StarColumn {
  type: 'star';
}

export interface AggregateColumn {
  type: 'aggregate';
  func: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  argument: ColumnRef | StarColumn;
}

export type SelectColumn = ColumnRef | StarColumn | AggregateColumn;

export interface TableRef {
  table: string;
  alias?: string;
}

export interface JoinClause {
  type: 'INNER' | 'LEFT';
  table: TableRef;
  condition: Expression;
}

export interface OrderByItem {
  column: ColumnRef;
  direction: 'ASC' | 'DESC';
}

export interface BinaryExpression {
  type: 'binary';
  operator: '=' | '!=' | '<' | '>' | '<=' | '>=' | 'AND' | 'OR' | 'LIKE';
  left: Expression;
  right: Expression;
}

export interface UnaryExpression {
  type: 'unary';
  operator: 'NOT';
  operand: Expression;
}

export interface LiteralExpression {
  type: 'literal';
  value: number | string;
}

export interface ColumnRefExpression {
  type: 'column_ref';
  table?: string;
  column: string;
}

export interface AggregateExpression {
  type: 'aggregate';
  func: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  argument: ColumnRefExpression | { type: 'star' };
}

export type Expression =
  | BinaryExpression
  | UnaryExpression
  | LiteralExpression
  | ColumnRefExpression
  | AggregateExpression;

export interface SelectStatement {
  type: 'select';
  columns: SelectColumn[];
  from: TableRef;
  joins: JoinClause[];
  where: Expression | null;
  groupBy: ColumnRef[];
  having: Expression | null;
  orderBy: OrderByItem[];
  limit: number | null;
  offset: number | null;
}

class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(
        `Expected ${type} but got ${token.type} ('${token.value}') at position ${token.position}`
      );
    }
    return this.advance();
  }

  private match(...types: TokenType[]): boolean {
    return types.includes(this.current().type);
  }

  parse(): SelectStatement {
    return this.parseSelect();
  }

  private parseSelect(): SelectStatement {
    this.expect(TokenType.SELECT);
    const columns = this.parseSelectColumns();
    this.expect(TokenType.FROM);
    const from = this.parseTableRef();
    const joins = this.parseJoins();

    let where: Expression | null = null;
    if (this.match(TokenType.WHERE)) {
      this.advance();
      where = this.parseExpression();
    }

    let groupBy: ColumnRef[] = [];
    if (this.match(TokenType.GROUP)) {
      this.advance();
      this.expect(TokenType.BY);
      groupBy = this.parseGroupByColumns();
    }

    let having: Expression | null = null;
    if (this.match(TokenType.HAVING)) {
      this.advance();
      having = this.parseExpression();
    }

    let orderBy: OrderByItem[] = [];
    if (this.match(TokenType.ORDER)) {
      this.advance();
      this.expect(TokenType.BY);
      orderBy = this.parseOrderBy();
    }

    let limit: number | null = null;
    if (this.match(TokenType.LIMIT)) {
      this.advance();
      limit = parseInt(this.expect(TokenType.NUMBER).value);
    }

    let offset: number | null = null;
    if (this.match(TokenType.OFFSET)) {
      this.advance();
      offset = parseInt(this.expect(TokenType.NUMBER).value);
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

  private parseSelectColumns(): SelectColumn[] {
    const columns: SelectColumn[] = [];
    columns.push(this.parseSelectColumn());
    while (this.match(TokenType.COMMA)) {
      this.advance();
      columns.push(this.parseSelectColumn());
    }
    return columns;
  }

  private parseSelectColumn(): SelectColumn {
    if (this.isAggregateFunction()) {
      return this.parseAggregateColumn();
    }
    if (this.match(TokenType.STAR)) {
      this.advance();
      return { type: 'star' };
    }
    return this.parseColumnRef();
  }

  private isAggregateFunction(): boolean {
    return this.match(
      TokenType.COUNT,
      TokenType.SUM,
      TokenType.AVG,
      TokenType.MIN,
      TokenType.MAX
    );
  }

  private parseAggregateColumn(): AggregateColumn {
    const func = this.advance().value as AggregateColumn['func'];
    this.expect(TokenType.LPAREN);

    let argument: ColumnRef | StarColumn;
    if (this.match(TokenType.STAR)) {
      this.advance();
      argument = { type: 'star' };
    } else {
      argument = this.parseColumnRef();
    }

    this.expect(TokenType.RPAREN);
    return { type: 'aggregate', func, argument };
  }

  private parseColumnRef(): ColumnRef {
    const name = this.expect(TokenType.IDENTIFIER).value;
    if (this.match(TokenType.DOT)) {
      this.advance();
      const column = this.expect(TokenType.IDENTIFIER).value;
      return { type: 'column_ref', table: name, column };
    }
    return { type: 'column_ref', column: name };
  }

  private parseTableRef(): TableRef {
    const table = this.expect(TokenType.IDENTIFIER).value;
    let alias: string | undefined;
    if (this.match(TokenType.IDENTIFIER)) {
      alias = this.advance().value;
    }
    return { table, alias };
  }

  private parseJoins(): JoinClause[] {
    const joins: JoinClause[] = [];
    while (true) {
      let joinType: 'INNER' | 'LEFT' | undefined;
      if (this.match(TokenType.JOIN)) {
        joinType = 'INNER';
        this.advance();
      } else if (this.match(TokenType.INNER)) {
        joinType = 'INNER';
        this.advance();
        this.expect(TokenType.JOIN);
      } else if (this.match(TokenType.LEFT)) {
        joinType = 'LEFT';
        this.advance();
        if (this.match(TokenType.OUTER)) {
          this.advance();
        }
        this.expect(TokenType.JOIN);
      } else {
        break;
      }
      const table = this.parseTableRef();
      this.expect(TokenType.ON);
      const condition = this.parseExpression();
      joins.push({ type: joinType, table, condition });
    }
    return joins;
  }

  private parseGroupByColumns(): ColumnRef[] {
    const columns: ColumnRef[] = [];
    columns.push(this.parseColumnRef());
    while (this.match(TokenType.COMMA)) {
      this.advance();
      columns.push(this.parseColumnRef());
    }
    return columns;
  }

  private parseOrderBy(): OrderByItem[] {
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

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.match(TokenType.OR)) {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'binary', operator: 'OR', left, right };
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNot();
    while (this.match(TokenType.AND)) {
      this.advance();
      const right = this.parseNot();
      left = { type: 'binary', operator: 'AND', left, right };
    }
    return left;
  }

  private parseNot(): Expression {
    if (this.match(TokenType.NOT)) {
      this.advance();
      const operand = this.parseNot();
      return { type: 'unary', operator: 'NOT', operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    const left = this.parsePrimary();
    if (
      this.match(
        TokenType.EQ,
        TokenType.NEQ,
        TokenType.LT,
        TokenType.GT,
        TokenType.LTE,
        TokenType.GTE,
        TokenType.LIKE
      )
    ) {
      const opToken = this.advance();
      const operatorMap: Record<string, BinaryExpression['operator']> = {
        [TokenType.EQ]: '=',
        [TokenType.NEQ]: '!=',
        [TokenType.LT]: '<',
        [TokenType.GT]: '>',
        [TokenType.LTE]: '<=',
        [TokenType.GTE]: '>=',
        [TokenType.LIKE]: 'LIKE',
      };
      const operator = operatorMap[opToken.type];
      const right = this.parsePrimary();
      return { type: 'binary', operator, left, right };
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

    if (this.isAggregateFunction()) {
      const func = this.advance().value as AggregateExpression['func'];
      this.expect(TokenType.LPAREN);
      let argument: AggregateExpression['argument'];
      if (this.match(TokenType.STAR)) {
        this.advance();
        argument = { type: 'star' };
      } else {
        const ref = this.parseColumnRef();
        argument = { type: 'column_ref', table: ref.table, column: ref.column };
      }
      this.expect(TokenType.RPAREN);
      return { type: 'aggregate', func, argument };
    }

    if (this.match(TokenType.NUMBER)) {
      const value = parseFloat(this.advance().value);
      return { type: 'literal', value };
    }

    if (this.match(TokenType.STRING)) {
      const value = this.advance().value;
      return { type: 'literal', value };
    }

    if (this.match(TokenType.IDENTIFIER)) {
      const ref = this.parseColumnRef();
      return { type: 'column_ref', table: ref.table, column: ref.column };
    }

    throw new Error(
      `Unexpected token ${this.current().type} ('${this.current().value}') at position ${this.current().position}`
    );
  }
}

export function parse(tokens: Token[]): SelectStatement {
  const parser = new Parser(tokens);
  return parser.parse();
}
