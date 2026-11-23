import { describe, expect, it } from 'vitest';
import {
  discussionSummary,
  disputeState,
  disputeStep,
  holdsApproval,
  isActive,
  mayCloseTopic,
  topicTab,
  topicTransition,
  validAgreement,
  type DisputeEventFact,
  type TopicStatus,
} from '../src/index.js';

const statuses: TopicStatus[] = ['open', 'on_hold', 'resolved', 'rejected'];

describe('topic transitions', () => {
  it('accepts replies only while open or on hold', () => {
    for (const s of statuses)
      for (const kind of ['comment', 'agreement'] as const)
        expect(topicTransition(s, { kind }).ok).toBe(s === 'open' || s === 'on_hold');
  });
  it('closes from open or on hold, never twice into on hold', () => {
    expect(topicTransition('open', { kind: 'close', outcome: 'resolved' })).toEqual({
      ok: true,
      status: 'resolved',
    });
    expect(topicTransition('on_hold', { kind: 'close', outcome: 'rejected' })).toEqual({
      ok: true,
      status: 'rejected',
    });
    expect(topicTransition('open', { kind: 'close', outcome: 'on_hold' })).toEqual({
      ok: true,
      status: 'on_hold',
    });
    expect(topicTransition('on_hold', { kind: 'close', outcome: 'on_hold' })).toMatchObject({
      ok: false,
      code: 'PRECONDITION_FAILED',
    });
    for (const s of ['resolved', 'rejected'] as const)
      for (const outcome of ['resolved', 'rejected', 'on_hold'] as const)
        expect(topicTransition(s, { kind: 'close', outcome })).toMatchObject({
          ok: false,
          code: 'PRECONDITION_FAILED',
          detail: 'The topic is already closed',
        });
  });
  it('reopens anything that is not open', () => {
    expect(topicTransition('open', { kind: 'reopen' }).ok).toBe(false);
    for (const s of ['on_hold', 'resolved', 'rejected'] as const)
      expect(topicTransition(s, { kind: 'reopen' })).toEqual({ ok: true, status: 'open' });
  });
  it('maps statuses to tabs', () => {
    expect(statuses.map(topicTab)).toEqual(['open', 'open', 'closed', 'closed']);
    expect(statuses.map(isActive)).toEqual([true, true, false, false]);
  });
});

describe('holds', () => {
  it('only resolved releases a proposal topic; plain topics never hold', () => {
    expect(holdsApproval(null)).toBe(false);
    for (const s of statuses) {
      expect(holdsApproval({ proposalId: 'p', status: s })).toBe(s !== 'resolved');
      expect(holdsApproval({ proposalId: null, status: s })).toBe(false);
    }
  });
});

describe('who may close', () => {
  const base = { isProposalTopic: false, isAuthor: false, isReviewer: false, isSubmitter: false };
  it('plain topic: author or reviewer', () => {
    expect(mayCloseTopic(base)).toBe('FORBIDDEN');
    expect(mayCloseTopic({ ...base, isAuthor: true })).toBeNull();
    expect(mayCloseTopic({ ...base, isReviewer: true })).toBeNull();
  });
  it('proposal topic: a reviewer who is not the submitter', () => {
    const p = { ...base, isProposalTopic: true };
    expect(mayCloseTopic({ ...p, isAuthor: true })).toBe('FORBIDDEN');
    expect(mayCloseTopic({ ...p, isReviewer: true })).toBeNull();
    expect(mayCloseTopic({ ...p, isReviewer: true, isSubmitter: true })).toBe('SELF_REVIEW');
    expect(mayCloseTopic({ ...p, isSubmitter: true })).toBe('FORBIDDEN');
  });
});

describe('agreements', () => {
  it('must reference an existing entry', () => {
    expect(validAgreement(1, 1)).toBe(true);
    expect(validAgreement(0, 3)).toBe(false);
    expect(validAgreement(4, 3)).toBe(false);
    expect(validAgreement(1.5, 3)).toBe(false);
  });
});

describe('dispute log (md-wiki semantic discussion)', () => {
  const log = (...actions: DisputeEventFact['action'][]) =>
    actions.map((action, i) => ({ seq: i + 1, action }));
  const step = (
    events: DisputeEventFact[],
    action: DisputeEventFact['action'],
    resolutionKind: string | null = null,
    relatedSlugs: string[] = [],
  ) => disputeStep(events, { action, resolutionKind, relatedSlugs });

  it('derives version and disputed from the log', () => {
    expect(disputeState([])).toEqual({ version: 0, disputed: false });
    expect(disputeState(log('open'))).toEqual({ version: 1, disputed: true });
    expect(disputeState(log('open', 'comment'))).toEqual({ version: 2, disputed: true });
    expect(disputeState(log('open', 'resolve'))).toEqual({ version: 2, disputed: false });
    expect(disputeState(log('open', 'resolve', 'reopen'))).toEqual({ version: 3, disputed: true });
  });
  it('open only first, reopen only after a resolve', () => {
    expect(step([], 'open')).toBeNull();
    expect(step(log('open', 'resolve'), 'open')?.detail).toMatch(/reopen/);
    expect(step([], 'reopen')?.code).toBe('PRECONDITION_FAILED');
    expect(step(log('open'), 'reopen')?.code).toBe('PRECONDITION_FAILED');
    expect(step(log('open', 'resolve'), 'reopen')).toBeNull();
  });
  it('comment and resolve need an open dispute', () => {
    expect(step([], 'comment')?.code).toBe('PRECONDITION_FAILED');
    expect(step(log('open', 'resolve'), 'resolve', 'scoped')?.code).toBe('PRECONDITION_FAILED');
    expect(step(log('open'), 'comment')).toBeNull();
    expect(step(log('open'), 'resolve', 'supported')).toBeNull();
  });
  it('resolution kind only and always on resolve', () => {
    expect(step(log('open'), 'resolve')).toMatchObject({
      code: 'VALIDATION_FAILED',
      field: 'resolutionKind',
    });
    expect(step(log('open'), 'resolve', 'agreed')?.code).toBe('VALIDATION_FAILED');
    expect(step([], 'open', 'scoped')?.field).toBe('resolutionKind');
  });
  it('related proposals are unique valid slugs, at most 50', () => {
    expect(step([], 'open', null, ['p2', 'p3'])).toBeNull();
    expect(step([], 'open', null, ['p2', 'p2'])?.field).toBe('relatedSlugs');
    expect(step([], 'open', null, ['Bad Slug'])?.field).toBe('relatedSlugs');
    expect(
      step(
        [],
        'open',
        null,
        Array.from({ length: 51 }, (_, i) => `p${String(i)}`),
      )?.field,
    ).toBe('relatedSlugs');
  });
});

describe('discussion summary', () => {
  it('is 0/0 and not disputed without records', () => {
    expect(discussionSummary(null, [])).toEqual({
      discussionVersion: 0,
      disputeVersion: 0,
      held: false,
      disputeOpen: false,
      disputed: false,
    });
  });
  it('a hold or an open dispute blocks approval', () => {
    expect(discussionSummary({ proposalId: 'p', status: 'open', version: 2 }, [])).toMatchObject({
      discussionVersion: 2,
      held: true,
      disputed: true,
    });
    expect(
      discussionSummary({ proposalId: 'p', status: 'resolved', version: 3 }, [
        { seq: 1, action: 'open' },
      ]),
    ).toMatchObject({ discussionVersion: 3, disputeVersion: 1, held: false, disputed: true });
    expect(
      discussionSummary({ proposalId: 'p', status: 'resolved', version: 3 }, [
        { seq: 1, action: 'open' },
        { seq: 2, action: 'resolve' },
      ]),
    ).toMatchObject({ disputed: false, disputeVersion: 2 });
  });
});
