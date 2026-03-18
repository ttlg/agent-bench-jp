#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { executeSql, formatJson, formatTable } from './sql.ts';

interface CliOptions {
  dataPath?: string;
  query?: string;
  format: 'table' | 'json';
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    format: 'table',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    const [flag, inlineValue] = arg.split('=', 2);
    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      index += 1;
      const value = argv[index];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`);
      }
      return value;
    };

    switch (flag) {
      case '--data':
      case '-d':
        options.dataPath = takeValue();
        break;
      case '--query':
      case '-q':
        options.query = takeValue();
        break;
      case '--format':
      case '-f': {
        const value = takeValue();
        if (value !== 'table' && value !== 'json') {
          throw new Error(`Unsupported format: ${value}`);
        }
        options.format = value;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage(): void {
  process.stdout.write(
    [
      'Usage:',
      '  jsql --data <JSON file> --query "<SQL>" [--format table|json]',
      '',
      'Examples:',
      '  jsql --data data.json --query "SELECT * FROM users"',
      '  jsql --data data.json --query "SELECT name, age FROM users" --format json',
    ].join('\n') + '\n',
  );
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  if (!options.dataPath || !options.query) {
    throw new Error('Both --data and --query are required');
  }

  const raw = await readFile(options.dataPath, 'utf8');
  const data = JSON.parse(raw);
  const result = executeSql(data, options.query);
  const output = options.format === 'json' ? formatJson(result) : formatTable(result);
  process.stdout.write(output + '\n');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

export { main, parseArgs };
