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
  filePath: string;
  lines: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

function parseArgs(args: string[]): Options {
  const opts: Options = { dir: ".", sort: false, total: false };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--ext" && i + 1 < args.length) {
      opts.ext = args[++i].startsWith(".") ? args[i] : `.${args[i]}`;
    } else if (arg === "--sort") {
      opts.sort = true;
    } else if (arg === "--total") {
      opts.total = true;
    } else if (!arg.startsWith("-")) {
      opts.dir = arg;
    }
    i++;
  }
  return opts;
}

function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, "utf-8");
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

function collectFiles(dir: string, ext?: string): FileCount[] {
  const results: FileCount[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (ext && path.extname(entry.name) !== ext) continue;
        results.push({ filePath: fullPath, lines: countLines(fullPath) });
      }
    }
  }

  walk(dir);
  return results;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const resolvedDir = path.resolve(opts.dir);

  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.error(`Error: "${opts.dir}" is not a valid directory`);
    process.exit(1);
  }

  let files = collectFiles(resolvedDir, opts.ext);

  if (files.length === 0) {
    console.log("No files found.");
    return;
  }

  if (opts.sort) {
    files.sort((a, b) => b.lines - a.lines);
  }

  // Calculate column widths
  const displayPaths = files.map((f) => path.relative(resolvedDir, f.filePath));
  const maxPathLen = Math.max(...displayPaths.map((p) => p.length));
  const maxLineLen = Math.max(...files.map((f) => String(f.lines).length));

  for (let i = 0; i < files.length; i++) {
    const p = displayPaths[i].padEnd(maxPathLen);
    const l = String(files[i].lines).padStart(maxLineLen);
    console.log(`${p}  ${l}`);
  }

  if (opts.total) {
    const totalLines = files.reduce((sum, f) => sum + f.lines, 0);
    const separator = "─".repeat(maxPathLen + 2 + maxLineLen);
    console.log(separator);
    console.log(
      `${"合計".padEnd(maxPathLen - 2)}  ${String(totalLines).padStart(maxLineLen)}`
    );
  }
}

main();
