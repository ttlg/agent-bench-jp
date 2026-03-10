#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(currentDir, "..");
const entrypoint = resolve(rootDir, "src/cli.ts");

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", entrypoint, ...process.argv.slice(2)],
  {
    cwd: rootDir,
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
