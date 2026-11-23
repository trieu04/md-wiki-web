import { Inject, Injectable } from '@nestjs/common';
import type { QualityCheckOutput } from '@md-wiki/contracts';
import {
  addDrops,
  locateQuote,
  parseQualityRules,
  verifyFindings,
  type DroppedCounts,
} from '@md-wiki/domain';
import type { AiJob, Prisma } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { EventsService } from '../events/events.service.js';
import { readQualityInput } from '../jobs/job-contracts.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Finding = QualityCheckOutput['findings'][number];
export interface Verified {
  findings: (Finding & { lineStart: number | null; lineEnd: number | null })[];
  dropped: DroppedCounts;
}

/**
 * Re-verify a worker's findings against the run's own input (system-logic §7.6.3, D-134): a
 * finding whose rule, block or quote does not check out is dropped and counted, never stored.
 */
export function verifyOutput(job: Pick<AiJob, 'input'>, output: QualityCheckOutput): Verified {
  const input = readQualityInput(job.input);
  const blocks = new Map(input.blocks.map((b) => [b.id, b.text]));
  const parsed = parseQualityRules(Buffer.from(input.rules.text, 'utf8'));
  const ruleIds = new Set(parsed.ok ? parsed.value.rules.map((r) => r.id) : []);
  const { kept, dropped } = verifyFindings(output.findings, blocks, ruleIds);
  return {
    findings: kept.map((f) => {
      const at = locateQuote(f.quote.text, blocks.get(f.quote.block) ?? '');
      return { ...f, lineStart: at?.lineStart ?? null, lineEnd: at?.lineEnd ?? null };
    }),
    dropped: addDrops(dropped, output.dropped),
  };
}

/** Stores a `quality_check` result (internal listener). */
@Injectable()
export class QualityResults {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** Returns false when another result finished the job first (the caller checks the replay). */
  async store(job: AiJob, output: QualityCheckOutput): Promise<boolean> {
    if (output.rulesSha256 !== job.rulesSha256)
      throw new AppError('VALIDATION_FAILED', undefined, [
        {
          path: 'output.rulesSha256',
          code: 'rulesMismatch',
          message: 'The result was made with other rules than the run sent',
        },
      ]);
    const { findings, dropped } = verifyOutput(job, output);
    const stored = await this.db.$transaction(async (tx) => {
      const updated = await tx.aiJob.updateMany({
        where: { id: job.id, status: { in: ['queued', 'running'] } },
        data: {
          status: 'succeeded',
          output: output as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
          provider: output.provider,
          model: output.model,
          promptVersion: output.promptVersion,
          tokensIn: output.usage.inputTokens,
          tokensOut: output.usage.outputTokens,
          dropped: { ...dropped },
        },
      });
      if (updated.count === 0) return false;
      if (findings.length)
        await tx.finding.createMany({
          data: findings.map((f, ord) => ({
            jobId: job.id,
            proposalId: job.proposalId,
            draftId: job.draftId,
            ord,
            rule: f.rule,
            severity: f.severity,
            message: f.message,
            block: f.quote.block,
            quote: f.quote.text,
            lineStart: f.lineStart,
            lineEnd: f.lineEnd,
            origin: f.origin,
            ...(f.original && { original: { block: f.original.block, text: f.original.text } }),
          })),
        });
      return true;
    });
    if (stored) await this.announce(job);
    return stored;
  }

  /** SSE after a run finished (stored or failed). */
  async announce(job: Pick<AiJob, 'proposalId' | 'draftId' | 'requestedById'>) {
    if (job.proposalId) {
      const p = await this.db.proposal.findUnique({
        where: { id: job.proposalId },
        select: { slug: true, submitterId: true },
      });
      if (p) this.events.quality({ slug: p.slug, submitterId: p.submitterId });
    } else if (job.draftId && job.requestedById) {
      this.events.quality({ draftId: job.draftId, authorId: job.requestedById });
    }
  }
}
