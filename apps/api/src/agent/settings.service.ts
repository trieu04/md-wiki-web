import { Inject, Injectable } from '@nestjs/common';
import {
  checkTriggerConfig,
  customTriggerId,
  DEFAULT_TRIGGERS,
  OPTIONAL_TRIGGERS,
  OWNERS_PATH,
  TRIGGER_TEXT,
} from '@md-wiki/domain';
import type { Prisma, ReviewSettings } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit, sha256 } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { logger } from '../common/request-id.middleware.js';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { userRef } from '../review/views.js';
import type { Wire } from '../wiki/read.dto.js';
import { agentFacts, settingsOf, triggerConfigOf } from './agent-facts.js';
import type { AgentPauseInput, ReviewSettingsDto, ReviewSettingsInput } from './agent.dto.js';
import { ownersFile } from './page-authors.js';

export const SEEDED_TOKEN_NAME = 'reviewer-agent (seeded)';
const userSelect = { id: true, name: true, kind: true } as const;

/** Settings › Review, the stop switch and the reviewer agent's identity (system-logic §7.8.2). */
@Injectable()
export class ReviewSettingsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /**
   * Boot (D-200): the reviewer agent user (kind agent, role reviewer) and, when
   * REVIEWER_AGENT_TOKEN is set, its token (scopes read, discuss, review) stored as a hash.
   * A new token value revokes the previously seeded one. An AUTO_PUBLISH change since the last
   * boot is audited (D-211).
   */
  async seed(): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await settingsOf(tx);
      await tx.$queryRaw`SELECT id FROM "ReviewSettings" WHERE id = 1 FOR UPDATE`;
      const s = await settingsOf(tx);
      const email = this.config.REVIEWER_AGENT_EMAIL.toLowerCase();
      let agent = s.reviewerAgentId
        ? await tx.user.findUnique({ where: { id: s.reviewerAgentId } })
        : null;
      if (!agent) {
        agent = await tx.user.findUnique({ where: { email } });
        if (agent && agent.kind !== 'agent')
          throw new Error('REVIEWER_AGENT_EMAIL belongs to a human account');
        if (!agent) {
          agent = await tx.user.create({
            data: { email, name: 'Reviewer agent', kind: 'agent', roles: ['reviewer'] },
          });
          await audit(tx, null, 'user.created', 'user', agent.id, { seeded: 'reviewer_agent' });
        }
        await tx.reviewSettings.update({ where: { id: 1 }, data: { reviewerAgentId: agent.id } });
      }
      const token = this.config.REVIEWER_AGENT_TOKEN;
      if (token) {
        const prefix = token.slice(4, 12);
        const existing = await tx.apiToken.findUnique({ where: { prefix } });
        if (existing && (existing.userId !== agent.id || existing.tokenHash !== sha256(token)))
          throw new Error('REVIEWER_AGENT_TOKEN collides with another token');
        if (existing?.revokedAt)
          logger.warn('REVIEWER_AGENT_TOKEN was revoked by an owner; the agent stays unavailable');
        if (!existing) {
          const old = await tx.apiToken.findMany({
            where: { userId: agent.id, name: SEEDED_TOKEN_NAME, revokedAt: null },
            select: { id: true },
          });
          const now = new Date();
          for (const o of old) {
            await tx.apiToken.update({ where: { id: o.id }, data: { revokedAt: now } });
            await audit(tx, null, 'token.revoked', 'token', o.id, { seeded: 'reviewer_agent' });
          }
          const row = await tx.apiToken.create({
            data: {
              userId: agent.id,
              name: SEEDED_TOKEN_NAME,
              prefix,
              tokenHash: sha256(token),
              scopes: ['read', 'discuss', 'review'],
            },
          });
          await audit(tx, null, 'token.created', 'token', row.id, { seeded: 'reviewer_agent' });
        }
      }
      if (s.autoPublishSeen !== this.config.AUTO_PUBLISH) {
        if (s.autoPublishSeen !== null)
          await audit(tx, null, 'review.auto_publish_changed', 'settings', 'review', {
            autoPublish: this.config.AUTO_PUBLISH,
          });
        await tx.reviewSettings.update({
          where: { id: 1 },
          data: { autoPublishSeen: this.config.AUTO_PUBLISH },
        });
      }
    });
  }

  get(db: Prisma.TransactionClient = this.db): Promise<ReviewSettings> {
    return settingsOf(db);
  }

  async dto(): Promise<Wire<ReviewSettingsDto>> {
    const s = await settingsOf(this.db);
    const facts = await agentFacts(this.db, s);
    const people = await this.db.user.findMany({
      where: {
        id: { in: [s.reviewerAgentId, s.pausedById, s.updatedById].filter((x) => x !== null) },
      },
      select: userSelect,
    });
    const ref = (id: string | null) => {
      const u = people.find((p) => p.id === id);
      return u ? userRef(u) : null;
    };
    const owners = await ownersFile(this.db);
    const config = triggerConfigOf(s);
    return {
      reviewModel: s.reviewModel,
      autoPublish: this.config.AUTO_PUBLISH,
      agent: {
        user: ref(s.reviewerAgentId),
        available: facts.agent?.available ?? false,
        tokenConfigured: this.config.REVIEWER_AGENT_TOKEN !== undefined,
        paused: s.agentPaused,
        pausedAt: s.pausedAt?.toISOString() ?? null,
        pausedBy: ref(s.pausedById),
        pauseReason: s.pauseReason,
      },
      triggers: [
        ...DEFAULT_TRIGGERS.map((id) => ({
          id,
          ...TRIGGER_TEXT[id],
          source: 'default' as const,
          enabled: id === 'agent_edits_human_pages' ? config.agentEditsHumanPages : true,
          optional: OPTIONAL_TRIGGERS.includes(id),
          match: null,
        })),
        ...config.custom.map((c) => ({
          id: customTriggerId(c.id),
          title: c.reason,
          description:
            c.kind === 'path' ? `Pages matching ${c.value}` : `Changes that add “${c.value}”`,
          source: 'custom' as const,
          enabled: true,
          optional: true,
          match: { kind: c.kind, value: c.value },
        })),
      ],
      pageAuthors: {
        order: ['owners_file', 'published_authors', 'owner'],
        ownersFile: {
          path: OWNERS_PATH,
          versionLabel: owners.versionLabel,
          rules: owners.file.rules.length,
          warnings: owners.file.warnings,
        },
      },
      spotCheckRate: s.spotCheckRate,
      reminderDays: s.reminderDays,
      qualityCheck: { onSubmit: true, rulesPath: this.config.QUALITY_RULES_PATH },
      updatedAt: s.updatedAt?.toISOString() ?? null,
      updatedBy: ref(s.updatedById),
    };
  }

  /** PATCH (D-202): the shape cannot weaken the defaults; only the optional one toggles. */
  async update(identity: Identity, input: ReviewSettingsInput) {
    if (input.customTriggers) {
      const problem = checkTriggerConfig(input.customTriggers);
      if (problem)
        throw new AppError('VALIDATION_FAILED', undefined, [
          {
            path: `customTriggers.${String(problem.index)}.${problem.field}`,
            code: 'invalid',
            message: problem.message,
          },
        ]);
    }
    const data: Prisma.ReviewSettingsUpdateInput = {
      ...(input.reviewModel !== undefined && { reviewModel: input.reviewModel }),
      ...(input.spotCheckRate !== undefined && { spotCheckRate: input.spotCheckRate }),
      ...(input.reminderDays !== undefined && { reminderDays: input.reminderDays }),
      ...(input.agentEditsHumanPages !== undefined && {
        agentEditsHumanPages: input.agentEditsHumanPages,
      }),
      ...(input.customTriggers !== undefined && {
        customTriggers: input.customTriggers.map((c) => ({
          id: c.id,
          kind: c.kind,
          value: c.value,
          reason: c.reason,
        })),
      }),
    };
    const changed = Object.keys(data);
    if (changed.length)
      await this.db.$transaction(async (tx) => {
        await settingsOf(tx);
        await tx.reviewSettings.update({
          where: { id: 1 },
          data: { ...data, updatedAt: new Date(), updatedById: identity.user.id },
        });
        await audit(tx, identity.user, 'review.settings_updated', 'settings', 'review', {
          changed,
          ...(JSON.parse(JSON.stringify(input)) as Prisma.InputJsonObject),
        });
      });
    return this.dto();
  }

  /** The stop switch (D-211). Returns whether the state changed. */
  async setPaused(identity: Identity, input: AgentPauseInput): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      await settingsOf(tx);
      await tx.$queryRaw`SELECT id FROM "ReviewSettings" WHERE id = 1 FOR UPDATE`;
      const s = await settingsOf(tx);
      if (s.agentPaused === input.paused) return false;
      await tx.reviewSettings.update({
        where: { id: 1 },
        data: input.paused
          ? {
              agentPaused: true,
              pausedAt: new Date(),
              pausedById: identity.user.id,
              pauseReason: input.reason || null,
            }
          : { agentPaused: false, pausedAt: null, pausedById: null, pauseReason: null },
      });
      await audit(
        tx,
        identity.user,
        input.paused ? 'agent.paused' : 'agent.resumed',
        'settings',
        'review',
        { reason: input.reason ?? null },
      );
      return true;
    });
  }
}
