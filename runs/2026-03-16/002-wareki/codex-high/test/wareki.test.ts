import test from "node:test";
import assert from "node:assert/strict";

import { convertToSeireki, convertToWareki, WarekiError } from "../src/wareki.ts";

test("西暦を和暦へ変換できる", () => {
  assert.equal(convertToWareki("2026-03-10"), "令和8年3月10日（火）");
});

test("和暦を西暦へ変換できる", () => {
  assert.equal(convertToSeireki("令和8年3月10日"), "2026-03-10 (Tuesday)");
});

test("短縮表記で和暦を出力できる", () => {
  assert.equal(convertToWareki("2026-03-10", "short"), "R8.3.10");
});

test("元号境界日の前日を正しく昭和として扱う", () => {
  assert.equal(convertToWareki("1989-01-07"), "昭和64年1月7日（土）");
});

test("元号境界日を正しく平成元年として扱う", () => {
  assert.equal(convertToWareki("1989-01-08"), "平成元年1月8日（日）");
});

test("平成の最終日を正しく扱う", () => {
  assert.equal(convertToWareki("2019-04-30"), "平成31年4月30日（火）");
});

test("令和の初日を正しく扱う", () => {
  assert.equal(convertToWareki("2019-05-01"), "令和元年5月1日（水）");
});

test("元年表記を西暦に戻せる", () => {
  assert.equal(convertToSeireki("平成元年1月8日"), "1989-01-08 (Sunday)");
});

test("元号の範囲外の和暦はエラーにする", () => {
  assert.throws(() => convertToSeireki("平成元年1月7日"), WarekiError);
});

test("存在しない西暦日付はエラーにする", () => {
  assert.throws(() => convertToWareki("2026-02-30"), WarekiError);
});

test("明治以前の西暦日付はエラーにする", () => {
  assert.throws(() => convertToWareki("1868-01-24"), WarekiError);
});
