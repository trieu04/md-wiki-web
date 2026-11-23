import { Module } from '@nestjs/common';
import { ContributionsModule } from '../contributions/contributions.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { QualityModule } from '../quality/quality.module.js';
import { WikiModule } from '../wiki/wiki.module.js';
import { ConflictsService } from './conflicts.service.js';
import { OpsService } from './ops.service.js';
import { DiscussionsModule } from '../discussions/discussions.module.js';
import { AFTER_PUBLISH, ESCALATION_TRIGGERS, NoHooks, PUBLISH_HOOKS } from './ports.js';
import {
  AUTHOR_NOTIFIER,
  CONFIRMED_ERRORS,
  CREDIBILITY_SIGNALS,
  LogAuthorNotifier,
  NoCredibilitySignals,
  RecordOnlyConfirmedErrors,
} from '../agent/ports.js';
import { SpotChecksService } from '../agent/spot-checks.service.js';
import { MandatoryTriggers } from '../agent/triggers.js';
import { PublishService } from './publish.service.js';
import { AuditController, OpsController, ProposalsController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { ReviewViews } from './views.js';

/** Review and publish (system-logic §7.4). */
@Module({
  imports: [PrismaModule, WikiModule, ContributionsModule, DiscussionsModule, QualityModule],
  controllers: [ProposalsController, OpsController, AuditController],
  providers: [
    // Phase 8 (system-logic §7.8): the ports below are replaced by Phase 9 implementations.
    { provide: AUTHOR_NOTIFIER, useClass: LogAuthorNotifier },
    { provide: CONFIRMED_ERRORS, useClass: RecordOnlyConfirmedErrors },
    { provide: CREDIBILITY_SIGNALS, useClass: NoCredibilitySignals },
    MandatoryTriggers,
    SpotChecksService,
    { provide: ESCALATION_TRIGGERS, useExisting: MandatoryTriggers },
    { provide: AFTER_PUBLISH, useExisting: SpotChecksService },
    { provide: PUBLISH_HOOKS, useClass: NoHooks },
    PublishService,
    ReviewViews,
    ReviewService,
    ConflictsService,
    OpsService,
  ],
  exports: [
    PublishService,
    ReviewService,
    MandatoryTriggers,
    SpotChecksService,
    AUTHOR_NOTIFIER,
    CONFIRMED_ERRORS,
    CREDIBILITY_SIGNALS,
  ],
})
export class ReviewModule {}
