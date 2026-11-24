import type { components } from '@md-wiki/contracts';
import { citedSources, formatDate, labelMeta } from '@md-wiki/domain';

type S = components['schemas'];
export type WhyDto = S['WhyDto'];
export type EvidenceDto = S['EvidenceDto'];
export type PeopleDto = S['PeopleDto'];
export type PeopleCountDto = S['PeopleCountDto'];
export type AttestationDto = S['AttestationDto'];
export type AttestationInput = S['AttestationInput'];
export type ReportInput = S['ReportInput'];
export type AttestationResultDto = S['AttestationResultDto'];

/** F-04 drawer modes (system-logic §7.7.13). */
export const TRUST_MODES = [
  { id: 'why', label: 'Why this label' },
  { id: 'check', label: 'I checked a source' },
  { id: 'use', label: 'I used it' },
  { id: 'report', label: 'Report a problem' },
] as const;
export type TrustMode = (typeof TRUST_MODES)[number]['id'];

export function trustMode(value: unknown): TrustMode {
  return TRUST_MODES.some(({ id }) => id === value) ? (value as TrustMode) : 'why';
}

/** The section a reader acts on: always the hash they read (SECTION_CHANGED otherwise). */
export type SectionTarget = { path: string; anchor: string; sectionHash: string; title: string };

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

function evidenceMeta(item: EvidenceDto): string {
  const parts: string[] = [];
  if (item.result === 'supported') parts.push('Supports the text');
  else if (item.result === 'not_supported') parts.push('Does not support the text');
  else if (item.result === 'unverifiable') parts.push('Could not be checked');
  if (item.sourceName && !item.summary.includes(item.sourceName)) parts.push(item.sourceName);
  if (item.open === true) parts.push('open');
  else if (item.open === false) parts.push('closed');
  if (item.onOldVersion) parts.push('previous version, does not count now');
  else if (!item.valid) parts.push('no longer valid');
  else if (item.contributes) parts.push('counts for this version');
  return parts.join(' · ');
}

export type EvidenceRow = { key: string; at: string; when: string; what: string; meta: string };

export function evidenceRows(evidence: readonly EvidenceDto[]): EvidenceRow[] {
  return evidence.map((item) => ({
    key: `${item.kind}:${item.id}`,
    at: item.at,
    when: formatDate(new Date(item.at)),
    what: item.summary,
    meta: evidenceMeta(item),
  }));
}

export function whyModel(why: WhyDto) {
  return {
    label: why.label.label,
    labelText: labelMeta[why.label.label],
    version: `version ${why.versionLabel}`,
    meaning: why.meaning,
    evidence: evidenceRows(why.evidence),
    changeIt: why.changeIt,
    note: why.note,
  };
}

const teamsText = (count: PeopleCountDto) =>
  `${plural(count.people, 'person', 'people')} in ${plural(count.teams.length, 'team')}`;

export const HIDDEN_COUNTS_TEXT =
  'Hidden until you say whether you used or checked this section, so your answer isn’t swayed.';

/** F-03 *People who rely on it* and F-04 after-submit counts (D-168). */
export function peopleText(people: PeopleDto | undefined): string {
  if (!people || people.hidden) return HIDDEN_COUNTS_TEXT;
  const parts: string[] = [];
  if (people.checked?.people) parts.push(`${teamsText(people.checked)} checked this version`);
  if (people.used?.people) parts.push(`${teamsText(people.used)} used it in practice`);
  if (people.useful) parts.push(`${plural(people.useful, 'person', 'people')} found it useful`);
  const old = people.onOldVersion;
  if (old && old.checked + old.used > 0 && !people.checked?.people)
    parts.push(`${plural(old.checked + old.used, 'check')} on the previous version`);
  return parts.length ? `${parts.join(' · ')}.` : 'No one has said they rely on it.';
}

// ---------- forms ----------

export type CheckResult = S['CheckedDetailsInput']['result'];
export const CHECK_RESULTS: readonly { value: CheckResult; label: string; hint: string }[] = [
  {
    value: 'supports',
    label: 'It supports the text',
    hint: 'The section says what the source says',
  },
  { value: 'partly', label: 'Partly', hint: 'Some of it matches, some doesn’t' },
  {
    value: 'contradicts',
    label: 'It contradicts the text',
    hint: 'This also sends a report to the page authors',
  },
  {
    value: 'unverifiable',
    label: 'I couldn’t check',
    hint: 'Paywall, missing page, can’t find the passage',
  },
];

export type UseKind = S['UsedDetailsInput']['use'];
export const USE_KINDS: readonly { value: UseKind; label: string }[] = [
  { value: 'acquisition', label: 'Setting up an acquisition' },
  { value: 'analysis', label: 'Analysing or reporting data' },
  { value: 'training', label: 'Training someone' },
  { value: 'protocol', label: 'Writing a protocol or paper' },
  { value: 'other', label: 'Something else' },
];
export type Worked = S['UsedDetailsInput']['worked'];
export const WORKED: readonly { value: Worked; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'with_changes', label: 'With changes' },
  { value: 'no', label: 'No' },
];
export type ReportKind = ReportInput['kind'];
export const REPORT_KINDS: readonly { value: ReportKind; label: string }[] = [
  { value: 'wrong', label: 'Wrong' },
  { value: 'outdated', label: 'Outdated' },
  { value: 'unclear', label: 'Unclear' },
  { value: 'source', label: 'Missing or weak source' },
  { value: 'other', label: 'Something else' },
];

export type FormErrors = Partial<Record<string, string>>;
type Built<T> = { ok: true; input: T } | { ok: false; errors: FormErrors };

const OTHER_SOURCE = '';

export type CheckForm = {
  /** A cited ref, or '' for *Another source* (then `otherSource` is used). */
  source: string;
  otherSource: string;
  location: string;
  result: CheckResult;
  comparedNumbers: boolean;
  note: string;
};

export function emptyCheckForm(cited: readonly string[]): CheckForm {
  return {
    source: cited[0] ?? OTHER_SOURCE,
    otherSource: '',
    location: '',
    result: 'supports',
    comparedNumbers: false,
    note: '',
  };
}

function base(section: SectionTarget, sawCounts: boolean) {
  return {
    path: section.path,
    anchor: section.anchor,
    sectionHash: section.sectionHash,
    sawCounts,
  };
}

export function checkInput(
  form: CheckForm,
  section: SectionTarget,
  sawCounts: boolean,
): Built<AttestationInput> {
  const cited = form.source !== OTHER_SOURCE;
  const ref = (cited ? form.source : form.otherSource).trim();
  const location = form.location.trim();
  const note = form.note.trim();
  const errors: FormErrors = {};
  if (!ref) errors.source = 'Name the source you checked.';
  else if (ref.length > 500) errors.source = 'Use at most 500 characters.';
  if (!location) errors.location = 'Say where in the source.';
  else if (location.length > 200) errors.location = 'Use at most 200 characters.';
  if (note.length > 2000) errors.note = 'Use at most 2000 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      ...base(section, sawCounts),
      kind: 'checked',
      ...(note && { note }),
      checked: {
        source: { ref, cited },
        location,
        result: form.result,
        comparedNumbers: form.comparedNumbers,
      },
    },
  };
}

export type UseForm = { use: UseKind; worked: Worked; change: string; note: string };
export const emptyUseForm: UseForm = { use: 'acquisition', worked: 'yes', change: '', note: '' };

export function usedInput(
  form: UseForm,
  section: SectionTarget,
  sawCounts: boolean,
): Built<AttestationInput> {
  const change = form.change.trim();
  const errors: FormErrors = {};
  if (form.worked !== 'yes' && !change) errors.change = 'Say what you had to change.';
  else if (change.length > 2000) errors.change = 'Use at most 2000 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      ...base(section, sawCounts),
      kind: 'used',
      used: { use: form.use, worked: form.worked, ...(form.worked !== 'yes' && { change }) },
    },
  };
}

export function usefulInput(section: SectionTarget, sawCounts: boolean): AttestationInput {
  return { ...base(section, sawCounts), kind: 'useful' };
}

export type ReportForm = {
  kind: ReportKind;
  quote: string;
  suggestion: string;
  blocking: boolean;
};
export const emptyReportForm = (quote = ''): ReportForm => ({
  kind: 'wrong',
  quote,
  suggestion: '',
  blocking: false,
});

export function reportInput(
  form: ReportForm,
  section: SectionTarget,
  sawCounts: boolean,
): Built<ReportInput> {
  const quote = form.quote.trim();
  const suggestion = form.suggestion.trim();
  const errors: FormErrors = {};
  if (quote.length > 2000) errors.quote = 'Use at most 2000 characters.';
  if (!suggestion) errors.suggestion = 'Say what it should say, and how you know.';
  else if (suggestion.length > 4000) errors.suggestion = 'Use at most 4000 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      ...base(section, sawCounts),
      kind: form.kind,
      ...(quote && { quote }),
      suggestion,
      blocking: form.blocking,
    },
  };
}

export function checkSubmitLabel(result: CheckResult) {
  return result === 'contradicts' ? 'Save check and send report' : 'Save source check';
}

// ---------- after submit ----------

export type DoneModel = { title: string; text: string; next: string[]; counts: string };

export function doneModel(
  mode: Exclude<TrustMode, 'why'>,
  result: AttestationResultDto,
  sectionTitle: string,
  maintainers: readonly string[],
): DoneModel {
  const counts = peopleText(result.people);
  if (mode === 'check')
    return {
      title: 'Source check saved',
      text: result.report
        ? 'Because it contradicts the text, the page authors got a report too.'
        : `It counts for this version of ${sectionTitle}.`,
      next: [
        'It shows in the evidence for this section straight away.',
        'If the section is edited, you’ll be asked to check again.',
        'Checks from different teams carry more weight than several from one team.',
      ],
      counts,
    };
  if (mode === 'use')
    return {
      title: 'Thanks, saved for your team',
      text: 'Readers will see that your team used this section.',
      next: [
        'You’ll be told if this section changes or goes under re-check.',
        'If it stops matching what you do, report it from here.',
      ],
      counts,
    };
  return {
    title: maintainers.length
      ? `Report sent to ${new Intl.ListFormat('en-GB').format(maintainers)}`
      : 'Report sent to the page authors',
    text: 'The section keeps its label until a page author confirms the problem.',
    next: [
      'The page authors confirm or dismiss it, with a reason. You’ll be told either way.',
      'If confirmed, everyone sees Under re-check on this section until it is fixed.',
      'You can follow the fix from your activity.',
    ],
    counts,
  };
}

/** Undo = withdraw within 10 minutes (`undoUntil`, §7.7.6). */
export function canUndo(attestation: Pick<AttestationDto, 'undoUntil' | 'state'>, now: Date) {
  return (
    now.getTime() < new Date(attestation.undoUntil).getTime() &&
    (attestation.state === 'active' ||
      attestation.state === 'open' ||
      attestation.state === 'downweighted')
  );
}

/** The viewer's active *Useful* on this hash, if any (to show the toggle pressed). */
export function activeUseful(people: PeopleDto | undefined) {
  return people?.mine.find((item) => item.kind === 'useful' && item.state === 'active') ?? null;
}

// ---------- page feedback (F-03) ----------

export type FeedbackAnswer = S['PageFeedbackInput']['answer'];
export const FEEDBACK_ANSWERS: readonly { value: FeedbackAnswer; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'partly', label: 'Partly' },
  { value: 'no', label: 'No' },
];
export function feedbackQuestion(answer: FeedbackAnswer | null) {
  switch (answer) {
    case 'yes':
      return 'Thanks. Counted for your team.';
    case 'partly':
      return 'Thanks. What was missing? Report it on the section.';
    case 'no':
      return 'Sorry. Report the section that let you down so it gets fixed.';
    default:
      return 'Did this page help with your work?';
  }
}

/** Cited refs offered as choices in *Which source did you check?* (domain rule, §7.7.5). */
export function citedChoices(sectionMarkdown: string) {
  return citedSources(sectionMarkdown).map((ref) => ({
    value: ref,
    label: ref.replace(/^(doi|url):/, ''),
  }));
}
