import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { ApiError, useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { readStored, writeStored } from '../../lib/form-storage';
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
import { discussionsHref } from '../discussions/model';
import { proposalDiscussionQueryOptions, useDispute } from '../discussions/queries';
import { MarkdownArticle } from '../markdown/MarkdownArticle';
import { pageHref } from '../page/model';
import { DiscussionPanel, type DiscussionQuery } from './DiscussionPanel';
import {
  LOCK_CODES,
  bindingText,
  decisionChoices,
  decisionPanel,
  detailStatusInput,
  discussionCount,
  historyRows,
  holdAction,
  proposalStatus,
  readerBody,
  reasonStorageKey,
  refRows,
  reviewBanner,
  reviewDiff,
  reviewSubline,
  seenVersions,
  submitState,
  versionsChanged,
  type Banner,
  type DecisionChoice,
  type LockReason,
  type ProposalDetailDto,
  type SeenVersions,
} from './model';
import { proposalDiffQueryOptions, proposalQueryOptions, useDecide, usePublish } from './queries';

const headerAction =
  'rounded-8 border border-control bg-surface px-12px py-7px font-medium text-primary no-underline hover:bg-nav-current hover:text-primary';

const bannerBorder = {
  default: 'border-edge',
  warn: 'border-trust-recheck-border',
  error: 'border-trust-error-border',
} as const;

function StatusBanner({
  banner,
  onReload,
  onTab,
}: {
  banner: Banner;
  onReload: () => void;
  onTab: (tab: string) => void;
}) {
  const { action } = banner;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-x-16px gap-y-8px rounded-10 border bg-surface px-16px py-12px ${bannerBorder[banner.tone]}`}
    >
      <span>
        <strong>{banner.title}</strong> {banner.text}
      </span>
      {action.reload || action.tab ? (
        <button
          type="button"
          className="font-semibold text-accent underline"
          onClick={() => {
            if (action.tab) onTab(action.tab);
            else onReload();
          }}
        >
          {action.label}
        </button>
      ) : (
        <a href={action.href} className="font-semibold">
          {action.label}
        </a>
      )}
    </div>
  );
}

function DecisionForm({
  detail,
  locked,
  onLocked,
  onSeen,
}: {
  detail: ProposalDetailDto;
  locked: LockReason | null;
  onLocked: (code: LockReason) => void;
  onSeen: (seen: Partial<SeenVersions>) => void;
}) {
  const storageKey = reasonStorageKey(detail.slug);
  const [choice, setChoice] = useState<DecisionChoice>('approve');
  const [reason, setReason] = useState(() => readStored(storageKey));
  const [missing, setMissing] = useState(false);
  const decide = useDecide(detail.slug);
  const dispute = useDispute(detail.slug);
  const preview = detail.preview;
  const choices = decisionChoices(detail);
  const submit = submitState(choice, detail, locked);
  const error = choice === 'hold' ? dispute.error : decide.error;
  const showError =
    error && !(error instanceof ApiError && LOCK_CODES.includes(error.code)) ? error : null;

  function done() {
    writeStored(storageKey, null);
    setReason('');
  }
  function failed(failure: Error) {
    if (failure instanceof ApiError && LOCK_CODES.includes(failure.code))
      onLocked(failure.code as LockReason);
  }

  function send() {
    if (!preview) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setMissing(true);
      return;
    }
    setMissing(false);
    if (choice === 'hold') {
      dispute.mutate(
        {
          bundleHash: detail.bundleHash,
          disputeVersion: preview.binding.disputeVersion,
          action: holdAction(detail.discussion),
          reason: trimmed,
        },
        {
          onSuccess(log) {
            done();
            onSeen({ disputeVersion: log.disputeVersion });
          },
          onError: failed,
        },
      );
      return;
    }
    decide.mutate(
      { approve: choice === 'approve', reason: trimmed, ...preview.binding },
      { onSuccess: done, onError: failed },
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
          setChoice(value as DecisionChoice);
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
      <Button
        disabled={submit.disabled}
        loading={decide.isPending || dispute.isPending}
        onClick={send}
      >
        {submit.label}
      </Button>
    </div>
  );
}

function DecisionSection({
  detail,
  viewerId,
  locked,
  onLocked,
  onSeen,
}: {
  detail: ProposalDetailDto;
  viewerId: string | null;
  locked: LockReason | null;
  onLocked: (code: LockReason) => void;
  onSeen: (seen: Partial<SeenVersions>) => void;
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
        <DecisionForm detail={detail} locked={locked} onLocked={onLocked} onSeen={onSeen} />
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

function ContentSection({
  detail,
  tab,
  onTab,
  discussion,
  onSeen,
}: {
  detail: ProposalDetailDto;
  tab: string;
  onTab: (tab: string) => void;
  discussion: DiscussionQuery;
  onSeen: (seen: Partial<SeenVersions>) => void;
}) {
  const api = useApi();
  const diff = useQuery(proposalDiffQueryOptions(api, detail.slug));
  const changes = useMemo(
    () => (diff.data ? reviewDiff(diff.data, detail.sectionTitle) : null),
    [diff.data, detail.sectionTitle],
  );
  const history = historyRows(detail.history);
  const count = discussionCount(discussion.data);
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
        onChange={onTab}
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
            id: 'discussion',
            label: count === undefined ? 'Discussion' : `Discussion (${String(count)})`,
            panel: <DiscussionPanel detail={detail} query={discussion} onSeen={onSeen} />,
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
  const [errorLock, setErrorLock] = useState<LockReason | null>(null);
  // Versions the reviewer has read; an SSE refetch with newer ones locks the decision (D-123).
  const [seen, setSeen] = useState<SeenVersions>(() => seenVersions(detail));
  const [tab, setTab] = useState('changes');
  const discussion = useQuery(proposalDiscussionQueryOptions(useApi(), detail.slug));
  const locked = errorLock ?? (versionsChanged(seen, detail) ? 'DISCUSSION_CHANGED' : null);
  const status = proposalStatus(detailStatusInput(detail));
  const subline = reviewSubline(detail, new Date());
  const page = pageHref(detail.targetPath);
  const banner = reviewBanner(detail, locked, page, discussion.data);
  const topicId = detail.discussion.topicId;
  function onSeen(next: Partial<SeenVersions>) {
    setSeen((old) => ({ ...old, ...next }));
  }
  function reload() {
    const key = queryKeys.proposal(detail.slug);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: key, exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.proposalDiscussion(detail.slug) }),
    ]).then(() => {
      const fresh = queryClient.getQueryData<ProposalDetailDto>(key);
      if (fresh) setSeen(seenVersions(fresh));
      setErrorLock(null);
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
          <div className="flex flex-wrap gap-8px">
            {detail.conflict && (
              <a
                href={`/me/suggestions/${encodeURIComponent(detail.slug)}/resolve`}
                className={headerAction}
              >
                Compare with current
              </a>
            )}
            {topicId ? (
              <a href={discussionsHref({ filter: 'all', topic: topicId })} className={headerAction}>
                Discuss
              </a>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setTab('discussion');
                }}
              >
                Discuss
              </Button>
            )}
          </div>
        </div>
      </div>
      {banner && <StatusBanner banner={banner} onReload={reload} onTab={setTab} />}
      <div className="flex flex-wrap items-start gap-16px">
        <div className="flex min-w-0 flex-review-content flex-col gap-16px">
          <ContentSection
            detail={detail}
            tab={tab}
            onTab={setTab}
            discussion={discussion}
            onSeen={onSeen}
          />
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
            onLocked={setErrorLock}
            onSeen={onSeen}
          />
        </aside>
      </div>
    </>
  );
}

/** F-10 Review (D-98, D-121). Escalation, agent review, quality check and evidence are later phases. */
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
