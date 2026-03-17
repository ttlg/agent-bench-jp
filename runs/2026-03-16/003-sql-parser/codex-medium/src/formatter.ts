import type { QueryResult } from "./types.ts";

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function formatAsJson(result: QueryResult): string {
  return JSON.stringify(result.rows, null, 2);
}

export function formatAsTable(result: QueryResult): string {
  const columns = result.columns.length > 0 ? result.columns : [];
  const widths = new Map<string, number>();
  for (const column of columns) {
    widths.set(column, column.length);
  }
  for (const row of result.rows) {
    for (const column of columns) {
      const width = Math.max(widths.get(column) ?? 0, stringifyValue(row[column]).length);
      widths.set(column, width);
    }
  }

  const separator = columns.map((column) => "-".repeat(widths.get(column) ?? column.length)).join("-+-");
  const header = columns.map((column) => column.padEnd(widths.get(column) ?? column.length)).join(" | ");
  const lines = [header, separator];

  for (const row of result.rows) {
    lines.push(columns.map((column) => stringifyValue(row[column]).padEnd(widths.get(column) ?? column.length)).join(" | "));
  }

  return lines.join("\n");
}
