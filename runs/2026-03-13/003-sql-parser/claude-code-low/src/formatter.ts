type Row = Record<string, any>;

export function formatTable(rows: Row[]): string {
  if (rows.length === 0) return '(empty result)';
  const keys = Object.keys(rows[0]);
  const widths = keys.map(k =>
    Math.max(k.length, ...rows.map(r => String(r[k] ?? 'NULL').length))
  );

  const header = '| ' + keys.map((k, i) => k.padEnd(widths[i])).join(' | ') + ' |';
  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  const body = rows.map(r =>
    '| ' + keys.map((k, i) => {
      const v = r[k] ?? 'NULL';
      const s = String(v);
      return typeof v === 'number' ? s.padStart(widths[i]) : s.padEnd(widths[i]);
    }).join(' | ') + ' |'
  ).join('\n');

  return [header, sep, body].join('\n');
}

export function formatJson(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}
