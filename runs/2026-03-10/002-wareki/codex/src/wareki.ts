export type GregorianDate = {
  year: number;
  month: number;
  day: number;
};

export type OutputFormat = "long" | "short";

type Era = {
  name: "明治" | "大正" | "昭和" | "平成" | "令和";
  short: "M" | "T" | "S" | "H" | "R";
  start: GregorianDate;
  end?: GregorianDate;
};

const ERAS: readonly Era[] = [
  {
    name: "令和",
    short: "R",
    start: { year: 2019, month: 5, day: 1 }
  },
  {
    name: "平成",
    short: "H",
    start: { year: 1989, month: 1, day: 8 },
    end: { year: 2019, month: 4, day: 30 }
  },
  {
    name: "昭和",
    short: "S",
    start: { year: 1926, month: 12, day: 25 },
    end: { year: 1989, month: 1, day: 7 }
  },
  {
    name: "大正",
    short: "T",
    start: { year: 1912, month: 7, day: 30 },
    end: { year: 1926, month: 12, day: 24 }
  },
  {
    name: "明治",
    short: "M",
    start: { year: 1868, month: 1, day: 25 },
    end: { year: 1912, month: 7, day: 29 }
  }
];

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
const WEEKDAYS_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;

export function parseIsoDate(input: string): GregorianDate {
  const trimmed = input.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (!match) {
    throw new Error("西暦日は YYYY-MM-DD 形式で指定してください。");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  validateGregorianDate({ year, month, day });
  return { year, month, day };
}

export function toWarekiString(input: string, format: OutputFormat = "long"): string {
  return formatWareki(parseIsoDate(input), format);
}

export function toSeirekiString(input: string, format: OutputFormat = "long"): string {
  return formatSeireki(parseWarekiDate(input), format);
}

export function formatWareki(date: GregorianDate, format: OutputFormat = "long"): string {
  validateGregorianDate(date);
  const era = findEraByGregorianDate(date);

  if (!era) {
    throw new Error("対応範囲外の日付です。明治元年以降の日付を指定してください。");
  }

  const eraYear = date.year - era.start.year + 1;

  if (format === "short") {
    return `${era.short}${eraYear}.${date.month}.${date.day}`;
  }

  const yearText = eraYear === 1 ? "元" : String(eraYear);
  const weekday = WEEKDAYS_JA[getDayOfWeek(date)];
  return `${era.name}${yearText}年${date.month}月${date.day}日（${weekday}）`;
}

export function parseWarekiDate(input: string): GregorianDate {
  const trimmed = input.trim();
  const match = /^(明治|大正|昭和|平成|令和)(元|\d+)年(\d{1,2})月(\d{1,2})日$/.exec(trimmed);

  if (!match) {
    throw new Error("和暦日は 令和8年3月10日 の形式で指定してください。");
  }

  const era = ERAS.find((item) => item.name === match[1]);

  if (!era) {
    throw new Error("未対応の元号です。");
  }

  const eraYear = match[2] === "元" ? 1 : Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);

  if (!Number.isInteger(eraYear) || eraYear <= 0) {
    throw new Error("和暦年は 1 以上で指定してください。");
  }

  const date: GregorianDate = {
    year: era.start.year + eraYear - 1,
    month,
    day
  };

  validateGregorianDate(date);

  if (compareDates(date, era.start) < 0 || (era.end && compareDates(date, era.end) > 0)) {
    throw new Error("元号と日付の組み合わせが不正です。");
  }

  return date;
}

export function formatSeireki(date: GregorianDate, format: OutputFormat = "long"): string {
  validateGregorianDate(date);
  const iso = formatIsoDate(date);

  if (format === "short") {
    return iso;
  }

  const weekday = WEEKDAYS_EN[getDayOfWeek(date)];
  return `${iso} (${weekday})`;
}

function validateGregorianDate(date: GregorianDate): void {
  if (!Number.isInteger(date.year) || date.year < 1) {
    throw new Error("年は 1 以上の整数で指定してください。");
  }

  if (!Number.isInteger(date.month) || date.month < 1 || date.month > 12) {
    throw new Error("月は 1 から 12 の範囲で指定してください。");
  }

  const maxDay = getDaysInMonth(date.year, date.month);

  if (!Number.isInteger(date.day) || date.day < 1 || date.day > maxDay) {
    throw new Error("不正な日付です。");
  }
}

function findEraByGregorianDate(date: GregorianDate): Era | undefined {
  return ERAS.find((era) => {
    const afterStart = compareDates(date, era.start) >= 0;
    const beforeEnd = !era.end || compareDates(date, era.end) <= 0;
    return afterStart && beforeEnd;
  });
}

function formatIsoDate(date: GregorianDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function compareDates(left: GregorianDate, right: GregorianDate): number {
  if (left.year !== right.year) {
    return left.year < right.year ? -1 : 1;
  }

  if (left.month !== right.month) {
    return left.month < right.month ? -1 : 1;
  }

  if (left.day !== right.day) {
    return left.day < right.day ? -1 : 1;
  }

  return 0;
}

function getDayOfWeek(date: GregorianDate): number {
  const monthOffsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let year = date.year;

  if (date.month < 3) {
    year -= 1;
  }

  return (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + monthOffsets[date.month - 1] + date.day) % 7;
}
