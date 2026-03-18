import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

type Options = {
  directory: string;
  ext: string | null;
  sort: boolean;
  total: boolean;
  help: boolean;
};

type FileCount = {
  filePath: string;
  lines: number;
};

const LINE_BREAK = 0x0a;
const COLUMN_GAP = 2;

function printUsage(): void {
  console.log(`Usage: lc [options] [directory]

Options:
  --ext <ext>   Count only files with the given extension
  --sort        Sort by line count descending
  --total       Show total line count
  -h, --help    Show this help
`);
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('--ext の値が空です');
  }

  return trimmed.startsWith('.') ? trimmed.toLowerCase() : `.${trimmed.toLowerCase()}`;
}

function parseArgs(argv: string[]): Options {
  const positionals: string[] = [];
  let ext: string | null = null;
  let sort = false;
  let total = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }

    if (arg === '--sort') {
      sort = true;
      continue;
    }

    if (arg === '--total') {
      total = true;
      continue;
    }

    if (arg === '--ext') {
      const value = argv[index + 1];
      if (value == null) {
        throw new Error('--ext には拡張子を指定してください');
      }
      ext = normalizeExtension(value);
      index += 1;
      continue;
    }

    if (arg.startsWith('--ext=')) {
      ext = normalizeExtension(arg.slice('--ext='.length));
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`不明なオプションです: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 1) {
    throw new Error('ディレクトリは1つだけ指定できます');
  }

  return {
    directory: positionals[0] ?? '.',
    ext,
    sort,
    total,
    help,
  };
}

function isExcludedName(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules';
}

function matchesExtension(fileName: string, ext: string): boolean {
  return extname(fileName).toLowerCase() === ext;
}

async function walkDirectory(rootDirectory: string, ext: string | null): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (isExcludedName(entry.name)) {
        continue;
      }

      const fullPath = join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (ext != null && !matchesExtension(entry.name, ext)) {
        continue;
      }

      files.push(fullPath);
    }
  }

  await walk(rootDirectory);
  return files;
}

async function countLines(filePath: string): Promise<number> {
  const stream = createReadStream(filePath);
  let lineBreaks = 0;
  let sawData = false;
  let lastByte = 0;

  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      if (buffer.length === 0) {
        continue;
      }

      sawData = true;
      lastByte = buffer[buffer.length - 1];

      for (let index = 0; index < buffer.length; index += 1) {
        if (buffer[index] === LINE_BREAK) {
          lineBreaks += 1;
        }
      }
    }
  } finally {
    stream.destroy();
  }

  if (!sawData) {
    return 0;
  }

  return lastByte === LINE_BREAK ? lineBreaks : lineBreaks + 1;
}

function formatRow(label: string, value: number, labelWidth: number, valueWidth: number): string {
  return `${label.padEnd(labelWidth)}${' '.repeat(COLUMN_GAP)}${String(value).padStart(valueWidth)}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  const rootDirectory = resolve(options.directory);
  const rootInfo = await stat(rootDirectory);
  if (!rootInfo.isDirectory()) {
    throw new Error(`ディレクトリではありません: ${options.directory}`);
  }

  const toDisplayPath = (filePath: string): string => relative(rootDirectory, filePath).split(sep).join('/');

  if (isExcludedName(basename(rootDirectory))) {
    if (options.total) {
      console.log('合計 0');
    }
    return;
  }

  const filePaths = await walkDirectory(rootDirectory, options.ext);
  const counts: FileCount[] = [];

  for (const filePath of filePaths) {
    counts.push({
      filePath,
      lines: await countLines(filePath),
    });
  }

  if (options.sort) {
    counts.sort((left, right) => {
      if (left.lines !== right.lines) {
        return right.lines - left.lines;
      }

      return toDisplayPath(left.filePath).localeCompare(toDisplayPath(right.filePath));
    });
  }

  const displayRows = counts.map((entry) => ({
    label: toDisplayPath(entry.filePath),
    value: entry.lines,
  }));

  if (displayRows.length === 0) {
    if (options.total) {
      console.log('合計 0');
    }
    return;
  }

  const totalLines = counts.reduce((sum, entry) => sum + entry.lines, 0);
  const labels = displayRows.map((entry) => entry.label);
  if (options.total) {
    labels.push('合計');
  }

  const labelWidth = Math.max(...labels.map((label) => label.length));
  const valueWidth = Math.max(
    ...displayRows.map((entry) => String(entry.value).length),
    options.total ? String(totalLines).length : 0,
  );

  for (const entry of displayRows) {
    console.log(formatRow(entry.label, entry.value, labelWidth, valueWidth));
  }

  if (options.total) {
    console.log('─'.repeat(labelWidth + COLUMN_GAP + valueWidth));
    console.log(formatRow('合計', totalLines, labelWidth, valueWidth));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`エラー: ${message}`);
  process.exitCode = 1;
});
