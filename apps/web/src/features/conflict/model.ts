import type { components } from '@md-wiki/contracts';
import { lineDiff, splitLines } from '@md-wiki/domain';
import type { ProposalDetailDto } from '../review/model';

export type ConflictDto = components['schemas']['ConflictDto'];
export type ConflictInput = components['schemas']['ConflictInput'];
export type ConflictChoice = 'merge' | 'mine' | 'drop';
export type LineTone = 'plain' | 'del' | 'add' | 'theirs';
export type Pane = { title: string; meta: string; lines: { text: string; tone: LineTone }[] };

/** F-07 *What do you want to do?* → `POST /proposals/{slug}/conflict` outcome (D-84, D-99). */
export const CONFLICT_OUTCOME = {
  merge: 'merge',
  mine: 'use_incoming',
  drop: 'keep_current',
} as const satisfies Record<ConflictChoice, ConflictInput['outcome']>;

type ChoiceCopy = {
  value: ConflictChoice;
  label: string;
  hint: string;
  editorTitle: string;
  submit: string;
};
const MERGE: ChoiceCopy = {
  value: 'merge',
  label: 'Combine both',
  hint: 'Keep the new wording and add your change',
  editorTitle: 'Combined section',
  submit: 'Submit as new proposal',
};
export const CONFLICT_CHOICES: readonly ChoiceCopy[] = [
  MERGE,
  {
    value: 'mine',
    label: 'Replace with mine',
    hint: 'Your change replaces the new wording; reviewers see both diffs',
    editorTitle: 'Your section',
    submit: 'Submit as new proposal',
  },
  {
    value: 'drop',
    label: 'Drop my change',
    hint: 'The current page already says enough',
    editorTitle: 'Current section (no change)',
    submit: 'Withdraw with reason',
  },
];

export function choiceCopy(choice: ConflictChoice): ChoiceCopy {
  return CONFLICT_CHOICES.find(({ value }) => value === choice) ?? MERGE;
}

function toned(text: string, changed: ReadonlySet<number>, tone: LineTone) {
  return splitLines(text).map((line, index) => ({
    text: line,
    tone: changed.has(index) ? tone : ('plain' as const),
  }));
}

/** Indexes (0-based) of `side` lines that differ from `other` in a line diff. */
function changedLines(from: string, to: string, side: 'old' | 'new') {
  const changed = new Set<number>();
  for (const line of lineDiff(from, to)) {
    if (side === 'old' && line.kind === 'del' && line.oldLine !== null)
      changed.add(line.oldLine - 1);
    if (side === 'new' && line.kind === 'add' && line.newLine !== null)
      changed.add(line.newLine - 1);
  }
  return changed;
}

/**
 * The three F-07 panes: base lines the proposal removed (del), current lines that changed since
 * the author read (theirs), proposed lines the author added (add).
 */
export function conflictPanes(detail: ProposalDetailDto, conflict: ConflictDto): Pane[] {
  const { baseText, currentText, proposedText } = conflict;
  const publishedBy = conflict.current?.publishedBy?.slug;
  return [
    {
      title: 'What you read',
      meta: conflict.base?.versionLabel ?? 'new page',
      lines: toned(baseText, changedLines(baseText, proposedText, 'old'), 'del'),
    },
    {
      title: 'What changed since',
      meta: conflict.current
        ? [conflict.current.versionLabel, publishedBy ?? 'changed outside review'].join(' · ')
        : 'deleted',
      lines: toned(currentText, changedLines(baseText, currentText, 'new'), 'theirs'),
    },
    {
      title: 'Your proposal',
      meta: detail.slug,
      lines: toned(proposedText, changedLines(baseText, proposedText, 'new'), 'add'),
    },
  ];
}

export function conflictSubline(conflict: ConflictDto) {
  const read = conflict.base ? `You read ${conflict.base.versionLabel}` : 'You proposed a new page';
  const now = conflict.current
    ? `now ${conflict.current.versionLabel} (${conflict.current.publishedBy?.slug ?? 'changed outside review'})`
    : 'now deleted';
  return [read, now, conflict.section ? `section #${conflict.section}` : 'whole page'].join(' · ');
}

/** Text the editor starts from for each choice; nothing is merged for the author. */
export function startingText(choice: ConflictChoice, conflict: ConflictDto) {
  switch (choice) {
    case 'merge': {
      const current = conflict.currentText.trimEnd();
      const mine = splitLines(conflict.proposedText.trimEnd());
      // A section region starts with its heading; do not repeat it below the current text.
      if (mine[0] !== undefined && mine[0] === splitLines(current)[0]) mine.shift();
      return [current, mine.join('\n').trim()].filter(Boolean).join('\n\n');
    }
    case 'mine':
      return conflict.proposedText;
    default:
      return conflict.currentText;
  }
}

export function startsFrom(choice: ConflictChoice, conflict: ConflictDto) {
  if (choice === 'merge') return 'current page + your proposal';
  if (choice === 'mine') return 'your proposal';
  return conflict.current?.versionLabel ?? 'current page';
}

export type ConflictFormError = { field: 'reason' | 'text'; message: string } | null;

/** Body for the conflict endpoint, or the field to fix (VALIDATION rules of §7.4.7). */
export function conflictInput(
  choice: ConflictChoice,
  reason: string,
  text: string,
): { input: ConflictInput; error: null } | { input: null; error: NonNullable<ConflictFormError> } {
  const trimmed = reason.trim();
  if (!trimmed) return { input: null, error: { field: 'reason', message: 'Give a reason.' } };
  if (choice === 'drop')
    return { input: { outcome: 'keep_current', reason: trimmed }, error: null };
  if (!text.trim())
    return {
      input: null,
      error: { field: 'text', message: 'The new section text cannot be empty.' },
    };
  return {
    input: { outcome: CONFLICT_OUTCOME[choice], reason: trimmed, replacement: text },
    error: null,
  };
}
