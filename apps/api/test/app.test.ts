import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { apiPlaceholder } from '../src/index.js';

const children: ReturnType<typeof spawn>[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill('SIGTERM');
  }
});

describe('API scaffold', () => {
  it('exports its package identifier', () => {
    expect(apiPlaceholder).toBe('md-wiki-api');
  });

  it('bootstraps the Nest application and closes it cleanly', async () => {
    const app = await NestFactory.create(AppModule);
    await app.init();
    await app.close();
  });

  it('boots the built start command on an ephemeral port and serves an HTTP response', async () => {
    const child = spawn('pnpm', ['start'], {
      cwd: process.cwd(),
      env: { ...process.env, API_PORT: '0' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    children.push(child);

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    const deadline = Date.now() + 10_000;
    let response: Response | undefined;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Built start command exited with code ${String(child.exitCode)}`);
      }
      const match = /API listening at (http:\/\/[^\s]+)/.exec(output);
      if (match?.[1]) {
        response = await fetch(match[1]);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(response).toBeDefined();
    expect(response?.status).toBe(404);
  }, 15_000);
});
