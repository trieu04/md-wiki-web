import { Inject, Injectable } from '@nestjs/common';
import {
  GATE_CAPABILITIES,
  GATE_DESCRIPTION,
  GATE_EXPERIMENT,
  validateGateChange,
  type GateCapability,
} from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import type { CredibilityGateDto, CredibilityGatesDto, GateInput } from './credibility.dto.js';

type Db = Prisma.TransactionClient | PrismaService;
const isCapability = (c: string): c is GateCapability =>
  (GATE_CAPABILITIES as readonly string[]).includes(c);

/** Experiment gates (system-logic §7.7.10, D-177): stored and validated; consumers are inert. */
@Injectable()
export class CredibilityGates {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async enabled(capability: GateCapability, db: Db = this.db): Promise<boolean> {
    return (await db.credibilityGate.findUnique({ where: { capability } }))?.enabled ?? false;
  }

  async list(): Promise<Wire<CredibilityGatesDto>> {
    const rows = await this.db.credibilityGate.findMany();
    const actors = await this.db.user.findMany({
      where: { id: { in: rows.flatMap((r) => (r.actorId ? [r.actorId] : [])) } },
      select: { id: true, name: true, kind: true },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return {
      items: GATE_CAPABILITIES.map((capability): Wire<CredibilityGateDto> => {
        const row = rows.find((r) => r.capability === capability);
        const actor = row?.actorId ? byId.get(row.actorId) : undefined;
        return {
          capability,
          experiment: GATE_EXPERIMENT[capability],
          enabled: row?.enabled ?? false,
          reference:
            row?.runRecord && row.runDate ? { runRecord: row.runRecord, runDate: row.runDate } : null,
          updatedAt: row ? row.updatedAt.toISOString() : null,
          updatedBy: actor ? { id: actor.id, name: actor.name, kind: actor.kind } : null,
          description: GATE_DESCRIPTION[capability],
        };
      }),
    };
  }

  async set(identity: Identity, capability: string, input: GateInput, now = new Date()) {
    if (!isCapability(capability)) throw new AppError('NOT_FOUND', 'Unknown capability');
    const issues = validateGateChange(input, now);
    if (issues.length) throw new AppError('VALIDATION_FAILED', undefined, issues);
    const runRecord = input.enabled ? (input.runRecord?.trim() ?? null) : undefined;
    const runDate = input.enabled ? (input.runDate ?? null) : undefined;
    await this.db.$transaction(async (tx) => {
      await tx.credibilityGate.upsert({
        where: { capability },
        create: {
          capability,
          enabled: input.enabled,
          runRecord: runRecord ?? null,
          runDate: runDate ?? null,
          actorId: identity.user.id,
          updatedAt: now,
        },
        update: {
          enabled: input.enabled,
          ...(input.enabled ? { runRecord: runRecord ?? null, runDate: runDate ?? null } : {}),
          actorId: identity.user.id,
          updatedAt: now,
        },
      });
      await audit(tx, identity.user, 'credibility.gate_changed', 'gate', capability, {
        capability,
        enabled: input.enabled,
        runRecord: runRecord ?? null,
        runDate: runDate ?? null,
      });
    });
    const dto = (await this.list()).items.find((g) => g.capability === capability);
    if (!dto) throw new AppError('INTERNAL');
    return dto;
  }
}
