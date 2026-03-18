#!/usr/bin/env node
import {
  convertSeirekiToWareki,
  convertSeirekiToWarekiWithWeekday,
  convertWarekiToSeireki,
} from "./calendar";
import type { WarekiFormat } from "./calendar";

type CommandName = "to-wareki" | "to-seireki";

interface ParsedArgs {
  command: CommandName;
  input: string;
  format: WarekiFormat;
}

function printUsage(): void {
  console.log(`Usage:
  wareki to-wareki <YYYY-MM-DD> [--format short]
  wareki to-seireki <和暦文字列>

Options:
  --format short   短縮表記で出力します（to-wareki 用）

Examples:
  wareki to-wareki 2026-03-10
  wareki to-wareki 2026-03-10 --format short
  wareki to-seireki 令和8年3月10日
  wareki to-seireki R8.3.10
`);
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): ParsedArgs | { help: true } {
  if (argv.length === 0) {
    return { help: true };
  }

  if (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
    return { help: true };
  }

  const command = argv[0];

  if (command !== "to-wareki" && command !== "to-seireki") {
    fail(`不明なサブコマンドです: ${command}`);
  }

  let format: WarekiFormat = "long";
  const positional: string[] = [];

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "-h" || token === "--help") {
      return { help: true };
    }

    if (token === "--format" || token === "-f") {
      const value = argv[index + 1];

      if (!value) {
        fail("--format には short または long を指定してください");
      }

      if (value !== "short" && value !== "long") {
        fail(`不明な format です: ${value}`);
      }

      format = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--format=")) {
      const value = token.slice("--format=".length);

      if (value !== "short" && value !== "long") {
        fail(`不明な format です: ${value}`);
      }

      format = value;
      continue;
    }

    if (token.startsWith("-")) {
      fail(`不明なオプションです: ${token}`);
    }

    positional.push(token);
  }

  if (positional.length !== 1) {
    fail("引数の数が正しくありません");
  }

  return {
    command,
    input: positional[0],
    format,
  };
}

export function main(argv: string[]): void {
  const parsed = parseArgs(argv);

  if ("help" in parsed) {
    printUsage();
    return;
  }

  const output =
    parsed.command === "to-wareki"
      ? parsed.format === "short"
        ? convertSeirekiToWareki(parsed.input, "short")
        : convertSeirekiToWarekiWithWeekday(parsed.input)
      : convertWarekiToSeireki(parsed.input);

  console.log(output);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
