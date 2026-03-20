/** YYYY-MM-DD components; month 1–12, day 1–31 */
export type Ymd = { y: number; m: number; d: number };

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2 && isLeapYear(y)) return 29;
  return DAYS_IN_MONTH[m - 1] ?? 0;
}

/** Compare two Ymd; negative if a < b, 0 if equal, positive if a > b */
export function compareYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

export function isValidGregorian(ymd: Ymd): boolean {
  const { y, m, d } = ymd;
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

/** Gregorian Julian Day Number (integer, noon-based convention not needed for our use) */
export function gregorianToJdn(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return (
    d +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  );
}

/** 0 = Sunday … 6 = Saturday (same as Date#getDay) */
export function weekdayIndexSun0(y: number, m: number, d: number): number {
  const jdn = gregorianToJdn(y, m, d);
  return (jdn + 1) % 7;
}

const WEEKDAY_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function weekdayEnglish(y: number, m: number, d: number): string {
  return WEEKDAY_EN[weekdayIndexSun0(y, m, d)]!;
}

export function weekdayJapaneseChar(y: number, m: number, d: number): string {
  return WEEKDAY_JP[weekdayIndexSun0(y, m, d)]!;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(s: string): Ymd | null {
  const m = s.trim().match(ISO_RE);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  return { y, m: mo, d };
}

export function formatIso(ymd: Ymd): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ymd.y}-${pad(ymd.m)}-${pad(ymd.d)}`;
}
