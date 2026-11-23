import { Inject, Injectable } from '@nestjs/common';
import {
  can,
  conflictView,
  decisionId,
  OPEN_PHASES,
  pageTitle,
  renderArtifact,
  reviewerKindOf,
  sha256Hex,
  tabOf,
  type PermissionActor,
} from '@md-wiki/domain';
import type { Prisma, User } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { parseManifest, ContributionViews } from '../contributions/views.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import { decodeMarkdown } from '../wiki/storage/wiki-storage.js';
import { chooseAssignee } from './assignments.js';
import { DISCUSSION_STATE, type DiscussionState } from './ports.js';
import type {
  ConflictDto,
  ConflictResolutionDto,
  ProposalDetailDto,
  ProposalEventDto,
  ProposalListItemDto,
  PublicationDto,
  UserRefDto,
} from './review.dto.js';

const OPEN = [...OPEN_PHASES];
const isOpen = (phase: string) => (OPEN as string[]).includes(phase);
const userSelect = { select: { id: true, name: true, kind: true } } as const;
export const detailInclude = {
  submitter: userSelect,
  decision: { include: { reviewer: userSelect } },
  assignments: {
    where: { closedAt: null },
    include: { assignee: userSelect },
    orderBy: { createdAt: 'asc' },
  },
  publications: {
    include: { actor: userSelect, resolution: { include: { actor: userSelect } } },
    orderBy: { attempt: 'desc' },
  },
  withdrawal: true,
  conflict: { include: { actor: userSelect, replacement: { select: { slug: true } } } },
  refs: {
    include: { snapshot: { select: { path: true, label: true, sha256: true } } },
    orderBy: { ord: 'asc' },
  },
} satisfies Prisma.ProposalInclude;
export type DetailRow = Prisma.ProposalGetPayload<{ include: typeof detailInclude }>;
type UserRef = Pick<User, 'id' | 'name' | 'kind'>;

export const userRef = (u: UserRef): Wire<UserRefDto> => ({ id: u.id, name: u.name, kind: u.kind });
export const actorOf = (identity: Identity): PermissionActor => ({
  kind: identity.user.kind,
  roles: identity.user.roles,
  auth:
    identity.kind === 'token' ? { kind: 'token', scopes: identity.scopes } : { kind: 'session' },
});
export const mayRead = (identity: Identity) => can(actorOf(identity), 'proposal.read', {}).ok;

function publicationDto(p: DetailRow['publications'][number]): Wire<PublicationDto> {
  const receipt = p.receipt as { id?: string } | null;
  return {
    id: p.id,
    attempt: p.attempt,
    phase: p.phase,
    auto: p.auto,
    actor: p.actor ? userRef(p.actor) : null,
    baseSha256: p.baseSha256,
    artifactHash: p.artifactHash,
    receiptId: receipt?.id ?? null,
    error: p.error,
    versionLabel: p.versionLabel,
    startedAt: p.startedAt.toISOString(),
    writtenAt: p.writtenAt?.toISOString() ?? null,
    finishedAt: p.finishedAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
    resolution: p.resolution
      ? {
          outcome: p.resolution.outcome,
          evidence: p.resolution.evidence,
          actor: userRef(p.resolution.actor),
          diskSha256: p.resolution.diskSha256,
          createdAt: p.resolution.createdAt.toISOString(),
        }
      : null,
  };
}

export function conflictResolutionDto(
  c: NonNullable<DetailRow['conflict']>,
): Wire<ConflictResolutionDto> {
  return {
    outcome: c.outcome,
    actor: userRef(c.actor),
    reason: c.reason,
    baseSha256: c.baseSha256,
    currentSha256: c.currentSha256,
    replacementSlug: c.replacement?.slug ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** The preview a caller would approve (system-logic §7.4.3). */
export function previewFor(
  proposal: Pick<DetailRow, 'id' | 'slug' | 'proposed'>,
  viewer: Pick<User, 'id' | 'kind'>,
  previewAt: string,
) {
  const id = decisionId(proposal.id, viewer.id, previewAt);
  const reviewerKind = reviewerKindOf(viewer.kind);
  const bytes = renderArtifact(
    { slug: proposal.slug, decisionId: id, reviewerKind, previewAt },
    proposal.proposed,
  );
  return { decisionId: id, reviewerKind, bytes, artifactHash: sha256Hex(bytes) };
}

/** Read models for review (no storage IO: current versions come from the index). */
@Injectable()
export class ReviewViews {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ContributionViews) private readonly contributions: ContributionViews,
    @Inject(DISCUSSION_STATE) private readonly discussions: DiscussionState,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  load(where: Prisma.ProposalWhereUniqueInput) {
    return this.db.proposal.findUnique({ where, include: detailInclude });
  }

  async currentOf(path: string) {
    const page = await this.db.page.findUnique({ where: { path } });
    if (!page) return null;
    const snapshot = await this.db.snapshot.findUnique({
      where: { path_label: { path, label: page.currentVersionLabel } },
    });
    return snapshot
      ? {
          page,
          versionLabel: page.currentVersionLabel,
          sha256: page.currentSha256,
          content: Buffer.from(snapshot.content),
        }
      : null;
  }

  /** §7.4.7: a pending or stale proposal whose target moved on since its base. */
  hasConflict(state: string, baseSha: string | null, currentSha: string | null) {
    return (
      (state === 'pending' || state === 'stale') && currentSha !== baseSha && currentSha !== null
    );
  }

  async conflict(
    row: DetailRow,
    current: Awaited<ReturnType<ReviewViews['currentOf']>>,
  ): Promise<Wire<ConflictDto> | null> {
    if (!this.hasConflict(row.state, row.baseSha256, current?.sha256 ?? null) && !row.conflict)
      return null;
    const base = row.base ? decodeMarkdown(Buffer.from(row.base)) : null;
    const currentText = current ? decodeMarkdown(current.content) : null;
    const view = conflictView(
      base,
      currentText,
      decodeMarkdown(Buffer.from(row.proposed)),
      row.section,
    );
    const manifest = parseManifest(row);
    const publishedBy = current
      ? await this.db.publication.findFirst({
          where: { targetPath: row.targetPath, phase: 'done', artifactHash: current.sha256 },
          orderBy: { finishedAt: 'desc' },
          include: {
            proposal: { select: { slug: true } },
            decision: { select: { reviewerKind: true } },
          },
        })
      : null;
    return {
      section: row.section,
      scope: view.scope,
      base:
        row.baseSha256 && manifest.context.target.version
          ? { versionLabel: manifest.context.target.version, sha256: row.baseSha256 }
          : null,
      current: current
        ? {
            versionLabel: current.versionLabel,
            sha256: current.sha256,
            publishedBy: publishedBy
              ? { slug: publishedBy.proposal.slug, reviewerKind: publishedBy.decision.reviewerKind }
              : null,
          }
        : null,
      baseText: view.baseText,
      currentText: view.currentText,
      proposedText: view.proposedText,
      resolution: row.conflict ? conflictResolutionDto(row.conflict) : null,
    };
  }

  /** May this viewer decide now (steps 1, 4–6 of §7.4.3, including the assignment self-heal)? */
  async mayDecide(row: DetailRow, identity: Identity) {
    if (row.state !== 'pending') return false;
    const user = identity.user;
    let assigned = row.assignments.some((a) => a.assigneeId === user.id);
    if (!assigned && row.assignments.length === 0)
      assigned = (await chooseAssignee(this.db, row.submitterId))?.id === user.id;
    return can(actorOf(identity), 'proposal.decide', {
      hasOpenAssignment: assigned,
      isOwnProposal: row.submitterId === user.id,
    }).ok;
  }

  async detail(row: DetailRow, identity: Identity): Promise<Wire<ProposalDetailDto>> {
    const user = identity.user;
    const base = await this.contributions.proposal(row);
    const current = await this.currentOf(row.targetPath);
    const latest = row.publications[0] ?? null;
    const [blocker, discussion, events, pages] = await Promise.all([
      this.db.publication.findFirst({
        where: { targetPath: row.targetPath, phase: { in: OPEN }, proposalId: { not: row.id } },
        include: { proposal: { select: { slug: true } } },
      }),
      this.discussions.state(this.db, row.id),
      this.db.auditEvent.findMany({
        where: { subjectType: 'proposal', subjectId: row.id },
        orderBy: [{ at: 'asc' }, { id: 'asc' }],
        include: { actor: userSelect },
      }),
      this.db.page.findMany({
        where: { path: { in: row.refs.map((r) => r.snapshot.path) } },
        select: { path: true, currentSha256: true, currentVersionLabel: true },
      }),
    ]);
    const pageOf = new Map(pages.map((p) => [p.path, p]));
    const manifest = parseManifest(row);
    const preview = row.state === 'pending' ? this.preview(row, user, discussion) : null;
    const actor = actorOf(identity);
    const isSubmitter = row.submitterId === user.id;
    const conflict = await this.conflict(row, current);
    const tab = tabOf(row.state, latest?.phase ?? null);
    return {
      ...base,
      tab,
      withdrawn: row.withdrawal
        ? { reason: row.withdrawal.reason, at: row.withdrawal.createdAt.toISOString() }
        : null,
      preview,
      final:
        row.artifact && row.artifactHash
          ? { artifact: Buffer.from(row.artifact).toString('utf8'), artifactHash: row.artifactHash }
          : null,
      assignment: row.assignments[0]
        ? {
            id: row.assignments[0].id,
            assignee: userRef(row.assignments[0].assignee),
            reason: row.assignments[0].reason,
            trigger: row.assignments[0].trigger,
            createdAt: row.assignments[0].createdAt.toISOString(),
          }
        : null,
      decisions: row.decision
        ? [
            {
              id: row.decision.id,
              reviewer: userRef(row.decision.reviewer),
              reviewerKind: row.decision.reviewerKind,
              approve: row.decision.approve,
              reason: row.decision.reason,
              bundleHash: row.decision.bundleHash,
              artifactHash: row.decision.artifactHash,
              previewAt: row.decision.previewAt.toISOString(),
              discussionVersion: row.decision.discussionVersion,
              disputeVersion: row.decision.disputeVersion,
              createdAt: row.decision.createdAt.toISOString(),
            },
          ]
        : [],
      publication: latest ? publicationDto(latest) : null,
      publications: row.publications.map(publicationDto),
      blockedBy: blocker ? { slug: blocker.proposal.slug, phase: blocker.phase } : null,
      refs: [
        {
          role: 'target' as const,
          path: row.targetPath,
          versionLabel: manifest.context.target.version,
          sha256: row.baseSha256,
          currentVersionLabel: current?.versionLabel ?? null,
          current: (current?.sha256 ?? null) === row.baseSha256,
        },
        ...row.refs
          .filter((r) => r.role !== 'target')
          .map((r) => ({
            role: r.role,
            path: r.snapshot.path,
            versionLabel: r.snapshot.label,
            sha256: r.snapshot.sha256,
            currentVersionLabel: pageOf.get(r.snapshot.path)?.currentVersionLabel ?? null,
            current: pageOf.get(r.snapshot.path)?.currentSha256 === r.snapshot.sha256,
          })),
      ],
      conflict,
      discussion,
      can: {
        decide: await this.mayDecide(row, identity),
        publish:
          can(actor, 'proposal.publish', { autoPublish: this.config.AUTO_PUBLISH }).ok &&
          row.state === 'approved' &&
          tab !== 'blocked' &&
          blocker === null,
        withdraw:
          isSubmitter &&
          can(actor, 'proposal.submit', {}).ok &&
          (row.state === 'pending' ||
            (row.state === 'approved' && !row.publications.some((p) => isOpen(p.phase)))),
        resolveConflict:
          conflict !== null &&
          conflict.resolution === null &&
          this.hasConflict(row.state, row.baseSha256, current?.sha256 ?? null) &&
          ((isSubmitter && can(actor, 'proposal.submit', {}).ok) || mayRead(identity)),
        resolveBlocked: can(actor, 'admin.recovery', {}).ok && latest?.phase === 'unknown',
      },
      history: events.map((e): Wire<ProposalEventDto> => ({
        id: e.id,
        at: e.at.toISOString(),
        action: e.action,
        actor: e.actor ? userRef(e.actor) : null,
        data: e.data as Record<string, unknown>,
      })),
    };
  }

  preview(
    row: DetailRow,
    viewer: Pick<User, 'id' | 'kind'>,
    discussion: { discussionVersion: number; disputeVersion: number },
  ) {
    const previewAt = new Date().toISOString();
    const p = previewFor(row, viewer, previewAt);
    return {
      artifact: Buffer.from(p.bytes).toString('utf8'),
      artifactHash: p.artifactHash,
      previewAt,
      decisionId: p.decisionId,
      reviewerKind: p.reviewerKind,
      binding: {
        bundleHash: row.bundleHash,
        artifactHash: p.artifactHash,
        previewAt,
        discussionVersion: discussion.discussionVersion,
        disputeVersion: discussion.disputeVersion,
      },
    };
  }

  /** F-09 rows (system-logic §7.4.8). */
  async listItems(rows: DetailRow[]): Promise<Wire<ProposalListItemDto>[]> {
    const pages = await this.db.page.findMany({
      where: { path: { in: [...new Set(rows.map((r) => r.targetPath))] } },
      select: { path: true, title: true, currentSha256: true },
    });
    const pageOf = new Map(pages.map((p) => [p.path, p]));
    const keys = rows.flatMap((r) => {
      const version = parseManifest(r).context.target.version;
      return r.section && version
        ? [{ path: r.targetPath, versionLabel: version, anchor: r.section }]
        : [];
    });
    const titles = keys.length
      ? await this.db.pageSection.findMany({
          where: { OR: keys },
          select: { path: true, versionLabel: true, anchor: true, title: true },
        })
      : [];
    const title = new Map(
      titles.map((t) => [`${t.path}\0${t.versionLabel}\0${t.anchor}`, t.title]),
    );
    return rows.map((r) => {
      const latest = r.publications[0] ?? null;
      const page = pageOf.get(r.targetPath);
      const version = parseManifest(r).context.target.version;
      const done = r.publications.find((p) => p.phase === 'done') ?? null;
      return {
        slug: r.slug,
        title: r.title,
        targetPath: r.targetPath,
        pageTitle: page?.title ?? pageTitle(r.targetPath, []),
        section: r.section,
        sectionTitle:
          r.section && version
            ? (title.get(`${r.targetPath}\0${version}\0${r.section}`) ?? null)
            : null,
        submitter: userRef(r.submitter),
        state: r.state,
        tab: tabOf(r.state, latest?.phase ?? null),
        phase: latest?.phase ?? null,
        withdrawn: r.withdrawal !== null,
        conflict: this.hasConflict(r.state, r.baseSha256, page?.currentSha256 ?? null),
        assignees: r.assignments.map((a) => userRef(a.assignee)),
        decision: r.decision
          ? {
              approve: r.decision.approve,
              reviewer: userRef(r.decision.reviewer),
              reviewerKind: r.decision.reviewerKind,
              at: r.decision.createdAt.toISOString(),
            }
          : null,
        publishedVersion: done?.versionLabel ?? null,
        autoPublished: done ? done.auto : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }
}
