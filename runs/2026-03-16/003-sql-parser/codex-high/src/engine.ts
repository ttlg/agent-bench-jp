import type {
  Expression,
  FunctionCallExpression,
  Query,
  SelectExpressionItem,
  TableReference
} from "./ast.ts";

export type RowObject = Record<string, unknown>;
export type TableData = RowObject[];
export type Database = Record<string, TableData>;

type SourceBinding = {
  alias: string;
  table: string;
};

type JoinedRow = {
  bindings: Record<string, RowObject | null>;
  sources: SourceBinding[];
};

type EvaluationScope = {
  bindings: Record<string, RowObject | null>;
  sources: SourceBinding[];
  groupRows?: JoinedRow[];
  aliasValues?: Record<string, unknown>;
};

export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
};

export function executeQuery(database: Database, query: Query): QueryResult {
  const schemas = buildSchemas(database);
  const baseRows = loadTable(database, query.from.name).map((row) => ({
    bindings: { [query.from.alias]: row },
    sources: [{ alias: query.from.alias, table: query.from.name }]
  }));

  let joinedRows = baseRows;
  for (const join of query.joins) {
    joinedRows = applyJoin(database, joinedRows, join.table, join.kind, join.on);
  }

  const filteredRows = query.where
    ? joinedRows.filter((row) => isTruthy(evaluateExpression(query.where!, toScope(row))))
    : joinedRows;

  const isAggregateQuery =
    query.groupBy.length > 0 ||
    query.select.some((item) => item.type === "expression" && containsAggregate(item.expression)) ||
    Boolean(query.having && containsAggregate(query.having));

  const projectedRows = isAggregateQuery
    ? projectAggregateRows(database, query, filteredRows, schemas)
    : projectPlainRows(query, filteredRows, schemas);

  const orderedRows = applyOrdering(projectedRows, query.orderBy, isAggregateQuery);
  const offset = query.offset ?? 0;
  const limitedRows =
    query.limit === undefined
      ? orderedRows.slice(offset)
      : orderedRows.slice(offset, offset + query.limit);

  const columns = collectColumns(projectedRows.length > 0 ? projectedRows : limitedRows);
  return {
    columns,
    rows: limitedRows.map((entry) => entry.record)
  };
}

type ProjectedRow = {
  record: Record<string, unknown>;
  columns: string[];
  scope: EvaluationScope;
};

function projectPlainRows(
  query: Query,
  rows: JoinedRow[],
  schemas: Record<string, string[]>
): ProjectedRow[] {
  return rows.map((row) => {
    const scope = toScope(row);
    return buildProjection(query, scope, schemas);
  });
}

function projectAggregateRows(
  database: Database,
  query: Query,
  rows: JoinedRow[],
  schemas: Record<string, string[]>
): ProjectedRow[] {
  const groups = buildGroups(query, rows);
  const fallbackSources = collectQuerySources(query);
  const projected: ProjectedRow[] = [];

  if (groups.length === 0 && query.groupBy.length === 0) {
    groups.push([]);
  }

  for (const groupRows of groups) {
    const baseScope =
      groupRows[0] !== undefined
        ? toScope(groupRows[0], groupRows)
        : createEmptyGroupScope(fallbackSources);

    if (query.having && !isTruthy(evaluateExpression(query.having, baseScope))) {
      continue;
    }

    projected.push(buildProjection(query, baseScope, schemas));
  }

  return projected;
}

function applyJoin(
  database: Database,
  leftRows: JoinedRow[],
  table: TableReference,
  kind: "INNER" | "LEFT",
  on: Expression
): JoinedRow[] {
  const rightRows = loadTable(database, table.name);
  const nextRows: JoinedRow[] = [];

  for (const leftRow of leftRows) {
    let matched = false;

    for (const rightRow of rightRows) {
      const candidate: JoinedRow = {
        bindings: { ...leftRow.bindings, [table.alias]: rightRow },
        sources: [...leftRow.sources, { alias: table.alias, table: table.name }]
      };

      if (isTruthy(evaluateExpression(on, toScope(candidate)))) {
        matched = true;
        nextRows.push(candidate);
      }
    }

    if (!matched && kind === "LEFT") {
      nextRows.push({
        bindings: { ...leftRow.bindings, [table.alias]: null },
        sources: [...leftRow.sources, { alias: table.alias, table: table.name }]
      });
    }
  }

  return nextRows;
}

function buildGroups(query: Query, rows: JoinedRow[]): JoinedRow[][] {
  if (query.groupBy.length === 0) {
    return rows.length === 0 ? [] : [rows];
  }

  const groups = new Map<string, JoinedRow[]>();
  for (const row of rows) {
    const scope = toScope(row);
    const keyValues = query.groupBy.map((expression) => evaluateExpression(expression, scope));
    const key = JSON.stringify(keyValues);
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  return [...groups.values()];
}

function buildProjection(
  query: Query,
  scope: EvaluationScope,
  schemas: Record<string, string[]>
): ProjectedRow {
  const record: Record<string, unknown> = {};
  const columns: string[] = [];

  for (let index = 0; index < query.select.length; index += 1) {
    const item = query.select[index];
    if (item.type === "all") {
      const expanded = expandStar(scope, schemas, item.qualifier);
      for (const column of expanded.columns) {
        if (!columns.includes(column)) {
          columns.push(column);
        }
        record[column] = expanded.record[column];
      }
      continue;
    }

    const value = evaluateExpression(item.expression, scope);
    const column = item.alias ?? inferColumnName(item, index);
    if (!columns.includes(column)) {
      columns.push(column);
    }
    record[column] = value;
  }

  return {
    record,
    columns,
    scope: {
      ...scope,
      aliasValues: { ...record }
    }
  };
}

function applyOrdering(
  projectedRows: ProjectedRow[],
  orderBy: Query["orderBy"],
  isAggregateQuery: boolean
): ProjectedRow[] {
  if (orderBy.length === 0) {
    return projectedRows;
  }

  return [...projectedRows].sort((left, right) => {
    for (const item of orderBy) {
      const leftValue = evaluateExpression(item.expression, left.scope);
      const rightValue = evaluateExpression(item.expression, right.scope);
      const comparison = compareValues(leftValue, rightValue);
      if (comparison !== 0) {
        return item.direction === "ASC" ? comparison : -comparison;
      }
    }

    if (isAggregateQuery) {
      return 0;
    }

    return 0;
  });
}

function expandStar(
  scope: EvaluationScope,
  schemas: Record<string, string[]>,
  qualifier?: string
): { columns: string[]; record: Record<string, unknown> } {
  const record: Record<string, unknown> = {};
  const columns: string[] = [];
  const sources = qualifier
    ? scope.sources.filter((source) => source.alias === qualifier || source.table === qualifier)
    : scope.sources;

  if (sources.length === 0) {
    throw new Error(`Unknown qualifier "${qualifier}"`);
  }

  const usePrefix = qualifier !== undefined || scope.sources.length > 1;
  for (const source of sources) {
    const row = scope.bindings[source.alias];
    const schema = schemas[source.table] ?? [];
    for (const column of schema) {
      const key = usePrefix ? `${source.alias}.${column}` : column;
      columns.push(key);
      record[key] = row === null ? null : (row?.[column] ?? null);
    }
  }

  return { columns, record };
}

function inferColumnName(item: SelectExpressionItem, index: number): string {
  if (item.expression.type === "column_ref") {
    return item.expression.path[item.expression.path.length - 1];
  }

  if (item.expression.type === "function_call") {
    return item.expression.name.toUpperCase();
  }

  return `expr${index + 1}`;
}

function evaluateExpression(expression: Expression, scope: EvaluationScope): unknown {
  switch (expression.type) {
    case "literal":
      return expression.value;
    case "column_ref":
      return resolveColumn(scope, expression.path);
    case "unary":
      return !isTruthy(evaluateExpression(expression.operand, scope));
    case "binary":
      return evaluateBinaryExpression(expression, scope);
    case "function_call":
      return evaluateFunctionCall(expression, scope);
  }
}

function evaluateBinaryExpression(expression: Extract<Expression, { type: "binary" }>, scope: EvaluationScope): unknown {
  const left = evaluateExpression(expression.left, scope);

  if (expression.operator === "AND") {
    return isTruthy(left) && isTruthy(evaluateExpression(expression.right, scope));
  }

  if (expression.operator === "OR") {
    return isTruthy(left) || isTruthy(evaluateExpression(expression.right, scope));
  }

  const right = evaluateExpression(expression.right, scope);

  switch (expression.operator) {
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
      return likeCompare(left, right);
    default:
      return false;
  }
}

function evaluateFunctionCall(expression: FunctionCallExpression, scope: EvaluationScope): unknown {
  const name = expression.name.toUpperCase();

  if (!expression.isAggregate) {
    throw new Error(`Unsupported function "${expression.name}"`);
  }

  const rows = scope.groupRows;
  if (!rows) {
    throw new Error(`Aggregate function "${expression.name}" requires grouping context`);
  }

  if (name === "COUNT") {
    if (expression.isStar) {
      return rows.length;
    }

    let count = 0;
    for (const row of rows) {
      const value = evaluateExpression(expression.args[0], toScope(row));
      if (value !== null && value !== undefined) {
        count += 1;
      }
    }
    return count;
  }

  const values = rows
    .map((row) => evaluateExpression(expression.args[0], toScope(row)))
    .filter((value) => value !== null && value !== undefined);

  if (name === "SUM") {
    if (values.length === 0) {
      return null;
    }
    return values.reduce((sum, value) => sum + Number(value), 0);
  }

  if (name === "AVG") {
    if (values.length === 0) {
      return null;
    }
    return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
  }

  if (name === "MIN") {
    if (values.length === 0) {
      return null;
    }
    return values.reduce((min, value) => (compareValues(value, min) < 0 ? value : min));
  }

  if (name === "MAX") {
    if (values.length === 0) {
      return null;
    }
    return values.reduce((max, value) => (compareValues(value, max) > 0 ? value : max));
  }

  throw new Error(`Unsupported aggregate "${expression.name}"`);
}

function resolveColumn(scope: EvaluationScope, path: string[]): unknown {
  if (path.length === 1 && scope.aliasValues && Object.hasOwn(scope.aliasValues, path[0])) {
    return scope.aliasValues[path[0]];
  }

  const [head, ...tail] = path;
  if (scope.bindings[head] !== undefined) {
    return getPath(scope.bindings[head], tail);
  }

  const candidates: unknown[] = [];
  for (const source of scope.sources) {
    const row = scope.bindings[source.alias];
    if (row === null) {
      continue;
    }

    if (hasOwn(row, head)) {
      candidates.push(getPath(row, [head, ...tail]));
    }
  }

  if (candidates.length > 1) {
    throw new Error(`Ambiguous column reference "${path.join(".")}"`);
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  return undefined;
}

function toScope(row: JoinedRow, groupRows?: JoinedRow[]): EvaluationScope {
  return {
    bindings: row.bindings,
    sources: row.sources,
    groupRows
  };
}

function createEmptyGroupScope(sources: SourceBinding[]): EvaluationScope {
  const bindings: Record<string, RowObject | null> = {};
  for (const source of sources) {
    bindings[source.alias] = null;
  }
  return { bindings, sources, groupRows: [] };
}

function collectQuerySources(query: Query): SourceBinding[] {
  return [
    { alias: query.from.alias, table: query.from.name },
    ...query.joins.map((join) => ({ alias: join.table.alias, table: join.table.name }))
  ];
}

function containsAggregate(expression: Expression): boolean {
  switch (expression.type) {
    case "literal":
    case "column_ref":
      return false;
    case "unary":
      return containsAggregate(expression.operand);
    case "binary":
      return containsAggregate(expression.left) || containsAggregate(expression.right);
    case "function_call":
      return expression.isAggregate || expression.args.some(containsAggregate);
  }
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }

  if (left === null || left === undefined) {
    return 1;
  }

  if (right === null || right === undefined) {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left < right ? -1 : 1;
  }

  return String(left).localeCompare(String(right));
}

function likeCompare(left: unknown, right: unknown): boolean {
  const value = String(left ?? "");
  const pattern = String(right ?? "");
  const regex = new RegExp(
    `^${escapeRegExp(pattern).replace(/%/g, ".*").replace(/_/g, ".")}$`
  );
  return regex.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTruthy(value: unknown): boolean {
  return Boolean(value);
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function hasOwn(value: unknown, key: string): boolean {
  return value !== null && value !== undefined && Object.prototype.hasOwnProperty.call(value, key);
}

function loadTable(database: Database, name: string): TableData {
  const table = database[name];
  if (!Array.isArray(table)) {
    throw new Error(`Unknown table "${name}"`);
  }
  return table;
}

function buildSchemas(database: Database): Record<string, string[]> {
  const schemas: Record<string, string[]> = {};
  for (const [tableName, rows] of Object.entries(database)) {
    const columns = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        columns.add(key);
      }
    }
    schemas[tableName] = [...columns];
  }
  return schemas;
}

function collectColumns(rows: ProjectedRow[]): string[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const column of row.columns) {
      if (!columns.includes(column)) {
        columns.push(column);
      }
    }
  }
  return columns;
}
