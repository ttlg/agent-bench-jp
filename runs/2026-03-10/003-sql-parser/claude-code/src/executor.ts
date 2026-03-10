import {
  SelectStatement,
  Expression,
  Column,
  ColumnRef,
  AggregateColumn,
  OrderByItem,
} from './parser';

type Row = Record<string, unknown>;
type DataSource = Record<string, Row[]>;

function resolveColumnValue(row: Row, name: string, table?: string, aliases?: Record<string, string>): unknown {
  if (table) {
    // Try alias resolution
    const realTable = aliases?.[table] || table;
    const prefixed = `${realTable}.${name}`;
    if (prefixed in row) return row[prefixed];
    // Also try alias as prefix
    const aliasedKey = `${table}.${name}`;
    if (aliasedKey in row) return row[aliasedKey];
  }
  // Try direct name
  if (name in row) return row[name];
  // Search for table-prefixed keys matching the name
  for (const key of Object.keys(row)) {
    const parts = key.split('.');
    if (parts.length === 2 && parts[1] === name) {
      return row[key];
    }
  }
  return undefined;
}

function evaluateExpression(expr: Expression, row: Row, aliases: Record<string, string>): unknown {
  switch (expr.type) {
    case 'literal':
      return expr.value;

    case 'column_ref': {
      // Handle aggregate placeholders in HAVING
      if (expr.name.startsWith('__agg__')) {
        return row[expr.name];
      }
      return resolveColumnValue(row, expr.name, expr.table, aliases);
    }

    case 'binary': {
      if (expr.op === 'AND') {
        return evaluateExpression(expr.left, row, aliases) && evaluateExpression(expr.right, row, aliases);
      }
      if (expr.op === 'OR') {
        return evaluateExpression(expr.left, row, aliases) || evaluateExpression(expr.right, row, aliases);
      }
      const left = evaluateExpression(expr.left, row, aliases);
      const right = evaluateExpression(expr.right, row, aliases);
      switch (expr.op) {
        case '=': return left === right;
        case '!=': return left !== right;
        case '<': return (left as number) < (right as number);
        case '>': return (left as number) > (right as number);
        case '<=': return (left as number) <= (right as number);
        case '>=': return (left as number) >= (right as number);
        default: throw new Error(`Unknown operator: ${expr.op}`);
      }
    }

    case 'unary': {
      if (expr.op === 'NOT') {
        return !evaluateExpression(expr.operand, row, aliases);
      }
      throw new Error(`Unknown unary operator: ${expr.op}`);
    }

    case 'like': {
      const val = String(resolveColumnValue(row, expr.column.name, expr.column.table, aliases) ?? '');
      const pattern = expr.pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*');
      return new RegExp(`^${pattern}$`).test(val);
    }

    default:
      throw new Error(`Unknown expression type: ${(expr as Expression).type}`);
  }
}

function computeAggregate(func: string, arg: string, rows: Row[], aliases: Record<string, string>, argTable?: string): unknown {
  if (func === 'COUNT') {
    if (arg === '*') return rows.length;
    return rows.filter(r => resolveColumnValue(r, arg, argTable, aliases) != null).length;
  }

  const values = rows
    .map(r => resolveColumnValue(r, arg, argTable, aliases))
    .filter(v => v != null)
    .map(v => Number(v));

  switch (func) {
    case 'SUM': return values.reduce((a, b) => a + b, 0);
    case 'AVG': return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    case 'MIN': return values.length ? Math.min(...values) : null;
    case 'MAX': return values.length ? Math.max(...values) : null;
    default: throw new Error(`Unknown aggregate function: ${func}`);
  }
}

function buildColumnLabel(col: Column): string {
  switch (col.type) {
    case 'star': return '*';
    case 'column': return col.table ? `${col.table}.${col.name}` : col.name;
    case 'aggregate': return `${col.func}(${col.arg})`;
  }
}

export function execute(stmt: SelectStatement, data: DataSource): Row[] {
  const fromTable = data[stmt.from.name];
  if (!fromTable) {
    throw new Error(`Table not found: ${stmt.from.name}`);
  }

  // Build alias map: alias -> real table name
  const aliases: Record<string, string> = {};
  if (stmt.from.alias) {
    aliases[stmt.from.alias] = stmt.from.name;
  }
  for (const join of stmt.joins) {
    if (join.table.alias) {
      aliases[join.table.alias] = join.table.name;
    }
  }

  // Determine if we have joins
  const hasJoins = stmt.joins.length > 0;

  // Build initial rows, prefixing keys with table name if joins are present
  let rows: Row[];
  if (hasJoins) {
    const fromName = stmt.from.alias || stmt.from.name;
    rows = fromTable.map(r => {
      const newRow: Row = {};
      for (const [k, v] of Object.entries(r)) {
        newRow[`${fromName}.${k}`] = v;
      }
      return newRow;
    });
  } else {
    rows = fromTable.map(r => ({ ...r }));
  }

  // Process JOINs
  for (const join of stmt.joins) {
    const joinTableData = data[join.table.name];
    if (!joinTableData) {
      throw new Error(`Table not found: ${join.table.name}`);
    }
    const joinName = join.table.alias || join.table.name;
    const newRows: Row[] = [];

    for (const leftRow of rows) {
      let matched = false;
      for (const rightRow of joinTableData) {
        const combinedRow: Row = { ...leftRow };
        for (const [k, v] of Object.entries(rightRow)) {
          combinedRow[`${joinName}.${k}`] = v;
        }
        if (evaluateExpression(join.on, combinedRow, aliases)) {
          newRows.push(combinedRow);
          matched = true;
        }
      }
      if (!matched && join.type === 'LEFT') {
        const combinedRow: Row = { ...leftRow };
        if (joinTableData.length > 0) {
          for (const k of Object.keys(joinTableData[0])) {
            combinedRow[`${joinName}.${k}`] = null;
          }
        }
        newRows.push(combinedRow);
      }
    }
    rows = newRows;
  }

  // WHERE
  if (stmt.where) {
    rows = rows.filter(r => evaluateExpression(stmt.where!, r, aliases));
  }

  // Check for aggregates
  const hasAggregates = stmt.columns.some(c => c.type === 'aggregate');

  // GROUP BY + aggregates
  if (stmt.groupBy || hasAggregates) {
    const groupKeys = stmt.groupBy || [];

    // Group rows
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = groupKeys.map(g => {
        const val = resolveColumnValue(row, g.name, g.table, aliases);
        return String(val);
      }).join('|||');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    // Build result rows
    const resultRows: Row[] = [];
    for (const [, groupRows] of groups) {
      const resultRow: Row = {};
      const firstRow = groupRows[0];

      // Add group key columns
      for (const g of groupKeys) {
        const label = g.table ? `${g.table}.${g.name}` : g.name;
        resultRow[label] = resolveColumnValue(firstRow, g.name, g.table, aliases);
      }

      // Process columns
      for (const col of stmt.columns) {
        if (col.type === 'aggregate') {
          const label = buildColumnLabel(col);
          resultRow[label] = computeAggregate(col.func, col.arg, groupRows, aliases, col.argTable);
          // Also store as __agg__ for HAVING
          resultRow[`__agg__${col.func}__${col.arg}`] = resultRow[label];
        } else if (col.type === 'column') {
          const label = col.table ? `${col.table}.${col.name}` : col.name;
          resultRow[label] = resolveColumnValue(firstRow, col.name, col.table, aliases);
        }
      }

      resultRows.push(resultRow);
    }

    rows = resultRows;

    // HAVING
    if (stmt.having) {
      rows = rows.filter(r => evaluateExpression(stmt.having!, r, aliases));
    }

    // Clean up __agg__ keys
    rows = rows.map(r => {
      const cleaned: Row = {};
      for (const [k, v] of Object.entries(r)) {
        if (!k.startsWith('__agg__')) {
          cleaned[k] = v;
        }
      }
      return cleaned;
    });
  } else {
    // Project columns (no aggregation)
    rows = projectColumns(rows, stmt.columns, aliases, hasJoins);
  }

  // ORDER BY
  if (stmt.orderBy) {
    rows = sortRows(rows, stmt.orderBy, aliases);
  }

  // OFFSET
  if (stmt.offset) {
    rows = rows.slice(stmt.offset);
  }

  // LIMIT
  if (stmt.limit !== undefined) {
    rows = rows.slice(0, stmt.limit);
  }

  return rows;
}

function projectColumns(rows: Row[], columns: Column[], aliases: Record<string, string>, hasJoins: boolean): Row[] {
  // Check if it's SELECT *
  if (columns.length === 1 && columns[0].type === 'star' && !columns[0].table) {
    if (!hasJoins) return rows;
    // For joins with *, keep prefixed keys but make them friendlier
    return rows;
  }

  return rows.map(row => {
    const result: Row = {};
    for (const col of columns) {
      if (col.type === 'star') {
        if (col.table) {
          const realTable = aliases[col.table] || col.table;
          for (const [k, v] of Object.entries(row)) {
            const prefix = `${col.table}.`;
            const realPrefix = `${realTable}.`;
            if (k.startsWith(prefix) || k.startsWith(realPrefix)) {
              result[k] = v;
            }
          }
        } else {
          Object.assign(result, row);
        }
      } else if (col.type === 'column') {
        const label = col.table ? `${col.table}.${col.name}` : col.name;
        result[label] = resolveColumnValue(row, col.name, col.table, aliases);
      }
    }
    return result;
  });
}

function sortRows(rows: Row[], orderBy: OrderByItem[], aliases: Record<string, string>): Row[] {
  return [...rows].sort((a, b) => {
    for (const item of orderBy) {
      let aVal: unknown, bVal: unknown;
      if (item.column.type === 'aggregate') {
        const label = buildColumnLabel(item.column);
        aVal = a[label];
        bVal = b[label];
      } else {
        const col = item.column as ColumnRef;
        aVal = resolveColumnValue(a, col.name, col.table, aliases);
        bVal = resolveColumnValue(b, col.name, col.table, aliases);
      }

      if (aVal === bVal) continue;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp: number;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }

      if (item.direction === 'DESC') cmp = -cmp;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}
