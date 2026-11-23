import { err, ok, type Result } from './result.js';

export type StrictJsonError = 'INVALID_JSON' | 'DUPLICATE_KEY';

const token = /"(?:[^"\\]|\\.)*"|[{}[\],:]/g;

/**
 * JSON.parse keeps the last of two equal keys. Bundles are frozen bytes: reject
 * any repeated key at any depth (md-wiki `pairs`).
 */
export function parseStrictJson(text: string): Result<unknown, StrictJsonError> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err('INVALID_JSON');
  }
  // The text is valid JSON, so strings and punctuation are the only tokens that matter.
  const stack: ({ keys: Set<string>; expectKey: boolean } | null)[] = [];
  for (const [match] of text.matchAll(token)) {
    const top = stack.at(-1);
    switch (match) {
      case '{':
        stack.push({ keys: new Set(), expectKey: true });
        break;
      case '[':
        stack.push(null);
        break;
      case '}':
      case ']':
        stack.pop();
        break;
      case ',':
        if (top) top.expectKey = true;
        break;
      case ':':
        break;
      default:
        if (top?.expectKey) {
          const key = JSON.parse(match) as string;
          if (top.keys.has(key)) return err('DUPLICATE_KEY');
          top.keys.add(key);
          top.expectKey = false;
        }
    }
  }
  return ok(value);
}
