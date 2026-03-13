#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, basename, relative } from "node:path";
import { resolve } from "node:path";

interface Options {
  ext?: string;
  sort: boolean;
  total: boolean;
}

interface FileResult {
  path: string;
  lines: number;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".svn", ".hg"]);

function parseArgs(args: string[]): { dir: string; options: Options } {
  const options: Options = { sort: false, total: false };
  let dir = ".";
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ext") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --ext requires a value");
        process.exit(1);
      }
      options.ext = val.startsWith(".") ? val : `.${val}`;
    } else if (arg === "--sort") {
      options.sort = true;
    } else if (arg === "--total") {
      options.total = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    dir = positional[0];
  }

  return { dir, options };
}

function printHelp(): void {
  console.log(`
Usage: lc [directory] [options]

Count lines in files within a directory.

Arguments:
  directory          Target directory (default: current directory)

Options:
  --ext <extension>  Filter by file extension (e.g. --ext ts)
  --sort             Sort results by line count (descending)
  --total            Show total line count
  -h, --help         Show this help message
`);
}

async function collectFiles(
  dir: string,
  ext: string | undefined
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;

      // Skip hidden files/dirs and ignored directories
      if (name.startsWith(".")) continue;
      if (entry.isDirectory() && IGNORED_DIRS.has(name)) continue;

      const fullPath = join(currentDir, name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (ext && extname(name) !== ext) continue;
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

async function countLines(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, "utf-8");
    if (content.length === 0) return 0;
    // Count newlines; a file ending with \n doesn't count as an extra line
    const lines = content.split("\n");
    return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const { dir, options } = parseArgs(process.argv.slice(2));
  const absDir = resolve(dir);

  // Verify directory exists
  try {
    const s = await stat(absDir);
    if (!s.isDirectory()) {
      console.error(`Error: ${dir} is not a directory`);
      process.exit(1);
    }
  } catch {
    console.error(`Error: ${dir} does not exist`);
    process.exit(1);
  }

  const files = await collectFiles(absDir, options.ext);

  if (files.length === 0) {
    console.log("No files found.");
    return;
  }

  let results: FileResult[] = await Promise.all(
    files.map(async (f) => ({
      path: relative(absDir, f),
      lines: await countLines(f),
    }))
  );

  if (options.sort) {
    results.sort((a, b) => b.lines - a.lines);
  } else {
    results.sort((a, b) => a.path.localeCompare(b.path));
  }

  // Calculate column width for alignment
  const maxLines = Math.max(...results.map((r) => r.lines));
  const numWidth = Math.max(String(maxLines).length, 5);

  console.log(`${"Lines".padStart(numWidth)}  File`);
  console.log(`${"─".repeat(numWidth)}  ${"─".repeat(40)}`);

  let total = 0;
  for (const r of results) {
    console.log(`${String(r.lines).padStart(numWidth)}  ${r.path}`);
    total += r.lines;
  }

  if (options.total) {
    console.log(`${"─".repeat(numWidth)}  ${"─".repeat(40)}`);
    console.log(`${String(total).padStart(numWidth)}  Total (${results.length} files)`);
  }
}

main();
