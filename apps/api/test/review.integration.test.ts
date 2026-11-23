/* eslint-disable @typescript-eslint/no-misused-spread -- response DTO classes are plain JSON at runtime */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { parseStatusBlock, type WikiPath } from '@md-wiki/domain';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { CreatedTokenDto, LoginDto } from '../src/auth/identity.dto.js';
import { AppError } from '../src/common/app-error.js';
import { API_CONFIG, loadConfig, type ApiConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import type { ProposalDto } from '../src/contributions/contributions.dto.js';
import { EventsService } from '../src/events/events.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  DISCUSSION_STATE,
  ESCALATION_TRIGGERS,
  PUBLISH_HOOKS,
  type CrashPoint,
} from '../src/review/ports.js';
import { PublishService } from '../src/review/publish.service.js';
import type {
  AuditPageDto,
  BlockedListDto,
  ConflictResultDto,
  ProposalDetailDto,
  ProposalDiffDto,
  ProposalListDto,
} from '../src/review/review.dto.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import type { HistoryDto, PageDto, RecentDto } from '../src/wiki/read.dto.js';
import { FixtureStorage } from '../src/wiki/storage/fixture-storage.js';
import { wikiPath } from '../src/wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../src/wiki/wiki.module.js';
import { testSchema } from './test-schema.js';

/**
 * Review and publish (system-logic §7.4), ported from md-wiki tests/test_workflow.py and
 * test_context.py review/publish/recovery/conflict cases, plus fault injection for every phase.
 */

const database = testSchema();
const email = 'review-owner@example.org';
const password = 'review test password';
const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

class Crash extends Error {}
/** FixtureStorage with test-only controls: a failing read and a callback after one read. */
class TestStorage extends FixtureStorage {
  readFails = new Set<string>();
  afterRead: ((path: string) => Promise<void>) | null = null;
  override async read(path: WikiPath) {
    if (this.readFails.has(path.path)) throw new AppError('STORAGE_ERROR', 'read denied');
    try {
      return await super.read(path);
    } finally {
      // Runs after the read (found or absent): another writer acts between read and write.
      const hook = this.afterRead;
      if (hook) {
        this.afterRead = null;
        await hook(path.path);
      }
    }
  }
  /** An out-of-band edit (another writer): conditional on whatever is there now. */
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
  async text(path: string) {
    return (await super.read(wikiPath(path))).content.toString('utf8');
  }
}

const storage = new TestStorage();
const hooks = {
  crashAt: null as CrashPoint | null,
  at(point: CrashPoint) {
    if (hooks.crashAt !== point) return;
    hooks.crashAt = null;
    throw new Crash(`simulated crash at ${point}`);
  },
};
const discussion = { discussionVersion: 0, disputeVersion: 0, disputed: false, calls: 0 };
const triggers = { firing: [] as string[] };
let config: ApiConfig;
let app: INestApplication | undefined;
let db: PrismaService;
let owner: Session;
let reviewer: Session;
let publisher: Session;
let contributor: Session;
let agentToken = '';
let reviewerAgentToken = '';
let reviewerAgentId = '';
let ownerId = '';
type Session = { cookie: string; csrf: string };

const http = () => request(app?.getHttpServer() as Parameters<typeof request>[0]);
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed response bodies
const body = <T>(res: Response) => res.body as T;
type Caller = Session | string;
function as(who: Caller) {
  const auth = (r: request.Test) =>
    typeof who === 'string'
      ? r.set('Authorization', `Bearer ${who}`)
      : r.set('Cookie', who.cookie).set('X-CSRF-Token', who.csrf);
  return {
    get: (url: string) => auth(http().get(`/api/v1${url}`)),
    post: (url: string, data: object = {}) => auth(http().post(`/api/v1${url}`)).send(data),
  };
}
function problem(res: Response, status: number, code: string, fieldCode?: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.headers['content-type']).toContain('application/problem+json');
  expect(res.body).toMatchObject({ code });
  if (fieldCode)
    expect((res.body as { fields: { code: string }[] }).fields.map((f) => f.code)).toContain(
      fieldCode,
    );
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
/** A fresh page per test, indexed like an existing wiki file. */
async function seedPage(text = '# Page\n\nIntro.\n\n## Detectors\n\nPMT.\n\n## Other\n\nX.\n') {
  const path = `p${String(++counter)}.md`;
  await storage.put(path, text);
  await app?.get(WikiIndexer).observe(wikiPath(path));
  return path;
}
async function contextOf(path: string) {
  const ctx = await as(agentToken)
    .get(`/context?path=${encodeURIComponent(path)}`)
    .expect(200);
  return ctx.body as { versionLabel: string; sha256: string; content: string };
}
/** The author agent submits a whole-page edit (or a create when the page does not exist). */
async function submit(
  path: string,
  content: string,
  extra: Record<string, unknown> = {},
  who: Caller = agentToken,
): Promise<ProposalDto> {
  const exists = await db.page.findUnique({ where: { path } });
  const base = exists ? await contextOf(path) : null;
  const res = await as(who).post('/contributions', {
    targetPath: path,
    base: base ? { versionLabel: base.versionLabel, sha256: base.sha256 } : null,
    content,
    reason: `Change ${path}`,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return body<ProposalDto>(res);
}
async function detail(slug: string, who: Caller = owner) {
  const res = await as(who).get(`/proposals/${slug}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return body<ProposalDetailDto>(res);
}
async function decide(
  slug: string,
  approve = true,
  who: Caller = owner,
  override: Record<string, unknown> = {},
) {
  const d = await detail(slug, who);
  if (!d.preview) throw new Error('no preview');
  return as(who).post(`/proposals/${slug}/decisions`, {
    approve,
    reason: approve ? 'Checked source' : 'Needs changes',
    ...d.preview.binding,
    ...override,
  });
}
async function approve(slug: string, who: Caller = owner) {
  const res = await decide(slug, true, who);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return body<ProposalDetailDto>(res);
}
async function publish(slug: string, who: Caller = publisher) {
  const res = await as(who).post(`/proposals/${slug}/publish`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return body<ProposalDetailDto>(res);
}
const writes = () => storage.receipts.size;
function autoPublish(on: boolean) {
  config.AUTO_PUBLISH = on;
}

beforeAll(async () => {
  database.migrate();
  config = {
    ...loadConfig(),
    DATABASE_URL: database.url,
    WIKI_ROOT: '/nonexistent',
    OWNER_EMAIL: email,
    OWNER_PASSWORD: password,
    AUTO_PUBLISH: false,
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config)
    .overrideProvider(WIKI_STORAGE)
    .useValue(storage)
    .overrideProvider(PUBLISH_HOOKS)
    .useValue(hooks)
    .overrideProvider(DISCUSSION_STATE)
    .useValue({
      state: () => {
        discussion.calls++;
        return Promise.resolve({
          discussionVersion: discussion.discussionVersion,
          disputeVersion: discussion.disputeVersion,
          disputed: discussion.disputed,
        });
      },
    })
    .overrideProvider(ESCALATION_TRIGGERS)
    .useValue({ firing: () => Promise.resolve(triggers.firing) })
    .compile();
  app = module.createNestApplication();
  configureHttp(app, { public: true });
  await app.get(AuthService).seedOwner();
  await app.get(WikiIndexer).reindex();
  await app.init();
  db = app.get(PrismaService);
  owner = await login(email, password);
  ownerId = (await db.user.findFirstOrThrow({ where: { email } })).id;
  for (const [address, roles] of [
    ['reviewer@example.org', ['reviewer']],
    ['publisher@example.org', ['publisher']],
    ['contributor@example.org', ['contributor']],
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
  reviewer = await login('reviewer@example.org', 'pw-12345678');
  publisher = await login('publisher@example.org', 'pw-12345678');
  contributor = await login('contributor@example.org', 'pw-12345678');
  const author = await db.user.create({
    data: {
      email: 'author-agent@example.org',
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
  const bot = await db.user.create({
    data: {
      email: 'reviewer-agent@example.org',
      name: 'reviewer-agent',
      kind: 'agent',
      roles: ['reviewer'],
    },
  });
  reviewerAgentId = bot.id;
  reviewerAgentToken = body<CreatedTokenDto>(
    await as(owner)
      .post('/admin/tokens', { userId: bot.id, name: 'r', scopes: ['read', 'review'] })
      .expect(201),
  ).token;
}, 60_000);

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.drop();
  }
});

beforeEach(() => {
  autoPublish(false);
  hooks.crashAt = null;
  storage.fault = undefined;
  storage.readFails.clear();
  storage.afterRead = null;
  Object.assign(discussion, { discussionVersion: 0, disputeVersion: 0, disputed: false });
  triggers.firing = [];
});

describe('assignment and preview', () => {
  it('assigns the owner, previews the exact artifact and binds the decision to it', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nIntro, fixed.\n');
    const d = await detail(p.slug);
    expect(d.assignment).toMatchObject({ assignee: { id: ownerId }, reason: 'owner' });
    expect(d.tab).toBe('open');
    expect(d.can).toMatchObject({ decide: true, publish: false, withdraw: false });
    expect(d.preview?.binding).toMatchObject({
      bundleHash: p.bundleHash,
      discussionVersion: 0,
      disputeVersion: 0,
    });
    const preview = d.preview;
    if (!preview) throw new Error('preview');
    const parsed = parseStatusBlock(preview.artifact);
    expect(parsed.block).toMatchObject({
      proposal: p.slug,
      decision: preview.decisionId,
      reviewer: 'person',
      decided_at: preview.previewAt,
    });
    expect(parsed.body).toBe('# Page\n\nIntro, fixed.\n');
    expect(sha(preview.artifact)).toBe(preview.artifactHash);
    expect(d.refs[0]).toMatchObject({ role: 'target', path, current: true });
    expect(d.history.map((e) => e.action)).toEqual(['proposal.submitted', 'proposal.assigned']);
    // The reviewer who is not assigned may look but not decide; the submitter may withdraw.
    expect((await detail(p.slug, reviewer)).can.decide).toBe(false);
    expect((await detail(p.slug, agentToken)).can).toMatchObject({ decide: false, withdraw: true });
    // Another contributor cannot see it (D-63, D-86).
    problem(await as(contributor).get(`/proposals/${p.slug}`), 404, 'NOT_FOUND');
  });

  it('falls back to another reviewer when the only owner submitted, never self-review', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nOwner edit.\n', {}, owner);
    const d = await detail(p.slug);
    // Publisher outranks reviewer in the fallback (D-75).
    expect(d.assignment?.assignee.name).toBe('publisher');
    expect(d.assignment?.reason).toBe('fallback_reviewer');
    expect(d.can.decide).toBe(false);
    problem(await decide(p.slug, true, owner), 409, 'NOT_ASSIGNED');
    // Even with an assignment the submitter is refused (md-wiki test_self_review_and_unknown_reviewer).
    await db.assignment.create({ data: { proposalId: p.id, assigneeId: ownerId, reason: 'test' } });
    problem(await decide(p.slug, true, owner), 409, 'SELF_REVIEW');
    problem(await decide(p.slug, false, owner), 409, 'SELF_REVIEW');
  });

  it('heals a proposal that had nobody to assign once the rule picks the caller', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nHeal.\n');
    await db.assignment.updateMany({ where: { proposalId: p.id }, data: { closedAt: new Date() } });
    expect((await detail(p.slug)).assignment).toBeNull();
    problem(await decide(p.slug, true, reviewer), 409, 'NOT_ASSIGNED');
    const res = await decide(p.slug, false);
    expect(res.status).toBe(201);
    const d = body<ProposalDetailDto>(res);
    expect(d.state).toBe('rejected');
    expect(d.history.filter((e) => e.action === 'proposal.assigned')).toHaveLength(2);
  });
});

describe('decision guards (system-logic §7.4.3 order)', () => {
  it('checks role, existence, binding, versions and state', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nGuarded.\n');
    const binding = (await detail(p.slug)).preview?.binding;
    problem(
      await as(contributor).post(`/proposals/${p.slug}/decisions`, {
        approve: true,
        reason: 'x',
        ...binding,
      }),
      403,
      'FORBIDDEN',
    );
    problem(
      await as(owner).post('/proposals/no-such-proposal/decisions', {
        approve: true,
        reason: 'x',
        bundleHash: 'a'.repeat(64),
        artifactHash: 'a'.repeat(64),
        previewAt: new Date().toISOString(),
        discussionVersion: 0,
        disputeVersion: 0,
      }),
      404,
      'NOT_FOUND',
    );
    problem(await decide(p.slug, true, owner, { reason: '   ' }), 400, 'VALIDATION_FAILED');
    problem(await decide(p.slug, true, owner, { bogus: 1 }), 400, 'VALIDATION_FAILED');
    problem(
      await decide(p.slug, true, owner, { artifactHash: 'b'.repeat(64) }),
      409,
      'DECISION_BINDING_MISMATCH',
    );
    problem(
      await decide(p.slug, true, owner, { bundleHash: 'b'.repeat(64) }),
      409,
      'DECISION_BINDING_MISMATCH',
    );
    problem(
      await decide(p.slug, true, owner, { previewAt: new Date(Date.now() + 60_000).toISOString() }),
      409,
      'DECISION_BINDING_MISMATCH',
    );
    problem(await decide(p.slug, true, owner, { discussionVersion: 1 }), 409, 'DISCUSSION_CHANGED');
    // A preview read, then a discussion entry: the decision is stale (md-wiki "discussion changed").
    const d = await detail(p.slug);
    discussion.discussionVersion = 1;
    problem(
      await as(owner).post(`/proposals/${p.slug}/decisions`, {
        approve: false,
        reason: 'Old snapshot',
        ...d.preview?.binding,
      }),
      409,
      'DISCUSSION_CHANGED',
    );
    expect(discussion.calls).toBeGreaterThan(0);
    // Disputes block approval but not rejection.
    discussion.disputed = true;
    problem(await decide(p.slug, true), 409, 'DISPUTED');
    const rejected = await decide(p.slug, false);
    expect(rejected.status).toBe(201);
    expect(body<ProposalDetailDto>(rejected)).toMatchObject({
      state: 'rejected',
      tab: 'rejected',
      decisions: [{ approve: false, reviewerKind: 'person', discussionVersion: 1 }],
      assignment: null,
    });
    // md-wiki test_review_rechecks_state_after_preview.
    problem(
      await as(owner).post(`/proposals/${p.slug}/decisions`, {
        approve: true,
        reason: 'Approve the earlier preview',
        ...d.preview?.binding,
        discussionVersion: 1,
      }),
      409,
      'PRECONDITION_FAILED',
    );
    expect((await detail(p.slug)).preview).toBeNull();
  });

  it('replays the same decision idempotently and lets only one of two concurrent decisions win', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nOnce.\n');
    const d = await detail(p.slug);
    const input = { approve: false, reason: 'No', ...d.preview?.binding };
    expect((await as(owner).post(`/proposals/${p.slug}/decisions`, input)).status).toBe(201);
    expect((await as(owner).post(`/proposals/${p.slug}/decisions`, input)).status).toBe(200);
    problem(
      await as(owner).post(`/proposals/${p.slug}/decisions`, { ...input, approve: true }),
      409,
      'PRECONDITION_FAILED',
    );

    const q = await submit(await seedPage(), '# Page\n\nRace.\n');
    const [a, b] = await Promise.all([detail(q.slug), detail(q.slug)]);
    const results = await Promise.all(
      [a, b].map((x) =>
        as(owner).post(`/proposals/${q.slug}/decisions`, {
          approve: true,
          reason: 'Race',
          ...x.preview?.binding,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.decision.count({ where: { proposalId: q.id } })).toBe(1);
  });

  it('blocks approval on a changed target or source but allows rejection (md-wiki test_context)', async () => {
    const source = await seedPage('# Source\n\nPolicy: 30 days.\n');
    const path = await seedPage();
    const src = await contextOf(source);
    const p = await submit(path, '# Page\n\nPolicy is 30 days.\n', {
      sources: [{ path: source, versionLabel: src.versionLabel }],
    });
    const d = await detail(p.slug);
    await storage.put(source, '# Source\n\nPolicy: 7 days.\n');
    problem(
      await as(owner).post(`/proposals/${p.slug}/decisions`, {
        approve: true,
        reason: 'Approve',
        ...d.preview?.binding,
      }),
      409,
      'SOURCE_CHANGED',
      'SOURCE_CHANGED',
    );
    expect((await detail(p.slug)).refs[1]).toMatchObject({ role: 'source', current: false });

    const q = await submit(path, '# Page\n\nOther.\n');
    const e = await detail(q.slug);
    await storage.put(path, '# Page\n\nChanged outside.\n');
    problem(
      await as(owner).post(`/proposals/${q.slug}/decisions`, {
        approve: true,
        reason: 'Approve',
        ...e.preview?.binding,
      }),
      409,
      'STALE_BASE',
    );
    const rejected = await as(owner).post(`/proposals/${p.slug}/decisions`, {
      approve: false,
      reason: 'Source changed',
      ...d.preview?.binding,
    });
    expect(rejected.status).toBe(201);
  });

  it('refuses an agent approval while an escalation trigger fires', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nAgent reviewed.\n');
    await db.assignment.create({
      data: { proposalId: p.id, assigneeId: reviewerAgentId, reason: 'test' },
    });
    triggers.firing = ['claim_added_to_sourced_sentence'];
    const d = await detail(p.slug, reviewerAgentToken);
    expect(d.preview?.reviewerKind).toBe('agent');
    problem(await decide(p.slug, true, reviewerAgentToken), 409, 'ESCALATION_REQUIRED');
    triggers.firing = [];
    autoPublish(true);
    const res = await decide(p.slug, true, reviewerAgentToken);
    expect(res.status).toBe(201);
    const done = body<ProposalDetailDto>(res);
    expect(done).toMatchObject({ state: 'published', publication: { phase: 'done', auto: true } });
    const page = body<PageDto>(await as(owner).get(`/wiki/pages/${path}`).expect(200));
    expect(page.sections.every((s) => s.label.label === 'reviewed')).toBe(true);
    expect(page.sections[0]?.label.reviewerKind).toBe('agent');
  });
});

describe('publish (md-wiki test_workflow)', () => {
  it('publishes the exact artifact once, records sections, history and audit', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nIntro.\n\n## Detectors\n\nPMT and HyD.\n');
    const approved = await approve(p.slug);
    expect(approved).toMatchObject({ state: 'approved', tab: 'open', publication: null });
    expect(approved.can.publish).toBe(true); // AUTO_PUBLISH is off: a publisher publishes
    problem(await as(contributor).post(`/proposals/${p.slug}/publish`), 403, 'FORBIDDEN');
    const before = writes();
    const published = await publish(p.slug);
    expect(published).toMatchObject({
      state: 'published',
      tab: 'published',
      publication: { phase: 'done', auto: false, attempt: 1, error: null },
    });
    expect(await publish(p.slug)).toMatchObject({ state: 'published' });
    expect(writes()).toBe(before + 1);
    expect(await storage.text(path)).toBe(approved.final?.artifact);
    const sections = await db.publishedSection.findMany({ where: { path } });
    expect(sections.map((s) => s.anchor).sort()).toEqual(['detectors', 'page']);
    expect(sections.every((s) => s.reviewerKind === 'person')).toBe(true);

    const page = body<PageDto>(await as(contributor).get(`/wiki/pages/${path}`).expect(200));
    expect(page.changedOutsideReview).toBe(false);
    expect(page.markdown).toBe('# Page\n\nIntro.\n\n## Detectors\n\nPMT and HyD.\n');
    expect(page.sections.map((s) => [s.anchor, s.label.label, s.label.reviewerKind])).toEqual([
      ['page', 'reviewed', 'person'],
      ['detectors', 'reviewed', 'person'],
    ]);
    const history = body<HistoryDto>(
      await as(contributor).get(`/wiki/pages/${path}/history`).expect(200),
    );
    expect(history.items[0]).toMatchObject({
      versionLabel: published.publication?.versionLabel,
      publication: {
        proposalSlug: p.slug,
        reviewerKind: 'person',
        auto: false,
        sectionTitle: null,
      },
    });
    expect(history.items[1]?.publication).toBeNull();
    const recent = body<RecentDto>(await as(contributor).get('/wiki/recent?limit=100').expect(200));
    expect(recent.items.find((r) => r.path === path)).toMatchObject({
      proposalSlug: p.slug,
      summary: p.title,
    });
    expect(published.history.map((e) => e.action)).toEqual([
      'proposal.submitted',
      'proposal.assigned',
      'proposal.decided',
      'publication.prepared',
      'publication.writing',
      'publication.written',
      'proposal.published',
    ]);
    // Changed outside review: an out-of-band edit is flagged, and the next publish goes stale.
    await storage.put(path, '# Page\n\nEdited on disk.\n');
    await app?.get(WikiIndexer).reindex();
    expect(
      body<PageDto>(await as(contributor).get(`/wiki/pages/${path}`).expect(200))
        .changedOutsideReview,
    ).toBe(true);
  });

  it('makes the loser of two competing proposals stale and shows the conflict', async () => {
    const path = await seedPage('v1\n');
    const a = await submit(path, 'v1\nA\n');
    const b = await submit(path, 'v1\nB\n');
    await approve(a.slug);
    await approve(b.slug);
    await publish(a.slug);
    const stale = await publish(b.slug);
    expect(stale).toMatchObject({
      state: 'stale',
      tab: 'stale',
      publication: { phase: 'stale', error: 'base_changed' },
    });
    expect(stale.conflict).toMatchObject({
      scope: 'page',
      baseText: 'v1\n',
      currentText: 'v1\nA\n',
      proposedText: 'v1\nB\n',
      current: { publishedBy: { slug: a.slug, reviewerKind: 'person' } },
      resolution: null,
    });
    expect(stale.can.resolveConflict).toBe(true);
    expect((await detail(b.slug, agentToken)).can.resolveConflict).toBe(true);
  });

  it('never overwrites an edit that lands between the read and the write (race after read)', async () => {
    const path = await seedPage('Base\n');
    const p = await submit(path, 'Base\nMine\n');
    await approve(p.slug);
    storage.afterRead = async (read) => {
      if (read === path) await storage.put(path, 'External edit\n');
    };
    const res = await publish(p.slug);
    expect(res).toMatchObject({ state: 'stale', publication: { phase: 'stale' } });
    expect(await storage.text(path)).toBe('External edit\n');
  });

  it('preserves a file created by someone else after a create proposal was approved', async () => {
    const path = `new-${String(++counter)}.md`;
    const p = await submit(path, '# New\n');
    expect(p.base).toBeNull();
    await approve(p.slug);
    storage.afterRead = async (read) => {
      if (read === path) await storage.put(path, 'External create\n');
    };
    expect(await publish(p.slug)).toMatchObject({ state: 'stale' });
    expect(await storage.text(path)).toBe('External create\n');
  });

  it('does not treat a failed read as absence (no phase, no write)', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nRead fails.\n');
    await approve(p.slug);
    storage.readFails.add(path);
    const before = writes();
    problem(await as(publisher).post(`/proposals/${p.slug}/publish`), 500, 'STORAGE_ERROR');
    expect(await db.publication.count({ where: { proposalId: p.id } })).toBe(0);
    expect((await detail(p.slug)).state).toBe('approved');
    expect(writes()).toBe(before);
  });

  it('refuses a tampered approved artifact and writes nothing', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nTamper.\n');
    await approve(p.slug);
    await db.proposal.update({
      where: { id: p.id },
      data: { artifact: new Uint8Array(Buffer.from('tampered')) },
    });
    problem(await as(publisher).post(`/proposals/${p.slug}/publish`), 409, 'PRECONDITION_FAILED');
    expect(await db.publication.count({ where: { proposalId: p.id } })).toBe(0);
  });

  it('goes stale when a source changes after approval (md-wiki test_changed_source_after_approval)', async () => {
    const source = await seedPage('# Source\n\nA.\n');
    const path = `new-${String(++counter)}.md`;
    const src = await contextOf(source);
    const p = await submit(path, '# New\n', {
      sources: [{ path: source, versionLabel: src.versionLabel }],
    });
    await approve(p.slug);
    await storage.put(source, '# Source\n\nB.\n');
    expect(await publish(p.slug)).toMatchObject({
      state: 'stale',
      publication: { error: 'source_changed' },
    });
    await expect(storage.text(path)).rejects.toThrow();
  });
});

describe('unknown outcome, blocked target and resolution', () => {
  it('blocks the target until the owner resolves; other targets still publish (md-wiki test_unknown_write)', async () => {
    const path = await seedPage('Base\n');
    const other = await seedPage('Other\n');
    const p1 = await submit(path, 'Base\n1\n');
    const p2 = await submit(path, 'Base\n2\n');
    const p3 = await submit(other, 'Other\n3\n');
    for (const p of [p1, p2, p3]) await approve(p.slug);
    storage.fault = 'beforeRename';
    const blocked = await publish(p1.slug);
    expect(blocked).toMatchObject({
      state: 'approved',
      tab: 'blocked',
      publication: { phase: 'unknown', error: 'outcome_unknown:STORAGE_ERROR' },
      can: { publish: false, resolveBlocked: false },
    });
    // Only the owner (admin.recovery) may conclude what happened.
    expect((await detail(p1.slug)).can.resolveBlocked).toBe(true);
    // Recovery at "restart" leaves it blocked: nothing is retried blindly.
    await app?.get(PublishService).recover();
    expect((await detail(p1.slug)).publication?.phase).toBe('unknown');
    problem(await as(publisher).post(`/proposals/${p2.slug}/publish`), 409, 'TARGET_BLOCKED');
    expect((await detail(p2.slug)).blockedBy).toEqual({ slug: p1.slug, phase: 'unknown' });
    expect(await publish(p3.slug)).toMatchObject({ state: 'published' });
    const q = await submit(path, 'Base\n4\n');
    problem(await decide(q.slug, true), 409, 'TARGET_BLOCKED');

    const list = body<BlockedListDto>(await as(owner).get('/ops/blocked').expect(200));
    expect(list.items.find((i) => i.slug === p1.slug)).toMatchObject({
      targetPath: path,
      old: { sha256: sha('Base\n') },
      disk: { sha256: sha('Base\n'), matches: 'old' },
      waiting: [p2.slug],
    });
    problem(await as(publisher).get('/ops/blocked'), 403, 'FORBIDDEN');
    const tabs = body<ProposalListDto>(await as(owner).get('/proposals?tab=blocked').expect(200));
    expect(tabs.items.map((i) => i.slug)).toContain(p1.slug);
    expect(tabs.counts.blocked).toBeGreaterThanOrEqual(1);

    // "Matching content is insufficient" inverted: the bytes on disk disprove `written`.
    problem(
      await as(owner).post(`/ops/blocked/${p1.slug}/resolution`, {
        outcome: 'written',
        evidence: 'Content hash matches',
      }),
      409,
      'PRECONDITION_FAILED',
    );
    problem(
      await as(owner).post(`/ops/blocked/${p1.slug}/resolution`, {
        outcome: 'not_written',
        evidence: ' ',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const resolved = await as(owner)
      .post(`/ops/blocked/${p1.slug}/resolution`, {
        outcome: 'not_written',
        evidence: 'File still has the old hash',
      })
      .expect(200);
    expect(body<ProposalDetailDto>(resolved)).toMatchObject({
      state: 'approved',
      tab: 'open',
      publication: {
        phase: 'not_written',
        resolution: { outcome: 'not_written', diskSha256: sha('Base\n') },
      },
    });
    problem(
      await as(owner).post(`/ops/blocked/${p1.slug}/resolution`, {
        outcome: 'not_written',
        evidence: 'again',
      }),
      409,
      'PRECONDITION_FAILED',
    );
    // An explicit retry after the owner's conclusion publishes; the waiting proposal goes stale.
    expect(await publish(p1.slug)).toMatchObject({
      state: 'published',
      publication: { attempt: 2 },
    });
    expect(await publish(p2.slug)).toMatchObject({ state: 'stale' });
  });

  it('resolves a verify failure as written when the file holds the artifact', async () => {
    autoPublish(true);
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nVerify.\n');
    storage.fault = 'beforeVerify';
    const d = await approve(p.slug);
    expect(d.publication).toMatchObject({
      phase: 'unknown',
      error: 'outcome_unknown:VERIFY_FAILED',
    });
    const item = body<BlockedListDto>(await as(owner).get('/ops/blocked').expect(200)).items.find(
      (i) => i.slug === p.slug,
    );
    expect(item?.disk?.matches).toBe('new');
    problem(
      await as(owner).post(`/ops/blocked/${p.slug}/resolution`, {
        outcome: 'not_written',
        evidence: 'x',
      }),
      409,
      'PRECONDITION_FAILED',
    );
    const done = await as(owner)
      .post(`/ops/blocked/${p.slug}/resolution`, {
        outcome: 'written',
        evidence: 'Hash matches artifact',
      })
      .expect(200);
    expect(body<ProposalDetailDto>(done)).toMatchObject({
      state: 'published',
      publication: { phase: 'done', resolution: { outcome: 'written' } },
    });
    const page = body<PageDto>(await as(owner).get(`/wiki/pages/${path}`).expect(200));
    expect(page.sections.every((s) => s.label.label === 'reviewed')).toBe(true);
  });

  it('retries automatically after not_written with AUTO_PUBLISH', async () => {
    autoPublish(true);
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nRetry.\n');
    storage.fault = 'beforeRename';
    expect((await approve(p.slug)).publication?.phase).toBe('unknown');
    const res = await as(owner)
      .post(`/ops/blocked/${p.slug}/resolution`, {
        outcome: 'not_written',
        evidence: 'Old hash on disk',
      })
      .expect(200);
    expect(body<ProposalDetailDto>(res)).toMatchObject({
      state: 'published',
      publications: [
        { attempt: 2, phase: 'done', auto: true },
        { attempt: 1, phase: 'not_written' },
      ],
    });
  });
});

describe('fault injection for every phase (AUTO_PUBLISH=true)', () => {
  it.each([
    ['beforeRename', 'unknown', 'approved', 'outcome_unknown:STORAGE_ERROR'],
    ['afterRename', 'done', 'published', 'receipt_missing:STORAGE_ERROR'],
    ['beforeVerify', 'unknown', 'approved', 'outcome_unknown:VERIFY_FAILED'],
    ['receipt', 'done', 'published', 'receipt_missing:STORAGE_ERROR'],
  ] as const)('storage fault %s → publication %s', async (fault, phase, state, error) => {
    autoPublish(true);
    const path = await seedPage();
    const p = await submit(path, `# Page\n\n${fault}.\n`);
    storage.fault = fault;
    const d = await approve(p.slug);
    expect(d).toMatchObject({ state, publication: { phase, error, auto: true } });
    if (phase === 'done') expect(d.publication?.receiptId).toBeNull();
    const onDisk = await storage.text(path);
    expect(onDisk === d.final?.artifact).toBe(fault !== 'beforeRename');
  });

  it.each([
    ['approved', 'done'],
    ['prepared', 'done'],
    ['writing', 'unknown'],
    ['afterWrite', 'done'],
    ['written', 'done'],
  ] as const)('a crash at %s is recovered at boot → %s', async (point, phase) => {
    autoPublish(true);
    const path = await seedPage();
    const p = await submit(path, `# Page\n\nCrash at ${point}.\n`);
    hooks.crashAt = point;
    const res = await decide(p.slug);
    // A crash after the commit fails the request; inside auto-publish the outbox keeps the row.
    expect(res.status).toBe(point === 'approved' ? 500 : 201);
    const decided = await db.proposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(decided.state).toBe('approved');
    if (point === 'approved')
      expect(await db.publishOutbox.count({ where: { proposalId: p.id, processedAt: null } })).toBe(
        1,
      );
    // The process "restarts": the boot reindex runs first, then recovery.
    const before = writes();
    await app?.get(WikiIndexer).reindex();
    await app?.get(PublishService).recover();
    // Bytes already written are never uploaded again (md-wiki written-then-history-failure).
    if (point === 'afterWrite' || point === 'written') expect(writes()).toBe(before);
    const d = await detail(p.slug);
    expect(d.publication?.phase).toBe(phase);
    expect(d.state).toBe(phase === 'done' ? 'published' : 'approved');
    expect(await db.publication.count({ where: { proposalId: p.id } })).toBe(1);
    if (phase === 'done') {
      expect(await storage.text(path)).toBe(d.final?.artifact);
      const page = body<PageDto>(await as(owner).get(`/wiki/pages/${path}`).expect(200));
      expect(page.changedOutsideReview).toBe(false);
      expect(page.sections.every((s) => s.label.label === 'reviewed')).toBe(true);
    }
    expect(await db.publishOutbox.count({ where: { proposalId: p.id, processedAt: null } })).toBe(
      0,
    );
  });

  it('queues approved proposals at boot when AUTO_PUBLISH is switched on', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nLater.\n');
    await approve(p.slug);
    autoPublish(true);
    await app?.get(PublishService).recover();
    expect((await detail(p.slug)).state).toBe('published');
  });
});

describe('conflicts (md-wiki test_reviewer_resolves_conflict_from_frozen_base)', () => {
  it('merges from the frozen base into a fresh proposal on the current version', async () => {
    const path = await seedPage('v1\n');
    const a = await submit(path, 'v1\nA\n');
    const b = await submit(path, 'v1\nB\n');
    await approve(a.slug);
    await approve(b.slug);
    await publish(a.slug);
    await publish(b.slug);
    problem(
      await as(agentToken).post(`/proposals/${b.slug}/conflict`, { outcome: 'merge', reason: 'x' }),
      400,
      'VALIDATION_FAILED',
    );
    problem(
      await as(contributor).post(`/proposals/${b.slug}/conflict`, {
        outcome: 'keep_current',
        reason: 'x',
      }),
      404,
      'NOT_FOUND',
    );
    const res = await as(agentToken).post(`/proposals/${b.slug}/conflict`, {
      outcome: 'merge',
      reason: 'Keep both compatible additions',
      replacement: 'v1\nA\nB\n',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const result = body<ConflictResultDto>(res);
    expect(result.resolution).toMatchObject({ outcome: 'merge', baseSha256: sha('v1\n') });
    const replacement = result.replacement;
    if (!replacement) throw new Error('replacement');
    expect(replacement).toMatchObject({ state: 'pending', submitter: { name: 'lab-agent' } });
    const row = await db.proposal.findUniqueOrThrow({ where: { id: replacement.id } });
    expect(Buffer.from(row.proposed).toString()).toBe('v1\nA\nB\n');
    expect(row.baseSha256).toBe(sha(await storage.text(path)));
    expect(Buffer.from(row.base ?? new Uint8Array()).toString()).toBe(await storage.text(path));
    const old = await detail(b.slug);
    expect(old).toMatchObject({
      state: 'stale',
      conflict: { resolution: { outcome: 'merge', replacementSlug: replacement.slug } },
      can: { resolveConflict: false },
    });
    problem(
      await as(owner).post(`/proposals/${b.slug}/conflict`, {
        outcome: 'keep_current',
        reason: 'x',
      }),
      409,
      'ALREADY_EXISTS',
    );
    // The replacement is reviewed again like any proposal.
    expect(await publish((await approve(replacement.slug)).slug)).toMatchObject({
      state: 'published',
    });
  });

  it('keeps the current page (drop) or uses the incoming section on a pending proposal', async () => {
    const text = '# Page\n\nIntro.\n\n## Detectors\n\nPMT.\n\n## Other\n\nX.\n';
    const path = await seedPage(text);
    const ctx = await contextOf(path);
    const mine = await submit(path, text.replace('PMT.', '| table |'), { section: 'detectors' });
    const drop = await submit(path, text.replace('X.', 'Y.'));
    expect(ctx.sha256).toBe(sha(text));
    await storage.put(path, text.replace('Intro.', 'Intro v2.').replace('PMT.', 'PMT and HyD.'));
    await app?.get(WikiIndexer).reindex();
    problem(
      await as(owner).post(`/proposals/${drop.slug}/conflict`, {
        outcome: 'keep_current',
        reason: 'Already says enough',
        replacement: 'x',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const dropped = await as(owner)
      .post(`/proposals/${drop.slug}/conflict`, {
        outcome: 'keep_current',
        reason: 'Already says enough',
      })
      .expect(201);
    expect(body<ConflictResultDto>(dropped).replacement).toBeNull();
    expect((await detail(drop.slug)).state).toBe('rejected');

    const d = await detail(mine.slug, agentToken);
    expect(d.conflict).toMatchObject({
      scope: 'section',
      baseText: '## Detectors\n\nPMT.\n\n',
      currentText: '## Detectors\n\nPMT and HyD.\n\n',
      proposedText: '## Detectors\n\n| table |\n\n',
    });
    const res = await as(agentToken)
      .post(`/proposals/${mine.slug}/conflict`, {
        outcome: 'use_incoming',
        reason: 'Table replaces wording',
      })
      .expect(201);
    const replacement = body<ConflictResultDto>(res).replacement;
    const row = await db.proposal.findUniqueOrThrow({ where: { id: replacement?.id ?? '' } });
    expect(Buffer.from(row.proposed).toString()).toBe(
      '# Page\n\nIntro v2.\n\n## Detectors\n\n| table |\n\n## Other\n\nX.\n',
    );
    expect(row.section).toBe('detectors');
    expect((await detail(mine.slug)).state).toBe('rejected');
    problem(
      await as(owner).post(`/proposals/${replacement?.slug ?? ''}/conflict`, {
        outcome: 'keep_current',
        reason: 'none',
      }),
      409,
      'PRECONDITION_FAILED',
    );
  });
});

describe('withdraw, lists, diff, audit and events', () => {
  it('lets only the submitter withdraw a pending proposal', async () => {
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nWithdraw.\n');
    problem(await as(owner).post(`/proposals/${p.slug}/withdraw`, {}), 403, 'FORBIDDEN');
    const res = await as(agentToken).post(`/proposals/${p.slug}/withdraw`, {
      reason: 'Not needed',
    });
    expect(res.status).toBe(200);
    expect(body<ProposalDetailDto>(res)).toMatchObject({
      state: 'rejected',
      withdrawn: { reason: 'Not needed' },
      assignment: null,
    });
    problem(
      await as(agentToken).post(`/proposals/${p.slug}/withdraw`, {}),
      409,
      'PRECONDITION_FAILED',
    );
  });

  it('lists proposals per tab with counts and a cursor', async () => {
    problem(await as(contributor).get('/proposals'), 403, 'FORBIDDEN');
    problem(await as(owner).get('/proposals?tab=bogus'), 400, 'VALIDATION_FAILED');
    const path = await seedPage();
    const p = await submit(path, '# Page\n\nListed.\n');
    const open = body<ProposalListDto>(
      await as(reviewer).get(`/proposals?targetPath=${path}`).expect(200),
    );
    expect(open.items).toHaveLength(1);
    expect(open.items[0]).toMatchObject({
      slug: p.slug,
      tab: 'open',
      state: 'pending',
      submitter: { kind: 'agent' },
      assignees: [{ id: ownerId }],
      decision: null,
      conflict: false,
    });
    expect(open.counts).toMatchObject({ open: 1, all: 1, published: 0 });
    const all = body<ProposalListDto>(
      await as(reviewerAgentToken).get('/proposals?tab=all&limit=2').expect(200),
    );
    expect(all.items).toHaveLength(2);
    expect(all.nextCursor).not.toBeNull();
    const next = body<ProposalListDto>(
      await as(owner)
        .get(`/proposals?tab=all&limit=2&cursor=${all.nextCursor ?? ''}`)
        .expect(200),
    );
    expect(next.items.map((i) => i.slug)).not.toContain(all.items[0]?.slug);
    expect(all.counts.all).toBe(
      all.counts.open +
        all.counts.stale +
        all.counts.blocked +
        all.counts.published +
        all.counts.rejected,
    );
  });

  it('diffs the artifact against the base or the current version', async () => {
    const path = await seedPage('# Page\n\nOld line.\n');
    const p = await submit(path, '# Page\n\nNew line.\n');
    const diff = body<ProposalDiffDto>(
      await as(owner).get(`/proposals/${p.slug}/diff`).expect(200),
    );
    expect(diff.against).toBe('base');
    expect(diff.from.text).toBe('# Page\n\nOld line.\n');
    expect(diff.lines.filter((l) => l.kind === 'del').map((l) => l.text)).toEqual(['Old line.']);
    expect(diff.lines.filter((l) => l.kind === 'add').map((l) => l.text)).toContain('New line.');
    expect(diff.stats.removed).toBe(1);
    const current = body<ProposalDiffDto>(
      await as(owner).get(`/proposals/${p.slug}/diff?against=current`).expect(200),
    );
    expect(current.from.sha256).toBe(sha('# Page\n\nOld line.\n'));
    problem(await as(owner).get(`/proposals/${p.slug}/diff?against=x`), 400, 'VALIDATION_FAILED');
  });

  it('serves the audit log to the owner only', async () => {
    problem(await as(reviewer).get('/audit'), 403, 'FORBIDDEN');
    const page = body<AuditPageDto>(
      await as(owner).get('/audit?action=proposal.decided&limit=2').expect(200),
    );
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((e) => e.action === 'proposal.decided')).toBe(true);
    if (page.nextCursor) {
      const next = body<AuditPageDto>(
        await as(owner)
          .get(`/audit?action=proposal.decided&limit=2&cursor=${page.nextCursor}`)
          .expect(200),
      );
      expect(next.items.map((e) => e.id)).not.toContain(page.items[0]?.id);
    }
  });

  it('streams events to reviewers and the submitter only', async () => {
    const events = app?.get(EventsService);
    if (!events) throw new Error('events');
    const seen: { viewer: string; type: string; slug: string | undefined }[] = [];
    const subs = [
      ['reviewer', ['reviewer']],
      ['reader', ['reader']],
    ].map(([id, roles]) =>
      events.stream({ id: id as string, roles: roles as string[] }, 60_000).subscribe((e) => {
        seen.push({ viewer: id as string, type: e.type, slug: e.data.slug });
      }),
    );
    events.proposal('x', 'reader', 'pending');
    events.proposal('y', 'someone', 'pending');
    events.page('a.md');
    for (const s of subs) s.unsubscribe();
    expect(seen).toEqual([
      { viewer: 'reviewer', type: 'proposal.changed', slug: 'x' },
      { viewer: 'reader', type: 'proposal.changed', slug: 'x' },
      { viewer: 'reviewer', type: 'proposal.changed', slug: 'y' },
      { viewer: 'reviewer', type: 'page.changed', slug: undefined },
      { viewer: 'reader', type: 'page.changed', slug: undefined },
    ]);

    // Over HTTP: text/event-stream with the event name and JSON data.
    const server = app?.getHttpServer() as Server;
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      const abort = new AbortController();
      const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/events`, {
        headers: { Cookie: owner.cookie },
        signal: abort.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body?.getReader();
      setTimeout(() => {
        events.page('streamed.md');
      }, 50);
      let text = '';
      while (reader && !text.includes('streamed.md')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += Buffer.from(chunk.value).toString('utf8');
      }
      abort.abort();
      expect(text).toContain('event: page.changed');
      expect(text).toMatch(/data: \{.*"path":"streamed.md"/);
      const anonymous = await fetch(`http://127.0.0.1:${String(port)}/api/v1/events`);
      expect(anonymous.status).toBe(401);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});

describe('append-only review records and exclusivity in Postgres', () => {
  it('rejects updates and deletes of decisions and published sections', async () => {
    const decision = await db.decision.findFirstOrThrow();
    await expect(
      db.$executeRaw`UPDATE "Decision" SET reason = 'x' WHERE id = ${decision.id}::uuid`,
    ).rejects.toThrow('Decision is append-only');
    await expect(
      db.$executeRaw`DELETE FROM "PublishedSection" WHERE "publicationId" IS NOT NULL`,
    ).rejects.toThrow('PublishedSection is append-only');
  });

  it('allows only one open publication per target', async () => {
    const open = await db.publication.findFirst({ where: { phase: 'done' } });
    if (!open) throw new Error('no publication');
    await expect(
      db.$executeRaw`INSERT INTO "Publication" (id, "proposalId", attempt, "targetPath", "decisionId", phase, auto, "artifactHash", condition)
        SELECT gen_random_uuid(), "proposalId", 90, 'same.md', "decisionId", 'prepared', false, 'x', '{}' FROM "Publication" WHERE id = ${open.id}::uuid
        UNION ALL
        SELECT gen_random_uuid(), "proposalId", 91, 'same.md', "decisionId", 'writing', false, 'x', '{}' FROM "Publication" WHERE id = ${open.id}::uuid`,
    ).rejects.toThrow();
  });
});
