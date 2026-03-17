import type {
  Expression,
  FunctionCallExpression,
  Query,
  SelectItem,
  TableReference
} from "./ast.ts";
import { tokenize, type Token } from "./tokenizer.ts";

const AGGREGATE_FUNCTIONS = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);
const CLAUSE_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "BY",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "INNER",
  "LEFT",
  "JOIN",
  "ON",
  "ASC",
  "DESC"
]);

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(sql: string) {
    this.tokens = tokenize(sql);
  }

  parseQuery(): Query {
    this.expectKeyword("SELECT");
    const select = this.parseSelectList();
    this.expectKeyword("FROM");
    const from = this.parseTableReference();
    const joins = this.parseJoins();

    let where: Expression | undefined;
    if (this.matchKeyword("WHERE")) {
      where = this.parseExpression();
    }

    const groupBy: Expression[] = [];
    if (this.matchKeyword("GROUP")) {
      this.expectKeyword("BY");
      groupBy.push(...this.parseExpressionList());
    }

    let having: Expression | undefined;
    if (this.matchKeyword("HAVING")) {
      having = this.parseExpression();
    }

    const orderBy = [];
    if (this.matchKeyword("ORDER")) {
      this.expectKeyword("BY");
      do {
        const expression = this.parseExpression();
        let direction: "ASC" | "DESC" = "ASC";
        if (this.matchKeyword("ASC")) {
          direction = "ASC";
        } else if (this.matchKeyword("DESC")) {
          direction = "DESC";
        }
        orderBy.push({ expression, direction });
      } while (this.matchSymbol(","));
    }

    let limit: number | undefined;
    if (this.matchKeyword("LIMIT")) {
      limit = this.parseNumber("LIMIT");
    }

    let offset: number | undefined;
    if (this.matchKeyword("OFFSET")) {
      offset = this.parseNumber("OFFSET");
    }

    this.matchSymbol(";");
    this.expectType("eof");

    return {
      type: "select",
      select,
      from,
      joins,
      where,
      groupBy,
      having,
      orderBy,
      limit,
      offset
    };
  }

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    do {
      if (this.matchSymbol("*")) {
        items.push({ type: "all" });
        continue;
      }

      if (
        this.peek().type === "identifier" &&
        this.peek(1).value === "." &&
        this.peek(2).value === "*"
      ) {
        const qualifier = this.consume().value;
        this.expectSymbol(".");
        this.expectSymbol("*");
        items.push({ type: "all", qualifier });
        continue;
      }

      const expression = this.parseExpression();
      const alias = this.parseOptionalAlias();
      items.push({ type: "expression", expression, alias });
    } while (this.matchSymbol(","));
    return items;
  }

  private parseJoins() {
    const joins = [];
    while (true) {
      let kind: "INNER" | "LEFT" = "INNER";
      if (this.matchKeyword("INNER")) {
        this.expectKeyword("JOIN");
        kind = "INNER";
      } else if (this.matchKeyword("LEFT")) {
        this.expectKeyword("JOIN");
        kind = "LEFT";
      } else if (this.matchKeyword("JOIN")) {
        kind = "INNER";
      } else {
        break;
      }

      const table = this.parseTableReference();
      this.expectKeyword("ON");
      const on = this.parseExpression();
      joins.push({ kind, table, on });
    }
    return joins;
  }

  private parseTableReference(): TableReference {
    const name = this.expectIdentifier("table name").value;
    const alias = this.parseOptionalAlias() ?? name;
    return { name, alias };
  }

  private parseOptionalAlias(): string | undefined {
    if (this.matchKeyword("AS")) {
      return this.expectIdentifier("alias").value;
    }

    const token = this.peek();
    if (token.type !== "identifier") {
      return undefined;
    }

    if (CLAUSE_KEYWORDS.has(token.value.toUpperCase())) {
      return undefined;
    }

    return this.consume().value;
  }

  private parseExpressionList(): Expression[] {
    const expressions = [];
    do {
      expressions.push(this.parseExpression());
    } while (this.matchSymbol(","));
    return expressions;
  }

  private parseExpression(): Expression {
    return this.parseOrExpression();
  }

  private parseOrExpression(): Expression {
    let expression = this.parseAndExpression();
    while (this.matchKeyword("OR")) {
      expression = {
        type: "binary",
        operator: "OR",
        left: expression,
        right: this.parseAndExpression()
      };
    }
    return expression;
  }

  private parseAndExpression(): Expression {
    let expression = this.parseNotExpression();
    while (this.matchKeyword("AND")) {
      expression = {
        type: "binary",
        operator: "AND",
        left: expression,
        right: this.parseNotExpression()
      };
    }
    return expression;
  }

  private parseNotExpression(): Expression {
    if (this.matchKeyword("NOT")) {
      return {
        type: "unary",
        operator: "NOT",
        operand: this.parseNotExpression()
      };
    }
    return this.parseComparisonExpression();
  }

  private parseComparisonExpression(): Expression {
    let expression = this.parsePrimaryExpression();

    while (true) {
      if (this.matchKeyword("LIKE")) {
        expression = {
          type: "binary",
          operator: "LIKE",
          left: expression,
          right: this.parsePrimaryExpression()
        };
        continue;
      }

      const token = this.peek();
      if (token.type === "symbol" && ["=", "!=", "<>", "<", "<=", ">", ">="].includes(token.value)) {
        this.consume();
        expression = {
          type: "binary",
          operator: token.value as "=" | "!=" | "<>" | "<" | "<=" | ">" | ">=",
          left: expression,
          right: this.parsePrimaryExpression()
        };
        continue;
      }

      break;
    }

    return expression;
  }

  private parsePrimaryExpression(): Expression {
    const token = this.peek();

    if (token.type === "number") {
      this.consume();
      return { type: "literal", value: Number(token.value) };
    }

    if (token.type === "string") {
      this.consume();
      return { type: "literal", value: token.value };
    }

    if (token.type === "identifier") {
      const upper = token.value.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") {
        this.consume();
        return { type: "literal", value: upper === "TRUE" };
      }

      if (upper === "NULL") {
        this.consume();
        return { type: "literal", value: null };
      }

      return this.parseIdentifierExpression();
    }

    if (this.matchSymbol("(")) {
      const expression = this.parseExpression();
      this.expectSymbol(")");
      return expression;
    }

    throw new Error(`Unexpected token "${token.value}" at position ${token.position}`);
  }

  private parseIdentifierExpression(): Expression {
    const identifier = this.expectIdentifier("identifier").value;

    if (this.matchSymbol("(")) {
      return this.parseFunctionCall(identifier);
    }

    const path = [identifier];
    while (this.matchSymbol(".")) {
      path.push(this.expectIdentifier("column name").value);
    }

    return { type: "column_ref", path };
  }

  private parseFunctionCall(name: string): FunctionCallExpression {
    const args: Expression[] = [];
    let isStar = false;

    if (this.matchSymbol("*")) {
      isStar = true;
    } else if (this.peek().value !== ")") {
      args.push(...this.parseExpressionList());
    }

    this.expectSymbol(")");
    return {
      type: "function_call",
      name,
      args,
      isAggregate: AGGREGATE_FUNCTIONS.has(name.toUpperCase()),
      isStar
    };
  }

  private parseNumber(label: string): number {
    const token = this.expectType("number");
    const value = Number(token.value);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer`);
    }
    return value;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.index + offset];
  }

  private consume(): Token {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private expectType(type: Token["type"]): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected ${type} at position ${token.position}`);
    }
    return this.consume();
  }

  private expectIdentifier(label: string): Token {
    const token = this.peek();
    if (token.type !== "identifier") {
      throw new Error(`Expected ${label} at position ${token.position}`);
    }
    return this.consume();
  }

  private matchKeyword(keyword: string): boolean {
    const token = this.peek();
    if (token.type === "identifier" && token.value.toUpperCase() === keyword) {
      this.consume();
      return true;
    }
    return false;
  }

  private expectKeyword(keyword: string): void {
    const token = this.peek();
    if (token.type !== "identifier" || token.value.toUpperCase() !== keyword) {
      throw new Error(`Expected ${keyword} at position ${token.position}`);
    }
    this.consume();
  }

  private matchSymbol(symbol: string): boolean {
    const token = this.peek();
    if (token.type === "symbol" && token.value === symbol) {
      this.consume();
      return true;
    }
    return false;
  }

  private expectSymbol(symbol: string): void {
    const token = this.peek();
    if (token.type !== "symbol" || token.value !== symbol) {
      throw new Error(`Expected "${symbol}" at position ${token.position}`);
    }
    this.consume();
  }
}

export function parseSql(sql: string): Query {
  return new Parser(sql).parseQuery();
}
