import { describe, expect, it } from 'vitest';
import {
  checkTriggerConfig,
  DEFAULT_TRIGGER_CONFIG,
  DEFAULT_TRIGGERS,
  evaluateTriggers,
  isCosmeticChange,
  knownTriggerIds,
  OPTIONAL_TRIGGERS,
  quantities,
  sentences,
  sourcedMeaningChanges,
  touchedSections,
  TRIGGER_TEXT,
  type TriggerFacts,
} from '../src/index.js';

const BASE =
  '# Lens\n\nThe objective resolves 200 nm [ref](sources/a.md).\n\n## Detectors\n\nPMT detectors are used.\n';
const facts = (over: Partial<TriggerFacts> = {}): TriggerFacts => ({
  targetPath: 'imaging/lens.md',
  submitterKind: 'human',
  base: BASE,
  proposed: BASE.replace('PMT detectors are used.', 'PMT detectors are used daily.'),
  disputed: false,
  openReports: 0,
  quality: { current: true, blocking: 0, ruleFindings: 0 },
  checkedAnchors: [],
  sourceProblems: { retracted: [], lowTierAdded: [] },
  contradictions: 0,
  humanAuthors: 0,
  ...over,
});
const ids = (f: TriggerFacts, config = DEFAULT_TRIGGER_CONFIG) =>
  evaluateTriggers(f, config).map((t) => t.id);

describe('trigger catalog', () => {
  it('describes every default and allows turning off only the agent-edit trigger', () => {
    for (const id of DEFAULT_TRIGGERS) expect(TRIGGER_TEXT[id].title).toBeTruthy();
    expect(OPTIONAL_TRIGGERS).toEqual(['agent_edits_human_pages']);
    expect(knownTriggerIds({ agentEditsHumanPages: false, custom: [] }).has('wiki_meta')).toBe(
      true,
    );
  });
  it('fires nothing for a clean human edit of an unsourced sentence', () => {
    expect(ids(facts())).toEqual([]);
  });
});

describe('each mandatory trigger', () => {
  it('dispute, hold or report', () => {
    expect(ids(facts({ disputed: true }))).toEqual(['dispute_or_report']);
    expect(evaluateTriggers(facts({ openReports: 2 }), DEFAULT_TRIGGER_CONFIG)[0]?.detail).toBe(
      '2 open report(s) on touched sections',
    );
  });
  it('quality: blocking finding, missing result, dropped hedge', () => {
    expect(ids(facts({ quality: { current: true, blocking: 1, ruleFindings: 0 } }))).toEqual([
      'quality_blocking',
    ]);
    expect(ids(facts({ quality: { current: false, blocking: 0, ruleFindings: 0 } }))).toEqual([
      'quality_missing',
    ]);
    expect(ids(facts({ quality: { current: true, blocking: 0, ruleFindings: 2 } }))).toEqual([
      'dropped_hedge',
    ]);
    // a stale run's counts never count: no current run → only quality_missing
    expect(ids(facts({ quality: { current: false, blocking: 3, ruleFindings: 1 } }))).toEqual([
      'quality_missing',
    ]);
  });
  it('checked section removed or rewritten', () => {
    expect(ids(facts({ checkedAnchors: ['detectors'] }))).toEqual(['checked_section']);
    expect(ids(facts({ checkedAnchors: ['lens'] }))).toEqual([]);
    const removed = facts({ checkedAnchors: ['detectors'], proposed: '# Lens\n\nOnly lead.\n' });
    expect(ids(removed)).toContain('checked_section');
  });
  it('sourced meaning: number, unit, negation, removal', () => {
    const number = facts({ proposed: BASE.replace('200 nm', '250 nm') });
    expect(ids(number)).toEqual(['sourced_meaning']);
    const unit = facts({ proposed: BASE.replace('200 nm', '200 µm') });
    expect(ids(unit)).toEqual(['sourced_meaning']);
    const negation = facts({
      proposed: BASE.replace('The objective resolves', 'The objective does not resolve'),
    });
    expect(ids(negation)).toEqual(['sourced_meaning']);
    const removal = facts({
      proposed: '# Lens\n\nSomething else entirely.\n\n## Detectors\n\nPMT detectors are used.\n',
    });
    expect(ids(removal)).toEqual(['sourced_meaning']);
  });
  it('source problems and contradictions', () => {
    expect(ids(facts({ sourceProblems: { retracted: ['10.1/x'], lowTierAdded: [] } }))).toEqual([
      'source_problem',
    ]);
    expect(ids(facts({ sourceProblems: { retracted: [], lowTierAdded: ['blog.md'] } }))).toEqual([
      'source_problem',
    ]);
    expect(ids(facts({ contradictions: 1 }))).toEqual(['contradiction']);
  });
  it('wiki-meta pages', () => {
    expect(ids(facts({ targetPath: 'wiki-meta/owners.md' }))).toEqual(['wiki_meta']);
    expect(ids(facts({ targetPath: 'wiki-metadata/x.md' }))).toEqual([]);
  });
  it('agent edits a human page unless cosmetic; owner may turn it off', () => {
    const agent = facts({ submitterKind: 'agent', humanAuthors: 1 });
    expect(ids(agent)).toEqual(['agent_edits_human_pages']);
    expect(ids(agent, { agentEditsHumanPages: false, custom: [] })).toEqual([]);
    expect(ids(facts({ submitterKind: 'agent', humanAuthors: 0 }))).toEqual([]);
    const cosmetic = facts({
      submitterKind: 'agent',
      humanAuthors: 2,
      proposed: BASE.replace('PMT detectors are used.', 'PMT  detectors are *used*'),
    });
    expect(ids(cosmetic)).toEqual([]);
    // a new page by an agent is never cosmetic
    expect(ids(facts({ submitterKind: 'agent', humanAuthors: 1, base: null }))).toEqual([
      'agent_edits_human_pages',
    ]);
  });
  it('custom triggers add scrutiny: path globs and added terms', () => {
    const config = {
      agentEditsHumanPages: true,
      custom: [
        { id: 'protocols', kind: 'path' as const, value: 'imaging/**', reason: 'Imaging core' },
        { id: 'dose', kind: 'term' as const, value: 'Dose', reason: 'Dosing' },
      ],
    };
    expect(ids(facts(), config)).toEqual(['custom:protocols']);
    const dose = facts({ proposed: BASE + '\nThe dose is 5 mg.\n', targetPath: 'other.md' });
    expect(ids(dose, config)).toEqual(['custom:dose']);
    // a term that was already there and stays is not "added"
    const kept = facts({ base: BASE + 'dose\n', proposed: BASE + 'dose\n', targetPath: 'o.md' });
    expect(ids(kept, config)).toEqual([]);
    expect(knownTriggerIds(config).has('custom:dose')).toBe(true);
  });
  it('fires several triggers in catalog order', () => {
    const many = facts({
      targetPath: 'wiki-meta/topics.md',
      quality: { current: true, blocking: 1, ruleFindings: 1 },
      proposed: BASE.replace('200 nm', '300 nm'),
    });
    expect(ids(many)).toEqual(['quality_blocking', 'dropped_hedge', 'sourced_meaning', 'wiki_meta']);
  });
});

describe('heuristics', () => {
  it('splits sentences per line and on terminal punctuation', () => {
    expect(sentences('- One. Two!\n\n## Three\nFour')).toEqual(['One.', 'Two!', 'Three', 'Four']);
  });
  it('reads numbers with units, ignoring link targets', () => {
    expect(quantities('Use 4,5 h or 200 nm [x](a-2.md) at 37 °C and 5%')).toEqual([
      '4,5 h',
      '200 nm',
      '37 °c',
      '5 %',
    ]);
  });
  it('ignores unsourced sentences and verbatim kept sourced ones', () => {
    expect(sourcedMeaningChanges(BASE, BASE)).toEqual([]);
    expect(sourcedMeaningChanges(null, BASE)).toEqual([]);
    const unsourced = '# A\n\nThe value is 5.\n';
    expect(sourcedMeaningChanges(unsourced, unsourced.replace('5', '6'))).toEqual([]);
  });
  it('treats footnotes, wiki links, URLs and DOIs as citations', () => {
    for (const cite of ['[^1]', '[[Other page]]', 'https://x.org/a', 'doi:10.1/abc']) {
      const base = `# A\n\nIt takes 5 days ${cite}.\n`;
      expect(sourcedMeaningChanges(base, base.replace('5 days', '7 days'))).toHaveLength(1);
    }
  });
  it('touched sections: changed or removed anchors of the base', () => {
    expect(touchedSections(BASE, BASE)).toEqual([]);
    expect(touchedSections(BASE, BASE.replace('used.', 'used!'))).toEqual(['detectors']);
    expect(touchedSections(null, BASE)).toEqual([]);
  });
  it('cosmetic: case, emphasis, punctuation and whitespace only', () => {
    expect(isCosmeticChange('# A\n\nHello world.\n', '# a\n\nHello   **world**\n')).toBe(true);
    expect(isCosmeticChange('# A\n\nHello world.\n', '# A\n\nHello there.\n')).toBe(false);
    expect(isCosmeticChange(null, 'x')).toBe(false);
    // a status block in the stored base is not content
    expect(
      isCosmeticChange(
        '<!-- md-wiki:status\nproposal: p\ndecision: 00000000-0000-8000-8000-000000000001\nreviewer: agent\ndecided_at: 2026-01-01T00:00:00Z\n-->\n\n# A\n',
        '# A\n',
      ),
    ).toBe(true);
  });
});

describe('owner trigger settings', () => {
  it('rejects bad ids, duplicates, empty values and bad globs', () => {
    const t = (over: object) => ({ id: 'a', kind: 'path' as const, value: 'x/**', reason: 'r', ...over });
    expect(checkTriggerConfig([t({})])).toBeNull();
    expect(checkTriggerConfig([t({ id: 'Bad' })])?.field).toBe('id');
    expect(checkTriggerConfig([t({}), t({})])?.message).toBe('Duplicate trigger id');
    expect(checkTriggerConfig([t({ value: ' ' })])?.field).toBe('value');
    expect(checkTriggerConfig([t({ value: 'a b' })])?.field).toBe('value');
    expect(checkTriggerConfig([t({ kind: 'term', value: 'a b' })])).toBeNull();
  });
});
