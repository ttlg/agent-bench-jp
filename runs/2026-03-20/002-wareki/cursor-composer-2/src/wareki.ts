import {
  type Ymd,
  compareYmd,
  formatIso,
  isValidGregorian,
  parseIsoDate,
  weekdayEnglish,
  weekdayJapaneseChar,
} from "./calendar.js";
import {
  type EraDef,
  eraByJapaneseName,
  eraYearToGregorianYear,
  findEraForDate,
  gregorianToEraYear,
} from "./eras.js";

const WAREKI_RE = /^(.+?)(\d+)年(\d+)月(\d+)日$/;

export type ParseWarekiError = { kind: "parse" | "unknown_era"; message: string };

export function parseWarekiString(input: string): { era: EraDef; eraYear: number; m: number; d: number } | ParseWarekiError {
  const s = input.trim();
  const m = s.match(WAREKI_RE);
  if (!m) {
    return { kind: "parse", message: `和暦の形式が正しくありません: 「元号名」「年」「月」「日」（例: 令和8年3月10日）` };
  }
  const eraName = m[1]!.trim();
  const eraYear = Number(m[2]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (!Number.isInteger(eraYear) || eraYear < 1) {
    return { kind: "parse", message: `年号の年が不正です: ${m[2]}` };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { kind: "parse", message: `月が不正です: ${m[3]}` };
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return { kind: "parse", message: `日が不正です: ${m[4]}` };
  }
  const era = eraByJapaneseName(eraName);
  if (!era) {
    return { kind: "unknown_era", message: `未対応の元号です: ${eraName}（対応: 明治・大正・昭和・平成・令和）` };
  }
  return { era, eraYear, m: month, d: day };
}

/** その元号の「年号年」に対応する西暦年へ。元年は開始日以降のみ。 */
export function warekiToYmd(era: EraDef, eraYear: number, m: number, d: number): Ymd | string {
  const gy = eraYearToGregorianYear(era, eraYear);
  if (gy === null) return "年号の年が不正です";
  const ymd: Ymd = { y: gy, m, d };
  if (!isValidGregorian(ymd)) {
    return `存在しない日付です: ${era.name}${eraYear}年${m}月${d}日`;
  }
  if (eraYear === 1) {
    if (compareYmd(ymd, era.start) < 0) {
      return `${era.name}元年は${formatIso(era.start)}以降です`;
    }
  }
  const resolvedEra = findEraForDate(ymd);
  if (!resolvedEra || resolvedEra.id !== era.id) {
    return `${formatIso(ymd)} は ${era.name}${eraYear}年としては無効です（元号の範囲外）`;
  }
  return ymd;
}

export function formatWarekiLong(ymd: Ymd): string {
  const era = findEraForDate(ymd);
  if (!era) {
    throw new Error("対応範囲外の日付です（明治元年以降）");
  }
  const ey = gregorianToEraYear(era, ymd);
  const w = weekdayJapaneseChar(ymd.y, ymd.m, ymd.d);
  return `${era.name}${ey}年${ymd.m}月${ymd.d}日（${w}）`;
}

export function formatWarekiShort(ymd: Ymd): string {
  const era = findEraForDate(ymd);
  if (!era) {
    throw new Error("対応範囲外の日付です（明治元年以降）");
  }
  const ey = gregorianToEraYear(era, ymd);
  return `${era.letter}${ey}.${ymd.m}.${ymd.d}`;
}

export function formatSeirekiLine(ymd: Ymd): string {
  const iso = formatIso(ymd);
  const w = weekdayEnglish(ymd.y, ymd.m, ymd.d);
  return `${iso} (${w})`;
}

export function formatSeirekiShort(ymd: Ymd): string {
  return formatIso(ymd);
}

export function isoToWareki(
  isoInput: string,
  short: boolean,
): { ok: true; out: string } | { ok: false; message: string } {
  const p = parseIsoDate(isoInput);
  if (!p) {
    return {
      ok: false,
      message: `西暦の形式が正しくありません: YYYY-MM-DD（例: 2026-03-10）`,
    };
  }
  if (!isValidGregorian(p)) {
    return { ok: false, message: `存在しない日付です: ${isoInput.trim()}` };
  }
  const era = findEraForDate(p);
  if (!era) {
    return { ok: false, message: `対応範囲外の日付です（1868-09-08 明治元年以降）` };
  }
  const out = short ? formatWarekiShort(p) : formatWarekiLong(p);
  return { ok: true, out };
}

export function warekiStringToSeireki(
  warekiInput: string,
  short: boolean,
): { ok: true; out: string } | { ok: false; message: string } {
  const parsed = parseWarekiString(warekiInput);
  if ("kind" in parsed) {
    return { ok: false, message: parsed.message };
  }
  const { era, eraYear, m, d } = parsed;
  const ymd = warekiToYmd(era, eraYear, m, d);
  if (typeof ymd === "string") {
    return { ok: false, message: ymd };
  }
  const out = short ? formatSeirekiShort(ymd) : formatSeirekiLine(ymd);
  return { ok: true, out };
}