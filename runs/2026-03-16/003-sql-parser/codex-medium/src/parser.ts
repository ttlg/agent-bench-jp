import { tokenize } from "./tokenizer.ts";
import type {
  BinaryExpression,
  Expression,
  IdentifierExpression,
  OrderByItem,
  SelectItem,
  SelectQuery,
  TableRef,
  Token
} from "./types.ts";

const CLAUSE_KEYWORDS = new Set([
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
]);

class Parser {
  private index = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseQuery(): SelectQuery {
    this.expectKeyword("SELECT");
    const select = this.parseSelectList();
    this.expectKeyword("FROM");
    const from = this.parseTableRef();
    const joins = this.parseJoins();
    const where = this.matchKeyword("WHERE") ? this.parseExpression() : undefined;
    const groupBy = this.matchKeyword("GROUP") ? this.parseGroupBy() : [];
    const having = this.matchKeyword("HAVING") ? this.parseExpression() : undefined;
    const orderBy = this.matchKeyword("ORDER") ? this.parseOrderBy() : [];
    const limit = this.matchKeyword("LIMIT") ? this.parseNumericClause("LIMIT") : undefined;
    const offset = this.matchKeyword("OFFSET") ? this.parseNumericClause("OFFSET") : undefined;

    this.expect("eof");
    return { type: "select", select, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    do {
      if (this.matchPunctuation("*")) {
        items.push({ type: "wildcard" });
      } else {
        const expression = this.parseExpression();
        let alias: string | undefined;
        if (this.matchKeyword("AS")) {
          alias = this.parseAlias();
        } else if (this.canParseImplicitAlias()) {
          alias = this.parseAlias();
        }
        items.push({ type: "expression", expression, alias });
      }
    } while (this.matchPunctuation(","));
    return items;
  }

  private parseTableRef(): TableRef {
    const name = this.parseIdentifierValue("Expected table name");
    let alias = name;
    if (this.matchKeyword("AS")) {
      alias = this.parseAlias();
    } else if (this.canParseImplicitAlias()) {
      alias = this.parseAlias();
    }
    return { name, alias };
  }

  private parseJoins() {
    const joins = [];
    while (true) {
      let type: "inner" | "left" = "inner";
      if (this.matchKeyword("INNER")) {
        this.expectKeyword("JOIN");
      } else if (this.matchKeyword("LEFT")) {
        type = "left";
        this.expectKeyword("JOIN");
      } else if (this.matchKeyword("JOIN")) {
        type = "inner";
      } else {
        break;
      }
      const table = this.parseTableRef();
      this.expectKeyword("ON");
      const on = this.parseExpression();
      joins.push({ type, table, on });
    }
    return joins;
  }

  private parseGroupBy(): Expression[] {
    this.expectKeyword("BY");
    return this.parseExpressionList();
  }

  private parseOrderBy(): OrderByItem[] {
    this.expectKeyword("BY");
    const items: OrderByItem[] = [];
    do {
      const expression = this.parseExpression();
      let direction: "asc" | "desc" = "asc";
      if (this.matchKeyword("ASC")) {
        direction = "asc";
      } else if (this.matchKeyword("DESC")) {
        direction = "desc";
      }
      items.push({ expression, direction });
    } while (this.matchPunctuation(","));
    return items;
  }

  private parseExpressionList(): Expression[] {
    const expressions = [this.parseExpression()];
    while (this.matchPunctuation(",")) {
      expressions.push(this.parseExpression());
    }
    return expressions;
  }

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.matchKeyword("OR")) {
      left = { type: "binary", operator: "OR", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNot();
    while (this.matchKeyword("AND")) {
      left = { type: "binary", operator: "AND", left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Expression {
    if (this.matchKeyword("NOT")) {
      return { type: "unary", operator: "NOT", operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    let left = this.parsePrimary();
    while (true) {
      if (this.matchKeyword("LIKE")) {
        left = { type: "binary", operator: "LIKE", left, right: this.parsePrimary() };
        continue;
      }
      const token = this.peek();
      if (token.type === "operator" && ["=", "!=", "<>", "<", "<=", ">", ">="].includes(token.value)) {
        this.index += 1;
        const operator = token.value as BinaryExpression["operator"];
        left = { type: "binary", operator, left, right: this.parsePrimary() };
        continue;
      }
      break;
    }
    return left;
  }

  private parsePrimary(): Expression {
    if (this.matchPunctuation("(")) {
      const expression = this.parseExpression();
      this.expectPunctuation(")");
      return expression;
    }

    if (this.matchPunctuation("*")) {
      return { type: "wildcard-expression" };
    }

    const token = this.peek();
    if (token.type === "number") {
      this.index += 1;
      return { type: "literal", value: Number(token.value) };
    }
    if (token.type === "string") {
      this.index += 1;
      return { type: "literal", value: token.value };
    }
    if (token.type === "keyword" && ["TRUE", "FALSE", "NULL"].includes(token.value)) {
      this.index += 1;
      return {
        type: "literal",
        value: token.value === "TRUE" ? true : token.value === "FALSE" ? false : null
      };
    }
    if (token.type === "identifier" || token.type === "keyword") {
      const identifier = this.parseIdentifier();
      if (this.matchPunctuation("(")) {
        const args = this.matchPunctuation(")") ? [] : this.parseCallArgs();
        this.expectPunctuation(")");
        return { type: "call", name: identifier.parts.join("."), args };
      }
      return identifier;
    }

    throw new Error(`Unexpected token '${token.value}' at position ${token.position}`);
  }

  private parseCallArgs(): Expression[] {
    const args = [this.parseExpression()];
    while (this.matchPunctuation(",")) {
      args.push(this.parseExpression());
    }
    return args;
  }

  private parseIdentifier(): IdentifierExpression {
    const parts = [this.parseIdentifierValue("Expected identifier")];
    while (this.matchPunctuation(".")) {
      parts.push(this.parseIdentifierValue("Expected identifier after '.'"));
    }
    return { type: "identifier", parts };
  }

  private parseIdentifierValue(message: string): string {
    const token = this.peek();
    if (token.type === "identifier" || token.type === "keyword") {
      this.index += 1;
      return token.value;
    }
    throw new Error(`${message} at position ${token.position}`);
  }

  private parseAlias(): string {
    return this.parseIdentifierValue("Expected alias");
  }

  private parseNumericClause(clause: string): number {
    const token = this.peek();
    if (token.type !== "number") {
      throw new Error(`Expected numeric value after ${clause} at position ${token.position}`);
    }
    this.index += 1;
    return Number(token.value);
  }

  private canParseImplicitAlias(): boolean {
    const token = this.peek();
    if (!(token.type === "identifier" || token.type === "keyword")) {
      return false;
    }
    return !CLAUSE_KEYWORDS.has(token.value.toUpperCase());
  }

  private matchKeyword(value: string): boolean {
    const token = this.peek();
    if (token.type === "keyword" && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expectKeyword(value: string) {
    const token = this.peek();
    if (!(token.type === "keyword" && token.value === value)) {
      throw new Error(`Expected keyword ${value} at position ${token.position}`);
    }
    this.index += 1;
  }

  private matchPunctuation(value: string): boolean {
    const token = this.peek();
    if (token.type === "punctuation" && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expectPunctuation(value: string) {
    const token = this.peek();
    if (!(token.type === "punctuation" && token.value === value)) {
      throw new Error(`Expected '${value}' at position ${token.position}`);
    }
    this.index += 1;
  }

  private expect(type: Token["type"]) {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected ${type} at position ${token.position}`);
    }
    this.index += 1;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }
}

export function parseQuery(sql: string): SelectQuery {
  return new Parser(tokenize(sql)).parseQuery();
}
