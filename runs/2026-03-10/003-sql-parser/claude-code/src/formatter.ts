type Row = Record<string, unknown>;

export function formatTable(rows: Row[]): string {
  if (rows.length === 0) return '(empty result set)';

  const columns = Object.keys(rows[0]);
  const widths = columns.map(col => {
    const maxDataWidth = rows.reduce((max, row) => {
      const val = formatValue(row[col]);
      return Math.max(max, displayWidth(val));
    }, 0);
    return Math.max(displayWidth(col), maxDataWidth);
  });

  const header = '| ' + columns.map((col, i) => padRight(col, widths[i])).join(' | ') + ' |';
  const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

  const dataRows = rows.map(row => {
    return '| ' + columns.map((col, i) => {
      const val = formatValue(row[col]);
      if (typeof row[col] === 'number') {
        return padLeft(val, widths[i]);
      }
      return padRight(val, widths[i]);
    }).join(' | ') + ' |';
  });

  return [header, separator, ...dataRows].join('\n');
}

export function formatJson(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  return String(val);
}

// Handle multi-byte characters for display width
function displayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    if (
      (code >= 0x1100 && code <= 0x115F) ||
      (code >= 0x2E80 && code <= 0xA4CF && code !== 0x303F) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE10 && code <= 0xFE6F) ||
      (code >= 0xFF01 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x20000 && code <= 0x2FFFF)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padRight(str: string, width: number): string {
  const diff = width - displayWidth(str);
  return str + ' '.repeat(Math.max(0, diff));
}

function padLeft(str: string, width: number): string {
  const diff = width - displayWidth(str);
  return ' '.repeat(Math.max(0, diff)) + str;
}
