type Row = Record<string, unknown>;

export function formatTable(rows: Row[]): string {
  if (rows.length === 0) return '(no results)';

  const cols = Object.keys(rows[0]);
  const widths = cols.map(c => {
    const maxVal = rows.reduce((m, r) => {
      const s = String(r[c] ?? 'NULL');
      return s.length > m ? s.length : m;
    }, 0);
    return Math.max(c.length, maxVal);
  });

  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  const header = '|' + cols.map((c, i) => ` ${c.padEnd(widths[i])} `).join('|') + '|';

  const dataRows = rows.map(r =>
    '|' + cols.map((c, i) => {
      const val = String(r[c] ?? 'NULL');
      const isNum = typeof r[c] === 'number';
      return isNum ? ` ${val.padStart(widths[i])} ` : ` ${val.padEnd(widths[i])} `;
    }).join('|') + '|'
  );

  return [header, sep, ...dataRows].join('\n');
}

export function formatJson(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}
