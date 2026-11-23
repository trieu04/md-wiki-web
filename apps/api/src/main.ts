import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, InternalModule } from './app.module.js';
import { logger } from './common/request-id.middleware.js';
import { API_CONFIG } from './config/env.js';
import type { ApiConfig } from './config/env.js';
import { configureHttp } from './config/http.js';

import { AuthService } from './auth/auth.service.js';
import { PublishService } from './review/publish.service.js';
import { QualityJobs } from './quality/quality-jobs.service.js';
import { AgentRuns } from './agent/agent-runs.service.js';
import { ReviewSettingsService } from './agent/settings.service.js';
import { WikiIndexer } from './wiki/indexer/wiki-indexer.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const internal = await NestFactory.create(InternalModule);
  const config = app.get<ApiConfig>(API_CONFIG);
  configureHttp(app, { public: true });
  configureHttp(internal, { serviceToken: config.SERVICE_TOKEN });

  const close = () => Promise.all([app.close(), internal.close()]);
  try {
    await app.get(AuthService).seedOwner();
    // The reviewer agent user and its token from the environment (system-logic §7.8.2).
    await app.get(ReviewSettingsService).seed();
    await app.get(WikiIndexer).reindex();
    // Resume or classify publications a crash interrupted (system-logic §7.4.5).
    await app.get(PublishService).recover();
    // Quality runs whose enqueue was lost (Redis down at submit) go out again (§7.6.5).
    await app.get(QualityJobs).redispatch();
    // Agent reviews: re-send queued jobs, then create any the agent owes (§7.8.6).
    await app.get(AgentRuns).redispatch();
    await app.get(AgentRuns).reconcileAll();
    await internal.listen(config.INTERNAL_PORT, config.INTERNAL_HOST);
    await app.listen(config.API_PORT, config.API_HOST);
    logger.info(
      { publicUrl: await app.getUrl(), internalUrl: await internal.getUrl() },
      'API listening',
    );
  } catch (error) {
    await close();
    throw error;
  }
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      void close();
    });
}

void bootstrap();
