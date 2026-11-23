import type { WikiPath } from '@md-wiki/domain';
import type { PrismaClient } from '@prisma/client';

export const PUBLICATION_LOOKUP = Symbol('PUBLICATION_LOOKUP');
export interface PublicationLookup {
  lastPublishedSha256(path: WikiPath): Promise<string | null>;
}
/** A lookup for indexer tests without a review history. `null` = never published. */
export class NoPublications implements PublicationLookup {
  lastPublishedSha256(_path: WikiPath): Promise<null> {
    return Promise.resolve(null);
  }
}
/**
 * The reviewed baseline of a page (system-logic §7.4.10, D-89): the artifact of its latest
 * publication that reached `written` or `done`. A page never published has none, so its
 * initial index is not an out-of-band change.
 */
export class PrismaPublications implements PublicationLookup {
  constructor(private readonly db: PrismaClient) {}
  async lastPublishedSha256(path: WikiPath): Promise<string | null> {
    const row = await this.db.publication.findFirst({
      where: { targetPath: path.path, phase: { in: ['written', 'done'] } },
      orderBy: [{ writtenAt: 'desc' }, { id: 'desc' }],
      select: { artifactHash: true },
    });
    return row?.artifactHash ?? null;
  }
}
