import { Module } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PUBLICATION_LOOKUP,
  type PublicationLookup,
  NoPublications,
} from './indexer/publication-lookup.js';
import { WikiIndexer } from './indexer/wiki-indexer.js';
import { LocalFolderStorage } from './storage/local-folder-storage.js';
import type { WikiStorage } from './storage/wiki-storage.js';

export const WIKI_STORAGE = Symbol('WIKI_STORAGE');
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: WIKI_STORAGE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => new LocalFolderStorage(config.WIKI_ROOT),
    },
    { provide: PUBLICATION_LOOKUP, useClass: NoPublications },
    {
      provide: WikiIndexer,
      inject: [WIKI_STORAGE, PrismaService, PUBLICATION_LOOKUP],
      useFactory: (storage: WikiStorage, db: PrismaService, lookup: PublicationLookup) =>
        new WikiIndexer(storage, db, lookup),
    },
  ],
  exports: [WIKI_STORAGE, WikiIndexer],
})
export class WikiModule {}
