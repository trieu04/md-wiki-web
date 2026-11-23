import { Controller, Get, Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';

@Controller('test')
class InternalTestController {
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: process.env.NODE_ENV === 'test' ? [InternalTestController] : [] })
export class InternalModule {}

@Module({ imports: [ConfigModule, HealthModule] })
export class AppModule {
  readonly moduleName = 'AppModule';
}
