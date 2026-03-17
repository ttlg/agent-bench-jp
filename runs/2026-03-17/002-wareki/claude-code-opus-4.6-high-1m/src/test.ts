import { toWareki, toSeireki } from "./wareki";

let passed = 0;
let failed = 0;

function assert(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    console.log(`  OK: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    console.log(`    期待値: ${expected}`);
    console.log(`    実際値: ${actual}`);
    failed++;
  }
}

function assertThrows(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  FAIL: ${label} (例外が発生しませんでした)`);
    failed++;
  } catch {
    console.log(`  OK: ${label}`);
    passed++;
  }
}

console.log("=== to-wareki テスト ===");
assert("令和の日付", toWareki("2026-03-10"), "令和8年3月10日（火）");
assert("令和元年", toWareki("2019-05-01"), "令和元年5月1日（水）");
assert("平成最終日", toWareki("2019-04-30"), "平成31年4月30日（火）");
assert("平成元年", toWareki("1989-01-08"), "平成元年1月8日（日）");
assert("昭和64年最終日", toWareki("1989-01-07"), "昭和64年1月7日（土）");
assert("昭和元年", toWareki("1926-12-25"), "昭和元年12月25日（土）");
assert("大正最終日", toWareki("1926-12-24"), "大正15年12月24日（金）");
assert("大正元年", toWareki("1912-07-30"), "大正元年7月30日（火）");
assert("明治最終日", toWareki("1912-07-29"), "明治45年7月29日（月）");
assert("明治初期", toWareki("1868-01-25"), "明治元年1月25日（土）");

console.log("\n=== to-wareki 短縮表記テスト ===");
assert("短縮: 令和", toWareki("2026-03-10", "short"), "R8.3.10");
assert("短縮: 平成", toWareki("2000-01-01", "short"), "H12.1.1");
assert("短縮: 昭和", toWareki("1975-04-15", "short"), "S50.4.15");

console.log("\n=== to-seireki テスト ===");
assert("令和→西暦", toSeireki("令和8年3月10日"), "2026-03-10 (Tuesday)");
assert("平成→西暦", toSeireki("平成12年1月1日"), "2000-01-01 (Saturday)");
assert("昭和→西暦", toSeireki("昭和50年4月15日"), "1975-04-15 (Tuesday)");
assert("元年→西暦", toSeireki("令和元年5月1日"), "2019-05-01 (Wednesday)");

console.log("\n=== to-seireki 短縮表記テスト ===");
assert("短縮: 西暦のみ", toSeireki("令和8年3月10日", "short"), "2026-03-10");

console.log("\n=== エラー系テスト ===");
assertThrows("不正な形式", () => toWareki("20260310"));
assertThrows("存在しない日付", () => toWareki("2026-02-29"));
assertThrows("明治以前", () => toWareki("1867-12-31"));
assertThrows("不正な和暦形式", () => toSeireki("令和8年"));
assertThrows("元号範囲外", () => toSeireki("平成32年1月1日"));

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
