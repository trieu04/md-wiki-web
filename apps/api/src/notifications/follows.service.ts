import { Inject, Injectable } from '@nestjs/common';
import { can } from '@md-wiki/domain';
import type { FollowReason, Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  currentPages,
  offsetCursor,
  offsetOf,
  pageLabels,
} from '../wiki/current-sections.js';
import type { Wire } from '../wiki/read.dto.js';
import { SectionLabels } from '../wiki/section-labels.js';
import { wikiPath } from '../wiki/storage/wiki-storage.js';
import type {
  FollowDto,
  FollowedPagesDto,
  FollowInput,
  PageListInput,
  UnfollowInput,
} from './notifications.dto.js';

type Tx = Prisma.TransactionClient;
type FollowRow = Prisma.FollowGetPayload<object>;

export function requireHuman(identity: Identity, action: 'follow' | 'attest' | 'report' | 'feedback') {
  const decision = can(
    { kind: identity.user.kind, roles: identity.user.roles, auth: identity },
    action,
    { isOwnSectionVersion: false },
  );
  if (!decision.ok) throw new AppError(decision.code);
}

const followDto = (f: FollowRow): Wire<FollowDto> => ({
  path: f.path,
  anchor: f.anchor === '' ? null : f.anchor,
  reason: f.reason,
  muted: f.mutedAt !== null,
  createdAt: f.createdAt.toISOString(),
});

/** Follows and mute (system-logic §7.7.9, D-171). */
@Injectable()
export class FollowsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(SectionLabels) private readonly labels: SectionLabels,
  ) {}

  async follow(identity: Identity, input: FollowInput): Promise<Wire<FollowDto>> {
    requireHuman(identity, 'follow');
    const path = wikiPath(input.path).path;
    const pages = await currentPages(this.db, [path]);
    const page = pages.get(path);
    if (!page) throw new AppError('NOT_FOUND', 'No such page');
    const anchor = input.anchor ?? '';
    if (anchor && !page.sections.some((s) => s.anchor === anchor))
      throw new AppError('NOT_FOUND', 'No such section');
    const muted =
      input.muted === undefined ? undefined : input.muted ? new Date() : null;
    const row = await this.db.follow.upsert({
      where: { userId_path_anchor: { userId: identity.user.id, path, anchor } },
      create: { userId: identity.user.id, path, anchor, reason: 'manual', mutedAt: muted ?? null },
      update: muted === undefined ? {} : { mutedAt: muted },
    });
    return followDto(row);
  }

  async unfollow(identity: Identity, input: UnfollowInput) {
    requireHuman(identity, 'follow');
    const path = wikiPath(input.path).path;
    const removed = await this.db.follow.deleteMany({
      where: { userId: identity.user.id, path, anchor: input.anchor ?? '' },
    });
    if (!removed.count) throw new AppError('NOT_FOUND', 'Not following');
  }

  /** Follow unless a follow exists (a muted follow stays muted). True when the page is followed. */
  async autoFollow(tx: Tx, userId: string, path: string, reason: FollowReason) {
    await tx.follow.createMany({
      data: [{ userId, path, anchor: '', reason }],
      skipDuplicates: true,
    });
    return true;
  }

  async isFollowing(userId: string, path: string, db: Tx | PrismaService = this.db) {
    return (await db.follow.count({ where: { userId, path, anchor: '' } })) > 0;
  }

  async mine(identity: Identity, input: PageListInput): Promise<Wire<FollowedPagesDto>> {
    requireHuman(identity, 'follow');
    const limit = input.limit ?? 25;
    const offset = offsetOf(input.cursor);
    const rows = await this.db.follow.findMany({
      where: { userId: identity.user.id },
      orderBy: [{ createdAt: 'desc' }, { path: 'asc' }, { anchor: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const pages = await currentPages(
      this.db,
      page.map((f) => f.path),
    );
    const labels = await pageLabels(this.labels, pages.values());
    const paths = [...pages.keys()];
    const [snapshots, publications, checks] = await Promise.all([
      this.db.snapshot.findMany({
        where: { path: { in: paths } },
        orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
        distinct: ['path'],
        select: { path: true, label: true, capturedAt: true },
      }),
      this.db.publication.findMany({
        where: { targetPath: { in: paths }, phase: 'done' },
        select: { targetPath: true, versionLabel: true, proposal: { select: { title: true } } },
      }),
      this.db.attestation.findMany({
        where: {
          actorId: identity.user.id,
          kind: 'checked',
          path: { in: paths },
          NOT: { id: { in: await this.withdrawnIds(identity.user.id) } },
        },
        select: { path: true, anchor: true, sectionHash: true },
      }),
    ]);
    return {
      items: page.flatMap((f) => {
        const current = pages.get(f.path);
        if (!current) return [];
        const label = labels.get(f.path);
        const snap = snapshots.find((s) => s.path === f.path);
        const mineHere = checks.filter((c) => c.path === f.path);
        const checkAgain = current.sections.filter(
          (s) =>
            mineHere.some((c) => c.anchor === s.anchor && c.sectionHash !== s.sectionHash) &&
            !mineHere.some((c) => c.anchor === s.anchor && c.sectionHash === s.sectionHash),
        );
        return [
          {
            ...followDto(f),
            pageTitle: current.title,
            pageLabel: {
              label: label?.label ?? 'not_reviewed',
              spread: label?.spread ?? { checked: 0, reviewed: 0, not_reviewed: 0, recheck: 0, error: 0 },
            },
            lastChange: {
              versionLabel: snap?.label ?? current.versionLabel,
              at: (snap?.capturedAt ?? current.updatedAt).toISOString(),
              summary:
                publications.find(
                  (p) => p.targetPath === f.path && p.versionLabel === (snap?.label ?? current.versionLabel),
                )?.proposal.title ?? null,
            },
            checkAgain: checkAgain.map((s) => ({ anchor: s.anchor, title: s.title })),
          },
        ];
      }),
      nextCursor: rows.length > limit ? offsetCursor(offset + limit) : null,
    };
  }

  private async withdrawnIds(userId: string) {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM "Attestation" a JOIN "AttestationEvent" e ON e."attestationId" = a.id
      WHERE a."actorId" = ${userId}::uuid AND e.status = 'withdrawn'`;
    return rows.map((r) => r.id);
  }
}
