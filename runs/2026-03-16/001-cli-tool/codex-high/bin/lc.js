#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entrypoint = path.resolve(__dirname, "../src/lc.ts");

const child = spawn(
  process.execPath,
  ["--experimental-strip-types", entrypoint, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
