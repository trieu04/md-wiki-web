import { Inject, Injectable } from '@nestjs/common';
import {
  aliasKeys,
  citedSources,
  contradictionApplies,
  provenanceGroups,
  sectionKeyOf,
  type InvalidationKind,
  type ReviewerKind,
  type SectionEvidence,
  type SourceCheckResult,
} from '@md-wiki/domain';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SectionKey {
  path: string;
  anchor: string;
  sectionHash: string;
}
type Db = Prisma.TransactionClient | PrismaService;

export interface LoadedCheck {
  id: string;
  sectionHash: string;
  /** The hash the record was written for (differs from `sectionHash` through an anchor link). */
  recordedHash: string;
  recordedAnchor: string;
  time: string;
  checkerKind: ReviewerKind;
  checkerId: string;
  result: SourceCheckResult;
  sourceRef: string;
  sourceTitle: string | null;
  location: string | null;
}
export interface LoadedRecord {
  id: string;
  sectionHash: string;
  recordedHash: string;
  recordedAnchor: string;
  time: string;
}
/** Everything the label engine and *Why this label* need for one section key. */
export interface LoadedEvidence extends SectionEvidence {
  key: SectionKey;
  sourceChecks: LoadedCheck[];
  ownerConfirmations: (LoadedRecord & { ownerId: string; note: string })[];
  errors: (LoadedRecord & { reason: string; origin: string })[];
  flags: (LoadedRecord & { reason: string; cause: string; depth: number })[];
  /** Flags already resolved (shown in *Why* as closed). */
  closedFlags: (LoadedRecord & { reason: string; cause: string })[];
  invalidations: { id: string; kind: InvalidationKind; ref: string; time: string; detail: string }[];
  contradictions: { id: string; time: string; applies: boolean; other: { path: string; anchor: string } }[];
  links: { oldAnchor: string; oldHash: string; at: string }[];
}

interface Row {
  id: string;
  path: string;
  anchor: string;
  sectionHash: string;
  createdAt: Date;
}
const CLOSING = ['still_correct', 'confirm_error'];

/**
 * Loads credibility records for section keys (system-logic §7.7.2): anchor-link aliases, source
 * checks, owner confirmations, confirmed errors, open flags, invalidations of the refs involved,
 * cited-source retractions, on-hold section topics and confirmed contradictions.
 */
@Injectable()
export class SectionEvidenceLoader {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async load(keys: readonly SectionKey[], db: Db = this.prisma): Promise<LoadedEvidence[]> {
    if (!keys.length) return [];
    const paths = [...new Set(keys.map((k) => k.path))];
    const links = (
      await db.anchorLink.findMany({ where: { path: { in: paths } }, orderBy: { createdAt: 'asc' } })
    ).map((l) => ({ ...l, at: l.createdAt.toISOString() }));
    // every key the evidence of a requested key may be recorded under
    const owners = new Map<string, SectionKey>();
    const aliasesOf = new Map<string, SectionKey[]>();
    for (const key of keys) {
      const aliases = aliasKeys(key, links);
      aliasesOf.set(sectionKeyOf(key), aliases);
      for (const k of [key, ...aliases]) owners.set(sectionKeyOf(k), key);
    }
    const all = [...owners.keys()].map((k) => {
      const [path = '', anchor = '', sectionHash = ''] = k.split('\0');
      return { path, anchor, sectionHash };
    });
    const tuple = Prisma.sql`unnest(${all.map((k) => k.path)}::text[], ${all.map((k) => k.anchor)}::text[], ${all.map((k) => k.sectionHash)}::text[]) AS k(path, anchor, hash)`;
    const on = Prisma.sql`t.path = k.path AND t.anchor = k.anchor AND t."sectionHash" = k.hash`;

    const [checks, confirmations, errors, flags] = await Promise.all([
      db.$queryRaw<
        (Row & {
          checkerKind: ReviewerKind;
          checkerId: string;
          result: SourceCheckResult;
          sourceRef: string;
          sourceTitle: string | null;
          location: string | null;
        })[]
      >`SELECT t.* FROM "SourceCheck" t JOIN ${tuple} ON ${on}`,
      db.$queryRaw<
        (Row & { ownerId: string; note: string })[]
      >`SELECT t.* FROM "OwnerConfirmation" t JOIN ${tuple} ON ${on}`,
      db.$queryRaw<
        (Row & { reason: string; origin: string })[]
      >`SELECT t.* FROM "ConfirmedError" t JOIN ${tuple} ON ${on}`,
      db.$queryRaw<
        (Row & { reason: string; cause: string; depth: number })[]
      >`SELECT t.* FROM "RecheckFlag" t JOIN ${tuple} ON ${on}`,
    ]);
    const closedFlagIds = new Set(
      flags.length
        ? (
            await db.credibilityResolution.findMany({
              where: {
                subjectType: 'flag',
                subjectId: { in: flags.map((f) => f.id) },
                outcome: { in: CLOSING },
              },
              select: { subjectId: true },
            })
          ).map((r) => r.subjectId)
        : [],
    );

    // Cited refs are only needed when some cited source could be retracted.
    const retracted = await db.invalidationEvent.findMany({
      where: { kind: 'retraction' },
      select: { ref: true },
      distinct: ['ref'],
    });
    const cited = new Map<string, string[]>();
    if (retracted.length) {
      const k = Prisma.sql`unnest(${keys.map((x) => x.path)}::text[], ${keys.map((x) => x.anchor)}::text[], ${keys.map((x) => x.sectionHash)}::text[]) AS k(path, anchor, hash)`;
      const texts = await db.$queryRaw<{ path: string; anchor: string; sectionHash: string; text: string }[]>`
        SELECT DISTINCT ON (t.path, t.anchor, t."sectionHash") t.path, t.anchor, t."sectionHash", t.text
        FROM "PageSection" t JOIN ${k} ON ${on}`;
      for (const t of texts) cited.set(sectionKeyOf(t), citedSources(t.text));
    }
    const refs = [
      ...new Set([...checks.map((c) => c.sourceRef), ...[...cited.values()].flat()]),
    ];
    const invalidations = refs.length
      ? await db.invalidationEvent.findMany({ where: { ref: { in: refs } } })
      : [];
    const retractionIds = invalidations.filter((i) => i.kind === 'retraction').map((i) => i.id);
    const cleared = retractionIds.length
      ? await db.credibilityResolution.findMany({
          where: { subjectType: 'retraction', subjectId: { in: retractionIds }, outcome: 'still_correct' },
        })
      : [];

    const anchorPairs = Prisma.sql`unnest(${keys.map((x) => x.path)}::text[], ${keys.map((x) => x.anchor)}::text[]) AS k(path, anchor)`;
    const [held, edges] = await Promise.all([
      db.$queryRaw<{ id: string; path: string; anchor: string; updatedAt: Date }[]>`
        SELECT t.id, t.path, t.anchor, t."updatedAt" FROM "Topic" t JOIN ${anchorPairs}
          ON t.path = k.path AND t.anchor = k.anchor
        WHERE t."proposalId" IS NULL AND t.status = 'on_hold'`,
      db.$queryRaw<
        { id: string; srcPath: string; srcAnchor: string; dstPath: string; dstAnchor: string; createdAt: Date }[]
      >`
        SELECT DISTINCT e.id, e."srcPath", e."srcAnchor", e."dstPath", e."dstAnchor", e."createdAt"
        FROM "CredibilityEdge" e JOIN ${anchorPairs}
          ON (e."srcPath" = k.path AND e."srcAnchor" = k.anchor) OR (e."dstPath" = k.path AND e."dstAnchor" = k.anchor)
        WHERE e.kind = 'contradicts'
          AND NOT EXISTS (SELECT 1 FROM "CredibilityResolution" r WHERE r."subjectId" = e.id AND r."subjectType" = 'edge')`,
    ]);
    // Provenance groups of both sides of each contradiction, on their current versions.
    const groups = new Map<string, number>();
    if (edges.length) {
      const sides = [
        ...new Set(edges.flatMap((e) => [`${e.srcPath}\0${e.srcAnchor}`, `${e.dstPath}\0${e.dstAnchor}`])),
      ].map((s) => s.split('\0') as [string, string]);
      const current = await db.$queryRaw<{ path: string; anchor: string; sectionHash: string }[]>`
        SELECT s.path, s.anchor, s."sectionHash" FROM "PageSection" s
        JOIN "Page" p ON p.path = s.path AND p."currentVersionLabel" = s."versionLabel"
        JOIN unnest(${sides.map((s) => s[0])}::text[], ${sides.map((s) => s[1])}::text[]) AS k(path, anchor)
          ON s.path = k.path AND s.anchor = k.anchor`;
      const sideChecks = await db.sourceCheck.findMany({
        where: { OR: current.map((c) => ({ path: c.path, anchor: c.anchor, sectionHash: c.sectionHash })) },
      });
      const sideInvalidations = await db.invalidationEvent.findMany({
        where: { ref: { in: [...new Set(sideChecks.map((c) => c.sourceRef))] } },
      });
      for (const c of current)
        groups.set(
          `${c.path}\0${c.anchor}`,
          provenanceGroups(
            sideChecks
              .filter((s) => s.path === c.path && s.anchor === c.anchor)
              .map((s) => ({
                id: s.id,
                sectionHash: s.sectionHash,
                time: s.createdAt.toISOString(),
                checkerKind: s.checkerKind,
                result: s.result,
                sourceRef: s.sourceRef,
              })),
            c.sectionHash,
            sideInvalidations.map((i) => ({
              id: i.id,
              kind: i.kind,
              ref: i.ref,
              time: i.detectedAt.toISOString(),
            })),
          ),
        );
    }

    const bucket = <T extends Row>(rows: T[]) => {
      const out = new Map<string, (T & { recordedHash: string; recordedAnchor: string })[]>();
      for (const row of rows) {
        const owner = owners.get(sectionKeyOf(row));
        if (!owner) continue;
        const list = out.get(sectionKeyOf(owner)) ?? [];
        list.push({ ...row, recordedHash: row.sectionHash, recordedAnchor: row.anchor });
        out.set(sectionKeyOf(owner), list);
      }
      return out;
    };
    const [byChecks, byConfirmations, byErrors, byFlags] = [
      bucket(checks),
      bucket(confirmations),
      bucket(errors),
      bucket(flags),
    ];
    const iso = (d: Date) => d.toISOString();
    return keys.map((key): LoadedEvidence => {
      const k = sectionKeyOf(key);
      const hash = key.sectionHash;
      const rekey = (r: Row & { recordedHash: string; recordedAnchor: string }) => ({
        id: r.id,
        sectionHash: hash,
        recordedHash: r.recordedHash,
        recordedAnchor: r.recordedAnchor,
        time: iso(r.createdAt),
      });
      const keyChecks = byChecks.get(k) ?? [];
      const keyRefs = new Set([...keyChecks.map((c) => c.sourceRef), ...(cited.get(k) ?? [])]);
      const flagRows = byFlags.get(k) ?? [];
      const self = `${key.path}\0${key.anchor}`;
      return {
        key,
        currentHash: hash,
        reviews: [],
        sourceChecks: keyChecks.map((c) => ({
          ...rekey(c),
          checkerKind: c.checkerKind,
          checkerId: c.checkerId,
          result: c.result,
          sourceRef: c.sourceRef,
          sourceTitle: c.sourceTitle,
          location: c.location,
        })),
        ownerConfirmations: (byConfirmations.get(k) ?? []).map((c) => ({
          ...rekey(c),
          ownerId: c.ownerId,
          note: c.note,
        })),
        errors: (byErrors.get(k) ?? []).map((e) => ({ ...rekey(e), reason: e.reason, origin: e.origin })),
        flags: flagRows
          .filter((f) => !closedFlagIds.has(f.id))
          .map((f) => ({ ...rekey(f), reason: f.reason, cause: f.cause, depth: f.depth })),
        closedFlags: flagRows
          .filter((f) => closedFlagIds.has(f.id))
          .map((f) => ({ ...rekey(f), reason: f.reason, cause: f.cause })),
        invalidations: invalidations
          .filter((i) => keyRefs.has(i.ref))
          .map((i) => ({ id: i.id, kind: i.kind, ref: i.ref, time: iso(i.detectedAt), detail: i.detail })),
        clearedRetractions: new Set(
          cleared
            .filter((c) => c.path === key.path && c.anchor === key.anchor && c.sectionHash === hash)
            .map((c) => c.subjectId),
        ),
        citedRefs: cited.get(k) ?? [],
        onHoldTopics: held
          .filter((t) => t.path === key.path && t.anchor === key.anchor)
          .map((t) => ({ id: t.id, time: iso(t.updatedAt) })),
        contradictions: edges
          .filter((e) => `${e.srcPath}\0${e.srcAnchor}` === self || `${e.dstPath}\0${e.dstAnchor}` === self)
          .map((e) => {
            const other =
              `${e.srcPath}\0${e.srcAnchor}` === self
                ? { path: e.dstPath, anchor: e.dstAnchor }
                : { path: e.srcPath, anchor: e.srcAnchor };
            return {
              id: e.id,
              time: iso(e.createdAt),
              other,
              applies: contradictionApplies(
                groups.get(self) ?? 0,
                groups.get(`${other.path}\0${other.anchor}`) ?? 0,
              ),
            };
          }),
        links: (aliasesOf.get(k) ?? []).map((a) => ({
          oldAnchor: a.anchor,
          oldHash: a.sectionHash,
          at: links.find((l) => l.oldAnchor === a.anchor && l.oldHash === a.sectionHash)?.at ?? '',
        })),
      };
    });
  }
}
