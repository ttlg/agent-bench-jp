#!/usr/bin/env node

import type { Dirent, Stats } from "node:fs";

const fs = require("node:fs").promises as typeof import("node:fs").promises;
const path = require("node:path") as typeof import("node:path");

type Options = {
  targetDir: string;
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
  const rootDir = path.resolve(process.cwd(), options.targetDir);

  const stats = await safeStat(rootDir);
  if (!stats?.isDirectory()) {
    throw new Error(`Directory not found: ${rootDir}`);
  }

  const counts = await collectLineCounts(rootDir, rootDir, options.ext);

  if (options.sort) {
    counts.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  }

  if (counts.length === 0) {
    console.log("No matching files found.");
    return;
  }

  const width = Math.max(...counts.map((entry) => String(entry.lines).length));
  for (const entry of counts) {
    console.log(`${String(entry.lines).padStart(width, " ")}  ${entry.path}`);
  }

  if (options.total) {
    const totalLines = counts.reduce((sum, entry) => sum + entry.lines, 0);
    console.log(`${"-".repeat(width)}  ${"-".repeat(5)}`);
    console.log(`${String(totalLines).padStart(width, " ")}  total`);
  }
}

function parseArgs(args: string[]): Options {
  let targetDir = ".";
  let ext: string | undefined;
  let sort = false;
  let total = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--ext") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --ext");
      }
      ext = value.startsWith(".") ? value : `.${value}`;
      i += 1;
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

    targetDir = arg;
  }

  return { targetDir, ext, sort, total };
}

async function collectLineCounts(
  currentDir: string,
  rootDir: string,
  ext?: string,
): Promise<FileCount[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const results: FileCount[] = [];

  for (const entry of entries) {
    if (shouldSkip(entry)) {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await collectLineCounts(fullPath, rootDir, ext)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (ext && path.extname(entry.name) !== ext) {
      continue;
    }

    const content = await fs.readFile(fullPath, "utf8");
    const relativePath = path.relative(rootDir, fullPath) || entry.name;
    results.push({
      path: relativePath,
      lines: countLines(content),
    });
  }

  return results;
}

function shouldSkip(entry: Dirent): boolean {
  if (entry.name.startsWith(".")) {
    return true;
  }

  if (entry.isDirectory() && entry.name === "node_modules") {
    return true;
  }

  return false;
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.length;
}

async function safeStat(targetPath: string): Promise<Stats | null> {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
