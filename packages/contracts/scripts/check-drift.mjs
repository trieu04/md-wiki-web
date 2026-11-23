import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dto = new URL('../../../apps/api/src/health/health.dto.ts', import.meta.url);
const original = readFileSync(dto, 'utf8');
const edited = original.replace('type: String', "type: String, description: 'DTO drift fixture'");
assert.notEqual(edited, original, 'HealthDto drift fixture needs updating');

function check() {
  const result = spawnSync('pnpm', ['contracts:check'], { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

const clean = check();
assert.equal(clean.status, 0, clean.stderr);
try {
  writeFileSync(dto, edited);
  const drift = check();
  assert.equal(drift.status, 1, drift.stdout + drift.stderr);
  assert.match(
    drift.stderr,
    /Generated contracts are out of date:\s+packages\/contracts\/openapi\.json/,
  );
} finally {
  writeFileSync(dto, original);
}
console.log('DTO drift detected without regenerating checked-in contracts.');
