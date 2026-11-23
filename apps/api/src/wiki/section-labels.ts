import { Injectable } from '@nestjs/common';
import { computeSectionLabel } from '@md-wiki/domain';

export interface SectionKey {
  path: string;
  anchor: string;
  sectionHash: string;
}

/** Phase 1 has no review or credibility records. Both reads and search use the same label source. */
@Injectable()
export class SectionLabels {
  forSection({ sectionHash }: SectionKey) {
    return computeSectionLabel({
      currentHash: sectionHash,
      confirmedErrors: [],
      openRecheckReasons: [],
      reviewedVersions: [],
      sourceChecks: [],
      ownerConfirmations: [],
    });
  }
}
