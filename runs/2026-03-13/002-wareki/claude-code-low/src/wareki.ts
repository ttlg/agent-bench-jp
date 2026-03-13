#!/usr/bin/env node

// 元号定義（開始日, 名前, 略称）
const ERAS = [
  { name: "明治", abbr: "M", start: new Date(1868, 0, 25) },
  { name: "大正", abbr: "T", start: new Date(1912, 6, 30) },
  { name: "昭和", abbr: "S", start: new Date(1926, 11, 25) },
  { name: "平成", abbr: "H", start: new Date(1989, 0, 8) },
  { name: "令和", abbr: "R", start: new Date(2019, 4, 1) },
];

const DAY_NAMES_JA = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isValidDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function parseISO(s: string): Date {
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`不正な日付形式です: ${s} (YYYY-MM-DD形式で入力してください)`);
  const [, ys, ms, ds] = match;
  const y = Number(ys), m = Number(ms), d = Number(ds);
  if (!isValidDate(y, m, d)) throw new Error(`不正な日付です: ${s}`);
  return new Date(y, m - 1, d);
}

function parseWareki(s: string): Date {
  const match = s.match(/^(明治|大正|昭和|平成|令和)(\d+)年(\d+)月(\d+)日$/);
  if (!match) throw new Error(`不正な和暦形式です: ${s} (例: 令和8年3月10日)`);
  const eraName = match[1];
  const eraYear = Number(match[2]), m = Number(match[3]), d = Number(match[4]);
  const eraIdx = ERAS.findIndex(e => e.name === eraName);
  if (eraIdx === -1) throw new Error(`不明な元号です: ${eraName}`);
  const era = ERAS[eraIdx]!;
  const seirekiYear = era.start.getFullYear() + eraYear - 1;
  if (!isValidDate(seirekiYear, m, d)) throw new Error(`不正な日付です: ${s}`);
  const date = new Date(seirekiYear, m - 1, d);
  if (date < era.start) throw new Error(`${eraName}${eraYear}年${m}月${d}日は${eraName}の範囲外です`);
  if (eraIdx < ERAS.length - 1 && date >= ERAS[eraIdx + 1]!.start) {
    throw new Error(`${eraName}${eraYear}年${m}月${d}日は${eraName}の範囲外です`);
  }
  return date;
}

function toWareki(date: Date, short: boolean): string {
  // 元号を逆順で探す（新しい元号から）
  for (let i = ERAS.length - 1; i >= 0; i--) {
    if (date >= ERAS[i]!.start) {
      const era = ERAS[i]!;
      const eraYear = date.getFullYear() - era.start.getFullYear() + 1;
      const m = date.getMonth() + 1;
      const d = date.getDate();
      if (short) {
        return `${era.abbr}${eraYear}.${m}.${d}`;
      }
      const yearStr = eraYear === 1 ? "元" : String(eraYear);
      const dow = DAY_NAMES_JA[date.getDay()];
      return `${era.name}${yearStr}年${m}月${d}日（${dow}）`;
    }
  }
  throw new Error(`対応する元号がありません（明治以前の日付です）`);
}

function toSeireki(date: Date, short: boolean): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  if (short) {
    return `${y}-${m}-${d}`;
  }
  const dow = DAY_NAMES_EN[date.getDay()];
  return `${y}-${m}-${d} (${dow})`;
}

function usage(): void {
  console.log(`使い方:
  wareki to-wareki <YYYY-MM-DD> [--format short]
  wareki to-seireki <和暦文字列>  [--format short]

例:
  wareki to-wareki 2026-03-10
  wareki to-seireki 令和8年3月10日
  wareki to-wareki 2026-03-10 --format short`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) usage();

  const subcommand = args[0];
  const input = args[1];
  const short = args.includes("--format") && args[args.indexOf("--format") + 1] === "short";

  try {
    switch (subcommand) {
      case "to-wareki": {
        const date = parseISO(input!);
        console.log(toWareki(date, short));
        break;
      }
      case "to-seireki": {
        const date = parseWareki(input!);
        console.log(toSeireki(date, short));
        break;
      }
      default:
        console.error(`不明なサブコマンド: ${subcommand}`);
        usage();
    }
  } catch (e: any) {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  }
}

main();
