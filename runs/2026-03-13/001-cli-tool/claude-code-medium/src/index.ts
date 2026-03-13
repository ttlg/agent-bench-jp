#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";

interface Options {
  ext?: string;
  sort: boolean;
  total: boolean;
}

interface FileResult {
  file: string;
  lines: number;
}

const IGNORE_DIRS = new Set(["node_modules", ".git", ".svn", ".hg"]);

function parseArgs(argv: string[]): { dir: string; options: Options } {
  const args = argv.slice(2);
  const options: Options = { sort: false, total: false };
  let dir = ".";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--ext":
        if (i + 1 < args.length) {
          options.ext = args[++i].replace(/^\./, "");
        } else {
          console.error("Error: --ext requires a value");
          process.exit(1);
        }
        break;
      case "--sort":
        options.sort = true;
        break;
      case "--total":
        options.total = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (!args[i].startsWith("-")) {
          dir = args[i];
        } else {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  return { dir: path.resolve(dir), options };
}

function printHelp(): void {
  console.log(`
Usage: lc [directory] [options]

Arguments:
  directory          Target directory (default: current directory)

Options:
  --ext <extension>  Filter by file extension (e.g. --ext ts)
  --sort             Sort results by line count (descending)
  --total            Show only the total line count
  -h, --help         Show this help message
`);
}

function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, "utf-8");
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

function walkDir(dir: string, ext: string | undefined): FileResult[] {
  const results: FileResult[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, ext));
    } else if (entry.isFile()) {
      if (ext && path.extname(entry.name) !== `.${ext}`) continue;
      try {
        results.push({ file: fullPath, lines: countLines(fullPath) });
      } catch {
        // skip unreadable files
      }
    }
  }

  return results;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function main(): void {
  const { dir, options } = parseArgs(process.argv);

  if (!fs.existsSync(dir)) {
    console.error(`Error: directory not found: ${dir}`);
    process.exit(1);
  }

  let results = walkDir(dir, options.ext);

  if (results.length === 0) {
    console.log("No files found.");
    return;
  }

  if (options.sort) {
    results.sort((a, b) => b.lines - a.lines);
  }

  if (options.total) {
    const total = results.reduce((sum, r) => sum + r.lines, 0);
    console.log(`Total: ${formatNumber(total)} lines (${results.length} files)`);
    return;
  }

  const maxLines = Math.max(...results.map((r) => formatNumber(r.lines).length));

  for (const r of results) {
    const lineStr = formatNumber(r.lines).padStart(maxLines);
    const relPath = path.relative(process.cwd(), r.file);
    console.log(`  ${lineStr}  ${relPath}`);
  }

  const total = results.reduce((sum, r) => sum + r.lines, 0);
  console.log(`${"─".repeat(maxLines + 4)}`);
  console.log(`  ${formatNumber(total).padStart(maxLines)}  total (${results.length} files)`);
}

main();
