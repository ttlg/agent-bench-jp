/** 元号の定義 */
interface Era {
  name: string;
  shortName: string;
  startDate: { year: number; month: number; day: number };
  endDate: { year: number; month: number; day: number };
}

const ERAS: Era[] = [
  {
    name: "明治",
    shortName: "M",
    startDate: { year: 1868, month: 1, day: 25 },
    endDate: { year: 1912, month: 7, day: 29 },
  },
  {
    name: "大正",
    shortName: "T",
    startDate: { year: 1912, month: 7, day: 30 },
    endDate: { year: 1926, month: 12, day: 24 },
  },
  {
    name: "昭和",
    shortName: "S",
    startDate: { year: 1926, month: 12, day: 25 },
    endDate: { year: 1989, month: 1, day: 7 },
  },
  {
    name: "平成",
    shortName: "H",
    startDate: { year: 1989, month: 1, day: 8 },
    endDate: { year: 2019, month: 4, day: 30 },
  },
  {
    name: "令和",
    shortName: "R",
    startDate: { year: 2019, month: 5, day: 1 },
    endDate: { year: 9999, month: 12, day: 31 },
  },
];

const DAY_OF_WEEK_JA = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_OF_WEEK_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** 日付の比較用数値を返す (YYYYMMDD) */
function dateToNum(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

/** うるう年判定 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 月の日数を返す */
function daysInMonth(year: number, month: number): number {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return days[month - 1];
}

/** 日付の妥当性チェック */
function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/** 曜日を求める (Zellerの公式ベース) */
function getDayOfWeek(year: number, month: number, day: number): number {
  // Date オブジェクトを使わずに曜日を計算 (Tomohiko Sakamoto's algorithm)
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let y = year;
  if (month < 3) y -= 1;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[month - 1] + day) % 7;
}

/** 該当する元号を探す */
function findEra(year: number, month: number, day: number): Era | null {
  const num = dateToNum(year, month, day);
  for (const era of ERAS) {
    const start = dateToNum(era.startDate.year, era.startDate.month, era.startDate.day);
    const end = dateToNum(era.endDate.year, era.endDate.month, era.endDate.day);
    if (num >= start && num <= end) {
      return era;
    }
  }
  return null;
}

/** 和暦の年を計算 */
function warekiYear(era: Era, seirekiYear: number): number {
  return seirekiYear - era.startDate.year + 1;
}

/** 西暦 → 和暦 変換 */
export function toWareki(
  dateStr: string,
  format: "long" | "short" = "long"
): string {
  const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    throw new Error(`不正な日付形式です: ${dateStr} (YYYY-MM-DD形式で入力してください)`);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (!isValidDate(year, month, day)) {
    throw new Error(`存在しない日付です: ${dateStr}`);
  }

  const era = findEra(year, month, day);
  if (!era) {
    throw new Error(
      `対応する元号が見つかりません: ${dateStr} (明治以降の日付を入力してください)`
    );
  }

  const wYear = warekiYear(era, year);
  const dow = getDayOfWeek(year, month, day);

  if (format === "short") {
    return `${era.shortName}${wYear}.${month}.${day}`;
  }

  const yearStr = wYear === 1 ? "元" : String(wYear);
  return `${era.name}${yearStr}年${month}月${day}日（${DAY_OF_WEEK_JA[dow]}）`;
}

/** 和暦文字列をパース */
function parseWareki(
  warekiStr: string
): { era: Era; year: number; month: number; day: number } {
  // 「令和8年3月10日」形式
  const match = warekiStr.match(
    /^(明治|大正|昭和|平成|令和)(元|\d+)年(\d+)月(\d+)日$/
  );
  if (!match) {
    throw new Error(
      `不正な和暦形式です: ${warekiStr} (例: 令和8年3月10日)`
    );
  }

  const eraName = match[1];
  const wYear = match[2] === "元" ? 1 : parseInt(match[2], 10);
  const month = parseInt(match[3], 10);
  const day = parseInt(match[4], 10);

  const era = ERAS.find((e) => e.name === eraName);
  if (!era) {
    throw new Error(`不明な元号です: ${eraName}`);
  }

  return { era, year: wYear, month, day };
}

/** 和暦 → 西暦 変換 */
export function toSeireki(
  warekiStr: string,
  format: "long" | "short" = "long"
): string {
  const { era, year: wYear, month, day } = parseWareki(warekiStr);

  const seirekiYear = era.startDate.year + wYear - 1;

  if (!isValidDate(seirekiYear, month, day)) {
    throw new Error(`存在しない日付です: ${warekiStr}`);
  }

  // 変換後の日付がこの元号の範囲内かチェック
  const num = dateToNum(seirekiYear, month, day);
  const start = dateToNum(era.startDate.year, era.startDate.month, era.startDate.day);
  const end = dateToNum(era.endDate.year, era.endDate.month, era.endDate.day);
  if (num < start || num > end) {
    throw new Error(
      `${era.name}${wYear === 1 ? "元" : wYear}年${month}月${day}日は${era.name}の範囲外です`
    );
  }

  const dow = getDayOfWeek(seirekiYear, month, day);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  if (format === "short") {
    return `${seirekiYear}-${mm}-${dd}`;
  }

  return `${seirekiYear}-${mm}-${dd} (${DAY_OF_WEEK_EN[dow]})`;
}
