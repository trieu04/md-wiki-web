import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parseStatusBlock } from './status-block.js';

/**
 * Page authors (system-logic §7.8.4, architecture.md › Self-managed review): the escalation
 * targets of a page. `wiki-meta/owners.md` (path patterns → people) first, else the humans whose
 * proposals on that page were published, else the owner. Agents are never targets and the
 * proposal's own author is excluded. Pure.
 */

export const OWNERS_PATH = 'wiki-meta/owners.md';
export const MAX_PAGE_AUTHORS = 10;

export interface OwnersRule {
  pattern: string;
  people: string[];
  /** 1-based row number in the table (for warnings). */
  row: number;
}
export interface OwnersFile {
  rules: OwnersRule[];
  warnings: string[];
}

const parser = unified().use(remarkParse).use(remarkGfm).freeze();
const PATH_KEYS = ['path', 'paths', 'pattern', 'page', 'pages'];
const PEOPLE_KEYS = ['authors', 'author', 'owners', 'owner', 'people', 'email', 'emails'];
const GLOB = /^[a-z0-9_\-./*]+$/;

/**
 * Parse every table that has a path column and an authors column. People are separated by
 * commas, semicolons or whitespace and compared case-blind (emails). Rows with a bad pattern or
 * no people are skipped with a warning; nothing throws.
 */
export function parseOwners(markdown: string): OwnersFile {
  const rules: OwnersRule[] = [];
  const warnings: string[] = [];
  let row = 0;
  for (const node of parser.parse(parseStatusBlock(markdown).body).children) {
    if (node.type !== 'table') continue;
    const [header, ...rows] = node.children;
    const keys = header?.children.map((cell) => toString(cell).trim().toLowerCase()) ?? [];
    const pathAt = keys.findIndex((k) => PATH_KEYS.includes(k));
    const peopleAt = keys.findIndex((k) => PEOPLE_KEYS.includes(k));
    if (pathAt < 0 || peopleAt < 0) continue;
    for (const r of rows) {
      row++;
      const cells = r.children.map((cell) => toString(cell).trim());
      const pattern = (cells[pathAt] ?? '').replace(/^\/+/, '');
      const people = [
        ...new Set(
          (cells[peopleAt] ?? '')
            .split(/[\s,;]+/)
            .map((p) => p.replace(/^@/, '').toLowerCase())
            .filter(Boolean),
        ),
      ];
      if (!pattern || !GLOB.test(pattern)) {
        warnings.push(`row ${String(row)}: invalid path pattern`);
        continue;
      }
      if (!people.length) {
        warnings.push(`row ${String(row)}: no authors`);
        continue;
      }
      rules.push({ pattern, people, row });
    }
  }
  return { rules, warnings };
}

/**
 * Glob over `/`-separated paths: `*` matches within one segment, `**` any number of segments,
 * a pattern ending in `/` matches everything below it, a bare folder name matches the folder.
 */
export function globMatch(pattern: string, path: string): boolean {
  let p = pattern.replace(/^\/+/, '');
  if (p.endsWith('/')) p += '**';
  if (!p.includes('*') && !p.endsWith('.md')) p += '/**';
  let re = '^';
  for (let i = 0; i < p.length; i++) {
    const c = p[i] ?? '';
    if (c === '*' && p[i + 1] === '*') {
      const slash = p[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${re}$`).test(path);
}

/** People of the last matching row (CODEOWNERS order, D-206); [] when no row matches. */
export function ownersOf(file: OwnersFile, path: string): string[] {
  let found: string[] = [];
  for (const rule of file.rules) if (globMatch(rule.pattern, path)) found = rule.people;
  return found;
}

export interface AuthorCandidate {
  id: string;
  email: string;
  kind: 'human' | 'agent';
  disabled: boolean;
  roles: readonly string[];
  createdAt: number;
}
export type AuthorSource = 'owners_file' | 'published_authors' | 'owner';
export interface PageAuthors {
  ids: string[];
  source: AuthorSource;
  /** Human authors from the file or published proposals (agent-edit trigger input). */
  humanAuthors: number;
}

/**
 * Resolve page authors (D-206). `listed` = emails from `ownersOf`, `published` = submitter ids
 * of published proposals on the page, most recent first. Only enabled humans count; the
 * submitter is excluded. Nobody left → the first enabled human owner (by age) who is not the
 * submitter; no such owner → nobody.
 */
export function resolvePageAuthors(input: {
  listed: readonly string[];
  published: readonly string[];
  users: readonly AuthorCandidate[];
  submitterId: string;
}): PageAuthors {
  const usable = (u: AuthorCandidate | undefined): u is AuthorCandidate =>
    u !== undefined && u.kind === 'human' && !u.disabled;
  const byEmail = new Map(input.users.map((u) => [u.email.toLowerCase(), u]));
  const byId = new Map(input.users.map((u) => [u.id, u]));
  const listed = input.listed.map((e) => byEmail.get(e.toLowerCase())).filter(usable);
  const published = [...new Set(input.published)].map((id) => byId.get(id)).filter(usable);
  const pick = (us: AuthorCandidate[]) =>
    [...new Set(us.map((u) => u.id))]
      .filter((id) => id !== input.submitterId)
      .slice(0, MAX_PAGE_AUTHORS);
  const humanAuthors = new Set([...listed, ...published].map((u) => u.id)).size;
  // The first source that names anyone decides; the submitter is then excluded (architecture.md:
  // "if nobody is left, the owner gets it").
  const source: AuthorSource | null = listed.length
    ? 'owners_file'
    : published.length
      ? 'published_authors'
      : null;
  const ids = pick(source === 'owners_file' ? listed : published);
  if (source && ids.length) return { ids, source, humanAuthors };
  const owner = input.users
    .filter((u) => usable(u) && u.roles.includes('owner') && u.id !== input.submitterId)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))[0];
  return { ids: owner ? [owner.id] : [], source: 'owner', humanAuthors };
}
