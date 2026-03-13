export type ColumnRef = { type: 'column'; table?: string; name: string };
export type StarRef = { type: 'star'; table?: string };
export type FuncCall = { type: 'func'; name: string; arg: ColumnRef | StarRef };
export type Literal = { type: 'literal'; value: string | number };

export type Expr =
  | ColumnRef
  | StarRef
  | FuncCall
  | Literal
  | { type: 'binary'; op: string; left: Expr; right: Expr }
  | { type: 'unary'; op: 'NOT'; expr: Expr };

export type SelectItem = (ColumnRef | StarRef | FuncCall) & { alias?: string };

export type JoinType = 'INNER' | 'LEFT';

export interface JoinClause {
  type: JoinType;
  table: string;
  alias?: string;
  on: Expr;
}

export interface OrderByItem {
  expr: ColumnRef | FuncCall;
  direction: 'ASC' | 'DESC';
}

export interface SelectStatement {
  kind: 'SELECT';
  columns: SelectItem[];
  from: string;
  fromAlias?: string;
  joins: JoinClause[];
  where?: Expr;
  groupBy?: ColumnRef[];
  having?: Expr;
  orderBy?: OrderByItem[];
  limit?: number;
  offset?: number;
}

export type Statement = SelectStatement;
