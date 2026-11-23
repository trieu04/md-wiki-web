import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { parseContribution } from '@md-wiki/domain';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { CreatedTokenDto, LoginDto } from '../src/auth/identity.dto.js';
import { API_CONFIG, loadConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import type {
  ContributionDto,
  DraftDto,
  ProposalDto,
  SuggestionsDto,
} from '../src/contributions/contributions.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import type { ContextDto } from '../src/wiki/read.dto.js';
import { NO_QUEUE } from './no-queue.js';
import { testSchema } from './test-schema.js';

const database = testSchema();
const email = 'contribute-owner@example.org';
const password = 'contribute test password';
const page = 'microscopy/confocal.md';
const pageText =
  '# Confocal microscopy\n\nIntro.\n\n## Principle\n\nClosing the pinhole improves sectioning.\n\n## Detectors\n\nPMT.\n';
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
let app: INestApplication | undefined;
let root = '';
let owner: { cookie: string; csrf: string };
let other: { cookie: string; csrf: string };
let agentToken = '';
let reader: { cookie: string; csrf: string };

const http = () => request(app?.getHttpServer() as Parameters<typeof request>[0]);
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed response bodies
const body = <T>(res: Response) => res.body as T;
function as(who: { cookie: string; csrf: string }) {
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set('Cookie', who.cookie),
    post: (url: string, data?: object, headers: Record<string, string> = {}) =>
      http()
        .post(`/api/v1${url}`)
        .set('Cookie', who.cookie)
        .set('X-CSRF-Token', who.csrf)
        .set(headers)
        .send(data ?? {}),
    patch: (url: string, data: object, headers: Record<string, string> = {}) =>
      http()
        .patch(`/api/v1${url}`)
        .set('Cookie', who.cookie)
        .set('X-CSRF-Token', who.csrf)
        .set(headers)
        .send(data),
    del: (url: string) =>
      http().delete(`/api/v1${url}`).set('Cookie', who.cookie).set('X-CSRF-Token', who.csrf),
  };
}
const agent = {
  get: (url: string) => http().get(`/api/v1${url}`).set('Authorization', `Bearer ${agentToken}`),
  post: (url: string, data: object) =>
    http().post(`/api/v1${url}`).set('Authorization', `Bearer ${agentToken}`).send(data),
};
function problem(res: Response, status: number, code: string, fieldCode?: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.headers['content-type']).toContain('application/problem+json');
  expect(res.body).toMatchObject({ code });
  if (fieldCode)
    expect((res.body as { fields: { code: string }[] }).fields.map((f) => f.code)).toContain(
      fieldCode,
    );
}
async function login(user: string, pass: string) {
  const res = await http()
    .post('/api/v1/auth/login')
    .send({ email: user, password: pass })
    .expect(200);
  const header = res.header['set-cookie'] as unknown as string[];
  return { cookie: header[0]?.split(';')[0] ?? '', csrf: body<LoginDto>(res).csrfToken };
}
const draftUrl = (id: string) => `/drafts/${id}`;
const match = (draft: DraftDto) => ({ 'If-Match': `"${draft.updatedAt}"` });
/** The structure of a frozen manifest: its keys and the keys of every nested object. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return value === null ? 'null' : typeof value;
}

beforeAll(async () => {
  database.migrate();
  root = await mkdtemp(join(tmpdir(), 'md-wiki-contribute-'));
  await writeFile(join(root, 'index.md'), '# Home\n');
  await import('node:fs/promises').then((fs) => fs.mkdir(join(root, 'microscopy')));
  await writeFile(join(root, page), pageText);
  await writeFile(join(root, 'source.md'), '# Handbook\n\nPinhole: 1 AU.\n');
  await writeFile(join(root, 'guide.md'), '# Guide\n\nSteps.\n');
  const config = {
    ...loadConfig(),
    DATABASE_URL: database.url,
    WIKI_ROOT: root,
    OWNER_EMAIL: email,
    OWNER_PASSWORD: password,
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config)
    .overrideProvider(NO_QUEUE.provide)
    .useValue(NO_QUEUE.value)
    .compile();
  app = module.createNestApplication();
  configureHttp(app, { public: true });
  await app.get(AuthService).seedOwner();
  await app.get(WikiIndexer).reindex();
  await app.init();
  owner = await login(email, password);
  for (const [address, roles] of [
    ['other@example.org', ['contributor']],
    ['reader@example.org', ['reader']],
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
  other = await login('other@example.org', 'pw-12345678');
  reader = await login('reader@example.org', 'pw-12345678');
  const bot = await app.get(PrismaService).user.create({
    data: {
      email: 'author-agent@example.org',
      name: 'author-agent',
      kind: 'agent',
      roles: ['contributor'],
    },
  });
  agentToken = body<CreatedTokenDto>(
    await as(owner)
      .post('/admin/tokens', { userId: bot.id, name: 'agent', scopes: ['read', 'contribute'] })
      .expect(201),
  ).token;
}, 60_000);

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    try {
      await database.drop();
    } finally {
      if (root) await rm(root, { recursive: true, force: true });
    }
  }
});

async function openDraft(who = owner, section: string | null = 'principle', path = page) {
  const res = await as(who).post('/drafts', { targetPath: path, section });
  expect([200, 201]).toContain(res.status);
  return body<DraftDto>(res);
}

describe('drafts', () => {
  it('pins the target on open, resumes, autosaves with If-Match and stays private', async () => {
    const res = await as(owner)
      .post('/drafts', { targetPath: page, section: 'principle' })
      .expect(201);
    const draft = body<DraftDto>(res);
    expect(res.headers.etag).toBe(`"${draft.updatedAt}"`);
    expect(draft).toMatchObject({
      targetPath: page,
      pageTitle: 'Confocal microscopy',
      section: 'principle',
      sectionTitle: 'Principle',
      content: '## Principle\n\nClosing the pinhole improves sectioning.\n\n',
      baseText: '## Principle\n\nClosing the pinhole improves sectioning.\n\n',
      baseStartLine: 5,
      baseChanged: false,
      sectionChanged: false,
      currentText: null,
      sources: [],
    });
    expect(draft.base?.sha256).toBe(sha(pageText));
    expect(
      (await as(owner).post('/drafts', { targetPath: page, section: 'detectors' }).expect(200))
        .body,
    ).toMatchObject({
      id: draft.id,
      section: 'principle',
    });
    problem(await as(other).get(draftUrl(draft.id)), 404, 'NOT_FOUND');
    problem(await as(reader).post('/drafts', { targetPath: page }), 403, 'FORBIDDEN');

    problem(
      await as(owner).patch(draftUrl(draft.id), { reason: 'x' }),
      400,
      'VALIDATION_FAILED',
      'if_match',
    );
    const saved = body<DraftDto>(
      await as(owner)
        .patch(draftUrl(draft.id), { reason: 'State the pinhole in AU' }, match(draft))
        .expect(200),
    );
    expect(saved.reason).toBe('State the pinhole in AU');
    expect(saved.updatedAt > draft.updatedAt).toBe(true);
    problem(
      await as(owner).patch(draftUrl(draft.id), { reason: 'stale' }, match(draft)),
      409,
      'PRECONDITION_FAILED',
    );
    problem(
      await as(owner).patch(
        draftUrl(draft.id),
        { content: 'x'.repeat(1024 * 1024 + 1) },
        match(saved),
      ),
      413,
      'PAYLOAD_TOO_LARGE',
    );
    problem(
      await as(owner).patch(draftUrl(draft.id), { scope: { section: 'x' } }, match(saved)),
      400,
      'VALIDATION_FAILED',
    );
    problem(
      await as(owner).patch(draftUrl(draft.id), { bogus: 1 }, match(saved)),
      400,
      'VALIDATION_FAILED',
    );
    const list = await as(owner).get('/drafts').expect(200);
    expect((list.body as { items: DraftDto[] }).items.map((d) => d.id)).toContain(draft.id);
    await as(owner).del(draftUrl(draft.id)).expect(204);
    problem(await as(owner).get(draftUrl(draft.id)), 404, 'NOT_FOUND');
  });

  it('validates the target and section on open', async () => {
    problem(await as(owner).post('/drafts', { targetPath: '../x.md' }), 400, 'INVALID_PATH');
    problem(await as(owner).post('/drafts', { targetPath: 'Upper.md' }), 400, 'INVALID_PATH');
    problem(
      await as(owner).post('/drafts', { targetPath: 'missing.md', section: 'x' }),
      404,
      'NOT_FOUND',
    );
    problem(
      await as(owner).post('/drafts', { targetPath: 'guide.md', section: 'nope' }),
      400,
      'VALIDATION_FAILED',
      'UNKNOWN_SECTION',
    );
    const created = await openDraft(owner, null, 'new-page.md');
    expect(created).toMatchObject({ base: null, content: '', baseText: '', baseStartLine: 1 });
    problem(await as(owner).get(`/drafts/${created.id}/export`), 409, 'PRECONDITION_FAILED');
    await as(owner).del(draftUrl(created.id)).expect(204);
  });

  it('pins sources, rejects bad ones and removes them', async () => {
    const draft = await openDraft(owner, null, 'guide.md');
    const withSource = body<DraftDto>(
      await as(owner).post(`/drafts/${draft.id}/sources`, { path: 'source.md' }).expect(200),
    );
    expect(withSource.sources).toMatchObject([{ path: 'source.md', changed: false }]);
    problem(
      await as(owner).post(`/drafts/${draft.id}/sources`, { path: 'source.md' }),
      400,
      'VALIDATION_FAILED',
    );
    problem(
      await as(owner).post(`/drafts/${draft.id}/sources`, { path: 'guide.md' }),
      400,
      'VALIDATION_FAILED',
    );
    problem(
      await as(owner).post(`/drafts/${draft.id}/sources`, { path: 'missing.md' }),
      404,
      'NOT_FOUND',
    );
    problem(
      await as(owner).post(`/drafts/${draft.id}/sources`, { path: '/abs.md' }),
      400,
      'INVALID_PATH',
    );
    const removed = body<DraftDto>(
      await as(owner).del(`/drafts/${draft.id}/sources/source.md`).expect(200),
    );
    expect(removed.sources).toEqual([]);
    problem(await as(owner).del(`/drafts/${draft.id}/sources/source.md`), 404, 'NOT_FOUND');
    await as(owner).del(draftUrl(draft.id)).expect(204);
  });

  it('switches to whole page by splicing the edited section', async () => {
    let draft = await openDraft(owner, 'principle');
    draft = body<DraftDto>(
      await as(owner)
        .patch(draftUrl(draft.id), { content: '## Principle\n\nEdited.' }, match(draft))
        .expect(200),
    );
    draft = body<DraftDto>(
      await as(owner)
        .patch(draftUrl(draft.id), { scope: { section: null } }, match(draft))
        .expect(200),
    );
    expect(draft).toMatchObject({
      section: null,
      content: '# Confocal microscopy\n\nIntro.\n\n## Principle\n\nEdited.\n## Detectors\n\nPMT.\n',
    });
    await as(owner).del(draftUrl(draft.id)).expect(204);
  });

  it('detects a changed base, blocks submit with STALE_BASE and rebases per the table', async () => {
    let draft = await openDraft(other, 'principle');
    draft = body<DraftDto>(
      await as(other)
        .patch(
          draftUrl(draft.id),
          { content: '## Principle\n\nMine.\n\n', reason: 'Clarify' },
          match(draft),
        )
        .expect(200),
    );
    // Another section changes: rebase keeps the edit.
    await writeFile(join(root, page), pageText.replace('PMT.', 'HyD.'));
    problem(
      await as(other).post(`/drafts/${draft.id}/submit`, {}, match(draft)),
      409,
      'STALE_BASE',
    );
    await app?.get(WikiIndexer).reindex();
    const seen = body<DraftDto>(await as(other).get(draftUrl(draft.id)).expect(200));
    expect(seen).toMatchObject({ baseChanged: true, sectionChanged: false });
    draft = body<DraftDto>(await as(other).post(`/drafts/${draft.id}/rebase`, {}).expect(200));
    expect(draft).toMatchObject({ baseChanged: false, content: '## Principle\n\nMine.\n\n' });
    // The scoped section changes: auto refuses, keep_mine re-pins.
    await writeFile(
      join(root, page),
      pageText.replace('PMT.', 'HyD.').replace('improves', 'sharpens'),
    );
    problem(
      await as(other).post(`/drafts/${draft.id}/rebase`, { mode: 'auto' }),
      409,
      'SECTION_CHANGED',
    );
    const after = body<DraftDto>(await as(other).get(draftUrl(draft.id)).expect(200));
    expect(after).toMatchObject({ baseChanged: true, sectionChanged: true });
    expect(after.currentText).toContain('sharpens');
    draft = body<DraftDto>(
      await as(other).post(`/drafts/${draft.id}/rebase`, { mode: 'keep_mine' }).expect(200),
    );
    expect(draft).toMatchObject({ baseChanged: false, content: '## Principle\n\nMine.\n\n' });
    problem(
      await as(other).post(`/drafts/${draft.id}/rebase`, { mode: 'bad' }),
      400,
      'VALIDATION_FAILED',
    );
    await as(other).del(draftUrl(draft.id)).expect(204);
    await writeFile(join(root, page), pageText);
  });

  it('blocks submit when a pinned source changed (no silent recapture)', async () => {
    let draft = await openDraft(other, null, 'guide.md');
    draft = body<DraftDto>(
      await as(other).post(`/drafts/${draft.id}/sources`, { path: 'source.md' }).expect(200),
    );
    draft = body<DraftDto>(
      await as(other)
        .patch(
          draftUrl(draft.id),
          { content: '# Guide\n\nNew steps.\n', reason: 'Per handbook' },
          match(draft),
        )
        .expect(200),
    );
    await writeFile(join(root, 'source.md'), '# Handbook\n\nPinhole: 2 AU.\n');
    const res = await as(other).post(`/drafts/${draft.id}/submit`, {}, match(draft));
    problem(res, 409, 'SOURCE_CHANGED', 'SOURCE_CHANGED');
    expect((await as(other).get(draftUrl(draft.id)).expect(200)).body).toMatchObject({
      sources: [{ changed: true }],
    });
    await writeFile(join(root, 'source.md'), '# Handbook\n\nPinhole: 1 AU.\n');
    await as(other).del(draftUrl(draft.id)).expect(204);
  });

  it('requires a reason, a change and the current If-Match to submit', async () => {
    let draft = await openDraft(other, 'detectors');
    problem(
      await as(other).post(`/drafts/${draft.id}/submit`, {}, match(draft)),
      400,
      'VALIDATION_FAILED',
      'REASON_REQUIRED',
    );
    draft = body<DraftDto>(
      await as(other).patch(draftUrl(draft.id), { reason: 'No-op' }, match(draft)).expect(200),
    );
    problem(
      await as(other).post(`/drafts/${draft.id}/submit`, {}, match(draft)),
      400,
      'VALIDATION_FAILED',
      'NO_CHANGE',
    );
    draft = body<DraftDto>(
      await as(other)
        .patch(
          draftUrl(draft.id),
          { content: '## Detectors\n\n<!-- md-wiki:status\n' },
          match(draft),
        )
        .expect(200),
    );
    problem(
      await as(other).post(`/drafts/${draft.id}/submit`, {}, match(draft)),
      400,
      'VALIDATION_FAILED',
      'RESERVED_MARKER',
    );
    problem(
      await as(other).post(
        `/drafts/${draft.id}/submit`,
        {},
        { 'If-Match': '"2020-01-01T00:00:00.000Z"' },
      ),
      409,
      'PRECONDITION_FAILED',
    );
    await as(other).del(draftUrl(draft.id)).expect(204);
  });
});

describe('P4-G: human, agent and import submissions', () => {
  it('produce identical bundle structure, all pending', async () => {
    // Human: editor draft → submit.
    let draft = await openDraft(owner, 'principle');
    draft = body<DraftDto>(
      await as(owner).post(`/drafts/${draft.id}/sources`, { path: 'source.md' }).expect(200),
    );
    draft = body<DraftDto>(
      await as(owner)
        .patch(
          draftUrl(draft.id),
          {
            content:
              '## Principle\n\nClosing the pinhole below 1 AU gives little extra sectioning.\n\n',
            reason: 'State the pinhole size in Airy units as the handbook does.',
            appliesTo: [{ name: 'LAS X', version: '4.1' }],
          },
          match(draft),
        )
        .expect(200),
    );
    const exported = await as(owner).get(`/drafts/${draft.id}/export`).expect(200);
    expect(exported.headers['content-type']).toContain('text/markdown');
    expect(exported.headers['content-disposition']).toMatch(
      /state-the-pinhole-size-in-airy-units-as-the-handbook-does\.contribution\.md/,
    );
    const human = body<ProposalDto>(
      await as(owner).post(`/drafts/${draft.id}/submit`, {}, match(draft)).expect(201),
    );
    expect(human).toMatchObject({
      slug: 'state-the-pinhole-size-in-airy-units-as-the-handbook-does',
      state: 'pending',
      origin: 'editor',
      section: 'principle',
      sectionTitle: 'Principle',
      submitter: { kind: 'human' },
      scope: [{ path: page, impact: 'Edits section #principle' }],
      sources: [{ path: 'source.md' }],
    });
    problem(await as(owner).get(draftUrl(draft.id)), 404, 'NOT_FOUND');

    // Agent: read /context, then POST /contributions with the version it read.
    const context = body<ContextDto>(
      await agent.get(`/context?path=${encodeURIComponent(page)}`).expect(200),
    );
    const sourceContext = body<ContextDto>(await agent.get('/context?path=source.md').expect(200));
    const agentBody = {
      targetPath: page,
      base: { versionLabel: context.versionLabel, sha256: context.sha256 },
      content: context.content.replace('PMT.', 'PMT or HyD.'),
      reason: 'Add the HyD detector',
      section: 'detectors',
      slug: 'add-hyd-detector',
      sources: [{ path: 'source.md', versionLabel: sourceContext.versionLabel }],
      appliesTo: [{ name: 'Leica SP8', version: '3.5' }],
    };
    const machine = body<ProposalDto>(await agent.post('/contributions', agentBody).expect(201));
    expect(machine).toMatchObject({
      slug: 'add-hyd-detector',
      state: 'pending',
      origin: 'api',
      submitter: { kind: 'agent' },
    });
    // Idempotent replay; a different bundle under the same slug is refused.
    expect(body<ProposalDto>(await agent.post('/contributions', agentBody).expect(200)).id).toBe(
      machine.id,
    );
    problem(
      await agent.post('/contributions', { ...agentBody, reason: 'Other' }),
      409,
      'ALREADY_EXISTS',
    );

    // Import: the exported file of a fresh human draft.
    let second = await openDraft(owner, null, 'guide.md');
    second = body<DraftDto>(
      await as(owner)
        .patch(
          draftUrl(second.id),
          { content: '# Guide\n\nBetter steps.\n', reason: 'Clearer steps', title: 'Guide steps' },
          match(second),
        )
        .expect(200),
    );
    second = body<DraftDto>(
      await as(owner).post(`/drafts/${second.id}/sources`, { path: 'source.md' }).expect(200),
    );
    const file = (await as(owner).get(`/drafts/${second.id}/export`).expect(200)).text;
    const imported = body<ProposalDto>(
      await agent.post('/contributions/import', { file }).expect(201),
    );
    expect(imported).toMatchObject({
      slug: 'guide-steps',
      state: 'pending',
      origin: 'import',
      title: 'Guide steps',
    });
    expect(
      body<ProposalDto>(await agent.post('/contributions/import', { file }).expect(200)).id,
    ).toBe(imported.id);

    // Editor submit of the same draft: next free slug, otherwise the same bundle as its import.
    const editorSecond = body<ProposalDto>(
      await as(owner).post(`/drafts/${second.id}/submit`, {}, match(second)).expect(201),
    );
    expect(editorSecond).toMatchObject({
      slug: 'guide-steps-2',
      origin: 'editor',
      state: 'pending',
    });
    const [importedView, editorView] = await Promise.all(
      [imported, editorSecond].map(async (p) =>
        body<ContributionDto>(await as(owner).get(`/contributions/${p.slug}`).expect(200)),
      ),
    );
    expect(editorView?.proposed).toBe(importedView?.proposed);
    expect({ ...(JSON.parse(editorView?.manifest ?? '{}') as object), id: 'x' }).toEqual({
      ...(JSON.parse(importedView?.manifest ?? '{}') as object),
      id: 'x',
    });
    await openDraft(owner, null, 'source.md');

    const views = await Promise.all(
      [human, machine, imported].map(async (p) =>
        body<ContributionDto>(await as(owner).get(`/contributions/${p.slug}`).expect(200)),
      ),
    );
    const manifests = views.map((v) => JSON.parse(v.manifest) as Record<string, unknown>);
    const keys = manifests.map((m) => Object.keys(m));
    expect(keys[1]).toEqual(keys[0]);
    expect(keys[2]).toEqual(keys[0]);
    const structure = manifests.map((m) => {
      const s = shape(m) as Record<string, unknown>;
      return { ...s, section: 'string|null', applies_to: 'array', source_references: 'array' };
    });
    expect(structure[1]).toEqual(structure[0]);
    expect(structure[2]).toEqual(structure[0]);
    for (const v of views) {
      expect(v.state).toBe('pending');
      expect(sha(Buffer.from(v.manifest, 'utf8'))).toBe(v.bundleHash);
      expect(sha(v.proposed)).toBe(v.proposedSha256);
    }
    const rows = await app?.get(PrismaService).proposal.findMany({ include: { refs: true } });
    expect(rows?.map((r) => r.state)).toEqual(['pending', 'pending', 'pending', 'pending']);
    expect(
      rows
        ?.find((r) => r.slug === human.slug)
        ?.refs.map((r) => r.role)
        .sort(),
    ).toEqual(['source', 'target']);

    // Suggestions list both kinds for their owner.
    const mine = body<SuggestionsDto>(await as(owner).get('/me/suggestions').expect(200));
    expect(mine.total).toBe(3);
    expect(mine.items.map((i) => [i.kind, i.state])).toEqual([
      ['draft', 'draft'],
      ['proposal', 'pending'],
      ['proposal', 'pending'],
    ]);
    const paged = body<SuggestionsDto>(await as(owner).get('/me/suggestions?limit=1').expect(200));
    expect(paged.nextCursor).not.toBeNull();
    const next = body<SuggestionsDto>(
      await as(owner)
        .get(`/me/suggestions?limit=1&cursor=${paged.nextCursor ?? ''}`)
        .expect(200),
    );
    expect(next.items[0]?.kind).toBe('proposal');
    problem(await as(owner).get('/me/suggestions?cursor=bad!'), 400, 'VALIDATION_FAILED');
  });

  it('keeps proposals frozen in the database', async () => {
    const db = (app as INestApplication).get(PrismaService);
    await expect(db.$executeRaw`UPDATE "Proposal" SET "proposed" = 'x'::bytea`).rejects.toThrow(
      /frozen/,
    );
    await expect(db.$executeRaw`DELETE FROM "ProposalRef"`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "Proposal"`).rejects.toThrow(/never deleted/);
    await expect(
      db.$executeRaw`UPDATE "Proposal" SET "state" = 'pending'`,
    ).resolves.toBeGreaterThan(0);
  });
});

describe('agent contributions', () => {
  it('rejects forged, stale and malformed contributions', async () => {
    const context = body<ContextDto>(
      await agent.get(`/context?path=${encodeURIComponent(page)}`).expect(200),
    );
    const good = {
      targetPath: page,
      base: { versionLabel: context.versionLabel, sha256: context.sha256 },
      content: context.content + '\nMore.\n',
      reason: 'Add more',
    };
    problem(
      await agent.post('/contributions', {
        ...good,
        base: { ...good.base, versionLabel: '20200101-999' },
      }),
      400,
      'VALIDATION_FAILED',
      'UNKNOWN_VERSION',
    );
    problem(
      await agent.post('/contributions', {
        ...good,
        base: { ...good.base, sha256: '0'.repeat(64) },
      }),
      400,
      'VALIDATION_FAILED',
      'UNKNOWN_VERSION',
    );
    problem(await agent.post('/contributions', { ...good, base: null }), 409, 'STALE_BASE');
    problem(
      await agent.post('/contributions', {
        ...good,
        sources: [{ path: 'source.md', versionLabel: '20200101-1' }],
      }),
      400,
      'VALIDATION_FAILED',
      'UNKNOWN_VERSION',
    );
    problem(
      await agent.post('/contributions', { ...good, targetPath: 'A.md' }),
      400,
      'INVALID_PATH',
    );
    problem(await agent.post('/contributions', { ...good, reason: ' ' }), 400, 'VALIDATION_FAILED');
    problem(
      await agent.post('/contributions', { ...good, slug: 'Bad_Slug' }),
      400,
      'VALIDATION_FAILED',
      'INVALID_ID',
    );
    problem(
      await agent.post('/contributions', { ...good, section: 'missing' }),
      400,
      'VALIDATION_FAILED',
      'UNKNOWN_SECTION',
    );
    problem(
      await agent.post('/contributions', { ...good, content: '<!-- md-wiki:status\n' }),
      400,
      'VALIDATION_FAILED',
      'RESERVED_MARKER',
    );
    problem(
      await agent.post('/contributions', { ...good, content: 'x'.repeat(1024 * 1024 + 1) }),
      413,
      'PAYLOAD_TOO_LARGE',
    );
    // Concurrent change of the target after the agent read it (md-wiki test_missing_duplicate_sources_and_changed_target).
    await writeFile(join(root, page), pageText + '\nConcurrent.\n');
    problem(await agent.post('/contributions', good), 409, 'STALE_BASE');
    await writeFile(join(root, page), pageText);
    // A new page.
    const created = await agent.post('/contributions', {
      targetPath: 'new/created.md',
      base: null,
      content: '# New\n',
      reason: 'Create it',
    });
    expect(created.status).toBe(201);
    expect(body<ProposalDto>(created)).toMatchObject({
      base: null,
      scope: [{ impact: 'Creates the page', versionLabel: null }],
    });
    problem(await http().post('/api/v1/contributions').send(good), 401, 'UNAUTHENTICATED');
  });

  it('rejects malformed or tampered contribution files', async () => {
    problem(
      await agent.post('/contributions/import', { file: '# not a contribution\n' }),
      400,
      'VALIDATION_FAILED',
      'CONTRIBUTION_FORMAT',
    );
    const owned = body<DraftDto>(
      await as(other).post('/drafts', { targetPath: 'index.md', section: null }).expect(201),
    );
    const saved = body<DraftDto>(
      await as(other)
        .patch(draftUrl(owned.id), { content: '# Home v2\n', reason: 'Rename' }, match(owned))
        .expect(200),
    );
    const file = (await as(other).get(`/drafts/${saved.id}/export`).expect(200)).text;
    problem(
      await agent.post('/contributions/import', { file: file.replace('# Home v2', '# Tampered') }),
      400,
      'VALIDATION_FAILED',
      'HASH_MISMATCH',
    );
    problem(
      await agent.post('/contributions/import', {
        file: file.replace('wiki-contribution-v3', 'wiki-contribution-v2'),
      }),
      400,
      'VALIDATION_FAILED',
      'CONTRIBUTION_FORMAT',
    );
    problem(
      await agent.post('/contributions/import', { file: 'x'.repeat(4 * 1024 * 1024 + 65537) }),
      413,
      'PAYLOAD_TOO_LARGE',
    );
    await writeFile(join(root, 'index.md'), '# Home changed\n');
    problem(await agent.post('/contributions/import', { file }), 409, 'STALE_BASE');
    await unlink(join(root, 'index.md'));
    expect(parseContribution(Buffer.from(file)).ok).toBe(true);
  });

  it('hides proposals from users who neither submitted nor review them', async () => {
    problem(await as(other).get('/contributions/add-hyd-detector'), 404, 'NOT_FOUND');
    await agent.get('/contributions/add-hyd-detector').expect(200);
    problem(await agent.get('/contributions/missing'), 404, 'NOT_FOUND');
  });
});
