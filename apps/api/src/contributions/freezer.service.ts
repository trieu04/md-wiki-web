import { Inject, Injectable } from '@nestjs/common';
import {
  buildManifest,
  proposalTitle,
  serializeManifest,
  slugCandidate,
  slugify,
  validateBundle,
  validateWikiPath,
  type AppliesTo,
  type AuthorMetadata,
} from '@md-wiki/domain';
import type { Prisma, ProposalOrigin, User } from '@prisma/client';
import { audit } from '../auth/credentials.js';
import { AppError, type FieldProblem } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WikiIndexer } from '../wiki/indexer/wiki-indexer.js';
import { WIKI_STORAGE } from '../wiki/wiki.module.js';
import type { WikiStorage } from '../wiki/storage/wiki-storage.js';
import { wikiPath } from '../wiki/storage/wiki-storage.js';
import {
  bundleError,
  invalid,
  isUniqueViolation,
  sha256,
  sourceChanged,
  type Pin,
} from './pins.js';

export interface FreezeInput {
  submitter: Pick<User, 'id' | 'kind'>;
  origin: ProposalOrigin;
  targetPath: string;
  base: Pin | null;
  proposed: Buffer;
  title: string | null | undefined;
  reason: string;
  section: string | null;
  targetImpact?: string | null;
  /** Explicit slug (agent `slug`, import `ID`): idempotent replay (§7.2.5). */
  slug?: string;
  sources: Pin[];
  related: (Pin & { impact: string })[];
  appliesTo: AppliesTo[];
  authorMetadata?: AuthorMetadata;
  /** Runs inside the insert transaction (editor submit deletes the draft here). */
  commit?: (tx: Prisma.TransactionClient) => Promise<void>;
}
export interface Frozen {
  proposalId: string;
  replay: boolean;
}

const MAX_ATTEMPTS = 5;

/** The single freeze path for editor, agent and import submissions (P4-G). */
@Injectable()
export class ProposalFreezer {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WikiIndexer) private readonly indexer: WikiIndexer,
    @Inject(WIKI_STORAGE) private readonly storage: WikiStorage,
  ) {}

  /** Resolve a public (path, versionLabel) pair to its registered snapshot (md-wiki `reference`). */
  async resolve(field: string, path: unknown, versionLabel: string): Promise<Pin> {
    const valid = typeof path === 'string' && validateWikiPath(path).ok;
    if (!valid) throw new AppError('INVALID_PATH', `${field}: invalid path`);
    const row = await this.db.snapshot.findUnique({
      where: { path_label: { path, label: versionLabel } },
      select: { id: true, sha256: true, content: true },
    });
    if (!row || sha256(row.content) !== row.sha256)
      throw invalid(field, 'UNKNOWN_VERSION', 'unknown or modified context snapshot');
    return { path, snapshotId: row.id, versionLabel, sha256: row.sha256 };
  }

  private async snapshotBytes(field: string, pin: Pin): Promise<Buffer> {
    const row = await this.db.snapshot.findUnique({ where: { id: pin.snapshotId } });
    if (
      !row ||
      row.path !== pin.path ||
      row.sha256 !== pin.sha256 ||
      sha256(row.content) !== row.sha256
    )
      throw invalid(field, 'UNKNOWN_VERSION', 'unknown or modified context snapshot');
    return Buffer.from(row.content);
  }

  async freeze(input: FreezeInput): Promise<Frozen> {
    const target = wikiPath(input.targetPath);
    return this.storage.withRootLock(async () => {
      const base = input.base ? await this.snapshotBytes('base', input.base) : null;
      for (const [i, pin] of input.sources.entries())
        await this.snapshotBytes(`sources[${String(i)}]`, pin);
      for (const [i, pin] of input.related.entries())
        await this.snapshotBytes(`scope[${String(i)}]`, pin);
      const title = proposalTitle(input.title, input.reason);
      const build = (slug: string) => {
        const manifest = serializeManifest(
          buildManifest({
            slug,
            target: target.path,
            title,
            reason: input.reason,
            section: input.section,
            base: input.base ? { version: input.base.versionLabel, hash: input.base.sha256 } : null,
            proposed: input.proposed,
            sources: input.sources.map((s) => ({
              path: s.path,
              version: s.versionLabel,
              hash: s.sha256,
            })),
            related: input.related.map((s) => ({
              path: s.path,
              version: s.versionLabel,
              impact: s.impact,
            })),
            targetImpact: input.targetImpact ?? null,
            appliesTo: input.appliesTo,
            ...(input.authorMetadata && { authorMetadata: input.authorMetadata }),
          }),
        );
        const result = validateBundle({ manifest, base, proposed: input.proposed });
        if (!result.ok) throw bundleError(result.error);
        return { manifest, bundleHash: result.value.bundleHash };
      };

      let slugs: () => string;
      if (input.slug !== undefined) {
        const explicit = input.slug;
        const { bundleHash } = build(explicit);
        const existing = await this.db.proposal.findUnique({
          where: { slug: explicit },
          select: { id: true, submitterId: true, bundleHash: true },
        });
        if (existing) {
          if (existing.submitterId === input.submitter.id && existing.bundleHash === bundleHash)
            return { proposalId: existing.id, replay: true };
          throw new AppError('ALREADY_EXISTS', 'proposal slug is bound to another bundle');
        }
        slugs = () => explicit;
      } else {
        const stem = slugify(title);
        build(stem);
        const taken = new Set(
          (
            await this.db.proposal.findMany({
              where: { slug: { startsWith: stem } },
              select: { slug: true },
            })
          ).map((p) => p.slug),
        );
        let attempt = 1;
        slugs = () => {
          while (taken.has(slugCandidate(stem, attempt))) attempt++;
          const slug = slugCandidate(stem, attempt);
          taken.add(slug);
          return slug;
        };
      }

      await this.checkFresh(target.path, input);

      for (let attempt = 1; ; attempt++) {
        const slug = slugs();
        const { manifest, bundleHash } = build(slug);
        try {
          const id = await this.db.$transaction(async (tx) => {
            const refs = [
              ...(input.base
                ? [{ pin: input.base, role: 'target' as const, impact: null, ord: 0 }]
                : []),
              ...input.related.map((pin, ord) => ({
                pin,
                role: 'scope' as const,
                impact: pin.impact,
                ord,
              })),
              ...input.sources.map((pin, ord) => ({
                pin,
                role: 'source' as const,
                impact: null,
                ord,
              })),
            ];
            const created = await tx.proposal.create({
              data: {
                slug,
                title,
                targetPath: target.path,
                section: input.section,
                submitterId: input.submitter.id,
                origin: input.origin,
                reason: input.reason,
                bundleHash,
                manifest: new Uint8Array(manifest),
                base: base ? new Uint8Array(base) : null,
                proposed: new Uint8Array(input.proposed),
                baseSha256: input.base?.sha256 ?? null,
                baseSnapshotId: input.base?.snapshotId ?? null,
                refs: {
                  create: refs.map(({ pin, role, impact, ord }) => ({
                    snapshotId: pin.snapshotId,
                    role,
                    impact,
                    ord,
                  })),
                },
              },
              select: { id: true },
            });
            await input.commit?.(tx);
            await audit(tx, input.submitter, 'proposal.submitted', 'proposal', created.id, {
              slug,
              targetPath: target.path,
              origin: input.origin,
              bundleHash,
            });
            return created.id;
          });
          return { proposalId: id, replay: false };
        } catch (error) {
          if (isUniqueViolation(error) && input.slug === undefined && attempt < MAX_ATTEMPTS)
            continue;
          if (isUniqueViolation(error)) throw new AppError('ALREADY_EXISTS', 'proposal slug taken');
          throw error;
        }
      }
    });
  }

  /** Freshness at submit (§7.2.4): nothing is recaptured silently. */
  private async checkFresh(targetPath: string, input: FreezeInput) {
    const current = await this.indexer.observe(wikiPath(targetPath));
    if ((current?.sha256 ?? null) !== (input.base?.sha256 ?? null))
      throw new AppError('STALE_BASE', 'The page changed since it was read');
    const fields: FieldProblem[] = [];
    const check = async (field: string, pin: Pin) => {
      const now = await this.indexer.observe(wikiPath(pin.path));
      if (now?.sha256 !== pin.sha256)
        fields.push({ path: field, code: 'SOURCE_CHANGED', message: pin.path });
    };
    for (const [i, pin] of input.sources.entries()) await check(`sources[${String(i)}]`, pin);
    for (const [i, pin] of input.related.entries()) await check(`scope[${String(i)}]`, pin);
    if (fields.length) throw sourceChanged(fields);
  }
}
