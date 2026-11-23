/** Proposal slugs (D-6, D-61). Same grammar as the status-block `proposal` key. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;
const BASE_MAX = 60;
const TITLE_MAX = 80;

export function isSlug(value: string): boolean {
  return value.length <= SLUG_MAX && SLUG_PATTERN.test(value);
}

export function slugify(title: string): string {
  const kebab = title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!kebab) return 'suggestion';
  if (kebab.length <= BASE_MAX) return kebab;
  const cut = kebab.slice(0, BASE_MAX + 1);
  const hyphen = cut.lastIndexOf('-');
  return (hyphen > 0 ? cut.slice(0, hyphen) : kebab.slice(0, BASE_MAX)).replace(/-+$/, '');
}

/** Attempt 1 is the base slug, then `-2`, `-3`, … */
export function slugCandidate(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${String(attempt)}`;
}

export function deriveTitle(reason: string): string {
  const line =
    reason
      .split(/\r\n|\r|\n/)
      .map((part) => part.trim())
      .find(Boolean) ?? '';
  const chars = Array.from(line);
  if (chars.length <= TITLE_MAX) return line;
  const head = chars.slice(0, TITLE_MAX - 1).join('');
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** The explicit title when non-blank, else one derived from the reason. */
export function proposalTitle(title: string | null | undefined, reason: string): string {
  return title?.trim() ? title.trim() : deriveTitle(reason);
}
