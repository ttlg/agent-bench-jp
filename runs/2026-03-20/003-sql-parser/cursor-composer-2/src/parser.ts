import type {
  BinaryOp,
  Expr,
  JoinClause,
  OrderClause,
  Query,
  SelectItem,
} from "./ast.js";
import type { Keyword, Token } from "./lexer.js";

export class ParseError extends Error {
  constructor(
    message: string,
    public offset: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export class Parser {
  private i = 0;

  constructor(private readonly tokens: Token[]) {}

  private cur(): Token {
    return this.tokens[this.i] ?? { kind: "eof" };
  }

  private advance(): Token {
    const t = this.cur();
    if (this.i < this.tokens.length) this.i++;
    return t;
  }

  private matchKeyword(kw: Keyword): boolean {
    const t = this.cur();
    if (t.kind === "keyword" && t.value === kw) {
      this.advance();
      return true;
    }
    return false;
  }

  private expectKeyword(kw: Keyword): void {
    const t = this.cur();
    if (t.kind !== "keyword" || t.value !== kw) {
      throw new ParseError(`Expected keyword '${kw}'`, this.i);
    }
    this.advance();
  }

  private match(kind: Token["kind"]): boolean {
    const t = this.cur();
    if (t.kind === kind) {
      this.advance();
      return true;
    }
    return false;
  }

  parseQuery(): Query {
    this.expectKeyword("select");
    const select = this.parseSelectList();
    this.expectKeyword("from");
    const from = this.parseTableRef();
    const joins = this.parseJoins();

    let where: Expr | undefined;
    if (this.matchKeyword("where")) where = this.parseExpr();

    const groupBy: Expr[] = [];
    if (this.matchKeyword("group")) {
      this.expectKeyword("by");
      groupBy.push(...this.parseExprList());
    }

    let having: Expr | undefined;
    if (this.matchKeyword("having")) having = this.parseExpr();

    const orderBy: OrderClause[] = [];
    if (this.matchKeyword("order")) {
      this.expectKeyword("by");
      orderBy.push(...this.parseOrderList());
    }

    let limit: number | undefined;
    let offset: number | undefined;
    if (this.matchKeyword("limit")) {
      limit = this.expectNumber();
      if (this.matchKeyword("offset")) offset = this.expectNumber();
    }

    const t = this.cur();
    if (t.kind !== "eof") {
      throw new ParseError(`Unexpected token after query`, this.i);
    }

    return { select, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseTableRef(): { table: string; alias?: string } {
    const table = this.expectIdentText();
    let alias: string | undefined;
    if (this.matchKeyword("as")) {
      alias = this.expectIdentText();
    } else if (this.cur().kind === "ident") {
      const next = this.cur() as { kind: "ident"; value: string };
      const lower = next.value.toLowerCase();
      const reserved = new Set([
        "where",
        "join",
        "inner",
        "left",
        "order",
        "group",
        "limit",
        "offset",
        "on",
      ]);
      if (!reserved.has(lower)) {
        alias = this.expectIdentText();
      }
    }
    return { table, alias };
  }

  private parseJoins(): JoinClause[] {
    const joins: JoinClause[] = [];
    while (true) {
      let joinType: "inner" | "left" = "inner";
      if (this.matchKeyword("left")) {
        this.matchKeyword("outer");
        this.expectKeyword("join");
        joinType = "left";
      } else if (this.matchKeyword("inner")) {
        this.expectKeyword("join");
        joinType = "inner";
      } else if (this.matchKeyword("join")) {
        joinType = "inner";
      } else {
        break;
      }
      const { table, alias } = this.parseTableRef();
      this.expectKeyword("on");
      const on = this.parseExpr();
      joins.push({ joinType, table, alias, on });
    }
    return joins;
  }

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    items.push(this.parseSelectItem());
    while (this.match("comma")) {
      items.push(this.parseSelectItem());
    }
    return items;
  }

  private parseSelectItem(): SelectItem {
    if (this.match("star")) {
      return { type: "star" };
    }
    const t = this.cur();
    if (t.kind === "ident") {
      const id = t.value;
      this.advance();
      if (this.match("dot")) {
        if (this.match("star")) {
          return { type: "star", table: id };
        }
        const name = this.expectIdentText();
        const expr: Expr = { type: "column", table: id, name };
        return this.finishSelectExpr(expr);
      }
      const expr: Expr = { type: "column", name: id };
      return this.finishSelectExpr(expr);
    }
    if (t.kind === "keyword") {
      const agg = ["count", "sum", "avg", "min", "max"].includes(t.value);
      if (agg) {
        const expr = this.parsePrimary();
        return this.finishSelectExpr(expr);
      }
    }
    const expr = this.parseExpr();
    return this.finishSelectExpr(expr);
  }

  private finishSelectExpr(expr: Expr): SelectItem {
    if (this.matchKeyword("as")) {
      const alias = this.expectIdentText();
      return { type: "expr", expr, alias };
    }
    if (this.cur().kind === "ident") {
      const next = this.cur() as { value: string };
      const reserved = new Set([
        "from",
        "where",
        "join",
        "inner",
        "left",
        "on",
        "group",
        "order",
        "by",
        "limit",
        "offset",
        "having",
        "and",
        "or",
      ]);
      if (!reserved.has(next.value.toLowerCase())) {
        const alias = this.expectIdentText();
        return { type: "expr", expr, alias };
      }
    }
    return { type: "expr", expr };
  }

  private parseOrderList(): OrderClause[] {
    const list: OrderClause[] = [];
    list.push(this.parseOrderClause());
    while (this.match("comma")) {
      list.push(this.parseOrderClause());
    }
    return list;
  }

  private parseOrderClause(): OrderClause {
    const expr = this.parseExpr();
    let direction: "asc" | "desc" = "asc";
    if (this.matchKeyword("asc")) direction = "asc";
    else if (this.matchKeyword("desc")) direction = "desc";
    return { expr, direction };
  }

  private parseExprList(): Expr[] {
    const list: Expr[] = [this.parseExpr()];
    while (this.match("comma")) {
      list.push(this.parseExpr());
    }
    return list;
  }

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.matchKeyword("or")) {
      const right = this.parseAnd();
      left = { type: "binary", op: "or", left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.matchKeyword("and")) {
      const right = this.parseNot();
      left = { type: "binary", op: "and", left, right };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.matchKeyword("not")) {
      return { type: "unary", op: "not", expr: this.parseNot() };
    }
    return this.parseCmp();
  }

  private parseCmp(): Expr {
    let left = this.parsePrimary();
    const op = this.tryComparisonOp();
    if (op) {
      const right = this.parsePrimary();
      return { type: "binary", op, left, right };
    }
    return left;
  }

  private tryComparisonOp(): BinaryOp | null {
    const t = this.cur();
    if (t.kind === "eq") {
      this.advance();
      return "=";
    }
    if (t.kind === "neq") {
      this.advance();
      return "!=";
    }
    if (t.kind === "lt") {
      this.advance();
      return "<";
    }
    if (t.kind === "gt") {
      this.advance();
      return ">";
    }
    if (t.kind === "lte") {
      this.advance();
      return "<=";
    }
    if (t.kind === "gte") {
      this.advance();
      return ">=";
    }
    if (t.kind === "keyword" && t.value === "like") {
      this.advance();
      return "like";
    }
    return null;
  }

  private parsePrimary(): Expr {
    const t = this.cur();
    if (t.kind === "number") {
      this.advance();
      return { type: "literal", value: t.value };
    }
    if (t.kind === "string") {
      this.advance();
      return { type: "literal", value: t.value };
    }
    if (t.kind === "lparen") {
      this.advance();
      const inner = this.parseExpr();
      if (!this.match("rparen")) throw new ParseError("Expected ')'", this.i);
      return inner;
    }
    if (t.kind === "keyword") {
      const agg = ["count", "sum", "avg", "min", "max"].includes(t.value);
      if (agg) {
        const name = t.value;
        this.advance();
        if (!this.match("lparen")) throw new ParseError("Expected '(' after aggregate", this.i);
        let starArg = false;
        const args: Expr[] = [];
        if (this.match("star")) {
          starArg = true;
          if (name !== "count") {
            throw new ParseError("STAR argument only allowed for COUNT", this.i);
          }
        } else {
          args.push(this.parseExpr());
          while (this.match("comma")) {
            args.push(this.parseExpr());
          }
        }
        if (!this.match("rparen")) throw new ParseError("Expected ')'", this.i);
        return { type: "call", name, args, starArg };
      }
    }
    if (t.kind === "ident") {
      const id = t.value;
      this.advance();
      if (this.match("dot")) {
        const name = this.expectIdentText();
        return { type: "column", table: id, name };
      }
      return { type: "column", name: id };
    }
    throw new ParseError(`Unexpected token in expression`, this.i);
  }

  private expectIdentText(): string {
    const t = this.cur();
    if (t.kind === "ident") {
      this.advance();
      return t.value;
    }
    if (t.kind === "keyword") {
      this.advance();
      return t.value;
    }
    throw new ParseError("Expected identifier", this.i);
  }

  private expectNumber(): number {
    const t = this.cur();
    if (t.kind === "number") {
      this.advance();
      return t.value;
    }
    throw new ParseError("Expected number", this.i);
  }
}

export function parseQuery(tokens: Token[]): Query {
  return new Parser(tokens).parseQuery();
}
