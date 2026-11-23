import type { components } from '@md-wiki/contracts';
import { renderStatusBlock } from '@md-wiki/domain';
import { visualNow } from './home-search';
import { frameSamples } from './samples';

type S = components['schemas'];
type ListItem = S['ProposalListItemDto'];
type Detail = S['ProposalDetailDto'];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hex = (c: string) => c.repeat(64).slice(0, 64);
const ago = (minutes: number) => new Date(Date.parse(visualNow) - minutes * 60_000).toISOString();
const user = (name: string, n: number): S['UserRefDto'] => ({
  id: uuid(100 + n),
  name,
  kind: name.endsWith('-agent') ? 'agent' : 'human',
});
const people = ['lab-agent', 'reviewer-agent', 'm.nguyen', 'h.pham', 't.le', 'a.tran'];
const ref = (name: string) => user(name, people.indexOf(name));
const ageMinutes = (age: string) => {
  const [n = '0', unit] = age.split(' ');
  return Number(n) * (unit === 'min' ? 1 : unit === 'h' ? 60 : 1440);
};

const stateOf = {
  open: 'pending',
  stale: 'stale',
  blocked: 'approved',
  published: 'published',
  rejected: 'rejected',
} as const;

/** Phase 7 quality summary: no run yet (the frames predate the quality check). */
export const noQuality: S['QualitySummaryDto'] = {
  status: 'none',
  findings: 0,
  counts: { info: 0, warning: 0, blocking: 0 },
  flags: [],
  current: false,
};

/** F-09 rows as wire items (Phase 5 has no escalation, so escalated rows are pending). */
export const visualProposalItems: ListItem[] = frameSamples.Proposals.all.map((row) => {
  const [targetPath = '', section = null] = row.where.replace(' (new)', '').split('#');
  const tab = row.s as ListItem['tab'];
  const decided = row.with.startsWith('Decided by ') ? ref(row.with.slice(11)) : null;
  return {
    slug: row.id,
    title: row.title,
    targetPath,
    pageTitle: row.title,
    section,
    sectionTitle: section,
    submitter: ref(row.author),
    state: stateOf[tab],
    tab,
    phase: tab === 'blocked' ? 'unknown' : tab === 'published' ? 'done' : null,
    withdrawn: false,
    conflict: tab === 'stale',
    assignees:
      tab === 'open'
        ? row.with
            .split(', ')
            .filter((name) => people.includes(name))
            .map(ref)
        : [],
    decision: decided && {
      approve: tab === 'published',
      reviewer: decided,
      reviewerKind: decided.kind === 'agent' ? 'agent' : 'person',
      at: ago(ageMinutes(row.age) - 5),
    },
    publishedVersion: tab === 'published' ? '20261123-1' : null,
    autoPublished: tab === 'published' ? row.detail.startsWith('Automatically') : null,
    quality: noQuality,
    createdAt: ago(ageMinutes(row.age)),
    updatedAt: tab === 'blocked' ? '2026-11-23T09:31:00.000Z' : ago(ageMinutes(row.age)),
  };
});

const counts = Object.fromEntries(
  frameSamples.Proposals.defs.map(({ id, count }) => [id, count]),
) as S['TabCountsDto'];

export function visualProposalList(tab: string | null): S['ProposalListDto'] {
  const id = tab ?? 'open';
  return {
    items: visualProposalItems.filter((item) => id === 'all' || item.tab === id),
    nextCursor: null,
    counts,
  };
}

const base = {
  path: 'confocal-microscopy.md',
  versionLabel: '20261120-1',
  sha256: hex('3f90aa12'),
};
const can = {
  decide: false,
  publish: false,
  withdraw: false,
  resolveConflict: false,
  resolveBlocked: false,
  rerunQuality: false,
};
const binding = {
  bundleHash: hex('a1f3c9e2'),
  artifactHash: hex('9c0e57b1'),
  previewAt: '2026-11-23T10:31:00.000Z',
  discussionVersion: 1,
  disputeVersion: 0,
};

const historyActions = [
  ['10:05', 'proposal.submitted', 'lab-agent'],
  ['10:05', 'proposal.assigned', null],
] as const;

function detail(slug: string, overrides: Partial<Detail>): Detail {
  const item = visualProposalItems.find((row) => row.slug === slug) ?? visualProposalItems[0];
  if (!item) throw new Error('No proposal fixtures');
  return {
    id: uuid(500),
    slug: item.slug,
    title: item.title,
    targetPath: item.targetPath,
    pageTitle: 'Confocal microscopy',
    section: item.section,
    sectionTitle: item.section && `${item.section.charAt(0).toUpperCase()}${item.section.slice(1)}`,
    submitter: item.submitter,
    state: item.state,
    tab: item.tab,
    origin: 'api',
    reason: 'Fix pinhole units: state the pinhole size in Airy units as the handbook does.',
    base,
    bundleHash: binding.bundleHash,
    proposedSha256: hex('5d0c'),
    sources: [
      { path: 'sources/pawley-handbook.md', versionLabel: '20261118-1', sha256: hex('77aa') },
    ],
    scope: [],
    appliesTo: [],
    createdAt: item.createdAt,
    withdrawn: null,
    preview: null,
    final: null,
    assignment: null,
    decisions: [],
    publication: null,
    publications: [],
    blockedBy: null,
    refs: [
      {
        role: 'target',
        path: base.path,
        versionLabel: base.versionLabel,
        sha256: base.sha256,
        currentVersionLabel: base.versionLabel,
        current: true,
      },
      {
        role: 'source',
        path: 'sources/pawley-handbook.md',
        versionLabel: '20261118-1',
        sha256: hex('77aa'),
        currentVersionLabel: '20261118-1',
        current: true,
      },
    ],
    conflict: null,
    discussion: {
      discussionVersion: 1,
      disputeVersion: 0,
      disputed: false,
      disputeOpen: false,
      held: false,
      topicId: null,
    },
    quality: noQuality,
    can,
    history: historyActions.map(([time, action, actor], index) => ({
      id: uuid(900 + index),
      at: `2026-11-23T${time}:00.000Z`,
      action,
      actor: actor ? ref(actor) : null,
      data: {},
    })),
    ...overrides,
  };
}

const decision = (approve: boolean): S['DecisionDto'] => ({
  id: uuid(700),
  reviewer: ref('m.nguyen'),
  reviewerKind: 'person',
  approve,
  reason: 'Checked “1 Airy unit (AU)” against §2.4.',
  ...binding,
  createdAt: '2026-11-23T10:44:00.000Z',
});

const publication = (phase: S['PublicationPhase']): S['PublicationDto'] => ({
  id: uuid(800),
  attempt: 1,
  phase,
  auto: true,
  actor: null,
  baseSha256: base.sha256,
  artifactHash: binding.artifactHash,
  receiptId: null,
  error: phase === 'unknown' ? 'outcome_unknown:STORAGE_ERROR' : null,
  versionLabel: phase === 'done' ? '20261123-3' : null,
  startedAt: '2026-11-23T09:31:00.000Z',
  writtenAt: null,
  finishedAt: null,
  updatedAt: '2026-11-23T09:31:00.000Z',
  resolution: null,
});

export const visualArtifact =
  renderStatusBlock({
    proposal: 'fix-pinhole-units',
    decision: uuid(700),
    reviewer: 'person',
    decided_at: binding.previewAt,
  }) +
  '## Principle\n\nClosing the pinhole below about 1 Airy unit (AU) gives little extra sectioning and reduces the detected signal.\n';

/** F-10 scenarios with Phase 5 data: decide (pending), publishing, blocked. */
export function visualProposal(slug: string, scenario: string | null): Detail {
  if (slug === 'detector-table') return visualConflictProposal;
  if (slug === 'deconv-iterations' || scenario === 'blocked')
    return detail('deconv-iterations', {
      state: 'approved',
      tab: 'blocked',
      decisions: [decision(true)],
      publication: publication('unknown'),
      publications: [publication('unknown')],
      final: { artifact: visualArtifact, artifactHash: binding.artifactHash },
      can: { ...can, resolveBlocked: true },
    });
  if (scenario === 'publishing')
    return detail(slug, {
      state: 'approved',
      tab: 'open',
      decisions: [decision(true)],
      publication: publication('writing'),
      publications: [publication('writing')],
      final: { artifact: visualArtifact, artifactHash: binding.artifactHash },
    });
  // F-10 *disputed*: h.pham's dispute is open (dispute v1), approval is held (Phase 6).
  const disputed = scenario === 'disputed';
  return detail(slug, {
    preview: {
      artifact: visualArtifact,
      artifactHash: binding.artifactHash,
      previewAt: binding.previewAt,
      decisionId: uuid(700),
      reviewerKind: 'person',
      binding: disputed ? { ...binding, disputeVersion: 1 } : binding,
    },
    ...(disputed && {
      discussion: {
        discussionVersion: 1,
        disputeVersion: 1,
        disputed: true,
        disputeOpen: true,
        held: false,
        topicId: null,
      },
    }),
    assignment: {
      id: uuid(600),
      assignee: ref('m.nguyen'),
      reason: 'owner',
      trigger: null,
      createdAt: ago(120),
    },
    can: { ...can, decide: true },
  });
}

export function visualDiff(): S['ProposalDiffDto'] {
  const before = [
    'A laser is scanned across the sample. Emitted fluorescence returns',
    'through the objective and the same scanning optics to a point detector.',
    'Closing the pinhole improves sectioning and reduces the detected signal.',
  ];
  return {
    against: 'base',
    from: { versionLabel: base.versionLabel, sha256: base.sha256, text: before.join('\n') },
    to: { sha256: binding.artifactHash, text: visualArtifact },
    lines: [
      { kind: 'same', oldLine: 12, newLine: 12, text: before[0] ?? '' },
      { kind: 'same', oldLine: 13, newLine: 13, text: before[1] ?? '' },
      { kind: 'del', oldLine: 14, newLine: null, text: before[2] ?? '' },
      {
        kind: 'add',
        oldLine: null,
        newLine: 14,
        text: 'Closing the pinhole below about 1 Airy unit (AU) gives little extra sectioning and reduces the detected signal.[^4]',
      },
      ...Array.from({ length: 24 }, (_, i) => ({
        kind: 'same' as const,
        oldLine: 15 + i,
        newLine: 15 + i,
        text: `Unchanged line ${String(i + 1)}`,
      })),
      { kind: 'add', oldLine: null, newLine: 41, text: '[^4]: sources/pawley-handbook.md, §2.4' },
    ],
    stats: { added: 2, removed: 1 },
  };
}

const conflictTexts = {
  baseText:
    '## Detectors\nPhotomultiplier tubes remain common.\nHybrid detectors offer higher quantum\nefficiency and lower noise.\n',
  currentText:
    '## Detectors\nPhotomultiplier tubes remain common.\nHybrid detectors (HyD) offer higher\nquantum efficiency and lower noise.\nSee detectors.md.\n',
  proposedText:
    '## Detectors\n| Detector | QE | Noise |\n| PMT | 20–30% | higher |\n| Hybrid | 40–45% | lower |\n',
};

/** F-07 sample: detector-table, stale under 20261123-2 published by lightsheet-lead-2. */
export const visualConflictProposal: Detail = detail('detector-table', {
  title: 'Detector comparison table',
  reason: 'Replace the detector prose with a comparison table.',
  state: 'stale',
  tab: 'stale',
  section: 'detectors',
  sectionTitle: 'Detectors',
  conflict: {
    section: 'detectors',
    scope: 'section',
    base: { versionLabel: '20261120-1', sha256: base.sha256 },
    current: {
      versionLabel: '20261123-2',
      sha256: hex('b2c4'),
      publishedBy: { slug: 'lightsheet-lead-2', reviewerKind: 'agent' },
    },
    ...conflictTexts,
    resolution: null,
  },
  can: { ...can, resolveConflict: true },
});

/** F-13 Blocked: deconv-iterations → deconvolution.md since 09:31. */
export const visualBlocked: S['BlockedListDto'] = {
  items: [
    {
      slug: 'deconv-iterations',
      title: 'Iteration count',
      targetPath: 'deconvolution.md',
      pageTitle: 'Deconvolution',
      since: '2026-11-23T09:31:00.000Z',
      error: 'outcome_unknown:STORAGE_ERROR',
      publicationId: uuid(800),
      expected: { sha256: hex('7b21e0c4') },
      old: { sha256: hex('3f90aa12') },
      disk: { sha256: hex('7b21e0c4'), matches: 'new' },
      waiting: [],
    },
  ],
};

export const visualAudit: S['AuditPageDto'] = {
  items: [
    {
      id: uuid(950),
      at: '2026-11-23T09:31:00.000Z',
      action: 'publication.unknown',
      actorKind: 'system',
      actor: null,
      subjectType: 'proposal',
      subjectId: uuid(500),
      data: { publicationId: uuid(800), error: 'outcome_unknown:STORAGE_ERROR' },
    },
    {
      id: uuid(951),
      at: '2026-11-23T09:30:00.000Z',
      action: 'proposal.decided',
      actorKind: 'human',
      actor: ref('m.nguyen'),
      subjectType: 'proposal',
      subjectId: uuid(500),
      data: { approve: true },
    },
  ],
  nextCursor: null,
};
