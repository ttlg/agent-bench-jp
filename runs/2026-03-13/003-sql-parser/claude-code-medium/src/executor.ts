import {
  SelectStatement,
  Expression,
  SelectItem,
  isFunctionCall,
  isColumnRef,
  isStar,
  ColumnRef,
  FunctionCall,
} from './parser';

type Row = Record<string, any>;
type Database = Record<string, Row[]>;

export function execute(stmt: SelectStatement, db: Database): Row[] {
  // Resolve table aliases
  const aliasMap: Record<string, string> = {}; // alias -> table name
  const mainTable = stmt.from.table;
  const mainAlias = stmt.from.alias || mainTable;
  aliasMap[mainAlias] = mainTable;

  if (!db[mainTable]) {
    throw new Error(`Table '${mainTable}' not found`);
  }

  // Start with the main table rows, prefixed with alias
  let rows: Row[] = db[mainTable].map(row => prefixRow(row, mainAlias));

  // Process JOINs
  for (const join of stmt.joins) {
    const joinAlias = join.alias || join.table;
    aliasMap[joinAlias] = join.table;

    if (!db[join.table]) {
      throw new Error(`Table '${join.table}' not found`);
    }

    const joinRows = db[join.table];
    const newRows: Row[] = [];

    for (const leftRow of rows) {
      let matched = false;
      for (const rightRow of joinRows) {
        const prefixed = prefixRow(rightRow, joinAlias);
        const combined = { ...leftRow, ...prefixed };
        if (evaluateExpression(join.on, combined)) {
          newRows.push(combined);
          matched = true;
        }
      }
      if (!matched && join.type === 'LEFT') {
        // Add left row with nulls for right columns
        const nullRight: Row = {};
        if (joinRows.length > 0) {
          for (const key of Object.keys(joinRows[0])) {
            nullRight[`${joinAlias}.${key}`] = null;
          }
        }
        newRows.push({ ...leftRow, ...nullRight });
      }
    }
    rows = newRows;
  }

  // WHERE
  if (stmt.where) {
    rows = rows.filter(row => evaluateExpression(stmt.where!, row));
  }

  // GROUP BY
  if (stmt.groupBy || hasAggregate(stmt.columns)) {
    rows = executeGroupBy(rows, stmt, aliasMap);
  } else {
    // Project columns
    rows = projectColumns(rows, stmt.columns, aliasMap);
  }

  // ORDER BY
  if (stmt.orderBy) {
    rows = rows.slice().sort((a, b) => {
      for (const item of stmt.orderBy!) {
        const key = item.column.table
          ? `${item.column.table}.${item.column.column}`
          : item.column.column;

        // Find the actual key in the row
        const aVal = resolveValue(a, key);
        const bVal = resolveValue(b, key);

        let cmp = 0;
        if (aVal == null && bVal == null) cmp = 0;
        else if (aVal == null) cmp = -1;
        else if (bVal == null) cmp = 1;
        else if (typeof aVal === 'number' && typeof bVal === 'number') cmp = aVal - bVal;
        else cmp = String(aVal).localeCompare(String(bVal));

        if (cmp !== 0) return item.direction === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });
  }

  // OFFSET
  if (stmt.offset !== undefined) {
    rows = rows.slice(stmt.offset);
  }

  // LIMIT
  if (stmt.limit !== undefined) {
    rows = rows.slice(0, stmt.limit);
  }

  return rows;
}

function prefixRow(row: Row, alias: string): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(row)) {
    result[`${alias}.${key}`] = value;
  }
  return result;
}

function resolveValue(row: Row, key: string): any {
  // Direct match
  if (key in row) return row[key];
  // Try without table prefix (find first match)
  for (const [k, v] of Object.entries(row)) {
    const parts = k.split('.');
    if (parts[parts.length - 1] === key) return v;
  }
  return undefined;
}

function resolveColumnValue(row: Row, col: { table?: string; column: string }): any {
  if (col.table) {
    const key = `${col.table}.${col.column}`;
    if (key in row) return row[key];
  }
  return resolveValue(row, col.column);
}

function evaluateExpression(expr: Expression, row: Row): boolean {
  switch (expr.type) {
    case 'binary': {
      if (expr.op === 'AND') {
        return evaluateExpression(expr.left, row) && evaluateExpression(expr.right, row);
      }
      if (expr.op === 'OR') {
        return evaluateExpression(expr.left, row) || evaluateExpression(expr.right, row);
      }
      const left = evalValue(expr.left, row);
      const right = evalValue(expr.right, row);
      switch (expr.op) {
        case '=': return left == right;
        case '!=': return left != right;
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
        default: throw new Error(`Unknown operator: ${expr.op}`);
      }
    }
    case 'not':
      return !evaluateExpression(expr.expr, row);
    case 'like': {
      const val = String(evalValue(expr.left, row));
      const regex = new RegExp('^' + expr.pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$');
      return regex.test(val);
    }
    default:
      return !!evalValue(expr, row);
  }
}

function evalValue(expr: Expression, row: Row): any {
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'column': {
      // Check for aggregate marker
      if (expr.column.startsWith('__agg_')) {
        const key = expr.column;
        if (key in row) return row[key];
        return resolveValue(row, key);
      }
      return resolveColumnValue(row, expr);
    }
    default:
      throw new Error(`Cannot evaluate expression type '${expr.type}' as value`);
  }
}

function hasAggregate(columns: SelectItem[]): boolean {
  return columns.some(c => isFunctionCall(c));
}

function executeGroupBy(rows: Row[], stmt: SelectStatement, aliasMap: Record<string, string>): Row[] {
  const groupBy = stmt.groupBy || [];

  // Group rows
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    const keyParts = groupBy.map(col => {
      const val = resolveColumnValue(row, col);
      return String(val);
    });
    const key = keyParts.join('|||');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // If no GROUP BY, treat all rows as one group
  if (groupBy.length === 0) {
    const all = groups.size === 0 ? [] : Array.from(groups.values()).flat();
    groups.clear();
    groups.set('__all__', all.length > 0 ? all : rows);
  }

  // Process each group
  let result: Row[] = [];

  for (const [, groupRows] of groups) {
    const outputRow: Row = {};

    for (const col of stmt.columns) {
      if (isFunctionCall(col)) {
        const aggKey = computeAggKey(col);
        outputRow[aggKey] = computeAggregate(col, groupRows);
      } else if (isColumnRef(col)) {
        const key = col.table ? `${col.table}.${col.column}` : col.column;
        outputRow[key] = resolveColumnValue(groupRows[0], col);
      } else if (isStar(col)) {
        Object.assign(outputRow, groupRows[0]);
      }
    }

    // Also compute aggregates used in HAVING
    if (stmt.having) {
      addHavingAggregates(outputRow, stmt.having, groupRows);
    }

    result.push(outputRow);
  }

  // HAVING
  if (stmt.having) {
    result = result.filter(row => evaluateExpression(stmt.having!, row));
  }

  // Clean up aggregate markers from HAVING (keep only selected columns)
  result = result.map(row => {
    const cleaned: Row = {};
    for (const col of stmt.columns) {
      if (isFunctionCall(col)) {
        const key = computeAggKey(col);
        cleaned[key] = row[key];
      } else if (isColumnRef(col)) {
        const key = col.table ? `${col.table}.${col.column}` : col.column;
        cleaned[key] = row[key];
      }
    }
    return cleaned;
  });

  return result;
}

function computeAggKey(fn: FunctionCall): string {
  return `__agg_${fn.name}_${fn.arg}`;
}

function computeAggregate(fn: FunctionCall, rows: Row[]): number {
  switch (fn.name) {
    case 'COUNT': {
      if (fn.arg === '*') return rows.length;
      return rows.filter(r => {
        const v = fn.argTable
          ? resolveColumnValue(r, { table: fn.argTable, column: fn.arg })
          : resolveValue(r, fn.arg);
        return v != null;
      }).length;
    }
    case 'SUM': {
      return rows.reduce((sum, r) => {
        const v = fn.argTable
          ? resolveColumnValue(r, { table: fn.argTable, column: fn.arg })
          : resolveValue(r, fn.arg);
        return sum + (typeof v === 'number' ? v : 0);
      }, 0);
    }
    case 'AVG': {
      const vals = rows.map(r => {
        const v = fn.argTable
          ? resolveColumnValue(r, { table: fn.argTable, column: fn.arg })
          : resolveValue(r, fn.arg);
        return typeof v === 'number' ? v : null;
      }).filter(v => v !== null) as number[];
      return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    case 'MIN': {
      const vals = rows.map(r => {
        const v = fn.argTable
          ? resolveColumnValue(r, { table: fn.argTable, column: fn.arg })
          : resolveValue(r, fn.arg);
        return v;
      }).filter(v => v != null);
      return vals.length === 0 ? 0 : Math.min(...vals.map(Number));
    }
    case 'MAX': {
      const vals = rows.map(r => {
        const v = fn.argTable
          ? resolveColumnValue(r, { table: fn.argTable, column: fn.arg })
          : resolveValue(r, fn.arg);
        return v;
      }).filter(v => v != null);
      return vals.length === 0 ? 0 : Math.max(...vals.map(Number));
    }
    default:
      throw new Error(`Unknown aggregate function: ${fn.name}`);
  }
}

function addHavingAggregates(row: Row, expr: Expression, groupRows: Row[]): void {
  if (expr.type === 'column' && expr.column.startsWith('__agg_')) {
    // Parse aggregate from marker: __agg_COUNT_*, __agg_AVG_age, etc.
    const match = expr.column.match(/^__agg_(\w+)_(.+)$/);
    if (match) {
      const fn: FunctionCall = { name: match[1], arg: match[2] };
      row[expr.column] = computeAggregate(fn, groupRows);
    }
  }
  if (expr.type === 'binary') {
    addHavingAggregates(row, expr.left, groupRows);
    addHavingAggregates(row, expr.right, groupRows);
  }
  if (expr.type === 'not') {
    addHavingAggregates(row, expr.expr, groupRows);
  }
}

function projectColumns(rows: Row[], columns: SelectItem[], aliasMap: Record<string, string>): Row[] {
  return rows.map(row => {
    const result: Row = {};
    for (const col of columns) {
      if (isStar(col)) {
        // Include all columns but strip prefix for single-table queries
        for (const [key, value] of Object.entries(row)) {
          const parts = key.split('.');
          const colName = parts.length > 1 ? parts.slice(1).join('.') : key;
          // If there's only one table, strip the prefix
          if (Object.keys(aliasMap).length <= 1) {
            result[colName] = value;
          } else {
            result[key] = value;
          }
        }
      } else if (isColumnRef(col)) {
        const key = col.table ? `${col.table}.${col.column}` : col.column;
        result[key] = resolveColumnValue(row, col);
      }
    }
    return result;
  });
}
