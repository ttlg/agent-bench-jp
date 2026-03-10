#!/usr/bin/env node

import * as fs from 'fs';
import { tokenize } from './lexer';
import { parse } from './parser';
import { execute } from './executor';
import { formatTable, formatJson } from './formatter';

function main() {
  const args = process.argv.slice(2);

  let dataFile = '';
  let query = '';
  let format = 'table';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--data':
        dataFile = args[++i];
        break;
      case '--query':
        query = args[++i];
        break;
      case '--format':
        format = args[++i];
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

  const rawData = fs.readFileSync(dataFile, 'utf-8');
  const data = JSON.parse(rawData);

  const tokens = tokenize(query);
  const ast = parse(tokens);
  const results = execute(ast, data);

  if (format === 'json') {
    console.log(formatJson(results));
  } else {
    console.log(formatTable(results));
  }
}

main();
