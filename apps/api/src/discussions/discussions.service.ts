import { Inject, Injectable } from '@nestjs/common';
import {
  can,
  discussionSummary,
  disputeStep,
  holdsApproval,
  isActive,
  mayCloseTopic,
  pageTitle,
  topicTransition,
  validAgreement,
  type Action,
  type TopicAction,
  type TopicStatus,
} from '@md-wiki/domain';
import { Prisma, type User } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { decodeCursor, encodeCursor, invalid } from '../contributions/pins.js';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { chooseAssignee } from '../review/assignments.js';
import { parseManifest } from '../contributions/views.js';
import { actorOf, mayRead, userRef } from '../review/views.js';
import type { Wire } from '../wiki/read.dto.js';
import { wikiPath } from '../wiki/storage/wiki-storage.js';
import type {
  CommentInput,
  DisputeInput,
  DisputeLogDto,
  EntryPageInput,
  ProposalDiscussionDto,
  ProposalDiscussionInput,
  TopicCloseInput,
  TopicCreateInput,
  TopicDetailDto,
  TopicEntryDto,
  TopicEntryPageDto,
  TopicListDto,
  TopicListInput,
  TopicListItemDto,
  TopicReopenInput,
} from './discussions.dto.js';
import { TITLE_LIMIT } from './discussions.dto.js';

type Tx = Prisma.TransactionClient;
const userSelect = { select: { id: true, name: true, kind: true } } as const;
const topicInclude = {
  author: userSelect,
  closedBy: userSelect,
  proposal: { select: { id: true, slug: true, title: true, state: true, submitterId: true } },
  _count: { select: { entries: { where: { kind: { in: ['comment', 'agreement'] } } } } },
} satisfies Prisma.TopicInclude;
type TopicRow = Prisma.TopicGetPayload<{ include: typeof topicInclude }>;
const ACTIVE: TopicStatus[] = ['open', 'on_hold'];
const CLOSED: TopicStatus[] = ['resolved', 'rejected'];
const REVIEW_ROLES = new Set(['reviewer', 'publisher', 'owner']);

/** Topics, proposal discussions and the dispute log (system-logic §7.5). */
@Injectable()
export class DiscussionsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  // ---- guards -------------------------------------------------------------------------------

  private require(identity: Identity, action: Action) {
    const decision = can(actorOf(identity), action, {});
    if (!decision.ok) throw new AppError(decision.code);
  }
  private allowed(identity: Identity, action: Action) {
    return can(actorOf(identity), action, {}).ok;
  }
  /** Role ≥ reviewer (no token scope needed beyond the action's own). */
  private isReviewer(identity: Identity) {
    return identity.user.roles.some((r) => REVIEW_ROLES.has(r));
  }

  /** Proposal topics are visible to the proposal's audience (D-63) and to participants (D-110). */
  private visibleWhere(identity: Identity): Prisma.TopicWhereInput {
    if (mayRead(identity)) return {};
    const me = identity.user.id;
    return {
      OR: [
        { proposalId: null },
        { proposal: { submitterId: me } },
        { participantIds: { has: me } },
      ],
    };
  }
  private async visibleTopic(identity: Identity, id: string): Promise<TopicRow> {
    const row = await this.db.topic.findFirst({
      where: { AND: [{ id }, this.visibleWhere(identity)] },
      include: topicInclude,
    });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }
  private async visibleProposal(identity: Identity, slug: string) {
    const p = await this.db.proposal.findUnique({ where: { slug } });
    if (!p || (p.submitterId !== identity.user.id && !mayRead(identity)))
      throw new AppError('NOT_FOUND');
    return p;
  }

  private async checkMentions(tx: Tx, ids: readonly string[] | undefined) {
    if (!ids?.length) return [];
    const found = await tx.user.findMany({
      where: { id: { in: [...ids] }, disabledAt: null },
      select: { id: true },
    });
    if (found.length !== ids.length)
      throw invalid('mentions', 'UNKNOWN_USER', 'Every mention must be an enabled user');
    return [...ids];
  }

  // ---- views --------------------------------------------------------------------------------

  private async items(rows: TopicRow[]): Promise<Wire<TopicListItemDto>[]> {
    const paths = [...new Set(rows.map((r) => r.path))];
    const pages = await this.db.page.findMany({
      where: { path: { in: paths } },
      select: { path: true, title: true, currentVersionLabel: true },
    });
    const pageOf = new Map(pages.map((p) => [p.path, p]));
    const keys = rows.flatMap((r) => {
      const versionLabel = r.versionLabel ?? pageOf.get(r.path)?.currentVersionLabel;
      return r.anchor && versionLabel ? [{ path: r.path, versionLabel, anchor: r.anchor }] : [];
    });
    const sections = keys.length
      ? await this.db.pageSection.findMany({
          where: { OR: keys },
          select: { path: true, versionLabel: true, anchor: true, title: true },
        })
      : [];
    const title = new Map(
      sections.map((s) => [`${s.path}\0${s.versionLabel}\0${s.anchor}`, s.title]),
    );
    return rows.map((r) => {
      const page = pageOf.get(r.path);
      const versionLabel = r.versionLabel ?? page?.currentVersionLabel;
      return {
        id: r.id,
        title: r.title,
        path: r.path,
        pageTitle: page?.title ?? pageTitle(r.path, []),
        anchor: r.anchor,
        sectionTitle:
          r.anchor && versionLabel
            ? (title.get(`${r.path}\0${versionLabel}\0${r.anchor}`) ?? null)
            : null,
        status: r.status,
        proposal: r.proposal
          ? {
              slug: r.proposal.slug,
              title: r.proposal.title,
              state: r.proposal.state,
              holds: r.proposal.state === 'pending' && holdsApproval(r),
            }
          : null,
        author: userRef(r.author),
        replies: r._count.entries,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  private entryDtos(
    entries: Prisma.DiscussionEventGetPayload<{ include: { author: typeof userSelect } }>[],
    people: Map<string, Pick<User, 'id' | 'name' | 'kind'>>,
  ): Wire<TopicEntryDto>[] {
    return entries.map((e) => ({
      id: e.id,
      seq: e.seq,
      kind: e.kind,
      author: userRef(e.author),
      body: e.body,
      parentSeq: e.parentSeq,
      agreesWith: e.agreesWith,
      outcome: e.outcome === 'open' ? null : e.outcome,
      mentions: e.mentions.flatMap((id) => {
        const u = people.get(id);
        return u ? [userRef(u)] : [];
      }),
      createdAt: e.createdAt.toISOString(),
    }));
  }

  private async people(ids: Iterable<string>) {
    const users = await this.db.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true, kind: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  /** What the viewer may do now (computed by the API; the web never re-derives it). */
  private abilities(row: TopicRow, identity: Identity) {
    const pendingOrPlain = !row.proposal || row.proposal.state === 'pending';
    const isAuthor = row.authorId === identity.user.id;
    const closer =
      this.allowed(identity, 'topic.open') &&
      mayCloseTopic({
        isProposalTopic: row.proposalId !== null,
        isAuthor,
        isReviewer: this.isReviewer(identity),
        isSubmitter: row.proposal?.submitterId === identity.user.id,
      }) === null &&
      pendingOrPlain;
    return {
      comment:
        isActive(row.status) &&
        pendingOrPlain &&
        (this.allowed(identity, 'comment') || (isAuthor && this.allowed(identity, 'topic.open'))),
      close: closer && isActive(row.status),
      reopen: closer && row.status !== 'open',
    };
  }

  async detail(identity: Identity, id: string): Promise<Wire<TopicDetailDto>> {
    const row = await this.visibleTopic(identity, id);
    return this.detailOf(row, identity);
  }

  private async detailOf(row: TopicRow, identity: Identity): Promise<Wire<TopicDetailDto>> {
    const [item] = await this.items([row]);
    const entries = await this.db.discussionEvent.findMany({
      where: { topicId: row.id },
      orderBy: { seq: 'asc' },
      include: { author: userSelect },
    });
    const people = await this.people([
      ...row.participantIds,
      ...entries.flatMap((e) => e.mentions),
    ]);
    if (!item) throw new AppError('INTERNAL');
    return {
      ...item,
      versionLabel: row.versionLabel,
      bundleHash: row.bundleHash,
      participants: row.participantIds.flatMap((p) => {
        const u = people.get(p);
        return u ? [userRef(u)] : [];
      }),
      closed:
        row.closedBy && row.closedAt && row.closeReason && row.status !== 'open'
          ? {
              by: userRef(row.closedBy),
              outcome: row.status,
              reason: row.closeReason,
              at: row.closedAt.toISOString(),
            }
          : null,
      entries: this.entryDtos(entries, people),
      can: this.abilities(row, identity),
    };
  }

  // ---- topics -------------------------------------------------------------------------------

  async list(identity: Identity, input: TopicListInput): Promise<Wire<TopicListDto>> {
    const limit = input.limit ?? 25;
    const cursor = decodeCursor(input.cursor);
    const me = identity.user.id;
    let proposalId: string | undefined;
    if (input.proposal !== undefined) {
      const p = await this.db.proposal.findUnique({
        where: { slug: input.proposal },
        select: { id: true },
      });
      proposalId = p?.id ?? '00000000-0000-0000-0000-000000000000';
    }
    const base: Prisma.TopicWhereInput = {
      AND: [
        this.visibleWhere(identity),
        {
          ...(input.path !== undefined && { path: input.path }),
          ...(input.anchor !== undefined && { anchor: input.anchor }),
          ...(proposalId !== undefined && { proposalId }),
        },
      ],
    };
    const filters: Record<'open' | 'mine' | 'closed' | 'all', Prisma.TopicWhereInput> = {
      open: { status: { in: ACTIVE } },
      mine: {
        status: { in: ACTIVE },
        OR: [{ authorId: me }, { participantIds: { has: me } }],
      },
      closed: { status: { in: CLOSED } },
      all: {},
    };
    const filter = input.filter ?? 'open';
    const rows = await this.db.topic.findMany({
      where: {
        AND: [
          base,
          filters[filter],
          ...(cursor
            ? [
                {
                  OR: [
                    { updatedAt: { lt: cursor.at } },
                    { updatedAt: cursor.at, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: topicInclude,
    });
    const count = (f: keyof typeof filters) =>
      this.db.topic.count({ where: { AND: [base, filters[f]] } });
    const [open, mine, closed, all] = await Promise.all([
      count('open'),
      count('mine'),
      count('closed'),
      count('all'),
    ]);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await this.items(page),
      nextCursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null,
      counts: { open, mine, closed, all },
    };
  }

  async create(identity: Identity, input: TopicCreateInput): Promise<Wire<TopicDetailDto>> {
    this.require(identity, 'topic.open');
    const path = wikiPath(input.path).path;
    const page = await this.db.page.findUnique({ where: { path } });
    if (!page) throw new AppError('NOT_FOUND', 'No such page');
    const anchor = input.anchor ?? null;
    if (anchor !== null) {
      const section = await this.db.pageSection.findUnique({
        where: {
          path_versionLabel_anchor: { path, versionLabel: page.currentVersionLabel, anchor },
        },
      });
      if (!section)
        throw invalid('anchor', 'UNKNOWN_SECTION', 'No such section in the current version');
    }
    const user = identity.user;
    const id = await this.db.$transaction(async (tx) => {
      const mentions = await this.checkMentions(tx, input.mentions);
      const topic = await tx.topic.create({
        data: {
          path,
          anchor,
          versionLabel: page.currentVersionLabel,
          title: input.title,
          authorId: user.id,
          participantIds: [...new Set([user.id, ...mentions])],
          entries: {
            create: { seq: 1, kind: 'open', authorId: user.id, body: input.body, mentions },
          },
        },
      });
      await audit(tx, user, 'topic.opened', 'topic', topic.id, {
        path,
        anchor,
        versionLabel: page.currentVersionLabel,
      });
      return topic.id;
    });
    this.events.discussion({ topicId: id, path, version: 1 });
    return this.detail(identity, id);
  }

  async entries(
    identity: Identity,
    id: string,
    input: EntryPageInput,
  ): Promise<Wire<TopicEntryPageDto>> {
    await this.visibleTopic(identity, id);
    const limit = input.limit ?? 25;
    const after = input.cursor === undefined ? 0 : Number(input.cursor);
    const rows = await this.db.discussionEvent.findMany({
      where: { topicId: id, seq: { gt: after } },
      orderBy: { seq: 'asc' },
      take: limit + 1,
      include: { author: userSelect },
    });
    const page = rows.slice(0, limit);
    const people = await this.people(page.flatMap((e) => e.mentions));
    const last = page.at(-1);
    return {
      items: this.entryDtos(page, people),
      nextCursor: rows.length > limit && last ? String(last.seq) : null,
    };
  }

  /**
   * One write to a topic: lock order Proposal row (when it holds one, §7.4.3 discussion race)
   * → Topic row, then re-read and run `fn`. Emits after commit.
   */
  private async write(
    identity: Identity,
    id: string,
    fn: (
      tx: Tx,
      topic: TopicRow,
      proposal: Prisma.ProposalGetPayload<object> | null,
    ) => Promise<void>,
  ) {
    const seen = await this.visibleTopic(identity, id);
    const result = await this.db.$transaction(async (tx) => {
      if (seen.proposalId)
        await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${seen.proposalId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Topic" WHERE id = ${id}::uuid FOR UPDATE`;
      const topic = await tx.topic.findUniqueOrThrow({ where: { id }, include: topicInclude });
      const proposal = topic.proposalId
        ? await tx.proposal.findUniqueOrThrow({ where: { id: topic.proposalId } })
        : null;
      await fn(tx, topic, proposal);
      return tx.topic.findUniqueOrThrow({ where: { id }, include: topicInclude });
    });
    this.emitTopic(result);
    return this.detailOf(result, identity);
  }

  private emitTopic(t: TopicRow) {
    this.events.discussion({
      topicId: t.id,
      path: t.path,
      version: t.version,
      ...(t.proposal && {
        proposal: {
          slug: t.proposal.slug,
          submitterId: t.proposal.submitterId,
          participants: t.participantIds,
        },
      }),
    });
    if (t.proposal) this.events.proposal(t.proposal.slug, t.proposal.submitterId, t.proposal.state);
  }

  /** Shared checks of a versioned topic write (§7.5.3 order). */
  private guardVersioned(
    topic: TopicRow,
    proposal: { state: string } | null,
    version: number | undefined,
    action: TopicAction,
  ): TopicStatus {
    if (proposal && version === undefined)
      throw invalid('version', 'REQUIRED', 'A proposal discussion needs the version you read');
    if (proposal && proposal.state !== 'pending')
      throw new AppError('PRECONDITION_FAILED', 'The discussion requires a pending proposal');
    if (version !== undefined && version !== topic.version)
      throw new AppError('DISCUSSION_CHANGED', 'The discussion changed; reread it');
    const next = topicTransition(topic.status, action);
    if (!next.ok) throw new AppError(next.code, next.detail);
    return next.status;
  }

  async comment(identity: Identity, id: string, input: CommentInput) {
    this.require(identity, 'topic.open');
    return this.write(identity, id, async (tx, topic, proposal) => {
      if (!this.allowed(identity, 'comment') && topic.authorId !== identity.user.id)
        throw new AppError('FORBIDDEN');
      const kind = input.kind ?? 'comment';
      const status = this.guardVersioned(topic, proposal, input.version, { kind });
      if (kind === 'agreement') {
        if (input.agreesWith === undefined || !validAgreement(input.agreesWith, topic.version))
          throw invalid(
            'agreesWith',
            'UNKNOWN_ENTRY',
            'An agreement must reference an existing entry',
          );
      } else if (input.agreesWith !== undefined)
        throw invalid('agreesWith', 'NOT_AGREEMENT', 'agreesWith is only valid for an agreement');
      if (input.parentSeq !== undefined && input.parentSeq > topic.version)
        throw invalid('parentSeq', 'UNKNOWN_ENTRY', 'The reply must reference an existing entry');
      const mentions = await this.checkMentions(tx, input.mentions);
      await this.append(tx, topic, identity.user, {
        kind,
        body: input.body,
        parentSeq: input.parentSeq ?? null,
        agreesWith: input.agreesWith ?? null,
        mentions,
        status,
      });
    });
  }

  async close(identity: Identity, id: string, input: TopicCloseInput) {
    this.require(identity, 'topic.open');
    return this.write(identity, id, async (tx, topic, proposal) => {
      this.guardCloser(identity, topic, proposal);
      const status = this.guardVersioned(topic, proposal, input.version, {
        kind: 'close',
        outcome: input.outcome,
      });
      await this.append(tx, topic, identity.user, {
        kind: 'close',
        body: input.reason,
        outcome: input.outcome,
        status,
        closed: { reason: input.reason },
      });
      await audit(tx, identity.user, 'topic.closed', 'topic', topic.id, {
        outcome: input.outcome,
        reason: input.reason,
        version: topic.version + 1,
      });
      if (proposal) {
        await audit(tx, identity.user, 'proposal.discussion_closed', 'proposal', proposal.id, {
          topicId: topic.id,
          outcome: input.outcome,
          discussionVersion: topic.version + 1,
        });
        if (input.outcome === 'resolved') await this.returnIfReleased(tx, proposal, identity.user);
      }
    });
  }

  async reopen(identity: Identity, id: string, input: TopicReopenInput) {
    this.require(identity, 'topic.open');
    return this.write(identity, id, async (tx, topic, proposal) => {
      this.guardCloser(identity, topic, proposal);
      const status = this.guardVersioned(topic, proposal, input.version, { kind: 'reopen' });
      await this.append(tx, topic, identity.user, {
        kind: 'reopen',
        body: input.reason,
        status,
        closed: null,
      });
      await audit(tx, identity.user, 'topic.reopened', 'topic', topic.id, {
        reason: input.reason,
        version: topic.version + 1,
      });
      if (proposal)
        await audit(tx, identity.user, 'proposal.discussion_reopened', 'proposal', proposal.id, {
          topicId: topic.id,
          discussionVersion: topic.version + 1,
        });
    });
  }

  private guardCloser(
    identity: Identity,
    topic: TopicRow,
    proposal: { submitterId: string } | null,
  ) {
    const code = mayCloseTopic({
      isProposalTopic: proposal !== null,
      isAuthor: topic.authorId === identity.user.id,
      isReviewer: this.isReviewer(identity),
      isSubmitter: proposal?.submitterId === identity.user.id,
    });
    if (code) throw new AppError(code);
  }

  private async append(
    tx: Tx,
    topic: TopicRow,
    user: Pick<User, 'id'>,
    e: {
      kind: 'comment' | 'agreement' | 'close' | 'reopen';
      body: string;
      parentSeq?: number | null;
      agreesWith?: number | null;
      outcome?: 'resolved' | 'rejected' | 'on_hold';
      mentions?: string[];
      status: TopicStatus;
      closed?: { reason: string } | null;
    },
  ) {
    const seq = topic.version + 1;
    const now = new Date();
    await tx.discussionEvent.create({
      data: {
        topicId: topic.id,
        seq,
        kind: e.kind,
        authorId: user.id,
        body: e.body,
        parentSeq: e.parentSeq ?? null,
        agreesWith: e.agreesWith ?? null,
        outcome: e.outcome ?? null,
        mentions: e.mentions ?? [],
        bundleHash: topic.bundleHash,
        createdAt: now,
      },
    });
    const participants = [...new Set([...topic.participantIds, user.id, ...(e.mentions ?? [])])];
    // The WHERE on version makes a lost update impossible even without the row lock.
    const updated = await tx.topic.updateMany({
      where: { id: topic.id, version: topic.version },
      data: {
        version: seq,
        status: e.status,
        participantIds: participants,
        updatedAt: now,
        ...(e.closed !== undefined &&
          (e.closed
            ? { closedById: user.id, closeReason: e.closed.reason, closedAt: now }
            : { closedById: null, closeReason: null, closedAt: null })),
      },
    });
    if (updated.count !== 1) throw new AppError('DISCUSSION_CHANGED');
  }

  /**
   * Resolution returns a held proposal to its assignee (§7.5.6): once neither the topic nor the
   * dispute log blocks approval, the open assignment stays (or the last assignee's is reopened).
   */
  private async returnIfReleased(
    tx: Tx,
    proposal: { id: string; state: string; submitterId: string },
    actor: Pick<User, 'id' | 'kind'>,
  ) {
    if (proposal.state !== 'pending') return;
    const state = await stateOf(tx, proposal.id);
    if (state.disputed) return;
    let assignment = await tx.assignment.findFirst({
      where: { proposalId: proposal.id, closedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!assignment) {
      const last = await tx.assignment.findFirst({
        where: { proposalId: proposal.id },
        orderBy: { createdAt: 'desc' },
      });
      const assigneeId = last?.assigneeId ?? (await chooseAssignee(tx, proposal.submitterId))?.id;
      if (assigneeId) {
        assignment = await tx.assignment.create({
          data: { proposalId: proposal.id, assigneeId, reason: 'discussion_resolved' },
        });
        await audit(tx, actor, 'proposal.assigned', 'proposal', proposal.id, {
          assigneeId,
          reason: 'discussion_resolved',
        });
      }
    }
    await audit(tx, actor, 'proposal.returned', 'proposal', proposal.id, {
      assigneeId: assignment?.assigneeId ?? null,
      discussionVersion: state.discussionVersion,
      disputeVersion: state.disputeVersion,
    });
  }

  // ---- proposal discussion ------------------------------------------------------------------

  async proposalDiscussion(identity: Identity, slug: string): Promise<Wire<ProposalDiscussionDto>> {
    const p = await this.visibleProposal(identity, slug);
    const state = await stateOf(this.db, p.id);
    const topic = state.topicId
      ? await this.db.topic.findUniqueOrThrow({
          where: { id: state.topicId },
          include: topicInclude,
        })
      : null;
    return {
      slug: p.slug,
      bundleHash: p.bundleHash,
      state: p.state,
      discussionVersion: state.discussionVersion,
      disputeVersion: state.disputeVersion,
      held: state.held,
      disputeOpen: state.disputeOpen,
      disputed: state.disputed,
      topic: topic ? await this.detailOf(topic, identity) : null,
      disputes: await this.disputeLog(p),
    };
  }

  async openProposalDiscussion(
    identity: Identity,
    slug: string,
    input: ProposalDiscussionInput,
  ): Promise<Wire<ProposalDiscussionDto>> {
    this.require(identity, 'topic.open');
    const seen = await this.visibleProposal(identity, slug);
    const user = identity.user;
    const manifest = parseManifest(seen);
    const baseVersion = manifest.context.target.version;
    const anchor = input.anchor ?? seen.section;
    const created = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${seen.id}::uuid FOR UPDATE`;
      const p = await tx.proposal.findUniqueOrThrow({ where: { id: seen.id } });
      if (p.state !== 'pending' || input.bundleHash !== p.bundleHash)
        throw new AppError(
          'PRECONDITION_FAILED',
          'A discussion requires the current pending proposal (bundle hash as read)',
        );
      if (await tx.topic.findUnique({ where: { proposalId: p.id } }))
        throw new AppError('ALREADY_EXISTS', 'The proposal already has a discussion; reply to it');
      if (anchor !== null) {
        const known =
          baseVersion !== null &&
          (await tx.pageSection.findUnique({
            where: {
              path_versionLabel_anchor: { path: p.targetPath, versionLabel: baseVersion, anchor },
            },
          })) !== null;
        if (!known && anchor !== p.section)
          throw invalid('anchor', 'UNKNOWN_SECTION', 'No such section in the base version');
      }
      const mentions = await this.checkMentions(tx, input.mentions);
      const title = (input.title ?? `Discussion: ${p.title}`).slice(0, TITLE_LIMIT);
      const topic = await tx.topic.create({
        data: {
          path: p.targetPath,
          anchor,
          versionLabel: baseVersion,
          title,
          authorId: user.id,
          proposalId: p.id,
          bundleHash: p.bundleHash,
          participantIds: [...new Set([user.id, ...mentions])],
          entries: {
            create: {
              seq: 1,
              kind: 'open',
              authorId: user.id,
              body: input.body,
              mentions,
              bundleHash: p.bundleHash,
            },
          },
        },
        include: topicInclude,
      });
      await audit(tx, user, 'topic.opened', 'topic', topic.id, {
        path: p.targetPath,
        anchor,
        proposalSlug: p.slug,
      });
      await audit(tx, user, 'proposal.discussion_opened', 'proposal', p.id, {
        topicId: topic.id,
        discussionVersion: 1,
      });
      return topic;
    });
    this.emitTopic(created);
    return this.proposalDiscussion(identity, slug);
  }

  // ---- disputes -----------------------------------------------------------------------------

  private async disputeLog(p: { id: string; slug: string; bundleHash: string }) {
    const events = await this.db.disputeEvent.findMany({
      where: { proposalId: p.id },
      orderBy: { seq: 'asc' },
      include: { actor: userSelect },
    });
    const state = discussionSummary(null, events);
    return {
      slug: p.slug,
      bundleHash: p.bundleHash,
      disputeVersion: state.disputeVersion,
      disputeOpen: state.disputeOpen,
      events: events.map((e) => ({
        seq: e.seq,
        action: e.action,
        actor: userRef(e.actor),
        reason: e.reason,
        resolutionKind: e.resolutionKind as Wire<DisputeLogDto>['events'][number]['resolutionKind'],
        relatedSlugs: e.relatedSlugs,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async disputes(identity: Identity, slug: string): Promise<Wire<DisputeLogDto>> {
    return this.disputeLog(await this.visibleProposal(identity, slug));
  }

  async recordDispute(identity: Identity, slug: string, input: DisputeInput) {
    this.require(identity, 'dispute.write');
    const seen = await this.visibleProposal(identity, slug);
    const user = identity.user;
    const participants = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${seen.id}::uuid FOR UPDATE`;
      const p = await tx.proposal.findUniqueOrThrow({ where: { id: seen.id } });
      if (p.state !== 'pending' || input.bundleHash !== p.bundleHash)
        throw new AppError(
          'PRECONDITION_FAILED',
          'A dispute requires the current pending proposal (bundle hash as read)',
        );
      if (p.submitterId === user.id) throw new AppError('SELF_REVIEW');
      const events = await tx.disputeEvent.findMany({
        where: { proposalId: p.id },
        orderBy: { seq: 'asc' },
        select: { seq: true, action: true },
      });
      const version = events.at(-1)?.seq ?? 0;
      if (input.disputeVersion !== version)
        throw new AppError('DISCUSSION_CHANGED', 'The dispute log changed; reread the proposal');
      const step = disputeStep(events, {
        action: input.action,
        resolutionKind: input.resolutionKind ?? null,
        relatedSlugs: input.relatedSlugs ?? [],
      });
      if (step)
        throw step.field
          ? invalid(step.field, step.code, step.detail)
          : new AppError(step.code, step.detail);
      await tx.disputeEvent.create({
        data: {
          proposalId: p.id,
          seq: version + 1,
          actorId: user.id,
          action: input.action,
          reason: input.reason,
          resolutionKind: input.resolutionKind ?? null,
          relatedSlugs: input.relatedSlugs ?? [],
          bundleHash: p.bundleHash,
        },
      });
      await audit(tx, user, `dispute.${input.action}`, 'proposal', p.id, {
        disputeVersion: version + 1,
        resolutionKind: input.resolutionKind ?? null,
        relatedSlugs: input.relatedSlugs ?? [],
      });
      if (input.action === 'resolve') await this.returnIfReleased(tx, p, user);
      const topic = await tx.topic.findUnique({ where: { proposalId: p.id } });
      return { version: version + 1, participants: topic?.participantIds ?? [], p };
    });
    this.events.discussion({
      path: seen.targetPath,
      version: participants.version,
      proposal: {
        slug: seen.slug,
        submitterId: seen.submitterId,
        participants: participants.participants,
      },
    });
    this.events.proposal(seen.slug, seen.submitterId, participants.p.state);
    return this.disputeLog(seen);
  }
}

/** The decision's view of discussions (§7.4.3 steps 7 and 9); `tx` holds the proposal lock. */
export async function stateOf(tx: Tx, proposalId: string) {
  const [topic, disputes] = await Promise.all([
    tx.topic.findUnique({
      where: { proposalId },
      select: { id: true, proposalId: true, status: true, version: true },
    }),
    tx.disputeEvent.findMany({ where: { proposalId }, select: { seq: true, action: true } }),
  ]);
  return { ...discussionSummary(topic, disputes), topicId: topic?.id ?? null };
}
