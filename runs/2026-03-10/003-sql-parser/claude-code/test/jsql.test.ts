import { tokenize } from '../src/lexer';
import { parse } from '../src/parser';
import { execute } from '../src/executor';
import { formatTable, formatJson } from '../src/formatter';

const data = {
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
  const tokens = tokenize(sql);
  const ast = parse(tokens);
  return execute(ast, data);
}

describe('SELECT', () => {
  test('SELECT * FROM users', () => {
    const result = query('SELECT * FROM users');
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty('name', '田中太郎');
  });

  test('SELECT specific columns', () => {
    const result = query('SELECT name, age FROM users');
    expect(result).toHaveLength(3);
    expect(Object.keys(result[0])).toEqual(['name', 'age']);
  });

  test('case insensitive keywords', () => {
    const result = query('select * from users');
    expect(result).toHaveLength(3);
  });
});

describe('WHERE', () => {
  test('WHERE with > operator', () => {
    const result = query('SELECT * FROM users WHERE age > 30');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('鈴木一郎');
  });

  test('WHERE with = operator on string', () => {
    const result = query("SELECT * FROM users WHERE name = '佐藤花子'");
    expect(result).toHaveLength(1);
    expect(result[0].age).toBe(25);
  });

  test('WHERE with AND', () => {
    const result = query('SELECT * FROM users WHERE age >= 25 AND department_id = 1');
    expect(result).toHaveLength(2);
  });

  test('WHERE with OR', () => {
    const result = query('SELECT * FROM users WHERE age < 30 OR department_id = 2');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('WHERE with NOT', () => {
    const result = query('SELECT * FROM users WHERE NOT age = 30');
    expect(result).toHaveLength(2);
  });

  test('WHERE with parentheses', () => {
    const result = query('SELECT * FROM users WHERE (age < 30 OR age > 30) AND department_id = 1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('鈴木一郎');
  });
});

describe('LIKE', () => {
  test('LIKE with % prefix', () => {
    const result = query("SELECT * FROM users WHERE name LIKE '%太郎'");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('田中太郎');
  });

  test('LIKE with % suffix', () => {
    const result = query("SELECT * FROM users WHERE name LIKE '佐藤%'");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('LIKE with % on both sides', () => {
    const result = query("SELECT * FROM users WHERE name LIKE '%一%'");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('鈴木一郎');
  });
});

describe('ORDER BY', () => {
  test('ORDER BY ASC', () => {
    const result = query('SELECT * FROM users ORDER BY age ASC');
    expect(result[0].age).toBe(25);
    expect(result[2].age).toBe(35);
  });

  test('ORDER BY DESC', () => {
    const result = query('SELECT * FROM users ORDER BY age DESC');
    expect(result[0].age).toBe(35);
    expect(result[2].age).toBe(25);
  });

  test('ORDER BY multiple columns', () => {
    const result = query('SELECT * FROM users ORDER BY department_id ASC, age DESC');
    expect(result[0].name).toBe('鈴木一郎');
    expect(result[1].name).toBe('田中太郎');
    expect(result[2].name).toBe('佐藤花子');
  });

  test('ORDER BY default is ASC', () => {
    const result = query('SELECT * FROM users ORDER BY age');
    expect(result[0].age).toBe(25);
  });
});

describe('LIMIT / OFFSET', () => {
  test('LIMIT', () => {
    const result = query('SELECT * FROM users LIMIT 2');
    expect(result).toHaveLength(2);
  });

  test('LIMIT with OFFSET', () => {
    const result = query('SELECT * FROM users ORDER BY id ASC LIMIT 1 OFFSET 1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });
});

describe('JOIN', () => {
  test('INNER JOIN', () => {
    const result = query(
      'SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id'
    );
    expect(result).toHaveLength(3);
    expect(result[0]['u.name']).toBe('田中太郎');
    expect(result[0]['d.name']).toBe('開発部');
  });

  test('JOIN (without INNER keyword)', () => {
    const result = query(
      'SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id'
    );
    expect(result).toHaveLength(3);
  });

  test('LEFT JOIN', () => {
    const result = query(
      'SELECT d.name, u.name FROM departments d LEFT JOIN users u ON d.id = u.department_id'
    );
    // 開発部 has 2 users, 営業部 has 1, 人事部 has 0 (null)
    expect(result).toHaveLength(4);
    const hrDept = result.find(r => r['d.name'] === '人事部');
    expect(hrDept).toBeDefined();
    expect(hrDept!['u.name']).toBeNull();
  });
});

describe('Aggregate functions', () => {
  test('COUNT(*)', () => {
    const result = query('SELECT COUNT(*) FROM users');
    expect(result).toHaveLength(1);
    expect(result[0]['COUNT(*)']).toBe(3);
  });

  test('GROUP BY with COUNT', () => {
    const result = query('SELECT department_id, COUNT(*) FROM users GROUP BY department_id');
    expect(result).toHaveLength(2);
    const dept1 = result.find(r => r.department_id === 1);
    expect(dept1!['COUNT(*)']).toBe(2);
  });

  test('AVG', () => {
    const result = query('SELECT department_id, AVG(age) FROM users GROUP BY department_id');
    const dept1 = result.find(r => r.department_id === 1);
    expect(dept1!['AVG(age)']).toBe(32.5);
  });

  test('SUM', () => {
    const result = query('SELECT SUM(age) FROM users');
    expect(result[0]['SUM(age)']).toBe(90);
  });

  test('MIN and MAX', () => {
    const result = query('SELECT MIN(age), MAX(age) FROM users');
    expect(result[0]['MIN(age)']).toBe(25);
    expect(result[0]['MAX(age)']).toBe(35);
  });

  test('HAVING', () => {
    const result = query(
      'SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30'
    );
    expect(result).toHaveLength(1);
    expect(result[0].department_id).toBe(1);
    expect(result[0]['AVG(age)']).toBe(32.5);
  });
});

describe('Formatter', () => {
  test('table format', () => {
    const rows = [{ name: '田中太郎', age: 30 }];
    const output = formatTable(rows);
    expect(output).toContain('name');
    expect(output).toContain('田中太郎');
    expect(output).toContain('30');
    expect(output).toContain('|');
  });

  test('json format', () => {
    const rows = [{ name: '田中太郎', age: 30 }];
    const output = formatJson(rows);
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(rows);
  });

  test('empty result set', () => {
    const output = formatTable([]);
    expect(output).toBe('(empty result set)');
  });
});
