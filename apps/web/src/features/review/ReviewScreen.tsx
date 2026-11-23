import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { ApiError, useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { queryKeys } from '../../lib/query-keys';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { DiffView } from '../../ui/DiffView';
import { PublishProgress } from '../../ui/PublishProgress';
import { QueryFailure } from '../../ui/QueryFailure';
import { RadioCards } from '../../ui/RadioCards';
import { StatusDot } from '../../ui/StatusDot';
import { Table } from '../../ui/Table';
import { Tabs } from '../../ui/Tabs';
import type { TopBarProps } from '../../ui/TopBar';
import { WorkspaceLayout } from '../../ui/WorkspaceLayout';
import type { WorkNavProps } from '../../ui/WorkNav';
import { MarkdownArticle } from '../markdown/MarkdownArticle';
import { pageHref } from '../page/model';
import {
  LOCK_CODES,
  bindingText,
  decisionPanel,
  detailStatusInput,
  historyRows,
  proposalStatus,
  readerBody,
  reasonStorageKey,
  refRows,
  reviewBanner,
  reviewDiff,
  reviewSubline,
  type Banner,
  type LockReason,
  type ProposalDetailDto,
} from './model';
import { proposalDiffQueryOptions, proposalQueryOptions, useDecide, usePublish } from './queries';

const bannerBorder = {
  default: 'border-edge',
  warn: 'border-trust-recheck-border',
  error: 'border-trust-error-border',
} as const;

function StatusBanner({ banner, onReload }: { banner: Banner; onReload: () => void }) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-x-16px gap-y-8px rounded-10 border bg-surface px-16px py-12px ${bannerBorder[banner.tone]}`}
    >
      <span>
        <strong>{banner.title}</strong> {banner.text}
      </span>
      {banner.action.reload ? (
        <button type="button" className="font-semibold text-accent underline" onClick={onReload}>
          {banner.action.label}
        </button>
      ) : (
        <a href={banner.action.href} className="font-semibold">
          {banner.action.label}
        </a>
      )}
    </div>
  );
}

function readStored(key: string) {
  try {
    return globalThis.sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writeStored(key: string, value: string | null) {
  try {
    if (value === null) globalThis.sessionStorage.removeItem(key);
    else globalThis.sessionStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); the reason stays in component state.
  }
}

const choices = [
  {
    value: 'approve',
    label: 'Approve and publish',
    description: 'published at once',
    submit: 'Approve and publish',
  },
  {
    value: 'changes',
    label: 'Request changes',
    description: 'back to the author with your reason',
    submit: 'Send back with reason',
  },
] as const;

function DecisionForm({
  detail,
  locked,
  onLocked,
}: {
  detail: ProposalDetailDto;
  locked: LockReason | null;
  onLocked: (code: LockReason) => void;
}) {
  const storageKey = reasonStorageKey(detail.slug);
  const [choice, setChoice] = useState<'approve' | 'changes'>('approve');
  const [reason, setReason] = useState(() => readStored(storageKey));
  const [missing, setMissing] = useState(false);
  const decide = useDecide(detail.slug);
  const preview = detail.preview;
  const current = choices.find(({ value }) => value === choice) ?? choices[0];
  const error = decide.error;
  const showError =
    error && !(error instanceof ApiError && LOCK_CODES.includes(error.code)) ? error : null;

  function submit() {
    if (!preview) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setMissing(true);
      return;
    }
    setMissing(false);
    decide.mutate(
      { approve: choice === 'approve', reason: trimmed, ...preview.binding },
      {
        onSuccess() {
          writeStored(storageKey, null);
          setReason('');
        },
        onError(failure) {
          if (failure instanceof ApiError && LOCK_CODES.includes(failure.code))
            onLocked(failure.code as LockReason);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-10px">
      <RadioCards
        label="Outcome"
        variant="decision"
        options={choices.map(({ value, label, description }) => ({ value, label, description }))}
        value={choice}
        onChange={(value) => {
          setChoice(value as 'approve' | 'changes');
        }}
      />
      <label htmlFor="decision-reason" className="text-13 font-semibold">
        Reason (required)
      </label>
      <textarea
        id="decision-reason"
        rows={3}
        value={reason}
        placeholder="Claims and sources you checked, and why the decision follows"
        aria-invalid={missing || undefined}
        aria-describedby={missing ? 'decision-reason-error' : undefined}
        onChange={(event) => {
          setReason(event.target.value);
          writeStored(storageKey, event.target.value);
        }}
        className="resize-y rounded-8 border border-control px-10px py-8px text-13"
      />
      {missing && (
        <p id="decision-reason-error" className="text-12 text-trust-error-fg">
          Give a reason for your decision.
        </p>
      )}
      {showError && (
        <p role="alert" className="text-12 text-trust-error-fg">
          {messageForError(showError)}
        </p>
      )}
      <Button disabled={locked !== null || !preview} loading={decide.isPending} onClick={submit}>
        {locked ? 'Reread before deciding' : current.submit}
      </Button>
    </div>
  );
}

function DecisionSection({
  detail,
  viewerId,
  locked,
  onLocked,
}: {
  detail: ProposalDetailDto;
  viewerId: string | null;
  locked: LockReason | null;
  onLocked: (code: LockReason) => void;
}) {
  const panel = decisionPanel(detail, viewerId);
  const publish = usePublish(detail.slug);
  const binding = detail.preview?.binding ?? detail.decisions[0];
  return (
    <section
      aria-label="Decision"
      className="flex flex-col gap-12px rounded-10 border border-accent-tint bg-surface px-18px py-16px"
    >
      <h2 className="text-14 font-bold">Your decision</h2>
      {panel.kind === 'decide' && (
        <DecisionForm detail={detail} locked={locked} onLocked={onLocked} />
      )}
      {panel.kind === 'publishing' && (
        <div className="flex flex-col gap-8px">
          <span>{panel.text}</span>
          <PublishProgress steps={panel.steps} />
        </div>
      )}
      {panel.kind === 'note' && (
        <div className="flex flex-col gap-8px">
          <span>{panel.text}</span>
          {panel.publish && (
            <Button
              className="self-start"
              loading={publish.isPending}
              onClick={() => {
                publish.mutate(undefined);
              }}
            >
              Publish
            </Button>
          )}
          {publish.error && (
            <p role="alert" className="text-12 text-trust-error-fg">
              {messageForError(publish.error)}
            </p>
          )}
        </div>
      )}
      {binding && <span className="font-mono text-11 text-muted">{bindingText(binding)}</span>}
    </section>
  );
}

function ContentSection({ detail }: { detail: ProposalDetailDto }) {
  const api = useApi();
  const [tab, setTab] = useState('changes');
  const diff = useQuery(proposalDiffQueryOptions(api, detail.slug));
  const changes = useMemo(
    () => (diff.data ? reviewDiff(diff.data, detail.sectionTitle) : null),
    [diff.data, detail.sectionTitle],
  );
  const history = historyRows(detail.history);
  const wait = (render: (data: NonNullable<typeof diff.data>) => ReactNode) =>
    diff.data ? (
      render(diff.data)
    ) : diff.isError ? (
      <div className="p-14px">
        <QueryFailure error={diff.error} retry={() => void diff.refetch()} busy={diff.isFetching} />
      </div>
    ) : (
      <div className="flex flex-col gap-12px px-18px py-16px" aria-hidden="true">
        {[1, 2, 3].map((row) => (
          <div key={row} className="h-12px bg-row" />
        ))}
      </div>
    );
  const markdown = (text: string, empty: string) =>
    text.trim() ? (
      <div className="px-26px py-20px">
        <MarkdownArticle markdown={text} sections={[]} />
      </div>
    ) : (
      <p className="p-18px text-muted">{empty}</p>
    );
  return (
    <section
      aria-label="Content"
      className="overflow-hidden rounded-10 border border-edge bg-surface"
    >
      <Tabs
        label="View"
        selected={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'changes',
            label: 'Changes',
            panel: wait(() =>
              changes ? (
                <DiffView rows={changes.rows} heading={changes.heading} empty="No changes." />
              ) : null,
            ),
          },
          {
            id: 'final',
            label: 'Final page',
            panel: wait((data) => markdown(readerBody(data.to.text), 'The final page is empty.')),
          },
          {
            id: 'base',
            label: 'Current page',
            panel: wait((data) =>
              markdown(
                data.from.text,
                detail.base
                  ? 'The page was empty.'
                  : 'This is a new page; there is no current page.',
              ),
            ),
          },
          {
            id: 'history',
            label: `History (${String(history.length)})`,
            panel: (
              <ol className="m-0 flex list-none flex-col gap-10px px-18px py-14px">
                {history.map((row) => (
                  <li key={row.key} className="flex gap-14px">
                    <time
                      dateTime={row.at}
                      className="shrink-0 basis-diff-number pt-mark-x font-mono text-12 text-trust-none"
                    >
                      {row.time}
                    </time>
                    <span>{row.text}</span>
                  </li>
                ))}
              </ol>
            ),
          },
        ]}
      />
    </section>
  );
}

function ReasonSection({ detail }: { detail: ProposalDetailDto }) {
  const rows = refRows(detail.refs);
  return (
    <section
      aria-label="Reason and sources"
      className="flex flex-col gap-12px rounded-10 border border-edge bg-surface px-18px py-16px"
    >
      <div className="flex flex-col gap-2px">
        <h2 className="text-14 font-bold">Reason given by the author</h2>
        <p className="text-secondary">{detail.reason}</p>
      </div>
      {rows.length > 0 && (
        <>
          <Table label="Read by the author" widthClass="min-w-table-refs text-13">
            <thead>
              <tr>
                <th scope="col" className="py-6px">
                  Read by the author
                </th>
                <th scope="col" className="px-8px py-6px">
                  Version
                </th>
                <th scope="col" className="px-8px py-6px">
                  Now
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-divider!">
                  <td className="py-8px font-mono text-12">{row.path}</td>
                  <td className="p-8px font-mono text-12">{row.version}</td>
                  <td className="p-8px">{row.now}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <span className="text-12 text-muted">
            “Current” means unchanged since the author read it, not that it supports the claim.
          </span>
        </>
      )}
    </section>
  );
}

function Review({ detail, viewerId }: { detail: ProposalDetailDto; viewerId: string | null }) {
  const queryClient = useQueryClient();
  const [locked, setLocked] = useState<LockReason | null>(null);
  const status = proposalStatus(detailStatusInput(detail));
  const subline = reviewSubline(detail, new Date());
  const page = pageHref(detail.targetPath);
  const banner = reviewBanner(detail, locked, page);
  function reload() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.proposal(detail.slug) }).then(() => {
      setLocked(null);
    });
  }
  return (
    <>
      <div className="flex flex-col gap-6px">
        <span className="text-13 text-muted">
          <a href="/work/proposals" className="text-muted">
            Proposals
          </a>{' '}
          / <span className="font-mono">{detail.slug}</span>
        </span>
        <div className="flex flex-wrap items-start justify-between gap-x-24px gap-y-12px">
          <div className="flex flex-col gap-4px">
            <h1 className="text-24 font-bold">{detail.title}</h1>
            <span className="inline-flex flex-wrap items-center gap-x-12px gap-y-6px text-secondary">
              <StatusDot tone={status.tone} weight="semibold">
                {status.status}
              </StatusDot>
              <span className="text-muted">
                {subline.proposedBy} ·{' '}
                <a href={page} className="font-mono text-13">
                  {detail.targetPath}
                </a>{' '}
                · {subline.base}
              </span>
            </span>
          </div>
          {detail.conflict && (
            <div className="flex flex-wrap gap-8px">
              <a
                href={`/me/suggestions/${encodeURIComponent(detail.slug)}/resolve`}
                className="rounded-8 border border-control bg-surface px-12px py-7px font-medium text-primary no-underline hover:bg-nav-current"
              >
                Compare with current
              </a>
            </div>
          )}
        </div>
      </div>
      {banner && <StatusBanner banner={banner} onReload={reload} />}
      <div className="flex flex-wrap items-start gap-16px">
        <div className="flex min-w-0 flex-review-content flex-col gap-16px">
          <ContentSection detail={detail} />
          <ReasonSection detail={detail} />
        </div>
        <aside
          aria-label="Review panel"
          className="flex min-w-0 max-w-review-aside-max grow basis-review-aside flex-col gap-12px"
        >
          <DecisionSection
            detail={detail}
            viewerId={viewerId}
            locked={locked}
            onLocked={setLocked}
          />
        </aside>
      </div>
    </>
  );
}

/** F-10 Review (D-98). Escalation, agent review, quality check and evidence are later phases. */
export function ReviewScreen({
  slug,
  topBar,
  workNav,
}: {
  slug: string;
  topBar: TopBarProps;
  workNav: WorkNavProps;
}) {
  const query = useQuery(proposalQueryOptions(useApi(), slug));
  const session = useSession();
  return (
    <WorkspaceLayout topBar={topBar} workNav={workNav}>
      {query.data ? (
        <Review key={slug} detail={query.data} viewerId={session.data?.user?.id ?? null} />
      ) : query.isError ? (
        <QueryFailure
          error={query.error}
          retry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : (
        <Card title="Proposal" state={{ type: 'loading' }} />
      )}
    </WorkspaceLayout>
  );
}
