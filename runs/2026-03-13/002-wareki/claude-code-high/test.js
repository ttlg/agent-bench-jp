const { execSync } = require("child_process");

let passed = 0;
let failed = 0;

function test(description, command, expected) {
  try {
    const result = execSync(command, { encoding: "utf-8" }).trim();
    if (result === expected) {
      console.log(`  PASS: ${description}`);
      passed++;
    } else {
      console.log(`  FAIL: ${description}`);
      console.log(`    期待: ${expected}`);
      console.log(`    実際: ${result}`);
      failed++;
    }
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : "";
    const stdout = e.stdout ? e.stdout.toString().trim() : "";
    if (expected.startsWith("ERROR:")) {
      console.log(`  PASS: ${description} (エラー出力確認)`);
      passed++;
    } else {
      console.log(`  FAIL: ${description}`);
      console.log(`    期待: ${expected}`);
      console.log(`    エラー: ${stderr || stdout}`);
      failed++;
    }
  }
}

const cmd = "node dist/wareki.js";

console.log("=== to-wareki テスト ===");
test("令和の日付", `${cmd} to-wareki 2026-03-10`, "令和8年3月10日（火）");
test("平成元年", `${cmd} to-wareki 1989-01-08`, "平成元年1月8日（日）");
test("昭和64年最終日", `${cmd} to-wareki 1989-01-07`, "昭和64年1月7日（土）");
test("昭和元年", `${cmd} to-wareki 1926-12-25`, "昭和元年12月25日（土）");
test("大正元年", `${cmd} to-wareki 1912-07-30`, "大正元年7月30日（火）");
test("明治元年", `${cmd} to-wareki 1868-01-25`, "明治元年1月25日（土）");
test("令和元年", `${cmd} to-wareki 2019-05-01`, "令和元年5月1日（水）");
test("短縮形式", `${cmd} to-wareki 2026-03-10 --format short`, "R8.3.10");
test("短縮形式 昭和", `${cmd} to-wareki 1989-01-07 --format short`, "S64.1.7");

console.log("\n=== to-seireki テスト ===");
test("令和8年", `${cmd} to-seireki 令和8年3月10日`, "2026-03-10 (Tuesday)");
test("平成元年", `${cmd} to-seireki 平成元年1月8日`, "1989-01-08 (Sunday)");
test("昭和64年", `${cmd} to-seireki 昭和64年1月7日`, "1989-01-07 (Saturday)");
test("短縮形式", `${cmd} to-seireki 令和8年3月10日 --format short`, "2026-03-10");

console.log("\n=== エラーケース ===");
test("不正な形式", `${cmd} to-wareki 2026/03/10`, "ERROR:");
test("存在しない日付", `${cmd} to-wareki 2026-02-29`, "ERROR:");
test("範囲外の元号", `${cmd} to-seireki 平成32年1月1日`, "ERROR:");

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
