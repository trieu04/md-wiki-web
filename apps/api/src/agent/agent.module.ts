import {
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { logger } from '../common/request-id.middleware.js';
import { DiscussionsModule } from '../discussions/discussions.module.js';
import { QueueModule } from '../jobs/jobs.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ReviewModule } from '../review/review.module.js';
import {
  AgentOpsController,
  EscalationsController,
  InboxController,
  ReviewAdminController,
  SpotChecksController,
} from './agent.controller.js';
import { AgentRuns } from './agent-runs.service.js';
import { EscalationsService } from './escalations.service.js';
import { InboxService } from './inbox.service.js';
import { AgentMetricsService } from './metrics.service.js';
import { INBOX_CHECK_ITEMS } from './ports.js';
import { CredibilityModule } from '../credibility/credibility.module.js';
import { CredibilityCheckItems } from '../credibility/review-ports.js';
import { ReviewSettingsService } from './settings.service.js';

const REMINDER_SWEEP_MS = 60 * 60 * 1000;

/** Self-managed review (system-logic §7.8): escalations, inbox, settings, agent scheduler. */
@Module({
  imports: [PrismaModule, QueueModule, DiscussionsModule, ReviewModule, CredibilityModule],
  controllers: [
    EscalationsController,
    InboxController,
    SpotChecksController,
    ReviewAdminController,
    AgentOpsController,
  ],
  providers: [
    { provide: INBOX_CHECK_ITEMS, useExisting: CredibilityCheckItems },
    ReviewSettingsService,
    EscalationsService,
    InboxService,
    AgentMetricsService,
    AgentRuns,
  ],
  exports: [ReviewSettingsService, AgentRuns, EscalationsService],
})
export class AgentModule implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(@Inject(EscalationsService) private readonly escalations: EscalationsService) {}

  /** Reminders sweep hourly (D-212); a sweep only reminds, it never decides. */
  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.escalations.remind().catch((error: unknown) => {
        logger.warn({ err: error }, 'escalation reminder sweep failed');
      });
    }, REMINDER_SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
