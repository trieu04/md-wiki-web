import { pageTitle, splitSections, topicId, topicName, topicNames } from '@md-wiki/domain';
import type { WikiPath } from '@md-wiki/domain';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../common/app-error.js';
import {
  decodeMarkdown,
  sha256,
  type ReadResult,
  type WikiStorage,
} from '../storage/wiki-storage.js';
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
        await this.index(file, markdown, changedOutsideReview);
        changed++;
      }
      this.names = names;
      return { scanned: items.length, changed, durationMs: Math.round(performance.now() - start) };
    });
  }

  /**
   * Pin the current version of one path (system-logic §7.2.4, D-55): a live read under the
   * root lock that indexes the file when it changed, so every pin is a registered snapshot.
   * `null` when the file does not exist.
   */
  async observe(path: WikiPath): Promise<Observed | null> {
    return this.storage.withRootLock(async () => {
      let file: ReadResult;
      try {
        file = await this.storage.read(path);
      } catch (error) {
        if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
        throw error;
      }
      const current = await this.db.page.findUnique({
        where: { path: path.path },
        select: { currentSha256: true, currentVersionLabel: true },
      });
      let label = current?.currentVersionLabel;
      if (current?.currentSha256 !== file.sha256) {
        const published = await this.publications.lastPublishedSha256(path);
        label = await this.index(
          file,
          decodeMarkdown(file.content),
          published !== null && published !== file.sha256,
        );
      }
      const snapshot = await this.db.snapshot.findUniqueOrThrow({
        where: { path_label: { path: path.path, label: label ?? '' } },
        select: { id: true, label: true, sha256: true },
      });
      if (snapshot.sha256 !== file.sha256) throw new AppError('STORAGE_ERROR', 'Index mismatch');
      return {
        snapshotId: snapshot.id,
        versionLabel: snapshot.label,
        sha256: file.sha256,
        content: file.content,
      };
    });
  }

  /**
   * Register bytes this API just wrote and verified (publish finish, system-logic §7.4.5): the
   * new version is the artifact itself, not a later read. Returns its version label. The caller
   * observes the path afterwards so a later out-of-band edit is indexed on top.
   */
  async register(path: WikiPath, content: Buffer): Promise<string> {
    return this.storage.withRootLock(async () => {
      const file: ReadResult = { path, content, sha256: sha256(content), mtime: this.now() };
      return this.index(file, decodeMarkdown(content), false);
    });
  }

  private async index(file: ReadResult, markdown: string, changedOutsideReview: boolean) {
    const { path: wikiPath } = file;
    const path = wikiPath.path;
    const sections = splitSections(markdown);
    const capturedAt = this.now();
    return this.db.$transaction(async (tx) => {
      const versionLabel = await captureSnapshot(tx, file, capturedAt);
      const data = {
        title: pageTitle(path, sections),
        topic: topicId(wikiPath),
        isMeta: wikiPath.isMeta,
        currentVersionLabel: versionLabel,
        currentSha256: file.sha256,
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
      return versionLabel;
    });
  }
}

export interface Observed {
  snapshotId: string;
  versionLabel: string;
  sha256: string;
  content: Buffer;
}
