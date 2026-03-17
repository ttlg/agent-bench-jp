import fs from 'fs';
import { Lexer } from '../src/lexer';
import { Parser } from '../src/parser';
import { Engine } from '../src/engine';

const data = JSON.parse(fs.readFileSync('./tests/data.json', 'utf-8'));

function runQuery(sql: string) {
  const lexer = new Lexer(sql);
  const parser = new Parser(lexer.tokenize());
  const engine = new Engine(data);
  return engine.execute(parser.parse());
}

describe('Engine', () => {
  describe('SELECT', () => {
    it('SELECT * FROM users', () => {
      const res = runQuery('SELECT * FROM users');
      expect(res.length).toBe(3);
      expect(res[0]).toEqual({ id: 1, name: '田中太郎', age: 30, department_id: 1 });
    });

    it('SELECT name, age FROM users', () => {
      const res = runQuery('SELECT name, age FROM users');
      expect(res.length).toBe(3);
      expect(res[0]).toEqual({ name: '田中太郎', age: 30 });
    });
  });

  describe('WHERE', () => {
    it('WHERE age > 30', () => {
      const res = runQuery('SELECT * FROM users WHERE age > 30');
      expect(res.length).toBe(1);
      expect(res[0].name).toBe('鈴木一郎');
    });

    it('WHERE name = \'佐藤花子\'', () => {
      const res = runQuery("SELECT * FROM users WHERE name = '佐藤花子'");
      expect(res.length).toBe(1);
      expect(res[0].name).toBe('佐藤花子');
    });

    it('WHERE age >= 25 AND department_id = 1', () => {
      const res = runQuery('SELECT * FROM users WHERE age >= 25 AND department_id = 1');
      expect(res.length).toBe(2);
      expect(res.map(r => r.name)).toEqual(['田中太郎', '鈴木一郎']);
    });

    it('WHERE age < 30 OR department_id = 2', () => {
      const res = runQuery('SELECT * FROM users WHERE age < 30 OR department_id = 2');
      expect(res.length).toBe(1);
      expect(res[0].name).toBe('佐藤花子');
    });

    it('WHERE NOT age = 30', () => {
      const res = runQuery('SELECT * FROM users WHERE NOT age = 30');
      expect(res.length).toBe(2);
      expect(res.map(r => r.name)).toEqual(['佐藤花子', '鈴木一郎']);
    });

    it('WHERE name LIKE \'%太郎\'', () => {
      const res = runQuery("SELECT * FROM users WHERE name LIKE '%太郎'");
      expect(res.length).toBe(1);
      expect(res[0].name).toBe('田中太郎');
    });
  });

  describe('ORDER BY', () => {
    it('ORDER BY age ASC', () => {
      const res = runQuery('SELECT * FROM users ORDER BY age ASC');
      expect(res.map(r => r.age)).toEqual([25, 30, 35]);
    });

    it('ORDER BY department_id DESC, age ASC', () => {
      const res = runQuery('SELECT * FROM users ORDER BY department_id DESC, age ASC');
      expect(res.map(r => r.name)).toEqual(['佐藤花子', '田中太郎', '鈴木一郎']);
    });
  });

  describe('LIMIT / OFFSET', () => {
    it('LIMIT 2', () => {
      const res = runQuery('SELECT * FROM users LIMIT 2');
      expect(res.length).toBe(2);
      expect(res[0].name).toBe('田中太郎');
      expect(res[1].name).toBe('佐藤花子');
    });

    it('LIMIT 2 OFFSET 1', () => {
      const res = runQuery('SELECT * FROM users LIMIT 2 OFFSET 1');
      expect(res.length).toBe(2);
      expect(res[0].name).toBe('佐藤花子');
      expect(res[1].name).toBe('鈴木一郎');
    });
  });

  describe('JOIN', () => {
    it('INNER JOIN', () => {
      const res = runQuery('SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id');
      expect(res.length).toBe(3);
      expect(res[0]).toEqual({ 'u.name': '田中太郎', 'd.name': '開発部' });
    });

    it('LEFT JOIN', () => {
      // Create a user without a department for testing
      const testData = {
        users: [...data.users, { id: 4, name: '名無し', age: 20, department_id: 99 }],
        departments: data.departments
      };
      
      const engine = new Engine(testData);
      const lexer = new Lexer('SELECT u.name, d.name FROM users u LEFT JOIN departments d ON u.department_id = d.id');
      const parser = new Parser(lexer.tokenize());
      const res = engine.execute(parser.parse());
      
      expect(res.length).toBe(4);
      expect(res[3]).toEqual({ 'u.name': '名無し', 'd.name': null });
    });
  });

  describe('GROUP BY and HAVING', () => {
    it('COUNT(*)', () => {
      const res = runQuery('SELECT COUNT(*) FROM users');
      expect(res.length).toBe(1);
      expect(res[0]['COUNT(*)']).toBe(3);
    });

    it('GROUP BY department_id', () => {
      const res = runQuery('SELECT department_id, COUNT(*) FROM users GROUP BY department_id');
      expect(res.length).toBe(2);
      const dev = res.find(r => r.department_id === 1);
      expect(dev['COUNT(*)']).toBe(2);
    });

    it('HAVING AVG(age) > 30', () => {
      const res = runQuery('SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30');
      expect(res.length).toBe(1);
      expect(res[0].department_id).toBe(1);
      expect(res[0]['AVG(age)']).toBe(32.5);
    });
  });
});
