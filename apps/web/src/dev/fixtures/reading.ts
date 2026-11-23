import type { components } from '@md-wiki/contracts';
import type { PageDto } from '../../features/markdown/model';
import { frameSamples } from './samples';

export const visualMeta = {
  wikiName: 'Bioimaging core',
  wikiDescription: '',
} satisfies components['schemas']['MetaDto'];

const frame = frameSamples.Page;
const updatedAt = '2026-11-23T00:00:00Z';
const sampleLabels = {
  checked: 'checked',
  reviewed: 'reviewed',
  recheck: 'recheck',
  error: 'error',
  none: 'not_reviewed',
} as const;
function sampleLabel(key: string) {
  if (!Object.hasOwn(sampleLabels, key)) throw new Error(`Unknown F-03 label: ${key}`);
  return sampleLabels[key as keyof typeof sampleLabels];
}
export const visualPage = {
  path: 'confocal-microscopy.md',
  title: 'Confocal microscopy',
  topic: { id: 'microscopy-techniques', name: 'Microscopy techniques' },
  versionLabel: '20261123-2',
  sha256: '0'.repeat(64),
  updatedAt,
  changedOutsideReview: false,
  maintainers: [{ name: 'm.nguyen' }, { name: 'h.pham' }],
  usedByTeams: 4,
  pageLabel: {
    label: 'recheck',
    spread: { checked: 1, reviewed: 2, not_reviewed: 1, recheck: 1, error: 0 },
  },
  // F-03 source markers point to structured citations, not author-written footnotes (D-47).
  markdown: frame.data.map(({ title, body }) => `## ${title}\n\n${body}`).join('\n\n'),
  sections: frame.data.map(({ id, title, k }): PageDto['sections'][number] => {
    const reason =
      k === 'recheck'
        ? 'A reader reported the pinhole wording is outdated; m.nguyen confirmed it on 22 Nov. A fix is being reviewed.'
        : null;
    return {
      anchor: id,
      title,
      level: 2,
      hash: '0'.repeat(64),
      label: {
        label: sampleLabel(k),
        since: k === 'none' ? null : updatedAt,
        reviewerKind: k === 'reviewed' ? 'agent' : k === 'checked' ? 'person' : null,
        reason,
      },
      warn: reason ? { reason, fixProposalSlug: 'confocal-pinhole-wording' } : null,
    };
  }),
} satisfies PageDto;

export const visualPageTopic = {
  ...visualPage.topic,
  pageCount: frame.siblings.length,
  pages: frame.siblings.map(({ name, k, cur }) => ({
    path: cur ? visualPage.path : `${name.toLowerCase().replaceAll(' ', '-')}.md`,
    title: name,
    pageLabel: cur
      ? visualPage.pageLabel
      : {
          label: sampleLabel(k),
          spread: {
            checked: 0,
            reviewed: 0,
            not_reviewed: 0,
            recheck: 0,
            error: 0,
            [sampleLabel(k)]: 1,
          },
        },
    updatedAt,
  })),
} satisfies components['schemas']['TreeTopicDto'];

export const visualHistory = {
  items: [
    { versionLabel: visualPage.versionLabel, sha256: visualPage.sha256, capturedAt: updatedAt },
  ],
  nextCursor: null,
} satisfies components['schemas']['HistoryDto'];

export const visualSession = {
  user: {
    id: '00000000-0000-4000-8000-000000000000',
    kind: 'human',
    email: 'mn@example.test',
    name: 'm.nguyen',
    roles: ['reviewer'],
    teamId: null,
  },
  csrfToken: 'visual-only',
} satisfies components['schemas']['SessionDto'];
