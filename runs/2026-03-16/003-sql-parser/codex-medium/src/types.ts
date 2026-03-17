export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type TokenType =
  | "identifier"
  | "number"
  | "string"
  | "operator"
  | "punctuation"
  | "keyword"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export interface TableRef {
  name: string;
  alias: string;
}

export interface SelectQuery {
  type: "select";
  select: SelectItem[];
  from: TableRef;
  joins: JoinClause[];
  where?: Expression;
  groupBy: Expression[];
  having?: Expression;
  orderBy: OrderByItem[];
  limit?: number;
  offset?: number;
}

export interface JoinClause {
  type: "inner" | "left";
  table: TableRef;
  on: Expression;
}

export interface OrderByItem {
  expression: Expression;
  direction: "asc" | "desc";
}

export type SelectItem =
  | {
      type: "wildcard";
    }
  | {
      type: "expression";
      expression: Expression;
      alias?: string;
    };

export type Expression =
  | LiteralExpression
  | IdentifierExpression
  | UnaryExpression
  | BinaryExpression
  | CallExpression
  | WildcardExpression;

export interface LiteralExpression {
  type: "literal";
  value: string | number | boolean | null;
}

export interface IdentifierExpression {
  type: "identifier";
  parts: string[];
}

export interface UnaryExpression {
  type: "unary";
  operator: "NOT";
  operand: Expression;
}

export interface BinaryExpression {
  type: "binary";
  operator: "=" | "!=" | "<>" | "<" | "<=" | ">" | ">=" | "AND" | "OR" | "LIKE";
  left: Expression;
  right: Expression;
}

export interface CallExpression {
  type: "call";
  name: string;
  args: Expression[];
}

export interface WildcardExpression {
  type: "wildcard-expression";
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}
