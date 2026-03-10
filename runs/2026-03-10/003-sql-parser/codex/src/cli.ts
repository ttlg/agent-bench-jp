#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { executeQuery } from "./executor.js";
import { formatResultAsJson, formatResultAsTable } from "./formatter.js";
import { parseQuery } from "./parser.js";
import type { TableData } from "./types.js";

interface CliOptions {
  dataPath: string;
  query: string;
  format: "table" | "json";
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const data = await loadData(options.dataPath);
  const query = parseQuery(options.query);
  const result = executeQuery(data, query);
  const output = options.format === "json" ? formatResultAsJson(result) : formatResultAsTable(result);
  process.stdout.write(`${output}\n`);
}

function parseArgs(args: string[]): CliOptions {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  let dataPath = "";
  let query = "";
  let format: "table" | "json" = "table";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === "--data") {
      dataPath = value ?? "";
      index += 1;
      continue;
    }
    if (arg === "--query") {
      query = value ?? "";
      index += 1;
      continue;
    }
    if (arg === "--format") {
      if (value !== "table" && value !== "json") {
        throw new Error(`Unsupported format "${value ?? ""}"`);
      }
      format = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument "${arg}"`);
  }

  if (!dataPath) {
    throw new Error("Missing required option --data");
  }
  if (!query) {
    throw new Error("Missing required option --query");
  }

  return { dataPath, query, format };
}

async function loadData(path: string): Promise<TableData> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JSON data must be an object keyed by table name");
  }
  return parsed as TableData;
}

function printHelp(): void {
  process.stdout.write("Usage: jsql --data <JSONファイル> --query \"<SQL文>\" [--format table|json]\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
