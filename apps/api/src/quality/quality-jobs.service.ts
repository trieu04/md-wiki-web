import { Inject, Injectable } from '@nestjs/common';
import type { QualityCheckInput } from '@md-wiki/contracts';
import { can, currentRun, isActiveRun, qualitySummary, type QualitySummary } from '@md-wiki/domain';
import type { AiJob, Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { inProposalAudience } from '../agent/agent-facts.js';
import { AppError } from '../common/app-error.js';
import { logger } from '../common/request-id.middleware.js';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { decodeCursor, encodeCursor } from '../contributions/pins.js';
import { EventsService } from '../events/events.service.js';
import { JobQueue } from '../jobs/ping-queue.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import { QualityRulesFile, qualityModelConfig, redactUrl, sha } from './quality-config.js';
import {
  blockTextLength,
  INPUT_TEXT_LIMIT,
  qualityBlocks,
  type BlockSources,
} from './quality-input.js';
import { ACTIVE, jobListItem, runDto, runFacts, type RunRow } from './quality-views.js';
import type {
  JobListDto,
  JobListInput,
  ModelsDto,
  QualityReportDto,
  QualityRunDto,
  RulesDto,
} from './quality.dto.js';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
type Subject =
  | { kind: 'proposal'; id: string; slug: string; submitterId: string }
  | { kind: 'draft'; id: string; authorId: string };
export interface DraftRunInput {
  draftId: string;
  authorId: string;
  digest: string;
  targetPath: string;
  section: string | null;
  sources: BlockSources;
}

const REVIEW_ROLES = new Set(['reviewer', 'publisher', 'owner']);
const RUN_HISTORY = 10;
const superseded = { code: 'superseded', message: 'Superseded by a newer run' };
const runInclude = {
  findings: { orderBy: { ord: 'asc' } },
  requestedBy: { select: { id: true, name: true, kind: true } },
} satisfies Prisma.AiJobInclude;

const actorOf = (identity: Identity) => ({
  kind: identity.user.kind,
  roles: identity.user.roles,
  auth:
    identity.kind === 'token'
      ? { kind: 'token' as const, scopes: identity.scopes }
      : { kind: 'session' as const },
});

/**
 * Quality check runs (system-logic §7.6): created on submit (inside the freeze transaction), on
 * demand by reviewers and by authors on their drafts; enqueued best-effort after commit.
 * Nothing here changes a proposal's state: findings are advisory.
 */
@Injectable()
export class QualityJobs {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(QualityRulesFile) private readonly rules: QualityRulesFile,
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  // ---- creation --------------------------------------------------------------------------

  /** Insert a run for a proposal in the caller's transaction (§7.6.5). */
  async createForProposal(
    tx: Tx,
    proposalId: string,
    trigger: 'submit' | 'rerun',
    requestedById: string | null,
  ): Promise<AiJob> {
    const p = await tx.proposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: { refs: { include: { snapshot: true }, orderBy: { ord: 'asc' } } },
    });
    const target = p.refs.find((r) => r.role === 'target');
    const sources: BlockSources = {
      targetPath: p.targetPath,
      title: p.title,
      reason: p.reason,
      proposed: p.proposed,
      base: p.base ? { versionLabel: target?.snapshot.label ?? null, content: p.base } : null,
      sources: p.refs
        .filter((r) => r.role === 'source')
        .map((r) => ({
          path: r.snapshot.path,
          versionLabel: r.snapshot.label,
          content: r.snapshot.content,
        })),
    };
    return this.insert(tx, {
      trigger,
      proposalId,
      draftId: null,
      requestedById,
      bundleHash: p.bundleHash,
      subject: {
        kind: 'proposal',
        id: p.id,
        slug: p.slug,
        targetPath: p.targetPath,
        section: p.section,
      },
      sources,
    });
  }

  private async insert(
    tx: Tx,
    run: {
      trigger: 'submit' | 'rerun' | 'self_check';
      proposalId: string | null;
      draftId: string | null;
      requestedById: string | null;
      bundleHash: string;
      subject: QualityCheckInput['subject'];
      sources: BlockSources;
    },
  ): Promise<AiJob> {
    const rules = await this.rules.read();
    const blocks = qualityBlocks(run.sources);
    const base = {
      kind: 'quality_check' as const,
      trigger: run.trigger,
      proposalId: run.proposalId,
      draftId: run.draftId,
      requestedById: run.requestedById,
      bundleHash: run.bundleHash,
    };
    const failed = (code: string, message: string, rulesSha256: string | null) =>
      tx.aiJob.create({
        data: {
          ...base,
          rulesSha256,
          status: 'failed',
          input: json({ subject: run.subject, bundleHash: run.bundleHash }),
          error: { code, message: message.slice(0, 500) },
          finishedAt: new Date(),
        },
      });
    if (!rules.raw || !rules.parsed.ok) {
      const message = rules.parsed.ok ? 'rules file unreadable' : rules.parsed.error;
      return failed(
        'rules_invalid',
        `${rules.path}: ${message}`,
        rules.raw ? sha(rules.raw) : null,
      );
    }
    if (blockTextLength(blocks) > INPUT_TEXT_LIMIT)
      return failed(
        'input_too_large',
        'The texts to check are too large',
        rules.parsed.value.sha256,
      );
    const input: QualityCheckInput = {
      subject: run.subject,
      bundleHash: run.bundleHash,
      blocks: blocks as QualityCheckInput['blocks'],
      rules: {
        path: rules.path,
        sha256: rules.parsed.value.sha256,
        text: rules.raw.toString('utf8'),
      },
    };
    return tx.aiJob.create({
      data: { ...base, rulesSha256: rules.parsed.value.sha256, input: json(input) },
    });
  }

  /** Enqueue after commit; never throws (the row is the outbox, §7.6.5). */
  dispatch(job: Pick<AiJob, 'id' | 'kind' | 'status'>): void {
    if (job.status !== 'queued' || job.kind !== 'quality_check') return;
    void this.queue.enqueueQuietly({ v: 1, jobId: job.id, kind: job.kind });
  }

  /** After a submit commits: enqueue the run and tell the proposal's audience. */
  submitted(job: AiJob | null, proposal: { slug: string; submitterId: string }) {
    if (!job) return;
    this.dispatch(job);
    this.events.quality({ slug: proposal.slug, submitterId: proposal.submitterId });
  }

  /** Boot: enqueue every queued run again (BullMQ dedupes by job id). */
  async redispatch(): Promise<number> {
    try {
      const rows = await this.db.aiJob.findMany({
        where: { kind: 'quality_check', status: 'queued' },
        select: { id: true, kind: true, status: true },
      });
      for (const row of rows) this.dispatch(row);
      return rows.length;
    } catch {
      logger.warn('Quality run re-dispatch failed');
      return 0;
    }
  }

  /** Lock the subject's runs, return a reusable active run or retire the stale ones. */
  private async activeOrRetire(
    tx: Tx,
    where: Prisma.AiJobWhereInput,
    reusable: (row: AiJob) => boolean,
  ): Promise<AiJob | null> {
    const active = await tx.aiJob.findMany({
      where: { ...where, kind: 'quality_check', status: { in: [...ACTIVE] } },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    const keep = active.find((row) => isActiveRun(row, now) && reusable(row));
    if (keep) return keep;
    if (active.length)
      await tx.aiJob.updateMany({
        where: { id: { in: active.map((r) => r.id) }, status: { in: [...ACTIVE] } },
        data: { status: 'failed', error: superseded, finishedAt: now },
      });
    return null;
  }

  /** `POST /proposals/{slug}/quality-check` (§7.6.5). */
  async rerun(identity: Identity, slug: string) {
    const p = await this.db.proposal.findUnique({ where: { slug } });
    if (!p) throw new AppError('NOT_FOUND');
    const { job, created } = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${p.id}::uuid FOR UPDATE`;
      const row = await tx.proposal.findUniqueOrThrow({ where: { id: p.id } });
      if (row.state !== 'pending')
        throw new AppError('PRECONDITION_FAILED', 'Only a pending proposal is checked again');
      const active = await this.activeOrRetire(tx, { proposalId: p.id }, () => true);
      if (active) return { job: active, created: false };
      const job = await this.createForProposal(tx, p.id, 'rerun', identity.user.id);
      await audit(tx, identity.user, 'quality.requested', 'proposal', p.id, {
        jobId: job.id,
        trigger: 'rerun',
      });
      return { job, created: true };
    });
    if (created) this.submitted(job, p);
    return { created, run: await this.run(job.id, p.bundleHash) };
  }

  /** `POST /drafts/{id}/self-check` (§7.6.6); the draft was composed by DraftsService. */
  async selfCheck(input: DraftRunInput) {
    const { job, created } = await this.db.$transaction(async (tx) => {
      // Serialize self-checks of one draft (the draft row is the subject's lock).
      await tx.$queryRaw`SELECT id FROM "Draft" WHERE id = ${input.draftId}::uuid FOR UPDATE`;
      const active = await this.activeOrRetire(
        tx,
        { draftId: input.draftId },
        (row) => row.bundleHash === input.digest,
      );
      if (active) return { job: active, created: false };
      const job = await this.insert(tx, {
        trigger: 'self_check',
        proposalId: null,
        draftId: input.draftId,
        requestedById: input.authorId,
        bundleHash: input.digest,
        subject: {
          kind: 'draft',
          id: input.draftId,
          slug: null,
          targetPath: input.targetPath,
          section: input.section,
        },
        sources: input.sources,
      });
      return { job, created: true };
    });
    if (created) {
      this.dispatch(job);
      this.events.quality({ draftId: input.draftId, authorId: input.authorId });
    }
    return { created, run: await this.run(job.id, input.digest) };
  }

  // ---- reads ------------------------------------------------------------------------------

  private async currentRulesSha(): Promise<string | null> {
    const rules = await this.rules.read();
    return rules.parsed.ok ? rules.parsed.value.sha256 : null;
  }

  private async run(id: string, hash: string): Promise<Wire<QualityRunDto>> {
    const row = await this.db.aiJob.findUniqueOrThrow({ where: { id }, include: runInclude });
    return runDto(row, { hash, rulesSha256: await this.currentRulesSha(), withFindings: true });
  }

  private async report(
    subject: Subject,
    where: Prisma.AiJobWhereInput,
    hash: string,
    rerun: boolean,
  ): Promise<Wire<QualityReportDto>> {
    const rows: RunRow[] = await this.db.aiJob.findMany({
      where: { ...where, kind: 'quality_check' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RUN_HISTORY,
      include: runInclude,
    });
    const rulesSha256 = await this.currentRulesSha();
    let current: RunRow | null = currentRun(rows, hash);
    // The current run may be older than the listed history.
    current ??= await this.db.aiJob.findFirst({
      where: { ...where, kind: 'quality_check', status: 'succeeded', bundleHash: hash },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: runInclude,
    });
    const latest = rows[0] ?? null;
    const facts = [...rows.map(runFacts)];
    if (current && !rows.includes(current)) facts.push(runFacts(current));
    const dto = (row: RunRow) =>
      runDto(row, {
        hash,
        rulesSha256,
        withFindings: row.id === current?.id || row.id === latest?.id,
      });
    return {
      subject: {
        kind: subject.kind,
        id: subject.id,
        slug: subject.kind === 'proposal' ? subject.slug : null,
      },
      bundleHash: hash,
      summary: qualitySummary(facts, hash),
      current: current ? dto(current) : null,
      latest: latest ? dto(latest) : null,
      runs: rows.map(dto),
      can: { rerun },
    };
  }

  /** `GET /proposals/{slug}/findings`: visible like the proposal (D-63). */
  async proposalReport(identity: Identity, slug: string) {
    const p = await this.db.proposal.findUnique({ where: { slug } });
    const reviewer = identity.user.roles.some((r) => REVIEW_ROLES.has(r));
    if (
      !p ||
      (p.submitterId !== identity.user.id &&
        !reviewer &&
        !(await inProposalAudience(this.db, p.id, identity.user.id)))
    )
      throw new AppError('NOT_FOUND');
    return this.report(
      { kind: 'proposal', id: p.id, slug: p.slug, submitterId: p.submitterId },
      { proposalId: p.id },
      p.bundleHash,
      this.mayRerun(identity, p.state),
    );
  }

  /** `GET /drafts/{id}/self-check` for the author (the caller checked ownership). */
  draftReport(draft: { id: string; authorId: string }, digest: string) {
    return this.report(
      { kind: 'draft', id: draft.id, authorId: draft.authorId },
      { draftId: draft.id },
      digest,
      true,
    );
  }

  mayRerun(identity: Identity, state: string) {
    return can(actorOf(identity), 'proposal.read', {}).ok && state === 'pending';
  }

  /** Summaries for proposal rows (list and detail, §7.6.4). */
  async summaries(
    proposals: readonly { id: string; bundleHash: string }[],
  ): Promise<Map<string, Wire<QualitySummary>>> {
    if (!proposals.length) return new Map();
    const ids = proposals.map((p) => p.id);
    const rows = await this.db.aiJob.findMany({
      where: { proposalId: { in: ids }, kind: 'quality_check' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { findings: { select: { severity: true, origin: true } } },
    });
    const byProposal = new Map<string, RunRow[]>();
    for (const row of rows) {
      const list = byProposal.get(row.proposalId ?? '') ?? [];
      list.push(row as RunRow);
      byProposal.set(row.proposalId ?? '', list);
    }
    return new Map(
      proposals.map((p) => [
        p.id,
        qualitySummary((byProposal.get(p.id) ?? []).map(runFacts), p.bundleHash),
      ]),
    );
  }

  // ---- admin and operations -------------------------------------------------------------

  async models(): Promise<Wire<ModelsDto>> {
    const kinds = ['quality_check'] as const;
    const lastUsed = [];
    for (const kind of kinds) {
      const row = await this.db.aiJob.findFirst({
        where: { kind, status: 'succeeded', provider: { not: null }, model: { not: null } },
        orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
      });
      if (row?.provider && row.model)
        lastUsed.push({
          kind,
          provider: row.provider,
          model: row.model,
          promptVersion: row.promptVersion,
          at: (row.finishedAt ?? row.createdAt).toISOString(),
        });
    }
    return {
      jobs: [qualityModelConfig(this.config)],
      openaiCompat: { baseUrl: redactUrl(this.config.OPENAI_COMPAT_BASE_URL) },
      lastUsed,
    };
  }

  async rulesDto(): Promise<Wire<RulesDto>> {
    const file = await this.rules.read();
    return {
      path: file.path,
      sha256: file.raw ? sha(file.raw) : null,
      size: file.raw?.length ?? null,
      error: file.parsed.ok ? null : file.parsed.error,
      rules: file.parsed.ok ? file.parsed.value.rules : [],
      preamble: file.parsed.ok ? file.parsed.value.preamble : '',
    };
  }

  /** `GET /ops/jobs`: metadata only, newest first (§7.6.7). */
  async jobs(input: JobListInput): Promise<Wire<JobListDto>> {
    const limit = input.limit ?? 25;
    const cursor = decodeCursor(input.cursor);
    const filters: Prisma.AiJobWhereInput = {
      ...(input.kind && { kind: input.kind }),
      ...(input.status && { status: input.status }),
    };
    const rows = await this.db.aiJob.findMany({
      where: {
        AND: [
          filters,
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.at } },
                    { createdAt: cursor.at, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: listInclude,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const present = await this.db.aiJob.groupBy({ by: ['kind'], _count: { _all: true } });
    const kinds = (['quality_check', 'agent_review', 'ping'] as const).filter(
      (k) => k !== 'ping' || present.some((p) => p.kind === k),
    );
    const since = new Date(Date.now() - 24 * 3600_000);
    return {
      kinds: await Promise.all(
        kinds.map(async (kind) => {
          const [queued, running, failed24h, lastRow] = await Promise.all([
            this.db.aiJob.count({ where: { kind, status: 'queued' } }),
            this.db.aiJob.count({ where: { kind, status: 'running' } }),
            this.db.aiJob.count({ where: { kind, status: 'failed', finishedAt: { gte: since } } }),
            this.db.aiJob.findFirst({
              where: { kind, status: { in: ['succeeded', 'failed'] } },
              orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
              include: listInclude,
            }),
          ]);
          return { kind, queued, running, failed24h, last: lastRow ? jobListItem(lastRow) : null };
        }),
      ),
      items: page.map(jobListItem),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
}

const listInclude = {
  proposal: { select: { slug: true, title: true } },
  _count: { select: { findings: true } },
} satisfies Prisma.AiJobInclude;
