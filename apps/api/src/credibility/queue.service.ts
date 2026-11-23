import { Inject, Injectable } from '@nestjs/common';
import {
  citedSources,
  LABEL_ORDER,
  linkedPaths,
  QUEUE_OUTCOMES,
  QUEUE_TYPES,
  queueOrder,
  reciprocalPairs,
  sectionKeyOf,
  tierOf,
  type Label,
  type QueueType,
} from '@md-wiki/domain';
import type { Attestation } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { DiscussionsService } from '../discussions/discussions.service.js';
import { userRef } from '../review/views.js';
import { offsetCursor, offsetOf, pageLabels } from '../wiki/current-sections.js';
import type { Wire } from '../wiki/read.dto.js';
import type { SectionKey } from '../wiki/section-evidence.js';
import { usedByTeams } from '../wiki/usage.js';
import { AttestationsService } from './attestations.service.js';
import { CredibilityCore, emptySpread, type Db, type Tx } from './credibility-core.js';
import type {
  CredibilityPagesDto,
  CredibilityQueueDto,
  CredibilitySourcesDto,
  DecisionInput,
  QueueItemDetailDto,
  QueueItemDto,
  SectionKeyDto,
  SourcesInput,
} from './credibility.dto.js';
import { EvidenceService } from './evidence.service.js';

type Item = Wire<QueueItemDto> & { key: SectionKey | null; path: string };
const FLAG_REASON: Record<string, string> = {
  retraction: 'A cited source was retracted',
  source_changed: 'The source changed',
  version_changed: 'The source has a new version',
  contradiction: 'Another page contradicts it',
  root_wrong: 'A source it builds on was found wrong',
  propagated: 'It derives from a section with a problem',
};
const REPORT_KIND: Record<string, string> = {
  wrong: 'Wrong',
  outdated: 'Outdated',
  unclear: 'Unclear',
  source: 'Source problem',
  other: 'Other',
};
const OUTCOME_TEXT: Record<string, string> = {
  confirm: 'confirmed; the section is under re-check',
  confirm_error: 'confirmed as an error',
  dismiss: 'dismissed',
};
const DAY = 86_400_000;

/** Workspace › Credibility (system-logic §7.7.8, D-174). */
@Injectable()
export class QueueService {
  constructor(
    @Inject(CredibilityCore) private readonly core: CredibilityCore,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(AttestationsService) private readonly attestations: AttestationsService,
    @Inject(DiscussionsService) private readonly discussions: DiscussionsService,
  ) {}

  private get db() {
    return this.core.db;
  }

  private requireRead(identity: Identity) {
    this.core.require(identity, 'proposal.read');
  }

  // ---- items --------------------------------------------------------------------------------

  private async openReports(db: Db): Promise<Attestation[]> {
    const rows = await db.attestation.findMany({ where: { kind: 'report' }, orderBy: { createdAt: 'asc' } });
    const derived = await this.attestations.derive(rows, db);
    return rows.filter((r) => derived.get(r.id)?.state === 'open');
  }

  private async unresolvedRetractions(db: Db) {
    const rows = await db.invalidationEvent.findMany({ where: { kind: 'retraction' }, orderBy: { detectedAt: 'asc' } });
    const resolved = await db.credibilityResolution.findMany({
      where: { subjectType: 'retraction', subjectId: { in: rows.map((r) => r.id) } },
    });
    const out: { row: (typeof rows)[number]; open: SectionKey[] }[] = [];
    for (const row of rows) {
      const affected = await this.evidence.affected(db, row.ref);
      const done = new Set(
        resolved
          .filter((r) => r.subjectId === row.id && r.path && r.anchor && r.sectionHash)
          .map((r) => sectionKeyOf({ path: r.path ?? '', anchor: r.anchor ?? '', sectionHash: r.sectionHash ?? '' })),
      );
      const open = affected.filter((k) => !done.has(sectionKeyOf(k)));
      if (open.length) out.push({ row, open });
    }
    return out;
  }

  private async openFlags(db: Db) {
    const flags = await db.$queryRaw<
      { id: string; path: string; anchor: string; sectionHash: string; cause: string; reason: string; depth: number; createdAt: Date }[]
    >`
      SELECT f.id, f.path, f.anchor, f."sectionHash", f.cause::text AS cause, f.reason, f.depth, f."createdAt"
      FROM "RecheckFlag" f
      JOIN "Page" p ON p.path = f.path
      JOIN "PageSection" s ON s.path = f.path AND s."versionLabel" = p."currentVersionLabel"
        AND s.anchor = f.anchor AND s."sectionHash" = f."sectionHash"
      WHERE f.cause <> 'report'
        AND NOT EXISTS (SELECT 1 FROM "CredibilityResolution" r WHERE r."subjectType" = 'flag' AND r."subjectId" = f.id)
      ORDER BY f."createdAt" ASC`;
    return flags;
  }

  private async openCandidates(db: Db) {
    return db.$queryRaw<
      { id: string; kind: string; srcPath: string; srcAnchor: string; dstPath: string; dstAnchor: string; score: number; createdAt: Date }[]
    >`
      SELECT c.id, c.kind::text AS kind, c."srcPath", c."srcAnchor", c."dstPath", c."dstAnchor", c.score, c."createdAt"
      FROM "EdgeCandidate" c
      WHERE NOT EXISTS (SELECT 1 FROM "CredibilityResolution" r WHERE r."subjectType" = 'candidate'
        AND r."subjectId" = c.id AND r.outcome IN ('yes', 'no'))
      ORDER BY c."createdAt" ASC`;
  }

  /** Reciprocal pairs among counting attestations (§7.7.7). */
  async pairs(db: Db = this.db) {
    const rows = await db.attestation.findMany({ where: { kind: { in: ['checked', 'used', 'useful'] } } });
    const derived = await this.attestations.derive(rows, db);
    const live = rows.filter((r) => ['active', 'downweighted'].includes(derived.get(r.id)?.state ?? ''));
    const authors = new Map<string, string[]>();
    for (const r of live) {
      const k = sectionKeyOf(r);
      if (!authors.has(k)) authors.set(k, [...(await this.core.authorship(r, db)).submitters]);
    }
    const pairs = reciprocalPairs(live.map((r) => ({ id: r.id, actorId: r.actorId, authorIds: authors.get(sectionKeyOf(r)) ?? [] })));
    return { pairs, rows: live, derived };
  }

  private async items(_identity: Identity, db: Db = this.db): Promise<Item[]> {
    const [reports, retractions, flags, candidates, pairs, pending] = await Promise.all([
      this.openReports(db),
      this.unresolvedRetractions(db),
      this.openFlags(db),
      this.openCandidates(db),
      this.pairs(db),
      db.proposal.findMany({ where: { state: 'pending' }, select: { slug: true, title: true, targetPath: true, section: true, createdAt: true } }),
    ]);
    const raw: Omit<Item, 'reach' | 'section'>[] = [];
    for (const r of reports) {
      const d = r.details as { kind?: string; quote?: string };
      raw.push({
        type: 'report',
        id: r.id,
        title: `Report: ${REPORT_KIND[d.kind ?? 'other'] ?? 'Other'}`,
        why: d.quote ? `“${d.quote}”` : 'A reader reported a problem',
        at: r.createdAt.toISOString(),
        outcomes: [...QUEUE_OUTCOMES.report],
        blocking: r.blocking,
        key: r,
        path: r.path,
      });
    }
    for (const { row, open } of retractions)
      raw.push({
        type: 'retraction',
        id: row.id,
        title: `Source retracted: ${row.ref}`,
        why: `${String(open.length)} section${open.length === 1 ? '' : 's'} cite or were checked against it`,
        at: row.detectedAt.toISOString(),
        outcomes: [...QUEUE_OUTCOMES.retraction],
        blocking: false,
        key: open[0] ?? null,
        path: open[0]?.path ?? '',
      });
    for (const f of flags)
      raw.push({
        type: 'flag',
        id: f.id,
        title: FLAG_REASON[f.cause] ?? 'Under re-check',
        why: f.reason,
        at: f.createdAt.toISOString(),
        outcomes: [...QUEUE_OUTCOMES.flag],
        blocking: false,
        key: f,
        path: f.path,
      });
    const candidateKeys = await this.core.currentKeys(candidates.map((c) => ({ path: c.dstPath, anchor: c.dstAnchor })), db);
    for (const c of candidates)
      raw.push({
        type: 'candidate',
        id: c.id,
        title: `Possible ${c.kind} link`,
        why: `${c.srcPath}#${c.srcAnchor} → ${c.dstPath}#${c.dstAnchor} (score ${c.score.toFixed(2)})`,
        at: c.createdAt.toISOString(),
        outcomes: [...QUEUE_OUTCOMES.candidate],
        blocking: false,
        key: candidateKeys.find((k) => k.path === c.dstPath && k.anchor === c.dstAnchor) ?? null,
        path: c.dstPath,
      });
    for (const p of pairs.pairs) {
      const first = pairs.rows.find((r) => r.id === p.attestationIds[0]);
      raw.push({
        type: 'pair',
        id: p.people.join('.'),
        title: 'Reciprocal attestations',
        why: 'Two readers attested versions the other wrote; their attestations count with less weight',
        at: (first?.createdAt ?? new Date(0)).toISOString(),
        outcomes: [],
        blocking: false,
        key: first ?? null,
        path: first?.path ?? '',
      });
    }
    const issues = new Set([
      ...reports.map((r) => `${r.path}\0${r.anchor}`),
      ...flags.map((f) => `${f.path}\0${f.anchor}`),
      ...(await db.confirmedError.findMany({ select: { path: true, anchor: true } })).map((e) => `${e.path}\0${e.anchor}`),
    ]);
    const issuePaths = new Set([...issues].map((i) => i.split('\0')[0]));
    for (const p of pending) {
      const hit = p.section ? issues.has(`${p.targetPath}\0${p.section}`) : issuePaths.has(p.targetPath);
      if (!hit) continue;
      raw.push({
        type: 'fix',
        id: p.slug,
        title: `Fix in review: ${p.title}`,
        why: 'A pending proposal changes a section with an open issue',
        at: p.createdAt.toISOString(),
        outcomes: [],
        blocking: false,
        key: null,
        path: p.targetPath,
      });
    }
    return this.withReach(raw, db);
  }

  private async withReach(raw: Omit<Item, 'reach' | 'section'>[], db: Db): Promise<Item[]> {
    const texts = await db.$queryRaw<{ path: string; text: string }[]>`
      SELECT s.path, s.text FROM "PageSection" s
      JOIN "Page" p ON p.path = s.path AND p."currentVersionLabel" = s."versionLabel"`;
    const linked = new Map<string, Set<string>>();
    for (const t of texts)
      for (const target of linkedPaths(t.text, t.path)) linked.set(target, (linked.get(target) ?? new Set()).add(t.path));
    const paths = [...new Set(raw.map((r) => r.path).filter(Boolean))];
    const pages = await this.core.pageMap(paths, db);
    const sectionKeys = [...pages.values()].flatMap((p) => p.sections.map((s) => ({ path: p.path, anchor: s.anchor, sectionHash: s.sectionHash })));
    const teams = await usedByTeams(db, sectionKeys, (k) => k.path);
    const keys = raw.flatMap((r) => (r.key ? [r.key] : []));
    const dtos = await this.core.keyDtos(keys, db);
    const byKey = new Map(dtos.map((d) => [sectionKeyOf(d), d]));
    return raw.map((r) => ({
      ...r,
      key: r.key ? { path: r.key.path, anchor: r.key.anchor, sectionHash: r.key.sectionHash } : null,
      section: r.key ? (byKey.get(sectionKeyOf(r.key)) ?? null) : null,
      reach: { linkedFrom: linked.get(r.path)?.size ?? 0, teams: teams.get(r.path) ?? 0 },
    }));
  }

  private strip(item: Item): Wire<QueueItemDto> {
    const dto: Partial<Item> = { ...item };
    delete dto.key;
    delete dto.path;
    return dto as Wire<QueueItemDto>;
  }

  async queue(identity: Identity, input: { type?: QueueType; limit?: number; cursor?: string }): Promise<Wire<CredibilityQueueDto>> {
    this.requireRead(identity);
    const all = queueOrder(await this.items(identity));
    const counts = Object.fromEntries([...QUEUE_TYPES.map((t) => [t, all.filter((i) => i.type === t).length]), ['all', all.length]]) as Wire<CredibilityQueueDto>['counts'];
    const filtered = input.type ? all.filter((i) => i.type === input.type) : all;
    const limit = input.limit ?? 25;
    let start = 0;
    if (input.cursor !== undefined) {
      let decoded = '';
      try {
        decoded = Buffer.from(input.cursor, 'base64url').toString('utf8');
      } catch {
        decoded = '';
      }
      const at = filtered.findIndex((i) => `${i.type}:${i.id}` === decoded);
      start = at < 0 ? filtered.length : at + 1;
    }
    const page = filtered.slice(start, start + limit);
    const last = page.at(-1);
    return {
      items: page.map((i) => this.strip(i)),
      nextCursor:
        last && start + limit < filtered.length ? Buffer.from(`${last.type}:${last.id}`, 'utf8').toString('base64url') : null,
      counts,
    };
  }

  async detail(identity: Identity, type: QueueType, id: string, db: Db = this.db): Promise<Wire<QueueItemDetailDto>> {
    this.requireRead(identity);
    const item = (await this.items(identity, db)).find((i) => i.type === type && i.id === id) ?? (await this.decided(type, id, db));
    if (!item) throw new AppError('NOT_FOUND');
    const properties: { label: string; value: string }[] = [];
    let reporter: Wire<QueueItemDetailDto>['reporter'] = null;
    let topicId: string | null = null;
    const decisions: Wire<QueueItemDetailDto>['decisions'] = [];
    const people = async (ids: string[]) =>
      new Map((await db.user.findMany({ where: { id: { in: ids } } })).map((u) => [u.id, userRef(u)]));
    if (type === 'report') {
      const row = await db.attestation.findUnique({ where: { id } });
      if (row) {
        const d = row.details as Record<string, string | undefined>;
        for (const [label, key] of [['Kind', 'kind'], ['Quote', 'quote'], ['Suggestion', 'suggestion'], ['Evidence', 'evidence']] as const)
        {
          const v = d[key];
          if (v) properties.push({ label, value: key === 'kind' ? (REPORT_KIND[v] ?? v) : v });
        }
        properties.push({ label: 'Blocking', value: row.blocking ? 'Yes' : 'No' });
        const events = await db.attestationEvent.findMany({ where: { attestationId: id }, orderBy: { seq: 'asc' } });
        const users = await people([row.actorId, ...events.flatMap((e) => (e.actorId ? [e.actorId] : []))]);
        reporter = users.get(row.actorId) ?? null;
        topicId = row.topicId;
        for (const e of events) {
          const actor = e.actorId ? users.get(e.actorId) : undefined;
          if (actor && e.status !== 'downweighted')
            decisions.push({ outcome: e.status, reason: e.reason, actor, at: e.createdAt.toISOString() });
        }
      }
    } else {
      const rows = await db.credibilityResolution.findMany({ where: { subjectId: id }, orderBy: { createdAt: 'asc' } });
      const users = await people(rows.map((r) => r.actorId));
      for (const r of rows) {
        const actor = users.get(r.actorId);
        if (actor) decisions.push({ outcome: r.outcome, reason: r.reason, actor, at: r.createdAt.toISOString() });
      }
    }
    const downstream = item.key ? await this.core.keyDtos(await this.core.downstream([item.key], db), db) : [];
    return {
      ...this.strip(item),
      properties,
      reporter,
      topicId,
      downstream,
      decisions,
      can: { decide: item.outcomes.length > 0 && item.path !== '' && (await this.core.mayDecide(identity, item.path, db)) },
    };
  }

  /** A decided item is still readable (with no outcomes left). */
  private async decided(type: QueueType, id: string, db: Db): Promise<Item | null> {
    const uuid = /^[0-9a-f-]{36}$/i.test(id);
    let key: SectionKey | null = null;
    let path = '';
    let title = '';
    let at = new Date(0);
    if (type === 'report' && uuid) {
      const r = await db.attestation.findUnique({ where: { id } });
      if (!r || r.kind !== 'report') return null;
      key = r;
      path = r.path;
      title = `Report: ${REPORT_KIND[(r.details as { kind?: string }).kind ?? 'other'] ?? 'Other'}`;
      at = r.createdAt;
    } else if (type === 'flag' && uuid) {
      const f = await db.recheckFlag.findUnique({ where: { id } });
      if (!f) return null;
      key = f;
      path = f.path;
      title = FLAG_REASON[f.cause] ?? 'Under re-check';
      at = f.createdAt;
    } else if (type === 'candidate' && uuid) {
      const c = await db.edgeCandidate.findUnique({ where: { id } });
      if (!c) return null;
      path = c.dstPath;
      title = `Possible ${c.kind} link`;
      at = c.createdAt;
    } else if (type === 'retraction' && uuid) {
      const i = await db.invalidationEvent.findUnique({ where: { id } });
      if (!i || i.kind !== 'retraction') return null;
      title = `Source retracted: ${i.ref}`;
      at = i.detectedAt;
    } else return null;
    const [item] = await this.withReach(
      [{ type, id, title, why: 'Decided', at: at.toISOString(), outcomes: [], blocking: false, key, path }],
      db,
    );
    return item ?? null;
  }

  // ---- decisions ----------------------------------------------------------------------------

  async decide(identity: Identity, input: DecisionInput): Promise<Wire<QueueItemDetailDto>> {
    this.requireRead(identity);
    if (!QUEUE_OUTCOMES[input.type].includes(input.outcome))
      throw new AppError('PRECONDITION_FAILED', 'That choice is not available for this item');
    const touched: string[] = [];
    let topic = null as string | null;
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credibility|${input.type}|${input.id}`}))`;
      const item = (await this.items(identity, tx)).find((i) => i.type === input.type && i.id === input.id);
      if (!item) {
        if (await this.decided(input.type, input.id, tx)) throw new AppError('PRECONDITION_FAILED', 'Already decided');
        throw new AppError('NOT_FOUND');
      }
      await this.core.requireDecide(identity, item.path, tx);
      touched.push(item.path);
      const me = identity.user;
      const record = (subjectType: string, key: SectionKey | null) =>
        tx.credibilityResolution.create({
          data: {
            subjectType,
            subjectId: input.id,
            path: key?.path ?? null,
            anchor: key?.anchor ?? null,
            sectionHash: key?.sectionHash ?? null,
            outcome: input.outcome,
            reason: input.reason,
            actorId: me.id,
          },
        });
      const error = async (key: SectionKey, origin: 'report' | 'flag', originId: string) => {
        const row = await tx.confirmedError.create({
          data: { ...key, reason: input.reason, origin, originId, confirmedById: me.id },
        });
        const flagged = await this.core.propagate(tx, [key], row.id, input.reason);
        touched.push(...flagged.map((f) => f.path));
      };
      if (input.type === 'report') {
        const row = await tx.attestation.findUniqueOrThrow({ where: { id: input.id } });
        if (row.actorId === me.id) throw new AppError('SELF_REVIEW', 'You cannot decide your own report');
        const status = input.outcome === 'confirm' ? 'confirmed' : input.outcome === 'confirm_error' ? 'confirmed_error' : 'dismissed';
        await this.attestations.appendEvent(tx, row.id, me.id, status, input.reason);
        await audit(tx, me, 'report.decided', 'attestation', row.id, { outcome: input.outcome });
        const [key] = await this.core.currentKeys([row], tx);
        const target = key ?? row;
        if (input.outcome === 'confirm')
          await this.core.flag(tx, [target], { cause: 'report', causeId: row.id, reason: input.reason });
        else if (input.outcome === 'confirm_error') await error(target, 'report', row.id);
        else if (row.topicId) {
          await this.discussions.closeTopic(tx, row.topicId, me, 'rejected', input.reason);
          topic = row.topicId;
        }
        await this.core.notifications.notify(tx, {
          userIds: [row.actorId],
          event: 'report_outcome',
          path: row.path,
          anchor: row.anchor,
          text: `Your report was ${OUTCOME_TEXT[input.outcome] ?? input.outcome}: ${input.reason}`,
          data: { attestationId: row.id, outcome: input.outcome },
        });
      } else if (input.type === 'retraction') {
        const open = (await this.unresolvedRetractions(tx)).find((r) => r.row.id === input.id)?.open ?? [];
        for (const key of open) {
          await record('retraction', key);
          if (input.outcome === 'confirm_error') await error(key, 'flag', input.id);
          touched.push(key.path);
        }
      } else if (input.type === 'flag') {
        await record('flag', item.key);
        if (input.outcome === 'confirm_error' && item.key) await error(item.key, 'flag', input.id);
      } else {
        const c = await tx.edgeCandidate.findUniqueOrThrow({ where: { id: input.id } });
        await record('candidate', item.key);
        if (input.outcome === 'yes') {
          await tx.credibilityEdge.create({
            data: {
              kind: c.kind,
              srcPath: c.srcPath,
              srcAnchor: c.srcAnchor,
              dstPath: c.dstPath,
              dstAnchor: c.dstAnchor,
              candidateId: c.id,
              confirmedById: me.id,
            },
          });
          touched.push(c.srcPath);
        } else if (input.outcome === 'ask_authors') {
          const page = (await this.core.pageMap([c.dstPath], tx)).get(c.dstPath);
          if (page)
            topic = await this.discussions.openSectionTopic(tx, me, {
              path: c.dstPath,
              anchor: c.dstAnchor,
              versionLabel: page.versionLabel,
              title: `Is this a ${c.kind} of ${c.srcPath}#${c.srcAnchor}?`,
              body: input.reason,
            });
        }
      }
      await audit(tx, me, 'credibility.decided', 'credibility', input.id.length === 36 ? input.id : '00000000-0000-0000-0000-000000000000', {
        itemType: input.type,
        outcome: input.outcome,
      });
    });
    if (topic) await this.discussions.emitTopicId(topic);
    this.core.emitPages(touched);
    return this.detail(identity, input.type, input.id);
  }

  // ---- pages and sources --------------------------------------------------------------------

  async pages(identity: Identity, input: { limit?: number; cursor?: string }): Promise<Wire<CredibilityPagesDto>> {
    this.requireRead(identity);
    const all = await this.db.page.findMany({ where: { isMeta: false }, select: { path: true } });
    const pages = await this.core.pageMap(all.map((p) => p.path));
    const labels = await pageLabels(this.core.labels, pages.values());
    const since = new Date(Date.now() - 30 * DAY);
    const week = Date.now() - 7 * DAY;
    const readers = await this.db.$queryRaw<{ path: string; n: bigint }[]>`
      SELECT path, COUNT(DISTINCT actor)::bigint AS n FROM (
        SELECT path, "actorId" AS actor FROM "Attestation" WHERE "createdAt" >= ${since}
        UNION ALL SELECT path, "actorId" FROM "PageFeedback" WHERE "createdAt" >= ${since}
      ) x GROUP BY path`;
    const tiles = Object.fromEntries(LABEL_ORDER.map((l) => [l, { sections: 0, changeThisWeek: 0 }])) as Record<
      Label,
      { sections: number; changeThisWeek: number }
    >;
    for (const l of labels.values())
      for (const s of l.sections) {
        tiles[s.label.label].sections++;
        if (s.label.since && Date.parse(s.label.since) >= week) tiles[s.label.label].changeThisWeek++;
      }
    const rank = (l: Label) => LABEL_ORDER.indexOf(l);
    const rows = [...pages.values()]
      .map((p) => {
        const l = labels.get(p.path);
        const unchecked = (l?.sections ?? [])
          .filter((s) => s.label.label !== 'checked')
          .sort((a, b) => (a.label.since ?? '').localeCompare(b.label.since ?? ''));
        const oldest = unchecked[0];
        return {
          path: p.path,
          title: p.title,
          pageLabel: { label: l?.label ?? ('not_reviewed'), spread: l?.spread ?? emptySpread() },
          oldestUnchecked: oldest ? { anchor: oldest.anchor, title: oldest.title, since: oldest.label.since } : null,
          activeReaders30d: Number(readers.find((r) => r.path === p.path)?.n ?? 0),
        };
      })
      .sort((a, b) => rank(b.pageLabel.label) - rank(a.pageLabel.label) || a.path.localeCompare(b.path, 'en'));
    const limit = input.limit ?? 25;
    const offset = offsetOf(input.cursor);
    return {
      items: rows.slice(offset, offset + limit),
      nextCursor: offset + limit < rows.length ? offsetCursor(offset + limit) : null,
      tiles,
    };
  }

  async sources(identity: Identity, input: SourcesInput): Promise<Wire<CredibilitySourcesDto>> {
    this.requireRead(identity);
    const texts = await this.db.$queryRaw<{ path: string; anchor: string; text: string }[]>`
      SELECT s.path, s.anchor, s.text FROM "PageSection" s
      JOIN "Page" p ON p.path = s.path AND p."currentVersionLabel" = s."versionLabel"`;
    const cited = new Map<string, number>();
    for (const t of texts) for (const ref of citedSources(t.text)) cited.set(ref, (cited.get(ref) ?? 0) + 1);
    const checks = await this.db.sourceCheck.findMany({ orderBy: { createdAt: 'desc' } });
    const invalidations = await this.db.invalidationEvent.findMany();
    const { tiers } = await this.evidence.tiers();
    const refs = [...new Set([...cited.keys(), ...checks.map((c) => c.sourceRef)])];
    const rows = refs
      .map((ref) => {
        const last = checks.find((c) => c.sourceRef === ref);
        const inv = invalidations.filter((i) => i.ref === ref);
        const state: Wire<CredibilitySourcesDto>['items'][number]['state'] = inv.some((i) => i.kind === 'retraction')
          ? 'retracted'
          : inv.some((i) => i.kind === 'source_changed' || i.kind === 'version_changed')
            ? 'changed'
            : !last
              ? 'unchecked'
              : 'ok';
        return {
          ref,
          name: checks.find((c) => c.sourceRef === ref && c.sourceTitle)?.sourceTitle ?? null,
          tier: tierOf(ref, tiers)?.tier ?? null,
          state,
          citedBy: cited.get(ref) ?? 0,
          lastCheck: last ? { at: last.createdAt.toISOString(), result: last.result } : null,
        };
      })
      .filter((r) => !input.state || r.state === input.state)
      .sort((a, b) => b.citedBy - a.citedBy || a.ref.localeCompare(b.ref, 'en'));
    const limit = input.limit ?? 25;
    const offset = offsetOf(input.cursor);
    return {
      items: rows.slice(offset, offset + limit),
      nextCursor: offset + limit < rows.length ? offsetCursor(offset + limit) : null,
    };
  }

  /** Exposed for the maintenance job (reciprocal pairs). */
  async markPairs(tx: Tx) {
    const { pairs, derived } = await this.pairs(tx);
    let marked = 0;
    for (const p of pairs)
      for (const id of p.attestationIds) {
        if (derived.get(id)?.state === 'downweighted') continue;
        await this.attestations.appendEvent(tx, id, null, 'downweighted', 'Reciprocal attestations between two readers');
        marked++;
      }
    return { pairs: pairs.length, marked };
  }
}

export type { SectionKeyDto };
