import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeQuery, formatAsJson, formatAsTable, parseQuery } from "./index.ts";
import type { JsonValue } from "./types.ts";

interface CliOptions {
  dataPath?: string;
  query?: string;
  format: "table" | "json";
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { format: "table" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--data") {
      options.dataPath = argv[++i];
    } else if (arg === "--query") {
      options.query = argv[++i];
    } else if (arg === "--format") {
      const format = argv[++i];
      if (format !== "table" && format !== "json") {
        throw new Error(`Unsupported format '${format}'`);
      }
      options.format = format;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument '${arg}'`);
    }
  }
  return options;
}

function printHelp() {
  console.log("Usage: jsql --data <JSON file> --query \"<SQL>\" [--format table|json]");
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.dataPath || !options.query) {
      printHelp();
      process.exit(1);
    }

    const raw = readFileSync(resolve(options.dataPath), "utf8");
    const data = JSON.parse(raw) as JsonValue;
    const query = parseQuery(options.query);
    const result = executeQuery(data, query);
    const output = options.format === "json" ? formatAsJson(result) : formatAsTable(result);
    console.log(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
