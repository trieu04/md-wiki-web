import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { Prisma, User } from '@prisma/client';
import { AppError } from '../common/app-error.js';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));
export const passwordHash = (value: string) =>
  hash(value, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const secret = () => randomBytes(32).toString('base64url');
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function base62(length: number) {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}
export function audit(
  tx: Prisma.TransactionClient,
  actor: Pick<User, 'id' | 'kind'> | null,
  action: string,
  subjectType: string,
  subjectId: string,
  data: Prisma.InputJsonObject = {},
) {
  return tx.auditEvent.create({
    data: {
      actorId: actor?.id ?? null,
      actorKind: actor?.kind ?? 'system',
      action,
      subjectType,
      subjectId,
      data,
    },
  });
}
export class LoginLimited extends AppError {
  constructor(readonly seconds: number) {
    super('RATE_LIMITED');
  }
}
