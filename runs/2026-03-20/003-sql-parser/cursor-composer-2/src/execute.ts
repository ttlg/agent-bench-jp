import type { Expr, Query, SelectItem } from "./ast.js";

export type JsonDatabase = Record<string, Record<string, unknown>[]>;

export type RowCtx = Map<string, Record<string, unknown> | null>;

function isNullish(v: unknown): boolean {
  return v === null || v === undefined;
}

function likeMatch(pattern: string, value: string): boolean {
  let re = "";
  for (const c of pattern) {
    if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`).test(value);
}

function getAliases(query: Query): string[] {
  const base = query.from.alias ?? query.from.table;
  const rest = query.joins.map((j) => j.alias ?? j.table);
  return [base, ...rest];
}

function resolveColumn(ctx: RowCtx, table: string | undefined, name: string): unknown {
  if (table) {
    const row = ctx.get(table);
    if (row === null || row === undefined) return null;
    return row[name];
  }
  const aliases = [...ctx.keys()];
  if (aliases.length === 1) {
    const row = ctx.get(aliases[0]!);
    if (!row) return null;
    return row[name];
  }
  for (const a of aliases) {
    const row = ctx.get(a);
    if (row && Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  }
  return undefined;
}

function evalExpr(ctx: RowCtx, expr: Expr): unknown {
  switch (expr.type) {
    case "literal":
      return expr.value;
    case "column":
      return resolveColumn(ctx, expr.table, expr.name);
    case "unary": {
      if (expr.op !== "not") throw new Error("unsupported unary");
      const v = evalExpr(ctx, expr.expr);
      return !truthy(v);
    }
    case "binary": {
      const l = evalExpr(ctx, expr.left);
      const r = evalExpr(ctx, expr.right);
      switch (expr.op) {
        case "and":
          return truthy(l) && truthy(r);
        case "or":
          return truthy(l) || truthy(r);
        case "=":
          return eq(l, r);
        case "!=":
          return !eq(l, r);
        case "<":
          return compare(l, r) < 0;
        case ">":
          return compare(l, r) > 0;
        case "<=":
          return compare(l, r) <= 0;
        case ">=":
          return compare(l, r) >= 0;
        case "like": {
          const ls = l == null ? "" : String(l);
          const pat = r == null ? "" : String(r);
          return likeMatch(pat, ls);
        }
      }
    }
    case "call":
      throw new Error("aggregate not allowed in row expression");
  }
}

function truthy(v: unknown): boolean {
  if (v === false || v === 0 || v === "" || v === null || v === undefined) return false;
  return Boolean(v);
}

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function evalAggregate(group: RowCtx[], call: Extract<Expr, { type: "call" }>): unknown {
  const name = call.name.toLowerCase();
  if (name === "count") {
    if (call.starArg) return group.length;
    const col = call.args[0];
    if (!col) return 0;
    let n = 0;
    for (const row of group) {
      const v = evalExpr(row, col);
      if (!isNullish(v)) n++;
    }
    return n;
  }
  const col = call.args[0];
  if (!col) throw new Error("aggregate requires argument");
  const vals: unknown[] = [];
  for (const row of group) {
    const v = evalExpr(row, col);
    if (!isNullish(v)) vals.push(v);
  }
  if (name === "sum") {
    return vals.reduce((a, b) => (Number(a) + Number(b)) as unknown, 0);
  }
  if (name === "avg") {
    if (vals.length === 0) return null;
    const s = vals.reduce<number>((a, b) => a + Number(b), 0);
    return s / vals.length;
  }
  if (name === "min") {
    if (vals.length === 0) return null;
    return vals.reduce((m, v) => (compare(m, v) < 0 ? m : v));
  }
  if (name === "max") {
    if (vals.length === 0) return null;
    return vals.reduce((m, v) => (compare(m, v) > 0 ? m : v));
  }
  throw new Error(`unknown aggregate ${name}`);
}

function evalGroupExpr(group: RowCtx[], expr: Expr): unknown {
  switch (expr.type) {
    case "literal":
      return expr.value;
    case "column": {
      const first = group[0];
      if (!first) return null;
      return resolveColumn(first, expr.table, expr.name);
    }
    case "unary": {
      if (expr.op !== "not") throw new Error("unsupported unary");
      const v = evalGroupExpr(group, expr.expr);
      return !truthy(v);
    }
    case "binary": {
      const l = evalGroupExpr(group, expr.left);
      const r = evalGroupExpr(group, expr.right);
      switch (expr.op) {
        case "and":
          return truthy(l) && truthy(r);
        case "or":
          return truthy(l) || truthy(r);
        case "=":
          return eq(l, r);
        case "!=":
          return !eq(l, r);
        case "<":
          return compare(l, r) < 0;
        case ">":
          return compare(l, r) > 0;
        case "<=":
          return compare(l, r) <= 0;
        case ">=":
          return compare(l, r) >= 0;
        case "like": {
          const ls = l == null ? "" : String(l);
          const pat = r == null ? "" : String(r);
          return likeMatch(pat, ls);
        }
      }
    }
    case "call":
      return evalAggregate(group, expr);
  }
}

function hasAggregate(expr: Expr): boolean {
  switch (expr.type) {
    case "call":
      return true;
    case "binary":
      return hasAggregate(expr.left) || hasAggregate(expr.right);
    case "unary":
      return hasAggregate(expr.expr);
    default:
      return false;
  }
}

function selectHasAggregate(items: SelectItem[]): boolean {
  for (const it of items) {
    if (it.type === "expr" && hasAggregate(it.expr)) return true;
  }
  return false;
}

function buildBaseRows(db: JsonDatabase, query: Query): RowCtx[] {
  const t = query.from.table;
  const baseAlias = query.from.alias ?? t;
  const rows = db[t];
  if (!Array.isArray(rows)) throw new Error(`Table not found or not an array: ${t}`);
  return rows.map((r) => new Map<string, Record<string, unknown> | null>([[baseAlias, { ...r }]]));
}

function joinRows(
  db: JsonDatabase,
  leftRows: RowCtx[],
  join: { joinType: "inner" | "left"; table: string; alias?: string; on: Expr },
): RowCtx[] {
  const rightAlias = join.alias ?? join.table;
  const rightTable = db[join.table];
  if (!Array.isArray(rightTable)) throw new Error(`Table not found: ${join.table}`);
  const out: RowCtx[] = [];
  for (const left of leftRows) {
    const matches: RowCtx[] = [];
    for (const rr of rightTable) {
      const merged = new Map(left);
      merged.set(rightAlias, { ...rr });
      if (truthy(evalExpr(merged, join.on))) {
        matches.push(merged);
      }
    }
    if (join.joinType === "inner") {
      out.push(...matches);
    } else {
      if (matches.length === 0) {
        const merged = new Map(left);
        merged.set(rightAlias, null);
        out.push(merged);
      } else {
        out.push(...matches);
      }
    }
  }
  return out;
}

function columnLabel(expr: Expr): string {
  switch (expr.type) {
    case "column":
      return expr.table ? `${expr.table}.${expr.name}` : expr.name;
    case "call": {
      const inner = expr.starArg ? "*" : expr.args.map(columnLabel).join(", ");
      return `${expr.name.toUpperCase()}(${inner})`;
    }
    default:
      return "?";
  }
}

function outputKeyForSelectItem(item: SelectItem, index: number): string {
  if (item.type === "star") return `*${index}`;
  if (item.alias) return item.alias;
  return columnLabel(item.expr);
}

function projectRow(
  ctx: RowCtx,
  item: SelectItem,
  multiTable: boolean,
  index: number,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (item.type === "star") {
    const keys = [...ctx.keys()];
    if (item.table) {
      const r = ctx.get(item.table);
      if (r) {
        for (const [k, v] of Object.entries(r)) {
          row[multiTable ? `${item.table}.${k}` : k] = v;
        }
      }
      return row;
    }
    if (keys.length === 1) {
      const only = ctx.get(keys[0]!)!;
      if (only) {
        for (const [k, v] of Object.entries(only)) {
          row[k] = v;
        }
      }
      return row;
    }
    for (const al of keys) {
      const r = ctx.get(al);
      if (r) {
        for (const [k, v] of Object.entries(r)) {
          row[`${al}.${k}`] = v;
        }
      }
    }
    return row;
  }
  const key = outputKeyForSelectItem(item, index);
  row[key] = evalExpr(ctx, item.expr);
  return row;
}

function projectGroupRow(
  group: RowCtx[],
  item: SelectItem,
  index: number,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (item.type === "star") {
    throw new Error("SELECT * not supported with GROUP BY");
  }
  const key = outputKeyForSelectItem(item, index);
  row[key] = evalGroupExpr(group, item.expr);
  return row;
}

function mergeProjections(parts: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of parts) Object.assign(out, p);
  return out;
}

/** Re-resolve ORDER BY using projected row keys (alias / labels). */
function orderByRowsResolved(
  rows: Record<string, unknown>[],
  clauses: Query["orderBy"],
): Record<string, unknown>[] {
  if (clauses.length === 0) return rows;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const ob of clauses) {
      const k = resolveOrderKey(ob.expr, a);
      const av = a[k];
      const bv = b[k];
      const c = compare(av, bv);
      if (c !== 0) return ob.direction === "desc" ? -c : c;
    }
    return 0;
  });
  return sorted;
}

function resolveOrderKey(expr: Expr, ra: Record<string, unknown>): string {
  const tryKeys = (cand: string[]) =>
    cand.find((k) => Object.prototype.hasOwnProperty.call(ra, k)) ?? cand[0]!;
  if (expr.type === "column") {
    if (expr.table) return tryKeys([`${expr.table}.${expr.name}`, expr.name]);
    return tryKeys([expr.name]);
  }
  const lbl = columnLabel(expr);
  if (Object.prototype.hasOwnProperty.call(ra, lbl)) return lbl;
  return lbl;
}

export function executeQuery(db: JsonDatabase, query: Query): Record<string, unknown>[] {
  let rows = buildBaseRows(db, query);
  for (const j of query.joins) {
    rows = joinRows(db, rows, j);
  }
  if (query.where) {
    rows = rows.filter((ctx) => truthy(evalExpr(ctx, query.where!)));
  }

  const multiTable = getAliases(query).length > 1;

  const needGroup = query.groupBy.length > 0 || selectHasAggregate(query.select);
  if (!needGroup) {
    let projected = rows.map((ctx) =>
      mergeProjections(
        query.select.map((it, i) => projectRow(ctx, it, multiTable, i)),
      ),
    );
    projected = orderByRowsResolved(projected, query.orderBy);
    const off = query.offset ?? 0;
    const lim = query.limit;
    const sliced =
      lim !== undefined ? projected.slice(off, off + lim) : projected.slice(off);
    return sliced;
  }

  let groups: RowCtx[][];
  if (query.groupBy.length === 0) {
    groups = [rows];
  } else {
    const map = new Map<string, RowCtx[]>();
    for (const ctx of rows) {
      const keyParts = query.groupBy.map((e) => evalExpr(ctx, e));
      const key = JSON.stringify(keyParts);
      const arr = map.get(key);
      if (arr) arr.push(ctx);
      else map.set(key, [ctx]);
    }
    groups = [...map.values()];
  }

  if (query.having) {
    groups = groups.filter((g) => truthy(evalGroupExpr(g, query.having!)));
  }

  let projected = groups.map((g) =>
    mergeProjections(query.select.map((it, i) => projectGroupRow(g, it, i))),
  );
  projected = orderByRowsResolved(projected, query.orderBy);
  const off = query.offset ?? 0;
  const lim = query.limit;
  return lim !== undefined ? projected.slice(off, off + lim) : projected.slice(off);
}
