#!/usr/bin/env node

type Era = {
  kanji: "明治" | "大正" | "昭和" | "平成" | "令和";
  short: "M" | "T" | "S" | "H" | "R";
  start: string;
  end: string;
  startYear: number;
};

const ERAS: Era[] = [
  { kanji: "明治", short: "M", start: "1868-01-25", end: "1912-07-29", startYear: 1868 },
  { kanji: "大正", short: "T", start: "1912-07-30", end: "1926-12-24", startYear: 1912 },
  { kanji: "昭和", short: "S", start: "1926-12-25", end: "1989-01-07", startYear: 1926 },
  { kanji: "平成", short: "H", start: "1989-01-08", end: "2019-04-30", startYear: 1989 },
  { kanji: "令和", short: "R", start: "2019-05-01", end: "9999-12-31", startYear: 2019 }
];

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

function main(): void {
  try {
    const args = process.argv.slice(2);
    const { format, positional } = parseArgs(args);
    const [command, input] = positional;

    if (!command || !input || positional.length !== 2) {
      exitWithError(
        "Usage:\n  wareki to-wareki <YYYY-MM-DD> [--format short]\n  wareki to-seireki <和暦文字列>"
      );
    }

    if (command === "to-wareki") {
      const date = parseIsoDate(input);
      console.log(formatDateToWareki(date, format));
      return;
    }

    if (command === "to-seireki") {
      const date = parseWarekiDate(input);
      console.log(formatDateToSeireki(date, format));
      return;
    }

    exitWithError(`Unknown command: ${command}`);
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : "Unknown error");
  }
}

function parseArgs(args: string[]): { format: "long" | "short"; positional: string[] } {
  const positional: string[] = [];
  let format: "long" | "short" = "long";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--format") {
      const value = args[i + 1];
      if (value !== "short") {
        throw new Error("Invalid --format value. Supported: short");
      }
      format = "short";
      i += 1;
      continue;
    }

    positional.push(arg);
  }

  return { format, positional };
}

function parseIsoDate(input: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) {
    throw new Error(`Invalid ISO date: ${input}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return createUtcDate(year, month, day, `Invalid date: ${input}`);
}

function parseWarekiDate(input: string): Date {
  const match = /^(明治|大正|昭和|平成|令和)(元|\d+)年(\d{1,2})月(\d{1,2})日$/.exec(input);
  if (!match) {
    throw new Error(`Invalid wareki date: ${input}`);
  }

  const era = ERAS.find((entry) => entry.kanji === match[1]);
  if (!era) {
    throw new Error(`Unsupported era: ${match[1]}`);
  }

  const eraYear = match[2] === "元" ? 1 : Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const year = era.startYear + eraYear - 1;
  const date = createUtcDate(year, month, day, `Invalid date: ${input}`);
  const iso = toIsoDate(date);

  if (compareIso(iso, era.start) < 0 || compareIso(iso, era.end) > 0) {
    throw new Error(`Date is outside ${era.kanji}: ${input}`);
  }

  return date;
}

function createUtcDate(year: number, month: number, day: number, message: string): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(message);
  }
  return date;
}

function formatDateToWareki(date: Date, format: "long" | "short"): string {
  const iso = toIsoDate(date);
  const era = ERAS.find((entry) => compareIso(iso, entry.start) >= 0 && compareIso(iso, entry.end) <= 0);
  if (!era) {
    throw new Error(`Date is outside supported eras: ${iso}`);
  }

  const eraYear = date.getUTCFullYear() - era.startYear + 1;
  if (format === "short") {
    return `${era.short}${eraYear}.${date.getUTCMonth() + 1}.${date.getUTCDate()}`;
  }

  const eraYearLabel = eraYear === 1 ? "元" : String(eraYear);
  const weekday = JP_WEEKDAYS[date.getUTCDay()];
  return `${era.kanji}${eraYearLabel}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekday}）`;
}

function formatDateToSeireki(date: Date, format: "long" | "short"): string {
  if (format === "short") {
    throw new Error("--format short is only supported with to-wareki");
  }

  const weekday = EN_WEEKDAYS[date.getUTCDay()];
  return `${toIsoDate(date)} (${weekday})`;
}

function toIsoDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compareIso(left: string, right: string): number {
  return left.localeCompare(right);
}

function exitWithError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

main();
