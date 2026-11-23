import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPlaceholder } from '../src/index.js';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

describe('built API', () => {
  it('exports its package identifier', () => {
    expect(apiPlaceholder).toBe('md-wiki-api');
  });

  it('serves real health probes and isolates the guarded internal listener', async () => {
    const token = 'internal-test-token';
    const child = spawn(process.execPath, ['dist/main.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_PORT: '0',
        INTERNAL_PORT: '0',
        SERVICE_TOKEN: token,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const exited = once(child, 'exit');
    stop = async () => {
      child.kill('SIGTERM');
      await exited;
    };
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const urls = await vi.waitFor(
      () => {
        const line = output.split('\n').find((line) => line.includes('"msg":"API listening"'));
        if (!line) throw new Error(`Not listening (exit code ${String(child.exitCode)})`);
        return JSON.parse(line) as { publicUrl: string; internalUrl: string };
      },
      { timeout: 10000 },
    );

    const health = await fetch(`${urls.publicUrl}/api/v1/health`);
    expect(health.status).toBe(200);
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(await health.json()).toEqual({
      status: 'ok',
      db: 'ok',
      redis: 'ok',
      storage: 'ok',
      version,
    });

    for (const auth of ['', `Basic ${token}`, 'Bearer incorrect']) {
      const response = await fetch(`${urls.internalUrl}/internal/v1/test`, {
        headers: { Authorization: auth },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: 'UNAUTHENTICATED',
        requestId: response.headers.get('x-request-id'),
      });
    }
    const authorized = await fetch(`${urls.internalUrl}/internal/v1/test`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ ok: true });
    // No job routes yet, and the public health controller must not be mounted here.
    for (const path of ['/internal/v1/jobs', '/api/v1/health', '/internal/v1/health']) {
      expect(
        (await fetch(urls.internalUrl + path, { headers: { Authorization: `Bearer ${token}` } }))
          .status,
      ).toBe(404);
    }
    const requestId = 'caller-supplied-id';
    const missing = await fetch(`${urls.publicUrl}/internal/v1/test`, {
      headers: { 'X-Request-Id': requestId },
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/problem+json');
    expect(missing.headers.get('x-request-id')).toBe(requestId);
    expect(await missing.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      requestId,
    });
    await vi.waitFor(() => {
      expect(output).toContain(`"requestId":"${requestId}"`);
    });
  }, 15000);
});
