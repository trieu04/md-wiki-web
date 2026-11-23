import type { DraftDto } from '../../features/editor/model';
import type { SuggestionsDto } from '../../features/you/model';
import { visualPage } from './reading';

// F-06 Editor.dc.html sample data: the textarea text, the reason, the source and the base label.
const baseText =
  '## Principle\n\nA laser is scanned across the sample. Emitted fluorescence returns\nthrough the objective and the same scanning optics to a point detector.\nClosing the pinhole improves sectioning and reduces the detected signal.\n\n';
const content =
  '## Principle\n\nA laser is scanned across the sample. Emitted fluorescence returns\nthrough the objective and the same scanning optics to a point detector.\nClosing the pinhole below about 1 Airy unit (AU) gives little extra sectioning and reduces the detected signal.[^4]\n\n[^4]: sources/pawley-handbook.md, §2.4\n';
const sha = '0'.repeat(64);
const base = {
  path: visualPage.path,
  versionLabel: '20261120-1',
  sha256: sha,
  capturedAt: '2026-11-20T09:00:00Z',
};

/** `?baseChanged` in the page URL selects the frame's `baseChanged` variant. */
export function visualDraft(baseChanged: boolean): DraftDto {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    targetPath: visualPage.path,
    pageTitle: visualPage.title,
    section: 'principle',
    sectionTitle: 'Principle',
    title: '',
    content,
    reason: 'State the pinhole size in Airy units as the handbook does.',
    appliesTo: [],
    base,
    baseText,
    baseStartLine: 10,
    current: baseChanged
      ? { path: visualPage.path, versionLabel: '20261123-2', sha256: '1'.repeat(64) }
      : { path: base.path, versionLabel: base.versionLabel, sha256: sha },
    baseChanged,
    sectionChanged: baseChanged,
    currentText: baseChanged ? baseText.replace('improves', 'sharpens') : null,
    sources: [
      {
        path: 'sources/pawley-handbook.md',
        versionLabel: '20261118-1',
        sha256: sha,
        addedAt: '2026-11-23T10:30:00Z',
        changed: false,
      },
    ],
    createdAt: '2026-11-23T10:30:00Z',
    updatedAt: '2026-11-23T10:42:00Z',
  };
}

// F-05 You.dc.html, *Your suggestions* tab rows (only Phase 4 data: no decider names).
export const visualSuggestions: SuggestionsDto = {
  items: [
    {
      kind: 'proposal',
      id: '00000000-0000-4000-8000-0000000000a1',
      slug: 'detector-comparison-table',
      targetPath: visualPage.path,
      pageTitle: 'Confocal microscopy',
      section: 'detectors',
      sectionTitle: 'Detectors',
      title: 'Detector comparison table',
      state: 'stale',
      needsAttention: true,
      at: '2026-11-23T09:00:00Z',
    },
    {
      kind: 'proposal',
      id: '00000000-0000-4000-8000-0000000000b2',
      slug: 'depletion-wavelength',
      targetPath: 'sted-microscopy.md',
      pageTitle: 'STED microscopy',
      section: 'principle',
      sectionTitle: 'Principle',
      title: 'Depletion wavelength',
      state: 'published',
      needsAttention: false,
      at: '2026-11-22T12:00:00Z',
    },
    {
      kind: 'draft',
      id: '00000000-0000-4000-8000-0000000000d1',
      slug: null,
      targetPath: visualPage.path,
      pageTitle: 'Confocal microscopy',
      section: 'principle',
      sectionTitle: 'Principle',
      title: 'pinhole units',
      state: 'draft',
      needsAttention: false,
      at: '2026-11-23T10:42:00Z',
    },
  ],
  nextCursor: null,
  total: 3,
};
