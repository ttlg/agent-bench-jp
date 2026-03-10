import type { JsonPrimitive, QueryResult } from "./types.js";

export function formatResultAsJson(result: QueryResult): string {
  return JSON.stringify(result.rows, null, 2);
}

export function formatResultAsTable(result: QueryResult): string {
  const widths = result.columns.map((column) =>
    Math.max(
      stringDisplayWidth(column),
      ...result.rows.map((row) => stringDisplayWidth(formatCell(row[column]))),
    ),
  );

  const numericColumns = new Set(
    result.columns.filter((column) => result.rows.some((row) => typeof row[column] === "number")),
  );

  const header = renderLine(result.columns, widths, new Set());
  const separator = `|${widths.map((width) => "-".repeat(width + 2)).join("|")}|`;
  const lines = result.rows.map((row) =>
    renderLine(
      result.columns.map((column) => formatCell(row[column])),
      widths,
      numericColumns,
      result.columns,
    ),
  );

  return [header, separator, ...lines].join("\n");
}

function renderLine(
  cells: string[],
  widths: number[],
  numericColumns: Set<string>,
  columns: string[] = cells,
): string {
  const rendered = cells.map((cell, index) => {
    const width = widths[index];
    const column = columns[index];
    const content = numericColumns.has(column) ? padStartDisplay(cell, width) : padEndDisplay(cell, width);
    return ` ${content} `;
  });
  return `|${rendered.join("|")}|`;
}

function formatCell(value: JsonPrimitive | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function padEndDisplay(value: string, width: number): string {
  const padding = Math.max(0, width - stringDisplayWidth(value));
  return `${value}${" ".repeat(padding)}`;
}

function padStartDisplay(value: string, width: number): string {
  const padding = Math.max(0, width - stringDisplayWidth(value));
  return `${" ".repeat(padding)}${value}`;
}

function stringDisplayWidth(value: string): number {
  return Array.from(value).reduce((total, char) => total + charDisplayWidth(char), 0);
}

function charDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }

  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f)
    || (codePoint >= 0x2329 && codePoint <= 0x232a)
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  ) {
    return 2;
  }

  return 1;
}
