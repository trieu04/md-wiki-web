import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { QueryFailure } from '../../ui/QueryFailure';
import { TopBar, type TopBarProps } from '../../ui/TopBar';
import { notificationRow, unreadLabel } from './model';
import { notificationsQueryOptions, useMarkRead } from './queries';

/** Derived screen (D-16): the bell's list, newest first. */
export function NotificationsScreen({
  topBar,
  now = () => new Date(),
}: {
  topBar: TopBarProps;
  now?: () => Date;
}) {
  const query = useInfiniteQuery(notificationsQueryOptions(useApi()));
  const markRead = useMarkRead();
  const rows = useMemo(
    () =>
      (query.data?.pages ?? []).flatMap((page) =>
        page.items.map((item) => notificationRow(item, now())),
      ),
    [query.data, now],
  );
  const unread = query.data?.pages[0]?.unread ?? 0;
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar {...topBar} />
      <main className="mx-auto box-border flex w-full max-w-article flex-col gap-18px px-24px pt-28px pb-48px">
        <div className="flex flex-wrap items-end justify-between gap-12px">
          <div className="flex flex-col gap-2px">
            <h1 className="text-24 font-bold">Notifications</h1>
            <span className="text-muted">{unreadLabel(unread)}</span>
          </div>
          {unread > 0 && (
            <Button
              variant="secondary"
              loading={markRead.isPending}
              onClick={() => {
                markRead.mutate({ all: true });
              }}
            >
              Mark all as read
            </Button>
          )}
        </div>
        {markRead.error && (
          <p className="text-12 text-trust-error-fg">{messageForError(markRead.error)}</p>
        )}
        {query.isPending ? (
          <Card title="Notifications" state={{ type: 'loading' }} />
        ) : query.error && !query.data ? (
          <QueryFailure
            error={query.error}
            retry={() => void query.refetch()}
            busy={query.isFetching}
          />
        ) : rows.length ? (
          <ul className="flex flex-col overflow-hidden rounded-12 border border-edge bg-surface">
            {rows.map((row) => (
              <li
                key={row.key}
                className={`flex gap-12px border-b border-row px-18px py-14px last:border-b-0 ${row.unread ? 'bg-selected' : ''}`}
              >
                <div className="flex min-w-0 flex-auto flex-col gap-2px">
                  <span className="text-12 font-semibold tracking-overline text-secondary uppercase">
                    {row.kind}
                    {row.page && ` · ${row.page}`}
                  </span>
                  {row.href ? (
                    <a
                      href={row.href}
                      className="font-medium"
                      onClick={() => {
                        if (row.unread) markRead.mutate({ ids: [row.id] });
                      }}
                    >
                      {row.text}
                    </a>
                  ) : (
                    <span>{row.text}</span>
                  )}
                  <time dateTime={row.at} className="text-12 text-muted">
                    {row.when}
                  </time>
                </div>
                {row.unread && <span className="sr-only">Unread</span>}
              </li>
            ))}
          </ul>
        ) : (
          <Card
            title="Notifications"
            header
            state={{ type: 'empty', message: 'No notifications yet.' }}
          />
        )}
        {query.hasNextPage && (
          <Button
            className="self-start"
            variant="secondary"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </main>
    </div>
  );
}
