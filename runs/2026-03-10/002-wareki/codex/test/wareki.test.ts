import test from "node:test";
import assert from "node:assert/strict";

import { parseWarekiDate, toSeirekiString, toWarekiString } from "../src/wareki";

test("converts seireki to wareki with weekday", () => {
  assert.equal(toWarekiString("2026-03-10"), "令和8年3月10日（火）");
});

test("converts wareki to seireki with weekday", () => {
  assert.equal(toSeirekiString("令和8年3月10日"), "2026-03-10 (Tuesday)");
});

test("handles era boundary dates correctly", () => {
  assert.equal(toWarekiString("1989-01-07"), "昭和64年1月7日（土）");
  assert.equal(toWarekiString("1989-01-08"), "平成元年1月8日（日）");
});

test("supports short format", () => {
  assert.equal(toWarekiString("2026-03-10", "short"), "R8.3.10");
  assert.equal(toSeirekiString("令和8年3月10日", "short"), "2026-03-10");
});

test("rejects impossible wareki dates", () => {
  assert.throws(() => parseWarekiDate("平成元年1月7日"), /元号と日付の組み合わせが不正です/);
  assert.throws(() => toWarekiString("2026-02-29"), /不正な日付です/);
});
