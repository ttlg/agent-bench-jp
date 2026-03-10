#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";

interface Options {
  dir: string;
  ext?: string;
  sort: boolean;
  total: boolean;
}

interface FileCount {
  file: string;
  lines: number;
}

function parseArgs(args: string[]): Options {
  const opts: Options = { dir: ".", sort: false, total: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ext") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --ext requires a value");
        process.exit(1);
      }
      opts.ext = val.startsWith(".") ? val : `.${val}`;
    } else if (arg === "--sort") {
      opts.sort = true;
    } else if (arg === "--total") {
      opts.total = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      opts.dir = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Usage: lc [directory] [options]

Options:
  --ext <ext>   Count only files with the given extension (e.g. --ext .ts)
  --sort        Sort by line count (descending)
  --total       Show total line count
  -h, --help    Show this help`);
}

function collectFiles(dir: string, ext?: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (ext && path.extname(entry.name) !== ext) continue;
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, "utf-8");
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const resolvedDir = path.resolve(opts.dir);

  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.error(`Error: "${opts.dir}" is not a valid directory`);
    process.exit(1);
  }

  const files = collectFiles(resolvedDir, opts.ext);
  if (files.length === 0) {
    console.log("No files found.");
    return;
  }

  let counts: FileCount[] = files.map((f) => ({
    file: path.relative(resolvedDir, f),
    lines: countLines(f),
  }));

  if (opts.sort) {
    counts.sort((a, b) => b.lines - a.lines);
  }

  const maxPath = Math.max(...counts.map((c) => c.file.length));
  const maxNum = Math.max(...counts.map((c) => String(c.lines).length));

  for (const c of counts) {
    console.log(`${c.file.padEnd(maxPath)}  ${String(c.lines).padStart(maxNum)}`);
  }

  if (opts.total) {
    const total = counts.reduce((sum, c) => sum + c.lines, 0);
    const lineWidth = maxPath + 2 + maxNum;
    console.log("─".repeat(lineWidth));
    console.log(`${"合計".padEnd(maxPath)}  ${String(total).padStart(maxNum)}`);
  }
}

main();
