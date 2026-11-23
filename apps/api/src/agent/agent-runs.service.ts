import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { AgentReviewInput } from '@md-wiki/contracts';
import { agentRunDue, isActiveRun } from '@md-wiki/domain';
import type { AiJob, Prisma } from '@prisma/client';
import type { Subscription } from 'rxjs';
import { logger } from '../common/request-id.middleware.js';
import { EventsService } from '../events/events.service.js';
import { JobQueue } from '../jobs/ping-queue.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { agentFacts } from './agent-facts.js';

type Tx = Prisma.TransactionClient;
const PAUSED = 'paused';
const ROUND_EVENTS = ['proposal.returned', 'proposal.discussion_closed'];

/**
 * Creates and dispatches `agent_review` jobs (system-logic §7.8.6, D-209). The job row is the
 * outbox: it is inserted when the agent owes a review (`agentRunDue`) and enqueued best-effort.
 * Reconciliation runs after any committed change of a proposal (quality result, discussion,
 * assignment), at boot and on resume — never on a timer, and nothing here decides.
 */
@Injectable()
export class AgentRuns implements OnApplicationBootstrap, OnModuleDestroy {
  private subscription?: Subscription;
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  onApplicationBootstrap() {
    this.subscription = this.events.changes().subscribe((event) => {
      if (
        event.slug &&
        (event.type === 'quality.changed' ||
          event.type === 'proposal.changed' ||
          event.type === 'discussion.changed')
      )
        this.schedule(event.slug);
    });
  }

  async onModuleDestroy() {
    this.closed = true;
    this.subscription?.unsubscribe();
    await this.settled();
  }

  /** Serialised, best-effort reconcile of one proposal (errors are logged). */
  schedule(slug: string) {
    this.chain = this.chain
      .then(async () => {
        if (this.closed) return;
        const p = await this.db.proposal.findUnique({ where: { slug }, select: { id: true } });
        if (p) await this.reconcile(p.id);
      })
      .catch((error: unknown) => {
        if (!this.closed) logger.warn({ err: error, slug }, 'agent review reconcile failed');
      });
  }

  /** Resolves when every scheduled reconcile has run (tests, shutdown). */
  async settled(): Promise<void> {
    let current: Promise<unknown>;
    do {
      current = this.chain;
      await current;
    } while (current !== this.chain);
  }

  /** Discussion escalations end when their topic is closed (§7.8.5). */
  private async closeDiscussionEscalations(tx: Tx, proposalId: string, now: Date) {
    const open = await tx.escalation.findMany({
      where: { proposalId, kind: 'discussion', resolvedAt: null, topicId: { not: null } },
      select: { id: true, topicId: true },
    });
    for (const e of open) {
      const topic = await tx.topic.findUnique({
        where: { id: e.topicId ?? '' },
        select: { status: true },
      });
      if (topic && (topic.status === 'resolved' || topic.status === 'rejected'))
        await tx.escalation.update({
          where: { id: e.id },
          data: { resolvedAt: now, resolution: 'discussion_closed' },
        });
    }
  }

  /** Insert the job when the agent owes a review now; returns it (or null). */
  async reconcile(proposalId: string): Promise<AiJob | null> {
    const facts = await agentFacts(this.db);
    if (!facts.agent) return null;
    const agentId = facts.agent.id;
    const job = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${proposalId}::uuid FOR UPDATE`;
      const now = new Date();
      await this.closeDiscussionEscalations(tx, proposalId, now);
      const p = await tx.proposal.findUniqueOrThrow({ where: { id: proposalId } });
      const current = await agentFacts(tx);
      const assignment = await tx.assignment.findFirst({
        where: { proposalId, assigneeId: agentId, closedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const [returned, quality, runs] = await Promise.all([
        tx.auditEvent.findFirst({
          where: { subjectType: 'proposal', subjectId: proposalId, action: { in: ROUND_EVENTS } },
          orderBy: [{ at: 'desc' }, { id: 'desc' }],
          select: { at: true },
        }),
        tx.aiJob.findMany({
          where: { proposalId, kind: 'quality_check', status: { in: ['queued', 'running'] } },
          select: { status: true, createdAt: true },
        }),
        tx.aiJob.findMany({
          where: { proposalId, kind: 'agent_review' },
          select: { status: true, createdAt: true, error: true },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      const counted = runs.filter(
        (r) => !(r.status === 'failed' && (r.error as { code?: string } | null)?.code === PAUSED),
      );
      const due = agentRunDue({
        model: current.model,
        paused: current.paused,
        agentAvailable: current.agent?.available ?? false,
        state: p.state,
        assignedAt: assignment?.createdAt.getTime() ?? null,
        returnedAt: returned?.at.getTime() ?? null,
        qualityActive: quality.some((q) => isActiveRun(q, now)),
        runs: counted.map((r) => ({ status: r.status, createdAt: r.createdAt.getTime() })),
      });
      if (!due) return null;
      const input: AgentReviewInput = {
        proposal: { id: p.id, slug: p.slug, bundleHash: p.bundleHash, targetPath: p.targetPath },
        trigger: due,
        round: counted.filter((r) => r.status === 'succeeded').length + 1,
      };
      return tx.aiJob.create({
        data: {
          kind: 'agent_review',
          trigger: due,
          proposalId: p.id,
          bundleHash: p.bundleHash,
          input: input as unknown as Prisma.InputJsonValue,
        },
      });
    });
    if (job) this.dispatch(job);
    return job;
  }

  dispatch(job: Pick<AiJob, 'id' | 'kind' | 'status'>) {
    if (job.kind !== 'agent_review' || job.status !== 'queued') return;
    void this.queue.enqueueQuietly({ v: 1, jobId: job.id, kind: 'agent_review' });
  }

  /** Every pending proposal the agent holds (boot, resume). */
  async reconcileAll(): Promise<number> {
    const facts = await agentFacts(this.db);
    if (!facts.agent) return 0;
    const rows = await this.db.assignment.findMany({
      where: { assigneeId: facts.agent.id, closedAt: null, proposal: { state: 'pending' } },
      select: { proposalId: true },
    });
    let created = 0;
    for (const id of new Set(rows.map((r) => r.proposalId)))
      if (await this.reconcile(id)) created++;
    return created;
  }

  /** Boot: enqueue queued rows again (BullMQ dedupes by job id). */
  async redispatch(): Promise<number> {
    const rows = await this.db.aiJob.findMany({
      where: { kind: 'agent_review', status: 'queued' },
      select: { id: true, kind: true, status: true },
    });
    for (const row of rows) this.dispatch(row);
    return rows.length;
  }

  /** Pause (D-211): queued and running reviews end as failed `paused`; resume re-creates them. */
  async stopActive(): Promise<number> {
    const { count } = await this.db.aiJob.updateMany({
      where: { kind: 'agent_review', status: { in: ['queued', 'running'] } },
      data: {
        status: 'failed',
        error: { code: PAUSED, message: 'The reviewer agent was paused' },
        finishedAt: new Date(),
      },
    });
    return count;
  }
}
