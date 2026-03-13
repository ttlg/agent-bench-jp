#!/usr/bin/env node

import * as fs from 'fs';
import { tokenize } from './tokenizer';
import { Parser } from './parser';
import { execute, DataSet } from './executor';
import { formatTable, formatJSON } from './formatter';

function main() {
  const args = process.argv.slice(2);

  let dataFile: string | undefined;
  let query: string | undefined;
  let format: 'table' | 'json' = 'table';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--data':
        dataFile = args[++i];
        break;
      case '--query':
        query = args[++i];
        break;
      case '--format':
        format = args[++i] as 'table' | 'json';
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!dataFile || !query) {
    console.error('Usage: jsql --data <JSONファイル> --query "<SQL文>" [--format json]');
    process.exit(1);
  }

  let data: DataSet;
  try {
    const raw = fs.readFileSync(dataFile, 'utf-8');
    data = JSON.parse(raw);
  } catch (e: any) {
    console.error(`Failed to read data file: ${e.message}`);
    process.exit(1);
  }

  try {
    const tokens = tokenize(query);
    const parser = new Parser(tokens);
    const stmt = parser.parse();
    const results = execute(stmt, data);

    if (format === 'json') {
      console.log(formatJSON(results));
    } else {
      console.log(formatTable(results));
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

main();
