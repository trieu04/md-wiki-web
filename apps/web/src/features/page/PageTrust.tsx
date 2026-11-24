import { useQuery } from '@tanstack/react-query';
import { labelMeta } from '@md-wiki/domain';
import { useState } from 'react';
import { useApi } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';
import { Button } from '../../ui/Button';
import { PillToggle } from '../../ui/PillToggle';
import { TrustIcon } from '../../ui/TrustIcon';
import { userInitials } from '../navigation/model';
import type { PageDto } from '../markdown/model';
import {
  FEEDBACK_ANSWERS,
  activeUseful,
  feedbackQuestion,
  peopleText,
  usefulInput,
  whyModel,
  type FeedbackAnswer,
  type SectionTarget,
  type TrustMode,
} from '../trust/model';
import {
  followsQueryOptions,
  peopleQueryOptions,
  useFollowMutations,
  usePageFeedback,
  useTrustMutations,
  whyQueryOptions,
} from '../trust/queries';
import { isFollowing } from './model';

const cardClass = 'flex flex-col gap-10px rounded-12 border border-edge bg-surface px-18px py-16px';
const chipClass =
  'rounded-7 border border-control bg-surface px-10px py-5px text-13 text-primary hover:bg-nav-current active:bg-nav-current aria-pressed:border-accent aria-pressed:bg-selected';

/** F-03 *Follow* in the action row (D-171). */
export function FollowButton({ path }: { path: string }) {
  const follows = useQuery(followsQueryOptions(useApi()));
  const { follow, unfollow } = useFollowMutations();
  const following = isFollowing(follows.data?.items ?? [], path);
  const busy = follow.isPending || unfollow.isPending;
  return (
    <button
      type="button"
      aria-pressed={following}
      disabled={busy || follows.isPending}
      onClick={() => {
        if (following) unfollow.mutate({ path });
        else follow.mutate({ path, muted: false });
      }}
      className={`rounded-8 border px-12px py-7px font-medium text-primary hover:bg-nav-current ${following ? 'border-accent bg-selected' : 'border-control bg-surface'}`}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  );
}

/** *This section:* row under the selected section (F-03). */
export function SectionActions({
  section,
  onOpen,
  sawCounts,
}: {
  section: SectionTarget;
  onOpen: (mode: Exclude<TrustMode, 'why'>, trigger: HTMLElement, quote: string) => void;
  sawCounts: boolean;
}) {
  const people = useQuery(peopleQueryOptions(useApi(), section.path, section.anchor, false));
  const { attest, withdraw } = useTrustMutations(section.path);
  const useful = activeUseful(people.data);
  const error = attest.error ?? withdraw.error;
  const open = (mode: Exclude<TrustMode, 'why'>) => (event: { currentTarget: HTMLElement }) => {
    const selection = globalThis.getSelection()?.toString().trim() ?? '';
    onOpen(mode, event.currentTarget, selection.slice(0, 2000));
  };
  return (
    <div className="flex flex-col gap-6px pt-4px font-ui">
      <div
        role="group"
        aria-label={`This section: ${section.title}`}
        className="flex flex-wrap items-center gap-6px text-13"
      >
        <span className="mr-4px text-muted">This section:</span>
        <button
          type="button"
          className={chipClass}
          aria-pressed={!!useful}
          disabled={attest.isPending || withdraw.isPending || people.isPending}
          onClick={() => {
            if (useful) withdraw.mutate(useful.id);
            else attest.mutate(usefulInput(section, sawCounts));
          }}
        >
          Useful
        </button>
        <button type="button" className={chipClass} onClick={open('check')}>
          I checked a source
        </button>
        <button type="button" className={chipClass} onClick={open('use')}>
          I used it in practice
        </button>
        <button type="button" className={chipClass} onClick={open('report')}>
          Report a problem
        </button>
      </div>
      {error && <p className="text-12 text-trust-error-fg">{messageForError(error)}</p>}
    </div>
  );
}

function WhyCard({
  section,
  onFull,
}: {
  section: SectionTarget;
  onFull: (trigger: HTMLElement) => void;
}) {
  const why = useQuery(whyQueryOptions(useApi(), section.path, section.anchor));
  const model = why.data && whyModel(why.data);
  return (
    <section aria-label="Why this label" className={cardClass}>
      <h2 className="text-15 font-bold">Why “{section.title}” has this label</h2>
      {why.isPending ? (
        <p className="text-13 text-muted">Loading…</p>
      ) : why.isError ? (
        <p className="text-13 text-trust-error-fg">{messageForError(why.error)}</p>
      ) : (
        model && (
          <>
            <span className="inline-flex items-center gap-8px font-semibold">
              <TrustIcon label={model.label} size={14} />
              {labelMeta[model.label]}
            </span>
            {model.evidence.length ? (
              <ul className="flex flex-col gap-9px">
                {model.evidence.slice(0, 3).map((row) => (
                  <li key={row.key} className="flex flex-col text-13">
                    <span>{row.what}</span>
                    <span className="text-12 text-muted">
                      {row.when}
                      {row.meta && ` · ${row.meta}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-13 text-muted">No evidence recorded yet.</p>
            )}
            {model.changeIt[0] && (
              <span className="border-t border-row pt-8px text-12 text-muted">
                {model.changeIt[0]}
              </span>
            )}
          </>
        )
      )}
      <Button
        variant="link"
        className="self-start"
        onClick={(event) => {
          onFull(event.currentTarget);
        }}
      >
        Full evidence and history
      </Button>
    </section>
  );
}

function PeopleCard({
  section,
  revealed,
  onReveal,
}: {
  section: SectionTarget;
  revealed: boolean;
  onReveal: (revealed: boolean) => void;
}) {
  const people = useQuery(peopleQueryOptions(useApi(), section.path, section.anchor, revealed));
  const acted = people.data?.acted ?? false;
  return (
    <section aria-label="People who rely on it" className={cardClass}>
      <h2 className="text-15 font-bold">People who rely on it</h2>
      <span className="text-13 text-secondary" aria-live="polite">
        {people.isError ? messageForError(people.error) : peopleText(people.data)}
      </span>
      {!acted && (
        <Button
          variant="link"
          className="self-start"
          onClick={() => {
            onReveal(!revealed);
          }}
        >
          {revealed ? 'Hide' : 'Show anyway'}
        </Button>
      )}
      <span className="text-12 text-muted">
        Shown as team counts, never names. For content quality only, not to rate people.
      </span>
    </section>
  );
}

function MaintainersCard({ page }: { page: PageDto }) {
  return (
    <section aria-label="Maintained by" className={cardClass}>
      <h2 className="text-15 font-bold">Maintained by</h2>
      {page.maintainers.length ? (
        <ul className="flex flex-col gap-8px">
          {page.maintainers.map(({ name }) => (
            <li key={name} className="flex items-center gap-10px">
              <span
                aria-hidden="true"
                className="inline-flex size-28px items-center justify-center rounded-14 bg-avatar text-11 font-semibold text-accent-hover"
              >
                {userInitials(name)}
              </span>
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-13 text-muted">No page authors listed.</p>
      )}
      <dl className="flex gap-10px border-t border-row pt-8px text-13">
        <dt className="text-muted">Version</dt>
        <dd>{page.versionLabel}</dd>
      </dl>
    </section>
  );
}

export function PageRail({
  page,
  section,
  revealed,
  onReveal,
  onFull,
}: {
  page: PageDto;
  section: SectionTarget | null;
  revealed: boolean;
  onReveal: (revealed: boolean) => void;
  onFull: (trigger: HTMLElement) => void;
}) {
  return (
    <aside
      aria-label="About this page"
      className="flex min-w-0 max-w-rail-page grow basis-rail-page flex-col gap-14px"
    >
      {section && <WhyCard key={section.anchor} section={section} onFull={onFull} />}
      {section && (
        <PeopleCard
          key={`people:${section.anchor}`}
          section={section}
          revealed={revealed}
          onReveal={onReveal}
        />
      )}
      <MaintainersCard page={page} />
    </aside>
  );
}

/** *Did this page help with your work?* (F-03, §7.7.6): one answer per version. */
export function PageFeedback({ page }: { page: PageDto }) {
  const feedback = usePageFeedback();
  const [answer, setAnswer] = useState<FeedbackAnswer | null>(null);
  return (
    <section
      aria-label="Feedback on this page"
      className="flex flex-wrap items-center justify-between gap-x-16px gap-y-10px rounded-10 bg-canvas px-16px py-14px font-ui"
    >
      <span className="font-semibold" aria-live="polite">
        {feedback.error ? messageForError(feedback.error) : feedbackQuestion(answer)}
      </span>
      <div role="group" aria-label="Did this page help?" className="flex gap-6px">
        {FEEDBACK_ANSWERS.map((option) => (
          <PillToggle
            key={option.value}
            size="sort"
            pressed={answer === option.value}
            disabled={feedback.isPending}
            onClick={() => {
              feedback.mutate(
                { path: page.path, versionLabel: page.versionLabel, answer: option.value },
                {
                  onSuccess: () => {
                    setAnswer(option.value);
                  },
                },
              );
            }}
          >
            {option.label}
          </PillToggle>
        ))}
      </div>
    </section>
  );
}
