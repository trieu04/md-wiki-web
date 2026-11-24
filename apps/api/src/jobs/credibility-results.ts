import { Inject, Injectable } from '@nestjs/common';
import type { AiJob, Prisma } from '@prisma/client';
import { credibilityJobBus, type CredibilityJobKind } from '../credibility/job-bus.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  readCopyCandidatesOutput,
  readCredibilityScoreOutput,
  readRelationCandidatesOutput,
  readRetractionCheckOutput,
} from './job-contracts.js';

const readers: Record<CredibilityJobKind, (body: unknown) => unknown> = {
  retraction_check: readRetractionCheckOutput,
  copy_candidates: readCopyCandidatesOutput,
  relation_candidates: readRelationCandidatesOutput,
  credibility_score: readCredibilityScoreOutput,
};

/** Internal side of the credibility jobs (§7.7.12): validate, store, hand to the public app. */
@Injectable()
export class CredibilityResults {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  read(kind: CredibilityJobKind, output: unknown) {
    return readers[kind](output);
  }

  /** `false` when another result already finished the job. */
  async store(job: AiJob, output: unknown): Promise<boolean> {
    const valid = this.read(job.kind as CredibilityJobKind, output);
    const updated = await this.db.aiJob.updateMany({
      where: { id: job.id, status: { in: ['queued', 'running'] } },
      data: { status: 'succeeded', output: valid as Prisma.InputJsonValue, finishedAt: new Date() },
    });
    if (updated.count === 0) return false;
    credibilityJobBus.next(job.id);
    return true;
  }

  /**
   * The internal endpoints (`/internal/v1/credibility/*`): the body is recorded as a finished job
   * of the matching kind, so it is applied exactly like a worker result (D-230).
   */
  async record(kind: CredibilityJobKind, output: unknown): Promise<{ jobId: string }> {
    const valid = this.read(kind, output);
    const now = new Date();
    const row = await this.db.aiJob.create({
      data: {
        kind,
        trigger: 'internal',
        status: 'succeeded',
        input: { trigger: 'internal' },
        output: valid as Prisma.InputJsonValue,
        startedAt: now,
        finishedAt: now,
      },
    });
    credibilityJobBus.next(row.id);
    return { jobId: row.id };
  }
}
