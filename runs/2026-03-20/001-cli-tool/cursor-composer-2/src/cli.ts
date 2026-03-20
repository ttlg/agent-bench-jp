#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
const SEP = "─────────────────";

async function countLinesStream(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let lines = 0;
    let buf = "";
    const stream = createReadStream(filePath, { encoding: "utf8" });
    stream.on("data", (chunk: string | Buffer) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const segs = buf.split(/\r?\n/);
      buf = segs.pop() ?? "";
      lines += segs.length;
    });
    stream.on("end", () => {
      if (buf.length > 0) lines += 1;
      resolve(lines);
    });
    stream.on("error", reject);
  });
}

function normalizeExt(ext: string): string {
  const t = ext.trim();
  if (!t) return "";
  return t.startsWith(".") ? t : `.${t}`;
}

function shouldSkipName(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

interface CliArgs {
  dir: string;
  ext?: string;
  sort: boolean;
  total: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    dir: process.cwd(),
    sort: false,
    total: false,
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ext") {
      const v = argv[++i];
      if (v === undefined) {
        console.error("lc: --ext requires a value");
        process.exit(1);
      }
      out.ext = normalizeExt(v);
      continue;
    }
    if (a === "--sort") {
      out.sort = true;
      continue;
    }
    if (a === "--total") {
      out.total = true;
      continue;
    }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (a.startsWith("-")) {
      console.error(`lc: unknown option: ${a}`);
      process.exit(1);
    }
    positionals.push(a);
  }
  if (positionals.length > 1) {
    console.error("lc: too many arguments");
    process.exit(1);
  }
  if (positionals.length === 1) {
    out.dir = path.resolve(positionals[0]);
  }
  if (out.ext === "") {
    console.error("lc: --ext requires a non-empty extension");
    process.exit(1);
  }
  return out;
}

function printHelp(): void {
  console.log(`Usage: lc [directory] [options]

Count lines in files under a directory. Hidden names and node_modules are skipped.

Options:
  --ext <ext>   Only files with this extension (e.g. .ts or ts)
  --sort        Sort by line count descending
  --total       Print total line count
  -h, --help    Show this help`);
}

async function collectFiles(
  base: string,
  ext: string | undefined,
  acc: string[]
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error(`lc: no such directory: ${base}`);
      process.exit(1);
    }
    if (err.code === "ENOTDIR") {
      console.error(`lc: not a directory: ${base}`);
      process.exit(1);
    }
    throw e;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (shouldSkipName(ent.name)) continue;
    const full = path.join(base, ent.name);
    if (ent.isDirectory()) {
      await collectFiles(full, ext, acc);
    } else if (ent.isFile()) {
      if (ext !== undefined) {
        const e = path.extname(ent.name);
        if (e !== ext) continue;
      }
      acc.push(full);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  let stat;
  try {
    stat = await fs.stat(args.dir);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error(`lc: no such file or directory: ${args.dir}`);
      process.exit(1);
    }
    throw e;
  }
  if (!stat.isDirectory()) {
    console.error(`lc: not a directory: ${args.dir}`);
    process.exit(1);
  }

  const files: string[] = [];
  await collectFiles(args.dir, args.ext, files);

  const rows: { rel: string; lines: number }[] = [];
  for (const f of files) {
    const lines = await countLinesStream(f);
    rows.push({ rel: path.relative(args.dir, f) || f, lines });
  }

  if (args.sort) {
    rows.sort((a, b) => b.lines - a.lines || a.rel.localeCompare(b.rel));
  }

  const total = rows.reduce((s, r) => s + r.lines, 0);

  if (rows.length === 0) {
    if (args.total) {
      console.log(`${"合計".padEnd(16)} ${total}`);
    }
    return;
  }

  const maxPath = Math.max(...rows.map((r) => r.rel.length), "合計".length);
  const maxNum = Math.max(...rows.map((r) => String(r.lines).length), String(total).length);

  for (const r of rows) {
    const left = r.rel.padEnd(maxPath);
    const right = String(r.lines).padStart(maxNum);
    console.log(`${left} ${right}`);
  }

  if (args.total) {
    console.log(SEP);
    const left = "合計".padEnd(maxPath);
    const right = String(total).padStart(maxNum);
    console.log(`${left} ${right}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
