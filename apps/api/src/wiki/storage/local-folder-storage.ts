import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { validateWikiPath, type WikiPath } from '@md-wiki/domain';
import { AppError } from '../../common/app-error.js';
import {
  byPath,
  ConditionalStorage,
  sha256,
  type WikiItem,
  type WriteReceipt,
} from './wiki-storage.js';

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
async function io<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('STORAGE_ERROR');
  }
}
async function syncDirectory(path: string) {
  const dir = await fs.open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
async function durableFile(path: string, bytes: Buffer) {
  const file = await fs.open(path, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

export class LocalFolderStorage extends ConditionalStorage {
  constructor(private readonly root: string) {
    super();
  }
  protected lockKey(): Promise<string> {
    return io(async () => {
      await fs.mkdir(this.root, { recursive: true });
      return fs.realpath(this.root);
    });
  }

  // Resolve each existing ancestor before creating the next directory. Checking
  // only the completed target misses writes through a symlink to a missing file.
  private async resolve(root: string, name: string, createParents = false): Promise<string> {
    const parts = name.split('/');
    let current = root;
    for (const [i, part] of parts.entries()) {
      const parent = current;
      current = join(parent, part);
      const info = await fs.lstat(current).catch((error: unknown) => {
        if (missing(error)) return null;
        throw error;
      });
      if (info?.isSymbolicLink()) {
        current = await fs.realpath(current).catch(() => {
          throw new AppError('INVALID_PATH', 'TRAVERSAL');
        });
        const rel = relative(root, current);
        if (
          rel === '..' ||
          rel.startsWith(`..${sep}`) ||
          rel.split(sep).some((s) => s.startsWith('.')) ||
          parts[0] === '.wiki-system'
        )
          throw new AppError('INVALID_PATH', 'TRAVERSAL');
      } else if (!info && createParents && i < parts.length - 1) {
        await fs.mkdir(current);
        await syncDirectory(parent);
      }
    }
    return current;
  }
  private async bytes(path: WikiPath) {
    const root = await this.lockKey();
    const target = await this.resolve(root, path.path);
    const file = await fs
      .open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      .catch((error: unknown) => {
        if (missing(error)) throw new AppError('NOT_FOUND');
        throw error;
      });
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new AppError('STORAGE_ERROR');
      return { content: await file.readFile(), mtime: stat.mtime };
    } finally {
      await file.close();
    }
  }
  protected readRaw(path: WikiPath) {
    return io(async () => {
      const { content, mtime } = await this.bytes(path);
      return { path, content, mtime, sha256: sha256(content) };
    });
  }
  async list(prefix = ''): Promise<WikiItem[]> {
    return io(async () => {
      const root = await this.lockKey();
      const items: WikiItem[] = [];
      const visit = async (dir: string, parent: string, ancestors: Set<string>) => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue;
          const name = parent + entry.name;
          const target = await this.resolve(root, name);
          const info = entry.isSymbolicLink() ? await fs.stat(target) : entry;
          if (info.isDirectory() && !ancestors.has(target) && validateWikiPath(`${name}/a.md`).ok) {
            await visit(target, name + '/', new Set([...ancestors, target]));
          } else if (info.isFile() && name.startsWith(prefix)) {
            const path = validateWikiPath(name);
            if (!path.ok) continue;
            const { content, sha256, mtime } = await this.read(path.value);
            items.push({ path: path.value, size: content.length, sha256, mtime });
          }
        }
      };
      await visit(root, '', new Set([root]));
      return items.sort(byPath);
    });
  }
  protected install(path: WikiPath, bytes: Buffer): Promise<void> {
    return io(async () => {
      const root = await this.lockKey();
      const target = await this.resolve(root, path.path, true);
      const temp = await this.resolve(root, `.wiki-system/tmp/${randomUUID()}`, true);
      try {
        await durableFile(temp, bytes);
        await fs.rename(temp, target);
      } finally {
        await fs.rm(temp, { force: true });
      }
      await syncDirectory(dirname(target));
    });
  }
  protected record(receipt: WriteReceipt, meta: Record<string, string>): Promise<void> {
    return io(async () => {
      const target = await this.resolve(await this.lockKey(), receipt.receiptPath, true);
      await durableFile(target, Buffer.from(JSON.stringify({ ...receipt, meta })));
      await syncDirectory(dirname(target));
    });
  }
}
