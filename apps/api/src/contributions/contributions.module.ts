import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WikiModule } from '../wiki/wiki.module.js';
import { ContributionsController, DraftsController } from './contributions.controller.js';
import { ContributionsService } from './contributions.service.js';
import { DraftsService } from './drafts.service.js';
import { ProposalFreezer } from './freezer.service.js';
import { ContributionViews } from './views.js';

@Module({
  imports: [PrismaModule, WikiModule],
  controllers: [DraftsController, ContributionsController],
  providers: [ContributionViews, ProposalFreezer, DraftsService, ContributionsService],
  exports: [ContributionViews, ProposalFreezer, ContributionsService],
})
export class ContributionsModule {}
