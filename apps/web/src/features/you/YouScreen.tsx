import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Card } from '../../ui/Card';
import { Table } from '../../ui/Table';
import { Switch } from '../../ui/Switch';
import { Tabs } from '../../ui/Tabs';
import { TopBar, type TopBarProps } from '../../ui/TopBar';
import { TrustIcon } from '../../ui/TrustIcon';
import { Radio } from '../../ui/Radio';
import { useFollowMutations } from '../trust/queries';
import {
  PREF_ROWS,
  activityRow,
  followRow,
  suggestionsModel,
  summaryTiles,
  youSubtitle,
  type ActivityRow,
  type FollowRow,
  type NotificationPrefsDto,
  type SuggestionRow,
  type YouTab,
} from './model';
import {
  activityQueryOptions,
  followedPagesQueryOptions,
  prefsQueryOptions,
  suggestionsQueryOptions,
  summaryQueryOptions,
  useSavePrefs,
} from './queries';

const cell = 'px-16px py-12px';

type InfiniteLike = {
  isPending: boolean;
  error: Error | null;
  data?: unknown;
  isFetching: boolean;
  refetch: () => unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

function ListPanel({
  title,
  query,
  empty,
  children,
}: {
  title: string;
  query: InfiniteLike;
  empty: string | null;
  children: ReactNode;
}) {
  if (query.isPending) return <Card title={title} state={{ type: 'loading' }} />;
  if (query.error && !query.data)
    return (
      <div className="p-16px">
        <Callout
          tone="error"
          queryError
          title={`Could not load ${title.toLowerCase()}.`}
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
  if (empty) return <p className="px-16px py-16px text-13 text-muted">{empty}</p>;
  return (
    <>
      {children}
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
}

function StatusCell({
  row,
}: {
  row: { label: SuggestionRow['label']; status: string; detail: string };
}) {
  return (
    <td className={cell}>
      <span className="inline-flex items-center gap-7px">
        <TrustIcon label={row.label} size={14} />
        {row.status}
      </span>
      {row.detail && <div className="text-12 text-muted">{row.detail}</div>}
    </td>
  );
}

function Head({ titles }: { titles: readonly string[] }) {
  return (
    <thead>
      <tr>
        {titles.map((title) => (
          <th key={title} scope="col" className="px-16px py-10px">
            {title}
          </th>
        ))}
        <th scope="col" className="px-16px py-10px">
          <span className="sr-only">Action</span>
        </th>
      </tr>
    </thead>
  );
}

function FollowTable({ rows }: { rows: readonly FollowRow[] }) {
  const { unfollow } = useFollowMutations();
  return (
    <Table label="Followed pages" widthClass="min-w-you-table">
      <Head titles={['Page', 'Last change', 'Trust now']} />
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
            <StatusCell row={row} />
            <td className={`${cell} whitespace-nowrap`}>
              <span className="flex flex-col items-start gap-4px">
                <Link
                  to={row.href}
                  className="font-medium"
                  aria-label={`${row.action}: ${row.page}`}
                >
                  {row.action}
                </Link>
                <Button
                  variant="link"
                  aria-label={`Unfollow ${row.page}`}
                  disabled={unfollow.isPending}
                  onClick={() => {
                    unfollow.mutate({ path: row.path });
                  }}
                >
                  Unfollow
                </Button>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ActivityTable({ rows }: { rows: readonly ActivityRow[] }) {
  return (
    <Table label="Your checks and reports" widthClass="min-w-you-table">
      <Head titles={['Section', 'What you did', 'Outcome']} />
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className={cell}>
              <span className="font-semibold">{row.page}</span>
              <div className="text-12 text-muted">{row.section}</div>
            </td>
            <td className={`${cell} text-secondary`}>{row.what}</td>
            <StatusCell row={row} />
            <td className={`${cell} whitespace-nowrap`}>
              <a href={row.href} className="font-medium" aria-label={`${row.action}: ${row.what}`}>
                {row.action}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SuggestionTable({ rows }: { rows: readonly SuggestionRow[] }) {
  return (
    <Table label="Your suggestions" widthClass="min-w-you-table">
      <Head titles={['Page', 'Your suggestion', 'Status']} />
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
            <StatusCell row={row} />
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

function Preferences() {
  const prefs = useQuery(prefsQueryOptions(useApi()));
  const save = useSavePrefs();
  const update = (next: NotificationPrefsDto) => {
    save.mutate(next);
  };
  const data = save.isPending ? save.variables : prefs.data;
  return (
    <section
      aria-label="Tell me when"
      className="flex flex-col gap-12px rounded-12 border border-edge bg-surface px-18px py-16px"
    >
      <h2 className="text-15 font-bold">Tell me when</h2>
      {prefs.isPending ? (
        <p className="text-13 text-muted">Loading…</p>
      ) : prefs.isError ? (
        <p className="text-13 text-trust-error-fg">{messageForError(prefs.error)}</p>
      ) : (
        data && (
          <>
            {PREF_ROWS.map(({ id, label }) => (
              <Switch
                key={id}
                label={label}
                checked={data.events[id]}
                disabled={save.isPending}
                onChange={(checked) => {
                  update({ ...data, events: { ...data.events, [id]: checked } });
                }}
              />
            ))}
            <fieldset className="flex flex-col gap-8px border-t border-row pt-12px">
              <legend className="pb-6px text-13 font-semibold">How</legend>
              <Radio
                name="channel"
                variant="form"
                label="In the wiki and a daily email"
                checked={data.channel === 'wiki_and_daily_email'}
                disabled={save.isPending}
                onChange={() => {
                  update({ ...data, channel: 'wiki_and_daily_email' });
                }}
              />
              <Radio
                name="channel"
                variant="form"
                label="In the wiki only"
                checked={data.channel === 'wiki'}
                disabled={save.isPending}
                onChange={() => {
                  update({ ...data, channel: 'wiki' });
                }}
              />
              <Radio
                name="channel"
                variant="form"
                label="Slack or Teams message (later)"
                disabled
              />
            </fieldset>
            {save.error && (
              <p className="text-12 text-trust-error-fg">{messageForError(save.error)}</p>
            )}
          </>
        )
      )}
    </section>
  );
}

function Summary() {
  const summary = useQuery(summaryQueryOptions(useApi()));
  return (
    <section
      aria-label="Your part this year"
      className="flex flex-col gap-12px rounded-12 border border-edge bg-surface px-18px py-16px"
    >
      <h2 className="text-15 font-bold">Your part this year</h2>
      {summary.isPending ? (
        <p className="text-13 text-muted">Loading…</p>
      ) : summary.isError ? (
        <p className="text-13 text-trust-error-fg">{messageForError(summary.error)}</p>
      ) : (
        <dl className="flex flex-col gap-8px">
          {summaryTiles(summary.data).map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-12px text-13">
              <dt className="text-secondary">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <span className="text-12 text-muted">Only you see this. It is not used to rate people.</span>
    </section>
  );
}

export function YouScreen({
  topBar,
  tab = 'following',
  onTab = () => undefined,
  now = () => new Date(),
}: {
  topBar: TopBarProps;
  tab?: YouTab;
  onTab?: (tab: YouTab) => void;
  now?: () => Date;
}) {
  const session = useSession();
  const api = useApi();
  const suggestions = useInfiniteQuery(suggestionsQueryOptions(api));
  const follows = useInfiniteQuery(followedPagesQueryOptions(api));
  const activity = useInfiniteQuery(activityQueryOptions(api));
  const model = useMemo(
    () => suggestionsModel(suggestions.data?.pages ?? [], now()),
    [suggestions.data, now],
  );
  const followRows = useMemo(
    () =>
      (follows.data?.pages ?? []).flatMap((page) =>
        page.items.map((item) => followRow(item, now())),
      ),
    [follows.data, now],
  );
  const activityRows = useMemo(
    () => (activity.data?.pages ?? []).flatMap((page) => page.items.map(activityRow)),
    [activity.data],
  );
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar {...topBar} />
      <main className="mx-auto box-border flex w-full max-w-reading flex-col gap-18px px-24px pt-28px pb-48px">
        <div className="flex flex-col gap-2px">
          <h1 className="text-24 font-bold">You</h1>
          <span className="text-muted">{youSubtitle(session.data?.user?.name)}</span>
        </div>
        <div className="flex flex-wrap items-start gap-24px">
          <section
            aria-label="Your activity"
            className="min-w-0 flex-reading-content overflow-hidden rounded-12 border border-edge bg-surface"
          >
            <Tabs
              label="Your activity"
              variant="activity"
              selected={tab}
              onChange={(id) => {
                onTab(id as YouTab);
              }}
              tabs={[
                {
                  id: 'following',
                  label: 'Followed pages',
                  ...(follows.data && { count: followRows.length }),
                  panel: (
                    <ListPanel
                      title="Followed pages"
                      query={follows}
                      empty={
                        followRows.length
                          ? null
                          : 'You don’t follow any pages yet. Use Follow on a page, or check or use a section.'
                      }
                    >
                      <FollowTable rows={followRows} />
                    </ListPanel>
                  ),
                },
                {
                  id: 'trust',
                  label: 'Your checks and reports',
                  ...(activity.data && { count: activity.data.pages[0]?.counts.all ?? 0 }),
                  panel: (
                    <ListPanel
                      title="Your checks and reports"
                      query={activity}
                      empty={
                        activityRows.length
                          ? null
                          : 'Nothing yet. Use I checked a source, I used it or Report a problem on any section.'
                      }
                    >
                      <ActivityTable rows={activityRows} />
                    </ListPanel>
                  ),
                },
                {
                  id: 'suggestions',
                  label: 'Your suggestions',
                  ...(suggestions.data && { count: model.total }),
                  panel: (
                    <ListPanel
                      title="Your suggestions"
                      query={suggestions}
                      empty={
                        model.rows.length
                          ? null
                          : 'No suggestions yet. Use Suggest an edit on any page to start one.'
                      }
                    >
                      <SuggestionTable rows={model.rows} />
                    </ListPanel>
                  ),
                },
              ].map((item) => ({ ...item, panel: item.id === tab ? item.panel : null }))}
            />
          </section>
          <div className="flex min-w-0 max-w-rail-page grow basis-rail-page flex-col gap-14px">
            <Preferences />
            <Summary />
          </div>
        </div>
      </main>
    </div>
  );
}
