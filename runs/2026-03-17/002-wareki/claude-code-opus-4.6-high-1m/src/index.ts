#!/usr/bin/env node

import { toWareki, toSeireki } from "./wareki";

function printUsage(): void {
  console.log(`wareki - 西暦⇔和暦 変換ツール

使い方:
  wareki to-wareki <日付>          西暦 → 和暦に変換
  wareki to-seireki <和暦文字列>   和暦 → 西暦に変換

オプション:
  --format short    短縮表記で出力

例:
  wareki to-wareki 2026-03-10
  wareki to-wareki 2026-03-10 --format short
  wareki to-seireki 令和8年3月10日
  wareki to-seireki 令和8年3月10日 --format short`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const subcommand = args[0];
  const formatIdx = args.indexOf("--format");
  const format: "long" | "short" =
    formatIdx !== -1 && args[formatIdx + 1] === "short" ? "short" : "long";

  // サブコマンド引数（--format と その値を除外して取得）
  const positionalArgs = args.slice(1).filter((_, i) => {
    const argIdx = i + 1; // args内のインデックス
    return argIdx !== formatIdx && argIdx !== formatIdx + 1;
  });

  if (!positionalArgs[0]) {
    console.error("エラー: 日付を指定してください。");
    printUsage();
    process.exit(1);
  }

  try {
    switch (subcommand) {
      case "to-wareki":
        console.log(toWareki(positionalArgs[0], format));
        break;
      case "to-seireki":
        console.log(toSeireki(positionalArgs[0], format));
        break;
      default:
        console.error(`エラー: 不明なサブコマンドです: ${subcommand}`);
        printUsage();
        process.exit(1);
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(`エラー: ${e.message}`);
    }
    process.exit(1);
  }
}

main();
