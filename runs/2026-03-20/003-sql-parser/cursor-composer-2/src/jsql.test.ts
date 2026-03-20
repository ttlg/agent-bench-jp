import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonDatabase } from "./execute.js";
import { runSql } from "./run.js";
import { formatTable } from "./format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "../test/fixtures/sample.json");

async function loadDb(): Promise<JsonDatabase> {
  const raw = await readFile(fixturePath, "utf8");
  return JSON.parse(raw) as JsonDatabase;
}

describe("jsql", () => {
  it("SELECT * FROM users", async () => {
    const db = await loadDb();
    const rows = runSql(db, "SELECT * FROM users");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: 1, name: "田中太郎", age: 30 });
  });

  it("SELECT name, age FROM users", async () => {
    const db = await loadDb();
    const rows = runSql(db, "SELECT name, age FROM users");
    expect(rows).toEqual([
      { name: "田中太郎", age: 30 },
      { name: "佐藤花子", age: 25 },
      { name: "鈴木一郎", age: 35 },
    ]);
  });

  it("SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id", async () => {
    const db = await loadDb();
    const rows = runSql(
      db,
      "SELECT u.name, d.name FROM users u JOIN departments d ON u.department_id = d.id",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ "u.name": "田中太郎", "d.name": "開発部" });
  });

  it("WHERE comparison and string", async () => {
    const db = await loadDb();
    expect(runSql(db, "SELECT name FROM users WHERE age > 30")).toEqual([
      { name: "鈴木一郎" },
    ]);
    expect(runSql(db, "SELECT name FROM users WHERE name = '佐藤花子'")).toEqual([
      { name: "佐藤花子" },
    ]);
  });

  it("WHERE AND / OR / NOT", async () => {
    const db = await loadDb();
    expect(
      runSql(db, "SELECT id FROM users WHERE age >= 25 AND department_id = 1"),
    ).toEqual([{ id: 1 }, { id: 3 }]);
    expect(
      runSql(db, "SELECT id FROM users WHERE age < 30 OR department_id = 2"),
    ).toEqual([{ id: 2 }]);
    expect(runSql(db, "SELECT name FROM users WHERE NOT age = 30")).toEqual([
      { name: "佐藤花子" },
      { name: "鈴木一郎" },
    ]);
  });

  it("WHERE parentheses", async () => {
    const db = await loadDb();
    const rows = runSql(
      db,
      "SELECT id FROM users WHERE (age < 30 OR department_id = 2) AND id = 2",
    );
    expect(rows).toEqual([{ id: 2 }]);
  });

  it("WHERE LIKE", async () => {
    const db = await loadDb();
    const rows = runSql(db, "SELECT name FROM users WHERE name LIKE '%太郎'");
    expect(rows).toEqual([{ name: "田中太郎" }]);
  });

  it("ORDER BY", async () => {
    const db = await loadDb();
    const rows = runSql(db, "SELECT name, age FROM users ORDER BY age ASC");
    expect(rows.map((r) => r.age)).toEqual([25, 30, 35]);
    const rows2 = runSql(
      db,
      "SELECT name, age FROM users ORDER BY age DESC, name ASC",
    );
    expect(rows2[0]!.age).toBe(35);
  });

  it("LIMIT and OFFSET", async () => {
    const db = await loadDb();
    const rows = runSql(db, "SELECT id FROM users ORDER BY id ASC LIMIT 2");
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    const rows2 = runSql(
      db,
      "SELECT id FROM users ORDER BY id ASC LIMIT 2 OFFSET 1",
    );
    expect(rows2).toEqual([{ id: 2 }, { id: 3 }]);
  });

  it("INNER JOIN and LEFT JOIN", async () => {
    const db = await loadDb();
    const inner = runSql(
      db,
      "SELECT u.name, d.name FROM users u INNER JOIN departments d ON u.department_id = d.id",
    );
    expect(inner).toHaveLength(3);
    const left = runSql(
      db,
      "SELECT u.name, d.name FROM users u LEFT JOIN departments d ON u.department_id = d.id",
    );
    expect(left).toHaveLength(3);
  });

  it("GROUP BY and aggregates", async () => {
    const db = await loadDb();
    const cnt = runSql(db, "SELECT COUNT(*) FROM users");
    expect(cnt).toEqual([{ "COUNT(*)": 3 }]);
    const grp = runSql(
      db,
      "SELECT department_id, COUNT(*) FROM users GROUP BY department_id",
    );
    expect(grp).toHaveLength(2);
    const byDept = Object.fromEntries(
      grp.map((r) => [String(r.department_id), r["COUNT(*)"]]),
    );
    expect(byDept["1"]).toBe(2);
    expect(byDept["2"]).toBe(1);
    const avg = runSql(
      db,
      "SELECT department_id, AVG(age) FROM users GROUP BY department_id",
    );
    expect(avg.find((r) => r.department_id === 1)?.["AVG(age)"]).toBe(32.5);
  });

  it("HAVING", async () => {
    const db = await loadDb();
    const rows = runSql(
      db,
      "SELECT department_id, AVG(age) FROM users GROUP BY department_id HAVING AVG(age) > 30",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.department_id).toBe(1);
  });

  it("case-insensitive keywords", async () => {
    const db = await loadDb();
    const rows = runSql(db, "select name from users where id = 1");
    expect(rows).toEqual([{ name: "田中太郎" }]);
  });

  it("formatTable produces markdown-style table", async () => {
    const db = await loadDb();
    const rows = runSql(db, "SELECT name, age FROM users ORDER BY age ASC LIMIT 2");
    const t = formatTable(rows);
    expect(t).toContain("| name");
    expect(t).toContain("| age");
    expect(t).toContain("---");
    expect(t).toContain("佐藤花子");
  });
});
