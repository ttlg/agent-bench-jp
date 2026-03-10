import {
  SelectStatement,
  Expression,
  SelectColumn,
  ColumnRef,
  JoinClause,
  OrderByItem,
  AggregateColumn,
} from './parser';

type Row = Record<string, any>;
type Database = Record<string, Row[]>;

export function execute(stmt: SelectStatement, db: Database): Row[] {
  const tableName = stmt.from.table;
  if (!db[tableName]) {
    throw new Error(`Table '${tableName}' not found`);
  }

  const alias = stmt.from.alias || tableName;
  let rows: Row[] = db[tableName].map((row) => {
    const result: Row = {};
    for (const [key, value] of Object.entries(row)) {
      result[`${alias}.${key}`] = value;
      result[key] = value;
    }
    return result;
  });

  for (const join of stmt.joins) {
    rows = executeJoin(rows, join, db);
  }

  if (stmt.where) {
    rows = rows.filter((row) => evaluateExpression(stmt.where!, row));
  }

  const isAggregate = stmt.groupBy.length > 0 || hasAggregates(stmt.columns);

  if (isAggregate) {
    rows = executeGroupBy(rows, stmt);
  }

  if (stmt.orderBy.length > 0) {
    rows = executeOrderBy(rows, stmt.orderBy);
  }

  if (stmt.offset !== null) {
    rows = rows.slice(stmt.offset);
  }
  if (stmt.limit !== null) {
    rows = rows.slice(0, stmt.limit);
  }

  if (!isAggregate) {
    rows = projectColumns(rows, stmt.columns, stmt.joins.length > 0);
  }

  return rows;
}

function executeJoin(leftRows: Row[], join: JoinClause, db: Database): Row[] {
  const rightTable = join.table.table;
  if (!db[rightTable]) {
    throw new Error(`Table '${rightTable}' not found`);
  }

  const rightAlias = join.table.alias || rightTable;
  const rightData = db[rightTable];
  const result: Row[] = [];

  for (const leftRow of leftRows) {
    let matched = false;
    for (const rightOriginal of rightData) {
      const combined: Row = { ...leftRow };
      for (const [key, value] of Object.entries(rightOriginal)) {
        combined[`${rightAlias}.${key}`] = value;
      }
      if (evaluateExpression(join.condition, combined)) {
        result.push(combined);
        matched = true;
      }
    }
    if (!matched && join.type === 'LEFT') {
      const combined: Row = { ...leftRow };
      if (rightData.length > 0) {
        for (const key of Object.keys(rightData[0])) {
          combined[`${rightAlias}.${key}`] = null;
        }
      }
      result.push(combined);
    }
  }

  return result;
}

function resolveColumnValue(
  row: Row,
  table: string | undefined,
  column: string
): any {
  if (table) {
    const key = `${table}.${column}`;
    if (key in row) return row[key];
  }
  if (column in row) return row[column];
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith(`.${column}`)) return value;
  }
  return undefined;
}

function evaluateExpression(expr: Expression, row: Row): any {
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'column_ref':
      return resolveColumnValue(row, expr.table, expr.column);
    case 'binary': {
      const left = evaluateExpression(expr.left, row);
      const right = evaluateExpression(expr.right, row);
      switch (expr.operator) {
        case '=':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return left < right;
        case '>':
          return left > right;
        case '<=':
          return left <= right;
        case '>=':
          return left >= right;
        case 'AND':
          return left && right;
        case 'OR':
          return left || right;
        case 'LIKE':
          return matchLike(String(left), String(right));
      }
      break;
    }
    case 'unary':
      if (expr.operator === 'NOT') {
        return !evaluateExpression(expr.operand, row);
      }
      break;
    case 'aggregate':
      throw new Error(
        'Aggregate functions cannot be used outside GROUP BY context'
      );
  }
}

function matchLike(value: string, pattern: string): boolean {
  let regexStr = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '%') {
      regexStr += '.*';
    } else if (/[.*+?^${}()|[\]\\]/.test(ch)) {
      regexStr += '\\' + ch;
    } else {
      regexStr += ch;
    }
  }
  return new RegExp(`^${regexStr}$`, 'u').test(value);
}

function hasAggregates(columns: SelectColumn[]): boolean {
  return columns.some((col) => col.type === 'aggregate');
}

function executeGroupBy(rows: Row[], stmt: SelectStatement): Row[] {
  const groups = new Map<string, Row[]>();

  if (stmt.groupBy.length === 0) {
    groups.set('__all__', rows);
  } else {
    for (const row of rows) {
      const key = stmt.groupBy
        .map((col) => String(resolveColumnValue(row, col.table, col.column)))
        .join('\0');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(row);
    }
  }

  const result: Row[] = [];

  for (const [, groupRows] of groups) {
    const resultRow: Row = {};

    for (const col of stmt.columns) {
      if (col.type === 'column_ref') {
        const value = resolveColumnValue(
          groupRows[0],
          col.table,
          col.column
        );
        const key = col.table ? `${col.table}.${col.column}` : col.column;
        resultRow[key] = value;
      } else if (col.type === 'aggregate') {
        const key = formatAggregateKey(col);
        resultRow[key] = computeAggregate(col.func, col.argument, groupRows);
      }
    }

    if (stmt.having) {
      if (!evaluateHaving(stmt.having, groupRows)) continue;
    }

    result.push(resultRow);
  }

  return result;
}

function formatAggregateKey(col: AggregateColumn): string {
  if (col.argument.type === 'star') {
    return `${col.func}(*)`;
  }
  const arg = col.argument as ColumnRef;
  const argStr = arg.table ? `${arg.table}.${arg.column}` : arg.column;
  return `${col.func}(${argStr})`;
}

function computeAggregate(
  func: string,
  argument: any,
  rows: Row[]
): number {
  if (func === 'COUNT') {
    if (argument.type === 'star') return rows.length;
    return rows.filter((r) => {
      const v = resolveColumnValue(r, argument.table, argument.column);
      return v !== null && v !== undefined;
    }).length;
  }

  const values = rows
    .map((r) => resolveColumnValue(r, argument.table, argument.column))
    .filter((v) => v !== null && v !== undefined) as number[];

  switch (func) {
    case 'SUM':
      return values.reduce((a, b) => a + b, 0);
    case 'AVG':
      return values.length > 0
        ? values.reduce((a, b) => a + b, 0) / values.length
        : 0;
    case 'MIN':
      return Math.min(...values);
    case 'MAX':
      return Math.max(...values);
    default:
      throw new Error(`Unknown aggregate function: ${func}`);
  }
}

function evaluateHaving(expr: Expression, groupRows: Row[]): boolean {
  return !!evaluateHavingValue(expr, groupRows);
}

function evaluateHavingValue(expr: Expression, groupRows: Row[]): any {
  switch (expr.type) {
    case 'aggregate': {
      const argument =
        expr.argument.type === 'star'
          ? { type: 'star' }
          : expr.argument;
      return computeAggregate(expr.func, argument, groupRows);
    }
    case 'literal':
      return expr.value;
    case 'column_ref':
      return resolveColumnValue(groupRows[0], expr.table, expr.column);
    case 'binary': {
      const left = evaluateHavingValue(expr.left, groupRows);
      const right = evaluateHavingValue(expr.right, groupRows);
      switch (expr.operator) {
        case '=':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return left < right;
        case '>':
          return left > right;
        case '<=':
          return left <= right;
        case '>=':
          return left >= right;
        case 'AND':
          return left && right;
        case 'OR':
          return left || right;
        default:
          return false;
      }
    }
    case 'unary':
      if (expr.operator === 'NOT') {
        return !evaluateHavingValue(expr.operand, groupRows);
      }
      return false;
  }
}

function projectColumns(
  rows: Row[],
  columns: SelectColumn[],
  hasJoins: boolean
): Row[] {
  if (columns.length === 1 && columns[0].type === 'star') {
    return rows.map((row) => {
      const result: Row = {};
      if (hasJoins) {
        for (const [key, value] of Object.entries(row)) {
          if (key.includes('.')) {
            result[key] = value;
          }
        }
      } else {
        for (const [key, value] of Object.entries(row)) {
          if (!key.includes('.')) {
            result[key] = value;
          }
        }
      }
      return result;
    });
  }

  return rows.map((row) => {
    const result: Row = {};
    for (const col of columns) {
      if (col.type === 'star') {
        for (const [key, value] of Object.entries(row)) {
          if (!key.includes('.')) {
            result[key] = value;
          }
        }
      } else if (col.type === 'column_ref') {
        const value = resolveColumnValue(row, col.table, col.column);
        const key = col.table ? `${col.table}.${col.column}` : col.column;
        result[key] = value;
      }
    }
    return result;
  });
}

function executeOrderBy(rows: Row[], orderBy: OrderByItem[]): Row[] {
  return [...rows].sort((a, b) => {
    for (const item of orderBy) {
      const aVal = resolveColumnValue(a, item.column.table, item.column.column);
      const bVal = resolveColumnValue(b, item.column.table, item.column.column);
      let cmp = 0;
      if (aVal < bVal) cmp = -1;
      else if (aVal > bVal) cmp = 1;
      if (cmp !== 0) {
        return item.direction === 'DESC' ? -cmp : cmp;
      }
    }
    return 0;
  });
}
