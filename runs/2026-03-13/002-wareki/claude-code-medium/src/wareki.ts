#!/usr/bin/env node

// 元号定義（開始日, 名称, 略称）
const ERAS: { name: string; short: string; start: [number, number, number] }[] = [
  { name: "令和", short: "R", start: [2019, 5, 1] },
  { name: "平成", short: "H", start: [1989, 1, 8] },
  { name: "昭和", short: "S", start: [1926, 12, 25] },
  { name: "大正", short: "T", start: [1912, 7, 30] },
  { name: "明治", short: "M", start: [1868, 1, 25] },
];

const DAY_NAMES_JA = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_NAMES_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  const days = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[m - 1];
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}

function dateToNum(y: number, m: number, d: number): number {
  return y * 10000 + m * 100 + d;
}

function getDayOfWeek(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d).getDay();
}

function findEra(y: number, m: number, d: number): { name: string; short: string; year: number } | null {
  const num = dateToNum(y, m, d);
  for (const era of ERAS) {
    const eraNum = dateToNum(...era.start);
    if (num >= eraNum) {
      const eraYear = y - era.start[0] + 1;
      return { name: era.name, short: era.short, year: eraYear };
    }
  }
  return null;
}

function toWareki(dateStr: string, short: boolean): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    console.error("エラー: 日付の形式が正しくありません。YYYY-MM-DD形式で入力してください。");
    process.exit(1);
  }

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);

  if (!isValidDate(y, m, d)) {
    console.error("エラー: 無効な日付です。");
    process.exit(1);
  }

  const era = findEra(y, m, d);
  if (!era) {
    console.error("エラー: 明治以前の日付には対応していません。");
    process.exit(1);
  }

  const dow = getDayOfWeek(y, m, d);

  if (short) {
    return `${era.short}${era.year}.${m}.${d}`;
  }

  const yearStr = era.year === 1 ? "元" : String(era.year);
  return `${era.name}${yearStr}年${m}月${d}日（${DAY_NAMES_JA[dow]}）`;
}

function toSeireki(warekiStr: string, short: boolean): string {
  const match = warekiStr.match(/^(明治|大正|昭和|平成|令和)(元|\d+)年(\d+)月(\d+)日$/);
  if (!match) {
    console.error("エラー: 和暦の形式が正しくありません。例: 令和8年3月10日");
    process.exit(1);
  }

  const eraName = match[1];
  const eraYear = match[2] === "元" ? 1 : parseInt(match[2], 10);
  const m = parseInt(match[3], 10);
  const d = parseInt(match[4], 10);

  const era = ERAS.find((e) => e.name === eraName);
  if (!era) {
    console.error("エラー: 不明な元号です。");
    process.exit(1);
  }

  const y = era.start[0] + eraYear - 1;

  if (!isValidDate(y, m, d)) {
    console.error("エラー: 無効な日付です。");
    process.exit(1);
  }

  // その日付が本当にこの元号の範囲内かチェック
  const num = dateToNum(y, m, d);
  const eraStartNum = dateToNum(...era.start);
  if (num < eraStartNum) {
    console.error(`エラー: ${eraName}${match[2]}年${m}月${d}日は${eraName}の開始前です。`);
    process.exit(1);
  }

  // 次の元号の開始日以降でないかチェック
  const eraIdx = ERAS.indexOf(era);
  if (eraIdx > 0) {
    const nextEra = ERAS[eraIdx - 1];
    const nextEraStartNum = dateToNum(...nextEra.start);
    if (num >= nextEraStartNum) {
      console.error(
        `エラー: ${eraName}${match[2]}年${m}月${d}日は${nextEra.name}に該当します。`
      );
      process.exit(1);
    }
  }

  const dow = getDayOfWeek(y, m, d);
  const yStr = String(y).padStart(4, "0");
  const mStr = String(m).padStart(2, "0");
  const dStr = String(d).padStart(2, "0");

  if (short) {
    return `${yStr}-${mStr}-${dStr}`;
  }

  return `${yStr}-${mStr}-${dStr} (${DAY_NAMES_EN[dow]})`;
}

function printUsage(): void {
  console.log(`使い方:
  wareki to-wareki <YYYY-MM-DD> [--format short]
  wareki to-seireki <和暦文字列>  [--format short]

例:
  wareki to-wareki 2026-03-10
  wareki to-seireki 令和8年3月10日
  wareki to-wareki 2026-03-10 --format short`);
}

// --- main ---
const args = process.argv.slice(2);
const subcommand = args[0];
const input = args[1];
const shortFormat = args.includes("--format") && args[args.indexOf("--format") + 1] === "short";

if (!subcommand || !input) {
  printUsage();
  process.exit(subcommand ? 1 : 0);
}

switch (subcommand) {
  case "to-wareki":
    console.log(toWareki(input, shortFormat));
    break;
  case "to-seireki":
    console.log(toSeireki(input, shortFormat));
    break;
  default:
    console.error(`エラー: 不明なサブコマンド '${subcommand}'`);
    printUsage();
    process.exit(1);
}
