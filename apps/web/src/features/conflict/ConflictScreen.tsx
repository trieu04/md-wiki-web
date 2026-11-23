import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiData, useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Card } from '../../ui/Card';
import { QueryFailure } from '../../ui/QueryFailure';
import { RadioCards } from '../../ui/RadioCards';
import { StatusDot } from '../../ui/StatusDot';
import { TopBar, type TopBarProps } from '../../ui/TopBar';
import { detailStatusInput, proposalStatus, type ProposalDetailDto } from '../review/model';
import { proposalQueryOptions, useWithdraw } from '../review/queries';
import {
  CONFLICT_CHOICES,
  choiceCopy,
  conflictInput,
  conflictPanes,
  conflictSubline,
  startingText,
  startsFrom,
  type ConflictChoice,
  type ConflictDto,
  type ConflictFormError,
  type ConflictInput,
  type LineTone,
} from './model';

const lineTone: Record<LineTone, string> = {
  plain: '',
  del: 'bg-trust-error-bg text-trust-error-fg',
  add: 'bg-trust-checked-bg text-trust-checked-fg',
  theirs: 'bg-trust-reviewed-bg text-trust-reviewed-fg',
};

function useResolveConflict(slug: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: ConflictInput) =>
      apiData(
        await api.POST('/api/v1/proposals/{slug}/conflict', { params: { path: { slug } }, body }),
      ),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposal(slug) });
      void queryClient.invalidateQueries({ queryKey: ['proposals'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.suggestions });
    },
  });
}

type Outcome = { title: string; replacement: string | null };

function Resolve({
  detail,
  conflict,
  onDone,
}: {
  detail: ProposalDetailDto;
  conflict: ConflictDto;
  onDone: (outcome: Outcome) => void;
}) {
  const [choice, setChoice] = useState<ConflictChoice>('merge');
  const [texts, setTexts] = useState<Partial<Record<ConflictChoice, string>>>({});
  const [reason, setReason] = useState(detail.reason);
  const [formError, setFormError] = useState<ConflictFormError>(null);
  const resolve = useResolveConflict(detail.slug);
  const withdraw = useWithdraw(detail.slug);
  const current = choiceCopy(choice);
  const text = texts[choice] ?? startingText(choice, conflict);
  const panes = conflictPanes(detail, conflict);
  const status = proposalStatus(detailStatusInput(detail));

  function submit() {
    const result = conflictInput(choice, reason, text);
    setFormError(result.error);
    if (result.input)
      resolve.mutate(result.input, {
        onSuccess({ replacement }) {
          onDone({
            title: replacement ? 'Submitted as a new proposal.' : 'Your change was dropped.',
            replacement: replacement?.slug ?? null,
          });
        },
      });
  }

  return (
    <>
      <div className="flex flex-col gap-6px">
        <span className="text-13 text-muted">
          <a href="/me" className="text-muted">
            Your suggestions
          </a>{' '}
          / {detail.title}
        </span>
        <div className="flex flex-wrap items-start justify-between gap-x-24px gap-y-12px">
          <div className="flex flex-col gap-4px">
            <h1 className="text-24 font-bold">The page changed under your proposal</h1>
            <span className="inline-flex flex-wrap items-center gap-x-12px gap-y-6px text-secondary">
              <StatusDot tone={status.tone} weight="semibold">
                {status.status}
              </StatusDot>
              <span className="text-muted">{conflictSubline(conflict)}</span>
            </span>
          </div>
          {detail.can.withdraw && (
            <div className="flex flex-wrap gap-8px">
              <Button
                variant="secondary"
                className="text-14"
                loading={withdraw.isPending}
                onClick={() => {
                  withdraw.mutate(
                    {},
                    {
                      onSuccess() {
                        onDone({ title: 'Proposal withdrawn.', replacement: null });
                      },
                    },
                  );
                }}
              >
                Withdraw proposal
              </Button>
            </div>
          )}
        </div>
      </div>
      {withdraw.error && (
        <Callout tone="error" title="Could not withdraw.">
          {messageForError(withdraw.error)}
        </Callout>
      )}

      <div className="overflow-hidden rounded-10 border border-edge bg-surface">
        <div className="grid grid-cols-panes">
          {panes.map((pane) => (
            <section
              key={pane.title}
              aria-label={pane.title}
              className="flex flex-col border-r border-divider"
            >
              <div className="flex flex-col border-b border-divider px-14px py-10px">
                <span className="font-semibold">{pane.title}</span>
                <span className="font-mono text-12 text-muted">{pane.meta}</span>
              </div>
              <div className="px-14px py-12px font-mono text-12-5 leading-diff whitespace-pre-wrap text-wiki-body">
                {pane.lines.map((line, index) => (
                  <div key={index} className={`px-4px ${lineTone[line.tone]}`}>
                    {line.text}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-16px">
        <section
          aria-label="Choose an outcome"
          className="flex min-w-0 flex-1 basis-conflict-choices flex-col gap-10px rounded-10 border border-edge bg-surface px-18px py-16px"
        >
          <h2 className="text-14 font-bold">What do you want to do?</h2>
          <RadioCards
            label="Outcome"
            variant="conflict"
            options={CONFLICT_CHOICES.map(({ value, label, hint }) => ({
              value,
              label,
              description: hint,
            }))}
            value={choice}
            onChange={(value) => {
              setChoice(value as ConflictChoice);
              setFormError(null);
            }}
          />
          <span className="text-12 text-muted">
            Nothing is merged for you. Whatever you submit is a new proposal on{' '}
            {conflict.current?.versionLabel ?? 'the current page'} and is reviewed again.
          </span>
        </section>

        <section
          aria-label="Merged text"
          className="flex min-w-0 flex-conflict-editor flex-col overflow-hidden rounded-10 border border-accent-tint bg-surface"
        >
          <div className="flex flex-wrap items-center justify-between gap-8px border-b border-divider px-14px py-10px">
            <span className="font-semibold">{current.editorTitle}</span>
            <span className="text-12 text-muted">Starts from: {startsFrom(choice, conflict)}</span>
          </div>
          <label htmlFor="conflict-text" className="sr-only">
            Merged section text
          </label>
          <textarea
            id="conflict-text"
            spellCheck={false}
            value={text}
            readOnly={choice === 'drop'}
            aria-invalid={formError?.field === 'text' || undefined}
            onChange={(event) => {
              setTexts((all) => ({ ...all, [choice]: event.target.value }));
            }}
            className="min-h-conflict-editor-min resize-y border-0 px-14px py-12px font-mono text-12-5 leading-diff focus-visible:-outline-offset-2"
          />
          {formError?.field === 'text' && (
            <p className="px-14px pb-8px text-12 text-trust-error-fg">{formError.message}</p>
          )}
          <div className="flex flex-col gap-4px border-t border-divider px-14px pt-12px">
            <label htmlFor="conflict-reason" className="text-13 font-semibold">
              Reason
            </label>
            <textarea
              id="conflict-reason"
              rows={2}
              value={reason}
              aria-invalid={formError?.field === 'reason' || undefined}
              aria-describedby={formError?.field === 'reason' ? 'conflict-reason-error' : undefined}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              className="resize-y rounded-8 border border-control px-10px py-8px text-13"
            />
            {formError?.field === 'reason' && (
              <p id="conflict-reason-error" className="text-12 text-trust-error-fg">
                {formError.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-8px px-14px py-12px">
            <span className="text-12 text-muted">
              Reason is copied from the old proposal. Edit it if the change is different now.
            </span>
            <Button className="px-16px py-9px" loading={resolve.isPending} onClick={submit}>
              {current.submit}
            </Button>
          </div>
          {resolve.error && (
            <p role="alert" className="px-14px pb-12px text-12 text-trust-error-fg">
              {messageForError(resolve.error)}
            </p>
          )}
        </section>
      </div>
    </>
  );
}

/** F-07 Conflict at /me/suggestions/:id/resolve, where `:id` is the proposal slug (D-99). */
export function ConflictScreen({ slug, topBar }: { slug: string; topBar: TopBarProps }) {
  const query = useQuery(proposalQueryOptions(useApi(), slug));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const detail = query.data;
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar {...topBar} />
      <main className="mx-auto flex w-full min-w-0 max-w-workspace flex-col gap-16px px-28px pt-20px pb-40px">
        {outcome ? (
          <Callout tone="success" title={outcome.title}>
            {outcome.replacement && (
              <>
                <span className="font-mono">{outcome.replacement}</span> is reviewed again.{' '}
              </>
            )}
            The old proposal is closed. <a href="/me">Back to your suggestions</a>
          </Callout>
        ) : detail ? (
          detail.conflict && !detail.conflict.resolution ? (
            <Resolve detail={detail} conflict={detail.conflict} onDone={setOutcome} />
          ) : (
            <Card
              title={detail.title}
              header
              state={{
                type: 'empty',
                message: detail.conflict?.resolution
                  ? 'This conflict is already resolved.'
                  : 'The page has not changed under this proposal. There is nothing to resolve.',
              }}
            />
          )
        ) : query.isError ? (
          <QueryFailure
            error={query.error}
            retry={() => void query.refetch()}
            busy={query.isFetching}
          />
        ) : (
          <Card title="The page changed under your proposal" state={{ type: 'loading' }} />
        )}
      </main>
    </div>
  );
}
