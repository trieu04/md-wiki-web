import type { WikiPath } from '@md-wiki/domain';

export const PUBLICATION_LOOKUP = Symbol('PUBLICATION_LOOKUP');
export interface PublicationLookup {
  lastPublishedSha256(path: WikiPath): Promise<string | null>;
}
// Publication arrives with the review flow. A page with no publication has no
// reviewed baseline; its initial index is not an out-of-band change.
export class NoPublications implements PublicationLookup {
  lastPublishedSha256(_path: WikiPath): Promise<null> {
    return Promise.resolve(null);
  }
}
