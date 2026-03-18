import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { executeSql, formatJson, formatTable } from '../src/sql.ts';

const sampleData = {
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

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function writeTempData(data: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jsql-'));
  const filePath = path.join(dir, 'data.json');
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function runCli(args: string[]): string {
  const cliPath = fileURLToPath(new URL('../jsql', import.meta.url));
  const env = { ...process.env };
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  return execFileSync(cliPath, args, {
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env,
  });
}

test('SELECT and WHERE support case-insensitive keywords, parentheses, NOT, and LIKE', () => {
  const result = executeSql(
    sampleData,
    "select name, age from users where (age < 30 or department_id = 2) and not name = '鈴木一郎' order by id asc",
  );

  assert.deepEqual(result.columns, ['name', 'age']);
  assert.deepEqual(result.rows, [{ name: '佐藤花子', age: 25 }]);

  const likeResult = executeSql(sampleData, "select * from users where name like '%太郎'");
  assert.deepEqual(likeResult.rows, [
    { id: 1, name: '田中太郎', age: 30, department_id: 1 },
  ]);
});

test('JOIN supports INNER JOIN, aliases, and LEFT JOIN', () => {
  const inner = executeSql(
    sampleData,
    'SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id ORDER BY u.id ASC',
  );

  assert.deepEqual(inner.columns, ['u.name', 'd.name']);
  assert.deepEqual(inner.rows, [
    { 'u.name': '田中太郎', 'd.name': '開発部' },
    { 'u.name': '佐藤花子', 'd.name': '営業部' },
    { 'u.name': '鈴木一郎', 'd.name': '開発部' },
  ]);

  const leftJoinData = cloneData(sampleData);
  leftJoinData.users.push({ id: 4, name: '未所属', age: 20, department_id: 999 });
  const left = executeSql(
    leftJoinData,
    'SELECT u.name, d.name FROM users u LEFT JOIN departments d ON u.department_id = d.id ORDER BY u.id ASC',
  );

  assert.deepEqual(left.rows.at(-1), { 'u.name': '未所属', 'd.name': null });
});

test('ORDER BY supports multiple columns, LIMIT, and OFFSET', () => {
  const data = cloneData(sampleData);
  data.users.push({ id: 4, name: 'Aaron', age: 30, department_id: 1 });
  data.users.push({ id: 5, name: 'Bob', age: 30, department_id: 2 });

  const result = executeSql(
    data,
    'SELECT name, age FROM users ORDER BY age DESC, name ASC LIMIT 3 OFFSET 0',
  );

  assert.deepEqual(result.rows.map((row) => row.name), ['鈴木一郎', 'Aaron', 'Bob']);
});

test('GROUP BY, HAVING, COUNT, AVG, and COUNT(*) work together', () => {
  const countResult = executeSql(sampleData, 'SELECT COUNT(*) FROM users');
  assert.deepEqual(countResult.columns, ['COUNT(*)']);
  assert.deepEqual(countResult.rows, [{ 'COUNT(*)': 3 }]);

  const grouped = executeSql(
    sampleData,
    'SELECT department_id, COUNT(*) FROM users GROUP BY department_id HAVING AVG(age) > 30 ORDER BY department_id ASC',
  );

  assert.deepEqual(grouped.columns, ['department_id', 'COUNT(*)']);
  assert.deepEqual(grouped.rows, [{ department_id: 1, 'COUNT(*)': 2 }]);

  const avgResult = executeSql(
    sampleData,
    'SELECT department_id, AVG(age) FROM users GROUP BY department_id ORDER BY department_id ASC',
  );

  assert.deepEqual(avgResult.rows, [
    { department_id: 1, 'AVG(age)': 32.5 },
    { department_id: 2, 'AVG(age)': 25 },
  ]);
});

test('table formatting keeps the expected columns and values', () => {
  const result = executeSql(sampleData, 'SELECT name, age FROM users WHERE age <= 30 ORDER BY age ASC');
  const table = formatTable(result);

  assert.match(table, /\| name/);
  assert.match(table, /田中太郎/);
  assert.match(table, /佐藤花子/);
});

test('CLI returns table output by default and JSON with --format json', () => {
  const dataPath = writeTempData(sampleData);

  const tableOutput = runCli([
    '--data',
    dataPath,
    '--query',
    'SELECT name, age FROM users WHERE id = 2',
  ]);
  assert.match(tableOutput, /佐藤花子/);
  assert.match(tableOutput, /\| name/);

  const jsonOutput = runCli([
    '--data',
    dataPath,
    '--query',
    'SELECT name, age FROM users WHERE id = 2',
    '--format',
    'json',
  ]);
  assert.deepEqual(JSON.parse(jsonOutput), [{ name: '佐藤花子', age: 25 }]);
  assert.equal(formatJson({ columns: ['name'], rows: [{ name: 'x' }] }), '[{"name":"x"}]');
});
