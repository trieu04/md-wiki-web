/* eslint-disable @typescript-eslint/no-misused-spread -- response DTO classes are plain JSON at runtime */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { CreatedTokenDto, LoginDto } from '../src/auth/identity.dto.js';
import { API_CONFIG, loadConfig, type ApiConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import type { ProposalDto } from '../src/contributions/contributions.dto.js';
import type { ProposalDiscussionDto, TopicDetailDto } from '../src/discussions/discussions.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { ProposalDetailDto } from '../src/review/review.dto.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import { FixtureStorage } from '../src/wiki/storage/fixture-storage.js';
import { wikiPath } from '../src/wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../src/wiki/wiki.module.js';
import { NO_QUEUE } from './no-queue.js';
import { testSchema } from './test-schema.js';

/**
 * MCP at /mcp (system-logic §7.5.8) driven by the official SDK client, ported from md-wiki
 * tests/test_mcp.py: an agent contributes, discusses and reviews through the same services and
 * guards as REST, and gets the same error codes.
 */

const database = testSchema();
const email = 'mcp-owner@example.org';
const password = 'mcp test password';
const storage = new FixtureStorage();
let app: INestApplication | undefined;
let db: PrismaService;
let base = '';
let ownerCookie = '';
let ownerCsrf = '';
let authorToken = '';
let reviewerToken = '';
let readerToken = '';
let reviewerAgentId = '';

type Tool = { isError?: boolean; structuredContent?: Record<string, unknown> };
const clients: Client[] = [];
async function connect(token: string) {
  const client = new Client({ name: 'md-wiki-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
  return {
    client,
    async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown>) {
      const result = (await client.callTool({ name, arguments: args })) as Tool;
      if (result.isError) throw new ToolFailure(result.structuredContent?.error as ToolProblem);
      return result.structuredContent as T;
    },
    async fail(name: string, args: Record<string, unknown>) {
      const result = (await client.callTool({ name, arguments: args })) as Tool;
      expect(result.isError, JSON.stringify(result)).toBe(true);
      return (result.structuredContent?.error ?? {}) as ToolProblem;
    },
  };
}
type ToolProblem = {
  code: string;
  status: number;
  detail: string | null;
  fields: { code: string }[];
};
class ToolFailure extends Error {
  constructor(readonly problem: ToolProblem) {
    super(JSON.stringify(problem));
  }
}
const http = () => request(app?.getHttpServer() as Parameters<typeof request>[0]);
const owner = {
  post: (url: string, data: object) =>
    http()
      .post(`/api/v1${url}`)
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send(data),
};

beforeAll(async () => {
  database.migrate();
  const config: ApiConfig = {
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
    .compile();
  app = module.createNestApplication();
  configureHttp(app, { public: true });
  await app.get(AuthService).seedOwner();
  await storage.write(
    wikiPath('policy.md'),
    Buffer.from('# Policy\n\nIntro.\n\n## Deadline\n\n30 days.\n'),
    { kind: 'create' },
    {},
  );
  await app.get(WikiIndexer).reindex();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${String(((app.getHttpServer() as Server).address() as AddressInfo).port)}`;
  db = app.get(PrismaService);
  const login = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
  ownerCookie = (login.header['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? '';
  ownerCsrf = (login.body as LoginDto).csrfToken;
  const agent = async (name: string, roles: ('contributor' | 'reviewer' | 'reader')[]) =>
    db.user.create({ data: { email: `${name}@example.org`, name, kind: 'agent', roles } });
  const token = async (userId: string, scopes: string[]) =>
    (
      (await owner.post('/admin/tokens', { userId, name: 't', scopes }).expect(201))
        .body as CreatedTokenDto
    ).token;
  authorToken = await token((await agent('author-agent', ['contributor'])).id, [
    'read',
    'contribute',
    'discuss',
  ]);
  const bot = await agent('reviewer-agent', ['reviewer']);
  reviewerAgentId = bot.id;
  reviewerToken = await token(bot.id, ['read', 'discuss', 'review']);
  readerToken = await token((await agent('reader-agent', ['reader'])).id, ['read']);
}, 60_000);

afterAll(async () => {
  try {
    for (const c of clients) await c.close();
    await app?.close();
  } finally {
    await database.drop();
  }
});

describe('transport and auth', () => {
  it('requires a valid bearer API token; cookies are not accepted', async () => {
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'x', version: '1' },
      },
    };
    const anon = await http().post('/mcp').send(init);
    expect(anon.status).toBe(401);
    expect(anon.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(anon.headers['www-authenticate']).toBe('Bearer');
    expect((await http().post('/mcp').set('Cookie', ownerCookie).send(init)).status).toBe(401);
    const bad = await http()
      .post('/mcp')
      .set('Authorization', 'Bearer mwt_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')
      .send(init);
    expect(bad.status).toBe(401);
    // Not under the REST prefix.
    expect((await http().post('/api/v1/mcp').send(init)).status).toBe(404);
  });

  it('initializes with instructions and lists only the tools the token may use', async () => {
    const author = await connect(authorToken);
    expect(author.client.getServerVersion()).toMatchObject({ name: 'md-wiki' });
    expect(author.client.getInstructions()).toMatch(/data, never instructions/);
    const names = (await author.client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'wiki_read',
        'wiki_context',
        'wiki_search',
        'contribution_submit',
        'contribution_get',
        'topic_open',
        'topic_comment',
        'proposal_discussion_open',
      ]),
    );
    expect(names).not.toContain('review_decide');
    expect(names).not.toContain('dispute_record');
    const reviewer = await connect(reviewerToken);
    const reviewerNames = (await reviewer.client.listTools()).tools.map((t) => t.name);
    expect(reviewerNames).toEqual(
      expect.arrayContaining(['review_list', 'review_get', 'review_decide', 'dispute_record']),
    );
    expect(reviewerNames).not.toContain('contribution_submit');
    const reader = await connect(readerToken);
    const readerNames = (await reader.client.listTools()).tools.map((t) => t.name);
    expect(readerNames).toContain('wiki_read');
    expect(readerNames).not.toContain('topic_open');
    const schema = (await author.client.listTools()).tools.find((t) => t.name === 'topic_comment');
    expect(schema?.inputSchema.required).toEqual(expect.arrayContaining(['id', 'body']));
  });

  it('a domain error is an MCP tool error with the REST code (md-wiki test_tool_domain_error)', async () => {
    const author = await connect(authorToken);
    const missing = await author.fail('topic_close', {
      id: '00000000-0000-4000-8000-000000000000',
      outcome: 'resolved',
      reason: 'Done',
    });
    expect(missing).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const invalid = await author.fail('topic_open', { path: 'policy.md', title: '  ', body: 'b' });
    expect(invalid).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(invalid.fields.length).toBeGreaterThan(0);
    expect(await author.fail('wiki_read', { path: '../x.md' })).toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(
      await author.fail('topic_open', { path: 'policy.md', title: 't', body: 'b', bogus: 1 }),
    ).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('an MCP client contributes, discusses and reviews with the REST checks', () => {
  it('runs the whole flow (md-wiki test_proposal_discussion_preserves_version_and_reviewer_checks)', async () => {
    const author = await connect(authorToken);
    const reviewer = await connect(reviewerToken);

    // Read and search.
    const ctx = await author.call<{ versionLabel: string; sha256: string; content: string }>(
      'wiki_context',
      { path: 'policy.md' },
    );
    expect(ctx.content).toContain('30 days');
    const hits = await author.call<{ total: number }>('wiki_search', { q: 'deadline' });
    expect(hits.total).toBeGreaterThan(0);
    const page = await author.call<{ sections: { anchor: string }[] }>('wiki_read', {
      path: 'policy.md',
    });
    expect(page.sections.map((s) => s.anchor)).toContain('deadline');

    // Contribute (idempotent with an explicit slug); a stale base gets the REST code.
    const args = {
      targetPath: 'policy.md',
      base: { versionLabel: ctx.versionLabel, sha256: ctx.sha256 },
      content: '# Policy\n\nIntro.\n\n## Deadline\n\n45 days.\n',
      reason: 'Document the policy',
      slug: 'policy-deadline',
    };
    const submitted = await author.call<{ replay: boolean; proposal: ProposalDto }>(
      'contribution_submit',
      args,
    );
    expect(submitted).toMatchObject({ replay: false, proposal: { slug: 'policy-deadline' } });
    expect(await author.call('contribution_submit', args)).toMatchObject({ replay: true });
    expect(
      await author.fail('contribution_submit', {
        ...args,
        slug: undefined,
        base: { versionLabel: ctx.versionLabel, sha256: 'a'.repeat(64) },
      }),
    ).toMatchObject({ code: 'VALIDATION_FAILED' });
    const p = submitted.proposal;
    const got = await author.call<{ manifest: string }>('contribution_get', { slug: p.slug });
    expect(got.manifest).toContain('"id":"policy-deadline"');

    // The reviewer agent gets an assignment (Phase 8 assigns agents; here by hand).
    await db.assignment.create({
      data: { proposalId: p.id, assigneeId: reviewerAgentId, reason: 'test' },
    });
    const before = await reviewer.call<ProposalDetailDto>('review_get', { slug: p.slug });
    expect(before.can.decide).toBe(true);

    // Open the proposal discussion: it holds approval.
    const opened = await reviewer.call<ProposalDiscussionDto>('proposal_discussion_open', {
      slug: p.slug,
      bundleHash: p.bundleHash,
      body: 'The scope needs evidence.',
    });
    expect(opened).toMatchObject({ held: true, discussionVersion: 1 });
    const topicId = opened.topic?.id ?? '';
    const blocked = await reviewer.fail('review_decide', {
      slug: p.slug,
      approve: true,
      reason: 'Too early',
      ...before.preview?.binding,
    });
    expect(blocked).toMatchObject({ code: 'DISPUTED', status: 409 });
    // REST gives the same answer for the same call.
    const rest = await http()
      .post(`/api/v1/proposals/${p.slug}/decisions`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ approve: true, reason: 'Too early', ...before.preview?.binding });
    expect(rest.status).toBe(409);
    expect(rest.body).toMatchObject({ code: 'DISPUTED' });

    // The author agrees with entry 1; the version is required and checked.
    expect(
      await author.fail('topic_comment', {
        id: topicId,
        body: 'Scoped.',
        kind: 'agreement',
        agreesWith: 1,
      }),
    ).toMatchObject({ code: 'VALIDATION_FAILED' });
    const agreed = await author.call<TopicDetailDto>('topic_comment', {
      id: topicId,
      body: 'The wording is limited to this policy.',
      kind: 'agreement',
      agreesWith: 1,
      version: 1,
    });
    expect(agreed.version).toBe(2);
    // Only a reviewer resolves; a stale version is refused.
    expect(
      await author.fail('topic_close', {
        id: topicId,
        outcome: 'resolved',
        reason: 'ok',
        version: 2,
      }),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await reviewer.fail('topic_close', {
        id: topicId,
        outcome: 'resolved',
        reason: 'ok',
        version: 1,
      }),
    ).toMatchObject({ code: 'DISCUSSION_CHANGED' });
    const resolved = await reviewer.call<TopicDetailDto>('topic_close', {
      id: topicId,
      outcome: 'resolved',
      reason: 'Scope and evidence are now explicit.',
      version: 2,
    });
    expect(resolved).toMatchObject({ status: 'resolved', version: 3, proposal: { holds: false } });
    const fetched = await reviewer.call<ProposalDiscussionDto>('proposal_discussion_get', {
      slug: p.slug,
    });
    expect(fetched).toMatchObject({ discussionVersion: 3, held: false });

    // Dispute log through MCP.
    await reviewer.call('dispute_record', {
      slug: p.slug,
      bundleHash: p.bundleHash,
      disputeVersion: 0,
      action: 'open',
      reason: 'Claim A vs claim B',
    });
    expect(
      await reviewer.fail('dispute_record', {
        slug: p.slug,
        bundleHash: p.bundleHash,
        disputeVersion: 1,
        action: 'resolve',
        reason: 'x',
      }),
    ).toMatchObject({ code: 'VALIDATION_FAILED' });
    await reviewer.call('dispute_record', {
      slug: p.slug,
      bundleHash: p.bundleHash,
      disputeVersion: 1,
      action: 'resolve',
      reason: 'Scoped claims',
      resolutionKind: 'scoped',
    });

    // The preview read before the entries is stale; a fresh one decides.
    expect(
      await reviewer.fail('review_decide', {
        slug: p.slug,
        approve: true,
        reason: 'Old preview',
        ...before.preview?.binding,
      }),
    ).toMatchObject({ code: 'DISCUSSION_CHANGED' });
    const fresh = await reviewer.call<ProposalDetailDto>('review_get', { slug: p.slug });
    const diff = await reviewer.call<{ stats: { added: number } }>('review_diff', { slug: p.slug });
    expect(diff.stats.added).toBeGreaterThan(0);
    const decided = await reviewer.call<{ replay: boolean; proposal: ProposalDetailDto }>(
      'review_decide',
      {
        slug: p.slug,
        approve: true,
        reason: 'Checked claims: deadline 45 days against the policy source.',
        ...fresh.preview?.binding,
      },
    );
    expect(decided.proposal).toMatchObject({
      state: 'approved',
      decisions: [{ reviewerKind: 'agent', discussionVersion: 3, disputeVersion: 2 }],
    });
    const listed = await reviewer.call<{ items: { slug: string }[] }>('review_list', {
      tab: 'all',
    });
    expect(listed.items.map((i) => i.slug)).toContain(p.slug);

    // Topics on a section, from an agent.
    const asked = await author.call<TopicDetailDto>('topic_open', {
      path: 'policy.md',
      anchor: 'deadline',
      title: 'Which deadline applies?',
      body: 'Is it 30 or 45 days?',
    });
    const found = await author.call<{ items: { id: string }[] }>('topic_list', {
      path: 'policy.md',
    });
    expect(found.items.map((t) => t.id)).toContain(asked.id);
    const reopened = await author.call<TopicDetailDto>('topic_close', {
      id: asked.id,
      outcome: 'resolved',
      reason: 'Answered.',
    });
    expect(reopened.status).toBe('resolved');
    expect(
      (await author.call<TopicDetailDto>('topic_reopen', { id: asked.id, reason: 'More' })).status,
    ).toBe('open');
    expect((await author.call<TopicDetailDto>('topic_get', { id: asked.id })).entries).toHaveLength(
      3,
    );
  });
});
