/* eslint-disable @typescript-eslint/no-misused-spread -- response DTO classes are plain JSON at runtime */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InboxDto } from '../src/agent/agent.dto.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { LoginDto } from '../src/auth/identity.dto.js';
import { API_CONFIG, loadConfig, type ApiConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import type { ProposalDto } from '../src/contributions/contributions.dto.js';
import type {
  AttestationResultDto,
  CredibilityGatesDto,
  CredibilityQueueDto,
  MaintenanceDto,
  PeopleDto,
  SourceCheckResultDto,
  WhyDto,
} from '../src/credibility/credibility.dto.js';
import {
  CredibilityConfirmedErrors,
  CredibilitySignalsAdapter,
} from '../src/credibility/review-ports.js';
import type { NotificationListDto } from '../src/notifications/notifications.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { ProposalDetailDto } from '../src/review/review.dto.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import type { PageDto } from '../src/wiki/read.dto.js';
import { FixtureStorage } from '../src/wiki/storage/fixture-storage.js';
import { wikiPath } from '../src/wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../src/wiki/wiki.module.js';
import { NO_QUEUE } from './no-queue.js';
import { testSchema } from './test-schema.js';

/** Credibility (system-logic §7.7): evidence, reader actions, queue, gates, E8a invariants. */

const database = testSchema();
const email = 'cred-owner@example.org';
const password = 'credibility test password';
const storage = new FixtureStorage();
let config: ApiConfig;
let app: INestApplication | undefined;
let db: PrismaService;
let owner: Session;
let reviewer: Session;
let contributor: Session;
const readers: Session[] = [];
type Session = { cookie: string; csrf: string };

const http = () => request(app?.getHttpServer() as Parameters<typeof request>[0]);
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed response bodies
const body = <T>(res: Response) => res.body as T;
function as(who: Session) {
  const auth = (r: request.Test) => r.set('Cookie', who.cookie).set('X-CSRF-Token', who.csrf);
  return {
    get: (url: string) => auth(http().get(`/api/v1${url}`)),
    post: (url: string, data: object = {}) => auth(http().post(`/api/v1${url}`)).send(data),
    put: (url: string, data: object = {}) => auth(http().put(`/api/v1${url}`)).send(data),
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
async function user(address: string, roles: string[]) {
  await as(owner)
    .post('/admin/users', {
      email: address,
      name: address.split('@')[0],
      roles,
      teamId: null,
      password: 'pw-12345678',
    })
    .expect(201);
  return login(address, 'pw-12345678');
}
const enc = encodeURIComponent;
async function page(path: string) {
  return body<PageDto>(
    await as(owner)
      .get(`/wiki/pages/${enc(path)}`)
      .expect(200),
  );
}
async function section(path: string, anchor: string) {
  const s = (await page(path)).sections.find((x) => x.anchor === anchor);
  if (!s) throw new Error(`no section ${anchor}`);
  return s;
}
/** The contributor proposes `content`; the owner approves and publishes it. */
async function publish(path: string, content: string) {
  const ctx = body<{ versionLabel: string; sha256: string }>(
    await as(contributor)
      .get(`/context?path=${enc(path)}`)
      .expect(200),
  );
  const res = await as(contributor).post('/contributions', {
    targetPath: path,
    base: { versionLabel: ctx.versionLabel, sha256: ctx.sha256 },
    content,
    reason: `Change ${path}`,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const p = body<ProposalDto>(res);
  const d = body<ProposalDetailDto>(await as(owner).get(`/proposals/${p.slug}`).expect(200));
  if (!d.preview) throw new Error('no preview');
  await as(owner)
    .post(`/proposals/${p.slug}/decisions`, {
      approve: true,
      reason: 'Checked',
      ...d.preview.binding,
    })
    .expect(201);
  await as(owner).post(`/proposals/${p.slug}/publish`).expect(200);
  return p;
}

const PATH = 'imaging/lens.md';
const V1 =
  '# Lens\n\nIntro.\n\n## Detectors\n\nPMT gain may vary [1](https://doi.org/10.1101/abc).\n\n## Other\n\nX.\n';
const V2 =
  '# Lens\n\nIntro.\n\n## Detectors\n\nPMT gain may vary [1](https://doi.org/10.1101/abc), fixed.\n\n## Other\n\nX.\n';

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
    .overrideProvider(NO_QUEUE.provide)
    .useValue(NO_QUEUE.value)
    .overrideProvider(WIKI_STORAGE)
    .useValue(storage)
    .compile();
  app = module.createNestApplication();
  configureHttp(app, { public: true });
  await app.get(AuthService).seedOwner();
  await app.get(WikiIndexer).reindex();
  await app.init();
  db = app.get(PrismaService);
  owner = await login(email, password);
  reviewer = await user('cred-reviewer@example.org', ['reviewer']);
  contributor = await user('cred-contrib@example.org', ['contributor']);
  for (const n of [1, 2, 3]) readers.push(await user(`reader${String(n)}@example.org`, ['reader']));
  await storage.write(
    wikiPath(PATH),
    Buffer.from(V1.replace('may vary', 'varies')),
    { kind: 'create' },
    {},
  );
  await app.get(WikiIndexer).observe(wikiPath(PATH));
  await publish(PATH, V1);
}, 60_000);

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.drop();
  }
});

describe('labels follow evidence, never votes (E8a)', () => {
  it('starts Reviewed after a person approved the version', async () => {
    expect((await section(PATH, 'detectors')).label.label).toBe('reviewed');
  });

  it('reader attestations never reach Checked against source', async () => {
    const s = await section(PATH, 'detectors');
    for (const r of readers) {
      const res = await as(r).post('/attestations', {
        path: PATH,
        anchor: 'detectors',
        sectionHash: s.hash,
        kind: 'useful',
        sawCounts: false,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(body<AttestationResultDto>(res).label.label).toBe('reviewed');
    }
    await as(readers[0] ?? owner)
      .post('/page-feedback', {
        path: PATH,
        versionLabel: (await page(PATH)).versionLabel,
        answer: 'yes',
      })
      .expect(201);
    expect((await section(PATH, 'detectors')).label.label).toBe('reviewed');
    // The same kind twice by the same person on the same hash is a duplicate.
    const dup = await as(readers[0] ?? owner).post('/attestations', {
      path: PATH,
      anchor: 'detectors',
      sectionHash: s.hash,
      kind: 'useful',
      sawCounts: false,
    });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('the author of the section version may not attest it', async () => {
    const s = await section(PATH, 'detectors');
    const res = await as(contributor).post('/attestations', {
      path: PATH,
      anchor: 'detectors',
      sectionHash: s.hash,
      kind: 'useful',
      sawCounts: false,
    });
    expect(res.status).toBe(403);
  });

  it('hides counts until the reader acted or asked to reveal', async () => {
    const fresh = await user('reader-fresh@example.org', ['reader']);
    const hidden = body<PeopleDto>(
      await as(fresh)
        .get(`/sections/${enc(PATH)}/detectors/people`)
        .expect(200),
    );
    expect(hidden).toMatchObject({ hidden: true, useful: null });
    const shown = body<PeopleDto>(
      await as(fresh)
        .get(`/sections/${enc(PATH)}/detectors/people?reveal=true`)
        .expect(200),
    );
    expect(shown.hidden).toBe(false);
    expect(shown.useful).toBe(3);
  });
});

describe('evidence writes (§7.7.3)', () => {
  it('a person’s supported source check makes it Checked, bound to the current hash', async () => {
    const s = await section(PATH, 'detectors');
    await as(reviewer)
      .post('/source-checks', {
        path: PATH,
        anchor: 'detectors',
        sectionHash: 'f'.repeat(64),
        sourceRef: 'https://doi.org/10.1101/abc',
        result: 'supported',
      })
      .expect(409)
      .expect((res) => {
        expect(res.body).toMatchObject({ code: 'SECTION_CHANGED' });
      });
    const res = await as(reviewer).post('/source-checks', {
      path: PATH,
      anchor: 'detectors',
      sectionHash: s.hash,
      sourceRef: 'https://doi.org/10.1101/abc',
      result: 'supported',
      comparedNumbers: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(body<SourceCheckResultDto>(res).label.label).toBe('checked');
    const why = body<WhyDto>(
      await as(readers[1] ?? owner)
        .get(`/sections/${enc(PATH)}/detectors/why`)
        .expect(200),
    );
    expect(why.label.label).toBe('checked');
    expect(why.evidence.some((e) => e.kind === 'source_check' && e.contributes)).toBe(true);
    expect(why.baseRateCalibrated).toBe(false);
  });

  it('readers cannot record source checks', async () => {
    const s = await section(PATH, 'detectors');
    await as(readers[0] ?? owner)
      .post('/source-checks', {
        path: PATH,
        anchor: 'detectors',
        sectionHash: s.hash,
        sourceRef: 'x',
        result: 'supported',
      })
      .expect(403);
  });
});

describe('reports, the queue and fixes (§7.7.6, §7.7.8)', () => {
  let reportId = '';

  it('a blocking report opens a topic, tells page authors and lands in the queue', async () => {
    const s = await section(PATH, 'detectors');
    const res = await as(readers[2] ?? owner).post('/reports', {
      path: PATH,
      anchor: 'detectors',
      sectionHash: s.hash,
      kind: 'wrong',
      quote: 'PMT gain may vary',
      evidence: 'The datasheet says it is fixed.',
      blocking: true,
      sawCounts: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const result = body<AttestationResultDto>(res);
    reportId = result.attestation.id;
    expect(result.attestation).toMatchObject({ kind: 'report', state: 'open' });
    expect(result.attestation.topicId).toBeTruthy();
    expect(result.following).toBe(true);
    // The page author is the human whose proposal was published (no owners.md).
    const notes = body<NotificationListDto>(
      await as(contributor).get('/notifications').expect(200),
    );
    expect(notes.items.some((n) => n.event === 'report_received')).toBe(true);
    const queue = body<CredibilityQueueDto>(
      await as(owner).get('/credibility/queue?type=report').expect(200),
    );
    expect(queue.items.map((i) => i.id)).toContain(reportId);
    // Inbox › Check shows it to page authors (the role owner always counts).
    const inbox = body<InboxDto>(await as(owner).get('/inbox?tab=check').expect(200));
    expect(inbox.items.some((i) => i.kind === 'check' && i.path === PATH)).toBe(true);
  });

  it('an open report fires the agent trigger facts', async () => {
    const p = await db.proposal.findFirstOrThrow({ where: { targetPath: PATH } });
    const facts = await db.$transaction((tx) =>
      (app?.get(CredibilitySignalsAdapter) as CredibilitySignalsAdapter).facts(tx, {
        id: p.id,
        targetPath: PATH,
        baseVersionLabel: null,
        touched: ['detectors'],
      }),
    );
    expect(facts.openReports).toBe(1);
  });

  it('confirming puts the section under re-check in the same request', async () => {
    await as(readers[0] ?? owner)
      .post('/credibility/decisions', {
        type: 'report',
        id: reportId,
        outcome: 'confirm',
        reason: 'x',
      })
      .expect(403);
    const res = await as(owner).post('/credibility/decisions', {
      type: 'report',
      id: reportId,
      outcome: 'confirm',
      reason: 'The datasheet disagrees.',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await section(PATH, 'detectors')).label.label).toBe('recheck');
    await as(owner)
      .post('/credibility/decisions', {
        type: 'report',
        id: reportId,
        outcome: 'dismiss',
        reason: 'x',
      })
      .expect((r) => {
        expect([404, 409]).toContain(r.status);
      });
  });

  it('a published fix resets evidence and tells the reporter it was fixed', async () => {
    const before = await section(PATH, 'detectors');
    await publish(PATH, V2);
    const after = await section(PATH, 'detectors');
    expect(after.hash).not.toBe(before.hash);
    // Hash change resets evidence: the old source check no longer counts.
    expect(after.label.label).toBe('reviewed');
    const notes = body<NotificationListDto>(
      await as(readers[2] ?? owner)
        .get('/notifications')
        .expect(200),
    );
    expect(notes.items.some((n) => n.event === 'report_outcome')).toBe(true);
    const events = await db.attestationEvent.findMany({ where: { attestationId: reportId } });
    expect(events.map((e) => e.status)).toContain('fixed');
    // The contributor follows the page after a published suggestion.
    const follow = await db.follow.findFirst({ where: { path: PATH, reason: 'contributed' } });
    expect(follow).not.toBeNull();
  });
});

describe('confirmed errors from spot checks (D-214)', () => {
  it('records a ConfirmedError that labels the section Confirmed error', async () => {
    const s = await section(PATH, 'other');
    const ownerId = (await db.user.findFirstOrThrow({ where: { email } })).id;
    const versionLabel = (await page(PATH)).versionLabel;
    await db.$transaction((tx) =>
      (app?.get(CredibilityConfirmedErrors) as CredibilityConfirmedErrors).record(tx, {
        source: 'spot_check',
        spotCheckId: '019ac174-1da5-738a-a8c2-2f50343a60ff',
        proposalId: '019ac174-1da5-738a-a8c2-2f50343a60fe',
        path: PATH,
        versionLabel,
        sections: [{ anchor: 'other', sectionHash: s.hash }],
        actorId: ownerId,
        reason: 'Spot check failed',
        at: new Date(),
      }),
    );
    expect((await section(PATH, 'other')).label.label).toBe('error');
  });
});

describe('gates and maintenance (§7.7.7, §7.7.10)', () => {
  it('enabling a gate needs a run record and a past date; readers cannot', async () => {
    await as(readers[0] ?? owner)
      .get('/admin/credibility-gates')
      .expect(403);
    await as(owner).put('/admin/credibility-gates/nope', { enabled: true }).expect(404);
    await as(owner).put('/admin/credibility-gates/label_threshold', { enabled: true }).expect(400);
    await as(owner)
      .put('/admin/credibility-gates/label_threshold', {
        enabled: true,
        runRecord: 'experiments/runs/e8d/2026-01-10.json',
        runDate: '2099-01-01',
      })
      .expect(400);
    await as(owner)
      .put('/admin/credibility-gates/label_threshold', {
        enabled: true,
        runRecord: 'experiments/runs/e8d/2026-01-10.json',
        runDate: '2026-01-10',
      })
      .expect(200);
    const gates = body<CredibilityGatesDto>(
      await as(owner).get('/admin/credibility-gates').expect(200),
    );
    expect(gates.items.find((g) => g.capability === 'label_threshold')).toMatchObject({
      enabled: true,
      experiment: 'E8d',
      reference: { runDate: '2026-01-10' },
    });
    await as(owner).put('/admin/credibility-gates/label_threshold', { enabled: false }).expect(200);
  });

  it('runs maintenance on demand', async () => {
    const res = body<MaintenanceDto>(
      await as(owner).post('/admin/credibility/maintenance').expect(200),
    );
    expect(res.purged).toEqual({ attestations: 0, feedback: 0 });
    expect(typeof res.pairs).toBe('number');
  });
});

describe('security pass (P10-02): who may write evidence, report limits, retention', () => {
  it('refuses attestations and reports from API-token callers, even for a person', async () => {
    const fresh = await user('reader-token@example.org', ['reader']);
    const me = body<{ user: { id: string } }>(await as(fresh).get('/auth/session').expect(200));
    const created = await as(owner)
      .post('/admin/tokens', { userId: me.user.id, name: 'script', scopes: ['read', 'discuss'] })
      .expect(201);
    const bearer = `Bearer ${body<{ token: string }>(created).token}`;
    const s = await section(PATH, 'other');
    for (const [url, data] of [
      ['/attestations', { kind: 'useful', sawCounts: false }],
      ['/reports', { kind: 'wrong', quote: 'X', evidence: 'e', blocking: false, sawCounts: false }],
    ] as const) {
      const res = await http()
        .post(`/api/v1${url}`)
        .set('Authorization', bearer)
        .send({ path: PATH, anchor: 'other', sectionHash: s.hash, ...data });
      expect(res.status, url).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('limits reports to 5 per person per page per 7 days with Retry-After', async () => {
    const fresh = await user('reader-reports@example.org', ['reader']);
    const s = await section(PATH, 'other');
    const report = () =>
      as(fresh).post('/reports', {
        path: PATH,
        anchor: 'other',
        sectionHash: s.hash,
        kind: 'unclear',
        quote: 'X.',
        evidence: 'Too short to follow.',
        blocking: false,
        sawCounts: false,
      });
    for (let n = 0; n < 5; n += 1) expect((await report()).status).toBe(201);
    const limited = await report();
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(limited.header['retry-after'])).toBeGreaterThan(6 * 24 * 3600);
  });

  it('retention folds old feedback into counts and deletes the raw rows', async () => {
    const me = body<{ user: { id: string } }>(
      await as(readers[1] ?? owner)
        .get('/auth/session')
        .expect(200),
    );
    const old = await db.pageFeedback.create({
      data: {
        path: PATH,
        versionLabel: 'old-version',
        actorId: me.user.id,
        answer: 'no',
        createdAt: new Date(
          Date.now() - (config.CREDIBILITY_RETENTION_DAYS + 5) * 24 * 3600 * 1000,
        ),
      },
    });
    const res = body<MaintenanceDto>(
      await as(owner).post('/admin/credibility/maintenance').expect(200),
    );
    expect(res.purged.feedback).toBe(1);
    expect(await db.pageFeedback.findUnique({ where: { id: old.id } })).toBeNull();
    const folded = await db.credibilityAggregate.findMany({
      where: { path: PATH, versionLabel: 'old-version', metric: 'feedback_no' },
    });
    expect(folded.map((row) => row.count)).toEqual([1]);
  });
});
