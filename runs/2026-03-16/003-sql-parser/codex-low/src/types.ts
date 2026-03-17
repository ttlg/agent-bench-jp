export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type Operator =
  | "="
  | "!="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "LIKE";

export type Expression =
  | { type: "literal"; value: JsonPrimitive }
  | { type: "identifier"; name: string }
  | { type: "wildcard"; table?: string }
  | { type: "unary"; operator: "NOT" | "-"; operand: Expression }
  | {
      type: "binary";
      operator: Operator | "AND" | "OR" | "+" | "-" | "*" | "/";
      left: Expression;
      right: Expression;
    }
  | {
      type: "function";
      name: string;
      args: Expression[];
      distinct?: boolean;
    };

export type SelectItem =
  | { type: "wildcard"; table?: string }
  | { type: "expression"; expression: Expression; alias?: string };

export type TableRef = {
  name: string;
  alias?: string;
};

export type JoinRef = {
  kind: "INNER" | "LEFT";
  table: TableRef;
  on: Expression;
};

export type OrderBy = {
  expression: Expression;
  direction: "ASC" | "DESC";
};

export type QueryAst = {
  type: "select";
  select: SelectItem[];
  from: TableRef;
  joins: JoinRef[];
  where?: Expression;
  groupBy: Expression[];
  having?: Expression;
  orderBy: OrderBy[];
  limit?: number;
  offset?: number;
};

export type DataSet = Record<string, JsonObject[]>;
