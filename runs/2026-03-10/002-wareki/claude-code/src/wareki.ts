#!/usr/bin/env node

// 元号定義（開始日の早い順）
interface Era {
  name: string;
  short: string;
  startYear: number;
  startMonth: number;
  startDay: number;
}

const ERAS: Era[] = [
  { name: "明治", short: "M", startYear: 1868, startMonth: 1, startDay: 25 },
  { name: "大正", short: "T", startYear: 1912, startMonth: 7, startDay: 30 },
  { name: "昭和", short: "S", startYear: 1926, startMonth: 12, startDay: 25 },
  { name: "平成", short: "H", startYear: 1989, startMonth: 1, startDay: 8 },
  { name: "令和", short: "R", startYear: 2019, startMonth: 5, startDay: 1 },
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

// ツェラーの公式で曜日を計算
function getDayOfWeek(year: number, month: number, day: number): number {
  // 1月・2月は前年の13月・14月として扱う
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const k = y % 100;
  const j = Math.floor(y / 100);
  const h = (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) - 2 * j) % 7;
  // hを0=土, 1=日, ... に変換 → JS標準の 0=日, 1=月, ... に変換
  return ((h + 6) % 7);
}

function dateToNum(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

function findEra(year: number, month: number, day: number): Era | null {
  const num = dateToNum(year, month, day);
  // 逆順で最初にマッチする元号を返す
  for (let i = ERAS.length - 1; i >= 0; i--) {
    const era = ERAS[i];
    const eraStart = dateToNum(era.startYear, era.startMonth, era.startDay);
    if (num >= eraStart) return era;
  }
  return null;
}

function toWareki(dateStr: string, short: boolean): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    console.error("エラー: 日付の形式が正しくありません。YYYY-MM-DD 形式で入力してください。");
    process.exit(1);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (!isValidDate(year, month, day)) {
    console.error("エラー: 無効な日付です。");
    process.exit(1);
  }

  const era = findEra(year, month, day);
  if (!era) {
    console.error("エラー: 対応する元号が見つかりません。明治以降の日付を入力してください。");
    process.exit(1);
  }

  const eraYear = year - era.startYear + 1;
  const dow = getDayOfWeek(year, month, day);

  if (short) {
    console.log(`${era.short}${eraYear}.${month}.${day}`);
  } else {
    const eraYearStr = eraYear === 1 ? "元" : String(eraYear);
    console.log(`${era.name}${eraYearStr}年${month}月${day}日（${DAY_NAMES_JA[dow]}）`);
  }

  return "";
}

function toSeireki(warekiStr: string, short: boolean): string {
  // 短縮形式: R8.3.10
  const shortMatch = warekiStr.match(/^([MTSHR])(\d+)\.(\d+)\.(\d+)$/);
  // 通常形式: 令和8年3月10日
  const longMatch = warekiStr.match(/^(明治|大正|昭和|平成|令和)(元|\d+)年(\d+)月(\d+)日$/);

  let eraName: string;
  let eraYear: number;
  let month: number;
  let day: number;

  if (shortMatch) {
    const shortCode = shortMatch[1];
    const era = ERAS.find((e) => e.short === shortCode);
    if (!era) {
      console.error("エラー: 不明な元号コードです。");
      process.exit(1);
    }
    eraName = era.name;
    eraYear = parseInt(shortMatch[2], 10);
    month = parseInt(shortMatch[3], 10);
    day = parseInt(shortMatch[4], 10);
  } else if (longMatch) {
    eraName = longMatch[1];
    eraYear = longMatch[2] === "元" ? 1 : parseInt(longMatch[2], 10);
    month = parseInt(longMatch[3], 10);
    day = parseInt(longMatch[4], 10);
  } else {
    console.error("エラー: 和暦の形式が正しくありません。例: 令和8年3月10日 または R8.3.10");
    process.exit(1);
  }

  const era = ERAS.find((e) => e.name === eraName);
  if (!era) {
    console.error("エラー: 不明な元号です。");
    process.exit(1);
  }

  if (eraYear < 1) {
    console.error("エラー: 元号の年は1以上である必要があります。");
    process.exit(1);
  }

  const year = era.startYear + eraYear - 1;

  if (!isValidDate(year, month, day)) {
    console.error("エラー: 無効な日付です。");
    process.exit(1);
  }

  // 変換後の日付がこの元号の範囲内か確認
  const actualEra = findEra(year, month, day);
  if (!actualEra || actualEra.name !== eraName) {
    console.error(`エラー: ${warekiStr} は ${eraName} の範囲外です。`);
    process.exit(1);
  }

  const dow = getDayOfWeek(year, month, day);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  if (short) {
    console.log(`${year}-${mm}-${dd}`);
  } else {
    console.log(`${year}-${mm}-${dd} (${DAY_NAMES_EN[dow]})`);
  }

  return "";
}

function showUsage(): void {
  console.log(`使い方:
  wareki to-wareki <YYYY-MM-DD> [--format short]   西暦 → 和暦
  wareki to-seireki <和暦文字列> [--format short]   和暦 → 西暦

例:
  wareki to-wareki 2026-03-10
  wareki to-wareki 2026-03-10 --format short
  wareki to-seireki 令和8年3月10日
  wareki to-seireki R8.3.10`);
}

// メイン処理
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  showUsage();
  process.exit(0);
}

const subcommand = args[0];
const input = args[1];
const shortFormat = args.includes("--format") && args[args.indexOf("--format") + 1] === "short";

if (!input) {
  console.error("エラー: 日付を指定してください。");
  showUsage();
  process.exit(1);
}

switch (subcommand) {
  case "to-wareki":
    toWareki(input, shortFormat);
    break;
  case "to-seireki":
    toSeireki(input, shortFormat);
    break;
  default:
    console.error(`エラー: 不明なサブコマンド '${subcommand}'`);
    showUsage();
    process.exit(1);
}
