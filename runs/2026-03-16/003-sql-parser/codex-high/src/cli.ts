#!/usr/bin/env -S node --experimental-strip-types
import { readFile } from "node:fs/promises";
import { executeQuery, type Database } from "./engine.ts";
import { formatTable } from "./formatter.ts";
import { parseSql } from "./parser.ts";

type CliOptions = {
  dataPath: string;
  query: string;
  format: "table" | "json";
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const data = JSON.parse(await readFile(options.dataPath, "utf8")) as Database;
  const query = parseSql(options.query);
  const result = executeQuery(data, query);

  if (options.format === "json") {
    console.log(JSON.stringify(result.rows, null, 2));
    return;
  }

  console.log(formatTable(result));
}

function parseArgs(args: string[]): CliOptions {
  let dataPath: string | undefined;
  let query: string | undefined;
  let format: "table" | "json" = "table";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--data") {
      dataPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--query") {
      query = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--format") {
      const value = args[index + 1];
      if (value !== "table" && value !== "json") {
        throw new Error(`Unsupported format "${value}"`);
      }
      format = value;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument "${arg}"`);
  }

  if (!dataPath || !query) {
    throw new Error("Usage: jsql --data <JSON file> --query \"<SQL>\" [--format table|json]");
  }

  return { dataPath, query, format };
}

function printHelp(): void {
  console.log("Usage: jsql --data <JSON file> --query \"<SQL>\" [--format table|json]");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
