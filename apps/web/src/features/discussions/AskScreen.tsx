import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiData, useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { readStored, writeStored } from '../../lib/form-storage';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ReadingLayout } from '../../ui/ReadingLayout';
import { Select } from '../../ui/Select';
import { Textarea } from '../../ui/Textarea';
import { TextInput } from '../../ui/TextInput';
import type { TopBarProps } from '../../ui/TopBar';
import { pageQueryOptions } from '../markdown/page-query';
import { pageHref } from '../page/model';
import {
  askErrors,
  askInput,
  askStorageKey,
  pageOptions,
  sectionOptions,
  type AskDraft,
  type TopicDetailDto,
} from './model';
import { useCreateTopic } from './queries';

function useTree() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.tree,
    queryFn: async ({ signal }) => apiData(await api.GET('/api/v1/wiki/tree', { signal })),
  });
}

function AskForm({
  path: initialPath,
  section: initialSection,
  q,
  onPosted,
}: {
  path: string | null;
  section: string | null;
  q: string | null;
  onPosted: (topic: TopicDetailDto) => void;
}) {
  const api = useApi();
  const storageKey = askStorageKey(initialPath);
  const [draft, setDraft] = useState<AskDraft>(() => ({
    path: initialPath ?? '',
    section: initialSection ?? '',
    title: q ?? '',
    body: readStored(storageKey),
  }));
  const [checked, setChecked] = useState(false);
  const tree = useTree();
  const page = useQuery({ ...pageQueryOptions(api, draft.path), enabled: !!draft.path });
  const create = useCreateTopic();
  const pages = pageOptions(tree.data, draft.path || null);
  const sections = sectionOptions(page.data?.sections);
  const errors = checked ? askErrors(draft) : {};
  const set = (patch: Partial<AskDraft>) => {
    setDraft((old) => ({ ...old, ...patch }));
  };

  function submit() {
    setChecked(true);
    if (Object.keys(askErrors(draft)).length) return;
    create.mutate(askInput(draft), {
      onSuccess(topic) {
        writeStored(storageKey, null);
        onPosted(topic);
      },
    });
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-16px px-18px py-16px"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap gap-16px">
        <div className="min-w-0 flex-filter">
          <Select
            label="Page"
            value={draft.path}
            error={errors.path}
            onChange={(event) => {
              set({ path: event.target.value, section: '' });
            }}
          >
            <option value="">Choose a page</option>
            {pages.extra && <option value={pages.extra}>{pages.extra}</option>}
            {pages.groups.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {group.pages.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div className="min-w-0 flex-filter">
          <Select
            label="Section"
            value={draft.section}
            disabled={!draft.path}
            onChange={(event) => {
              set({ section: event.target.value });
            }}
          >
            {/* Keep a preselected anchor while the page loads. */}
            {draft.section && !sections.some(({ value }) => value === draft.section) && (
              <option value={draft.section}>{draft.section}</option>
            )}
            {sections.map(({ value, label }) => (
              <option key={value || 'whole'} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <TextInput
        label="Title"
        value={draft.title}
        maxLength={200}
        error={errors.title}
        onChange={(event) => {
          set({ title: event.target.value });
        }}
      />
      <Textarea
        label="Your question"
        rows={5}
        value={draft.body}
        error={errors.body}
        hint="Page authors and reviewers answer in Discussions. Your question is kept if posting fails."
        onChange={(event) => {
          set({ body: event.target.value });
          writeStored(storageKey, event.target.value);
        }}
      />
      {create.error && (
        <p role="alert" className="text-12 text-trust-error-fg">
          {messageForError(create.error)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-12px">
        <Button type="submit" loading={create.isPending}>
          Post question
        </Button>
        <a href={draft.path ? pageHref(draft.path) : '/'} className="text-13 font-medium">
          Cancel
        </a>
      </div>
    </form>
  );
}

/** *Ask a question* (D-119): derived compose screen for a topic on a page and section. */
export function AskScreen({
  path,
  section,
  q,
  topBar,
  onPosted,
}: {
  path: string | null;
  section: string | null;
  q: string | null;
  topBar: TopBarProps;
  onPosted: (topic: TopicDetailDto) => void;
}) {
  return (
    <ReadingLayout topBar={topBar}>
      <div className="flex flex-col gap-2px">
        <h1 className="text-24 font-bold">Ask a question</h1>
        <span className="text-muted">
          Ask the people who maintain the page. Your question opens a topic on the page or section.
        </span>
      </div>
      <Card title="Topic" header>
        <AskForm path={path} section={section} q={q} onPosted={onPosted} />
      </Card>
    </ReadingLayout>
  );
}
