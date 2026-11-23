import type { UseQueryResult } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiError } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { Button } from '../../ui/Button';
import { QueryFailure } from '../../ui/QueryFailure';
import { TopicThread } from '../discussions/TopicThread';
import { useDispute, useOpenProposalDiscussion } from '../discussions/queries';
import {
  RESOLUTION_KINDS,
  disputeRows,
  type ProposalDetailDto,
  type ProposalDiscussionDto,
  type SeenVersions,
} from './model';

export type DiscussionQuery = UseQueryResult<ProposalDiscussionDto>;
type ResolutionKind = (typeof RESOLUTION_KINDS)[number][0];

const fieldClass = 'resize-y rounded-8 border border-control px-10px py-8px text-13';

function StartDiscussion({
  detail,
  onSeen,
}: {
  detail: ProposalDetailDto;
  onSeen: (seen: Partial<SeenVersions>) => void;
}) {
  const id = useId();
  const [body, setBody] = useState('');
  const [missing, setMissing] = useState(false);
  const open = useOpenProposalDiscussion(detail.slug);
  return (
    <div className="flex flex-col gap-10px px-18px py-14px">
      <label htmlFor={`${id}-body`} className="text-13 font-semibold">
        Start a discussion
      </label>
      <textarea
        id={`${id}-body`}
        rows={3}
        value={body}
        placeholder="What is in question, and what would settle it"
        aria-invalid={missing || undefined}
        aria-describedby={missing ? `${id}-error` : `${id}-note`}
        onChange={(event) => {
          setBody(event.target.value);
        }}
        className={fieldClass}
      />
      {missing && (
        <p id={`${id}-error`} className="text-12 text-trust-error-fg">
          Write what is in question.
        </p>
      )}
      {open.error && (
        <p role="alert" className="text-12 text-trust-error-fg">
          {messageForError(open.error)}
        </p>
      )}
      <Button
        className="self-start px-16px! py-8px!"
        loading={open.isPending}
        onClick={() => {
          const trimmed = body.trim();
          setMissing(!trimmed);
          if (!trimmed) return;
          open.mutate(
            { bundleHash: detail.bundleHash, body: trimmed },
            {
              onSuccess(discussion) {
                setBody('');
                onSeen({ discussionVersion: discussion.discussionVersion });
              },
            },
          );
        }}
      >
        Open discussion
      </Button>
      <span id={`${id}-note`} className="text-12 text-muted">
        The topic holds approval until a reviewer closes it as resolved.
      </span>
    </div>
  );
}

function ResolveDispute({
  detail,
  disputeVersion,
  onSeen,
}: {
  detail: ProposalDetailDto;
  disputeVersion: number;
  onSeen: (seen: Partial<SeenVersions>) => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<ResolutionKind>('supported');
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const dispute = useDispute(detail.slug);
  const changed = dispute.error instanceof ApiError && dispute.error.code === 'DISCUSSION_CHANGED';
  return (
    <div className="flex flex-col gap-10px border-t border-divider pt-12px">
      <label htmlFor={`${id}-kind`} className="text-13 font-semibold">
        Resolve the dispute
      </label>
      <select
        id={`${id}-kind`}
        value={kind}
        onChange={(event) => {
          setKind(event.target.value as ResolutionKind);
        }}
        className="rounded-8 border border-control bg-surface px-10px py-7px text-13"
      >
        {RESOLUTION_KINDS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-reason`} className="sr-only">
        Resolution reason
      </label>
      <textarea
        id={`${id}-reason`}
        rows={2}
        value={reason}
        placeholder="Why the claim stands, and where"
        aria-invalid={missing || undefined}
        aria-describedby={missing ? `${id}-error` : undefined}
        onChange={(event) => {
          setReason(event.target.value);
        }}
        className={fieldClass}
      />
      {missing && (
        <p id={`${id}-error`} className="text-12 text-trust-error-fg">
          Give a reason for the resolution.
        </p>
      )}
      {dispute.error && (
        <p role="alert" className="text-12 text-trust-error-fg">
          {changed
            ? 'The dispute log changed. Reload the proposal and reread it.'
            : messageForError(dispute.error)}
        </p>
      )}
      <Button
        variant="secondary-compact"
        className="self-start"
        loading={dispute.isPending}
        onClick={() => {
          const trimmed = reason.trim();
          setMissing(!trimmed);
          if (!trimmed) return;
          dispute.mutate(
            {
              bundleHash: detail.bundleHash,
              disputeVersion,
              action: 'resolve',
              resolutionKind: kind,
              reason: trimmed,
            },
            {
              onSuccess(log) {
                setReason('');
                onSeen({ disputeVersion: log.disputeVersion });
              },
            },
          );
        }}
      >
        Resolve dispute
      </Button>
    </div>
  );
}

/** Review › Discussion (derived, D-16/D-121): the proposal topic, then the dispute log. */
export function DiscussionPanel({
  detail,
  query,
  onSeen,
}: {
  detail: ProposalDetailDto;
  query: DiscussionQuery;
  onSeen: (seen: Partial<SeenVersions>) => void;
}) {
  if (!query.data)
    return query.isError ? (
      <div className="p-14px">
        <QueryFailure
          error={query.error}
          retry={() => void query.refetch()}
          busy={query.isFetching}
        />
      </div>
    ) : (
      <div className="flex flex-col gap-12px px-18px py-16px" aria-hidden="true">
        {[1, 2, 3].map((row) => (
          <div key={row} className="h-12px bg-row" />
        ))}
      </div>
    );
  const { topic, disputes } = query.data;
  const pending = detail.state === 'pending';
  const rows = disputeRows(disputes.events);
  return (
    <div className="flex flex-col">
      {topic ? (
        <section aria-label="Proposal discussion" className="flex flex-col">
          <TopicThread
            embedded
            detail={topic}
            onWritten={(next) => {
              onSeen({ discussionVersion: next.version });
            }}
          />
        </section>
      ) : pending ? (
        <StartDiscussion detail={detail} onSeen={onSeen} />
      ) : (
        <p className="px-18px py-14px text-13 text-muted">Nobody discussed this proposal.</p>
      )}
      <section
        aria-label="Dispute log"
        className="flex flex-col gap-10px border-t border-divider px-18px py-14px"
      >
        <h3 className="text-14 font-bold">
          Dispute log{' '}
          <span className="font-mono text-12 font-normal text-muted">
            dispute v{disputes.disputeVersion}
          </span>
        </h3>
        {rows.length ? (
          <ol className="m-0 flex list-none flex-col gap-10px p-0">
            {rows.map((row) => (
              <li key={row.key} className="flex gap-14px">
                <time
                  dateTime={row.at}
                  className="shrink-0 basis-diff-number pt-mark-x font-mono text-12 text-trust-none"
                >
                  {row.time}
                </time>
                <span className="min-w-0 wrap-anywhere">
                  <strong className="font-semibold">{row.who}</strong> {row.text}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-13 text-muted">No dispute on this proposal.</p>
        )}
        {pending && detail.can.decide && disputes.disputeOpen && (
          <ResolveDispute
            detail={detail}
            disputeVersion={disputes.disputeVersion}
            onSeen={onSeen}
          />
        )}
      </section>
    </div>
  );
}
