import { pageLabel, type Label, type LabelDto } from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { invalid } from '../contributions/pins.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SectionLabels } from './section-labels.js';

type Db = Prisma.TransactionClient | PrismaService;
export interface CurrentSection {
  path: string;
  anchor: string;
  title: string;
  level: number;
  ord: number;
  sectionHash: string;
  text: string;
}
export interface CurrentPage {
  path: string;
  title: string;
  versionLabel: string;
  updatedAt: Date;
  sections: CurrentSection[];
}

/** Current version and its sections (document order) of each existing path. */
export async function currentPages(db: Db, paths: readonly string[]): Promise<Map<string, CurrentPage>> {
  const unique = [...new Set(paths)];
  const out = new Map<string, CurrentPage>();
  if (!unique.length) return out;
  const pages = await db.page.findMany({ where: { path: { in: unique } } });
  if (!pages.length) return out;
  const sections = await db.pageSection.findMany({
    where: { OR: pages.map((p) => ({ path: p.path, versionLabel: p.currentVersionLabel })) },
    select: { path: true, anchor: true, title: true, level: true, ord: true, sectionHash: true, text: true },
    orderBy: [{ path: 'asc' }, { ord: 'asc' }],
  });
  for (const p of pages)
    out.set(p.path, {
      path: p.path,
      title: p.title,
      versionLabel: p.currentVersionLabel,
      updatedAt: p.updatedAt,
      sections: sections.filter((s) => s.path === p.path),
    });
  return out;
}

/**
 * The current section a credibility write targets (system-logic §7.7.3): unknown page →
 * NOT_FOUND, unknown anchor → UNKNOWN_SECTION, another hash → SECTION_CHANGED.
 */
export async function currentSection(
  db: Db,
  ref: { path: string; anchor: string; sectionHash?: string | undefined },
): Promise<{ page: CurrentPage; section: CurrentSection }> {
  const page = (await currentPages(db, [ref.path])).get(ref.path);
  if (!page) throw new AppError('NOT_FOUND', 'No such page');
  const section = page.sections.find((s) => s.anchor === ref.anchor);
  if (!section) throw invalid('anchor', 'UNKNOWN_SECTION', 'No such section in the current version');
  if (ref.sectionHash !== undefined && section.sectionHash !== ref.sectionHash)
    throw new AppError('SECTION_CHANGED', 'The section changed; reread it');
  return { page, section };
}

export interface PageLabelSummary {
  label: Label;
  spread: Record<Label, number>;
  sections: { anchor: string; title: string; label: LabelDto }[];
}

/** Page label (worst section) + spread for each page (§6, §7.7.2). */
export async function pageLabels(
  labels: SectionLabels,
  pages: Iterable<CurrentPage>,
  db?: Db,
): Promise<Map<string, PageLabelSummary>> {
  const list = [...pages];
  const keys = list.flatMap((p) => p.sections);
  const computed = await labels.forSections(keys, db);
  const out = new Map<string, PageLabelSummary>();
  let i = 0;
  for (const p of list) {
    const sections = p.sections.map((s) => ({
      anchor: s.anchor,
      title: s.title,
      label: computed[i++] ?? { label: 'not_reviewed' as const, since: null, reviewerKind: null, reason: null },
    }));
    out.set(p.path, { ...pageLabel(sections.map((s) => s.label)), sections });
  }
  return out;
}

/** Opaque offset cursor for small recomputed lists. */
export function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isInteger(n) || n < 0) throw invalid('cursor', 'cursor', 'Invalid cursor');
  return n;
}
export const offsetCursor = (n: number) => Buffer.from(String(n), 'utf8').toString('base64url');
