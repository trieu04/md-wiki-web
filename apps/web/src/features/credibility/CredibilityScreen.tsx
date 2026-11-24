import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { useSession } from '../../lib/session';
import { AITag } from '../../ui/AITag';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Card } from '../../ui/Card';
import { QueryFailure } from '../../ui/QueryFailure';
import { RadioCards } from '../../ui/RadioCards';
import { SpreadBar } from '../../ui/SpreadBar';
import { Table } from '../../ui/Table';
import { Tabs } from '../../ui/Tabs';
import { Textarea } from '../../ui/Textarea';
import type { TopBarProps } from '../../ui/TopBar';
import { TrustIcon } from '../../ui/TrustIcon';
import type { WorkNavProps } from '../../ui/WorkNav';
import { WorkspaceLayout } from '../../ui/WorkspaceLayout';
import {
  CREDIBILITY_TABS,
  coverageRow,
  decisionInput,
  detailModel,
  queueRow,
  sourceRow,
  statTiles,
  type CredibilityTab,
  type QueueItemDetailDto,
  type QueueType,
} from './model';
import {
  pagesQueryOptions,
  queueItemQueryOptions,
  queueQueryOptions,
  sourcesQueryOptions,
  useDecide,
  useExport,
  useRunRetractionCheck,
} from './queries';

const overline = 'text-12 font-semibold tracking-overline text-secondary uppercase';

type Paged = {
  isPending: boolean;
  error: Error | null;
  data?: unknown;
  isFetching: boolean;
  refetch: () => unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

function PagedState({
  query,
  title,
  children,
}: {
  query: Paged;
  title: string;
  children: ReactNode;
}) {
  if (query.isPending) return <Card title={title} state={{ type: 'loading' }} />;
  if (query.error && !query.data)
    return (
      <div className="p-16px">
        <QueryFailure
          error={query.error}
          retry={() => void query.refetch()}
          busy={query.isFetching}
        />
      </div>
    );
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

function Decision({ item }: { item: QueueItemDetailDto }) {
  const model = detailModel(item);
  const decide = useDecide();
  const [outcome, setOutcome] = useState<string | null>(model.outcomes[0]?.value ?? null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ outcome?: string; reason?: string }>({});
  if (!model.canDecide)
    return model.reviewHref ? (
      <Link to={model.reviewHref} className="font-medium">
        See the fix in Proposals
      </Link>
    ) : model.outcomes.length ? (
      <p className="text-13 text-muted">Only a page author of this page can decide.</p>
    ) : (
      <p className="text-13 text-muted">For information only; nothing to decide.</p>
    );
  return (
    <form
      className="flex flex-col gap-12px"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const built = decisionInput(item, outcome, reason);
        if (!built.ok) {
          setErrors(built.errors);
          return;
        }
        setErrors({});
        decide.mutate(built.input, {
          onSuccess: () => {
            setReason('');
          },
        });
      }}
    >
      <h3 className="text-15 font-bold">{model.decideTitle}</h3>
      <RadioCards
        label={model.decideTitle}
        variant="decision"
        value={outcome ?? ''}
        onChange={setOutcome}
        options={model.outcomes}
      />
      {errors.outcome && <p className="text-12 text-trust-error-fg">{errors.outcome}</p>}
      <Textarea
        label="Reason (shown in the section’s evidence)"
        value={reason}
        rows={3}
        maxLength={4000}
        error={errors.reason}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <p className="text-12 text-muted">Readers see the new label as soon as you save.</p>
      {decide.error && (
        <Callout tone="error" title="Not saved.">
          {messageForError(decide.error)}
        </Callout>
      )}
      <Button type="submit" className="self-start" loading={decide.isPending}>
        Save decision
      </Button>
    </form>
  );
}

function Detail({ type, id }: { type: QueueType; id: string }) {
  const query = useQuery(queueItemQueryOptions(useApi(), type, id));
  if (query.isPending) return <Card title="Item" state={{ type: 'loading' }} />;
  if (query.isError)
    return (
      <QueryFailure
        error={query.error}
        retry={() => void query.refetch()}
        busy={query.isFetching}
      />
    );
  const model = detailModel(query.data);
  return (
    <section
      aria-label={model.kind}
      className="flex flex-col gap-16px rounded-12 border border-edge bg-surface px-20px py-18px"
    >
      <div className="flex flex-col gap-4px">
        <span className="inline-flex items-center gap-8px font-semibold">
          <TrustIcon label={model.label} size={14} />
          {model.kind}
          {model.ai && <AITag />}
        </span>
        <span className="text-13 text-muted">{model.where}</span>
      </div>
      <p>{model.why}</p>
      {!!model.properties.length && (
        <dl className="flex flex-col gap-6px text-13">
          {model.properties.map(({ label, value }) => (
            <div key={label} className="flex flex-wrap gap-x-10px">
              <dt className="w-inbox-term shrink-0 text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <section aria-label="Affected downstream" className="flex flex-col gap-6px">
        <h3 className={overline}>Affected downstream</h3>
        {model.downstream.length ? (
          <ul className="flex flex-col gap-4px text-13">
            {model.downstream.map((row) => (
              <li key={row.key} className="flex items-center gap-8px">
                <TrustIcon label={row.label} size={12} />
                <a href={row.href}>{row.text}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-13 text-muted">No other sections depend on it.</p>
        )}
      </section>
      {!!model.decisions.length && (
        <section aria-label="Decisions" className="flex flex-col gap-6px">
          <h3 className={overline}>Decided</h3>
          <ul className="flex flex-col gap-6px text-13">
            {model.decisions.map((decision) => (
              <li key={decision.key} className="flex flex-col">
                <span className="font-semibold">{decision.text}</span>
                <span className="text-secondary">{decision.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="border-t border-row pt-14px">
        <Decision key={`${type}:${id}:${String(query.data.decisions.length)}`} item={query.data} />
      </div>
    </section>
  );
}

function QueuePanel() {
  const query = useInfiniteQuery(queueQueryOptions(useApi()));
  const rows = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items.map(queueRow)),
    [query.data],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const selected = rows.find((row) => row.key === picked) ?? rows[0];
  return (
    <PagedState query={query} title="Needs a person">
      <p className="px-16px pt-12px text-12 text-muted">
        Ordered by reach: pages linking to it and teams using it. Not yet tuned (gate E8d).
      </p>
      {rows.length ? (
        <div className="flex flex-wrap items-start gap-16px p-16px">
          <ul
            aria-label="Items"
            className="flex min-w-0 grow basis-inbox-list flex-col overflow-hidden rounded-10 border border-edge"
          >
            {rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  aria-current={row === selected ? 'true' : undefined}
                  onClick={() => {
                    setPicked(row.key);
                  }}
                  className="flex w-full flex-col items-start gap-3px border-b border-divider bg-surface px-14px py-12px text-left text-primary aria-[current]:bg-selected"
                >
                  <span className="inline-flex items-center gap-8px font-semibold">
                    <TrustIcon label={row.label} size={12} />
                    {row.kind}
                    {row.ai && <AITag />}
                    {row.blocking && (
                      <span className="text-12 font-semibold text-trust-error-fg">Blocking</span>
                    )}
                  </span>
                  <span className="text-13">{row.where}</span>
                  <span className="text-12 text-muted">{row.reach}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 flex-workspace-content flex-col">
            {selected && <Detail key={selected.key} type={selected.type} id={selected.id} />}
          </div>
        </div>
      ) : (
        <p className="px-16px py-16px text-13 text-muted">Nothing needs a person right now.</p>
      )}
    </PagedState>
  );
}

function CoveragePanel() {
  const query = useInfiniteQuery(pagesQueryOptions(useApi()));
  const rows = (query.data?.pages ?? []).flatMap((page) => page.items.map(coverageRow));
  return (
    <PagedState query={query} title="Pages">
      {rows.length ? (
        <Table label="Pages" widthClass="min-w-table-settings">
          <thead>
            <tr>
              {['Page', 'Readers see', 'Sections', 'Oldest unchecked', 'Readers, 30 days'].map(
                (title) => (
                  <th key={title} scope="col" className="px-16px py-10px">
                    {title}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="px-16px py-12px">
                  <a href={row.href} className="font-semibold no-underline">
                    {row.page}
                  </a>
                </td>
                <td className="px-16px py-12px whitespace-nowrap">
                  <span className="inline-flex items-center gap-7px">
                    <TrustIcon label={row.label} size={13} />
                    {LABEL_TEXT[row.label]}
                  </span>
                </td>
                <td className="px-16px py-12px">
                  <SpreadBar size="sm" spread={row.spread} ariaLabel={row.ariaLabel} caption="" />
                </td>
                <td className="px-16px py-12px text-secondary">{row.oldest}</td>
                <td className="px-16px py-12px text-secondary">{row.readers}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="px-16px py-16px text-13 text-muted">No pages yet.</p>
      )}
    </PagedState>
  );
}

const LABEL_TEXT = {
  checked: 'Checked against source',
  reviewed: 'Reviewed',
  not_reviewed: 'Not reviewed',
  recheck: 'Under re-check',
  error: 'Confirmed error',
} as const;

function SourcesPanel() {
  const query = useInfiniteQuery(sourcesQueryOptions(useApi()));
  const rows = (query.data?.pages ?? []).flatMap((page) => page.items.map(sourceRow));
  return (
    <PagedState query={query} title="Sources">
      {rows.length ? (
        <Table label="Sources" widthClass="min-w-table-settings">
          <thead>
            <tr>
              {['Source', 'Tier', 'Status', 'Cited by', 'Last checked'].map((title) => (
                <th key={title} scope="col" className="px-16px py-10px">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="px-16px py-12px break-all">
                  <span className="font-mono text-12-5">{row.source}</span>
                </td>
                <td className="px-16px py-12px">{row.tier}</td>
                <td className="px-16px py-12px whitespace-nowrap">
                  <span className="inline-flex items-center gap-7px">
                    <TrustIcon label={row.tone} size={12} />
                    {row.status}
                  </span>
                </td>
                <td className="px-16px py-12px text-secondary">{row.cited}</td>
                <td className="px-16px py-12px text-secondary">{row.checked}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="px-16px py-16px text-13 text-muted">No sources cited yet.</p>
      )}
    </PagedState>
  );
}

function Tiles() {
  const pages = useInfiniteQuery(pagesQueryOptions(useApi()));
  const tiles = pages.data?.pages[0]?.tiles;
  if (!tiles) return null;
  return (
    <ul aria-label="Sections by label" className="flex flex-wrap gap-12px">
      {statTiles(tiles).map((tile) => (
        <li
          key={tile.label}
          className="flex min-w-0 grow basis-search-filter-basis flex-col gap-4px rounded-10 border border-edge bg-surface px-16px py-12px"
        >
          <span className="inline-flex items-center gap-7px text-13 font-semibold">
            <TrustIcon label={tile.label} size={13} />
            {tile.title}
          </span>
          <span className="text-24 font-bold">{tile.n}</span>
          <span className="text-12 text-muted">{tile.delta}</span>
        </li>
      ))}
    </ul>
  );
}

function OwnerActions() {
  const run = useRunRetractionCheck();
  const exported = useExport();
  return (
    <div className="flex flex-col items-end gap-6px">
      <div className="flex flex-wrap gap-8px">
        <Button
          variant="secondary"
          loading={run.isPending}
          onClick={() => {
            run.mutate();
          }}
        >
          Run retraction check now
        </Button>
        <Button
          variant="secondary"
          loading={exported.isPending}
          onClick={() => {
            exported.mutate(undefined, {
              onSuccess: (data) => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                );
                const link = document.createElement('a');
                link.href = url;
                link.download = 'credibility-export.json';
                link.click();
                URL.revokeObjectURL(url);
              },
            });
          }}
        >
          Export
        </Button>
      </div>
      {run.isSuccess && <span className="text-12 text-muted">Retraction check queued.</span>}
      {(run.error ?? exported.error) && (
        <span className="text-12 text-trust-error-fg">
          {messageForError(run.error ?? exported.error)}
        </span>
      )}
    </div>
  );
}

export function CredibilityScreen({
  tab,
  onTab,
  topBar,
  workNav = { active: 'recheck' },
}: {
  tab: CredibilityTab;
  onTab: (tab: CredibilityTab) => void;
  topBar: TopBarProps;
  workNav?: WorkNavProps;
}) {
  const roles = useSession().data?.user?.roles ?? [];
  const queue = useInfiniteQuery(queueQueryOptions(useApi()));
  const pages = useInfiniteQuery(pagesQueryOptions(useApi()));
  const counts = {
    queue: queue.data?.pages[0]?.counts.all,
    coverage: pages.data
      ? pages.data.pages.reduce((n, page) => n + page.items.length, 0)
      : undefined,
    sources: undefined,
  };
  const panels: Record<CredibilityTab, () => ReactNode> = {
    queue: () => <QueuePanel />,
    coverage: () => <CoveragePanel />,
    sources: () => <SourcesPanel />,
  };
  return (
    <WorkspaceLayout topBar={topBar} workNav={workNav}>
      <div className="flex flex-wrap items-start justify-between gap-12px">
        <div className="flex flex-col gap-2px">
          <h1 className="text-24 font-bold">Credibility</h1>
          <span className="text-muted">
            What readers see across the wiki, and the sections that need a person to look.
          </span>
        </div>
        {roles.includes('owner') && <OwnerActions />}
      </div>
      <Tiles />
      <div className="overflow-hidden rounded-10 border border-edge bg-surface">
        <Tabs
          label="Credibility"
          selected={tab}
          onChange={(id) => {
            onTab(id as CredibilityTab);
          }}
          tabs={CREDIBILITY_TABS.map(({ id, label }) => ({
            id,
            label,
            ...(counts[id] != null && { count: counts[id] }),
            panel: id === tab ? panels[id]() : null,
          }))}
        />
      </div>
    </WorkspaceLayout>
  );
}
