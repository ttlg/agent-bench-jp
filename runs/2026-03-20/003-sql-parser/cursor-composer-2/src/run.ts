import type { JsonDatabase } from "./execute.js";
import { executeQuery } from "./execute.js";
import { tokenize } from "./lexer.js";
import { parseQuery } from "./parser.js";

export function runSql(db: JsonDatabase, sql: string): Record<string, unknown>[] {
  const clean = sql.trim().replace(/;\s*$/, "");
  const tokens = tokenize(clean);
  const q = parseQuery(tokens);
  return executeQuery(db, q);
}
