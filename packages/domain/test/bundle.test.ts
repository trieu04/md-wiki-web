import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  BUNDLE_LIMIT,
  defaultImpact,
  serializeManifest,
  sha256Hex,
  validateBundle,
  type BuildManifestInput,
  type BundleCode,
  type Manifest,
} from '../src/bundle.js';
import { renderStatusBlock } from '../src/status-block.js';
import { parseStrictJson } from '../src/strict-json.js';

const enc = new TextEncoder();
const bytes = (text: string) => enc.encode(text);
const status = renderStatusBlock({
  proposal: 'earlier',
  decision: '019ab789-97fd-72dc-b74c-2321af809fe6',
  reviewer: 'person',
  decided_at: '2026-11-23T10:42:00Z',
});
const baseText = `${status}# Page\n\nOld content\n\n## Principle\n\nA laser.\n`;
const base = bytes(baseText);
const sourceHash = sha256Hex(bytes('Policy: 30 days'));

function input(overrides: Partial<BuildManifestInput> = {}): BuildManifestInput {
  return {
    slug: 'fix-pinhole-units',
    target: 'page.md',
    title: 'Fix pinhole units',
    reason: 'Correct documentation',
    section: null,
    base: { version: '20261120-1', hash: sha256Hex(base) },
    proposed: bytes('# Page\n\nNew content\n'),
    sources: [{ path: 'source.md', version: '20261118-1', hash: sourceHash }],
    ...overrides,
  };
}
function bundle(overrides: Partial<BuildManifestInput> = {}, baseBytes: Uint8Array | null = base) {
  const value = input(overrides);
  return {
    manifest: serializeManifest(buildManifest(value)),
    base: baseBytes,
    proposed: value.proposed,
  };
}
function tamper(
  edit: (m: Record<string, unknown>) => void,
  overrides: Partial<BuildManifestInput> = {},
) {
  const value = bundle(overrides);
  const m = JSON.parse(new TextDecoder().decode(value.manifest)) as Record<string, unknown>;
  edit(m);
  return { ...value, manifest: bytes(JSON.stringify(m)) };
}
function code(result: ReturnType<typeof validateBundle>): BundleCode | 'ok' {
  return result.ok ? 'ok' : result.error.code;
}

describe('buildManifest + serializeManifest', () => {
  it('emits the fixed key order and binds bundleHash to the manifest bytes', () => {
    const value = bundle();
    const text = new TextDecoder().decode(value.manifest);
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
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
    ]);
    expect(text).not.toMatch(/\s"/);
    const result = validateBundle(value);
    expect(result).toEqual({
      ok: true,
      value: { manifest: JSON.parse(text) as Manifest, bundleHash: sha256Hex(value.manifest) },
    });
  });

  it('is deterministic and identical for equal inputs regardless of property order', () => {
    const a = serializeManifest(buildManifest(input()));
    const reordered = Object.fromEntries(
      Object.entries(input()).reverse(),
    ) as unknown as BuildManifestInput;
    expect(serializeManifest(buildManifest(reordered))).toEqual(a);
  });

  it('defaults the target impact by mode and keeps author metadata optional and last', () => {
    expect(defaultImpact('principle', false)).toBe('Edits section #principle');
    expect(defaultImpact(null, false)).toBe('Edits the whole page');
    expect(defaultImpact(null, true)).toBe('Creates the page');
    const created = buildManifest(input({ base: null }));
    expect(created.scope_impact[0]).toEqual({
      path: 'page.md',
      version: null,
      impact: 'Creates the page',
    });
    expect(created.context.target).toEqual({ path: 'page.md', version: null, hash: null });
    const withAuthor = buildManifest(input({ authorMetadata: { role: 'PhD student' } }));
    expect(Object.keys(withAuthor).at(-1)).toBe('author_metadata');
    expect(validateBundle({ ...bundle({ authorMetadata: { role: 'PhD student' } }) }).ok).toBe(
      true,
    );
  });
});

describe('validateBundle (md-wiki validate_bundle cases)', () => {
  it('accepts an update, a create, a section edit and related scope files', () => {
    expect(code(validateBundle(bundle()))).toBe('ok');
    expect(code(validateBundle(bundle({ base: null }, null)))).toBe('ok');
    expect(code(validateBundle(bundle({ section: 'principle' })))).toBe('ok');
    expect(
      code(
        validateBundle(
          bundle({
            related: [{ path: 'guide.md', version: '20261120-2', impact: 'Update steps' }],
          }),
        ),
      ),
    ).toBe('ok');
  });

  it('enforces the 1 MiB limit on every part', () => {
    const big = new Uint8Array(BUNDLE_LIMIT + 1).fill(97);
    expect(code(validateBundle({ ...bundle(), proposed: big }))).toBe('TOO_LARGE');
    expect(code(validateBundle({ ...bundle(), base: big }))).toBe('TOO_LARGE');
    expect(code(validateBundle({ ...bundle(), manifest: big }))).toBe('TOO_LARGE');
    const exact = new Uint8Array(BUNDLE_LIMIT).fill(97);
    expect(code(validateBundle(bundle({ proposed: exact })))).toBe('ok');
  });

  it('rejects invalid JSON, non-objects and duplicate keys at any depth', () => {
    const valid = bundle();
    const text = new TextDecoder().decode(valid.manifest);
    expect(code(validateBundle({ ...valid, manifest: bytes('{nope') }))).toBe('INVALID_JSON');
    expect(code(validateBundle({ ...valid, manifest: bytes('[1]') }))).toBe('INVALID_JSON');
    expect(code(validateBundle({ ...valid, manifest: new Uint8Array([0xff, 0xfe]) }))).toBe(
      'INVALID_JSON',
    );
    expect(
      code(validateBundle({ ...valid, manifest: bytes(`${text.slice(0, -1)},"id":"x"}`) })),
    ).toBe('DUPLICATE_KEY');
    const nested = text.replace('"hash":"', '"hash":"0","hash":"');
    expect(code(validateBundle({ ...valid, manifest: bytes(nested) }))).toBe('DUPLICATE_KEY');
  });

  it('rejects missing, unknown and mistyped fields', () => {
    expect(code(validateBundle(tamper((m) => delete m.reason)))).toBe('FIELDS');
    expect(code(validateBundle(tamper((m) => (m.extra = 1))))).toBe('FIELDS');
    expect(code(validateBundle(tamper((m) => (m.sources = []))))).toBe('FIELDS');
    expect(code(validateBundle(tamper((m) => (m.knowledge_change = {}))))).toBe('FIELDS');
    expect(code(validateBundle(tamper((m) => (m.title = 3))))).toBe('FIELDS');
    expect(code(validateBundle(tamper((m) => (m.applies_to = {}))))).toBe('FIELDS');
  });

  it('rejects other schema versions, bad IDs and bad targets', () => {
    expect(code(validateBundle(tamper((m) => (m.schema_version = 2))))).toBe('SCHEMA_VERSION');
    expect(code(validateBundle(tamper((m) => (m.schema_version = 1.5))))).toBe('SCHEMA_VERSION');
    for (const id of ['Upper', 'under_score', '-lead', 'trail-', 'a--b', '', 'x'.repeat(81)])
      expect(code(validateBundle(bundle({ slug: id })))).toBe('INVALID_ID');
    for (const path of [
      '../x.md',
      '/x.md',
      'a//x.md',
      'A.md',
      'a\\b.md',
      'a%2fb.md',
      'x.txt',
      '.wiki-system/x.md',
    ])
      expect(code(validateBundle(bundle({ target: path })))).toBe('INVALID_TARGET');
  });

  it('requires a non-blank title and reason within their limits', () => {
    expect(code(validateBundle(bundle({ reason: '   ' })))).toBe('REASON_REQUIRED');
    expect(code(validateBundle(bundle({ reason: 'x'.repeat(4001) })))).toBe('REASON_REQUIRED');
    expect(code(validateBundle(bundle({ title: '' })))).toBe('TITLE_REQUIRED');
    expect(code(validateBundle(bundle({ title: 'x'.repeat(121) })))).toBe('TITLE_REQUIRED');
  });

  it('checks hash syntax, create/update mode and payload hashes', () => {
    expect(code(validateBundle(tamper((m) => (m.proposed_hash = 'ABC'))))).toBe('INVALID_HASH');
    expect(code(validateBundle({ ...bundle(), base: null }))).toBe('MODE_MISMATCH');
    expect(code(validateBundle({ ...bundle({ base: null }, null), base }))).toBe('MODE_MISMATCH');
    // md-wiki test_mutation_duplicate_id_and_frozen_payload: altered payload after freezing
    expect(code(validateBundle({ ...bundle(), proposed: bytes('Altered') }))).toBe('HASH_MISMATCH');
    expect(code(validateBundle({ ...bundle(), base: bytes('other base') }))).toBe('HASH_MISMATCH');
  });

  it('rejects non-UTF-8 Markdown and the reserved status marker', () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    expect(code(validateBundle(bundle({ proposed: latin1 })))).toBe('NOT_UTF8');
    // md-wiki test_restore_is_new_review_without_old_marker
    expect(code(validateBundle(bundle({ proposed: base })))).toBe('RESERVED_MARKER');
    expect(code(validateBundle(bundle({ proposed: bytes('a\n<!-- md-wiki:status\n') })))).toBe(
      'RESERVED_MARKER',
    );
    expect(
      code(validateBundle(bundle({ proposed: bytes('Mentions md-wiki:status safely') }))),
    ).toBe('ok');
  });

  it('validates the pinned context (md-wiki context.validate)', () => {
    expect(
      code(
        validateBundle(
          tamper((m) => ((m.context as { target: { hash: string } }).target.hash = sourceHash)),
        ),
      ),
    ).toBe('INVALID_CONTEXT');
    expect(
      code(
        validateBundle(
          tamper((m) => ((m.context as { target: { path: string } }).target.path = 'other.md')),
        ),
      ),
    ).toBe('INVALID_CONTEXT');
    const many = Array.from({ length: 33 }, (_, i) => ({
      path: `s${String(i)}.md`,
      version: '20261118-1',
      hash: sourceHash,
    }));
    expect(code(validateBundle(bundle({ sources: many })))).toBe('INVALID_CONTEXT');
    expect(code(validateBundle(bundle({ sources: many.slice(0, 32) })))).toBe('ok');
    const dup = { path: 'source.md', version: '20261118-1', hash: sourceHash };
    expect(code(validateBundle(bundle({ sources: [dup, dup] })))).toBe('INVALID_CONTEXT');
    expect(code(validateBundle(bundle({ sources: [{ ...dup, path: 'page.md' }] })))).toBe(
      'INVALID_CONTEXT',
    );
    expect(code(validateBundle(bundle({ sources: [{ ...dup, version: 'v1' }] })))).toBe(
      'INVALID_CONTEXT',
    );
    expect(code(validateBundle(bundle({ sources: [{ ...dup, path: '../x.md' }] })))).toBe(
      'INVALID_CONTEXT',
    );
  });

  it('validates scope rows, source references and applies-to', () => {
    const related = (path: string, version = '20261120-2', impact = 'Update') => ({
      path,
      version,
      impact,
    });
    expect(
      code(validateBundle(bundle({ related: [related('guide.md', '20261120-2', ' ')] }))),
    ).toBe('INVALID_SCOPE');
    expect(code(validateBundle(bundle({ related: [related('page.md')] })))).toBe('INVALID_SCOPE');
    expect(code(validateBundle(bundle({ related: [related('g.md'), related('g.md')] })))).toBe(
      'INVALID_SCOPE',
    );
    expect(code(validateBundle(bundle({ related: [related('source.md', '20261119-1')] })))).toBe(
      'INVALID_SCOPE',
    );
    expect(code(validateBundle(bundle({ related: [related('source.md', '20261118-1')] })))).toBe(
      'ok',
    );
    expect(code(validateBundle(tamper((m) => ((m.scope_impact as unknown[]).length = 0))))).toBe(
      'INVALID_SCOPE',
    );
    expect(code(validateBundle(tamper((m) => (m.source_references = []))))).toBe('INVALID_SOURCES');
    const applies = (name: string, version = '1') => ({ name, version });
    expect(code(validateBundle(bundle({ appliesTo: [applies('LAS X'), applies('las x')] })))).toBe(
      'INVALID_APPLIES_TO',
    );
    expect(code(validateBundle(bundle({ appliesTo: [applies('LAS X', '')] })))).toBe(
      'INVALID_APPLIES_TO',
    );
    expect(
      code(
        validateBundle(
          bundle({ appliesTo: Array.from({ length: 17 }, (_, i) => applies(`n${String(i)}`)) }),
        ),
      ),
    ).toBe('INVALID_APPLIES_TO');
    expect(code(validateBundle(bundle({ appliesTo: [applies('Leica SP8', '3.5')] })))).toBe('ok');
    expect(code(validateBundle(bundle({ authorMetadata: { name: ' ' } })))).toBe(
      'INVALID_AUTHOR_METADATA',
    );
    expect(code(validateBundle(tamper((m) => (m.author_metadata = { nick: 'x' }))))).toBe(
      'INVALID_AUTHOR_METADATA',
    );
  });

  it('requires the section to exist in the base and the proposal to change it', () => {
    expect(code(validateBundle(bundle({ section: 'missing' })))).toBe('UNKNOWN_SECTION');
    expect(code(validateBundle(bundle({ base: null, section: 'principle' }, null)))).toBe(
      'UNKNOWN_SECTION',
    );
    const body = baseText.slice(status.length);
    expect(code(validateBundle(bundle({ proposed: bytes(body) })))).toBe('NO_CHANGE');
  });
});

describe('parseStrictJson', () => {
  it('accepts equal keys in different objects and escaped quotes in strings', () => {
    expect(parseStrictJson('{"a":{"x":1},"b":{"x":"q\\"x"},"c":[{"x":1},{"x":2}]}').ok).toBe(true);
    expect(parseStrictJson('{"a":1,"a":2}')).toEqual({ ok: false, error: 'DUPLICATE_KEY' });
    expect(parseStrictJson('{"a":[{"k":1,"k":1}]}')).toEqual({ ok: false, error: 'DUPLICATE_KEY' });
    expect(parseStrictJson('{"\\u0061":1,"a":2}')).toEqual({ ok: false, error: 'DUPLICATE_KEY' });
    expect(parseStrictJson('{')).toEqual({ ok: false, error: 'INVALID_JSON' });
  });
});
