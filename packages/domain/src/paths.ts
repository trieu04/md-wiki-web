import { err, ok, type Result } from './result.js';

export interface WikiPath {
  readonly path: string;
  readonly isMeta: boolean;
}

export type PathError =
  | 'ABSOLUTE'
  | 'TRAVERSAL'
  | 'EMPTY_SEGMENT'
  | 'NOT_PORTABLE'
  | 'NOT_MARKDOWN'
  | 'TOO_LONG'
  | 'TOO_DEEP'
  | 'RESERVED_PATH';

const portableName = /^[a-z0-9][a-z0-9_-]*$/;
const utf8 = new TextEncoder();

export function validateWikiPath(p: string): Result<WikiPath, PathError> {
  if (p.startsWith('/')) return err('ABSOLUTE');
  if (p.includes('\\') || p.includes('\0')) return err('NOT_PORTABLE');
  if (utf8.encode(p).length > 200) return err('TOO_LONG');
  const parts = p.split('/');
  if (parts.includes('')) return err('EMPTY_SEGMENT');
  if (parts.some((part) => part === '.' || part === '..')) return err('TRAVERSAL');
  if (parts.some((part) => part.startsWith('.'))) return err('RESERVED_PATH');
  if (parts.length > 8) return err('TOO_DEEP');
  const file = parts.pop();
  if (!file?.endsWith('.md')) return err('NOT_MARKDOWN');
  if (![...parts, file.slice(0, -3)].every((part) => portableName.test(part))) {
    return err('NOT_PORTABLE');
  }
  return ok({ path: p, isMeta: parts[0] === 'wiki-meta' });
}
