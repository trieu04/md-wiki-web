import { describe, expect, it } from 'vitest';
import {
  artifactHash,
  classifyWriteFailure,
  composeReplacement,
  conflictView,
  decisionGuard,
  decisionId,
  diskMatch,
  parseStatusBlock,
  pickAssignee,
  publishedSections,
  renderArtifact,
  resolutionAllowed,
  sha256Hex,
  splitSections,
  tabOf,
  validPreviewAt,
  type AssigneeCandidate,
  type DecisionFacts,
} from '../src/index.js';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('decisionId', () => {
  it('is a deterministic version-8 UUID bound to proposal, reviewer and preview time', () => {
    const id = decisionId('p', 'r', '2026-11-23T10:00:00.000Z');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(decisionId('p', 'r', '2026-11-23T10:00:00.000Z')).toBe(id);
    expect(decisionId('p', 'r2', '2026-11-23T10:00:00.000Z')).not.toBe(id);
    expect(decisionId('p2', 'r', '2026-11-23T10:00:00.000Z')).not.toBe(id);
    expect(decisionId('p', 'r', '2026-11-23T10:00:00.001Z')).not.toBe(id);
    // NUL separation: field boundaries cannot be shifted.
    expect(decisionId('ab', 'c', 't')).not.toBe(decisionId('a', 'bc', 't'));
  });
});

describe('renderArtifact', () => {
  const input = {
    slug: 'fix-units',
    decisionId: decisionId('p', 'r', '2026-11-23T10:00:00.000Z'),
    reviewerKind: 'person' as const,
    previewAt: '2026-11-23T10:00:00.000Z',
  };
  it('prefixes a parseable status block and keeps the proposed bytes exactly', () => {
    const proposed = enc('# T\r\n\nBody with no final newline  ');
    const artifact = renderArtifact(input, proposed);
    const parsed = parseStatusBlock(dec(artifact));
    expect(parsed.block).toMatchObject({
      proposal: 'fix-units',
      decision: input.decisionId,
      reviewer: 'person',
      decided_at: input.previewAt,
    });
    expect(parsed.body).toBe(dec(proposed));
    expect(artifact.slice(artifact.length - proposed.length)).toEqual(proposed);
    expect(artifactHash(input, proposed)).toBe(sha256Hex(artifact));
  });
  it('changes hash with any bound field', () => {
    const p = enc('x\n');
    const h = artifactHash(input, p);
    expect(artifactHash({ ...input, reviewerKind: 'agent' }, p)).not.toBe(h);
    expect(artifactHash({ ...input, previewAt: '2026-11-23T10:00:00.001Z' }, p)).not.toBe(h);
    expect(artifactHash(input, enc('y\n'))).not.toBe(h);
  });
  it('splits into the same section hashes as the proposed body (status block ignored)', () => {
    const proposed = '# A\n\nOne.\n\n## B\n\nTwo.\n';
    const fromArtifact = publishedSections(dec(renderArtifact(input, enc(proposed))));
    expect(fromArtifact).toEqual(
      splitSections(proposed).map((s) => ({ anchor: s.anchor, sectionHash: s.hash })),
    );
    expect(publishedSections('')).toEqual([]);
  });
});

describe('pickAssignee', () => {
  const user = (
    id: string,
    roles: AssigneeCandidate['roles'],
    createdAt: number,
    extra: Partial<AssigneeCandidate> = {},
  ): AssigneeCandidate => ({ id, kind: 'human', roles, disabled: false, createdAt, ...extra });
  it('picks the oldest enabled human owner who is not the submitter', () => {
    const users = [
      user('o2', ['owner'], 2),
      user('o1', ['owner'], 1),
      user('r', ['reviewer'], 0),
      user('bot', ['owner'], 0, { kind: 'agent' }),
      user('off', ['owner'], 0, { disabled: true }),
    ];
    expect(pickAssignee(users, 'x')).toEqual({ id: 'o1', reason: 'owner' });
    expect(pickAssignee(users, 'o1')).toEqual({ id: 'o2', reason: 'owner' });
  });
  it('falls back to a publisher, then a reviewer, when the only owner submitted', () => {
    const users = [
      user('o', ['owner'], 0),
      user('r', ['reviewer'], 1),
      user('p', ['publisher'], 5),
    ];
    expect(pickAssignee(users, 'o')).toEqual({ id: 'p', reason: 'fallback_reviewer' });
    expect(pickAssignee(users.slice(0, 2), 'o')).toEqual({ id: 'r', reason: 'fallback_reviewer' });
  });
  it('returns null when nobody else may decide (never the submitter, never agents)', () => {
    expect(pickAssignee([user('o', ['owner'], 0), user('c', ['contributor'], 1)], 'o')).toBeNull();
    expect(pickAssignee([user('a', ['reviewer'], 0, { kind: 'agent' })], 'o')).toBeNull();
    expect(pickAssignee([], 'o')).toBeNull();
  });
  it('breaks createdAt ties by id', () => {
    expect(pickAssignee([user('b', ['owner'], 1), user('a', ['owner'], 1)], 'x')?.id).toBe('a');
  });
});

describe('tabOf', () => {
  it.each([
    ['pending', null, 'open'],
    ['approved', null, 'open'],
    ['approved', 'prepared', 'open'],
    ['approved', 'not_written', 'open'],
    ['approved', 'unknown', 'blocked'],
    ['published', 'done', 'published'],
    ['rejected', null, 'rejected'],
    ['stale', 'stale', 'stale'],
    ['stale', null, 'stale'],
  ] as const)('%s + %s → %s', (state, phase, tab) => {
    expect(tabOf(state, phase)).toBe(tab);
  });
});

describe('decisionGuard (system-logic §7.4.3 order)', () => {
  const ok: DecisionFacts = {
    approve: true,
    state: 'pending',
    hasOpenAssignment: true,
    isOwnProposal: false,
    disputed: false,
    bindingMatches: true,
    versionsMatch: true,
    targetFresh: true,
    sourcesFresh: true,
    targetBlocked: false,
    isAgent: true,
    firingTriggers: [],
  };
  it('passes when every fact holds', () => {
    expect(decisionGuard(ok)).toBeNull();
    expect(decisionGuard({ ...ok, approve: false })).toBeNull();
  });
  it('reports the first failing check in order', () => {
    const failing: [Partial<DecisionFacts>, string][] = [
      [{ state: 'approved' }, 'PRECONDITION_FAILED'],
      [{ hasOpenAssignment: false }, 'NOT_ASSIGNED'],
      [{ isOwnProposal: true }, 'SELF_REVIEW'],
      [{ disputed: true }, 'DISPUTED'],
      [{ bindingMatches: false }, 'DECISION_BINDING_MISMATCH'],
      [{ versionsMatch: false }, 'DISCUSSION_CHANGED'],
      [{ targetFresh: false }, 'STALE_BASE'],
      [{ sourcesFresh: false }, 'SOURCE_CHANGED'],
      [{ targetBlocked: true }, 'TARGET_BLOCKED'],
      [{ firingTriggers: ['x'] }, 'ESCALATION_REQUIRED'],
    ];
    // Each fact alone yields its code; all failing together yields the first.
    for (const [facts, code] of failing) expect(decisionGuard({ ...ok, ...facts })).toBe(code);
    const all = Object.assign({}, ok, ...failing.map(([f]) => f)) as DecisionFacts;
    expect(decisionGuard(all)).toBe('PRECONDITION_FAILED');
    // Remove failures from the front one at a time: the next code surfaces.
    for (let i = 0; i < failing.length; i++) {
      const rest = Object.assign({}, ok, ...failing.slice(i).map(([f]) => f)) as DecisionFacts;
      expect(decisionGuard(rest)).toBe(failing[i]?.[1]);
    }
  });
  it('lets a rejection through disputes, stale context, blocked targets and triggers', () => {
    const reject = {
      ...ok,
      approve: false,
      disputed: true,
      targetFresh: false,
      sourcesFresh: false,
      targetBlocked: true,
      firingTriggers: ['x'],
    };
    expect(decisionGuard(reject)).toBeNull();
    expect(decisionGuard({ ...reject, bindingMatches: false })).toBe('DECISION_BINDING_MISMATCH');
    expect(decisionGuard({ ...reject, versionsMatch: false })).toBe('DISCUSSION_CHANGED');
  });
  it('only applies escalation triggers to agents', () => {
    expect(decisionGuard({ ...ok, isAgent: false, firingTriggers: ['x'] })).toBeNull();
  });
});

describe('classifyWriteFailure (D-79)', () => {
  it.each([
    ['PRECONDITION_FAILED', 'a', 'stale'],
    ['ALREADY_EXISTS', 'a', 'stale'],
    ['VERIFY_FAILED', 'a', 'unknown'],
    ['STORAGE_ERROR', 'a', 'written'],
    ['STORAGE_ERROR', 'b', 'unknown'],
    ['STORAGE_ERROR', null, 'unknown'],
    [null, 'a', 'written'],
    [null, null, 'unknown'],
  ] as const)('%s with read-back %s → %s', (code, sha, outcome) => {
    expect(classifyWriteFailure(code, sha, 'a')).toBe(outcome);
  });
});

describe('diskMatch / resolutionAllowed (D-80)', () => {
  it('names what is on disk', () => {
    expect(diskMatch('n', 'n', 'o')).toBe('new');
    expect(diskMatch('o', 'n', 'o')).toBe('old');
    expect(diskMatch('x', 'n', 'o')).toBe('neither');
    expect(diskMatch(null, 'n', 'o')).toBe('missing');
    expect(diskMatch(null, 'n', null)).toBe('old');
  });
  it('allows only the outcome consistent with the bytes', () => {
    expect(resolutionAllowed('written', 'n', 'n')).toBe(true);
    expect(resolutionAllowed('written', 'o', 'n')).toBe(false);
    expect(resolutionAllowed('written', null, 'n')).toBe(false);
    expect(resolutionAllowed('not_written', 'o', 'n')).toBe(true);
    expect(resolutionAllowed('not_written', null, 'n')).toBe(true);
    expect(resolutionAllowed('not_written', 'n', 'n')).toBe(false);
  });
});

describe('conflictView / composeReplacement (system-logic §7.4.7)', () => {
  const v1 = '# Page\n\nIntro.\n\n## Detectors\n\nPMT.\n\n## Other\n\nX.\n';
  const v2 = '# Page\n\nIntro v2.\n\n## Detectors\n\nPMT and HyD.\n\n## Other\n\nX.\n';
  const mine = '# Page\n\nIntro.\n\n## Detectors\n\n| table |\n\n## Other\n\nX.\n';
  it('shows the section region of all three versions', () => {
    expect(conflictView(v1, v2, mine, 'detectors')).toEqual({
      scope: 'section',
      baseText: '## Detectors\n\nPMT.\n\n',
      currentText: '## Detectors\n\nPMT and HyD.\n\n',
      proposedText: '## Detectors\n\n| table |\n\n',
    });
  });
  it('falls back to whole bodies when the section is gone, or for page scope and creates', () => {
    const gone = '# Page\n\nIntro v2.\n';
    expect(conflictView(v1, gone, mine, 'detectors').scope).toBe('page');
    expect(conflictView(v1, v2, mine, null)).toMatchObject({ scope: 'page', baseText: v1 });
    expect(conflictView(null, v2, mine, null)).toMatchObject({
      scope: 'page',
      baseText: '',
      currentText: v2,
    });
    expect(conflictView(v1, null, mine, 'detectors')).toMatchObject({
      scope: 'page',
      currentText: '',
    });
  });
  it('strips a status block from the shown bodies', () => {
    const published = `<!-- md-wiki:status\nproposal: a\ndecision: 019ab789-97fd-72dc-b74c-2321af809fe6\nreviewer: agent\ndecided_at: 2026-11-23T10:42:00Z\n-->\n\n${v2}`;
    expect(conflictView(v1, published, mine, null).currentText).toBe(v2);
  });
  it('splices the replacement into the current version', () => {
    const view = conflictView(v1, v2, mine, 'detectors');
    const merged = composeReplacement(
      v2,
      view,
      'detectors',
      '## Detectors\n\nPMT and HyD.\n\n| table |\n\n',
    );
    expect(merged).toEqual({
      ok: true,
      value: '# Page\n\nIntro v2.\n\n## Detectors\n\nPMT and HyD.\n\n| table |\n\n## Other\n\nX.\n',
    });
    expect(composeReplacement(v2, { scope: 'page' }, 'detectors', 'All new\n')).toEqual({
      ok: true,
      value: 'All new\n',
    });
    expect(composeReplacement(null, { scope: 'page' }, null, 'Created\n')).toEqual({
      ok: true,
      value: 'Created\n',
    });
  });
});

describe('validPreviewAt', () => {
  const now = Date.parse('2026-11-23T10:00:00.000Z');
  it('accepts canonical past instants within skew', () => {
    expect(validPreviewAt('2026-11-23T09:00:00.000Z', now)).toBe(true);
    expect(validPreviewAt('2026-11-23T10:00:04.000Z', now)).toBe(true);
  });
  it('rejects future, non-canonical and invalid values', () => {
    expect(validPreviewAt('2026-11-23T10:00:06.000Z', now)).toBe(false);
    expect(validPreviewAt('2026-11-23T09:00:00Z', now)).toBe(false);
    expect(validPreviewAt('2026-02-30T09:00:00.000Z', now)).toBe(false);
    expect(validPreviewAt('yesterday', now)).toBe(false);
  });
});
