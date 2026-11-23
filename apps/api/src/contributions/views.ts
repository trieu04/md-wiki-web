import { Inject, Injectable } from '@nestjs/common';
import {
  pageTitle,
  proposalTitle,
  regionOf,
  sectionChangedBetween,
  splitSections,
  type Manifest,
} from '@md-wiki/domain';
import type { Draft, Proposal, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import { decodeMarkdown } from '../wiki/storage/wiki-storage.js';
import type { ContributionDto, DraftDto, ProposalDto, SuggestionDto } from './contributions.dto.js';
import type { DraftScope, StoredSource } from './pins.js';

export const draftScope = (draft: Pick<Draft, 'scope'>) => draft.scope as unknown as DraftScope;
export const draftSources = (draft: Pick<Draft, 'sources'>) =>
  draft.sources as unknown as StoredSource[];
export const draftAppliesTo = (draft: Pick<Draft, 'appliesTo'>) =>
  draft.appliesTo as unknown as { name: string; version: string }[];
export const parseManifest = (proposal: Pick<Proposal, 'manifest'>) =>
  JSON.parse(Buffer.from(proposal.manifest).toString('utf8')) as Manifest;

/** Builds the read DTOs; all values come from stored rows (no storage IO). */
@Injectable()
export class ContributionViews {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  private async pageTitles(paths: string[]) {
    const pages = await this.db.page.findMany({
      where: { path: { in: [...new Set(paths)] } },
      select: { path: true, title: true, currentSha256: true, currentVersionLabel: true },
    });
    return new Map(pages.map((page) => [page.path, page]));
  }

  private async sectionTitles(keys: { path: string; versionLabel: string; anchor: string }[]) {
    if (!keys.length) return new Map<string, string>();
    const rows = await this.db.pageSection.findMany({
      where: { OR: keys.map(({ path, versionLabel, anchor }) => ({ path, versionLabel, anchor })) },
      select: { path: true, versionLabel: true, anchor: true, title: true },
    });
    return new Map(rows.map((r) => [`${r.path}\0${r.versionLabel}\0${r.anchor}`, r.title]));
  }

  async draft(draft: Draft): Promise<Wire<DraftDto>> {
    const { section } = draftScope(draft);
    const sources = draftSources(draft);
    const [base, pages] = await Promise.all([
      draft.baseSnapshotId
        ? this.db.snapshot.findUniqueOrThrow({ where: { id: draft.baseSnapshotId } })
        : null,
      this.pageTitles([draft.targetPath, ...sources.map((s) => s.path)]),
    ]);
    const page = pages.get(draft.targetPath);
    const baseMarkdown = base ? decodeMarkdown(Buffer.from(base.content)) : null;
    const region = regionOf(baseMarkdown, section);
    const baseChanged = (base?.sha256 ?? null) !== (page?.currentSha256 ?? null);
    let currentText: string | null = null;
    let sectionChanged = false;
    if (baseChanged) {
      const current = page
        ? await this.db.snapshot.findUnique({
            where: { path_label: { path: page.path, label: page.currentVersionLabel } },
          })
        : null;
      const currentMarkdown = current ? decodeMarkdown(Buffer.from(current.content)) : null;
      currentText = regionOf(currentMarkdown, section)?.text ?? null;
      sectionChanged = sectionChangedBetween(baseMarkdown, currentMarkdown, section);
    }
    const sectionTitle =
      section === null || baseMarkdown === null
        ? null
        : (splitSections(baseMarkdown).find((s) => s.anchor === section)?.title ?? null);
    return {
      id: draft.id,
      targetPath: draft.targetPath,
      pageTitle: page?.title ?? pageTitle(draft.targetPath, []),
      section,
      sectionTitle,
      title: draft.title,
      content: draft.content,
      reason: draft.reason,
      appliesTo: draftAppliesTo(draft),
      base: base
        ? {
            path: base.path,
            versionLabel: base.label,
            sha256: base.sha256,
            capturedAt: base.capturedAt.toISOString(),
          }
        : null,
      baseText: region?.text ?? '',
      baseStartLine: region?.startLine ?? 1,
      current: page
        ? { path: page.path, versionLabel: page.currentVersionLabel, sha256: page.currentSha256 }
        : null,
      baseChanged,
      sectionChanged,
      currentText,
      sources: sources.map(({ path, versionLabel, sha256, addedAt }) => ({
        path,
        versionLabel,
        sha256,
        addedAt,
        changed: pages.get(path)?.currentSha256 !== sha256,
      })),
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  async proposal(
    proposal: Proposal & { submitter: Pick<User, 'id' | 'name' | 'kind'> },
  ): Promise<Wire<ProposalDto>> {
    const m = parseManifest(proposal);
    const version = m.context.target.version;
    const [pages, titles] = await Promise.all([
      this.pageTitles([proposal.targetPath]),
      this.sectionTitles(
        proposal.section && version
          ? [{ path: proposal.targetPath, versionLabel: version, anchor: proposal.section }]
          : [],
      ),
    ]);
    return {
      id: proposal.id,
      slug: proposal.slug,
      title: proposal.title,
      targetPath: proposal.targetPath,
      pageTitle: pages.get(proposal.targetPath)?.title ?? pageTitle(proposal.targetPath, []),
      section: proposal.section,
      sectionTitle:
        proposal.section && version
          ? (titles.get(`${proposal.targetPath}\0${version}\0${proposal.section}`) ?? null)
          : null,
      state: proposal.state,
      origin: proposal.origin,
      submitter: {
        id: proposal.submitter.id,
        name: proposal.submitter.name,
        kind: proposal.submitter.kind,
      },
      reason: proposal.reason,
      bundleHash: proposal.bundleHash,
      proposedSha256: m.proposed_hash,
      base:
        version && m.context.target.hash
          ? { path: m.target, versionLabel: version, sha256: m.context.target.hash }
          : null,
      sources: m.context.sources.map(({ path, version: label, hash }) => ({
        path,
        versionLabel: label,
        sha256: hash,
      })),
      scope: m.scope_impact.map(({ path, version: label, impact }) => ({
        path,
        versionLabel: label,
        impact,
      })),
      appliesTo: m.applies_to,
      createdAt: proposal.createdAt.toISOString(),
    };
  }

  async contribution(
    proposal: Proposal & { submitter: Pick<User, 'id' | 'name' | 'kind'> },
  ): Promise<Wire<ContributionDto>> {
    return {
      ...(await this.proposal(proposal)),
      manifest: Buffer.from(proposal.manifest).toString('utf8'),
      proposed: Buffer.from(proposal.proposed).toString('utf8'),
    };
  }

  async suggestions(
    drafts: (Draft & { baseSnapshot: { label: string; sha256: string } | null })[],
    proposals: Proposal[],
  ): Promise<Map<string, Wire<SuggestionDto>>> {
    const pages = await this.pageTitles([
      ...drafts.map((d) => d.targetPath),
      ...proposals.map((p) => p.targetPath),
    ]);
    const keys = [
      ...drafts.flatMap((d) => {
        const { section } = draftScope(d);
        return section && d.baseSnapshot
          ? [{ path: d.targetPath, versionLabel: d.baseSnapshot.label, anchor: section }]
          : [];
      }),
      ...proposals.flatMap((p) => {
        const version = parseManifest(p).context.target.version;
        return p.section && version
          ? [{ path: p.targetPath, versionLabel: version, anchor: p.section }]
          : [];
      }),
    ];
    const titles = await this.sectionTitles(keys);
    const title = (path: string, version: string | null | undefined, anchor: string | null) =>
      anchor && version ? (titles.get(`${path}\0${version}\0${anchor}`) ?? null) : null;
    const out = new Map<string, Wire<SuggestionDto>>();
    for (const d of drafts) {
      const { section } = draftScope(d);
      const page = pages.get(d.targetPath);
      out.set(d.id, {
        kind: 'draft',
        id: d.id,
        slug: null,
        targetPath: d.targetPath,
        pageTitle: page?.title ?? pageTitle(d.targetPath, []),
        section,
        sectionTitle: title(d.targetPath, d.baseSnapshot?.label, section),
        title: proposalTitle(d.title, d.reason),
        state: 'draft',
        needsAttention: (d.baseSnapshot?.sha256 ?? null) !== (page?.currentSha256 ?? null),
        at: d.updatedAt.toISOString(),
      });
    }
    for (const p of proposals) {
      out.set(p.id, {
        kind: 'proposal',
        id: p.id,
        slug: p.slug,
        targetPath: p.targetPath,
        pageTitle: pages.get(p.targetPath)?.title ?? pageTitle(p.targetPath, []),
        section: p.section,
        sectionTitle: title(p.targetPath, parseManifest(p).context.target.version, p.section),
        title: p.title,
        state: p.state,
        needsAttention: p.state === 'stale',
        at: p.createdAt.toISOString(),
      });
    }
    return out;
  }
}
