import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeSectionLabel,
  contradictionApplies,
  labelInputFromEvidence,
  provenanceGroups,
  scoreGraph,
  type ScoreGraph,
  type ScoreNode,
  type SectionEvidence,
} from '../src/index.js';

/**
 * E8a invariants (architecture.md › Invariants tested in CI; page-credibility.md §5.5, §5.7),
 * over the shadow reference model and the label engine (system-logic §7.7.11).
 */

const H = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const node = (key: string, over: Partial<ScoreNode> = {}): ScoreNode => ({
  key,
  currentHash: H,
  reviews: [{ sectionHash: H }],
  sourceChecks: [],
  ownerConfirmations: [],
  errors: [],
  attestations: [],
  ...over,
});
const supported = (ref: string, sectionHash = H) => ({
  sectionHash,
  checkerKind: 'person' as const,
  result: 'supported' as const,
  sourceRef: ref,
});
const graph = (nodes: ScoreNode[], over: Partial<ScoreGraph> = {}): ScoreGraph => ({
  nodes,
  derivations: [],
  corroborations: [],
  contradictions: [],
  links: [],
  retractedRefs: [],
  wrongRoots: [],
  ...over,
});
const strongA = node('A', { sourceChecks: [supported('doi:10.1/x'), supported('doi:10.2/y')] });

const evidence = (over: Partial<SectionEvidence> = {}): SectionEvidence => ({
  currentHash: H,
  reviews: [{ id: 'r', sectionHash: H, time: '2026-11-01T00:00:00.000Z', kind: 'agent' }],
  sourceChecks: [],
  ownerConfirmations: [],
  errors: [],
  flags: [],
  invalidations: [],
  clearedRetractions: new Set(),
  citedRefs: [],
  onHoldTopics: [],
  contradictions: [],
  ...over,
});
const label = (e: SectionEvidence) => computeSectionLabel(labelInputFromEvidence(e)).label;

describe('E8a: copy laundering', () => {
  it('ten copies of A, declared or not, leave A unchanged', () => {
    const alone = scoreGraph(graph([strongA])).get('A');
    const copies = Array.from({ length: 10 }, (_, i) => node(`C${String(i)}`));
    const withCopies = scoreGraph(
      graph([strongA, ...copies], {
        // five declared sources, five confirmed copy edges: both are derivations A → C
        derivations: copies.map((c) => ({ from: 'A', to: c.key })),
      }),
    ).get('A');
    expect(withCopies).toEqual(alone);
  });
  it('a copy never rises above A from A alone', () => {
    const weak = node('A');
    const scores = scoreGraph(graph([weak, node('C', { reviews: [] })], { derivations: [{ from: 'A', to: 'C' }] }));
    expect(scores.get('C')?.p ?? 1).toBeLessThanOrEqual(scores.get('A')?.p ?? 0);
  });
});

describe('E8a: link stuffing', () => {
  it('a hundred inbound links leave A unchanged; only reach rises', () => {
    const linkers = Array.from({ length: 100 }, (_, i) => node(`L${String(i)}`));
    const before = scoreGraph(graph([strongA])).get('A');
    const after = scoreGraph(
      graph([strongA, ...linkers], { links: linkers.map((l) => ({ from: l.key, to: 'A' })) }),
    ).get('A');
    expect(after?.reach).toBe(100);
    expect({ ...after, reach: 0 }).toEqual({ ...before, reach: 0 });
  });
});

describe('E8a: weak contradiction', () => {
  it('a weak page contradicting a two-root section does not move it off Checked against source', () => {
    const weakB = node('B');
    const scores = scoreGraph(graph([strongA, weakB], { contradictions: [{ a: 'A', b: 'B' }] }));
    const alone = scoreGraph(graph([strongA])).get('A');
    // the strong side only loses 10 %; the weak side takes the doubt
    expect(scores.get('A')?.r).toBeCloseTo((alone?.r ?? 0) * 0.9);
    expect(scores.get('B')?.s ?? 0).toBeGreaterThan(0);
    // and at θ = 0.9 the strong side still clears the threshold
    expect(scores.get('A')?.p ?? 0).toBeGreaterThanOrEqual(0.9);

    const checks = strongA.sourceChecks.map((c, i) => ({
      ...c,
      id: `c${String(i)}`,
      time: '2026-11-02T00:00:00.000Z',
    }));
    const groupsA = provenanceGroups(checks, H, []);
    const applies = contradictionApplies(groupsA, 0);
    expect(groupsA).toBe(2);
    expect(
      label(
        evidence({
          sourceChecks: checks,
          contradictions: [{ id: 'k', time: '2026-11-03T00:00:00.000Z', applies }],
        }),
      ),
    ).toBe('checked');
    // the weak side goes under re-check
    expect(
      label(
        evidence({
          contradictions: [
            { id: 'k', time: '2026-11-03T00:00:00.000Z', applies: contradictionApplies(0, groupsA) },
          ],
        }),
      ),
    ).toBe('recheck');
  });
});

describe('E8a: suspicion propagation', () => {
  const chain = (over: Partial<ScoreGraph> = {}) =>
    scoreGraph(
      graph(
        [
          node('A', { sourceChecks: [supported('doi:10.1/x')] }),
          node('B'),
          node('C'),
          node('D'),
          node('Z'),
        ],
        {
          derivations: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
            { from: 'C', to: 'D' },
          ],
          ...over,
        },
      ),
    );
  it('a retracted root lowers A, lowers what B received, and flags every transitive descendant', () => {
    const before = chain();
    const after = chain({ retractedRefs: ['doi:10.1/x'] });
    expect(after.get('A')?.p ?? 1).toBeLessThan(before.get('A')?.p ?? 0);
    expect(after.get('B')?.received.r ?? 1).toBeLessThan(before.get('B')?.received.r ?? 0);
    expect(['A', 'B', 'C', 'D'].map((k) => after.get(k)?.flagged)).toEqual([true, true, true, true]);
    expect(after.get('Z')?.flagged).toBe(false);
  });
  it('a confirmed error lowers A and what B received; the score moves one step only', () => {
    const before = chain();
    const errored = scoreGraph(
      graph(
        [node('A', { sourceChecks: [supported('doi:10.1/x')], errors: [{ sectionHash: H }] }), node('B'), node('C')],
        {
          derivations: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
          ],
          wrongRoots: ['A'],
        },
      ),
    );
    expect(errored.get('A')?.p ?? 1).toBeLessThan(before.get('A')?.p ?? 0);
    expect(errored.get('B')?.received.s ?? 0).toBeGreaterThan(0);
    // C receives from B's own evidence only (one step), not from A through B
    expect(errored.get('C')?.received).toEqual(before.get('C')?.received);
    expect(errored.get('C')?.flagged).toBe(true);
  });
});

describe('E8a: no vote-only path to Checked against source', () => {
  it('no number of attestations, teams, feedback, links or copies gives rule 4', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom('checked' as const, 'used' as const, 'useful' as const),
            team: fc.constantFrom('T1', 'T2', 'T3', 'T4'),
            weight: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { maxLength: 60 },
        ),
        fc.integer({ min: 0, max: 50 }),
        fc.boolean(),
        (votes, links, agentCheck) => {
          const e = evidence({
            sourceChecks: agentCheck
              ? [
                  {
                    id: 'g',
                    sectionHash: H,
                    time: '2026-11-02T00:00:00.000Z',
                    checkerKind: 'agent',
                    result: 'supported',
                    sourceRef: 'doi:10.1/x',
                  },
                ]
              : [],
          });
          // attestations are not label inputs at all; the label is the same with or without them
          expect(label(e)).toBe('reviewed');
          const scores = scoreGraph(
            graph(
              [
                node('A', {
                  attestations: votes.map((v) => ({ ...v, sectionHash: H })),
                }),
                ...Array.from({ length: links }, (_, i) => node(`L${String(i)}`)),
              ],
              { links: Array.from({ length: links }, (_, i) => ({ from: `L${String(i)}`, to: 'A' })) },
            ),
          );
          // weights stay 0 while the gate is off: votes do not move the score either
          expect(scores.get('A')?.r).toBe(1);
        },
      ),
    );
  });
});

describe('E8a: hash change resets evidence', () => {
  it('evidence on an old hash contributes 0 to label and score', () => {
    const old = node('A', {
      reviews: [{ sectionHash: OLD }, { sectionHash: H }],
      sourceChecks: [supported('doi:10.1/x', OLD)],
      ownerConfirmations: [{ sectionHash: OLD }],
      errors: [{ sectionHash: OLD }],
      attestations: [{ sectionHash: OLD, kind: 'checked', team: 'T1', weight: 1 }],
    });
    expect(scoreGraph(graph([old])).get('A')).toMatchObject({ r: 1, s: 0 });
    expect(
      label(
        evidence({
          sourceChecks: [
            {
              id: 'c',
              sectionHash: OLD,
              time: '2026-11-02T00:00:00.000Z',
              checkerKind: 'person',
              result: 'supported',
              sourceRef: 'doi:10.1/x',
            },
          ],
          ownerConfirmations: [{ id: 'o', sectionHash: OLD, time: '2026-11-02T00:00:00.000Z' }],
          errors: [{ id: 'e', sectionHash: OLD, time: '2026-11-02T00:00:00.000Z', reason: 'x' }],
        }),
      ),
    ).toBe('reviewed');
  });
  it('the placeholder model reproduces the research example (no evidence = base rate)', () => {
    const bare = scoreGraph(graph([node('A', { reviews: [] })])).get('A');
    expect(bare).toMatchObject({ r: 0, s: 0, u: 1, p: 0.8 });
    const checked = scoreGraph(graph([node('A', { reviews: [], sourceChecks: [supported('x')] })])).get('A');
    expect(checked?.p).toBeCloseTo(0.9);
  });
});
