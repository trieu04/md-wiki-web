import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { AITag } from '../../ui/AITag';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Textarea } from '../../ui/Textarea';
import { escalationQueryOptions, useEscalate } from '../inbox/queries';
import { agentCard, escalationCard } from './escalation-model';

const section = 'flex flex-col gap-8px rounded-10 border border-edge bg-surface px-18px py-16px';

function EscalateForm({ slug, bundleHash }: { slug: string; bundleHash: string }) {
  const escalate = useEscalate(slug);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open)
    return (
      <Button
        variant="secondary-compact"
        className="self-start"
        onClick={() => {
          setOpen(true);
        }}
      >
        Ask page authors
      </Button>
    );
  return (
    <div className="flex flex-col gap-8px">
      {escalate.error && (
        <Callout tone="error" title="Not escalated.">
          {messageForError(escalate.error)}
        </Callout>
      )}
      <Textarea
        variant="compact"
        label="What should page authors look at"
        rows={3}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
      />
      <div className="flex flex-wrap gap-8px">
        <Button
          variant="secondary-compact"
          loading={escalate.isPending}
          disabled={!reason.trim()}
          onClick={() => {
            escalate.mutate({
              kind: 'rereview',
              reason: reason.trim(),
              bundleHash,
              triggers: ['judgement'],
            });
          }}
        >
          Send to page authors
        </Button>
        <Button
          variant="link"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** F-10 *Escalation* and *Agent review* cards (system-logic §7.8.5, D-220). Nothing when neither applies. */
export function EscalationPanel({ slug }: { slug: string }) {
  const query = useQuery(escalationQueryOptions(useApi(), slug));
  const state = query.data;
  if (!state) return null;
  const esc = escalationCard(state, null);
  const agent = agentCard(state);
  return (
    <>
      {esc ? (
        <section aria-label="Escalation" className={`${section} gap-10px`}>
          <h2 className="text-14 font-semibold">Escalation</h2>
          <span className="text-13 text-muted">{esc.kind}</span>
          <dl className="grid grid-cols-thread-props gap-x-12px gap-y-6px text-13">
            {esc.rows.map((r) => (
              <div key={r.k} className="contents">
                <dt className="text-muted">{r.k}</dt>
                <dd className="min-w-0 break-words">{r.v}</dd>
              </div>
            ))}
          </dl>
          {esc.notes.length > 0 && (
            <ul className="flex list-disc flex-col gap-3px pl-18px text-13 text-secondary">
              {esc.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        state.can.escalate && (
          <section aria-label="Escalation" className={section}>
            <h2 className="text-14 font-semibold">Escalation</h2>
            <span className="text-13 text-muted">
              Not escalated. Page authors can be asked to re-review before anyone decides.
            </span>
            <EscalateForm slug={slug} bundleHash={state.bundleHash} />
          </section>
        )
      )}
      {agent && (
        <section aria-label="Agent review" className={section}>
          <h2 className="flex items-center gap-8px text-14 font-semibold">
            Agent review <AITag />
          </h2>
          <span className="text-13 font-medium">{agent.outcome}</span>
          {agent.bullets.length > 0 && (
            <ul className="flex list-disc flex-col gap-3px pl-18px text-13 text-secondary">
              {agent.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <span className="text-12 text-trust-none">{agent.meta}</span>
        </section>
      )}
    </>
  );
}
