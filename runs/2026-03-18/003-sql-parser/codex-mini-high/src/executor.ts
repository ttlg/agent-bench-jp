import type {
  DataSet,
  Expression,
  GroupContext,
  JsonValue,
  ParsedQuery,
  QueryResultRow,
  RowContext,
  RowSource,
  SelectItem,
} from './types.ts';

interface EvaluatedSelect {
  name: string;
  value: JsonValue;
}

export function executeQuery(data: DataSet, query: ParsedQuery): QueryResultRow[] {
  const initialRows = buildRowsForTable(data, query.from.table, query.from.alias);
  let rows = initialRows;

  for (const join of query.joins) {
    rows = applyJoin(data, rows, join);
  }

  if (query.where) {
    rows = rows.filter((row) => truthy(evalExpr(query.where!, row, null)));
  }

  const usesAggregation = query.groupBy.length > 0 || containsAggregateSelect(query.select) || containsAggregateExpr(query.having) || query.orderBy.some((item) => containsAggregateExpr(item.expr));

  if (query.groupBy.length > 0 || usesAggregation) {
    const groups = groupRows(rows, query.groupBy);
    const filteredGroups = query.having ? groups.filter((group) => truthy(evalExpr(query.having!, group.rows[0] ?? emptyRowContext(), group))) : groups;
    const items = filteredGroups.map((group, index) => ({
      group,
      projected: projectGroupedRow(group, query.select),
      index,
    }));
    if (query.orderBy.length > 0) {
      items.sort((a, b) => compareItems(a.group.rows[0] ?? emptyRowContext(), a.group, b.group.rows[0] ?? emptyRowContext(), b.group, query.orderBy));
    }
    return sliceRows(items.map((item) => item.projected), query.limit, query.offset);
  }

  const items = rows.map((row, index) => ({
    row,
    projected: projectRow(row, query.select),
    index,
  }));
  if (query.orderBy.length > 0) {
    items.sort((a, b) => compareItems(a.row, null, b.row, null, query.orderBy));
  }
  return sliceRows(items.map((item) => item.projected), query.limit, query.offset);
}

function buildRowsForTable(data: DataSet, table: string, alias: string | null): RowContext[] {
  const rows = data[table];
  if (!rows) {
    throw new Error(`Unknown table: ${table}`);
  }
  const sourceAlias = alias ?? table;
  const columns = collectColumns(rows);
  return rows.map((row) => ({
    sources: [{ table, alias: sourceAlias, row, columns }],
  }));
}

function applyJoin(data: DataSet, leftRows: RowContext[], join: { type: 'inner' | 'left'; table: string; alias: string | null; on: Expression }): RowContext[] {
  const rightRows = buildRowsForTable(data, join.table, join.alias);
  const result: RowContext[] = [];

  for (const left of leftRows) {
    let matched = false;
    for (const right of rightRows) {
      const merged: RowContext = { sources: [...left.sources, ...right.sources] };
      if (truthy(evalExpr(join.on, merged, null))) {
        matched = true;
        result.push(merged);
      }
    }
    if (!matched && join.type === 'left') {
      const nullSource: RowSource = {
        table: join.table,
        alias: join.alias ?? join.table,
        row: null,
        columns: rightRows[0]?.sources[0]?.columns ?? collectColumns(data[join.table] ?? []),
      };
      result.push({ sources: [...left.sources, nullSource] });
    }
  }

  return result;
}

function groupRows(rows: RowContext[], groupBy: Expression[]): GroupContext[] {
  if (groupBy.length === 0) {
    return [{ rows, key: [] }];
  }

  const groups = new Map<string, GroupContext>();
  for (const row of rows) {
    const keyValues = groupBy.map((expr) => evalExpr(expr, row, null));
    const key = JSON.stringify(keyValues);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, { rows: [row], key: keyValues });
    }
  }
  return [...groups.values()];
}

function projectRow(row: RowContext, select: SelectItem[]): QueryResultRow {
  if (select.length === 1 && select[0].type === 'star') {
    return expandStar(row);
  }
  const projected: QueryResultRow = {};
  for (const item of select) {
    if (item.type === 'star') {
      Object.assign(projected, expandStar(row));
      continue;
    }
    const value = evalExpr(item.expr, row, null);
    const name = item.alias ?? expressionLabel(item.expr);
    projected[name] = value;
  }
  return projected;
}

function projectGroupedRow(group: GroupContext, select: SelectItem[]): QueryResultRow {
  const representative = group.rows[0] ?? emptyRowContext();
  if (select.length === 1 && select[0].type === 'star') {
    return expandStar(representative);
  }
  const projected: QueryResultRow = {};
  for (const item of select) {
    if (item.type === 'star') {
      Object.assign(projected, expandStar(representative));
      continue;
    }
    const value = evalExpr(item.expr, representative, group);
    const name = item.alias ?? expressionLabel(item.expr);
    projected[name] = value;
  }
  return projected;
}

function expandStar(row: RowContext): QueryResultRow {
  const output: QueryResultRow = {};
  const singleSource = row.sources.length === 1;
  for (const source of row.sources) {
    if (!source.row) {
      for (const column of source.columns) {
        output[singleSource ? column : `${source.alias}.${column}`] = null;
      }
      continue;
    }
    for (const [key, value] of Object.entries(source.row)) {
      if (singleSource) {
        output[key] = value;
      } else {
        output[`${source.alias}.${key}`] = value;
      }
    }
  }
  return output;
}

function getRepresentativeRow(group: GroupContext): RowContext {
  return group.rows[0] ?? emptyRowContext();
}

function sliceRows(rows: QueryResultRow[], limit: number | null, offset: number | null): QueryResultRow[] {
  const start = offset ?? 0;
  if (limit === null) {
    return rows.slice(start);
  }
  return rows.slice(start, start + limit);
}

function evalExpr(expr: Expression, row: RowContext, group: GroupContext | null): JsonValue {
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'star':
      return null;
    case 'column':
      return resolveColumn(expr, row);
    case 'group':
      return evalExpr(expr.expr, row, group);
    case 'unary':
      if (expr.op === 'NOT') {
        return !truthy(evalExpr(expr.expr, row, group));
      }
      return negate(evalExpr(expr.expr, row, group));
    case 'binary':
      return evalBinary(expr.op, evalExpr(expr.left, row, group), evalExpr(expr.right, row, group));
    case 'function':
      return evalFunction(expr.name, expr.args, row, group);
  }
}

function evalBinary(op: string, left: JsonValue, right: JsonValue): JsonValue {
  switch (op) {
    case 'OR':
      return truthy(left) || truthy(right);
    case 'AND':
      return truthy(left) && truthy(right);
    case '=':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return compareValues(left, right) < 0;
    case '>':
      return compareValues(left, right) > 0;
    case '<=':
      return compareValues(left, right) <= 0;
    case '>=':
      return compareValues(left, right) >= 0;
    case 'LIKE':
      return likeMatch(String(left ?? ''), String(right ?? ''));
    default:
      throw new Error(`Unsupported operator: ${op}`);
  }
}

function evalFunction(name: string, args: Expression[], row: RowContext, group: GroupContext | null): JsonValue {
  const upper = name.toUpperCase();
  const rows = group?.rows ?? [row];

  switch (upper) {
    case 'COUNT':
      if (args.length === 1 && args[0].type === 'star') {
        return rows.length;
      }
      return rows.reduce((count, current) => {
        const value = evalExpr(args[0] ?? { type: 'literal', value: null }, current, group);
        return value === null ? count : count + 1;
      }, 0);
    case 'SUM': {
      const values = rows.map((current) => evalExpr(args[0], current, group)).filter((value): value is number => typeof value === 'number');
      if (values.length === 0) {
        return null;
      }
      return values.reduce((sum, value) => sum + value, 0);
    }
    case 'AVG': {
      const values = rows.map((current) => evalExpr(args[0], current, group)).filter((value): value is number => typeof value === 'number');
      if (values.length === 0) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    case 'MIN': {
      const values = rows.map((current) => evalExpr(args[0], current, group)).filter((value) => value !== null);
      return values.reduce((min, value) => (min === null || compareValues(value, min) < 0 ? value : min), null as JsonValue);
    }
    case 'MAX': {
      const values = rows.map((current) => evalExpr(args[0], current, group)).filter((value) => value !== null);
      return values.reduce((max, value) => (max === null || compareValues(value, max) > 0 ? value : max), null as JsonValue);
    }
    default:
      throw new Error(`Unsupported function: ${name}`);
  }
}

function resolveColumn(expr: Extract<Expression, { type: 'column' }>, row: RowContext): JsonValue {
  const matches = row.sources
    .filter((source) => source.row !== null)
    .filter((source) => (expr.table ? source.alias === expr.table || source.table === expr.table : true))
    .filter((source) => source.row !== null && Object.prototype.hasOwnProperty.call(source.row, expr.column))
    .map((source) => source.row![expr.column]);

  if (matches.length === 0) {
    return null;
  }
  if (expr.table || matches.length === 1) {
    return matches[0];
  }
  throw new Error(`Ambiguous column reference: ${expr.column}`);
}

function compareValues(left: JsonValue, right: JsonValue): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'en');
}

function compareItems(leftRow: RowContext, leftGroup: GroupContext | null, rightRow: RowContext, rightGroup: GroupContext | null, orderBy: { expr: Expression; direction: 'asc' | 'desc' }[]): number {
  for (const item of orderBy) {
    const leftValue = evalExpr(item.expr, leftRow, leftGroup);
    const rightValue = evalExpr(item.expr, rightRow, rightGroup);
    const comparison = compareValues(leftValue, rightValue);
    if (comparison !== 0) {
      return item.direction === 'asc' ? comparison : -comparison;
    }
  }
  return 0;
}

function truthy(value: JsonValue): boolean {
  return Boolean(value);
}

function negate(value: JsonValue): JsonValue {
  if (typeof value === 'number') {
    return -value;
  }
  throw new Error('Unary minus expects a numeric value');
}

function likeMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function containsAggregateSelect(select: SelectItem[]): boolean {
  return select.some((item) => item.type === 'expr' && containsAggregateExpr(item.expr));
}

function containsAggregateExpr(expr: Expression | null): boolean {
  if (!expr) return false;
  switch (expr.type) {
    case 'function':
      return ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(expr.name.toUpperCase()) || expr.args.some(containsAggregateExpr);
    case 'binary':
      return containsAggregateExpr(expr.left) || containsAggregateExpr(expr.right);
    case 'unary':
      return containsAggregateExpr(expr.expr);
    case 'group':
      return containsAggregateExpr(expr.expr);
    default:
      return false;
  }
}

function expressionLabel(expr: Expression): string {
  switch (expr.type) {
    case 'column':
      return expr.table ? `${expr.table}.${expr.column}` : expr.column;
    case 'function':
      return `${expr.name.toUpperCase()}(${expr.args.map(expressionLabel).join(', ')})`;
    case 'literal':
      return String(expr.value);
    case 'star':
      return '*';
    case 'group':
      return `(${expressionLabel(expr.expr)})`;
    case 'binary':
      return `${expressionLabel(expr.left)} ${expr.op} ${expressionLabel(expr.right)}`;
    case 'unary':
      return `${expr.op} ${expressionLabel(expr.expr)}`;
  }
}

function emptyRowContext(): RowContext {
  return { sources: [] };
}

function collectColumns(rows: Array<Record<string, JsonValue>>): string[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) {
        columns.push(key);
      }
    }
  }
  return columns;
}
