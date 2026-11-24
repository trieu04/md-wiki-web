import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AgentResults } from '../agent/agent-results.js';
import { QualityResults } from '../quality/quality-results.js';
import { DevPingController } from './dev-ping.controller.js';
import { CredibilityResults } from './credibility-results.js';
import { InternalCredibilityController } from './internal-credibility.controller.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { JobQueue } from './ping-queue.js';

/** The queue (§7.1), shared by dev ping and quality runs. */
@Module({ providers: [JobQueue], exports: [JobQueue] })
export class QueueModule {}

// The internal app has no EventsModule (its controller is public-only); results still reach
// the public SSE streams through the process bus (§7.6.7).
@Module({
  imports: [PrismaModule],
  providers: [JobsService, QualityResults, AgentResults, CredibilityResults, EventsService],
  exports: [JobsService, CredibilityResults],
})
class JobsModule {}

@Module({ imports: [JobsModule], controllers: [JobsController, InternalCredibilityController] })
export class InternalJobsModule {}

@Module({ imports: [JobsModule, QueueModule], controllers: [DevPingController] })
export class DevPingModule {}
