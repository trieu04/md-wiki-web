import { Inject, Injectable } from '@nestjs/common';
import { inboxCounts, inboxTab, tabOfInboxKind, type InboxKind, type InboxTab } from '@md-wiki/domain';
import type { Identity } from '../auth/auth.service.js';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { userRef } from '../review/views.js';
import type { Wire } from '../wiki/read.dto.js';
import type { InboxDto, InboxInput, InboxItemDto } from './agent.dto.js';
import { INBOX_CHECK_ITEMS, type InboxCheckItems } from './ports.js';

type Item = Wire<InboxItemDto>;
type Entry = Item & { kindKey: InboxKind; atMs: number };
const DONE_WINDOW_MS = 30 * 86_400_000;
const userSelect = { id: true, name: true, kind: true } as const;

const encode = (n: number) => Buffer.from(`o:${String(n)}`).toString('base64url');
function decode(cursor: string | undefined): number {
  if (!cursor) return 0;
  const raw = Buffer.from(cursor, 'base64url').toString();
  const n = /^o:(\d{1,6})$/.exec(raw)?.[1];
  if (n === undefined)
    throw new AppError('VALIDATION_FAILED', undefined, [
      { path: 'cursor', code: 'invalid', message: 'Unknown cursor' },
    ]);
  return Number(n);
}

/**
 * F-08 Inbox (system-logic §7.8.8, D-215): everything waiting for the caller — proposals to
 * decide (agent hand-overs and plain assignments), discussion escalations, spot checks, mentions
 * and re-check items (Phase 9 port). `done` lists items finished in the last 30 days.
 */
@Injectable()
export class InboxService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(INBOX_CHECK_ITEMS) private readonly checks: InboxCheckItems,
  ) {}

  private async entries(userId: string, now: Date): Promise<Entry[]> {
    const since = new Date(now.getTime() - DONE_WINDOW_MS);
    const [assignments, escalations, spots, mentions, checks] = await Promise.all([
      this.db.assignment.findMany({
        where: {
          assigneeId: userId,
          OR: [{ closedAt: null }, { closedAt: { gte: since } }],
        },
        include: { proposal: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.db.escalation.findMany({
        where: {
          assigneeIds: { has: userId },
          OR: [{ resolvedAt: null }, { resolvedAt: { gte: since } }],
        },
        include: { proposal: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.db.spotCheck.findMany({
        where: {
          assigneeIds: { has: userId },
          OR: [{ outcome: null }, { decidedAt: { gte: since } }],
        },
        include: { proposal: true },
        orderBy: { sampledAt: 'desc' },
        take: 200,
      }),
      this.db.discussionEvent.findMany({
        where: { mentions: { has: userId }, createdAt: { gte: since }, authorId: { not: userId } },
        include: { topic: { include: { proposal: true } }, author: { select: userSelect } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.checks.forUser(userId),
    ]);
    const paths = new Set<string>([
      ...assignments.map((a) => a.proposal.targetPath),
      ...escalations.map((e) => e.proposal.targetPath),
      ...spots.map((s) => s.path),
      ...mentions.map((m) => m.topic.path),
      ...checks.map((c) => c.path),
    ]);
    const pages = await this.db.page.findMany({
      where: { path: { in: [...paths] } },
      select: { path: true, title: true },
    });
    const titleOf = (path: string) => pages.find((p) => p.path === path)?.title ?? path;
    const requesters = await this.db.user.findMany({
      where: { id: { in: escalations.map((e) => e.requestedById) } },
      select: userSelect,
    });
    const reviews = await this.db.agentReview.findMany({
      where: { escalationId: { in: escalations.map((e) => e.id) } },
      select: { escalationId: true, notes: true },
    });

    const out: Entry[] = [];
    const push = (kind: InboxKind, item: Omit<Item, 'kind' | 'tab'>) =>
      out.push({
        ...item,
        kind,
        tab: tabOfInboxKind(kind),
        kindKey: kind,
        atMs: Date.parse(item.at),
      });

    const escalatedProposals = new Set(
      escalations.filter((e) => e.kind === 'rereview').map((e) => e.proposalId),
    );
    for (const a of assignments) {
      // A re-review assignment is shown through its escalation row (it carries the triggers).
      if (a.reason === 'escalation' && escalatedProposals.has(a.proposalId)) continue;
      const done = a.closedAt !== null || a.proposal.state !== 'pending';
      push('review', {
        id: `review:${a.id}`,
        done,
        title: a.proposal.title,
        path: a.proposal.targetPath,
        pageTitle: titleOf(a.proposal.targetPath),
        anchor: a.proposal.section,
        proposal: { slug: a.proposal.slug, title: a.proposal.title, state: a.proposal.state },
        topicId: null,
        spotCheckId: null,
        why: a.reason === 'escalation' ? 'Escalated to you as a page author' : 'Assigned to you',
        triggers: a.trigger ? a.trigger.split(',') : [],
        agentNotes: null,
        from: null,
        at: a.createdAt.toISOString(),
        reminders: 0,
        action: 'decide',
      });
    }
    for (const e of escalations) {
      const requester = requesters.find((u) => u.id === e.requestedById);
      push(e.kind === 'rereview' ? 'rereview' : 'discussion', {
        id: `${e.kind}:${e.id}`,
        done: e.resolvedAt !== null || e.proposal.state !== 'pending',
        title: e.proposal.title,
        path: e.proposal.targetPath,
        pageTitle: titleOf(e.proposal.targetPath),
        anchor: e.proposal.section,
        proposal: { slug: e.proposal.slug, title: e.proposal.title, state: e.proposal.state },
        topicId: e.topicId,
        spotCheckId: null,
        why:
          e.kind === 'rereview'
            ? 'The reviewer asks you, as a page author, to decide'
            : 'The reviewer opened a discussion with the page authors',
        triggers: e.triggers,
        agentNotes:
          requester?.kind === 'agent'
            ? (reviews.find((r) => r.escalationId === e.id)?.notes ?? e.notes)
            : null,
        from: requester ? userRef(requester) : null,
        at: e.createdAt.toISOString(),
        reminders: e.reminders,
        action: e.kind === 'rereview' ? 'decide' : 'discuss',
      });
    }
    for (const s of spots)
      push('spot_check', {
        id: `spot_check:${s.id}`,
        done: s.outcome !== null,
        title: s.proposal.title,
        path: s.path,
        pageTitle: titleOf(s.path),
        anchor: s.proposal.section,
        proposal: { slug: s.proposal.slug, title: s.proposal.title, state: s.proposal.state },
        topicId: null,
        spotCheckId: s.id,
        why: 'Spot check of an agent approval (published)',
        triggers: [],
        agentNotes: null,
        from: null,
        at: s.sampledAt.toISOString(),
        reminders: 0,
        action: 'spot_check',
      });
    for (const m of mentions) {
      const closed = m.topic.status === 'resolved' || m.topic.status === 'rejected';
      push('mention', {
        id: `mention:${m.id}`,
        done: closed,
        title: m.topic.title,
        path: m.topic.path,
        pageTitle: titleOf(m.topic.path),
        anchor: m.topic.anchor,
        proposal: m.topic.proposal
          ? {
              slug: m.topic.proposal.slug,
              title: m.topic.proposal.title,
              state: m.topic.proposal.state,
            }
          : null,
        topicId: m.topicId,
        spotCheckId: null,
        why: 'You were mentioned',
        triggers: [],
        agentNotes: null,
        from: userRef(m.author),
        at: m.createdAt.toISOString(),
        reminders: 0,
        action: 'reply',
      });
    }
    for (const c of checks)
      push('check', {
        id: `check:${c.id}`,
        done: c.done,
        title: c.title,
        path: c.path,
        pageTitle: titleOf(c.path),
        anchor: c.anchor,
        proposal: null,
        topicId: null,
        spotCheckId: null,
        why: c.why,
        triggers: [],
        agentNotes: null,
        from: null,
        at: c.at.toISOString(),
        reminders: 0,
        action: 'open',
      });
    return out;
  }

  async inbox(identity: Identity, input: InboxInput, now = new Date()): Promise<Wire<InboxDto>> {
    const tab: InboxTab = input.tab ?? 'all';
    const limit = input.limit ?? 25;
    const offset = decode(input.cursor);
    const all = await this.entries(identity.user.id, now);
    const shaped = all.map((e) => ({ ...e, kind: e.kindKey, at: e.atMs, id: e.id }));
    const counts = inboxCounts(shaped);
    const ordered = inboxTab(shaped, tab);
    const page = ordered.slice(offset, offset + limit);
    const byId = new Map(all.map((e) => [e.id, e]));
    return {
      items: page.map((e) => {
        const item: Partial<Entry> = { ...(byId.get(e.id) as Entry) };
        delete item.kindKey;
        delete item.atMs;
        return item as Item;
      }),
      nextCursor: offset + limit < ordered.length ? encode(offset + limit) : null,
      counts,
    };
  }
}
