export type JsonPrimitive = string | number | boolean | null;
export type JsonRow = Record<string, JsonPrimitive>;
export type TableData = Record<string, JsonRow[]>;

export interface TableReference {
  name: string;
  alias: string;
}

export interface JoinClause {
  kind: "inner" | "left";
  table: TableReference;
  on: Expression;
}

export interface SelectWildcard {
  kind: "wildcard";
}

export interface SelectExpression {
  kind: "expression";
  expression: Expression;
  label: string;
}

export type SelectItem = SelectWildcard | SelectExpression;

export interface OrderByItem {
  expression: Expression;
  direction: "asc" | "desc";
}

export interface Query {
  select: SelectItem[];
  from: TableReference;
  joins: JoinClause[];
  where?: Expression;
  groupBy: Expression[];
  having?: Expression;
  orderBy: OrderByItem[];
  limit?: number;
  offset?: number;
}

export interface LiteralExpression {
  kind: "literal";
  value: JsonPrimitive;
}

export interface ColumnExpression {
  kind: "column";
  table?: string;
  name: string;
}

export interface BinaryExpression {
  kind: "binary";
  operator:
    | "and"
    | "or"
    | "="
    | "!="
    | "<"
    | ">"
    | "<="
    | ">="
    | "like";
  left: Expression;
  right: Expression;
}

export interface UnaryExpression {
  kind: "unary";
  operator: "not";
  operand: Expression;
}

export interface FunctionExpression {
  kind: "function";
  name: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
  args: Expression[];
  star: boolean;
}

export type Expression =
  | LiteralExpression
  | ColumnExpression
  | BinaryExpression
  | UnaryExpression
  | FunctionExpression;

export interface QueryResult {
  columns: string[];
  rows: JsonRow[];
}
