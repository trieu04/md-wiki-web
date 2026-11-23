import { parseStatusBlock } from './status-block.js';
import { splitSections } from './sections.js';
import { globMatch } from './page-authors.js';

/**
 * Mandatory escalation triggers (system-logic §7.8.3, architecture.md › Self-managed review).
 * Evaluated by the API inside the decision transaction before it accepts an agent approval; any
 * firing trigger refuses the approval with ESCALATION_REQUIRED. Triggers only add scrutiny: the
 * owner can add custom ones and turn off only `agent_edits_human_pages` (D-202). Pure.
 */

export const DEFAULT_TRIGGERS = [
  'dispute_or_report',
  'quality_blocking',
  'quality_missing',
  'dropped_hedge',
  'checked_section',
  'sourced_meaning',
  'source_problem',
  'contradiction',
  'wiki_meta',
  'agent_edits_human_pages',
] as const;
export type DefaultTrigger = (typeof DEFAULT_TRIGGERS)[number];
/** The only default the owner may turn off (plan.md › Open decisions). */
export const OPTIONAL_TRIGGERS: readonly DefaultTrigger[] = ['agent_edits_human_pages'];
/** What an agent cites when it escalates on its own judgement. */
export const JUDGEMENT_TRIGGER = 'judgement';

export const TRIGGER_TEXT: Record<DefaultTrigger, { title: string; description: string }> = {
  dispute_or_report: {
    title: 'Dispute, hold or open report',
    description: 'An open dispute, discussion hold or unresolved report on a touched section.',
  },
  quality_blocking: {
    title: 'Blocking quality finding',
    description: 'The current quality check has a blocking finding.',
  },
  quality_missing: {
    title: 'No quality result',
    description: 'No succeeded quality check for this bundle (failed or never ran).',
  },
  dropped_hedge: {
    title: 'Dropped hedge',
    description: 'The change restates a hedged sentence without its hedge.',
  },
  checked_section: {
    title: 'Checked section changed',
    description: 'Removes or rewrites a section labelled Checked against source.',
  },
  sourced_meaning: {
    title: 'Sourced meaning changed',
    description:
      'Removes sourced content, or changes a number, unit or negation in a sourced sentence.',
  },
  source_problem: {
    title: 'Source problem',
    description: 'A cited source is retracted, or a low-tier source is added.',
  },
  contradiction: {
    title: 'Contradiction',
    description: 'A confirmed or candidate contradiction with another page.',
  },
  wiki_meta: {
    title: 'wiki-meta page',
    description: 'The page is in wiki-meta/ (owners, source tiers, topics).',
  },
  agent_edits_human_pages: {
    title: 'Agent edit of a human page',
    description: 'An agent changes a page with human authors, and the change is not cosmetic.',
  },
};

export type CustomTriggerKind = 'path' | 'term';
export interface CustomTrigger {
  /** `^[a-z][a-z0-9-]{0,39}$`; exposed as `custom:<id>`. */
  id: string;
  kind: CustomTriggerKind;
  /** A path glob (`*`, `**`) or a term that the change adds (case-blind). */
  value: string;
  reason: string;
}
export const CUSTOM_TRIGGER_ID = /^[a-z][a-z0-9-]{0,39}$/;
export const customTriggerId = (id: string) => `custom:${id}`;

export interface TriggerConfig {
  agentEditsHumanPages: boolean;
  custom: readonly CustomTrigger[];
}
export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = { agentEditsHumanPages: true, custom: [] };

export interface TriggerFacts {
  targetPath: string;
  submitterKind: 'human' | 'agent';
  /** Stored base file (status block allowed) or null for a create. */
  base: string | null;
  proposed: string;
  /** DiscussionState.disputed (hold or open dispute). */
  disputed: boolean;
  /** Unresolved reports on touched sections (Phase 9; 0 before). */
  openReports: number;
  quality: { current: boolean; blocking: number; ruleFindings: number };
  /** Anchors of the base version labelled `checked` (Phase 9; [] before). */
  checkedAnchors: readonly string[];
  sourceProblems: { retracted: readonly string[]; lowTierAdded: readonly string[] };
  /** Confirmed or candidate contradictions with other pages (Phase 9; 0 before). */
  contradictions: number;
  /** Human page authors from owners.md or published proposals (not the owner fallback). */
  humanAuthors: number;
}

export interface FiredTrigger {
  id: string;
  detail: string;
}

const bodyOf = (md: string | null) => (md === null ? '' : parseStatusBlock(md).body);

/** Anchors of the base whose section is removed or rewritten by the proposal. */
export function touchedSections(base: string | null, proposed: string): string[] {
  if (base === null) return [];
  const after = new Map(splitSections(proposed).map((s) => [s.anchor, s.hash]));
  return splitSections(base)
    .filter((s) => after.get(s.anchor) !== s.hash)
    .map((s) => s.anchor);
}

// ---- sourced sentences ---------------------------------------------------------------------

const LINK = /\[[^\]]*\]\([^)]+\)|\[\^[^\]]+\]|\[\[[^\]]+\]\]|https?:\/\/\S+|\bdoi:\s*\S+/i;
const NEGATION = new Set([
  'not',
  'no',
  'never',
  'none',
  'nor',
  'neither',
  'cannot',
  "can't",
  "don't",
  "doesn't",
  "didn't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "won't",
  "shouldn't",
  "mustn't",
  'without',
  'không',
  'đừng',
  'chưa',
  'chẳng',
]);
const NUMBER = /(\d+(?:[.,]\d+)*)\s*(%|°[cf]?|[a-zµμ]+(?:\/[a-zµμ]+)?)?/giu;

/** Split prose into sentences (lines first, then terminal punctuation). */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/, '').trim();
    if (!stripped) continue;
    for (const part of stripped.split(/(?<=[.!?])\s+(?=\S)/u)) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}
const isSourced = (s: string) => LINK.test(s);
const normalise = (s: string) => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
function words(s: string): Set<string> {
  return new Set(
    normalise(s)
      .toLowerCase()
      .replace(/\[[^\]]*\]\([^)]+\)/g, (m) => m.replace(/\([^)]+\)$/, ''))
      .split(/[^\p{L}\p{N}']+/u)
      .filter((w) => w.length > 0),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}
/** Number + unit pairs in order of appearance (`5 mg` ≠ `5 g`; `4,5` ≠ `6`). */
export function quantities(s: string): string[] {
  const text = s.replace(/\[[^\]]*\]\(([^)]+)\)/g, (m) => m.replace(/\([^)]+\)$/, ''));
  return [...text.matchAll(NUMBER)].map(
    (m) => `${m[1] ?? ''}${m[2] ? ` ${m[2].toLowerCase()}` : ''}`,
  );
}
const negations = (s: string) => [...words(s)].filter((w) => NEGATION.has(w)).length;
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export interface MeaningChange {
  original: string;
  derived: string | null;
  kinds: ('removed' | 'number' | 'unit' | 'negation')[];
}

/** Similarity at which a proposed sentence counts as a rewrite of a base sentence. */
export const REWRITE_SIMILARITY = 0.5;

/**
 * Meaning-changing edits to sourced sentences (D-204): a base sentence with a citation (link,
 * footnote, wiki link, URL or DOI) that is gone without a rewrite (best proposed sentence with
 * word Jaccard ≥ 0.5) is `removed`; a rewrite that changes the numbers, units or negations of the
 * sentence is reported with those kinds. Sentences kept verbatim are never reported.
 */
export function sourcedMeaningChanges(base: string | null, proposed: string): MeaningChange[] {
  if (base === null) return [];
  const before = sentences(bodyOf(base)).filter(isSourced);
  if (!before.length) return [];
  const after = sentences(bodyOf(proposed));
  const kept = new Set(after.map(normalise));
  const out: MeaningChange[] = [];
  for (const original of before) {
    if (kept.has(normalise(original))) continue;
    const ws = words(original);
    let best: { s: string; sim: number } | null = null;
    for (const s of after) {
      const sim = jaccard(ws, words(s));
      if (!best || sim > best.sim) best = { s, sim };
    }
    if (!best || best.sim < REWRITE_SIMILARITY) {
      out.push({ original, derived: null, kinds: ['removed'] });
      continue;
    }
    const kinds: MeaningChange['kinds'] = [];
    const [qa, qb] = [quantities(original), quantities(best.s)];
    const numbers = (q: string[]) => q.map((x) => x.split(' ')[0] ?? '');
    const units = (q: string[]) => q.map((x) => x.split(' ')[1] ?? '');
    if (!sameList(numbers(qa), numbers(qb))) kinds.push('number');
    else if (!sameList(units(qa), units(qb))) kinds.push('unit');
    if (negations(original) !== negations(best.s)) kinds.push('negation');
    if (kinds.length) out.push({ original, derived: best.s, kinds });
  }
  return out;
}

/**
 * A cosmetic change (D-204): equal after NFC, case folding, dropping Markdown emphasis/code
 * markers and punctuation, and collapsing whitespace. Anything else is substantive.
 */
export function isCosmeticChange(base: string | null, proposed: string): boolean {
  if (base === null) return false;
  const flat = (md: string) =>
    bodyOf(md)
      .normalize('NFC')
      .toLowerCase()
      .replace(/[*_`~]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  return flat(base) === flat(proposed);
}

function countTerm(text: string, term: string): number {
  const hay = text.normalize('NFC').toLowerCase();
  const needle = term.normalize('NFC').toLowerCase();
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Every firing trigger, in catalog order, then custom triggers in configured order. */
export function evaluateTriggers(facts: TriggerFacts, config: TriggerConfig): FiredTrigger[] {
  const fired: FiredTrigger[] = [];
  const fire = (id: string, detail: string) => fired.push({ id, detail });
  if (facts.disputed || facts.openReports > 0)
    fire(
      'dispute_or_report',
      facts.disputed
        ? 'An open dispute or discussion holds the proposal'
        : `${String(facts.openReports)} open report(s) on touched sections`,
    );
  if (facts.quality.current && facts.quality.blocking > 0)
    fire('quality_blocking', `${String(facts.quality.blocking)} blocking finding(s)`);
  if (!facts.quality.current) fire('quality_missing', 'No succeeded quality check for this bundle');
  if (facts.quality.current && facts.quality.ruleFindings > 0)
    fire('dropped_hedge', `${String(facts.quality.ruleFindings)} dropped hedge(s)`);
  const touched = touchedSections(facts.base, facts.proposed);
  const checked = touched.filter((a) => facts.checkedAnchors.includes(a));
  if (checked.length) fire('checked_section', `Checked sections changed: ${checked.join(', ')}`);
  const meaning = sourcedMeaningChanges(facts.base, facts.proposed);
  if (meaning.length)
    fire(
      'sourced_meaning',
      meaning
        .slice(0, 3)
        .map((m) => `${m.kinds.join('+')}: “${m.original.slice(0, 120)}”`)
        .join('; '),
    );
  const { retracted, lowTierAdded } = facts.sourceProblems;
  if (retracted.length || lowTierAdded.length)
    fire(
      'source_problem',
      [
        ...retracted.map((s) => `retracted: ${s}`),
        ...lowTierAdded.map((s) => `low tier added: ${s}`),
      ].join('; '),
    );
  if (facts.contradictions > 0)
    fire('contradiction', `${String(facts.contradictions)} contradiction(s) with other pages`);
  if (facts.targetPath === 'wiki-meta' || facts.targetPath.startsWith('wiki-meta/'))
    fire('wiki_meta', 'The page is in wiki-meta/');
  if (
    config.agentEditsHumanPages &&
    facts.submitterKind === 'agent' &&
    facts.humanAuthors > 0 &&
    !isCosmeticChange(facts.base, facts.proposed)
  )
    fire('agent_edits_human_pages', 'An agent changes a page with human authors');
  for (const c of config.custom) {
    if (c.kind === 'path' && globMatch(c.value, facts.targetPath))
      fire(customTriggerId(c.id), c.reason);
    if (
      c.kind === 'term' &&
      countTerm(bodyOf(facts.proposed), c.value) > countTerm(bodyOf(facts.base), c.value)
    )
      fire(customTriggerId(c.id), c.reason);
  }
  return fired;
}

/** Ids an escalation may cite: every default, every configured custom trigger, `judgement`. */
export function knownTriggerIds(config: TriggerConfig): Set<string> {
  return new Set<string>([
    ...DEFAULT_TRIGGERS,
    JUDGEMENT_TRIGGER,
    ...config.custom.map((c) => customTriggerId(c.id)),
  ]);
}

/**
 * Validate the owner's trigger settings (D-202): unique custom ids, non-empty values, valid
 * globs. Returns the first problem (field + message) or null.
 */
export function checkTriggerConfig(
  custom: readonly CustomTrigger[],
): { index: number; field: 'id' | 'value'; message: string } | null {
  const seen = new Set<string>();
  for (const [index, c] of custom.entries()) {
    if (!CUSTOM_TRIGGER_ID.test(c.id))
      return { index, field: 'id', message: 'Lowercase letters, digits and dashes' };
    if (seen.has(c.id)) return { index, field: 'id', message: 'Duplicate trigger id' };
    seen.add(c.id);
    if (!c.value.trim()) return { index, field: 'value', message: 'Empty value' };
    if (c.kind === 'path' && /[^a-z0-9_\-./*]/.test(c.value))
      return { index, field: 'value', message: 'A path glob uses a-z 0-9 _ - . / * only' };
  }
  return null;
}
