import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORE_PARAMS,
  SCORE_MODEL_VERSION,
  lower10,
  scoreItems,
  type ScoreGraph,
  type ScoreParams,
} from '../src/index.js';

// Shared with services/worker/tests (the Python port must give the same items, D-231).
const fixture = JSON.parse(
  readFileSync(
    new URL('../../contracts/jobs/fixtures/credibility_score.cases.json', import.meta.url),
    'utf8',
  ),
) as {
  modelVersion: string;
  cases: { name: string; params: ScoreParams; graph: ScoreGraph; expected: unknown }[];
};

describe('credibility_score job output (§7.7.12)', () => {
  it('pins the model version of the shared cases', () => {
    expect(fixture.modelVersion).toBe(SCORE_MODEL_VERSION);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(scoreItems(c.graph, c.params)).toEqual(c.expected);
  });

  it('bounds lower10 within [0, p]', () => {
    for (const r of [0, 1, 5, 50])
      for (const s of [0, 1, 5]) {
        const total = r + s + DEFAULT_SCORE_PARAMS.weight;
        const p = r / total + (DEFAULT_SCORE_PARAMS.baseRate * DEFAULT_SCORE_PARAMS.weight) / total;
        const l = lower10({ r, s, p });
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(p);
      }
    // More evidence narrows the bound.
    expect(lower10({ r: 50, s: 0, p: 0.99 })).toBeGreaterThan(lower10({ r: 1, s: 0, p: 0.9 }));
  });
});
