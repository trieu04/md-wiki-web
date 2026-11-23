import { describe, expect, it } from 'vitest';
import { agentMetricRows, type AgentMetricsDto } from './model';

const m: AgentMetricsDto = {
  days: 7,
  since: '2026-11-17T00:00:00Z',
  until: '2026-11-24T00:00:00Z',
  paused: false,
  reviews: 20,
  decided: 16,
  approved: 12,
  autoPublished: 12,
  sentBack: 4,
  escalated: { total: 3, rereview: 2, discussion: 1 },
  refusedByTriggers: 2,
  leftPending: 1,
  failed: 0,
  spotChecks: { sampled: 2, passed: 1, failed: 1, open: 0 },
  approvalErrorRate: 0.5,
  reverts: 0,
  byTrigger: [],
};

describe('F-13 reviewer agent metrics', () => {
  it('shows counts with shares of decided', () => {
    const rows = agentMetricRows(m);
    expect(rows.find((r) => r.k === 'Approved')?.v).toBe('12 · 75%');
    expect(rows.find((r) => r.k === 'Escalated to page authors')?.v).toBe(
      '3 (2 re-review, 1 discussion)',
    );
    expect(rows.find((r) => r.k === 'Approval error rate')?.v).toBe('50%');
  });

  it('handles nothing decided and no error rate', () => {
    const rows = agentMetricRows({ ...m, decided: 0, approved: 0, approvalErrorRate: null });
    expect(rows.find((r) => r.k === 'Approved')?.v).toBe('0');
    expect(rows.find((r) => r.k === 'Approval error rate')?.v).toBe('Not enough spot checks');
  });
});
