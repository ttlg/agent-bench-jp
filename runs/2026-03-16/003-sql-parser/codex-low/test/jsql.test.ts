import test from "node:test";
import assert from "node:assert/strict";
import { parseSql } from "../src/parser.ts";
import { runQuery } from "../src/index.ts";
import type { DataSet } from "../src/types.ts";

const data: DataSet = {
  users: [
    { id: 1, name: "Alice", age: 30, dept_id: 10, salary: 100 },
    { id: 2, name: "Bob", age: 24, dept_id: 20, salary: 80 },
    { id: 3, name: "Carol", age: 35, dept_id: 10, salary: 120 },
    { id: 4, name: "Dave", age: 28, dept_id: null, salary: 70 }
  ],
  departments: [
    { id: 10, name: "Engineering" },
    { id: 20, name: "Sales" }
  ]
};

test("parser handles mixed case keywords and aliases", () => {
  const ast = parseSql("select u.name as employee from users u where age >= 30");
  assert.equal(ast.from.alias, "u");
  assert.equal(ast.select[0].type, "expression");
});

test("where, order by, limit, offset", () => {
  const result = runQuery(
    data,
    "SELECT name, age FROM users WHERE age >= 28 AND NOT name LIKE 'D%' ORDER BY age DESC, name ASC LIMIT 2 OFFSET 0",
    "json"
  );
  assert.deepEqual(JSON.parse(result), [
    { name: "Carol", age: 35 },
    { name: "Alice", age: 30 }
  ]);
});

test("inner join projects matching rows", () => {
  const result = runQuery(
    data,
    "SELECT u.name AS employee, d.name AS department FROM users u INNER JOIN departments d ON u.dept_id = d.id ORDER BY employee ASC",
    "json"
  );
  assert.deepEqual(JSON.parse(result), [
    { employee: "Alice", department: "Engineering" },
    { employee: "Bob", department: "Sales" },
    { employee: "Carol", department: "Engineering" }
  ]);
});

test("left join keeps unmatched rows", () => {
  const result = runQuery(
    data,
    "SELECT u.name, d.name AS department FROM users u LEFT JOIN departments d ON u.dept_id = d.id WHERE u.name = 'Dave'",
    "json"
  );
  assert.deepEqual(JSON.parse(result), [{ name: "Dave", department: null }]);
});

test("group by, aggregates, having", () => {
  const result = runQuery(
    data,
    "SELECT dept_id, COUNT(*) AS total, SUM(salary) AS payroll, AVG(age) AS avg_age FROM users GROUP BY dept_id HAVING COUNT(*) >= 2 ORDER BY dept_id ASC",
    "json"
  );
  assert.deepEqual(JSON.parse(result), [
    { dept_id: 10, total: 2, payroll: 220, avg_age: 32.5 }
  ]);
});

test("table format renders headers and rows", () => {
  const output = runQuery(data, "SELECT name, salary FROM users WHERE id = 1");
  assert.match(output, /name/);
  assert.match(output, /Alice/);
});
