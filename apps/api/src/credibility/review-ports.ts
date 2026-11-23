import { Inject, Injectable } from '@nestjs/common';
import { citedSources, tierOf } from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import type {
  CheckItem,
  ConfirmedError,
  ConfirmedErrors,
  CredibilityFacts,
  CredibilitySignals,
  InboxCheckItems,
} from '../agent/ports.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decodeMarkdown } from '../wiki/storage/wiki-storage.js';
import { CredibilityCore } from './credibility-core.js';
import { EvidenceService } from './evidence.service.js';

type Tx = Prisma.TransactionClient;
const CLOSING = ['still_correct', 'confirm_error'];

/** Reports, flags and resolutions shared by the adapters below. */
async function openReportsOn(db: Tx, path: string, anchors: readonly string[] | null) {
  const reports = await db.attestation.findMany({
    where: { path, kind: 'report', ...(anchors ? { anchor: { in: [...anchors] } } : {}) },
    select: { id: true, anchor: true, createdAt: true, details: true, blocking: true },
  });
  if (!reports.length) return [];
  const decided = new Set(
    (
      await db.attestationEvent.findMany({
        where: {
          attestationId: { in: reports.map((r) => r.id) },
          status: { in: ['withdrawn', 'confirmed', 'confirmed_error', 'dismissed', 'fixed'] },
        },
        select: { attestationId: true },
      })
    ).map((e) => e.attestationId),
  );
  return reports.filter((r) => !decided.has(r.id));
}

/**
 * Credibility inputs of the mandatory escalation triggers (system-logic §7.8.3), read inside the
 * decision transaction: open reports on the touched sections, sections labelled *Checked against
 * source*, retracted or low-tier sources the proposal adds, confirmed contradictions on the page.
 */
@Injectable()
export class CredibilitySignalsAdapter implements CredibilitySignals {
  constructor(
    @Inject(CredibilityCore) private readonly core: CredibilityCore,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
  ) {}

  async facts(
    tx: Tx,
    p: { id: string; targetPath: string; baseVersionLabel: string | null; touched: string[] },
  ): Promise<CredibilityFacts> {
    const touched = p.touched.length ? p.touched : null;
    const [reports, sections, proposal, contradictions] = await Promise.all([
      openReportsOn(tx, p.targetPath, touched),
      p.baseVersionLabel
        ? tx.pageSection.findMany({
            where: { path: p.targetPath, versionLabel: p.baseVersionLabel },
            select: { anchor: true, sectionHash: true },
          })
        : Promise.resolve([]),
      tx.proposal.findUniqueOrThrow({ where: { id: p.id }, select: { base: true, proposed: true } }),
      tx.credibilityEdge.count({
        where: {
          kind: 'contradicts',
          OR: [{ srcPath: p.targetPath }, { dstPath: p.targetPath }],
        },
      }),
    ]);
    const labels = sections.length
      ? await this.core.labels.forSections(
          sections.map((s) => ({ path: p.targetPath, anchor: s.anchor, sectionHash: s.sectionHash })),
          tx,
        )
      : [];
    const checkedAnchors = sections
      .filter((_, i) => labels[i]?.label === 'checked')
      .map((s) => s.anchor);
    const base = proposal.base ? decodeMarkdown(Buffer.from(proposal.base)) : '';
    const before = new Set(citedSources(base));
    const added = citedSources(decodeMarkdown(Buffer.from(proposal.proposed))).filter(
      (r) => !before.has(r),
    );
    let retracted: string[] = [];
    let lowTierAdded: string[] = [];
    if (added.length) {
      const [hits, { tiers }] = await Promise.all([
        tx.invalidationEvent.findMany({
          where: { kind: 'retraction', ref: { in: added } },
          select: { ref: true },
        }),
        this.evidence.tiers(tx),
      ]);
      retracted = [...new Set(hits.map((h) => h.ref))];
      lowTierAdded = added.filter((r) => tierOf(r, tiers)?.tier === 'low');
    }
    return {
      openReports: reports.length,
      checkedAnchors,
      sourceProblems: { retracted, lowTierAdded },
      contradictions,
    };
  }
}

/**
 * A failed spot check is a confirmed error (D-214): `ConfirmedError(origin spot_check)` per
 * section, propagated to descendants (D-178), in the spot-check transaction.
 */
@Injectable()
export class CredibilityConfirmedErrors implements ConfirmedErrors {
  constructor(@Inject(CredibilityCore) private readonly core: CredibilityCore) {}

  async record(tx: Tx, e: ConfirmedError): Promise<void> {
    if (!e.sections.length) return;
    await tx.confirmedError.createMany({
      data: e.sections.map((s) => ({
        path: e.path,
        anchor: s.anchor,
        sectionHash: s.sectionHash,
        reason: e.reason,
        origin: 'spot_check',
        originId: e.spotCheckId,
        confirmedById: e.actorId,
        createdAt: e.at,
      })),
    });
    await this.core.propagate(
      tx,
      e.sections.map((s) => ({ path: e.path, anchor: s.anchor })),
      e.spotCheckId,
      e.reason,
    );
    this.core.emitPages([e.path]);
  }
}

/**
 * Inbox › *Check* (D-215): open reports and re-check flags on pages the user is a page author of.
 */
@Injectable()
export class CredibilityCheckItems implements InboxCheckItems {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(CredibilityCore) private readonly core: CredibilityCore,
  ) {}

  async forUser(userId: string): Promise<CheckItem[]> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, roles: true, kind: true },
    });
    if (!user || user.kind !== 'human') return [];
    const flags = await this.db.recheckFlag.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, path: true, anchor: true, reason: true, createdAt: true, cause: true },
    });
    const closed = new Set(
      (
        await this.db.credibilityResolution.findMany({
          where: { subjectType: 'flag', subjectId: { in: flags.map((f) => f.id) }, outcome: { in: CLOSING } },
          select: { subjectId: true },
        })
      ).map((r) => r.subjectId),
    );
    const openFlags = flags.filter((f) => !closed.has(f.id) && f.cause !== 'report');
    const reportPaths = await this.db.attestation.findMany({
      where: { kind: 'report' },
      distinct: ['path'],
      select: { path: true },
      take: 200,
    });
    const reports = (
      await Promise.all(
        reportPaths.map(async ({ path }) =>
          (await openReportsOn(this.db, path, null)).map((r) => ({ ...r, path })),
        ),
      )
    ).flat();
    const paths = [...new Set([...openFlags.map((f) => f.path), ...reports.map((r) => r.path)])];
    const mine = new Set<string>();
    for (const path of paths)
      if (await this.core.authors.isAuthor(path, user, this.db)) mine.add(path);
    const items: CheckItem[] = [
      ...reports
        .filter((r) => mine.has(r.path))
        .map((r) => ({
          id: `report:${r.id}`,
          title: `Report${r.blocking ? ' (blocking)' : ''} on ${r.path}`,
          path: r.path,
          anchor: r.anchor,
          why: 'A reader reported a problem on a page you are an author of',
          at: r.createdAt,
          done: false,
        })),
      ...openFlags
        .filter((f) => mine.has(f.path))
        .map((f) => ({
          id: `flag:${f.id}`,
          title: `Re-check on ${f.path}`,
          path: f.path,
          anchor: f.anchor,
          why: f.reason,
          at: f.createdAt,
          done: false,
        })),
    ];
    return items.sort((a, b) => b.at.getTime() - a.at.getTime());
  }
}
