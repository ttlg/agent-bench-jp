import { SelectStatement, Expr, ColumnRef } from './parser';

type Row = Record<string, any>;
type DB = Record<string, Row[]>;

export function execute(stmt: SelectStatement, db: DB): Row[] {
  // Resolve table aliases
  const aliasMap: Record<string, string> = {};
  const tableName = stmt.from.table;
  const tableAlias = stmt.from.alias || tableName;
  aliasMap[tableAlias] = tableName;

  // Start with FROM table - prefix columns with alias
  let rows: Row[] = (db[tableName] || []).map(r => prefixRow(r, tableAlias));

  // JOINs
  for (const join of stmt.joins) {
    const joinAlias = join.alias || join.table;
    aliasMap[joinAlias] = join.table;
    const joinRows = db[join.table] || [];

    if (join.type === 'INNER') {
      const result: Row[] = [];
      for (const left of rows) {
        for (const right of joinRows) {
          const combined = { ...left, ...prefixRow(right, joinAlias) };
          if (evalExpr(join.on, combined)) result.push(combined);
        }
      }
      rows = result;
    } else {
      // LEFT JOIN
      const result: Row[] = [];
      for (const left of rows) {
        let matched = false;
        for (const right of joinRows) {
          const combined = { ...left, ...prefixRow(right, joinAlias) };
          if (evalExpr(join.on, combined)) { result.push(combined); matched = true; }
        }
        if (!matched) {
          const nullRight: Row = {};
          for (const key of Object.keys(joinRows[0] || {})) {
            nullRight[`${joinAlias}.${key}`] = null;
          }
          result.push({ ...left, ...nullRight });
        }
      }
      rows = result;
    }
  }

  // WHERE
  if (stmt.where) {
    rows = rows.filter(r => evalExpr(stmt.where!, r));
  }

  // GROUP BY
  if (stmt.groupBy.length > 0 || stmt.columns.some(c => c.aggFunc)) {
    const groups = new Map<string, Row[]>();
    if (stmt.groupBy.length > 0) {
      for (const row of rows) {
        const key = stmt.groupBy.map(g => resolveValue(g, row)).join('|||');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }
    } else {
      groups.set('__all__', rows);
    }

    const aggRows: Row[] = [];
    for (const [, groupRows] of groups) {
      const row: Row = {};
      for (const col of stmt.columns) {
        const outputKey = columnOutputKey(col);
        if (col.aggFunc) {
          row[outputKey] = computeAgg(col.aggFunc, col.column, groupRows);
        } else {
          row[outputKey] = resolveValue(col, groupRows[0]);
        }
      }
      // Keep group-by columns available for HAVING
      for (const g of stmt.groupBy) {
        const k = columnOutputKey(g);
        if (!(k in row)) row[k] = resolveValue(g, groupRows[0]);
      }
      // Store groupRows for HAVING aggregates
      (row as any).__groupRows__ = groupRows;
      aggRows.push(row);
    }

    // HAVING
    if (stmt.having) {
      rows = aggRows.filter(r => evalExprAgg(stmt.having!, r, (r as any).__groupRows__));
    } else {
      rows = aggRows;
    }
    // Clean up
    rows.forEach(r => delete (r as any).__groupRows__);
  } else {
    // Project columns
    rows = rows.map(r => projectRow(stmt.columns, r));
  }

  // ORDER BY
  if (stmt.orderBy.length > 0) {
    rows.sort((a, b) => {
      for (const o of stmt.orderBy) {
        const key = columnOutputKey(o.column);
        const va = a[key], vb = b[key];
        let cmp = 0;
        if (va < vb) cmp = -1;
        else if (va > vb) cmp = 1;
        if (o.direction === 'DESC') cmp = -cmp;
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }

  // OFFSET
  if (stmt.offset) rows = rows.slice(stmt.offset);
  // LIMIT
  if (stmt.limit !== undefined) rows = rows.slice(0, stmt.limit);

  return rows;
}

function prefixRow(row: Row, alias: string): Row {
  const result: Row = {};
  for (const [k, v] of Object.entries(row)) {
    result[`${alias}.${k}`] = v;
  }
  return result;
}

function resolveValue(col: ColumnRef, row: Row): any {
  if (col.table) return row[`${col.table}.${col.column}`];
  // Try to find without prefix
  if (col.column in row) return row[col.column];
  // Search prefixed
  for (const key of Object.keys(row)) {
    if (key.endsWith(`.${col.column}`)) return row[key];
  }
  return undefined;
}

function columnOutputKey(col: ColumnRef): string {
  if (col.aggFunc) return `${col.aggFunc}(${col.column})`;
  if (col.table) return `${col.table}.${col.column}`;
  return col.column;
}

function projectRow(columns: ColumnRef[], row: Row): Row {
  if (columns.length === 1 && columns[0].column === '*' && !columns[0].aggFunc) {
    return { ...row };
  }
  const result: Row = {};
  for (const col of columns) {
    const key = columnOutputKey(col);
    result[key] = resolveValue(col, row);
  }
  return result;
}

function evalExpr(expr: Expr, row: Row): boolean {
  switch (expr.kind) {
    case 'binary': {
      if (expr.op === 'AND') return evalExpr(expr.left, row) && evalExpr(expr.right, row);
      if (expr.op === 'OR') return evalExpr(expr.left, row) || evalExpr(expr.right, row);
      const lv = exprValue(expr.left, row);
      const rv = exprValue(expr.right, row);
      switch (expr.op) {
        case '=': return lv === rv;
        case '!=': return lv !== rv;
        case '<': return lv < rv;
        case '>': return lv > rv;
        case '<=': return lv <= rv;
        case '>=': return lv >= rv;
      }
      return false;
    }
    case 'not': return !evalExpr(expr.expr, row);
    case 'like': {
      const val = String(exprValue(expr.expr, row));
      const regex = new RegExp('^' + expr.pattern.replace(/%/g, '.*') + '$');
      return regex.test(val);
    }
    default: return !!exprValue(expr, row);
  }
}

function exprValue(expr: Expr, row: Row): any {
  if (expr.kind === 'literal') return expr.value;
  if (expr.kind === 'column') return resolveValue(expr.ref, row);
  return evalExpr(expr, row) ? 1 : 0;
}

function evalExprAgg(expr: Expr, aggRow: Row, groupRows: Row[]): boolean {
  if (expr.kind === 'binary') {
    if (expr.op === 'AND') return evalExprAgg(expr.left, aggRow, groupRows) && evalExprAgg(expr.right, aggRow, groupRows);
    if (expr.op === 'OR') return evalExprAgg(expr.left, aggRow, groupRows) || evalExprAgg(expr.right, aggRow, groupRows);
    const lv = exprValueAgg(expr.left, aggRow, groupRows);
    const rv = exprValueAgg(expr.right, aggRow, groupRows);
    switch (expr.op) {
      case '=': return lv === rv;
      case '!=': return lv !== rv;
      case '<': return lv < rv;
      case '>': return lv > rv;
      case '<=': return lv <= rv;
      case '>=': return lv >= rv;
    }
  }
  if (expr.kind === 'not') return !evalExprAgg(expr.expr, aggRow, groupRows);
  return false;
}

function exprValueAgg(expr: Expr, aggRow: Row, groupRows: Row[]): any {
  if (expr.kind === 'literal') return expr.value;
  if (expr.kind === 'column' && expr.ref.aggFunc) {
    return computeAgg(expr.ref.aggFunc, expr.ref.column, groupRows);
  }
  if (expr.kind === 'column') {
    const key = columnOutputKey(expr.ref);
    return aggRow[key];
  }
  return 0;
}

function computeAgg(func: string, column: string, rows: Row[]): number {
  if (func === 'COUNT') {
    if (column === '*') return rows.length;
    return rows.filter(r => resolveValue({ column }, r) != null).length;
  }
  const values = rows.map(r => Number(resolveValue({ column }, r))).filter(v => !isNaN(v));
  switch (func) {
    case 'SUM': return values.reduce((a, b) => a + b, 0);
    case 'AVG': return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case 'MIN': return Math.min(...values);
    case 'MAX': return Math.max(...values);
  }
  return 0;
}
