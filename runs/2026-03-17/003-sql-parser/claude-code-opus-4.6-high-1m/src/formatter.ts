import { Row } from "./types";

export function formatTable(rows: Row[]): string {
  if (rows.length === 0) return "(0 rows)";

  const columns = Object.keys(rows[0]);

  // Compute column widths
  const widths = columns.map((col) => {
    const valueWidths = rows.map((row) => displayWidth(String(row[col] ?? "NULL")));
    return Math.max(displayWidth(col), ...valueWidths);
  });

  const lines: string[] = [];

  // Header
  lines.push(
    "| " +
      columns.map((col, i) => padEnd(col, widths[i])).join(" | ") +
      " |"
  );

  // Separator
  lines.push(
    "|" +
      widths.map((w) => "-".repeat(w + 2)).join("|") +
      "|"
  );

  // Rows
  for (const row of rows) {
    lines.push(
      "| " +
        columns
          .map((col, i) => {
            const val = row[col];
            const str = val === null || val === undefined ? "NULL" : String(val);
            if (typeof val === "number") {
              return padStart(str, widths[i]);
            }
            return padEnd(str, widths[i]);
          })
          .join(" | ") +
        " |"
    );
  }

  return lines.join("\n");
}

export function formatJson(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}

// Handle multi-byte characters (e.g., Japanese) for display width
function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    // CJK characters and fullwidth forms take 2 columns
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x303e) ||
      (code >= 0x3040 && code <= 0x33bf) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd) ||
      (code >= 0x30000 && code <= 0x3fffd)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padEnd(str: string, targetWidth: number): string {
  const diff = targetWidth - displayWidth(str);
  return str + " ".repeat(Math.max(0, diff));
}

function padStart(str: string, targetWidth: number): string {
  const diff = targetWidth - displayWidth(str);
  return " ".repeat(Math.max(0, diff)) + str;
}
