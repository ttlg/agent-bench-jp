import { type Ymd, compareYmd, isValidGregorian } from "./calendar.js";

export type EraId = "meiji" | "taisho" | "showa" | "heisei" | "reiwa";

export type EraDef = {
  id: EraId;
  name: string;
  /** Latin letter used in short format (e.g. R for 令和) */
  letter: string;
  /** First calendar day of 元年 (year 1) */
  start: Ymd;
};

/** Newest first — first matching era whose start <= date wins */
export const ERAS_DESC: readonly EraDef[] = [
  { id: "reiwa", name: "令和", letter: "R", start: { y: 2019, m: 5, d: 1 } },
  { id: "heisei", name: "平成", letter: "H", start: { y: 1989, m: 1, d: 8 } },
  { id: "showa", name: "昭和", letter: "S", start: { y: 1926, m: 12, d: 25 } },
  { id: "taisho", name: "大正", letter: "T", start: { y: 1912, m: 7, d: 30 } },
  { id: "meiji", name: "明治", letter: "M", start: { y: 1868, m: 9, d: 8 } },
] as const;

export function findEraForDate(date: Ymd): EraDef | null {
  if (!isValidGregorian(date)) return null;
  for (const era of ERAS_DESC) {
    if (compareYmd(date, era.start) >= 0) return era;
  }
  return null;
}

/**
 * 元年のうち、その暦年の開始日以前は別元号。元年以外は西暦年 = 開始年 + 年号年 - 1。
 */
export function gregorianToEraYear(era: EraDef, date: Ymd): number {
  const { start } = era;
  if (date.y === start.y) return 1;
  return date.y - start.y + 1;
}

export function eraYearToGregorianYear(era: EraDef, eraYear: number): number | null {
  if (eraYear < 1) return null;
  if (eraYear === 1) return era.start.y;
  return era.start.y + eraYear - 1;
}

const NAME_TO_ERA: ReadonlyMap<string, EraDef> = new Map(
  ERAS_DESC.map((e) => [e.name, e]),
);

export function eraByJapaneseName(name: string): EraDef | null {
  return NAME_TO_ERA.get(name) ?? null;
}
