import type { components } from '@md-wiki/contracts';
import { agentNotes, triggerText } from '../inbox/model';

type S = components['schemas'];
export type EscalationStateDto = S['EscalationStateDto'];
type AgentReviewDto = S['AgentReviewDto'];

const AUTHOR_SOURCE: Record<S['PageAuthorsDto']['source'], string> = {
  owners_file: 'page authors (wiki-meta/owners.md)',
  published_authors: 'page authors (published changes)',
  owner: 'the owner',
};
const OUTCOME: Record<AgentReviewDto['outcome'], string> = {
  approved: 'Approved',
  rejected: 'Sent back',
  escalated: 'Escalated to page authors',
  left_pending: 'Left for a person',
};
const RUN_STATUS: Record<S['AgentRunDto']['status'], string> = {
  queued: 'Waiting for the reviewer agent',
  running: 'The reviewer agent is reviewing',
  succeeded: 'Reviewed',
  failed: 'The agent run failed',
};

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export type EscalationCard = {
  kind: string;
  rows: { k: string; v: string }[];
  notes: string[];
};
/** F-10 *Escalation* card: the open escalation, newest first (system-logic §7.8.5). */
export function escalationCard(
  state: EscalationStateDto,
  reminderDays: number | null,
): EscalationCard | null {
  const open = state.escalations.find((e) => e.resolvedAt === null);
  if (!open) return null;
  const rows = [
    {
      k: open.triggers.length > 1 ? 'Triggers' : 'Trigger',
      v: open.triggers.map(triggerText).join('; ') || triggerText('judgement'),
    },
    {
      k: 'Assigned to',
      v: `${open.assignees.map((u) => u.name).join(', ') || 'nobody'} · ${AUTHOR_SOURCE[state.pageAuthors.source]}`,
    },
    {
      k: 'Waiting since',
      v:
        hhmm(open.createdAt) +
        (open.reminders > 0
          ? ` · ${String(open.reminders)} reminder${open.reminders > 1 ? 's' : ''} sent`
          : reminderDays
            ? ` · reminder in ${String(reminderDays)} day${reminderDays > 1 ? 's' : ''}`
            : ''),
    },
    {
      k: 'Requested by',
      v: `${open.requestedBy.name}${open.requestedBy.kind === 'agent' ? ' (agent)' : ''}`,
    },
  ];
  return {
    kind: open.kind === 'discussion' ? 'Discussion with page authors' : 'Re-review by page authors',
    rows,
    notes: open.requestedBy.kind === 'agent' ? [] : agentNotes(open.notes),
  };
}

export type AgentCard = {
  outcome: string;
  bullets: string[];
  meta: string;
};
/** F-10 *Agent review* (AI) card: the latest agent review, or the run in progress. */
export function agentCard(state: EscalationStateDto): AgentCard | null {
  const review = state.agentReviews[0];
  const run = state.agentRuns[0];
  if (!review) {
    if (!run) return null;
    return {
      outcome: RUN_STATUS[run.status],
      bullets: run.errorCode ? [`Error: ${run.errorCode}`] : [],
      meta: `reviewer-agent · ${hhmm(run.createdAt)}`,
    };
  }
  const bullets = [
    ...review.claims.map((c) =>
      c.supported
        ? `Checked: “${c.claim}”${c.source ? ` matches ${c.source}` : ''}.`
        : `Not shown in the source: “${c.claim}”${c.source ? ` (${c.source})` : ''}.`,
    ),
    ...agentNotes(review.notes),
    ...(review.refusals.some((r) => r.code === 'ESCALATION_REQUIRED')
      ? [
          `Approval refused by the API because of ${
            review.refusals
              .flatMap((r) => r.triggers)
              .map(triggerText)
              .join('; ') || 'a trigger'
          }; escalated.`,
        ]
      : []),
  ];
  const meta = ['reviewer-agent', review.model, review.promptVersion, hhmm(review.createdAt)]
    .filter(Boolean)
    .join(' · ');
  return { outcome: OUTCOME[review.outcome], bullets: bullets.slice(0, 10), meta };
}
