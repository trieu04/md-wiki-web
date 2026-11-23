import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { AITag } from '../../ui/AITag';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { QueryFailure } from '../../ui/QueryFailure';
import { Tabs } from '../../ui/Tabs';
import { Textarea } from '../../ui/Textarea';
import type { TopBarProps } from '../../ui/TopBar';
import type { WorkNavProps } from '../../ui/WorkNav';
import { WorkspaceLayout } from '../../ui/WorkspaceLayout';
import {
  INBOX_TABS,
  inboxDetail,
  inboxRow,
  selectedItem,
  type InboxDetail,
  type InboxDot,
  type InboxItemDto,
  type InboxTab,
} from './model';
import { inboxQueryOptions, useSpotCheckOutcome } from './queries';

const overline = 'text-12 font-semibold tracking-overline text-secondary uppercase';
const dotClass: Record<InboxDot, string> = {
  decide: 'rounded-full bg-trust-recheck',
  check: 'rounded-1 bg-trust-error',
  spot: 'rounded-full bg-accent',
  mention: 'rounded-full bg-ai',
  done: 'rounded-full bg-trust-checked',
};
function Dot({ tone }: { tone: InboxDot }) {
  return <span aria-hidden="true" className={`inline-block size-8px ${dotClass[tone]}`} />;
}

function SpotCheckForm({ id }: { id: string }) {
  const outcome = useSpotCheckOutcome(id);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-col gap-10px">
      {outcome.error && (
        <Callout tone="error" title="Not recorded.">
          {messageForError(outcome.error)}
        </Callout>
      )}
      {failing ? (
        <>
          <Textarea
            label="What is wrong"
            hint="Recorded as a confirmed error on the sections this change touched."
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          <div className="flex flex-wrap gap-8px">
            <Button
              loading={outcome.isPending}
              disabled={!reason.trim()}
              onClick={() => {
                outcome.mutate({ outcome: 'failed', reason: reason.trim() });
              }}
            >
              Record a problem
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setFailing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-8px">
          <Button
            loading={outcome.isPending}
            onClick={() => {
              outcome.mutate({ outcome: 'passed', reason: 'Looks right' });
            }}
          >
            Looks right
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setFailing(true);
            }}
          >
            Report a problem
          </Button>
        </div>
      )}
    </div>
  );
}

function Detail({ detail }: { detail: InboxDetail }) {
  return (
    <section
      aria-label="Selected item"
      className="flex min-w-0 flex-inbox-detail flex-col gap-18px rounded-10 border border-edge bg-surface p-20px"
    >
      <div className="flex flex-col gap-6px">
        <span className={`inline-flex items-center gap-8px ${overline}`}>
          <Dot tone={detail.dot} />
          {detail.type}
        </span>
        <h2 className="text-19 leading-tight font-bold">{detail.title}</h2>
        <p className="text-secondary">{detail.why}</p>
      </div>
      <dl className="grid grid-cols-inbox-props gap-x-14px gap-y-8px border-y border-divider py-14px text-13">
        {detail.props.map((p) => (
          <div key={p.k} className="contents">
            <dt className="text-muted">{p.k}</dt>
            <dd className="min-w-0 break-words">{p.v}</dd>
          </div>
        ))}
      </dl>
      {detail.ai.length > 0 && (
        <div className="flex flex-col gap-6px">
          <span className="inline-flex items-center gap-8px font-semibold">
            Agent’s notes <AITag />
          </span>
          <ul className="flex list-disc flex-col gap-3px pl-18px text-secondary">
            {detail.ai.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-12px">
        <div className="flex flex-wrap gap-8px">
          <a
            href={detail.primary.href}
            className="rounded-8 bg-accent px-16px py-9px font-semibold text-surface no-underline hover:bg-accent-hover hover:text-surface"
          >
            {detail.primary.label}
          </a>
        </div>
        {detail.spotCheckId && <SpotCheckForm key={detail.spotCheckId} id={detail.spotCheckId} />}
      </div>
    </section>
  );
}

function Rows() {
  return (
    <div className="flex flex-col gap-12px px-16px py-14px" aria-hidden="true">
      {[1, 2, 3].map((row) => (
        <div key={row} className="h-12px bg-row" />
      ))}
    </div>
  );
}

/** F-08 Inbox (system-logic §7.8.8, D-215): tabs, item list, selected item. */
export function InboxScreen({
  tab,
  item,
  onTab,
  onItem,
  topBar,
  workNav,
}: {
  tab: InboxTab;
  item: string | undefined;
  onTab: (tab: InboxTab) => void;
  onItem: (id: string) => void;
  topBar: TopBarProps;
  workNav: WorkNavProps;
}) {
  const query = useInfiniteQuery(inboxQueryOptions(useApi(), tab));
  const counts = query.data?.pages[0]?.counts;
  const items: InboxItemDto[] = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  );
  const now = new Date();
  const current = selectedItem(item, items);
  const list = (
    <div className="flex flex-wrap items-start gap-16px pt-16px">
      <section
        aria-label="Items"
        aria-busy={query.isPending || undefined}
        className="min-w-0 flex-inbox-list overflow-hidden rounded-10 border border-edge bg-surface"
      >
        {query.isError ? (
          <div className="p-14px">
            <QueryFailure
              error={query.error}
              retry={() => void query.refetch()}
              busy={query.isFetching}
            />
          </div>
        ) : query.isPending ? (
          <Rows />
        ) : items.length === 0 ? (
          <p className="px-16px py-14px text-muted">
            {tab === 'done' ? 'Nothing finished in the last 30 days.' : 'Nothing waiting for you.'}
          </p>
        ) : (
          <ul>
            {items.map((it) => {
              const row = inboxRow(it, now);
              const on = row.id === current?.id;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      onItem(row.id);
                    }}
                    className={`flex w-full flex-col items-start gap-4px border-b border-divider px-16px py-14px text-left text-primary ${on ? 'bg-selected' : 'bg-surface hover:bg-nav-current'}`}
                  >
                    <span className="flex w-full justify-between gap-8px">
                      <span className={`inline-flex items-center gap-8px ${overline}`}>
                        <Dot tone={row.dot} />
                        {row.type}
                      </span>
                      <span className="text-12 text-trust-none">{row.age}</span>
                    </span>
                    <span className="text-14 font-semibold">{row.title}</span>
                    <span className="font-mono text-12 break-all text-muted">{row.where}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {query.hasNextPage && (
          <div className="p-12px">
            <Button
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </section>
      {current && <Detail detail={inboxDetail(current, now)} />}
    </div>
  );
  return (
    <WorkspaceLayout topBar={topBar} workNav={workNav}>
      <div className="flex flex-wrap items-end justify-between gap-x-24px gap-y-12px">
        <div className="flex flex-col gap-2px">
          <h1 className="text-24 font-bold">Inbox</h1>
          <span className="text-muted">
            Things assigned to you as a page author or reviewer. The reviewer agent handles the rest
            and publishes what it approves.
          </span>
        </div>
      </div>
      <Tabs
        label="Inbox filter"
        selected={tab}
        onChange={(id) => {
          onTab(id as InboxTab);
        }}
        tabs={INBOX_TABS.map(({ id, label }) => ({
          id,
          label,
          ...(counts && { count: counts[id] }),
          panel: id === tab ? list : null,
        }))}
      />
    </WorkspaceLayout>
  );
}
