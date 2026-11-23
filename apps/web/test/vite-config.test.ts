// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { createServer, resolveConfig } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';

const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));

afterEach(() => vi.unstubAllEnvs());

it.each([
  ['5199', 5199, '0.0.0.0', '0.0.0.0'],
  [undefined, 5173, undefined, '127.0.0.1'],
])('uses WEB_PORT=%s and WEB_HOST=%s with strictPort', async (portEnv, port, hostEnv, host) => {
  vi.stubEnv('WEB_PORT', portEnv);
  vi.stubEnv('WEB_HOST', hostEnv);
  const config = await resolveConfig({ configFile }, 'serve');
  expect(config.server.port).toBe(port);
  expect(config.server.host).toBe(host);
  expect(config.server.strictPort).toBe(true);
});

it('accepts connections on IPv4 localhost by default', async () => {
  vi.stubEnv('WEB_HOST', undefined);
  vi.stubEnv('WEB_PORT', '0');
  const server = await createServer({ configFile });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    expect(address.address).toBe('127.0.0.1');
    expect((await fetch(`http://127.0.0.1:${String(address.port)}/`)).ok).toBe(true);
  } finally {
    await server.close();
  }
});
