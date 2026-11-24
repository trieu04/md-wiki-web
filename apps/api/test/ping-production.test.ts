import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { expect, it, vi } from 'vitest';
import { configureHttp } from '../src/config/http.js';

it('does not mount either public ping endpoint in production', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  // Production refuses the .env.example secrets (D-251).
  vi.stubEnv('SERVICE_TOKEN', 'x'.repeat(40));
  vi.stubEnv('OWNER_PASSWORD', 'a-real-owner-password');
  try {
    const { AppModule } = await import('../src/app.module.js');
    const app = await NestFactory.create(AppModule);
    try {
      configureHttp(app, { public: true });
      await app.listen(0, '127.0.0.1');
      const base = `${await app.getUrl()}/api/v1/dev/ping`;
      expect((await fetch(base, { method: 'POST' })).status).toBe(404);
      expect((await fetch(`${base}/019ac174-1da5-738a-a8c2-2f50343a60a3`)).status).toBe(404);
    } finally {
      await app.close();
    }
  } finally {
    vi.unstubAllEnvs();
  }
});
