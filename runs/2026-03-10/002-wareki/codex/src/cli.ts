#!/usr/bin/env node

declare const process: {
  argv: string[];
  exitCode?: number;
  stderr: {
    write(message: string): void;
  };
  stdout: {
    write(message: string): void;
  };
};

import { toSeireki, toWareki } from "./wareki";

type Command = "to-wareki" | "to-seireki";
type Format = "long" | "short";

function printUsage(): void {
  process.stderr.write(
    [
      "使い方:",
      "  wareki to-wareki <YYYY-MM-DD> [--format short]",
      "  wareki to-seireki <和暦文字列> [--format short]"
    ].join("\n") + "\n"
  );
}

function parseArgs(argv: string[]): { command: Command; value: string; format: Format } {
  const args = [...argv];
  const command = args.shift();

  if (command !== "to-wareki" && command !== "to-seireki") {
    throw new Error("不明なサブコマンドです。");
  }

  let format: Format = "long";
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--format") {
      const value = args[i + 1];
      if (value !== "short") {
        throw new Error("--format には short のみ指定できます。");
      }
      format = "short";
      i += 1;
      continue;
    }

    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error("引数の数が不正です。");
  }

  return { command, value: positional[0], format };
}

function main(): void {
  try {
    const { command, value, format } = parseArgs(process.argv.slice(2));
    const output = command === "to-wareki" ? toWareki(value, format) : toSeireki(value, format);
    process.stdout.write(`${output}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "予期しないエラーです。";
    process.stderr.write(`Error: ${message}\n`);
    printUsage();
    process.exitCode = 1;
  }
}

main();
