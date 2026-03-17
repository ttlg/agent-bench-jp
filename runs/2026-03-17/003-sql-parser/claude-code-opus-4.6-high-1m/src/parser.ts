import { tokenize } from "./tokenizer";
import {
  Token,
  TokenType,
  SelectStatement,
  SelectItem,
  ColumnRef,
  AggregateExpr,
  WhereExpr,
  JoinClause,
  OrderByItem,
} from "./types";

const AGGREGATE_FUNCS = new Set([
  TokenType.COUNT,
  TokenType.SUM,
  TokenType.AVG,
  TokenType.MIN,
  TokenType.MAX,
]);

export class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(sql: string) {
    this.tokens = tokenize(sql);
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  private expect(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new Error(
        `Expected ${type} but got ${t.type} ("${t.value}") at position ${t.position}`
      );
    }
    return this.advance();
  }

  private match(...types: TokenType[]): Token | null {
    if (types.includes(this.peek().type)) {
      return this.advance();
    }
    return null;
  }

  parse(): SelectStatement {
    return this.parseSelect();
  }

  private parseSelect(): SelectStatement {
    this.expect(TokenType.SELECT);

    const columns = this.parseSelectList();

    this.expect(TokenType.FROM);
    const from = this.parseTableRef();

    const joins = this.parseJoins();

    const where = this.peek().type === TokenType.WHERE ? this.parseWhere() : undefined;

    const groupBy = this.parseGroupBy();
    const having = this.parseHaving();
    const orderBy = this.parseOrderBy();
    const { limit, offset } = this.parseLimitOffset();

    if (this.peek().type !== TokenType.EOF) {
      throw new Error(
        `Unexpected token ${this.peek().type} ("${this.peek().value}") at position ${this.peek().position}`
      );
    }

    return {
      type: "select",
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

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];

    items.push(this.parseSelectItem());
    while (this.match(TokenType.COMMA)) {
      items.push(this.parseSelectItem());
    }

    return items;
  }

  private parseSelectItem(): SelectItem {
    // Check for aggregate function
    if (AGGREGATE_FUNCS.has(this.peek().type)) {
      return this.parseAggregate();
    }

    // Check for *
    if (this.peek().type === TokenType.STAR) {
      this.advance();
      return "*";
    }

    return this.parseColumnRef();
  }

  private parseAggregate(): AggregateExpr {
    const funcToken = this.advance();
    const func = funcToken.value as AggregateExpr["func"];

    this.expect(TokenType.LPAREN);

    let arg: ColumnRef | "*";
    if (this.peek().type === TokenType.STAR) {
      this.advance();
      arg = "*";
    } else {
      arg = this.parseColumnRef();
    }

    this.expect(TokenType.RPAREN);

    return { func, arg };
  }

  private parseColumnRef(): ColumnRef {
    const first = this.expect(TokenType.IDENTIFIER);

    if (this.match(TokenType.DOT)) {
      const second = this.expect(TokenType.IDENTIFIER);
      return { table: first.value, column: second.value };
    }

    return { column: first.value };
  }

  private parseTableRef(): { table: string; alias?: string } {
    const table = this.expect(TokenType.IDENTIFIER).value;
    let alias: string | undefined;

    if (this.match(TokenType.AS)) {
      alias = this.expect(TokenType.IDENTIFIER).value;
    } else if (
      this.peek().type === TokenType.IDENTIFIER &&
      !this.isClauseKeyword(this.peek())
    ) {
      alias = this.advance().value;
    }

    return { table, alias };
  }

  private isClauseKeyword(t: Token): boolean {
    return [
      TokenType.WHERE,
      TokenType.ORDER,
      TokenType.LIMIT,
      TokenType.OFFSET,
      TokenType.GROUP,
      TokenType.HAVING,
      TokenType.JOIN,
      TokenType.INNER,
      TokenType.LEFT,
      TokenType.ON,
    ].includes(t.type);
  }

  private parseJoins(): JoinClause[] {
    const joins: JoinClause[] = [];

    while (true) {
      let joinType: "INNER" | "LEFT" | null = null;

      if (this.match(TokenType.JOIN)) {
        joinType = "INNER";
      } else if (this.match(TokenType.INNER)) {
        this.expect(TokenType.JOIN);
        joinType = "INNER";
      } else if (this.match(TokenType.LEFT)) {
        this.match(TokenType.OUTER); // optional OUTER
        this.expect(TokenType.JOIN);
        joinType = "LEFT";
      }

      if (joinType === null) break;

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

  private parseWhere(): WhereExpr {
    this.expect(TokenType.WHERE);
    return this.parseExpression();
  }

  private parseExpression(): WhereExpr {
    return this.parseOr();
  }

  private parseOr(): WhereExpr {
    let left = this.parseAnd();

    while (this.match(TokenType.OR)) {
      const right = this.parseAnd();
      left = { type: "logical", op: "OR", left, right };
    }

    return left;
  }

  private parseAnd(): WhereExpr {
    let left = this.parseNot();

    while (this.match(TokenType.AND)) {
      const right = this.parseNot();
      left = { type: "logical", op: "AND", left, right };
    }

    return left;
  }

  private parseNot(): WhereExpr {
    if (this.match(TokenType.NOT)) {
      const expr = this.parseNot();
      return { type: "not", expr };
    }
    return this.parseComparison();
  }

  private parseComparison(): WhereExpr {
    if (this.peek().type === TokenType.LPAREN) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    const left = this.parseValue();

    if (this.match(TokenType.LIKE)) {
      const pattern = this.expect(TokenType.STRING).value;
      if (typeof left === "object" && "column" in left) {
        return { type: "like", column: left as ColumnRef, pattern };
      }
      throw new Error("LIKE can only be applied to a column reference");
    }

    const opToken = this.match(
      TokenType.EQ,
      TokenType.NEQ,
      TokenType.LT,
      TokenType.GT,
      TokenType.LTE,
      TokenType.GTE
    );

    if (!opToken) {
      throw new Error(
        `Expected comparison operator at position ${this.peek().position}, got ${this.peek().type} ("${this.peek().value}")`
      );
    }

    const right = this.parseValue();

    return {
      type: "compare",
      left: left as ColumnRef | AggregateExpr,
      op: opToken.value as "=" | "!=" | "<" | ">" | "<=" | ">=",
      right,
    };
  }

  private parseValue(): ColumnRef | AggregateExpr | string | number {
    if (AGGREGATE_FUNCS.has(this.peek().type)) {
      return this.parseAggregate();
    }

    if (this.peek().type === TokenType.STRING) {
      return this.advance().value;
    }

    if (this.peek().type === TokenType.NUMBER) {
      return Number(this.advance().value);
    }

    return this.parseColumnRef();
  }

  private parseGroupBy(): ColumnRef[] | undefined {
    if (!this.match(TokenType.GROUP)) return undefined;
    this.expect(TokenType.BY);

    const cols: ColumnRef[] = [];
    cols.push(this.parseColumnRef());
    while (this.match(TokenType.COMMA)) {
      cols.push(this.parseColumnRef());
    }
    return cols;
  }

  private parseHaving(): WhereExpr | undefined {
    if (!this.match(TokenType.HAVING)) return undefined;
    return this.parseExpression();
  }

  private parseOrderBy(): OrderByItem[] | undefined {
    if (!this.match(TokenType.ORDER)) return undefined;
    this.expect(TokenType.BY);

    const items: OrderByItem[] = [];
    items.push(this.parseOrderByItem());
    while (this.match(TokenType.COMMA)) {
      items.push(this.parseOrderByItem());
    }
    return items;
  }

  private parseOrderByItem(): OrderByItem {
    const column = this.parseColumnRef();
    let direction: "ASC" | "DESC" = "ASC";

    if (this.match(TokenType.DESC)) {
      direction = "DESC";
    } else {
      this.match(TokenType.ASC); // optional
    }

    return { column, direction };
  }

  private parseLimitOffset(): { limit?: number; offset?: number } {
    let limit: number | undefined;
    let offset: number | undefined;

    if (this.match(TokenType.LIMIT)) {
      limit = Number(this.expect(TokenType.NUMBER).value);
    }

    if (this.match(TokenType.OFFSET)) {
      offset = Number(this.expect(TokenType.NUMBER).value);
    }

    return { limit, offset };
  }
}

export function parse(sql: string): SelectStatement {
  return new Parser(sql).parse();
}
