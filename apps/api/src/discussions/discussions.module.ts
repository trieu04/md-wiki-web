import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DISCUSSION_STATE } from '../review/ports.js';
import { PrismaDiscussionState } from './discussion-state.js';
import { ProposalDiscussionController, TopicsController } from './discussions.controller.js';
import { DiscussionsService } from './discussions.service.js';

/** Discussions (system-logic §7.5). Review imports it for the `DiscussionState` port. */
@Module({
  imports: [PrismaModule],
  controllers: [TopicsController, ProposalDiscussionController],
  providers: [DiscussionsService, { provide: DISCUSSION_STATE, useClass: PrismaDiscussionState }],
  exports: [DiscussionsService, DISCUSSION_STATE],
})
export class DiscussionsModule {}
