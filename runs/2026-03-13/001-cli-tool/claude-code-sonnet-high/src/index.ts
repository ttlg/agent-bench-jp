#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";

interface Options {
  ext: string | null;
  sort: boolean;
  total: boolean;
}

interface FileResult {
  file: string;
  lines: number;
}

function parseArgs(): { dir: string; options: Options } {
  const args = process.argv.slice(2);
  const options: Options = { ext: null, sort: false, total: false };
  let dir = ".";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ext") {
      const ext = args[++i];
      if (!ext) {
        console.error("Error: --ext requires a value");
        process.exit(1);
      }
      options.ext = ext.startsWith(".") ? ext : "." + ext;
    } else if (arg === "--sort") {
      options.sort = true;
    } else if (arg === "--total") {
      options.total = true;
    } else if (!arg.startsWith("--")) {
      dir = arg;
    }
  }

  return { dir, options };
}

function collectFiles(dir: string, options: Options): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (options.ext && path.extname(entry.name) !== options.ext) continue;
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

function formatResults(results: FileResult[], baseDir: string, options: Options): void {
  if (results.length === 0) {
    console.log("No files found.");
    return;
  }

  const displayed = options.sort
    ? [...results].sort((a, b) => b.lines - a.lines)
    : results;

  const maxFile = Math.max(...displayed.map((r) => path.relative(baseDir, r.file).length));
  const maxLines = Math.max(...displayed.map((r) => String(r.lines).length));
  const colWidth = Math.max(maxFile, 10);
  const numWidth = Math.max(maxLines, 5);

  for (const { file, lines } of displayed) {
    const rel = path.relative(baseDir, file);
    console.log(`${rel.padEnd(colWidth)}  ${String(lines).padStart(numWidth)}`);
  }

  if (options.total) {
    const total = results.reduce((sum, r) => sum + r.lines, 0);
    const divider = "─".repeat(colWidth + numWidth + 2);
    console.log(divider);
    console.log(`${"合計".padEnd(colWidth)}  ${String(total).padStart(numWidth)}`);
  }
}

function main(): void {
  const { dir, options } = parseArgs();

  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    console.error(`Error: '${dir}' is not a valid directory`);
    process.exit(1);
  }

  const files = collectFiles(absDir, options);
  const results: FileResult[] = files.map((file) => ({
    file,
    lines: countLines(file),
  }));

  formatResults(results, absDir, options);
}

main();
