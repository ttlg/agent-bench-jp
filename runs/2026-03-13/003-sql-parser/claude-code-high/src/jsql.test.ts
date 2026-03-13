import { tokenize } from './tokenizer';
import { Parser } from './parser';
import { execute, DataSet, Row } from './executor';
import { formatTable, formatJSON } from './formatter';

const testData: DataSet = {
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

function run(sql: string): Row[] {
  const tokens = tokenize(sql);
  const parser = new Parser(tokens);
  const stmt = parser.parse();
  return execute(stmt, testData);
}

describe('SELECT', () => {
  test('SELECT * FROM users', () => {
    const result = run('SELECT * FROM users');
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty('name', '田中太郎');
    expect(result[0]).toHaveProperty('age', 30);
  });

  test('SELECT specific columns', () => {
    const result = run('SELECT name, age FROM users');
    expect(result).toHaveLength(3);
    expect(Object.keys(result[0])).toEqual(['name', 'age']);
    expect(result[0].name).toBe('田中太郎');
  });

  test('Case insensitivity', () => {
    const result = run('select * from users');
    expect(result).toHaveLength(3);
  });
});

describe('WHERE', () => {
  test('WHERE with >', () => {
    const result = run('SELECT * FROM users WHERE age > 30');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('鈴木一郎');
  });

  test('WHERE with = string', () => {
    const result = run("SELECT * FROM users WHERE name = '佐藤花子'");
    expect(result).toHaveLength(1);
    expect(result[0].age).toBe(25);
  });

  test('WHERE with AND', () => {
    const result = run('SELECT * FROM users WHERE age >= 25 AND department_id = 1');
    expect(result).toHaveLength(2);
  });

  test('WHERE with OR', () => {
    const result = run('SELECT * FROM users WHERE age < 30 OR department_id = 2');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('WHERE with NOT', () => {
    const result = run('SELECT * FROM users WHERE NOT age = 30');
    expect(result).toHaveLength(2);
  });

  test('WHERE with comparison operators', () => {
    expect(run('SELECT * FROM users WHERE age < 30')).toHaveLength(1);
    expect(run('SELECT * FROM users WHERE age <= 30')).toHaveLength(2);
    expect(run('SELECT * FROM users WHERE age > 30')).toHaveLength(1);
    expect(run('SELECT * FROM users WHERE age >= 30')).toHaveLength(2);
    expect(run('SELECT * FROM users WHERE age != 30')).toHaveLength(2);
  });

  test('WHERE with parentheses', () => {
    const result = run('SELECT * FROM users WHERE (age < 30 OR age > 30) AND department_id = 1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('鈴木一郎');
  });
});

describe('LIKE', () => {
  test('LIKE with % at end', () => {
    const result = run("SELECT * FROM users WHERE name LIKE '田中%'");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('田中太郎');
  });

  test('LIKE with % at start', () => {
    const result = run("SELECT * FROM users WHERE name LIKE '%太郎'");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('田中太郎');
  });

  test('LIKE with % on both sides', () => {
    const result = run("SELECT * FROM users WHERE name LIKE '%花%'");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });
});

describe('ORDER BY', () => {
  test('ORDER BY ASC', () => {
    const result = run('SELECT * FROM users ORDER BY age ASC');
    expect(result[0].age).toBe(25);
    expect(result[1].age).toBe(30);
    expect(result[2].age).toBe(35);
  });

  test('ORDER BY DESC', () => {
    const result = run('SELECT * FROM users ORDER BY age DESC');
    expect(result[0].age).toBe(35);
    expect(result[1].age).toBe(30);
    expect(result[2].age).toBe(25);
  });

  test('ORDER BY default is ASC', () => {
    const result = run('SELECT * FROM users ORDER BY age');
    expect(result[0].age).toBe(25);
    expect(result[2].age).toBe(35);
  });

  test('ORDER BY multiple columns', () => {
    const result = run('SELECT * FROM users ORDER BY department_id ASC, age DESC');
    expect(result[0].name).toBe('鈴木一郎'); // dept 1, age 35
    expect(result[1].name).toBe('田中太郎'); // dept 1, age 30
    expect(result[2].name).toBe('佐藤花子'); // dept 2, age 25
  });
});

describe('LIMIT / OFFSET', () => {
  test('LIMIT', () => {
    const result = run('SELECT * FROM users LIMIT 2');
    expect(result).toHaveLength(2);
  });

  test('LIMIT with OFFSET', () => {
    const result = run('SELECT * FROM users LIMIT 1 OFFSET 1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('佐藤花子');
  });

  test('LIMIT 10 returns all when fewer rows', () => {
    const result = run('SELECT * FROM users LIMIT 10');
    expect(result).toHaveLength(3);
  });
});

describe('JOIN', () => {
  test('INNER JOIN', () => {
    const result = run(
      'SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id'
    );
    expect(result).toHaveLength(3);
    expect(result[0]['u.name']).toBe('田中太郎');
    expect(result[0]['d.name']).toBe('開発部');
  });

  test('JOIN (without INNER keyword)', () => {
    const result = run(
      'SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id'
    );
    expect(result).toHaveLength(3);
  });

  test('LEFT JOIN', () => {
    const result = run(
      'SELECT d.name, u.name FROM departments d LEFT JOIN users u ON d.id = u.department_id'
    );
    // departments has 3 rows; 開発部 has 2 users, 営業部 has 1, 人事部 has 0
    expect(result).toHaveLength(4);
    const jinjiRow = result.find((r: Row) => r['d.name'] === '人事部');
    expect(jinjiRow).toBeDefined();
    expect(jinjiRow!['u.name']).toBeNull();
  });
});

describe('Aggregate functions', () => {
  test('COUNT(*)', () => {
    const result = run('SELECT COUNT(*) FROM users');
    expect(result).toHaveLength(1);
    expect(result[0]['COUNT(*)']).toBe(3);
  });

  test('SUM', () => {
    const result = run('SELECT SUM(age) FROM users');
    expect(result[0]['SUM(age)']).toBe(90);
  });

  test('AVG', () => {
    const result = run('SELECT AVG(age) FROM users');
    expect(result[0]['AVG(age)']).toBe(30);
  });

  test('MIN', () => {
    const result = run('SELECT MIN(age) FROM users');
    expect(result[0]['MIN(age)']).toBe(25);
  });

  test('MAX', () => {
    const result = run('SELECT MAX(age) FROM users');
    expect(result[0]['MAX(age)']).toBe(35);
  });
});

describe('GROUP BY', () => {
  test('GROUP BY with COUNT', () => {
    const result = run('SELECT department_id, COUNT(*) FROM users GROUP BY department_id');
    expect(result).toHaveLength(2);
    const dept1 = result.find((r: Row) => r.department_id === 1);
    const dept2 = result.find((r: Row) => r.department_id === 2);
    expect(dept1!['COUNT(*)']).toBe(2);
    expect(dept2!['COUNT(*)']).toBe(1);
  });

  test('GROUP BY with AVG', () => {
    const result = run('SELECT department_id, AVG(age) FROM users GROUP BY department_id');
    const dept1 = result.find((r: Row) => r.department_id === 1);
    expect(dept1!['AVG(age)']).toBe(32.5);
  });
});

describe('HAVING', () => {
  test('HAVING with aggregate condition', () => {
    const result = run(
      'SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30'
    );
    expect(result).toHaveLength(1);
    expect(result[0].department_id).toBe(1);
  });

  test('HAVING with COUNT', () => {
    const result = run(
      'SELECT department_id, COUNT(*) FROM users GROUP BY department_id HAVING COUNT(*) > 1'
    );
    expect(result).toHaveLength(1);
    expect(result[0].department_id).toBe(1);
    expect(result[0]['COUNT(*)']).toBe(2);
  });
});

describe('Combined queries', () => {
  test('WHERE + ORDER BY + LIMIT', () => {
    const result = run('SELECT * FROM users WHERE age >= 25 ORDER BY age DESC LIMIT 2');
    expect(result).toHaveLength(2);
    expect(result[0].age).toBe(35);
    expect(result[1].age).toBe(30);
  });
});

describe('Formatter', () => {
  test('formatTable outputs correct table', () => {
    const rows = [
      { name: '田中太郎', age: 30 },
      { name: '佐藤花子', age: 25 },
    ];
    const output = formatTable(rows);
    expect(output).toContain('| name');
    expect(output).toContain('| age');
    expect(output).toContain('田中太郎');
    expect(output).toContain('30');
  });

  test('formatJSON outputs valid JSON', () => {
    const rows = [{ name: '田中太郎', age: 30 }];
    const output = formatJSON(rows);
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(rows);
  });

  test('empty result', () => {
    const output = formatTable([]);
    expect(output).toBe('(empty result)');
  });
});
