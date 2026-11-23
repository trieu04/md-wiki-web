import { Inject, Injectable } from '@nestjs/common';
import {
  aliasKeys,
  attestationIssues,
  attestationState,
  counts,
  INVALIDATING,
  normalizeSourceRef,
  reportRateLimit,
  sectionKeyOf,
  teamCounts,
  UNDO_MS,
  type AttestationEventStatus,
  type AttestationState,
  type CountRow,
} from '@md-wiki/domain';
import type { Attestation, Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { invalid } from '../contributions/pins.js';
import { DiscussionsService } from '../discussions/discussions.service.js';
import { FollowsService } from '../notifications/follows.service.js';
import { currentSection, offsetCursor, offsetOf } from '../wiki/current-sections.js';
import type { Wire } from '../wiki/read.dto.js';
import type { SectionKey } from '../wiki/section-evidence.js';
import { wikiPath } from '../wiki/storage/wiki-storage.js';
import { CredibilityCore, type Db, type Tx } from './credibility-core.js';
import type {
  ActivityDto,
  ActivityInput,
  AttestationDto,
  AttestationInput,
  AttestationResultDto,
  PageFeedbackDto,
  PageFeedbackInput,
  PeopleDto,
  ReportInput,
  SummaryDto,
} from './credibility.dto.js';

const PURPOSE = 'For content quality, not for rating people.';
const REPORT_TITLE = {
  wrong: 'Wrong',
  outdated: 'Outdated',
  unclear: 'Unclear',
  source: 'Source problem',
  other: 'Other',
} as const;
const FINAL_REPORT = new Set<AttestationState>(['confirmed', 'confirmed_error', 'dismissed', 'fixed']);
type Derived = { state: AttestationState; outcomeReason: string | null };

/** Reader actions (system-logic §7.7.6) and You › activity (§7.7.9). */
@Injectable()
export class AttestationsService {
  constructor(
    @Inject(CredibilityCore) private readonly core: CredibilityCore,
    @Inject(DiscussionsService) private readonly discussions: DiscussionsService,
    @Inject(FollowsService) private readonly follows: FollowsService,
  ) {}

  private get db() {
    return this.core.db;
  }

  // ---- derived state ------------------------------------------------------------------------

  /** Derived state of attestations (D-160): events, version binding, invalidated source. */
  async derive(rows: readonly Attestation[], db: Db = this.db): Promise<Map<string, Derived>> {
    const out = new Map<string, Derived>();
    if (!rows.length) return out;
    const [events, pages, links] = await Promise.all([
      db.attestationEvent.findMany({
        where: { attestationId: { in: rows.map((r) => r.id) } },
        orderBy: { seq: 'asc' },
      }),
      this.core.pageMap(
        rows.map((r) => r.path),
        db,
      ),
      db.anchorLink.findMany({ where: { path: { in: [...new Set(rows.map((r) => r.path))] } } }),
    ]);
    // Current keys plus every key whose evidence follows them through anchor links.
    const current = new Set<string>();
    for (const page of pages.values())
      for (const s of page.sections) {
        const key = { path: page.path, anchor: s.anchor, sectionHash: s.sectionHash };
        current.add(sectionKeyOf(key));
        for (const alias of aliasKeys(key, links)) current.add(sectionKeyOf(alias));
      }
    const refs = rows.flatMap((r) => {
      const source = (r.details as { source?: { ref?: string } } | null)?.source?.ref;
      return r.kind === 'checked' && source ? [normalizeSourceRef(source)] : [];
    });
    const invalidations = refs.length
      ? await db.invalidationEvent.findMany({ where: { ref: { in: [...new Set(refs)] } } })
      : [];
    for (const r of rows) {
      const own = events.filter((e) => e.attestationId === r.id);
      const ref = (r.details as { source?: { ref?: string } } | null)?.source?.ref;
      const invalidated =
        r.kind === 'checked' &&
        ref !== undefined &&
        invalidations.some(
          (i) => INVALIDATING.has(i.kind) && i.ref === normalizeSourceRef(ref) && i.detectedAt > r.createdAt,
        );
      const key = sectionKeyOf(r);
      const state = attestationState(
        { kind: r.kind, sectionHash: r.sectionHash },
        own.map((e) => ({ status: e.status })),
        { currentHashes: current.has(key) ? new Set([r.sectionHash]) : new Set(), invalidated },
      );
      const decisive = [...own].reverse().find((e) => e.status !== 'downweighted');
      out.set(r.id, {
        state,
        outcomeReason: state === 'open' || state === 'active' ? null : (decisive?.reason ?? null),
      });
    }
    return out;
  }

  async dtos(rows: readonly Attestation[], db: Db = this.db): Promise<Wire<AttestationDto>[]> {
    if (!rows.length) return [];
    const derived = await this.derive(rows, db);
    const [pages, sections] = await Promise.all([
      db.page.findMany({
        where: { path: { in: [...new Set(rows.map((r) => r.path))] } },
        select: { path: true, title: true },
      }),
      db.pageSection.findMany({
        where: { OR: rows.map((r) => ({ path: r.path, anchor: r.anchor, sectionHash: r.sectionHash })) },
        select: { path: true, anchor: true, sectionHash: true, title: true },
      }),
    ]);
    return rows.map((r) => {
      const d = derived.get(r.id) ?? { state: 'active' as const, outcomeReason: null };
      return {
        id: r.id,
        path: r.path,
        pageTitle: pages.find((p) => p.path === r.path)?.title ?? r.path,
        anchor: r.anchor,
        sectionTitle:
          sections.find((s) => s.path === r.path && s.anchor === r.anchor && s.sectionHash === r.sectionHash)
            ?.title ?? null,
        versionLabel: r.versionLabel,
        kind: r.kind,
        details: (r.details ?? {}) as object,
        blocking: r.blocking,
        note: r.note,
        state: d.state,
        outcomeReason: d.outcomeReason,
        topicId: r.topicId,
        createdAt: r.createdAt.toISOString(),
        undoUntil: new Date(r.createdAt.getTime() + UNDO_MS).toISOString(),
      };
    });
  }

  // ---- people who rely on it ----------------------------------------------------------------

  async people(identity: Identity, rawPath: string, anchor: string, reveal: boolean, db: Db = this.db): Promise<Wire<PeopleDto>> {
    const path = wikiPath(rawPath).path;
    const { section } = await currentSection(db, { path, anchor }).catch((error: unknown) => {
      if (error instanceof AppError && error.code === 'VALIDATION_FAILED')
        throw new AppError('NOT_FOUND', 'No such section');
      throw error;
    });
    const key = { path, anchor, sectionHash: section.sectionHash };
    const rows = await db.attestation.findMany({
      where: { path, anchor },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const derived = await this.derive(rows, db);
    const me = identity.user.id;
    const onCurrent = rows.filter((r) => derived.get(r.id)?.state !== 'on_old_version' && r.kind !== 'report');
    const acted = rows.some(
      (r) =>
        r.actorId === me &&
        r.sectionHash === key.sectionHash &&
        derived.get(r.id)?.state !== 'withdrawn',
    );
    const mine = await this.dtos(
      rows.filter((r) => r.actorId === me),
      db,
    );
    const hidden = !acted && !reveal;
    if (hidden)
      return { hidden, acted, checked: null, used: null, useful: null, onOldVersion: null, purpose: PURPOSE, mine };
    const teamIds = [...new Set(rows.map((r) => r.teamId).filter((t): t is string => t !== null))];
    const aggregates = await db.credibilityAggregate.findMany({
      where: { path, anchor, sectionHash: key.sectionHash },
    });
    const allTeams = [...new Set([...teamIds, ...aggregates.map((a) => a.teamKey).filter((t) => t !== '')])];
    const teams = new Map(
      (await db.team.findMany({ where: { id: { in: allTeams } }, select: { id: true, name: true } })).map((t) => [
        t.id,
        t.name,
      ]),
    );
    const countRows: CountRow[] = onCurrent.map((r) => ({
      actorId: r.actorId,
      team: r.teamId ? (teams.get(r.teamId) ?? null) : null,
      kind: r.kind,
      state: derived.get(r.id)?.state ?? 'active',
    }));
    const c = teamCounts(
      countRows,
      aggregates.map((a) => ({
        metric: a.metric,
        team: a.teamKey ? (teams.get(a.teamKey) ?? null) : null,
        count: a.count,
      })),
    );
    const old = (kind: 'checked' | 'used') =>
      new Set(
        rows
          .filter((r) => r.kind === kind && derived.get(r.id)?.state === 'on_old_version')
          .map((r) => r.actorId),
      ).size;
    return {
      hidden,
      acted,
      checked: c.checked,
      used: c.used,
      useful: c.useful,
      onOldVersion: { checked: old('checked'), used: old('used') },
      purpose: PURPOSE,
      mine,
    };
  }

  // ---- writes -------------------------------------------------------------------------------

  /** Order of checks up to the own-version rule (system-logic §7.7.6). */
  private async target(identity: Identity, input: { path: string; anchor: string; sectionHash: string }, action: 'attest' | 'report') {
    this.core.requireRole(identity, action);
    if (identity.kind !== 'session') throw new AppError('FORBIDDEN');
    const path = wikiPath(input.path).path;
    const key = { path, anchor: input.anchor, sectionHash: input.sectionHash };
    const { page, section } = await currentSection(this.db, key);
    const { submitters, reviewers } = await this.core.authorship(key);
    const me = identity.user.id;
    if (submitters.has(me) || (action === 'attest' && reviewers.has(me)))
      throw new AppError('FORBIDDEN', 'You wrote or reviewed this version');
    return { key, page, section };
  }

  private async rateLimit(tx: Tx, userId: string, path: string) {
    const previous = await tx.attestation.findMany({
      where: { actorId: userId, path, kind: 'report', createdAt: { gt: new Date(Date.now() - 8 * 86_400_000) } },
      select: { createdAt: true },
    });
    const limit = reportRateLimit(
      previous.map((p) => p.createdAt),
      new Date(),
    );
    if (!limit.ok)
      throw new AppError('RATE_LIMITED', 'Too many reports on this page this week', undefined, limit.retryAfterSeconds);
  }

  /** Serialize writes of one person on one section version (duplicate check, rate limit). */
  private lock(tx: Tx, userId: string, key: SectionKey) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}|${sectionKeyOf(key).replaceAll('\0', '|')}`}))`;
  }

  private async createReport(
    tx: Tx,
    identity: Identity,
    target: Awaited<ReturnType<AttestationsService['target']>>,
    report: { kind: keyof typeof REPORT_TITLE; quote?: string; suggestion?: string; evidence?: string; blocking: boolean; sawCounts: boolean },
  ) {
    await this.rateLimit(tx, identity.user.id, target.key.path);
    const body = [
      `**${REPORT_TITLE[report.kind]}**`,
      report.quote && `> ${report.quote.replace(/\n/g, '\n> ')}`,
      report.suggestion && `Suggestion: ${report.suggestion}`,
      report.evidence && `Evidence: ${report.evidence}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const topicId = await this.discussions.openSectionTopic(tx, identity.user, {
      path: target.key.path,
      anchor: target.key.anchor,
      versionLabel: target.page.versionLabel,
      title: `Report: ${REPORT_TITLE[report.kind].toLowerCase()} — ${target.section.title}`,
      body,
    });
    const row = await tx.attestation.create({
      data: {
        ...target.key,
        versionLabel: target.page.versionLabel,
        actorId: identity.user.id,
        teamId: identity.user.teamId,
        role: identity.user.roles[0] ?? 'reader',
        kind: 'report',
        details: {
          kind: report.kind,
          ...(report.quote && { quote: report.quote }),
          ...(report.suggestion && { suggestion: report.suggestion }),
          ...(report.evidence && { evidence: report.evidence }),
        },
        blocking: report.blocking,
        sawCounts: report.sawCounts,
        topicId,
      },
    });
    await audit(tx, identity.user, 'report.opened', 'attestation', row.id, {
      attestationId: row.id,
      topicId,
      blocking: report.blocking,
    });
    const authors = (await this.core.authors.of(target.key.path, tx)).map((a) => a.id).filter((id) => id !== identity.user.id);
    const email = await this.core.notifications.notify(tx, {
      userIds: authors,
      event: 'report_received',
      path: target.key.path,
      anchor: target.key.anchor,
      text: `${report.blocking ? 'Blocking report' : 'Report'} on “${target.section.title}”: ${REPORT_TITLE[report.kind]}`,
      data: { attestationId: row.id, topicId, blocking: report.blocking },
    });
    return { row, topicId, email: report.blocking ? email : [] };
  }

  private async result(identity: Identity, key: SectionKey, rows: Attestation[], following: boolean): Promise<Wire<AttestationResultDto>> {
    const [dtos, people, label] = await Promise.all([
      this.dtos(rows),
      this.people(identity, key.path, key.anchor, true),
      this.core.labelOf(key),
    ]);
    const [attestation, report] = dtos;
    if (!attestation) throw new AppError('INTERNAL');
    return { attestation, report: report ?? null, people, label, following };
  }

  async attest(identity: Identity, input: AttestationInput): Promise<Wire<AttestationResultDto>> {
    const target = await this.target(identity, input, 'attest');
    const issues = attestationIssues(input);
    if (issues.length) throw new AppError('VALIDATION_FAILED', issues[0]?.message, issues);
    const details =
      input.kind === 'checked' && input.checked
        ? {
            source: { ref: normalizeSourceRef(input.checked.source.ref), cited: input.checked.source.cited },
            location: input.checked.location,
            result: input.checked.result,
            comparedNumbers: input.checked.comparedNumbers,
          }
        : input.kind === 'used' && input.used
          ? {
              use: input.used.use,
              worked: input.used.worked,
              ...(input.used.change?.trim() && { change: input.used.change.trim() }),
            }
          : {};
    const done = await this.db.$transaction(async (tx) => {
      await this.lock(tx, identity.user.id, target.key);
      const same = await tx.attestation.findMany({
        where: { ...target.key, actorId: identity.user.id, kind: input.kind },
      });
      const derived = await this.derive(same, tx);
      if (same.some((s) => counts(derived.get(s.id)?.state ?? 'active')))
        throw new AppError('ALREADY_EXISTS', 'You already did this for this version');
      const row = await tx.attestation.create({
        data: {
          ...target.key,
          versionLabel: target.page.versionLabel,
          actorId: identity.user.id,
          teamId: identity.user.teamId,
          role: identity.user.roles[0] ?? 'reader',
          kind: input.kind,
          details,
          sawCounts: input.sawCounts,
          note: input.note?.trim() || null,
        },
      });
      await audit(tx, identity.user, 'attestation.created', 'attestation', row.id, {
        kind: input.kind,
        ...target.key,
      });
      const rows: Attestation[] = [row];
      let email: string[] = [];
      if (input.kind === 'checked' && input.checked?.result === 'contradicts') {
        const report = await this.createReport(tx, identity, target, {
          kind: 'wrong',
          quote: input.checked.location,
          ...(input.note && { evidence: input.note }),
          blocking: false,
          sawCounts: input.sawCounts,
        });
        rows.push(report.row);
        email = report.email;
      }
      if (input.kind !== 'useful') await this.follows.autoFollow(tx, identity.user.id, target.key.path, 'attested');
      return { rows, email, topicId: rows[1]?.topicId ?? null };
    });
    if (done.topicId) await this.discussions.emitTopicId(done.topicId);
    return this.result(
      identity,
      target.key,
      done.rows,
      await this.follows.isFollowing(identity.user.id, target.key.path),
    );
  }

  async report(identity: Identity, input: ReportInput): Promise<Wire<AttestationResultDto>> {
    const target = await this.target(identity, input, 'report');
    const done = await this.db.$transaction(async (tx) => {
      await this.lock(tx, identity.user.id, { ...target.key, anchor: '' });
      const report = await this.createReport(tx, identity, target, {
        kind: input.kind,
        ...(input.quote && { quote: input.quote }),
        ...(input.suggestion && { suggestion: input.suggestion }),
        ...(input.evidence && { evidence: input.evidence }),
        blocking: input.blocking,
        sawCounts: input.sawCounts,
      });
      await this.follows.autoFollow(tx, identity.user.id, target.key.path, 'attested');
      return report;
    });
    await this.discussions.emitTopicId(done.topicId);
    await this.core.notifications.sendNow(
      done.email,
      `Blocking report on ${target.page.title}`,
      `${identity.user.name} reported “${target.section.title}” as ${REPORT_TITLE[input.kind].toLowerCase()} and marked it blocking.`,
    );
    return this.result(identity, target.key, [done.row], await this.follows.isFollowing(identity.user.id, target.key.path));
  }

  async withdraw(identity: Identity, id: string, reason?: string): Promise<Wire<AttestationDto>> {
    const row = await this.db.attestation.findUnique({ where: { id } });
    if (!row) throw new AppError('NOT_FOUND');
    if (row.actorId !== identity.user.id) throw new AppError('FORBIDDEN');
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attestation|${id}`}))`;
      const state = (await this.derive([row], tx)).get(id)?.state;
      if (state === 'withdrawn') throw new AppError('PRECONDITION_FAILED', 'Already withdrawn');
      if (row.kind === 'report' && state && FINAL_REPORT.has(state))
        throw new AppError('PRECONDITION_FAILED', 'The report was already decided');
      await this.appendEvent(tx, id, identity.user.id, 'withdrawn', reason?.trim() || 'Withdrawn');
      await audit(tx, identity.user, 'attestation.withdrawn', 'attestation', id, { kind: row.kind });
      if (row.topicId)
        await this.discussions.closeTopic(tx, row.topicId, identity.user, 'rejected', 'Withdrawn by the reporter');
    });
    if (row.topicId) await this.discussions.emitTopicId(row.topicId);
    this.core.emitPages([row.path]);
    const [dto] = await this.dtos([row]);
    if (!dto) throw new AppError('INTERNAL');
    return dto;
  }

  async appendEvent(tx: Tx, attestationId: string, actorId: string | null, status: AttestationEventStatus, reason: string) {
    const last = await tx.attestationEvent.findFirst({
      where: { attestationId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    await tx.attestationEvent.create({
      data: { attestationId, seq: (last?.seq ?? 0) + 1, actorId, status, reason },
    });
  }

  async feedback(identity: Identity, input: PageFeedbackInput): Promise<Wire<PageFeedbackDto>> {
    this.core.requireRole(identity, 'feedback');
    if (identity.kind !== 'session') throw new AppError('FORBIDDEN');
    const path = wikiPath(input.path).path;
    const page = await this.db.page.findUnique({ where: { path } });
    if (!page) throw new AppError('NOT_FOUND', 'No such page');
    const version = await this.db.snapshot.findUnique({
      where: { path_label: { path, label: input.versionLabel } },
    });
    if (!version) throw new AppError('NOT_FOUND', 'No such version');
    const row = await this.db.pageFeedback.create({
      data: {
        path,
        versionLabel: input.versionLabel,
        actorId: identity.user.id,
        teamId: identity.user.teamId,
        answer: input.answer,
      },
    });
    return { answer: row.answer, versionLabel: row.versionLabel, createdAt: row.createdAt.toISOString() };
  }

  // ---- You ----------------------------------------------------------------------------------

  async activity(identity: Identity, input: ActivityInput): Promise<Wire<ActivityDto>> {
    this.core.requireRole(identity, 'attest');
    const me = identity.user.id;
    const kind = input.kind ?? 'all';
    const where: Prisma.AttestationWhereInput = {
      actorId: me,
      ...(kind === 'checks' && { kind: 'checked' }),
      ...(kind === 'reports' && { kind: 'report' }),
    };
    const limit = input.limit ?? 25;
    const offset = offsetOf(input.cursor);
    const [rows, checks, reports, all] = await Promise.all([
      this.db.attestation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit + 1,
      }),
      this.db.attestation.count({ where: { actorId: me, kind: 'checked' } }),
      this.db.attestation.count({ where: { actorId: me, kind: 'report' } }),
      this.db.attestation.count({ where: { actorId: me } }),
    ]);
    return {
      items: await this.dtos(rows.slice(0, limit)),
      nextCursor: rows.length > limit ? offsetCursor(offset + limit) : null,
      counts: { checks, reports, all },
    };
  }

  async summary(identity: Identity, now = new Date()): Promise<Wire<SummaryDto>> {
    this.core.requireRole(identity, 'attest');
    const me = identity.user.id;
    const year = now.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const rows = await this.db.attestation.findMany({
      where: { actorId: me, kind: { in: ['checked', 'report'] }, createdAt: { gte: start } },
    });
    const derived = await this.derive(rows);
    const suggestionsPublished = await this.db.proposal.count({
      where: { submitterId: me, state: 'published', updatedAt: { gte: start } },
    });
    return {
      year,
      checksCounting: rows.filter((r) => r.kind === 'checked' && counts(derived.get(r.id)?.state ?? 'active')).length,
      reportsConfirmed: rows.filter(
        (r) => r.kind === 'report' && ['confirmed', 'confirmed_error', 'fixed'].includes(derived.get(r.id)?.state ?? ''),
      ).length,
      suggestionsPublished,
    };
  }
}

export { invalid };
