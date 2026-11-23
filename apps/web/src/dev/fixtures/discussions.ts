import type { components } from '@md-wiki/contracts';
import { visualNow } from './home-search';

type S = components['schemas'];
type Detail = S['TopicDetailDto'];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ago = (minutes: number) => new Date(Date.parse(visualNow) - minutes * 60_000).toISOString();
const people = [
  'lab-agent',
  'reviewer-agent',
  'm.nguyen',
  'h.pham',
  't.le',
  'a.tran',
  'l.tran',
] as const;
export const discussionUser = (name: (typeof people)[number]): S['UserRefDto'] => ({
  id: uuid(100 + people.indexOf(name)),
  name,
  kind: name.endsWith('-agent') ? 'agent' : 'human',
});

let next = 0;
const thread = (list: S['TopicEntryDto'][]) =>
  list.map((item, index) => ({ ...item, seq: index + 1 }));
function entry(
  author: (typeof people)[number],
  minutes: number,
  body: string,
  kind: S['TopicEntryDto']['kind'] = 'comment',
): S['TopicEntryDto'] {
  next += 1;
  return {
    id: uuid(2000 + next),
    seq: 0,
    kind,
    author: discussionUser(author),
    body,
    parentSeq: kind === 'comment' ? 1 : null,
    agreesWith: null,
    outcome: kind === 'close' ? 'resolved' : null,
    mentions: [],
    createdAt: ago(minutes),
  };
}

const open = { comment: true, close: true, reopen: false };

/** F-11 sample topics (frame `all`): the holding proposal topic, a report, a closed topic. */
export const visualTopics: Detail[] = [
  {
    id: uuid(1001),
    title: 'Lateral FWHM differs between two pages',
    path: 'point-spread-function.md',
    pageTitle: 'Point spread function',
    anchor: 'fwhm',
    sectionTitle: 'FWHM',
    versionLabel: '20261121-1',
    status: 'open',
    proposal: {
      slug: 'psf-fwhm-table',
      title: 'PSF FWHM table',
      state: 'pending',
      holds: true,
    },
    bundleHash: 'b'.repeat(64),
    author: discussionUser('reviewer-agent'),
    participants: ['reviewer-agent', 'm.nguyen', 'h.pham'].map((name) =>
      discussionUser(name as (typeof people)[number]),
    ),
    replies: 3,
    version: 2,
    createdAt: ago(22 * 60),
    updatedAt: ago(3 * 60),
    closed: null,
    can: open,
    entries: thread([
      entry(
        'reviewer-agent',
        22 * 60,
        'psf-fwhm-table states lateral FWHM = 0.51 λ/NA. deconvolution.md#psf-model states 0.61 λ/NA. I can’t approve while the pages disagree.',
        'open',
      ),
      entry(
        'h.pham',
        5 * 60,
        '0.61 is the Rayleigh distance, not FWHM. Both are right, but deconvolution.md should say which one it means.',
      ),
      entry(
        'm.nguyen',
        3 * 60,
        'Agreed. I’ll propose a wording fix on deconvolution.md and we can resolve this.',
      ),
    ]),
  },
  {
    id: uuid(1002),
    title: 'Pinhole wording outdated',
    path: 'confocal-microscopy.md',
    pageTitle: 'Confocal microscopy',
    anchor: 'principle',
    sectionTitle: 'Principle',
    versionLabel: '20261120-1',
    status: 'open',
    proposal: null,
    bundleHash: null,
    author: discussionUser('l.tran'),
    participants: [discussionUser('l.tran')],
    replies: 0,
    version: 1,
    createdAt: ago(24 * 60),
    updatedAt: ago(24 * 60),
    closed: null,
    can: open,
    entries: thread([
      entry(
        'l.tran',
        24 * 60,
        'The pinhole size wording predates the hybrid detector we now use.',
        'open',
      ),
    ]),
  },
  {
    id: uuid(1003),
    title: 'Should STED page cite vendor docs?',
    path: 'sted-microscopy.md',
    pageTitle: 'STED microscopy',
    anchor: 'principle',
    sectionTitle: 'Principle',
    versionLabel: '20261118-1',
    status: 'resolved',
    proposal: null,
    bundleHash: null,
    author: discussionUser('a.tran'),
    participants: [discussionUser('a.tran'), discussionUser('h.pham')],
    replies: 4,
    version: 6,
    createdAt: ago(4 * 1440),
    updatedAt: ago(3 * 1440),
    closed: {
      by: discussionUser('h.pham'),
      outcome: 'resolved',
      reason: 'Use the 2019 review article instead.',
      at: ago(3 * 1440),
    },
    can: { comment: false, close: false, reopen: true },
    entries: thread([
      entry('a.tran', 3 * 1440, 'Is the vendor application note a good enough source?', 'open'),
    ]),
  },
];

const counts: S['TopicCountsDto'] = { open: 3, mine: 2, closed: 41, all: 44 };

const listItem = ({
  versionLabel: _v,
  bundleHash: _b,
  participants: _p,
  closed: _c,
  entries: _e,
  can: _can,
  ...item
}: Detail): S['TopicListItemDto'] => item;

export function visualTopicList(filter: string | null): S['TopicListDto'] {
  const closed = (topic: Detail) => topic.status === 'resolved' || topic.status === 'rejected';
  const items = visualTopics.filter((topic) =>
    filter === 'all' ? true : filter === 'closed' ? closed(topic) : !closed(topic),
  );
  return { items: items.map(listItem), nextCursor: null, counts };
}

export function visualTopic(id: string): Detail | undefined {
  return visualTopics.find((topic) => topic.id === id);
}

/** F-10 › Discussion: one topic on #principle ("Is the claim general?"); disputed adds the log. */
export function visualProposalDiscussion(
  slug: string,
  scenario: string | null,
): S['ProposalDiscussionDto'] {
  const disputed = scenario === 'disputed';
  const bundleHash = 'a1f3c9e2'.repeat(8);
  const topic: Detail = {
    id: uuid(1010),
    title: 'Is the claim general?',
    path: 'confocal-microscopy.md',
    pageTitle: 'Confocal microscopy',
    anchor: 'principle',
    sectionTitle: 'Principle',
    versionLabel: '20261120-1',
    status: 'open',
    proposal: { slug, title: 'Pinhole units and sectioning', state: 'pending', holds: disputed },
    bundleHash,
    author: discussionUser('h.pham'),
    participants: [discussionUser('h.pham')],
    replies: 0,
    version: 1,
    createdAt: ago(20),
    updatedAt: ago(20),
    closed: null,
    can: open,
    entries: thread([
      entry(
        'h.pham',
        20,
        '§2.4 covers the 1.4 NA case only. Is “little extra sectioning” true for water objectives?',
        'open',
      ),
    ]),
  };
  const events: S['DisputeEventDto'][] = disputed
    ? [
        {
          seq: 1,
          action: 'open',
          actor: discussionUser('h.pham'),
          reason: 'Does the claim hold for other objectives? §2.4 covers 1.4 NA oil only.',
          resolutionKind: null,
          relatedSlugs: [],
          createdAt: ago(20),
        },
      ]
    : [];
  return {
    slug,
    bundleHash,
    state: 'pending',
    discussionVersion: 1,
    disputeVersion: events.length,
    held: false,
    disputeOpen: disputed,
    disputed,
    topic,
    disputes: {
      slug,
      bundleHash,
      disputeVersion: events.length,
      disputeOpen: disputed,
      events,
    },
  };
}
