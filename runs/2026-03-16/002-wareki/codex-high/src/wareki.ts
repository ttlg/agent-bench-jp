export type Era = {
  kanji: string;
  short: string;
  start: DateParts;
};

export type DateParts = {
  year: number;
  month: number;
  day: number;
};

const ERAS: readonly Era[] = [
  { kanji: "明治", short: "M", start: { year: 1868, month: 1, day: 25 } },
  { kanji: "大正", short: "T", start: { year: 1912, month: 7, day: 30 } },
  { kanji: "昭和", short: "S", start: { year: 1926, month: 12, day: 25 } },
  { kanji: "平成", short: "H", start: { year: 1989, month: 1, day: 8 } },
  { kanji: "令和", short: "R", start: { year: 2019, month: 5, day: 1 } }
] as const;

const JP_WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const EN_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;

export class WarekiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarekiError";
  }
}

export function convertToWareki(input: string, format: "default" | "short" = "default"): string {
  const date = parseIsoDate(input);
  const era = findEraForDate(date);

  if (!era) {
    throw new WarekiError("対応していない日付です。明治元年以降の日付を指定してください。");
  }

  const eraYear = date.year - era.start.year + 1;

  if (format === "short") {
    return `${era.short}${eraYear}.${date.month}.${date.day}`;
  }

  return `${era.kanji}${formatEraYear(eraYear)}年${date.month}月${date.day}日（${getJapaneseWeekday(date)}）`;
}

export function convertToSeireki(input: string, format: "default" | "short" = "default"): string {
  const wareki = parseWarekiDate(input);
  const date = warekiToDateParts(wareki);

  if (format === "short") {
    return formatIsoDate(date);
  }

  return `${formatIsoDate(date)} (${getEnglishWeekday(date)})`;
}

export function parseIsoDate(input: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);

  if (!match) {
    throw new WarekiError("不正な西暦日付です。YYYY-MM-DD 形式で指定してください。");
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  return validateDateParts({ year, month, day }, "不正な西暦日付です。存在する日付を指定してください。");
}

export function parseWarekiDate(input: string): { era: Era; eraYear: number; month: number; day: number } {
  const match = /^(明治|大正|昭和|平成|令和)(元|\d+)年(\d{1,2})月(\d{1,2})日$/.exec(input);

  if (!match) {
    throw new WarekiError("不正な和暦日付です。例: 令和8年3月10日");
  }

  const era = ERAS.find((candidate) => candidate.kanji === match[1]);

  if (!era) {
    throw new WarekiError("対応していない元号です。");
  }

  const eraYear = match[2] === "元" ? 1 : Number.parseInt(match[2], 10);
  const month = Number.parseInt(match[3], 10);
  const day = Number.parseInt(match[4], 10);

  if (eraYear < 1) {
    throw new WarekiError("和暦の年は 1 以上で指定してください。");
  }

  return { era, eraYear, month, day };
}

function warekiToDateParts(input: { era: Era; eraYear: number; month: number; day: number }): DateParts {
  const year = input.era.start.year + input.eraYear - 1;
  const date = validateDateParts(
    { year, month: input.month, day: input.day },
    "不正な和暦日付です。存在する日付を指定してください。"
  );
  const actualEra = findEraForDate(date);

  if (!actualEra || actualEra.kanji !== input.era.kanji) {
    throw new WarekiError("不正な和暦日付です。元号の範囲外です。");
  }

  return date;
}

function validateDateParts(input: DateParts, errorMessage: string): DateParts {
  const date = new Date(Date.UTC(input.year, input.month - 1, input.day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== input.year ||
    date.getUTCMonth() + 1 !== input.month ||
    date.getUTCDate() !== input.day
  ) {
    throw new WarekiError(errorMessage);
  }

  return input;
}

function findEraForDate(date: DateParts): Era | undefined {
  for (let index = ERAS.length - 1; index >= 0; index -= 1) {
    const era = ERAS[index];

    if (compareDateParts(date, era.start) >= 0) {
      return era;
    }
  }

  return undefined;
}

function compareDateParts(left: DateParts, right: DateParts): number {
  if (left.year !== right.year) {
    return left.year - right.year;
  }

  if (left.month !== right.month) {
    return left.month - right.month;
  }

  return left.day - right.day;
}

function getJapaneseWeekday(date: DateParts): string {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return JP_WEEKDAYS[weekday];
}

function getEnglishWeekday(date: DateParts): string {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return EN_WEEKDAYS[weekday];
}

function formatIsoDate(date: DateParts): string {
  return `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day
    .toString()
    .padStart(2, "0")}`;
}

function formatEraYear(year: number): string {
  return year === 1 ? "元" : String(year);
}
