import { pageTitle, splitSections, topicId, topicName, topicNames } from '@md-wiki/domain';
import type { PrismaClient } from '@prisma/client';
import { decodeMarkdown, type WikiStorage } from '../storage/wiki-storage.js';
import type { PublicationLookup } from './publication-lookup.js';
import { captureSnapshot } from './snapshots.js';

export class WikiIndexer {
  private names = new Map<string, string>();
  constructor(
    private readonly storage: WikiStorage,
    private readonly db: PrismaClient,
    private readonly publications: PublicationLookup,
    private readonly now = () => new Date(),
  ) {}

  topicName(id: string) {
    return topicName(id, this.names);
  }

  async reindex() {
    const start = performance.now();
    return this.storage.withRootLock(async () => {
      const items = await this.storage.list();
      let changed = 0;
      let names = new Map<string, string>();
      for (const item of items) {
        const path = item.path.path;
        const current = await this.db.page.findUnique({
          where: { path },
          select: { currentSha256: true, changedOutsideReview: true },
        });
        const published = await this.publications.lastPublishedSha256(item.path);
        const isTopicsPage = path === 'wiki-meta/topics.md';
        // Direct edits don't take our lock. If we have to read again, bind all
        // derived rows and the snapshot to that single read, not the list hash.
        const file =
          current?.currentSha256 !== item.sha256 || isTopicsPage
            ? await this.storage.read(item.path)
            : null;
        const hash = file?.sha256 ?? item.sha256;
        const changedOutsideReview = published !== null && published !== hash;
        const markdown = file ? decodeMarkdown(file.content) : '';
        if (isTopicsPage) names = topicNames(markdown);
        if (!file || current?.currentSha256 === hash) {
          if (current && current.changedOutsideReview !== changedOutsideReview)
            await this.db.page.update({ where: { path }, data: { changedOutsideReview } });
          continue;
        }
        const sections = splitSections(markdown);
        const capturedAt = this.now();
        await this.db.$transaction(async (tx) => {
          const versionLabel = await captureSnapshot(tx, file, capturedAt);
          const data = {
            title: pageTitle(path, sections),
            topic: topicId(item.path),
            isMeta: item.path.isMeta,
            currentVersionLabel: versionLabel,
            currentSha256: hash,
            changedOutsideReview,
            updatedAt: capturedAt,
          };
          await tx.page.upsert({ where: { path }, create: { path, ...data }, update: data });
          await tx.pageSection.createMany({
            data: sections.map(({ anchor, title, level, hash: sectionHash, text }, ord) => ({
              path,
              versionLabel,
              anchor,
              title,
              level,
              ord,
              sectionHash,
              text,
            })),
            skipDuplicates: true,
          });
        });
        changed++;
      }
      this.names = names;
      return { scanned: items.length, changed, durationMs: Math.round(performance.now() - start) };
    });
  }
}
