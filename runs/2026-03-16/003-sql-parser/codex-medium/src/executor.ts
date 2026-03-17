import type {
  CallExpression,
  Expression,
  IdentifierExpression,
  JsonValue,
  QueryResult,
  SelectItem,
  SelectQuery
} from "./types.ts";

type TableData = Record<string, unknown[]>;

interface RowContext {
  tables: Record<string, Record<string, unknown> | null>;
}

interface OutputRow {
  values: Record<string, unknown>;
  source?: RowContext;
  group?: RowContext[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTableRows(rows: unknown, tableName: string): Record<string, unknown>[] {
  if (!Array.isArray(rows)) {
    throw new Error(`Table '${tableName}' must contain an array`);
  }
  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`Row ${index} in table '${tableName}' must be an object`);
    }
    return row;
  });
}

function truthy(value: unknown): boolean {
  return Boolean(value);
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined || left === null) {
    return -1;
  }
  if (right === undefined || right === null) {
    return 1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

function matchLike(value: unknown, pattern: unknown): boolean {
  const source = String(value ?? "");
  const regexSource = String(pattern ?? "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${regexSource}$`, "i").test(source);
}

function identifierName(expression: IdentifierExpression): string {
  return expression.parts.join(".");
}

function resolveIdentifier(expression: IdentifierExpression, row: RowContext, outputRow?: Record<string, unknown>): unknown {
  const parts = expression.parts;
  if (parts.length === 1 && outputRow && Object.prototype.hasOwnProperty.call(outputRow, parts[0])) {
    return outputRow[parts[0]];
  }
  if (parts.length === 2) {
    const [tableName, columnName] = parts;
    return row.tables[tableName]?.[columnName];
  }

  const [columnName] = parts;
  const matches: unknown[] = [];
  for (const table of Object.values(row.tables)) {
    if (table && Object.prototype.hasOwnProperty.call(table, columnName)) {
      matches.push(table[columnName]);
    }
  }
  if (matches.length === 0) {
    return undefined;
  }
  return matches[0];
}

function hasAggregate(expression: Expression): boolean {
  switch (expression.type) {
    case "call":
      return ["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(expression.name.toUpperCase()) || expression.args.some(hasAggregate);
    case "binary":
      return hasAggregate(expression.left) || hasAggregate(expression.right);
    case "unary":
      return hasAggregate(expression.operand);
    default:
      return false;
  }
}

function evaluateAggregate(call: CallExpression, rows: RowContext[]): unknown {
  const name = call.name.toUpperCase();
  if (name === "COUNT") {
    if (call.args.length === 0 || call.args[0].type === "wildcard-expression") {
      return rows.length;
    }
    return rows.filter((row) => evaluateExpression(call.args[0], row) !== undefined && evaluateExpression(call.args[0], row) !== null).length;
  }

  const values = rows
    .map((row) => (call.args[0] ? evaluateExpression(call.args[0], row) : undefined))
    .filter((value) => value !== undefined && value !== null);

  if (name === "SUM") {
    return values.reduce((sum, value) => sum + Number(value), 0);
  }
  if (name === "AVG") {
    if (values.length === 0) {
      return null;
    }
    return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
  }
  if (name === "MIN") {
    return values.reduce<unknown>((min, value) => (min === undefined || compareValues(value, min) < 0 ? value : min), undefined);
  }
  if (name === "MAX") {
    return values.reduce<unknown>((max, value) => (max === undefined || compareValues(value, max) > 0 ? value : max), undefined);
  }
  throw new Error(`Unsupported aggregate function ${call.name}`);
}

function evaluateExpression(
  expression: Expression,
  row: RowContext,
  groupRows?: RowContext[],
  outputRow?: Record<string, unknown>
): unknown {
  switch (expression.type) {
    case "literal":
      return expression.value;
    case "identifier":
      return resolveIdentifier(expression, row, outputRow);
    case "wildcard-expression":
      return undefined;
    case "unary":
      return !truthy(evaluateExpression(expression.operand, row, groupRows, outputRow));
    case "binary": {
      const left = evaluateExpression(expression.left, row, groupRows, outputRow);
      const right = evaluateExpression(expression.right, row, groupRows, outputRow);
      switch (expression.operator) {
        case "AND":
          return truthy(left) && truthy(right);
        case "OR":
          return truthy(left) || truthy(right);
        case "=":
          return left === right;
        case "!=":
        case "<>":
          return left !== right;
        case "<":
          return compareValues(left, right) < 0;
        case "<=":
          return compareValues(left, right) <= 0;
        case ">":
          return compareValues(left, right) > 0;
        case ">=":
          return compareValues(left, right) >= 0;
        case "LIKE":
          return matchLike(left, right);
      }
      return false;
    }
    case "call": {
      const upper = expression.name.toUpperCase();
      if (["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(upper)) {
        if (!groupRows) {
          throw new Error(`Aggregate function ${expression.name} used without grouping context`);
        }
        return evaluateAggregate(expression, groupRows);
      }
      throw new Error(`Unsupported function ${expression.name}`);
    }
  }
}

function projectWildcard(row: RowContext): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const table of Object.values(row.tables)) {
    if (!table) {
      continue;
    }
    for (const [key, value] of Object.entries(table)) {
      result[key] = value;
    }
  }
  return result;
}

function deriveExpressionName(expression: Expression): string {
  if (expression.type === "identifier") {
    return identifierName(expression);
  }
  if (expression.type === "call") {
    return `${expression.name.toUpperCase()}(...)`;
  }
  return "expr";
}

function createBaseRows(tableName: string, alias: string, rows: Record<string, unknown>[]): RowContext[] {
  return rows.map((row) => ({
    tables: {
      [tableName]: row,
      [alias]: row
    }
  }));
}

function joinRows(currentRows: RowContext[], joinType: "inner" | "left", joinName: string, joinAlias: string, joinRowsData: Record<string, unknown>[], on: Expression): RowContext[] {
  const result: RowContext[] = [];
  for (const leftRow of currentRows) {
    let matched = false;
    for (const rightRow of joinRowsData) {
      const combined: RowContext = {
        tables: {
          ...leftRow.tables,
          [joinName]: rightRow,
          [joinAlias]: rightRow
        }
      };
      if (truthy(evaluateExpression(on, combined))) {
        matched = true;
        result.push(combined);
      }
    }
    if (!matched && joinType === "left") {
      result.push({
        tables: {
          ...leftRow.tables,
          [joinName]: null,
          [joinAlias]: null
        }
      });
    }
  }
  return result;
}

function buildSelectRow(items: SelectItem[], row: RowContext, groupRows?: RowContext[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of items) {
    if (item.type === "wildcard") {
      Object.assign(result, projectWildcard(row));
      continue;
    }
    const alias = item.alias ?? deriveExpressionName(item.expression);
    result[alias] = evaluateExpression(item.expression, row, groupRows, result);
  }
  return result;
}

function buildGroupKey(expressions: Expression[], row: RowContext): string {
  return JSON.stringify(expressions.map((expression) => evaluateExpression(expression, row)));
}

function sortRows(rows: OutputRow[], orderBy: SelectQuery["orderBy"]) {
  if (orderBy.length === 0) {
    return rows;
  }

  rows.sort((leftRow, rightRow) => {
    for (const item of orderBy) {
      const leftValue = leftRow.source
        ? evaluateExpression(item.expression, leftRow.source, leftRow.group, leftRow.values)
        : leftRow.values[deriveExpressionName(item.expression)];
      const rightValue = rightRow.source
        ? evaluateExpression(item.expression, rightRow.source, rightRow.group, rightRow.values)
        : rightRow.values[deriveExpressionName(item.expression)];
      const comparison = compareValues(leftValue, rightValue);
      if (comparison !== 0) {
        return item.direction === "asc" ? comparison : -comparison;
      }
    }
    return 0;
  });

  return rows;
}

function detectAggregateQuery(query: SelectQuery): boolean {
  return (
    query.groupBy.length > 0 ||
    query.select.some((item) => item.type === "expression" && hasAggregate(item.expression)) ||
    (query.having ? hasAggregate(query.having) : false)
  );
}

export function executeQuery(data: JsonValue, query: SelectQuery): QueryResult {
  if (!isRecord(data)) {
    throw new Error("Input data must be an object mapping table names to arrays");
  }

  const baseRows = normalizeTableRows(data[query.from.name], query.from.name);
  let rows = createBaseRows(query.from.name, query.from.alias, baseRows);

  for (const join of query.joins) {
    const joinData = normalizeTableRows(data[join.table.name], join.table.name);
    rows = joinRows(rows, join.type, join.table.name, join.table.alias, joinData, join.on);
  }

  if (query.where) {
    rows = rows.filter((row) => truthy(evaluateExpression(query.where!, row)));
  }

  const aggregateMode = detectAggregateQuery(query);
  let outputRows: OutputRow[] = [];

  if (aggregateMode) {
    const groups = new Map<string, RowContext[]>();
    if (rows.length === 0 && query.groupBy.length === 0) {
      groups.set("[]", []);
    } else {
      for (const row of rows) {
        const key = query.groupBy.length === 0 ? "[]" : buildGroupKey(query.groupBy, row);
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
      }
    }

    for (const groupRows of groups.values()) {
      const baseRow = groupRows[0] ?? { tables: {} };
      if (query.having && !truthy(evaluateExpression(query.having, baseRow, groupRows))) {
        continue;
      }
      outputRows.push({
        values: buildSelectRow(query.select, baseRow, groupRows),
        source: baseRow,
        group: groupRows
      });
    }
  } else {
    outputRows = rows.map((row) => ({
      values: buildSelectRow(query.select, row),
      source: row
    }));
  }

  sortRows(outputRows, query.orderBy);

  const offset = query.offset ?? 0;
  const limit = query.limit ?? outputRows.length;
  const sliced = outputRows.slice(offset, offset + limit);
  const resultRows = sliced.map((row) => row.values);
  const columns = Array.from(
    resultRows.reduce((set, row) => {
      for (const key of Object.keys(row)) {
        set.add(key);
      }
      return set;
    }, new Set<string>())
  );

  return { columns, rows: resultRows };
}
