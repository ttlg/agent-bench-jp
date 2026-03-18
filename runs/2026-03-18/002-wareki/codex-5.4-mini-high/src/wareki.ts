#!/usr/bin/env node

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type Era = {
  name: string;
  short: string;
  start: DateParts;
};

type Format = "full" | "short";

const ERAS: readonly Era[] = [
  { name: "明治", short: "M", start: { year: 1868, month: 1, day: 25 } },
  { name: "大正", short: "T", start: { year: 1912, month: 7, day: 30 } },
  { name: "昭和", short: "S", start: { year: 1926, month: 12, day: 25 } },
  { name: "平成", short: "H", start: { year: 1989, month: 1, day: 8 } },
  { name: "令和", short: "R", start: { year: 2019, month: 5, day: 1 } },
] as const;

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

declare const process: {
  argv: string[];
  exitCode?: number;
};

declare const console: {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

function isLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
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

function compareDates(left: DateParts, right: DateParts): number {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function parseIsoDate(input: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) {
    throw new Error("Invalid date format. Use YYYY-MM-DD.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    throw new Error(`Invalid month in date: ${input}`);
  }

  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    throw new Error(`Invalid day in date: ${input}`);
  }

  return { year, month, day };
}

function formatIsoDate(parts: DateParts): string {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year.toString().padStart(4, "0")}-${month}-${day}`;
}

function parseWareki(input: string): { era: Era; eraYear: number; month: number; day: number } {
  const trimmed = input.trim();
  const match = /^(明治|大正|昭和|平成|令和)(元|\d+)年(\d{1,2})月(\d{1,2})日$/.exec(trimmed);
  if (!match) {
    throw new Error("Invalid wareki format. Use 令和8年3月10日.");
  }

  const era = ERAS.find((candidate) => candidate.name === match[1]);
  if (!era) {
    throw new Error(`Unsupported era: ${match[1]}`);
  }

  const eraYear = match[2] === "元" ? 1 : Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);

  if (eraYear < 1) {
    throw new Error("Era year must be 1 or greater.");
  }

  if (month < 1 || month > 12) {
    throw new Error(`Invalid month in wareki: ${input}`);
  }

  const gregorianYear = era.start.year + eraYear - 1;
  const maxDay = daysInMonth(gregorianYear, month);
  if (day < 1 || day > maxDay) {
    throw new Error(`Invalid day in wareki: ${input}`);
  }

  const parts = { year: gregorianYear, month, day };
  const eraIndex = ERAS.findIndex((candidate) => candidate.name === era.name);
  const nextEra = ERAS[eraIndex + 1];

  if (compareDates(parts, era.start) < 0) {
    throw new Error(`Date is before the start of ${era.name}.`);
  }

  if (nextEra && compareDates(parts, nextEra.start) >= 0) {
    throw new Error(`Date is after the end of ${era.name}.`);
  }

  return { era, eraYear, month, day };
}

function findEraForDate(parts: DateParts): { era: Era; eraYear: number } {
  for (let index = ERAS.length - 1; index >= 0; index -= 1) {
    const era = ERAS[index];
    if (compareDates(parts, era.start) >= 0) {
      return {
        era,
        eraYear: parts.year - era.start.year + 1,
      };
    }
  }

  throw new Error("Date is before the start of Meiji.");
}

function weekdayIndex(parts: DateParts): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let year = parts.year;
  if (parts.month < 3) {
    year -= 1;
  }
  return (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + offsets[parts.month - 1] + parts.day) % 7;
}

function formatWarekiOutput(parts: DateParts, format: Format): string {
  const { era, eraYear } = findEraForDate(parts);
  const yearText = format === "short" ? String(eraYear) : eraYear === 1 ? "元" : String(eraYear);
  const body =
    format === "short"
      ? `${era.short}${yearText}.${parts.month}.${parts.day}`
      : `${era.name}${yearText}年${parts.month}月${parts.day}日`;

  return `${body}（${WEEKDAY_JA[weekdayIndex(parts)]}）`;
}

function formatSeirekiOutput(parts: DateParts, format: Format): string {
  const dateText =
    format === "short"
      ? `${parts.year}-${parts.month}-${parts.day}`
      : formatIsoDate(parts);
  return `${dateText} (${WEEKDAY_EN[weekdayIndex(parts)]})`;
}

function parseFormatFlag(args: string[]): { format: Format; positionals: string[] } {
  let format: Format = "full";
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--format") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --format.");
      }
      if (value !== "short") {
        throw new Error("Unsupported format. Use --format short.");
      }
      format = "short";
      index += 1;
      continue;
    }

    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value !== "short") {
        throw new Error("Unsupported format. Use --format short.");
      }
      format = "short";
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  return { format, positionals };
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  wareki to-wareki <YYYY-MM-DD> [--format short]");
  console.error("  wareki to-seireki <wareki> [--format short]");
  console.error("  short format: R8.3.10 or 2026-3-10");
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const { format, positionals } = parseFormatFlag(rest);
    if (positionals.length !== 1) {
      throw new Error("Expected exactly one input value.");
    }

    const input = positionals[0];

    switch (command) {
      case "to-wareki": {
        const parts = parseIsoDate(input);
        if (compareDates(parts, ERAS[0].start) < 0) {
          throw new Error("Date is before the start of Meiji.");
        }
        console.log(formatWarekiOutput(parts, format));
        return;
      }
      case "to-seireki": {
        const wareki = parseWareki(input);
        const parts = {
          year: wareki.era.start.year + wareki.eraYear - 1,
          month: wareki.month,
          day: wareki.day,
        };
        console.log(formatSeirekiOutput(parts, format));
        return;
      }
      default:
        throw new Error(`Unknown subcommand: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
