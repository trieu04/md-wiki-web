import { Inject, Injectable } from '@nestjs/common';
import { LABEL_ORDER, matchesLabelSelection, pageLabel } from '@md-wiki/domain';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WikiIndexer } from './indexer/wiki-indexer.js';
import { DEFAULT_LIMIT, type SearchDto, type SearchInput, type Wire } from './read.dto.js';
import { headlineMarkers, splitHeadline } from './search-snippet.js';
import { SectionLabels, type SectionKey } from './section-labels.js';
import { byName, compareKey } from './wiki-read.service.js';

interface Match extends SectionKey {
  versionLabel: string;
  pageTitle: string;
  sectionTitle: string;
  topic: string;
  updatedAt: Date;
  rank: number;
}
const cursorFor = ({ path, anchor }: Pick<SectionKey, 'path' | 'anchor'>) =>
  Buffer.from(JSON.stringify([path, anchor])).toString('base64url');
function validateCursor(cursor: string | undefined): void {
  if (cursor === undefined) return;
  try {
    const parts: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parts) && parts.length === 2) {
      const [path, anchor] = parts as unknown[];
      if (
        typeof path === 'string' &&
        typeof anchor === 'string' &&
        cursor === cursorFor({ path, anchor })
      )
        return;
    }
  } catch {
    /* malformed cursor */
  }
  throw new AppError('VALIDATION_FAILED', undefined, [
    { path: 'cursor', code: 'invalid', message: 'Invalid search cursor' },
  ]);
}
const DAY_MS = 86_400_000;

@Injectable()
export class SearchService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WikiIndexer) private readonly indexer: WikiIndexer,
    @Inject(SectionLabels) private readonly labels: SectionLabels,
  ) {}

  async search(input: SearchInput): Promise<Wire<SearchDto>> {
    const { q, sort, updated, cursor, limit = DEFAULT_LIMIT } = input;
    validateCursor(cursor);
    const query = Prisma.sql`plainto_tsquery('english', ${q.replaceAll('\0', ' ')})`;
    const since =
      updated === '30d' || updated === '1y'
        ? new Date(Date.now() - (updated === '30d' ? 30 : 365) * DAY_MS)
        : null;
    // Retrieve the candidate metadata once for both facet universes. Old
    // versions are retained in PageSection but never match the current join.
    const rows = await this.db.$queryRaw<Match[]>`
      SELECT s.path, s.anchor, s."sectionHash", s."versionLabel",
             p.title AS "pageTitle", s.title AS "sectionTitle", p.topic, p."updatedAt",
             ts_rank_cd(s.search, ${query}) AS rank
      FROM "PageSection" s JOIN "Page" p
        ON p.path = s.path AND p."currentVersionLabel" = s."versionLabel"
      WHERE s.search @@ ${query}
        ${since === null ? Prisma.empty : Prisma.sql`AND p."updatedAt" >= ${since}`}
    `;
    const labelFilter = new Set(input['labels[]']);
    const topicFilter = new Set(input['topics[]']);
    const labels = pageLabel([]).spread;
    const topics = new Map<string, number>();
    const matching = rows
      .map((row) => ({ ...row, label: this.labels.forSection(row) }))
      .filter((row) => {
        const label = row.label.label;
        const inTopic = !topicFilter.size || topicFilter.has(row.topic);
        const hasLabel = matchesLabelSelection(label, labelFilter);
        if (inTopic) labels[label]++;
        if (hasLabel) topics.set(row.topic, (topics.get(row.topic) ?? 0) + 1);
        return inTopic && hasLabel;
      });
    matching.sort((a, b) => {
      const primary =
        sort === 'trust'
          ? LABEL_ORDER.indexOf(a.label.label) - LABEL_ORDER.indexOf(b.label.label)
          : sort === 'recent'
            ? b.updatedAt.getTime() - a.updatedAt.getTime()
            : 0;
      return (
        primary ||
        (sort !== 'recent' ? b.rank - a.rank : 0) ||
        compareKey(a.path, b.path) ||
        compareKey(a.anchor, b.anchor)
      );
    });
    const position =
      cursor === undefined ? -1 : matching.findIndex((row) => cursorFor(row) === cursor);
    const start = cursor !== undefined && position < 0 ? matching.length : position + 1;
    const selected = matching.slice(start, start + limit);
    const markers = headlineMarkers();
    // Headline generation is more expensive than matching; only run it for
    // displayed results and use their exact version keys even across a reindex.
    const headlines = selected.length
      ? await this.db.$queryRaw<{ path: string; anchor: string; headline: string }[]>`
      SELECT s.path, s.anchor, ts_headline('english', s.text, ${query}, ${markers.options}) AS headline
      FROM "PageSection" s
      WHERE (s.path, s."versionLabel", s.anchor) IN (${Prisma.join(
        selected.map(
          ({ path, versionLabel, anchor }) => Prisma.sql`(${path}, ${versionLabel}, ${anchor})`,
        ),
      )})
    `
      : [];
    const bySection = new Map(
      headlines.map(({ path, anchor, headline }) => [cursorFor({ path, anchor }), headline]),
    );
    const last = selected.at(-1);
    return {
      total: matching.length,
      pageCount: new Set(matching.map((row) => row.path)).size,
      facets: {
        labels,
        topics: [...topics]
          .map(([id, n]) => ({ id, name: this.indexer.topicName(id), n }))
          .sort(byName),
      },
      items: selected.map((row) => ({
        path: row.path,
        pageTitle: row.pageTitle,
        anchor: row.anchor,
        sectionTitle: row.sectionTitle,
        label: row.label,
        snippet: splitHeadline(bySection.get(cursorFor(row)) ?? '', markers),
        meta: {
          updatedAt: row.updatedAt.toISOString(),
          checkedBy: null,
          sourceName: null,
          usedByTeams: null,
        },
      })),
      nextCursor: last && start + limit < matching.length ? cursorFor(last) : null,
    };
  }
}
