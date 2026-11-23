import { Inject, Injectable } from '@nestjs/common';
import { retentionCutoff, retentionPlan, type RetentionRow } from '@md-wiki/domain';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import type { MaintenanceDto } from './credibility.dto.js';
import { QueueService } from './queue.service.js';

const FINAL = new Set(['withdrawn', 'dismissed', 'fixed']);
const bucketOf = (b: {
  path: string;
  anchor: string;
  sectionHash: string;
  versionLabel: string;
  metric: string;
  teamKey: string;
}) => JSON.stringify([b.path, b.anchor, b.sectionHash, b.versionLabel, b.metric, b.teamKey]);

/**
 * Daily credibility maintenance (system-logic §7.7.7, D-169, D-170): retention purge into
 * aggregates, reciprocal-pair marking, email digests.
 */
@Injectable()
export class CredibilityMaintenance {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date(), identity: Identity | null = null): Promise<Wire<MaintenanceDto>> {
    const purged = await this.purge(now);
    const pairs = await this.db.$transaction((tx) => this.queue.markPairs(tx));
    const digests = await this.notifications.runDigests(now);
    await audit(this.db, identity?.user ?? null, 'credibility.maintenance', 'credibility', 'maintenance', {
      ...purged,
      pairs: pairs.pairs,
      digests,
    });
    return { purged, pairs: pairs.pairs, digests };
  }

  private async purge(now: Date) {
    const cutoff = retentionCutoff(now, this.config.CREDIBILITY_RETENTION_DAYS);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL md_wiki.purge = 'on'`;
      const old = await tx.attestation.findMany({ where: { createdAt: { lt: cutoff } } });
      const events = old.length
        ? await tx.attestationEvent.findMany({
            where: { attestationId: { in: old.map((a) => a.id) } },
            select: { attestationId: true, status: true },
          })
        : [];
      const statusOf = (id: string) => events.filter((e) => e.attestationId === id).map((e) => e.status);
      const keys = new Map<string, Parameters<typeof bucketOf>[0]>();
      const rows: RetentionRow[] = old.map((a) => {
        const statuses = statusOf(a.id);
        const withdrawn = statuses.includes('withdrawn');
        const final = a.kind !== 'report' || statuses.some((s) => FINAL.has(s));
        const key = {
          path: a.path,
          anchor: a.anchor,
          sectionHash: a.sectionHash,
          versionLabel: a.versionLabel,
          metric: a.kind,
          teamKey: a.teamId ?? '',
        };
        keys.set(bucketOf(key), key);
        return { id: a.id, createdAt: a.createdAt, final, counted: !withdrawn, bucket: bucketOf(key) };
      });
      const plan = retentionPlan(rows, cutoff);
      const feedback = await tx.pageFeedback.findMany({ where: { createdAt: { lt: cutoff } } });
      const fbRows: RetentionRow[] = feedback.map((f) => {
        const key = {
          path: f.path,
          anchor: '',
          sectionHash: '',
          versionLabel: f.versionLabel,
          metric: `feedback_${f.answer}`,
          teamKey: f.teamId ?? '',
        };
        keys.set(bucketOf(key), key);
        return { id: f.id, createdAt: f.createdAt, final: true, counted: true, bucket: bucketOf(key) };
      });
      const fbPlan = retentionPlan(fbRows, cutoff);
      for (const [bucket, n] of [...plan.add, ...fbPlan.add]) {
        const key = keys.get(bucket);
        if (!key) continue;
        await tx.credibilityAggregate.upsert({
          where: { path_anchor_sectionHash_versionLabel_metric_teamKey: key },
          create: { ...key, count: n, updatedAt: now },
          update: { count: { increment: n }, updatedAt: now },
        });
      }
      if (plan.purge.length) {
        await tx.attestationEvent.deleteMany({ where: { attestationId: { in: plan.purge } } });
        await tx.attestation.deleteMany({ where: { id: { in: plan.purge } } });
      }
      if (fbPlan.purge.length) await tx.pageFeedback.deleteMany({ where: { id: { in: fbPlan.purge } } });
      return { attestations: plan.purge.length, feedback: fbPlan.purge.length };
    });
  }
}
