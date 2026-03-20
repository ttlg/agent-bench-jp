#!/usr/bin/env node
import { isoToWareki, warekiStringToSeireki } from "./wareki.js";

function parseArgs(argv: string[]): { formatShort: boolean; rest: string[] } {
  const rest: string[] = [];
  let formatShort = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--format" && argv[i + 1] === "short") {
      formatShort = true;
      i++;
      continue;
    }
    if (a === "--format=short" || a === "--short") {
      formatShort = true;
      continue;
    }
    if (a === "-h" || a === "--help") {
      rest.push("__help__");
      continue;
    }
    rest.push(a);
  }
  return { formatShort, rest };
}

function printHelp(): void {
  console.log(`wareki — 西暦（ISO 8601）と和暦（明治・大正・昭和・平成・令和）の相互変換

使い方:
  wareki to-wareki <YYYY-MM-DD>   西暦 → 和暦
  wareki to-seireki <和暦>        和暦 → 西暦

和暦の入力例: 令和8年3月10日

オプション:
  --format short   短縮表記（例: R8.3.10 / 2026-03-10 のみ）
  -h, --help       このヘルプ
`);
}

function main(): void {
  const { formatShort, rest } = parseArgs(process.argv.slice(2));
  if (rest[0] === "__help__" || rest.length === 0) {
    printHelp();
    process.exit(rest[0] === "__help__" ? 0 : 1);
  }
  const [sub, ...positional] = rest;
  if (sub === "to-wareki") {
    const dateArg = positional.join(" ").trim();
    if (!dateArg) {
      console.error("エラー: 日付を指定してください（例: wareki to-wareki 2026-03-10）");
      process.exit(1);
    }
    const r = isoToWareki(dateArg, formatShort);
    if (!r.ok) {
      console.error(`エラー: ${r.message}`);
      process.exit(1);
    }
    console.log(r.out);
    return;
  }
  if (sub === "to-seireki") {
    const warekiArg = positional.join(" ").trim();
    if (!warekiArg) {
      console.error("エラー: 和暦を指定してください（例: wareki to-seireki 令和8年3月10日）");
      process.exit(1);
    }
    const r = warekiStringToSeireki(warekiArg, formatShort);
    if (!r.ok) {
      console.error(`エラー: ${r.message}`);
      process.exit(1);
    }
    console.log(r.out);
    return;
  }
  console.error(`エラー: 不明なサブコマンド: ${sub ?? ""}`);
  printHelp();
  process.exit(1);
}

main();
