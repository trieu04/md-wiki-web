import { Inject, Injectable } from '@nestjs/common';
import { roleAllowsScope } from '@md-wiki/domain';
import { Prisma, type User } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { audit, base62, passwordHash, sha256 } from './credentials.js';
import {
  userDto,
  type CreateUserInput,
  type PageInput,
  type TeamInput,
  type TokenInput,
  type UpdateUserInput,
} from './identity.dto.js';

type AuditActor = Pick<User, 'kind' | 'id'>;

function pageArgs({ cursor, limit = 25 }: PageInput) {
  return {
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    take: limit + 1,
  };
}
function page<T extends { id: string }>(rows: T[], { limit = 25 }: PageInput) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}
const teamSelect = { id: true, name: true, slug: true };
const tokenSelect = {
  id: true,
  userId: true,
  name: true,
  prefix: true,
  scopes: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
};
function invalid(path: string, message: string) {
  return new AppError('VALIDATION_FAILED', undefined, [{ path, code: 'invalid', message }]);
}
async function userMutation<T>(write: () => Promise<T>) {
  try {
    return await write();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new AppError('EMAIL_TAKEN');
      if (error.code === 'P2003') throw invalid('teamId', 'Unknown team');
    }
    throw error;
  }
}
@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async users(query: PageInput) {
    return page((await this.db.user.findMany(pageArgs(query))).map(userDto), query);
  }
  async teams(query: PageInput) {
    return page(await this.db.team.findMany({ ...pageArgs(query), select: teamSelect }), query);
  }
  async tokens(query: PageInput) {
    return page(
      await this.db.apiToken.findMany({ ...pageArgs(query), select: tokenSelect }),
      query,
    );
  }

  async createUser(actor: AuditActor, input: CreateUserInput) {
    const hash = input.password === undefined ? null : await passwordHash(input.password);
    return userMutation(() =>
      this.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email.toLowerCase(),
            name: input.name,
            roles: input.roles,
            teamId: input.teamId,
            kind: 'human',
            passwordHash: hash,
          },
        });
        await audit(tx, actor, 'user.created', 'user', user.id);
        return userDto(user);
      }),
    );
  }
  async updateUser(actor: AuditActor, id: string, input: UpdateUserInput) {
    const hash = input.password === undefined ? undefined : await passwordHash(input.password);
    return userMutation(() =>
      this.db.$transaction(async (tx) => {
        // Serialize owner-set changes, including two owners disabling one another.
        await tx.$executeRaw`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`;
        const current = await tx.user.findUnique({ where: { id } });
        if (!current) throw new AppError('NOT_FOUND');
        if (
          !current.disabledAt &&
          current.roles.includes('owner') &&
          (input.disabled || (input.roles && !input.roles.includes('owner')))
        ) {
          if (
            !(await tx.user.count({
              where: {
                id: { not: id },
                disabledAt: null,
                kind: 'human',
                passwordHash: { not: null },
                roles: { has: 'owner' },
              },
            }))
          )
            throw new AppError('LAST_OWNER');
        }
        const row = await tx.user.update({
          where: { id },
          data: {
            email: input.email?.toLowerCase() ?? current.email,
            name: input.name ?? current.name,
            roles: input.roles ?? current.roles,
            teamId: input.teamId === undefined ? current.teamId : input.teamId,
            passwordHash: hash ?? current.passwordHash,
            disabledAt:
              input.disabled === undefined
                ? current.disabledAt
                : input.disabled
                  ? (current.disabledAt ?? new Date())
                  : null,
          },
        });
        if (input.disabled) await tx.session.deleteMany({ where: { userId: id } });
        const before = userDto(current),
          after = userDto(row);
        const changedFields = (['email', 'name', 'roles', 'teamId', 'disabled'] as const).filter(
          (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
        );
        await audit(tx, actor, 'user.updated', 'user', id, {
          changedFields: hash ? [...changedFields, 'password'] : changedFields,
        });
        return after;
      }),
    );
  }
  async createTeam(actor: AuditActor, { name }: TeamInput) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "Team" IN SHARE ROW EXCLUSIVE MODE`;
      if (await tx.team.findUnique({ where: { name } })) throw new AppError('ALREADY_EXISTS');
      const stem =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'team';
      let slug = stem;
      for (let suffix = 2; await tx.team.findUnique({ where: { slug } }); suffix++)
        slug = `${stem}-${String(suffix)}`;
      const team = await tx.team.create({ data: { name, slug }, select: teamSelect });
      await audit(tx, actor, 'team.created', 'team', team.id);
      return team;
    });
  }
  async createToken(actor: AuditActor, input: TokenInput) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${input.userId}::uuid FOR SHARE`;
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (!user) throw new AppError('NOT_FOUND');
      if (input.scopes.some((s) => !roleAllowsScope(user.roles, s)))
        throw invalid('scopes', 'Scope exceeds target role');
      const prefix = base62(8),
        token = `mwt_${prefix}_${base62(32)}`;
      const row = await tx.apiToken.create({
        data: {
          userId: user.id,
          name: input.name,
          scopes: input.scopes,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          prefix,
          tokenHash: sha256(token),
        },
        select: tokenSelect,
      });
      await audit(tx, actor, 'token.created', 'token', row.id);
      return { ...row, token };
    });
  }
  async revokeToken(actor: AuditActor, id: string) {
    await this.db.$transaction(async (tx) => {
      const revoked = await tx.apiToken.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count) await audit(tx, actor, 'token.revoked', 'token', id);
      else if (!(await tx.apiToken.count({ where: { id } }))) throw new AppError('NOT_FOUND');
    });
  }
}
