// AST Node types

export interface ColumnRef {
  type: 'column_ref';
  table?: string;
  column: string;
}

export interface StarRef {
  type: 'star';
}

export interface AggregateFn {
  type: 'aggregate';
  fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  arg: ColumnRef | StarRef;
}

export type SelectItem = ColumnRef | StarRef | AggregateFn;

export interface NumberLiteral {
  type: 'number';
  value: number;
}

export interface StringLiteral {
  type: 'string';
  value: string;
}

export type Literal = NumberLiteral | StringLiteral;

export type CompareOp = '=' | '!=' | '<' | '>' | '<=' | '>=';

export interface CompareExpr {
  type: 'compare';
  left: ColumnRef | AggregateFn;
  op: CompareOp;
  right: Literal | ColumnRef;
}

export interface LikeExpr {
  type: 'like';
  left: ColumnRef;
  pattern: string;
}

export interface AndExpr {
  type: 'and';
  left: WhereExpr;
  right: WhereExpr;
}

export interface OrExpr {
  type: 'or';
  left: WhereExpr;
  right: WhereExpr;
}

export interface NotExpr {
  type: 'not';
  expr: WhereExpr;
}

export type WhereExpr = CompareExpr | LikeExpr | AndExpr | OrExpr | NotExpr;

export interface JoinClause {
  type: 'INNER' | 'LEFT';
  table: string;
  alias?: string;
  on: CompareExpr;
}

export interface OrderByItem {
  column: ColumnRef;
  direction: 'ASC' | 'DESC';
}

export interface SelectStatement {
  type: 'select';
  columns: SelectItem[];
  from: {
    table: string;
    alias?: string;
  };
  joins: JoinClause[];
  where?: WhereExpr;
  groupBy?: ColumnRef[];
  having?: WhereExpr;
  orderBy?: OrderByItem[];
  limit?: number;
  offset?: number;
}
