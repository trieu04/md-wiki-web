import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { JobEnvelope } from '@md-wiki/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../common/request-id.middleware.js';
import { API_CONFIG } from '../config/env.js';
import type { ApiConfig } from '../config/env.js';

/** The `mw-jobs` BullMQ queue (system-logic §7.1). Only the envelope travels through Redis. */
@Injectable()
export class JobQueue implements OnModuleDestroy {
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

  /**
   * Best-effort enqueue after a commit (§7.6.5): the row is the outbox, so a failure is only
   * logged; boot re-dispatch picks the row up again.
   */
  async enqueueQuietly(envelope: JobEnvelope): Promise<boolean> {
    try {
      await this.enqueue(envelope);
      return true;
    } catch {
      logger.warn({ jobId: envelope.jobId, kind: envelope.kind }, 'Job enqueue failed');
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.queue?.close();
    } finally {
      this.redis?.disconnect();
    }
  }
}

/** The Phase 0 name of the queue (dev ping endpoints and their tests). */
export { JobQueue as PingQueue };
