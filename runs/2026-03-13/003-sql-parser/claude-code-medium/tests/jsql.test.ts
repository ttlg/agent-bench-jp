import { tokenize } from '../src/tokenizer';
import { Parser } from '../src/parser';
import { execute } from '../src/executor';
import { formatTable, formatJson } from '../src/formatter';
import * as fs from 'fs';
import * as path from 'path';

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'testdata.json'), 'utf-8'));

function query(sql: string): Record<string, any>[] {
  const tokens = tokenize(sql);
  const parser = new Parser(tokens);
  const stmt = parser.parse();
  return execute(stmt, db);
}

// Helper to strip internal key prefixes for easier assertion
function cleanKeys(rows: Record<string, any>[]): Record<string, any>[] {
  return rows.map(row => {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      const match = key.match(/^__agg_(\w+)_(.+)$/);
      if (match) {
        cleaned[`${match[1]}(${match[2]})`] = value;
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  });
}

describe('SELECT', () => {
  test('SELECT * FROM users', () => {
    const result = query('SELECT * FROM users');
    expect(result.length).toBe(3);
    expect(result[0]).toHaveProperty('id', 1);
    expect(result[0]).toHaveProperty('name', '田中太郎');
  });

  test('SELECT name, age FROM users', () => {
    const result = query('SELECT name, age FROM users');
    expect(result.length).toBe(3);
    expect(Object.keys(result[0])).toEqual(['name', 'age']);
    expect(result[0].name).toBe('田中太郎');
    expect(result[0].age).toBe(30);
  });

  test('case insensitive keywords', () => {
    const result = query('select name from users');
    expect(result.length).toBe(3);
    expect(result[0].name).toBe('田中太郎');
  });
});

describe('WHERE', () => {
  test('WHERE age > 30', () => {
    const result = query('SELECT * FROM users WHERE age > 30');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('鈴木一郎');
  });

  test('WHERE name = string literal', () => {
    const result = query("SELECT * FROM users WHERE name = '佐藤花子'");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('WHERE with AND', () => {
    const result = query('SELECT * FROM users WHERE age >= 25 AND department_id = 1');
    expect(result.length).toBe(2);
  });

  test('WHERE with OR', () => {
    const result = query('SELECT * FROM users WHERE age < 30 OR department_id = 2');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('WHERE with NOT', () => {
    const result = query('SELECT * FROM users WHERE NOT age = 30');
    expect(result.length).toBe(2);
  });

  test('WHERE with parentheses', () => {
    const result = query('SELECT * FROM users WHERE (age < 30 OR age > 30) AND department_id = 1');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('鈴木一郎');
  });
});

describe('LIKE', () => {
  test('LIKE with trailing %', () => {
    const result = query("SELECT * FROM users WHERE name LIKE '%太郎'");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('田中太郎');
  });

  test('LIKE with leading %', () => {
    const result = query("SELECT * FROM users WHERE name LIKE '佐藤%'");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('LIKE with both %', () => {
    const result = query("SELECT * FROM users WHERE name LIKE '%花%'");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('佐藤花子');
  });
});

describe('ORDER BY', () => {
  test('ORDER BY ASC', () => {
    const result = query('SELECT * FROM users ORDER BY age ASC');
    expect(result[0].age).toBe(25);
    expect(result[1].age).toBe(30);
    expect(result[2].age).toBe(35);
  });

  test('ORDER BY DESC', () => {
    const result = query('SELECT * FROM users ORDER BY age DESC');
    expect(result[0].age).toBe(35);
    expect(result[1].age).toBe(30);
    expect(result[2].age).toBe(25);
  });

  test('ORDER BY multiple columns', () => {
    const result = query('SELECT * FROM users ORDER BY department_id ASC, age DESC');
    expect(result[0].name).toBe('鈴木一郎'); // dept 1, age 35
    expect(result[1].name).toBe('田中太郎'); // dept 1, age 30
    expect(result[2].name).toBe('佐藤花子'); // dept 2, age 25
  });
});

describe('LIMIT / OFFSET', () => {
  test('LIMIT', () => {
    const result = query('SELECT * FROM users LIMIT 2');
    expect(result.length).toBe(2);
  });

  test('LIMIT with OFFSET', () => {
    const result = query('SELECT * FROM users ORDER BY id ASC LIMIT 1 OFFSET 1');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('佐藤花子');
  });
});

describe('JOIN', () => {
  test('INNER JOIN', () => {
    const result = query(
      'SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id'
    );
    expect(result.length).toBe(3);
    expect(result[0]['u.name']).toBe('田中太郎');
    expect(result[0]['d.name']).toBe('開発部');
  });

  test('INNER JOIN explicit', () => {
    const result = query(
      'SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id'
    );
    expect(result.length).toBe(3);
  });

  test('LEFT JOIN', () => {
    const result = query(
      'SELECT d.name, u.name FROM departments d LEFT JOIN users u ON d.id = u.department_id'
    );
    // 開発部 has 2 users, 営業部 has 1, 人事部 has 0 → total 4 rows
    expect(result.length).toBe(4);
    const jinjiRows = result.filter(r => r['d.name'] === '人事部');
    expect(jinjiRows.length).toBe(1);
    expect(jinjiRows[0]['u.name']).toBeNull();
  });
});

describe('Aggregate functions', () => {
  test('COUNT(*)', () => {
    const result = cleanKeys(query('SELECT COUNT(*) FROM users'));
    expect(result.length).toBe(1);
    expect(result[0]['COUNT(*)']).toBe(3);
  });

  test('GROUP BY with COUNT', () => {
    const result = cleanKeys(
      query('SELECT department_id, COUNT(*) FROM users GROUP BY department_id')
    );
    expect(result.length).toBe(2);
    const dept1 = result.find(r => r.department_id === 1);
    expect(dept1!['COUNT(*)']).toBe(2);
  });

  test('GROUP BY with AVG', () => {
    const result = cleanKeys(
      query('SELECT department_id, AVG(age) FROM users GROUP BY department_id')
    );
    const dept1 = result.find(r => r.department_id === 1);
    expect(dept1!['AVG(age)']).toBeCloseTo(32.5);
  });

  test('SUM', () => {
    const result = cleanKeys(
      query('SELECT department_id, SUM(age) FROM users GROUP BY department_id')
    );
    const dept1 = result.find(r => r.department_id === 1);
    expect(dept1!['SUM(age)']).toBe(65);
  });

  test('MIN and MAX', () => {
    const result = cleanKeys(
      query('SELECT department_id, MIN(age), MAX(age) FROM users GROUP BY department_id')
    );
    const dept1 = result.find(r => r.department_id === 1);
    expect(dept1!['MIN(age)']).toBe(30);
    expect(dept1!['MAX(age)']).toBe(35);
  });
});

describe('HAVING', () => {
  test('HAVING with AVG', () => {
    const result = cleanKeys(
      query('SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30')
    );
    expect(result.length).toBe(1);
    expect(result[0].department_id).toBe(1);
  });
});

describe('Output formatting', () => {
  test('table format', () => {
    const rows = [
      { name: '田中太郎', age: 30 },
      { name: '佐藤花子', age: 25 },
    ];
    const output = formatTable(rows);
    expect(output).toContain('| name');
    expect(output).toContain('田中太郎');
    expect(output).toContain('---');
  });

  test('JSON format', () => {
    const rows = [{ name: '田中太郎', age: 30 }];
    const output = formatJson(rows);
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe('田中太郎');
    expect(parsed[0].age).toBe(30);
  });

  test('empty result set', () => {
    const output = formatTable([]);
    expect(output).toContain('empty');
  });
});
