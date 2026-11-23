import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SectionKey } from './section-evidence.js';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Distinct teams with an active (not withdrawn) *Used in practice* attestation on the given
 * section keys, plus purged aggregates (system-logic §7.7.4, §7.7.7), grouped by `group(key)`.
 * Team counts are reach data shown to readers ("used by 4 teams"); they never feed a label.
 */
export async function usedByTeams(
  db: Db,
  keys: readonly SectionKey[],
  group: (key: SectionKey) => string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!keys.length) return out;
  const tuple = Prisma.sql`unnest(${keys.map((k) => k.path)}::text[], ${keys.map((k) => k.anchor)}::text[], ${keys.map((k) => k.sectionHash)}::text[]) AS k(path, anchor, hash)`;
  const rows = await db.$queryRaw<{ path: string; anchor: string; sectionHash: string; team: string }[]>`
    SELECT DISTINCT a.path, a.anchor, a."sectionHash", a."teamId"::text AS team
    FROM "Attestation" a JOIN ${tuple} ON a.path = k.path AND a.anchor = k.anchor AND a."sectionHash" = k.hash
    WHERE a.kind = 'used' AND a."teamId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "AttestationEvent" e WHERE e."attestationId" = a.id AND e.status = 'withdrawn')
    UNION
    SELECT DISTINCT g.path, g.anchor, g."sectionHash", g."teamKey" AS team
    FROM "CredibilityAggregate" g JOIN ${tuple} ON g.path = k.path AND g.anchor = k.anchor AND g."sectionHash" = k.hash
    WHERE g.metric = 'used' AND g."teamKey" <> '' AND g.count > 0`;
  const teams = new Map<string, Set<string>>();
  for (const r of rows) {
    const g = group(r);
    teams.set(g, (teams.get(g) ?? new Set()).add(r.team));
  }
  for (const key of keys) out.set(group(key), teams.get(group(key))?.size ?? 0);
  return out;
}
