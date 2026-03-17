#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runQuery } from "./index.ts";
import type { DataSet } from "./types.ts";

const args = process.argv.slice(2);
const options = parseArgs(args);

if (!options.data || !options.query) {
  printUsage();
  process.exit(1);
}

const content = readFileSync(options.data, "utf8");
const data = JSON.parse(content) as DataSet;
const output = runQuery(data, options.query, options.format);
console.log(output);

function parseArgs(argv: string[]) {
  const options: { data?: string; query?: string; format: "table" | "json" } = { format: "table" };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--data") {
      options.data = argv[++i];
    } else if (value === "--query") {
      options.query = argv[++i];
    } else if (value === "--format") {
      const format = argv[++i];
      if (format !== "table" && format !== "json") {
        throw new Error(`Unsupported format: ${format}`);
      }
      options.format = format;
    }
  }
  return options;
}

function printUsage() {
  console.error('Usage: jsql --data <JSON file> --query "<SQL>" [--format table|json]');
}
