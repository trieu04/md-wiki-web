import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useApi } from '../../lib/api';
import { Button } from '../../ui/Button';
import { QueryFailure } from '../../ui/QueryFailure';
import { StatusDot } from '../../ui/StatusDot';
import { Table } from '../../ui/Table';
import { Tabs } from '../../ui/Tabs';
import type { TopBarProps } from '../../ui/TopBar';
import { WorkspaceLayout } from '../../ui/WorkspaceLayout';
import type { WorkNavProps } from '../../ui/WorkNav';
import { filterRows, proposalRow, proposalTabs, type ProposalRow, type ProposalTab } from './model';
import { proposalsQueryOptions } from './queries';

const head = ['Proposal', 'Page · section', 'Author', 'Status', 'With', 'Quality', 'Age'];

function ProposalTable({ rows }: { rows: readonly ProposalRow[] }) {
  return (
    <Table label="Proposals" widthClass="min-w-table-proposals">
      <thead>
        <tr>
          {head.map((title) => (
            <th key={title} scope="col" className="px-14px py-10px">
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.slug} className="border-divider!">
            <td className="px-14px py-12px">
              <a href={row.href} className="font-mono text-13 no-underline">
                {row.slug}
              </a>
              <div className="text-secondary">{row.title}</div>
            </td>
            <td className="px-14px py-12px font-mono text-12 text-secondary">{row.where}</td>
            <td className="px-14px py-12px">
              {row.author}
              <div className="text-12 text-trust-none">{row.kind}</div>
            </td>
            <td className="px-14px py-12px">
              <StatusDot tone={row.tone}>{row.status}</StatusDot>
              <div className="text-12 text-muted">{row.detail}</div>
            </td>
            <td className="px-14px py-12px text-secondary">{row.with}</td>
            <td className="px-14px py-12px text-secondary">{row.quality}</td>
            <td className="px-14px py-12px text-trust-none">
              <time dateTime={row.createdAt}>{row.age}</time>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function TabPanel({ tab, filter }: { tab: ProposalTab; filter: string }) {
  const query = useInfiniteQuery(proposalsQueryOptions(useApi(), tab));
  const rows = useMemo(() => {
    const now = new Date();
    return filterRows(
      (query.data?.pages ?? []).flatMap((page) => page.items.map((item) => proposalRow(item, now))),
      filter,
    );
  }, [query.data, filter]);
  if (query.isPending)
    return (
      <div className="flex flex-col gap-12px px-14px py-16px" aria-hidden="true">
        {[1, 2, 3].map((row) => (
          <div key={row} className="h-12px bg-row" />
        ))}
      </div>
    );
  if (query.isError && !query.data)
    return (
      <div className="p-14px">
        <QueryFailure
          error={query.error}
          retry={() => void query.refetch()}
          busy={query.isFetching}
        />
      </div>
    );
  return (
    <>
      {rows.length ? (
        <ProposalTable rows={rows} />
      ) : (
        <p className="px-14px py-16px text-13 text-muted">
          {filter.trim() ? 'No proposals match this filter.' : 'No proposals here.'}
        </p>
      )}
      {query.hasNextPage && (
        <div className="border-t border-divider px-14px py-10px">
          <Button
            variant="secondary-compact"
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

/** F-09 Proposals (D-97: regions without Phase 5 data are not rendered). */
export function ProposalsScreen({
  tab,
  onTab,
  topBar,
  workNav,
}: {
  tab: ProposalTab;
  onTab: (tab: ProposalTab) => void;
  topBar: TopBarProps;
  workNav: WorkNavProps;
}) {
  const [filter, setFilter] = useState('');
  // Counts come with every list page; the open tab's are shared with the WorkNav counts.
  const counts = useInfiniteQuery(proposalsQueryOptions(useApi(), tab)).data?.pages[0]?.counts;
  return (
    <WorkspaceLayout topBar={topBar} workNav={workNav}>
      <div className="flex flex-wrap items-end justify-between gap-x-24px gap-y-12px">
        <div className="flex flex-col gap-2px">
          <h1 className="text-24 font-bold">Proposals</h1>
          <span className="text-muted">
            Every proposed change and who decided it. The reviewer agent decides by default;
            escalated ones go to page authors.
          </span>
        </div>
      </div>
      {counts && (
        <div className="grid grid-cols-stats gap-10px">
          <div className="flex flex-col rounded-10 border border-edge bg-surface px-14px py-12px">
            <span className="text-22 font-bold">{counts.blocked}</span>
            <span className="text-13 text-muted">blocked, owner must check</span>
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-10 border border-edge bg-surface">
        <Tabs
          label="State"
          selected={tab}
          onChange={(id) => {
            onTab(id as ProposalTab);
          }}
          tabs={proposalTabs(counts).map(({ id, label, count }) => ({
            id,
            label,
            ...(count !== undefined && { count }),
            panel: (
              <>
                <div className="flex flex-wrap gap-8px border-b border-divider px-14px py-10px">
                  <label htmlFor={`proposal-filter-${id}`} className="sr-only">
                    Filter
                  </label>
                  <input
                    id={`proposal-filter-${id}`}
                    type="search"
                    placeholder="Filter by ID, page or author"
                    value={filter}
                    onChange={(event) => {
                      setFilter(event.target.value);
                    }}
                    className="max-w-filter-max flex-filter rounded-7 border border-control px-10px py-7px"
                  />
                </div>
                {id === tab && <TabPanel tab={id} filter={filter} />}
              </>
            ),
          }))}
        />
      </div>
    </WorkspaceLayout>
  );
}
