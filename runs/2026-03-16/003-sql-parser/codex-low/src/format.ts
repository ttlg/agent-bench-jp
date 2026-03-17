import type { JsonObject } from "./types.ts";

export function formatJson(rows: JsonObject[]) {
  return JSON.stringify(rows, null, 2);
}

export function formatTable(rows: JsonObject[], columns: string[]) {
  if (rows.length === 0) {
    return columns.length > 0 ? columns.join(" | ") : "(no rows)";
  }
  const widths = new Map<string, number>();
  for (const column of columns) {
    widths.set(column, column.length);
  }
  for (const row of rows) {
    for (const column of columns) {
      const width = String(row[column] ?? "null").length;
      widths.set(column, Math.max(widths.get(column) ?? 0, width));
    }
  }
  const render = (values: string[]) => values.map((value, index) => value.padEnd(widths.get(columns[index]) ?? value.length)).join(" | ");
  const header = render(columns);
  const separator = columns.map((column) => "-".repeat(widths.get(column) ?? column.length)).join("-+-");
  const body = rows.map((row) => render(columns.map((column) => String(row[column] ?? "null"))));
  return [header, separator, ...body].join("\n");
}
