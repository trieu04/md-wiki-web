/* eslint-disable @typescript-eslint/no-misused-spread -- response DTO classes are plain JSON at runtime */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { WikiPath } from '@md-wiki/domain';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { CreatedTokenDto, LoginDto } from '../src/auth/identity.dto.js';
import { API_CONFIG, loadConfig, type ApiConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import type { ProposalDto } from '../src/contributions/contributions.dto.js';
import type {
  DisputeLogDto,
  ProposalDiscussionDto,
  TopicDetailDto,
  TopicEntryPageDto,
  TopicListDto,
} from '../src/discussions/discussions.dto.js';
import { EventsService, type WireEvent } from '../src/events/events.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ESCALATION_TRIGGERS } from '../src/review/ports.js';
import type { ProposalDetailDto } from '../src/review/review.dto.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import { FixtureStorage } from '../src/wiki/storage/fixture-storage.js';
import { wikiPath } from '../src/wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../src/wiki/wiki.module.js';
import { NO_QUEUE } from './no-queue.js';
import { testSchema } from './test-schema.js';

/**
 * Discussions (system-logic §7.5), ported from md-wiki tests/test_workflow.py
 * (semantic dispute cases), test_web.py (workflow discussion, semantic API) and test_mcp.py
 * (topic lifecycle), plus holds, the decision lock and append-only enforcement.
 */

const database = testSchema();
const email = 'disc-owner@example.org';
const password = 'discussion test password';

class TestStorage extends FixtureStorage {
  afterRead: ((path: string) => Promise<void>) | null = null;
  override async read(path: WikiPath) {
    try {
      return await super.read(path);
    } finally {
      const hook = this.afterRead;
      if (hook) {
        this.afterRead = null;
        await hook(path.path);
      }
    }
  }
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
const triggers = { during: null as (() => Promise<void>) | null };
let config: ApiConfig;
let app: INestApplication | undefined;
let db: PrismaService;
type Session = { cookie: string; csrf: string };
type Caller = Session | string;
let owner: Session;
let reviewer: Session;
let contributor: Session;
let other: Session;
let reader: Session;
let ownerId = '';
let reviewerId = '';
let otherId = '';
let agentToken = '';
let readOnlyToken = '';
let reviewerAgentToken = '';
let reviewerAgentId = '';

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
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed response bodies
function ok<T>(res: Response, status = 200): T {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return body<T>(res);
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
async function seedPage(
  text = '# Policy\n\nIntro.\n\n## Deadline\n\n30 days.\n\n## Scope\n\nAll.\n',
) {
  const path = `d${String(++counter)}.md`;
  await storage.put(path, text);
  await app?.get(WikiIndexer).observe(wikiPath(path));
  return path;
}
async function submit(path: string, content: string, who: Caller = agentToken) {
  const ctx = ok<{ versionLabel: string; sha256: string }>(
    await as(who).get(`/context?path=${encodeURIComponent(path)}`),
  );
  return ok<ProposalDto>(
    await as(who).post('/contributions', {
      targetPath: path,
      base: { versionLabel: ctx.versionLabel, sha256: ctx.sha256 },
      content,
      reason: 'Document the policy',
    }),
    201,
  );
}
async function proposal() {
  const path = await seedPage();
  return submit(path, '# Policy\n\nIntro.\n\n## Deadline\n\n45 days.\n\n## Scope\n\nAll.\n');
}
const detail = async (slug: string, who: Caller = owner) =>
  ok<ProposalDetailDto>(await as(who).get(`/proposals/${slug}`));
async function decide(
  slug: string,
  approve: boolean,
  who: Caller = owner,
  binding?: ProposalDetailDto['preview'],
) {
  const preview = binding ?? (await detail(slug, who)).preview;
  if (!preview) throw new Error('no preview');
  return as(who).post(`/proposals/${slug}/decisions`, {
    approve,
    reason: approve ? 'Approve' : 'Reject',
    ...preview.binding,
  });
}
const discussion = async (slug: string, who: Caller = owner) =>
  ok<ProposalDiscussionDto>(await as(who).get(`/proposals/${slug}/discussion`));

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
    .overrideProvider(NO_QUEUE.provide)
    .useValue(NO_QUEUE.value)
    .overrideProvider(WIKI_STORAGE)
    .useValue(storage)
    .overrideProvider(ESCALATION_TRIGGERS)
    .useValue({
      firing: async () => {
        const during = triggers.during;
        triggers.during = null;
        if (during) await during();
        return [];
      },
    })
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
    ['d-reviewer@example.org', ['reviewer']],
    ['d-contrib@example.org', ['contributor']],
    ['d-other@example.org', ['contributor']],
    ['d-reader@example.org', ['reader']],
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
  reviewer = await login('d-reviewer@example.org', 'pw-12345678');
  contributor = await login('d-contrib@example.org', 'pw-12345678');
  other = await login('d-other@example.org', 'pw-12345678');
  reader = await login('d-reader@example.org', 'pw-12345678');
  reviewerId = (await db.user.findFirstOrThrow({ where: { email: 'd-reviewer@example.org' } })).id;
  otherId = (await db.user.findFirstOrThrow({ where: { email: 'd-other@example.org' } })).id;
  const author = await db.user.create({
    data: {
      email: 'd-agent@example.org',
      name: 'lab-agent',
      kind: 'agent',
      roles: ['contributor'],
    },
  });
  const token = async (userId: string, scopes: string[]) =>
    body<CreatedTokenDto>(
      await as(owner).post('/admin/tokens', { userId, name: 't', scopes }).expect(201),
    ).token;
  agentToken = await token(author.id, ['read', 'contribute', 'discuss']);
  readOnlyToken = await token(author.id, ['read']);
  const bot = await db.user.create({
    data: {
      email: 'd-reviewer-agent@example.org',
      name: 'reviewer-agent',
      kind: 'agent',
      roles: ['reviewer'],
    },
  });
  reviewerAgentId = bot.id;
  reviewerAgentToken = await token(bot.id, ['read', 'discuss', 'review']);
}, 60_000);

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.drop();
  }
});

beforeEach(() => {
  storage.afterRead = null;
  triggers.during = null;
});

describe('file and section topics (md-wiki test_mcp topic lifecycle)', () => {
  it('opens, comments, mentions, closes with a rationale and reopens', async () => {
    const path = await seedPage();
    // A reader may ask a question (topic.open) on a section.
    const opened = ok<TopicDetailDto>(
      await as(reader).post('/topics', {
        path,
        anchor: 'deadline',
        title: 'Which deadline applies?',
        body: 'Is it 30 or 45 days?',
      }),
      201,
    );
    expect(opened).toMatchObject({
      path,
      anchor: 'deadline',
      sectionTitle: 'Deadline',
      pageTitle: 'Policy',
      status: 'open',
      version: 1,
      replies: 0,
      proposal: null,
      versionLabel: expect.stringMatching(/^\d{8}-\d+$/) as unknown,
      entries: [{ seq: 1, kind: 'open', body: 'Is it 30 or 45 days?' }],
      can: { comment: true, close: true, reopen: false },
    });
    const commented = ok<TopicDetailDto>(
      await as(contributor).post(`/topics/${opened.id}/comments`, {
        body: 'The policy source says 30 days.',
        mentions: [otherId],
        version: 1,
      }),
      201,
    );
    expect(commented).toMatchObject({ version: 2, replies: 1 });
    expect(commented.entries[1]).toMatchObject({
      kind: 'comment',
      author: { name: 'd-contrib' },
      mentions: [{ id: otherId }],
    });
    expect(commented.participants.map((p) => p.name).sort()).toEqual(
      ['d-contrib', 'd-other', 'd-reader'].sort(),
    );
    // The reader can reply on their own topic, but not comment elsewhere (comment = contributor).
    ok(await as(reader).post(`/topics/${opened.id}/comments`, { body: 'Thanks.' }), 201);
    const elsewhere = ok<TopicDetailDto>(
      await as(contributor).post('/topics', { path, title: 'Scope?', body: 'Who is covered?' }),
      201,
    );
    problem(
      await as(reader).post(`/topics/${elsewhere.id}/comments`, { body: 'Me too' }),
      403,
      'FORBIDDEN',
    );
    // Stale version → DISCUSSION_CHANGED; reply to an unknown entry → VALIDATION_FAILED.
    problem(
      await as(contributor).post(`/topics/${opened.id}/comments`, { body: 'x', version: 2 }),
      409,
      'DISCUSSION_CHANGED',
    );
    problem(
      await as(contributor).post(`/topics/${opened.id}/comments`, { body: 'x', parentSeq: 9 }),
      400,
      'VALIDATION_FAILED',
      'UNKNOWN_ENTRY',
    );
    problem(
      await as(contributor).post(`/topics/${opened.id}/comments`, {
        body: 'x',
        kind: 'agreement',
      }),
      400,
      'VALIDATION_FAILED',
      'UNKNOWN_ENTRY',
    );
    // Only the author or a reviewer closes a plain topic.
    problem(
      await as(other).post(`/topics/${opened.id}/close`, { outcome: 'resolved', reason: 'done' }),
      403,
      'FORBIDDEN',
    );
    problem(
      await as(reader).post(`/topics/${opened.id}/close`, { outcome: 'resolved', reason: '  ' }),
      400,
      'VALIDATION_FAILED',
    );
    const closed = ok<TopicDetailDto>(
      await as(reader).post(`/topics/${opened.id}/close`, {
        outcome: 'resolved',
        reason: 'Source owner confirmed.',
      }),
    );
    expect(closed).toMatchObject({
      status: 'resolved',
      version: 4,
      closed: { outcome: 'resolved', reason: 'Source owner confirmed.', by: { name: 'd-reader' } },
      can: { comment: false, close: false, reopen: true },
    });
    problem(
      await as(contributor).post(`/topics/${opened.id}/comments`, { body: 'late' }),
      409,
      'PRECONDITION_FAILED',
    );
    problem(
      await as(reviewer).post(`/topics/${opened.id}/close`, { outcome: 'on_hold', reason: 'x' }),
      409,
      'PRECONDITION_FAILED',
    );
    const reopened = ok<TopicDetailDto>(
      await as(reviewer).post(`/topics/${opened.id}/reopen`, { reason: 'New evidence.' }),
    );
    expect(reopened).toMatchObject({ status: 'open', version: 5, closed: null });
    problem(
      await as(reviewer).post(`/topics/${opened.id}/reopen`, { reason: 'again' }),
      409,
      'PRECONDITION_FAILED',
    );
    const held = ok<TopicDetailDto>(
      await as(reviewer).post(`/topics/${opened.id}/close`, { outcome: 'on_hold', reason: 'Wait' }),
    );
    expect(held).toMatchObject({ status: 'on_hold', can: { comment: true } });

    // Entries page oldest first with a seq cursor.
    const first = ok<TopicEntryPageDto>(
      await as(other).get(`/topics/${opened.id}/comments?limit=2`),
    );
    expect(first.items.map((e) => e.seq)).toEqual([1, 2]);
    const rest = ok<TopicEntryPageDto>(
      await as(other).get(`/topics/${opened.id}/comments?cursor=${String(first.nextCursor)}`),
    );
    expect(rest.items.map((e) => e.kind)).toEqual(['comment', 'close', 'reopen', 'close']);
    expect(rest.nextCursor).toBeNull();
  });

  it('lists with filters, counts and a path filter', async () => {
    const path = await seedPage();
    const a = ok<TopicDetailDto>(
      await as(contributor).post('/topics', { path, title: 'A', body: 'a' }),
      201,
    );
    const b = ok<TopicDetailDto>(
      await as(other).post('/topics', { path, title: 'B', body: 'b', mentions: [] }),
      201,
    );
    ok(await as(other).post(`/topics/${b.id}/close`, { outcome: 'rejected', reason: 'dup' }));
    const mine = ok<TopicListDto>(await as(contributor).get(`/topics?path=${path}&filter=mine`));
    expect(mine.items.map((t) => t.id)).toEqual([a.id]);
    expect(mine.counts).toEqual({ open: 1, mine: 1, closed: 1, all: 2 });
    const closed = ok<TopicListDto>(await as(reader).get(`/topics?path=${path}&filter=closed`));
    expect(closed.items).toMatchObject([{ id: b.id, status: 'rejected', title: 'B' }]);
    const all = ok<TopicListDto>(await as(reader).get(`/topics?path=${path}&filter=all&limit=1`));
    expect(all.items).toHaveLength(1);
    expect(all.nextCursor).not.toBeNull();
    const next = ok<TopicListDto>(
      await as(reader).get(`/topics?path=${path}&filter=all&cursor=${String(all.nextCursor)}`),
    );
    expect([...all.items, ...next.items].map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    problem(await as(reader).get('/topics?filter=bogus'), 400, 'VALIDATION_FAILED');
  });

  it('rejects bad input with the documented codes', async () => {
    const path = await seedPage();
    problem(
      await as(contributor).post('/topics', { path: '../x.md', title: 't', body: 'b' }),
      400,
      'INVALID_PATH',
    );
    problem(
      await as(contributor).post('/topics', { path: 'missing.md', title: 't', body: 'b' }),
      404,
      'NOT_FOUND',
    );
    problem(
      await as(contributor).post('/topics', { path, anchor: 'nope', title: 't', body: 'b' }),
      400,
      'VALIDATION_FAILED',
      'UNKNOWN_SECTION',
    );
    problem(
      await as(contributor).post('/topics', {
        path,
        title: 't',
        body: 'b',
        mentions: ['00000000-0000-4000-8000-000000000000'],
      }),
      400,
      'VALIDATION_FAILED',
      'UNKNOWN_USER',
    );
    problem(await as(contributor).post('/topics', { path, title: 't' }), 400, 'VALIDATION_FAILED');
    // A token without the discuss scope cannot open topics.
    problem(
      await as(readOnlyToken).post('/topics', { path, title: 't', body: 'b' }),
      403,
      'FORBIDDEN',
    );
    problem(
      await as(contributor).get('/topics/00000000-0000-4000-8000-000000000000'),
      404,
      'NOT_FOUND',
    );
    problem(await as(contributor).get('/topics/not-a-uuid'), 400, 'VALIDATION_FAILED');
    problem(await http().get('/api/v1/topics'), 401, 'UNAUTHENTICATED');
  });
});

describe('proposal discussion (md-wiki test_workflow_discussion_keeps_multi_party_history)', () => {
  it('holds approval until a reviewer resolves it, versioned per entry', async () => {
    const p = await proposal();
    const before = await detail(p.slug);
    expect(before.discussion).toEqual({
      discussionVersion: 0,
      disputeVersion: 0,
      disputed: false,
      held: false,
      disputeOpen: false,
      topicId: null,
    });
    problem(
      await as(reviewer).post(`/proposals/${p.slug}/discussion`, {
        bundleHash: 'b'.repeat(64),
        body: 'x',
      }),
      409,
      'PRECONDITION_FAILED',
    );
    const opened = ok<ProposalDiscussionDto>(
      await as(reviewer).post(`/proposals/${p.slug}/discussion`, {
        bundleHash: p.bundleHash,
        body: 'The source appears to conflict with the wording.',
      }),
      201,
    );
    expect(opened).toMatchObject({ discussionVersion: 1, held: true, disputed: true });
    expect(opened.topic).toMatchObject({
      path: p.targetPath,
      status: 'open',
      title: `Discussion: ${p.title}`,
      proposal: { slug: p.slug, holds: true },
      entries: [{ seq: 1, kind: 'open' }],
    });
    const topicId = opened.topic?.id ?? '';
    problem(
      await as(reviewer).post(`/proposals/${p.slug}/discussion`, {
        bundleHash: p.bundleHash,
        body: 'again',
      }),
      409,
      'ALREADY_EXISTS',
    );
    // Approval is blocked while held; the old 0/0 binding is stale as well.
    problem(await decide(p.slug, true, owner, before.preview), 409, 'DISPUTED');
    problem(await decide(p.slug, true), 409, 'DISPUTED');

    // The submitter (agent) agrees with entry 1; a proposal entry must carry the version.
    problem(
      await as(agentToken).post(`/topics/${topicId}/comments`, { body: 'Agreed.' }),
      400,
      'VALIDATION_FAILED',
      'REQUIRED',
    );
    const agreed = ok<TopicDetailDto>(
      await as(agentToken).post(`/topics/${topicId}/comments`, {
        body: 'I agree that the source needs a narrower scope.',
        kind: 'agreement',
        agreesWith: 1,
        version: 1,
      }),
      201,
    );
    expect(agreed.entries.at(-1)).toMatchObject({ kind: 'agreement', agreesWith: 1 });
    // Only a reviewer who did not submit resolves; contributors are refused.
    problem(
      await as(agentToken).post(`/topics/${topicId}/close`, {
        outcome: 'resolved',
        reason: 'mine',
        version: 2,
      }),
      403,
      'FORBIDDEN',
    );
    const onHold = ok<TopicDetailDto>(
      await as(reviewer).post(`/topics/${topicId}/close`, {
        outcome: 'on_hold',
        reason: 'Need a cited policy passage before a decision.',
        version: 2,
      }),
    );
    expect(onHold).toMatchObject({ status: 'on_hold', version: 3, proposal: { holds: true } });
    problem(await decide(p.slug, true), 409, 'DISPUTED');
    problem(
      await as(reviewer).post(`/topics/${topicId}/close`, {
        outcome: 'resolved',
        reason: 'stale',
        version: 2,
      }),
      409,
      'DISCUSSION_CHANGED',
    );
    const stale = (await detail(p.slug)).preview;
    const resolved = ok<TopicDetailDto>(
      await as(reviewer).post(`/topics/${topicId}/close`, {
        outcome: 'resolved',
        reason: 'The proposed wording is now interpreted as scoped.',
        version: 3,
      }),
    );
    expect(resolved).toMatchObject({ status: 'resolved', version: 4, proposal: { holds: false } });
    const fetched = await discussion(p.slug);
    expect(fetched).toMatchObject({ discussionVersion: 4, held: false, disputed: false });
    expect(fetched.topic?.entries.map((e) => e.kind)).toEqual([
      'open',
      'agreement',
      'close',
      'close',
    ]);
    // A preview taken before the last entry cannot decide.
    problem(await decide(p.slug, true, owner, stale), 409, 'DISCUSSION_CHANGED');
    // Resolution returns the held proposal to its assignee (the owner).
    const history = (await detail(p.slug)).history;
    expect(history.filter((h) => h.action === 'proposal.returned')).toMatchObject([
      { data: { assigneeId: ownerId, discussionVersion: 4 } },
    ]);
    const approved = ok<ProposalDetailDto>(await decide(p.slug, true), 201);
    expect(approved.decisions[0]).toMatchObject({ approve: true, discussionVersion: 4 });
    // Decided: no further entries.
    problem(
      await as(reviewer).post(`/topics/${topicId}/reopen`, { reason: 'late', version: 4 }),
      409,
      'PRECONDITION_FAILED',
    );
  });

  it('rejected keeps the hold but never blocks a rejection; SELF_REVIEW for the submitter', async () => {
    const own = await submit(await seedPage(), '# Policy\n\nOwner text.\n', owner);
    const opened = ok<ProposalDiscussionDto>(
      await as(owner).post(`/proposals/${own.slug}/discussion`, {
        bundleHash: own.bundleHash,
        body: 'I want input.',
        anchor: null,
      }),
      201,
    );
    problem(
      await as(owner).post(`/topics/${opened.topic?.id ?? ''}/close`, {
        outcome: 'resolved',
        reason: 'mine',
        version: 1,
      }),
      409,
      'SELF_REVIEW',
    );

    const p = await proposal();
    const d = ok<ProposalDiscussionDto>(
      await as(reviewer).post(`/proposals/${p.slug}/discussion`, {
        bundleHash: p.bundleHash,
        body: 'Wrong.',
        anchor: 'deadline',
      }),
      201,
    );
    expect(d.topic).toMatchObject({ anchor: 'deadline', sectionTitle: 'Deadline' });
    ok(
      await as(reviewer).post(`/topics/${d.topic?.id ?? ''}/close`, {
        outcome: 'rejected',
        reason: 'The debate went against it.',
        version: 1,
      }),
    );
    expect(await discussion(p.slug)).toMatchObject({ held: true, disputed: true });
    problem(await decide(p.slug, true), 409, 'DISPUTED');
    const rejected = ok<ProposalDetailDto>(await decide(p.slug, false), 201);
    expect(rejected).toMatchObject({ state: 'rejected', decisions: [{ discussionVersion: 2 }] });
    problem(
      await as(reviewer).post(`/proposals/${p.slug}/discussion`, {
        bundleHash: p.bundleHash,
        body: 'x',
      }),
      409,
      'PRECONDITION_FAILED',
    );
    problem(
      await as(reviewer).post(`/proposals/${(await proposal()).slug}/discussion`, {
        bundleHash: p.bundleHash.replace(/^./, p.bundleHash.startsWith('a') ? 'b' : 'a'),
        body: 'x',
        anchor: 'nope',
      }),
      409,
      'PRECONDITION_FAILED',
    );
  });

  it('proposal topics are visible to the proposal audience and participants only', async () => {
    const p = await proposal();
    const opened = ok<ProposalDiscussionDto>(
      await as(reviewer).post(`/proposals/${p.slug}/discussion`, {
        bundleHash: p.bundleHash,
        body: 'Please look.',
      }),
      201,
    );
    const id = opened.topic?.id ?? '';
    problem(await as(contributor).get(`/topics/${id}`), 404, 'NOT_FOUND');
    problem(await as(contributor).get(`/proposals/${p.slug}/discussion`), 404, 'NOT_FOUND');
    expect(
      ok<TopicListDto>(await as(contributor).get(`/topics?path=${p.targetPath}&filter=all`)).items,
    ).toEqual([]);
    // The submitter (agent) sees it; a mentioned contributor becomes a participant and sees it.
    ok(await as(agentToken).get(`/topics/${id}`));
    ok(
      await as(reviewer).post(`/topics/${id}/comments`, {
        body: 'Asking d-other.',
        mentions: [otherId],
        version: 1,
      }),
      201,
    );
    const seen = ok<TopicDetailDto>(await as(other).get(`/topics/${id}`));
    expect(seen.can).toEqual({ comment: true, close: false, reopen: false });
    const list = ok<TopicListDto>(await as(other).get(`/topics?proposal=${p.slug}`));
    expect(list.items).toMatchObject([{ id, proposal: { slug: p.slug, holds: true } }]);
    expect(
      ok<TopicListDto>(await as(other).get('/topics?proposal=no-such-proposal')).items,
    ).toEqual([]);
  });
});

describe('dispute log (md-wiki test_semantic_dispute_blocks_approval_until_reasoned_resolution)', () => {
  it('blocks approval until a reasoned resolution, versioned', async () => {
    const p = await proposal();
    const original = await detail(p.slug);
    const post = (data: object, who: Caller = owner) =>
      as(who).post(`/proposals/${p.slug}/disputes`, { bundleHash: p.bundleHash, ...data });
    const opened = ok<DisputeLogDto>(
      await post({
        disputeVersion: 0,
        action: 'open',
        reason: 'Question: use Redis?\nClaim A: required\nClaim B: prohibited\nEvidence: source',
      }),
      201,
    );
    expect(opened).toMatchObject({ disputeOpen: true, disputeVersion: 1 });
    problem(await decide(p.slug, true, owner, original.preview), 409, 'DISPUTED');
    problem(await decide(p.slug, true), 409, 'DISPUTED');
    problem(
      await post({ disputeVersion: 0, action: 'comment', reason: 'x' }),
      409,
      'DISCUSSION_CHANGED',
    );
    const commented = ok<DisputeLogDto>(
      await post({
        disputeVersion: 1,
        action: 'comment',
        reason: 'No consensus: the effective policy is still missing',
      }),
      201,
    );
    expect(commented.disputeOpen).toBe(true);
    problem(
      await post({ disputeVersion: 2, action: 'resolve', reason: 'x' }),
      400,
      'VALIDATION_FAILED',
      'VALIDATION_FAILED',
    );
    const resolved = ok<DisputeLogDto>(
      await post(
        {
          disputeVersion: 2,
          action: 'resolve',
          reason: 'The claims apply to cache and primary storage respectively.',
          resolutionKind: 'scoped',
          relatedSlugs: ['p2'],
        },
        reviewerAgentToken,
      ),
      201,
    );
    expect(resolved).toMatchObject({ disputeOpen: false, disputeVersion: 3 });
    expect(resolved.events.at(-1)).toMatchObject({
      action: 'resolve',
      resolutionKind: 'scoped',
      relatedSlugs: ['p2'],
      actor: { name: 'reviewer-agent' },
    });
    const approved = ok<ProposalDetailDto>(await decide(p.slug, true), 201);
    expect(approved.decisions[0]).toMatchObject({ disputeVersion: 3, discussionVersion: 0 });
    expect(
      ok<DisputeLogDto>(await as(agentToken).get(`/proposals/${p.slug}/disputes`)).events,
    ).toHaveLength(3);
  });

  it('reopen, reject and the guards (md-wiki test_semantic_discussion_reopen_reject_and_restart)', async () => {
    const p = await proposal();
    const post = (data: object, who: Caller = reviewer) =>
      as(who).post(`/proposals/${p.slug}/disputes`, { bundleHash: p.bundleHash, ...data });
    problem(
      await post({ disputeVersion: 0, action: 'reopen', reason: 'x' }),
      409,
      'PRECONDITION_FAILED',
    );
    problem(
      await post({ disputeVersion: 0, action: 'comment', reason: 'x' }),
      409,
      'PRECONDITION_FAILED',
    );
    problem(
      await post({ disputeVersion: 0, action: 'open', reason: 'x', resolutionKind: 'scoped' }),
      400,
      'VALIDATION_FAILED',
    );
    problem(
      await post({ disputeVersion: 0, action: 'open', reason: 'x' }, contributor),
      403,
      'FORBIDDEN',
    );
    problem(
      await post({ disputeVersion: 0, action: 'open', reason: 'x' }, agentToken),
      403,
      'FORBIDDEN',
    );
    problem(
      await post({ disputeVersion: 0, action: 'bogus', reason: 'x' }),
      400,
      'VALIDATION_FAILED',
    );
    ok(await post({ disputeVersion: 0, action: 'open', reason: 'Conflict found' }), 201);
    problem(
      await post({ disputeVersion: 1, action: 'open', reason: 'again' }),
      409,
      'PRECONDITION_FAILED',
    );
    ok(
      await post({
        disputeVersion: 1,
        action: 'resolve',
        reason: 'Existing proposal is directly supported',
        resolutionKind: 'supported',
      }),
      201,
    );
    const reopened = ok<DisputeLogDto>(
      await post({ disputeVersion: 2, action: 'reopen', reason: 'New objection' }),
      201,
    );
    expect(reopened).toMatchObject({ disputeOpen: true, disputeVersion: 3 });
    expect(await db.disputeEvent.count({ where: { proposalId: p.id } })).toBe(3);
    const rejected = ok<ProposalDetailDto>(await decide(p.slug, false), 201);
    expect(rejected).toMatchObject({ state: 'rejected', decisions: [{ disputeVersion: 3 }] });
    problem(
      await post({ disputeVersion: 3, action: 'comment', reason: 'late' }),
      409,
      'PRECONDITION_FAILED',
    );

    // The submitter can never dispute their own proposal.
    const own = await submit(await seedPage(), '# Policy\n\nMine.\n', owner);
    problem(
      await as(owner).post(`/proposals/${own.slug}/disputes`, {
        bundleHash: own.bundleHash,
        disputeVersion: 0,
        action: 'open',
        reason: 'x',
      }),
      409,
      'SELF_REVIEW',
    );
    problem(
      await as(reviewer).post('/proposals/no-such-slug/disputes', {
        bundleHash: own.bundleHash,
        disputeVersion: 0,
        action: 'open',
        reason: 'x',
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('resolution returns a held proposal to its assignee', () => {
  it('reopens the last assignee when no assignment is open', async () => {
    const p = await proposal();
    ok(
      await as(reviewer).post(`/proposals/${p.slug}/disputes`, {
        bundleHash: p.bundleHash,
        disputeVersion: 0,
        action: 'open',
        reason: 'Needs a check',
      }),
      201,
    );
    // Phase 8 escalations close the agent's assignment; simulate an assignment-less hold.
    await db.assignment.updateMany({ where: { proposalId: p.id }, data: { closedAt: new Date() } });
    expect((await detail(p.slug)).assignment).toBeNull();
    ok(
      await as(reviewer).post(`/proposals/${p.slug}/disputes`, {
        bundleHash: p.bundleHash,
        disputeVersion: 1,
        action: 'resolve',
        reason: 'Attributed to the source',
        resolutionKind: 'attributed',
      }),
      201,
    );
    const d = await detail(p.slug);
    expect(d.assignment).toMatchObject({
      assignee: { id: ownerId },
      reason: 'discussion_resolved',
    });
    expect(d.can.decide).toBe(true);
  });
});

describe('decision lock on new entries (system-logic §11 concurrency)', () => {
  it('an entry that commits while the decision reads the page invalidates it', async () => {
    const p = await proposal();
    ok(
      await as(reviewer).post(`/proposals/${p.slug}/disputes`, {
        bundleHash: p.bundleHash,
        disputeVersion: 0,
        action: 'open',
        reason: 'Check the deadline',
      }),
      201,
    );
    const preview = (await detail(p.slug)).preview;
    // The approval's binding says disputeVersion 1 while disputed → DISPUTED; resolve first in
    // the window between the decision's live observe and its transaction.
    storage.afterRead = async () => {
      ok(
        await as(reviewer).post(`/proposals/${p.slug}/disputes`, {
          bundleHash: p.bundleHash,
          disputeVersion: 1,
          action: 'resolve',
          reason: 'Supported',
          resolutionKind: 'supported',
        }),
        201,
      );
    };
    problem(await decide(p.slug, true, owner, preview), 409, 'DISCUSSION_CHANGED');
    expect(storage.afterRead).toBeNull();
    expect((await detail(p.slug)).state).toBe('pending');
  });

  it('an entry posted during the decision transaction waits for it and then fails', async () => {
    const p = await proposal();
    const opened = ok<ProposalDiscussionDto>(
      await as(reviewer).post(`/proposals/${p.slug}/discussion`, {
        bundleHash: p.bundleHash,
        body: 'Quick question',
      }),
      201,
    );
    const id = opened.topic?.id ?? '';
    ok(
      await as(reviewer).post(`/topics/${id}/close`, {
        outcome: 'resolved',
        reason: 'Answered',
        version: 1,
      }),
    );
    await db.assignment.create({
      data: { proposalId: p.id, assigneeId: reviewerAgentId, reason: 'test' },
    });
    let entry: Promise<Response> | null = null;
    let settled = false;
    triggers.during = async () => {
      // The decision holds the proposal row lock here (step 12 runs inside its transaction).
      entry = as(reviewer)
        .post(`/topics/${id}/reopen`, { reason: 'Second thoughts', version: 2 })
        .then((r) => {
          settled = true;
          return r;
        });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);
    };
    const decided = ok<ProposalDetailDto>(await decide(p.slug, true, reviewerAgentToken), 201);
    expect(decided).toMatchObject({
      state: 'approved',
      decisions: [{ discussionVersion: 2, reviewerKind: 'agent' }],
    });
    expect(entry).not.toBeNull();
    problem(await (entry as unknown as Promise<Response>), 409, 'PRECONDITION_FAILED');
    expect((await discussion(p.slug)).discussionVersion).toBe(2);
  });
});

describe('append-only records', () => {
  it('rejects UPDATE/DELETE of entries and disputes and protects topic identity', async () => {
    const p = await proposal();
    const opened = ok<ProposalDiscussionDto>(
      await as(reviewer).post(`/proposals/${p.slug}/discussion`, {
        bundleHash: p.bundleHash,
        body: 'x',
      }),
      201,
    );
    ok(
      await as(reviewer).post(`/proposals/${p.slug}/disputes`, {
        bundleHash: p.bundleHash,
        disputeVersion: 0,
        action: 'open',
        reason: 'x',
      }),
      201,
    );
    const id = opened.topic?.id ?? '';
    await expect(
      db.$executeRaw`UPDATE "DiscussionEvent" SET body = 'edited' WHERE "topicId" = ${id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`DELETE FROM "DiscussionEvent" WHERE "topicId" = ${id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`UPDATE "DisputeEvent" SET reason = 'edited' WHERE "proposalId" = ${p.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`DELETE FROM "DisputeEvent" WHERE "proposalId" = ${p.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`UPDATE "Topic" SET path = 'other.md' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/frozen/);
    await expect(
      db.$executeRaw`UPDATE "Topic" SET version = 0 WHERE id = ${id}::uuid`,
    ).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "Topic" WHERE id = ${id}::uuid`).rejects.toThrow(
      /never deleted/,
    );
  });
});

describe('events', () => {
  it('emits discussion.changed to the right audience', async () => {
    const events = app?.get(EventsService);
    if (!events) throw new Error('no events');
    const seen: Record<string, WireEvent[]> = { reader: [], other: [], reviewer: [] };
    const subs = [
      events
        .stream({ id: 'reader-id', roles: ['reader'] }, 1e9)
        .subscribe((m) => seen.reader?.push(m.data)),
      events
        .stream({ id: otherId, roles: ['contributor'] }, 1e9)
        .subscribe((m) => seen.other?.push(m.data)),
      events
        .stream({ id: reviewerId, roles: ['reviewer'] }, 1e9)
        .subscribe((m) => seen.reviewer?.push(m.data)),
    ];
    try {
      const path = await seedPage();
      const t = ok<TopicDetailDto>(
        await as(contributor).post('/topics', { path, title: 'Q', body: 'q' }),
        201,
      );
      expect(seen.reader).toContainEqual(
        expect.objectContaining({ type: 'discussion.changed', topicId: t.id, path, version: 1 }),
      );
      const p = await proposal();
      const d = ok<ProposalDiscussionDto>(
        await as(reviewer).post(`/proposals/${p.slug}/discussion`, {
          bundleHash: p.bundleHash,
          body: 'x',
        }),
        201,
      );
      const id = d.topic?.id ?? '';
      const restricted = (who: string) =>
        (seen[who] ?? []).filter((e) => e.type === 'discussion.changed' && e.topicId === id);
      expect(restricted('reviewer')).toHaveLength(1);
      expect(restricted('reader')).toHaveLength(0);
      expect(restricted('other')).toHaveLength(0);
      ok(
        await as(reviewer).post(`/topics/${id}/comments`, {
          body: 'cc',
          mentions: [otherId],
          version: 1,
        }),
        201,
      );
      expect(restricted('other')).toMatchObject([{ slug: p.slug, version: 2 }]);
      expect(restricted('other')[0]).not.toHaveProperty('audience');
      expect(seen.reviewer).toContainEqual(
        expect.objectContaining({ type: 'proposal.changed', slug: p.slug }),
      );
    } finally {
      for (const s of subs) s.unsubscribe();
    }
  });
});
