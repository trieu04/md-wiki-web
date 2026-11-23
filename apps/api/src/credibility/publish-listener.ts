import { Inject, Injectable } from '@nestjs/common';
import { detectRenames, type SectionShape } from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import { FollowsService } from '../notifications/follows.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { PublishedVersion, PublishListener } from '../review/ports.js';
import { AttestationsService } from './attestations.service.js';

type Tx = Prisma.TransactionClient;
const shape = (s: { anchor: string; level: number; text: string; sectionHash: string }): SectionShape => ({
  anchor: s.anchor,
  level: s.level,
  text: s.text,
  hash: s.sectionHash,
});

/**
 * Credibility work at publish finish, inside the finish transaction (system-logic §7.7.3,
 * §7.7.6, §7.7.9): anchor links for pure renames (D-163), confirmed reports on changed sections
 * become `fixed` (reporter told), `section_edited` to followers who attested a changed section,
 * and the contributor follows the page (D-171).
 */
@Injectable()
export class CredibilityPublishListener implements PublishListener {
  constructor(
    @Inject(AttestationsService) private readonly attestations: AttestationsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(FollowsService) private readonly follows: FollowsService,
  ) {}

  async published(tx: Tx, v: PublishedVersion): Promise<void> {
    const [after, before] = await Promise.all([
      tx.pageSection.findMany({ where: { path: v.path, versionLabel: v.versionLabel } }),
      v.baseVersionLabel
        ? tx.pageSection.findMany({ where: { path: v.path, versionLabel: v.baseVersionLabel } })
        : Promise.resolve([]),
    ]);
    const renames = detectRenames(before.map(shape), after.map(shape));
    if (renames.length)
      await tx.anchorLink.createMany({
        data: renames.map((r) => ({
          path: v.path,
          ...r,
          proposalId: v.proposalId,
          reviewerId: v.reviewerId,
        })),
        skipDuplicates: true,
      });
    const renamed = new Set(renames.map((r) => r.oldAnchor));
    const afterHash = new Map(after.map((s) => [s.anchor, s.sectionHash]));
    // Changed or removed sections of the previous version (pure renames carry their evidence).
    const changed = before.filter(
      (s) => !renamed.has(s.anchor) && afterHash.get(s.anchor) !== s.sectionHash,
    );
    if (changed.length) {
      const anchors = changed.map((s) => s.anchor);
      await this.fixReports(tx, v, anchors);
      await this.sectionEdited(tx, v, changed);
    }
    await this.follows.autoFollow(tx, v.submitterId, v.path, 'contributed');
  }

  private async fixReports(tx: Tx, v: PublishedVersion, anchors: string[]) {
    const reports = await tx.attestation.findMany({
      where: { path: v.path, kind: 'report', anchor: { in: anchors } },
      select: { id: true, actorId: true, anchor: true },
    });
    if (!reports.length) return;
    const events = await tx.attestationEvent.findMany({
      where: { attestationId: { in: reports.map((r) => r.id) } },
      select: { attestationId: true, status: true },
    });
    for (const r of reports) {
      const statuses = new Set(events.filter((e) => e.attestationId === r.id).map((e) => e.status));
      const confirmed = statuses.has('confirmed') || statuses.has('confirmed_error');
      if (!confirmed || statuses.has('fixed') || statuses.has('withdrawn')) continue;
      await this.attestations.appendEvent(tx, r.id, null, 'fixed', `Fixed in ${v.versionLabel}`);
      await this.notifications.notify(tx, {
        userIds: [r.actorId],
        event: 'report_outcome',
        path: v.path,
        anchor: r.anchor,
        text: `Your report was fixed and published in ${v.versionLabel}`,
        data: { outcome: 'fixed', attestationId: r.id },
      });
    }
  }

  private async sectionEdited(
    tx: Tx,
    v: PublishedVersion,
    changed: readonly { anchor: string; sectionHash: string }[],
  ) {
    const rows = await tx.attestation.findMany({
      where: {
        path: v.path,
        kind: { in: ['checked', 'used'] },
        OR: changed.map((c) => ({ anchor: c.anchor, sectionHash: c.sectionHash })),
      },
      select: { id: true, actorId: true, anchor: true },
    });
    if (!rows.length) return;
    const withdrawn = new Set(
      (
        await tx.attestationEvent.findMany({
          where: { attestationId: { in: rows.map((r) => r.id) }, status: 'withdrawn' },
          select: { attestationId: true },
        })
      ).map((e) => e.attestationId),
    );
    const followers = new Set(
      (await this.notifications.followers(tx, [v.path], [v.submitterId])).get(v.path) ?? [],
    );
    const byAnchor = new Map<string, Set<string>>();
    for (const r of rows) {
      if (withdrawn.has(r.id) || !followers.has(r.actorId)) continue;
      byAnchor.set(r.anchor, (byAnchor.get(r.anchor) ?? new Set()).add(r.actorId));
    }
    for (const [anchor, users] of byAnchor)
      await this.notifications.notify(tx, {
        userIds: [...users],
        event: 'section_edited',
        path: v.path,
        anchor,
        text: `A section you checked or used changed in ${v.versionLabel}`,
        data: { versionLabel: v.versionLabel },
      });
  }
}
