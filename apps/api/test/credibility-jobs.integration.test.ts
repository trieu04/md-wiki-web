import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { scoreItems, type ScoreGraph, type ScoreParams } from '@md-wiki/domain';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule, InternalModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { LoginDto } from '../src/auth/identity.dto.js';
import { API_CONFIG, loadConfig, type ApiConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import { CredibilityJobs } from '../src/credibility/credibility-jobs.service.js';
import type { CredibilityJobDto, SectionScoresDto } from '../src/credibility/credibility.dto.js';
import { JobQueue } from '../src/jobs/ping-queue.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import { FixtureStorage } from '../src/wiki/storage/fixture-storage.js';
import { wikiPath } from '../src/wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../src/wiki/wiki.module.js';
import { testSchema } from './test-schema.js';

/** Phase 9b credibility jobs (system-logic §7.7.12, D-230..D-233). */

const database = testSchema();
const email = 'jobs-owner@example.org';
const password = 'credibility jobs password';
const storage = new FixtureStorage();
const enqueued: { jobId: string; kind: string }[] = [];
const queue = {
  enqueue: (e: { jobId: string; kind: string }) => {
    enqueued.push(e);
    return Promise.resolve();
  },
  enqueueQuietly: (e: { jobId: string; kind: string }) => {
    enqueued.push(e);
    return Promise.resolve(true);
  },
  onModuleDestroy: () => Promise.resolve(),
};
let config: ApiConfig;
let app: INestApplication | undefined;
let internal: INestApplication | undefined;
let db: PrismaService;
let owner: Session;
let reader: Session;
type Session = { cookie: string; csrf: string };

const jobs = () => {
  if (!app) throw new Error('app not started');
  return app.get(CredibilityJobs);
};
const http = () => request(app?.getHttpServer() as Parameters<typeof request>[0]);
const inner = () => request(internal?.getHttpServer() as Parameters<typeof request>[0]);
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed response bodies
const body = <T>(res: Response) => res.body as T;
const service = () => ({ Authorization: `Bearer ${config.SERVICE_TOKEN}` });
function as(who: Session) {
  const auth = (r: request.Test) => r.set('Cookie', who.cookie).set('X-CSRF-Token', who.csrf);
  return {
    get: (url: string) => auth(http().get(`/api/v1${url}`)),
    post: (url: string, data: object = {}) => auth(http().post(`/api/v1${url}`)).send(data),
  };
}
async function login(user: string, pass: string): Promise<Session> {
  const res = await http()
    .post('/api/v1/auth/login')
    .send({ email: user, password: pass })
    .expect(200);
  const header = res.header['set-cookie'] as unknown as string[];
  return { cookie: header[0]?.split(';')[0] ?? '', csrf: body<LoginDto>(res).csrfToken };
}
async function input(jobId: string) {
  const res = await inner().get(`/internal/v1/jobs/${jobId}/input`).set(service());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return body<{ kind: string; input: Record<string, unknown> }>(res).input;
}
const result = (jobId: string, data: object) =>
  inner().post(`/internal/v1/jobs/${jobId}/result`).set(service()).send(data);
/** Applying happens on the public side after the internal store (D-230). */
async function applied(jobId: string) {
  for (let i = 0; i < 100; i++) {
    const row = await db.aiJob.findUnique({ where: { id: jobId } });
    if (row?.appliedAt) return row;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`job ${jobId} was not applied`);
}
async function run(kind: string) {
  const res = await as(owner).post(`/credibility/jobs/${kind}`);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return body<CredibilityJobDto>(res);
}

const TEXT =
  'Set the pinhole to 1 Airy unit for confocal imaging with the 63x oil objective [1](https://doi.org/10.1101/abc). Larger pinholes reduce sectioning.';
const PAGES: Record<string, string> = {
  'imaging/a.md': `# A\n\n## Pinhole\n\n${TEXT}\n`,
  'imaging/b.md': `# B\n\n## Pinhole\n\n${TEXT} Use lens paper.\n`,
  'imaging/c.md': '# C\n\n## Lasers\n\nClass 4 lasers need interlocks.\n',
};

beforeAll(async () => {
  database.migrate();
  config = {
    ...loadConfig(),
    DATABASE_URL: database.url,
    WIKI_ROOT: '/nonexistent',
    OWNER_EMAIL: email,
    OWNER_PASSWORD: password,
    AUTO_PUBLISH: false,
    REVIEWER_AGENT_TOKEN: undefined,
    MAIL_TRANSPORT: 'noop',
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config)
    .overrideProvider(JobQueue)
    .useValue(queue)
    .overrideProvider(WIKI_STORAGE)
    .useValue(storage)
    .compile();
  app = module.createNestApplication();
  configureHttp(app, { public: true });
  await app.get(AuthService).seedOwner();
  await app.init();
  const internalModule = await Test.createTestingModule({ imports: [InternalModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config)
    .compile();
  internal = internalModule.createNestApplication();
  configureHttp(internal, { serviceToken: config.SERVICE_TOKEN });
  await internal.init();
  db = app.get(PrismaService);
  for (const [path, text] of Object.entries(PAGES)) {
    await storage.write(wikiPath(path), Buffer.from(text), { kind: 'create' }, {});
    await app.get(WikiIndexer).observe(wikiPath(path));
  }
  owner = await login(email, password);
  await as(owner)
    .post('/admin/users', {
      email: 'jobs-reader@example.org',
      name: 'jobs-reader',
      roles: ['reader'],
      teamId: null,
      password: 'pw-12345678',
    })
    .expect(201);
  reader = await login('jobs-reader@example.org', 'pw-12345678');
}, 60_000);

afterAll(async () => {
  try {
    await internal?.close();
    await app?.close();
  } finally {
    await database.drop();
  }
});

describe('starting runs', () => {
  it('is owner only, reuses an active run and enqueues it', async () => {
    const res = await as(reader).post('/credibility/jobs/retraction_check');
    expect(res.status).toBe(403);
    expect((await as(owner).post('/credibility/jobs/nope')).status).toBe(400);
    const first = await run('retraction_check');
    expect(first).toMatchObject({ kind: 'retraction_check', status: 'queued', trigger: 'manual' });
    expect((await run('retraction_check')).jobId).toBe(first.jobId);
    expect(enqueued).toContainEqual({ v: 1, jobId: first.jobId, kind: 'retraction_check' });
  });
});

describe('retraction_check', () => {
  it('sends cited DOIs and records each hit once as an invalidation', async () => {
    const job = await db.aiJob.findFirstOrThrow({ where: { kind: 'retraction_check' } });
    expect(await input(job.id)).toEqual({ refs: ['doi:10.1101/abc'], trigger: 'manual' });
    const payload = {
      status: 'ok',
      output: {
        checked: 1,
        hits: [
          {
            ref: 'doi:10.1101/abc',
            kind: 'retraction',
            detail: 'Retraction notice 10.9/x',
            source: 'crossref',
            noticeDoi: '10.9/x',
          },
        ],
      },
    };
    expect((await result(job.id, payload)).status).toBe(204);
    await applied(job.id);
    const rows = await db.invalidationEvent.findMany({ where: { ref: 'doi:10.1101/abc' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'retraction', jobId: job.id, recordedById: null });
    // A replay is accepted and changes nothing; a new run with the same hit adds nothing either.
    expect((await result(job.id, payload)).status).toBe(204);
    const again = await run('retraction_check');
    await input(again.jobId);
    await result(again.jobId, payload).expect(204);
    await applied(again.jobId);
    expect(await db.invalidationEvent.count({ where: { ref: 'doi:10.1101/abc' } })).toBe(1);
  });

  it('stores a failure without applying anything', async () => {
    const job = await run('retraction_check');
    await input(job.jobId);
    await result(job.jobId, {
      status: 'failed',
      error: { code: 'source_unavailable', message: 'Crossref could not be reached' },
    }).expect(204);
    const row = await db.aiJob.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(row).toMatchObject({ status: 'failed', appliedAt: null });
  });
});

describe('copy and relation candidates', () => {
  it('sends current sections and adds new pairs to the queue only', async () => {
    const job = await run('copy_candidates');
    const data = await input(job.jobId);
    const sections = data.sections as { path: string; anchor: string }[];
    expect(sections.map((s) => `${s.path}#${s.anchor}`)).toEqual(
      expect.arrayContaining([
        'imaging/a.md#pinhole',
        'imaging/b.md#pinhole',
        'imaging/c.md#lasers',
      ]),
    );
    expect(data.threshold).toBe(0.6);
    const pair = {
      kind: 'copy',
      src: { path: 'imaging/a.md', anchor: 'pinhole' },
      dst: { path: 'imaging/b.md', anchor: 'pinhole' },
      score: 0.92,
      detail: { jaccard: 0.9 },
    };
    const bad = { ...pair, src: { path: '../etc.md', anchor: 'x' } };
    await result(job.jobId, { status: 'ok', output: { candidates: [pair, bad] } }).expect(204);
    await applied(job.jobId);
    const rows = await db.edgeCandidate.findMany({ where: { kind: 'copy' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      srcPath: 'imaging/a.md',
      dstPath: 'imaging/b.md',
      jobId: job.jobId,
    });
    // The reverse pair from a later run is the same candidate.
    const later = await run('copy_candidates');
    await input(later.jobId);
    const reverse = { ...pair, src: pair.dst, dst: pair.src };
    await result(later.jobId, { status: 'ok', output: { candidates: [reverse] } }).expect(204);
    await applied(later.jobId);
    expect(await db.edgeCandidate.count({ where: { kind: 'copy' } })).toBe(1);
    // Candidates never change a label: both sections are still unreviewed.
    const labels = await as(owner).get('/credibility/queue?type=candidate').expect(200);
    expect(JSON.stringify(labels.body)).toContain('imaging/b.md');
  });

  it('rejects an output with the wrong kind for the job', async () => {
    const job = await run('relation_candidates');
    expect((await input(job.jobId)).topK).toBe(20);
    const res = await result(job.jobId, {
      status: 'ok',
      output: {
        candidates: [
          {
            kind: 'copy',
            src: { path: 'imaging/a.md', anchor: 'pinhole' },
            dst: { path: 'imaging/c.md', anchor: 'lasers' },
            score: 0.5,
            detail: {},
          },
        ],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(body<{ code: string }>(res).code).toBe('VALIDATION_FAILED');
  });
});

describe('credibility_score (shadow)', () => {
  it('sends the §7.7.11 graph and caches the scores for current hashes', async () => {
    const job = await run('credibility_score');
    const data = (await input(job.jobId)) as { params: ScoreParams; graph: ScoreGraph };
    expect(data.params.attestationWeight).toBe(0);
    expect(data.graph.retractedRefs).toEqual(['doi:10.1101/abc']);
    expect(data.graph.nodes.map((n) => n.key)).toEqual(
      expect.arrayContaining(['imaging/a.md#pinhole', 'imaging/c.md#lasers']),
    );
    const scores = scoreItems(data.graph, data.params);
    await result(job.jobId, {
      status: 'ok',
      output: { modelVersion: 'score-v1', paramsSha256: 'a'.repeat(64), scores },
    }).expect(204);
    await applied(job.jobId);
    expect(await db.sectionScore.count()).toBe(scores.length);
    const listed = body<SectionScoresDto>(
      await as(owner).get('/credibility/scores?path=imaging/a.md').expect(200),
    );
    expect(listed.items.map((s) => s.anchor)).toContain('pinhole');
    expect(listed.items.every((s) => s.modelVersion === 'score-v1')).toBe(true);
    expect((await as(reader).get('/credibility/scores')).status).toBe(403);
    const exported = await as(owner).get('/credibility/export').expect(200);
    expect(Object.keys(exported.body as object)).toEqual(
      expect.arrayContaining(['scores', 'invalidations', 'candidates', 'edges', 'params']),
    );
    // Scores never reach the reader-facing page.
    const page = await as(reader)
      .get(`/wiki/pages/${encodeURIComponent('imaging/a.md')}`)
      .expect(200);
    expect(JSON.stringify(page.body)).not.toContain('lower10');
  });
});

describe('internal endpoints (service token)', () => {
  it('needs the service token', async () => {
    expect((await inner().post('/internal/v1/credibility/scores').send({})).status).toBe(401);
  });

  it('records invalidations and candidates like the owner endpoints', async () => {
    const inv = await inner()
      .post('/internal/v1/credibility/invalidations')
      .set(service())
      .send({
        kind: 'concern',
        ref: 'https://doi.org/10.1101/XYZ',
        detail: 'Expression of concern',
      });
    expect(inv.status, JSON.stringify(inv.body)).toBe(202);
    await applied(body<{ jobId: string }>(inv).jobId);
    expect(
      await db.invalidationEvent.findFirst({ where: { ref: 'doi:10.1101/xyz' } }),
    ).toMatchObject({
      kind: 'concern',
    });
    const cand = await inner()
      .post('/internal/v1/credibility/candidates')
      .set(service())
      .send({
        kind: 'contradicts',
        src: { path: 'imaging/a.md', anchor: 'pinhole' },
        dst: { path: 'imaging/c.md', anchor: 'lasers' },
        score: 0.4,
      });
    expect(cand.status, JSON.stringify(cand.body)).toBe(202);
    await applied(body<{ jobId: string }>(cand).jobId);
    expect(await db.edgeCandidate.count({ where: { kind: 'contradicts' } })).toBe(1);
  });

  it('validates the bodies', async () => {
    const res = await inner()
      .post('/internal/v1/credibility/scores')
      .set(service())
      .send({ scores: [] });
    expect(res.status).toBe(400);
    const bad = await inner()
      .post('/internal/v1/credibility/invalidations')
      .set(service())
      .send({ kind: 'nope', ref: 'doi:10.1/x', detail: 'x' });
    expect(bad.status).toBe(400);
  });
});

describe('recovery at boot', () => {
  it('applies outputs that were stored but never applied', async () => {
    const row = await db.aiJob.create({
      data: {
        kind: 'retraction_check',
        trigger: 'internal',
        status: 'succeeded',
        input: {},
        output: {
          checked: 1,
          hits: [
            {
              ref: 'doi:10.1101/late',
              kind: 'retraction',
              detail: 'Late notice',
              source: 'crossref',
            },
          ],
        },
        finishedAt: new Date(),
      },
    });
    const done = await jobs().recover();
    expect(done.applied).toBe(1);
    expect((await db.aiJob.findUniqueOrThrow({ where: { id: row.id } })).appliedAt).not.toBeNull();
    expect(await db.invalidationEvent.count({ where: { ref: 'doi:10.1101/late' } })).toBe(1);
    expect((await jobs().recover()).applied).toBe(0);
  });
});
