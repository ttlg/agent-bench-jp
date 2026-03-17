import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

type CliOptions = {
  directory: string;
  ext?: string;
  sort: boolean;
  total: boolean;
};

type FileLineCount = {
  filePath: string;
  lines: number;
};

function printUsage(): void {
  console.log(`Usage: lc [directory] [--ext <extension>] [--sort] [--total]

Options:
  --ext <extension>  Count only files with the given extension
  --sort             Sort results by line count in descending order
  --total            Show the total line count
  -h, --help         Show this help message`);
}

function parseArgs(argv: string[]): CliOptions {
  let directory = ".";
  let ext: string | undefined;
  let sort = false;
  let total = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--ext") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("Missing value for --ext");
      }

      ext = normalizeExtension(value);
      index += 1;
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

    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (directory !== ".") {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    directory = arg;
  }

  return { directory, ext, sort, total };
}

function normalizeExtension(ext: string): string {
  return ext.startsWith(".") ? ext : `.${ext}`;
}

function shouldSkip(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

async function ensureDirectory(directory: string): Promise<string> {
  const resolvedPath = path.resolve(directory);

  let stats;

  try {
    stats = await fs.stat(resolvedPath);
  } catch {
    throw new Error(`Directory not found: ${directory}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${directory}`);
  }

  return resolvedPath;
}

async function countLines(filePath: string): Promise<number> {
  const content = await fs.readFile(filePath, "utf8");

  if (content.length === 0) {
    return 0;
  }

  const normalized = content.replace(/\r\n/g, "\n");

  return normalized.endsWith("\n")
    ? normalized.split("\n").length - 1
    : normalized.split("\n").length;
}

async function walkDirectory(
  rootDirectory: string,
  currentDirectory: string,
  ext: string | undefined,
  results: FileLineCount[],
): Promise<void> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldSkip(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(rootDirectory, absolutePath, ext, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (ext && path.extname(entry.name) !== ext) {
      continue;
    }

    const lines = await countLines(absolutePath);
    const filePath = path.relative(rootDirectory, absolutePath) || entry.name;

    results.push({ filePath, lines });
  }
}

function formatCount(count: number): string {
  return count.toString().padStart(8, " ");
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const directory = await ensureDirectory(options.directory);
  const results: FileLineCount[] = [];

  await walkDirectory(directory, directory, options.ext, results);

  if (options.sort) {
    results.sort((left, right) => right.lines - left.lines || left.filePath.localeCompare(right.filePath));
  }

  for (const result of results) {
    console.log(`${formatCount(result.lines)}  ${result.filePath}`);
  }

  if (options.total) {
    const totalLines = results.reduce((sum, result) => sum + result.lines, 0);
    console.log(`${formatCount(totalLines)}  total`);
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(`Error: ${message}`);
  process.exit(1);
});
