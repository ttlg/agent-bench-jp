#!/usr/bin/env node

import { convertToSeireki, convertToWareki, WarekiError } from "./wareki.ts";

type Command = "to-wareki" | "to-seireki";
type Format = "default" | "short";

function main(): void {
  try {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      printHelp();
      process.exit(args.length === 0 ? 1 : 0);
    }

    const { command, value, format } = parseArgs(args);
    const result =
      command === "to-wareki"
        ? convertToWareki(value, format)
        : command === "to-seireki"
          ? convertToSeireki(value, format)
          : invalidCommand(command);

    console.log(result);
  } catch (error) {
    if (error instanceof WarekiError) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }

    throw error;
  }
}

function parseArgs(args: string[]): { command: Command; value: string; format: Format } {
  let format: Format = "default";
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--format") {
      const formatValue = args[index + 1];

      if (formatValue !== "short") {
        throw new WarekiError("`--format` には `short` を指定してください。");
      }

      format = "short";
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new WarekiError(`不明なオプションです: ${arg}`);
    }

    positional.push(arg);
  }

  const command = positional[0];
  const value = positional[1];

  if ((command !== "to-wareki" && command !== "to-seireki") || !value || positional.length > 2) {
    throw new WarekiError("引数が不正です。`--help` で使用方法を確認してください。");
  }

  return { command, value, format };
}

function invalidCommand(command: string): never {
  throw new WarekiError(`不明なサブコマンドです: ${command}`);
}

function printHelp(): void {
  console.error("Usage:");
  console.error("  wareki to-wareki <YYYY-MM-DD> [--format short]");
  console.error("  wareki to-seireki <和暦文字列> [--format short]");
}

main();
