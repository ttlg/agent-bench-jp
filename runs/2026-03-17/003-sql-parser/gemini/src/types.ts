export type TokenType =
  | 'SELECT' | 'FROM' | 'WHERE' | 'JOIN' | 'INNER' | 'LEFT' | 'ON'
  | 'ORDER' | 'BY' | 'ASC' | 'DESC' | 'LIMIT' | 'OFFSET'
  | 'GROUP' | 'HAVING' | 'AND' | 'OR' | 'NOT' | 'LIKE'
  | 'IDENTIFIER' | 'STRING' | 'NUMBER'
  | 'OPERATOR' | 'COMMA' | 'DOT' | 'STAR' | 'LPAREN' | 'RPAREN' | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
}

export interface ColumnRef {
  type: 'ColumnRef';
  table?: string;
  column: string;
  alias?: string;
  isAggregate?: boolean;
  aggregateFunc?: string; // COUNT, SUM, AVG, MIN, MAX
}

export interface StarRef {
  type: 'Star';
  table?: string;
  isAggregate?: boolean;
  aggregateFunc?: string; // COUNT
}

export type SelectItem = ColumnRef | StarRef;

export interface TableRef {
  name: string;
  alias?: string;
}

export interface JoinClause {
  type: 'INNER' | 'LEFT';
  table: TableRef;
  on: Expr;
}

export type Expr =
  | { type: 'ColumnRef', table?: string, column: string }
  | { type: 'StringLiteral', value: string }
  | { type: 'NumberLiteral', value: number }
  | { type: 'BinaryExpr', left: Expr, operator: string, right: Expr }
  | { type: 'LogicalExpr', left: Expr, operator: 'AND' | 'OR', right: Expr }
  | { type: 'UnaryExpr', operator: 'NOT', expr: Expr }
  | { type: 'FunctionCall', name: string, args: Expr[] };

export interface OrderByItem {
  column: Expr;
  direction: 'ASC' | 'DESC';
}

export interface SelectStmt {
  select: SelectItem[];
  from: TableRef;
  joins: JoinClause[];
  where?: Expr;
  groupBy?: Expr[];
  having?: Expr;
  orderBy?: OrderByItem[];
  limit?: number;
  offset?: number;
}
