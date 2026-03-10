import { tokenize, type Token } from "./tokenizer.js";
import type {
  ColumnExpression,
  Expression,
  FunctionExpression,
  JoinClause,
  OrderByItem,
  Query,
  SelectExpression,
  SelectItem,
  TableReference,
} from "./types.js";

const CLAUSE_KEYWORDS = new Set([
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "INNER",
  "LEFT",
  "JOIN",
  "ON",
]);

const FUNCTION_NAMES = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseQuery(): Query {
    this.expectKeyword("SELECT");
    const select = this.parseSelectList();
    this.expectKeyword("FROM");
    const from = this.parseTableReference();
    const joins: JoinClause[] = [];

    while (this.matchesKeyword("INNER") || this.matchesKeyword("JOIN") || this.matchesKeyword("LEFT")) {
      joins.push(this.parseJoinClause());
    }

    const where = this.consumeKeyword("WHERE") ? this.parseExpression() : undefined;
    const groupBy = this.consumeKeyword("GROUP")
      ? (this.expectKeyword("BY"), this.parseExpressionList())
      : [];
    const having = this.consumeKeyword("HAVING") ? this.parseExpression() : undefined;
    const orderBy = this.consumeKeyword("ORDER")
      ? (this.expectKeyword("BY"), this.parseOrderByList())
      : [];
    const limit = this.consumeKeyword("LIMIT") ? this.parsePositiveInteger("LIMIT") : undefined;
    const offset = this.consumeKeyword("OFFSET") ? this.parsePositiveInteger("OFFSET") : undefined;

    this.consumePunctuation(";");
    this.expect("eof");

    return {
      select,
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
    do {
      if (this.consumePunctuation("*")) {
        items.push({ kind: "wildcard" });
      } else {
        const expression = this.parseExpression();
        const label = this.consumeKeyword("AS")
          ? this.parseIdentifier("column alias")
          : expressionToLabel(expression);
        items.push({
          kind: "expression",
          expression,
          label,
        } satisfies SelectExpression);
      }
    } while (this.consumePunctuation(","));
    return items;
  }

  private parseJoinClause(): JoinClause {
    let kind: JoinClause["kind"] = "inner";
    if (this.consumeKeyword("INNER")) {
      this.expectKeyword("JOIN");
      kind = "inner";
    } else if (this.consumeKeyword("LEFT")) {
      this.consumeKeyword("OUTER");
      this.expectKeyword("JOIN");
      kind = "left";
    } else {
      this.expectKeyword("JOIN");
    }

    const table = this.parseTableReference();
    this.expectKeyword("ON");
    const on = this.parseExpression();

    return {
      kind,
      table,
      on,
    };
  }

  private parseOrderByList(): OrderByItem[] {
    const items: OrderByItem[] = [];
    do {
      const expression = this.parseExpression();
      let direction: OrderByItem["direction"] = "asc";
      if (this.consumeKeyword("ASC")) {
        direction = "asc";
      } else if (this.consumeKeyword("DESC")) {
        direction = "desc";
      }
      items.push({ expression, direction });
    } while (this.consumePunctuation(","));
    return items;
  }

  private parseExpressionList(): Expression[] {
    const expressions: Expression[] = [];
    do {
      expressions.push(this.parseExpression());
    } while (this.consumePunctuation(","));
    return expressions;
  }

  private parseTableReference(): TableReference {
    const name = this.parseIdentifier("table name");
    let alias = name;

    if (this.consumeKeyword("AS")) {
      alias = this.parseIdentifier("table alias");
    } else if (this.peek().kind === "identifier" && !CLAUSE_KEYWORDS.has(this.peekUpper())) {
      alias = this.parseIdentifier("table alias");
    }

    return { name, alias };
  }

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let expression = this.parseAnd();
    while (this.consumeKeyword("OR")) {
      expression = {
        kind: "binary",
        operator: "or",
        left: expression,
        right: this.parseAnd(),
      };
    }
    return expression;
  }

  private parseAnd(): Expression {
    let expression = this.parseNot();
    while (this.consumeKeyword("AND")) {
      expression = {
        kind: "binary",
        operator: "and",
        left: expression,
        right: this.parseNot(),
      };
    }
    return expression;
  }

  private parseNot(): Expression {
    if (this.consumeKeyword("NOT")) {
      return {
        kind: "unary",
        operator: "not",
        operand: this.parseNot(),
      };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    let expression = this.parsePrimary();

    while (true) {
      if (this.consumeKeyword("LIKE")) {
        expression = {
          kind: "binary",
          operator: "like",
          left: expression,
          right: this.parsePrimary(),
        };
        continue;
      }

      const operator = this.consumeOperator(["=", "!=", "<", ">", "<=", ">="]);
      if (!operator) {
        break;
      }

      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parsePrimary(),
      };
    }

    return expression;
  }

  private parsePrimary(): Expression {
    if (this.consumePunctuation("(")) {
      const expression = this.parseExpression();
      this.expectPunctuation(")");
      return expression;
    }

    if (this.peek().kind === "number") {
      return {
        kind: "literal",
        value: Number(this.consume("number").value),
      };
    }

    if (this.peek().kind === "string") {
      return {
        kind: "literal",
        value: this.consume("string").value,
      };
    }

    if (this.consumeKeyword("NULL")) {
      return {
        kind: "literal",
        value: null,
      };
    }

    if (this.peek().kind === "identifier") {
      const identifier = this.consume("identifier").value;
      if (this.consumePunctuation("(")) {
        const name = identifier.toUpperCase();
        if (!FUNCTION_NAMES.has(name)) {
          throw this.error(`Unsupported function "${identifier}"`);
        }

        const star = this.consumePunctuation("*");
        const args = star ? [] : [this.parseExpression()];
        this.expectPunctuation(")");
        return {
          kind: "function",
          name: name as FunctionExpression["name"],
          args,
          star,
        };
      }

      const column: ColumnExpression = {
        kind: "column",
        name: identifier,
      };

      if (this.consumePunctuation(".")) {
        column.table = identifier;
        column.name = this.parseIdentifier("column name");
      }

      return column;
    }

    throw this.error(`Unexpected token "${this.peek().value}"`);
  }

  private parseIdentifier(label: string): string {
    if (this.peek().kind !== "identifier") {
      throw this.error(`Expected ${label}`);
    }
    return this.consume("identifier").value;
  }

  private parsePositiveInteger(label: string): number {
    const token = this.consume("number");
    const value = Number(token.value);
    if (!Number.isInteger(value) || value < 0) {
      throw this.error(`${label} must be a non-negative integer`);
    }
    return value;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private peekUpper(): string {
    return this.peek().value.toUpperCase();
  }

  private expect(kind: Token["kind"]): Token {
    if (this.peek().kind !== kind) {
      throw this.error(`Expected ${kind}`);
    }
    return this.consume(kind);
  }

  private consume(kind: Token["kind"]): Token {
    const token = this.tokens[this.index];
    if (token.kind !== kind) {
      throw this.error(`Expected ${kind}`);
    }
    this.index += 1;
    return token;
  }

  private matchesKeyword(keyword: string): boolean {
    return this.peek().kind === "identifier" && this.peekUpper() === keyword;
  }

  private consumeKeyword(keyword: string): boolean {
    if (!this.matchesKeyword(keyword)) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private expectKeyword(keyword: string): void {
    if (!this.consumeKeyword(keyword)) {
      throw this.error(`Expected keyword ${keyword}`);
    }
  }

  private consumeOperator(operators: string[]): Expression["kind"] extends never ? never : BinaryOperator | null {
    if (this.peek().kind !== "operator") {
      return null;
    }
    if (!operators.includes(this.peek().value)) {
      return null;
    }
    return this.consume("operator").value as BinaryOperator;
  }

  private consumePunctuation(value: string): boolean {
    if (this.peek().kind !== "punctuation" || this.peek().value !== value) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private expectPunctuation(value: string): void {
    if (!this.consumePunctuation(value)) {
      throw this.error(`Expected "${value}"`);
    }
  }

  private error(message: string): Error {
    return new Error(`${message} at position ${this.peek().position}`);
  }
}

type BinaryOperator = "=" | "!=" | "<" | ">" | "<=" | ">=";

export function parseQuery(sql: string): Query {
  return new Parser(tokenize(sql)).parseQuery();
}

export function expressionToLabel(expression: Expression): string {
  switch (expression.kind) {
    case "literal":
      return expression.value === null ? "NULL" : String(expression.value);
    case "column":
      return expression.table ? `${expression.table}.${expression.name}` : expression.name;
    case "unary":
      return `NOT ${expressionToLabel(expression.operand)}`;
    case "binary":
      return `${expressionToLabel(expression.left)} ${expression.operator.toUpperCase()} ${expressionToLabel(
        expression.right,
      )}`;
    case "function":
      return expression.star
        ? `${expression.name}(*)`
        : `${expression.name}(${expression.args.map((arg) => expressionToLabel(arg)).join(", ")})`;
  }
}
