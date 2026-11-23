import { Module } from '@nestjs/common';
import { ContributionsModule } from '../contributions/contributions.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { QualityModule } from '../quality/quality.module.js';
import { WikiModule } from '../wiki/wiki.module.js';
import { ConflictsService } from './conflicts.service.js';
import { OpsService } from './ops.service.js';
import { DiscussionsModule } from '../discussions/discussions.module.js';
import { ESCALATION_TRIGGERS, NoHooks, NoTriggers, PUBLISH_HOOKS } from './ports.js';
import { PublishService } from './publish.service.js';
import { AuditController, OpsController, ProposalsController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { ReviewViews } from './views.js';

/** Review and publish (system-logic §7.4). */
@Module({
  imports: [PrismaModule, WikiModule, ContributionsModule, DiscussionsModule, QualityModule],
  controllers: [ProposalsController, OpsController, AuditController],
  providers: [
    { provide: ESCALATION_TRIGGERS, useClass: NoTriggers },
    { provide: PUBLISH_HOOKS, useClass: NoHooks },
    PublishService,
    ReviewViews,
    ReviewService,
    ConflictsService,
    OpsService,
  ],
  exports: [PublishService, ReviewService],
})
export class ReviewModule {}
