// ===== Token types =====
export enum TokenType {
  // Keywords
  SELECT = "SELECT",
  FROM = "FROM",
  WHERE = "WHERE",
  AND = "AND",
  OR = "OR",
  NOT = "NOT",
  JOIN = "JOIN",
  INNER = "INNER",
  LEFT = "LEFT",
  OUTER = "OUTER",
  ON = "ON",
  ORDER = "ORDER",
  BY = "BY",
  ASC = "ASC",
  DESC = "DESC",
  LIMIT = "LIMIT",
  OFFSET = "OFFSET",
  GROUP = "GROUP",
  HAVING = "HAVING",
  LIKE = "LIKE",
  COUNT = "COUNT",
  SUM = "SUM",
  AVG = "AVG",
  MIN = "MIN",
  MAX = "MAX",
  AS = "AS",

  // Literals
  NUMBER = "NUMBER",
  STRING = "STRING",
  IDENTIFIER = "IDENTIFIER",

  // Symbols
  STAR = "STAR",
  COMMA = "COMMA",
  DOT = "DOT",
  LPAREN = "LPAREN",
  RPAREN = "RPAREN",
  EQ = "EQ",
  NEQ = "NEQ",
  LT = "LT",
  GT = "GT",
  LTE = "LTE",
  GTE = "GTE",

  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

// ===== AST types =====

export interface ColumnRef {
  table?: string;
  column: string;
}

export interface AggregateExpr {
  func: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
  arg: ColumnRef | "*";
  alias?: string;
}

export type SelectItem = ColumnRef | AggregateExpr | "*";

export interface JoinClause {
  type: "INNER" | "LEFT";
  table: string;
  alias?: string;
  on: WhereExpr;
}

export type WhereExpr =
  | BinaryCompare
  | LogicalExpr
  | NotExpr
  | LikeExpr;

export interface BinaryCompare {
  type: "compare";
  left: ColumnRef | AggregateExpr;
  op: "=" | "!=" | "<" | ">" | "<=" | ">=";
  right: ColumnRef | AggregateExpr | string | number;
}

export interface LogicalExpr {
  type: "logical";
  op: "AND" | "OR";
  left: WhereExpr;
  right: WhereExpr;
}

export interface NotExpr {
  type: "not";
  expr: WhereExpr;
}

export interface LikeExpr {
  type: "like";
  column: ColumnRef;
  pattern: string;
}

export interface OrderByItem {
  column: ColumnRef;
  direction: "ASC" | "DESC";
}

export interface SelectStatement {
  type: "select";
  columns: SelectItem[];
  from: { table: string; alias?: string };
  joins: JoinClause[];
  where?: WhereExpr;
  groupBy?: ColumnRef[];
  having?: WhereExpr;
  orderBy?: OrderByItem[];
  limit?: number;
  offset?: number;
}

export type Row = Record<string, unknown>;
export type Database = Record<string, Row[]>;
