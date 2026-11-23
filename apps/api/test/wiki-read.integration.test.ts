import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { computeSectionLabel, renderStatusBlock, splitSections } from '@md-wiki/domain';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { CreatedTokenDto, LoginDto } from '../src/auth/identity.dto.js';
import { API_CONFIG, loadConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import type {
  ContextDto,
  HistoryDto,
  PageDto,
  RecentDto,
  SearchDto,
  TreeDto,
} from '../src/wiki/read.dto.js';
import { SectionLabels, type SectionKey } from '../src/wiki/section-labels.js';
import { testSchema } from './test-schema.js';

const database = testSchema();
const email = 'wiki-owner@example.org';
const password = 'wiki test password';
const datedAt = '2026-01-01T00:00:00Z';
const basics = 'microscopy/basics.md';
const pageUrl = `/wiki/pages/${encodeURIComponent(basics)}`;
const strong = 'microscopy/rank.md';
const weak = 'lab-notes/rank.md';
const other = 'lab-notes/references.md';
const status = renderStatusBlock({
  proposal: 'wiki-fixture',
  decision: '12345678-1234-1234-1234-123456789abc',
  reviewer: 'person',
  decided_at: datedAt,
});
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const query = (params: Record<string, string> | [string, string][]) =>
  new URLSearchParams(params).toString();
const body = <T>(res: Omit<Response, 'body'> & { body: T }): T => res.body;
let app: INestApplication | undefined;
let root: string | undefined;
let oldMarkdown: string, newMarkdown: string, cookie: string;
let history: HistoryDto;

function http() {
  return request(app?.getHttpServer() as Parameters<typeof request>[0]);
}
function get(path: string) {
  return http().get(`/api/v1${path}`).set('Cookie', cookie);
}
function login() {
  return http().post('/api/v1/auth/login').send({ email, password }).expect(200);
}
function loginCookie(res: Response): string {
  const header: unknown = res.header['set-cookie'];
  const first: unknown = Array.isArray(header) ? header[0] : header;
  return typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
}
function problem(res: Response, code: string) {
  expect(res.headers['content-type']).toContain('application/problem+json');
  expect(res.body).toMatchObject({
    code,
    status: res.status,
    requestId: res.headers['x-request-id'],
  });
}

beforeAll(async () => {
  database.migrate();
  root = await mkdtemp(join(tmpdir(), 'md-wiki-read-'));
  await cp(fileURLToPath(new URL('../../../wiki-sample', import.meta.url)), root, {
    recursive: true,
  });
  const sample = await readFile(join(root, basics), 'utf8');
  oldMarkdown = `Introductory note.\n\n${sample}\n## Zeta\n\nOld instructions, antiqueonly.\n\n## Alpha\n\nLast.\n`;
  newMarkdown = oldMarkdown
    .replace('Microscopy Basics', 'Microscopy Basics Revised')
    .replace('Old instructions, antiqueonly.', 'Revised instructions.');
  await writeFile(join(root, basics), status + oldMarkdown);
  await writeFile(
    join(root, strong),
    '# Spectrometer\n\nWe use a <i class="instrument">spectrometer</i> here.\n\n## Repeat\n\nWe use a spectrometer twice.\n',
  );
  await writeFile(join(root, weak), '# Instruments\n\nWe use a spectrometer here.\n');
  await writeFile(join(root, other), '# Instruments\n\nWe also use a spectrometer.\n');
  await writeFile(join(root, 'empty.md'), '');
  await mkdir(join(root, 'wiki-meta'));
  await writeFile(
    join(root, 'wiki-meta/topics.md'),
    '| folder | name |\n| --- | --- |\n| microscopy | Z Imaging |\n| lab-notes | A Laboratory |\n',
  );
  const oldHash = splitSections(oldMarkdown).find(({ anchor }) => anchor === 'zeta')?.hash;
  const config = {
    ...loadConfig(),
    DATABASE_URL: database.url,
    WIKI_ROOT: root,
    OWNER_EMAIL: email,
    OWNER_PASSWORD: password,
  };
  const fixtureLabel = (section: SectionKey) => {
    const { path, anchor, sectionHash } = section;
    const evidence = { id: 'fixture', time: datedAt, kind: 'person' as const };
    const reviewedHash =
      path === weak ? sectionHash : path === basics && anchor === 'zeta' ? oldHash : undefined;
    return computeSectionLabel({
      currentHash: sectionHash,
      confirmedErrors: [],
      openRecheckReasons:
        path === other ? [{ ...evidence, sectionHash, reason: 'Verify setup' }] : [],
      reviewedVersions:
        reviewedHash === undefined ? [] : [{ ...evidence, sectionHash: reviewedHash }],
      sourceChecks: [],
      ownerConfirmations: [],
    });
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config)
    // No Phase 1 database records can produce these labels. Exercise the real domain
    // algorithm with fixture evidence rather than adding later-phase storage.
    .overrideProvider(SectionLabels)
    .useValue({
      forSections: (keys: Parameters<SectionLabels['forSections']>[0]) =>
        Promise.resolve(keys.map(fixtureLabel)),
      detailed: (keys: Parameters<SectionLabels['forSections']>[0]) =>
        Promise.resolve(
          keys.map((key) => ({ label: fixtureLabel(key), checkedBy: 0, sourceName: null })),
        ),
    })
    .compile();
  app = module.createNestApplication();
  configureHttp(app, { public: true });
  await app.get(AuthService).seedOwner();
  await app.get(WikiIndexer).reindex();
  await app.init();
  const auth = await login();
  cookie = loginCookie(auth);
  await writeFile(join(root, basics), status + newMarkdown);
  await http()
    .post('/api/v1/admin/reindex')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', body<LoginDto>(auth).csrfToken)
    .expect(200);
  const db = app.get(PrismaService);
  for (const [path, days] of [
    [weak, 90],
    [other, 0],
    [strong, 400],
  ] as const) {
    await db.page.update({
      where: { path },
      data: { updatedAt: new Date(Date.now() - days * 86_400_000) },
    });
  }
  history = body<HistoryDto>(await get(`${pageUrl}/history`).expect(200));
}, 30_000);

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

it('logs in, browses the sample, searches it, then reads context using an admin-created token', async () => {
  const session = await login();
  const sessionCookie = loginCookie(session);
  const { user, csrfToken } = body<LoginDto>(session);
  expect(user.roles).toEqual(['owner']);
  const tree = body<TreeDto>(
    await http().get('/api/v1/wiki/tree').set('Cookie', sessionCookie).expect(200),
  );
  expect(tree.topics.find(({ id }) => id === 'microscopy')?.pages).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: basics })]),
  );
  const page = body<PageDto>(
    await http().get(`/api/v1${pageUrl}`).set('Cookie', sessionCookie).expect(200),
  );
  const search = body<SearchDto>(
    await http()
      .get('/api/v1/search')
      .query({ q: 'bright-field microscope' })
      .set('Cookie', sessionCookie)
      .expect(200),
  );
  expect(search.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: basics, anchor: page.sections[1]?.anchor }),
    ]),
  );
  const created = body<CreatedTokenDto>(
    await http()
      .post('/api/v1/admin/tokens')
      .set('Cookie', sessionCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ userId: user.id, name: 'wiki client', scopes: ['read'] })
      .expect(201),
  );
  const context = body<ContextDto>(
    await http()
      .get('/api/v1/context')
      .query({ path: basics })
      .auth(created.token, { type: 'bearer' })
      .expect(200),
  );
  expect(context).toEqual({
    path: page.path,
    versionLabel: page.versionLabel,
    sha256: page.sha256,
    content: page.markdown,
    sections: page.sections,
  });
});

it('sorts the tree, filters topics exactly, and aggregates current labels including empty pages', async () => {
  const { topics } = body<TreeDto>(await get('/wiki/tree').expect(200));
  expect(topics.map(({ name }) => name)).toEqual([
    'A Laboratory',
    'General',
    'Wiki Meta',
    'Z Imaging',
  ]);
  const lab = topics[0];
  expect(lab?.pages.filter(({ title }) => title === 'Instruments').map(({ path }) => path)).toEqual(
    [weak, other],
  );
  expect(lab?.pageCount).toBe(lab?.pages.length);
  expect(lab?.pages.find(({ path }) => path === other)?.pageLabel).toMatchObject({
    label: 'recheck',
    spread: { recheck: 1 },
  });
  expect(topics[1]?.pages[0]?.pageLabel).toEqual({
    label: 'not_reviewed',
    spread: { checked: 0, reviewed: 0, not_reviewed: 0, recheck: 0, error: 0 },
  });
  expect(body<TreeDto>(await get('/wiki/tree?topic=lab-notes').expect(200)).topics).toEqual([lab]);
  expect(body<TreeDto>(await get('/wiki/tree?topic=unknown').expect(200))).toEqual({ topics: [] });
  expect(body<TreeDto>(await get('/wiki/tree?topic=%00').expect(200))).toEqual({ topics: [] });
});

it('serves indexed current and historical bytes, strips status, and keeps the document section order', async () => {
  const newest = body<PageDto>(await get(pageUrl).expect(200));
  const oldVersion = history.items[1]?.versionLabel ?? '';
  const old = body<PageDto>(await get(`${pageUrl}/versions/${oldVersion}`).expect(200));
  for (const [page, markdown] of [
    [newest, newMarkdown],
    [old, oldMarkdown],
  ] as const) {
    expect(page.markdown).toBe(markdown);
    expect(page.sha256).toBe(sha256(status + markdown));
    expect(page.sections.map(({ anchor, hash }) => ({ anchor, hash }))).toEqual(
      splitSections(markdown).map(({ anchor, hash }) => ({ anchor, hash })),
    );
    expect(page.sections.slice(-2).map(({ anchor }) => anchor)).toEqual(['zeta', 'alpha']);
    expect(page).toMatchObject({
      path: basics,
      topic: { id: 'microscopy', name: 'Z Imaging' },
      // no owners.md and nothing published through review: the owner maintains it (D-164)
      maintainers: [{ name: 'Owner' }],
      usedByTeams: 0,
      changedOutsideReview: false,
    });
  }
  expect(old.title).toBe('Microscopy Basics');
  expect(newest.title).toBe('Microscopy Basics Revised');
  expect(old.sections.find(({ anchor }) => anchor === 'zeta')?.label).toEqual({
    label: 'reviewed',
    since: datedAt,
    reviewerKind: 'person',
    reason: null,
  });
  expect(
    newest.sections.every(({ label, warn }) => label.label === 'not_reviewed' && warn === null),
  ).toBe(true);
  const warned = body<PageDto>(await get(`/wiki/pages/${encodeURIComponent(other)}`).expect(200));
  expect(warned.sections[0]?.warn).toEqual({ reason: 'Verify setup', fixProposalSlug: null });
  expect(
    body<ContextDto>(await get(`/context?${query({ path: basics })}`).expect(200)).content,
  ).toBe(newMarkdown);
});

it('paginates history and recent changes newest first, one per snapshot; mine is empty', async () => {
  expect(history.items.map(({ sha256 }) => sha256)).toEqual([
    sha256(status + newMarkdown),
    sha256(status + oldMarkdown),
  ]);
  expect(history.nextCursor).toBeNull();
  const first = body<HistoryDto>(await get(`${pageUrl}/history?limit=1`).expect(200));
  expect(first.items).toEqual(history.items.slice(0, 1));
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(
    body<HistoryDto>(
      await get(`${pageUrl}/history?limit=1&cursor=${first.nextCursor ?? ''}`).expect(200),
    ),
  ).toEqual({ items: history.items.slice(1), nextCursor: null });
  const recent = body<RecentDto>(await get('/wiki/recent?scope=all&limit=100').expect(200));
  expect(recent.items.map(({ at }) => at)).toEqual(
    recent.items
      .map(({ at }) => at)
      .sort()
      .reverse(),
  );
  expect(
    recent.items.filter(({ path }) => path === basics).map(({ versionLabel }) => versionLabel),
  ).toEqual(history.items.map(({ versionLabel }) => versionLabel));
  expect(recent.items[0]).toEqual({
    path: basics,
    pageTitle: 'Microscopy Basics Revised',
    versionLabel: history.items[0]?.versionLabel,
    at: history.items[0]?.capturedAt,
    changedOutsideReview: false,
    proposalSlug: null,
    sectionTitle: null,
    summary: null,
  });
  const firstRecent = body<RecentDto>(await get('/wiki/recent?limit=1').expect(200));
  expect(
    body<RecentDto>(await get(`/wiki/recent?cursor=${firstRecent.nextCursor ?? ''}`).expect(200))
      .items,
  ).toEqual(recent.items.slice(1));
  expect(body<RecentDto>(await get('/wiki/recent?scope=mine').expect(200))).toEqual({
    items: [],
    nextCursor: null,
  });
});

it.each([
  '/wiki/tree',
  pageUrl,
  `${pageUrl}/history`,
  `${pageUrl}/versions/unknown`,
  '/wiki/recent',
  '/context',
  '/search',
])('requires authentication on %s', async (path) => {
  problem(await http().get(`/api/v1${path}`).expect(401), 'UNAUTHENTICATED');
});
it.each([
  '/wiki/pages/unknown.md',
  '/wiki/pages/unknown.md/history',
  '/wiki/pages/unknown.md/versions/unknown',
  `${pageUrl}/versions/unknown`,
  `${pageUrl}/versions/%00`,
  '/context?path=unknown.md',
])('returns NOT_FOUND on %s', async (path) => {
  problem(await get(path).expect(404), 'NOT_FOUND');
});
it.each([
  '/wiki/pages/topic%2F..%2Fa.md',
  '/wiki/pages/%2Ewiki-system%2Fa.md/history',
  '/wiki/pages/UPPER.md/versions/unknown',
  '/wiki/pages/%FF.md',
  '/wiki/pages/%FF.md/history',
  '/wiki/pages/%FF.md/versions/unknown',
  '/context?path=bad%20file.md',
  '/context',
  '/context?path=a.md&path=b.md',
  `/context?path=${'a'.repeat(198)}.md`,
  '/context?path=%C3%A9.md',
])('returns INVALID_PATH on %s', async (path) => {
  problem(await get(path).expect(400), 'INVALID_PATH');
});

async function search(params: [string, string][] = []) {
  return body<SearchDto>(
    await get(`/search?${query([['q', 'spectrometer'], ...params])}`).expect(200),
  );
}
it('ranks independently of labels, sorts by trust or recency, and ignores archived matches', async () => {
  const relevance = await search();
  expect(relevance.total).toBe(4);
  expect(relevance.pageCount).toBe(3);
  expect(relevance.items[0]).toMatchObject({
    path: strong,
    anchor: 'spectrometer',
    label: { label: 'not_reviewed' },
  });
  const trust = await search([['sort', 'trust']]);
  expect(trust.items.map(({ path }) => path)).toEqual([weak, strong, strong, other]);
  expect(trust.items[1]?.anchor).toBe('spectrometer');
  expect((await search([['sort', 'recent']])).items.map(({ path }) => path)).toEqual([
    other,
    weak,
    strong,
    strong,
  ]);
  expect(body<SearchDto>(await get('/search?q=antiqueonly').expect(200)).total).toBe(0);
  const hit = relevance.items[0];
  expect(hit?.meta).toMatchObject({ checkedBy: 0, sourceName: null, usedByTeams: 0 });
  expect(hit?.meta.updatedAt).toMatch(/Z$/);
  expect(hit?.snippet[0]?.hit.toLowerCase()).toBe('spectrometer');
  expect(JSON.stringify(hit?.snippet)).not.toMatch(/<[^>]*>|mw_start_|mw_stop_/);
  expect(hit?.snippet.length).toBeLessThanOrEqual(2);
});

it('keeps recheck when labels exclude everything else and counts each facet without its own filter', async () => {
  const result = await search([['labels[]', 'checked']]);
  expect(result.total).toBe(1);
  expect(result.pageCount).toBe(1);
  expect(result.items[0]?.label).toMatchObject({ label: 'recheck', reason: 'Verify setup' });
  const both = await search([
    ['labels[]', 'checked'],
    ['topics[]', 'microscopy'],
  ]);
  expect(both).toEqual({
    total: 0,
    pageCount: 0,
    items: [],
    nextCursor: null,
    facets: {
      labels: { checked: 0, reviewed: 0, not_reviewed: 2, recheck: 0, error: 0 },
      topics: [{ id: 'lab-notes', name: 'A Laboratory', n: 1 }],
    },
  });
  const repeated = await search([
    ['labels[]', 'reviewed'],
    ['labels[]', 'not_reviewed'],
    ['topics[]', 'microscopy'],
    ['topics[]', 'lab-notes'],
  ]);
  expect(repeated.total).toBe(4);
});

it('filters by update time and paginates without changing totals or facets', async () => {
  expect((await search([['updated', '30d']])).items.map(({ path }) => path)).toEqual([other]);
  expect((await search([['updated', '1y']])).items.map(({ path }) => path).sort()).toEqual(
    [weak, other].sort(),
  );
  const all = await search([['updated', 'any']]);
  const first = await search([['limit', '2']]);
  expect(first.items).toEqual(all.items.slice(0, 2));
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await search([
    ['limit', '2'],
    ['cursor', first.nextCursor ?? ''],
  ]);
  expect(second.items).toEqual(all.items.slice(2));
  expect(second.nextCursor).toBeNull();
  expect(second.total).toBe(all.total);
  expect(second.pageCount).toBe(all.pageCount);
  expect(second.facets).toEqual(all.facets);
  expect(first.facets).toEqual(all.facets);
  expect(first.total).toBe(all.total);
});

it.each(['the and of', '& | ! :*', 'a'.repeat(200)])(
  'returns an empty result for %s',
  async (q) => {
    expect(body<SearchDto>(await get(`/search?${query({ q })}`).expect(200))).toEqual({
      total: 0,
      pageCount: 0,
      items: [],
      nextCursor: null,
      facets: {
        labels: { checked: 0, reviewed: 0, not_reviewed: 0, recheck: 0, error: 0 },
        topics: [],
      },
    });
  },
);
it('trims the search term and treats tsquery syntax as punctuation', async () => {
  const result = body<SearchDto>(
    await get(`/search?${query({ q: '  !spectrometer:* | &  ' })}`).expect(200),
  );
  expect(result).toEqual(await search());
});
it.each([
  '/search',
  '/search?q=',
  '/search?q=%20%20',
  `/search?q=${'a'.repeat(201)}`,
  '/search?q=a&q=b',
  '/search?q=x&sort=nope',
  '/search?q=x&updated=nope',
  '/search?q=x&labels%5B%5D=nope',
  '/search?q=x&topics%5B%5D=',
  '/search?q=x&limit=0',
  '/search?q=x&limit=101',
  '/search?q=x&limit=1.5',
  '/search?q=x&limit=1&limit=2',
  '/search?q=x&cursor=garbage',
  '/search?q=x&extra=y',
  '/wiki/tree?topic=a&topic=b',
  '/wiki/recent?scope=invalid',
  `${pageUrl}/history?cursor=broken`,
])('validates query parameters on %s', async (path) => {
  problem(await get(path).expect(400), 'VALIDATION_FAILED');
});
