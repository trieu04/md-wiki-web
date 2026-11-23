import { describe, expect, it } from 'vitest';
import {
  agentRunDue,
  can,
  globMatch,
  inboxCounts,
  inboxTab,
  ownersOf,
  parseOwners,
  pickReviewer,
  reminderDue,
  resolvePageAuthors,
  spotCheckSampled,
  type AgentRunFacts,
  type AuthorCandidate,
  type InboxEntry,
} from '../src/index.js';

const OWNERS = `# Owners

| Path | Authors |
| --- | --- |
| imaging/** | Alice@example.org, bob@example.org |
| imaging/lens.md | carol@example.org |
| bad path! | x@example.org |
| protocols/ | |
| general | dan@example.org;eve@example.org |
`;

describe('owners.md', () => {
  it('parses tables with path and author columns, warning on bad rows', () => {
    const file = parseOwners(OWNERS);
    expect(file.rules.map((r) => [r.pattern, r.people])).toEqual([
      ['imaging/**', ['alice@example.org', 'bob@example.org']],
      ['imaging/lens.md', ['carol@example.org']],
      ['general', ['dan@example.org', 'eve@example.org']],
    ]);
    expect(file.warnings).toEqual(['row 3: invalid path pattern', 'row 4: no authors']);
    expect(parseOwners('# Nothing\n\nNo table.\n')).toEqual({ rules: [], warnings: [] });
    expect(parseOwners('| a | b |\n| - | - |\n| x | y |\n').rules).toEqual([]);
  });
  it('the last matching row wins (CODEOWNERS)', () => {
    const file = parseOwners(OWNERS);
    expect(ownersOf(file, 'imaging/lens.md')).toEqual(['carol@example.org']);
    expect(ownersOf(file, 'imaging/deep/x.md')).toEqual(['alice@example.org', 'bob@example.org']);
    expect(ownersOf(file, 'general/a.md')).toEqual(['dan@example.org', 'eve@example.org']);
    expect(ownersOf(file, 'other.md')).toEqual([]);
  });
  it('globs: * within a segment, ** across, trailing slash and bare folders', () => {
    expect(globMatch('*.md', 'a.md')).toBe(true);
    expect(globMatch('*.md', 'x/a.md')).toBe(false);
    expect(globMatch('**/*.md', 'x/y/a.md')).toBe(true);
    expect(globMatch('**/*.md', 'a.md')).toBe(true);
    expect(globMatch('x/', 'x/y/a.md')).toBe(true);
    expect(globMatch('x', 'xy/a.md')).toBe(false);
    expect(globMatch('a.b.md', 'aXb.md')).toBe(false);
  });
});

const users: AuthorCandidate[] = [
  { id: 'o', email: 'owner@example.org', kind: 'human', disabled: false, roles: ['owner'], createdAt: 1 },
  { id: 'a', email: 'alice@example.org', kind: 'human', disabled: false, roles: ['contributor'], createdAt: 2 },
  { id: 'b', email: 'bob@example.org', kind: 'human', disabled: true, roles: ['reviewer'], createdAt: 3 },
  { id: 'g', email: 'bot@example.org', kind: 'agent', disabled: false, roles: ['reviewer'], createdAt: 4 },
  { id: 'c', email: 'carol@example.org', kind: 'human', disabled: false, roles: ['contributor'], createdAt: 5 },
];

describe('page-author resolution', () => {
  const resolve = (listed: string[], published: string[], submitterId = 'x') =>
    resolvePageAuthors({ listed, published, users, submitterId });
  it('owners file first, skipping disabled people, agents and unknown emails', () => {
    expect(
      resolve(['ALICE@example.org', 'bob@example.org', 'bot@example.org', 'nobody@x.org'], ['c']),
    ).toEqual({ ids: ['a'], source: 'owners_file', humanAuthors: 2 });
  });
  it('else published human authors, most recent first, deduplicated', () => {
    expect(resolve([], ['c', 'g', 'a', 'c'])).toEqual({
      ids: ['c', 'a'],
      source: 'published_authors',
      humanAuthors: 2,
    });
  });
  it('excludes the submitter; nobody left → the owner', () => {
    expect(resolve(['alice@example.org'], ['c'], 'a')).toEqual({
      ids: ['o'],
      source: 'owner',
      humanAuthors: 2,
    });
    expect(resolve([], [])).toEqual({ ids: ['o'], source: 'owner', humanAuthors: 0 });
    // the owner never reviews their own proposal
    expect(resolve([], [], 'o')).toEqual({ ids: [], source: 'owner', humanAuthors: 0 });
  });
});

describe('reviewer pick (D-201)', () => {
  const candidates = [
    { id: 'o', kind: 'human' as const, roles: ['owner' as const], disabled: false, createdAt: 1 },
  ];
  it('assigns the available agent under self-managed review', () => {
    expect(pickReviewer('self_managed', { id: 'g', available: true }, candidates, 's')).toEqual({
      id: 'g',
      reason: 'agent',
    });
  });
  it('falls back to D-75: human model, unavailable agent, or the agent submitted', () => {
    const owner = { id: 'o', reason: 'owner' };
    expect(pickReviewer('human', { id: 'g', available: true }, candidates, 's')).toEqual(owner);
    expect(pickReviewer('self_managed', { id: 'g', available: false }, candidates, 's')).toEqual(
      owner,
    );
    expect(pickReviewer('self_managed', null, candidates, 's')).toEqual(owner);
    expect(pickReviewer('self_managed', { id: 'g', available: true }, candidates, 'g')).toEqual(
      owner,
    );
  });
});

describe('spot-check sampling (D-213)', () => {
  it('is deterministic and close to the rate', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-8000-8000-${String(i).padStart(12, '0')}`);
    const n = ids.filter((id) => spotCheckSampled(id, 0.1)).length;
    expect(n).toBeGreaterThan(140);
    expect(n).toBeLessThan(260);
    expect(ids.map((id) => spotCheckSampled(id, 0.1))).toEqual(
      ids.map((id) => spotCheckSampled(id, 0.1)),
    );
    expect(spotCheckSampled(ids[0] ?? '', 0)).toBe(false);
    expect(spotCheckSampled(ids[0] ?? '', 1)).toBe(true);
    expect(spotCheckSampled(ids[0] ?? '', Number.NaN)).toBe(false);
  });
});

describe('agent run due (D-209)', () => {
  const base: AgentRunFacts = {
    model: 'self_managed',
    paused: false,
    agentAvailable: true,
    state: 'pending',
    assignedAt: 100,
    returnedAt: null,
    qualityActive: false,
    runs: [],
  };
  it('first run after the check', () => {
    expect(agentRunDue(base)).toBe('after_check');
  });
  it('waits for the quality check, an active run, a pause, the model and the assignment', () => {
    expect(agentRunDue({ ...base, qualityActive: true })).toBeNull();
    expect(agentRunDue({ ...base, runs: [{ status: 'running', createdAt: 150 }] })).toBeNull();
    expect(agentRunDue({ ...base, paused: true })).toBeNull();
    expect(agentRunDue({ ...base, model: 'human' })).toBeNull();
    expect(agentRunDue({ ...base, agentAvailable: false })).toBeNull();
    expect(agentRunDue({ ...base, assignedAt: null })).toBeNull();
    expect(agentRunDue({ ...base, state: 'approved' })).toBeNull();
  });
  it('one review per round; a return starts a new round', () => {
    const done = { ...base, runs: [{ status: 'succeeded' as const, createdAt: 150 }] };
    expect(agentRunDue(done)).toBeNull();
    expect(agentRunDue({ ...done, returnedAt: 200 })).toBe('returned');
    expect(agentRunDue({ ...done, assignedAt: 300 })).toBe('resumed');
  });
  it('retries failures up to the cap per round', () => {
    const failed = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ status: 'failed' as const, createdAt: 110 + i }));
    expect(agentRunDue({ ...base, runs: failed(2) })).toBe('resumed');
    expect(agentRunDue({ ...base, runs: failed(3) })).toBeNull();
    expect(agentRunDue({ ...base, runs: failed(3), returnedAt: 500 })).toBe('returned');
  });
});

describe('reminders (D-212)', () => {
  const day = 86_400_000;
  it('every reminderDays, never once resolved', () => {
    const e = { createdAt: 0, lastRemindedAt: null, resolved: false };
    expect(reminderDue(e, 2, 2 * day - 1)).toBe(false);
    expect(reminderDue(e, 2, 2 * day)).toBe(true);
    expect(reminderDue({ ...e, lastRemindedAt: 2 * day }, 2, 3 * day)).toBe(false);
    expect(reminderDue({ ...e, resolved: true }, 2, 9 * day)).toBe(false);
    expect(reminderDue(e, 0, 9 * day)).toBe(false);
  });
});

describe('inbox tabs (D-215)', () => {
  const entries: InboxEntry[] = [
    { id: 'r1', kind: 'rereview', done: false, at: 3 },
    { id: 'd1', kind: 'discussion', done: false, at: 5 },
    { id: 's1', kind: 'spot_check', done: false, at: 4 },
    { id: 'm1', kind: 'mention', done: false, at: 1 },
    { id: 'r0', kind: 'review', done: true, at: 2 },
  ];
  it('counts open items per tab, done separately', () => {
    expect(inboxCounts(entries)).toEqual({
      all: 4,
      decide: 2,
      check: 0,
      spot: 1,
      mentions: 1,
      done: 1,
    });
  });
  it('lists a tab newest first', () => {
    expect(inboxTab(entries, 'all').map((e) => e.id)).toEqual(['d1', 's1', 'r1', 'm1']);
    expect(inboxTab(entries, 'decide').map((e) => e.id)).toEqual(['d1', 'r1']);
    expect(inboxTab(entries, 'done').map((e) => e.id)).toEqual(['r0']);
    expect(inboxTab(entries, 'check')).toEqual([]);
  });
});

describe('page-author rights on escalated proposals (D-208)', () => {
  const contributor = {
    kind: 'human' as const,
    roles: ['contributor' as const],
    auth: { kind: 'session' as const },
  };
  it('lets an escalation assignee read, decide and dispute', () => {
    const ctx = { isEscalationAssignee: true, hasOpenAssignment: true, isOwnProposal: false };
    expect(can(contributor, 'proposal.decide', ctx)).toEqual({ ok: true });
    expect(can(contributor, 'proposal.read', ctx)).toEqual({ ok: true });
    expect(can(contributor, 'dispute.write', ctx)).toEqual({ ok: true });
    expect(can(contributor, 'proposal.publish', { ...ctx, autoPublish: false }).ok).toBe(false);
    expect(can(contributor, 'admin.users', ctx).ok).toBe(false);
  });
  it('never for agents, empty roles, missing scopes or without the fact', () => {
    expect(can(contributor, 'proposal.decide', { hasOpenAssignment: true, isOwnProposal: false }).ok).toBe(false);
    const ctx = { isEscalationAssignee: true, hasOpenAssignment: true, isOwnProposal: false };
    expect(can({ ...contributor, kind: 'agent' }, 'proposal.decide', ctx).ok).toBe(false);
    expect(can({ ...contributor, roles: [] }, 'proposal.decide', ctx).ok).toBe(false);
    expect(
      can({ ...contributor, auth: { kind: 'token', scopes: ['read'] } }, 'proposal.decide', ctx).ok,
    ).toBe(false);
    expect(can(contributor, 'proposal.decide', { ...ctx, isOwnProposal: true })).toEqual({
      ok: false,
      code: 'SELF_REVIEW',
    });
  });
});
