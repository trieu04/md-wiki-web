import 'reflect-metadata';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import { HealthService } from '../src/health/health.service.js';
import { loadConfig } from '../src/config/env.js';
import { IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AppError } from '../src/common/app-error.js';
import { configureHttp } from '../src/config/http.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

class Item {
  @IsString() name!: string;
}
class Input {
  @ValidateNested() @Type(() => Item) item!: Item;
}
@Controller('test')
class TestController {
  @Get('conflict') conflict(): never {
    throw new AppError('SELF_REVIEW', 'Cannot review your own work');
  }
  @Get('unexpected') unknown(): never {
    throw new Error('SECRET');
  }
  @Post() input(@Body() input: Input): Input {
    return input;
  }
}
@Module({ imports: [AppModule], controllers: [TestController] })
class TestModule {}

let app: INestApplication;
let url: string;
beforeAll(async () => {
  app = await NestFactory.create(TestModule);
  configureHttp(app, { public: true });
  await app.listen(0, '127.0.0.1');
  url = `${await app.getUrl()}/api/v1`;
});
afterAll(async () => {
  await app.close();
});

it('isolates a failing DB probe from the other checks', async () => {
  const ping = vi
    .spyOn(PrismaService.prototype, 'ping')
    .mockRejectedValueOnce(new Error('DB unreachable'));
  try {
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      db: 'down',
      redis: 'ok',
      storage: 'ok',
    });
  } finally {
    ping.mockRestore();
  }
});

it('reports inaccessible Redis and a non-directory storage root as down', async () => {
  const connect = vi.spyOn(Redis.prototype, 'connect').mockRejectedValueOnce(new Error('offline'));
  try {
    const health = new HealthService(
      { ...loadConfig(), WIKI_ROOT: import.meta.filename },
      app.get(PrismaService),
    );
    expect(await health.report()).toMatchObject({ db: 'ok', redis: 'down', storage: 'down' });
  } finally {
    connect.mockRestore();
  }
});

it('maps a domain conflict and generates a correlated request id', async () => {
  const response = await fetch(`${url}/test/conflict`);
  const requestId = response.headers.get('x-request-id');
  expect(requestId).toBeTruthy();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    status: 409,
    code: 'SELF_REVIEW',
    detail: 'Cannot review your own work',
    requestId,
  });
});

it('never leaks the message or stack of an unexpected exception', async () => {
  const response = await fetch(`${url}/test/unexpected`);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    code: 'INTERNAL',
    requestId: response.headers.get('x-request-id'),
  });
});

it.each([
  // Public JSON limit is 5 MiB (system-logic §7.2.6).
  {
    body: JSON.stringify({ a: 'a'.repeat(5 * 1024 * 1024) }),
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
  },
  { body: '{"item":', status: 400, code: 'VALIDATION_FAILED' },
])('reports $code for a rejected JSON body', async ({ body, status, code }) => {
  const response = await fetch(`${url}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(await response.json()).toMatchObject({
    status,
    code,
    requestId: response.headers.get('x-request-id'),
  });
});

it('rejects unknown properties and invalid nested DTO values with field errors', async () => {
  const post = (data: unknown) =>
    fetch(`${url}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  const response = await post({ extra: true, item: { name: 123 } });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    code: 'VALIDATION_FAILED',
    fields: [
      { path: 'extra', code: 'whitelistValidation', message: 'property extra should not exist' },
      { path: 'item.name', code: 'isString', message: 'name must be a string' },
    ],
  });
  expect((await post({ item: { name: 'valid' } })).status).toBe(201);
});

it('sends security headers, hides the framework and never caches by default (D-251)', async () => {
  const response = await fetch(`${url}/health`);
  expect(response.headers.get('x-powered-by')).toBeNull();
  expect(
    Object.fromEntries(
      [
        'x-content-type-options',
        'x-frame-options',
        'referrer-policy',
        'cross-origin-resource-policy',
        'content-security-policy',
        'cache-control',
      ].map((name) => [name, response.headers.get(name)]),
    ),
  ).toEqual({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'cache-control': 'no-store',
  });
  // Errors carry them too.
  expect((await fetch(`${url}/test/conflict`)).headers.get('x-content-type-options')).toBe(
    'nosniff',
  );
});

it('keeps a plain caller request id and replaces anything else', async () => {
  const id = (value: string) =>
    fetch(`${url}/health`, { headers: { 'X-Request-Id': value } }).then((r) =>
      r.headers.get('x-request-id'),
    );
  expect(await id('trace-01.a:b_c')).toBe('trace-01.a:b_c');
  for (const bad of ['has space', 'a'.repeat(129), '{"level":60}'])
    expect(await id(bad)).toMatch(/^[0-9a-f-]{36}$/);
});
