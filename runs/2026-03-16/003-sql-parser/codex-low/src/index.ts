import { executeQuery } from "./engine.ts";
import { formatJson, formatTable } from "./format.ts";
import { parseSql } from "./parser.ts";
import type { DataSet } from "./types.ts";

export function runQuery(data: DataSet, sql: string, format: "table" | "json" = "table") {
  const ast = parseSql(sql);
  const result = executeQuery(data, ast);
  return format === "json" ? formatJson(result.rows) : formatTable(result.rows, result.columns);
}
