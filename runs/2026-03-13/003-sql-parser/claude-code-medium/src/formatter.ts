type Row = Record<string, any>;

export function formatTable(rows: Row[]): string {
  if (rows.length === 0) return '(empty result set)';

  const headers = Object.keys(rows[0]);

  // Compute display names (strip __agg_ prefix)
  const displayHeaders = headers.map(h => {
    const match = h.match(/^__agg_(\w+)_(.+)$/);
    if (match) {
      return `${match[1]}(${match[2]})`;
    }
    return h;
  });

  // Compute column widths
  const widths = displayHeaders.map((h, i) => {
    const key = headers[i];
    const maxDataWidth = rows.reduce((max, row) => {
      const val = formatValue(row[key]);
      return Math.max(max, val.length);
    }, 0);
    return Math.max(h.length, maxDataWidth);
  });

  const lines: string[] = [];

  // Header
  const headerLine = '| ' + displayHeaders.map((h, i) => {
    return h.padEnd(widths[i]);
  }).join(' | ') + ' |';
  lines.push(headerLine);

  // Separator
  const sepLine = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  lines.push(sepLine);

  // Data rows
  for (const row of rows) {
    const rowLine = '| ' + headers.map((h, i) => {
      const val = formatValue(row[h]);
      // Right-align numbers
      if (typeof row[h] === 'number') {
        return val.padStart(widths[i]);
      }
      return val.padEnd(widths[i]);
    }).join(' | ') + ' |';
    lines.push(rowLine);
  }

  return lines.join('\n');
}

export function formatJson(rows: Row[]): string {
  // Clean up keys for JSON output
  const cleaned = rows.map(row => {
    const result: Row = {};
    for (const [key, value] of Object.entries(row)) {
      const match = key.match(/^__agg_(\w+)_(.+)$/);
      if (match) {
        result[`${match[1]}(${match[2]})`] = value;
      } else {
        result[key] = value;
      }
    }
    return result;
  });
  return JSON.stringify(cleaned, null, 2);
}

function formatValue(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  return String(val);
}
