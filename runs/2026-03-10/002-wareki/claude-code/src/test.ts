import { execSync } from "child_process";

const CLI = "node dist/wareki.js";
let passed = 0;
let failed = 0;

function test(description: string, command: string, expected: string): void {
  try {
    const result = execSync(`${CLI} ${command}`, { encoding: "utf-8" }).trim();
    if (result === expected) {
      console.log(`  ✓ ${description}`);
      passed++;
    } else {
      console.log(`  ✗ ${description}`);
      console.log(`    期待値: ${expected}`);
      console.log(`    実際値: ${result}`);
      failed++;
    }
  } catch (e: any) {
    const stderr = e.stderr?.toString().trim() || e.message;
    console.log(`  ✗ ${description}`);
    console.log(`    エラー: ${stderr}`);
    failed++;
  }
}

function testError(description: string, command: string, expectedSubstr: string): void {
  try {
    execSync(`${CLI} ${command}`, { encoding: "utf-8" });
    console.log(`  ✗ ${description} (エラーが発生しなかった)`);
    failed++;
  } catch (e: any) {
    const stderr = e.stderr?.toString().trim() || "";
    if (stderr.includes(expectedSubstr)) {
      console.log(`  ✓ ${description}`);
      passed++;
    } else {
      console.log(`  ✗ ${description}`);
      console.log(`    期待部分文字列: ${expectedSubstr}`);
      console.log(`    実際のエラー: ${stderr}`);
      failed++;
    }
  }
}

console.log("=== to-wareki テスト ===");
test("令和の日付", "to-wareki 2026-03-10", "令和8年3月10日（火）");
test("平成の日付", "to-wareki 2000-01-01", "平成12年1月1日（土）");
test("昭和の日付", "to-wareki 1970-01-01", "昭和45年1月1日（木）");
test("大正の日付", "to-wareki 1920-01-01", "大正9年1月1日（木）");
test("明治の日付", "to-wareki 1900-01-01", "明治33年1月1日（月）");

console.log("\n=== 元号境界テスト ===");
test("昭和64年1月7日", "to-wareki 1989-01-07", "昭和64年1月7日（土）");
test("平成元年1月8日", "to-wareki 1989-01-08", "平成元年1月8日（日）");
test("平成31年4月30日", "to-wareki 2019-04-30", "平成31年4月30日（火）");
test("令和元年5月1日", "to-wareki 2019-05-01", "令和元年5月1日（水）");

console.log("\n=== to-seireki テスト ===");
test("令和→西暦", "to-seireki 令和8年3月10日", "2026-03-10 (Tuesday)");
test("平成→西暦", "to-seireki 平成12年1月1日", "2000-01-01 (Saturday)");
test("令和元年", "to-seireki 令和元年5月1日", "2019-05-01 (Wednesday)");

console.log("\n=== --format short テスト ===");
test("short形式 to-wareki", "to-wareki 2026-03-10 --format short", "R8.3.10");
test("short形式 to-seireki", "to-seireki 令和8年3月10日 --format short", "2026-03-10");

console.log("\n=== エラー処理テスト ===");
testError("不正な形式", "to-wareki abc", "不正な日付形式");
testError("存在しない日付", "to-wareki 2026-02-29", "存在しない日付");
testError("不正な和暦形式", "to-seireki abc", "不正な和暦形式");

console.log(`\n結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
