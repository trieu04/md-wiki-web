import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, useApi } from '../../lib/api';
import { errorCopy, messageForError } from '../../lib/error-copy';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Card } from '../../ui/Card';
import { DiffView } from '../../ui/DiffView';
import { MarkdownToolbar, type MarkdownFormat } from '../../ui/MarkdownToolbar';
import { Tabs } from '../../ui/Tabs';
import { TextInput } from '../../ui/TextInput';
import { TopBar, type TopBarProps } from '../../ui/TopBar';
import { MarkdownArticle } from '../markdown/MarkdownArticle';
import { pageQueryOptions } from '../markdown/page-query';
import { QualityCheckCard } from '../quality/QualityCard';
import { qualityCard } from '../quality/model';
import { selfCheckQueryOptions, useSelfCheck } from '../quality/queries';
import { QueryFailure } from '../../ui/QueryFailure';
import {
  addAppliesTo,
  afterSubmitModel,
  applyFormat,
  baseChangedModel,
  changesModel,
  editorHeaderModel,
  gutterModel,
  sourcesModel,
  submitErrorModel,
  submitModel,
  type DraftDto,
} from './model';
import {
  draftQueryOptions,
  openDraftQueryOptions,
  useDraftActions,
  useDraftAutosave,
  useWholePage,
} from './queries';

const asideCard = 'flex flex-col gap-8px rounded-10 border border-edge bg-surface px-18px py-16px';
const smallButton =
  'rounded-7 border border-control bg-surface px-10px py-4px text-13 enabled:hover:bg-nav-current';

function Shell({ topBar, children }: { topBar: TopBarProps; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar {...topBar} />
      <main className="mx-auto box-border flex w-full max-w-workspace min-w-0 flex-col gap-16px px-28px pt-20px pb-40px">
        {children}
      </main>
    </div>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** F-06 *Self-check* (AI) on the saved draft (system-logic §7.6.6, D-150). Advice only. */
function SelfCheck({ draft, flush }: { draft: DraftDto; flush: () => Promise<DraftDto> }) {
  const report = useQuery(selfCheckQueryOptions(useApi(), draft.id));
  const run = useSelfCheck(draft.id);
  const [flushError, setFlushError] = useState<unknown>(null);
  const card = useMemo(
    () => (report.data ? qualityCard(report.data, { subject: 'draft' }) : null),
    [report.data],
  );
  const failure = flushError ?? run.error;
  if (report.isError)
    return (
      <QueryFailure
        error={report.error}
        retry={() => void report.refetch()}
        busy={report.isFetching}
      />
    );
  return (
    <QualityCheckCard
      title="Self-check"
      variant="editor"
      card={card}
      footer="Advice only. It doesn’t block submitting."
      error={failure ? messageForError(failure) : null}
      action={
        <button
          type="button"
          className={`${smallButton} disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg`}
          disabled={!card || card.active || run.isPending}
          aria-busy={run.isPending || undefined}
          onClick={() => {
            setFlushError(null);
            flush().then(
              () => {
                run.mutate();
              },
              (error: unknown) => {
                setFlushError(error);
              },
            );
          }}
        >
          {card?.state === 'none' ? 'Run self-check' : 'Run again'}
        </button>
      }
    />
  );
}

function SourceEditor({ draft }: { draft: DraftDto }) {
  const actions = useDraftActions(draft.id);
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState('');
  const rows = sourcesModel(draft);
  const error = actions.addSource.error ?? actions.removeSource.error;
  return (
    <section aria-labelledby="sources-heading" className={`${asideCard} gap-10px`}>
      <div className="flex items-center justify-between">
        <h2 id="sources-heading" className="text-14 font-bold">
          Sources you read
        </h2>
        <button
          type="button"
          className={smallButton}
          aria-expanded={adding}
          onClick={() => {
            setAdding(!adding);
          }}
        >
          Add source
        </button>
      </div>
      {adding && (
        <form
          className="flex flex-wrap items-end gap-8px text-13"
          onSubmit={(event) => {
            event.preventDefault();
            actions.addSource.mutate(path.trim(), {
              onSuccess() {
                setPath('');
                setAdding(false);
              },
            });
          }}
        >
          <div className="min-w-0 flex-1">
            <TextInput
              label="Wiki path"
              value={path}
              placeholder="sources/handbook.md"
              onChange={(event) => {
                setPath(event.target.value);
              }}
            />
          </div>
          <Button
            type="submit"
            variant="secondary-compact"
            loading={actions.addSource.isPending}
            disabled={!path.trim()}
          >
            Add
          </Button>
        </form>
      )}
      {rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-8px p-0">
          {rows.map((row) => (
            <li
              key={row.path}
              className="flex flex-col gap-2px rounded-8 border border-divider px-10px py-8px"
            >
              <span className="font-mono text-12">{row.path}</span>
              <span className={`text-12 ${row.changed ? 'text-trust-error-fg' : 'text-muted'}`}>
                {row.meta}
              </span>
              {row.removable && (
                <Button
                  variant="link"
                  className="self-start"
                  aria-label={`Remove ${row.path}`}
                  loading={
                    actions.removeSource.isPending && actions.removeSource.variables === row.path
                  }
                  onClick={() => {
                    actions.removeSource.mutate(row.path);
                  }}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-12 text-trust-error-fg">{messageForError(error)}</p>}
      <span className="text-12 text-muted">
        Pinned at the version you read. If one changes before review, the proposal goes stale.
      </span>
    </section>
  );
}

function AppliesToEditor({
  rows,
  onChange,
}: {
  rows: DraftDto['appliesTo'];
  onChange: (rows: DraftDto['appliesTo']) => void;
}) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [error, setError] = useState<string>();
  return (
    <section aria-labelledby="applies-heading" className={asideCard}>
      <h2 id="applies-heading" className="text-14 font-bold">
        Applies to
      </h2>
      {rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-6px p-0 text-13">
          {rows.map((row) => (
            <li key={row.name} className="flex items-center justify-between gap-8px">
              <span>
                {row.name} <span className="font-mono text-12 text-muted">{row.version}</span>
              </span>
              <Button
                variant="link"
                aria-label={`Remove ${row.name}`}
                onClick={() => {
                  onChange(rows.filter((other) => other !== row));
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-8px text-13"
        onSubmit={(event) => {
          event.preventDefault();
          const result = addAppliesTo(rows, name, version);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setError(undefined);
          setName('');
          setVersion('');
          onChange(result.rows);
        }}
      >
        <div className="min-w-0 flex-2">
          <TextInput
            label="Software or instrument"
            value={name}
            error={error}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <TextInput
            label="Version"
            value={version}
            onChange={(event) => {
              setVersion(event.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="secondary-compact">
          Add
        </Button>
      </form>
    </section>
  );
}

function Editor({ draft, topBar }: { draft: DraftDto; topBar: TopBarProps }) {
  const api = useApi();
  const navigate = useNavigate();
  const autosave = useDraftAutosave(draft);
  const actions = useDraftActions(draft.id);
  const wholePage = useWholePage(draft);
  const page = useQuery({
    ...pageQueryOptions(api, draft.targetPath),
    enabled: draft.base !== null,
  });
  const [tab, setTab] = useState('write');
  const [againstCurrent, setAgainstCurrent] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const content = autosave.pending.content ?? draft.content;
  const reason = autosave.pending.reason ?? draft.reason;
  const appliesTo = autosave.pending.appliesTo ?? draft.appliesTo;
  const header = editorHeaderModel(draft, { saving: autosave.saving });
  const banner = baseChangedModel(draft);
  const changes = useMemo(
    () => changesModel(draft, content, againstCurrent),
    [draft, content, againstCurrent],
  );
  const gutter = useMemo(() => gutterModel(draft.baseStartLine, content), [draft, content]);
  const submit = submitModel(draft);
  const submitError = actions.submit.error ? submitErrorModel(actions.submit.error) : null;
  const rebaseError =
    actions.rebase.error instanceof ApiError &&
    (actions.rebase.error.code === 'SECTION_CHANGED' || actions.rebase.error.code === 'STALE_BASE')
      ? actions.rebase.error.code
      : null;
  const otherError = [
    autosave.error,
    wholePage.error,
    actions.discard.error,
    actions.exportFile.error,
  ]
    .concat(rebaseError ? [] : [actions.rebase.error])
    .find(Boolean);

  function format(kind: MarkdownFormat) {
    const node = textarea.current;
    if (!node) return;
    const next = applyFormat(content, node.selectionStart, node.selectionEnd, kind);
    autosave.edit({ content: next.text });
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(next.start, next.end);
    });
  }

  async function onSubmit() {
    const saved = await autosave.flush();
    actions.submit.mutate(saved, {
      onSuccess() {
        void navigate({ to: '/me', search: { tab: 'suggestions' } });
      },
    });
  }

  return (
    <Shell topBar={topBar}>
      <div className="flex flex-col gap-6px">
        <span className="text-13 text-muted">
          <Link to={header.pageHref} className="text-muted">
            {header.path}
          </Link>{' '}
          / Propose edit
        </span>
        <div className="flex flex-wrap items-start justify-between gap-x-24px gap-y-12px">
          <div className="flex flex-col gap-4px">
            <h1 className="text-24 font-bold">{header.title}</h1>
            <span className="text-muted" aria-live="polite">
              {header.subtitle}
            </span>
          </div>
          <div className="flex flex-wrap gap-8px">
            <Button
              variant="secondary"
              loading={actions.discard.isPending}
              onClick={() => {
                actions.discard.mutate(undefined, {
                  onSuccess() {
                    void navigate({ to: header.pageHref });
                  },
                });
              }}
            >
              Discard draft
            </Button>
            {header.canExport && (
              <Button
                variant="secondary"
                loading={actions.exportFile.isPending}
                onClick={() => {
                  void autosave.flush().then(() => {
                    actions.exportFile.mutate(undefined, {
                      onSuccess({ name, text }) {
                        download(name, text);
                      },
                    });
                  });
                }}
              >
                Export .contribution.md
              </Button>
            )}
            {header.wholePageAction && (
              <Button
                variant="secondary"
                loading={wholePage.isPending}
                onClick={() => {
                  void autosave.flush().then(() => {
                    wholePage.mutate();
                  });
                }}
              >
                Whole page
              </Button>
            )}
          </div>
        </div>
      </div>

      {banner && (
        <Callout
          tone="error"
          title={banner.title}
          action={
            <button
              type="button"
              className="bg-transparent p-0 font-semibold text-accent underline hover:text-accent-hover disabled:cursor-not-allowed"
              disabled={actions.rebase.isPending}
              onClick={() => {
                actions.rebase.mutate('auto', {
                  onError(error) {
                    if (error instanceof ApiError && error.code === 'SECTION_CHANGED') {
                      setAgainstCurrent(true);
                      setTab('diff');
                    }
                  },
                });
              }}
            >
              Compare and rebase
            </button>
          }
        >
          {banner.text}
        </Callout>
      )}
      {rebaseError && draft.baseChanged && (
        <Callout
          tone="error"
          title={errorCopy[rebaseError]}
          action={
            <Button
              variant="secondary"
              loading={actions.rebase.isPending}
              onClick={() => {
                actions.rebase.mutate('keep_mine', {
                  onSuccess() {
                    setAgainstCurrent(false);
                  },
                });
              }}
            >
              Keep my text and rebase
            </Button>
          }
        >
          Changes now compares the current text with yours.
        </Callout>
      )}
      {otherError && (
        <Callout tone="error" title="Something did not save.">
          {messageForError(otherError)}
        </Callout>
      )}

      <div className="flex flex-wrap items-start gap-16px">
        <section
          aria-label="Editor"
          className="flex min-w-0 flex-editor-content flex-col overflow-hidden rounded-10 border border-edge bg-surface"
        >
          <Tabs
            label="Mode"
            selected={tab}
            onChange={setTab}
            actions={<MarkdownToolbar onFormat={format} disabled={tab !== 'write'} />}
            tabs={[
              {
                id: 'write',
                label: 'Write',
                panel: (
                  <div className="flex font-mono text-13 leading-editor">
                    <div
                      aria-hidden="true"
                      className="bg-subtle-gutter py-14px pr-10px pl-16px text-right text-placeholder border-r border-divider"
                    >
                      {gutter.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                    <label htmlFor="draft-source" className="sr-only">
                      Markdown source
                    </label>
                    <textarea
                      id="draft-source"
                      ref={textarea}
                      spellCheck={false}
                      wrap="off"
                      rows={gutter.length}
                      value={content}
                      onChange={(event) => {
                        autosave.edit({ content: event.target.value });
                      }}
                      className="min-h-editor-min min-w-0 flex-auto resize-y overflow-x-auto border-0 px-16px py-14px font-[inherit] text-primary focus-visible:-outline-offset-2"
                    />
                  </div>
                ),
              },
              {
                id: 'preview',
                label: 'Preview',
                panel: (
                  <div className="px-26px py-20px">
                    {content.trim() ? (
                      <MarkdownArticle markdown={content} sections={[]} />
                    ) : (
                      <p className="text-13 text-muted">Nothing to preview yet.</p>
                    )}
                  </div>
                ),
              },
              {
                id: 'diff',
                label: 'Changes',
                panel: <DiffView rows={changes.rows} />,
              },
            ]}
          />
          <div className="mt-auto flex flex-wrap gap-12px border-t border-divider px-16px py-8px text-12 text-muted">
            <span>Markdown</span>
            <span>{changes.summary}</span>
            <span>{changes.scope}</span>
          </div>
        </section>

        <aside
          aria-label="Submission"
          className="flex min-w-0 max-w-editor-aside-max grow basis-editor-aside flex-col gap-12px"
        >
          <section className={asideCard}>
            <label htmlFor="draft-reason" className="text-14 font-bold">
              Reason (required)
            </label>
            <textarea
              id="draft-reason"
              rows={2}
              value={reason}
              aria-invalid={submitError?.field === 'reason' || undefined}
              aria-describedby="draft-reason-hint"
              onChange={(event) => {
                autosave.edit({ reason: event.target.value });
              }}
              className="resize-y rounded-8 border border-control px-10px py-8px text-13 text-primary"
            />
            <span id="draft-reason-hint" className="text-12 text-muted">
              Reviewers compare the reason with the change. Say every claim you add.
            </span>
            {submitError?.field === 'reason' && (
              <p className="text-12 text-trust-error-fg">Add a reason before submitting.</p>
            )}
          </section>

          <SourceEditor draft={draft} />

          <AppliesToEditor
            rows={appliesTo}
            onChange={(rows) => {
              autosave.edit({ appliesTo: rows });
            }}
          />

          <SelfCheck draft={draft} flush={() => autosave.flush()} />

          <Callout tone="info" title="After you submit">
            <ol className="m-0 flex list-decimal flex-col gap-3px pl-18px text-13 text-secondary">
              {afterSubmitModel(page.data?.maintainers.map(({ name }) => name)).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {submitError && submitError.field === null && (
              <p role="alert" className="text-12 text-trust-error-fg">
                {errorCopy[submitError.code]}
              </p>
            )}
            <Button
              disabled={submit.disabled}
              loading={actions.submit.isPending}
              onClick={() => void onSubmit()}
            >
              {submit.label}
            </Button>
          </Callout>
        </aside>
      </div>
    </Shell>
  );
}

export function EditorScreen({
  path,
  section,
  topBar,
}: {
  path: string;
  section: string | null;
  topBar: TopBarProps;
}) {
  const api = useApi();
  // Opening a draft is a POST: wait for the session so the request carries its CSRF token.
  const session = useSession();
  const open = useQuery({
    ...openDraftQueryOptions(api, path, section),
    enabled: !!path && session.data !== undefined,
  });
  const draft = useQuery({
    ...draftQueryOptions(api, open.data?.id ?? ''),
    enabled: !!open.data,
    ...(open.data && { initialData: open.data }),
  });
  if (!path) return <Shell topBar={topBar}>{null}</Shell>;
  if (open.isError || draft.isError) {
    const error = open.error ?? draft.error;
    return (
      <Shell topBar={topBar}>
        <Callout
          tone="error"
          queryError
          title="Could not open the editor."
          action={
            <Button
              variant="secondary"
              loading={open.isFetching || draft.isFetching}
              onClick={() => void (open.isError ? open.refetch() : draft.refetch())}
            >
              Try again
            </Button>
          }
        >
          {messageForError(error)}
        </Callout>
      </Shell>
    );
  }
  if (!draft.data)
    return (
      <Shell topBar={topBar}>
        <Card title="Suggest an edit" state={{ type: 'loading' }} />
      </Shell>
    );
  return <Editor key={draft.data.id} draft={draft.data} topBar={topBar} />;
}
