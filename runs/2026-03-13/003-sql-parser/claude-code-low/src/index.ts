#!/usr/bin/env node
import * as fs from 'fs';
import { tokenize } from './lexer';
import { Parser } from './parser';
import { execute } from './executor';
import { formatTable, formatJson } from './formatter';

function main() {
  const args = process.argv.slice(2);
  let dataFile = '';
  let query = '';
  let format = 'table';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data' && args[i + 1]) dataFile = args[++i];
    else if (args[i] === '--query' && args[i + 1]) query = args[++i];
    else if (args[i] === '--format' && args[i + 1]) format = args[++i];
  }

  if (!dataFile || !query) {
    console.error('Usage: jsql --data <file.json> --query "<SQL>" [--format json]');
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  const tokens = tokenize(query);
  const stmt = new Parser(tokens).parse();
  const results = execute(stmt, db);

  console.log(format === 'json' ? formatJson(results) : formatTable(results));
}

main();
