import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { AiJob } from '@prisma/client';
import { afterEach, expect, it, vi } from 'vitest';
import { parseConfig } from '../src/config/env.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const config = parseConfig(
  parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')),
);
const prisma = new PrismaService(config);
const jobs = new JobsService(prisma);
const queued: AiJob = {
  id: '019ac174-1da5-738a-a8c2-2f50343a60a3',
  kind: 'ping',
  status: 'queued',
  input: { message: 'ping' },
  output: null,
  error: null,
  appliedAt: null,
  createdAt: new Date(),
  startedAt: null,
  finishedAt: null,
  trigger: 'dev',
  proposalId: null,
  draftId: null,
  requestedById: null,
  bundleHash: null,
  rulesSha256: null,
  provider: null,
  model: null,
  promptVersion: null,
  tokensIn: null,
  tokensOut: null,
  dropped: null,
};
const running: AiJob = { ...queued, status: 'running', startedAt: new Date() };
const ok = { status: 'ok', output: { echo: 'ping', workerVersion: 'test' } };
const succeeded: AiJob = {
  ...running,
  status: 'succeeded',
  output: ok.output,
  finishedAt: new Date(),
};

afterEach(() => vi.restoreAllMocks());

it('validates a ping before writing it and stores the message unmodified', async () => {
  const create = vi.spyOn(prisma.aiJob, 'create').mockResolvedValue(queued);
  for (const body of [
    { message: '' },
    { message: '😀'.repeat(201) },
    { message: 'ping', extra: true },
  ]) {
    await expect(jobs.createPing(body)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  }
  expect(create).not.toHaveBeenCalled();
  const input = { message: ` ${'😀'.repeat(199)}` };
  await jobs.createPing(input);
  expect(create).toHaveBeenCalledWith({ data: { kind: 'ping', input } });
});

it('sets startedAt once and refuses input after a racing completion', async () => {
  const find = vi
    .spyOn(prisma.aiJob, 'findUnique')
    .mockResolvedValueOnce(queued)
    .mockResolvedValueOnce(running);
  const update = vi.spyOn(prisma.aiJob, 'updateMany').mockResolvedValueOnce({ count: 1 });
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await jobs.input(queued.id)).toEqual({
      jobId: queued.id,
      kind: 'ping',
      input: queued.input,
    });
  }
  expect(update).toHaveBeenCalledTimes(1);
  const call = update.mock.calls[0]?.[0];
  expect(call?.where).toEqual({ id: queued.id, status: 'queued' });
  expect(call?.data.status).toBe('running');
  expect(call?.data.startedAt).toBeInstanceOf(Date);

  find.mockResolvedValueOnce(queued).mockResolvedValueOnce(succeeded);
  update.mockResolvedValueOnce({ count: 0 });
  await expect(jobs.input(queued.id)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
});

it('rejects invalid output without writing, persists a valid result, and compares replays', async () => {
  const find = vi.spyOn(prisma.aiJob, 'findUnique').mockResolvedValue(running);
  const update = vi.spyOn(prisma.aiJob, 'updateMany').mockResolvedValue({ count: 1 });
  await expect(
    jobs.result(queued.id, { status: 'ok', output: { ...ok.output, echo: 'not ping' } }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    jobs.result(queued.id, { status: 'failed', error: { code: 'INVALID', message: 'bad' } }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(update).not.toHaveBeenCalled();
  await jobs.result(queued.id, ok);
  const call = update.mock.calls[0]?.[0];
  expect(call?.data.status).toBe('succeeded');
  expect(call?.data.output).toEqual(ok.output);
  expect(call?.data.finishedAt).toBeInstanceOf(Date);

  find.mockResolvedValue(succeeded);
  await expect(
    jobs.result(queued.id, { output: { ...ok.output }, status: 'ok' }),
  ).resolves.toBeUndefined();
  await expect(
    jobs.result(queued.id, { ...ok, output: { ...ok.output, workerVersion: 'new' } }),
  ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  expect(update).toHaveBeenCalledTimes(1);
});
