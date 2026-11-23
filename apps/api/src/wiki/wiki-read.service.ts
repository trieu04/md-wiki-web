import { Inject, Injectable } from '@nestjs/common';
import { pageLabel, pageTitle, parseStatusBlock, type LabelDto } from '@md-wiki/domain';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WikiIndexer } from './indexer/wiki-indexer.js';
import {
  DEFAULT_LIMIT,
  type ContextDto,
  type HistoryDto,
  type PageDto,
  type RecentDto,
  type RecentInput,
  type SectionDto,
  type SnapshotPageInput,
  type TreeDto,
  type TreeTopicDto,
  type VersionPublicationDto,
  type Wire,
} from './read.dto.js';
import { PageAuthors } from './page-authors.js';
import { SectionLabels, type SectionKey } from './section-labels.js';
import { decodeMarkdown, wikiPath } from './storage/wiki-storage.js';
import { usedByTeams } from './usage.js';

// Use an explicit locale for human-readable names; use the ID/path as a stable tie-breaker.
export function byName(a: { name: string; id: string }, b: { name: string; id: string }) {
  return a.name.localeCompare(b.name, 'en') || compareKey(a.id, b.id);
}
export function compareKey(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function snapshotArgs({ cursor, limit = DEFAULT_LIMIT }: SnapshotPageInput) {
  return {
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    orderBy: [{ capturedAt: 'desc' as const }, { id: 'desc' as const }],
    take: limit + 1,
  };
}
function snapshotPage<T extends { id: string }>(rows: T[], limit = DEFAULT_LIMIT) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}
const notReviewed: LabelDto = {
  label: 'not_reviewed',
  since: null,
  reviewerKind: null,
  reason: null,
};
function validatedPath(input: unknown) {
  if (typeof input !== 'string') throw new AppError('INVALID_PATH');
  return wikiPath(input).path;
}

@Injectable()
export class WikiReadService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WikiIndexer) private readonly indexer: WikiIndexer,
    @Inject(SectionLabels) private readonly labels: SectionLabels,
    @Inject(PageAuthors) private readonly authors: PageAuthors,
  ) {}

  async tree(topic?: string): Promise<Wire<TreeDto>> {
    if (topic?.includes('\0')) return { topics: [] };
    const [pages, sections] = await this.db.$transaction(
      [
        this.db.page.findMany(topic === undefined ? undefined : { where: { topic } }),
        this.db.$queryRaw<SectionKey[]>`
        SELECT s.path, s.anchor, s."sectionHash"
        FROM "PageSection" s JOIN "Page" p
          ON p.path = s.path AND p."currentVersionLabel" = s."versionLabel"
        ${topic === undefined ? Prisma.empty : Prisma.sql`WHERE p.topic = ${topic}`}
      `,
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const byPath = new Map<string, LabelDto[]>();
    const sectionLabels = await this.labels.forSections(sections);
    for (const [i, section] of sections.entries()) {
      const labels = byPath.get(section.path) ?? [];
      labels.push(sectionLabels[i] ?? notReviewed);
      byPath.set(section.path, labels);
    }
    const topics = new Map<string, Wire<TreeTopicDto>>();
    for (const { path, title, topic: id, updatedAt } of pages) {
      const entry = topics.get(id) ?? {
        id,
        name: this.indexer.topicName(id),
        pages: [],
        pageCount: 0,
      };
      entry.pages.push({
        path,
        title,
        updatedAt: updatedAt.toISOString(),
        pageLabel: pageLabel(byPath.get(path) ?? []),
      });
      topics.set(id, entry);
    }
    for (const topic of topics.values()) {
      topic.pages.sort(
        (a, b) => a.title.localeCompare(b.title, 'en') || compareKey(a.path, b.path),
      );
      topic.pageCount = topic.pages.length;
    }
    return { topics: [...topics.values()].sort(byName) };
  }

  async page(input: unknown, label?: string): Promise<Wire<PageDto>> {
    const path = validatedPath(input);
    if (label?.includes('\0')) throw new AppError('NOT_FOUND');
    const page = await this.db.page.findUnique({ where: { path } });
    if (!page) throw new AppError('NOT_FOUND');
    const versionLabel = label ?? page.currentVersionLabel;
    // Both rows are version-keyed and written together. A later reindex cannot
    // substitute a newer version's sections for the snapshot selected here.
    const [snapshot, rows] = await Promise.all([
      this.db.snapshot.findUnique({ where: { path_label: { path, label: versionLabel } } }),
      this.db.pageSection.findMany({ where: { path, versionLabel }, orderBy: { ord: 'asc' } }),
    ]);
    if (!snapshot) throw new AppError('NOT_FOUND');
    const current = versionLabel === page.currentVersionLabel;
    const [rowLabels, authors, teams, fixes] = await Promise.all([
      this.labels.forSections(rows),
      this.authors.of(path),
      usedByTeams(this.db, rows, () => path),
      this.db.proposal.findMany({
        where: { targetPath: path, state: 'pending' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { slug: true, section: true },
      }),
    ]);
    // The newest pending proposal on the section (or the whole page) is the fix in progress (§7.7.2).
    const fixFor = (anchor: string) =>
      fixes.find((p) => p.section === anchor || p.section === null)?.slug ?? null;
    const sections = rows.map((row, i): Wire<SectionDto> => {
      const label = rowLabels[i] ?? notReviewed;
      return {
        anchor: row.anchor,
        title: row.title,
        level: row.level,
        hash: row.sectionHash,
        label,
        warn:
          (label.label === 'recheck' || label.label === 'error') && label.reason !== null
            ? { reason: label.reason, fixProposalSlug: fixFor(row.anchor) }
            : null,
      };
    });
    return {
      path,
      title: current ? page.title : pageTitle(path, sections),
      topic: { id: page.topic, name: this.indexer.topicName(page.topic) },
      versionLabel,
      sha256: snapshot.sha256,
      updatedAt: (current ? page.updatedAt : snapshot.capturedAt).toISOString(),
      changedOutsideReview: current && page.changedOutsideReview,
      markdown: parseStatusBlock(decodeMarkdown(Buffer.from(snapshot.content))).body,
      sections,
      pageLabel: pageLabel(sections.map((section) => section.label)),
      maintainers: authors.map((a) => ({ name: a.name })),
      usedByTeams: teams.get(path) ?? 0,
    };
  }

  async context(input: unknown): Promise<Wire<ContextDto>> {
    const { path, versionLabel, sha256, markdown: content, sections } = await this.page(input);
    return { path, versionLabel, sha256, content, sections };
  }

  async history(input: unknown, query: SnapshotPageInput): Promise<Wire<HistoryDto>> {
    const path = validatedPath(input);
    if (!(await this.db.page.count({ where: { path } }))) throw new AppError('NOT_FOUND');
    const rows = await this.db.snapshot.findMany({
      ...snapshotArgs(query),
      where: { path },
      select: { id: true, label: true, sha256: true, capturedAt: true },
    });
    const { items, nextCursor } = snapshotPage(rows, query.limit);
    const published = await this.publications(
      this.db,
      items.map(({ label }) => ({ path, label })),
    );
    return {
      items: items.map(({ label, sha256, capturedAt }) => ({
        versionLabel: label,
        sha256,
        capturedAt: capturedAt.toISOString(),
        publication: published.get(`${path}\0${label}`) ?? null,
      })),
      nextCursor,
    };
  }

  /** Done publications that produced these versions (system-logic §7.4.10, D-89). */
  private async publications(
    db: Prisma.TransactionClient,
    keys: { path: string; label: string }[],
  ): Promise<Map<string, Wire<VersionPublicationDto>>> {
    if (!keys.length) return new Map();
    const rows = await db.publication.findMany({
      where: {
        phase: 'done',
        OR: keys.map(({ path, label }) => ({ targetPath: path, versionLabel: label })),
      },
      include: {
        proposal: { select: { slug: true, title: true, section: true } },
        decision: { select: { reviewerKind: true, createdAt: true } },
      },
    });
    const sectioned = rows.filter((r) => r.proposal.section !== null && r.versionLabel !== null);
    const titles = sectioned.length
      ? await db.pageSection.findMany({
          where: {
            OR: sectioned.map((r) => ({
              path: r.targetPath,
              versionLabel: r.versionLabel ?? '',
              anchor: r.proposal.section ?? '',
            })),
          },
          select: { path: true, versionLabel: true, anchor: true, title: true },
        })
      : [];
    const title = new Map(
      titles.map((t) => [`${t.path}\0${t.versionLabel}\0${t.anchor}`, t.title]),
    );
    return new Map(
      rows.map((r) => [
        `${r.targetPath}\0${r.versionLabel ?? ''}`,
        {
          proposalSlug: r.proposal.slug,
          title: r.proposal.title,
          sectionTitle: r.proposal.section
            ? (title.get(`${r.targetPath}\0${r.versionLabel ?? ''}\0${r.proposal.section}`) ?? null)
            : null,
          reviewerKind: r.decision.reviewerKind,
          decidedAt: r.decision.createdAt.toISOString(),
          publishedAt: (r.finishedAt ?? r.updatedAt).toISOString(),
          auto: r.auto,
        },
      ]),
    );
  }

  /** `scope=mine` = the caller's unmuted follows (§7.7.9); no human caller → empty page. */
  async recent(query: RecentInput, viewer?: { id: string; kind: string }): Promise<Wire<RecentDto>> {
    let followed: string[] | null = null;
    if (query.scope === 'mine') {
      if (viewer?.kind !== 'human') return { items: [], nextCursor: null };
      followed = (
        await this.db.follow.findMany({
          where: { userId: viewer.id, mutedAt: null },
          select: { path: true },
        })
      ).map((f) => f.path);
      if (!followed.length) return { items: [], nextCursor: null };
    }
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.snapshot.findMany({
          ...snapshotArgs(query),
          ...(followed && { where: { path: { in: [...new Set(followed)] } } }),
          select: { id: true, path: true, label: true, capturedAt: true },
        });
        const { items, nextCursor } = snapshotPage(rows, query.limit);
        const paths = [...new Set(items.map((row) => row.path))];
        const pages = new Map(
          (await tx.page.findMany({ where: { path: { in: paths } } })).map((p) => [p.path, p]),
        );
        const published = await this.publications(tx, items);
        return {
          items: items.map(({ path, label, capturedAt }) => {
            const page = pages.get(path);
            const publication = published.get(`${path}\0${label}`);
            return {
              proposalSlug: publication?.proposalSlug ?? null,
              sectionTitle: publication?.sectionTitle ?? null,
              summary: publication?.title ?? null,
              path,
              pageTitle: page?.title ?? pageTitle(path, []),
              versionLabel: label,
              at: capturedAt.toISOString(),
              changedOutsideReview:
                page?.currentVersionLabel === label && page.changedOutsideReview,
            };
          }),
          nextCursor,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
