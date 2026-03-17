import test from "node:test";
import assert from "node:assert/strict";
import { executeQuery, parseQuery } from "../src/index.ts";

const data = {
  users: [
    { id: 1, name: "Alice", age: 34, department_id: 10 },
    { id: 2, name: "Bob", age: 28, department_id: 20 },
    { id: 3, name: "Carol", age: 41, department_id: 10 },
    { id: 4, name: "Dave", age: 22, department_id: null }
  ],
  departments: [
    { id: 10, name: "Engineering" },
    { id: 20, name: "Sales" },
    { id: 30, name: "Support" }
  ],
  orders: [
    { id: 100, user_id: 1, total: 50 },
    { id: 101, user_id: 1, total: 75 },
    { id: 102, user_id: 2, total: 20 },
    { id: 103, user_id: 3, total: 100 }
  ]
};

test("filters with nested boolean logic and LIKE", () => {
  const result = executeQuery(
    data,
    parseQuery(
      "select name, age from users where (age >= 30 and not name like 'C%') or name = 'Dave' order by age desc"
    )
  );

  assert.deepEqual(result.rows, [
    { name: "Alice", age: 34 },
    { name: "Dave", age: 22 }
  ]);
});

test("supports joins with aliases and left join semantics", () => {
  const result = executeQuery(
    data,
    parseQuery(
      "SELECT u.name AS user_name, d.name AS department FROM users u LEFT JOIN departments d ON u.department_id = d.id ORDER BY u.id ASC"
    )
  );

  assert.deepEqual(result.rows, [
    { user_name: "Alice", department: "Engineering" },
    { user_name: "Bob", department: "Sales" },
    { user_name: "Carol", department: "Engineering" },
    { user_name: "Dave", department: undefined }
  ]);
});

test("supports grouping, aggregates, having, ordering, limit and offset", () => {
  const result = executeQuery(
    data,
    parseQuery(
      "SELECT u.department_id AS dept, COUNT(*) AS cnt, SUM(o.total) AS revenue, AVG(o.total) AS avg_total FROM users u INNER JOIN orders o ON u.id = o.user_id GROUP BY u.department_id HAVING SUM(o.total) >= 100 ORDER BY revenue DESC LIMIT 1 OFFSET 0"
    )
  );

  assert.deepEqual(result.rows, [
    { dept: 10, cnt: 3, revenue: 225, avg_total: 75 }
  ]);
});

test("supports wildcard selection", () => {
  const result = executeQuery(data, parseQuery("SELECT * FROM users WHERE id = 2"));
  assert.deepEqual(result.rows, [{ id: 2, name: "Bob", age: 28, department_id: 20 }]);
});
