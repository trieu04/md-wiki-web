import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { DEFAULT_SCORE_PARAMS, citedSources, normalizeSourceRef } from '@md-wiki/domain';
import type {
  CopyCandidatesInput,
  CopyCandidatesOutput,
  CredibilityScoreInput,
  CredibilityScoreOutput,
  RelationCandidatesOutput,
  RetractionCheckInput,
  RetractionCheckOutput,
} from '@md-wiki/contracts';
import type { AiJob, AiJobTrigger, Prisma } from '@prisma/client';
import type { Subscription } from 'rxjs';
import type { Identity } from '../auth/auth.service.js';
import { AppError } from '../common/app-error.js';
import { logger } from '../common/request-id.middleware.js';
import { JobQueue } from '../jobs/ping-queue.js';
import { offsetCursor, offsetOf } from '../wiki/current-sections.js';
import type { Wire } from '../wiki/read.dto.js';
import { SectionLabels } from '../wiki/section-labels.js';
import { wikiPath } from '../wiki/storage/wiki-storage.js';
import { CredibilityCore } from './credibility-core.js';
import type { CredibilityJobDto, SectionScoreDto, SectionScoresDto } from './credibility.dto.js';
import { EvidenceService } from './evidence.service.js';
import { CredibilityGates } from './gates.service.js';
import {
  CREDIBILITY_JOB_KINDS,
  credibilityJobBus,
  isCredibilityJob,
  type CredibilityJobKind,
} from './job-bus.js';

const DOI_REF = /^doi:10\.\d{4,9}\/\S+$/;
const MAX_REFS = 2000;
const MAX_SECTIONS = 5000;
const MAX_TEXT = 20_000;
const COPY_THRESHOLD = 0.6;
const RELATION_TOP_K = 20;
const keyOf = (path: string, anchor: string) => `${path}#${anchor}`;
const splitKey = (key: string) => {
  const at = key.lastIndexOf('#');
  return { path: key.slice(0, at), anchor: key.slice(at + 1) };
};
const json = (value: unknown) => value as Prisma.InputJsonValue;

type JobTrigger = Extract<AiJobTrigger, 'manual' | 'weekly' | 'daily' | 'internal'>;
type Candidate = (CopyCandidatesOutput | RelationCandidatesOutput)['candidates'][number];

/**
 * Phase 9b credibility jobs (system-logic §7.7.12, D-230..D-233): builds inputs, enqueues runs
 * and applies their outputs. Candidates never change a label (a reviewer answers them in the
 * queue); retraction hits record invalidations like the owner endpoint; scores are shadow only.
 */
@Injectable()
export class CredibilityJobs implements OnModuleDestroy {
  private readonly subscription: Subscription;
  /** Applying is serialized in-process (one API process, D-88), so a job is never applied twice. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(CredibilityCore) private readonly core: CredibilityCore,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(SectionLabels) private readonly labels: SectionLabels,
    @Inject(CredibilityGates) private readonly gates: CredibilityGates,
    @Inject(JobQueue) private readonly queue: JobQueue,
  ) {
    this.subscription = credibilityJobBus.subscribe((id) => {
      void this.apply(id).catch((error: unknown) => {
        logger.warn({ err: error, jobId: id }, 'credibility job apply failed');
      });
    });
  }

  private get db() {
    return this.core.db;
  }

  onModuleDestroy() {
    this.subscription.unsubscribe();
  }

  // ---- starting runs ---------------------------------------------------------------------

  /** `POST /credibility/jobs/{kind}` (owner): start a run now. */
  async run(identity: Identity, kind: string): Promise<Wire<CredibilityJobDto>> {
    this.core.require(identity, 'admin.credibility');
    if (!isCredibilityJob(kind)) throw new AppError('NOT_FOUND', 'Unknown job kind');
    const job = await this.start(kind, 'manual', identity.user.id);
    return {
      jobId: job.id,
      kind,
      status: job.status,
      trigger: 'manual',
      createdAt: job.createdAt.toISOString(),
    };
  }

  /** Create and enqueue a run; an active run of the same kind is reused. */
  async start(
    kind: CredibilityJobKind,
    trigger: JobTrigger,
    requestedById: string | null = null,
  ): Promise<AiJob> {
    const active = await this.db.aiJob.findFirst({
      where: { kind, status: { in: ['queued', 'running'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (active) return active;
    const input = await this.inputFor(kind, trigger);
    const job = await this.db.aiJob.create({
      data: { kind, trigger, input: json(input), requestedById },
    });
    void this.queue.enqueueQuietly({ v: 1, jobId: job.id, kind });
    return job;
  }

  /** Scheduled runs (credibility module timers); failures are logged, never thrown. */
  async scheduled(kinds: readonly CredibilityJobKind[], trigger: 'weekly' | 'daily') {
    for (const kind of kinds)
      await this.start(kind, trigger).catch((error: unknown) => {
        logger.warn({ err: error, kind }, 'credibility job start failed');
      });
  }

  /** Boot: re-enqueue queued runs and apply finished outputs that were never applied. */
  async recover(): Promise<{ redispatched: number; applied: number }> {
    const kinds = [...CREDIBILITY_JOB_KINDS];
    const queued = await this.db.aiJob.findMany({
      where: { kind: { in: kinds }, status: 'queued' },
    });
    for (const row of queued)
      void this.queue.enqueueQuietly({ v: 1, jobId: row.id, kind: row.kind });
    const pending = await this.db.aiJob.findMany({
      where: { kind: { in: kinds }, status: 'succeeded', appliedAt: null },
      orderBy: { finishedAt: 'asc' },
      select: { id: true },
    });
    let applied = 0;
    for (const row of pending) if (await this.apply(row.id)) applied += 1;
    return { redispatched: queued.length, applied };
  }

  // ---- inputs ----------------------------------------------------------------------------

  private async currentSections() {
    return this.db.$queryRaw<
      { path: string; anchor: string; sectionHash: string; text: string; updatedAt: Date }[]
    >`
      SELECT s.path, s.anchor, s."sectionHash", s.text, p."updatedAt"
      FROM "PageSection" s
      JOIN "Page" p ON p.path = s.path AND p."currentVersionLabel" = s."versionLabel"
      ORDER BY s.path, s.ord`;
  }

  async inputFor(kind: CredibilityJobKind, trigger: JobTrigger) {
    switch (kind) {
      case 'retraction_check':
        return this.retractionInput(trigger);
      case 'copy_candidates':
        return { sections: await this.candidateSections(), threshold: COPY_THRESHOLD, trigger };
      case 'relation_candidates':
        return { sections: await this.candidateSections(), topK: RELATION_TOP_K, trigger };
      case 'credibility_score':
        return this.scoreInput(trigger);
    }
  }

  /** Cited DOIs of current sections plus every checked DOI (URLs have no retraction lookup). */
  async retractionInput(trigger: JobTrigger): Promise<RetractionCheckInput> {
    const sections = await this.currentSections();
    const checks = await this.db.sourceCheck.findMany({
      select: { sourceRef: true },
      distinct: ['sourceRef'],
    });
    const refs = [
      ...new Set([
        ...sections.flatMap((s) => citedSources(s.text)),
        ...checks.map((c) => normalizeSourceRef(c.sourceRef)),
      ]),
    ]
      .filter((r) => DOI_REF.test(r) && r.length <= 300)
      .sort()
      .slice(0, MAX_REFS);
    return { refs, trigger };
  }

  async candidateSections(): Promise<CopyCandidatesInput['sections']> {
    return (await this.currentSections())
      .filter((s) => s.text.trim())
      .slice(0, MAX_SECTIONS)
      .map((s) => ({
        path: s.path,
        anchor: s.anchor,
        sectionHash: s.sectionHash,
        text: s.text.slice(0, MAX_TEXT),
        updatedAt: s.updatedAt.toISOString(),
      }));
  }

  /** The §7.7.11 graph of every current section (D-231). Links are not indexed: reach is 0. */
  async scoreInput(trigger: JobTrigger): Promise<CredibilityScoreInput> {
    const sections = (await this.currentSections()).slice(0, 20_000);
    const keys = sections.map((s) => ({
      path: s.path,
      anchor: s.anchor,
      sectionHash: s.sectionHash,
    }));
    const detailed = await this.labels.detailed(keys);
    const attestations = keys.length
      ? await this.db.$queryRaw<
          {
            path: string;
            anchor: string;
            sectionHash: string;
            kind: string;
            teamId: string | null;
            actorId: string;
          }[]
        >`
          SELECT a.path, a.anchor, a."sectionHash", a.kind::text AS kind, a."teamId", a."actorId"
          FROM "Attestation" a
          WHERE a.kind IN ('useful', 'checked', 'used')
            AND NOT EXISTS (SELECT 1 FROM "AttestationEvent" e WHERE e."attestationId" = a.id AND e.status = 'withdrawn')`
      : [];
    const nodes: CredibilityScoreInput['graph']['nodes'] = detailed.map(({ evidence }) => {
      const k = evidence.key;
      return {
        key: keyOf(k.path, k.anchor),
        currentHash: k.sectionHash,
        reviews: evidence.reviews.map((r) => ({ sectionHash: r.sectionHash })),
        sourceChecks: evidence.sourceChecks.map((c) => ({
          sectionHash: c.sectionHash,
          checkerKind: c.checkerKind,
          result: c.result,
          sourceRef: c.sourceRef,
        })),
        ownerConfirmations: evidence.ownerConfirmations.map((o) => ({
          sectionHash: o.sectionHash,
        })),
        errors: evidence.errors.map((e) => ({ sectionHash: e.sectionHash })),
        attestations: attestations
          .filter((a) => a.path === k.path && a.anchor === k.anchor)
          .map((a) => ({
            sectionHash: a.sectionHash,
            kind: a.kind as 'checked' | 'used' | 'useful',
            team: a.teamId ?? `person:${a.actorId}`,
            weight: 1,
          })),
      };
    });
    const point = (p: string) => {
      const [path = '', anchor = ''] = p.split('\0');
      return keyOf(path, anchor);
    };
    const edges = await this.db.credibilityEdge.findMany({
      where: { kind: { in: ['corroborates', 'contradicts'] } },
    });
    const resolved = new Set(
      (
        await this.db.credibilityResolution.findMany({
          where: { subjectType: 'edge', subjectId: { in: edges.map((e) => e.id) } },
          select: { subjectId: true },
        })
      ).map((r) => r.subjectId),
    );
    const pair = (e: (typeof edges)[number]) => ({
      a: keyOf(e.srcPath, e.srcAnchor),
      b: keyOf(e.dstPath, e.dstAnchor),
    });
    const retracted = await this.db.invalidationEvent.findMany({
      where: { kind: 'retraction' },
      select: { ref: true },
      distinct: ['ref'],
    });
    const wrong = await this.db.recheckFlag.findMany({
      where: { cause: 'root_wrong' },
      select: { path: true, anchor: true },
      distinct: ['path', 'anchor'],
    });
    const gate = await this.gates.enabled('attestation_weights');
    return {
      params: { ...DEFAULT_SCORE_PARAMS, attestationWeight: gate ? 1 : 0 },
      graph: {
        nodes,
        derivations: (await this.core.derivationEdges([])).map((e) => ({
          from: point(e.from),
          to: point(e.to),
        })),
        corroborations: edges.filter((e) => e.kind === 'corroborates').map(pair),
        contradictions: edges
          .filter((e) => e.kind === 'contradicts' && !resolved.has(e.id))
          .map(pair),
        links: [],
        retractedRefs: retracted.map((r) => r.ref),
        wrongRoots: wrong.map((w) => keyOf(w.path, w.anchor)),
      },
      trigger,
    };
  }

  // ---- applying outputs ------------------------------------------------------------------

  /** Apply a finished job once (serialized); `false` when there was nothing to apply. */
  apply(id: string): Promise<boolean> {
    const next = this.chain.then(() => this.applyNow(id));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async applyNow(id: string): Promise<boolean> {
    const job = await this.db.aiJob.findUnique({ where: { id } });
    if (!job || job.status !== 'succeeded' || job.appliedAt || !isCredibilityJob(job.kind))
      return false;
    switch (job.kind) {
      case 'retraction_check':
        await this.applyHits(job, job.output as unknown as RetractionCheckOutput);
        break;
      case 'copy_candidates':
      case 'relation_candidates':
        await this.applyCandidates(
          job,
          (job.output as unknown as { candidates: Candidate[] }).candidates,
        );
        break;
      case 'credibility_score':
        await this.applyScores(job, job.output as unknown as CredibilityScoreOutput);
        break;
    }
    await this.db.aiJob.updateMany({
      where: { id, appliedAt: null },
      data: { appliedAt: new Date() },
    });
    return true;
  }

  /** A hit already recorded for the same ref and kind is not recorded again. */
  private async applyHits(job: AiJob, output: RetractionCheckOutput) {
    for (const hit of output.hits) {
      const ref = normalizeSourceRef(hit.ref);
      const known = await this.db.invalidationEvent.findFirst({ where: { ref, kind: hit.kind } });
      if (known) continue;
      await this.evidence.recordInvalidation(
        null,
        { kind: hit.kind, ref, detail: hit.detail },
        job.id,
      );
    }
  }

  /** New pairs only: a pair once proposed (in either direction) or confirmed is not proposed again. */
  private async applyCandidates(job: AiJob, candidates: readonly Candidate[]) {
    for (const c of candidates) {
      try {
        wikiPath(c.src.path);
        wikiPath(c.dst.path);
      } catch {
        continue;
      }
      if (c.src.path === c.dst.path && c.src.anchor === c.dst.anchor) continue;
      const forward = {
        srcPath: c.src.path,
        srcAnchor: c.src.anchor,
        dstPath: c.dst.path,
        dstAnchor: c.dst.anchor,
      };
      const directions = [
        forward,
        {
          srcPath: c.dst.path,
          srcAnchor: c.dst.anchor,
          dstPath: c.src.path,
          dstAnchor: c.src.anchor,
        },
      ];
      const where = { kind: c.kind, OR: directions };
      const [candidate, edge] = await Promise.all([
        this.db.edgeCandidate.findFirst({ where }),
        this.db.credibilityEdge.findFirst({ where }),
      ]);
      if (candidate || edge) continue;
      await this.db.edgeCandidate.create({
        data: { kind: c.kind, ...forward, score: c.score, detail: json(c.detail), jobId: job.id },
      });
    }
  }

  /** Scores are cached for the section's current hash only (D-231). */
  private async applyScores(job: AiJob, output: CredibilityScoreOutput) {
    const points = output.scores.map((s) => ({ ...splitKey(s.key), score: s }));
    const byKey = new Map(points.map((p) => [keyOf(p.path, p.anchor), p.score]));
    const keys = await this.core.currentKeys(points);
    const at = job.finishedAt ?? new Date();
    await this.db.$transaction(
      keys.flatMap((k) => {
        const s = byKey.get(keyOf(k.path, k.anchor));
        if (!s) return [];
        const data = {
          p: s.p,
          lower10: s.lower10,
          u: s.u,
          r: s.r,
          s: s.s,
          flagged: s.flagged,
          reach: s.reach,
          modelVersion: output.modelVersion,
          paramsSha256: output.paramsSha256,
          jobId: job.id,
          computedAt: at,
        };
        return [
          this.db.sectionScore.upsert({
            where: {
              path_anchor_sectionHash: {
                path: k.path,
                anchor: k.anchor,
                sectionHash: k.sectionHash,
              },
            },
            create: { ...k, ...data },
            update: data,
          }),
        ];
      }),
    );
  }

  // ---- reads (shadow: owner only) --------------------------------------------------------

  async scores(
    identity: Identity,
    input: { path?: string; limit?: number; cursor?: string },
  ): Promise<Wire<SectionScoresDto>> {
    this.core.require(identity, 'admin.credibility');
    const limit = input.limit ?? 50;
    const offset = offsetOf(input.cursor);
    const rows = await this.db.sectionScore.findMany({
      where: input.path ? { path: input.path } : {},
      orderBy: [{ p: 'asc' }, { path: 'asc' }, { anchor: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit).map(scoreDto),
      nextCursor: rows.length > limit ? offsetCursor(offset + limit) : null,
    };
  }

  /** Research export (§7.7.12): scores, invalidations, candidates and edges as plain JSON. */
  async export(identity: Identity) {
    this.core.require(identity, 'admin.credibility');
    const [scores, invalidations, candidates, edges] = await Promise.all([
      this.db.sectionScore.findMany({ orderBy: [{ path: 'asc' }, { anchor: 'asc' }] }),
      this.db.invalidationEvent.findMany({ orderBy: { detectedAt: 'asc' } }),
      this.db.edgeCandidate.findMany({ orderBy: { createdAt: 'asc' } }),
      this.db.credibilityEdge.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      params: DEFAULT_SCORE_PARAMS,
      scores: scores.map(scoreDto),
      invalidations: invalidations.map((i) => ({
        id: i.id,
        kind: i.kind,
        ref: i.ref,
        detail: i.detail,
        detectedAt: i.detectedAt.toISOString(),
        jobId: i.jobId,
      })),
      candidates: candidates.map((c) => ({
        id: c.id,
        kind: c.kind,
        src: { path: c.srcPath, anchor: c.srcAnchor },
        dst: { path: c.dstPath, anchor: c.dstAnchor },
        score: c.score,
        jobId: c.jobId,
        createdAt: c.createdAt.toISOString(),
      })),
      edges: edges.map((e) => ({
        id: e.id,
        kind: e.kind,
        src: { path: e.srcPath, anchor: e.srcAnchor },
        dst: { path: e.dstPath, anchor: e.dstAnchor },
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}

function scoreDto(s: {
  path: string;
  anchor: string;
  sectionHash: string;
  p: number;
  lower10: number;
  u: number;
  r: number;
  s: number;
  flagged: boolean;
  reach: number;
  modelVersion: string;
  paramsSha256: string;
  computedAt: Date;
}): Wire<SectionScoreDto> {
  return {
    path: s.path,
    anchor: s.anchor,
    sectionHash: s.sectionHash,
    p: s.p,
    lower10: s.lower10,
    u: s.u,
    r: s.r,
    s: s.s,
    flagged: s.flagged,
    reach: s.reach,
    modelVersion: s.modelVersion,
    paramsSha256: s.paramsSha256,
    computedAt: s.computedAt.toISOString(),
  };
}
