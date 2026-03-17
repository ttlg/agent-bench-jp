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

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function exitWithError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseIsoDate(input: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) {
    exitWithError(`invalid ISO date: ${input}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    exitWithError(`invalid date: ${input}`);
  }

  return date;
}

function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function findEraByDate(date: Date): Era | undefined {
  const iso = formatIsoDate(date);
  return ERAS.find((era) => iso >= era.start && iso <= era.end);
}

function formatWareki(date: Date, short = false): string {
  const era = findEraByDate(date);
  if (!era) {
    exitWithError(`date is outside supported eras: ${formatIsoDate(date)}`);
  }

  const yearInEra = date.getUTCFullYear() - era.startYear + 1;
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  if (short) {
    return `${era.short}${yearInEra}.${month}.${day}`;
  }

  const warekiYear = yearInEra === 1 ? "元" : String(yearInEra);
  const weekday = WEEKDAYS_JA[date.getUTCDay()];
  return `${era.kanji}${warekiYear}年${month}月${day}日（${weekday}）`;
}

function parseWareki(input: string): { era: Era; yearInEra: number; month: number; day: number } {
  const match = /^(明治|大正|昭和|平成|令和)(元|\d+)年(\d{1,2})月(\d{1,2})日$/.exec(input);
  if (!match) {
    exitWithError(`invalid wareki date: ${input}`);
  }

  const era = ERAS.find((item) => item.kanji === match[1]);
  if (!era) {
    exitWithError(`unsupported era: ${match[1]}`);
  }

  const yearInEra = match[2] === "元" ? 1 : Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);

  if (yearInEra < 1) {
    exitWithError(`invalid wareki year: ${match[2]}`);
  }

  return { era, yearInEra, month, day };
}

function warekiToDate(input: string): Date {
  const { era, yearInEra, month, day } = parseWareki(input);
  const year = era.startYear + yearInEra - 1;
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    exitWithError(`invalid date: ${input}`);
  }

  const iso = formatIsoDate(date);
  if (iso < era.start || iso > era.end) {
    exitWithError(`date is outside ${era.kanji} era: ${input}`);
  }

  return date;
}

function formatSeireki(date: Date, short = false): string {
  if (short) {
    return formatIsoDate(date);
  }

  const iso = formatIsoDate(date);
  const weekday = WEEKDAYS_EN[date.getUTCDay()];
  return `${iso} (${weekday})`;
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  wareki to-wareki <YYYY-MM-DD> [--format short]",
      "  wareki to-seireki <和暦日付> [--format short]"
    ].join("\n")
  );
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const formatIndex = args.indexOf("--format");
  let short = false;
  if (formatIndex !== -1) {
    const formatValue = args[formatIndex + 1];
    if (formatValue !== "short") {
      exitWithError(`unsupported format: ${formatValue ?? ""}`);
    }
    short = true;
    args.splice(formatIndex, 2);
  }

  const [command, input] = args;
  if (!command || !input || args.length !== 2) {
    printUsage();
    process.exit(1);
  }

  switch (command) {
    case "to-wareki":
      console.log(formatWareki(parseIsoDate(input), short));
      return;
    case "to-seireki":
      console.log(formatSeireki(warekiToDate(input), short));
      return;
    default:
      exitWithError(`unknown command: ${command}`);
  }
}

main();
