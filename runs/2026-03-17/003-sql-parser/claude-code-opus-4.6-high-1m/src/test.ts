import { parse } from "./parser";
import { execute } from "./executor";
import { formatTable } from "./formatter";
import { Database, Row } from "./types";

const db: Database = {
  users: [
    { id: 1, name: "田中太郎", age: 30, department_id: 1 },
    { id: 2, name: "佐藤花子", age: 25, department_id: 2 },
    { id: 3, name: "鈴木一郎", age: 35, department_id: 1 },
  ],
  departments: [
    { id: 1, name: "開発部" },
    { id: 2, name: "営業部" },
    { id: 3, name: "人事部" },
  ],
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

function query(sql: string): Row[] {
  const stmt = parse(sql);
  return execute(stmt, db);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = `  ✗ ${name}: ${(err as Error).message}`;
    console.log(msg);
    failures.push(msg);
  }
}

function assertEqual(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ? label + ": " : ""}Expected ${e}, got ${a}`);
  }
}

function assertLength(arr: unknown[], expected: number): void {
  if (arr.length !== expected) {
    throw new Error(`Expected length ${expected}, got ${arr.length}`);
  }
}

// ===== SELECT tests =====

console.log("\nSELECT:");

test("SELECT * FROM users", () => {
  const result = query("SELECT * FROM users");
  assertLength(result, 3);
  assertEqual(result[0].name, "田中太郎");
  assertEqual(result[0].age, 30);
});

test("SELECT specific columns", () => {
  const result = query("SELECT name, age FROM users");
  assertLength(result, 3);
  assertEqual(Object.keys(result[0]).length, 2);
  assertEqual(result[0].name, "田中太郎");
  assertEqual(result[0].age, 30);
});

test("case insensitive keywords", () => {
  const result = query("select name from users");
  assertLength(result, 3);
  assertEqual(result[0].name, "田中太郎");
});

// ===== WHERE tests =====

console.log("\nWHERE:");

test("WHERE with > operator", () => {
  const result = query("SELECT * FROM users WHERE age > 30");
  assertLength(result, 1);
  assertEqual(result[0].name, "鈴木一郎");
});

test("WHERE with = operator (string)", () => {
  const result = query("SELECT * FROM users WHERE name = '佐藤花子'");
  assertLength(result, 1);
  assertEqual(result[0].age, 25);
});

test("WHERE with >= and AND", () => {
  const result = query(
    "SELECT * FROM users WHERE age >= 25 AND department_id = 1"
  );
  assertLength(result, 2);
});

test("WHERE with < and OR", () => {
  const result = query(
    "SELECT * FROM users WHERE age < 30 OR department_id = 2"
  );
  assertLength(result, 1);
  assertEqual(result[0].name, "佐藤花子");
});

test("WHERE with NOT", () => {
  const result = query("SELECT * FROM users WHERE NOT age = 30");
  assertLength(result, 2);
});

test("WHERE with != operator", () => {
  const result = query("SELECT * FROM users WHERE age != 30");
  assertLength(result, 2);
});

test("WHERE with <= operator", () => {
  const result = query("SELECT * FROM users WHERE age <= 30");
  assertLength(result, 2);
});

test("WHERE with parentheses", () => {
  const result = query(
    "SELECT * FROM users WHERE (age < 30 OR age > 30) AND department_id = 1"
  );
  assertLength(result, 1);
  assertEqual(result[0].name, "鈴木一郎");
});

// ===== LIKE tests =====

console.log("\nLIKE:");

test("LIKE with trailing %", () => {
  const result = query("SELECT * FROM users WHERE name LIKE '田中%'");
  assertLength(result, 1);
  assertEqual(result[0].name, "田中太郎");
});

test("LIKE with leading %", () => {
  const result = query("SELECT * FROM users WHERE name LIKE '%太郎'");
  assertLength(result, 1);
  assertEqual(result[0].name, "田中太郎");
});

test("LIKE with % on both sides", () => {
  const result = query("SELECT * FROM users WHERE name LIKE '%花%'");
  assertLength(result, 1);
  assertEqual(result[0].name, "佐藤花子");
});

test("LIKE with no match", () => {
  const result = query("SELECT * FROM users WHERE name LIKE '%山田%'");
  assertLength(result, 0);
});

// ===== ORDER BY tests =====

console.log("\nORDER BY:");

test("ORDER BY ASC", () => {
  const result = query("SELECT * FROM users ORDER BY age ASC");
  assertEqual(result[0].age, 25);
  assertEqual(result[1].age, 30);
  assertEqual(result[2].age, 35);
});

test("ORDER BY DESC", () => {
  const result = query("SELECT * FROM users ORDER BY age DESC");
  assertEqual(result[0].age, 35);
  assertEqual(result[1].age, 30);
  assertEqual(result[2].age, 25);
});

test("ORDER BY default (ASC)", () => {
  const result = query("SELECT * FROM users ORDER BY age");
  assertEqual(result[0].age, 25);
  assertEqual(result[2].age, 35);
});

test("ORDER BY multiple columns", () => {
  const result = query(
    "SELECT * FROM users ORDER BY department_id ASC, age DESC"
  );
  // dept 1: age 35, 30; dept 2: age 25
  assertEqual(result[0].age, 35);
  assertEqual(result[1].age, 30);
  assertEqual(result[2].age, 25);
});

// ===== LIMIT / OFFSET tests =====

console.log("\nLIMIT / OFFSET:");

test("LIMIT", () => {
  const result = query("SELECT * FROM users LIMIT 2");
  assertLength(result, 2);
});

test("LIMIT with OFFSET", () => {
  const result = query("SELECT * FROM users ORDER BY id ASC LIMIT 1 OFFSET 1");
  assertLength(result, 1);
  assertEqual(result[0].name, "佐藤花子");
});

test("LIMIT 10 (larger than data)", () => {
  const result = query("SELECT * FROM users LIMIT 10");
  assertLength(result, 3);
});

// ===== JOIN tests =====

console.log("\nJOIN:");

test("INNER JOIN", () => {
  const result = query(
    "SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id"
  );
  assertLength(result, 3);
  assertEqual(result[0]["u.name"], "田中太郎");
  assertEqual(result[0]["d.name"], "開発部");
});

test("JOIN (shorthand for INNER JOIN)", () => {
  const result = query(
    "SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id"
  );
  assertLength(result, 3);
});

test("LEFT JOIN", () => {
  const result = query(
    "SELECT d.name, u.name FROM departments d LEFT JOIN users u ON d.id = u.department_id"
  );
  // 開発部->田中, 開発部->鈴木, 営業部->佐藤, 人事部->NULL
  assertLength(result, 4);
  const hr = result.find((r) => r["d.name"] === "人事部");
  assertEqual(hr?.["u.name"], null);
});

test("LEFT OUTER JOIN", () => {
  const result = query(
    "SELECT d.name, u.name FROM departments d LEFT OUTER JOIN users u ON d.id = u.department_id"
  );
  assertLength(result, 4);
});

// ===== Aggregate tests =====

console.log("\nAggregate functions:");

test("COUNT(*)", () => {
  const result = query("SELECT COUNT(*) FROM users");
  assertLength(result, 1);
  assertEqual(result[0]["COUNT(*)"], 3);
});

test("COUNT(column)", () => {
  const result = query("SELECT COUNT(name) FROM users");
  assertLength(result, 1);
  assertEqual(result[0]["COUNT(name)"], 3);
});

test("SUM", () => {
  const result = query("SELECT SUM(age) FROM users");
  assertEqual(result[0]["SUM(age)"], 90);
});

test("AVG", () => {
  const result = query("SELECT AVG(age) FROM users");
  assertEqual(result[0]["AVG(age)"], 30);
});

test("MIN", () => {
  const result = query("SELECT MIN(age) FROM users");
  assertEqual(result[0]["MIN(age)"], 25);
});

test("MAX", () => {
  const result = query("SELECT MAX(age) FROM users");
  assertEqual(result[0]["MAX(age)"], 35);
});

// ===== GROUP BY tests =====

console.log("\nGROUP BY:");

test("GROUP BY with COUNT", () => {
  const result = query(
    "SELECT department_id, COUNT(*) FROM users GROUP BY department_id"
  );
  assertLength(result, 2);
  const dept1 = result.find((r) => r.department_id === 1);
  const dept2 = result.find((r) => r.department_id === 2);
  assertEqual(dept1?.["COUNT(*)"], 2);
  assertEqual(dept2?.["COUNT(*)"], 1);
});

test("GROUP BY with AVG", () => {
  const result = query(
    "SELECT department_id, AVG(age) FROM users GROUP BY department_id"
  );
  assertLength(result, 2);
  const dept1 = result.find((r) => r.department_id === 1);
  assertEqual(dept1?.["AVG(age)"], 32.5);
});

// ===== HAVING tests =====

console.log("\nHAVING:");

test("HAVING with AVG", () => {
  const result = query(
    "SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30"
  );
  assertLength(result, 1);
  assertEqual(result[0].department_id, 1);
});

test("HAVING with COUNT", () => {
  const result = query(
    "SELECT department_id, COUNT(*) FROM users GROUP BY department_id HAVING COUNT(*) > 1"
  );
  assertLength(result, 1);
  assertEqual(result[0].department_id, 1);
  assertEqual(result[0]["COUNT(*)"], 2);
});

// ===== Combined query tests =====

console.log("\nCombined queries:");

test("WHERE + ORDER BY + LIMIT", () => {
  const result = query(
    "SELECT * FROM users WHERE age >= 25 ORDER BY age DESC LIMIT 2"
  );
  assertLength(result, 2);
  assertEqual(result[0].age, 35);
  assertEqual(result[1].age, 30);
});

test("JOIN + WHERE", () => {
  const result = query(
    "SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id WHERE u.age > 25"
  );
  assertLength(result, 2);
});

// ===== Formatter test =====

console.log("\nFormatter:");

test("table format output", () => {
  const result = query("SELECT name, age FROM users ORDER BY id ASC LIMIT 2");
  const table = formatTable(result);
  const lines = table.split("\n");
  // Header + separator + 2 rows = 4 lines
  assertEqual(lines.length, 4);
  // Header should contain column names
  if (!lines[0].includes("name") || !lines[0].includes("age")) {
    throw new Error("Header should contain column names");
  }
  // Separator should contain dashes
  if (!lines[1].includes("---")) {
    throw new Error("Separator should contain dashes");
  }
});

test("empty result", () => {
  const result = query("SELECT * FROM users WHERE age > 100");
  const table = formatTable(result);
  assertEqual(table, "(0 rows)");
});

// ===== Summary =====

console.log("\n" + "=".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(f));
}

process.exit(failed > 0 ? 1 : 0);
