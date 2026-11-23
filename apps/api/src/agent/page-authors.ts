import {
  OWNERS_PATH,
  ownersOf,
  parseOwners,
  resolvePageAuthors,
  type OwnersFile,
  type PageAuthors,
} from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

/** The indexed current version of `wiki-meta/owners.md` (reviewed like content), parsed. */
export async function ownersFile(
  db: Db,
): Promise<{ versionLabel: string | null; file: OwnersFile }> {
  const page = await db.page.findUnique({ where: { path: OWNERS_PATH } });
  if (!page) return { versionLabel: null, file: { rules: [], warnings: [] } };
  const snap = await db.snapshot.findFirst({
    where: { path: OWNERS_PATH, sha256: page.currentSha256 },
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
    select: { content: true },
  });
  if (!snap) return { versionLabel: page.currentVersionLabel, file: { rules: [], warnings: [] } };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(snap.content);
  } catch {
    return { versionLabel: page.currentVersionLabel, file: { rules: [], warnings: ['invalid UTF-8'] } };
  }
  return { versionLabel: page.currentVersionLabel, file: parseOwners(text) };
}

/** Page authors of a path for a proposal by `submitterId` (D-206). */
export async function pageAuthorsOf(
  db: Db,
  targetPath: string,
  submitterId: string,
): Promise<PageAuthors> {
  const { file } = await ownersFile(db);
  const listed = ownersOf(file, targetPath);
  const published = await db.proposal.findMany({
    where: { targetPath, state: 'published', submitter: { kind: 'human' } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { submitterId: true },
    take: 50,
  });
  const users = await db.user.findMany({
    where: {
      OR: [
        { email: { in: listed } },
        { id: { in: published.map((p) => p.submitterId) } },
        { roles: { has: 'owner' } },
      ],
    },
    select: { id: true, email: true, kind: true, disabledAt: true, roles: true, createdAt: true },
  });
  return resolvePageAuthors({
    listed,
    published: published.map((p) => p.submitterId),
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      kind: u.kind,
      disabled: u.disabledAt !== null,
      roles: u.roles,
      createdAt: u.createdAt.getTime(),
    })),
    submitterId,
  });
}
