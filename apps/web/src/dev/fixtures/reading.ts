import type { components } from '@md-wiki/contracts';
import type { PageDto } from '../../features/markdown/model';
import { frameSamples } from './samples';

export const visualMeta = {
  wikiName: 'Bioimaging core',
  wikiDescription: '',
} satisfies components['schemas']['MetaDto'];

const frame = frameSamples.Page;
const updatedAt = '2026-11-23T00:00:00Z';
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
  markdown: [
    ...frame.data.map(({ title, body, fn }) => `## ${title}\n\n${body}[^${fn}]`),
    ...frame.sources.map(
      ({ cite, status }, index) => `[^${String(index + 1)}]: ${cite} · ${status}`,
    ),
  ].join('\n\n'),
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
        label: k === 'none' ? 'not_reviewed' : (k as 'reviewed' | 'checked' | 'recheck'),
        since: k === 'none' ? null : updatedAt,
        reviewerKind: k === 'reviewed' ? 'agent' : k === 'checked' ? 'person' : null,
        reason,
      },
      warn: reason ? { reason, fixProposalSlug: null } : null,
    };
  }),
} satisfies PageDto;

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
