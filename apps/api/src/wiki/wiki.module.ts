import { Module } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PUBLICATION_LOOKUP,
  type PublicationLookup,
  PrismaPublications,
} from './indexer/publication-lookup.js';
import { WikiIndexer } from './indexer/wiki-indexer.js';
import { WikiReadController } from './read.controller.js';
import { SearchService } from './search.service.js';
import { PageAuthors } from './page-authors.js';
import { SectionEvidenceLoader } from './section-evidence.js';
import { SectionLabels } from './section-labels.js';
import { LocalFolderStorage } from './storage/local-folder-storage.js';
import type { WikiStorage } from './storage/wiki-storage.js';
import { WikiReadService } from './wiki-read.service.js';

export const WIKI_STORAGE = Symbol('WIKI_STORAGE');
@Module({
  imports: [PrismaModule],
  controllers: [WikiReadController],
  providers: [
    WikiReadService,
    SearchService,
    SectionLabels,
    SectionEvidenceLoader,
    PageAuthors,
    {
      provide: WIKI_STORAGE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => new LocalFolderStorage(config.WIKI_ROOT),
    },
    {
      provide: PUBLICATION_LOOKUP,
      inject: [PrismaService],
      useFactory: (db: PrismaService) => new PrismaPublications(db),
    },
    {
      provide: WikiIndexer,
      inject: [WIKI_STORAGE, PrismaService, PUBLICATION_LOOKUP],
      useFactory: (storage: WikiStorage, db: PrismaService, lookup: PublicationLookup) =>
        new WikiIndexer(storage, db, lookup),
    },
  ],
  exports: [
    WIKI_STORAGE,
    WikiIndexer,
    SectionLabels,
    SectionEvidenceLoader,
    PageAuthors,
    WikiReadService,
    SearchService,
  ],
})
export class WikiModule {}
