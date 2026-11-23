import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import { settingsOf } from './agent-facts.js';
import type { AgentMetricsDto } from './agent.dto.js';

/** Operations › Reviewer agent (system-logic §7.8.9): counts over the last `days` days. */
@Injectable()
export class AgentMetricsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async metrics(days = 30, now = new Date()): Promise<Wire<AgentMetricsDto>> {
    const since = new Date(now.getTime() - days * 86_400_000);
    const settings = await settingsOf(this.db);
    const agentId = settings.reviewerAgentId;
    const window = { gte: since, lte: now };
    const none = agentId === null;
    const [reviews, failed, decisions, escalations, refusals, spots] = await Promise.all([
      this.db.agentReview.findMany({
        where: { createdAt: window },
        select: { outcome: true },
      }),
      this.db.aiJob.count({ where: { kind: 'agent_review', status: 'failed', createdAt: window } }),
      none
        ? Promise.resolve([])
        : this.db.decision.findMany({
            where: { reviewerId: agentId, createdAt: window },
            select: { id: true, approve: true, proposalId: true },
          }),
      none
        ? Promise.resolve([])
        : this.db.escalation.findMany({
            where: { requestedById: agentId, createdAt: window },
            select: { kind: true, triggers: true },
          }),
      this.db.auditEvent.findMany({
        where: { action: 'agent.refused', at: window },
        select: { data: true },
      }),
      this.db.spotCheck.findMany({
        where: { sampledAt: window },
        select: { outcome: true },
      }),
    ]);
    const approvals = decisions.filter((d) => d.approve);
    const published = approvals.length
      ? await this.db.publication.findMany({
          where: { decisionId: { in: approvals.map((d) => d.id) }, phase: 'done' },
          select: { auto: true, targetPath: true, proposalId: true, finishedAt: true },
        })
      : [];
    // A revert: a later publication on the same path whose artifact equals this one's base.
    let reverts = 0;
    for (const pub of published) {
      const p = await this.db.proposal.findUnique({
        where: { id: pub.proposalId },
        select: { baseSha256: true },
      });
      if (!p?.baseSha256 || !pub.finishedAt) continue;
      const later = await this.db.publication.count({
        where: {
          targetPath: pub.targetPath,
          phase: 'done',
          finishedAt: { gt: pub.finishedAt },
          artifactHash: p.baseSha256,
        },
      });
      if (later) reverts++;
    }
    const byTrigger = new Map<string, number>();
    for (const r of refusals) {
      const triggers = (r.data as { triggers?: string[] } | null)?.triggers ?? [];
      for (const t of triggers) byTrigger.set(t, (byTrigger.get(t) ?? 0) + 1);
    }
    for (const e of escalations)
      for (const t of e.triggers) byTrigger.set(t, (byTrigger.get(t) ?? 0) + 1);
    const decided = spots.filter((s) => s.outcome !== null);
    const spotFailed = decided.filter((s) => s.outcome === 'failed').length;
    const rereview = escalations.filter((e) => e.kind === 'rereview').length;
    return {
      days,
      since: since.toISOString(),
      until: now.toISOString(),
      paused: settings.agentPaused,
      reviews: reviews.length,
      decided: decisions.length,
      approved: approvals.length,
      autoPublished: published.filter((p) => p.auto).length,
      sentBack: decisions.length - approvals.length,
      escalated: {
        rereview,
        discussion: escalations.length - rereview,
        total: escalations.length,
      },
      refusedByTriggers: refusals.length,
      byTrigger: [...byTrigger.entries()]
        .map(([id, n]) => ({ id, n }))
        .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)),
      leftPending: reviews.filter((r) => r.outcome === 'left_pending').length,
      failed,
      spotChecks: {
        sampled: spots.length,
        passed: decided.length - spotFailed,
        failed: spotFailed,
        open: spots.length - decided.length,
      },
      reverts,
      approvalErrorRate: decided.length ? spotFailed / decided.length : null,
    };
  }
}
