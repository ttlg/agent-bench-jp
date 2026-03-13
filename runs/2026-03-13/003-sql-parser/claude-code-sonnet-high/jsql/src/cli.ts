#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { parse } from './parser';
import { execute } from './executor';
import { formatTable, formatJson } from './formatter';
import { SelectStatement } from './ast';

function printUsage(): void {
  console.log('Usage: jsql --data <JSON file> --query "<SQL>" [--format table|json]');
}

function main(): void {
  const args = process.argv.slice(2);
  let dataFile: string | undefined;
  let query: string | undefined;
  let format: 'table' | 'json' = 'table';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data' && args[i + 1]) { dataFile = args[++i]; }
    else if (args[i] === '--query' && args[i + 1]) { query = args[++i]; }
    else if (args[i] === '--format' && args[i + 1]) {
      const f = args[++i];
      if (f !== 'table' && f !== 'json') { console.error(`Unknown format: ${f}`); process.exit(1); }
      format = f;
    }
  }

  if (!dataFile || !query) { printUsage(); process.exit(1); }

  const dataPath = path.resolve(dataFile);
  if (!fs.existsSync(dataPath)) { console.error(`File not found: ${dataPath}`); process.exit(1); }

  let db: Record<string, Record<string, unknown>[]>;
  try {
    db = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  } catch (e) {
    console.error(`Failed to parse JSON: ${(e as Error).message}`); process.exit(1);
  }

  let stmt;
  try {
    stmt = parse(query);
  } catch (e) {
    console.error(`Parse error: ${(e as Error).message}`); process.exit(1);
  }

  let results;
  try {
    results = execute(stmt as SelectStatement, db);
  } catch (e) {
    console.error(`Execution error: ${(e as Error).message}`); process.exit(1);
  }

  if (format === 'json') {
    console.log(formatJson(results));
  } else {
    console.log(formatTable(results));
  }
}

main();
