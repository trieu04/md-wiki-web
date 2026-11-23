import { Inject, Injectable } from '@nestjs/common';
import {
  can,
  decisionGuard,
  decisionId,
  lineDiff,
  OPEN_PHASES,
  validPreviewAt,
} from '@md-wiki/domain';
import { Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError, type FieldProblem } from '../common/app-error.js';
import { decodeCursor, encodeCursor, sourceChanged } from '../contributions/pins.js';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import { WikiIndexer } from '../wiki/indexer/wiki-indexer.js';
import {
  decodeMarkdown,
  sha256,
  wikiPath,
  type WikiStorage,
} from '../wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../wiki/wiki.module.js';
import { holdsEscalation, inProposalAudience } from '../agent/agent-facts.js';
import { chooseAssignee, closeAssignments } from './assignments.js';
import {
  DISCUSSION_STATE,
  ESCALATION_TRIGGERS,
  PUBLISH_HOOKS,
  type DiscussionState,
  type EscalationTriggers,
  type PublishHooks,
} from './ports.js';
import { PublishService } from './publish.service.js';
import type {
  DecisionInput,
  ProposalDiffDto,
  ProposalListDto,
  ProposalListInput,
} from './review.dto.js';
import {
  actorOf,
  detailInclude,
  mayRead,
  previewFor,
  ReviewViews,
  type DetailRow,
} from './views.js';

const OPEN = [...OPEN_PHASES];
const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Prisma filters for the F-09 tabs (D-87). */
function tabWhere(tab: string): Prisma.ProposalWhereInput {
  const blocked = { publications: { some: { phase: 'unknown' as const } } };
  switch (tab) {
    case 'blocked':
      return { state: 'approved', ...blocked };
    case 'open':
      return { OR: [{ state: 'pending' }, { state: 'approved', NOT: blocked }] };
    case 'stale':
    case 'published':
    case 'rejected':
      return { state: tab };
    default:
      return {};
  }
}

@Injectable()
export class ReviewService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WIKI_STORAGE) private readonly storage: WikiStorage,
    @Inject(WikiIndexer) private readonly indexer: WikiIndexer,
    @Inject(ReviewViews) private readonly views: ReviewViews,
    @Inject(PublishService) private readonly publisher: PublishService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(DISCUSSION_STATE) private readonly discussions: DiscussionState,
    @Inject(ESCALATION_TRIGGERS) private readonly triggers: EscalationTriggers,
    @Inject(PUBLISH_HOOKS) private readonly hooks: PublishHooks,
  ) {}

  // ---- reads --------------------------------------------------------------------------------

  async list(input: ProposalListInput): Promise<Wire<ProposalListDto>> {
    const limit = input.limit ?? 25;
    const cursor = decodeCursor(input.cursor);
    const filters: Prisma.ProposalWhereInput = {
      ...(input.state && { state: input.state }),
      ...(input.targetPath !== undefined && { targetPath: input.targetPath }),
    };
    const tab = input.tab ?? 'open';
    const rows = await this.db.proposal.findMany({
      where: {
        AND: [
          filters,
          tabWhere(tab),
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
      include: detailInclude,
    });
    const tabs = ['open', 'stale', 'blocked', 'published', 'rejected'] as const;
    const counted = await Promise.all(
      tabs.map((t) => this.db.proposal.count({ where: { AND: [filters, tabWhere(t)] } })),
    );
    const counts = Object.fromEntries(tabs.map((t, i) => [t, counted[i] ?? 0])) as Record<
      (typeof tabs)[number],
      number
    >;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await this.views.listItems(page),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
      counts: { ...counts, all: counted.reduce((a, b) => a + b, 0) },
    };
  }

  /** Visible to the submitter and to roles ≥ reviewer (D-63, D-86); else indistinguishable from absent. */
  async visible(identity: Identity, slug: string): Promise<DetailRow> {
    const row = await this.views.load({ slug });
    if (
      !row ||
      (row.submitterId !== identity.user.id &&
        !mayRead(identity) &&
        !(await inProposalAudience(this.db, row.id, identity.user.id)))
    )
      throw new AppError('NOT_FOUND');
    return row;
  }

  async detail(identity: Identity, slug: string) {
    return this.views.detail(await this.visible(identity, slug), identity);
  }

  async diff(
    identity: Identity,
    slug: string,
    against: 'base' | 'current',
  ): Promise<Wire<ProposalDiffDto>> {
    const row = await this.visible(identity, slug);
    const manifest = JSON.parse(Buffer.from(row.manifest).toString('utf8')) as {
      context: { target: { version: string | null } };
    };
    let from: { versionLabel: string | null; sha256: string | null; text: string };
    if (against === 'base') {
      from = {
        versionLabel: manifest.context.target.version,
        sha256: row.baseSha256,
        text: row.base ? decodeMarkdown(Buffer.from(row.base)) : '',
      };
    } else {
      const current = await this.views.currentOf(row.targetPath);
      from = current
        ? {
            versionLabel: current.versionLabel,
            sha256: current.sha256,
            text: decodeMarkdown(current.content),
          }
        : { versionLabel: null, sha256: null, text: '' };
    }
    const bytes =
      row.state === 'pending'
        ? previewFor(row, identity.user, new Date().toISOString()).bytes
        : row.artifact
          ? row.artifact
          : row.proposed;
    const toBuffer = Buffer.from(bytes);
    const to = { sha256: sha256(toBuffer), text: toBuffer.toString('utf8') };
    const lines = lineDiff(from.text, to.text);
    return {
      against,
      from,
      to,
      lines,
      stats: {
        added: lines.filter((l) => l.kind === 'add').length,
        removed: lines.filter((l) => l.kind === 'del').length,
      },
    };
  }

  // ---- decisions (system-logic §7.4.3) ------------------------------------------------------

  async decide(identity: Identity, slug: string, input: DecisionInput) {
    const user = identity.user;
    const actor = actorOf(identity);
    // Step 1: role and token scope only; the assignment and self checks come in order below.
    // A page author holding an escalation decides with reviewer rights (D-208).
    const roleOnly = { hasOpenAssignment: true, isOwnProposal: false };
    const found = await this.db.proposal.findUnique({ where: { slug }, select: { id: true } });
    if (
      !can(actor, 'proposal.decide', roleOnly).ok &&
      !(
        found &&
        can(actor, 'proposal.decide', {
          ...roleOnly,
          isEscalationAssignee: await holdsEscalation(this.db, found.id, user.id),
        }).ok
      )
    )
      throw new AppError('FORBIDDEN');
    if (!found) throw new AppError('NOT_FOUND');
    const id = decisionId(found.id, user.id, input.previewAt);
    // Step 3: replay of the same binding changes nothing.
    const prior = await this.db.decision.findUnique({ where: { id } });
    if (prior) {
      if (
        prior.approve === input.approve &&
        prior.bundleHash === input.bundleHash &&
        prior.artifactHash === input.artifactHash
      )
        return { replay: true, outcome: null };
      throw new AppError('PRECONDITION_FAILED', 'This preview was already decided differently');
    }

    const refused: { triggers: { id: string; detail: string }[] } = { triggers: [] };
    const committed = await this.storage.withRootLock(async () => {
      const proposal = await this.db.proposal.findUniqueOrThrow({
        where: { id: found.id },
        include: { refs: { include: { snapshot: true } } },
      });
      // Step 10 facts are observed live before the transaction (lock order: root lock → DB).
      let targetFresh = true;
      const changed: FieldProblem[] = [];
      let blocked = false;
      if (input.approve && proposal.state === 'pending') {
        const target = await this.indexer.observe(wikiPath(proposal.targetPath));
        targetFresh = (target?.sha256 ?? null) === proposal.baseSha256;
        const counters = { source: 0, scope: 0 };
        for (const ref of proposal.refs) {
          if (ref.role === 'target') continue;
          const field = `${ref.role === 'source' ? 'sources' : 'scope'}[${String(counters[ref.role]++)}]`;
          const now = await this.indexer.observe(wikiPath(ref.snapshot.path));
          if (now?.sha256 !== ref.snapshot.sha256)
            changed.push({ path: field, code: 'SOURCE_CHANGED', message: ref.snapshot.path });
        }
        blocked =
          (await this.db.publication.count({
            where: { targetPath: proposal.targetPath, phase: { in: OPEN } },
          })) > 0;
      }
      try {
        return await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${proposal.id}::uuid FOR UPDATE`;
          const p = await tx.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
          const gated = (await this.triggers.gate?.(tx, user)) ?? null;
          if (gated) throw new AppError('PRECONDITION_FAILED', gated);
          let assigned =
            (await tx.assignment.count({
              where: { proposalId: p.id, assigneeId: user.id, closedAt: null },
            })) > 0;
          if (
            !assigned &&
            p.state === 'pending' &&
            (await tx.assignment.count({ where: { proposalId: p.id, closedAt: null } })) === 0
          ) {
            // Self-heal (§7.4.2): nobody was assignable at submit; the rule may pick the caller now.
            const pick = await chooseAssignee(tx, p.submitterId);
            if (pick?.id === user.id) {
              await tx.assignment.create({
                data: { proposalId: p.id, assigneeId: user.id, reason: pick.reason },
              });
              await audit(tx, user, 'proposal.assigned', 'proposal', p.id, {
                assigneeId: user.id,
                reason: pick.reason,
              });
              assigned = true;
            }
          }
          const discussion = await this.discussions.state(tx, p.id);
          const preview = previewFor(p, user, input.previewAt);
          const firing =
            input.approve && user.kind === 'agent' ? await this.triggers.firing(tx, p, user) : [];
          const code = decisionGuard({
            approve: input.approve,
            state: p.state,
            hasOpenAssignment: assigned,
            isOwnProposal: p.submitterId === user.id,
            disputed: discussion.disputed,
            bindingMatches:
              input.bundleHash === p.bundleHash &&
              validPreviewAt(input.previewAt, Date.now()) &&
              preview.artifactHash === input.artifactHash,
            versionsMatch:
              input.discussionVersion === discussion.discussionVersion &&
              input.disputeVersion === discussion.disputeVersion,
            targetFresh,
            sourcesFresh: changed.length === 0,
            targetBlocked: blocked,
            isAgent: user.kind === 'agent',
            firingTriggers: firing.map((t) => t.id),
          });
          if (code === 'SOURCE_CHANGED') throw sourceChanged(changed);
          if (code === 'STALE_BASE')
            throw new AppError('STALE_BASE', 'The page changed since the proposal was made');
          if (code === 'ESCALATION_REQUIRED') {
            refused.triggers = firing;
            throw new AppError(
              code,
              `Escalation required: ${firing.map((t) => t.id).join(', ')}`,
              firing.map((t) => ({ path: 'triggers', code: t.id, message: t.detail })),
            );
          }
          if (code) throw new AppError(code);

          const now = new Date();
          await tx.decision.create({
            data: {
              id: preview.decisionId,
              proposalId: p.id,
              reviewerId: user.id,
              reviewerKind: preview.reviewerKind,
              approve: input.approve,
              reason: input.reason,
              bundleHash: p.bundleHash,
              artifactHash: preview.artifactHash,
              previewAt: new Date(input.previewAt),
              discussionVersion: discussion.discussionVersion,
              disputeVersion: discussion.disputeVersion,
              createdAt: now,
            },
          });
          await tx.proposal.update({
            where: { id: p.id },
            data: input.approve
              ? {
                  state: 'approved',
                  artifact: new Uint8Array(preview.bytes),
                  artifactHash: preview.artifactHash,
                  updatedAt: now,
                }
              : { state: 'rejected', updatedAt: now },
          });
          await closeAssignments(tx, p.id, now);
          await audit(tx, user, 'proposal.decided', 'proposal', p.id, {
            decisionId: preview.decisionId,
            approve: input.approve,
            bundleHash: p.bundleHash,
            artifactHash: preview.artifactHash,
            previewAt: input.previewAt,
            discussionVersion: discussion.discussionVersion,
            disputeVersion: discussion.disputeVersion,
          });
          // §8.1: the auto-publish intent commits with the approval (outbox row).
          const outbox =
            input.approve && this.publisher.autoPublish
              ? await this.publisher.enqueue(tx, p.id, preview.decisionId, 'approval')
              : null;
          return { proposal: p, outbox, state: input.approve ? 'approved' : 'rejected' };
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new AppError('PRECONDITION_FAILED', 'The proposal was decided concurrently');
        throw error;
      }
    }).catch(async (error: unknown) => {
      // The refusal rolled back with the transaction; it is recorded on its own (D-205).
      if (refused.triggers.length)
        await audit(this.db, user, 'agent.refused', 'proposal', found.id, {
          triggers: refused.triggers.map((t) => t.id),
          previewAt: input.previewAt,
        });
      throw error;
    });
    this.events.proposal(slug, committed.proposal.submitterId, committed.state);
    await this.hooks.at('approved', committed.proposal.id);
    const outcome = committed.outbox
      ? await this.publisher.processOutbox(committed.outbox.id)
      : null;
    return { replay: false, outcome };
  }

  async publish(identity: Identity, slug: string) {
    if (!can(actorOf(identity), 'proposal.publish', { autoPublish: this.publisher.autoPublish }).ok)
      throw new AppError('FORBIDDEN');
    const row = await this.db.proposal.findUnique({ where: { slug }, select: { id: true } });
    if (!row) throw new AppError('NOT_FOUND');
    await this.publisher.publish(row.id, { kind: 'manual', actor: identity.user });
  }

  async withdraw(identity: Identity, slug: string, reason: string | undefined) {
    if (!can(actorOf(identity), 'proposal.submit', {}).ok) throw new AppError('FORBIDDEN');
    const row = await this.visible(identity, slug);
    if (row.submitterId !== identity.user.id) throw new AppError('FORBIDDEN');
    const text = reason?.trim() ? reason.trim() : 'withdrawn';
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${row.id}::uuid FOR UPDATE`;
      const p = await tx.proposal.findUniqueOrThrow({ where: { id: row.id } });
      const open = await tx.publication.count({ where: { proposalId: p.id, phase: { in: OPEN } } });
      if (!(p.state === 'pending' || (p.state === 'approved' && open === 0)))
        throw new AppError(
          'PRECONDITION_FAILED',
          'Only pending or unpublished approved proposals can be withdrawn',
        );
      const now = new Date();
      await tx.withdrawal.create({
        data: { proposalId: p.id, actorId: identity.user.id, reason: text, createdAt: now },
      });
      await tx.proposal.update({
        where: { id: p.id },
        data: { state: 'rejected', updatedAt: now },
      });
      await closeAssignments(tx, p.id, now, 'withdrawn');
      await tx.publishOutbox.updateMany({
        where: { proposalId: p.id, processedAt: null },
        data: { processedAt: now, lastError: 'withdrawn' },
      });
      await audit(tx, identity.user, 'proposal.withdrawn', 'proposal', p.id, { reason: text });
    });
    this.events.proposal(slug, row.submitterId, 'rejected');
  }
}
