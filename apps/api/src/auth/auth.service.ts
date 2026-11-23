import { Inject, Injectable } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import type { Scope } from '@prisma/client';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { audit, equal, LoginLimited, passwordHash, secret, sha256 } from './credentials.js';
import { me, type LoginInput } from './identity.dto.js';

const day = 86400000;
const windowMs = 15 * 60000;
export const sessionLifetime = 30 * day;
export type Identity = { user: ReturnType<typeof me> } & (
  { kind: 'session'; id: string; csrfToken: string } | { kind: 'token'; scopes: Scope[] }
);
export type AuthRequest = Request & { identity?: Identity };

@Injectable()
export class AuthService {
  private dummy?: Promise<string>;
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async seedOwner() {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`;
      if (await tx.user.count({ where: { roles: { has: 'owner' } } })) return;
      const user = await tx.user.create({
        data: {
          email: this.config.OWNER_EMAIL.toLowerCase(),
          name: 'Owner',
          roles: ['owner'],
          kind: 'human',
          passwordHash: await passwordHash(this.config.OWNER_PASSWORD),
        },
      });
      await audit(tx, null, 'user.created', 'user', user.id);
    });
  }

  async login(input: LoginInput, ip: string, userAgent: string) {
    const email = input.email.toLowerCase();
    const bucket = sha256(JSON.stringify([email, ip]));
    // Serialize attempts for this pair across all API processes. Failed audit records
    // commit before the error is raised and double as the rolling-window ledger.
    const result = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucket},0))`;
      const now = Date.now();
      const failed = await tx.auditEvent.findMany({
        where: {
          action: 'auth.login_failed',
          subjectId: bucket,
          at: { gt: new Date(now - windowMs) },
        },
        orderBy: { at: 'desc' },
        take: 5,
        select: { at: true },
      });
      if (failed[4])
        throw new LoginLimited(
          Math.max(1, Math.ceil((failed[4].at.getTime() + windowMs - now) / 1000)),
        );
      // Keep password/disabled changes and session creation ordered.
      await tx.$queryRaw`SELECT id FROM "User" WHERE email = ${email}::public.citext FOR SHARE`;
      const user = await tx.user.findUnique({ where: { email } });
      const stored = user?.passwordHash ?? (await (this.dummy ??= passwordHash(secret())));
      const matches = await verify(stored, input.password);
      if (!matches || !user?.passwordHash || user.disabledAt) {
        await audit(tx, null, 'auth.login_failed', 'login', bucket);
        return {
          error: matches && user?.disabledAt ? 'ACCOUNT_DISABLED' : 'INVALID_CREDENTIALS',
        } as const;
      }
      const cookie = secret(),
        csrfToken = secret();
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: sha256(cookie),
          csrfToken,
          ip,
          userAgent,
          lastSeenAt: new Date(now),
          expiresAt: new Date(now + sessionLifetime),
        },
      });
      await audit(tx, user, 'auth.login', 'user', user.id);
      return { cookie, body: { user: me(user), csrfToken } };
    });
    if (result.error) throw new AppError(result.error);
    return result;
  }

  async bearer(header: string): Promise<Identity> {
    const value = header.replace(/^Bearer +/i, '');
    const match = /^mwt_([A-Za-z0-9]{8})_[A-Za-z0-9]{32}$/.exec(value);
    if (!match?.[1] || value === header) throw new AppError('UNAUTHENTICATED');
    const t = await this.db.apiToken.findUnique({
      where: { prefix: match[1] },
      include: { user: true },
    });
    if (
      !t ||
      !equal(t.tokenHash, sha256(value)) ||
      t.revokedAt ||
      (t.expiresAt && t.expiresAt.getTime() <= Date.now())
    )
      throw new AppError('UNAUTHENTICATED');
    if (t.user.disabledAt) throw new AppError('ACCOUNT_DISABLED');
    await this.db.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } });
    return { kind: 'token', scopes: t.scopes, user: me(t.user) };
  }
  async session(cookie: string): Promise<Identity | undefined> {
    const row = await this.db.session.findUnique({
      where: { tokenHash: sha256(cookie) },
      include: { user: true },
    });
    if (!row) return;
    const now = Date.now();
    if (row.expiresAt.getTime() <= now || row.lastSeenAt.getTime() <= now - 7 * day) {
      await this.db.session.deleteMany({ where: { id: row.id } });
      return;
    }
    if (row.user.disabledAt) throw new AppError('ACCOUNT_DISABLED');
    const touched = await this.db.session.updateMany({
      where: { id: row.id },
      data: { lastSeenAt: new Date(now) },
    });
    if (!touched.count) return;
    return { kind: 'session', id: row.id, csrfToken: row.csrfToken, user: me(row.user) };
  }
  async logout(identity: Identity | undefined) {
    if (identity?.kind !== 'session') throw new AppError('UNAUTHENTICATED');
    await this.db.session.deleteMany({ where: { id: identity.id } });
  }
}
