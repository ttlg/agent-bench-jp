#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { formatTable } from "./format.js";
import type { JsonDatabase } from "./execute.js";
import { runSql } from "./run.js";

function parseArgs(argv: string[]): {
  dataPath: string;
  query: string;
  format: "table" | "json";
} {
  let dataPath = "";
  let query = "";
  let format: "table" | "json" = "table";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data" && argv[i + 1]) {
      dataPath = argv[++i]!;
      continue;
    }
    if (a === "--query" && argv[i + 1]) {
      query = argv[++i]!;
      continue;
    }
    if (a === "--format" && argv[i + 1]) {
      const f = argv[++i]!;
      if (f !== "table" && f !== "json") {
        console.error(`Invalid --format: ${f} (use table or json)`);
        process.exit(1);
      }
      format = f;
      continue;
    }
    if (a === "--help" || a === "-h") {
      console.log(`Usage: jsql --data <file.json> --query "<SQL>" [--format table|json]`);
      process.exit(0);
    }
  }
  if (!dataPath || !query) {
    console.error("Usage: jsql --data <file.json> --query \"<SQL>\"");
    process.exit(1);
  }
  return { dataPath, query, format };
}

async function main() {
  const { dataPath, query, format } = parseArgs(process.argv.slice(2));
  const raw = await readFile(dataPath, "utf8");
  const db = JSON.parse(raw) as JsonDatabase;
  const rows = runSql(db, query);
  if (format === "json") {
    console.log(JSON.stringify(rows));
  } else {
    const t = formatTable(rows);
    if (t) console.log(t);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
