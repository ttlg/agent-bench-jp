import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("cli outputs json format", () => {
  const dir = mkdtempSync(join(tmpdir(), "jsql-"));
  try {
    const file = resolve(dir, "data.json");
    writeFileSync(
      file,
      JSON.stringify({
        users: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" }
        ]
      })
    );

    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", resolve(process.cwd(), "src/cli.ts"), "--data", file, "--query", "select name from users order by id desc limit 1", "--format", "json"],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), [{ name: "Bob" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
