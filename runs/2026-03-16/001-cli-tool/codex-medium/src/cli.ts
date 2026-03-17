#!/usr/bin/env -S node --experimental-strip-types

import { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const targetDirectory = path.resolve(options.directory);
  const files = await collectFiles(targetDirectory, options.ext);
  const counts = await countLines(files, targetDirectory);

  if (options.sort) {
    counts.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  }

  for (const entry of counts) {
    console.log(`${String(entry.lines).padStart(6)}  ${entry.path}`);
  }

  if (options.total) {
    const totalLines = counts.reduce((sum, entry) => sum + entry.lines, 0);
    console.log(`${String(totalLines).padStart(6)}  TOTAL`);
  }
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
        throw new Error("--ext requires a value");
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
      throw new Error(`Unknown option: ${arg}`);
    }

    if (directory !== ".") {
      throw new Error("Only one directory path can be provided");
    }

    directory = arg;
  }

  return { directory, ext, sort, total };
}

async function collectFiles(directory: string, ext?: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (shouldSkipEntry(entry)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, ext)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (ext && path.extname(entry.name) !== ext) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function shouldSkipEntry(entry: Dirent): boolean {
  if (entry.name === "node_modules") {
    return true;
  }

  return entry.name.startsWith(".");
}

async function countLines(files: string[], rootDirectory: string): Promise<FileCount[]> {
  const counts = await Promise.all(
    files.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");
      return {
        path: path.relative(rootDirectory, filePath) || path.basename(filePath),
        lines: getLineCount(content)
      };
    })
  );

  return counts;
}

function getLineCount(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  let count = 1;
  for (const character of content) {
    if (character === "\n") {
      count += 1;
    }
  }
  return count;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`lc: ${message}`);
  process.exitCode = 1;
});
