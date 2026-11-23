import { expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';

it('includes credentials and reads the latest CSRF token only for non-GET requests', async () => {
  let token: string | null = null;
  const getCsrfToken = vi.fn(() => token);
  const fetch = vi.fn((_request: Request) => Promise.resolve(Response.json({})));
  vi.stubGlobal('fetch', fetch);
  try {
    const client = createApiClient({ baseUrl: 'http://localhost:3000', getCsrfToken });
    await client.POST('/api/v1/dev/ping', { body: { message: 'one' } });
    token = 'session-csrf';
    await client.POST('/api/v1/dev/ping', { body: { message: 'two' } });
    await client.GET('/api/v1/health');
    const [first, second, get] = fetch.mock.calls.map(([request]) => request);
    expect(first?.headers.get('x-csrf-token')).toBeNull();
    expect(second?.headers.get('x-csrf-token')).toBe('session-csrf');
    expect(second?.credentials).toBe('include');
    expect(second?.url).toBe('http://localhost:3000/api/v1/dev/ping');
    expect(get?.headers.get('x-csrf-token')).toBeNull();
    expect(getCsrfToken).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
