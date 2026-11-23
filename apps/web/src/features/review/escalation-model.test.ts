import { describe, expect, it } from 'vitest';
import { agentCard, escalationCard, type EscalationStateDto } from './escalation-model';

const agent = { id: 'a', name: 'reviewer-agent', kind: 'agent' as const };
const base = (over: Partial<EscalationStateDto> = {}): EscalationStateDto => ({
  slug: 'fix',
  bundleHash: 'b'.repeat(64),
  state: 'pending',
  firing: [],
  evaluatedAt: '2026-11-24T10:00:00Z',
  pageAuthors: { users: [], source: 'owners_file' },
  escalations: [],
  agentReviews: [],
  agentRuns: [],
  spotCheck: null,
  can: { escalate: false },
  ...over,
});
const escalation = {
  id: 'e',
  kind: 'rereview' as const,
  triggers: ['sourced_meaning'],
  notes: 'agent notes',
  requestedBy: agent,
  assignees: [
    { id: 'm', name: 'm.nguyen', kind: 'human' as const },
    { id: 'h', name: 'h.pham', kind: 'human' as const },
  ],
  topicId: null,
  createdAt: new Date(2026, 10, 24, 10, 9).toISOString(),
  resolvedAt: null,
  resolution: null,
  reminders: 0,
  lastRemindedAt: null,
};

describe('F-10 escalation card', () => {
  it('shows the open escalation with triggers, assignees and the reminder', () => {
    const card = escalationCard(base({ escalations: [escalation] }), 3);
    expect(card?.kind).toBe('Re-review by page authors');
    expect(card?.rows).toEqual([
      { k: 'Trigger', v: 'A number, unit or negation changes in a sentence with a source' },
      { k: 'Assigned to', v: 'm.nguyen, h.pham · page authors (wiki-meta/owners.md)' },
      { k: 'Waiting since', v: '10:09 · reminder in 3 days' },
      { k: 'Requested by', v: 'reviewer-agent (agent)' },
    ]);
    // The agent's notes belong to the Agent review card, not here.
    expect(card?.notes).toEqual([]);
  });

  it('counts reminders and ignores resolved escalations', () => {
    expect(
      escalationCard(base({ escalations: [{ ...escalation, reminders: 2 }] }), 3)?.rows[2]?.v,
    ).toBe('10:09 · 2 reminders sent');
    expect(
      escalationCard(base({ escalations: [{ ...escalation, resolvedAt: 'x' }] }), 3),
    ).toBeNull();
  });
});

describe('F-10 agent review card', () => {
  it('lists claims, notes and a trigger refusal', () => {
    const card = agentCard(
      base({
        agentReviews: [
          {
            id: 'r',
            jobId: 'j',
            outcome: 'escalated',
            verdict: 'approve',
            notes: 'Units are fine.',
            claims: [
              { claim: '1 Airy unit (AU)', source: '§2.4', supported: true },
              { claim: 'little extra sectioning', source: null, supported: false },
            ],
            refusals: [{ code: 'ESCALATION_REQUIRED', triggers: ['sourced_meaning'] }],
            decisionId: null,
            escalationId: 'e',
            provider: 'anthropic',
            model: 'claude-opus-5-5',
            promptVersion: 'agent-review-v1',
            createdAt: new Date(2026, 10, 24, 10, 9).toISOString(),
          },
        ],
      }),
    );
    expect(card?.outcome).toBe('Escalated to page authors');
    expect(card?.bullets).toEqual([
      'Checked: “1 Airy unit (AU)” matches §2.4.',
      'Not shown in the source: “little extra sectioning”.',
      'Units are fine.',
      'Approval refused by the API because of A number, unit or negation changes in a sentence with a source; escalated.',
    ]);
    expect(card?.meta).toBe('reviewer-agent · claude-opus-5-5 · agent-review-v1 · 10:09');
  });

  it('shows a run in progress, and nothing without runs', () => {
    expect(
      agentCard(
        base({
          agentRuns: [
            {
              jobId: 'j',
              status: 'queued',
              trigger: 'after_check',
              errorCode: null,
              createdAt: '2026-11-24T10:00:00Z',
            },
          ],
        }),
      )?.outcome,
    ).toBe('Waiting for the reviewer agent');
    expect(agentCard(base())).toBeNull();
  });
});
