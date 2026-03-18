import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/parser.ts';
import { executeQuery } from '../src/executor.ts';
import { formatJson, formatTable } from '../src/formatter.ts';
import type { DataSet } from '../src/types.ts';

const data: DataSet = JSON.parse(readFileSync(new URL('./fixtures/sample-data.json', import.meta.url), 'utf8'));
const cliPath = new URL('../bin/jsql', import.meta.url);

test('SELECT', () => {
  const query = parseQuery('SELECT name, age FROM users');
  const result = executeQuery(data, query);
  assert.deepEqual(result, [
    { name: '田中太郎', age: 30 },
    { name: '佐藤花子', age: 25 },
    { name: '鈴木一郎', age: 35 },
  ]);
});

test('WHERE', () => {
  const query = parseQuery("SELECT * FROM users WHERE age >= 25 AND department_id = 1");
  const result = executeQuery(data, query);
  assert.deepEqual(result.map((row) => row.name), ['田中太郎', '鈴木一郎']);
});

test('LIKE', () => {
  const query = parseQuery("SELECT * FROM users WHERE name LIKE '%太郎'");
  const result = executeQuery(data, query);
  assert.deepEqual(result.map((row) => row.name), ['田中太郎']);
});

test('ORDER BY', () => {
  const query = parseQuery('SELECT name, age FROM users ORDER BY age DESC, name ASC');
  const result = executeQuery(data, query);
  assert.deepEqual(result.map((row) => row.name), ['鈴木一郎', '田中太郎', '佐藤花子']);
});

test('LIMIT / OFFSET', () => {
  const query = parseQuery('SELECT name FROM users ORDER BY id ASC LIMIT 1 OFFSET 1');
  const result = executeQuery(data, query);
  assert.deepEqual(result, [{ name: '佐藤花子' }]);
});

test('JOIN', () => {
  const query = parseQuery('SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id ORDER BY u.name ASC');
  const result = executeQuery(data, query);
  assert.deepEqual(result, [
    { 'u.name': '佐藤花子', 'd.name': '営業部' },
    { 'u.name': '田中太郎', 'd.name': '開発部' },
    { 'u.name': '鈴木一郎', 'd.name': '開発部' },
  ]);
});

test('LEFT JOIN', () => {
  const augmented: DataSet = {
    ...data,
    users: [...data.users, { id: 4, name: '独立太郎', age: 40, department_id: 99 }],
  };
  const query = parseQuery('SELECT u.name, d.name FROM users u LEFT JOIN departments d ON u.department_id = d.id ORDER BY u.id ASC');
  const result = executeQuery(augmented, query);
  assert.equal(result.at(-1)?.['d.name'], null);
});

test('GROUP BY', () => {
  const query = parseQuery('SELECT department_id, COUNT(*) FROM users GROUP BY department_id ORDER BY department_id ASC');
  const result = executeQuery(data, query);
  assert.deepEqual(result, [
    { department_id: 1, 'COUNT(*)': 2 },
    { department_id: 2, 'COUNT(*)': 1 },
  ]);
});

test('HAVING', () => {
  const query = parseQuery('SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30 ORDER BY department_id ASC');
  const result = executeQuery(data, query);
  assert.deepEqual(result, [
    { department_id: 1, 'AVG(age)': 32.5 },
  ]);
});

test('table format output', () => {
  const output = formatTable([
    { name: '田中太郎', age: 30 },
    { name: '佐藤花子', age: 25 },
  ]);
  assert.match(output, /\| name/);
  assert.match(output, /田中太郎/);
});

test('json format output', () => {
  const output = formatJson([{ name: '田中太郎', age: 30 }]);
  assert.equal(output, '[\n  {\n    "name": "田中太郎",\n    "age": 30\n  }\n]');
});

test('CLI integration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jsql-'));
  const jsonPath = join(dir, 'data.json');
  writeFileSync(jsonPath, JSON.stringify(data), 'utf8');

  const output = execFileSync('node', [
    cliPath.pathname,
    '--data',
    jsonPath,
    '--query',
    'SELECT name, age FROM users WHERE age > 25 ORDER BY age DESC',
    '--format',
    'json',
  ], { encoding: 'utf8' });

  assert.deepEqual(JSON.parse(output), [
    { name: '鈴木一郎', age: 35 },
    { name: '田中太郎', age: 30 },
  ]);
});
