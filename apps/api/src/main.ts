import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, InternalModule } from './app.module.js';
import { logger } from './common/request-id.middleware.js';
import { API_CONFIG } from './config/env.js';
import type { ApiConfig } from './config/env.js';
import { configureHttp } from './config/http.js';

import { AuthService } from './auth/auth.service.js';
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
    await app.get(WikiIndexer).reindex();
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
