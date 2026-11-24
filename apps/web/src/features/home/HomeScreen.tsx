import { labelMeta } from '@md-wiki/domain';
import { useState } from 'react';
import { useWikiMeta } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { PillToggle } from '../../ui/PillToggle';
import { QueryFailure } from '../../ui/QueryFailure';
import { ReadingLayout } from '../../ui/ReadingLayout';
import { SearchInput } from '../../ui/SearchInput';
import { SpreadBar } from '../../ui/SpreadBar';
import { Table } from '../../ui/Table';
import { TrustBadge } from '../../ui/TrustBadge';
import { TrustIcon } from '../../ui/TrustIcon';
import type { TopBarProps } from '../../ui/TopBar';
import { wikiPageHref } from '../navigation/model';
import {
  HOME_SCOPES,
  defaultScope,
  homeTreeModel,
  noticeRow,
  recentRows,
  trustLegend,
  type HomeScope,
  type NoticeDto,
} from './model';
import { useHomeQueries } from './queries';

type TreeModel = ReturnType<typeof homeTreeModel>;

function Topics({ model }: { model: TreeModel }) {
  return (
    <Card title="Browse by topic">
      {model.topics.length === 0 && <p className="text-13 text-muted">No topics yet.</p>}
      {model.topics.map(({ id, firstPage, name, pageCount }) => {
        const Row = firstPage ? 'a' : 'div';
        return (
          <Row
            key={id}
            href={firstPage && wikiPageHref(firstPage)}
            className="flex justify-between border-t border-row py-7px text-primary no-underline first-of-type:mt-4px"
          >
            <span>{name}</span>
            <span className="text-muted">{pageCount}</span>
          </Row>
        );
      })}
    </Card>
  );
}

function TrustLabels({ distribution }: { distribution: TreeModel['distribution'] | undefined }) {
  return (
    <Card title="How to read trust labels" className="gap-12px!">
      <ul className="flex flex-col gap-10px">
        {trustLegend.map(([label, meaning]) => (
          <li key={label} className="flex gap-10px text-13">
            <span className="mt-3px">
              <TrustIcon label={label} size={14} />
            </span>
            <span className="flex flex-col">
              <strong className="font-semibold">{labelMeta[label]}</strong>
              <span className="text-secondary">{meaning}</span>
            </span>
          </li>
        ))}
      </ul>
      {distribution && (
        <div className="flex flex-col gap-6px border-t border-row pt-12px">
          <span className="text-13 font-semibold">{distribution.title}</span>
          <SpreadBar size="md" {...distribution} />
        </div>
      )}
    </Card>
  );
}

function RecentTable({ rows }: { rows: ReturnType<typeof recentRows> }) {
  return (
    <Table label="Recently updated pages">
      <thead>
        <tr>
          <th scope="col" className="px-18px py-10px">
            Page
          </th>
          <th scope="col" className="px-12px py-10px">
            What changed
          </th>
          <th scope="col" className="px-12px py-10px">
            Trust now
          </th>
          <th scope="col" className="px-18px py-10px">
            When
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, path, pageTitle, section, change, label, timestamp, when }) => (
          <tr key={key}>
            <td className="px-18px py-12px">
              <a href={wikiPageHref(path)} className="font-semibold no-underline">
                {pageTitle}
              </a>
              {section && <div className="text-12 text-muted">{section}</div>}
            </td>
            <td className="p-12px text-secondary">{change}</td>
            <td className="p-12px whitespace-nowrap">
              {label && <TrustBadge label={label} variant="inline" />}
            </td>
            <td className="px-18px py-12px whitespace-nowrap text-muted">
              <time dateTime={timestamp}>{when}</time>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Notices({ items }: { items: readonly NoticeDto[] }) {
  return (
    <Card
      title="On pages you use"
      actions={
        <a href="/me" className="text-13 font-medium">
          Followed pages
        </a>
      }
      state={
        items.length
          ? undefined
          : { type: 'empty', message: 'Nothing new on the pages you follow.' }
      }
    >
      <ul className="flex flex-col">
        {items.map(noticeRow).map((row) => (
          <li
            key={row.key}
            className="flex gap-14px border-b border-row px-18px py-14px last:border-b-0"
          >
            <span className="mt-3px">
              <TrustIcon label={row.label} size={14} />
            </span>
            <div className="flex min-w-0 flex-auto flex-col gap-3px">
              <span className="font-semibold">{row.title}</span>
              <span className="text-secondary">{row.text}</span>
              <span className="mt-2px flex flex-wrap gap-14px text-13">
                <a href={row.href} className="font-medium">
                  {row.action}
                </a>
                <time dateTime={row.at} className="text-trust-none">
                  {row.when}
                </time>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function HomeScreen({ topBar }: { topBar: TopBarProps }) {
  const meta = useWikiMeta();
  const session = useSession();
  const signedIn = !!session.data?.user;
  const [picked, setScope] = useState<HomeScope | null>(null);
  const scope = signedIn ? (picked ?? defaultScope(signedIn)) : 'all';
  const { tree, recent, notices } = useHomeQueries(scope, signedIn, !session.isPending);
  const model = tree.data && homeTreeModel(tree.data);
  const rows = model && recent.data && recentRows(recent.data, model.pageLabels, new Date());
  const recentFailure = recent.isError ? recent : tree.isError ? tree : undefined;
  return (
    <ReadingLayout
      topBar={topBar}
      before={
        <section aria-label="Search" className="flex flex-col items-start gap-14px">
          <h1 className="font-content text-34 leading-home-title font-bold">
            {meta.data?.wikiName ?? topBar.wikiName}
          </h1>
          {meta.data?.wikiDescription && (
            <p className="max-w-home-description-max text-16 text-secondary">
              {meta.data.wikiDescription}
            </p>
          )}
          {meta.isError && (
            <QueryFailure
              error={meta.error}
              retry={() => void meta.refetch()}
              busy={meta.isFetching}
            />
          )}
          <form
            action="/search"
            role="search"
            aria-label="Search from home"
            className="flex w-full max-w-home-search-max gap-8px"
          >
            <SearchInput
              size="home"
              name="q"
              label="Search the wiki"
              placeholder="What do you need to know? e.g. pinhole size for a 63x objective"
              required
              maxLength={200}
            />
            <Button type="submit" variant="primary-home">
              Search
            </Button>
          </form>
        </section>
      }
      aside={
        <>
          {model ? (
            <Topics model={model} />
          ) : (
            <Card title="Browse by topic" state={tree.isPending ? { type: 'loading' } : undefined}>
              {tree.isError && (
                <QueryFailure
                  error={tree.error}
                  retry={() => void tree.refetch()}
                  busy={tree.isFetching}
                />
              )}
            </Card>
          )}
          <TrustLabels distribution={model?.distribution} />
        </>
      }
    >
      {signedIn && notices.data && <Notices items={notices.data.items} />}
      <div id="recent">
        <Card
          title="Recently updated"
          actions={
            signedIn ? (
              <div role="group" aria-label="Which pages" className="flex gap-4px">
                {HOME_SCOPES.map(({ id, label }) => (
                  <PillToggle
                    key={id}
                    pressed={scope === id}
                    onClick={() => {
                      setScope(id);
                    }}
                  >
                    {label}
                  </PillToggle>
                ))}
              </div>
            ) : (
              <span className="rounded-7 border border-accent bg-selected px-10px py-5px text-13 leading-control font-semibold">
                All pages
              </span>
            )
          }
          state={
            recentFailure
              ? undefined
              : !rows
                ? { type: 'loading' }
                : !rows.length
                  ? {
                      type: 'empty',
                      message:
                        scope === 'mine'
                          ? 'No recent changes on the pages you follow.'
                          : 'No recent changes yet.',
                    }
                  : undefined
          }
        >
          {recentFailure ? (
            <div className="px-18px py-16px">
              <QueryFailure
                error={recentFailure.error}
                retry={() => void recentFailure.refetch()}
                busy={recentFailure.isFetching}
              />
            </div>
          ) : (
            rows && <RecentTable rows={rows} />
          )}
        </Card>
      </div>
    </ReadingLayout>
  );
}
