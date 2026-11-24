import { Inject, Injectable } from '@nestjs/common';
import {
  can,
  descendants,
  LABEL_ORDER,
  sectionKeyOf,
  type Action,
  type LabelDto,
} from '@md-wiki/domain';
import type { FlagCause, Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { AppError } from '../common/app-error.js';
import { EventsService } from '../events/events.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { actorOf } from '../review/views.js';
import { currentPages, type CurrentPage } from '../wiki/current-sections.js';
import { PageAuthors } from '../wiki/page-authors.js';
import type { Wire } from '../wiki/read.dto.js';
import type { SectionKey } from '../wiki/section-evidence.js';
import { SectionLabels } from '../wiki/section-labels.js';
import type { SectionKeyDto } from './credibility.dto.js';

export type Tx = Prisma.TransactionClient;
export type Db = Tx | PrismaService;
export const notReviewed: LabelDto = {
  label: 'not_reviewed',
  since: null,
  reviewerKind: null,
  reason: null,
};
const pointOf = (k: { path: string; anchor: string }) => `${k.path}\0${k.anchor}`;

/**
 * Shared credibility helpers (system-logic §7.7): permission facts, authorship of a section
 * version, labels after a write, propagation of re-check flags and `section_recheck` notices.
 */
@Injectable()
export class CredibilityCore {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(SectionLabels) readonly labels: SectionLabels,
    @Inject(PageAuthors) readonly authors: PageAuthors,
    @Inject(NotificationsService) readonly notifications: NotificationsService,
    @Inject(EventsService) readonly events: EventsService,
  ) {}

  allowed(identity: Identity, action: Action, ctx: Parameters<typeof can>[2] = {}) {
    return can(actorOf(identity), action, ctx);
  }
  require(identity: Identity, action: Action, ctx: Parameters<typeof can>[2] = {}) {
    const decision = this.allowed(identity, action, ctx);
    if (!decision.ok) throw new AppError(decision.code);
  }
  /** Role gate only (the resource facts are checked later in the documented order). */
  requireRole(identity: Identity, action: 'attest' | 'report' | 'feedback' | 'follow') {
    this.require(identity, action, { isOwnSectionVersion: false });
  }

  async isPageAuthor(identity: Identity, path: string, db: Db = this.db) {
    return this.authors.isAuthor(path, identity.user, db);
  }
  async mayDecide(identity: Identity, path: string, db: Db = this.db) {
    if (!can(actorOf(identity), 'credibility.decide', { isPageAuthor: true }).ok) return false;
    return this.isPageAuthor(identity, path, db);
  }
  async requireDecide(identity: Identity, path: string, db: Db = this.db) {
    this.require(identity, 'credibility.decide', {
      isPageAuthor: await this.isPageAuthor(identity, path, db),
    });
  }

  /** Submitters and human reviewers of the `done` publications that produced this hash (D-166). */
  async authorship(key: SectionKey, db: Db = this.db) {
    const rows = await db.publishedSection.findMany({
      where: { path: key.path, anchor: key.anchor, sectionHash: key.sectionHash },
      select: {
        publication: {
          select: {
            phase: true,
            proposal: { select: { submitterId: true } },
            decision: { select: { reviewerId: true, reviewerKind: true } },
          },
        },
      },
    });
    const done = rows.filter((r) => r.publication.phase === 'done');
    return {
      submitters: new Set(done.map((r) => r.publication.proposal.submitterId)),
      reviewers: new Set(
        done
          .filter((r) => r.publication.decision.reviewerKind === 'person')
          .map((r) => r.publication.decision.reviewerId),
      ),
    };
  }

  async labelOf(key: SectionKey, db: Db = this.db): Promise<LabelDto> {
    return (await this.labels.forSections([key], db))[0] ?? notReviewed;
  }

  /** Section keys with page/section titles and the current label. */
  async keyDtos(keys: readonly SectionKey[], db: Db = this.db): Promise<Wire<SectionKeyDto>[]> {
    if (!keys.length) return [];
    const pages = await currentPages(
      db,
      keys.map((k) => k.path),
    );
    const titles = await db.pageSection.findMany({
      where: { OR: keys.map((k) => ({ path: k.path, anchor: k.anchor, sectionHash: k.sectionHash })) },
      select: { path: true, anchor: true, sectionHash: true, title: true },
    });
    const labels = await this.labels.forSections(keys, db);
    return keys.map((k, i) => ({
      path: k.path,
      pageTitle: pages.get(k.path)?.title ?? k.path,
      anchor: k.anchor,
      sectionTitle:
        titles.find((t) => t.path === k.path && t.anchor === k.anchor && t.sectionHash === k.sectionHash)
          ?.title ?? null,
      sectionHash: k.sectionHash,
      label: labels[i] ?? notReviewed,
    }));
  }

  /** Current section keys of `(path, anchor)` points (points that no longer exist are dropped). */
  async currentKeys(points: readonly { path: string; anchor: string }[], db: Db = this.db) {
    const pages = await currentPages(
      db,
      points.map((p) => p.path),
    );
    return points.flatMap((p) => {
      const s = pages.get(p.path)?.sections.find((x) => x.anchor === p.anchor);
      return s ? [{ path: p.path, anchor: p.anchor, sectionHash: s.sectionHash }] : [];
    });
  }

  /**
   * Transitive descendants of the roots (system-logic §7.7.8, D-178): proposals citing a page as
   * a `source` derive the sections they published from it; confirmed `copy` edges derive the
   * destination section. Returns current keys with their depth.
   */
  async downstream(roots: readonly { path: string; anchor: string }[], db: Db = this.db) {
    if (!roots.length) return [];
    const edges = await this.derivationEdges(roots, db);
    const found = descendants(roots.map(pointOf), edges);
    const points = found.map((f) => {
      const [path = '', anchor = ''] = f.key.split('\0');
      return { path, anchor, depth: f.depth };
    });
    const keys = await this.currentKeys(points, db);
    return keys.map((k) => ({
      ...k,
      depth: points.find((p) => p.path === k.path && p.anchor === k.anchor)?.depth ?? 1,
    }));
  }

  /**
   * Derivation edges `from → to` (`path\0anchor` points): source refs of published proposals and
   * confirmed `copy` edges. `roots` adds anchors of sections that no longer exist.
   */
  async derivationEdges(roots: readonly { path: string; anchor: string }[], db: Db = this.db) {
    const refs = await db.$queryRaw<
      { srcPath: string; dstPath: string; section: string | null; anchor: string }[]
    >`
      SELECT DISTINCT s.path AS "srcPath", pub."targetPath" AS "dstPath", p.section, ps.anchor
      FROM "ProposalRef" r
      JOIN "Snapshot" s ON s.id = r."snapshotId"
      JOIN "Proposal" p ON p.id = r."proposalId"
      JOIN "Publication" pub ON pub."proposalId" = p.id AND pub.phase = 'done'
      JOIN "PublishedSection" ps ON ps."publicationId" = pub.id
      WHERE r.role = 'source' AND (p.section IS NULL OR p.section = ps.anchor)`;
    const copies = await db.credibilityEdge.findMany({ where: { kind: 'copy' } });
    const srcPaths = [...new Set(refs.map((r) => r.srcPath))];
    const srcPages = await currentPages(db, srcPaths);
    const edges: { from: string; to: string }[] = [];
    for (const r of refs) {
      if (r.srcPath === r.dstPath) continue;
      const to = pointOf({ path: r.dstPath, anchor: r.anchor });
      // Every section of the cited page (current or a root that no longer exists) derives `to`.
      const anchors = new Set([
        ...(srcPages.get(r.srcPath)?.sections.map((s) => s.anchor) ?? []),
        ...roots.filter((x) => x.path === r.srcPath).map((x) => x.anchor),
      ]);
      for (const a of anchors) edges.push({ from: pointOf({ path: r.srcPath, anchor: a }), to });
    }
    for (const c of copies)
      edges.push({
        from: pointOf({ path: c.srcPath, anchor: c.srcAnchor }),
        to: pointOf({ path: c.dstPath, anchor: c.dstAnchor }),
      });
    return edges;
  }

  /** Flag sections (and notify followers of their pages). Returns the flagged keys. */
  async flag(
    tx: Tx,
    keys: readonly (SectionKey & { depth?: number })[],
    flag: { cause: FlagCause; causeId: string | null; reason: string },
  ) {
    const unique = [...new Map(keys.map((k) => [sectionKeyOf(k), k])).values()];
    if (!unique.length) return [];
    await tx.recheckFlag.createMany({
      data: unique.map((k) => ({
        path: k.path,
        anchor: k.anchor,
        sectionHash: k.sectionHash,
        cause: flag.cause,
        causeId: flag.causeId,
        reason: flag.reason,
        depth: k.depth ?? 0,
      })),
    });
    await this.notifyRecheck(tx, unique, flag.reason, flag.cause);
    return unique;
  }

  async notifyRecheck(tx: Tx, keys: readonly SectionKey[], reason: string, cause: string, except: string[] = []) {
    const followers = await this.notifications.followers(
      tx,
      keys.map((k) => k.path),
      except,
    );
    for (const key of keys)
      await this.notifications.notify(tx, {
        userIds: followers.get(key.path) ?? [],
        event: 'section_recheck',
        path: key.path,
        anchor: key.anchor,
        text: `A section went under re-check: ${reason}`,
        data: { cause },
      });
  }

  /** Propagate a problem at `roots` to every descendant (one flag per descendant). */
  async propagate(tx: Tx, roots: readonly { path: string; anchor: string }[], causeId: string, reason: string) {
    const down = await this.downstream(roots, tx);
    const rootSet = new Set(roots.map(pointOf));
    return this.flag(
      tx,
      down.filter((d) => !rootSet.has(pointOf(d))),
      { cause: 'propagated', causeId, reason: `Derived from a section with a problem: ${reason}` },
    );
  }

  emitPages(paths: Iterable<string>) {
    for (const path of new Set(paths)) this.events.page(path);
  }

  async pageMap(paths: readonly string[], db: Db = this.db): Promise<Map<string, CurrentPage>> {
    return currentPages(db, paths);
  }
}

export const emptySpread = () =>
  Object.fromEntries(LABEL_ORDER.map((l) => [l, 0])) as Record<(typeof LABEL_ORDER)[number], number>;
