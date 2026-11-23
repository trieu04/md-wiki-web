import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { JobEnvelope } from '@md-wiki/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../common/request-id.middleware.js';
import { API_CONFIG } from '../config/env.js';
import type { ApiConfig } from '../config/env.js';

@Injectable()
export class PingQueue implements OnModuleDestroy {
  private queue?: Queue<JobEnvelope, void, JobEnvelope['kind']>;
  private redis?: Redis;

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  async enqueue(envelope: JobEnvelope): Promise<void> {
    if (!this.queue) {
      this.redis = new Redis(this.config.REDIS_URL, {
        connectTimeout: 1500,
        commandTimeout: 1500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.queue = new Queue('mw-jobs', { connection: this.redis });
      this.queue.on('error', () => {
        logger.error('Job queue connection error');
      });
    }
    await this.queue.waitUntilReady();
    await this.queue.add(envelope.kind, envelope, {
      jobId: envelope.jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.queue?.close();
    } finally {
      this.redis?.disconnect();
    }
  }
}
