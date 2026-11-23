import { createLink, Link, useNavigate } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, type ComponentProps, type ReactNode } from 'react';
import { useApi } from '../../lib/api';
import { useSession } from '../../lib/session';
import { messageForError } from '../../lib/error-copy';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Card } from '../../ui/Card';
import { Mono } from '../../ui/Mono';
import { SpreadBar } from '../../ui/SpreadBar';
import { Table } from '../../ui/Table';
import { TopBar, type TopBarProps } from '../../ui/TopBar';
import { TrustIcon } from '../../ui/TrustIcon';
import { askHref } from '../discussions/model';
import { MarkdownPageContent } from '../markdown/MarkdownPageContent';
import type { PageDto } from '../markdown/model';
import { pageQueryOptions } from '../markdown/page-query';
import {
  canSuggest,
  changedOutsideReviewNote,
  historyModel,
  pageArticleModel,
  pageHeaderModel,
  topicModel,
  type PageArticleModel,
  type PageHeaderModel,
  type TopicModel,
} from './model';
import { historyQueryOptions, topicQueryOptions } from './queries';

const articleClass =
  'flex min-w-0 max-w-article flex-reading-content flex-col gap-22px rounded-12 border border-edge bg-surface px-40px pt-28px pb-36px';
const rowClass =
  'flex items-center gap-9px rounded-6 px-8px py-6px text-primary no-underline hover:bg-nav-current hover:text-primary active:bg-nav-current aria-[current]:bg-muted-toc aria-[current]:font-semibold';
const navHeadingClass =
  'px-8px pb-4px text-11 font-semibold tracking-overline text-muted uppercase';
const actionLinkClass =
  'self-start rounded-8 border border-control bg-surface px-12px py-7px font-medium text-primary no-underline hover:bg-nav-current hover:text-primary active:bg-nav-current';

function QueryError({
  title,
  error,
  retry,
  busy,
}: {
  title: string;
  error: Error;
  retry: () => void;
  busy: boolean;
}) {
  return (
    <Callout
      tone="error"
      queryError
      title={title}
      action={
        <Button variant="secondary" onClick={retry} loading={busy}>
          Try again
        </Button>
      }
    >
      {messageForError(error)}
    </Callout>
  );
}

function TopicLinks({ page }: { page: PageDto }) {
  const topic = useQuery(topicQueryOptions(useApi(), page.topic.id));
  if (topic.isPending) return <Card title={page.topic.name} state={{ type: 'loading' }} />;
  if (topic.isError)
    return (
      <QueryError
        title="Could not load pages in this topic."
        error={topic.error}
        retry={() => void topic.refetch()}
        busy={topic.isFetching}
      />
    );
  return <TopicList model={topicModel(page, topic.data)} />;
}

function TopicList({ model }: { model: TopicModel }) {
  if (!model.links.length)
    return (
      <Card
        title={model.title}
        header
        state={{ type: 'empty', message: 'No pages in this topic.' }}
      />
    );
  return (
    <div className="flex flex-col gap-2px">
      <h2 className={navHeadingClass}>{model.title}</h2>
      {model.links.map(({ href, title, label, current, ariaLabel }) => (
        <Link
          key={href}
          to={href}
          aria-label={ariaLabel}
          aria-current={current}
          className={`${rowClass} font-nav`}
          activeOptions={{ exact: true }}
        >
          <TrustIcon label={label} size={12} />
          <span>{title}</span>
        </Link>
      ))}
    </div>
  );
}

function sectionTarget(anchor: string) {
  return {
    to: '.',
    search: true,
    hash: anchor,
    hashScrollIntoView: false,
    resetScroll: false,
  } as const;
}

// Reflect the view's selection even when the initial URL has no fragment.
const ContentsLink = createLink(function ContentsAnchor({
  selected,
  ...props
}: ComponentProps<'a'> & { selected: boolean }) {
  return <a {...props} aria-current={selected ? 'location' : undefined} />;
});

function Contents({ links, selected }: { links: PageArticleModel['links']; selected: string }) {
  return (
    <div className="flex flex-col gap-2px">
      <h2 className={navHeadingClass}>On this page</h2>
      {links.map(({ title, anchor, label, ariaLabel }) => (
        <ContentsLink
          key={anchor}
          {...sectionTarget(anchor)}
          selected={selected === anchor}
          aria-label={ariaLabel}
          className={`${rowClass} leading-control font-nav`}
        >
          <TrustIcon label={label} size={12} />
          <span>{title}</span>
        </ContentsLink>
      ))}
    </div>
  );
}

function ReadingHeader({ model, selected }: { model: PageHeaderModel; selected: string }) {
  const session = useSession();
  return (
    <header className="flex flex-col gap-10px border-b border-divider pb-18px">
      <span className="text-13 text-muted">
        <Link to="/" className="text-muted underline">
          Home
        </Link>{' '}
        / {model.topic}
      </span>
      <h1 className="font-content text-36 leading-brand font-bold">{model.title}</h1>
      <div className="text-13 text-muted">
        {model.maintainers && <>{model.maintainers} · </>}
        <time dateTime={model.updatedAt}>{model.updated}</time>
        {model.usedBy && <> · {model.usedBy}</>}
      </div>
      <div className="flex flex-wrap items-center gap-x-16px gap-y-8px">
        <span className="inline-flex items-center gap-8px font-semibold">
          <TrustIcon label={model.label} size={14} />
          {model.status}
        </span>
        {model.spread && (
          <SpreadBar
            size="sm"
            flowWithParent
            spread={model.spread.counts}
            ariaLabel={model.spread.ariaLabel}
            caption={model.spread.caption}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-8px pt-4px">
        {canSuggest(session.data?.user?.roles) && (
          <Link
            className={actionLinkClass}
            to={model.editHref}
            search={selected ? { section: selected } : {}}
          >
            Suggest an edit
          </Link>
        )}
        {/* Any signed-in role may open a topic (`topic.open`, D-119); the selected section rides along. */}
        {session.data?.user && (
          <a className={actionLinkClass} href={askHref({ path: model.path, section: selected })}>
            Ask a question
          </a>
        )}
        <Link className={actionLinkClass} to={model.historyHref}>
          History
        </Link>
      </div>
    </header>
  );
}

function VersionTable({ path }: { path: string }) {
  const query = useInfiniteQuery(historyQueryOptions(useApi(), path));
  const rows = useMemo(() => historyModel(query.data?.pages ?? []), [query.data]);
  if (query.isPending) return <Card title="Versions" state={{ type: 'loading' }} />;
  if (query.error && !query.data)
    return (
      <QueryError
        title="Could not load version history."
        error={query.error}
        retry={() => void query.refetch()}
        busy={query.isFetching}
      />
    );
  if (!rows.length && !query.hasNextPage && !query.error)
    return <Card title="Versions" header state={{ type: 'empty', message: 'No versions yet.' }} />;
  return (
    <>
      <Card title="Versions" header>
        <Table label="Versions">
          <thead>
            <tr>
              {['Version', 'Captured', 'SHA-256'].map((title) => (
                <th key={title} scope="col" className="px-18px py-10px">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ versionLabel, capturedAt, captured, sha256 }) => (
              <tr key={versionLabel}>
                <td className="px-18px py-10px whitespace-nowrap">
                  <Mono>{versionLabel}</Mono>
                </td>
                <td className="px-18px py-10px">
                  <time dateTime={capturedAt}>{captured}</time>
                </td>
                <td className="px-18px py-10px break-all">
                  <Mono>{sha256}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {query.error ? (
        <QueryError
          title="Could not load version history."
          error={query.error}
          retry={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}
          busy={query.isFetching}
        />
      ) : (
        query.hasNextPage && (
          <Button
            className="self-start"
            variant="secondary"
            loading={query.isFetchingNextPage}
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        )
      )}
    </>
  );
}

function ReadingPage({
  page,
  anchor,
  history,
}: {
  page: PageDto;
  anchor: string;
  history: boolean;
}) {
  const navigate = useNavigate();
  const header = useMemo(() => pageHeaderModel(page), [page]);
  const article = useMemo(() => (history ? null : pageArticleModel(page)), [history, page]);
  const selected = anchor || article?.defaultAnchor || '';
  const outside = changedOutsideReviewNote(page);
  useEffect(() => {
    if (article && anchor) document.getElementById(anchor)?.scrollIntoView();
  }, [article, anchor]);
  return (
    <>
      <nav
        aria-label={history ? 'Pages in this topic' : 'Pages and contents'}
        className="flex min-w-0 max-w-page-nav grow basis-workspace-nav flex-col gap-20px text-13 wrap-anywhere"
      >
        <TopicLinks page={page} />
        {!!article?.links.length && <Contents links={article.links} selected={selected} />}
      </nav>
      <article
        aria-label={history ? 'History' : header.title}
        className={`${articleClass} wrap-anywhere`}
      >
        {article ? (
          <>
            <ReadingHeader model={header} selected={selected} />
            {outside && (
              <Callout tone="warn" title={outside.title}>
                {outside.text}
              </Callout>
            )}
            {article.empty ? (
              <Card
                title={header.title}
                header
                state={{ type: 'empty', message: 'This page is empty.' }}
              />
            ) : (
              <MarkdownPageContent
                markdown={article.markdown}
                selected={selected}
                onSelectSection={(section) => void navigate(sectionTarget(section))}
              />
            )}
          </>
        ) : (
          <>
            <header className="flex flex-col gap-10px border-b border-divider pb-18px">
              <span className="text-13 text-muted">
                <Link to="/" className="text-muted underline">
                  Home
                </Link>{' '}
                / {header.topic} / <Link to={header.pageHref}>{header.title}</Link>
              </span>
              <h1 className="font-content text-36 leading-brand font-bold">History</h1>
            </header>
            <VersionTable path={page.path} />
          </>
        )}
      </article>
    </>
  );
}

function PageShell({ topBar, children }: { topBar: TopBarProps; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar {...topBar} />
      <main className="mx-auto flex w-full max-w-workspace flex-wrap items-start gap-24px px-24px pt-24px pb-48px">
        {children}
      </main>
    </div>
  );
}

export function PageScreen({
  path,
  anchor = '',
  history = false,
  topBar,
}: {
  path: string;
  anchor?: string;
  history?: boolean;
  topBar: TopBarProps;
}) {
  const query = useQuery({ ...pageQueryOptions(useApi(), path), enabled: !!path });
  const title = history ? 'History' : 'Wiki page';
  return (
    <PageShell topBar={topBar}>
      {!path ? null : query.isPending ? (
        <Card
          className="max-w-article flex-reading-content"
          title={title}
          state={{ type: 'loading' }}
        />
      ) : query.isError ? (
        <QueryError
          title={history ? 'Could not load version history.' : 'Could not load the page.'}
          error={query.error}
          retry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : (
        <ReadingPage page={query.data} anchor={anchor} history={history} />
      )}
    </PageShell>
  );
}
