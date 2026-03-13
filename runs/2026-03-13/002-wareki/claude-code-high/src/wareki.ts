#!/usr/bin/env node

interface Era {
  name: string;
  shortName: string;
  startDate: [number, number, number]; // [year, month, day]
  endDate: [number, number, number] | null;
}

const ERAS: Era[] = [
  { name: "明治", shortName: "M", startDate: [1868, 1, 25], endDate: [1912, 7, 29] },
  { name: "大正", shortName: "T", startDate: [1912, 7, 30], endDate: [1926, 12, 24] },
  { name: "昭和", shortName: "S", startDate: [1926, 12, 25], endDate: [1989, 1, 7] },
  { name: "平成", shortName: "H", startDate: [1989, 1, 8], endDate: [2019, 4, 30] },
  { name: "令和", shortName: "R", startDate: [2019, 5, 1], endDate: null },
];

const DAY_OF_WEEK_JP = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_OF_WEEK_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

function compareDates(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function validateDate(year: number, month: number, day: number): void {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error("日付は整数で指定してください。");
  }
  if (month < 1 || month > 12) {
    throw new Error(`無効な月です: ${month}`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`無効な日です: ${year}年${month}月${day}日`);
  }
}

function getDayOfWeek(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay();
}

function findEra(year: number, month: number, day: number): Era {
  const date: [number, number, number] = [year, month, day];
  for (let i = ERAS.length - 1; i >= 0; i--) {
    const era = ERAS[i];
    if (compareDates(date, era.startDate) >= 0) {
      if (era.endDate === null || compareDates(date, era.endDate) <= 0) {
        return era;
      }
    }
  }
  throw new Error(`対応する元号が見つかりません: ${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

function findEraByName(name: string): Era {
  const era = ERAS.find((e) => e.name === name || e.shortName === name);
  if (!era) {
    throw new Error(`不明な元号です: ${name}`);
  }
  return era;
}

export function toWareki(isoDate: string, short: boolean): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("日付の形式が正しくありません。YYYY-MM-DD 形式で入力してください。");
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  validateDate(year, month, day);

  const era = findEra(year, month, day);
  const eraYear = year - era.startDate[0] + 1;
  const dow = getDayOfWeek(year, month, day);

  if (short) {
    return `${era.shortName}${eraYear}.${month}.${day}`;
  }

  const eraYearStr = eraYear === 1 ? "元" : String(eraYear);
  return `${era.name}${eraYearStr}年${month}月${day}日（${DAY_OF_WEEK_JP[dow]}）`;
}

export function toSeireki(warekiStr: string, short: boolean): string {
  // Parse full format: 令和8年3月10日
  const fullMatch = warekiStr.match(/^(明治|大正|昭和|平成|令和)(元|\d+)年(\d+)月(\d+)日$/);
  if (!fullMatch) {
    throw new Error("和暦の形式が正しくありません。例: 令和8年3月10日");
  }

  const eraName = fullMatch[1];
  const eraYearStr = fullMatch[2];
  const month = parseInt(fullMatch[3], 10);
  const day = parseInt(fullMatch[4], 10);

  const era = findEraByName(eraName);
  const eraYear = eraYearStr === "元" ? 1 : parseInt(eraYearStr, 10);

  if (eraYear < 1) {
    throw new Error("元号の年は1以上を指定してください。");
  }

  const seirekiYear = era.startDate[0] + eraYear - 1;

  validateDate(seirekiYear, month, day);

  // Verify the date falls within the era
  const date: [number, number, number] = [seirekiYear, month, day];
  if (compareDates(date, era.startDate) < 0) {
    throw new Error(`${eraName}${eraYearStr}年${month}月${day}日は${eraName}の開始日より前です。`);
  }
  if (era.endDate !== null && compareDates(date, era.endDate) > 0) {
    throw new Error(`${eraName}${eraYearStr}年${month}月${day}日は${eraName}の終了日より後です。`);
  }

  const dow = getDayOfWeek(seirekiYear, month, day);
  const iso = `${seirekiYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  if (short) {
    return iso;
  }

  return `${iso} (${DAY_OF_WEEK_EN[dow]})`;
}

function printUsage(): void {
  console.log(`使い方:
  wareki to-wareki <YYYY-MM-DD>       西暦 → 和暦に変換
  wareki to-seireki <和暦文字列>       和暦 → 西暦に変換

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

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  const subcommand = args[0];
  const shortFormat = args.includes("--format") && args[args.indexOf("--format") + 1] === "short";

  // Find the date argument (skip subcommand, skip --format and its value)
  const dateArgs = args.slice(1).filter((a, i, arr) => a !== "--format" && arr[i - 1] !== "--format");

  if (dateArgs.length === 0) {
    console.error("エラー: 日付を指定してください。");
    printUsage();
    process.exit(1);
  }

  const dateInput = dateArgs[0];

  try {
    switch (subcommand) {
      case "to-wareki":
        console.log(toWareki(dateInput, shortFormat));
        break;
      case "to-seireki":
        console.log(toSeireki(dateInput, shortFormat));
        break;
      default:
        console.error(`エラー: 不明なサブコマンドです: ${subcommand}`);
        printUsage();
        process.exit(1);
    }
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    process.exit(1);
  }
}

main();
