import { Token, TokenType } from './lexer';

// AST Node types
export interface SelectColumn {
  type: 'column';
  table?: string;
  name: string;
}

export interface StarColumn {
  type: 'star';
  table?: string;
}

export interface AggregateColumn {
  type: 'aggregate';
  func: string; // COUNT, SUM, AVG, MIN, MAX
  arg: string;  // column name or '*'
  argTable?: string;
}

export type Column = SelectColumn | StarColumn | AggregateColumn;

export interface TableRef {
  name: string;
  alias?: string;
}

export interface JoinClause {
  type: 'INNER' | 'LEFT';
  table: TableRef;
  on: Expression;
}

export type Expression =
  | BinaryExpr
  | UnaryExpr
  | ColumnRef
  | LiteralExpr
  | LikeExpr;

export interface BinaryExpr {
  type: 'binary';
  op: string;
  left: Expression;
  right: Expression;
}

export interface UnaryExpr {
  type: 'unary';
  op: string;
  operand: Expression;
}

export interface ColumnRef {
  type: 'column_ref';
  table?: string;
  name: string;
}

export interface LiteralExpr {
  type: 'literal';
  value: string | number;
}

export interface LikeExpr {
  type: 'like';
  column: ColumnRef;
  pattern: string;
}

export interface OrderByItem {
  column: ColumnRef | AggregateColumn;
  direction: 'ASC' | 'DESC';
}

export interface GroupByItem {
  table?: string;
  name: string;
}

export interface SelectStatement {
  columns: Column[];
  from: TableRef;
  joins: JoinClause[];
  where?: Expression;
  groupBy?: GroupByItem[];
  having?: Expression;
  orderBy?: OrderByItem[];
  limit?: number;
  offset?: number;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] || { type: TokenType.EOF, value: '' };
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(`Expected ${type} but got ${token.type} (${token.value}) at position ${this.pos}`);
    }
    return this.advance();
  }

  private match(...types: TokenType[]): boolean {
    return types.includes(this.current().type);
  }

  parse(): SelectStatement {
    return this.parseSelect();
  }

  private isAggregateFunc(type: TokenType): boolean {
    return [TokenType.COUNT, TokenType.SUM, TokenType.AVG, TokenType.MIN, TokenType.MAX].includes(type);
  }

  private parseSelect(): SelectStatement {
    this.expect(TokenType.SELECT);

    const columns = this.parseColumns();

    this.expect(TokenType.FROM);
    const from = this.parseTableRef();

    const joins: JoinClause[] = [];
    while (this.match(TokenType.JOIN, TokenType.INNER, TokenType.LEFT)) {
      joins.push(this.parseJoin());
    }

    let where: Expression | undefined;
    if (this.match(TokenType.WHERE)) {
      this.advance();
      where = this.parseExpression();
    }

    let groupBy: GroupByItem[] | undefined;
    if (this.match(TokenType.GROUP)) {
      this.advance();
      this.expect(TokenType.BY);
      groupBy = this.parseGroupBy();
    }

    let having: Expression | undefined;
    if (this.match(TokenType.HAVING)) {
      this.advance();
      having = this.parseExpression();
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

    return { columns, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseColumns(): Column[] {
    const columns: Column[] = [];
    columns.push(this.parseColumn());
    while (this.match(TokenType.COMMA)) {
      this.advance();
      columns.push(this.parseColumn());
    }
    return columns;
  }

  private parseColumn(): Column {
    // Aggregate function
    if (this.isAggregateFunc(this.current().type)) {
      return this.parseAggregateColumn();
    }

    // Star
    if (this.match(TokenType.STAR)) {
      this.advance();
      return { type: 'star' };
    }

    // table.* or table.column or column
    const id = this.expect(TokenType.IDENTIFIER);
    if (this.match(TokenType.DOT)) {
      this.advance();
      if (this.match(TokenType.STAR)) {
        this.advance();
        return { type: 'star', table: id.value };
      }
      const col = this.expect(TokenType.IDENTIFIER);
      return { type: 'column', table: id.value, name: col.value };
    }
    return { type: 'column', name: id.value };
  }

  private parseAggregateColumn(): AggregateColumn {
    const func = this.advance().value;
    this.expect(TokenType.LPAREN);
    let arg: string;
    let argTable: string | undefined;
    if (this.match(TokenType.STAR)) {
      this.advance();
      arg = '*';
    } else {
      const id = this.expect(TokenType.IDENTIFIER);
      if (this.match(TokenType.DOT)) {
        this.advance();
        argTable = id.value;
        arg = this.expect(TokenType.IDENTIFIER).value;
      } else {
        arg = id.value;
      }
    }
    this.expect(TokenType.RPAREN);
    return { type: 'aggregate', func, arg, argTable };
  }

  private parseTableRef(): TableRef {
    const name = this.expect(TokenType.IDENTIFIER).value;
    let alias: string | undefined;
    if (this.match(TokenType.IDENTIFIER)) {
      alias = this.advance().value;
    } else if (this.match(TokenType.AS)) {
      this.advance();
      alias = this.expect(TokenType.IDENTIFIER).value;
    }
    return { name, alias };
  }

  private parseJoin(): JoinClause {
    let joinType: 'INNER' | 'LEFT' = 'INNER';
    if (this.match(TokenType.LEFT)) {
      joinType = 'LEFT';
      this.advance();
      if (this.match(TokenType.OUTER)) this.advance();
    } else if (this.match(TokenType.INNER)) {
      this.advance();
    }
    this.expect(TokenType.JOIN);
    const table = this.parseTableRef();
    this.expect(TokenType.ON);
    const on = this.parseExpression();
    return { type: joinType, table, on };
  }

  private parseGroupBy(): GroupByItem[] {
    const items: GroupByItem[] = [];
    const parseOne = (): GroupByItem => {
      const id = this.expect(TokenType.IDENTIFIER);
      if (this.match(TokenType.DOT)) {
        this.advance();
        const col = this.expect(TokenType.IDENTIFIER);
        return { table: id.value, name: col.value };
      }
      return { name: id.value };
    };
    items.push(parseOne());
    while (this.match(TokenType.COMMA)) {
      this.advance();
      items.push(parseOne());
    }
    return items;
  }

  private parseOrderBy(): OrderByItem[] {
    const items: OrderByItem[] = [];
    const parseOne = (): OrderByItem => {
      let column: ColumnRef | AggregateColumn;
      if (this.isAggregateFunc(this.current().type)) {
        column = this.parseAggregateColumn();
      } else {
        const id = this.expect(TokenType.IDENTIFIER);
        if (this.match(TokenType.DOT)) {
          this.advance();
          const col = this.expect(TokenType.IDENTIFIER);
          column = { type: 'column_ref', table: id.value, name: col.value };
        } else {
          column = { type: 'column_ref', name: id.value };
        }
      }
      let direction: 'ASC' | 'DESC' = 'ASC';
      if (this.match(TokenType.ASC)) {
        this.advance();
      } else if (this.match(TokenType.DESC)) {
        this.advance();
        direction = 'DESC';
      }
      return { column, direction };
    };
    items.push(parseOne());
    while (this.match(TokenType.COMMA)) {
      this.advance();
      items.push(parseOne());
    }
    return items;
  }

  // Expression parsing with precedence: OR < AND < NOT < comparison
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
      const operand = this.parseNot();
      return { type: 'unary', op: 'NOT', operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    const left = this.parsePrimary();

    if (this.match(TokenType.LIKE)) {
      this.advance();
      const pattern = this.expect(TokenType.STRING).value;
      if (left.type !== 'column_ref') {
        throw new Error('LIKE operator requires a column reference on the left');
      }
      return { type: 'like', column: left, pattern };
    }

    const opMap: Record<string, string> = {
      [TokenType.EQ]: '=',
      [TokenType.NEQ]: '!=',
      [TokenType.LT]: '<',
      [TokenType.GT]: '>',
      [TokenType.LTE]: '<=',
      [TokenType.GTE]: '>=',
    };

    if (this.current().type in opMap) {
      const op = opMap[this.current().type];
      this.advance();
      const right = this.parsePrimary();
      return { type: 'binary', op, left, right };
    }

    return left;
  }

  private parsePrimary(): Expression {
    // Parenthesized expression
    if (this.match(TokenType.LPAREN)) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    // Aggregate in expression (for HAVING)
    if (this.isAggregateFunc(this.current().type)) {
      const agg = this.parseAggregateColumn();
      // Wrap aggregate as a special column_ref for evaluation
      return {
        type: 'column_ref',
        name: `__agg__${agg.func}__${agg.arg}`,
      };
    }

    // Number literal
    if (this.match(TokenType.NUMBER)) {
      const val = this.advance().value;
      return { type: 'literal', value: Number(val) };
    }

    // String literal
    if (this.match(TokenType.STRING)) {
      const val = this.advance().value;
      return { type: 'literal', value: val };
    }

    // Identifier (column ref)
    if (this.match(TokenType.IDENTIFIER)) {
      const id = this.advance();
      if (this.match(TokenType.DOT)) {
        this.advance();
        const col = this.expect(TokenType.IDENTIFIER);
        return { type: 'column_ref', table: id.value, name: col.value };
      }
      return { type: 'column_ref', name: id.value };
    }

    throw new Error(`Unexpected token: ${this.current().type} (${this.current().value}) at position ${this.pos}`);
  }
}

export function parse(tokens: Token[]): SelectStatement {
  const parser = new Parser(tokens);
  return parser.parse();
}
