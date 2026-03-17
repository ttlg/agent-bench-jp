import { tokenize, type Token } from "./tokenizer.ts";
import type { Expression, QueryAst, SelectItem, TableRef } from "./types.ts";

const AGGREGATES = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

export function parseSql(sql: string): QueryAst {
  const tokens = tokenize(sql);
  const parser = new Parser(tokens);
  return parser.parseQuery();
}

class Parser {
  private index = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseQuery(): QueryAst {
    this.expectKeyword("SELECT");
    const select = this.parseSelectList();
    this.expectKeyword("FROM");
    const from = this.parseTableRef();
    const joins = [];
    while (this.matchKeyword("INNER") || this.matchKeyword("LEFT") || this.matchKeyword("JOIN")) {
      let kind: "INNER" | "LEFT" = "INNER";
      if (this.previousUpper() === "LEFT") {
        kind = "LEFT";
        this.expectKeyword("JOIN");
      } else if (this.previousUpper() === "INNER") {
        this.expectKeyword("JOIN");
      }
      const table = this.parseTableRef();
      this.expectKeyword("ON");
      const on = this.parseExpression();
      joins.push({ kind, table, on });
    }

    const where = this.matchKeyword("WHERE") ? this.parseExpression() : undefined;
    const groupBy = this.matchKeyword("GROUP")
      ? (this.expectKeyword("BY"), this.parseExpressionList())
      : [];
    const having = this.matchKeyword("HAVING") ? this.parseExpression() : undefined;
    const orderBy = this.matchKeyword("ORDER")
      ? (this.expectKeyword("BY"), this.parseOrderBy())
      : [];
    const limit = this.matchKeyword("LIMIT") ? this.parseInteger() : undefined;
    const offset = this.matchKeyword("OFFSET") ? this.parseInteger() : undefined;

    this.expect("eof");
    return { type: "select", select, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    do {
      if (this.match("asterisk")) {
        items.push({ type: "wildcard" });
      } else if (this.peek().type === "identifier" && this.peekNext().type === "dot" && this.peekNext(2).type === "asterisk") {
        const table = this.advance().value;
        this.advance();
        this.advance();
        items.push({ type: "wildcard", table });
      } else {
        const expression = this.parseExpression();
        let alias: string | undefined;
        if (this.matchKeyword("AS")) {
          alias = this.parseIdentifier();
        } else if (this.canStartAlias()) {
          alias = this.advance().value;
        }
        items.push({ type: "expression", expression, alias });
      }
    } while (this.match("comma"));
    return items;
  }

  private canStartAlias(): boolean {
    if (this.peek().type !== "identifier" && this.peek().type !== "keyword") {
      return false;
    }
    const reserved = [
      "FROM",
      "WHERE",
      "GROUP",
      "HAVING",
      "ORDER",
      "LIMIT",
      "OFFSET",
      "INNER",
      "LEFT",
      "JOIN",
      "ON"
    ];
    return !reserved.includes(this.peek().value.toUpperCase());
  }

  private parseTableRef(): TableRef {
    const name = this.parseIdentifier();
    let alias: string | undefined;
    if (this.matchKeyword("AS")) {
      alias = this.parseIdentifier();
    } else if (this.peek().type === "identifier" || this.peek().type === "keyword") {
      const upper = this.peek().value.toUpperCase();
      if (!["WHERE", "INNER", "LEFT", "JOIN", "ON", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET"].includes(upper)) {
        alias = this.advance().value;
      }
    }
    return { name, alias };
  }

  private parseOrderBy() {
    const items = [];
    do {
      const expression = this.parseExpression();
      const direction = this.matchKeyword("DESC") ? "DESC" : (this.matchKeyword("ASC"), "ASC");
      items.push({ expression, direction: direction as "ASC" | "DESC" });
    } while (this.match("comma"));
    return items;
  }

  private parseExpressionList(): Expression[] {
    const items = [];
    do {
      items.push(this.parseExpression());
    } while (this.match("comma"));
    return items;
  }

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let expr = this.parseAnd();
    while (this.matchKeyword("OR")) {
      expr = { type: "binary", operator: "OR", left: expr, right: this.parseAnd() };
    }
    return expr;
  }

  private parseAnd(): Expression {
    let expr = this.parseNot();
    while (this.matchKeyword("AND")) {
      expr = { type: "binary", operator: "AND", left: expr, right: this.parseNot() };
    }
    return expr;
  }

  private parseNot(): Expression {
    if (this.matchKeyword("NOT")) {
      return { type: "unary", operator: "NOT", operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    let expr = this.parseAdditive();
    while (true) {
      if (this.matchKeyword("LIKE")) {
        expr = { type: "binary", operator: "LIKE", left: expr, right: this.parseAdditive() };
        continue;
      }
      if (this.peek().type === "operator" && ["=", "!=", "<>", "<", "<=", ">", ">="].includes(this.peek().value)) {
        const operator = this.advance().value as Expression extends { type: "binary"; operator: infer T } ? T : never;
        expr = { type: "binary", operator, left: expr, right: this.parseAdditive() };
        continue;
      }
      break;
    }
    return expr;
  }

  private parseAdditive(): Expression {
    let expr = this.parseMultiplicative();
    while (this.peek().type === "operator" && ["+", "-"].includes(this.peek().value)) {
      const operator = this.advance().value as "+" | "-";
      expr = { type: "binary", operator, left: expr, right: this.parseMultiplicative() };
    }
    return expr;
  }

  private parseMultiplicative(): Expression {
    let expr = this.parseUnary();
    while (this.peek().type === "operator" && ["*", "/"].includes(this.peek().value)) {
      const operator = this.advance().value as "*" | "/";
      expr = { type: "binary", operator, left: expr, right: this.parseUnary() };
    }
    return expr;
  }

  private parseUnary(): Expression {
    if (this.peek().type === "operator" && this.peek().value === "-") {
      this.advance();
      return { type: "unary", operator: "-", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const token = this.peek();
    if (this.match("number")) {
      return { type: "literal", value: Number(token.value) };
    }
    if (this.match("string")) {
      return { type: "literal", value: token.value };
    }
    if (this.match("paren_open")) {
      const expr = this.parseExpression();
      this.expect("paren_close");
      return expr;
    }
    if (this.match("asterisk")) {
      return { type: "wildcard" };
    }
    if (token.type === "identifier" || token.type === "keyword") {
      const name = this.advance().value;
      if (this.match("dot")) {
        const field = this.parseIdentifierLike();
        return { type: "identifier", name: `${name}.${field}` };
      }
      if (this.match("paren_open")) {
        const upper = name.toUpperCase();
        const distinct = this.matchKeyword("DISTINCT");
        const args =
          this.match("paren_close")
            ? []
            : (() => {
                const values = this.parseExpressionList();
                this.expect("paren_close");
                return values;
              })();
        if (!AGGREGATES.has(upper) && args.length === 0) {
          throw new Error(`Unsupported function ${name}`);
        }
        return { type: "function", name, args, distinct };
      }
      if (name.toUpperCase() === "NULL") {
        return { type: "literal", value: null };
      }
      if (name.toUpperCase() === "TRUE" || name.toUpperCase() === "FALSE") {
        return { type: "literal", value: name.toUpperCase() === "TRUE" };
      }
      return { type: "identifier", name };
    }
    throw new Error(`Unexpected token '${token.value}' at ${token.pos}`);
  }

  private parseIdentifier() {
    const token = this.peek();
    if (token.type !== "identifier" && token.type !== "keyword") {
      throw new Error(`Expected identifier at ${token.pos}`);
    }
    this.advance();
    return token.value;
  }

  private parseIdentifierLike() {
    const token = this.peek();
    if (!["identifier", "keyword", "asterisk"].includes(token.type)) {
      throw new Error(`Expected identifier at ${token.pos}`);
    }
    this.advance();
    return token.value;
  }

  private parseInteger() {
    const token = this.expect("number");
    return Number.parseInt(token.value, 10);
  }

  private previousUpper() {
    return this.tokens[this.index - 1]?.value.toUpperCase();
  }

  private peek(offset = 0) {
    return this.tokens[this.index + offset];
  }

  private peekNext(offset = 1) {
    return this.peek(offset);
  }

  private match(type: Token["type"]) {
    if (this.peek().type === type) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private matchKeyword(value: string) {
    const token = this.peek();
    if ((token.type === "keyword" || token.type === "identifier") && token.value.toUpperCase() === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expect(type: Token["type"]) {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected ${type} at ${token.pos}`);
    }
    this.index += 1;
    return token;
  }

  private expectKeyword(value: string) {
    const token = this.peek();
    if ((token.type !== "keyword" && token.type !== "identifier") || token.value.toUpperCase() !== value) {
      throw new Error(`Expected keyword ${value} at ${token.pos}`);
    }
    this.index += 1;
    return token;
  }

  private advance() {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }
}
