export interface DateParts {
  year: number;
  month: number;
  day: number;
}

const ERAS = [
  { name: "明治", short: "M", start: { year: 1868, month: 1, day: 25 } },
  { name: "大正", short: "T", start: { year: 1912, month: 7, day: 30 } },
  { name: "昭和", short: "S", start: { year: 1926, month: 12, day: 25 } },
  { name: "平成", short: "H", start: { year: 1989, month: 1, day: 8 } },
  { name: "令和", short: "R", start: { year: 2019, month: 5, day: 1 } },
] as const;

type Era = (typeof ERAS)[number];
export type WarekiFormat = "long" | "short";

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
const WEEKDAYS_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const LONG_WAREKI_PATTERN =
  /^(明治|大正|昭和|平成|令和)(元|\d+)年(\d{1,2})月(\d{1,2})日$/;
const SHORT_WAREKI_PATTERN = /^([MTSHR])(元|\d+)\.(\d{1,2})\.(\d{1,2})$/i;
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function compareDateParts(left: DateParts, right: DateParts): number {
  if (left.year !== right.year) {
    return left.year - right.year;
  }
  if (left.month !== right.month) {
    return left.month - right.month;
  }
  return left.day - right.day;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

function isValidGregorianDate(parts: DateParts): boolean {
  if (
    !Number.isInteger(parts.year) ||
    !Number.isInteger(parts.month) ||
    !Number.isInteger(parts.day)
  ) {
    return false;
  }

  if (parts.year < 1 || parts.month < 1 || parts.month > 12 || parts.day < 1) {
    return false;
  }

  return parts.day <= daysInMonth(parts.year, parts.month);
}

function weekdayIndex(parts: DateParts): number {
  let year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;

  if (month < 3) {
    year -= 1;
  }

  return (
    year +
    Math.floor(year / 4) -
    Math.floor(year / 100) +
    Math.floor(year / 400) +
    offsets[month - 1] +
    day
  ) % 7;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatIsoDate(parts: DateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${pad2(parts.month)}-${pad2(
    parts.day,
  )}`;
}

function findEraByName(name: string): Era | undefined {
  return ERAS.find((era) => era.name === name);
}

function findEraByShort(short: string): Era | undefined {
  return ERAS.find((era) => era.short === short.toUpperCase());
}

function findEraForGregorianDate(parts: DateParts): Era | undefined {
  for (let index = ERAS.length - 1; index >= 0; index -= 1) {
    if (compareDateParts(parts, ERAS[index].start) >= 0) {
      return ERAS[index];
    }
  }

  return undefined;
}

function parsePositiveInteger(token: string, input: string): number {
  const value = Number(token === "元" ? "1" : token);

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`不正な和暦です: ${input}`);
  }

  return value;
}

function parseMonthOrDay(token: string, input: string): number {
  const value = Number(token);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`不正な日付です: ${input}`);
  }

  return value;
}

export function parseSeirekiDate(input: string): DateParts {
  const match = ISO_PATTERN.exec(input);

  if (!match) {
    throw new Error(`不正な日付です: ${input}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = { year, month, day };

  if (!isValidGregorianDate(date)) {
    throw new Error(`不正な日付です: ${input}`);
  }

  return date;
}

function parseWarekiInput(input: string): { era: Era; eraYear: number; month: number; day: number } {
  const longMatch = LONG_WAREKI_PATTERN.exec(input);

  if (longMatch) {
    const era = findEraByName(longMatch[1]);

    if (!era) {
      throw new Error(`不正な和暦です: ${input}`);
    }

    return {
      era,
      eraYear: parsePositiveInteger(longMatch[2], input),
      month: parseMonthOrDay(longMatch[3], input),
      day: parseMonthOrDay(longMatch[4], input),
    };
  }

  const shortMatch = SHORT_WAREKI_PATTERN.exec(input);

  if (shortMatch) {
    const era = findEraByShort(shortMatch[1]);

    if (!era) {
      throw new Error(`不正な和暦です: ${input}`);
    }

    return {
      era,
      eraYear: parsePositiveInteger(shortMatch[2], input),
      month: parseMonthOrDay(shortMatch[3], input),
      day: parseMonthOrDay(shortMatch[4], input),
    };
  }

  throw new Error(`不正な和暦です: ${input}`);
}

function formatWarekiDate(parts: DateParts, era: Era, format: WarekiFormat): string {
  const eraYear = parts.year - era.start.year + 1;
  const yearText = format === "long" && eraYear === 1 ? "元" : String(eraYear);

  if (format === "short") {
    return `${era.short}${yearText}.${parts.month}.${parts.day}`;
  }

  return `${era.name}${yearText}年${parts.month}月${parts.day}日`;
}

function toGregorianDateFromWareki(input: string): DateParts {
  const parsed = parseWarekiInput(input);
  const year = parsed.era.start.year + parsed.eraYear - 1;
  const parts = { year, month: parsed.month, day: parsed.day };

  if (!isValidGregorianDate(parts)) {
    throw new Error(`不正な和暦です: ${input}`);
  }

  if (compareDateParts(parts, parsed.era.start) < 0) {
    throw new Error(`元号の範囲外です: ${input}`);
  }

  const eraIndex = ERAS.indexOf(parsed.era);
  const nextEra = eraIndex >= 0 ? ERAS[eraIndex + 1] : undefined;

  if (nextEra && compareDateParts(parts, nextEra.start) >= 0) {
    throw new Error(`元号の範囲外です: ${input}`);
  }

  return parts;
}

export function convertSeirekiToWareki(input: string, format: WarekiFormat = "long"): string {
  const parts = parseSeirekiDate(input);
  const era = findEraForGregorianDate(parts);

  if (!era) {
    throw new Error(`対応している元号は明治以降です: ${input}`);
  }

  return formatWarekiDate(parts, era, format);
}

export function convertWarekiToSeireki(input: string): string {
  const parts = toGregorianDateFromWareki(input);
  const weekday = WEEKDAYS_EN[weekdayIndex(parts)];

  return `${formatIsoDate(parts)} (${weekday})`;
}

export function convertSeirekiToWarekiWithWeekday(
  input: string,
  format: WarekiFormat = "long",
): string {
  const parts = parseSeirekiDate(input);
  const era = findEraForGregorianDate(parts);

  if (!era) {
    throw new Error(`対応している元号は明治以降です: ${input}`);
  }

  return `${formatWarekiDate(parts, era, format)}（${WEEKDAYS_JA[weekdayIndex(parts)]}）`;
}

