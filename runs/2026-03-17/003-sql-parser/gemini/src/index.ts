#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import Table from 'cli-table3';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Engine } from './engine';

const program = new Command();

program
  .name('jsql')
  .description('SQL parser and execution engine for JSON data')
  .version('1.0.0')
  .requiredOption('-d, --data <path>', 'path to JSON data file')
  .requiredOption('-q, --query <sql>', 'SQL query string')
  .option('-f, --format <type>', 'output format (table or json)', 'table')
  .parse(process.argv);

const options = program.opts();

try {
  // Read JSON data
  const dataRaw = fs.readFileSync(options.data, 'utf-8');
  const data = JSON.parse(dataRaw);

  // Parse SQL
  const lexer = new Lexer(options.query);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const stmt = parser.parse();

  // Execute
  const engine = new Engine(data);
  const result = engine.execute(stmt);

  // Output
  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.length === 0) {
      console.log('No results found.');
    } else {
      const keys = Array.from(new Set(result.flatMap(r => Object.keys(r))));
      const table = new Table({
        head: keys
      });

      for (const row of result) {
        table.push(keys.map(k => {
            const val = row[k];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
        }));
      }

      console.log(table.toString());
    }
  }
} catch (error: any) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
