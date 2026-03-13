import { Row } from './executor';

export function formatTable(rows: Row[]): string {
  if (rows.length === 0) {
    return '(empty result)';
  }

  const columns = Object.keys(rows[0]);

  // Compute column widths
  const widths: Record<string, number> = {};
  for (const col of columns) {
    widths[col] = col.length;
    for (const row of rows) {
      const val = formatValue(row[col]);
      widths[col] = Math.max(widths[col], val.length);
    }
  }

  const lines: string[] = [];

  // Header
  const header = '| ' + columns.map(col => padRight(col, widths[col])).join(' | ') + ' |';
  lines.push(header);

  // Separator
  const sep = '|' + columns.map(col => '-'.repeat(widths[col] + 2)).join('|') + '|';
  lines.push(sep);

  // Rows
  for (const row of rows) {
    const line = '| ' + columns.map(col => {
      const val = row[col];
      const str = formatValue(val);
      if (typeof val === 'number') {
        return padLeft(str, widths[col]);
      }
      return padRight(str, widths[col]);
    }).join(' | ') + ' |';
    lines.push(line);
  }

  return lines.join('\n');
}

export function formatJSON(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  return String(val);
}

function padRight(str: string, len: number): string {
  // Handle multi-byte characters (e.g., Japanese)
  const diff = len - displayWidth(str);
  if (diff <= 0) return str;
  return str + ' '.repeat(diff);
}

function padLeft(str: string, len: number): string {
  const diff = len - displayWidth(str);
  if (diff <= 0) return str;
  return ' '.repeat(diff) + str;
}

function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    // CJK characters take 2 columns
    if (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fa1f)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}
