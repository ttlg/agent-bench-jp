import { tokenize } from '../src/lexer';
import { parse } from '../src/parser';
import { execute } from '../src/executor';
import { formatTable, formatJson } from '../src/formatter';

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

function query(sql: string, data: any = sampleData) {
  const tokens = tokenize(sql);
  const ast = parse(tokens);
  return execute(ast, data);
}

describe('SELECT', () => {
  test('SELECT * FROM users', () => {
    const result = query('SELECT * FROM users');
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('name');
    expect(result[0]).toHaveProperty('age');
    expect(result[0]).toHaveProperty('department_id');
  });

  test('SELECT specific columns', () => {
    const result = query('SELECT name, age FROM users');
    expect(result).toHaveLength(3);
    expect(Object.keys(result[0])).toEqual(['name', 'age']);
    expect(result[0].name).toBe('田中太郎');
    expect(result[0].age).toBe(30);
  });

  test('SELECT with table alias', () => {
    const result = query('SELECT u.name, u.age FROM users u');
    expect(result).toHaveLength(3);
    expect(result[0]['u.name']).toBe('田中太郎');
    expect(result[0]['u.age']).toBe(30);
  });
});

describe('WHERE', () => {
  test('WHERE with > operator', () => {
    const result = query('SELECT * FROM users WHERE age > 30');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('鈴木一郎');
  });

  test('WHERE with = operator for string', () => {
    const result = query("SELECT * FROM users WHERE name = '佐藤花子'");
    expect(result).toHaveLength(1);
    expect(result[0].age).toBe(25);
  });

  test('WHERE with < operator', () => {
    const result = query('SELECT * FROM users WHERE age < 30');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('WHERE with >= operator', () => {
    const result = query('SELECT * FROM users WHERE age >= 30');
    expect(result).toHaveLength(2);
  });

  test('WHERE with <= operator', () => {
    const result = query('SELECT * FROM users WHERE age <= 30');
    expect(result).toHaveLength(2);
  });

  test('WHERE with != operator', () => {
    const result = query('SELECT * FROM users WHERE age != 30');
    expect(result).toHaveLength(2);
  });

  test('WHERE with AND', () => {
    const result = query(
      'SELECT * FROM users WHERE age >= 25 AND department_id = 1'
    );
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.department_id === 1)).toBe(true);
  });

  test('WHERE with OR', () => {
    const result = query(
      'SELECT * FROM users WHERE age > 30 OR department_id = 2'
    );
    expect(result).toHaveLength(2);
  });

  test('WHERE with NOT', () => {
    const result = query('SELECT * FROM users WHERE NOT age = 30');
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.age !== 30)).toBe(true);
  });

  test('WHERE with LIKE (suffix match)', () => {
    const result = query("SELECT * FROM users WHERE name LIKE '%太郎'");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('田中太郎');
  });

  test('WHERE with LIKE (prefix match)', () => {
    const result = query("SELECT * FROM users WHERE name LIKE '佐藤%'");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('WHERE with LIKE (contains)', () => {
    const result = query("SELECT * FROM users WHERE name LIKE '%花%'");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('WHERE with parentheses', () => {
    const result = query(
      'SELECT * FROM users WHERE (age = 25 OR age = 35) AND department_id = 1'
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('鈴木一郎');
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

  test('ORDER BY default is ASC', () => {
    const result = query('SELECT * FROM users ORDER BY age');
    expect(result[0].age).toBe(25);
    expect(result[2].age).toBe(35);
  });

  test('ORDER BY multiple columns', () => {
    const result = query(
      'SELECT * FROM users ORDER BY department_id ASC, age DESC'
    );
    expect(result[0].name).toBe('鈴木一郎'); // dept 1, age 35
    expect(result[1].name).toBe('田中太郎'); // dept 1, age 30
    expect(result[2].name).toBe('佐藤花子'); // dept 2, age 25
  });
});

describe('LIMIT / OFFSET', () => {
  test('LIMIT', () => {
    const result = query('SELECT * FROM users LIMIT 2');
    expect(result).toHaveLength(2);
  });

  test('LIMIT 1', () => {
    const result = query('SELECT * FROM users LIMIT 1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('田中太郎');
  });

  test('LIMIT with OFFSET', () => {
    const result = query('SELECT * FROM users LIMIT 1 OFFSET 1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('LIMIT 10 returns all rows when fewer exist', () => {
    const result = query('SELECT * FROM users LIMIT 10');
    expect(result).toHaveLength(3);
  });

  test('OFFSET skips rows', () => {
    const result = query('SELECT * FROM users LIMIT 10 OFFSET 2');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('鈴木一郎');
  });
});

describe('JOIN', () => {
  test('INNER JOIN (JOIN keyword)', () => {
    const result = query(
      'SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id'
    );
    expect(result).toHaveLength(3);
    expect(result[0]['u.name']).toBe('田中太郎');
    expect(result[0]['d.name']).toBe('開発部');
  });

  test('INNER JOIN (INNER JOIN keywords)', () => {
    const result = query(
      'SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id'
    );
    expect(result).toHaveLength(3);
  });

  test('LEFT JOIN includes unmatched rows', () => {
    const dataWithOrphan = {
      users: [
        { id: 1, name: 'Alice', age: 30, department_id: 1 },
        { id: 2, name: 'Bob', age: 25, department_id: 99 },
      ],
      departments: [{ id: 1, name: 'Engineering' }],
    };
    const result = query(
      'SELECT u.name, d.name FROM users u LEFT JOIN departments d ON u.department_id = d.id',
      dataWithOrphan
    );
    expect(result).toHaveLength(2);
    expect(result[0]['u.name']).toBe('Alice');
    expect(result[0]['d.name']).toBe('Engineering');
    expect(result[1]['u.name']).toBe('Bob');
    expect(result[1]['d.name']).toBeNull();
  });

  test('LEFT OUTER JOIN', () => {
    const result = query(
      'SELECT u.name, d.name FROM users u LEFT OUTER JOIN departments d ON u.department_id = d.id'
    );
    expect(result).toHaveLength(3);
  });

  test('JOIN with WHERE', () => {
    const result = query(
      'SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id WHERE u.age > 25'
    );
    expect(result).toHaveLength(2);
  });
});

describe('Aggregate Functions', () => {
  test('COUNT(*)', () => {
    const result = query('SELECT COUNT(*) FROM users');
    expect(result).toHaveLength(1);
    expect(result[0]['COUNT(*)']).toBe(3);
  });

  test('COUNT(column)', () => {
    const result = query('SELECT COUNT(name) FROM users');
    expect(result).toHaveLength(1);
    expect(result[0]['COUNT(name)']).toBe(3);
  });

  test('SUM', () => {
    const result = query('SELECT SUM(age) FROM users');
    expect(result).toHaveLength(1);
    expect(result[0]['SUM(age)']).toBe(90);
  });

  test('AVG', () => {
    const result = query('SELECT AVG(age) FROM users');
    expect(result).toHaveLength(1);
    expect(result[0]['AVG(age)']).toBe(30);
  });

  test('MIN', () => {
    const result = query('SELECT MIN(age) FROM users');
    expect(result).toHaveLength(1);
    expect(result[0]['MIN(age)']).toBe(25);
  });

  test('MAX', () => {
    const result = query('SELECT MAX(age) FROM users');
    expect(result).toHaveLength(1);
    expect(result[0]['MAX(age)']).toBe(35);
  });
});

describe('GROUP BY', () => {
  test('GROUP BY with COUNT', () => {
    const result = query(
      'SELECT department_id, COUNT(*) FROM users GROUP BY department_id'
    );
    expect(result).toHaveLength(2);
    const dept1 = result.find((r) => r.department_id === 1);
    const dept2 = result.find((r) => r.department_id === 2);
    expect(dept1!['COUNT(*)']).toBe(2);
    expect(dept2!['COUNT(*)']).toBe(1);
  });

  test('GROUP BY with AVG', () => {
    const result = query(
      'SELECT department_id, AVG(age) FROM users GROUP BY department_id'
    );
    const dept1 = result.find((r) => r.department_id === 1);
    const dept2 = result.find((r) => r.department_id === 2);
    expect(dept1!['AVG(age)']).toBe(32.5);
    expect(dept2!['AVG(age)']).toBe(25);
  });

  test('GROUP BY with SUM', () => {
    const result = query(
      'SELECT department_id, SUM(age) FROM users GROUP BY department_id'
    );
    const dept1 = result.find((r) => r.department_id === 1);
    expect(dept1!['SUM(age)']).toBe(65);
  });

  test('GROUP BY with MIN and MAX', () => {
    const result = query(
      'SELECT department_id, MIN(age), MAX(age) FROM users GROUP BY department_id'
    );
    const dept1 = result.find((r) => r.department_id === 1);
    expect(dept1!['MIN(age)']).toBe(30);
    expect(dept1!['MAX(age)']).toBe(35);
  });
});

describe('HAVING', () => {
  test('HAVING with aggregate condition', () => {
    const result = query(
      'SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30'
    );
    expect(result).toHaveLength(1);
    expect(result[0].department_id).toBe(1);
    expect(result[0]['AVG(age)']).toBe(32.5);
  });

  test('HAVING with COUNT', () => {
    const result = query(
      'SELECT department_id, COUNT(*) FROM users GROUP BY department_id HAVING COUNT(*) >= 2'
    );
    expect(result).toHaveLength(1);
    expect(result[0].department_id).toBe(1);
    expect(result[0]['COUNT(*)']).toBe(2);
  });
});

describe('Case insensitivity', () => {
  test('lowercase SQL keywords', () => {
    const result = query('select * from users where age > 30');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('鈴木一郎');
  });

  test('mixed case SQL keywords', () => {
    const result = query('Select name From users Where age >= 30');
    expect(result).toHaveLength(2);
  });
});

describe('Combined queries', () => {
  test('WHERE + ORDER BY + LIMIT', () => {
    const result = query(
      'SELECT * FROM users WHERE age >= 25 ORDER BY age DESC LIMIT 2'
    );
    expect(result).toHaveLength(2);
    expect(result[0].age).toBe(35);
    expect(result[1].age).toBe(30);
  });

  test('JOIN + WHERE + ORDER BY', () => {
    const result = query(
      'SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id WHERE u.age >= 30 ORDER BY u.age ASC'
    );
    expect(result).toHaveLength(2);
    expect(result[0]['u.name']).toBe('田中太郎');
    expect(result[1]['u.name']).toBe('鈴木一郎');
  });
});

describe('Formatter', () => {
  test('formatTable produces table output', () => {
    const result = query('SELECT name, age FROM users');
    const output = formatTable(result);
    expect(output).toContain('name');
    expect(output).toContain('age');
    expect(output).toContain('田中太郎');
    expect(output).toContain('|');
    expect(output).toContain('---');
  });

  test('formatTable with empty result', () => {
    const result = query('SELECT * FROM users WHERE age > 100');
    const output = formatTable(result);
    expect(output).toBe('(empty result)');
  });

  test('formatJson produces valid JSON', () => {
    const result = query('SELECT name, age FROM users');
    const output = formatJson(result);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ name: '田中太郎', age: 30 });
  });
});
