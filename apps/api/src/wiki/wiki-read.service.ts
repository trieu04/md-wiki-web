import { Inject, Injectable } from '@nestjs/common';
import { pageLabel, pageTitle, parseStatusBlock } from '@md-wiki/domain';
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
  type Wire,
} from './read.dto.js';
import { SectionLabels, type SectionKey } from './section-labels.js';
import { decodeMarkdown, wikiPath } from './storage/wiki-storage.js';

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
    const byPath = new Map<string, ReturnType<SectionLabels['forSection']>[]>();
    for (const section of sections) {
      const labels = byPath.get(section.path) ?? [];
      labels.push(this.labels.forSection(section));
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
    const sections = rows.map((row): Wire<SectionDto> => {
      const label = this.labels.forSection(row);
      return {
        anchor: row.anchor,
        title: row.title,
        level: row.level,
        hash: row.sectionHash,
        label,
        warn:
          (label.label === 'recheck' || label.label === 'error') && label.reason !== null
            ? { reason: label.reason, fixProposalSlug: null }
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
      maintainers: [],
      usedByTeams: null,
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
    return {
      items: items.map(({ label, sha256, capturedAt }) => ({
        versionLabel: label,
        sha256,
        capturedAt: capturedAt.toISOString(),
      })),
      nextCursor,
    };
  }

  async recent(query: RecentInput): Promise<Wire<RecentDto>> {
    if (query.scope === 'mine') return { items: [], nextCursor: null };
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.snapshot.findMany({
          ...snapshotArgs(query),
          select: { id: true, path: true, label: true, capturedAt: true },
        });
        const { items, nextCursor } = snapshotPage(rows, query.limit);
        const paths = [...new Set(items.map((row) => row.path))];
        const pages = new Map(
          (await tx.page.findMany({ where: { path: { in: paths } } })).map((p) => [p.path, p]),
        );
        return {
          items: items.map(({ path, label, capturedAt }) => {
            const page = pages.get(path);
            return {
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
