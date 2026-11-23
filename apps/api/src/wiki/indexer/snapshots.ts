import { nextLabel } from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import type { ReadResult } from '../storage/wiki-storage.js';

// Called under the storage root lock, in the same transaction as the index.
export async function captureSnapshot(tx: Prisma.TransactionClient, file: ReadResult, now: Date) {
  const path = file.path.path;
  const latest = await tx.snapshot.findFirst({
    where: { path },
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
    select: { label: true, sha256: true },
  });
  if (latest?.sha256 === file.sha256) return latest.label;
  const prefix = now.toISOString().slice(0, 10).replaceAll('-', '') + '-';
  const existing = await tx.snapshot.findMany({
    where: { path, label: { startsWith: prefix } },
    select: { label: true },
  });
  const label = nextLabel(
    existing.map((row) => row.label),
    now,
  );
  await tx.snapshot.create({
    data: {
      path,
      label,
      sha256: file.sha256,
      content: new Uint8Array(file.content),
      capturedAt: now,
    },
    select: { id: true },
  });
  return label;
}
