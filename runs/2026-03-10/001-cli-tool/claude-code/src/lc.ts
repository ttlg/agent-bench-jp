#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

interface FileResult {
  file: string;
  lines: number;
}

interface Options {
  ext?: string;
  sort: boolean;
  total: boolean;
}

function parseArgs(args: string[]): { dir: string; options: Options } {
  const options: Options = { sort: false, total: false };
  let dir = ".";
  const positionals: string[] = [];

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
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length > 0) {
    dir = positionals[0];
  }

  return { dir, options };
}

function shouldSkip(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

function collectFiles(dirPath: string, ext?: string): FileResult[] {
  const results: FileResult[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, ext));
    } else if (entry.isFile()) {
      if (ext && path.extname(entry.name) !== ext) continue;
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content === "" ? 0 : content.split("\n").length;
        results.push({ file: fullPath, lines });
      } catch {
        // skip unreadable files
      }
    }
  }

  return results;
}

function main(): void {
  const { dir, options } = parseArgs(process.argv.slice(2));

  const resolvedDir = path.resolve(dir);
  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.error(`Error: "${dir}" is not a valid directory`);
    process.exit(1);
  }

  let results = collectFiles(resolvedDir, options.ext);

  if (options.sort) {
    results.sort((a, b) => b.lines - a.lines);
  }

  if (results.length === 0) {
    console.log("No files found.");
    return;
  }

  const maxLines = Math.max(...results.map((r) => r.lines));
  const pad = String(maxLines).length;

  for (const r of results) {
    const rel = path.relative(resolvedDir, r.file);
    console.log(`${String(r.lines).padStart(pad)}  ${rel}`);
  }

  if (options.total) {
    const total = results.reduce((sum, r) => sum + r.lines, 0);
    const separator = "-".repeat(pad + 2);
    console.log(separator);
    console.log(`${String(total).padStart(pad)}  total (${results.length} files)`);
  }
}

main();
