import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import type { Type } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule, InternalModule } from '../src/app.module.js';
import { API_CONFIG } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const output = process.argv[2];
if (!output) throw new Error('Usage: openapi.ts <output.json>');

const config = new DocumentBuilder().setTitle('md-wiki API').setVersion('1').build();

// Scan each real listener's routes without loading local secrets or connecting to services.
async function scan(root: Type, listener: Parameters<typeof configureHttp>[1]) {
  const module = await Test.createTestingModule({ imports: [root] })
    .overrideProvider(API_CONFIG)
    .useValue({})
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();
  const app = module.createNestApplication();
  try {
    configureHttp(app, listener);
    return SwaggerModule.createDocument(app, config);
  } finally {
    await app.close();
  }
}

const publicApi = await scan(AppModule, { public: true });
const internalApi = await scan(InternalModule, { serviceToken: 'unused' });
const document = {
  ...publicApi,
  paths: { ...publicApi.paths, ...internalApi.paths },
  components: {
    ...publicApi.components,
    schemas: { ...publicApi.components?.schemas, ...internalApi.components?.schemas },
  },
};
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
