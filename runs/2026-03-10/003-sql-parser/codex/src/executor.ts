import type {
  Expression,
  JsonPrimitive,
  JsonRow,
  Query,
  QueryResult,
  SelectItem,
  TableData,
  TableReference,
} from "./types.js";

interface SourceBinding {
  alias: string;
  table: string;
  row: JsonRow | null;
}

interface JoinedRow {
  bindings: SourceBinding[];
}

interface ResultCandidate {
  projected: JsonRow;
  context: JoinedRow;
  groupRows?: JoinedRow[];
}

interface WildcardColumn {
  alias: string;
  column: string;
  label: string;
}

export function executeQuery(data: TableData, query: Query): QueryResult {
  const wildcardColumns = buildWildcardColumns(query, data);
  const resultColumns = buildResultColumns(query.select, wildcardColumns);
  const joinedRows = executeFromAndJoins(data, query);
  const filteredRows = query.where ? joinedRows.filter((row) => truthy(evaluateExpression(query.where!, row))) : joinedRows;
  const aggregateQuery = isAggregateQuery(query);

  const candidates = aggregateQuery
    ? executeAggregateQuery(filteredRows, query, wildcardColumns)
    : executeScalarQuery(filteredRows, query, wildcardColumns);

  const sortedCandidates = applyOrderBy(candidates, query);
  const offset = query.offset ?? 0;
  const limit = query.limit ?? sortedCandidates.length;
  const rows = sortedCandidates.slice(offset, offset + limit).map((candidate) => candidate.projected);

  return {
    columns: resultColumns,
    rows,
  };
}

function executeFromAndJoins(data: TableData, query: Query): JoinedRow[] {
  const baseRows: JoinedRow[] = getTableRows(data, query.from).map((row) => ({
    bindings: [{ alias: query.from.alias, table: query.from.name, row }],
  }));

  return query.joins.reduce((rows, join) => {
    const rightRows = getTableRows(data, join.table);
    const nextRows: JoinedRow[] = [];

    for (const row of rows) {
      let matched = false;

      for (const rightRow of rightRows) {
        const candidate: JoinedRow = {
          bindings: [...row.bindings, { alias: join.table.alias, table: join.table.name, row: rightRow }],
        };

        if (truthy(evaluateExpression(join.on, candidate))) {
          matched = true;
          nextRows.push(candidate);
        }
      }

      if (join.kind === "left" && !matched) {
        nextRows.push({
          bindings: [...row.bindings, { alias: join.table.alias, table: join.table.name, row: null }],
        });
      }
    }

    return nextRows;
  }, baseRows);
}

function executeScalarQuery(rows: JoinedRow[], query: Query, wildcardColumns: WildcardColumn[]): ResultCandidate[] {
  return rows.map((row) => ({
    projected: projectRow(query.select, row, wildcardColumns),
    context: row,
  }));
}

function executeAggregateQuery(rows: JoinedRow[], query: Query, wildcardColumns: WildcardColumn[]): ResultCandidate[] {
  if (query.select.some((item) => item.kind === "wildcard")) {
    throw new Error("SELECT * is not supported in aggregate queries");
  }

  const emptyContext = createEmptyContext(query);
  const groups = buildGroups(rows, query.groupBy, emptyContext);
  const candidates: ResultCandidate[] = [];

  for (const groupRows of groups) {
    const context = groupRows[0] ?? emptyContext;
    if (query.having && !truthy(evaluateExpression(query.having, context, groupRows))) {
      continue;
    }

    candidates.push({
      projected: projectRow(query.select, context, wildcardColumns, groupRows),
      context,
      groupRows,
    });
  }

  return candidates;
}

function buildGroups(rows: JoinedRow[], groupBy: Expression[], emptyContext: JoinedRow): JoinedRow[][] {
  if (groupBy.length === 0) {
    return [rows];
  }

  const grouped = new Map<string, JoinedRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(groupBy.map((expression) => evaluateExpression(expression, row)));
    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return [...grouped.values()];
}

function applyOrderBy(candidates: ResultCandidate[], query: Query): ResultCandidate[] {
  if (query.orderBy.length === 0) {
    return candidates;
  }

  return [...candidates].sort((left, right) => {
    for (const item of query.orderBy) {
      const leftValue = evaluateOrderExpression(item.expression, left);
      const rightValue = evaluateOrderExpression(item.expression, right);
      const comparison = compareValues(leftValue, rightValue);
      if (comparison !== 0) {
        return item.direction === "asc" ? comparison : -comparison;
      }
    }
    return 0;
  });
}

function evaluateOrderExpression(expression: Expression, candidate: ResultCandidate): JsonPrimitive {
  return evaluateExpression(expression, candidate.context, candidate.groupRows);
}

function projectRow(
  selectItems: SelectItem[],
  context: JoinedRow,
  wildcardColumns: WildcardColumn[],
  groupRows?: JoinedRow[],
): JsonRow {
  const projected: JsonRow = {};

  for (const item of selectItems) {
    if (item.kind === "wildcard") {
      for (const wildcard of wildcardColumns) {
        projected[wildcard.label] = getValueByAlias(context, wildcard.alias, wildcard.column);
      }
      continue;
    }

    projected[item.label] = evaluateExpression(item.expression, context, groupRows);
  }

  return projected;
}

function buildResultColumns(selectItems: SelectItem[], wildcardColumns: WildcardColumn[]): string[] {
  const columns: string[] = [];
  for (const item of selectItems) {
    if (item.kind === "wildcard") {
      columns.push(...wildcardColumns.map((column) => column.label));
      continue;
    }
    columns.push(item.label);
  }
  return columns;
}

function buildWildcardColumns(query: Query, data: TableData): WildcardColumn[] {
  const sources = [query.from, ...query.joins.map((join) => join.table)].map((table) => ({
    alias: table.alias,
    columns: collectTableColumns(getTableRows(data, table)),
  }));

  const nameCounts = new Map<string, number>();
  for (const source of sources) {
    for (const column of source.columns) {
      nameCounts.set(column, (nameCounts.get(column) ?? 0) + 1);
    }
  }

  return sources.flatMap((source) =>
    source.columns.map((column) => ({
      alias: source.alias,
      column,
      label: (nameCounts.get(column) ?? 0) > 1 ? `${source.alias}.${column}` : column,
    })),
  );
}

function collectTableColumns(rows: JsonRow[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];

  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    }
  }

  return columns;
}

function getTableRows(data: TableData, table: TableReference): JsonRow[] {
  const rows = data[table.name];
  if (!rows) {
    throw new Error(`Unknown table "${table.name}"`);
  }
  return rows;
}

function createEmptyContext(query: Query): JoinedRow {
  return {
    bindings: [query.from, ...query.joins.map((join) => join.table)].map((table) => ({
      alias: table.alias,
      table: table.name,
      row: null,
    })),
  };
}

function evaluateExpression(expression: Expression, context: JoinedRow, groupRows?: JoinedRow[]): JsonPrimitive {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "column":
      return resolveColumnValue(context, expression.table, expression.name);
    case "unary":
      return !truthy(evaluateExpression(expression.operand, context, groupRows));
    case "binary":
      if (expression.operator === "and") {
        return truthy(evaluateExpression(expression.left, context, groupRows))
          && truthy(evaluateExpression(expression.right, context, groupRows));
      }
      if (expression.operator === "or") {
        return truthy(evaluateExpression(expression.left, context, groupRows))
          || truthy(evaluateExpression(expression.right, context, groupRows));
      }
      if (expression.operator === "like") {
        const left = evaluateExpression(expression.left, context, groupRows);
        const right = evaluateExpression(expression.right, context, groupRows);
        if (typeof left !== "string" || typeof right !== "string") {
          return false;
        }
        return matchesLike(left, right);
      }
      return compareBinary(
        expression.operator,
        evaluateExpression(expression.left, context, groupRows),
        evaluateExpression(expression.right, context, groupRows),
      );
    case "function":
      if (!groupRows) {
        throw new Error(`Aggregate function ${expression.name} requires GROUP BY or aggregate context`);
      }
      return evaluateAggregate(expression.name, expression.star, expression.args, groupRows);
  }
}

function evaluateAggregate(
  name: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX",
  star: boolean,
  args: Expression[],
  rows: JoinedRow[],
): JsonPrimitive {
  if (name === "COUNT") {
    if (star) {
      return rows.filter((row) => row.bindings.some((binding) => binding.row !== null)).length;
    }
    return rows.reduce((count, row) => {
      const value = evaluateExpression(args[0], row);
      return value === null ? count : count + 1;
    }, 0);
  }

  const values = rows
    .map((row) => evaluateExpression(args[0], row))
    .filter((value): value is Exclude<JsonPrimitive, boolean | null> => value !== null && typeof value !== "boolean");

  if (values.length === 0) {
    return null;
  }

  if (name === "SUM") {
    const numericValues = values.filter((value): value is number => typeof value === "number");
    if (numericValues.length !== values.length) {
      throw new Error("SUM requires numeric values");
    }
    return numericValues.reduce((sum, value) => sum + value, 0);
  }

  if (name === "AVG") {
    const numericValues = values.filter((value): value is number => typeof value === "number");
    if (numericValues.length !== values.length) {
      throw new Error("AVG requires numeric values");
    }
    let total = 0;
    for (const value of numericValues) {
      total += value;
    }
    return total / numericValues.length;
  }

  if (name === "MIN") {
    return values.reduce((current, value) => (compareValues(value, current) < 0 ? value : current));
  }

  return values.reduce((current, value) => (compareValues(value, current) > 0 ? value : current));
}

function resolveColumnValue(context: JoinedRow, table: string | undefined, name: string): JsonPrimitive {
  if (table) {
    const binding = context.bindings.find((candidate) => candidate.alias === table);
    if (!binding) {
      throw new Error(`Unknown table alias "${table}"`);
    }
    return binding.row?.[name] ?? null;
  }

  const matches = context.bindings.filter((binding) => binding.row && Object.hasOwn(binding.row, name));
  if (matches.length === 0) {
    throw new Error(`Unknown column "${name}"`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous column "${name}"`);
  }
  return matches[0].row?.[name] ?? null;
}

function getValueByAlias(context: JoinedRow, alias: string, column: string): JsonPrimitive {
  const binding = context.bindings.find((candidate) => candidate.alias === alias);
  if (!binding) {
    throw new Error(`Unknown table alias "${alias}"`);
  }
  return binding.row?.[column] ?? null;
}

function compareBinary(
  operator: "=" | "!=" | "<" | ">" | "<=" | ">=",
  left: JsonPrimitive,
  right: JsonPrimitive,
): boolean {
  switch (operator) {
    case "=":
      return left === right;
    case "!=":
      return left !== right;
    case "<":
      return compareValues(left, right) < 0;
    case ">":
      return compareValues(left, right) > 0;
    case "<=":
      return compareValues(left, right) <= 0;
    case ">=":
      return compareValues(left, right) >= 0;
  }
}

function compareValues(left: JsonPrimitive, right: JsonPrimitive): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right), "ja");
}

function matchesLike(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`, "u").test(value);
}

function truthy(value: JsonPrimitive): boolean {
  return value === true || (value !== null && value !== false && value !== 0 && value !== "");
}

function isAggregateQuery(query: Query): boolean {
  return query.groupBy.length > 0
    || query.select.some((item) => item.kind === "expression" && hasAggregate(item.expression))
    || (query.having ? hasAggregate(query.having) : false)
    || query.orderBy.some((item) => hasAggregate(item.expression));
}

function hasAggregate(expression: Expression): boolean {
  switch (expression.kind) {
    case "function":
      return true;
    case "binary":
      return hasAggregate(expression.left) || hasAggregate(expression.right);
    case "unary":
      return hasAggregate(expression.operand);
    default:
      return false;
  }
}
