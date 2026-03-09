#!/usr/bin/env node

// 元号定義（開始日順）
interface Era {
  name: string;
  shortName: string;
  startDate: { year: number; month: number; day: number };
}

const ERAS: Era[] = [
  { name: "明治", shortName: "M", startDate: { year: 1868, month: 9, day: 8 } },
  { name: "大正", shortName: "T", startDate: { year: 1912, month: 7, day: 30 } },
  { name: "昭和", shortName: "S", startDate: { year: 1926, month: 12, day: 25 } },
  { name: "平成", shortName: "H", startDate: { year: 1989, month: 1, day: 8 } },
  { name: "令和", shortName: "R", startDate: { year: 2019, month: 5, day: 1 } },
];

// 曜日
const WEEKDAYS_JP = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

function compareDates(
  a: { year: number; month: number; day: number },
  b: { year: number; month: number; day: number }
): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function getDayOfWeek(year: number, month: number, day: number): number {
  // Zeller's congruence adapted for 0=Sunday
  const d = new Date(year, month - 1, day);
  return d.getDay();
}

function findEra(year: number, month: number, day: number): { era: Era; eraYear: number } | null {
  const date = { year, month, day };
  for (let i = ERAS.length - 1; i >= 0; i--) {
    if (compareDates(date, ERAS[i].startDate) >= 0) {
      const eraYear = year - ERAS[i].startDate.year + 1;
      return { era: ERAS[i], eraYear };
    }
  }
  return null;
}

function parseSeirekiDate(input: string): { year: number; month: number; day: number } {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`不正な日付形式です: "${input}" (YYYY-MM-DD形式で入力してください)`);
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (!isValidDate(year, month, day)) {
    throw new Error(`存在しない日付です: ${input}`);
  }
  return { year, month, day };
}

function parseWarekiDate(input: string): { year: number; month: number; day: number } {
  // 「令和8年3月10日」or 「令和元年5月1日」
  const match = input.match(/^(明治|大正|昭和|平成|令和)(元|\d+)年(\d+)月(\d+)日$/);
  if (!match) {
    throw new Error(`不正な和暦形式です: "${input}" (例: 令和8年3月10日)`);
  }
  const eraName = match[1];
  const eraYear = match[2] === "元" ? 1 : parseInt(match[2], 10);
  const month = parseInt(match[3], 10);
  const day = parseInt(match[4], 10);

  const era = ERAS.find((e) => e.name === eraName);
  if (!era) {
    throw new Error(`不明な元号です: ${eraName}`);
  }

  if (eraYear < 1) {
    throw new Error(`年は1以上を指定してください`);
  }

  const seirekiYear = era.startDate.year + eraYear - 1;

  if (!isValidDate(seirekiYear, month, day)) {
    throw new Error(`存在しない日付です: ${input}`);
  }

  // 元号の開始日より前の日付かチェック
  const date = { year: seirekiYear, month, day };
  if (compareDates(date, era.startDate) < 0) {
    throw new Error(`${eraName}${eraYear === 1 ? "元" : eraYear}年${month}月${day}日は${eraName}の開始日(${era.startDate.year}年${era.startDate.month}月${era.startDate.day}日)より前です`);
  }

  // 次の元号の開始日以降かチェック
  const eraIndex = ERAS.indexOf(era);
  if (eraIndex < ERAS.length - 1) {
    const nextEra = ERAS[eraIndex + 1];
    if (compareDates(date, nextEra.startDate) >= 0) {
      throw new Error(`${seirekiYear}年${month}月${day}日は${nextEra.name}に該当します`);
    }
  }

  return { year: seirekiYear, month, day };
}

function toWareki(input: string, short: boolean): string {
  const { year, month, day } = parseSeirekiDate(input);
  const result = findEra(year, month, day);
  if (!result) {
    throw new Error(`対応する元号が見つかりません: ${input} (明治以降の日付を入力してください)`);
  }

  const dow = getDayOfWeek(year, month, day);

  if (short) {
    return `${result.era.shortName}${result.eraYear}.${month}.${day}`;
  }
  const yearStr = result.eraYear === 1 ? "元" : String(result.eraYear);
  return `${result.era.name}${yearStr}年${month}月${day}日（${WEEKDAYS_JP[dow]}）`;
}

function toSeireki(input: string, short: boolean): string {
  const { year, month, day } = parseWarekiDate(input);
  const dow = getDayOfWeek(year, month, day);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  if (short) {
    return `${year}-${mm}-${dd}`;
  }
  return `${year}-${mm}-${dd} (${WEEKDAYS_EN[dow]})`;
}

function printUsage(): void {
  console.log(`使い方:
  wareki to-wareki <YYYY-MM-DD> [--format short]
  wareki to-seireki <和暦文字列>  [--format short]

例:
  wareki to-wareki 2026-03-10
  wareki to-wareki 2026-03-10 --format short
  wareki to-seireki 令和8年3月10日
  wareki to-seireki 令和8年3月10日 --format short

対応元号: 明治・大正・昭和・平成・令和`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  const subcommand = args[0];
  const input = args[1];
  const short = args.includes("--format") && args[args.indexOf("--format") + 1] === "short";

  if (!input) {
    console.error("エラー: 日付を指定してください");
    printUsage();
    process.exit(1);
  }

  try {
    switch (subcommand) {
      case "to-wareki":
        console.log(toWareki(input, short));
        break;
      case "to-seireki":
        console.log(toSeireki(input, short));
        break;
      default:
        console.error(`エラー: 不明なサブコマンド "${subcommand}"`);
        printUsage();
        process.exit(1);
    }
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    process.exit(1);
  }
}

main();
