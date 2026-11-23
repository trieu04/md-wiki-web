import {
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { logger } from '../common/request-id.middleware.js';
import { DiscussionsModule } from '../discussions/discussions.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WikiModule } from '../wiki/wiki.module.js';
import { AttestationsService } from './attestations.service.js';
import {
  CredibilityAdminController,
  CredibilityQueueController,
  EvidenceController,
  MeCredibilityController,
  ReaderActionsController,
  SectionsController,
} from './credibility.controller.js';
import { CredibilityCore } from './credibility-core.js';
import { EvidenceService } from './evidence.service.js';
import { CredibilityGates } from './gates.service.js';
import { CredibilityMaintenance } from './maintenance.service.js';
import { CredibilityPublishListener } from './publish-listener.js';
import { QueueService } from './queue.service.js';
import {
  CredibilityCheckItems,
  CredibilityConfirmedErrors,
  CredibilitySignalsAdapter,
} from './review-ports.js';

const DAY_MS = 86_400_000;
const FIRST_RUN_MS = 60_000;

/** Credibility (system-logic §7.7): evidence, reader actions, queue, gates, maintenance. */
@Module({
  imports: [PrismaModule, WikiModule, DiscussionsModule, NotificationsModule],
  controllers: [
    EvidenceController,
    SectionsController,
    ReaderActionsController,
    MeCredibilityController,
    CredibilityQueueController,
    CredibilityAdminController,
  ],
  providers: [
    CredibilityCore,
    EvidenceService,
    AttestationsService,
    QueueService,
    CredibilityGates,
    CredibilityMaintenance,
    CredibilityPublishListener,
    CredibilitySignalsAdapter,
    CredibilityConfirmedErrors,
    CredibilityCheckItems,
  ],
  exports: [
    CredibilityCore,
    EvidenceService,
    CredibilityGates,
    CredibilityPublishListener,
    CredibilitySignalsAdapter,
    CredibilityConfirmedErrors,
    CredibilityCheckItems,
  ],
})
export class CredibilityModule implements OnApplicationBootstrap, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];

  constructor(@Inject(CredibilityMaintenance) private readonly maintenance: CredibilityMaintenance) {}

  /** Daily maintenance; first run one minute after boot (§7.7.7). Off under tests. */
  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => {
      this.maintenance.run().catch((error: unknown) => {
        logger.warn({ err: error }, 'credibility maintenance failed');
      });
    };
    const first = setTimeout(run, FIRST_RUN_MS);
    const daily = setInterval(run, DAY_MS);
    first.unref();
    daily.unref();
    this.timers.push(first, daily);
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }
}
