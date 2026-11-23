import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Card } from '../../ui/Card';
import { Table } from '../../ui/Table';
import { Tabs } from '../../ui/Tabs';
import { TopBar, type TopBarProps } from '../../ui/TopBar';
import { TrustIcon } from '../../ui/TrustIcon';
import { suggestionsModel, youSubtitle, type SuggestionRow } from './model';
import { suggestionsQueryOptions } from './queries';

const cell = 'px-16px py-12px';

function SuggestionTable({ rows }: { rows: readonly SuggestionRow[] }) {
  return (
    <Table label="Your suggestions" widthClass="min-w-you-table">
      <thead>
        <tr>
          {['Page', 'Your suggestion', 'Status'].map((title) => (
            <th key={title} scope="col" className="px-16px py-10px">
              {title}
            </th>
          ))}
          <th scope="col" className="px-16px py-10px">
            <span className="sr-only">Action</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className={cell}>
              <Link to={row.pageHref} className="font-semibold no-underline">
                {row.page}
              </Link>
              <div className="text-12 text-muted">{row.section}</div>
            </td>
            <td className={`${cell} text-secondary`}>{row.what}</td>
            <td className={cell}>
              <span className="inline-flex items-center gap-7px">
                <TrustIcon label={row.label} size={14} />
                {row.status}
              </span>
              {row.detail && <div className="text-12 text-muted">{row.detail}</div>}
            </td>
            <td className={`${cell} whitespace-nowrap`}>
              <Link to={row.href} className="font-medium" aria-label={`${row.action}: ${row.what}`}>
                {row.action}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function YouScreen({
  topBar,
  now = () => new Date(),
}: {
  topBar: TopBarProps;
  now?: () => Date;
}) {
  const session = useSession();
  const query = useInfiniteQuery(suggestionsQueryOptions(useApi()));
  const [tab, setTab] = useState('suggestions');
  const model = useMemo(() => suggestionsModel(query.data?.pages ?? [], now()), [query.data, now]);
  let panel;
  if (query.isPending) panel = <Card title="Your suggestions" state={{ type: 'loading' }} />;
  else if (query.error && !query.data)
    panel = (
      <div className="p-16px">
        <Callout
          tone="error"
          queryError
          title="Could not load your suggestions."
          action={
            <Button
              variant="secondary"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          }
        >
          {messageForError(query.error)}
        </Callout>
      </div>
    );
  else if (!model.rows.length)
    panel = (
      <p className="px-16px py-16px text-13 text-muted">
        No suggestions yet. Use Suggest an edit on any page to start one.
      </p>
    );
  else
    panel = (
      <>
        <SuggestionTable rows={model.rows} />
        {query.hasNextPage && (
          <div className="border-t border-row px-16px py-12px">
            <Button
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </>
    );
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar {...topBar} />
      <main className="mx-auto box-border flex w-full max-w-reading flex-col gap-18px px-24px pt-28px pb-48px">
        <div className="flex flex-col gap-2px">
          <h1 className="text-24 font-bold">You</h1>
          <span className="text-muted">{youSubtitle(session.data?.user?.name)}</span>
        </div>
        <section
          aria-label="Your activity"
          className="min-w-0 overflow-hidden rounded-12 border border-edge bg-surface"
        >
          <Tabs
            label="Your activity"
            variant="activity"
            selected={tab}
            onChange={setTab}
            tabs={[
              {
                id: 'suggestions',
                label: 'Your suggestions',
                ...(query.data && { count: model.total }),
                panel,
              },
            ]}
          />
        </section>
      </main>
    </div>
  );
}
