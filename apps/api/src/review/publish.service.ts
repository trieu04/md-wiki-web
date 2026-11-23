import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  classifyWriteFailure,
  OPEN_PHASES,
  parseStatusBlock,
  publishedSections,
  type PublicationPhase,
} from '@md-wiki/domain';
import { Prisma, type Publication, type User } from '@prisma/client';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { logger } from '../common/request-id.middleware.js';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WikiIndexer } from '../wiki/indexer/wiki-indexer.js';
import {
  decodeMarkdown,
  sha256,
  wikiPath,
  type WikiStorage,
  type WriteCondition,
  type WriteReceipt,
} from '../wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../wiki/wiki.module.js';
import { AFTER_PUBLISH, PUBLISH_HOOKS, type AfterPublish, type PublishHooks } from './ports.js';

export type Actor = Pick<User, 'id' | 'kind'>;
/** Who asked: a publisher (manual), the outbox (auto-publish), or boot recovery. */
export type Trigger = { kind: 'manual'; actor: Actor } | { kind: 'auto' } | { kind: 'recovery' };
export type PublishOutcome = 'published' | 'stale' | 'unknown';

const OPEN = [...OPEN_PHASES];
const actorOf = (trigger: Trigger) => (trigger.kind === 'manual' ? trigger.actor : null);
const codeOf = (error: unknown) => (error instanceof AppError ? error.code : null);
const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

type Loaded = Prisma.ProposalGetPayload<{
  include: { decision: true; refs: { include: { snapshot: true } } };
}>;

/**
 * The publish flow (system-logic §7.4.5): phases prepared → writing → written → done, stale on
 * any freshness failure, unknown when the outcome cannot be established. Runs under the storage
 * root lock; every phase is persisted before the next step, so a crash leaves a resumable row.
 */
@Injectable()
export class PublishService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WIKI_STORAGE) private readonly storage: WikiStorage,
    @Inject(WikiIndexer) private readonly indexer: WikiIndexer,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(PUBLISH_HOOKS) private readonly hooks: PublishHooks,
    @Optional() @Inject(AFTER_PUBLISH) private readonly after?: AfterPublish,
  ) {}

  get autoPublish() {
    return this.config.AUTO_PUBLISH;
  }

  async publish(proposalId: string, trigger: Trigger): Promise<PublishOutcome> {
    return this.storage.withRootLock(async () => {
      const proposal = await this.load(proposalId);
      if (proposal.state === 'published') return 'published';
      const open = await this.db.publication.findFirst({
        where: { proposalId, phase: { in: OPEN } },
      });
      if (open?.phase === 'written') return this.finish(open.id);
      if (open?.phase === 'writing') return this.classify(proposal, open, 'crash', null, trigger);
      if (open?.phase === 'unknown')
        throw new AppError('TARGET_BLOCKED', 'The last publish outcome is unknown');
      if (proposal.state !== 'approved' || !proposal.decision)
        throw new AppError('PRECONDITION_FAILED', 'The proposal is not approved');
      this.integrity(proposal);
      const blocker = await this.db.publication.findFirst({
        where: {
          targetPath: proposal.targetPath,
          phase: { in: OPEN },
          proposalId: { not: proposalId },
        },
        include: { proposal: { select: { slug: true } } },
      });
      if (blocker)
        throw new AppError('TARGET_BLOCKED', `The page is held by ${blocker.proposal.slug}`);

      // Step 5: every pinned source/scope file must be unchanged.
      for (const ref of proposal.refs) {
        if (ref.role === 'target') continue;
        const now = await this.indexer.observe(wikiPath(ref.snapshot.path));
        if (now?.sha256 !== ref.snapshot.sha256)
          return this.stale(proposal, open, 'source_changed', trigger, {});
      }
      // Step 6: read the target once. A failed read is not absence: no phase is recorded.
      const current = await this.readSha(proposal.targetPath);
      const condition: WriteCondition =
        proposal.baseSha256 === null
          ? { kind: 'create' }
          : { kind: 'replace', expectedSha256: proposal.baseSha256 };
      if (current !== proposal.baseSha256)
        return this.stale(proposal, open, 'base_changed', trigger, condition);

      const pub = await this.prepare(proposal, open, condition, trigger);
      await this.hooks.at('prepared', proposalId);
      await this.transition(proposal, pub, 'writing', {}, (tx) =>
        audit(tx, actorOf(trigger), 'publication.writing', 'proposal', proposal.id, {
          publicationId: pub.id,
          decisionId: pub.decisionId,
        }),
      );
      await this.hooks.at('writing', proposalId);
      let receipt: WriteReceipt;
      try {
        receipt = await this.storage.write(
          wikiPath(proposal.targetPath),
          this.artifactOf(proposal),
          condition,
          { proposal: proposal.slug, decision: pub.decisionId, publication: pub.id },
        );
      } catch (error) {
        return this.classify(proposal, pub, 'write', error, trigger);
      }
      await this.hooks.at('afterWrite', proposalId);
      await this.markWritten(proposal, pub, receipt, null, trigger);
      await this.hooks.at('written', proposalId);
      return this.finish(pub.id);
    });
  }

  /**
   * Finish a written publication (step 9): register the verified artifact as the new version,
   * record section hashes, mark done. Idempotent; a crash re-runs it.
   */
  async finish(publicationId: string): Promise<'published'> {
    return this.storage.withRootLock(async (): Promise<'published'> => {
      const pub = await this.db.publication.findUniqueOrThrow({
        where: { id: publicationId },
        include: { proposal: true, decision: true },
      });
      if (pub.phase === 'done') return 'published';
      if (pub.phase !== 'written') throw new AppError('INTERNAL', `finish in phase ${pub.phase}`);
      const artifact = Buffer.from(pub.proposal.artifact ?? new Uint8Array());
      const path = wikiPath(pub.targetPath);
      const existing =
        pub.versionLabel ??
        (
          await this.db.snapshot.findFirst({
            where: {
              path: path.path,
              sha256: pub.artifactHash,
              capturedAt: { gte: pub.startedAt },
            },
            orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
            select: { label: true },
          })
        )?.label;
      const versionLabel = existing ?? (await this.indexer.register(path, artifact));
      const now = new Date();
      const finished = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Publication" WHERE id = ${pub.id}::uuid FOR UPDATE`;
        const fresh = await tx.publication.findUniqueOrThrow({ where: { id: pub.id } });
        if (fresh.phase !== 'written') return false;
        await tx.publishedSection.createMany({
          data: publishedSections(decodeMarkdown(artifact)).map((s) => ({
            publicationId: pub.id,
            path: path.path,
            versionLabel,
            anchor: s.anchor,
            sectionHash: s.sectionHash,
            reviewerKind: pub.decision.reviewerKind,
            reviewedAt: pub.decision.createdAt,
          })),
          skipDuplicates: true,
        });
        await tx.publication.update({
          where: { id: pub.id },
          data: { phase: 'done', versionLabel, finishedAt: now, updatedAt: now },
        });
        await tx.proposal.update({
          where: { id: pub.proposalId },
          data: { state: 'published', updatedAt: now },
        });
        await tx.publishOutbox.updateMany({
          where: { proposalId: pub.proposalId, processedAt: null },
          data: { processedAt: now },
        });
        await tx.page.updateMany({
          where: { path: path.path, currentSha256: pub.artifactHash },
          data: { changedOutsideReview: false },
        });
        await audit(
          tx,
          pub.actorId ? await this.actor(tx, pub.actorId) : null,
          'proposal.published',
          'proposal',
          pub.proposalId,
          {
            publicationId: pub.id,
            versionLabel,
            auto: pub.auto,
            decisionId: pub.decisionId,
          },
        );
        return true;
      });
      // An out-of-band edit that landed after our write becomes the current version, flagged.
      try {
        await this.indexer.observe(path);
      } catch (error) {
        logger.warn({ err: error, path: path.path }, 'observe after publish failed');
      }
      if (finished) {
        this.events.publication(pub.proposal.slug, pub.proposal.submitterId, 'done');
        this.events.proposal(pub.proposal.slug, pub.proposal.submitterId, 'published', 'done');
        this.events.page(path.path);
        // Digest and spot-check sampling (§7.8.7); never undoes or delays the publication.
        this.after?.published(pub.proposalId).catch((error: unknown) => {
          logger.warn({ err: error, proposalId: pub.proposalId }, 'after-publish follow-up failed');
        });
      }
      return 'published';
    });
  }

  /** Step 8 (and boot recovery of a `writing` row): stale, written or unknown (D-79). */
  private async classify(
    proposal: Loaded,
    pub: Publication,
    context: 'write' | 'crash',
    error: unknown,
    trigger: Trigger,
  ): Promise<PublishOutcome> {
    const code = context === 'crash' ? 'CRASH' : (codeOf(error) ?? 'ERROR');
    let readBack: string | null = null;
    if (code !== 'PRECONDITION_FAILED' && code !== 'ALREADY_EXISTS' && code !== 'VERIFY_FAILED') {
      try {
        readBack = await this.readSha(proposal.targetPath);
      } catch {
        readBack = null;
      }
    }
    const outcome = classifyWriteFailure(code, readBack, pub.artifactHash);
    if (outcome === 'stale') return this.stale(proposal, pub, 'base_changed', trigger, {});
    if (outcome === 'written') {
      await this.markWritten(proposal, pub, null, `receipt_missing:${code}`, trigger);
      return this.finish(pub.id);
    }
    await this.transition(
      proposal,
      pub,
      'unknown',
      { error: `outcome_unknown:${code}` },
      async (tx) => {
        await tx.publishOutbox.updateMany({
          where: { proposalId: proposal.id, processedAt: null },
          data: { processedAt: new Date() },
        });
        await audit(tx, actorOf(trigger), 'publication.unknown', 'proposal', proposal.id, {
          publicationId: pub.id,
          error: `outcome_unknown:${code}`,
          decisionId: pub.decisionId,
        });
      },
    );
    logger.error({ slug: proposal.slug, code }, 'publish outcome unknown; target blocked');
    return 'unknown';
  }

  private async markWritten(
    proposal: Loaded,
    pub: Publication,
    receipt: WriteReceipt | null,
    error: string | null,
    trigger: Trigger,
  ) {
    const now = new Date();
    await this.transition(
      proposal,
      pub,
      'written',
      {
        receipt: receipt
          ? {
              ...receipt,
              path: receipt.path.path,
              writtenAt: receipt.writtenAt.toISOString(),
            }
          : Prisma.DbNull,
        error,
        writtenAt: receipt?.writtenAt ?? now,
      },
      (tx) =>
        audit(tx, actorOf(trigger), 'publication.written', 'proposal', proposal.id, {
          publicationId: pub.id,
          receiptId: receipt?.id ?? null,
          afterSha256: pub.artifactHash,
          recovered: receipt === null,
          decisionId: pub.decisionId,
        }),
    );
  }

  /** Persist a phase change of `pub` (and its audit) in one transaction, then announce it. */
  private async transition(
    proposal: Loaded,
    pub: Publication,
    phase: PublicationPhase,
    data: Prisma.PublicationUpdateInput,
    also: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    await this.db.$transaction(async (tx) => {
      const moved = await tx.publication.updateMany({
        where: { id: pub.id, phase: pub.phase },
        data: {
          ...(data as Prisma.PublicationUpdateManyMutationInput),
          phase,
          updatedAt: new Date(),
        },
      });
      if (moved.count !== 1) throw new AppError('PRECONDITION_FAILED', 'Publication moved on');
      await also(tx);
    });
    pub.phase = phase;
    this.events.publication(proposal.slug, proposal.submitterId, phase);
  }

  /** Persist `prepared` (step 7), or refresh a `prepared` row left by a crash. */
  private async prepare(
    proposal: Loaded,
    open: Publication | null,
    condition: WriteCondition,
    trigger: Trigger,
  ): Promise<Publication> {
    const decision = proposal.decision;
    if (!decision) throw new AppError('PRECONDITION_FAILED');
    try {
      const pub = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${proposal.id}::uuid FOR UPDATE`;
        const state = await tx.proposal.findUniqueOrThrow({
          where: { id: proposal.id },
          select: { state: true },
        });
        if (state.state !== 'approved')
          throw new AppError('PRECONDITION_FAILED', 'The proposal is not approved');
        const row = open
          ? await tx.publication.update({
              where: { id: open.id },
              data: { condition, updatedAt: new Date() },
            })
          : await tx.publication.create({
              data: {
                proposalId: proposal.id,
                attempt: (await tx.publication.count({ where: { proposalId: proposal.id } })) + 1,
                targetPath: proposal.targetPath,
                decisionId: decision.id,
                phase: 'prepared',
                auto: trigger.kind !== 'manual',
                actorId: actorOf(trigger)?.id ?? null,
                baseSha256: proposal.baseSha256,
                artifactHash: decision.artifactHash,
                condition,
              },
            });
        await audit(tx, actorOf(trigger), 'publication.prepared', 'proposal', proposal.id, {
          publicationId: row.id,
          attempt: row.attempt,
          condition,
          decisionId: decision.id,
        });
        return row;
      });
      this.events.publication(proposal.slug, proposal.submitterId, 'prepared');
      return pub;
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError('TARGET_BLOCKED', 'Another publication holds the page');
      throw error;
    }
  }

  /** Steps 5/6/8: the proposal can no longer be published as approved. */
  private async stale(
    proposal: Loaded,
    open: Publication | null,
    error: 'source_changed' | 'base_changed',
    trigger: Trigger,
    condition: WriteCondition | Record<string, never>,
  ): Promise<'stale'> {
    const decision = proposal.decision;
    if (!decision) throw new AppError('PRECONDITION_FAILED');
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${proposal.id}::uuid FOR UPDATE`;
      const pub = open
        ? await tx.publication.update({
            where: { id: open.id },
            data: { phase: 'stale', error, finishedAt: now, updatedAt: now },
          })
        : await tx.publication.create({
            data: {
              proposalId: proposal.id,
              attempt: (await tx.publication.count({ where: { proposalId: proposal.id } })) + 1,
              targetPath: proposal.targetPath,
              decisionId: decision.id,
              phase: 'stale',
              auto: trigger.kind !== 'manual',
              actorId: actorOf(trigger)?.id ?? null,
              baseSha256: proposal.baseSha256,
              artifactHash: decision.artifactHash,
              condition,
              error,
              finishedAt: now,
            },
          });
      await tx.proposal.updateMany({
        where: { id: proposal.id, state: 'approved' },
        data: { state: 'stale', updatedAt: now },
      });
      await tx.publishOutbox.updateMany({
        where: { proposalId: proposal.id, processedAt: null },
        data: { processedAt: now },
      });
      await audit(tx, actorOf(trigger), 'publication.stale', 'proposal', proposal.id, {
        publicationId: pub.id,
        error,
        decisionId: decision.id,
      });
    });
    this.events.publication(proposal.slug, proposal.submitterId, 'stale');
    this.events.proposal(proposal.slug, proposal.submitterId, 'stale', 'stale');
    return 'stale';
  }

  /** Step 3 (D-92): the approved artifact is exactly the decision's artifact of the frozen bundle. */
  private integrity(p: Loaded) {
    const d = p.decision;
    const artifact = p.artifact ? Buffer.from(p.artifact) : null;
    const ok =
      d !== null &&
      artifact !== null &&
      sha256(Buffer.from(p.manifest)) === p.bundleHash &&
      d.bundleHash === p.bundleHash &&
      p.artifactHash === d.artifactHash &&
      sha256(artifact) === d.artifactHash &&
      (() => {
        const parsed = parseStatusBlock(artifact.toString('utf8'));
        return (
          parsed.block?.proposal === p.slug &&
          parsed.block.decision === d.id &&
          Buffer.from(parsed.body, 'utf8').equals(Buffer.from(p.proposed))
        );
      })();
    if (!ok) throw new AppError('PRECONDITION_FAILED', 'The approved artifact changed');
  }

  private artifactOf(p: Loaded) {
    return Buffer.from(p.artifact ?? new Uint8Array());
  }

  private load(id: string): Promise<Loaded> {
    return this.db.proposal.findUniqueOrThrow({
      where: { id },
      include: { decision: true, refs: { include: { snapshot: true } } },
    });
  }

  private actor(tx: Prisma.TransactionClient, id: string) {
    return tx.user.findUniqueOrThrow({ where: { id }, select: { id: true, kind: true } });
  }

  /** The target's current sha, `null` when absent. Other read errors propagate. */
  async readSha(path: string): Promise<string | null> {
    try {
      return (await this.storage.read(wikiPath(path))).sha256;
    } catch (error) {
      if (codeOf(error) === 'NOT_FOUND') return null;
      throw error;
    }
  }

  // ---- outbox and recovery (D-81) -----------------------------------------------------------

  /** Process one pending outbox row; never throws (the row keeps the error). */
  async processOutbox(outboxId: string): Promise<PublishOutcome | null> {
    const row = await this.db.publishOutbox.findUnique({ where: { id: outboxId } });
    if (!row || row.processedAt) return null;
    try {
      const outcome = await this.publish(row.proposalId, { kind: 'auto' });
      await this.db.publishOutbox.updateMany({
        where: { id: row.id, processedAt: null },
        data: { processedAt: new Date() },
      });
      return outcome;
    } catch (error) {
      const code = codeOf(error);
      const state = await this.db.proposal.findUnique({
        where: { id: row.proposalId },
        select: { state: true },
      });
      await this.db.publishOutbox.updateMany({
        where: { id: row.id, processedAt: null },
        data: {
          attempts: { increment: 1 },
          lastError: code ?? (error instanceof Error ? error.message.slice(0, 200) : 'error'),
          // Nothing left to publish (the proposal moved on), or a refusal a retry cannot change
          // (e.g. a tampered artifact). Blocked targets and storage errors stay pending.
          ...((state?.state !== 'approved' ||
            (code !== null && code !== 'TARGET_BLOCKED' && code !== 'STORAGE_ERROR')) && {
            processedAt: new Date(),
          }),
        },
      });
      if (code !== 'TARGET_BLOCKED') logger.error({ err: error, outboxId }, 'auto-publish failed');
      return null;
    }
  }

  /** Process every pending outbox row (optionally of one target), oldest first. */
  async processPending(targetPath?: string) {
    const rows = await this.db.publishOutbox.findMany({
      where: { processedAt: null, ...(targetPath && { proposal: { targetPath } }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    for (const row of rows) await this.processOutbox(row.id);
  }

  /** Queue an auto-publish for an approved proposal (approval or retry). */
  async enqueue(
    tx: Prisma.TransactionClient,
    proposalId: string,
    decisionId: string,
    kind: 'approval' | 'retry',
  ) {
    const row = await tx.publishOutbox.create({ data: { proposalId, decisionId, kind } });
    await audit(tx, null, 'publication.queued', 'proposal', proposalId, { decisionId, kind });
    return row;
  }

  /** Boot recovery (system-logic §7.4.5): resume or classify everything a crash interrupted. */
  async recover() {
    const interrupted = await this.db.publication.findMany({
      where: { phase: { in: ['writing', 'written', 'prepared'] } },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      select: { proposalId: true, phase: true },
    });
    for (const pub of interrupted) {
      try {
        await this.publish(pub.proposalId, { kind: 'recovery' });
      } catch (error) {
        logger.error({ err: error, proposalId: pub.proposalId }, 'publish recovery failed');
      }
    }
    await this.processPending();
    if (!this.autoPublish) return;
    const waiting = await this.db.proposal.findMany({
      where: {
        state: 'approved',
        outbox: { none: { processedAt: null } },
        publications: { none: { phase: { in: OPEN } } },
      },
      select: { id: true, decision: { select: { id: true } } },
    });
    for (const p of waiting) {
      if (!p.decision) continue;
      const decisionId = p.decision.id;
      try {
        const row = await this.db.$transaction((tx) => this.enqueue(tx, p.id, decisionId, 'retry'));
        await this.processOutbox(row.id);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }
}
