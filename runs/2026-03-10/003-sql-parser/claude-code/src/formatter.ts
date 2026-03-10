type Row = Record<string, any>;

export function formatJson(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}

export function formatTable(rows: Row[]): string {
  if (rows.length === 0) {
    return '(empty result)';
  }

  const headers = Object.keys(rows[0]);

  const widths = headers.map((h) => getDisplayWidth(h));
  for (const row of rows) {
    headers.forEach((h, i) => {
      const val = String(row[h] ?? 'NULL');
      widths[i] = Math.max(widths[i], getDisplayWidth(val));
    });
  }

  const headerLine =
    '| ' + headers.map((h, i) => padRight(h, widths[i])).join(' | ') + ' |';
  const separatorLine =
    '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|';

  const dataLines = rows.map((row) => {
    return (
      '| ' +
      headers
        .map((h, i) => {
          const val = row[h];
          const str = String(val ?? 'NULL');
          if (typeof val === 'number') {
            return padLeft(str, widths[i]);
          }
          return padRight(str, widths[i]);
        })
        .join(' | ') +
      ' |'
    );
  });

  return [headerLine, separatorLine, ...dataLines].join('\n');
}

function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0)!;
    if (isFullWidth(code)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3040 && code <= 0x33bf) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2ffff) ||
    (code >= 0x30000 && code <= 0x3ffff)
  );
}

function padRight(str: string, width: number): string {
  const displayWidth = getDisplayWidth(str);
  const padding = Math.max(0, width - displayWidth);
  return str + ' '.repeat(padding);
}

function padLeft(str: string, width: number): string {
  const displayWidth = getDisplayWidth(str);
  const padding = Math.max(0, width - displayWidth);
  return ' '.repeat(padding) + str;
}
