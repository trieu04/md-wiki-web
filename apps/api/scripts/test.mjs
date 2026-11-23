import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
// pnpm forwards the leading `--`, but Vitest expects its file filters before it.
if (args[0] === '--') args.shift();

const cli = fileURLToPath(import.meta.resolve('vitest/vitest.mjs'));
const result = spawnSync(process.execPath, [cli, 'run', ...args], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
