import { labelMeta } from '@md-wiki/domain';
import { Fragment, useState } from 'react';
import { Checkbox } from '../../ui/Checkbox';
import { Mark } from '../../ui/Mark';
import { PillToggle } from '../../ui/PillToggle';
import { QueryFailure } from '../../ui/QueryFailure';
import { Radio } from '../../ui/Radio';
import { TopBar } from '../../ui/TopBar';
import type { TopBarProps } from '../../ui/TopBar';
import { TrustBadge } from '../../ui/TrustBadge';
import { TrustIcon } from '../../ui/TrustIcon';
import {
  defaultFilters,
  searchModel,
  searchRequest,
  sorts,
  toggleTopic,
  toggleTrust,
  topicOptions,
  trustOptions,
  updatedWindows,
} from './model';
import { useSearchResults } from './queries';

const filterBox = 'flex min-w-0 flex-col rounded-12 border border-edge bg-surface px-16px py-14px';
const legend = 'px-4px font-semibold';
const resultCard = 'flex flex-col gap-6px rounded-12 border border-edge bg-surface px-18px py-16px';
const emptyCopy = 'Didn’t find what you need?';

function Result({ hit }: { hit: ReturnType<typeof searchModel>['hits'][number] }) {
  return (
    <article className={resultCard}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-14px gap-y-6px">
        <a href={hit.href} className="text-16 font-semibold no-underline">
          {hit.pageTitle} <span className="font-medium text-muted">› {hit.sectionTitle}</span>
        </a>
        <TrustBadge label={hit.label} variant="bordered" />
      </div>
      <p className="text-body-strong">
        {hit.snippet.map(({ before, hit, after }, index) => (
          <Fragment key={index}>
            {index > 0 && ' … '}
            {before}
            {hit && <Mark>{hit}</Mark>}
            {after}
          </Fragment>
        ))}
      </p>
      {hit.warning && (
        <span
          role="note"
          className={`rounded-6 px-10px py-6px text-13 ${hit.warning.kind === 'error' ? 'bg-trust-error-bg text-trust-error-fg' : 'bg-trust-recheck-bg text-trust-recheck-fg'}`}
        >
          {hit.warning.text}
        </span>
      )}
      <span className="text-12 text-muted">{hit.meta}</span>
    </article>
  );
}

export function SearchScreen({ q, topBar }: { q: string; topBar: TopBarProps }) {
  const [filters, setFilters] = useState(defaultFilters);
  const request = searchRequest(q, filters);
  const results = useSearchResults(request);
  const topicFilters = topicOptions(results.data?.facets.topics, filters.topics);
  const model = results.data && !results.isPlaceholderData ? searchModel(results.data) : undefined;
  const loading = Boolean(request.q) && (results.isPending || results.isPlaceholderData);
  return (
    <>
      <TopBar {...topBar} />
      <main className="mx-auto flex w-full max-w-reading flex-col gap-18px px-24px pt-24px pb-48px">
        <div className="flex flex-wrap items-end justify-between gap-x-24px gap-y-10px">
          <div className="flex min-w-0 flex-col gap-2px wrap-anywhere">
            <h1 className="text-22 font-bold">
              {request.q ? `Results for “${request.q}”` : 'Search'}
            </h1>
            {model && (
              <span role="status" className="text-muted">
                {model.countLine}
              </span>
            )}
          </div>
          <div role="group" aria-label="Sort" className="flex flex-wrap items-center gap-4px">
            <span className="mr-4px text-13 text-muted">Sort</span>
            {sorts.map(([id, label]) => (
              <PillToggle
                key={id}
                pressed={filters.sort === id}
                size="sort"
                onClick={() => {
                  setFilters((old) => ({ ...old, sort: id }));
                }}
              >
                {label}
              </PillToggle>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-20px">
          <aside
            aria-label="Filters"
            className="flex max-w-search-filter-max flex-auto basis-search-filter-basis flex-col gap-18px"
          >
            <fieldset className={`${filterBox} gap-4px`}>
              <legend className={legend}>Trust</legend>
              {trustOptions.map((label) => (
                <Checkbox
                  key={label}
                  label={labelMeta[label]}
                  icon={<TrustIcon label={label} size={14} />}
                  count={results.data?.facets.labels[label]}
                  checked={filters.labels.includes(label)}
                  onChange={() => {
                    setFilters((old) => toggleTrust(old, label));
                  }}
                />
              ))}
              <span className="pt-6px text-12 text-muted">
                Results under re-check are always shown, with their warning.
              </span>
            </fieldset>
            <fieldset className={`${filterBox} gap-8px`}>
              <legend className={legend}>Topic</legend>
              {topicFilters.map((topic) => (
                <label key={topic.id} className="flex items-center gap-10px text-13">
                  <input
                    type="checkbox"
                    className="size-16px shrink-0"
                    checked={filters.topics.some(({ id }) => id === topic.id)}
                    onChange={() => {
                      setFilters((old) => toggleTopic(old, topic));
                    }}
                  />
                  <span className="flex-auto">{topic.name}</span>
                  <span className="text-muted">{topic.n}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className={`${filterBox} gap-8px`}>
              <legend className={legend}>Updated</legend>
              {updatedWindows.map(([id, label]) => (
                <Radio
                  key={id}
                  name="updated"
                  label={label}
                  checked={filters.updated === id}
                  onChange={() => {
                    setFilters((old) => ({ ...old, updated: id }));
                  }}
                />
              ))}
            </fieldset>
          </aside>
          <section
            aria-label="Results"
            aria-busy={loading || undefined}
            className="flex min-w-0 flex-reading-content flex-col gap-12px"
          >
            {loading ? (
              <div className={`${resultCard} gap-12px!`} aria-hidden="true">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="h-12px bg-row" />
                ))}
              </div>
            ) : results.isError ? (
              <QueryFailure
                error={results.error}
                retry={() => void results.refetch()}
                busy={results.isFetching}
              />
            ) : model?.hits.length ? (
              <>
                {model.hits.map((hit) => (
                  <Result key={hit.href} hit={hit} />
                ))}
                <div className="rounded-12 border border-dashed border-input-strong px-18px py-14px text-secondary">
                  Didn’t find what you need? Ask the people who maintain these pages.
                </div>
              </>
            ) : (
              <p className={`${resultCard} text-13 text-muted`}>
                {request.q
                  ? `${emptyCopy} Try a different search term or change the filters.`
                  : 'Enter a search term.'}
              </p>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
