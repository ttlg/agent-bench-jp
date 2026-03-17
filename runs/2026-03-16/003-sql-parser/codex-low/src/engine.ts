import type { DataSet, Expression, JsonObject, JsonPrimitive, QueryAst, SelectItem } from "./types.ts";

type RowContext = {
  combined: Record<string, JsonPrimitive | JsonObject | JsonPrimitive[] | null | undefined>;
  aliases: Record<string, JsonObject | null>;
};

type ExecutionResult = {
  columns: string[];
  rows: JsonObject[];
};

export function executeQuery(data: DataSet, query: QueryAst): ExecutionResult {
  const baseRows = getTableRows(data, query.from.name, query.from.alias);
  let rows = baseRows;

  for (const join of query.joins) {
    rows = applyJoin(rows, getTableRows(data, join.table.name, join.table.alias), join.kind, join.table.alias ?? join.table.name, join.on);
  }

  if (query.where) {
    rows = rows.filter((row) => truthy(evaluateExpression(query.where!, row)));
  }

  const grouped = query.groupBy.length > 0 || hasAggregateSelection(query.select)
    ? groupRows(rows, query.groupBy)
    : null;

  let projectedRows: JsonObject[];
  if (grouped) {
    const filtered = query.having ? grouped.filter((group) => truthy(evaluateExpression(query.having!, group[0], group))) : grouped;
    projectedRows = filtered.map((group) => projectRow(group[0], query.select, group));
  } else {
    projectedRows = rows.map((row) => projectRow(row, query.select));
    if (query.having) {
      throw new Error("HAVING requires GROUP BY or aggregate functions");
    }
  }

  const columns = projectedRows[0] ? Object.keys(projectedRows[0]) : deriveColumns(query.select);

  if (query.orderBy.length > 0) {
    projectedRows.sort((a, b) => compareProjected(a, b, query.orderBy));
  }

  const offset = query.offset ?? 0;
  const limit = query.limit ?? projectedRows.length;
  return { columns, rows: projectedRows.slice(offset, offset + limit) };
}

function getTableRows(data: DataSet, tableName: string, alias?: string): RowContext[] {
  const table = data[tableName];
  if (!Array.isArray(table)) {
    throw new Error(`Table not found: ${tableName}`);
  }
  const key = alias ?? tableName;
  return table.map((record) => ({
    combined: flattenRecord(record, key),
    aliases: { [key]: record }
  }));
}

function flattenRecord(record: JsonObject, prefix: string) {
  const combined: RowContext["combined"] = { [prefix]: record };
  for (const [key, value] of Object.entries(record)) {
    combined[key] = value as JsonPrimitive | JsonObject | JsonPrimitive[] | null;
    combined[`${prefix}.${key}`] = value as JsonPrimitive | JsonObject | JsonPrimitive[] | null;
  }
  return combined;
}

function applyJoin(leftRows: RowContext[], rightRows: RowContext[], kind: "INNER" | "LEFT", aliasKey: string, on: Expression): RowContext[] {
  const results: RowContext[] = [];
  const nullRight = buildNullRow(aliasKey, rightRows[0]);

  for (const left of leftRows) {
    let matched = false;
    for (const right of rightRows) {
      const merged = mergeRows(left, right);
      if (truthy(evaluateExpression(on, merged))) {
        matched = true;
        results.push(merged);
      }
    }
    if (!matched && kind === "LEFT") {
      results.push(mergeRows(left, nullRight));
    }
  }
  return results;
}

function buildNullRow(aliasKey: string, sample?: RowContext): RowContext {
  const record: JsonObject = {};
  if (sample) {
    const source = sample.aliases[aliasKey];
    if (source) {
      for (const key of Object.keys(source)) {
        record[key] = null;
      }
    }
  }
  return {
    combined: flattenRecord(record, aliasKey),
    aliases: { [aliasKey]: record }
  };
}

function mergeRows(left: RowContext, right: RowContext): RowContext {
  return {
    combined: { ...left.combined, ...right.combined },
    aliases: { ...left.aliases, ...right.aliases }
  };
}

function groupRows(rows: RowContext[], groupBy: Expression[]) {
  const map = new Map<string, RowContext[]>();
  for (const row of rows) {
    const key = JSON.stringify(groupBy.map((expr) => evaluateExpression(expr, row)));
    const group = map.get(key);
    if (group) {
      group.push(row);
    } else {
      map.set(key, [row]);
    }
  }
  return [...map.values()];
}

function projectRow(row: RowContext, select: SelectItem[], group?: RowContext[]): JsonObject {
  const out: JsonObject = {};
  for (const item of select) {
    if (item.type === "wildcard") {
      if (item.table) {
        const source = row.aliases[item.table];
        if (!source) {
          throw new Error(`Unknown table alias: ${item.table}`);
        }
        Object.assign(out, source);
      } else {
        for (const source of Object.values(row.aliases)) {
          if (source) {
            Object.assign(out, source);
          }
        }
      }
      continue;
    }
    const value = evaluateExpression(item.expression, row, group);
    out[item.alias ?? defaultColumnName(item.expression)] = normalizeValue(value);
  }
  return out;
}

function normalizeValue(value: unknown): JsonPrimitive {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

function defaultColumnName(expression: Expression): string {
  switch (expression.type) {
    case "identifier":
      return expression.name.includes(".") ? expression.name.split(".").at(-1) ?? expression.name : expression.name;
    case "function":
      return `${expression.name.toUpperCase()}(${expression.args.map(defaultColumnName).join(", ")})`;
    case "literal":
      return String(expression.value);
    default:
      return "expr";
  }
}

function hasAggregateSelection(select: SelectItem[]) {
  return select.some((item) => item.type === "expression" && containsAggregate(item.expression));
}

function containsAggregate(expression: Expression): boolean {
  if (expression.type === "function") {
    return ["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(expression.name.toUpperCase());
  }
  if (expression.type === "binary") {
    return containsAggregate(expression.left) || containsAggregate(expression.right);
  }
  if (expression.type === "unary") {
    return containsAggregate(expression.operand);
  }
  return false;
}

function evaluateExpression(expression: Expression, row: RowContext, group?: RowContext[]): unknown {
  switch (expression.type) {
    case "literal":
      return expression.value;
    case "identifier":
      return row.combined[expression.name];
    case "wildcard":
      return row.combined;
    case "unary": {
      const operand = evaluateExpression(expression.operand, row, group);
      return expression.operator === "NOT" ? !truthy(operand) : -Number(operand ?? 0);
    }
    case "binary":
      return evaluateBinary(expression.operator, evaluateExpression(expression.left, row, group), evaluateExpression(expression.right, row, group));
    case "function":
      return evaluateFunction(expression.name, expression.args, row, group, Boolean(expression.distinct));
  }
}

function evaluateBinary(operator: string, left: unknown, right: unknown) {
  switch (operator) {
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
      return compare(left, right) < 0;
    case "<=":
      return compare(left, right) <= 0;
    case ">":
      return compare(left, right) > 0;
    case ">=":
      return compare(left, right) >= 0;
    case "LIKE":
      return likeMatch(String(left ?? ""), String(right ?? ""));
    case "+":
      return Number(left ?? 0) + Number(right ?? 0);
    case "-":
      return Number(left ?? 0) - Number(right ?? 0);
    case "*":
      return Number(left ?? 0) * Number(right ?? 0);
    case "/":
      return Number(left ?? 0) / Number(right ?? 1);
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}

function compare(left: unknown, right: unknown) {
  if (left === right) {
    return 0;
  }
  if (left == null) {
    return -1;
  }
  if (right == null) {
    return 1;
  }
  return left < right ? -1 : 1;
}

function likeMatch(value: string, pattern: string) {
  const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
  return regex.test(value);
}

function evaluateFunction(name: string, args: Expression[], row: RowContext, group: RowContext[] | undefined, distinct: boolean) {
  const upper = name.toUpperCase();
  const sourceRows = group ?? [row];
  const values = args.length === 0 || (args.length === 1 && args[0].type === "wildcard")
    ? sourceRows.map(() => 1)
    : sourceRows.map((current) => evaluateExpression(args[0], current, undefined));
  const filtered = distinct ? [...new Set(values)] : values;

  switch (upper) {
    case "COUNT":
      return args.length === 0 || (args.length === 1 && args[0].type === "wildcard")
        ? sourceRows.length
        : filtered.filter((value) => value != null).length;
    case "SUM":
      return filtered.reduce((sum, value) => sum + Number(value ?? 0), 0);
    case "AVG":
      return filtered.length === 0 ? null : filtered.reduce((sum, value) => sum + Number(value ?? 0), 0) / filtered.length;
    case "MIN":
      return filtered.reduce((min, value) => (min == null || compare(value, min) < 0 ? value : min), null as unknown);
    case "MAX":
      return filtered.reduce((max, value) => (max == null || compare(value, max) > 0 ? value : max), null as unknown);
    default:
      throw new Error(`Unsupported function: ${name}`);
  }
}

function truthy(value: unknown) {
  return Boolean(value);
}

function compareProjected(a: JsonObject, b: JsonObject, orderBy: QueryAst["orderBy"]) {
  for (const item of orderBy) {
    const column = defaultColumnName(item.expression);
    const result = compare(a[column], b[column]);
    if (result !== 0) {
      return item.direction === "DESC" ? -result : result;
    }
  }
  return 0;
}

function deriveColumns(select: SelectItem[]) {
  return select.flatMap((item) => (item.type === "wildcard" ? [] : [item.alias ?? defaultColumnName(item.expression)]));
}
