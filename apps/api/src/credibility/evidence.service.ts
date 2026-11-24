import { Inject, Injectable } from '@nestjs/common';
import {
  bodyHash,
  citedSources,
  LABEL_CHANGE,
  LABEL_MEANING,
  labelInputFromEvidence,
  normalizeSourceRef,
  parseSourceTiers,
  tierOf,
  type SourceTier,
} from '@md-wiki/domain';
import { audit } from '../auth/credentials.js';
import type { UserKind } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { AppError } from '../common/app-error.js';
import { isUniqueViolation } from '../contributions/pins.js';
import { currentSection } from '../wiki/current-sections.js';
import { metaPage } from '../wiki/page-authors.js';
import type { Wire } from '../wiki/read.dto.js';
import { SectionEvidenceLoader, type LoadedEvidence } from '../wiki/section-evidence.js';
import { wikiPath } from '../wiki/storage/wiki-storage.js';
import { CredibilityCore, notReviewed, type Db } from './credibility-core.js';
import type {
  AnchorLinkDto,
  AnchorLinkInput,
  EdgeCandidateInput,
  EvidenceDto,
  InvalidationInput,
  InvalidationResultDto,
  OwnerConfirmationInput,
  SourceCheckInput,
  SourceCheckResultDto,
  SourceTiersDto,
  SourceWarningsDto,
  WhyDto,
} from './credibility.dto.js';

export const SOURCE_TIERS_PATH = 'wiki-meta/source-tiers.md';
const REVIEW_SUMMARY = { agent: 'Reviewed by the reviewer agent', person: 'Reviewed by a person' };
const RESULT_SUMMARY = {
  supported: 'matched it',
  not_supported: 'found it does not support the text',
  unverifiable: 'could not check it',
} as const;

/** Evidence writes, *Why this label*, sources and tiers (system-logic §7.7.3–§7.7.5). */
@Injectable()
export class EvidenceService {
  constructor(
    @Inject(CredibilityCore) private readonly core: CredibilityCore,
    @Inject(SectionEvidenceLoader) private readonly loader: SectionEvidenceLoader,
  ) {}

  private get db() {
    return this.core.db;
  }

  // ---- writes -------------------------------------------------------------------------------

  async recordSourceCheck(identity: Identity, input: SourceCheckInput): Promise<Wire<SourceCheckResultDto>> {
    this.core.require(identity, 'source_check.record', {});
    const path = wikiPath(input.path).path;
    const key = { path, anchor: input.anchor, sectionHash: input.sectionHash };
    const { page } = await currentSection(this.db, key);
    const { submitters } = await this.core.authorship(key);
    this.core.require(identity, 'source_check.record', {
      isOwnSectionVersion: submitters.has(identity.user.id),
    });
    const proposal = input.proposalSlug
      ? await this.db.proposal.findUnique({ where: { slug: input.proposalSlug }, select: { id: true } })
      : null;
    const checkerKind = identity.user.kind === 'agent' ? ('agent' as const) : ('person' as const);
    const sourceRef = normalizeSourceRef(input.sourceRef);
    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.sourceCheck.create({
        data: {
          ...key,
          versionLabel: page.versionLabel,
          sourceRef,
          sourceTitle: input.sourceTitle?.trim() || null,
          sourceSnapshotId: input.sourceSnapshotId ?? null,
          result: input.result,
          excerpt: input.excerpt ?? null,
          location: input.location ?? null,
          comparedNumbers: input.comparedNumbers ?? false,
          note: input.note ?? null,
          checkerId: identity.user.id,
          checkerKind,
          proposalId: proposal?.id ?? null,
        },
      });
      await audit(tx, identity.user, 'source_check.recorded', 'section', created.id, {
        ...key,
        result: input.result,
        sourceRef,
      });
      // A person's not_supported check is a confirmed error: descendants go under re-check.
      if (input.result === 'not_supported' && checkerKind === 'person')
        await this.core.propagate(tx, [key], created.id, 'A person found the source does not support it');
      if (input.result === 'not_supported')
        await this.core.notifyRecheck(tx, [key], 'The source does not support it', 'source_check', [
          identity.user.id,
        ]);
      return created;
    });
    this.core.emitPages([path]);
    return { id: row.id, label: await this.core.labelOf(key), createdAt: row.createdAt.toISOString() };
  }

  async confirm(identity: Identity, input: OwnerConfirmationInput): Promise<Wire<SourceCheckResultDto>> {
    this.core.require(identity, 'credibility.decide', { isPageAuthor: true });
    const path = wikiPath(input.path).path;
    const key = { path, anchor: input.anchor, sectionHash: input.sectionHash };
    const { page } = await currentSection(this.db, key);
    await this.core.requireDecide(identity, path);
    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.ownerConfirmation.create({
        data: { ...key, versionLabel: page.versionLabel, ownerId: identity.user.id, note: input.note },
      });
      await audit(tx, identity.user, 'owner_confirmation.recorded', 'section', created.id, key);
      return created;
    });
    this.core.emitPages([path]);
    return { id: row.id, label: await this.core.labelOf(key), createdAt: row.createdAt.toISOString() };
  }

  /** Manual relink of a pure rename (D-163). */
  async linkAnchors(identity: Identity, input: AnchorLinkInput): Promise<Wire<AnchorLinkDto>> {
    this.core.require(identity, 'credibility.decide', { isPageAuthor: true });
    const path = wikiPath(input.path).path;
    const page = (await this.core.pageMap([path])).get(path);
    if (!page) throw new AppError('NOT_FOUND', 'No such page');
    await this.core.requireDecide(identity, path);
    const now = page.sections.find((s) => s.anchor === input.newAnchor);
    if (!now) throw new AppError('NOT_FOUND', 'No such section in the current version');
    if (page.sections.some((s) => s.anchor === input.oldAnchor))
      throw new AppError('PRECONDITION_FAILED', 'The old anchor still exists in the current version');
    const old = await this.db.$queryRaw<{ versionLabel: string; level: number; text: string; sectionHash: string }[]>`
      SELECT s."versionLabel", s.level, s.text, s."sectionHash" FROM "PageSection" s
      JOIN "Snapshot" v ON v.path = s.path AND v.label = s."versionLabel"
      WHERE s.path = ${path} AND s.anchor = ${input.oldAnchor}
      ORDER BY v."capturedAt" DESC, v.id DESC LIMIT 1`;
    const before = old[0];
    if (!before) throw new AppError('NOT_FOUND', 'No earlier version has that anchor');
    const newInOld = await this.db.pageSection.count({
      where: { path, versionLabel: before.versionLabel, anchor: input.newAnchor },
    });
    if (newInOld) throw new AppError('PRECONDITION_FAILED', 'The new anchor already existed in that version');
    if (bodyHash(before) !== bodyHash(now))
      throw new AppError('PRECONDITION_FAILED', 'The section bodies differ; this is not a pure rename');
    try {
      const link = await this.db.$transaction(async (tx) => {
        const created = await tx.anchorLink.create({
          data: {
            path,
            oldAnchor: input.oldAnchor,
            oldHash: before.sectionHash,
            newAnchor: input.newAnchor,
            newHash: now.sectionHash,
            reviewerId: identity.user.id,
          },
        });
        await audit(tx, identity.user, 'anchor_link.created', 'section', created.id, {
          path,
          oldAnchor: input.oldAnchor,
          newAnchor: input.newAnchor,
        });
        return created;
      });
      this.core.emitPages([path]);
      return { ...link, createdAt: link.createdAt.toISOString() };
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('ALREADY_EXISTS', 'Already linked');
      throw error;
    }
  }

  // ---- why ----------------------------------------------------------------------------------

  async why(identity: Identity, rawPath: string, anchor: string, versionLabel?: string): Promise<Wire<WhyDto>> {
    const path = wikiPath(rawPath).path;
    const page = await this.db.page.findUnique({ where: { path } });
    if (!page) throw new AppError('NOT_FOUND', 'No such page');
    const label = versionLabel ?? page.currentVersionLabel;
    const section = await this.db.pageSection.findUnique({
      where: { path_versionLabel_anchor: { path, versionLabel: label, anchor } },
    });
    if (!section) throw new AppError('NOT_FOUND', 'No such section in that version');
    const key = { path, anchor, sectionHash: section.sectionHash };
    // Every hash this anchor ever had: older versions are listed but do not contribute.
    const hashes = await this.db.pageSection.findMany({
      where: { path, anchor },
      distinct: ['sectionHash'],
      select: { sectionHash: true },
    });
    const others = hashes.map((h) => h.sectionHash).filter((h) => h !== key.sectionHash);
    const [detailed, ...old] = await this.core.labels.detailed([
      key,
      ...others.map((h) => ({ path, anchor, sectionHash: h })),
    ]);
    if (!detailed) throw new AppError('NOT_FOUND');
    const evidence = [
      ...this.evidenceOf(detailed.evidence, true),
      ...old.flatMap((o) => this.evidenceOf(o.evidence, false)),
    ];
    const seen = new Set<string>();
    const unique = evidence
      .filter((e) => (seen.has(`${e.kind}:${e.id}`) ? false : (seen.add(`${e.kind}:${e.id}`), true)))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const { submitters, reviewers } = await this.core.authorship(key);
    const me = identity.user.id;
    const human = identity.user.kind === 'human' && identity.kind === 'session';
    const current = section.versionLabel === page.currentVersionLabel;
    return {
      path,
      anchor,
      title: section.title,
      versionLabel: label,
      sectionHash: key.sectionHash,
      label: detailed.label,
      meaning: LABEL_MEANING[detailed.label.label],
      evidence: unique,
      changeIt: LABEL_CHANGE[detailed.label.label],
      note: 'Labels follow fixed rules over these records; they are not a score.',
      baseRateCalibrated: false,
      can: {
        recordSourceCheck:
          current &&
          this.core.allowed(identity, 'source_check.record', { isOwnSectionVersion: submitters.has(me) }).ok,
        confirm: current && (await this.core.mayDecide(identity, path)),
        attest: current && human && !submitters.has(me) && !reviewers.has(me),
        report: current && human && !submitters.has(me),
      },
    };
  }

  private evidenceOf(e: LoadedEvidence, current: boolean): Wire<EvidenceDto>[] {
    const input = labelInputFromEvidence(e);
    const validChecks = new Set(input.sourceChecks.filter((c) => c.valid).map((c) => c.id));
    const base = { onOldVersion: !current, sourceRef: null, sourceName: null, result: null, open: null };
    const out: Wire<EvidenceDto>[] = [];
    for (const r of e.reviews)
      out.push({
        ...base,
        id: r.id,
        kind: 'review',
        at: r.time,
        actorKind: r.kind,
        summary: REVIEW_SUMMARY[r.kind],
        valid: true,
        contributes: current,
      });
    for (const c of e.sourceChecks) {
      const valid = validChecks.has(c.id);
      out.push({
        ...base,
        id: c.id,
        kind: 'source_check',
        at: c.time,
        actorKind: c.checkerKind,
        summary: `Checked against ${c.sourceTitle ?? c.sourceRef} by ${c.checkerKind === 'agent' ? 'the reviewer agent' : 'a person'}: ${RESULT_SUMMARY[c.result]}`,
        result: c.result,
        sourceRef: c.sourceRef,
        sourceName: c.sourceTitle,
        valid,
        contributes: current && valid,
      });
    }
    for (const o of e.ownerConfirmations)
      out.push({
        ...base,
        id: o.id,
        kind: 'owner_confirmation',
        at: o.time,
        actorKind: 'person',
        summary: 'Confirmed by a page author',
        valid: true,
        contributes: current,
      });
    for (const x of e.errors)
      out.push({
        ...base,
        id: x.id,
        kind: 'confirmed_error',
        at: x.time,
        actorKind: 'person',
        summary: `Confirmed error: ${x.reason}`,
        valid: true,
        contributes: current,
      });
    for (const f of e.flags)
      out.push({
        ...base,
        id: f.id,
        kind: 'flag',
        at: f.time,
        actorKind: 'system',
        summary: `Under re-check: ${f.reason}`,
        valid: true,
        contributes: current,
        open: true,
      });
    for (const f of e.closedFlags)
      out.push({
        ...base,
        id: f.id,
        kind: 'flag',
        at: f.time,
        actorKind: 'system',
        summary: `Re-check resolved: ${f.reason}`,
        valid: true,
        contributes: false,
        open: false,
      });
    for (const i of e.invalidations.filter((x) => x.kind === 'retraction'))
      out.push({
        ...base,
        id: i.id,
        kind: 'retraction',
        at: i.time,
        actorKind: 'system',
        summary: `Source retracted: ${i.ref}`,
        sourceRef: i.ref,
        valid: !e.clearedRetractions.has(i.id),
        contributes: current && e.citedRefs.includes(i.ref) && !e.clearedRetractions.has(i.id),
      });
    for (const c of e.contradictions)
      out.push({
        ...base,
        id: c.id,
        kind: 'edge',
        at: c.time,
        actorKind: 'person',
        summary: `Contradicted by ${c.other.path}#${c.other.anchor}`,
        valid: true,
        contributes: current && c.applies,
      });
    for (const l of e.links)
      out.push({
        ...base,
        id: `${l.oldAnchor}:${l.oldHash}`,
        kind: 'anchor_link',
        at: l.at || new Date(0).toISOString(),
        actorKind: 'person',
        summary: `Renamed from #${l.oldAnchor}; its evidence carries over`,
        valid: true,
        contributes: current,
      });
    return out;
  }

  // ---- sources ------------------------------------------------------------------------------

  async tiers(db: Db = this.db): Promise<{ versionLabel: string | null; tiers: SourceTier[]; warnings: Wire<SourceTiersDto>['warnings'] }> {
    const page = await metaPage(db, SOURCE_TIERS_PATH);
    if (!page) return { versionLabel: null, tiers: [], warnings: [] };
    const parsed = parseSourceTiers(page.markdown, new Date());
    return { versionLabel: page.versionLabel, ...parsed };
  }

  async sourceTiers(): Promise<Wire<SourceTiersDto>> {
    const t = await this.tiers();
    return {
      path: SOURCE_TIERS_PATH,
      versionLabel: t.versionLabel,
      tiers: t.tiers.map((x) => ({
        source: x.source,
        match: x.match,
        tier: x.tier,
        reason: x.reason,
        reviewed: x.reviewed ?? '',
      })),
      warnings: t.warnings,
    };
  }

  async sourceWarnings(input: { path: string; content: string }): Promise<Wire<SourceWarningsDto>> {
    const path = wikiPath(input.path).path;
    const page = (await this.core.pageMap([path])).get(path);
    const before = new Set(page ? page.sections.flatMap((s) => citedSources(s.text)) : []);
    const added = citedSources(input.content).filter((ref) => !before.has(ref));
    const { tiers } = await this.tiers();
    const retracted = new Set(
      (
        await this.db.invalidationEvent.findMany({
          where: { kind: 'retraction', ref: { in: added } },
          select: { ref: true },
        })
      ).map((r) => r.ref),
    );
    return {
      added: added.map((ref) => {
        const tier = tierOf(ref, tiers);
        const isRetracted = retracted.has(ref);
        return {
          ref,
          tier: tier?.tier ?? null,
          retracted: isRetracted,
          warning: isRetracted
            ? 'This source was retracted'
            : tier?.tier === 'low'
              ? `Low-tier source: ${tier.reason}`
              : null,
        };
      }),
    };
  }

  // ---- owner-only inputs (the 7b worker posts the same through the internal API) -------------

  async candidate(identity: Identity, input: EdgeCandidateInput) {
    this.core.require(identity, 'admin.credibility');
    for (const p of [input.src, input.dst]) wikiPath(p.path);
    const row = await this.db.edgeCandidate.create({
      data: {
        kind: input.kind,
        srcPath: input.src.path,
        srcAnchor: input.src.anchor,
        dstPath: input.dst.path,
        dstAnchor: input.dst.anchor,
        score: input.score,
        detail: (input.detail ?? {}),
      },
    });
    return { id: row.id };
  }

  async invalidation(identity: Identity, input: InvalidationInput): Promise<Wire<InvalidationResultDto>> {
    this.core.require(identity, 'admin.credibility');
    return this.recordInvalidation(identity.user, input);
  }

  /** The invalidation write, also used by the 7b jobs (no actor, `jobId` set; D-230). */
  async recordInvalidation(
    actor: { id: string; kind: UserKind } | null,
    input: Pick<InvalidationInput, 'kind' | 'ref' | 'detail'>,
    jobId: string | null = null,
  ): Promise<Wire<InvalidationResultDto>> {
    const ref = normalizeSourceRef(input.ref);
    const { id, affected } = await this.db.$transaction(async (tx) => {
      const row = await tx.invalidationEvent.create({
        data: { kind: input.kind, ref, detail: input.detail, recordedById: actor?.id ?? null, jobId },
      });
      await audit(tx, actor, 'credibility.invalidation', 'source', row.id, {
        kind: input.kind,
        ref,
        ...(jobId && { jobId }),
      });
      const keys = await this.affected(tx, ref);
      if (input.kind === 'retraction' || input.kind === 'root_wrong') {
        if (input.kind === 'root_wrong')
          await this.core.flag(tx, keys, { cause: 'root_wrong', causeId: row.id, reason: input.detail });
        else await this.core.notifyRecheck(tx, keys, 'A cited source was retracted', 'retraction');
        await this.core.propagate(tx, keys, row.id, input.detail);
      }
      return { id: row.id, affected: keys };
    });
    this.core.emitPages(affected.map((k) => k.path));
    return { id, affected: await this.core.keyDtos(affected) };
  }

  /** Current sections that cite `ref` or carry a check against it. */
  async affected(db: Db, ref: string) {
    const checked = await db.sourceCheck.findMany({
      where: { sourceRef: ref },
      select: { path: true, anchor: true },
      distinct: ['path', 'anchor'],
    });
    const like = ref.replace(/^(doi|url):/, '');
    const citing = await db.$queryRaw<{ path: string; anchor: string; text: string }[]>`
      SELECT s.path, s.anchor, s.text FROM "PageSection" s
      JOIN "Page" p ON p.path = s.path AND p."currentVersionLabel" = s."versionLabel"
      WHERE strpos(lower(s.text), lower(${like})) > 0`;
    const points = [
      ...checked,
      ...citing.filter((c) => citedSources(c.text).includes(ref)),
    ];
    const unique = [...new Map(points.map((p) => [`${p.path}\0${p.anchor}`, p])).values()];
    return this.core.currentKeys(unique, db);
  }
}

export { notReviewed };
