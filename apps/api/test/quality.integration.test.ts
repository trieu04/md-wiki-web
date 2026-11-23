/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- typed response bodies */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { JobEnvelope, QualityCheckInput } from '@md-wiki/contracts';
import { sha256Hex } from '@md-wiki/domain';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule, InternalModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { CreatedTokenDto, LoginDto } from '../src/auth/identity.dto.js';
import { API_CONFIG, loadConfig, REPO_ROOT, type ApiConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import type { DraftDto, ProposalDto } from '../src/contributions/contributions.dto.js';
import { EventsService, type WireEvent } from '../src/events/events.service.js';
import { JobQueue } from '../src/jobs/ping-queue.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type {
  JobListDto,
  ModelsDto,
  QualityReportDto,
  QualityRunDto,
  RulesDto,
} from '../src/quality/quality.dto.js';
import type { ProposalDetailDto, ProposalListDto } from '../src/review/review.dto.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import { FixtureStorage } from '../src/wiki/storage/fixture-storage.js';
import { wikiPath } from '../src/wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../src/wiki/wiki.module.js';
import { testSchema } from './test-schema.js';

/**
 * Quality check (system-logic §7.6): runs on submit, on demand and on drafts; the internal
 * result path re-verifies findings; review never depends on the worker.
 */

const database = testSchema();
const email = 'quality-owner@example.org';
const password = 'quality test password';
const RULES_PATH = resolve(REPO_ROOT, 'rules/quality.md');
const RULES_SHA = sha256Hex(readFileSync(RULES_PATH));

class TestStorage extends FixtureStorage {
  async put(path: string, text: string) {
    const target = wikiPath(path);
    let current: string | null = null;
    try {
      current = (await super.read(target)).sha256;
    } catch {
      current = null;
    }
    return this.write(
      target,
      Buffer.from(text),
      current === null ? { kind: 'create' } : { kind: 'replace', expectedSha256: current },
      {},
    );
  }
}
const storage = new TestStorage();
/** Records envelopes instead of using Redis; `down` simulates an unreachable Redis. */
const queue = {
  sent: [] as JobEnvelope[],
  down: false,
  enqueue(envelope: JobEnvelope) {
    if (this.down) return Promise.reject(new Error('redis down'));
    this.sent.push(envelope);
    return Promise.resolve();
  },
  async enqueueQuietly(envelope: JobEnvelope) {
    try {
      await this.enqueue(envelope);
      return true;
    } catch {
      return false;
    }
  },
  onModuleDestroy() {
    return Promise.resolve();
  },
};

let config: ApiConfig;
let app: INestApplication | undefined;
let internal: INestApplication | undefined;
let db: PrismaService;
type Session = { cookie: string; csrf: string };
type Caller = Session | string;
let owner: Session;
let reviewer: Session;
let contributor: Session;
let other: Session;
let agentToken = '';
const events: WireEvent[] = [];

const http = () => request(app?.getHttpServer() as Parameters<typeof request>[0]);
const inner = () => request(internal?.getHttpServer() as Parameters<typeof request>[0]);
const body = <T>(res: Response) => res.body as T;
function as(who: Caller) {
  const auth = (r: request.Test) =>
    typeof who === 'string'
      ? r.set('Authorization', `Bearer ${who}`)
      : r.set('Cookie', who.cookie).set('X-CSRF-Token', who.csrf);
  return {
    get: (url: string) => auth(http().get(`/api/v1${url}`)),
    post: (url: string, data: object = {}) => auth(http().post(`/api/v1${url}`)).send(data),
    patch: (url: string, data: object, headers: Record<string, string>) =>
      auth(http().patch(`/api/v1${url}`))
        .set(headers)
        .send(data),
  };
}
const service = { Authorization: '' };
const jobInput = (id: string) => inner().get(`/internal/v1/jobs/${id}/input`).set(service);
const jobResult = (id: string, data: object) =>
  inner().post(`/internal/v1/jobs/${id}/result`).set(service).send(data);
function problem(res: Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body).toMatchObject({ code });
}
async function login(user: string, pass: string): Promise<Session> {
  const res = await http()
    .post('/api/v1/auth/login')
    .send({ email: user, password: pass })
    .expect(200);
  const header = res.header['set-cookie'] as unknown as string[];
  return { cookie: header[0]?.split(';')[0] ?? '', csrf: body<LoginDto>(res).csrfToken };
}

let counter = 0;
const BASE =
  '# Lens\n\nThe lens may resolve 200 nm in vitro.\n\n## Detectors\n\nPMT detectors are used.\n';
async function seedPage(text = BASE) {
  const path = `q${String(++counter)}.md`;
  await storage.put(path, text);
  await app?.get(WikiIndexer).observe(wikiPath(path));
  return path;
}
async function contextOf(path: string) {
  const res = await as(agentToken)
    .get(`/context?path=${encodeURIComponent(path)}`)
    .expect(200);
  return res.body as { versionLabel: string; sha256: string };
}
async function submit(
  path: string,
  content: string,
  extra: Record<string, unknown> = {},
): Promise<ProposalDto> {
  const base = await contextOf(path);
  const res = await as(agentToken).post('/contributions', {
    targetPath: path,
    base: { versionLabel: base.versionLabel, sha256: base.sha256 },
    content,
    reason: 'Fix units',
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return body<ProposalDto>(res);
}
const runsOf = (proposalId: string) =>
  db.aiJob.findMany({ where: { proposalId }, orderBy: { createdAt: 'asc' } });
const report = async (slug: string, who: Caller = owner) =>
  body<QualityReportDto>(await as(who).get(`/proposals/${slug}/findings`).expect(200));
const PROPOSED = '# Lens\n\nThe lens resolves 200 nm.\n\nIt is the best lens\never made.\n';
const ok = (findings: object[], dropped = {}) => ({
  status: 'ok',
  output: {
    promptVersion: 'quality-v1',
    provider: 'fake',
    model: 'fake-model',
    rulesSha256: RULES_SHA,
    usage: { inputTokens: 120, outputTokens: 30 },
    findings,
    dropped: { unknownRule: 0, unknownBlock: 0, emptyQuote: 0, quoteNotFound: 1, ...dropped },
  },
});
const finding = (over: Record<string, unknown> = {}) => ({
  rule: 'promotional-language',
  severity: 'warning',
  message: 'Peacock wording.',
  quote: { block: 'proposed', text: 'the best lens ever made' },
  origin: 'model',
  original: null,
  ...over,
});

beforeAll(async () => {
  database.migrate();
  config = {
    ...loadConfig(),
    DATABASE_URL: database.url,
    WIKI_ROOT: '/nonexistent',
    OWNER_EMAIL: email,
    OWNER_PASSWORD: password,
    AUTO_PUBLISH: false,
    QUALITY_RULES_PATH: RULES_PATH,
    AI_JOBS__QUALITY_CHECK__MODEL: 'claude-test-model',
    OPENAI_COMPAT_BASE_URL: 'http://user:secret@models.internal:8000/v1',
  };
  service.Authorization = `Bearer ${config.SERVICE_TOKEN}`;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config)
    .overrideProvider(WIKI_STORAGE)
    .useValue(storage)
    .overrideProvider(JobQueue)
    .useValue(queue)
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
  app
    .get(EventsService)
    .stream({ id: 'nobody', roles: ['owner'] }, 3_600_000)
    .subscribe(({ data }) => events.push(data));
  owner = await login(email, password);
  for (const [address, roles] of [
    ['q-reviewer@example.org', ['reviewer']],
    ['q-contributor@example.org', ['contributor']],
    ['q-other@example.org', ['contributor']],
  ] as const)
    await as(owner)
      .post('/admin/users', {
        email: address,
        name: address.split('@')[0],
        roles,
        teamId: null,
        password: 'pw-12345678',
      })
      .expect(201);
  reviewer = await login('q-reviewer@example.org', 'pw-12345678');
  contributor = await login('q-contributor@example.org', 'pw-12345678');
  other = await login('q-other@example.org', 'pw-12345678');
  const author = await db.user.create({
    data: {
      email: 'q-agent@example.org',
      name: 'lab-agent',
      kind: 'agent',
      roles: ['contributor'],
    },
  });
  agentToken = body<CreatedTokenDto>(
    await as(owner)
      .post('/admin/tokens', { userId: author.id, name: 'a', scopes: ['read', 'contribute'] })
      .expect(201),
  ).token;
}, 60_000);

afterAll(async () => {
  await Promise.all([app?.close(), internal?.close()]);
  await database.drop();
});

beforeEach(() => {
  queue.sent.length = 0;
  queue.down = false;
  events.length = 0;
  config.QUALITY_RULES_PATH = RULES_PATH;
});

describe('quality check on submit (§7.6.5)', () => {
  it('queues one run in the submit transaction, enqueues it and shows it as queued', async () => {
    const source = await seedPage('# Source\n\nCells may divide until day 3.\n');
    const sourceCtx = await contextOf(source);
    const page = await seedPage();
    const p = await submit(page, PROPOSED, {
      title: 'Lens wording',
      sources: [{ path: source, versionLabel: sourceCtx.versionLabel }],
    });
    const [run, ...more] = await runsOf(p.id);
    expect(more).toEqual([]);
    expect(run).toMatchObject({
      kind: 'quality_check',
      trigger: 'submit',
      status: 'queued',
      bundleHash: p.bundleHash,
      rulesSha256: RULES_SHA,
      requestedById: null,
    });
    expect(queue.sent).toEqual([{ v: 1, jobId: run?.id, kind: 'quality_check' }]);
    expect(events.some((e) => e.type === 'quality.changed' && e.slug === p.slug)).toBe(true);

    const detail = body<ProposalDetailDto>(await as(owner).get(`/proposals/${p.slug}`).expect(200));
    expect(detail.quality).toMatchObject({ status: 'queued', findings: 0, current: false });
    expect(detail.can.rerunQuality).toBe(true);
    const list = body<ProposalListDto>(await as(owner).get('/proposals').expect(200));
    expect(list.items.find((i) => i.slug === p.slug)?.quality.status).toBe('queued');

    // The worker's view: blocks in contract order, status blocks stripped, the rules text.
    const res = await jobInput(run?.id ?? '').expect(200);
    const input = (res.body as { input: QualityCheckInput }).input;
    expect(input.subject).toEqual({
      kind: 'proposal',
      id: p.id,
      slug: p.slug,
      targetPath: page,
      section: null,
    });
    expect(input.bundleHash).toBe(p.bundleHash);
    expect(input.blocks.map((b) => [b.id, b.kind])).toEqual([
      ['title', 'proposal'],
      ['reason', 'proposal'],
      ['proposed', 'proposal'],
      ['base', 'base'],
      ['source-1', 'source'],
    ]);
    expect(input.blocks[2]?.text).toBe(PROPOSED);
    expect(input.blocks[3]?.text).toBe(BASE);
    expect(input.blocks[4]?.label).toBe(`${source}@${sourceCtx.versionLabel}`);
    expect(input.rules).toMatchObject({ path: 'rules/quality.md', sha256: RULES_SHA });
    expect(sha256Hex(Buffer.from(input.rules.text, 'utf8'))).toBe(RULES_SHA);
    expect((await db.aiJob.findUniqueOrThrow({ where: { id: run?.id ?? '' } })).status).toBe(
      'running',
    );
  });

  it('a replayed submission creates no second run; Redis being down never fails a submit', async () => {
    const page = await seedPage();
    const ctx = await contextOf(page);
    const p = await submit(page, PROPOSED, { slug: 'replayed-quality' });
    const replay = await as(agentToken).post('/contributions', {
      targetPath: page,
      base: { versionLabel: ctx.versionLabel, sha256: ctx.sha256 },
      content: PROPOSED,
      reason: 'Fix units',
      slug: 'replayed-quality',
    });
    expect(replay.status).toBe(200);
    expect(await runsOf(p.id)).toHaveLength(1);

    queue.down = true;
    const q = await submit(await seedPage(), PROPOSED);
    expect((await runsOf(q.id))[0]?.status).toBe('queued');
  });

  it('an unreadable rules file fails the run, not the submission', async () => {
    config.QUALITY_RULES_PATH = resolve(REPO_ROOT, 'rules/missing.md');
    const p = await submit(await seedPage(), PROPOSED);
    const [run] = await runsOf(p.id);
    expect(run).toMatchObject({ status: 'failed', error: { code: 'rules_invalid' } });
    expect(queue.sent).toEqual([]);
    const r = await report(p.slug);
    expect(r.summary.flags).toEqual(['check_failed']);
    const rules = body<RulesDto>(await as(owner).get('/admin/rules').expect(200));
    expect(rules).toMatchObject({
      sha256: null,
      rules: [],
      error: expect.stringContaining('cannot read') as unknown,
    });
  });
});

describe('results (§7.6.3)', () => {
  async function running() {
    const p = await submit(await seedPage(), PROPOSED);
    const [run] = await runsOf(p.id);
    if (!run) throw new Error('no run');
    await jobInput(run.id).expect(200);
    return { p, run };
  }

  it('re-verifies findings: invented quotes, unknown rules and blocks are dropped and counted', async () => {
    const { p, run } = await running();
    const hedge = finding({
      rule: 'dropped-hedge',
      quote: { block: 'proposed', text: 'The lens resolves 200 nm.' },
      origin: 'rule',
      original: { block: 'base', text: 'The lens may resolve 200 nm in vitro.' },
    });
    const result = ok([
      finding(),
      finding({ quote: { block: 'proposed', text: 'resolves 50 nm' } }),
      finding({ rule: 'not-a-rule' }),
      finding({ quote: { block: 'nowhere', text: 'best' } }),
      finding({ severity: 'blocking', message: 'dup' }),
      hedge,
    ]);
    await jobResult(run.id, result).expect(204);
    const stored = await db.finding.findMany({ where: { jobId: run.id }, orderBy: { ord: 'asc' } });
    expect(stored.map((f) => [f.rule, f.lineStart, f.lineEnd])).toEqual([
      ['promotional-language', 5, 6],
      ['dropped-hedge', 3, 3],
    ]);
    const r = await report(p.slug);
    expect(r.current?.dropped).toEqual({
      unknownRule: 1,
      unknownBlock: 1,
      emptyQuote: 0,
      quoteNotFound: 2,
      total: 4,
    });
    expect(r.current).toMatchObject({
      status: 'succeeded',
      current: true,
      provider: 'fake',
      model: 'fake-model',
      promptVersion: 'quality-v1',
      tokensIn: 120,
      rulesChanged: false,
    });
    expect(r.current?.findings[0]).toMatchObject({
      rule: 'promotional-language',
      ruleTitle: 'Promotional or peacock language',
      block: 'proposed',
      quote: 'the best lens ever made',
      origin: 'model',
      original: null,
    });
    expect(r.current?.findings[1]?.original).toEqual({
      block: 'base',
      text: 'The lens may resolve 200 nm in vitro.',
    });
    expect(r.summary).toEqual({
      status: 'succeeded',
      findings: 2,
      counts: { info: 0, warning: 2, blocking: 0 },
      flags: ['dropped_hedge'],
      current: true,
    });
    expect(events.some((e) => e.type === 'quality.changed' && e.slug === p.slug)).toBe(true);
    // Replays: the identical body is accepted, another body is refused.
    await jobResult(run.id, result).expect(204);
    problem(await jobResult(run.id, ok([])), 409, 'PRECONDITION_FAILED');
    // Findings are append-only.
    await expect(db.finding.deleteMany({ where: { jobId: run.id } })).rejects.toThrow();
  });

  it('refuses a schema-invalid output or other rules, leaving the run running', async () => {
    const { run } = await running();
    problem(
      await jobResult(run.id, { status: 'ok', output: { findings: 'nope' } }),
      400,
      'VALIDATION_FAILED',
    );
    const bad = ok([finding({ severity: 'medium' })]);
    problem(await jobResult(run.id, bad), 400, 'VALIDATION_FAILED');
    const other = ok([]);
    other.output.rulesSha256 = 'f'.repeat(64);
    problem(await jobResult(run.id, other), 400, 'VALIDATION_FAILED');
    expect((await db.aiJob.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('running');
  });

  it('stores a provider failure; blocking findings flag the proposal without changing it', async () => {
    const { p, run } = await running();
    await jobResult(run.id, {
      status: 'failed',
      error: { code: 'provider_timeout', message: 'Model call timed out' },
    }).expect(204);
    let r = await report(p.slug);
    expect(r.latest).toMatchObject({ status: 'failed', error: { code: 'provider_timeout' } });
    expect(r.summary).toMatchObject({ status: 'failed', flags: ['check_failed'], current: false });

    const again = body<QualityRunDto>(
      await as(reviewer).post(`/proposals/${p.slug}/quality-check`).expect(202),
    );
    await jobInput(again.id).expect(200);
    await jobResult(again.id, ok([finding({ severity: 'blocking' })])).expect(204);
    r = await report(p.slug);
    expect(r.summary).toMatchObject({ flags: ['blocking_finding'], counts: { blocking: 1 } });
    expect(r.runs.map((x) => x.status)).toEqual(['succeeded', 'failed']);
    expect(r.runs[1]?.findings).toEqual([]);
    const detail = body<ProposalDetailDto>(await as(owner).get(`/proposals/${p.slug}`).expect(200));
    expect(detail.state).toBe('pending');
    expect(detail.quality.flags).toEqual(['blocking_finding']);
  });
});

describe('on demand (§7.6.5)', () => {
  it('reviewers re-run a pending proposal; an active run is reused; others are refused', async () => {
    const p = await submit(await seedPage(), PROPOSED);
    const [first] = await runsOf(p.id);
    const same = await as(reviewer).post(`/proposals/${p.slug}/quality-check`).expect(200);
    expect(body<QualityRunDto>(same).id).toBe(first?.id);
    problem(await as(contributor).post(`/proposals/${p.slug}/quality-check`), 403, 'FORBIDDEN');
    problem(await as(reviewer).post('/proposals/no-such-slug/quality-check'), 404, 'NOT_FOUND');
    problem(await as(reviewer).post('/proposals/Bad_Slug/quality-check'), 400, 'VALIDATION_FAILED');

    // Past the lease the active run is lost: a new run supersedes it.
    await db.aiJob.update({
      where: { id: first?.id ?? '' },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    const res = await as(reviewer).post(`/proposals/${p.slug}/quality-check`).expect(202);
    const run = body<QualityRunDto>(res);
    expect(run).toMatchObject({ trigger: 'rerun', status: 'queued', current: true });
    expect(run.requestedBy?.name).toBe('q-reviewer');
    expect(await db.aiJob.findUniqueOrThrow({ where: { id: first?.id ?? '' } })).toMatchObject({
      status: 'failed',
      error: { code: 'superseded' },
    });
    problem(await jobInput(first?.id ?? ''), 409, 'PRECONDITION_FAILED');
    expect(queue.sent.map((e) => e.jobId)).toEqual([first?.id, run.id]);
    const audit = await db.auditEvent.findFirst({
      where: { action: 'quality.requested', subjectId: p.id },
    });
    expect(audit?.data).toEqual({ jobId: run.id, trigger: 'rerun' });
  });

  it('review works with the worker stopped and does not re-run a decided proposal', async () => {
    const p = await submit(await seedPage(), PROPOSED);
    const d = body<ProposalDetailDto>(await as(owner).get(`/proposals/${p.slug}`).expect(200));
    expect(d.quality.status).toBe('queued');
    if (!d.preview) throw new Error('no preview');
    const decided = await as(owner).post(`/proposals/${p.slug}/decisions`, {
      approve: true,
      reason: 'Checked',
      bundleHash: d.preview.binding.bundleHash,
      artifactHash: d.preview.binding.artifactHash,
      previewAt: d.preview.binding.previewAt,
      discussionVersion: d.preview.binding.discussionVersion,
      disputeVersion: d.preview.binding.disputeVersion,
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    expect(body<ProposalDetailDto>(decided)).toMatchObject({
      state: 'approved',
      can: { rerunQuality: false },
    });
    problem(await as(owner).post(`/proposals/${p.slug}/quality-check`), 409, 'PRECONDITION_FAILED');
  });

  it('findings are visible to the submitter and reviewers only', async () => {
    const page = await seedPage();
    const ctx = await contextOf(page);
    const res = await as(contributor).post('/contributions', {
      targetPath: page,
      base: { versionLabel: ctx.versionLabel, sha256: ctx.sha256 },
      content: PROPOSED,
      reason: 'Fix units',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const slug = body<ProposalDto>(res).slug;
    expect((await report(slug, contributor)).can.rerun).toBe(false);
    expect((await report(slug, reviewer)).can.rerun).toBe(true);
    problem(await as(other).get(`/proposals/${slug}/findings`), 404, 'NOT_FOUND');
  });
});

describe('author self-check on drafts (§7.6.6)', () => {
  it('checks the composed draft, reuses an unchanged active run and goes stale on edit', async () => {
    const page = await seedPage();
    const author = await db.user.findFirstOrThrow({
      where: { email: 'q-contributor@example.org' },
    });
    const seen: WireEvent[] = [];
    const sub = app
      ?.get(EventsService)
      .stream({ id: author.id, roles: ['contributor'] }, 3_600_000)
      .subscribe(({ data }) => seen.push(data));
    const draft = body<DraftDto>(
      await as(contributor).post('/drafts', { targetPath: page, section: 'detectors' }).expect(201),
    );
    const first = body<QualityRunDto>(
      await as(contributor).post(`/drafts/${draft.id}/self-check`).expect(202),
    );
    expect(first).toMatchObject({ trigger: 'self_check', status: 'queued', current: true });
    const job = await db.aiJob.findUniqueOrThrow({ where: { id: first.id } });
    expect(job).toMatchObject({ draftId: draft.id, proposalId: null });
    const input = (job.input as unknown as QualityCheckInput).blocks;
    expect(input.map((b) => b.id)).toEqual(['proposed', 'base']);
    const again = await as(contributor).post(`/drafts/${draft.id}/self-check`).expect(200);
    expect(body<QualityRunDto>(again).id).toBe(first.id);
    // A self-check event reaches its author only, never reviewers (§7.6.7).
    expect(seen.some((e) => e.type === 'quality.changed' && e.draftId === draft.id)).toBe(true);
    expect(events.some((e) => e.draftId === draft.id)).toBe(false);
    sub?.unsubscribe();

    await jobInput(first.id).expect(200);
    await jobResult(
      first.id,
      ok([finding({ rule: 'unsourced-claim', quote: { block: 'proposed', text: 'PMT' } })]),
    ).expect(204);
    let r = body<QualityReportDto>(
      await as(contributor).get(`/drafts/${draft.id}/self-check`).expect(200),
    );
    expect(r.subject).toEqual({ kind: 'draft', id: draft.id, slug: null });
    expect(r.summary).toMatchObject({ status: 'succeeded', findings: 1, current: true });

    const saved = await as(contributor).patch(
      `/drafts/${draft.id}`,
      { content: '## Detectors\n\nHyD detectors are used.\n', reason: 'Detector type' },
      { 'If-Match': `"${draft.updatedAt}"` },
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    r = body<QualityReportDto>(
      await as(contributor).get(`/drafts/${draft.id}/self-check`).expect(200),
    );
    expect(r.current).toBeNull();
    expect(r.latest).toMatchObject({ id: first.id, current: false });
    expect(r.summary).toMatchObject({ findings: 0, current: false });
    const second = body<QualityRunDto>(
      await as(contributor).post(`/drafts/${draft.id}/self-check`).expect(202),
    );
    expect(second.id).not.toBe(first.id);
    const input2 = await db.aiJob.findUniqueOrThrow({ where: { id: second.id } });
    expect((input2.input as unknown as QualityCheckInput).blocks.map((b) => b.id)).toEqual([
      'reason',
      'proposed',
      'base',
    ]);

    problem(await as(other).post(`/drafts/${draft.id}/self-check`), 404, 'NOT_FOUND');
    problem(await as(other).get(`/drafts/${draft.id}/self-check`), 404, 'NOT_FOUND');
    // The ops list shows a draft run without its path or title.
    const jobs = body<JobListDto>(await as(owner).get('/ops/jobs?limit=100').expect(200));
    expect(jobs.items.find((i) => i.id === first.id)?.subject).toEqual({
      kind: 'draft',
      slug: null,
      title: null,
    });
  });
});

describe('admin and operations (§7.6.7)', () => {
  it('reports models from the shared env without secrets, and the rules file', async () => {
    const models = body<ModelsDto>(await as(owner).get('/admin/models').expect(200));
    expect(models.jobs).toEqual([
      {
        kind: 'quality_check',
        provider: 'anthropic',
        model: 'claude-test-model',
        maxTokens: 4096,
        timeoutS: 120,
        maxAttempts: 3,
        overridden: true,
      },
    ]);
    expect(models.openaiCompat.baseUrl).toBe('http://models.internal:8000');
    expect(models.lastUsed[0]).toMatchObject({ kind: 'quality_check', provider: 'fake' });
    const rules = body<RulesDto>(await as(owner).get('/admin/rules').expect(200));
    expect(rules).toMatchObject({ path: 'rules/quality.md', sha256: RULES_SHA, error: null });
    expect(rules.rules.map((r) => r.id)).toContain('dropped-hedge');
    problem(await as(reviewer).get('/admin/models'), 403, 'FORBIDDEN');
    problem(await as(reviewer).get('/admin/rules'), 403, 'FORBIDDEN');
  });

  it('lists jobs newest first with per-kind summaries, filters and a cursor', async () => {
    const all = body<JobListDto>(await as(owner).get('/ops/jobs?limit=2').expect(200));
    expect(all.items).toHaveLength(2);
    expect(all.nextCursor).not.toBeNull();
    const next = body<JobListDto>(
      await as(owner)
        .get(`/ops/jobs?limit=2&cursor=${encodeURIComponent(all.nextCursor ?? '')}`)
        .expect(200),
    );
    expect((next.items[0]?.createdAt ?? '') <= (all.items[1]?.createdAt ?? '')).toBe(true);
    const kinds = all.kinds.map((k) => k.kind);
    expect(kinds).toEqual(['quality_check']);
    const qc = all.kinds[0];
    expect(qc?.queued).toBeGreaterThan(0);
    expect(qc?.failed24h).toBeGreaterThan(0);
    expect(qc?.last?.status).toMatch(/succeeded|failed/);
    const failed = body<JobListDto>(await as(owner).get('/ops/jobs?status=failed').expect(200));
    expect(failed.items.every((i) => i.status === 'failed')).toBe(true);
    const done = failed.items.find((i) => i.error?.code === 'provider_timeout');
    expect(done?.subject?.kind).toBe('proposal');
    problem(await as(owner).get('/ops/jobs?status=bogus'), 400, 'VALIDATION_FAILED');
    problem(await as(owner).get('/ops/jobs?cursor=x'), 400, 'VALIDATION_FAILED');
    problem(await as(reviewer).get('/ops/jobs'), 403, 'FORBIDDEN');
  });
});
