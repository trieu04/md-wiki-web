import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { validateWikiPath, type WikiPath } from '@md-wiki/domain';
import { AppError } from '../../common/app-error.js';

export interface WikiItem {
  path: WikiPath;
  size: number;
  mtime: Date;
  sha256: string;
}
export interface ReadResult {
  path: WikiPath;
  content: Buffer;
  sha256: string;
  mtime: Date;
}
export type WriteCondition = { kind: 'create' } | { kind: 'replace'; expectedSha256: string };
export interface WriteReceipt {
  id: string;
  path: WikiPath;
  beforeSha256: string | null;
  afterSha256: string;
  writtenAt: Date;
  receiptPath: string;
}
export interface WikiStorage {
  list(prefix?: string): Promise<WikiItem[]>;
  read(path: WikiPath): Promise<ReadResult>;
  write(
    path: WikiPath,
    content: Buffer,
    cond: WriteCondition,
    meta: Record<string, string>,
  ): Promise<WriteReceipt>;
  withRootLock<T>(fn: () => Promise<T>): Promise<T>;
}
export function wikiPath(value: string): WikiPath {
  const result = validateWikiPath(value);
  if (!result.ok) throw new AppError('INVALID_PATH', result.error);
  return result.value;
}
export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function decodeMarkdown(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new AppError('STORAGE_ERROR', 'Invalid UTF-8');
  }
}

// One writer (the API), potentially multiple adapters for the same root. Allow a
// publish to take the lock around both the conditional write and its indexing.
const tails = new Map<string | symbol, Promise<void>>();
const owner = new AsyncLocalStorage<{ key: string | symbol; nested: symbol; active: boolean }>();
async function underLock<T>(key: string | symbol, fn: () => Promise<T>): Promise<T> {
  const current = owner.getStore();
  // Nested callers share a separate queue: they needn't wait on their own
  // outer lock, but two writes started together inside it still serialize.
  const queue = current?.key === key && current.active ? current.nested : key;
  const previous = tails.get(queue);
  let release!: () => void;
  const next = new Promise<void>((done) => {
    release = done;
  });
  tails.set(queue, next);
  await previous;
  const token = { key, nested: Symbol(), active: true };
  try {
    return await owner.run(token, fn);
  } finally {
    token.active = false;
    release();
    if (tails.get(queue) === next) tails.delete(queue);
  }
}
export abstract class ConditionalStorage implements WikiStorage {
  protected abstract lockKey(): Promise<string | symbol>;
  abstract list(prefix?: string): Promise<WikiItem[]>;
  protected abstract readRaw(path: WikiPath): Promise<ReadResult>;
  async read(input: WikiPath): Promise<ReadResult> {
    const row = await this.readRaw(wikiPath(input.path));
    decodeMarkdown(row.content);
    return row;
  }
  protected abstract install(path: WikiPath, bytes: Buffer): Promise<void>;
  protected abstract record(receipt: WriteReceipt, meta: Record<string, string>): Promise<void>;
  protected async verifyHash(path: WikiPath): Promise<string> {
    return (await this.readRaw(path)).sha256;
  }
  async withRootLock<T>(fn: () => Promise<T>): Promise<T> {
    return underLock(await this.lockKey(), fn);
  }
  async write(
    input: WikiPath,
    content: Buffer,
    cond: WriteCondition,
    meta: Record<string, string>,
  ): Promise<WriteReceipt> {
    const path = wikiPath(input.path);
    const bytes = Buffer.from(content);
    decodeMarkdown(bytes);
    return this.withRootLock(async () => {
      let beforeSha256: string | null = null;
      try {
        beforeSha256 = (await this.readRaw(path)).sha256;
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'NOT_FOUND')) throw error;
      }
      if (cond.kind === 'create' && beforeSha256 !== null) throw new AppError('ALREADY_EXISTS');
      if (cond.kind === 'replace' && beforeSha256 !== cond.expectedSha256)
        throw new AppError('PRECONDITION_FAILED');
      const afterSha256 = sha256(bytes);
      await this.install(path, bytes);
      if ((await this.verifyHash(path)) !== afterSha256) throw new AppError('VERIFY_FAILED');
      const writtenAt = new Date();
      const day = writtenAt.toISOString().slice(0, 10).replaceAll('-', '');
      const id = randomUUID();
      const receipt = {
        id,
        path,
        beforeSha256,
        afterSha256,
        writtenAt,
        receiptPath: `.wiki-system/receipts/${day}/${id}.json`,
      };
      await this.record(receipt, meta);
      return receipt;
    });
  }
}
export function byPath(a: WikiItem, b: WikiItem): number {
  return a.path.path < b.path.path ? -1 : a.path.path > b.path.path ? 1 : 0;
}
