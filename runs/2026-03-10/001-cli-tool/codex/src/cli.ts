#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type Options = {
  directory: string;
  ext?: string;
  sort: boolean;
  total: boolean;
};

type CountResult = {
  path: string;
  lines: number;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const baseDir = path.resolve(options.directory);
  const results = await collectLineCounts(baseDir, options.ext);

  if (options.sort) {
    results.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  } else {
    results.sort((a, b) => a.path.localeCompare(b.path));
  }

  printResults(results, options.total);
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
        throw new Error("--ext には拡張子を指定してください。例: --ext .ts");
      }
      ext = value.startsWith(".") ? value : `.${value}`;
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

    if (arg.startsWith("--")) {
      throw new Error(`不明なオプションです: ${arg}`);
    }

    directory = arg;
  }

  return { directory, ext, sort, total };
}

async function collectLineCounts(baseDir: string, ext?: string): Promise<CountResult[]> {
  const results: CountResult[] = [];
  await walk(baseDir, baseDir, ext, results);
  return results;
}

async function walk(currentDir: string, baseDir: string, ext: string | undefined, results: CountResult[]): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, baseDir, ext, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (ext && path.extname(entry.name) !== ext) {
      continue;
    }

    const content = await readFile(fullPath, "utf8");
    const relativePath = path.relative(baseDir, fullPath) || entry.name;

    results.push({
      path: relativePath,
      lines: countLines(content)
    });
  }
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const newlineCount = content.match(/\r\n|\r|\n/g)?.length ?? 0;
  return /(?:\r\n|\r|\n)$/.test(content) ? newlineCount : newlineCount + 1;
}

function printResults(results: CountResult[], showTotal: boolean): void {
  if (results.length === 0) {
    if (showTotal) {
      console.log("合計 0");
    }
    return;
  }

  const lineWidth = Math.max(...results.map((result) => String(result.lines).length));
  const pathWidth = Math.max(...results.map((result) => result.path.length));

  for (const result of results) {
    const filePath = result.path.padEnd(pathWidth, " ");
    const lines = String(result.lines).padStart(lineWidth, " ");
    console.log(`${filePath}  ${lines}`);
  }

  if (!showTotal) {
    return;
  }

  const total = results.reduce((sum, result) => sum + result.lines, 0);
  const separatorWidth = Math.max(pathWidth + lineWidth + 2, `合計 ${total}`.length);
  console.log("─".repeat(separatorWidth));
  console.log(`合計 ${total}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
