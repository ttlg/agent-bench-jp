import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './parser';
import { execute } from './executor';
import { SelectStatement } from './ast';

const db = {
  users: [
    { id: 1, name: '田中太郎', age: 30, department_id: 1 },
    { id: 2, name: '佐藤花子', age: 25, department_id: 2 },
    { id: 3, name: '鈴木一郎', age: 35, department_id: 1 },
  ],
  departments: [
    { id: 1, name: '開発部' },
    { id: 2, name: '営業部' },
    { id: 3, name: '人事部' },
  ],
};

function run(sql: string) {
  return execute(parse(sql) as SelectStatement, db);
}

// ── SELECT ─────────────────────────────────────────────────────────────────────

test('SELECT * FROM users', () => {
  const rows = run('SELECT * FROM users');
  assert.equal(rows.length, 3);
  assert.ok('name' in rows[0]);
  assert.ok('age' in rows[0]);
});

test('SELECT name, age FROM users', () => {
  const rows = run('SELECT name, age FROM users');
  assert.equal(rows.length, 3);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['age', 'name']);
});

// ── WHERE ──────────────────────────────────────────────────────────────────────

test('WHERE age > 30', () => {
  const rows = run('SELECT * FROM users WHERE age > 30');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '鈴木一郎');
});

test("WHERE name = '佐藤花子'", () => {
  const rows = run("SELECT * FROM users WHERE name = '佐藤花子'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].age, 25);
});

test('WHERE AND', () => {
  const rows = run('SELECT * FROM users WHERE age >= 25 AND department_id = 1');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r: Record<string, unknown>) => r.department_id === 1));
});

test('WHERE OR', () => {
  const rows = run('SELECT * FROM users WHERE age < 30 OR department_id = 2');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '佐藤花子');
});

test('WHERE NOT', () => {
  const rows = run('SELECT * FROM users WHERE NOT age = 30');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r: Record<string, unknown>) => r.age !== 30));
});

test('WHERE LIKE suffix', () => {
  const rows = run("SELECT * FROM users WHERE name LIKE '%太郎'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '田中太郎');
});

test('WHERE LIKE prefix', () => {
  const rows = run("SELECT * FROM users WHERE name LIKE '佐藤%'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '佐藤花子');
});

test('WHERE parentheses', () => {
  const rows = run('SELECT * FROM users WHERE (age > 25 AND department_id = 1) OR age = 25');
  assert.equal(rows.length, 3);
});

// ── ORDER BY ───────────────────────────────────────────────────────────────────

test('ORDER BY age ASC', () => {
  const rows = run('SELECT * FROM users ORDER BY age ASC');
  assert.deepEqual(rows.map((r: Record<string, unknown>) => r.age), [25, 30, 35]);
});

test('ORDER BY age DESC', () => {
  const rows = run('SELECT * FROM users ORDER BY age DESC');
  assert.deepEqual(rows.map((r: Record<string, unknown>) => r.age), [35, 30, 25]);
});

test('ORDER BY multiple columns', () => {
  const rows = run('SELECT * FROM users ORDER BY department_id ASC, age DESC');
  assert.equal(rows[0].name, '鈴木一郎');
  assert.equal(rows[1].name, '田中太郎');
  assert.equal(rows[2].name, '佐藤花子');
});

// ── LIMIT / OFFSET ─────────────────────────────────────────────────────────────

test('LIMIT', () => {
  const rows = run('SELECT * FROM users LIMIT 2');
  assert.equal(rows.length, 2);
});

test('LIMIT OFFSET', () => {
  const rows = run('SELECT * FROM users ORDER BY id ASC LIMIT 2 OFFSET 1');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 2);
});

// ── JOIN ───────────────────────────────────────────────────────────────────────

test('INNER JOIN', () => {
  const rows = run('SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id');
  assert.equal(rows.length, 3);
  // Duplicate column names get qualified as table.col
  assert.ok(rows.some((r: Record<string, unknown>) => r['d.name'] === '開発部' || r['d.name'] === '営業部'));
  assert.ok(rows.some((r: Record<string, unknown>) => r['u.name'] === '田中太郎'));
});

test('LEFT JOIN includes unmatched', () => {
  const rows = run('SELECT u.name, d.name FROM users u LEFT JOIN departments d ON u.department_id = d.id');
  assert.equal(rows.length, 3);
});

test('LEFT JOIN returns NULL for unmatched right', () => {
  const localDB = {
    users: [{ id: 1, name: '田中', age: 30, department_id: 1 }],
    departments: [
      { id: 1, name: '開発部' },
      { id: 2, name: '営業部' },
    ],
  };
  const rows = execute(
    parse('SELECT d.id, u.id FROM departments d LEFT JOIN users u ON d.id = u.department_id') as SelectStatement,
    localDB
  );
  assert.equal(rows.length, 2);
  // The unmatched row should have null for u.id (column qualified as 'u.id')
  const hasNull = rows.some((r: Record<string, unknown>) => r['u.id'] === null);
  assert.ok(hasNull);
});

// ── GROUP BY / aggregates ──────────────────────────────────────────────────────

test('COUNT(*)', () => {
  const rows = run('SELECT COUNT(*) FROM users');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['COUNT(*)'], 3);
});

test('GROUP BY COUNT', () => {
  const rows = run('SELECT department_id, COUNT(*) FROM users GROUP BY department_id');
  assert.equal(rows.length, 2);
  const dept1 = rows.find((r: Record<string, unknown>) => r.department_id === 1);
  assert.equal(dept1!['COUNT(*)'], 2);
});

test('AVG', () => {
  const rows = run('SELECT AVG(age) FROM users');
  assert.equal(rows[0]['AVG(age)'], 30);
});

test('SUM', () => {
  const rows = run('SELECT SUM(age) FROM users');
  assert.equal(rows[0]['SUM(age)'], 90);
});

test('MIN MAX', () => {
  const rows = run('SELECT MIN(age), MAX(age) FROM users');
  assert.equal(rows[0]['MIN(age)'], 25);
  assert.equal(rows[0]['MAX(age)'], 35);
});

test('HAVING', () => {
  const rows = run('SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].department_id, 1);
});

// ── Case insensitivity ─────────────────────────────────────────────────────────

test('lowercase keywords', () => {
  const rows = run('select * from users where age > 25 order by age asc');
  assert.equal(rows.length, 2);
});
