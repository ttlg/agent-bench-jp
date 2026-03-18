import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const env = { ...process.env };
delete env.NO_COLOR;
delete env.FORCE_COLOR;

const testDir = path.resolve('test');
const testFiles = readdirSync(testDir)
  .filter((file) => file.endsWith('.ts'))
  .sort()
  .map((file) => path.join(testDir, file));

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
