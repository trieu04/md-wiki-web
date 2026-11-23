import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiData, useApi, type ApiClient } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { QueryFailure } from '../../ui/QueryFailure';
import { StatusDot, type StatusTone } from '../../ui/StatusDot';
import { proposalHref } from '../review/model';
import { Table } from '../../ui/Table';
import type { TopBarProps } from '../../ui/TopBar';
import { WorkspaceLayout } from '../../ui/WorkspaceLayout';
import type { WorkNavProps } from '../../ui/WorkNav';
import { Select } from '../../ui/Select';
import {
  BLOCKED_CHOICES,
  JOB_KINDS,
  JOB_STATUSES,
  auditRows,
  blockedHealth,
  blockedModel,
  jobKindRows,
  jobRows,
  resolutionInput,
  workerQueueHealth,
  type AuditPageDto,
  type BlockedChoice,
  type BlockedTargetDto,
  type JobKind,
  type JobListDto,
  type JobStatus,
  type ResolutionInput,
} from './model';

type JobFilter = { kind: JobKind | ''; status: JobStatus | '' };

function jobsQueryOptions(api: ApiClient, filter: JobFilter, limit = 50) {
  const key = queryKeys.opsJobs({ kind: filter.kind, status: filter.status });
  return infiniteQueryOptions<
    JobListDto,
    Error,
    InfiniteData<JobListDto>,
    typeof key,
    string | null
  >({
    queryKey: key,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/ops/jobs', {
          params: {
            query: {
              limit,
              ...(filter.kind && { kind: filter.kind }),
              ...(filter.status && { status: filter.status }),
              ...(pageParam != null && { cursor: pageParam }),
            },
          },
          signal,
        }),
      ),
  });
}

export function blockedQueryOptions(api: ApiClient) {
  return {
    queryKey: queryKeys.opsBlocked,
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      apiData(await api.GET('/api/v1/ops/blocked', { signal })).items,
  };
}

function useResolution(slug: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: ResolutionInput) =>
      apiData(
        await api.POST('/api/v1/ops/blocked/{slug}/resolution', {
          params: { path: { slug } },
          body,
        }),
      ),
    onSuccess(detail) {
      queryClient.setQueryData(queryKeys.proposal(slug), detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.opsBlocked });
      void queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });
}

function BlockedTarget({ target }: { target: BlockedTargetDto }) {
  const model = blockedModel(target);
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<BlockedChoice | null>(null);
  const resolve = useResolution(target.slug);
  const evidenceId = `evidence-${target.publicationId}`;
  function submit(choice: BlockedChoice) {
    const result = resolutionInput(choice, evidence);
    setError(result.error);
    if (!result.input) return;
    setPicked(choice);
    resolve.mutate(result.input);
  }
  return (
    <section
      aria-label={`Blocked: ${target.targetPath}`}
      className="flex flex-col gap-12px rounded-10 border border-trust-error-border bg-surface px-18px py-16px"
    >
      <div className="flex flex-wrap items-center justify-between gap-8px">
        <h2 className="text-15 font-bold">Blocked: publish outcome unknown</h2>
        <span className="font-mono text-12 text-muted">{model.where}</span>
      </div>
      <p className="text-secondary">
        The write timed out. Nobody can publish to this page until you say what is on disk. Compare
        the file with both versions:
      </p>
      <div className="flex flex-col gap-4px">
        <label htmlFor={evidenceId} className="text-13 font-semibold">
          What you checked (required)
        </label>
        <textarea
          id={evidenceId}
          rows={2}
          value={evidence}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${evidenceId}-error` : undefined}
          onChange={(event) => {
            setEvidence(event.target.value);
          }}
          className="resize-y rounded-8 border border-control px-10px py-8px text-13"
        />
        {error && (
          <p id={`${evidenceId}-error`} className="text-12 text-trust-error-fg">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-8px">
        {BLOCKED_CHOICES.map(({ value, label }) => (
          <Button
            key={value}
            variant="secondary"
            className="text-14"
            loading={resolve.isPending && picked === value}
            disabled={resolve.isPending}
            onClick={() => {
              submit(value);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {resolve.error && (
        <p role="alert" className="text-12 text-trust-error-fg">
          {messageForError(resolve.error)}
        </p>
      )}
      <span className="text-12 text-muted">{model.hashes}</span>
      {model.waiting && <span className="text-12 text-muted">{model.waiting}</span>}
    </section>
  );
}

function Header({ title, subtitle, audit }: { title: string; subtitle: string; audit: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-24px gap-y-12px">
      <div className="flex flex-col gap-2px">
        {!audit && <h1 className="text-24 font-bold">{title}</h1>}
        {audit && (
          <>
            <span className="text-13 text-muted">
              <a href="/work/ops" className="text-muted">
                Operations
              </a>{' '}
              / {title}
            </span>
            <h1 className="text-24 font-bold">{title}</h1>
          </>
        )}
        <span className="text-muted">{subtitle}</span>
      </div>
      {!audit && (
        <div className="flex flex-wrap gap-8px">
          <a
            href="/work/ops/audit"
            className="rounded-8 border border-control bg-surface px-12px py-7px font-medium text-native-button no-underline hover:bg-nav-current"
          >
            Audit log
          </a>
        </div>
      )}
    </div>
  );
}

function HealthCard({
  label,
  health,
}: {
  label: string;
  health: { tone: StatusTone; value: string; note: string };
}) {
  return (
    <div className="flex flex-col gap-2px rounded-10 border border-edge bg-surface px-14px py-12px">
      <span className="text-13 text-secondary">
        <StatusDot tone={health.tone} weight="normal">
          {label}
        </StatusDot>
      </span>
      <span className="text-18 font-bold">{health.value}</span>
      <span className="text-12 text-muted">{health.note}</span>
    </div>
  );
}

/** F-13 *Background jobs*: one row per job kind from `/ops/jobs` (D-152). */
function BackgroundJobs({ data }: { data: JobListDto }) {
  const rows = jobKindRows(data.kinds);
  return (
    <section
      aria-labelledby="background-jobs"
      className="min-w-0 flex-ops-jobs overflow-hidden rounded-10 border border-edge bg-surface"
    >
      <h2
        id="background-jobs"
        className="border-b border-divider px-18px py-14px text-15 font-bold"
      >
        Background jobs
      </h2>
      <Table label="Background jobs" widthClass="min-w-table-jobs text-13">
        <thead>
          <tr>
            <th scope="col" className="px-18px py-9px">
              Job
            </th>
            <th scope="col" className="px-12px py-9px">
              Last run
            </th>
            <th scope="col" className="px-12px py-9px">
              Result
            </th>
            <th scope="col" className="px-18px py-9px">
              Queue
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-18px py-10px font-mono text-12">{row.name}</td>
              <td className="px-12px py-10px text-secondary">{row.last}</td>
              <td className="px-12px py-10px">
                <StatusDot tone={row.tone} weight="normal">
                  {row.result}
                </StatusDot>
              </td>
              <td className="px-18px py-10px text-secondary">{row.queue}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="border-t border-divider px-18px py-10px text-13">
        <a href="/work/ops/jobs">All AI jobs</a>
      </div>
    </section>
  );
}

/** F-13 Operations (D-100, D-152): health cards, Blocked targets, Background jobs. */
export function OpsScreen({ topBar, workNav }: { topBar: TopBarProps; workNav: WorkNavProps }) {
  const api = useApi();
  const query = useQuery(blockedQueryOptions(api));
  const jobs = useInfiniteQuery(jobsQueryOptions(api, { kind: '', status: '' }));
  const items = query.data;
  const health = items && blockedHealth(items);
  const jobPage = jobs.data?.pages[0];
  const queue = useMemo(
    () => (jobPage ? workerQueueHealth(jobPage.kinds, jobPage.items, new Date()) : null),
    [jobPage],
  );
  return (
    <WorkspaceLayout topBar={topBar} workNav={workNav}>
      <Header
        title="Operations"
        subtitle="Health of publishing, the reviewer agent and background jobs. Owner only."
        audit={false}
      />
      {query.isError ? (
        <QueryFailure
          error={query.error}
          retry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : !items || !health ? (
        <Card title="Blocked targets" state={{ type: 'loading' }} />
      ) : (
        <>
          <div className="grid grid-cols-stats gap-10px">
            <HealthCard label="Blocked targets" health={health} />
            {queue && <HealthCard label="Worker queue" health={queue} />}
          </div>
          {items.map((target) => (
            <BlockedTarget key={target.publicationId} target={target} />
          ))}
        </>
      )}
      <div className="flex flex-wrap items-start gap-16px">
        {jobs.isError && !jobs.data ? (
          <div className="min-w-0 flex-ops-jobs">
            <QueryFailure
              error={jobs.error}
              retry={() => void jobs.refetch()}
              busy={jobs.isFetching}
            />
          </div>
        ) : jobPage ? (
          <BackgroundJobs data={jobPage} />
        ) : (
          <Card title="Background jobs" className="flex-ops-jobs" state={{ type: 'loading' }} />
        )}
      </div>
    </WorkspaceLayout>
  );
}

const anyOption = (label: string) => <option value="">{label}</option>;

/** Derived *AI jobs* page (D-16, D-152; design-system §6 item 7): F-13 structure, Card + Table. */
export function JobsScreen({ topBar, workNav }: { topBar: TopBarProps; workNav: WorkNavProps }) {
  const [filter, setFilter] = useState<JobFilter>({ kind: '', status: '' });
  const query = useInfiniteQuery(jobsQueryOptions(useApi(), filter));
  const rows = jobRows(query.data?.pages ?? []);
  return (
    <WorkspaceLayout topBar={topBar} workNav={workNav}>
      <Header
        title="AI jobs"
        subtitle="Every background job run, newest first. Metadata only: no prompts, inputs or findings."
        audit
      />
      <div className="flex flex-wrap gap-12px [&>*]:grow [&>*]:basis-search-filter-basis">
        <Select
          label="Job"
          value={filter.kind}
          onChange={(event) => {
            setFilter({ ...filter, kind: event.target.value as JobKind | '' });
          }}
        >
          {anyOption('All jobs')}
          {JOB_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </Select>
        <Select
          label="Status"
          value={filter.status}
          onChange={(event) => {
            setFilter({ ...filter, status: event.target.value as JobStatus | '' });
          }}
        >
          {anyOption('Any status')}
          {JOB_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>
      </div>
      {query.isError && !query.data ? (
        <QueryFailure
          error={query.error}
          retry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : query.isPending ? (
        <Card title="Runs" state={{ type: 'loading' }} />
      ) : !rows.length ? (
        <Card title="Runs" header state={{ type: 'empty', message: 'No job runs match.' }} />
      ) : (
        <Card title="Runs" header>
          <Table label="AI jobs" widthClass="min-w-table-audit text-13">
            <thead>
              <tr>
                {['When', 'Job', 'Trigger', 'Subject', 'Result', 'Model', 'Tokens', 'Took'].map(
                  (title) => (
                    <th key={title} scope="col" className="px-12px py-9px first:pl-18px">
                      {title}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="py-10px pr-12px pl-18px whitespace-nowrap text-secondary">
                    <time dateTime={row.at}>{row.when}</time>
                  </td>
                  <td className="px-12px py-10px font-mono text-12">{row.kind}</td>
                  <td className="px-12px py-10px">{row.trigger}</td>
                  <td className="px-12px py-10px font-mono text-12">
                    {row.subject.slug ? (
                      <a href={proposalHref(row.subject.slug)}>{row.subject.text}</a>
                    ) : (
                      row.subject.text
                    )}
                  </td>
                  <td className="px-12px py-10px">
                    <StatusDot tone={row.tone} weight="normal">
                      {row.result}
                    </StatusDot>
                  </td>
                  <td className="px-12px py-10px font-mono text-12">{row.model}</td>
                  <td className="px-12px py-10px whitespace-nowrap text-secondary">{row.tokens}</td>
                  <td className="px-12px py-10px whitespace-nowrap text-secondary">
                    {row.duration}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {query.hasNextPage && (
            <div className="border-t border-divider px-18px py-10px">
              <Button
                variant="secondary-compact"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}
    </WorkspaceLayout>
  );
}

function auditQueryOptions(api: ApiClient) {
  return infiniteQueryOptions<
    AuditPageDto,
    Error,
    InfiniteData<AuditPageDto>,
    typeof queryKeys.audit,
    string | null
  >({
    queryKey: queryKeys.audit,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/audit', {
          params: { query: { limit: 50, ...(pageParam != null && { cursor: pageParam }) } },
          signal,
        }),
      ),
  });
}

/** Derived Audit log (D-16, D-101): F-13's structure, Table + Card from the inventory. */
export function AuditScreen({ topBar, workNav }: { topBar: TopBarProps; workNav: WorkNavProps }) {
  const query = useInfiniteQuery(auditQueryOptions(useApi()));
  const rows = auditRows(query.data?.pages ?? []);
  return (
    <WorkspaceLayout topBar={topBar} workNav={workNav}>
      <Header
        title="Audit log"
        subtitle="Every recorded change, newest first. Entries cannot be edited or deleted."
        audit
      />
      {query.isError && !query.data ? (
        <QueryFailure
          error={query.error}
          retry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : query.isPending ? (
        <Card title="Events" state={{ type: 'loading' }} />
      ) : !rows.length ? (
        <Card title="Events" header state={{ type: 'empty', message: 'Nothing recorded yet.' }} />
      ) : (
        <Card title="Events" header>
          <Table label="Audit log" widthClass="min-w-table-audit text-13">
            <thead>
              <tr>
                {['When', 'Action', 'Actor', 'Subject', 'Details'].map((title) => (
                  <th key={title} scope="col" className="px-12px py-9px first:pl-18px">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="py-10px pr-12px pl-18px whitespace-nowrap text-secondary">
                    <time dateTime={row.at}>{row.when}</time>
                  </td>
                  <td className="px-12px py-10px font-mono text-12">{row.action}</td>
                  <td className="px-12px py-10px">{row.actor}</td>
                  <td className="px-12px py-10px font-mono text-12">{row.subject}</td>
                  <td className="px-12px py-10px font-mono text-12 break-all text-muted">
                    {row.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {query.hasNextPage && (
            <div className="border-t border-divider px-18px py-10px">
              <Button
                variant="secondary-compact"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}
    </WorkspaceLayout>
  );
}
