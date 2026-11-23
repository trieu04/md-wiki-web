// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';

const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));

afterEach(() => vi.unstubAllEnvs());

it.each([
  ['5199', 5199],
  [undefined, 5173],
])('serves on WEB_PORT=%s without falling back to another port', async (value, port) => {
  vi.stubEnv('WEB_PORT', value);
  const config = await resolveConfig({ configFile }, 'serve');
  expect(config.server.port).toBe(port);
  expect(config.server.strictPort).toBe(true);
});
