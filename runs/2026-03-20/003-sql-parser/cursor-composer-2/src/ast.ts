/** SQL AST (subset) for jsql */

export type BinaryOp =
  | "and"
  | "or"
  | "="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "like";

export type Expr =
  | { type: "literal"; value: string | number | boolean | null }
  | { type: "column"; table?: string; name: string }
  | { type: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { type: "unary"; op: "not"; expr: Expr }
  | { type: "call"; name: string; args: Expr[]; starArg?: boolean };

export type SelectItem =
  | { type: "star"; table?: string }
  | { type: "expr"; expr: Expr; alias?: string };

export type JoinType = "inner" | "left";

export type JoinClause = {
  joinType: JoinType;
  table: string;
  alias?: string;
  on: Expr;
};

export type OrderClause = { expr: Expr; direction: "asc" | "desc" };

export type Query = {
  select: SelectItem[];
  from: { table: string; alias?: string };
  joins: JoinClause[];
  where?: Expr;
  groupBy: Expr[];
  having?: Expr;
  orderBy: OrderClause[];
  limit?: number;
  offset?: number;
};
