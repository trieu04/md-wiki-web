import { Controller, Get, Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module.js';
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
    HealthModule,
    ...(process.env.NODE_ENV === 'production' ? [] : [DevPingModule]),
  ],
})
export class AppModule {
  readonly moduleName = 'AppModule';
}
