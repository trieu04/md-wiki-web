/* eslint-disable @typescript-eslint/no-misused-spread -- response DTO classes are plain JSON at runtime */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentRuns } from '../src/agent/agent-runs.service.js';
import type {
  AgentMetricsDto,
  EscalationStateDto,
  InboxDto,
  ReviewSettingsDto,
  SpotCheckDto,
} from '../src/agent/agent.dto.js';
import { EscalationsService } from '../src/agent/escalations.service.js';
import { ReviewSettingsService } from '../src/agent/settings.service.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { LoginDto } from '../src/auth/identity.dto.js';
import { API_CONFIG, loadConfig, type ApiConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import type { ProposalDto } from '../src/contributions/contributions.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { ProposalDetailDto } from '../src/review/review.dto.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import { FixtureStorage } from '../src/wiki/storage/fixture-storage.js';
import { wikiPath } from '../src/wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../src/wiki/wiki.module.js';
import { NO_QUEUE } from './no-queue.js';
import { testSchema } from './test-schema.js';

/** Self-managed review (system-logic §7.8): the reviewer agent, triggers, escalation, inbox. */

const database = testSchema();
const email = 'agent-owner@example.org';
const password = 'agent test password';
const AGENT_TOKEN = 'mwt_AgEnT001_abcdefghijklmnopqrstuvwxyz012345';
const storage = new FixtureStorage();
let config: ApiConfig;
let app: INestApplication | undefined;
let db: PrismaService;
let owner: Session;
let contributor: Session;
let agentId = '';
type Session = { cookie: string; csrf: string };
type Caller = Session | string;

const http = () => request(app?.getHttpServer() as Parameters<typeof request>[0]);
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed response bodies
const body = <T>(res: Response) => res.body as T;
function as(who: Caller) {
  const auth = (r: request.Test) =>
    typeof who === 'string'
      ? r.set('Authorization', `Bearer ${who}`)
      : r.set('Cookie', who.cookie).set('X-CSRF-Token', who.csrf);
  return {
    get: (url: string) => auth(http().get(`/api/v1${url}`)),
    post: (url: string, data: object = {}) => auth(http().post(`/api/v1${url}`)).send(data),
    patch: (url: string, data: object = {}) => auth(http().patch(`/api/v1${url}`)).send(data),
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

let counter = 0;
async function seedPage(text = '# Page\n\nIntro.\n\n## Detectors\n\nPMT.\n') {
  const path = `a${String(++counter)}.md`;
  const target = wikiPath(path);
  await storage.write(target, Buffer.from(text), { kind: 'create' }, {});
  await app?.get(WikiIndexer).observe(target);
  return path;
}
async function submit(path: string, content: string): Promise<ProposalDto> {
  const ctx = body<{ versionLabel: string; sha256: string }>(
    await as(contributor)
      .get(`/context?path=${encodeURIComponent(path)}`)
      .expect(200),
  );
  const res = await as(contributor).post('/contributions', {
    targetPath: path,
    base: { versionLabel: ctx.versionLabel, sha256: ctx.sha256 },
    content,
    reason: `Change ${path}`,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return body<ProposalDto>(res);
}
async function detail(slug: string, who: Caller = owner) {
  const res = await as(who).get(`/proposals/${slug}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return body<ProposalDetailDto>(res);
}
async function decide(slug: string, who: Caller, approve = true) {
  const d = await detail(slug, who);
  if (!d.preview) throw new Error('no preview');
  return as(who).post(`/proposals/${slug}/decisions`, {
    approve,
    reason: approve ? 'Checked the source' : 'Needs changes',
    ...d.preview.binding,
  });
}
/** A succeeded quality run for the proposal's current bundle, so `quality_missing` is quiet. */
async function checked(slug: string) {
  const p = await db.proposal.findUniqueOrThrow({ where: { slug } });
  await db.aiJob.create({
    data: {
      kind: 'quality_check',
      status: 'succeeded',
      trigger: 'submit',
      proposalId: p.id,
      bundleHash: p.bundleHash,
      input: {},
      finishedAt: new Date(),
    },
  });
}
function code(res: Response, expected: string) {
  expect((res.body as { code?: string }).code, JSON.stringify(res.body)).toBe(expected);
}
/** Finish the quality run submit queued, so the agent's after_check round is due. */
async function qualityDone(proposalId: string) {
  await db.aiJob.updateMany({
    where: { proposalId, kind: 'quality_check' },
    data: { status: 'succeeded', finishedAt: new Date() },
  });
}
const settings = (patch: object) =>
  as(owner).patch('/admin/review-settings', patch).expect(200);

beforeAll(async () => {
  database.migrate();
  config = {
    ...loadConfig(),
    DATABASE_URL: database.url,
    WIKI_ROOT: '/nonexistent',
    OWNER_EMAIL: email,
    OWNER_PASSWORD: password,
    AUTO_PUBLISH: false,
    REVIEWER_AGENT_EMAIL: 'reviewer-agent@agents.example.org',
    REVIEWER_AGENT_TOKEN: AGENT_TOKEN,
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config)
    .overrideProvider(NO_QUEUE.provide)
    .useValue(NO_QUEUE.value)
    .overrideProvider(WIKI_STORAGE)
    .useValue(storage)
    .compile();
  app = module.createNestApplication();
  configureHttp(app, { public: true });
  await app.get(AuthService).seedOwner();
  await app.get(ReviewSettingsService).seed();
  // Seeding twice is a no-op (same token, same user).
  await app.get(ReviewSettingsService).seed();
  await app.get(WikiIndexer).reindex();
  await app.init();
  db = app.get(PrismaService);
  owner = await login(email, password);
  await as(owner)
    .post('/admin/users', {
      email: 'contrib@example.org',
      name: 'contrib',
      roles: ['contributor'],
      teamId: null,
      password: 'pw-12345678',
    })
    .expect(201);
  contributor = await login('contrib@example.org', 'pw-12345678');
  agentId = (await db.user.findFirstOrThrow({ where: { email: config.REVIEWER_AGENT_EMAIL } })).id;
}, 60_000);

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.drop();
  }
});

beforeEach(async () => {
  await as(owner).post('/admin/agent/pause', { paused: false }).expect(200);
  await settings({ reviewModel: 'self_managed', spotCheckRate: 0 });
});

describe('the reviewer agent (§7.8.2)', () => {
  it('is seeded once with one token and reported available', async () => {
    const tokens = await db.apiToken.findMany({ where: { userId: agentId } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.scopes).toEqual(['read', 'discuss', 'review']);
    const s = body<ReviewSettingsDto>(await as(owner).get('/admin/review-settings').expect(200));
    expect(s).toMatchObject({ reviewModel: 'self_managed', agent: { paused: false, available: true } });
  });

  it('is assigned new proposals and owes a review job', async () => {
    const p = await submit(await seedPage(), '# Page\n\nIntro, fixed.\n\n## Detectors\n\nPMT.\n');
    const open = await db.assignment.findMany({ where: { proposalId: p.id, closedAt: null } });
    expect(open.map((a) => a.assigneeId)).toEqual([agentId]);
    // While the quality check is queued the agent waits (after_check).
    expect(await app?.get(AgentRuns).reconcile(p.id)).toBeNull();
    await qualityDone(p.id);
    await app?.get(AgentRuns).reconcile(p.id);
    const jobs = await db.aiJob.findMany({ where: { proposalId: p.id, kind: 'agent_review' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.trigger).toBe('after_check');
    // Reconciling again does not create a second job for the same round.
    await app?.get(AgentRuns).reconcile(p.id);
    expect(await db.aiJob.count({ where: { proposalId: p.id, kind: 'agent_review' } })).toBe(1);
  });

  it('goes to a human under the human review model', async () => {
    await settings({ reviewModel: 'human' });
    const p = await submit(await seedPage(), '# Page\n\nIntro, human.\n\n## Detectors\n\nPMT.\n');
    const open = await db.assignment.findMany({ where: { proposalId: p.id, closedAt: null } });
    expect(open.map((a) => a.assigneeId)).not.toContain(agentId);
  });
});

describe('mandatory triggers and escalation (§7.8.3–§7.8.5)', () => {
  it('refuses an agent approval without a current quality check, then escalates', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nIntro, sharper.\n\n## Detectors\n\nPMT.\n');
    const refused = await decide(p.slug, AGENT_TOKEN);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body).toMatchObject({ code: 'ESCALATION_REQUIRED' });
    const fields = (refused.body as { fields: { code: string }[] }).fields.map((f) => f.code);
    expect(fields).toContain('quality_missing');
    expect(
      await db.auditEvent.count({ where: { action: 'agent.refused', subjectId: p.id } }),
    ).toBe(1);

    const escalated = await as(AGENT_TOKEN)
      .post(`/proposals/${p.slug}/escalations`, {
        kind: 'rereview',
        reason: 'Needs a quality check before anyone approves it.',
        bundleHash: p.bundleHash,
        triggers: ['quality_missing'],
      })
      .expect(201);
    const state = body<EscalationStateDto>(escalated);
    expect(state.escalations[0]).toMatchObject({ kind: 'rereview', resolvedAt: null });
    expect(state.escalations[0]?.triggers).toContain('quality_missing');
    // The agent handed over: the owner (the fallback page author) now holds it.
    const open = await db.assignment.findMany({ where: { proposalId: p.id, closedAt: null } });
    expect(open.map((a) => a.assigneeId)).not.toContain(agentId);
    const inbox = body<InboxDto>(await as(owner).get('/inbox?tab=decide').expect(200));
    const item = inbox.items.find((i) => i.proposal?.slug === p.slug);
    expect(item).toMatchObject({ tab: 'decide', done: false });
    expect(item?.agentNotes ?? item?.why).toBeTruthy();

    // A second open rereview escalation is refused; the agent can no longer decide.
    await as(owner)
      .post(`/proposals/${p.slug}/escalations`, {
        kind: 'rereview',
        reason: 'again',
        bundleHash: p.bundleHash,
      })
      .expect(409)
      .expect((res) => { code(res, 'ALREADY_EXISTS'); });
    code(await decide(p.slug, AGENT_TOKEN), 'NOT_ASSIGNED');

    // A human is not bound by the triggers; approving resolves the escalation.
    expect((await decide(p.slug, owner)).status).toBe(201);
    const after = await db.escalation.findFirstOrThrow({ where: { proposalId: p.id } });
    expect(after.resolvedAt).not.toBeNull();
  });

  it('refuses an escalation on a stale bundle hash and unknown triggers', async () => {
    const p = await submit(await seedPage(), '# Page\n\nIntro, stale.\n\n## Detectors\n\nPMT.\n');
    await as(AGENT_TOKEN)
      .post(`/proposals/${p.slug}/escalations`, {
        kind: 'rereview',
        reason: 'x',
        bundleHash: 'f'.repeat(64),
      })
      .expect(409)
      .expect((res) => { code(res, 'PRECONDITION_FAILED'); });
    await as(AGENT_TOKEN)
      .post(`/proposals/${p.slug}/escalations`, {
        kind: 'rereview',
        reason: 'x',
        bundleHash: p.bundleHash,
        triggers: ['no-such-trigger'],
      })
      .expect(400);
  });
});

describe('stop switch (D-211)', () => {
  it('gates every agent decision and escalation while paused', async () => {
    const p = await submit(await seedPage(), '# Page\n\nIntro, paused.\n\n## Detectors\n\nPMT.\n');
    await checked(p.slug);
    await as(owner).post('/admin/agent/pause', { paused: true, reason: 'audit' }).expect(200);
    const s = body<ReviewSettingsDto>(await as(owner).get('/admin/review-settings').expect(200));
    expect(s.agent.paused).toBe(true);
    code(await decide(p.slug, AGENT_TOKEN), 'PRECONDITION_FAILED');
    await as(AGENT_TOKEN)
      .post(`/proposals/${p.slug}/escalations`, {
        kind: 'rereview',
        reason: 'x',
        bundleHash: p.bundleHash,
      })
      .expect(409)
      .expect((res) => { code(res, 'PRECONDITION_FAILED'); });
    // Resuming restores the agent's right to decide.
    await as(owner).post('/admin/agent/pause', { paused: false }).expect(200);
    expect((await decide(p.slug, AGENT_TOKEN)).status).toBe(201);
  });

  it('only the owner manages review settings, with validated values', async () => {
    await as(contributor).get('/admin/review-settings').expect(403);
    await as(owner).patch('/admin/review-settings', { spotCheckRate: 1.5 }).expect(400);
    await as(owner).patch('/admin/review-settings', { reminderDays: 0 }).expect(400);
  });
});

describe('spot checks of agent approvals (§7.8.7)', () => {
  it('samples a published agent approval and records a failed check once', async () => {
    await settings({ spotCheckRate: 1 });
    const p = await submit(await seedPage(), '# Page\n\nIntro, spot.\n\n## Detectors\n\nPMT.\n');
    await checked(p.slug);
    expect((await decide(p.slug, AGENT_TOKEN)).status).toBe(201);
    await as(owner).post(`/proposals/${p.slug}/publish`).expect(200);
    let spot: { id: string } | null = null;
    for (let i = 0; i < 50 && !spot; i++) {
      spot = await db.spotCheck.findFirst({ where: { proposalId: p.id } });
      if (!spot) await new Promise((r) => setTimeout(r, 20));
    }
    expect(spot).not.toBeNull();
    const id = spot?.id ?? '';
    const inbox = body<InboxDto>(await as(owner).get('/inbox?tab=spot').expect(200));
    expect(inbox.items.some((i) => i.spotCheckId === id)).toBe(true);

    await as(AGENT_TOKEN)
      .post(`/spot-checks/${id}/outcome`, { outcome: 'passed', reason: 'mine' })
      .expect(403);
    await as(owner)
      .post(`/spot-checks/${id}/outcome`, { outcome: 'failed', reason: 'x', anchors: ['nope'] })
      .expect(400);
    const decided = body<SpotCheckDto>(
      await as(owner)
        .post(`/spot-checks/${id}/outcome`, { outcome: 'failed', reason: 'Claim unsupported' })
        .expect(200),
    );
    expect(decided).toMatchObject({ outcome: 'failed', canDecide: false });
    await as(owner)
      .post(`/spot-checks/${id}/outcome`, { outcome: 'passed', reason: 'again' })
      .expect(409)
      .expect((res) => { code(res, 'PRECONDITION_FAILED'); });

    const metrics = body<AgentMetricsDto>(await as(owner).get('/ops/agent?days=7').expect(200));
    expect(metrics.approved).toBeGreaterThanOrEqual(1);
    expect(metrics.spotChecks.failed).toBe(1);
    expect(metrics.approvalErrorRate).not.toBeNull();
  });
});

describe('reminders (D-212)', () => {
  it('reminds open escalations older than the reminder window, once per window', async () => {
    const p = await submit(await seedPage(), '# Page\n\nIntro, remind.\n\n## Detectors\n\nPMT.\n');
    await as(AGENT_TOKEN)
      .post(`/proposals/${p.slug}/escalations`, {
        kind: 'rereview',
        reason: 'Unsure',
        bundleHash: p.bundleHash,
      })
      .expect(201);
    const escalations = app?.get(EscalationsService);
    const later = new Date(Date.now() + 3 * 86_400_000);
    await escalations?.remind();
    await escalations?.remind(later);
    await escalations?.remind(later);
    const e = await db.escalation.findFirstOrThrow({ where: { proposalId: p.id } });
    expect(e.reminders).toBe(1);
  });
});
