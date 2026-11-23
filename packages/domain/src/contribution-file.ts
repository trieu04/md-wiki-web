import { BUNDLE_LIMIT, type AppliesTo, type AuthorMetadata } from './bundle.js';
import { err, ok, type Result } from './result.js';

/** md-wiki CONTRIBUTION_FILE_LIMIT = 4 × 1 MiB + 64 KiB. */
export const CONTRIBUTION_FILE_LIMIT = 4 * BUNDLE_LIMIT + 65536;
export const CONTRIBUTION_FORMAT = 'wiki-contribution-v3';
const HEADER = '# Wiki contribution\n\n| Field | Value |\n| --- | --- |\n';
const BOUNDARY = /^wc-[a-z0-9-]{1,200}$/;
const FIELD_ROW = /^\| ([A-Za-z][A-Za-z0-9 _-]*) \| ([\s\S]*?) \|$/;
const REFERENCES =
  /\n## Scope and impact files\n\n\| File \| Version \| Impact \|\n\| --- \| --- \| --- \|\n([\s\S]*?)\n\n## Sources\n\n\| File \| Version \|\n\| --- \| --- \|\n([\s\S]*?)$/;
const SCOPE_ROW = /^\| ([^|]+) \| (\d{8}-\d+) \| ((?:\\\||[^|])+) \|$/;
const SOURCE_ROW = /^\| ([^|]+) \| (\d{8}-\d+) \|$/;
const REQUIRED = [
  'Format',
  'Boundary',
  'ID',
  'Base SHA-256',
  'Proposed SHA-256',
  'Author',
  'Reason',
];
const AUTHOR_ROWS = [
  ['name', 'Author name'],
  ['role', 'Author role'],
  ['expert', 'Author expert'],
  ['metadata_source', 'Author metadata source'],
] as const;

export interface ContributionFile {
  id: string;
  boundary: string;
  baseHash: string;
  proposedHash: string;
  author: string;
  reason: string;
  title: string | null;
  section: string | null;
  appliesTo: AppliesTo[];
  authorMetadata: AuthorMetadata | null;
  /** Primary target first. */
  scope: { path: string; version: string; impact: string }[];
  /** Without the target (a target row with the target's version is dropped, as in md-wiki). */
  sources: { path: string; version: string }[];
  base: Uint8Array;
  proposed: Uint8Array;
}
export interface ContributionIssue {
  code: 'TOO_LARGE' | 'CONTRIBUTION_FORMAT';
  message: string;
}

function tableValue(value: string): string {
  return value.replaceAll('\\|', '|').replaceAll('<br>', '\n').replaceAll('\\\\', '\\');
}
function tableCell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', '<br>');
}
const count = (text: string, marker: string) => text.split(marker).length - 1;
const invalid = (message: string): Result<never, ContributionIssue> =>
  err({ code: 'CONTRIBUTION_FORMAT', message });

function references(text: string) {
  const match = REFERENCES.exec(text);
  if (!match) return invalid('missing scope/impact or sources table');
  const scope: ContributionFile['scope'] = [];
  for (const line of (match[1] ?? '').split('\n')) {
    const row = SCOPE_ROW.exec(line);
    const impact = row?.[3]?.trim();
    if (!row?.[1] || !row[2] || !impact) return invalid('invalid scope/impact file row');
    scope.push({ path: row[1].trim(), version: row[2], impact: tableValue(impact) });
  }
  if (!scope.length || new Set(scope.map((row) => row.path)).size !== scope.length)
    return invalid('scope must contain unique versioned files, primary target first');
  const sources: ContributionFile['sources'] = [];
  for (const line of (match[2] ?? '').split('\n')) {
    if (!line.trim()) continue;
    const row = SOURCE_ROW.exec(line);
    if (!row?.[1] || !row[2]) return invalid('invalid source file row');
    sources.push({ path: row[1].trim(), version: row[2] });
  }
  if (new Set(sources.map((row) => row.path)).size !== sources.length)
    return invalid('sources must contain unique versioned files');
  return ok({ scope, sources });
}

function appliesTo(value: string): Result<AppliesTo[], ContributionIssue> {
  const rows: AppliesTo[] = [];
  for (const line of value.split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf(' = ');
    if (at < 0) return invalid('Applies to rows are "name = version"');
    rows.push({ name: line.slice(0, at).trim(), version: line.slice(at + 3).trim() });
  }
  return ok(rows);
}

const fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf8 = new TextEncoder();

/** Port of md-wiki `contribution_file`: the envelope only; versions are resolved by the API. */
export function parseContribution(raw: Uint8Array): Result<ContributionFile, ContributionIssue> {
  if (raw.length > CONTRIBUTION_FILE_LIMIT)
    return err({ code: 'TOO_LARGE', message: 'contribution file exceeds size limit' });
  let text: string;
  try {
    text = fatal.decode(raw);
  } catch {
    return invalid('contribution file must be UTF-8 Markdown');
  }
  if (!text.startsWith(HEADER)) return invalid('invalid Markdown contribution header');
  const metadata = new Map<string, string>();
  const metadataText = text.split('\n\n## ')[0] ?? '';
  for (const line of metadataText.split('\n')) {
    const row = FIELD_ROW.exec(line);
    if (!row?.[1] || row[2] === undefined) continue;
    if (metadata.has(row[1])) return invalid(`duplicate contribution field: ${row[1]}`);
    metadata.set(row[1], tableValue(row[2]));
  }
  if (!REQUIRED.every((key) => metadata.has(key)))
    return invalid('incomplete Markdown contribution table');
  if (metadata.get('Format') !== CONTRIBUTION_FORMAT)
    return invalid(`unsupported contribution format; expected ${CONTRIBUTION_FORMAT}`);
  const boundary = metadata.get('Boundary') ?? '';
  if (!BOUNDARY.test(boundary)) return invalid('invalid contribution boundary');
  const start = `\n\n## Proposed content\n\n--- ${boundary}:proposed ---\n\n`;
  const middle = `\n\n--- ${boundary}:base ---\n\n## Base content\n\n`;
  const end = `\n\n--- ${boundary}:end ---\n`;
  if ([start, middle, end].some((marker) => count(text, marker) !== 1) || !text.endsWith(end))
    return invalid('missing or ambiguous contribution breaks');
  const startAt = text.indexOf(start);
  const head = text.slice(0, startAt);
  const payload = text.slice(startAt + start.length, text.length - end.length);
  const middleAt = payload.indexOf(middle);
  if (middleAt < 0) return invalid('contribution breaks are out of order');
  const proposedText = payload.slice(0, middleAt);
  const baseText = payload.slice(middleAt + middle.length);
  if (proposedText.includes(boundary) || baseText.includes(boundary))
    return invalid('contribution boundary occurs in content');
  const refs = references(head);
  if (!refs.ok) return refs;
  const [target, ...related] = refs.value.scope;
  if (!target) return invalid('scope must contain the primary target');
  const versions = new Map<string, string>();
  for (const row of [...related, ...refs.value.sources]) {
    const seen = versions.get(row.path);
    if (seen !== undefined && seen !== row.version)
      return invalid('a file cannot use different versions in scope and sources');
    versions.set(row.path, row.version);
  }
  const targetInSources = refs.value.sources.find((row) => row.path === target.path);
  if (targetInSources && targetInSources.version !== target.version)
    return invalid('target must use one version across scope and sources');
  const applies = appliesTo(metadata.get('Applies to') ?? '');
  if (!applies.ok) return applies;
  const authorMetadata: AuthorMetadata = {};
  for (const [key, label] of AUTHOR_ROWS) {
    const value = metadata.get(label);
    if (value !== undefined) authorMetadata[key] = value;
  }
  return ok({
    id: metadata.get('ID') ?? '',
    boundary,
    baseHash: metadata.get('Base SHA-256') ?? '',
    proposedHash: metadata.get('Proposed SHA-256') ?? '',
    author: metadata.get('Author') ?? '',
    reason: metadata.get('Reason') ?? '',
    title: metadata.get('Title') ?? null,
    section: metadata.get('Section') ?? null,
    appliesTo: applies.value,
    authorMetadata: Object.keys(authorMetadata).length ? authorMetadata : null,
    scope: refs.value.scope,
    sources: refs.value.sources.filter((row) => row.path !== target.path),
    base: utf8.encode(baseText),
    proposed: utf8.encode(proposedText),
  });
}

export interface RenderContributionInput {
  id: string;
  baseHash: string;
  proposedHash: string;
  author: string;
  reason: string;
  title?: string | null;
  section?: string | null;
  appliesTo?: readonly AppliesTo[];
  scope: readonly { path: string; version: string; impact: string }[];
  sources: readonly { path: string; version: string }[];
  base: string;
  proposed: string;
  /** Injectable for tests; must yield `wc-[a-z0-9-]+` tokens. */
  boundary?: () => string;
}

function randomBoundary(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `wc-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The `.contribution.md` v3 file for a bundle; parseContribution(render(x)) round-trips. */
export function renderContribution(input: RenderContributionInput): string {
  const next = input.boundary ?? randomBoundary;
  let boundary = next();
  for (let i = 0; input.base.includes(boundary) || input.proposed.includes(boundary); i++) {
    if (i > 100) throw new Error('could not choose a contribution boundary');
    boundary = next();
  }
  const fields: [string, string][] = [
    ['Format', CONTRIBUTION_FORMAT],
    ['Boundary', boundary],
    ['ID', input.id],
    ['Base SHA-256', input.baseHash],
    ['Proposed SHA-256', input.proposedHash],
    ['Author', input.author],
    ['Reason', input.reason],
  ];
  if (input.title) fields.push(['Title', input.title]);
  if (input.section) fields.push(['Section', input.section]);
  if (input.appliesTo?.length)
    fields.push(['Applies to', input.appliesTo.map((a) => `${a.name} = ${a.version}`).join('\n')]);
  const lines = [
    '# Wiki contribution',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...fields.map(([key, value]) => `| ${key} | ${tableCell(value)} |`),
    '',
    '## Scope and impact files',
    '',
    '| File | Version | Impact |',
    '| --- | --- | --- |',
    ...input.scope.map((row) => `| ${row.path} | ${row.version} | ${tableCell(row.impact)} |`),
    '',
    '## Sources',
    '',
    '| File | Version |',
    '| --- | --- |',
    ...input.sources.map((row) => `| ${row.path} | ${row.version} |`),
    // md-wiki's empty Sources table keeps one blank row before the payload framing.
    ...(input.sources.length ? [] : ['']),
  ];
  return (
    lines.join('\n') +
    `\n\n## Proposed content\n\n--- ${boundary}:proposed ---\n\n${input.proposed}` +
    `\n\n--- ${boundary}:base ---\n\n## Base content\n\n${input.base}` +
    `\n\n--- ${boundary}:end ---\n`
  );
}
