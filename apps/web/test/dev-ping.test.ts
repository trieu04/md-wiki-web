import { expect, it } from 'vitest';
import { pollInterval } from '../src/features/dev-ping/model';
import type { PingJob } from '../src/features/dev-ping/model';

it.each([
  ['queued', 250],
  ['running', 250],
  ['succeeded', false],
  ['failed', false],
] as const)('polls the dev ping according to its %s status', (status, interval) => {
  const job: PingJob = {
    id: 'test-job',
    status,
    input: { message: 'ping' },
    createdAt: '2026-11-23T00:00:00.000Z',
  };
  expect(pollInterval(job)).toBe(interval);
});

it('does not poll before a ping exists', () => {
  expect(pollInterval(undefined)).toBe(false);
});
