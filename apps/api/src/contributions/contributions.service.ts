import { Inject, Injectable } from '@nestjs/common';
import { parseContribution, sha256Hex } from '@md-wiki/domain';
import { Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import { wikiPath } from '../wiki/storage/wiki-storage.js';
import type { ContributionInput, CursorInput, SuggestionsDto } from './contributions.dto.js';
import { ProposalFreezer, type Frozen } from './freezer.service.js';
import { decodeCursor, encodeCursor, invalid, type Pin } from './pins.js';
import { ContributionViews } from './views.js';

type User = Identity['user'];
const REVIEW_ROLES = new Set(['reviewer', 'publisher', 'owner']);

@Injectable()
export class ContributionsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ProposalFreezer) private readonly freezer: ProposalFreezer,
    @Inject(ContributionViews) private readonly views: ContributionViews,
  ) {}

  async proposalDto(id: string) {
    const proposal = await this.db.proposal.findUniqueOrThrow({
      where: { id },
      include: { submitter: { select: { id: true, name: true, kind: true } } },
    });
    return this.views.proposal(proposal);
  }

  /** Agent REST submit (§7.2.6). */
  async submit(user: User, input: ContributionInput): Promise<Frozen> {
    if (typeof input.targetPath !== 'string') throw new AppError('INVALID_PATH');
    const target = wikiPath(input.targetPath);
    const proposed = Buffer.from(input.content, 'utf8');
    let base: Pin | null = null;
    if (input.base) {
      base = await this.freezer.resolve('base', target.path, input.base.versionLabel);
      if (base.sha256 !== input.base.sha256)
        throw invalid('base', 'UNKNOWN_VERSION', 'unknown or modified context snapshot');
    }
    const sources: Pin[] = [];
    for (const [i, ref] of (input.sources ?? []).entries())
      sources.push(await this.freezer.resolve(`sources[${String(i)}]`, ref.path, ref.versionLabel));
    const related: (Pin & { impact: string })[] = [];
    for (const [i, ref] of (input.scope ?? []).entries())
      related.push({
        ...(await this.freezer.resolve(`scope[${String(i)}]`, ref.path, ref.versionLabel)),
        impact: ref.impact.trim(),
      });
    return this.freezer.freeze({
      submitter: user,
      origin: 'api',
      targetPath: target.path,
      base,
      proposed,
      title: input.title,
      reason: input.reason,
      section: input.section ?? null,
      targetImpact: input.targetImpact?.trim() ?? null,
      ...(input.slug !== undefined && { slug: input.slug }),
      sources,
      related,
      appliesTo: (input.appliesTo ?? []).map((a) => ({
        name: a.name.trim(),
        version: a.version.trim(),
      })),
    });
  }

  /** `.contribution.md` v3 import (§7.2.7). The submitter is the caller, never the Author cell. */
  async import(user: User, text: string): Promise<Frozen> {
    const parsed = parseContribution(Buffer.from(text, 'utf8'));
    if (!parsed.ok) {
      if (parsed.error.code === 'TOO_LARGE')
        throw new AppError('PAYLOAD_TOO_LARGE', parsed.error.message);
      throw invalid('file', 'CONTRIBUTION_FORMAT', parsed.error.message);
    }
    const file = parsed.value;
    const [primary, ...rest] = file.scope;
    if (!primary) throw invalid('file', 'CONTRIBUTION_FORMAT', 'missing primary scope row');
    const base = await this.freezer.resolve('scope[0]', primary.path, primary.version);
    if (base.sha256 !== file.baseHash)
      throw invalid(
        'file',
        'CONTRIBUTION_FORMAT',
        'primary scope file must match the base content',
      );
    if (sha256Hex(file.base) !== file.baseHash || sha256Hex(file.proposed) !== file.proposedHash)
      throw invalid('bundle', 'HASH_MISMATCH', 'payload hash mismatch');
    const related: (Pin & { impact: string })[] = [];
    for (const [i, row] of rest.entries())
      related.push({
        ...(await this.freezer.resolve(`scope[${String(i + 1)}]`, row.path, row.version)),
        impact: row.impact.trim(),
      });
    const sources: Pin[] = [];
    for (const [i, row] of file.sources.entries())
      sources.push(await this.freezer.resolve(`sources[${String(i)}]`, row.path, row.version));
    return this.freezer.freeze({
      submitter: user,
      origin: 'import',
      targetPath: primary.path,
      base,
      proposed: Buffer.from(file.proposed),
      title: file.title,
      reason: file.reason,
      section: file.section,
      targetImpact: primary.impact.trim(),
      slug: file.id,
      sources,
      related,
      appliesTo: file.appliesTo,
      ...(file.authorMetadata && { authorMetadata: file.authorMetadata }),
    });
  }

  async get(user: User, slug: string) {
    const proposal = await this.db.proposal.findUnique({
      where: { slug },
      include: { submitter: { select: { id: true, name: true, kind: true } } },
    });
    // Visible to its submitter and to reviewers (D-63); otherwise indistinguishable from absent.
    if (
      !proposal ||
      (proposal.submitterId !== user.id && !user.roles.some((role) => REVIEW_ROLES.has(role)))
    )
      throw new AppError('NOT_FOUND');
    return this.views.contribution(proposal);
  }

  /** Drafts ∪ proposals of the caller, newest first (D-64). */
  async suggestions(user: User, query: CursorInput): Promise<Wire<SuggestionsDto>> {
    const limit = query.limit ?? 25;
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.$queryRaw<{ kind: 'draft' | 'proposal'; id: string; at: Date }[]>`
      SELECT kind, id, at FROM (
        SELECT 'draft' AS kind, id, "updatedAt" AS at FROM "Draft" WHERE "authorId" = ${user.id}::uuid
        UNION ALL
        SELECT 'proposal' AS kind, id, "createdAt" AS at FROM "Proposal" WHERE "submitterId" = ${user.id}::uuid
      ) s
      ${cursor ? Prisma.sql`WHERE (at, id) < (${cursor.at}, ${cursor.id}::uuid)` : Prisma.empty}
      ORDER BY at DESC, id DESC
      LIMIT ${limit + 1}
    `;
    const page = rows.slice(0, limit);
    const ids = (kind: string) => page.filter((r) => r.kind === kind).map((r) => r.id);
    const [drafts, proposals, draftCount, proposalCount] = await Promise.all([
      this.db.draft.findMany({
        where: { id: { in: ids('draft') } },
        include: { baseSnapshot: { select: { label: true, sha256: true } } },
      }),
      this.db.proposal.findMany({ where: { id: { in: ids('proposal') } } }),
      this.db.draft.count({ where: { authorId: user.id } }),
      this.db.proposal.count({ where: { submitterId: user.id } }),
    ]);
    const views = await this.views.suggestions(drafts, proposals);
    const last = page.at(-1);
    return {
      items: page.flatMap((r) => views.get(r.id) ?? []),
      nextCursor: rows.length > limit && last ? encodeCursor(new Date(last.at), last.id) : null,
      total: draftCount + proposalCount,
    };
  }
}
