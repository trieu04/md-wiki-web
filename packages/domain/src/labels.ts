// Best to worst (also the page aggregation order).
export const LABEL_ORDER = ['checked', 'reviewed', 'not_reviewed', 'recheck', 'error'] as const;
export type Label = (typeof LABEL_ORDER)[number];

/** An empty search selection is unrestricted; recheck results always remain visible. */
export function matchesLabelSelection(label: Label, selected: ReadonlySet<Label>): boolean {
  return selected.size === 0 || selected.has(label) || label === 'recheck';
}

export type ReviewerKind = 'person' | 'agent';
export interface LabelDto {
  label: Label;
  since: string | null;
  reviewerKind: ReviewerKind | null;
  reason: string | null;
}

interface Evidence {
  id: string;
  sectionHash: string;
  time: string; // ISO-8601 UTC, per system-logic §2
}
interface AttributedEvidence extends Evidence {
  kind: ReviewerKind;
}
interface Issue extends AttributedEvidence {
  reason: string;
}
interface ReviewedVersion extends AttributedEvidence {
  reason?: 'source not checkable';
}
interface SourceCheck extends Evidence {
  checkerKind: ReviewerKind;
  result: 'supported' | 'not_supported' | 'unverifiable';
  valid: boolean;
}

/**
 * Rule 4's calibrated threshold (system-logic §7.7.2, gate `label_threshold`). Off by default; when
 * on, a computed score must reach θ (θ − hysteresis while the section is already checked). A
 * missing score (`p: null`) leaves rule 4 evidence-only: a lagging score never makes a label false.
 */
export interface LabelThreshold {
  enabled: boolean;
  theta: number;
  hysteresis: number;
  p: number | null;
  previous: Label | null;
}

/** Evidence for one (path, anchor). Reviewed versions are published; issue lists contain only still-open issues. */
export interface SectionLabelInput {
  currentHash: string;
  confirmedErrors: readonly Issue[];
  openRecheckReasons: readonly Issue[];
  reviewedVersions: readonly ReviewedVersion[];
  sourceChecks: readonly SourceCheck[];
  ownerConfirmations: readonly (AttributedEvidence & { valid: boolean })[];
  threshold?: LabelThreshold;
}

export function meetsThreshold(threshold: LabelThreshold | undefined): boolean {
  if (!threshold?.enabled || threshold.p === null) return true;
  const floor =
    threshold.previous === 'checked' ? threshold.theta - threshold.hysteresis : threshold.theta;
  return threshold.p >= floor;
}

// Compare UTC instants, not timestamp spelling (fractional precision can vary).
function timeKey(time: string): string {
  const [seconds = '', fraction = ''] = time.slice(0, -1).split('.');
  return `${seconds}.${fraction.replace(/0+$/, '')}`;
}

function pick<T extends AttributedEvidence>(
  records: readonly T[],
  hash: string,
  order: 'earliest' | 'latest',
): T | undefined {
  let best: T | undefined;
  let bestTime = '';
  for (const record of records) {
    if (record.sectionHash !== hash) continue;
    const time = timeKey(record.time);
    if (
      !best ||
      (order === 'earliest' ? time < bestTime : time > bestTime) ||
      (time === bestTime &&
        (record.kind !== best.kind ? record.kind === 'person' : record.id < best.id))
    ) {
      best = record;
      bestTime = time;
    }
  }
  return best;
}

export function computeSectionLabel(input: SectionLabelInput): LabelDto {
  const hash = input.currentHash;
  for (const [label, issues] of [
    ['error', input.confirmedErrors],
    ['recheck', input.openRecheckReasons],
  ] as const) {
    const issue = pick(issues, hash, 'earliest');
    if (issue) return { label, since: issue.time, reviewerKind: null, reason: issue.reason };
  }

  const review = pick(input.reviewedVersions, hash, 'latest');
  if (!review) return { label: 'not_reviewed', since: null, reviewerKind: null, reason: null };

  const checked = pick(
    [
      ...input.sourceChecks
        .filter((c) => c.valid && c.result === 'supported' && c.checkerKind === 'person')
        .map((c) => ({ ...c, kind: c.checkerKind })),
      ...input.ownerConfirmations.filter((c) => c.valid),
    ],
    hash,
    'latest',
  );
  if (checked && meetsThreshold(input.threshold))
    return { label: 'checked', since: checked.time, reviewerKind: checked.kind, reason: null };
  return {
    label: 'reviewed',
    since: review.time,
    reviewerKind: review.kind,
    reason: review.reason ?? null,
  };
}

export function pageLabel(sections: readonly LabelDto[]): {
  label: Label;
  spread: Record<Label, number>;
} {
  const spread = { checked: 0, reviewed: 0, not_reviewed: 0, recheck: 0, error: 0 };
  let worst: Label = sections.length ? 'checked' : 'not_reviewed';
  for (const { label } of sections) {
    spread[label]++;
    if (LABEL_ORDER.indexOf(label) > LABEL_ORDER.indexOf(worst)) worst = label;
  }
  return { label: worst, spread };
}
