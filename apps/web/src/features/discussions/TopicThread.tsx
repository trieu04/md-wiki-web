import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiError } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { queryKeys } from '../../lib/query-keys';
import { readStored, writeStored } from '../../lib/form-storage';
import { AITag } from '../../ui/AITag';
import { Button } from '../../ui/Button';
import { proposalHref } from '../review/model';
import {
  readOnlyNote,
  replyStorageKey,
  sectionHref,
  threadActions,
  threadPosts,
  threadProps,
  threadTextError,
  topicWhere,
  type ThreadIntent,
  type TopicDetailDto,
} from './model';
import { useThreadWrite, type ThreadWrite } from './queries';

const linkClass =
  'rounded-7 border border-control px-12px py-6px text-13 font-medium text-primary no-underline hover:bg-nav-current hover:text-primary';
const closeClass =
  'rounded-7 border border-control bg-surface px-10px py-6px text-13 text-native-button enabled:hover:bg-nav-current disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg';

function writeOf(intent: ThreadIntent, text: string, version: number): ThreadWrite {
  const body = text.trim();
  switch (intent.kind) {
    case 'reply':
      return { kind: 'reply', body: { body, kind: 'comment', version } };
    case 'close':
      return { kind: 'close', body: { outcome: intent.outcome, reason: body, version } };
    case 'reopen':
      return { kind: 'reopen', body: { reason: body, version } };
  }
}

function ThreadForm({
  detail,
  onWritten,
}: {
  detail: TopicDetailDto;
  onWritten?: (detail: TopicDetailDto) => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const storageKey = replyStorageKey(detail.id);
  const [text, setText] = useState(() => readStored(storageKey));
  const [invalid, setInvalid] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const write = useThreadWrite(detail.id);
  const actions = threadActions(detail);
  const failure =
    write.error && !(write.error instanceof ApiError && write.error.code === 'DISCUSSION_CHANGED')
      ? write.error
      : null;

  function submit(intent: ThreadIntent) {
    const problem = threadTextError(intent, text);
    setInvalid(problem);
    if (problem) return;
    write.mutate(writeOf(intent, text, detail.version), {
      onSuccess(next) {
        writeStored(storageKey, null);
        setText('');
        onWritten?.(next);
      },
      onError(error) {
        if (error instanceof ApiError && error.code === 'DISCUSSION_CHANGED') setLocked(true);
      },
    });
  }

  function reload() {
    void queryClient
      .invalidateQueries({ queryKey: queryKeys.discussionTopic(detail.id) })
      .then(() => {
        setLocked(false);
        write.reset();
      });
  }

  return (
    <div className="mt-auto flex flex-col gap-10px border-t border-divider px-18px py-14px">
      {locked && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-16px gap-y-8px rounded-10 border border-trust-error-border bg-surface px-16px py-12px"
        >
          <span>
            <strong>New entry in this topic.</strong> Reread before posting. Your text is kept.
          </span>
          <button type="button" className="font-semibold text-accent underline" onClick={reload}>
            Reload
          </button>
        </div>
      )}
      <label htmlFor={`${id}-reply`} className="text-13 font-semibold">
        {actions.reply ? 'Reply' : 'Rationale'}
      </label>
      <textarea
        id={`${id}-reply`}
        rows={3}
        value={text}
        placeholder={actions.reply ? actions.placeholder : 'Why you close or reopen this topic.'}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? `${id}-error` : `${id}-note`}
        onChange={(event) => {
          setText(event.target.value);
          writeStored(storageKey, event.target.value);
        }}
        className="resize-y rounded-8 border border-control px-10px py-8px text-13"
      />
      {invalid && (
        <p id={`${id}-error`} className="text-12 text-trust-error-fg">
          {invalid}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-12 text-trust-error-fg">
          {messageForError(failure)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-8px">
        <div className="flex flex-wrap items-center gap-6px text-13">
          {actions.close.length > 0 && (
            <>
              <span className="text-muted">Close as</span>
              {actions.close.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={closeClass}
                  disabled={locked || write.isPending}
                  onClick={() => {
                    submit({ kind: 'close', outcome: value });
                  }}
                >
                  {label}
                </button>
              ))}
            </>
          )}
          {actions.reopen && (
            <button
              type="button"
              className={closeClass}
              disabled={locked || write.isPending}
              onClick={() => {
                submit({ kind: 'reopen' });
              }}
            >
              Reopen
            </button>
          )}
        </div>
        {actions.reply && (
          <Button
            className="px-16px! py-8px!"
            disabled={locked}
            loading={write.isPending}
            onClick={() => {
              submit({ kind: 'reply' });
            }}
          >
            Post reply
          </Button>
        )}
      </div>
      <span id={`${id}-note`} className="text-12 text-muted">
        {actions.note}
      </span>
    </div>
  );
}

/**
 * F-11 › Thread: header, properties, entries and the reply/close form (`can` decides). The caller
 * owns the landmark, so it stays the same element while topics load.
 */
export function TopicThread({
  detail,
  onWritten,
  embedded = false,
}: {
  detail: TopicDetailDto;
  onWritten?: (detail: TopicDetailDto) => void;
  /** Inside Review › Discussion: no card frame, a smaller heading. */
  embedded?: boolean;
}) {
  const now = new Date();
  const props = threadProps(detail);
  const posts = threadPosts(detail.entries, now);
  const actions = threadActions(detail);
  const Heading = embedded ? 'h3' : 'h2';
  return (
    <div className="flex min-w-0 flex-auto flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-20px gap-y-10px border-b border-divider px-18px py-16px">
        <div className="flex min-w-0 flex-col gap-4px wrap-anywhere">
          <Heading className={`${embedded ? 'text-16' : 'text-18'} font-bold`}>
            {detail.title}
          </Heading>
          <span className="font-mono text-12 text-muted">{topicWhere(detail)}</span>
        </div>
        <div className="flex flex-wrap gap-8px">
          <a href={sectionHref(detail)} className={linkClass}>
            Open section
          </a>
          {detail.proposal && !embedded && (
            <a href={proposalHref(detail.proposal.slug)} className={linkClass}>
              {detail.proposal.holds ? 'Held proposal' : 'Proposal'}
            </a>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-thread-props gap-x-12px gap-y-6px border-b border-divider px-18px py-12px text-13">
        {props.map(({ k, v }) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 wrap-anywhere">{v}</dd>
          </div>
        ))}
      </dl>
      <ol aria-label="Entries" className="m-0 flex list-none flex-col px-18px py-8px">
        {posts.map((post) => (
          <li key={post.key} className="flex gap-12px border-b border-row py-12px">
            <span
              aria-hidden="true"
              className={`inline-flex size-avatar-sm shrink-0 items-center justify-center rounded-15 text-11 font-semibold text-primary ${post.agent ? 'bg-ai-bg' : 'bg-avatar'}`}
            >
              {post.initials}
            </span>
            <div className="flex min-w-0 flex-auto flex-col gap-2px">
              <span className="flex flex-wrap items-center gap-8px">
                <strong className="font-semibold">{post.who}</strong>
                <span className="text-12 text-muted">
                  {post.action} · <time dateTime={post.at}>{post.time}</time>
                </span>
                {post.agent && <AITag />}
              </span>
              <span className="whitespace-pre-wrap text-body-strong wrap-anywhere">
                {post.text}
              </span>
            </div>
          </li>
        ))}
      </ol>
      {actions.any ? (
        <ThreadForm key={detail.id} detail={detail} {...(onWritten && { onWritten })} />
      ) : (
        <p className="mt-auto border-t border-divider px-18px py-14px text-13 text-muted">
          {readOnlyNote(detail)}
        </p>
      )}
    </div>
  );
}
