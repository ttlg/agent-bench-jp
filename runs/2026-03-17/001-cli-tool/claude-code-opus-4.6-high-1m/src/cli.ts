#!/usr/bin/env node

import { resolve } from "node:path";
import { walkAndCount, type FileLineCount } from "./counter.js";

interface Options {
  dir: string;
  ext?: string;
  sort: boolean;
  total: boolean;
}

function parseArgs(args: string[]): Options {
  const opts: Options = {
    dir: ".",
    sort: false,
    total: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--ext" && i + 1 < args.length) {
      opts.ext = args[i + 1];
      if (!opts.ext.startsWith(".")) {
        opts.ext = "." + opts.ext;
      }
      i += 2;
    } else if (arg === "--sort") {
      opts.sort = true;
      i++;
    } else if (arg === "--total") {
      opts.total = true;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      opts.dir = arg;
      i++;
    } else {
      console.error(`不明なオプション: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
使い方: lc [ディレクトリ] [オプション]

引数:
  ディレクトリ          対象ディレクトリ（省略時: カレントディレクトリ）

オプション:
  --ext <拡張子>       特定の拡張子のみカウント（例: --ext .ts）
  --sort               行数の降順でソート
  --total              合計行数を表示
  -h, --help           ヘルプを表示
`);
}

function formatOutput(results: FileLineCount[], showTotal: boolean): void {
  if (results.length === 0) {
    console.log("対象ファイルが見つかりませんでした。");
    return;
  }

  const maxPathLen = Math.max(...results.map((r) => r.path.length));
  const maxLineLen = Math.max(...results.map((r) => String(r.lines).length));

  for (const { path, lines } of results) {
    const paddedPath = path.padEnd(maxPathLen);
    const paddedLines = String(lines).padStart(maxLineLen);
    console.log(`${paddedPath}  ${paddedLines}`);
  }

  if (showTotal) {
    const total = results.reduce((sum, r) => sum + r.lines, 0);
    const separator = "─".repeat(maxPathLen + maxLineLen + 2);
    console.log(separator);
    console.log(
      `${"合計".padEnd(maxPathLen - 2)}  ${String(total).padStart(maxLineLen)}`
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);
  const targetDir = resolve(opts.dir);

  let results = await walkAndCount(targetDir, targetDir, opts.ext);

  if (opts.sort) {
    results.sort((a, b) => b.lines - a.lines);
  }

  formatOutput(results, opts.total);
}

main().catch((err) => {
  console.error(`エラー: ${err.message}`);
  process.exit(1);
});
