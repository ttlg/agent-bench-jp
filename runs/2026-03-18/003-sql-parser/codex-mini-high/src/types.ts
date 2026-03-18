export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface DataSet {
  [table: string]: Array<Record<string, JsonValue>>;
}

export interface ParsedQuery {
  select: SelectItem[];
  from: TableSource;
  joins: JoinClause[];
  where: Expression | null;
  groupBy: Expression[];
  having: Expression | null;
  orderBy: OrderItem[];
  limit: number | null;
  offset: number | null;
}

export interface TableSource {
  table: string;
  alias: string | null;
}

export interface JoinClause {
  type: 'inner' | 'left';
  table: string;
  alias: string | null;
  on: Expression;
}

export interface OrderItem {
  expr: Expression;
  direction: 'asc' | 'desc';
}

export type SelectItem =
  | { type: 'star' }
  | { type: 'expr'; expr: Expression; alias: string | null };

export type Expression =
  | { type: 'literal'; value: JsonValue }
  | { type: 'column'; table: string | null; column: string }
  | { type: 'star' }
  | { type: 'binary'; op: BinaryOperator; left: Expression; right: Expression }
  | { type: 'unary'; op: 'NOT' | '-'; expr: Expression }
  | { type: 'function'; name: string; args: Expression[] }
  | { type: 'group'; expr: Expression };

export type BinaryOperator =
  | 'OR'
  | 'AND'
  | '='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | 'LIKE';

export interface RowSource {
  table: string;
  alias: string;
  row: Record<string, JsonValue> | null;
  columns: string[];
}

export interface RowContext {
  sources: RowSource[];
}

export interface GroupContext {
  rows: RowContext[];
  key: JsonValue[];
}

export interface QueryResultRow {
  [key: string]: JsonValue;
}
