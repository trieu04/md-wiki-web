/* eslint-disable @typescript-eslint/require-await -- The in-memory adapter implements an asynchronous port, including rejected promises on faults. */
import type { WikiPath } from '@md-wiki/domain';
import { AppError } from '../../common/app-error.js';
import {
  byPath,
  ConditionalStorage,
  sha256,
  type ReadResult,
  type WriteReceipt,
} from './wiki-storage.js';

export type StorageFault = 'beforeRename' | 'afterRename' | 'beforeVerify' | 'receipt';
export class FixtureStorage extends ConditionalStorage {
  private readonly key = Symbol();
  private readonly files = new Map<string, ReadResult>();
  readonly receipts = new Map<string, WriteReceipt & { meta: Record<string, string> }>();
  constructor(public fault?: StorageFault) {
    super();
  }
  private take(fault: StorageFault): boolean {
    if (this.fault !== fault) return false;
    this.fault = undefined;
    return true;
  }
  protected async lockKey() {
    return this.key;
  }
  async list(prefix = '') {
    return [...this.files.values()]
      .filter((row) => row.path.path.startsWith(prefix))
      .map((row) => ({
        path: { ...row.path },
        size: row.content.length,
        sha256: row.sha256,
        mtime: new Date(row.mtime),
      }))
      .sort(byPath);
  }
  protected async readRaw(path: WikiPath) {
    const row = this.files.get(path.path);
    if (!row) throw new AppError('NOT_FOUND');
    return { ...row, path, content: Buffer.from(row.content), mtime: new Date(row.mtime) };
  }
  protected async install(path: WikiPath, content: Buffer) {
    if (this.take('beforeRename')) throw new AppError('STORAGE_ERROR');
    this.files.set(path.path, {
      path: { ...path },
      content,
      sha256: sha256(content),
      mtime: new Date(),
    });
    if (this.take('afterRename')) throw new AppError('STORAGE_ERROR');
  }
  protected async verifyHash(path: WikiPath) {
    const row = await this.readRaw(path);
    return this.take('beforeVerify')
      ? sha256(Buffer.concat([row.content, Buffer.from([0])]))
      : row.sha256;
  }
  protected async record(receipt: WriteReceipt, meta: Record<string, string>) {
    if (this.take('receipt')) throw new AppError('STORAGE_ERROR');
    this.receipts.set(receipt.id, structuredClone({ ...receipt, meta }));
  }
}
