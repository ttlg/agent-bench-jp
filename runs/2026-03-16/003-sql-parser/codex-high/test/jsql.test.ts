import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { executeQuery } from "../src/engine.ts";
import { parseSql } from "../src/parser.ts";
import { formatTable } from "../src/formatter.ts";

const fixturePath = resolve("test/fixtures/data.json");
const database = JSON.parse(readFileSync(fixturePath, "utf8"));

test("parses keywords case-insensitively and applies where/order/limit", () => {
  const query = parseSql(
    "select id, name as user_name from users where age >= 30 and not (city like 'B%') order by age desc, id asc limit 2"
  );

  const result = executeQuery(database, query);

  assert.deepEqual(result.rows, [
    { id: 3, user_name: "Carol" },
    { id: 1, user_name: "Alice" }
  ]);
});

test("executes inner joins with qualified columns", () => {
  const query = parseSql(
    "SELECT users.name AS user_name, orders.total FROM users INNER JOIN orders ON users.id = orders.userId WHERE orders.total > 50 ORDER BY orders.total DESC"
  );

  const result = executeQuery(database, query);

  assert.deepEqual(result.rows, [
    { user_name: "Carol", total: 200 },
    { user_name: "Alice", total: 120 },
    { user_name: "Alice", total: 80 }
  ]);
});

test("executes left joins and group by with aggregates and having", () => {
  const query = parseSql(
    "SELECT users.name, COUNT(orders.id) AS order_count, SUM(orders.total) AS total_spent FROM users LEFT JOIN orders ON users.id = orders.userId GROUP BY users.name HAVING COUNT(orders.id) >= 1 ORDER BY total_spent DESC, users.name ASC"
  );

  const result = executeQuery(database, query);

  assert.deepEqual(result.rows, [
    { name: "Alice", order_count: 2, total_spent: 200 },
    { name: "Carol", order_count: 1, total_spent: 200 },
    { name: "Bob", order_count: 1, total_spent: 40 }
  ]);
});

test("supports aggregate queries without group by", () => {
  const query = parseSql(
    "SELECT COUNT(*) AS order_count, AVG(total) AS avg_total, MAX(total) AS max_total FROM orders WHERE status = 'paid'"
  );

  const result = executeQuery(database, query);

  assert.deepEqual(result.rows, [
    { order_count: 3, avg_total: 120, max_total: 200 }
  ]);
});

test("formats tabular output", () => {
  const query = parseSql("SELECT id, name FROM users ORDER BY id ASC LIMIT 2");
  const result = executeQuery(database, query);
  const output = formatTable(result);

  assert.match(output, /^id \| name\s*\n/);
  assert.match(output, /1\s+\| Alice/);
  assert.match(output, /2\s+\| Bob/);
});

test("supports select star with offset", () => {
  const query = parseSql("SELECT * FROM users ORDER BY id ASC LIMIT 1 OFFSET 2");
  const result = executeQuery(database, query);

  assert.deepEqual(result.rows, [
    { id: 3, name: "Carol", age: 41, region: "East", city: "Osaka" }
  ]);
});

test("runs the CLI and emits JSON output", () => {
  const cliPath = resolve("src/cli.ts");
  const output = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      cliPath,
      "--data",
      fixturePath,
      "--query",
      "SELECT name FROM users ORDER BY id DESC LIMIT 2",
      "--format",
      "json"
    ],
    { encoding: "utf8" }
  );

  assert.deepEqual(JSON.parse(output), [
    { name: "Dave" },
    { name: "Carol" }
  ]);
});
