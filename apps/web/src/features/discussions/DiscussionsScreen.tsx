import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApi } from '../../lib/api';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { PillToggle } from '../../ui/PillToggle';
import { QueryFailure } from '../../ui/QueryFailure';
import { statusTones } from '../../ui/StatusDot';
import type { TopBarProps } from '../../ui/TopBar';
import { WorkspaceLayout } from '../../ui/WorkspaceLayout';
import type { WorkNavProps } from '../../ui/WorkNav';
import { askHref, selectedTopicId, topicFilters, topicRow, type TopicFilter } from './model';
import { topicQueryOptions, topicsQueryOptions } from './queries';
import { TopicThread } from './TopicThread';

function Rows({ space }: { space: string }) {
  return (
    <div className={`flex flex-col gap-12px ${space}`} aria-hidden="true">
      {[1, 2, 3].map((row) => (
        <div key={row} className="h-12px bg-row" />
      ))}
    </div>
  );
}

function SelectedThread({ id }: { id: string }) {
  const query = useQuery(topicQueryOptions(useApi(), id));
  return (
    <section
      aria-label="Thread"
      aria-busy={query.isPending || undefined}
      className="flex min-w-0 flex-thread flex-col rounded-10 border border-edge bg-surface"
    >
      {query.data ? (
        <TopicThread key={id} detail={query.data} />
      ) : query.isError ? (
        <div className="p-14px">
          <QueryFailure
            error={query.error}
            retry={() => void query.refetch()}
            busy={query.isFetching}
          />
        </div>
      ) : (
        <Rows space="px-18px py-16px" />
      )}
    </section>
  );
}

/** F-11 Discussions (D-118): filters, topic list, selected thread. */
export function DiscussionsScreen({
  filter,
  topic,
  onFilter,
  onTopic,
  topBar,
  workNav,
}: {
  filter: TopicFilter;
  topic: string | undefined;
  onFilter: (filter: TopicFilter) => void;
  onTopic: (id: string) => void;
  topBar: TopBarProps;
  workNav: WorkNavProps;
}) {
  const query = useInfiniteQuery(topicsQueryOptions(useApi(), filter));
  const counts = query.data?.pages[0]?.counts;
  const rows = useMemo(() => {
    const now = new Date();
    return (query.data?.pages ?? []).flatMap((page) =>
      page.items.map((item) => topicRow(item, now)),
    );
  }, [query.data]);
  const selected = selectedTopicId(topic, query.data ? rows : []);
  return (
    <WorkspaceLayout topBar={topBar} workNav={workNav}>
      <div className="flex flex-wrap items-end justify-between gap-x-24px gap-y-12px">
        <div className="flex flex-col gap-2px">
          <h1 className="text-24 font-bold">Discussions</h1>
          <span className="text-muted">
            Topics on a page section. A topic that holds a proposal blocks its approval until it is
            closed.
          </span>
        </div>
        <a
          href={askHref({})}
          className="rounded-8 bg-accent px-14px py-8px font-semibold text-surface no-underline hover:bg-accent-hover hover:text-surface"
        >
          New topic
        </a>
      </div>
      <div className="flex flex-wrap items-start gap-16px">
        <section
          aria-label="Topics"
          aria-busy={query.isPending || undefined}
          className="min-w-0 flex-topic-list overflow-hidden rounded-10 border border-edge bg-surface"
        >
          <div
            role="group"
            aria-label="Filter"
            className="flex flex-wrap gap-6px border-b border-divider px-12px py-10px"
          >
            {topicFilters(counts).map(({ id, label }) => (
              <PillToggle
                key={id}
                pressed={filter === id}
                onClick={() => {
                  onFilter(id);
                }}
              >
                {label}
              </PillToggle>
            ))}
          </div>
          {query.isPending ? (
            <Rows space="px-14px py-16px" />
          ) : query.isError && !query.data ? (
            <div className="p-14px">
              <QueryFailure
                error={query.error}
                retry={() => void query.refetch()}
                busy={query.isFetching}
              />
            </div>
          ) : rows.length ? (
            rows.map((row) => {
              const on = row.id === selected;
              return (
                <button
                  key={row.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    onTopic(row.id);
                  }}
                  className={`flex w-full flex-col items-start gap-3px border-b border-divider px-14px py-12px text-left text-primary hover:bg-nav-current ${on ? 'bg-selected' : 'bg-surface'}`}
                >
                  <span className="font-semibold wrap-anywhere">{row.title}</span>
                  <span className="font-mono text-12 text-muted wrap-anywhere">{row.where}</span>
                  <span className="flex flex-wrap gap-10px text-12 text-muted">
                    <span className="inline-flex items-center gap-6px">
                      <span
                        aria-hidden="true"
                        className={`size-8px rounded-4 ${statusTones[row.tone]}`}
                      />
                      {row.status}
                    </span>
                    <span>{row.meta}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="px-14px py-16px text-13 text-muted">No topics here.</p>
          )}
          {query.hasNextPage && (
            <div className="px-14px py-10px">
              <Button
                variant="secondary-compact"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </section>
        {selected ? (
          <SelectedThread id={selected} />
        ) : (
          query.data && (
            <Card
              className="flex-thread"
              title="Thread"
              header
              state={{ type: 'empty', message: 'Choose a topic to read its thread.' }}
            />
          )
        )}
      </div>
    </WorkspaceLayout>
  );
}
