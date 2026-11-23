import { opendir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { API_CONFIG } from '../config/env.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthDto, type DependencyStatus } from './health.dto.js';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

async function check(probe: () => Promise<void>): Promise<DependencyStatus> {
  try {
    await probe();
    return 'ok';
  } catch {
    return 'down';
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async report(): Promise<HealthDto> {
    const [db, redis, storage] = await Promise.all([
      check(() => this.prisma.ping()),
      check(() => this.pingRedis()),
      check(async () => {
        await (await opendir(this.config.WIKI_ROOT)).close();
      }),
    ]);
    return new HealthDto(db, redis, storage, version);
  }

  private async pingRedis(): Promise<void> {
    const redis = new Redis(this.config.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 1500,
      commandTimeout: 1500,
      retryStrategy: () => null,
    });
    try {
      await redis.connect();
      await redis.ping();
    } finally {
      redis.disconnect();
    }
  }
}
