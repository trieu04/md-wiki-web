import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { validateWikiPath } from './paths.js';
import { err, ok, type Result } from './result.js';
import { splitSections } from './sections.js';
import { isSlug } from './slug.js';
import { containsReservedMarker, parseStatusBlock } from './status-block.js';
import { parseStrictJson } from './strict-json.js';

/** md-wiki LIMIT: each bundle payload is at most 1 MiB. */
export const BUNDLE_LIMIT = 1024 * 1024;
export const MAX_SOURCES = 32;
export const MAX_APPLIES_TO = 16;
export const TITLE_LIMIT = 120;
export const REASON_LIMIT = 4000;
export const IMPACT_LIMIT = 500;
export const VERSION_PATTERN = /^\d{8}-\d+$/;
const HASH = /^[a-f0-9]{64}$/;

export type BundleCode =
  | 'TOO_LARGE'
  | 'INVALID_JSON'
  | 'DUPLICATE_KEY'
  | 'FIELDS'
  | 'SCHEMA_VERSION'
  | 'INVALID_ID'
  | 'INVALID_TARGET'
  | 'TITLE_REQUIRED'
  | 'REASON_REQUIRED'
  | 'INVALID_HASH'
  | 'MODE_MISMATCH'
  | 'HASH_MISMATCH'
  | 'NOT_UTF8'
  | 'RESERVED_MARKER'
  | 'INVALID_CONTEXT'
  | 'INVALID_SCOPE'
  | 'INVALID_SOURCES'
  | 'INVALID_APPLIES_TO'
  | 'INVALID_AUTHOR_METADATA'
  | 'UNKNOWN_SECTION'
  | 'NO_CHANGE';

export interface BundleIssue {
  code: BundleCode;
  message: string;
}

export interface VersionRef {
  path: string;
  version: string;
  hash: string;
}
export interface ScopeRow {
  path: string;
  version: string | null;
  impact: string;
}
export interface AppliesTo {
  name: string;
  version: string;
}
export const AUTHOR_METADATA_KEYS = ['name', 'role', 'expert', 'metadata_source'] as const;
export type AuthorMetadata = Partial<Record<(typeof AUTHOR_METADATA_KEYS)[number], string>>;

export interface Manifest {
  schema_version: 1;
  id: string;
  target: string;
  base_hash: string | null;
  proposed_hash: string;
  title: string;
  reason: string;
  section: string | null;
  context: {
    target: { path: string; version: string | null; hash: string | null };
    sources: VersionRef[];
  };
  scope_impact: ScopeRow[];
  source_references: { path: string; version: string }[];
  applies_to: AppliesTo[];
  author_metadata?: AuthorMetadata;
}

const REQUIRED = [
  'schema_version',
  'id',
  'target',
  'base_hash',
  'proposed_hash',
  'title',
  'reason',
  'section',
  'context',
  'scope_impact',
  'source_references',
  'applies_to',
] as const;

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function defaultImpact(section: string | null, isCreate: boolean): string {
  if (isCreate) return 'Creates the page';
  return section === null ? 'Edits the whole page' : `Edits section #${section}`;
}

export interface BuildManifestInput {
  slug: string;
  target: string;
  title: string;
  reason: string;
  section: string | null;
  /** The pinned base version, or null for a new page. */
  base: { version: string; hash: string } | null;
  proposed: Uint8Array;
  sources: readonly VersionRef[];
  /** Related files after the target row (agents and imports only in Phase 4, D-59). */
  related?: readonly { path: string; version: string; impact: string }[];
  targetImpact?: string | null;
  appliesTo?: readonly AppliesTo[];
  authorMetadata?: AuthorMetadata;
}

/** The one manifest builder for every submission path (P4-G: identical structure). */
export function buildManifest(input: BuildManifestInput): Manifest {
  const version = input.base?.version ?? null;
  const manifest: Manifest = {
    schema_version: 1,
    id: input.slug,
    target: input.target,
    base_hash: input.base?.hash ?? null,
    proposed_hash: sha256Hex(input.proposed),
    title: input.title,
    reason: input.reason,
    section: input.section,
    context: {
      target: { path: input.target, version, hash: input.base?.hash ?? null },
      sources: input.sources.map(({ path, version, hash }) => ({ path, version, hash })),
    },
    scope_impact: [
      {
        path: input.target,
        version,
        impact: input.targetImpact?.trim()
          ? input.targetImpact
          : defaultImpact(input.section, input.base === null),
      },
      ...(input.related ?? []).map(({ path, version, impact }) => ({ path, version, impact })),
    ],
    source_references: input.sources.map(({ path, version }) => ({ path, version })),
    applies_to: (input.appliesTo ?? []).map(({ name, version }) => ({ name, version })),
  };
  if (input.authorMetadata && Object.keys(input.authorMetadata).length) {
    const metadata: AuthorMetadata = {};
    for (const key of AUTHOR_METADATA_KEYS) {
      const value = input.authorMetadata[key];
      if (value !== undefined) metadata[key] = value;
    }
    manifest.author_metadata = metadata;
  }
  return manifest;
}

const utf8 = new TextEncoder();
/** Compact JSON in the declared key order; the bytes are what `bundleHash` binds. */
export function serializeManifest(manifest: Manifest): Uint8Array {
  const ordered: Record<string, unknown> = {};
  for (const key of REQUIRED) ordered[key] = manifest[key];
  if (manifest.author_metadata !== undefined) ordered.author_metadata = manifest.author_metadata;
  return utf8.encode(JSON.stringify(ordered));
}

const fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function decode(bytes: Uint8Array): string | null {
  try {
    return fatal.decode(bytes);
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactly = (value: unknown, keys: readonly string[]): value is Json =>
  isObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const nonBlank = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && Array.from(value).length <= max;
const validPath = (value: unknown): value is string =>
  typeof value === 'string' && validateWikiPath(value).ok;
const version = (value: unknown): value is string =>
  typeof value === 'string' && VERSION_PATTERN.test(value);

function issue(code: BundleCode, message: string): Result<never, BundleIssue> {
  return err({ code, message });
}

function fieldsOk(m: Json): boolean {
  const keys = Object.keys(m);
  if (!REQUIRED.every((key) => Object.hasOwn(m, key))) return false;
  if (
    keys.some((key) => !(REQUIRED as readonly string[]).includes(key) && key !== 'author_metadata')
  )
    return false;
  return (
    typeof m.schema_version === 'number' &&
    typeof m.id === 'string' &&
    typeof m.target === 'string' &&
    (m.base_hash === null || typeof m.base_hash === 'string') &&
    typeof m.proposed_hash === 'string' &&
    typeof m.title === 'string' &&
    typeof m.reason === 'string' &&
    (m.section === null || typeof m.section === 'string') &&
    isObject(m.context) &&
    Array.isArray(m.scope_impact) &&
    Array.isArray(m.source_references) &&
    Array.isArray(m.applies_to) &&
    (m.author_metadata === undefined || isObject(m.author_metadata))
  );
}

export interface BundleInput {
  manifest: Uint8Array;
  base: Uint8Array | null;
  proposed: Uint8Array;
}
export interface ValidBundle {
  manifest: Manifest;
  bundleHash: string;
}

/** Port of md-wiki `validate_bundle` + `context.validate` (system-logic §7.2.2). */
export function validateBundle({
  manifest,
  base,
  proposed,
}: BundleInput): Result<ValidBundle, BundleIssue> {
  if ([manifest, proposed, base].some((part) => part !== null && part.length > BUNDLE_LIMIT))
    return issue('TOO_LARGE', 'bundle files must be within the 1 MiB limit');
  const text = decode(manifest);
  if (text === null) return issue('INVALID_JSON', 'manifest must be UTF-8 JSON');
  const parsed = parseStrictJson(text);
  if (!parsed.ok)
    return parsed.error === 'DUPLICATE_KEY'
      ? issue('DUPLICATE_KEY', 'duplicate JSON key')
      : issue('INVALID_JSON', 'invalid JSON');
  const m = parsed.value;
  if (!isObject(m)) return issue('INVALID_JSON', 'manifest must be an object');
  if (!fieldsOk(m)) return issue('FIELDS', 'manifest has missing, unknown or mistyped fields');
  if (m.schema_version !== 1) return issue('SCHEMA_VERSION', 'unsupported schema version');
  if (!isSlug(m.id as string)) return issue('INVALID_ID', 'invalid proposal ID');
  if (!validPath(m.target)) return issue('INVALID_TARGET', 'invalid target path');
  if (!nonBlank(m.title, TITLE_LIMIT)) return issue('TITLE_REQUIRED', 'title required');
  if (!nonBlank(m.reason, REASON_LIMIT)) return issue('REASON_REQUIRED', 'reason required');
  const baseHash = m.base_hash as string | null;
  const proposedHash = m.proposed_hash as string;
  if (!HASH.test(proposedHash) || (baseHash !== null && !HASH.test(baseHash)))
    return issue('INVALID_HASH', 'invalid base_hash or proposed_hash');
  if ((baseHash === null) !== (base === null))
    return issue('MODE_MISMATCH', 'base content must match create/update mode');
  if (sha256Hex(proposed) !== proposedHash || (base !== null && sha256Hex(base) !== baseHash))
    return issue('HASH_MISMATCH', 'payload hash mismatch');
  const proposedText = decode(proposed);
  const baseText = base === null ? null : decode(base);
  if (proposedText === null || (base !== null && baseText === null))
    return issue('NOT_UTF8', 'Markdown must be UTF-8');
  if (containsReservedMarker(proposedText))
    return issue('RESERVED_MARKER', 'proposed content contains the reserved status marker');

  const target = m.target;
  const context = m.context as Json;
  const contextTarget = context.target;
  const sources = context.sources;
  if (
    !hasExactly(context, ['target', 'sources']) ||
    !hasExactly(contextTarget, ['path', 'version', 'hash']) ||
    contextTarget.path !== target ||
    contextTarget.hash !== baseHash ||
    (baseHash === null ? contextTarget.version !== null : !version(contextTarget.version)) ||
    !Array.isArray(sources) ||
    sources.length > MAX_SOURCES ||
    !sources.every(
      (ref) =>
        hasExactly(ref, ['path', 'version', 'hash']) &&
        validPath(ref.path) &&
        version(ref.version) &&
        typeof ref.hash === 'string' &&
        HASH.test(ref.hash),
    )
  )
    return issue('INVALID_CONTEXT', 'context requires a matching target and valid sources');
  const sourcePaths = (sources as VersionRef[]).map((ref) => ref.path);
  if (new Set([target, ...sourcePaths]).size !== sourcePaths.length + 1)
    return issue('INVALID_CONTEXT', 'context sources must have unique paths distinct from target');

  const scope = m.scope_impact as unknown[];
  const first = scope[0];
  if (
    !hasExactly(first, ['path', 'version', 'impact']) ||
    first.path !== target ||
    first.version !== contextTarget.version ||
    !scope.every(
      (row, i) =>
        hasExactly(row, ['path', 'version', 'impact']) &&
        validPath(row.path) &&
        nonBlank(row.impact, IMPACT_LIMIT) &&
        (i === 0 || (version(row.version) && row.path !== target)),
    ) ||
    new Set(scope.map((row) => (row as ScopeRow).path)).size !== scope.length
  )
    return issue('INVALID_SCOPE', 'scope_impact must list the target first, then unique files');
  const byPath = new Map((sources as VersionRef[]).map((ref) => [ref.path, ref.version]));
  for (const row of scope.slice(1) as ScopeRow[]) {
    const pinned = byPath.get(row.path);
    if (pinned !== undefined && pinned !== row.version)
      return issue('INVALID_SCOPE', 'a file cannot use different versions in scope and sources');
  }

  const references = m.source_references as unknown[];
  if (
    references.length !== sourcePaths.length ||
    !references.every(
      (ref, i) =>
        hasExactly(ref, ['path', 'version']) &&
        ref.path === (sources as VersionRef[])[i]?.path &&
        ref.version === (sources as VersionRef[])[i]?.version,
    )
  )
    return issue('INVALID_SOURCES', 'source_references must match the context sources');

  const applies = m.applies_to as unknown[];
  if (
    applies.length > MAX_APPLIES_TO ||
    !applies.every(
      (row) =>
        hasExactly(row, ['name', 'version']) &&
        nonBlank(row.name, 100) &&
        nonBlank(row.version, 50),
    ) ||
    new Set(applies.map((row) => (row as AppliesTo).name.trim().toLowerCase())).size !==
      applies.length
  )
    return issue('INVALID_APPLIES_TO', 'applies_to needs unique names with versions');

  if (m.author_metadata !== undefined) {
    const metadata = m.author_metadata as Json;
    const keys = Object.keys(metadata);
    if (
      !keys.length ||
      keys.some(
        (key) =>
          !(AUTHOR_METADATA_KEYS as readonly string[]).includes(key) ||
          !nonBlank(metadata[key], 200),
      )
    )
      return issue('INVALID_AUTHOR_METADATA', 'invalid author metadata');
  }

  const section = m.section as string | null;
  if (section !== null) {
    if (baseText === null) return issue('UNKNOWN_SECTION', 'a new page has no sections');
    if (!splitSections(baseText).some((s) => s.anchor === section))
      return issue('UNKNOWN_SECTION', 'section is not in the base version');
  }
  if (baseText !== null && parseStatusBlock(baseText).body === proposedText)
    return issue('NO_CHANGE', 'the proposal does not change the page');

  return ok({ manifest: m as unknown as Manifest, bundleHash: sha256Hex(manifest) });
}
