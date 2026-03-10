#!/usr/bin/env node

import { toSeirekiString, toWarekiString, type OutputFormat } from "./wareki";

type ParsedArgs = {
  command?: "to-wareki" | "to-seireki";
  input?: string;
  format: OutputFormat;
  help: boolean;
};

function main(argv: string[]): number {
  try {
    const args = parseArgs(argv);

    if (args.help) {
      printUsage();
      return 0;
    }

    if (!args.command || !args.input) {
      printUsage();
      return 1;
    }

    if (args.command === "to-wareki") {
      console.log(toWarekiString(args.input, args.format));
      return 0;
    }

    console.log(toSeirekiString(args.input, args.format));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    console.error(`エラー: ${message}`);
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    format: "long",
    help: false
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--format") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--format には値を指定してください。");
      }

      if (value !== "short") {
        throw new Error("--format は short のみ対応しています。");
      }

      parsed.format = "short";
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`未対応のオプションです: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional.length > 2) {
    throw new Error("引数が多すぎます。");
  }

  const [rawCommand, input] = positional;
  let command: ParsedArgs["command"];

  if (rawCommand) {
    if (rawCommand !== "to-wareki" && rawCommand !== "to-seireki") {
      throw new Error(`未対応のサブコマンドです: ${rawCommand}`);
    }

    command = rawCommand;
  }

  parsed.command = command;
  parsed.input = input;
  return parsed;
}

function printUsage(): void {
  console.log(`Usage:
  wareki to-wareki <YYYY-MM-DD> [--format short]
  wareki to-seireki <和暦文字列> [--format short]

Examples:
  wareki to-wareki 2026-03-10
  wareki to-seireki 令和8年3月10日
  wareki to-wareki 2026-03-10 --format short`);
}

process.exitCode = main(process.argv.slice(2));
