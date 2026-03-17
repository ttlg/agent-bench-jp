import {
  SelectStatement,
  SelectItem,
  ColumnRef,
  AggregateExpr,
  WhereExpr,
  JoinClause,
  Row,
  Database,
} from "./types";

type QualifiedRow = Record<string, unknown>;

export function execute(stmt: SelectStatement, db: Database): Row[] {
  // Resolve table aliases: alias -> tableName
  const aliasMap = new Map<string, string>();
  const fromAlias = stmt.from.alias || stmt.from.table;
  aliasMap.set(fromAlias, stmt.from.table);
  for (const j of stmt.joins) {
    const jAlias = j.alias || j.table;
    aliasMap.set(jAlias, j.table);
  }

  // 1. FROM: get base rows with qualified names (alias.column)
  const baseTable = db[stmt.from.table];
  if (!baseTable) {
    throw new Error(`Table "${stmt.from.table}" not found`);
  }
  let rows: QualifiedRow[] = baseTable.map((row) => qualify(row, fromAlias));

  // 2. JOINs
  for (const join of stmt.joins) {
    rows = executeJoin(rows, join, db, aliasMap);
  }

  // 3. WHERE
  if (stmt.where) {
    rows = rows.filter((row) => evaluateWhere(stmt.where!, row, aliasMap));
  }

  // 4. GROUP BY / aggregation
  const hasAggregates = stmt.columns.some(
    (c) => typeof c === "object" && "func" in c
  );

  if (stmt.groupBy || hasAggregates) {
    rows = executeGroupBy(
      rows,
      stmt.columns,
      stmt.groupBy || [],
      stmt.having,
      aliasMap
    );
  }

  // 5. ORDER BY
  if (stmt.orderBy) {
    rows = executeOrderBy(rows, stmt.orderBy, aliasMap);
  }

  // 6. OFFSET / LIMIT
  if (stmt.offset !== undefined) {
    rows = rows.slice(stmt.offset);
  }
  if (stmt.limit !== undefined) {
    rows = rows.slice(0, stmt.limit);
  }

  // 7. Project columns
  return projectColumns(rows, stmt.columns, aliasMap);
}

function qualify(row: Row, alias: string): QualifiedRow {
  const result: QualifiedRow = {};
  for (const [key, value] of Object.entries(row)) {
    result[`${alias}.${key}`] = value;
  }
  return result;
}

function executeJoin(
  leftRows: QualifiedRow[],
  join: JoinClause,
  db: Database,
  aliasMap: Map<string, string>
): QualifiedRow[] {
  const rightTable = db[join.table];
  if (!rightTable) {
    throw new Error(`Table "${join.table}" not found`);
  }
  const rightAlias = join.alias || join.table;

  const result: QualifiedRow[] = [];

  for (const leftRow of leftRows) {
    let matched = false;

    for (const rightRaw of rightTable) {
      const rightRow = qualify(rightRaw, rightAlias);
      const combined: QualifiedRow = { ...leftRow, ...rightRow };

      if (evaluateWhere(join.on, combined, aliasMap)) {
        result.push(combined);
        matched = true;
      }
    }

    if (!matched && join.type === "LEFT") {
      // Add left row with NULLs for right side
      const nullRight: QualifiedRow = {};
      if (rightTable.length > 0) {
        for (const key of Object.keys(rightTable[0])) {
          nullRight[`${rightAlias}.${key}`] = null;
        }
      }
      result.push({ ...leftRow, ...nullRight });
    }
  }

  return result;
}

function resolveColumnRef(
  ref: ColumnRef,
  row: QualifiedRow,
  aliasMap: Map<string, string>
): unknown {
  if (ref.table) {
    return row[`${ref.table}.${ref.column}`];
  }

  // Search all aliases for the column
  for (const alias of aliasMap.keys()) {
    const key = `${alias}.${ref.column}`;
    if (key in row) {
      return row[key];
    }
  }

  // Fallback: check if it exists as a direct key (for aggregated rows)
  if (ref.column in row) {
    return row[ref.column];
  }

  return undefined;
}

function evaluateWhere(
  expr: WhereExpr,
  row: QualifiedRow,
  aliasMap: Map<string, string>
): boolean {
  switch (expr.type) {
    case "compare": {
      const left = resolveValue(expr.left, row, aliasMap);
      const right = resolveValue(expr.right, row, aliasMap);
      return compare(left, right, expr.op);
    }
    case "logical": {
      const l = evaluateWhere(expr.left, row, aliasMap);
      const r = evaluateWhere(expr.right, row, aliasMap);
      return expr.op === "AND" ? l && r : l || r;
    }
    case "not":
      return !evaluateWhere(expr.expr, row, aliasMap);
    case "like": {
      const val = resolveColumnRef(expr.column, row, aliasMap);
      if (typeof val !== "string") return false;
      return matchLike(val, expr.pattern);
    }
  }
}

function resolveValue(
  val: ColumnRef | AggregateExpr | string | number,
  row: QualifiedRow,
  aliasMap: Map<string, string>
): unknown {
  if (typeof val === "string" || typeof val === "number") return val;
  if ("func" in val) {
    // Aggregate in HAVING - look for pre-computed key
    const key = aggregateKey(val);
    if (key in row) return row[key];
    return undefined;
  }
  return resolveColumnRef(val, row, aliasMap);
}

function compare(left: unknown, right: unknown, op: string): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }

  const l = typeof left === "string" && typeof right === "number" ? Number(left) : left;
  const r = typeof right === "string" && typeof left === "number" ? Number(right) : right;

  switch (op) {
    case "=":
      return l === r;
    case "!=":
      return l !== r;
    case "<":
      return (l as number) < (r as number);
    case ">":
      return (l as number) > (r as number);
    case "<=":
      return (l as number) <= (r as number);
    case ">=":
      return (l as number) >= (r as number);
    default:
      return false;
  }
}

function matchLike(value: string, pattern: string): boolean {
  // Convert SQL LIKE pattern to regex
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (match) => {
    if (match === "%") return match;
    return "\\" + match;
  });
  const regex = new RegExp(
    "^" + escaped.replace(/%/g, ".*") + "$"
  );
  return regex.test(value);
}

function aggregateKey(agg: AggregateExpr): string {
  const argStr = agg.arg === "*" ? "*" : agg.arg.table ? `${agg.arg.table}.${agg.arg.column}` : agg.arg.column;
  return `__agg_${agg.func}_${argStr}`;
}

function executeGroupBy(
  rows: QualifiedRow[],
  columns: SelectItem[],
  groupByCols: ColumnRef[],
  having: WhereExpr | undefined,
  aliasMap: Map<string, string>
): QualifiedRow[] {
  // Group rows
  const groups = new Map<string, QualifiedRow[]>();

  if (groupByCols.length === 0) {
    // Single group for all rows
    groups.set("__all__", rows);
  } else {
    for (const row of rows) {
      const key = groupByCols
        .map((col) => String(resolveColumnRef(col, row, aliasMap) ?? "NULL"))
        .join("|||");
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    }
  }

  // Compute aggregates for each group
  const result: QualifiedRow[] = [];

  for (const [, groupRows] of groups) {
    const outRow: QualifiedRow = {};

    // Copy group-by column values from first row
    for (const col of groupByCols) {
      const val = resolveColumnRef(col, groupRows[0], aliasMap);
      // Store under both qualified and unqualified names
      if (col.table) {
        outRow[`${col.table}.${col.column}`] = val;
      }
      outRow[col.column] = val;
      // Also store under all alias-qualified forms
      for (const alias of aliasMap.keys()) {
        const key = `${alias}.${col.column}`;
        if (key in groupRows[0]) {
          outRow[key] = val;
        }
      }
    }

    // Compute each aggregate
    for (const col of columns) {
      if (typeof col === "object" && "func" in col) {
        const agg = col as AggregateExpr;
        const key = aggregateKey(agg);
        outRow[key] = computeAggregate(agg, groupRows, aliasMap);
      }
    }

    // Also compute aggregates that appear in HAVING
    if (having) {
      computeHavingAggregates(having, groupRows, outRow, aliasMap);
    }

    result.push(outRow);
  }

  // Apply HAVING filter
  if (having) {
    return result.filter((row) => evaluateWhere(having, row, aliasMap));
  }

  return result;
}

function computeHavingAggregates(
  expr: WhereExpr,
  groupRows: QualifiedRow[],
  outRow: QualifiedRow,
  aliasMap: Map<string, string>
): void {
  if (expr.type === "compare") {
    if (typeof expr.left === "object" && "func" in expr.left) {
      const key = aggregateKey(expr.left);
      if (!(key in outRow)) {
        outRow[key] = computeAggregate(expr.left, groupRows, aliasMap);
      }
    }
    if (typeof expr.right === "object" && "func" in expr.right) {
      const key = aggregateKey(expr.right);
      if (!(key in outRow)) {
        outRow[key] = computeAggregate(expr.right, groupRows, aliasMap);
      }
    }
  } else if (expr.type === "logical") {
    computeHavingAggregates(expr.left, groupRows, outRow, aliasMap);
    computeHavingAggregates(expr.right, groupRows, outRow, aliasMap);
  } else if (expr.type === "not") {
    computeHavingAggregates(expr.expr, groupRows, outRow, aliasMap);
  }
}

function computeAggregate(
  agg: AggregateExpr,
  rows: QualifiedRow[],
  aliasMap: Map<string, string>
): number {
  if (agg.func === "COUNT") {
    if (agg.arg === "*") return rows.length;
    return rows.filter(
      (r) => resolveColumnRef(agg.arg as ColumnRef, r, aliasMap) != null
    ).length;
  }

  const values = rows
    .map((r) => resolveColumnRef(agg.arg as ColumnRef, r, aliasMap))
    .filter((v) => v != null)
    .map(Number);

  switch (agg.func) {
    case "SUM":
      return values.reduce((a, b) => a + b, 0);
    case "AVG":
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case "MIN":
      return Math.min(...values);
    case "MAX":
      return Math.max(...values);
    default:
      throw new Error(`Unknown aggregate function: ${agg.func}`);
  }
}

function executeOrderBy(
  rows: QualifiedRow[],
  orderBy: { column: ColumnRef; direction: "ASC" | "DESC" }[],
  aliasMap: Map<string, string>
): QualifiedRow[] {
  return [...rows].sort((a, b) => {
    for (const item of orderBy) {
      const aVal = resolveColumnRef(item.column, a, aliasMap);
      const bVal = resolveColumnRef(item.column, b, aliasMap);

      let cmp = 0;
      if (aVal == null && bVal == null) cmp = 0;
      else if (aVal == null) cmp = -1;
      else if (bVal == null) cmp = 1;
      else if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }

      if (cmp !== 0) {
        return item.direction === "DESC" ? -cmp : cmp;
      }
    }
    return 0;
  });
}

function projectColumns(
  rows: QualifiedRow[],
  columns: SelectItem[],
  aliasMap: Map<string, string>
): Row[] {
  return rows.map((row) => {
    const out: Row = {};

    for (const col of columns) {
      if (col === "*") {
        // Expand all columns, dequalify
        for (const [key, value] of Object.entries(row)) {
          if (key.startsWith("__agg_")) continue;
          const dotIdx = key.indexOf(".");
          const colName = dotIdx >= 0 ? key.substring(dotIdx + 1) : key;
          // If multiple tables have same column, prefix with table alias
          if (colName in out) {
            // Rename existing with its table prefix
            out[key] = value;
          } else {
            out[colName] = value;
          }
        }
      } else if (typeof col === "object" && "func" in col) {
        const agg = col as AggregateExpr;
        const key = aggregateKey(agg);
        const displayName = agg.alias || formatAggName(agg);
        out[displayName] = row[key];
      } else {
        const ref = col as ColumnRef;
        const value = resolveColumnRef(ref, row, aliasMap);
        const displayName = ref.table ? `${ref.table}.${ref.column}` : ref.column;
        out[displayName] = value;
      }
    }

    return out;
  });
}

function formatAggName(agg: AggregateExpr): string {
  const argStr =
    agg.arg === "*"
      ? "*"
      : agg.arg.table
      ? `${agg.arg.table}.${agg.arg.column}`
      : agg.arg.column;
  return `${agg.func}(${argStr})`;
}
