import { Inject, Injectable } from '@nestjs/common';
import { computeSectionLabel, type LabelDto } from '@md-wiki/domain';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SectionKey {
  path: string;
  anchor: string;
  sectionHash: string;
}

const keyOf = (k: SectionKey) => `${k.path}\0${k.anchor}\0${k.sectionHash}`;

/**
 * The single label source for reads and search (system-logic §6, §7.4.10). Phase 5 adds the
 * reviewed versions (`PublishedSection`); credibility records (Phase 9) are still empty.
 */
@Injectable()
export class SectionLabels {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  /** Labels in the order of `keys`. One query for any number of sections. */
  async forSections(keys: readonly SectionKey[]): Promise<LabelDto[]> {
    const reviewed = new Map<
      string,
      { id: string; sectionHash: string; time: string; kind: 'agent' | 'person' }[]
    >();
    if (keys.length) {
      const rows = await this.db.$queryRaw<
        {
          publicationId: string;
          path: string;
          anchor: string;
          sectionHash: string;
          reviewerKind: 'agent' | 'person';
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
        const key = keyOf(row);
        const list = reviewed.get(key) ?? [];
        list.push({
          id: `${row.publicationId}:${row.anchor}`,
          sectionHash: row.sectionHash,
          time: row.reviewedAt.toISOString(),
          kind: row.reviewerKind,
        });
        reviewed.set(key, list);
      }
    }
    return keys.map((key) =>
      computeSectionLabel({
        currentHash: key.sectionHash,
        confirmedErrors: [],
        openRecheckReasons: [],
        reviewedVersions: reviewed.get(keyOf(key)) ?? [],
        sourceChecks: [],
        ownerConfirmations: [],
      }),
    );
  }
}
