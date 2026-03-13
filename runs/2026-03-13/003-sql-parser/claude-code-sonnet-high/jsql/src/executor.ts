import {
  SelectStatement, Expr, SelectItem, ColumnRef, FuncCall, StarRef
} from './ast';

type Row = Record<string, unknown>;
type DB = Record<string, Row[]>;

// ── Expression evaluation ─────────────────────────────────────────────────────

function evalExpr(expr: Expr, row: Row): unknown {
  switch (expr.type) {
    case 'literal': return expr.value;
    case 'column': {
      const key = expr.table ? `${expr.table}.${expr.name}` : expr.name;
      if (key in row) return row[key];
      // fallback: search by col name only
      for (const k of Object.keys(row)) {
        const parts = k.split('.');
        if (parts[parts.length - 1] === expr.name) return row[k];
      }
      return null;
    }
    case 'star': return null;
    case 'func': return null; // aggregate handled separately
    case 'binary': return evalBinary(expr.op, evalExpr(expr.left, row), evalExpr(expr.right, row));
    case 'unary': return !evalExpr(expr.expr, row);
  }
}

function evalBinary(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case '=':  return left == right;
    case '!=': return left != right;
    case '<':  return (left as number) < (right as number);
    case '>':  return (left as number) > (right as number);
    case '<=': return (left as number) <= (right as number);
    case '>=': return (left as number) >= (right as number);
    case 'AND': return Boolean(left) && Boolean(right);
    case 'OR':  return Boolean(left) || Boolean(right);
    case 'LIKE': return matchLike(String(left), String(right));
  }
  return null;
}

function matchLike(value: string, pattern: string): boolean {
  const regex = '^' + pattern.split('%').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
  return new RegExp(regex).test(value);
}

// ── Column resolution helpers ─────────────────────────────────────────────────

function resolveColumnName(item: SelectItem, row: Row): string {
  if (item.type === 'star') return '*';
  if (item.type === 'func') {
    const argStr = item.arg.type === 'star' ? '*' : (item.arg as ColumnRef).name;
    return `${item.name}(${argStr})`;
  }
  // ColumnRef
  return (item as ColumnRef).name;
}

function getColumnValue(item: SelectItem, row: Row): unknown {
  if (item.type === 'column') return evalExpr(item, row);
  return null;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function computeAgg(func: FuncCall, rows: Row[]): unknown {
  const argName = func.arg.type === 'star' ? null : (func.arg as ColumnRef).name;

  switch (func.name) {
    case 'COUNT': {
      if (!argName) return rows.length;
      return rows.filter(r => getVal(r, argName) !== null && getVal(r, argName) !== undefined).length;
    }
    case 'SUM': return rows.reduce((s, r) => s + Number(getVal(r, argName!)), 0);
    case 'AVG': {
      if (rows.length === 0) return null;
      const sum = rows.reduce((s, r) => s + Number(getVal(r, argName!)), 0);
      return sum / rows.length;
    }
    case 'MIN': return rows.reduce((m, r) => { const v = getVal(r, argName!); return m === null || (v as number) < (m as number) ? v : m; }, null as unknown);
    case 'MAX': return rows.reduce((m, r) => { const v = getVal(r, argName!); return m === null || (v as number) > (m as number) ? v : m; }, null as unknown);
  }
  return null;
}

function getVal(row: Row, name: string): unknown {
  if (name in row) return row[name];
  for (const k of Object.keys(row)) {
    const parts = k.split('.');
    if (parts[parts.length - 1] === name) return row[k];
  }
  return null;
}

function evalExprOnGroup(expr: Expr, rows: Row[]): unknown {
  if (expr.type === 'func') return computeAgg(expr, rows);
  if (expr.type === 'binary') {
    const l = evalExprOnGroup(expr.left, rows);
    const r = evalExprOnGroup(expr.right, rows);
    return evalBinary(expr.op, l, r);
  }
  if (expr.type === 'unary') return !evalExprOnGroup(expr.expr, rows);
  // column / literal — use first row
  return evalExpr(expr, rows[0]);
}

// ── Main executor ─────────────────────────────────────────────────────────────

export function execute(stmt: SelectStatement, db: DB): Row[] {
  // 1. FROM
  const tableName = stmt.from;
  if (!(tableName in db)) throw new Error(`Table '${tableName}' not found`);
  const alias = stmt.fromAlias ?? tableName;

  let rows: Row[] = db[tableName].map(r => prefixRow(r, alias));

  // 2. JOINs
  for (const join of stmt.joins) {
    if (!(join.table in db)) throw new Error(`Table '${join.table}' not found`);
    const joinAlias = join.alias ?? join.table;
    const rightRows = db[join.table].map(r => prefixRow(r, joinAlias));

    if (join.type === 'INNER') {
      const result: Row[] = [];
      for (const left of rows) {
        for (const right of rightRows) {
          const merged = { ...left, ...right };
          if (evalExpr(join.on, merged)) result.push(merged);
        }
      }
      rows = result;
    } else { // LEFT
      const result: Row[] = [];
      for (const left of rows) {
        let matched = false;
        for (const right of rightRows) {
          const merged = { ...left, ...right };
          if (evalExpr(join.on, merged)) { result.push(merged); matched = true; }
        }
        if (!matched) {
          const nullRight = Object.fromEntries(Object.keys(rightRows[0] ?? {}).map(k => [k, null]));
          result.push({ ...left, ...nullRight });
        }
      }
      rows = result;
    }
  }

  // 3. WHERE
  if (stmt.where) rows = rows.filter(r => evalExpr(stmt.where!, r));

  // 4. GROUP BY + aggregation
  const hasAgg = stmt.columns.some(c => c.type === 'func');

  if (stmt.groupBy || hasAgg) {
    const groups = new Map<string, Row[]>();

    if (stmt.groupBy && stmt.groupBy.length > 0) {
      for (const row of rows) {
        const key = stmt.groupBy.map(c => String(evalExpr(c, row))).join('\0');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }
    } else {
      groups.set('__all__', rows);
    }

    // HAVING
    let groupEntries = [...groups.values()];
    if (stmt.having) {
      groupEntries = groupEntries.filter(g => evalExprOnGroup(stmt.having!, g));
    }

    // Project aggregated columns
    rows = groupEntries.map(groupRows => {
      const out: Row = {};
      for (const col of stmt.columns) {
        const label = resolveColumnName(col, groupRows[0]);
        if (col.type === 'func') {
          out[label] = computeAgg(col, groupRows);
        } else if (col.type === 'column') {
          out[label] = evalExpr(col, groupRows[0]);
        }
      }
      return out;
    });

    return applyOrderLimitOffset(rows, stmt);
  }

  // 5. SELECT projection (non-aggregate)
  rows = rows.map(row => projectRow(stmt.columns, row));

  return applyOrderLimitOffset(rows, stmt);
}

function prefixRow(row: Row, prefix: string): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[`${prefix}.${k}`] = v;
  return out;
}

function projectRow(columns: SelectItem[], row: Row): Row {
  // If SELECT *, return all columns (strip table prefix for cleaner output)
  if (columns.length === 1 && columns[0].type === 'star' && !columns[0].table) {
    return stripPrefixes(row);
  }

  // Determine output keys for each column to detect duplicates
  const keys: string[] = columns.map(col => {
    if (col.type === 'star') return '__star__';
    if (col.type === 'func') return `${col.name}(${col.arg.type === 'star' ? '*' : (col.arg as ColumnRef).name})`;
    return col.name;
  });

  // When duplicate simple column names exist, use table.col notation for those
  const keyCounts = new Map<string, number>();
  for (const k of keys) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);

  const out: Row = {};
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.type === 'star') {
      if (col.table) {
        for (const [k, v] of Object.entries(row)) {
          const [tbl, ...rest] = k.split('.');
          if (tbl === col.table) out[rest.join('.')] = v;
        }
      } else {
        Object.assign(out, stripPrefixes(row));
      }
    } else if (col.type === 'column') {
      const val = evalExpr(col, row);
      const baseKey = col.name;
      const outputKey = (keyCounts.get(baseKey)! > 1 && col.table) ? `${col.table}.${col.name}` : baseKey;
      out[outputKey] = val;
    } else if (col.type === 'func') {
      const label = `${col.name}(${col.arg.type === 'star' ? '*' : (col.arg as ColumnRef).name})`;
      out[label] = computeAgg(col, [row]);
    }
  }
  return out;
}

function stripPrefixes(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    const dot = k.indexOf('.');
    const colName = dot >= 0 ? k.slice(dot + 1) : k;
    out[colName] = v;
  }
  return out;
}

function applyOrderLimitOffset(rows: Row[], stmt: SelectStatement): Row[] {
  if (stmt.orderBy) {
    rows = [...rows].sort((a, b) => {
      for (const ob of stmt.orderBy!) {
        const va = getVal(a, (ob.expr as ColumnRef).name) ?? evalExpr(ob.expr, a);
        const vb = getVal(b, (ob.expr as ColumnRef).name) ?? evalExpr(ob.expr, b);
        let cmp = 0;
        if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
        else cmp = String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
        if (cmp !== 0) return ob.direction === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });
  }
  if (stmt.offset) rows = rows.slice(stmt.offset);
  if (stmt.limit !== undefined) rows = rows.slice(0, stmt.limit);
  return rows;
}
