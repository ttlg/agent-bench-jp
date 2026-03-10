import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { executeQuery } from "../src/executor.js";
import { formatResultAsTable } from "../src/formatter.js";
import { parseQuery } from "../src/parser.js";
import type { TableData } from "../src/types.js";

const rootDir = path.resolve(import.meta.dirname, "..");
const fixturePath = path.resolve(rootDir, "tests/fixtures/data.json");
const fixtureData = JSON.parse(readFileSync(fixturePath, "utf8")) as TableData;

function run(sql: string) {
  return executeQuery(fixtureData, parseQuery(sql));
}

test("SELECT * returns all rows and columns", () => {
  const result = run("SELECT * FROM users ORDER BY id");
  assert.deepEqual(result.columns, ["id", "name", "age", "department_id"]);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows[0], {
    id: 1,
    name: "田中太郎",
    age: 30,
    department_id: 1,
  });
});

test("SELECT specific columns supports lowercase keywords", () => {
  const result = run("select name, age from users order by age desc");
  assert.deepEqual(result.rows, [
    { name: "鈴木一郎", age: 35 },
    { name: "田中太郎", age: 30 },
    { name: "佐藤花子", age: 25 },
  ]);
});

test("WHERE supports comparison, AND, OR, NOT, and parentheses", () => {
  const result = run(
    "SELECT name FROM users WHERE (age >= 25 AND department_id = 1) OR NOT age = 30 ORDER BY id ASC",
  );
  assert.deepEqual(result.rows, [
    { name: "田中太郎" },
    { name: "佐藤花子" },
    { name: "鈴木一郎" },
  ]);
});

test("LIKE supports percent wildcard", () => {
  const result = run("SELECT name FROM users WHERE name LIKE '%太郎'");
  assert.deepEqual(result.rows, [{ name: "田中太郎" }]);
});

test("JOIN resolves aliases and ON conditions", () => {
  const result = run(
    "SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id ORDER BY u.id ASC",
  );
  assert.deepEqual(result.rows, [
    { "u.name": "田中太郎", "d.name": "開発部" },
    { "u.name": "佐藤花子", "d.name": "営業部" },
    { "u.name": "鈴木一郎", "d.name": "開発部" },
  ]);
});

test("ORDER BY supports multiple columns", () => {
  const result = run("SELECT name, age FROM users ORDER BY age DESC, name ASC");
  assert.deepEqual(result.rows, [
    { name: "鈴木一郎", age: 35 },
    { name: "田中太郎", age: 30 },
    { name: "佐藤花子", age: 25 },
  ]);
});

test("LIMIT and OFFSET trim ordered rows", () => {
  const result = run("SELECT name FROM users ORDER BY id ASC LIMIT 1 OFFSET 1");
  assert.deepEqual(result.rows, [{ name: "佐藤花子" }]);
});

test("aggregate functions work without GROUP BY", () => {
  const result = run("SELECT COUNT(*) FROM users");
  assert.deepEqual(result.rows, [{ "COUNT(*)": 3 }]);
});

test("GROUP BY aggregates rows", () => {
  const result = run(
    "SELECT department_id, COUNT(*) FROM users GROUP BY department_id ORDER BY department_id ASC",
  );
  assert.deepEqual(result.rows, [
    { department_id: 1, "COUNT(*)": 2 },
    { department_id: 2, "COUNT(*)": 1 },
  ]);
});

test("HAVING filters grouped rows with aggregate conditions", () => {
  const result = run(
    "SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30 ORDER BY department_id",
  );
  assert.deepEqual(result.rows, [
    { department_id: 1, "AVG(age)": 32.5 },
  ]);
});

test("table formatter renders a markdown-like grid", () => {
  const result = run("SELECT name, age FROM users ORDER BY id ASC LIMIT 2");
  assert.equal(
    formatResultAsTable(result),
    [
      "| name     | age |",
      "|----------|-----|",
      "| 田中太郎 |  30 |",
      "| 佐藤花子 |  25 |",
    ].join("\n"),
  );
});

test("CLI outputs JSON with --format json", () => {
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", path.resolve(rootDir, "src/cli.ts"), "--data", fixturePath, "--query", "SELECT name FROM users ORDER BY id", "--format", "json"],
    {
      cwd: rootDir,
      encoding: "utf8",
    },
  );

  assert.deepEqual(JSON.parse(output), [
    { name: "田中太郎" },
    { name: "佐藤花子" },
    { name: "鈴木一郎" },
  ]);
});
