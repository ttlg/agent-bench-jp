export type Primitive = string | number | boolean | null;

export type LiteralExpression = {
  type: "literal";
  value: Primitive;
};

export type ColumnReferenceExpression = {
  type: "column_ref";
  path: string[];
};

export type UnaryExpression = {
  type: "unary";
  operator: "NOT";
  operand: Expression;
};

export type BinaryOperator =
  | "AND"
  | "OR"
  | "="
  | "!="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "LIKE";

export type BinaryExpression = {
  type: "binary";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
};

export type FunctionCallExpression = {
  type: "function_call";
  name: string;
  args: Expression[];
  isAggregate: boolean;
  isStar: boolean;
};

export type Expression =
  | LiteralExpression
  | ColumnReferenceExpression
  | UnaryExpression
  | BinaryExpression
  | FunctionCallExpression;

export type SelectAllItem = {
  type: "all";
  qualifier?: string;
};

export type SelectExpressionItem = {
  type: "expression";
  expression: Expression;
  alias?: string;
};

export type SelectItem = SelectAllItem | SelectExpressionItem;

export type TableReference = {
  name: string;
  alias: string;
};

export type JoinClause = {
  kind: "INNER" | "LEFT";
  table: TableReference;
  on: Expression;
};

export type OrderByItem = {
  expression: Expression;
  direction: "ASC" | "DESC";
};

export type Query = {
  type: "select";
  select: SelectItem[];
  from: TableReference;
  joins: JoinClause[];
  where?: Expression;
  groupBy: Expression[];
  having?: Expression;
  orderBy: OrderByItem[];
  limit?: number;
  offset?: number;
};
