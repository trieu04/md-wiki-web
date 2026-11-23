import 'reflect-metadata';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AppModule, InternalModule } from '../src/app.module.js';
import { loadConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PingQueue } from '../src/jobs/ping-queue.js';
import { readPingOutput } from '../src/jobs/job-contracts.js';

const config = loadConfig();
const workerDir = fileURLToPath(new URL('../../../services/worker/', import.meta.url));
let app: INestApplication | undefined;
let internal: INestApplication | undefined;
let prisma: PrismaService;
let publicOrigin: string;
let publicUrl: string;
let internalUrl: string;
const ids: string[] = [];
const enqueued: string[] = [];
const auth = { Authorization: `Bearer ${config.SERVICE_TOKEN}` };

beforeAll(async () => {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: config.DATABASE_URL },
    stdio: 'inherit',
  });
  app = await NestFactory.create(AppModule);
  internal = await NestFactory.create(InternalModule);
  configureHttp(app, { public: true });
  configureHttp(internal, { serviceToken: config.SERVICE_TOKEN });
  await Promise.all([app.listen(0, '127.0.0.1'), internal.listen(0, '127.0.0.1')]);
  publicOrigin = await app.getUrl();
  publicUrl = `${publicOrigin}/api/v1/dev/ping`;
  internalUrl = `${await internal.getUrl()}/internal/v1`;
  prisma = app.get(PrismaService);
}, 20_000);

afterAll(async () => {
  try {
    if (ids.length) await prisma.aiJob.deleteMany({ where: { id: { in: ids } } });
    if (enqueued.length) {
      const redis = new Redis(config.REDIS_URL);
      const queue = new Queue('mw-jobs', { connection: redis });
      try {
        for (const id of enqueued) await queue.remove(id);
      } finally {
        await queue.close();
        redis.disconnect();
      }
    }
  } finally {
    await Promise.all([app?.close(), internal?.close()]);
  }
});

const post = (url: string, body: unknown, headers?: Record<string, string>) =>
  fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  });

async function expectProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(await response.json()).toMatchObject({ code, status });
}

it('round-trips a ping through Postgres, BullMQ and the Python worker in under 10 s', async () => {
  const worker = spawn('uv', ['run', '--locked', 'python', '-m', 'mdwiki_worker'], {
    cwd: workerDir,
    env: {
      ...process.env,
      REDIS_URL: config.REDIS_URL,
      SERVICE_TOKEN: config.SERVICE_TOKEN,
      INTERNAL_API_URL: internalUrl,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const ended = once(worker, 'exit');
  let output = '';
  worker.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const redis = new Redis(config.REDIS_URL);
  const queue = new Queue('mw-jobs', { connection: redis });
  try {
    await vi.waitFor(
      () => {
        expect(output).toContain('Starting mdwiki worker');
      },
      { timeout: 12_000 },
    );
    const start = performance.now();
    const message = '  ping 🔔\n';
    const created = await post(publicUrl, { message });
    expect(created.status).toBe(201);
    const { id, status } = (await created.json()) as { id: string; status: string };
    ids.push(id);
    enqueued.push(id);
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(status).toBe('queued');
    const job = await queue.getJob(id);
    expect(job?.name).toBe('ping');
    expect(job?.id).toBe(id);
    expect(job?.data).toEqual({ v: 1, jobId: id, kind: 'ping' });
    expect(job?.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
    const observed = await vi.waitFor(
      async () => {
        const response = await fetch(`${publicUrl}/${id}`);
        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        expect(body, output).toMatchObject({ status: 'succeeded' });
        return body;
      },
      { timeout: 9_000, interval: 50 },
    );
    expect(performance.now() - start).toBeLessThan(10_000);
    const row = await prisma.aiJob.findUniqueOrThrow({ where: { id } });
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(readPingOutput(row.output).echo).toBe(message);
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(observed).toEqual({
      id,
      status: 'succeeded',
      input: { message },
      output: row.output,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString(),
    });
    await vi.waitFor(async () => {
      expect(await job?.getState()).toBe('completed');
    });
    await app?.get(PingQueue).enqueue({ v: 1, jobId: id, kind: 'ping' });
    expect(await (await queue.getJob(id))?.getState()).toBe('completed');
  } finally {
    worker.kill('SIGTERM');
    await Promise.all([ended, queue.close()]);
    redis.disconnect();
  }
}, 25_000);

it('validates ping input and isolates the token-guarded internal routes', async () => {
  for (const body of [
    { message: '' },
    { message: 'a'.repeat(201) },
    { message: 1 },
    { message: 'ok', unexpected: true },
  ]) {
    await expectProblem(await post(publicUrl, body), 400, 'VALIDATION_FAILED');
  }
  const missing = '019ac174-1da5-738a-a8c2-2f50343a60a3';
  const path = `/jobs/${missing}/input`;
  await expectProblem(await fetch(internalUrl + path), 401, 'UNAUTHENTICATED');
  await expectProblem(await fetch(internalUrl + path, { headers: auth }), 404, 'NOT_FOUND');
  await expectProblem(
    await post(`${internalUrl}/jobs/${missing}/result`, { status: 'ok' }, auth),
    404,
    'NOT_FOUND',
  );
  await expectProblem(
    await fetch(`${publicOrigin}/internal/v1${path}`, { headers: auth }),
    404,
    'NOT_FOUND',
  );
  await expectProblem(await fetch(`${publicUrl}/bad-id`), 404, 'NOT_FOUND');
});

it('transitions a ping once, validates results, and handles concurrent replays', async () => {
  const message = '🔔'.repeat(200);
  const row = await prisma.aiJob.create({ data: { kind: 'ping', input: { message } } });
  ids.push(row.id);
  const base = `${internalUrl}/jobs/${row.id}`;
  const input = { jobId: row.id, kind: 'ping', input: { message } };
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/input`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(input);
    const current = await prisma.aiJob.findUniqueOrThrow({ where: { id: row.id } });
    expect(current.status).toBe('running');
    if (i === 0) row.startedAt = current.startedAt;
    expect(current.startedAt).toBeInstanceOf(Date);
    expect(current.startedAt).toEqual(row.startedAt);
  }
  const ok = (echo: string, workerVersion = 'test') => ({
    status: 'ok',
    output: { echo, workerVersion },
  });
  for (const bad of [
    ok('wrong echo'),
    ok(message, ''),
    ok(message, 'x'.repeat(41)),
    { status: 'ok', output: { echo: message } },
  ]) {
    await expectProblem(await post(`${base}/result`, bad, auth), 400, 'VALIDATION_FAILED');
  }
  expect(await prisma.aiJob.findUnique({ where: { id: row.id } })).toMatchObject({
    status: 'running',
    output: null,
    finishedAt: null,
  });
  const result = ok(message);
  const responses = await Promise.all([
    post(`${base}/result`, result, auth),
    post(`${base}/result`, result, auth),
    post(`${base}/result`, ok(message, 'competing'), auth),
  ]);
  const winner = await prisma.aiJob.findUniqueOrThrow({ where: { id: row.id } });
  const identicalWon = (winner.output as { workerVersion: string }).workerVersion === 'test';
  expect(responses.map((r) => r.status)).toEqual(identicalWon ? [204, 204, 409] : [409, 409, 204]);
  await expectProblem(await fetch(`${base}/input`, { headers: auth }), 409, 'PRECONDITION_FAILED');
  await expectProblem(
    await post(`${base}/result`, { status: 'failed' }, auth),
    409,
    'PRECONDITION_FAILED',
  );
  expect((await post(`${base}/result`, { output: winner.output, status: 'ok' }, auth)).status).toBe(
    204,
  );
  expect(await prisma.aiJob.findUnique({ where: { id: row.id } })).toEqual(winner);
});

it('stores failed ping results without output and supports idempotent failure replay', async () => {
  const row = await prisma.aiJob.create({ data: { kind: 'ping', input: { message: 'ping' } } });
  ids.push(row.id);
  const url = `${internalUrl}/jobs/${row.id}/result`;
  for (const [code, message] of [
    ['BAD', 'error'],
    ['x'.repeat(65), 'error'],
    ['broken', ''],
    ['broken', 'x'.repeat(501)],
  ]) {
    await expectProblem(
      await post(url, { status: 'failed', error: { code, message } }, auth),
      400,
      'VALIDATION_FAILED',
    );
  }
  const error = { code: 'ping_failed', message: 'Example failure' };
  expect((await post(url, { status: 'failed', error }, auth)).status).toBe(204);
  expect((await post(url, { error, status: 'failed' }, auth)).status).toBe(204);
  await expectProblem(
    await post(url, { status: 'failed', error: { ...error, message: 'changed' } }, auth),
    409,
    'PRECONDITION_FAILED',
  );
  const response = await fetch(`${publicUrl}/${row.id}`);
  expect(response.status).toBe(200);
  const finished = await prisma.aiJob.findUniqueOrThrow({ where: { id: row.id } });
  expect(finished.finishedAt).toBeInstanceOf(Date);
  expect(await response.json()).toEqual({
    id: row.id,
    status: 'failed',
    input: { message: 'ping' },
    error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: finished.finishedAt?.toISOString(),
  });
});
