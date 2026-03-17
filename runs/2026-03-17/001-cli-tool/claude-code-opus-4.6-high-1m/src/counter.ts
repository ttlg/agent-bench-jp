import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";

export interface FileLineCount {
  path: string;
  lines: number;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".svn", ".hg"]);

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

export async function countLines(filePath: string): Promise<number> {
  const content = await readFile(filePath, "utf-8");
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

export async function walkAndCount(
  dir: string,
  baseDir: string,
  ext?: string
): Promise<FileLineCount[]> {
  const results: FileLineCount[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (isHidden(entry.name) || IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const sub = await walkAndCount(fullPath, baseDir, ext);
      results.push(...sub);
    } else if (entry.isFile()) {
      if (ext && extname(entry.name) !== ext) continue;
      const lines = await countLines(fullPath);
      results.push({ path: relative(baseDir, fullPath), lines });
    }
  }

  return results;
}
