#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

type Options = {
  directory: string;
  ext?: string;
  sort: boolean;
  total: boolean;
};

type FileCount = {
  path: string;
  lines: number;
};

const IGNORED_DIRECTORY_NAMES = new Set(["node_modules"]);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const targetDirectory = path.resolve(process.cwd(), options.directory);

  await assertDirectory(targetDirectory);

  const counts = await collectFileCounts(targetDirectory, targetDirectory, options.ext);
  const rows = options.sort
    ? [...counts].sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
    : counts;

  printRows(rows, options.total);
}

function parseArgs(args: string[]): Options {
  let directory = ".";
  let ext: string | undefined;
  let sort = false;
  let total = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--ext") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--ext には拡張子を指定してください。");
      }

      ext = normalizeExtension(value);
      index += 1;
      continue;
    }

    if (arg === "--sort") {
      sort = true;
      continue;
    }

    if (arg === "--total") {
      total = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg.startsWith("--")) {
      throw new Error(`不明なオプションです: ${arg}`);
    }

    if (directory !== ".") {
      throw new Error("ディレクトリは 1 つだけ指定してください。");
    }

    directory = arg;
  }

  return { directory, ext, sort, total };
}

function normalizeExtension(value: string): string {
  return value.startsWith(".") ? value : `.${value}`;
}

async function assertDirectory(directoryPath: string): Promise<void> {
  const stats = await stat(directoryPath).catch(() => {
    throw new Error(`ディレクトリが見つかりません: ${directoryPath}`);
  });

  if (!stats.isDirectory()) {
    throw new Error(`ディレクトリを指定してください: ${directoryPath}`);
  }
}

async function collectFileCounts(
  currentDirectory: string,
  rootDirectory: string,
  ext?: string,
): Promise<FileCount[]> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const results: FileCount[] = [];

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) {
      continue;
    }

    const fullPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await collectFileCounts(fullPath, rootDirectory, ext)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (ext && path.extname(entry.name) !== ext) {
      continue;
    }

    results.push({
      path: formatRelativePath(rootDirectory, fullPath),
      lines: await countLines(fullPath),
    });
  }

  return results;
}

function shouldIgnore(name: string): boolean {
  if (name.startsWith(".")) {
    return true;
  }

  return IGNORED_DIRECTORY_NAMES.has(name);
}

function formatRelativePath(rootDirectory: string, filePath: string): string {
  return path.relative(rootDirectory, filePath).split(path.sep).join("/");
}

async function countLines(filePath: string): Promise<number> {
  const buffer = await readFile(filePath);

  if (buffer.length === 0) {
    return 0;
  }

  let lines = 0;

  for (const byte of buffer) {
    if (byte === 0x0a) {
      lines += 1;
    }
  }

  return buffer[buffer.length - 1] === 0x0a ? lines : lines + 1;
}

function printRows(rows: FileCount[], showTotal: boolean): void {
  if (rows.length === 0) {
    if (showTotal) {
      console.log("合計  0");
    }
    return;
  }

  const total = rows.reduce((sum, row) => sum + row.lines, 0);
  const pathWidth = Math.max(...rows.map((row) => row.path.length), showTotal ? "合計".length : 0);
  const countWidth = Math.max(...rows.map((row) => String(row.lines).length), showTotal ? String(total).length : 0);

  for (const row of rows) {
    console.log(`${row.path.padEnd(pathWidth)}  ${String(row.lines).padStart(countWidth)}`);
  }

  if (showTotal) {
    console.log(`${"─".repeat(pathWidth)}  ${"─".repeat(countWidth)}`);
    console.log(`${"合計".padEnd(pathWidth)}  ${String(total).padStart(countWidth)}`);
  }
}

function printHelp(): void {
  console.log("使い方: lc [directory] [--ext <拡張子>] [--sort] [--total]");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
