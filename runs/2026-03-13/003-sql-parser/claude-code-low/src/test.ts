import { tokenize } from './lexer';
import { Parser } from './parser';
import { execute } from './executor';

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

function query(sql: string) {
  return execute(new Parser(tokenize(sql)).parse(), db);
}

let passed = 0, failed = 0;
function assert(name: string, fn: () => boolean) {
  try {
    if (fn()) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}`); }
  } catch (e: any) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
}

console.log('SELECT tests:');
assert('SELECT *', () => query('SELECT * FROM users').length === 3);
assert('SELECT columns', () => {
  const r = query('SELECT name, age FROM users');
  return r.length === 3 && 'name' in r[0] && 'age' in r[0] && !('id' in r[0]);
});
assert('SELECT with alias', () => {
  const r = query('SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id');
  return r.length === 3 && 'u.name' in r[0] && 'd.name' in r[0];
});

console.log('\nWHERE tests:');
assert('WHERE >', () => query('SELECT * FROM users WHERE age > 30').length === 1);
assert('WHERE =', () => {
  const r = query("SELECT * FROM users WHERE name = '佐藤花子'");
  return r.length === 1;
});
assert('WHERE AND', () => query('SELECT * FROM users WHERE age >= 25 AND department_id = 1').length === 2);
assert('WHERE OR', () => query('SELECT * FROM users WHERE age < 30 OR department_id = 2').length === 1);
assert('WHERE NOT', () => query('SELECT * FROM users WHERE NOT age = 30').length === 2);
assert('WHERE parentheses', () =>
  query('SELECT * FROM users WHERE (age < 30 OR age > 30) AND department_id = 1').length === 1
);

console.log('\nLIKE tests:');
assert('LIKE %suffix', () => query("SELECT * FROM users WHERE name LIKE '%太郎'").length === 1);
assert('LIKE prefix%', () => query("SELECT * FROM users WHERE name LIKE '佐藤%'").length === 1);
assert('LIKE %middle%', () => query("SELECT * FROM users WHERE name LIKE '%藤%'").length === 1);

console.log('\nORDER BY tests:');
assert('ORDER BY ASC', () => {
  const r = query('SELECT name, age FROM users ORDER BY age ASC');
  return r[0]['age'] === 25 && r[2]['age'] === 35;
});
assert('ORDER BY DESC', () => {
  const r = query('SELECT name, age FROM users ORDER BY age DESC');
  return r[0]['age'] === 35;
});

console.log('\nLIMIT/OFFSET tests:');
assert('LIMIT', () => query('SELECT * FROM users LIMIT 2').length === 2);
assert('LIMIT OFFSET', () => {
  const r = query('SELECT * FROM users ORDER BY id ASC LIMIT 1 OFFSET 1');
  return r.length === 1 && r[0]['users.id'] === 2;
});

console.log('\nJOIN tests:');
assert('INNER JOIN', () => {
  const r = query('SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id');
  return r.length === 3;
});
assert('LEFT JOIN', () => {
  const r = query('SELECT d.name, u.name FROM departments d LEFT JOIN users u ON d.id = u.department_id');
  return r.length === 4; // 人事部 has no users, but appears with NULL
});

console.log('\nAggregate tests:');
assert('COUNT(*)', () => {
  const r = query('SELECT COUNT(*) FROM users');
  return r[0]['COUNT(*)'] === 3;
});
assert('GROUP BY + COUNT', () => {
  const r = query('SELECT department_id, COUNT(*) FROM users GROUP BY department_id');
  return r.length === 2;
});
assert('GROUP BY + AVG', () => {
  const r = query('SELECT department_id, AVG(age) FROM users GROUP BY department_id');
  const dept1 = r.find((x: any) => x.department_id === 1);
  return !!dept1 && dept1['AVG(age)'] === 32.5;
});
assert('HAVING', () => {
  const r = query('SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30');
  return r.length === 1 && r[0].department_id === 1;
});
assert('SUM', () => {
  const r = query('SELECT SUM(age) FROM users');
  return r[0]['SUM(age)'] === 90;
});
assert('MIN/MAX', () => {
  const rMin = query('SELECT MIN(age) FROM users');
  const rMax = query('SELECT MAX(age) FROM users');
  return rMin[0]['MIN(age)'] === 25 && rMax[0]['MAX(age)'] === 35;
});

console.log('\nCase insensitivity test:');
assert('lowercase keywords', () => query('select * from users where age > 30').length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
