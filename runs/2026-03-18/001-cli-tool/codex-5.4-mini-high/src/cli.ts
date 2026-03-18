#!/usr/bin/env node

import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

type Options = {
  dir: string;
  ext: string | null;
  sort: boolean;
  total: boolean;
  help: boolean;
};

type FileCount = {
  path: string;
  lines: number;
};

const USAGE = `Usage:
  lc [directory] [--ext <ext>] [--sort] [--total]

Options:
  --ext <ext>   Count only files with the given extension (for example, .ts)
  --sort        Sort by line count descending
  --total       Print total line count
  -h, --help    Show this help
`;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dir: ".",
    ext: null,
    sort: false,
    total: false,
    help: false,
  };

  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--sort") {
      options.sort = true;
      continue;
    }

    if (arg === "--total") {
      options.total = true;
      continue;
    }

    if (arg === "--ext") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--ext requires a value");
      }
      options.ext = normalizeExt(value);
      i += 1;
      continue;
    }

    if (arg.startsWith("--ext=")) {
      const value = arg.slice("--ext=".length);
      if (!value) {
        throw new Error("--ext requires a value");
      }
      options.ext = normalizeExt(value);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 1) {
    throw new Error("Only one directory path can be provided");
  }

  if (positionals.length === 1) {
    options.dir = positionals[0];
  }

  return options;
}

function normalizeExt(ext: string): string {
  return ext.startsWith(".") ? ext : `.${ext}`;
}

function toDisplayPath(root: string, fullPath: string): string {
  return path.relative(root, fullPath).split(path.sep).join("/");
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  const newlineMatches = text.match(/\r\n|\r|\n/g);
  const newlineCount = newlineMatches?.length ?? 0;
  const endsWithNewline = text.endsWith("\n") || text.endsWith("\r");

  return newlineCount + (endsWithNewline ? 0 : 1);
}

async function collectFiles(dir: string, options: Pick<Options, "ext">): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, options)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (options.ext && path.extname(entry.name) !== options.ext) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

async function main(): Promise<void> {
  let options: Options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(USAGE.trimEnd());
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE.trimEnd());
    return;
  }

  const root = path.resolve(options.dir);

  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      throw new Error(`${options.dir} is not a directory`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const filePaths = await collectFiles(root, options);
  const counts: FileCount[] = [];

  for (const filePath of filePaths) {
    const content = await readFile(filePath, "utf8");
    counts.push({
      path: toDisplayPath(root, filePath),
      lines: countLines(content),
    });
  }

  if (options.sort) {
    counts.sort((a, b) => {
      if (b.lines !== a.lines) {
        return b.lines - a.lines;
      }
      return a.path.localeCompare(b.path);
    });
  }

  const pathWidth = Math.max(
    0,
    ...counts.map((item) => item.path.length),
    options.total ? "合計".length : 0,
  );

  const renderedRows = counts.map((item) => `${item.path.padEnd(pathWidth + 2)}${item.lines}`);

  const totalLines = counts.reduce((sum, item) => sum + item.lines, 0);
  const totalText = `${"合計".padEnd(pathWidth + 2)}${totalLines}`;
  const separatorWidth = Math.max(
    ...renderedRows.map((row) => row.length),
    options.total ? totalText.length : 0,
    0,
  );

  for (const row of renderedRows) {
    console.log(row);
  }

  if (options.total) {
    console.log("─".repeat(separatorWidth));
    console.log(totalText);
  }
}

void main();
