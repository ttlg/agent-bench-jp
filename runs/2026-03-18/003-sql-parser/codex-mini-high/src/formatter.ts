import type { QueryResultRow } from './types.ts';

export function formatTable(rows: QueryResultRow[]): string {
  if (rows.length === 0) {
    return '(0 rows)';
  }

  const headers = collectHeaders(rows);
  const widths = headers.map((header) => Math.max(header.length, ...rows.map((row) => formatCell(row[header]).length)));

  const headerLine = `| ${headers.map((header, index) => padRight(header, widths[index])).join(' | ')} |`;
  const separatorLine = `|-${widths.map((width) => '-'.repeat(width)).join('-|-')}-|`;
  const body = rows.map((row) => `| ${headers.map((header, index) => padLeft(formatCell(row[header]), widths[index])).join(' | ')} |`);
  return [headerLine, separatorLine, ...body].join('\n');
}

export function formatJson(rows: QueryResultRow[]): string {
  return JSON.stringify(rows, null, 2);
}

function collectHeaders(rows: QueryResultRow[]): string[] {
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) {
        headers.push(key);
      }
    }
  }
  return headers;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function padRight(value: string, width: number): string {
  return value + ' '.repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return ' '.repeat(width - value.length) + value;
}
