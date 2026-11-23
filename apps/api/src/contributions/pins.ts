import { createHash } from 'node:crypto';
import type { BundleIssue } from '@md-wiki/domain';
import { Prisma } from '@prisma/client';
import { AppError, type FieldProblem } from '../common/app-error.js';

/** A pinned, registered snapshot (system-logic §7.2.4). */
export interface Pin {
  path: string;
  snapshotId: string;
  versionLabel: string;
  sha256: string;
}
export interface StoredSource extends Pin {
  addedAt: string;
}
export interface DraftScope {
  section: string | null;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function invalid(path: string, code: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, [{ path, code, message }]);
}

/** BundleIssue → problem (system-logic §7.2.2). */
export function bundleError(issue: BundleIssue): AppError {
  if (issue.code === 'TOO_LARGE') return new AppError('PAYLOAD_TOO_LARGE', issue.message);
  if (issue.code === 'INVALID_TARGET') return new AppError('INVALID_PATH', issue.message);
  return invalid('bundle', issue.code, issue.message);
}

export function sourceChanged(fields: FieldProblem[]): AppError {
  return new AppError('SOURCE_CHANGED', 'A pinned file changed since it was read', fields);
}

export const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Keyset cursor `<epoch ms>.<uuid>` over (time desc, id desc). */
export function encodeCursor(at: Date, id: string): string {
  return `${String(at.getTime())}.${id}`;
}
export function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (cursor === undefined) return null;
  const match = /^(\d{1,15})\.([0-9a-f-]{36})$/i.exec(cursor);
  if (!match?.[1] || !match[2]) throw invalid('cursor', 'cursor', 'Invalid cursor');
  return { at: new Date(Number(match[1])), id: match[2] };
}

/** `If-Match: "<updatedAt ISO>"`, quotes and a weak prefix optional. */
export function ifMatch(header: string | undefined): Date {
  const value = header
    ?.trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1');
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString() !== value)
    throw invalid('If-Match', 'if_match', 'If-Match must carry the draft updatedAt');
  return date;
}
