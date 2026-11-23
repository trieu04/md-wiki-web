import { Inject, Injectable } from '@nestjs/common';
import {
  computeSectionLabel,
  labelInputFromEvidence,
  sectionKeyOf,
  type LabelDto,
  type ReviewerKind,
} from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SectionEvidenceLoader,
  type LoadedEvidence,
  type SectionKey,
} from './section-evidence.js';

export type { SectionKey } from './section-evidence.js';
type Db = Prisma.TransactionClient | PrismaService;

export interface Review {
  id: string;
  sectionHash: string;
  time: string;
  kind: ReviewerKind;
}
export interface LabelledSection {
  label: LabelDto;
  evidence: LoadedEvidence;
  /** Distinct people with a valid supported source check or owner confirmation on this hash. */
  checkedBy: number;
  /** The source of the check that gives *Checked against source*, when it is one. */
  sourceName: string | null;
}

/**
 * The single label source for reads, search and credibility writes (system-logic §6, §7.4.10,
 * §7.7.2): reviewed versions from `PublishedSection` plus every credibility record, computed
 * synchronously so a write and the read after it see the same label.
 */
@Injectable()
export class SectionLabels {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(SectionEvidenceLoader) private readonly loader: SectionEvidenceLoader,
  ) {}

  /** Labels in the order of `keys`. */
  async forSections(keys: readonly SectionKey[], db: Db = this.db): Promise<LabelDto[]> {
    return (await this.detailed(keys, db)).map((s) => s.label);
  }

  async detailed(keys: readonly SectionKey[], db: Db = this.db): Promise<LabelledSection[]> {
    if (!keys.length) return [];
    const [reviews, evidence] = await Promise.all([this.reviews(keys, db), this.loader.load(keys, db)]);
    return keys.map((key, i) => {
      const e = evidence[i];
      if (!e) throw new Error('evidence missing');
      const withReviews = { ...e, reviews: reviews.get(sectionKeyOf(key)) ?? [] };
      const label = computeSectionLabel(labelInputFromEvidence(withReviews));
      const valid = labelInputFromEvidence(withReviews).sourceChecks;
      const validIds = new Set(valid.filter((c) => c.valid).map((c) => c.id));
      const humanChecks = e.sourceChecks.filter(
        (c) =>
          c.checkerKind === 'person' &&
          c.result === 'supported' &&
          c.sectionHash === key.sectionHash &&
          validIds.has(c.id),
      );
      const people = new Set([
        ...humanChecks.map((c) => c.checkerId),
        ...e.ownerConfirmations.map((o) => o.ownerId),
      ]);
      const winner =
        label.label === 'checked'
          ? humanChecks.find((c) => c.time === label.since)
          : undefined;
      return {
        label,
        evidence: withReviews,
        checkedBy: people.size,
        sourceName: winner ? (winner.sourceTitle ?? winner.sourceRef) : null,
      };
    });
  }

  private async reviews(keys: readonly SectionKey[], db: Db) {
    const reviewed = new Map<string, Review[]>();
    const rows = await db.$queryRaw<
      {
        publicationId: string;
        path: string;
        anchor: string;
        sectionHash: string;
        reviewerKind: ReviewerKind;
        reviewedAt: Date;
      }[]
    >`
      SELECT ps."publicationId", ps.path, ps.anchor, ps."sectionHash", ps."reviewerKind", ps."reviewedAt"
      FROM "PublishedSection" ps
      JOIN unnest(${keys.map((k) => k.path)}::text[], ${keys.map((k) => k.anchor)}::text[],
                  ${keys.map((k) => k.sectionHash)}::text[]) AS k(path, anchor, hash)
        ON ps.path = k.path AND ps.anchor = k.anchor AND ps."sectionHash" = k.hash
    `;
    for (const row of rows) {
      const key = sectionKeyOf(row);
      const list = reviewed.get(key) ?? [];
      list.push({
        id: `${row.publicationId}:${row.anchor}`,
        sectionHash: row.sectionHash,
        time: row.reviewedAt.toISOString(),
        kind: row.reviewerKind,
      });
      reviewed.set(key, list);
    }
    return reviewed;
  }
}
