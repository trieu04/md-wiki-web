import { Controller, Get, Module } from '@nestjs/common';

import { IdentityModule } from './auth/identity.module.js';
import { ConfigModule } from './config/config.module.js';
import { MetaController } from './config/meta.controller.js';
import { WikiModule } from './wiki/wiki.module.js';
import { ContributionsModule } from './contributions/contributions.module.js';
import { EventsModule } from './events/events.module.js';
import { ReviewModule } from './review/review.module.js';
import { DiscussionsModule } from './discussions/discussions.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { QualityModule } from './quality/quality.module.js';
import { AgentModule } from './agent/agent.module.js';
import { CredibilityModule } from './credibility/credibility.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { HealthModule } from './health/health.module.js';
import { DevPingModule, InternalJobsModule } from './jobs/jobs.module.js';

@Controller('test')
class InternalTestController {
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [ConfigModule, InternalJobsModule],
  controllers: process.env.NODE_ENV === 'test' ? [InternalTestController] : [],
})
export class InternalModule {}

@Module({
  imports: [
    ConfigModule,
    IdentityModule,
    HealthModule,
    WikiModule,
    EventsModule,
    ContributionsModule,
    ReviewModule,
    DiscussionsModule,
    McpModule,
    QualityModule,
    NotificationsModule,
    CredibilityModule,
    AgentModule,
    ...(process.env.NODE_ENV === 'production' ? [] : [DevPingModule]),
  ],
  controllers: [MetaController],
})
export class AppModule {
  readonly moduleName = 'AppModule';
}
