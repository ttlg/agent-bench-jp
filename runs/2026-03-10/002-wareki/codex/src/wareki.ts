type Era = {
  kanji: "明治" | "大正" | "昭和" | "平成" | "令和";
  short: "M" | "T" | "S" | "H" | "R";
  start: {
    year: number;
    month: number;
    day: number;
  };
};

const ERAS: Era[] = [
  { kanji: "令和", short: "R", start: { year: 2019, month: 5, day: 1 } },
  { kanji: "平成", short: "H", start: { year: 1989, month: 1, day: 8 } },
  { kanji: "昭和", short: "S", start: { year: 1926, month: 12, day: 25 } },
  { kanji: "大正", short: "T", start: { year: 1912, month: 7, day: 30 } },
  { kanji: "明治", short: "M", start: { year: 1868, month: 1, day: 25 } }
];

const WEEKS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
const WEEKS_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;

type ParsedDate = {
  year: number;
  month: number;
  day: number;
};

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }

  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }

  return 31;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  return day >= 1 && day <= daysInMonth(year, month);
}

function compareDateParts(a: ParsedDate, b: ParsedDate): number {
  if (a.year !== b.year) {
    return a.year - b.year;
  }
  if (a.month !== b.month) {
    return a.month - b.month;
  }
  return a.day - b.day;
}

function toUtcDate({ year, month, day }: ParsedDate): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function parseIsoDate(input: string): ParsedDate {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("西暦は YYYY-MM-DD 形式で入力してください。");
  }

  const [, y, m, d] = match;
  const parsed = {
    year: Number(y),
    month: Number(m),
    day: Number(d)
  };

  if (!isValidDateParts(parsed.year, parsed.month, parsed.day)) {
    throw new Error("不正な日付です。");
  }

  return parsed;
}

export function parseWarekiDate(input: string): ParsedDate {
  const match = input.match(/^(明治|大正|昭和|平成|令和)(元|\d+)年(\d{1,2})月(\d{1,2})日$/);
  if (!match) {
    throw new Error("和暦は 令和8年3月10日 の形式で入力してください。");
  }

  const [, eraName, yearText, monthText, dayText] = match;
  const era = ERAS.find((item) => item.kanji === eraName);
  if (!era) {
    throw new Error("対応していない元号です。");
  }

  const eraYear = yearText === "元" ? 1 : Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(eraYear) || eraYear < 1) {
    throw new Error("和暦の年が不正です。");
  }

  const year = era.start.year + eraYear - 1;
  if (!isValidDateParts(year, month, day)) {
    throw new Error("不正な日付です。");
  }

  const parsed = { year, month, day };
  const start = era.start;
  if (eraYear === 1 && compareDateParts(parsed, start) < 0) {
    throw new Error("元号の開始日より前の日付です。");
  }

  const currentEraIndex = ERAS.findIndex((item) => item.kanji === era.kanji);
  const newerEra = currentEraIndex > 0 ? ERAS[currentEraIndex - 1] : undefined;
  if (newerEra && compareDateParts(parsed, newerEra.start) >= 0) {
    throw new Error("その日付は次の元号に属します。");
  }

  return parsed;
}

function getEraForDate(parsed: ParsedDate): Era {
  const era = ERAS.find((item) => compareDateParts(parsed, item.start) >= 0);
  if (!era) {
    throw new Error("明治以前の日付には対応していません。");
  }
  return era;
}

export function getJapaneseWeekday(parsed: ParsedDate): string {
  return WEEKS_JA[toUtcDate(parsed).getUTCDay()];
}

export function getEnglishWeekday(parsed: ParsedDate): string {
  return WEEKS_EN[toUtcDate(parsed).getUTCDay()];
}

export function toWareki(input: string, format: "long" | "short" = "long"): string {
  const parsed = parseIsoDate(input);
  const era = getEraForDate(parsed);
  const eraYear = parsed.year - era.start.year + 1;

  if (eraYear === 1 && compareDateParts(parsed, era.start) < 0) {
    throw new Error("元号の開始日より前の日付です。");
  }

  if (format === "short") {
    return `${era.short}${eraYear}.${parsed.month}.${parsed.day}`;
  }

  return `${era.kanji}${eraYear === 1 ? "元" : eraYear}年${parsed.month}月${parsed.day}日（${getJapaneseWeekday(parsed)}）`;
}

export function toSeireki(input: string, format: "long" | "short" = "long"): string {
  const parsed = parseWarekiDate(input);

  if (format === "short") {
    return `${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
  }

  return `${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")} (${getEnglishWeekday(parsed)})`;
}
