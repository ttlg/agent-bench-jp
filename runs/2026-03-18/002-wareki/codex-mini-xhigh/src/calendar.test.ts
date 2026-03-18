import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  convertSeirekiToWareki,
  convertSeirekiToWarekiWithWeekday,
  convertWarekiToSeireki,
  parseSeirekiDate,
} from "./calendar";

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

function weekdayIndexFromIso(input: string): number {
  const [yearText, monthText, dayText] = input.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCDay();
}

test("西暦から和暦へ変換できる", () => {
  assert.equal(convertSeirekiToWarekiWithWeekday("2026-03-10"), "令和8年3月10日（火）");
});

test("元号境界を正しく処理する", () => {
  assert.equal(
    convertSeirekiToWarekiWithWeekday("1989-01-07"),
    `昭和64年1月7日（${WEEKDAYS_JA[weekdayIndexFromIso("1989-01-07")]}）`,
  );
  assert.equal(
    convertSeirekiToWarekiWithWeekday("1989-01-08"),
    `平成元年1月8日（${WEEKDAYS_JA[weekdayIndexFromIso("1989-01-08")]}）`,
  );
});

test("和暦から西暦へ変換できる", () => {
  assert.equal(
    convertWarekiToSeireki("令和8年3月10日"),
    `2026-03-10 (${WEEKDAYS_EN[weekdayIndexFromIso("2026-03-10")]})`,
  );
});

test("短縮表記を扱える", () => {
  assert.equal(convertSeirekiToWareki("2026-03-10", "short"), "R8.3.10");
  assert.equal(
    convertWarekiToSeireki("R8.3.10"),
    `2026-03-10 (${WEEKDAYS_EN[weekdayIndexFromIso("2026-03-10")]})`,
  );
});

test("不正な日付はエラーになる", () => {
  assert.throws(() => parseSeirekiDate("2026-02-30"), /不正な日付です/);
  assert.throws(() => convertSeirekiToWarekiWithWeekday("1868-01-24"), /対応している元号は明治以降です/);
  assert.throws(() => convertWarekiToSeireki("平成元年1月7日"), /元号の範囲外です/);
});
