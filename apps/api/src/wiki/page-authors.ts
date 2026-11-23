import { Inject, Injectable } from '@nestjs/common';
import { parseStatusBlock } from '@md-wiki/domain';
import { pageAuthorsOf } from '../agent/page-authors.js';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { decodeMarkdown } from './storage/wiki-storage.js';

type Db = Prisma.TransactionClient | PrismaService;
export const OWNERS_PATH = 'wiki-meta/owners.md';

/** Reads the current version of a `wiki-meta/` page from the index (no storage IO). */
export async function metaPage(db: Db, path: string): Promise<{ versionLabel: string; markdown: string } | null> {
  const page = await db.page.findUnique({ where: { path } });
  if (!page) return null;
  const snapshot = await db.snapshot.findUnique({
    where: { path_label: { path, label: page.currentVersionLabel } },
  });
  if (!snapshot) return null;
  return {
    versionLabel: snapshot.label,
    markdown: parseStatusBlock(decodeMarkdown(Buffer.from(snapshot.content))).body,
  };
}

/** A page author as reader surfaces show it (maintainers, notices). */
export interface AuthorRef {
  id: string;
  email: string;
  name: string;
  kind: 'human' | 'agent';
}

/**
 * Page authors of a path (system-logic §7.7.3, D-164) by the one rule of §7.8.5 (D-206): the last
 * matching `wiki-meta/owners.md` row, else humans who published the page, else the owner. No
 * submitter is excluded here; a user with role `owner` always counts for `isAuthor`.
 */
@Injectable()
export class PageAuthors {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async of(path: string, db: Db = this.prisma): Promise<AuthorRef[]> {
    const { ids } = await pageAuthorsOf(db, path, '');
    if (!ids.length) return [];
    const users = await db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, name: true, kind: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return ids.flatMap((id) => {
      const u = byId.get(id);
      return u ? [u] : [];
    });
  }

  async many(paths: readonly string[], db: Db = this.prisma): Promise<Map<string, AuthorRef[]>> {
    const unique = [...new Set(paths)];
    return new Map(await Promise.all(unique.map(async (p) => [p, await this.of(p, db)] as const)));
  }

  async isAuthor(path: string, user: { id: string; roles: readonly string[] }, db: Db = this.prisma) {
    if (user.roles.includes('owner')) return true;
    return (await this.of(path, db)).some((a) => a.id === user.id);
  }
}
