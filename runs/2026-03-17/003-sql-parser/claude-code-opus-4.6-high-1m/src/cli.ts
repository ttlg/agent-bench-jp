#!/usr/bin/env node

import * as fs from "fs";
import { parse } from "./parser";
import { execute } from "./executor";
import { formatTable, formatJson } from "./formatter";
import { Database } from "./types";

function main(): void {
  const args = process.argv.slice(2);

  let dataPath: string | undefined;
  let query: string | undefined;
  let format: "table" | "json" = "table";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--data":
        dataPath = args[++i];
        break;
      case "--query":
        query = args[++i];
        break;
      case "--format":
        format = args[++i] as "table" | "json";
        break;
      case "--help":
        printUsage();
        process.exit(0);
    }
  }

  if (!dataPath || !query) {
    printUsage();
    process.exit(1);
  }

  let db: Database;
  try {
    const raw = fs.readFileSync(dataPath, "utf-8");
    db = JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading data file: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    const stmt = parse(query);
    const result = execute(stmt, db);

    if (format === "json") {
      console.log(formatJson(result));
    } else {
      console.log(formatTable(result));
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

function printUsage(): void {
  console.log(`Usage: jsql --data <file.json> --query "<SQL>" [--format table|json]`);
}

main();
