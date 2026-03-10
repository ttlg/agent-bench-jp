// 元号の定義（開始日, 名前, 略称）
interface Era {
  name: string;
  short: string;
  startYear: number;
  startMonth: number;
  startDay: number;
}

const ERAS: Era[] = [
  { name: "令和", short: "R", startYear: 2019, startMonth: 5, startDay: 1 },
  { name: "平成", short: "H", startYear: 1989, startMonth: 1, startDay: 8 },
  { name: "昭和", short: "S", startYear: 1926, startMonth: 12, startDay: 25 },
  { name: "大正", short: "T", startYear: 1912, startMonth: 7, startDay: 30 },
  { name: "明治", short: "M", startYear: 1868, startMonth: 1, startDay: 25 },
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

function dateToNum(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

function getDayOfWeek(year: number, month: number, day: number): number {
  // Zeller's formula adapted for Date constructor
  const d = new Date(year, month - 1, day);
  return d.getDay();
}

function findEra(year: number, month: number, day: number): Era | null {
  const num = dateToNum(year, month, day);
  for (const era of ERAS) {
    const eraStart = dateToNum(era.startYear, era.startMonth, era.startDay);
    if (num >= eraStart) {
      return era;
    }
  }
  return null;
}

function parseISODate(input: string): { year: number; month: number; day: number } {
  const match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    throw new Error(`不正な日付形式です: "${input}" (YYYY-MM-DD形式で入力してください)`);
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (!isValidDate(year, month, day)) {
    throw new Error(`不正な日付です: "${input}"`);
  }
  return { year, month, day };
}

function parseWareki(input: string): { year: number; month: number; day: number } {
  // 「令和8年3月10日」or 「令和元年5月1日」
  const match = input.match(/^(明治|大正|昭和|平成|令和)(元|\d+)年(\d+)月(\d+)日$/);
  if (!match) {
    throw new Error(
      `不正な和暦形式です: "${input}" (例: 令和8年3月10日)`
    );
  }
  const eraName = match[1];
  const eraYear = match[2] === "元" ? 1 : parseInt(match[2], 10);
  const month = parseInt(match[3], 10);
  const day = parseInt(match[4], 10);

  const era = ERAS.find((e) => e.name === eraName);
  if (!era) {
    throw new Error(`不明な元号です: "${eraName}"`);
  }

  if (eraYear < 1) {
    throw new Error(`不正な和暦年です: ${eraYear}`);
  }

  const seirekiYear = era.startYear + eraYear - 1;

  if (!isValidDate(seirekiYear, month, day)) {
    throw new Error(`不正な日付です: "${input}"`);
  }

  // 元号の開始日より前かチェック
  const num = dateToNum(seirekiYear, month, day);
  const eraStart = dateToNum(era.startYear, era.startMonth, era.startDay);
  if (num < eraStart) {
    throw new Error(
      `${eraName}${match[2]}年${month}月${day}日は${eraName}の範囲外です`
    );
  }

  // 次の元号の開始日以降かチェック
  const eraIndex = ERAS.indexOf(era);
  if (eraIndex > 0) {
    const nextEra = ERAS[eraIndex - 1];
    const nextEraStart = dateToNum(nextEra.startYear, nextEra.startMonth, nextEra.startDay);
    if (num >= nextEraStart) {
      throw new Error(
        `${seirekiYear}年${month}月${day}日は${eraName}ではなく${nextEra.name}です`
      );
    }
  }

  return { year: seirekiYear, month, day };
}

function toWareki(
  year: number,
  month: number,
  day: number,
  format: "long" | "short"
): string {
  const era = findEra(year, month, day);
  if (!era) {
    throw new Error(
      `${year}年${month}月${day}日に対応する元号がありません (明治以降に対応)`
    );
  }

  const eraYear = year - era.startYear + 1;
  const dow = getDayOfWeek(year, month, day);

  if (format === "short") {
    return `${era.short}${eraYear}.${month}.${day}`;
  }

  const eraYearStr = eraYear === 1 ? "元" : String(eraYear);
  return `${era.name}${eraYearStr}年${month}月${day}日（${DAY_NAMES_JA[dow]}）`;
}

function toSeireki(
  year: number,
  month: number,
  day: number,
  format: "long" | "short"
): string {
  const dow = getDayOfWeek(year, month, day);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  if (format === "short") {
    return `${year}-${mm}-${dd}`;
  }

  return `${year}-${mm}-${dd} (${DAY_NAMES_EN[dow]})`;
}

function printUsage(): void {
  console.log(`Usage:
  wareki to-wareki <YYYY-MM-DD> [--format short]
  wareki to-seireki <和暦文字列>  [--format short]

Examples:
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
  const input = args[1];
  const formatFlag = args.includes("--format") && args[args.indexOf("--format") + 1] === "short";
  const format = formatFlag ? "short" : "long";

  if (!input) {
    console.error("エラー: 日付を指定してください");
    printUsage();
    process.exit(1);
  }

  try {
    switch (subcommand) {
      case "to-wareki": {
        const { year, month, day } = parseISODate(input);
        console.log(toWareki(year, month, day, format));
        break;
      }
      case "to-seireki": {
        const { year, month, day } = parseWareki(input);
        console.log(toSeireki(year, month, day, format));
        break;
      }
      default:
        console.error(`エラー: 不明なサブコマンド "${subcommand}"`);
        printUsage();
        process.exit(1);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`エラー: ${msg}`);
    process.exit(1);
  }
}

main();
