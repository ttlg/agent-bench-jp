#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";

interface Options {
  dir: string;
  ext?: string;
  sort: boolean;
  total: boolean;
}

function parseArgs(args: string[]): Options {
  const opts: Options = { dir: ".", sort: false, total: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--ext" && args[i + 1]) {
      opts.ext = args[++i].replace(/^\./, "");
    } else if (a === "--sort") {
      opts.sort = true;
    } else if (a === "--total") {
      opts.total = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: lc [dir] [--ext <ext>] [--sort] [--total]`);
      process.exit(0);
    } else if (!a.startsWith("-")) {
      opts.dir = a;
    }
  }
  return opts;
}

const IGNORE = new Set(["node_modules", ".git"]);

async function collectFiles(dir: string, ext?: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".") || IGNORE.has(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        if (ext && extname(e.name).slice(1) !== ext) continue;
        results.push(full);
      }
    }
  }

  await walk(dir);
  return results;
}

async function countLines(file: string): Promise<number> {
  const content = await readFile(file, "utf-8");
  if (content.length === 0) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dirStat = await stat(opts.dir).catch(() => null);
  if (!dirStat?.isDirectory()) {
    console.error(`Error: "${opts.dir}" is not a directory`);
    process.exit(1);
  }

  const files = await collectFiles(opts.dir, opts.ext);
  if (files.length === 0) {
    console.log("No files found.");
    return;
  }

  let results = await Promise.all(
    files.map(async (f) => ({ file: relative(opts.dir, f), lines: await countLines(f) }))
  );

  if (opts.sort) {
    results.sort((a, b) => b.lines - a.lines);
  }

  const maxLines = Math.max(...results.map((r) => r.lines));
  const pad = String(maxLines).length;

  for (const r of results) {
    console.log(`${String(r.lines).padStart(pad)}  ${r.file}`);
  }

  if (opts.total) {
    const total = results.reduce((s, r) => s + r.lines, 0);
    console.log(`${"-".repeat(pad + 2)}`);
    console.log(`${String(total).padStart(pad)}  total (${results.length} files)`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
