import type { ReviewerKind } from './labels.js';
import type { SourceCheckResult } from './credibility.js';
import { descendants } from './credibility.js';

/**
 * Shadow score reference model (system-logic §7.7.11, D-178). Placeholder parameters from
 * page-credibility.md §5.4; the 7b worker job `credibility_score` must reproduce this model. The
 * score never feeds a label while the `label_threshold` gate is off and is never shown to readers.
 */
export interface ScoreParams {
  baseRate: number;
  weight: number;
  agentWeight: number;
  attestationWeight: number;
  delta: number;
  k: number;
}
export const DEFAULT_SCORE_PARAMS: ScoreParams = {
  baseRate: 0.8,
  weight: 2,
  agentWeight: 0,
  attestationWeight: 0,
  delta: 0.05,
  k: 1,
};

export interface ScoreNode {
  key: string;
  currentHash: string;
  reviews: readonly { sectionHash: string }[];
  sourceChecks: readonly {
    sectionHash: string;
    checkerKind: ReviewerKind;
    result: SourceCheckResult;
    sourceRef: string;
  }[];
  ownerConfirmations: readonly { sectionHash: string }[];
  errors: readonly { sectionHash: string }[];
  attestations: readonly {
    sectionHash: string;
    kind: 'checked' | 'used' | 'useful';
    team: string;
    weight: number;
  }[];
}
export interface ScoreGraph {
  nodes: readonly ScoreNode[];
  /** `to` derives from `from` (declared source, or a confirmed copy edge). */
  derivations: readonly { from: string; to: string }[];
  corroborations: readonly { a: string; b: string }[];
  contradictions: readonly { a: string; b: string }[];
  /** Inbound links: blast radius only, never an input of the score. */
  links: readonly { from: string; to: string }[];
  retractedRefs: readonly string[];
  /** Sections confirmed wrong as a provenance root. */
  wrongRoots: readonly string[];
}
export interface Score {
  r: number;
  s: number;
  u: number;
  p: number;
  /** Received through derivation (one step), as evidence counts. */
  received: { r: number; s: number };
  roots: string[];
  flagged: boolean;
  reach: number;
}

interface Evidence {
  r: number;
  s: number;
}
const opinion = ({ r, s }: Evidence, p: ScoreParams) => {
  const total = r + s + p.weight;
  const b = r / total;
  const d = s / total;
  const u = p.weight / total;
  return { b, d, u, p: b + p.baseRate * u };
};

function rootsOf(node: ScoreNode, retracted: ReadonlySet<string>): string[] {
  return [
    ...new Set(
      node.sourceChecks
        .filter(
          (c) =>
            c.sectionHash === node.currentHash &&
            c.result === 'supported' &&
            !retracted.has(c.sourceRef),
        )
        .map((c) => c.sourceRef),
    ),
  ].sort();
}

/** Evidence of the node itself, only on its current hash (hash change resets evidence). */
export function ownEvidence(
  node: ScoreNode,
  graph: Pick<ScoreGraph, 'retractedRefs'>,
  params: ScoreParams = DEFAULT_SCORE_PARAMS,
): Evidence {
  const hash = node.currentHash;
  const retracted = new Set(graph.retractedRefs);
  let r = 0;
  let s = 0;
  if (node.reviews.some((x) => x.sectionHash === hash)) r += 1;
  const byRef = new Map<string, number>();
  for (const c of node.sourceChecks) {
    if (c.sectionHash !== hash || retracted.has(c.sourceRef)) continue;
    const w = c.checkerKind === 'person' ? 1 : params.agentWeight;
    if (c.result === 'supported') byRef.set(c.sourceRef, Math.max(byRef.get(c.sourceRef) ?? 0, w));
    if (c.result === 'not_supported') s += 3 * w;
  }
  // Checks of one source are one provenance group: the strongest counts, not the sum.
  for (const w of byRef.values()) r += 2 * w;
  if (node.ownerConfirmations.some((x) => x.sectionHash === hash)) r += 3;
  s += 3 * node.errors.filter((x) => x.sectionHash === hash).length;
  const teams = new Map<string, number>();
  for (const a of node.attestations) {
    if (a.sectionHash !== hash || a.kind === 'useful') continue;
    teams.set(a.team, (teams.get(a.team) ?? 0) + (a.kind === 'used' ? 0.5 : 1) * a.weight);
  }
  if (teams.size >= 2) {
    const effective = [...teams.values()].reduce((n, w) => n + Math.sqrt(w), 0);
    r += Math.min(1.5, 0.5 * effective) * params.attestationWeight;
  }
  return { r, s };
}

/** The whole graph's shadow scores. */
export function scoreGraph(
  graph: ScoreGraph,
  params: ScoreParams = DEFAULT_SCORE_PARAMS,
): Map<string, Score> {
  const retracted = new Set(graph.retractedRefs);
  const own = new Map(graph.nodes.map((n) => [n.key, ownEvidence(n, graph, params)]));
  const pOwn = (key: string) => opinion(own.get(key) ?? { r: 0, s: 0 }, params).p;
  const roots = new Map(graph.nodes.map((n) => [n.key, rootsOf(n, retracted)]));
  const total = new Map([...own].map(([k, e]) => [k, { ...e }]));
  const received = new Map(graph.nodes.map((n) => [n.key, { r: 0, s: 0 }]));

  // Corroboration only between disjoint, non-empty provenance roots; uses P_own (no feedback loop).
  for (const { a, b } of graph.corroborations) {
    const ra = roots.get(a) ?? [];
    const rb = roots.get(b) ?? [];
    if (!ra.length || !rb.length || ra.some((x) => rb.includes(x))) continue;
    const ea = total.get(a);
    const eb = total.get(b);
    if (ea) ea.r += 2 * pOwn(b);
    if (eb) eb.r += 2 * pOwn(a);
  }
  // Derivation: one step, B receives A's own opinion discounted by P_own(A); loss goes to u.
  for (const { from, to } of graph.derivations) {
    const src = opinion(own.get(from) ?? { r: 0, s: 0 }, params);
    const t = pOwn(from);
    const b = t * src.b;
    const d = t * src.d;
    const u = 1 - b - d;
    const add = { r: (params.weight * b) / u, s: (params.weight * d) / u };
    const target = total.get(to);
    const got = received.get(to);
    if (target && got) {
      target.r += add.r;
      target.s += add.s;
      got.r += add.r;
      got.s += add.s;
    }
  }
  // Asymmetric contradictions (one step; a contradiction of a contradiction is not support).
  for (const { a, b } of graph.contradictions) {
    const ga = (roots.get(a) ?? []).length;
    const gb = (roots.get(b) ?? []).length;
    const shared = (roots.get(a) ?? []).some((x) => (roots.get(b) ?? []).includes(x));
    const pa = pOwn(a);
    const pb = pOwn(b);
    const ea = total.get(a);
    const eb = total.get(b);
    if (!ea || !eb) continue;
    const strongA = !shared && (ga > gb || pa - pb >= params.delta);
    const strongB = !shared && (gb > ga || pb - pa >= params.delta);
    if (strongA && !strongB) {
      ea.r *= 0.9;
      ea.s *= 0.9;
      eb.s += params.k * pa;
    } else if (strongB && !strongA) {
      eb.r *= 0.9;
      eb.s *= 0.9;
      ea.s += params.k * pb;
    } else {
      for (const e of [ea, eb]) {
        e.r *= 0.5;
        e.s *= 0.5;
      }
    }
  }
  // Flags: every transitive descendant of a retracted or wrong root.
  const sourceRoots = graph.nodes
    .filter(
      (n) =>
        graph.wrongRoots.includes(n.key) ||
        n.sourceChecks.some((c) => c.sectionHash === n.currentHash && retracted.has(c.sourceRef)),
    )
    .map((n) => n.key);
  const flagged = new Set([
    ...sourceRoots,
    ...descendants(sourceRoots, graph.derivations).map((d) => d.key),
  ]);
  const reach = new Map<string, number>();
  for (const l of graph.links) reach.set(l.to, (reach.get(l.to) ?? 0) + 1);

  return new Map(
    graph.nodes.map((n) => {
      const e = total.get(n.key) ?? { r: 0, s: 0 };
      const o = opinion(e, params);
      return [
        n.key,
        {
          r: e.r,
          s: e.s,
          u: o.u,
          p: o.p,
          received: received.get(n.key) ?? { r: 0, s: 0 },
          roots: roots.get(n.key) ?? [],
          flagged: flagged.has(n.key),
          reach: reach.get(n.key) ?? 0,
        },
      ];
    }),
  );
}

// ---- 7b job output (system-logic §7.7.12, D-231) ---------------------------------------------

export const SCORE_MODEL_VERSION = 'score-v1';

/**
 * Lower 10% bound of P (D-231): normal approximation of Beta(r + a·W, s + (1−a)·W), clamped to
 * [0, 1]. Shadow only; never a reader-facing number.
 */
export function lower10(
  score: Pick<Score, 'r' | 's' | 'p'>,
  params: ScoreParams = DEFAULT_SCORE_PARAMS,
) {
  const alpha = score.r + params.baseRate * params.weight;
  const beta = score.s + (1 - params.baseRate) * params.weight;
  const n = alpha + beta;
  const variance = (alpha * beta) / (n * n * (n + 1));
  return Math.min(1, Math.max(0, score.p - 1.2815515655446004 * Math.sqrt(variance)));
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** The `credibility_score` job output items, sorted by key and rounded to 6 decimals. */
export function scoreItems(graph: ScoreGraph, params: ScoreParams = DEFAULT_SCORE_PARAMS) {
  return [...scoreGraph(graph, params)]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, s]) => ({
      key,
      p: round6(s.p),
      lower10: round6(lower10(s, params)),
      u: round6(s.u),
      r: round6(s.r),
      s: round6(s.s),
      flagged: s.flagged,
      reach: s.reach,
    }));
}
