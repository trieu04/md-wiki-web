import type { components } from '@md-wiki/contracts';

type S = components['schemas'];
const agent = {
  id: '00000000-0000-4000-8000-000000000901',
  name: 'reviewer-agent',
  kind: 'agent',
} as const;
const nguyen = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'm.nguyen',
  kind: 'human',
} as const;
const pham = { id: '00000000-0000-4000-8000-000000000002', name: 'h.pham', kind: 'human' } as const;
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const items: S['InboxItemDto'][] = [
  {
    id: 'escalation:1',
    kind: 'rereview',
    tab: 'decide',
    done: false,
    title: 'A claim is added to a sentence that cites a source',
    path: 'microscopy/confocal.md',
    pageTitle: 'Confocal microscopy',
    anchor: 'pinhole',
    proposal: { slug: 'confocal-pinhole', title: 'Pinhole size and sectioning', state: 'pending' },
    topicId: null,
    spotCheckId: null,
    why: 'The reviewer agent may not approve this change: a built-in rule sends it to page authors.',
    triggers: ['sourced_meaning'],
    agentNotes:
      'Checked: “1 Airy unit (AU)” matches §2.4.\nNot shown in the source: “little extra sectioning” in general. §2.4 covers 1.4 NA oil only.',
    from: agent,
    at: at(110),
    reminders: 0,
    action: 'decide',
  },
  {
    id: 'spot:1',
    kind: 'spot_check',
    tab: 'spot',
    done: false,
    title: 'Spot check: Objective cleaning',
    path: 'microscopy/objectives.md',
    pageTitle: 'Objectives',
    anchor: 'cleaning',
    proposal: { slug: 'objective-cleaning', title: 'Lens paper first', state: 'published' },
    topicId: null,
    spotCheckId: '00000000-0000-4000-8000-000000000a01',
    why: 'Published by the reviewer agent. Sampled for a check by a page author.',
    triggers: [],
    agentNotes: null,
    from: agent,
    at: at(60 * 26),
    reminders: 1,
    action: 'spot_check',
  },
  {
    id: 'check:1',
    kind: 'check',
    tab: 'check',
    done: false,
    title: 'A reader reported a problem in “Laser safety”',
    path: 'safety/lasers.md',
    pageTitle: 'Laser safety',
    anchor: 'class-4',
    proposal: null,
    topicId: null,
    spotCheckId: null,
    why: 'Reports on pages you author come here first.',
    triggers: [],
    agentNotes: null,
    from: pham,
    at: at(60 * 50),
    reminders: 0,
    action: 'open',
  },
];

export function visualInbox(tab: string | null): S['InboxDto'] {
  const t = tab ?? 'all';
  const list = t === 'all' ? items : t === 'done' ? [] : items.filter((i) => i.tab === t);
  return {
    items: list,
    nextCursor: null,
    counts: { all: 3, decide: 1, check: 1, spot: 1, mentions: 0, done: 0 },
  };
}

export function visualEscalation(slug: string, scenario: string | null): S['EscalationStateDto'] {
  const escalated = scenario !== 'not-escalated';
  return {
    slug,
    bundleHash: 'b'.repeat(64),
    state: 'pending',
    evaluatedAt: at(5),
    firing: escalated
      ? [
          {
            id: 'sourced_meaning',
            title: 'Adds a claim to a sentence that cites a source',
            detail: '',
          },
        ]
      : [],
    pageAuthors: { users: [nguyen, pham], source: 'owners_file' },
    escalations: escalated
      ? [
          {
            id: '00000000-0000-4000-8000-000000000e01',
            kind: 'rereview',
            triggers: ['sourced_meaning'],
            notes: '',
            requestedBy: agent,
            assignees: [nguyen, pham],
            topicId: null,
            createdAt: at(110),
            resolvedAt: null,
            resolution: null,
            reminders: 0,
            lastRemindedAt: null,
          },
        ]
      : [],
    agentReviews: escalated
      ? [
          {
            id: '00000000-0000-4000-8000-000000000b01',
            jobId: 'job-1',
            outcome: 'escalated',
            verdict: 'approve',
            notes: '',
            claims: [
              { claim: '1 Airy unit (AU)', source: '§2.4', supported: true },
              {
                claim: 'little extra sectioning',
                source: '§2.4 covers 1.4 NA oil only',
                supported: false,
              },
            ],
            refusals: [{ code: 'ESCALATION_REQUIRED', triggers: ['sourced_meaning'] }],
            decisionId: null,
            escalationId: '00000000-0000-4000-8000-000000000e01',
            provider: 'anthropic',
            model: 'claude-opus-5-5',
            promptVersion: 'agent-review-v1',
            createdAt: at(110),
          },
        ]
      : [],
    agentRuns: [],
    spotCheck: null,
    can: { escalate: !escalated },
  };
}

export const visualReviewSettings = {
  reviewModel: 'self_managed',
  autoPublish: true,
  spotCheckRate: 0.1,
  reminderDays: 3,
  qualityCheck: { onSubmit: true, rulesPath: 'wiki-meta/quality-rules.md' },
  pageAuthors: {
    order: ['owners_file', 'published_authors', 'owner'],
    ownersFile: { path: 'wiki-meta/owners.md', rules: 6, versionLabel: 'v12', warnings: [] },
  },
  triggers: [
    ['dispute_or_report', 'An open dispute, hold or report'],
    ['quality_blocking', 'A high-severity quality finding'],
    ['sourced_meaning', 'A number, unit or negation changes in a sentence with a source'],
    ['source_problem', 'A retracted or low-tier source is cited'],
    ['agent_edits_human_pages', 'An agent edits a page written by people'],
    ['wiki_meta', 'Any change under wiki-meta/'],
  ].map(([id = '', title = '']) => ({
    id,
    title,
    description: '',
    enabled: true,
    optional: id === 'agent_edits_human_pages',
    source: 'default' as const,
    match: null,
  })),
  agent: {
    user: agent,
    available: true,
    paused: false,
    pausedAt: null,
    pausedBy: null,
    pauseReason: null,
    tokenConfigured: true,
  },
  updatedAt: null,
  updatedBy: null,
} satisfies S['ReviewSettingsDto'];

export const visualAgentMetrics = {
  days: 7,
  since: at(7 * 24 * 60),
  until: at(0),
  paused: false,
  reviews: 41,
  decided: 34,
  approved: 29,
  autoPublished: 29,
  sentBack: 5,
  escalated: { total: 6, rereview: 5, discussion: 1 },
  refusedByTriggers: 4,
  leftPending: 1,
  failed: 0,
  spotChecks: { sampled: 3, passed: 3, failed: 0, open: 1 },
  approvalErrorRate: 0,
  reverts: 0,
  byTrigger: [{ id: 'sourced_meaning', n: 3 }],
} satisfies S['AgentMetricsDto'];
