import { Controller, Get, Module } from '@nestjs/common';

import { IdentityModule } from './auth/identity.module.js';
import { ConfigModule } from './config/config.module.js';
import { MetaController } from './config/meta.controller.js';
import { WikiModule } from './wiki/wiki.module.js';
import { ContributionsModule } from './contributions/contributions.module.js';
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
    ContributionsModule,
    ...(process.env.NODE_ENV === 'production' ? [] : [DevPingModule]),
  ],
  controllers: [MetaController],
})
export class AppModule {
  readonly moduleName = 'AppModule';
}
