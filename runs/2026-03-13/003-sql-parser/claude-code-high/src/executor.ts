import {
  SelectStatement,
  WhereExpr,
  ColumnRef,
  SelectItem,
  AggregateFn,
  CompareExpr,
  OrderByItem,
} from './ast';

export type Row = Record<string, unknown>;
export type DataSet = Record<string, Row[]>;

export function execute(stmt: SelectStatement, data: DataSet): Row[] {
  // 1. FROM
  const tableName = stmt.from.table;
  const tableData = data[tableName];
  if (!tableData) {
    throw new Error(`Table '${tableName}' not found`);
  }

  const fromAlias = stmt.from.alias || tableName;

  // Build aliased rows
  let rows: Row[] = tableData.map(row => prefixRow(row, fromAlias));

  // 2. JOINs
  for (const join of stmt.joins) {
    const joinTable = data[join.table];
    if (!joinTable) {
      throw new Error(`Table '${join.table}' not found`);
    }
    const joinAlias = join.alias || join.table;

    if (join.type === 'INNER') {
      const result: Row[] = [];
      for (const leftRow of rows) {
        for (const rightRow of joinTable) {
          const prefixed = prefixRow(rightRow, joinAlias);
          const combined = { ...leftRow, ...prefixed };
          if (evaluateCompare(join.on, combined)) {
            result.push(combined);
          }
        }
      }
      rows = result;
    } else if (join.type === 'LEFT') {
      const result: Row[] = [];
      for (const leftRow of rows) {
        let matched = false;
        for (const rightRow of joinTable) {
          const prefixed = prefixRow(rightRow, joinAlias);
          const combined = { ...leftRow, ...prefixed };
          if (evaluateCompare(join.on, combined)) {
            result.push(combined);
            matched = true;
          }
        }
        if (!matched) {
          // Add nulls for the right side
          const nullRow: Row = {};
          if (joinTable.length > 0) {
            for (const key of Object.keys(joinTable[0])) {
              nullRow[`${joinAlias}.${key}`] = null;
            }
          }
          result.push({ ...leftRow, ...nullRow });
        }
      }
      rows = result;
    }
  }

  // 3. WHERE
  if (stmt.where) {
    rows = rows.filter(row => evaluateWhere(stmt.where!, row));
  }

  // 4. GROUP BY
  if (stmt.groupBy && stmt.groupBy.length > 0) {
    const groupByCols: ColumnRef[] = stmt.groupBy;
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = groupByCols.map(col => String(resolveColumnValue(col, row))).join('|');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(row);
    }

    // Build grouped result rows
    const groupedRows: Row[] = [];
    for (const [, groupRows] of groups) {
      const resultRow: Row = {};

      // Add GROUP BY columns
      for (const col of groupByCols) {
        const colName = col.column;
        resultRow[colName] = resolveColumnValue(col, groupRows[0]);
      }

      // Compute aggregates
      for (const item of stmt.columns) {
        if (item.type === 'aggregate') {
          const aggKey = formatAggKey(item);
          resultRow[aggKey] = computeAggregate(item, groupRows);
        }
      }

      groupedRows.push(resultRow);
    }

    rows = groupedRows;

    // 5. HAVING
    if (stmt.having) {
      rows = rows.filter(row => evaluateHavingExpr(stmt.having!, row));
    }

    // 6. ORDER BY
    if (stmt.orderBy) {
      rows = applyOrderBy(rows, stmt.orderBy);
    }

    // 7. LIMIT / OFFSET
    rows = applyLimitOffset(rows, stmt.limit, stmt.offset);

    return rows;
  }

  // Check if this is an aggregate query without GROUP BY (e.g., SELECT COUNT(*) FROM users)
  const hasAggregates = stmt.columns.some(c => c.type === 'aggregate');
  if (hasAggregates && !stmt.groupBy) {
    const resultRow: Row = {};
    for (const item of stmt.columns) {
      if (item.type === 'aggregate') {
        const aggKey = formatAggKey(item);
        resultRow[aggKey] = computeAggregate(item, rows);
      }
    }
    return [resultRow];
  }

  // 6. ORDER BY
  if (stmt.orderBy) {
    rows = applyOrderBy(rows, stmt.orderBy);
  }

  // 7. LIMIT / OFFSET
  rows = applyLimitOffset(rows, stmt.limit, stmt.offset);

  // 8. SELECT projection
  rows = projectColumns(rows, stmt.columns, stmt.from.alias || stmt.from.table);

  return rows;
}

function prefixRow(row: Row, alias: string): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(row)) {
    result[`${alias}.${key}`] = value;
  }
  return result;
}

function resolveColumnValue(col: ColumnRef, row: Row): unknown {
  if (col.table) {
    const key = `${col.table}.${col.column}`;
    if (key in row) return row[key];
  }

  // Try direct match
  if (col.column in row) return row[col.column];

  // Search by column name in prefixed keys
  for (const [key, value] of Object.entries(row)) {
    const parts = key.split('.');
    if (parts.length === 2 && parts[1] === col.column) {
      return value;
    }
  }

  return undefined;
}

function evaluateCompare(expr: CompareExpr, row: Row): boolean {
  let leftVal: unknown;
  if (expr.left.type === 'column_ref') {
    leftVal = resolveColumnValue(expr.left, row);
  } else if (expr.left.type === 'aggregate') {
    const aggKey = formatAggKey(expr.left);
    leftVal = row[aggKey];
  }

  let rightVal: unknown;
  if (expr.right.type === 'column_ref') {
    rightVal = resolveColumnValue(expr.right, row);
  } else if (expr.right.type === 'number') {
    rightVal = expr.right.value;
  } else if (expr.right.type === 'string') {
    rightVal = expr.right.value;
  }

  return compare(leftVal, expr.op, rightVal);
}

function compare(left: unknown, op: string, right: unknown): boolean {
  // Handle null values
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }

  const l = typeof left === 'string' ? left : Number(left);
  const r = typeof right === 'string' ? right : Number(right);

  switch (op) {
    case '=': return l === r;
    case '!=': return l !== r;
    case '<': return l < r;
    case '>': return l > r;
    case '<=': return l <= r;
    case '>=': return l >= r;
    default: throw new Error(`Unknown operator: ${op}`);
  }
}

function evaluateWhere(expr: WhereExpr, row: Row): boolean {
  switch (expr.type) {
    case 'compare':
      return evaluateCompare(expr, row);
    case 'like': {
      const val = resolveColumnValue(expr.left, row);
      if (typeof val !== 'string') return false;
      const pattern = expr.pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*');
      return new RegExp(`^${pattern}$`).test(val);
    }
    case 'and':
      return evaluateWhere(expr.left, row) && evaluateWhere(expr.right, row);
    case 'or':
      return evaluateWhere(expr.left, row) || evaluateWhere(expr.right, row);
    case 'not':
      return !evaluateWhere(expr.expr, row);
    default:
      throw new Error(`Unknown expression type`);
  }
}

function evaluateHavingExpr(expr: WhereExpr, row: Row): boolean {
  switch (expr.type) {
    case 'compare': {
      let leftVal: unknown;
      if (expr.left.type === 'aggregate') {
        const aggKey = formatAggKey(expr.left);
        leftVal = row[aggKey];
      } else if (expr.left.type === 'column_ref') {
        leftVal = resolveColumnValue(expr.left, row);
      }

      let rightVal: unknown;
      if (expr.right.type === 'number') {
        rightVal = expr.right.value;
      } else if (expr.right.type === 'string') {
        rightVal = expr.right.value;
      } else if (expr.right.type === 'column_ref') {
        rightVal = resolveColumnValue(expr.right, row);
      }

      return compare(leftVal, expr.op, rightVal);
    }
    case 'and':
      return evaluateHavingExpr(expr.left, row) && evaluateHavingExpr(expr.right, row);
    case 'or':
      return evaluateHavingExpr(expr.left, row) || evaluateHavingExpr(expr.right, row);
    case 'not':
      return !evaluateHavingExpr(expr.expr, row);
    default:
      return evaluateWhere(expr, row);
  }
}

function formatAggKey(agg: AggregateFn): string {
  if (agg.arg.type === 'star') {
    return `${agg.fn}(*)`;
  }
  return `${agg.fn}(${agg.arg.column})`;
}

function computeAggregate(agg: AggregateFn, rows: Row[]): unknown {
  if (agg.fn === 'COUNT') {
    if (agg.arg.type === 'star') {
      return rows.length;
    }
    return rows.filter(r => resolveColumnValue(agg.arg as ColumnRef, r) !== null && resolveColumnValue(agg.arg as ColumnRef, r) !== undefined).length;
  }

  const values = rows
    .map(r => resolveColumnValue(agg.arg as ColumnRef, r))
    .filter(v => v !== null && v !== undefined)
    .map(v => Number(v));

  switch (agg.fn) {
    case 'SUM':
      return values.reduce((a, b) => a + b, 0);
    case 'AVG':
      return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
    case 'MIN':
      return values.length === 0 ? null : Math.min(...values);
    case 'MAX':
      return values.length === 0 ? null : Math.max(...values);
    default:
      throw new Error(`Unknown aggregate function: ${agg.fn}`);
  }
}

function applyOrderBy(rows: Row[], orderBy: OrderByItem[]): Row[] {
  return [...rows].sort((a, b) => {
    for (const item of orderBy) {
      const aVal = resolveColumnValue(item.column, a);
      const bVal = resolveColumnValue(item.column, b);

      let cmp = 0;
      if (aVal === null || aVal === undefined) cmp = -1;
      else if (bVal === null || bVal === undefined) cmp = 1;
      else if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = Number(aVal) - Number(bVal);
      }

      if (cmp !== 0) {
        return item.direction === 'DESC' ? -cmp : cmp;
      }
    }
    return 0;
  });
}

function applyLimitOffset(rows: Row[], limit?: number, offset?: number): Row[] {
  const start = offset || 0;
  if (limit !== undefined) {
    return rows.slice(start, start + limit);
  }
  if (start > 0) {
    return rows.slice(start);
  }
  return rows;
}

function projectColumns(rows: Row[], columns: SelectItem[], fromAlias: string): Row[] {
  return rows.map(row => {
    const result: Row = {};

    for (const col of columns) {
      if (col.type === 'star') {
        // Add all columns, stripping prefix
        for (const [key, value] of Object.entries(row)) {
          const parts = key.split('.');
          if (parts.length === 2) {
            result[parts[1]] = value;
          } else {
            result[key] = value;
          }
        }
      } else if (col.type === 'column_ref') {
        const val = resolveColumnValue(col, row);
        const name = col.table ? `${col.table}.${col.column}` : col.column;
        result[name] = val;
      } else if (col.type === 'aggregate') {
        const aggKey = formatAggKey(col);
        result[aggKey] = row[aggKey];
      }
    }

    return result;
  });
}
