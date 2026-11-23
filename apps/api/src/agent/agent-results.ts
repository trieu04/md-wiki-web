import { Inject, Injectable } from '@nestjs/common';
import type { AgentReviewOutput } from '@md-wiki/contracts';
import type { AiJob, Prisma } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { EventsService } from '../events/events.service.js';
import { readAgentInput } from '../jobs/job-contracts.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { settingsOf } from './agent-facts.js';

const invalid = (path: string, message: string) =>
  new AppError('VALIDATION_FAILED', undefined, [{ path: `output.${path}`, code: 'claim', message }]);

/**
 * Stores an `agent_review` result (internal listener, system-logic §7.8.6). The worker acted
 * through the public API; its claim about what happened is checked against the rows that act
 * created (D-210) before the AgentReview record is written.
 */
@Injectable()
export class AgentResults {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  private async verify(job: AiJob, output: AgentReviewOutput, agentId: string | null) {
    const proposalId = job.proposalId;
    if (output.outcome === 'approved' || output.outcome === 'rejected') {
      if (!output.decisionId) throw invalid('decisionId', 'A decision outcome names its decision');
      const d = await this.db.decision.findUnique({ where: { id: output.decisionId } });
      if (
        !d ||
        d.proposalId !== proposalId ||
        d.reviewerId !== agentId ||
        d.approve !== (output.outcome === 'approved')
      )
        throw invalid('decisionId', 'No such decision by the reviewer agent on this proposal');
      if (output.escalationId) throw invalid('escalationId', 'Only escalations name one');
    } else if (output.outcome === 'escalated') {
      if (!output.escalationId) throw invalid('escalationId', 'An escalation names its row');
      const e = await this.db.escalation.findUnique({ where: { id: output.escalationId } });
      if (!e || e.proposalId !== proposalId || e.requestedById !== agentId)
        throw invalid('escalationId', 'No such escalation by the reviewer agent on this proposal');
      if (output.decisionId) throw invalid('decisionId', 'Only decisions name one');
    } else if (output.decisionId || output.escalationId) {
      throw invalid('outcome', 'left_pending names neither a decision nor an escalation');
    }
  }

  /** Returns false when another result finished the job first (the caller checks the replay). */
  async store(job: AiJob, output: AgentReviewOutput): Promise<boolean> {
    const input = readAgentInput(job.input);
    const settings = await settingsOf(this.db);
    await this.verify(job, output, settings.reviewerAgentId);
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
        },
      });
      if (updated.count === 0) return false;
      await tx.agentReview.create({
        data: {
          jobId: job.id,
          proposalId: input.proposal.id,
          bundleHash: input.proposal.bundleHash,
          outcome: output.outcome,
          verdict: output.verdict,
          notes: output.notes,
          claims: output.claims as unknown as Prisma.InputJsonValue,
          refusals: output.refusals as unknown as Prisma.InputJsonValue,
          decisionId: output.decisionId,
          escalationId: output.escalationId,
          provider: output.provider,
          model: output.model,
          promptVersion: output.promptVersion,
        },
      });
      return true;
    });
    if (stored) {
      const p = await this.db.proposal.findUnique({
        where: { id: input.proposal.id },
        select: { slug: true, submitterId: true, state: true },
      });
      if (p) this.events.proposal(p.slug, p.submitterId, p.state);
    }
    return stored;
  }
}
