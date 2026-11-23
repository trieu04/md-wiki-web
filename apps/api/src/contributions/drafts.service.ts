import { Inject, Injectable } from '@nestjs/common';
import {
  composeProposed,
  defaultImpact,
  draftDigest,
  MAX_SOURCES,
  proposalTitle,
  rebasePlan,
  regionOf,
  renderContribution,
  sha256Hex,
  slugCandidate,
  slugify,
} from '@md-wiki/domain';
import { Prisma, type Draft } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QualityJobs } from '../quality/quality-jobs.service.js';
import { WikiIndexer } from '../wiki/indexer/wiki-indexer.js';
import type { Wire } from '../wiki/read.dto.js';
import { decodeMarkdown, wikiPath } from '../wiki/storage/wiki-storage.js';
import {
  CONTENT_LIMIT,
  type CreateDraftInput,
  type CursorInput,
  type DraftsDto,
  type UpdateDraftInput,
} from './contributions.dto.js';
import { ProposalFreezer } from './freezer.service.js';
import {
  decodeCursor,
  encodeCursor,
  invalid,
  isUniqueViolation,
  type Pin,
  type StoredSource,
} from './pins.js';
import { ContributionViews, draftAppliesTo, draftScope, draftSources } from './views.js';

type User = Identity['user'];
const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Strictly later than the previous updatedAt, so If-Match always distinguishes versions. */
function nextStamp(previous: Date) {
  const now = new Date();
  return now.getTime() > previous.getTime() ? now : new Date(previous.getTime() + 1);
}

@Injectable()
export class DraftsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WikiIndexer) private readonly indexer: WikiIndexer,
    @Inject(ContributionViews) private readonly views: ContributionViews,
    @Inject(ProposalFreezer) private readonly freezer: ProposalFreezer,
    @Inject(QualityJobs) private readonly quality: QualityJobs,
  ) {}

  private async own(user: User, id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new AppError('NOT_FOUND');
    const draft = await this.db.draft.findFirst({ where: { id, authorId: user.id } });
    if (!draft) throw new AppError('NOT_FOUND');
    return draft;
  }

  private async baseMarkdown(draft: Draft) {
    if (!draft.baseSnapshotId) return null;
    const row = await this.db.snapshot.findUniqueOrThrow({ where: { id: draft.baseSnapshotId } });
    return { row, markdown: decodeMarkdown(Buffer.from(row.content)) };
  }

  async list(user: User, query: CursorInput): Promise<Wire<DraftsDto>> {
    const limit = query.limit ?? 25;
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.draft.findMany({
      where: {
        authorId: user.id,
        ...(cursor && {
          OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }],
        }),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: await Promise.all(items.map((d) => this.views.draft(d))),
      nextCursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null,
    };
  }

  async get(user: User, id: string) {
    return this.views.draft(await this.own(user, id));
  }

  /** Create or resume (D-62); pins the target on open (§7.2.4). */
  async create(user: User, input: CreateDraftInput) {
    if (typeof input.targetPath !== 'string') throw new AppError('INVALID_PATH');
    const path = wikiPath(input.targetPath);
    const section = input.section ?? null;
    const existing = await this.db.draft.findUnique({
      where: { authorId_targetPath: { authorId: user.id, targetPath: path.path } },
    });
    if (existing) return { created: false, draft: await this.views.draft(existing) };
    const observed = await this.indexer.observe(path);
    if (!observed && section !== null) throw new AppError('NOT_FOUND');
    const region = regionOf(observed ? decodeMarkdown(observed.content) : null, section);
    if (!region)
      throw invalid('section', 'UNKNOWN_SECTION', 'section is not in the current version');
    try {
      const draft = await this.db.$transaction(async (tx) => {
        const now = new Date();
        const draft = await tx.draft.create({
          data: {
            authorId: user.id,
            targetPath: path.path,
            baseSnapshotId: observed?.snapshotId ?? null,
            scope: json({ section }),
            content: region.text,
            sources: json([]),
            appliesTo: json([]),
            createdAt: now,
            updatedAt: now,
          },
        });
        await audit(tx, user, 'draft.created', 'draft', draft.id, {
          targetPath: path.path,
          section,
          baseVersion: observed?.versionLabel ?? null,
        });
        return draft;
      });
      return { created: true, draft: await this.views.draft(draft) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.db.draft.findUniqueOrThrow({
        where: { authorId_targetPath: { authorId: user.id, targetPath: path.path } },
      });
      return { created: false, draft: await this.views.draft(raced) };
    }
  }

  /** Guarded write: the row must still carry `expected` as its updatedAt. */
  private async write(draft: Draft, expected: Date, data: Prisma.DraftUpdateManyMutationInput) {
    const updatedAt = nextStamp(draft.updatedAt);
    const { count } = await this.db.draft.updateMany({
      where: { id: draft.id, updatedAt: expected },
      data: { ...data, updatedAt },
    });
    if (!count) throw new AppError('PRECONDITION_FAILED', 'The draft changed; reload it');
    return this.db.draft.findUniqueOrThrow({ where: { id: draft.id } });
  }

  async update(user: User, id: string, expected: Date, input: UpdateDraftInput) {
    const draft = await this.own(user, id);
    if (draft.updatedAt.getTime() !== expected.getTime())
      throw new AppError('PRECONDITION_FAILED', 'The draft changed; reload it');
    const data: Prisma.DraftUpdateManyMutationInput = {};
    let content = input.content ?? draft.content;
    if (Buffer.byteLength(content, 'utf8') > CONTENT_LIMIT)
      throw new AppError('PAYLOAD_TOO_LARGE', 'Draft content exceeds 1 MiB');
    const { section } = draftScope(draft);
    if (input.scope && section !== null) {
      // Whole page: splice the edited region into the pinned body (§7.2.6, D-56).
      const base = await this.baseMarkdown(draft);
      const composed = composeProposed(base?.markdown ?? null, section, content);
      if (!composed.ok) throw invalid('scope', 'UNKNOWN_SECTION', 'section is not in the base');
      content = composed.value;
      data.scope = json({ section: null });
      if (Buffer.byteLength(content, 'utf8') > CONTENT_LIMIT)
        throw new AppError('PAYLOAD_TOO_LARGE', 'Draft content exceeds 1 MiB');
    }
    if (input.content !== undefined || data.scope) data.content = content;
    if (input.reason !== undefined) data.reason = input.reason;
    if (input.title !== undefined) data.title = input.title;
    if (input.appliesTo !== undefined) {
      const names = new Set(input.appliesTo.map((a) => a.name.trim().toLowerCase()));
      if (names.size !== input.appliesTo.length)
        throw invalid('appliesTo', 'INVALID_APPLIES_TO', 'applies-to names must be unique');
      data.appliesTo = json(
        input.appliesTo.map((a) => ({ name: a.name.trim(), version: a.version.trim() })),
      );
    }
    return this.views.draft(await this.write(draft, expected, data));
  }

  async remove(user: User, id: string) {
    const draft = await this.own(user, id);
    await this.db.$transaction(async (tx) => {
      await tx.draft.delete({ where: { id: draft.id } });
      await audit(tx, user, 'draft.discarded', 'draft', draft.id, { targetPath: draft.targetPath });
    });
  }

  /** Pin a source at its current version (§7.2.4). */
  async addSource(user: User, id: string, input: { path: unknown }) {
    const draft = await this.own(user, id);
    if (typeof input.path !== 'string') throw new AppError('INVALID_PATH');
    const path = wikiPath(input.path);
    const sources = draftSources(draft);
    if (path.path === draft.targetPath)
      throw invalid('path', 'INVALID_CONTEXT', 'the target cannot be its own source');
    if (sources.some((s) => s.path === path.path))
      throw invalid('path', 'INVALID_CONTEXT', 'source already pinned');
    if (sources.length >= MAX_SOURCES)
      throw invalid('path', 'INVALID_CONTEXT', `at most ${String(MAX_SOURCES)} sources`);
    const observed = await this.indexer.observe(path);
    if (!observed) throw new AppError('NOT_FOUND', 'source not found');
    const source: StoredSource = {
      path: path.path,
      snapshotId: observed.snapshotId,
      versionLabel: observed.versionLabel,
      sha256: observed.sha256,
      addedAt: new Date().toISOString(),
    };
    return this.views.draft(
      await this.write(draft, draft.updatedAt, { sources: json([...sources, source]) }),
    );
  }

  async removeSource(user: User, id: string, path: string) {
    const draft = await this.own(user, id);
    const sources = draftSources(draft);
    if (!sources.some((s) => s.path === path)) throw new AppError('NOT_FOUND');
    return this.views.draft(
      await this.write(draft, draft.updatedAt, {
        sources: json(sources.filter((s) => s.path !== path)),
      }),
    );
  }

  /** Rebase table §7.2.3. */
  async rebase(user: User, id: string, mode: 'auto' | 'keep_mine') {
    const draft = await this.own(user, id);
    const { section } = draftScope(draft);
    const base = await this.baseMarkdown(draft);
    const observed = await this.indexer.observe(wikiPath(draft.targetPath));
    const plan = rebasePlan({
      section,
      content: draft.content,
      base: base ? { markdown: base.markdown, sha256: base.row.sha256 } : null,
      current: observed
        ? { markdown: decodeMarkdown(observed.content), sha256: observed.sha256 }
        : null,
      mode,
    });
    if (!plan.ok) throw new AppError(plan.error);
    if (plan.value.kind === 'noop') return this.views.draft(draft);
    const content = plan.value.content;
    const updated = await this.db.$transaction(async (tx) => {
      const updatedAt = nextStamp(draft.updatedAt);
      const { count } = await tx.draft.updateMany({
        where: { id: draft.id, updatedAt: draft.updatedAt },
        data: { baseSnapshotId: observed?.snapshotId ?? null, content, updatedAt },
      });
      if (!count) throw new AppError('PRECONDITION_FAILED', 'The draft changed; reload it');
      await audit(tx, user, 'draft.rebased', 'draft', draft.id, {
        from: base?.row.label ?? null,
        to: observed?.versionLabel ?? null,
        mode,
      });
      return tx.draft.findUniqueOrThrow({ where: { id: draft.id } });
    });
    return this.views.draft(updated);
  }

  private async proposedOf(draft: Draft) {
    const { section } = draftScope(draft);
    const base = await this.baseMarkdown(draft);
    const composed = composeProposed(base?.markdown ?? null, section, draft.content);
    if (!composed.ok) throw invalid('bundle', 'UNKNOWN_SECTION', 'section is not in the base');
    const basePin: Pin | null = base
      ? {
          path: draft.targetPath,
          snapshotId: base.row.id,
          versionLabel: base.row.label,
          sha256: base.row.sha256,
        }
      : null;
    return { section, base, basePin, proposed: Buffer.from(composed.value, 'utf8') };
  }

  async submit(user: User, id: string, expected: Date) {
    const draft = await this.own(user, id);
    if (draft.updatedAt.getTime() !== expected.getTime())
      throw new AppError('PRECONDITION_FAILED', 'The draft changed; reload it');
    if (!draft.reason.trim()) throw invalid('reason', 'REASON_REQUIRED', 'A reason is required');
    const { section, basePin, proposed } = await this.proposedOf(draft);
    const sources = draftSources(draft).map(({ path, snapshotId, versionLabel, sha256 }) => ({
      path,
      snapshotId,
      versionLabel,
      sha256,
    }));
    return this.freezer.freeze({
      submitter: user,
      origin: 'editor',
      targetPath: draft.targetPath,
      base: basePin,
      proposed,
      title: draft.title,
      reason: draft.reason,
      section,
      sources,
      related: [],
      appliesTo: draftAppliesTo(draft),
      async commit(tx) {
        const { count } = await tx.draft.deleteMany({
          where: { id: draft.id, updatedAt: expected },
        });
        if (!count) throw new AppError('PRECONDITION_FAILED', 'The draft changed; reload it');
      },
    });
  }

  /** What a self-check of this draft checks, and its digest (§7.6.6). */
  private async selfCheckInput(draft: Draft) {
    const { section, base, proposed } = await this.proposedOf(draft);
    const sources = draftSources(draft);
    const digest = draftDigest({
      targetPath: draft.targetPath,
      baseSha256: base?.row.sha256 ?? null,
      section,
      proposedSha256: sha256Hex(proposed),
      title: draft.title,
      reason: draft.reason,
      sources: sources.map((s) => ({ path: s.path, sha256: s.sha256 })),
    });
    return { section, base, proposed, sources, digest };
  }

  async selfCheck(user: User, id: string) {
    const draft = await this.own(user, id);
    const { section, base, proposed, sources, digest } = await this.selfCheckInput(draft);
    const snapshots = await this.db.snapshot.findMany({
      where: { id: { in: sources.map((s) => s.snapshotId) } },
    });
    const byId = new Map(snapshots.map((row) => [row.id, row]));
    return this.quality.selfCheck({
      draftId: draft.id,
      authorId: user.id,
      digest,
      targetPath: draft.targetPath,
      section,
      sources: {
        targetPath: draft.targetPath,
        title: draft.title,
        reason: draft.reason,
        proposed,
        base: base ? { versionLabel: base.row.label, content: base.row.content } : null,
        sources: sources.flatMap((s) => {
          const row = byId.get(s.snapshotId);
          return row ? [{ path: s.path, versionLabel: s.versionLabel, content: row.content }] : [];
        }),
      },
    });
  }

  async selfCheckReport(user: User, id: string) {
    const draft = await this.own(user, id);
    let digest: string;
    try {
      digest = (await this.selfCheckInput(draft)).digest;
    } catch {
      // The section left the base: no run can be current.
      digest = '';
    }
    return this.quality.draftReport({ id: draft.id, authorId: user.id }, digest);
  }

  /** `.contribution.md` v3 for a draft (§7.2.7). */
  async export(user: User, id: string) {
    const draft = await this.own(user, id);
    const { section, base, basePin, proposed } = await this.proposedOf(draft);
    if (!base || !basePin)
      throw new AppError('PRECONDITION_FAILED', 'A new page has no versioned base to export');
    if (!draft.reason.trim()) throw invalid('reason', 'REASON_REQUIRED', 'A reason is required');
    const title = proposalTitle(draft.title, draft.reason);
    const stem = slugify(title);
    const taken = new Set(
      (
        await this.db.proposal.findMany({
          where: { slug: { startsWith: stem } },
          select: { slug: true },
        })
      ).map((p) => p.slug),
    );
    let attempt = 1;
    while (taken.has(slugCandidate(stem, attempt))) attempt++;
    const slug = slugCandidate(stem, attempt);
    const baseBytes = Buffer.from(base.row.content);
    const file = renderContribution({
      id: slug,
      baseHash: sha256Hex(baseBytes),
      proposedHash: sha256Hex(proposed),
      author: user.name,
      reason: draft.reason,
      title: draft.title.trim() ? draft.title.trim() : null,
      section,
      appliesTo: draftAppliesTo(draft),
      scope: [
        {
          path: draft.targetPath,
          version: basePin.versionLabel,
          impact: defaultImpact(section, false),
        },
      ],
      sources: draftSources(draft).map((s) => ({ path: s.path, version: s.versionLabel })),
      base: baseBytes.toString('utf8'),
      proposed: proposed.toString('utf8'),
    });
    return { slug, file };
  }
}
