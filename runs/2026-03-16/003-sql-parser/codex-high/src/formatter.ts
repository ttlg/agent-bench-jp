import type { QueryResult } from "./engine.ts";

export function formatTable(result: QueryResult): string {
  if (result.columns.length === 0) {
    return "(no columns)";
  }

  const widths = result.columns.map((column) => column.length);
  const rows = result.rows.map((row) =>
    result.columns.map((column, index) => {
      const value = stringifyValue(row[column]);
      widths[index] = Math.max(widths[index], value.length);
      return value;
    })
  );

  const header = result.columns
    .map((column, index) => column.padEnd(widths[index]))
    .join(" | ");
  const separator = widths.map((width) => "-".repeat(width)).join("-+-");
  const body = rows.map((row) => row.map((value, index) => value.padEnd(widths[index])).join(" | "));

  return [header, separator, ...body].join("\n");
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
