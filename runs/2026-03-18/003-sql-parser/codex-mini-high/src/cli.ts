#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseQuery } from './parser.ts';
import { executeQuery } from './executor.ts';
import { formatJson, formatTable } from './formatter.ts';
import type { DataSet } from './types.ts';

export function run(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  if (args.help || !args.data || !args.query) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const raw = readFileSync(args.data, 'utf8');
  const data = JSON.parse(raw) as DataSet;
  const parsed = parseQuery(args.query);
  const result = executeQuery(data, parsed);
  const output = args.format === 'json' ? formatJson(result) : formatTable(result);
  process.stdout.write(`${output}\n`);
}

function parseArgs(argv: string[]): { data: string | null; query: string | null; format: 'table' | 'json'; help: boolean } {
  let data: string | null = null;
  let query: string | null = null;
  let format: 'table' | 'json' = 'table';
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    switch (current) {
      case '--data':
        data = argv[++index] ?? null;
        break;
      case '--query':
        query = argv[++index] ?? null;
        break;
      case '--format':
        format = (argv[++index] ?? 'table') as 'table' | 'json';
        if (format !== 'json' && format !== 'table') {
          throw new Error(`Unsupported format: ${format}`);
        }
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return { data, query, format, help };
}

function printUsage(): void {
  process.stdout.write([
    'Usage:',
    '  jsql --data <JSONファイル> --query "<SQL文>" [--format json]',
    '',
    'Options:',
    '  --data    JSONファイルのパス',
    '  --query   実行するSQL文',
    '  --format  table (default) | json',
  ].join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
