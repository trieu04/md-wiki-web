# System logic and contracts

Status: **v1, 2026-11-23**. This is the contract every implementation task binds to. It refines [architecture.md](architecture.md) into module boundaries, types, rules and endpoints. Where it makes a choice that architecture.md leaves open, the choice is marked **[D-n]** and listed in [implementation-plan.md › Decisions taken by the plan](implementation-plan.md#decisions-taken-by-the-plan) so a human can reverse it. Contracts for later phases are listed here in outline and are expanded (same format) by the phase's `-00` spec task before any code in that phase is written.

## 1. Module boundaries

```text
packages/domain      pure TypeScript. No IO, no Nest, no React. Deterministic functions + types.
                     paths · sections · status block · snapshot labels · label precedence ·
                     bundle validation · permission matrix · time formatting · error codes
packages/contracts   generated + hand-written wire types: openapi.json, TS client, job schemas,
                     pydantic models. Depends on nothing at runtime.
apps/api             NestJS. All IO and state. Uses domain for every rule. Only writer of wiki + DB.
apps/web             React. Calls the API through the generated client. Uses domain only for
                     display helpers (label meta, time formatting). No business rules.
services/worker      Python. Reads via internal API, posts results. Never touches DB or wiki.
```

Rules:

1. A business rule lives in exactly one place: `packages/domain` if it is pure, else an `apps/api` service. Controllers only map HTTP ↔ service calls. React components only render view models.
2. `apps/web` view models live in `apps/web/src/features/<feature>/model.ts`: pure functions from API DTOs to render props, unit-tested. Components never compute labels, permissions, counts or sort orders that the API already returns.
3. Every API response DTO is declared once in Nest (class-validator + `@nestjs/swagger`) and reaches the web only through `packages/contracts` generation. Hand-written duplicate types in the web are a review failure.

## 2. Conventions

| Topic | Contract |
| --- | --- |
| Public API base | `/api/v1` on port `3000` (env `API_PORT`) |
| Internal API base | `/internal/v1` on port `3001` (env `INTERNAL_PORT`), bound to the compose network only, `Authorization: Bearer <SERVICE_TOKEN>` |
| IDs | UUIDv7 strings for all rows. Proposals also carry a unique `slug` (kebab-case from the title, `-2`, `-3` suffixes) used in URLs and shown in the UI **[D-6]** |
| Time | Stored as `timestamptz` UTC; JSON as ISO-8601 with `Z`. Display formatting in `domain/time.ts` **[D-9]** |
| Pagination | Cursor: `?limit=` (1–100, default 25) `&cursor=` → `{ items: T[], nextCursor: string \| null }` **[D-11]** |
| Errors | `application/problem+json`: `{ type, title, status, code, detail?, fields?: {path, code, message}[], requestId }`. `code` is a value of `ErrorCode` (§9). Never a stack trace **[D-5]** |
| Validation | DTOs validated by `class-validator` with `whitelist: true, forbidNonWhitelisted: true`. Invalid → `400 VALIDATION_FAILED` with `fields` |
| Request id | `X-Request-Id` accepted or generated, echoed, logged, and in every problem body |
| Hashes | SHA-256 lowercase hex of the exact bytes |
| Bytes | Bundle and snapshot content stored as `bytea`, never reserialized |
| Concurrency | Mutations that bind to a version take the hash they read and fail with `409` + specific code when it no longer matches |

## 3. Wiki storage (Phase 1)

### 3.1 Path rules (`domain/paths.ts`)

`validateWikiPath(p: string): Result<WikiPath, PathError>`

- Relative, `/`-separated, no leading `/`, no empty segment, no `.` or `..` segment, no backslash, no NUL.
- Each segment matches `^[a-z0-9][a-z0-9_-]*$` except the last, which matches `^[a-z0-9][a-z0-9_-]*\.md$`.
- Total length ≤ 200 bytes. Max depth 8.
- `.wiki-system/` and any segment starting with `.` are reserved → `RESERVED_PATH`.
- `wiki-meta/` is a normal content folder (reviewed like content) but flagged `isMeta: true`.
- Errors: `ABSOLUTE`, `TRAVERSAL`, `EMPTY_SEGMENT`, `NOT_PORTABLE`, `NOT_MARKDOWN`, `TOO_LONG`, `TOO_DEEP`, `RESERVED_PATH`.

### 3.2 `WikiStorage` port (`apps/api/src/wiki/storage/wiki-storage.ts`)

```ts
interface WikiItem { path: WikiPath; size: number; mtime: Date; sha256: string }
interface ReadResult { path: WikiPath; content: Buffer; sha256: string; mtime: Date }
type WriteCondition = { kind: 'create' } | { kind: 'replace'; expectedSha256: string };
interface WriteReceipt { id: string; path: WikiPath; beforeSha256: string | null;
  afterSha256: string; writtenAt: Date; receiptPath: string }
interface WikiStorage {
  list(prefix?: string): Promise<WikiItem[]>;                       // .md only, sorted by path
  read(path: WikiPath): Promise<ReadResult>;                         // NOT_FOUND
  write(path: WikiPath, content: Buffer, cond: WriteCondition, meta: Record<string, string>): Promise<WriteReceipt>;
  withRootLock<T>(fn: () => Promise<T>): Promise<T>;                 // serialises writes per root
}
```

`LocalFolderStorage` rules:

- `write` runs under the root lock: read current bytes → check condition (`create` and file exists → `ALREADY_EXISTS`; `replace` and sha differs or file missing → `PRECONDITION_FAILED`) → write to `.wiki-system/tmp/<uuid>` → `fsync` file → `rename` onto target → `fsync` directory → re-read and verify sha equals `afterSha256` (mismatch → `VERIFY_FAILED`) → write receipt JSON to `.wiki-system/receipts/<yyyymmdd>/<receipt id>.json` (fsync).
- Parent folders are created as needed (each segment validated).
- Never follows symlinks outside the root (realpath check) → `TRAVERSAL`.
- `FixtureStorage` implements the same port in memory with injectable faults at each step (`beforeRename`, `afterRename`, `beforeVerify`, `receipt`), used by publish-flow tests.
- **Fault semantics [D-36]** (each fault fires once, then the adapter behaves normally):
  - `beforeRename` → throws `STORAGE_ERROR`; the temp file is removed, the target is unchanged.
  - `afterRename` → the rename **has happened** (target holds the new bytes), then throws `STORAGE_ERROR` — simulates a crash after the write; callers recover by reading back.
  - `beforeVerify` → the read-back returns different bytes than written → `VERIFY_FAILED` (target is left as written).
  - `receipt` → write and verify succeeded, then producing the receipt throws `STORAGE_ERROR`.

### 3.3 Sections (`domain/sections.ts`) [D-1, D-2, D-3]

`splitSections(markdown: string): Section[]` where `Section = { anchor: string; title: string; level: 0..6; startLine: number; endLine: number; text: string; hash: string }`.

- Parse with `remark-parse` + `remark-gfm` (mdast). Only ATX/setext headings at the document root count (headings inside lists, blockquotes or fenced code do not).
- **Flat partition [D-1]**: every heading starts a section that ends right before the next root heading of any level. Text before the first heading is the `lead` section (anchor `lead`, level 0), omitted when empty after trimming.
- The status block (§3.4) is removed before splitting; its lines never belong to a section.
- **Line numbers [D-33]**: `startLine`/`endLine` are 1-based, inclusive, and counted in the **original file** (status block included), because diffs, findings and conflicts address the stored file. `splitSections` therefore takes the original markdown and strips the block itself via `parseStatusBlock`.
- Boundary cases [D-33]: invalid UTF-8 is rejected where bytes are decoded (storage adapter → `STORAGE_ERROR`), symlink escape is tested in `LocalFolderStorage`; the pure functions receive strings only.
- **Anchor [D-2]**: `github-slugger` slug of the heading's plain text; duplicates get `-1`, `-2` … in document order; the slug `lead` from a real heading becomes `lead-1`.
- **Hash [D-3]**: SHA-256 of the section's source text from its heading line up to (not including) the next heading, after: CRLF/CR → LF, trailing whitespace removed from each line, trailing blank lines removed, a single final LF added. The heading line is included, so a rename changes the hash (evidence follows via `AnchorLink` in Phase 9).
- Title for the page: first H1's plain text, else the file name without `.md`, `-`/`_` → space, first letter upper-cased **[D-8]**.

### 3.4 Status block (`domain/status-block.ts`) [D-4]

```text
<!-- md-wiki:status
proposal: <slug>
decision: <decision uuid>
reviewer: agent | person
decided_at: 2026-11-23T10:42:00Z
-->
```

- Must be the first bytes of a published artifact, followed by one blank line.
- `parseStatusBlock(md) → { block: StatusBlock | null; body: string; warning?: 'MALFORMED_STATUS_BLOCK' }` [D-33]; malformed block → `block: null`, `body` = the input unchanged (treated as content), `warning` set; absent block → `block: null`, no `warning`. Never throws.
- `renderStatusBlock(block) + body` must round-trip byte-exactly with `parseStatusBlock`.
- Proposed content containing the string `<!-- md-wiki:status` anywhere → bundle validation error `RESERVED_MARKER`.

### 3.5 Snapshots and versions (`domain/snapshot-label.ts`)

- Label `YYYYMMDD-N`: UTC date of capture; `N` starts at 1 per `(path, date)` and increments.
- `nextLabel(existingLabelsForPathOnDate: string[], now: Date): string` (pure).
- Capturing a snapshot of a path whose latest snapshot has the same sha256 returns the existing one (dedupe).
- A page's **version label** = the label of the snapshot captured at index time or publish time.

### 3.6 Index (`apps/api/src/wiki/indexer`)

- On boot, on `POST /api/v1/admin/reindex` (owner), and after every publish: list storage → for each changed sha: capture snapshot, split sections, upsert `Page` and `PageSection` rows for the current version, refresh the search vector.
- **Topic [D-7]**: the first path segment. Display name from `wiki-meta/topics.md` (table `folder | name`) when present, else the folder title-cased. Files at the root have topic `general`.
- Out-of-band detection: if a file's sha differs from the last `Publication.afterSha256` for that path, `Page.changedOutsideReview = true` (shown as "Changed outside review"; next publish goes `stale`).
  The indexer reads the last published hash through a port `PublicationLookup.lastPublishedSha256(path) → Promise<string | null>` [D-36]. Until the `Publication` model exists (Phase 3/5) the production implementation returns `null`, and `null` means "never published through review" → `changedOutsideReview = false`. Tests inject a lookup that returns a hash. Since Phase 5 the lookup reads `Publication` (§7.4.10).

## 4. Data model (Phase 1–5 precise, later outline)

Prisma models (names are table names; all have `id uuid pk` unless shown):

```text
User(email unique citext, name, kind human|agent, roles Role[], teamId?, passwordHash?, disabledAt?, createdAt)
Team(name unique, slug unique)
Session(userId, tokenHash unique, csrfToken, createdAt, expiresAt, lastSeenAt, ip, userAgent)
ApiToken(userId, name, prefix unique, tokenHash, scopes Scope[], expiresAt?, revokedAt?, lastUsedAt?, createdAt)
Page(path unique, title, topic, isMeta, currentVersionLabel, currentSha256, changedOutsideReview, updatedAt)
Snapshot(path, label, sha256, content bytea, capturedAt)                     unique(path,label), index(path,sha256)
PageSection(path, versionLabel, anchor, title, level, ord, sectionHash, text, search tsvector)
                                                                             pk(path,versionLabel,anchor); GIN(search)
AuditEvent(actorId?, actorKind human|agent|system, action, subjectType, subjectId, data jsonb, at)   append-only
-- Phase 2 (Prisma precise in §7.2.1)
Draft(authorId, targetPath, baseSnapshotId?, scope jsonb, title, content text, reason, sources jsonb, appliesTo jsonb,
      createdAt, updatedAt)                                                  unique(authorId,targetPath)
Proposal(slug unique, title, targetPath, section?, submitterId, origin, state, reason, bundleHash, manifest bytea,
         base bytea?, proposed bytea, artifact bytea?, artifactHash?, baseSha256?, baseSnapshotId?, createdAt, updatedAt)
ProposalRef(proposalId, snapshotId, role target|scope|source, impact?, ord)
-- Phase 3 (Prisma precise in §7.4.1)
Assignment, Decision, Publication, Resolution, ConflictResolution, Withdrawal, PublishOutbox, PublishedSection
-- Phase 6 (Prisma precise in §7.5.1)
Topic, DiscussionEvent, DisputeEvent
-- Phase 7 (Prisma precise in §7.6.1)
AiJob proposal columns, Finding
```

Later phases (Discussions, AI jobs, agent review, credibility, reading) use the architecture.md data model verbatim; their `-00` spec task turns it into Prisma with indexes.

**Append-only enforcement**: `AuditEvent`, `DiscussionEvent`, `DisputeEvent`, `Finding`, and all credibility record tables get a Postgres trigger rejecting `UPDATE` and `DELETE` (migration test asserts it).

## 5. Identity, roles, permissions

### 5.1 Auth

- Password: argon2id (`m=19456, t=2, p=1`). Login rate limit: 5 failures / 15 min per (email, ip) → `429 RATE_LIMITED` with `Retry-After`.
- Session: random 32-byte token in cookie `mw_session` (httpOnly, SameSite=Lax, Secure when `NODE_ENV=production`, Path=/), stored as SHA-256. Idle expiry 7 days, absolute 30 days.
- CSRF: session row holds `csrfToken`; `GET /api/v1/auth/session` returns it; every non-GET cookie-authenticated request must send `X-CSRF-Token` equal to it → else `403 CSRF_INVALID`. Token-authenticated requests skip CSRF.
- API token format `mwt_<prefix8>_<secret32>` (base62); stored as SHA-256 of the whole token; shown once at creation.
- Owner seeded from `OWNER_EMAIL` + `OWNER_PASSWORD` on first boot if no owner exists. Reviewer agent user seeded in Phase 8.

### 5.2 Roles, scopes, actions (`domain/permissions.ts`)

Roles are cumulative: `reader < contributor < reviewer < publisher < owner`. Agent tokens carry scopes; effective permission = role allows **and** (session **or** token scope allows).

| Action | Min role | Token scope | Extra rule |
| --- | --- | --- | --- |
| `wiki.read`, `search`, `history.read` | reader | read | |
| `follow`, `attest`, `report`, `feedback` | reader | — (humans only) | not on own section version; agents never |
| `topic.open`, `comment` | reader / contributor | discuss | close/reopen and proposal topics: §7.5.3 |
| `dispute.write` (proposal dispute log, §7.5.3) | reviewer | review | never own proposal (`SELF_REVIEW`) [D-110] |
| `draft.*`, `proposal.submit` | contributor | contribute | |
| `proposal.read` (workspace lists, §7.4.8) | reviewer | review | [D-86] |
| `proposal.decide` | reviewer | review | must hold an open `Assignment`; never own proposal (`SELF_REVIEW`) |
| `proposal.publish` | publisher | publish | only when `AUTO_PUBLISH=false` |
| `credibility.decide` | reviewer + page author of path | — | page authors: §7.7.3 (D-164) |
| `source_check.record` (§7.7.3) | reviewer | review | never on own section version (`SELF_REVIEW`) [D-165] |
| `admin.*` (users, tokens, settings, reindex, recovery) | owner | — | |

`can(actor, action, ctx) → { ok: true } | { ok: false, code: ErrorCode }` is pure and exhaustively tested (table-driven).

## 6. Public API — Phase 1 (full contract)

| Method | Path | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/health` | none | | `{ status: 'ok', db: 'ok'\|'down', redis, storage, version }` | |
| GET | `/meta` | none | | `{ wikiName: string, wikiDescription: string }` from env `WIKI_NAME` (default `"Wiki"`), `WIKI_DESCRIPTION` (default `""`) **[D-44]** | |
| GET | `/auth/session` | any | | `{ user: MeDto \| null, csrfToken \| null }` | |
| POST | `/auth/login` | none | `{ email, password }` | `{ user: MeDto, csrfToken }` + cookie | `INVALID_CREDENTIALS` (401, same for unknown email), `RATE_LIMITED`, `ACCOUNT_DISABLED` |
| POST | `/auth/logout` | session | | `204` | |
| GET | `/wiki/tree` | read | `?topic=` | `{ topics: { id, name, pageCount, pages: PageSummaryDto[] }[] }` | |
| GET | `/wiki/pages/{path}` | read | path URL-encoded | `PageDto` | `NOT_FOUND`, `INVALID_PATH` |
| GET | `/wiki/pages/{path}/history` | read | cursor | `Page<VersionDto>` | |
| GET | `/wiki/pages/{path}/versions/{label}` | read | | `PageDto` for that snapshot | |
| GET | `/wiki/recent` | read | `?scope=all\|mine&limit` | `Page<RecentChangeDto>` (`mine` empty until Phase 9 follows) | |
| GET | `/search` | read | `?q&labels[]&topics[]&updated=any\|30d\|1y&sort=relevance\|trust\|recent&cursor&limit` | `{ total, pageCount, facets: { labels: Record<Label,int>, topics: {id,name,n}[] }, items: SearchHitDto[], nextCursor }` | `VALIDATION_FAILED` (q empty or > 200 chars) |
| GET | `/context` | read (agents) | `?path` | `{ path, versionLabel, sha256, content, sections: SectionDto[] }` | |
| POST | `/admin/reindex` | owner | | `{ scanned, changed, durationMs }` | |
| GET/POST/PATCH | `/admin/users`, `/admin/users/{id}` | owner | POST `{ email, name, roles, teamId, password? }`; PATCH: any subset of those plus `disabled?: boolean` [D-38] | `UserDto` | `EMAIL_TAKEN`, `LAST_OWNER` |
| GET/POST | `/admin/teams` | owner | `{ name }` | `TeamDto` | |
| GET/POST/DELETE | `/admin/tokens`, `/admin/tokens/{id}` | owner | `{ userId, name, scopes, expiresAt? }` | create returns `{ token, ...ApiTokenDto }` once | |

**Users [D-38].** `UserDto = { id, email, name, kind: 'human'|'agent', roles: Role[], teamId: string | null, disabled: boolean, createdAt }` — never a password hash. PATCH `disabled: true` sets `User.disabledAt = now` and deletes that user's sessions (tokens of a disabled user are rejected with `ACCOUNT_DISABLED` by the token guard); `disabled: false` clears `disabledAt`. `LAST_OWNER` (409) whenever a PATCH (removing `owner` from roles, or `disabled: true`) would leave no enabled **human** user with the `owner` role **and a password** (an owner who cannot sign in does not count). Audit events: `user.created`, `user.updated` (payload lists changed fields, never the password).

**Auth and admin DTOs [D-40].**
- `MeDto = { id, email, name, kind, roles, teamId: string | null }` (a session or token user is always enabled, so no `disabled`).
- `TeamDto = { id, name, slug }`. `ApiTokenDto = { id, userId, name, prefix, scopes, createdAt, expiresAt: string | null, lastUsedAt: string | null, revokedAt: string | null }` — never the secret or hash; the full token appears only in the create response.
- `GET /admin/users`, `/admin/teams`, `/admin/tokens` use the §2 cursor envelope `Page<T>` (`?limit&cursor`, ordered by `createdAt, id`).
- `GET /auth/session` never fails on bad credentials: a missing, unknown or expired session cookie returns `200 { user: null, csrfToken: null }` (and clears the cookie). A valid bearer token returns `{ user, csrfToken: null }`. An invalid, revoked or expired bearer token presented on any endpoint (including this one) → `401 UNAUTHENTICATED`; a token of a disabled user → `403 ACCOUNT_DISABLED`.
- `POST /admin/tokens` with a scope the target user's role does not allow (or an unknown scope) → `400 VALIDATION_FAILED` (the caller is authorized; the input is invalid).

DTOs:

```ts
type Label = 'checked' | 'reviewed' | 'not_reviewed' | 'recheck' | 'error';
interface LabelDto { label: Label; since: string | null; reviewerKind: 'agent' | 'person' | null; reason: string | null }
interface SectionDto { anchor: string; title: string; level: number; hash: string; label: LabelDto; warn: { reason: string; fixProposalSlug: string | null } | null }
interface PageDto { path: string; title: string; topic: { id: string; name: string }; versionLabel: string; sha256: string;
  updatedAt: string; changedOutsideReview: boolean; markdown: string /* status block stripped */;
  sections: SectionDto[]; pageLabel: { label: Label; spread: Record<Label, number> };
  maintainers: { name: string }[]; usedByTeams: number | null /* null until Phase 9 */ }
interface SearchHitDto { path: string; pageTitle: string; anchor: string; sectionTitle: string; label: LabelDto;
  snippet: { before: string; hit: string; after: string }[]; meta: { updatedAt: string; checkedBy: number | null; sourceName: string | null; usedByTeams: number | null } }
```

**Labels before Phase 9**: the API returns `not_reviewed` for every section whose published versions include no review, and `reviewed` (with `reviewerKind`) once Phase 3 publishes reviewed content. The label is always computed by `domain/labels.ts#computeSectionLabel` (precedence table in architecture.md › Label precedence), which ships in Phase 1 with only rules 3 and 5 reachable and the other rules' inputs empty.

**Label metadata when several records satisfy the winning rule [D-34]**: rules 1–2 (*Confirmed error*, *Under re-check*) take the **earliest** still-open record — `since` = its time, `reason` = its reason (the section has been in that state since then); rules 4–5 (*Checked*, *Reviewed*) take the **most recent** valid record — `since` = its time, `reviewerKind` = its kind. Ties on time: `person` before `agent`, then the lower record id (UUIDv7 = creation order). Rule 3 has `since = null`, `reviewerKind = null`. **`pageLabel([])`** (no sections, e.g. an empty file) = `not_reviewed` with all five spread counts 0.

**Search rules**: section-level `tsvector` (`english` config, title weight A, text weight B); relevance = `ts_rank_cd`. `sort=trust` orders by label rank (`checked, reviewed, not_reviewed, recheck, error`) then relevance; `sort=recent` by `updatedAt desc`. The label filter excludes labels not selected **except `recheck` hits, which are always returned** (ux.md › Search). Label never enters `relevance`. Snippet: `ts_headline` with `StartSel/StopSel` sentinels split into `before/hit/after` server-side (no HTML from the server).

**Read DTOs not spelled out above [D-41]** (Phase 1 values; later phases fill the nullable fields):
- `PageSummaryDto = { path, title, pageLabel: { label, spread }, updatedAt }`. `/wiki/tree?topic=<id>` returns only that topic (unknown id → empty `topics`); topics and pages sorted by name/title, then path.
- `VersionDto = { versionLabel, sha256, capturedAt }` from `Snapshot` rows, newest first. `/versions/{label}` for an unknown label → `404 NOT_FOUND`; its `PageDto` uses that snapshot's content, sections and labels as computed for those section hashes.
- `RecentChangeDto = { path, pageTitle, versionLabel, at, changedOutsideReview }` — one item per captured snapshot, newest first; `scope=mine` returns an empty page before Phase 9.
- `PageDto.maintainers = []` and `usedByTeams = null` until the phases that introduce them.
- `/search`: `total` = number of matching **sections** after filters, `pageCount` = distinct pages among them; `facets.labels` is counted with every filter applied except the label filter, `facets.topics` with every filter except the topic filter. Up to 2 snippet fragments per hit. `meta.checkedBy`, `meta.sourceName`, `meta.usedByTeams` are `null` before Phase 9. `q` is required, trimmed, 1–200 chars, else `400 VALIDATION_FAILED`; unknown `sort`/`updated`/label values → `400 VALIDATION_FAILED`.
- `/context?path` returns `content` = the markdown with the status block stripped (same as `PageDto.markdown`); missing → `NOT_FOUND`, bad path → `INVALID_PATH`.

## 7. Public API — later phases (outline, expanded by each `-00` task)

| Phase | Endpoints |
| --- | --- |
| P4 Contribute (**full contract: §7.2**) | `GET/POST/PATCH/DELETE /drafts[/{id}]` (autosave `PATCH` with `If-Match: <updatedAt>`), `POST /drafts/{id}/sources`, `POST /drafts/{id}/rebase`, `POST /drafts/{id}/submit` → `ProposalDto`, `POST /contributions` (agent bundle), `GET /contributions/{slug}`, `POST /contributions/import` (`.contribution.md` v3), `GET /drafts/{id}/export` |
| P5 Review/publish (**full contract: §7.4**) | `GET /proposals?state&tab&cursor`, `GET /proposals/{slug}` (incl. `preview` artifact + hashes), `GET /proposals/{slug}/diff`, `POST /proposals/{slug}/decisions` `{ approve, reason, bundleHash, artifactHash, previewAt, discussionVersion, disputeVersion }`, `POST /proposals/{slug}/publish`, `POST /proposals/{slug}/conflict` `{ outcome: keep_current\|use_incoming\|merge, replacement? }`, `GET /ops/blocked`, `POST /ops/blocked/{slug}/resolution`, `GET /audit`, `GET /events` (SSE) |
| P6 Discussions/MCP (**full contract: §7.5**) | `/topics`, `/topics/{id}/comments`, `/proposals/{slug}/discussion`, `/proposals/{slug}/disputes`, MCP at `/mcp` (streamable HTTP) |
| P7 Quality (**full contract: §7.6**) | `POST /proposals/{slug}/quality-check`, `GET /proposals/{slug}/findings`, internal `GET /internal/v1/jobs/{id}/input`, `POST /internal/v1/jobs/{id}/result`, `/admin/models`, `/admin/rules` |
| P8 Agent review | `GET /inbox?tab`, `POST /proposals/{slug}/escalations`, `/admin/review-settings`, `POST /admin/agent/pause` |
| P9 Credibility (**full contract: §7.7**) | `/sections/{path}/{anchor}/why`, `/attestations`, `/reports`, `/source-checks`, `/owner-confirmations`, `/page-feedback`, `/follows`, `/notifications`, `/me/*`, `/credibility/queue`, `/credibility/pages`, `/credibility/sources`, internal invalidation/candidate endpoints |

### 7.1 Job wire contract (binding from Phase 0; later job kinds add an input/output pair only)

- **Queue**: one BullMQ queue `mw-jobs` on `REDIS_URL`. BullMQ job **name** = `kind`, BullMQ job **id** = `AiJob.id` (UUIDv7, so re-enqueueing the same row is a no-op). Attempts 3, exponential backoff 5 s; the API owns retries of the row state, the worker never writes to Postgres.
- **Queue payload** `JobEnvelope` (JSON Schema `packages/contracts/jobs/envelope.schema.json`): `{ "v": 1, "jobId": uuid, "kind": JobKind }`. Nothing else travels through Redis; inputs are fetched from the internal API so secrets and large inputs never sit in Redis.
- `JobKind` (Phase 0): `"ping"`; Phase 7 adds `"quality_check"` (§7.6.3). Later phases add `quality_check`, `agent_review`, credibility kinds.
- **Input**: `GET /internal/v1/jobs/{id}/input` → `200 { "jobId", "kind", "input": <kind input> }`; `404 NOT_FOUND` unknown id; `409 PRECONDITION_FAILED` when the job is not `queued`/`running` (already finished). First fetch moves the row `queued → running` and sets `startedAt`.
- **Result**: `POST /internal/v1/jobs/{id}/result` body `JobResult` = `{ "status": "ok", "output": <kind output> }` or `{ "status": "failed", "error": { "code": string (1..64, `^[a-z0-9_]+$`), "message": string (1..500) } }` → `204`. Output validated against the kind's schema (`400 VALIDATION_FAILED` otherwise). Posting to a finished job: identical body → `204` (idempotent), different body → `409 PRECONDITION_FAILED`.
- **Ping** (dev only): `PingInput { "message": string 1..200 }`, `PingOutput { "echo": string (must equal input.message), "workerVersion": string 1..40 }`. The API rejects an `ok` result whose `echo` ≠ `message` with `400 VALIDATION_FAILED` (row stays running).
- **Row**: `AiJob(id, kind, status queued|running|succeeded|failed, input Json, output Json?, error Json?, createdAt, startedAt?, finishedAt?)` for Phase 0; the proposal-related columns of architecture.md are added by P7-00.
- Dev endpoints (only `NODE_ENV !== "production"`, otherwise 404): `POST /api/v1/dev/ping { message }` → `201 { id, status }`; `GET /api/v1/dev/ping/{id}` → `{ id, status, input, output?, error?, createdAt, finishedAt? }`.
- Schemas live in `packages/contracts/jobs/*.schema.json` (JSON Schema 2020-12): `envelope`, `result`, `ping.input`, `ping.output`. TS types and pydantic v2 models are generated from them; neither side hand-writes these shapes.

### 7.2 Phase 4 — Contribute (full contract, P4-00)

Behavioural spec: `md-wiki/wiki_worker/core/bundle.py` (`validate_bundle`, `contribution_file`), `core/context.py` (pinned references, freshness) and their tests (`test_workflow.py`, `test_context.py`, `test_web.py`). Decisions D-55 … D-69.

#### 7.2.1 Data model (Prisma)

```text
enum ProposalState   pending | approved | published | rejected | stale
enum ProposalOrigin  editor | api | import                         -- how it arrived; never part of the bundle
enum ProposalRefRole target | scope | source

Draft(id, authorId → User, targetPath, baseSnapshotId? → Snapshot, scope jsonb, title text default '',
      content text, reason text default '', sources jsonb, appliesTo jsonb, createdAt, updatedAt timestamptz(3))
      unique(authorId, targetPath)  index(authorId, updatedAt)
Proposal(id, slug unique, title, targetPath, section?, submitterId → User, origin, state default pending,
      reason, bundleHash, manifest bytea, base bytea?, proposed bytea, artifact bytea?, artifactHash?,
      baseSha256?, baseSnapshotId? → Snapshot, createdAt, updatedAt)
      index(submitterId, createdAt)  index(targetPath, state)
ProposalRef(id, proposalId → Proposal, snapshotId → Snapshot, role, impact?, ord)  unique(proposalId, role, snapshotId)
```

- `Draft.scope = { section: string | null }` — the anchor of the base section being edited, `null` = whole page **[D-56]**.
- `Draft.sources = [{ path, snapshotId, versionLabel, sha256, addedAt }]` (ordered by add time, ≤ 32). `Draft.appliesTo = [{ name, version }]` (≤ 16).
- `Draft.content` is the **editable region** **[D-56]**: the source text of the scoped section (heading line to the line before the next root heading, exactly `Section.text`), or the whole body (status block stripped) for page scope, or the new file for a create (no base).
- Proposals are frozen: a trigger rejects `UPDATE` of `slug, targetPath, submitterId, origin, bundleHash, manifest, base, proposed, baseSha256, baseSnapshotId, createdAt` and rejects `DELETE`; `ProposalRef` is append-only (UPDATE/DELETE rejected). Only `state`, `artifact`, `artifactHash`, `updatedAt` change later (Phase 5) **[D-57]**.

#### 7.2.2 Bundle (`domain/bundle.ts`) [D-58]

A bundle is `(manifest bytes, base bytes | null, proposed bytes)`. Every submission path (editor submit, `POST /contributions`, `.contribution.md` import) builds its manifest with the **same** `buildManifest` and the same serializer, then runs the **same** `validateBundle`; the stored structure is therefore identical whatever the origin (P4-G).

```ts
interface SnapshotRef { path: string; version: string; hash: string }          // version = YYYYMMDD-N
interface Manifest {                                                            // keys serialized in this order
  schema_version: 1;
  id: string;                      // proposal slug (D-6, §7.2.5)
  target: string;                  // wiki path
  base_hash: string | null;        // sha256(base) or null for a new page
  proposed_hash: string;           // sha256(proposed)
  title: string;                   // 1..120 chars, trimmed non-empty
  reason: string;                  // 1..4000 chars, trimmed non-empty
  section: string | null;          // scoped base anchor or null (whole page / create)
  context: { target: { path: string; version: string | null; hash: string | null }; sources: SnapshotRef[] };
  scope_impact: { path: string; version: string | null; impact: string }[];   // primary target first
  source_references: { path: string; version: string }[];                      // = context.sources without hash
  applies_to: { name: string; version: string }[];
  author_metadata?: { name?: string; role?: string; expert?: string; metadata_source?: string };  // import only
}
```

- Serialization: `JSON.stringify` of an object built with the key order above, no whitespace, UTF-8, no trailing newline. **`bundleHash = sha256(manifest bytes)`** (as md-wiki: base and proposed are bound through `base_hash`/`proposed_hash`).
- `scope_impact[0] = { path: target, version: base version | null, impact }`; default impact (when none given): `Edits section #<anchor>` / `Edits the whole page` / `Creates the page`. Further rows are related files (agents and import only in Phase 4 **[D-59]**), each pinned to an existing snapshot.
- `validateBundle({ manifest, base, proposed }) → Result<ValidBundle, BundleIssue>`, `BundleIssue = { code: BundleCode; message: string }`. Checks, in this order (first failure wins):

| `BundleCode` | Rule (ported from `validate_bundle` / `context.validate` unless marked new) |
| --- | --- |
| `TOO_LARGE` | manifest, base, proposed each ≤ 1 MiB (1 048 576 bytes) |
| `INVALID_JSON` | manifest is UTF-8 JSON whose top level is an object |
| `DUPLICATE_KEY` | no object in the manifest repeats a key (at any depth) |
| `FIELDS` | required keys present, no unknown keys (`author_metadata` optional), each with its type |
| `SCHEMA_VERSION` | `schema_version` is the integer 1 |
| `INVALID_ID` | `id` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 80 chars (the status-block proposal grammar, §3.4) |
| `INVALID_TARGET` | `target` passes `validateWikiPath` (§3.1) |
| `TITLE_REQUIRED` / `REASON_REQUIRED` | trimmed non-empty, ≤ 120 / ≤ 4000 chars (title: new) |
| `INVALID_HASH` | `proposed_hash` and non-null `base_hash` are 64 lowercase hex |
| `MODE_MISMATCH` | `base_hash === null` ⇔ base bytes absent |
| `HASH_MISMATCH` | sha256(proposed) = `proposed_hash`; sha256(base) = `base_hash` |
| `NOT_UTF8` | proposed and base decode as strict UTF-8 |
| `RESERVED_MARKER` | proposed contains no `<!-- md-wiki:status` (§3.4) |
| `INVALID_CONTEXT` | `context.target.path = target`, `context.target.hash = base_hash`, version `null` ⇔ create, else `^\d{8}-\d+$`; ≤ 32 sources, each a valid path + version + hex hash, paths unique and ≠ target |
| `INVALID_SCOPE` | `scope_impact` non-empty, row 0 = `{target, context.target.version}`, paths unique, every impact trimmed non-empty ≤ 500, other rows have a version and are not the target |
| `INVALID_SOURCES` | `source_references` equals `context.sources` (path, version, same order) |
| `INVALID_APPLIES_TO` | ≤ 16 rows, name 1..100 and version 1..50 trimmed non-empty, names unique (case-insensitive) |
| `INVALID_AUTHOR_METADATA` | only the four keys, each a trimmed non-empty string ≤ 200 |
| `UNKNOWN_SECTION` | `section` is `null`, or (base present) an anchor of `splitSections(base)`; must be `null` for a create (new) |
| `NO_CHANGE` | proposed bytes ≠ base body bytes (base with its status block stripped) (new) |

- API mapping of a `BundleIssue`: `TOO_LARGE` → `413 PAYLOAD_TOO_LARGE`; `INVALID_TARGET` → `400 INVALID_PATH`; any other → `400 VALIDATION_FAILED` with `fields: [{ path: 'bundle', code: <BundleCode>, message }]`. A pinned reference that does not resolve (unknown path/version, or the snapshot row's bytes no longer hash to its `sha256`) → `400 VALIDATION_FAILED` with field code `UNKNOWN_VERSION` (md-wiki "unknown or modified context snapshot").
- Not ported: md-wiki's free-text `sources: string[]` (replaced by pinned refs), `knowledge_change` (no counterpart), Windows device names (`con.md`) — §3.1 paths stay binding **[D-58]**.

#### 7.2.3 Composition and rebase (`domain/draft.ts`) [D-56, D-60]

- `composeProposed(baseBody: string | null, section: string | null, content: string) → Result<string, 'UNKNOWN_SECTION'>`: create or page scope → `content`; section scope → `baseBody` with that section's text replaced by `content`; when another section follows and `content` does not end with a line break, one `\n` is appended so the next heading stays on its own line. Pure, byte-exact elsewhere.
- `regionOf(baseBody, section) → { text, startLine } | null`: the editable region and its 1-based start line in the **stored** file (status block lines counted, D-33).
- `rebasePlan(draft, base, current, mode)`; inputs are the pinned base body, the current body and the draft:

| Situation | `mode: auto` | `mode: keep_mine` |
| --- | --- | --- |
| current sha = pinned sha | no-op | no-op |
| draft unedited (content = base region) | re-pin, content := current region | same as auto |
| section scope, section hash equal in both versions | re-pin, content kept | re-pin, content kept |
| section scope, section changed | `409 SECTION_CHANGED` | re-pin, content kept (replaces the new section) |
| section scope, section removed in current | `409 SECTION_CHANGED` | `409 SECTION_CHANGED` (switch to whole page first) |
| page scope, page changed and draft edited | `409 STALE_BASE` | re-pin, content kept (replaces the whole page) |
| target removed, or created since a create-draft was opened | `409 STALE_BASE` | `409 STALE_BASE` |

#### 7.2.4 Pinning and freshness [D-55]

- **Observe** (`WikiIndexer.observe(path)`, under the storage root lock): read the file; if its sha differs from the indexed one, index that path exactly as a reindex would (snapshot capture with dedupe, `Page`/`PageSection` rows); return `{ snapshotId, versionLabel, sha256, content }` or `null` when the file does not exist. This is md-wiki's `observe`: every pin is a registered, immutable snapshot.
- Pin target on open (`POST /drafts`), pin each source when added (`POST /drafts/{id}/sources`): the observed snapshot.
- `DraftDto.baseChanged` (on every read) compares the pinned sha with the **indexed** `Page.currentSha256` (no storage IO on reads); submit and rebase observe storage live.
- Submit (and `POST /contributions`, import) run under the root lock: target observed sha ≠ pinned base sha (or file appeared/disappeared) → `409 STALE_BASE`; any source or related-scope file whose observed sha ≠ its pinned sha (or now missing) → `409 SOURCE_CHANGED` with `fields: [{ path: 'sources[i]' | 'scope[i]', code: 'SOURCE_CHANGED', message: <path> }]`. Nothing is recaptured silently (md-wiki `test_stale_draft_is_rejected_without_recapturing_source`).

#### 7.2.5 Slugs and titles (D-6) [D-61]

- `slugify(title)`: NFKD, strip combining marks, lowercase, every run of characters outside `[a-z0-9]` → `-`, trim `-`, cut to ≤ 60 chars at the last `-` before the limit (hard cut if none), empty → `suggestion`.
- Unique: the first of `s`, `s-2`, `s-3`, … not used by any proposal (checked in the insert transaction; a unique-violation race retries with the next suffix, max 5).
- Title: the draft/contribution `title` when non-blank, else `deriveTitle(reason)` = the first line of the reason, trimmed, cut to ≤ 80 chars at a word boundary with `…`. The editor has no title field (none is drawn), so editor titles are derived **[D-61]**.
- An explicit `slug` (agents; the `ID` of a `.contribution.md`) must match the `INVALID_ID` grammar and is used as is: if a proposal with that slug exists and has the **same submitter and bundleHash**, the call is an idempotent replay → `200` with that proposal (md-wiki `submit`); otherwise `409 ALREADY_EXISTS`.

#### 7.2.6 Endpoints

All under `/api/v1`; permission per §5.2 (`draft.*` / `proposal.submit`, token scope `contribute`). Drafts are private: another user's draft id → `404 NOT_FOUND`. `If-Match` carries `DraftDto.updatedAt` (ISO with ms, quotes optional); responses that return a draft also set `ETag: "<updatedAt>"`. JSON body limit 5 MiB (the 4 MiB + 64 KiB contribution file fits).

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/drafts` | `draft.read` | `?limit&cursor` | `Page<DraftDto>` own drafts, `updatedAt desc, id desc` | `VALIDATION_FAILED` |
| POST | `/drafts` | `draft.create` | `{ targetPath, section?: string \| null }` | `201 DraftDto` new · `200 DraftDto` the author's existing draft for that path (resume; its own scope is kept) **[D-62]** | `INVALID_PATH`, `NOT_FOUND` (section given and page missing), `VALIDATION_FAILED` (`section` not in the current version; field `section`), `STORAGE_ERROR` |
| GET | `/drafts/{id}` | `draft.read` | | `DraftDto` | `NOT_FOUND` |
| PATCH | `/drafts/{id}` | `draft.update` | header `If-Match`; any subset of `{ content, reason, title, appliesTo, scope: { section: null } }` | `DraftDto` (new `updatedAt`) | `VALIDATION_FAILED` (missing/invalid `If-Match`, field rules), `PRECONDITION_FAILED` (`If-Match` ≠ current `updatedAt`), `PAYLOAD_TOO_LARGE` (content > 1 MiB UTF-8), `NOT_FOUND` |
| DELETE | `/drafts/{id}` | `draft.delete` | | `204` | `NOT_FOUND` |
| POST | `/drafts/{id}/sources` | `draft.update` | `{ path }` | `DraftDto` | `INVALID_PATH`, `NOT_FOUND` (draft, or the source file), `VALIDATION_FAILED` (source = target, already pinned, > 32) |
| DELETE | `/drafts/{id}/sources/{path}` | `draft.update` | path URL-encoded | `DraftDto` | `NOT_FOUND` (draft or not pinned) |
| POST | `/drafts/{id}/rebase` | `draft.update` | `{ mode?: 'auto' \| 'keep_mine' }` (default auto) | `DraftDto` | `SECTION_CHANGED`, `STALE_BASE` (table §7.2.3), `NOT_FOUND` |
| POST | `/drafts/{id}/submit` | `proposal.submit` | header `If-Match` | `201 ProposalDto` (`state: 'pending'`, origin `editor`); the draft is deleted in the same transaction | `VALIDATION_FAILED` (`If-Match`; reason blank → field `reason`; bundle codes), `PRECONDITION_FAILED`, `STALE_BASE`, `SOURCE_CHANGED`, `PAYLOAD_TOO_LARGE`, `NOT_FOUND` |
| GET | `/drafts/{id}/export` | `draft.read` | | `200 text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>.contribution.md"` (v3, §7.2.7) | `NOT_FOUND`, `PRECONDITION_FAILED` (draft has no base: v3 needs a versioned primary file), `VALIDATION_FAILED` (reason blank; field `reason`) |
| POST | `/contributions` | `proposal.submit` | `ContributionInput` | `201 ProposalDto` (origin `api`) · `200` idempotent replay | `VALIDATION_FAILED` (DTO, `UNKNOWN_VERSION`, bundle codes), `INVALID_PATH`, `STALE_BASE`, `SOURCE_CHANGED`, `ALREADY_EXISTS`, `PAYLOAD_TOO_LARGE` |
| GET | `/contributions/{slug}` | `wiki.read` | | `ContributionDto` | `NOT_FOUND` (unknown, or caller is neither the submitter nor role ≥ reviewer **[D-63]**) |
| POST | `/contributions/import` | `proposal.submit` | `{ file: string }` (the `.contribution.md` text) | `201 ProposalDto` (origin `import`) · `200` idempotent replay | as `POST /contributions`, plus field code `CONTRIBUTION_FORMAT` for envelope errors; file > 4 MiB + 64 KiB → `PAYLOAD_TOO_LARGE` |
| GET | `/me/suggestions` | `draft.read` | `?limit&cursor` | `{ items: SuggestionDto[], nextCursor, total }` — the caller's drafts and proposals, `at desc, id desc` **[D-64]** | `VALIDATION_FAILED` |

```ts
interface PinnedRefDto { path: string; versionLabel: string; sha256: string }
interface DraftSourceDto extends PinnedRefDto { addedAt: string; changed: boolean /* indexed sha ≠ pinned */ }
interface DraftDto {
  id: string; targetPath: string; pageTitle: string;
  section: string | null; sectionTitle: string | null;       // title of the scoped base section
  title: string; content: string; reason: string; appliesTo: { name: string; version: string }[];
  base: (PinnedRefDto & { capturedAt: string }) | null;      // null = new page
  baseText: string;                                          // base region text ('' for a create) → Changes tab
  baseStartLine: number;                                     // first line of the region in the stored file (1 for create)
  current: PinnedRefDto | null;                              // indexed current version of the target
  baseChanged: boolean;                                      // current sha ≠ base sha (or existence differs)
  sectionChanged: boolean;                                   // baseChanged and the scoped section's hash differs or is gone
  currentText: string | null;                                // region text in `current` when baseChanged, else null
  sources: DraftSourceDto[];
  createdAt: string; updatedAt: string;
}
interface ProposalDto {
  id: string; slug: string; title: string; targetPath: string; pageTitle: string;
  section: string | null; sectionTitle: string | null;
  state: 'pending' | 'approved' | 'published' | 'rejected' | 'stale';
  origin: 'editor' | 'api' | 'import';
  submitter: { id: string; name: string; kind: 'human' | 'agent' };
  reason: string; bundleHash: string; proposedSha256: string;
  base: PinnedRefDto | null;
  sources: PinnedRefDto[];
  scope: { path: string; versionLabel: string | null; impact: string }[];
  appliesTo: { name: string; version: string }[];
  createdAt: string;
}
interface ContributionDto extends ProposalDto { manifest: string /* exact bytes */; proposed: string }
interface ContributionInput {
  targetPath: string;
  base: { versionLabel: string; sha256: string } | null;    // what the agent read via /context; null = new page
  content: string;                                          // the complete proposed Markdown (no status block)
  reason: string; title?: string; slug?: string; section?: string | null; targetImpact?: string;
  sources?: { path: string; versionLabel: string }[];       // ≤ 32
  scope?: { path: string; versionLabel: string; impact: string }[];   // related files, ≤ 32
  appliesTo?: { name: string; version: string }[];
}
interface SuggestionDto {
  kind: 'draft' | 'proposal'; id: string; slug: string | null;
  targetPath: string; pageTitle: string; section: string | null; sectionTitle: string | null;
  title: string;                                            // draft: title or derived from reason ('' if neither)
  state: 'draft' | ProposalDto['state'];
  needsAttention: boolean;                                  // draft.baseChanged, or proposal state stale
  at: string;                                               // draft updatedAt / proposal createdAt
}
```

- `POST /contributions`: `base` must resolve to the snapshot row `(targetPath, versionLabel)` with that `sha256` (else `UNKNOWN_VERSION`) and be the observed current version (else `STALE_BASE`); `base: null` requires the file to be absent (else `STALE_BASE`). `sources`/`scope` resolve `(path, versionLabel)` to snapshot rows (`UNKNOWN_VERSION`) and must be current (`SOURCE_CHANGED`). A file may appear in both `scope` and `sources` only with the same version (`INVALID_SCOPE`).
- Submitter identity is always the caller (session or token user); a contribution file's `Author` cell is informational and ignored (md-wiki: "the verified submitter comes from the caller").
- `pageTitle`: the indexed `Page.title`, else `pageTitle(path, [])` (§3.3).

#### 7.2.7 `.contribution.md` v3 (`domain/contribution-file.ts`) [D-65]

Byte-compatible with md-wiki `contribution_file` (envelope, framing, `\|` / `<br>` / `\\` escapes, boundary `wc-[a-z0-9-]{1,200}` absent from both payloads, the three breaks each exactly once and in order, file ends with the end break, payload framing of exactly two LF, size ≤ 4 MiB + 64 KiB, strict UTF-8). Required fields `Format` (= `wiki-contribution-v3`), `Boundary`, `ID`, `Base SHA-256`, `Proposed SHA-256`, `Author`, `Reason`; duplicate fields rejected. Optional fields kept: `Author name|role|expert|metadata source` → `author_metadata`; new optional fields `Title`, `Section` (anchor), `Applies to` (`name = version` lines joined by `<br>`) — md-wiki ignores unknown rows, so exported files stay md-wiki-readable. Scope table rows `| path | YYYYMMDD-N | impact |` (≥ 1, primary first, unique); Sources rows `| path | YYYYMMDD-N |` (unique). The primary row's snapshot hash must equal `Base SHA-256`; a file in both tables must use one version; the target may not appear in Sources. `ID` becomes the explicit slug (§7.2.5). Envelope errors → field code `CONTRIBUTION_FORMAT`; resolution and bundle errors as `POST /contributions`.

`renderContribution(bundle)` produces the file for `GET /drafts/{id}/export`: fields in the order above, a fresh boundary `wc-<16 hex>` regenerated until absent from both payloads, ID = the slug the draft would get now (not reserved). `parseContribution(renderContribution(x))` round-trips the bundle exactly (tested).

#### 7.2.8 Audit events [D-66]

`draft.created {targetPath, section, baseVersion}` · `draft.rebased {from, to, mode}` · `draft.discarded {targetPath}` · `proposal.submitted {slug, targetPath, origin, bundleHash}` (subject `proposal`). Autosave and source pins are not audited (they are private draft state; the submitted bundle records what was pinned).

#### 7.2.9 Web (F-06 Editor, F-05 Your suggestions, F-03 entry) [D-67, D-68, D-69]

- Route `/wiki/*path/edit?section=`: on mount `POST /drafts` (create-or-resume) and cache the result under `['draft', id]`; autosave = debounced (800 ms) `PATCH` with `If-Match`, one request in flight, the latest local text always wins locally; a `PRECONDITION_FAILED` reloads the draft and shows the error callout (input stays). Tabs Write · Preview · Changes; Changes = `domain/line-diff` of `baseText` → `content`, line numbers offset by `baseStartLine`.
- *Whole page* = `PATCH scope: { section: null }` (the server splices the region into the body); hidden when already whole page.
- Base changed banner (frame `baseChanged`): copy from `sectionChanged`; *Compare and rebase* → `POST rebase {auto}`; on `SECTION_CHANGED`/`STALE_BASE` the Changes tab compares `currentText` → `content` and offers *Keep my text and rebase* (`keep_mine`). Submit stays disabled while `baseChanged`.
- Not rendered in Phase 4 (no data): *What happens to evidence* (Phase 9), *Self-check (AI)* (Phase 7), source tier/retraction meta (Phase 9).
- `/me`: only the *Your suggestions* tab (count = `total`) renders; *Followed pages*, *Your checks and reports*, *Tell me when*, *Your part this year* belong to Phase 9.
- F-03 header *Suggest an edit* links to `/wiki/<path>/edit?section=<selected anchor>` (no `section` when nothing is selected); shown to roles ≥ contributor.

### 7.3 Worker providers (Phase 7 foundation) [D-70 … D-74]

Worker-only; no job kind, schema or endpoint is added here (the `quality_check` wiring comes with P7-00). Code: `services/worker/src/mdwiki_worker/providers/` and `.../quality/`.

- **Provider** protocol: `complete(StructuredRequest{ system, user, schema, schemaName }) → StructuredResult{ data: object, provider, model, usage{ input_tokens, output_tokens } }`. Implementations: `anthropic` (official SDK, native structured outputs `output_config.format = { type: json_schema, schema }`, SDK retries off), `openai_compat` (httpx `POST {OPENAI_COMPAT_BASE_URL}/chat/completions`, `response_format = { type: json_schema, json_schema: { name, schema, strict: false } }`), `fake` (scripted objects / raw text / errors, tests only). `complete_structured(provider, request, OutputModel)` validates `data` with the pydantic output model whose JSON schema was sent.
- **Config per job kind** (pydantic-settings): `AI_DEFAULT__{PROVIDER,MODEL,MAX_TOKENS,TIMEOUT_S,TEMPERATURE,MAX_ATTEMPTS}` (defaults `anthropic`, `claude-sonnet-5-5`, 4096, 120 s, unset, 3), override per kind with `AI_JOBS__<KIND>__<FIELD>`; credentials `ANTHROPIC_API_KEY`, `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY`. `temperature` is rejected for `anthropic` (the SDK/current models take no sampling parameters). Every later result records provider and model.
- **Error codes** (go into `JobResult.error.code`, message ≤ 500 chars, single line, never content or secrets):

| Code | When | Retried |
| --- | --- | --- |
| `provider_timeout` | client timeout; HTTP 408/504 | yes |
| `rate_limited` | HTTP 429 (honours `Retry-After`) | yes |
| `provider_error` | connection failure, HTTP 5xx/529 (retried); other 4xx, refusal, malformed envelope (not retried) | see left |
| `schema_invalid` | output not JSON, not an object, cut off at `max_tokens`, or fails the output model | no |

  Retry: at most `max_attempts` calls; delay `1 s × 2^(n-1)` (or `Retry-After` if larger), capped at 30 s. BullMQ attempts (§7.1) are separate and only cover worker crashes/transport errors to the internal API.
- **Fencing**: untrusted text (wiki page, base, proposal, sources, discussion) enters the user message as `<<<DATA id="<id>" kind="<kind>" nonce="<32 hex>">>>\n…\n<<<END id="<id>" nonce="<nonce>">>>`; block ids `^[a-z][a-z0-9-]{0,39}$`, unique; the nonce is 128 random bits per prompt and no block may contain it, so content cannot close its block. The system prompt carries the rules and the instruction that only markers with that nonce are real and block contents are data.
- **Rules file**: UTF-8 Markdown ≤ 64 KiB (BOM/CRLF tolerated); each `## ` heading outside code fences is a rule, id = heading slug or explicit trailing `{#id}`; duplicate ids, no rules or invalid UTF-8 → error. SHA-256 is over the file's raw bytes.
- **Model output**: `{ findings: [{ rule, severity: info|warning|blocking, message, quote: { block, text } }] }`, no extra properties.
- **Quote verification**: a finding is kept only if `rule` is a loaded rule id, `quote.block` is a block of the prompt, and the NFC + whitespace-collapsed quote is a non-empty substring of the equally normalised block (case and punctuation exact). Dropped findings are counted by reason `unknown_rule | unknown_block | empty_quote | quote_not_found`; identical kept findings (rule, block, normalised quote) collapse to one.
- **Dropped-hedge rule** (deterministic, advisory): a proposal sentence that is new (not verbatim in the original) and whose content-word Jaccard similarity to a hedged sentence of the base or a source is ≥ 0.6, but lacks one of that sentence's hedge terms (md-wiki `STRONG_HEDGE` + `suggest(s|ed)`, `có thể`, `giả thuyết`; whole-word, case-blind), yields a candidate `{ original, derived, hedges, similarity }`; each derived sentence is reported once, against its best match.

### 7.4 Phase 5 — Review and publish (full contract, P5-00)

Behavioural spec: `md-wiki/wiki_worker/core/worker.py` (`preview`, `review`, `publish`, `finish`, `resolve`, `conflict`, `resolve_conflict`, `integrity`) and its tests (`test_workflow.py`, `test_context.py`, `test_web.py` review/publish/recovery/conflict cases). Decisions D-75 … D-94. UI screens (F-07, F-09, F-10, F-13) bind to these contracts in P5-C/P5-D.

#### 7.4.1 Data model (Prisma)

```text
enum PublicationPhase   prepared | writing | written | done | unknown | stale | not_written
enum ResolutionOutcome  written | not_written
enum ConflictOutcome    keep_current | use_incoming | merge
enum ReviewerKind       agent | person                       -- status block / label vocabulary

Assignment(id, proposalId → Proposal, assigneeId → User, reason text, trigger text?, createdById? → User,
      createdAt, closedAt?)                                          index(assigneeId, closedAt)
      partial unique(proposalId, assigneeId) WHERE closedAt IS NULL
Decision(id, proposalId → Proposal unique, reviewerId → User, reviewerKind, approve bool, reason,
      bundleHash, artifactHash, previewAt timestamptz(3), discussionVersion int, disputeVersion int, createdAt)
      append-only
Publication(id, proposalId → Proposal, attempt int, targetPath, decisionId → Decision, phase, auto bool,
      actorId? → User, baseSha256?, artifactHash, condition jsonb, receipt jsonb?, error text?,
      versionLabel?, startedAt, writtenAt?, finishedAt?, updatedAt)
      unique(proposalId, attempt)  index(targetPath, phase)
      partial unique(targetPath) WHERE phase IN (prepared, writing, written, unknown)   -- one open per page
      partial unique(proposalId) WHERE phase IN (prepared, writing, written, unknown)
Resolution(id, publicationId → Publication unique, proposalId, actorId → User, outcome, evidence text,
      diskSha256?, createdAt)                                        append-only
ConflictResolution(id, proposalId → Proposal unique, actorId → User, outcome, baseSha256?, currentSha256?,
      replacementId? → Proposal, reason, createdAt)                  append-only
Withdrawal(id, proposalId → Proposal unique, actorId → User, reason, createdAt)   append-only
PublishOutbox(id, proposalId → Proposal, decisionId → Decision, kind approval|retry, attempts int default 0,
      lastError text?, createdAt, processedAt?)
      partial unique(proposalId) WHERE processedAt IS NULL           -- the outbox row of §8.1
PublishedSection(publicationId → Publication, path, versionLabel, anchor, sectionHash, reviewerKind,
      reviewedAt)                                                    pk(publicationId, anchor)
      index(path, anchor, sectionHash)                               append-only
```

- `Decision.id` is **deterministic [D-76]**: `decisionId(proposalId, reviewerId, previewAt)` = the first 16 bytes of `sha256("md-wiki:decision\0" + proposalId + "\0" + reviewerId + "\0" + previewAt)` formatted as a UUID with version nibble `8` and RFC 4122 variant (`domain/review.ts`). The preview can therefore print the decision id in the status block before the decision exists, and a replayed decision maps to the same row.
- `Publication.condition` = `{ kind: 'create' } | { kind: 'replace', expectedSha256 }` (§3.2), persisted at `prepared` before any write. `receipt` = the `WriteReceipt` (ISO dates) or `null` when the outcome was established by reading back (D-79).
- `PublishedSection` is the "`section_hash` per section for every published version" record: one row per section of every artifact that reaches `done`, with the decision's `reviewerKind` and `reviewedAt = Decision.createdAt` (D-83).
- A Postgres trigger rejects `UPDATE`/`DELETE` on `Decision`, `Resolution`, `ConflictResolution`, `Withdrawal`, `PublishedSection` (§4). `Assignment`, `Publication`, `PublishOutbox` are mutable state rows; every change to them is audited (§7.4.9).
- `Proposal` keeps D-57: only `state`, `artifact`, `artifactHash`, `updatedAt` change. `artifact`/`artifactHash` are set once, by the approving decision.

#### 7.4.2 Assignment (until Phase 8) [D-75]

- On submit (same transaction as the proposal insert) one `Assignment` is opened for `pickAssignee(candidates, submitterId)` (`domain/review.ts`): the first **enabled human owner** ordered by `(createdAt, id)` who is not the submitter; if every enabled owner is the submitter, the first enabled human with role `publisher` then `reviewer` (highest role first, then `createdAt, id`) who is not the submitter; else nobody. `reason = 'owner'` or `'fallback_reviewer'`. Agents are never assignees before Phase 8.
- No candidate → no assignment (the proposal waits; `assignment: null`). At decision time, a proposal without an open assignment re-runs the rule inside the decision transaction; if the caller is the one picked, the assignment is opened (audited `proposal.assigned`) and the decision proceeds. This heals proposals submitted before a reviewer existed without an Assign dialog (not designed).
- The decision, a withdrawal and a `keep_current`/`use_incoming`/`merge` conflict resolution close every open assignment of the proposal (`closedAt = now`).
- Migration backfill: every `pending` proposal without an assignment gets one by the same rule.

#### 7.4.3 Preview and decision binding (`domain/review.ts`) [D-76, D-77]

- **Preview** (in `GET /proposals/{slug}` while `pending`): `previewAt` = server time (ISO, ms, `Z`); `reviewerKind` = `person` for a human caller, `agent` for an agent; `decisionId = decisionId(proposal.id, caller.id, previewAt)`; `artifact = renderStatusBlock({ proposal: slug, decision: decisionId, reviewer: reviewerKind, decided_at: previewAt }) + proposed` (bytes: UTF-8 of the block followed by the frozen `proposed` bytes, never reserialized); `artifactHash = sha256(artifact)`. `binding = { bundleHash, artifactHash, previewAt, discussionVersion, disputeVersion }` is what the client sends back.
- **Decision** `POST /proposals/{slug}/decisions` body `DecisionInput = { approve: boolean, reason: string (trimmed 1..4000), bundleHash: hex64, artifactHash: hex64, previewAt: ISO-8601, discussionVersion: int ≥ 0, disputeVersion: int ≥ 0 }`. The server recomputes the artifact from `(proposal, caller, previewAt)`; it never accepts artifact bytes from the client.
- **Order of checks** (first failure wins; each its own code). Steps 1–3 are preconditions of any decision; 4–12 are §8.1 in its order:

| # | Check | Code | Applies to |
| --- | --- | --- | --- |
| 1 | role ≥ reviewer and (session or token scope `review`) | `FORBIDDEN` | both |
| 2 | proposal exists | `NOT_FOUND` | both |
| 3 | idempotent replay: a `Decision` with id `decisionId(proposal, caller, previewAt)` exists with the same `approve`, `bundleHash`, `artifactHash` → `200` with the current detail (nothing changes) | — | both |
| 4 | `state = pending` | `PRECONDITION_FAILED` | both |
| 5 | caller holds an open assignment (after the self-heal of §7.4.2) | `NOT_ASSIGNED` | both |
| 6 | caller ≠ submitter | `SELF_REVIEW` | both |
| 7 | no open dispute or hold (`DiscussionState.disputed`, §7.5.6) | `DISPUTED` | approve |
| 8 | `bundleHash = proposal.bundleHash`, recomputed `artifactHash` = sent `artifactHash`, `previewAt` parses and is ≤ now + 5 s | `DECISION_BINDING_MISMATCH` | both |
| 9 | `discussionVersion`, `disputeVersion` = `DiscussionState` versions (§7.5.6) | `DISCUSSION_CHANGED` | both |
| 10 | target observed live (§7.2.4) still has sha = `baseSha256` (or is still absent for a create) → else `STALE_BASE`; every source/scope pin observed live equals its sha → else `SOURCE_CHANGED` with `fields` as §7.2.4 | `STALE_BASE` / `SOURCE_CHANGED` | approve |
| 11 | no publication of `targetPath` in phase `unknown` (or another proposal's open `prepared`/`writing`/`written`) | `TARGET_BLOCKED` | approve |
| 12 | for agent callers: `EscalationTriggers.firing(...)` is empty (Phase 8 port → `[]`) | `ESCALATION_REQUIRED` | approve |

  Step 10 folds md-wiki's context freshness (which includes the target) into the "sources fresh" step: a changed target uses `STALE_BASE`, the code already meaning "the page changed since it was read" **[D-77]**. A rejection skips 7, 10, 11, 12 (md-wiki: a changed source still allows rejection).
- **Transaction** (all under the storage root lock, D-55 lock order: root lock → DB): observe target/sources (step 10) first, then one DB transaction that `SELECT … FOR UPDATE`s the `Proposal` row, re-reads state, assignment and `DiscussionState` (ports receive the transaction client), runs steps 4–12, inserts the `Decision`, sets `state` (`approved` with `artifact` + `artifactHash`, or `rejected`), closes assignments, audits `proposal.decided`, and — when approving with `AUTO_PUBLISH=true` — inserts the `PublishOutbox` row (audit `publication.queued`). `Decision.proposalId` is unique, so two concurrent decisions cannot both commit: the second waits on the row lock and then fails step 4 (`PRECONDITION_FAILED`), or at worst on the unique index (mapped to `PRECONDITION_FAILED`).
- **Discussion race** (§11): Phase 6 writes to `ProposalDiscussion`/`DisputeEvent` must take the same `Proposal` row lock (`FOR UPDATE`) and bump the version in that transaction, so an entry posted during a decision either commits first (the decision then fails step 9) or waits until the decision commits.
- **Auto-publish after approval** [D-82]: after the decision commits, the API processes the outbox row in the same request (§7.4.5) and returns the detail with the resulting publication state. A publish failure never undoes or fails the decision (`201` stays); the row stays pending for recovery.

#### 7.4.4 Proposal state machine (expands §8.1)

```text
            decide(approve) [§7.4.3]              publish: done
 pending ──────────────────────────▶ approved ─────────────────────▶ published
    │  ╲                                 │   ╲ publish: base/source changed, or the
    │   ╲ decide(reject) ──▶ rejected     │    ╲ conditional write lost a race ──▶ stale
    │    ╲ withdraw ───────▶ rejected     │ withdraw (no open publication) ──▶ rejected
    │     ╲ conflict resolved (§7.4.7) ─▶ rejected
    ╰──── publication unknown keeps `approved`; the target is blocked until a Resolution
```

- Terminal: `published`, `rejected`, `stale` (a revision is a new proposal; a conflict resolution on a stale proposal records a `ConflictResolution` and leaves it `stale`).
- `approved` + publication `unknown` = **blocked** (tab `blocked`); `approved` + resolution `not_written` = waits for the next publish attempt (auto: a `retry` outbox row; manual: a publisher).
- Withdraw [D-85]: only the submitter (permission `proposal.submit`, else `FORBIDDEN`), state `pending`, or `approved` with no open publication (else `PRECONDITION_FAILED`), body `{ reason?: string ≤ 4000 }` (default `"withdrawn"`); writes `Withdrawal`, `state = rejected`, closes assignments, marks a pending outbox row processed, audits `proposal.withdrawn`.

#### 7.4.5 Publish flow (expands §8.2) [D-78, D-79, D-81, D-92]

`PublishService.publish(proposal, trigger)` runs entirely under the storage root lock; `trigger` is `manual(actor)` (`POST /publish`) or `auto(outbox)` (actor `system`, audit data `{ decisionId }`, shown as "system (auto-publish after <decision id>)").

| Step | Action | On failure |
| --- | --- | --- |
| 0 | `state = published` → return `published` (idempotent, nothing written) | |
| 1 | resume an open publication of this proposal: `written` → step 9; `writing` → classify (step 8); `unknown` → `TARGET_BLOCKED`; `prepared` → continue at step 2 with that row | |
| 2 | `state = approved`, else `PRECONDITION_FAILED` | |
| 3 | integrity: `sha256(manifest) = bundleHash = Decision.bundleHash`, `sha256(artifact) = artifactHash = Decision.artifactHash`, `artifact` = status block + `proposed` | `PRECONDITION_FAILED`, nothing written (md-wiki "approved artifact changed") |
| 4 | another proposal's publication of the target is open (`prepared`/`writing`/`written`/`unknown`) | `TARGET_BLOCKED`; proposal stays `approved` |
| 5 | every source/scope pin observed live equals its sha | proposal `stale`, publication `stale` (`error = 'source_changed'`) |
| 6 | read the target once (`NOT_FOUND` = absent; **any other read error propagates, no phase is recorded**, md-wiki "failed read is not absence"); its sha ≠ `baseSha256` (or exists for a create) | proposal `stale`, publication `stale` (`error = 'base_changed'`) |
| 7 | persist `prepared` (condition from step 6) in a transaction that locks the proposal row and re-checks `approved`; then persist `writing`; then `storage.write(target, artifact, condition, { proposal, decision, publication })` | see classification |
| 8 | classify the write: `PRECONDITION_FAILED`/`ALREADY_EXISTS` → **stale** (the adapter checks before installing, so nothing was written; the out-of-band bytes stay); `VERIFY_FAILED` → **unknown**; any other error → read the target back once: sha = `artifactHash` → **written** with `receipt = null`, `error = 'receipt_missing:<code>'`; else (or the read-back fails) → **unknown** (`error = 'outcome_unknown:<code>'`) | unknown blocks the target |
| 9 | `written` (receipt, `writtenAt`); **finish**: register the artifact bytes as the new version (snapshot capture with dedupe — the verified artifact, not a later read), write `PublishedSection` rows for `splitSections(artifact)`, set publication `done` (+ `versionLabel`, `finishedAt`), proposal `published`, `Page.changedOutsideReview = false` when the page's current sha is the artifact, mark the outbox row processed, audit; then observe the target once more so an out-of-band edit that landed after the write is indexed (and flagged changed outside review); reindex the search rows for the new version | finish is idempotent; a crash re-runs it |

- No blind retry, no rollback: nothing re-writes after `writing` unless an owner records `not_written` (§7.4.6).
- `POST /proposals/{slug}/publish` (`proposal.publish`: publisher, token scope `publish`, only when `AUTO_PUBLISH=false`, else `FORBIDDEN`) returns `200 ProposalDetailDto` whatever the outcome (`published`, `stale`, or blocked); errors: `NOT_FOUND`, `PRECONDITION_FAILED`, `TARGET_BLOCKED`, `STORAGE_ERROR` (step 6 read failed).
- **Outbox** [D-81]: a pending `PublishOutbox` row is processed right after the approving commit and at boot. It is marked processed when the attempt reaches `done`, `stale` or `unknown`, or the proposal is no longer `approved`; `TARGET_BLOCKED` and transient errors (step 6) increment `attempts`, store `lastError`, and keep it pending. After an owner resolution on a target, the pending outbox rows of that target are processed again.
- **Boot recovery** (after seeding and the boot reindex, before listening): (1) publications in `writing` (process died mid-write) → classify by reading back as step 8 (`written` → finish, else `unknown`); (2) `written` → finish; (3) `prepared` → resume through `publish` (no write had started); (4) pending outbox rows → process; (5) with `AUTO_PUBLISH=true`, `approved` proposals with no open publication, no pending outbox row and no `unknown` attempt get a `retry` outbox row and are processed. Each recovery step is audited with actor `system`.
- Fault semantics (FixtureStorage, D-36) map to: `beforeRename` → read back = old bytes → `unknown`; `afterRename` → read back = artifact → `written` (receipt missing) → `done`; `beforeVerify` → `VERIFY_FAILED` → `unknown`; `receipt` → read back = artifact → `written` → `done`.

#### 7.4.6 Blocked targets and resolution [D-80]

- `GET /ops/blocked` (owner, `admin.recovery`) → `{ items: BlockedTargetDto[] }`, newest first: every publication in phase `unknown`, with a live read of the file (`disk.sha256`, `disk.matches: 'new' | 'old' | 'neither' | 'missing'`; read error → `disk = null`) and the approved proposals waiting behind it.
- `POST /ops/blocked/{slug}/resolution` (owner) body `{ outcome: 'written' | 'not_written', evidence: string (trimmed 1..4000) }`, under the root lock: the proposal's open publication must be `unknown` (else `PRECONDITION_FAILED`; unknown slug → `NOT_FOUND`); the file is read: `written` requires sha = `artifactHash`, `not_written` requires sha ≠ `artifactHash` (else `PRECONDITION_FAILED`: "matching content is insufficient" is inverted here — the bytes carry the decision id, so a mismatch disproves `written` and a match disproves `not_written`). Inserts `Resolution` (with `diskSha256`); `written` → publication `written` → finish (§7.4.5 step 9); `not_written` → publication `not_written` (closed, the target is unblocked), proposal stays `approved`, and with `AUTO_PUBLISH=true` a `retry` outbox row is inserted and processed (it runs the full flow, so it goes `stale` when the file is neither version). F-13's three choices map to `written` / `not_written` / `not_written` ("Neither (restore from backup)"). Response `200 ProposalDetailDto`. Audit `publication.resolved { outcome, evidence, diskSha256 }`.

#### 7.4.7 Conflicts (v1 / v2 / proposal) [D-84]

A proposal has a **conflict** when it is `pending` or `stale` and the target's current sha differs from `baseSha256` (or a create's target now exists). md-wiki always compares against the frozen v1 bytes; nothing is rolled back to display it.

- `ProposalDetailDto.conflict` (from the indexed current version, no storage IO): `{ section, scope: 'section' | 'page', base: { versionLabel, sha256 } | null, current: { versionLabel, sha256, publishedBy: { slug, reviewerKind } | null } | null, baseText, currentText, proposedText, resolution: ConflictResolutionDto | null }`. `scope = 'section'` when the proposal is section-scoped and the section exists in base, current and proposed; the three texts are then that section's region (`regionOf`), else the three whole bodies (status block stripped; `''` for an absent version). `publishedBy` names the proposal whose `done` publication produced the current sha.
- `POST /proposals/{slug}/conflict` body `{ outcome: 'keep_current' | 'use_incoming' | 'merge', reason: string (trimmed 1..4000), replacement?: string }`. Allowed for the submitter (permission `proposal.submit`) or any role ≥ reviewer (`proposal.read`) — never through assignment; others `FORBIDDEN`. Under the root lock the target is observed live: no conflict → `PRECONDITION_FAILED`; already resolved (`ConflictResolution` exists) → `ALREADY_EXISTS`.
  - `keep_current` ("Drop my change"): no replacement allowed (`VALIDATION_FAILED`).
  - `use_incoming` ("Replace with mine"): `replacement` optional, default = `proposedText`; `merge` ("Combine both"): `replacement` required.
  - The replacement is the editable region for `scope` (§7.2.3): it is spliced into the **current** body with `composeProposed(current, scope === 'section' ? section : null, replacement)` and frozen through the single freeze path (`ProposalFreezer`, §7.2) as a new proposal: same submitter and origin as the old one, base = the observed current snapshot, same title, `reason` = the given reason, same section/sources/scope pins/appliesTo (a changed pin → `SOURCE_CHANGED`, nothing recaptured), bundle rules apply (`NO_CHANGE` when the result equals current, etc.).
  - In the same transaction (freeze `commit` hook): `ConflictResolution { outcome, baseSha256, currentSha256, replacementId }`; a `pending` proposal becomes `rejected` and its assignments close; a `stale` one stays `stale`; audit `proposal.conflict_resolved`.
  - Response `201 ConflictResultDto = { resolution: ConflictResolutionDto, replacement: ProposalDto | null }`.

#### 7.4.8 Endpoints

All under `/api/v1`. New permission action **`proposal.read`** (min role `reviewer`, token scope `review`) **[D-86]** for workspace lists; `admin.recovery` and `admin.audit` are `admin.*` (owner).

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/proposals` | `proposal.read` | `?tab=open\|stale\|blocked\|published\|rejected\|all` (default `open`) `&state=<ProposalState>` `&targetPath&limit&cursor` | `ProposalListDto` | `VALIDATION_FAILED` |
| GET | `/proposals/{slug}` | `wiki.read` + (submitter or role ≥ reviewer) | | `ProposalDetailDto` | `NOT_FOUND` (also when not visible, D-63) |
| GET | `/proposals/{slug}/diff` | as above | `?against=base\|current` (default `base`) | `ProposalDiffDto` | `NOT_FOUND`, `VALIDATION_FAILED` |
| POST | `/proposals/{slug}/decisions` | `proposal.decide` (checks §7.4.3) | `DecisionInput` | `201 ProposalDetailDto` · `200` replay | table §7.4.3, `VALIDATION_FAILED`, `STORAGE_ERROR` |
| POST | `/proposals/{slug}/publish` | `proposal.publish` | | `200 ProposalDetailDto` | §7.4.5 |
| POST | `/proposals/{slug}/withdraw` | `proposal.submit` + submitter | `{ reason? }` | `200 ProposalDetailDto` | `FORBIDDEN`, `NOT_FOUND`, `PRECONDITION_FAILED` |
| POST | `/proposals/{slug}/conflict` | §7.4.7 | `ConflictInput` | `201 ConflictResultDto` | `FORBIDDEN`, `NOT_FOUND`, `PRECONDITION_FAILED`, `ALREADY_EXISTS`, `VALIDATION_FAILED` (+ bundle codes), `SOURCE_CHANGED`, `STALE_BASE`, `PAYLOAD_TOO_LARGE` |
| GET | `/ops/blocked` | `admin.recovery` | | `{ items: BlockedTargetDto[] }` | |
| POST | `/ops/blocked/{slug}/resolution` | `admin.recovery` | `{ outcome, evidence }` | `200 ProposalDetailDto` | `NOT_FOUND`, `PRECONDITION_FAILED`, `VALIDATION_FAILED`, `STORAGE_ERROR` |
| GET | `/audit` | `admin.audit` | `?action&subjectType&subjectId&actorId&limit&cursor` | `Page<AuditEventDto>` `at desc, id desc` | `VALIDATION_FAILED` |
| GET | `/events` | `wiki.read` | `text/event-stream` | `EventDto` stream | |

```ts
type PublicationPhase = 'prepared' | 'writing' | 'written' | 'done' | 'unknown' | 'stale' | 'not_written';
type ProposalTab = 'open' | 'stale' | 'blocked' | 'published' | 'rejected' | 'all';
interface UserRefDto { id: string; name: string; kind: 'human' | 'agent' }
interface AssignmentDto { id: string; assignee: UserRefDto; reason: string; trigger: string | null; createdAt: string }
interface DecisionDto { id: string; reviewer: UserRefDto; reviewerKind: 'agent' | 'person'; approve: boolean; reason: string;
  bundleHash: string; artifactHash: string; previewAt: string; discussionVersion: number; disputeVersion: number; createdAt: string }
interface ResolutionDto { outcome: 'written' | 'not_written'; evidence: string; actor: UserRefDto; diskSha256: string | null; createdAt: string }
interface PublicationDto { id: string; attempt: number; phase: PublicationPhase; auto: boolean; actor: UserRefDto | null;
  baseSha256: string | null; artifactHash: string; receiptId: string | null; error: string | null; versionLabel: string | null;
  startedAt: string; writtenAt: string | null; finishedAt: string | null; updatedAt: string; resolution: ResolutionDto | null }
interface ProposalListItemDto {
  slug: string; title: string; targetPath: string; pageTitle: string; section: string | null; sectionTitle: string | null;
  submitter: UserRefDto; state: ProposalDto['state']; tab: Exclude<ProposalTab, 'all'>;
  phase: PublicationPhase | null;                 // latest publication attempt
  withdrawn: boolean; conflict: boolean;          // conflict = §7.4.7 condition on the indexed current version
  assignees: UserRefDto[];                        // open assignments
  decision: { approve: boolean; reviewer: UserRefDto; reviewerKind: 'agent' | 'person'; at: string } | null;
  publishedVersion: string | null; autoPublished: boolean | null;   // quality summary arrives with Phase 7
  createdAt: string; updatedAt: string }
interface ProposalListDto { items: ProposalListItemDto[]; nextCursor: string | null; counts: Record<ProposalTab, number> }
interface PreviewDto { artifact: string; artifactHash: string; previewAt: string; decisionId: string; reviewerKind: 'agent' | 'person';
  binding: { bundleHash: string; artifactHash: string; previewAt: string; discussionVersion: number; disputeVersion: number } }
interface RefStatusDto { role: 'target' | 'source' | 'scope'; path: string; versionLabel: string | null; sha256: string | null;
  currentVersionLabel: string | null; current: boolean /* indexed sha = pinned sha (or both absent) */ }
interface ProposalEventDto { id: string; at: string; action: string; actor: UserRefDto | null /* null = system */; data: object }
interface ProposalDetailDto extends ProposalDto {
  tab: ProposalListItemDto['tab']; withdrawn: { reason: string; at: string } | null;
  preview: PreviewDto | null;                     // state pending only, computed for the caller
  final: { artifact: string; artifactHash: string } | null;   // the approved artifact (approved/published)
  assignment: AssignmentDto | null; decisions: DecisionDto[];
  publication: PublicationDto | null; publications: PublicationDto[];   // latest first
  blockedBy: { slug: string; phase: PublicationPhase } | null;          // another proposal holding the target
  refs: RefStatusDto[]; conflict: ConflictDto | null;
  discussion: { discussionVersion: number; disputeVersion: number; disputed: boolean };
  can: { decide: boolean; publish: boolean; withdraw: boolean; resolveConflict: boolean; resolveBlocked: boolean };
  history: ProposalEventDto[] }                   // audit events with this proposal as subject, oldest first
interface ProposalDiffDto { against: 'base' | 'current'; from: { versionLabel: string | null; sha256: string | null; text: string };
  to: { sha256: string; text: string /* preview/final artifact, or proposed when neither */ };
  lines: DiffLine[] /* domain/line-diff */; stats: { added: number; removed: number } }
interface ConflictInput { outcome: 'keep_current' | 'use_incoming' | 'merge'; reason: string; replacement?: string }
interface ConflictResolutionDto { outcome: ConflictInput['outcome']; actor: UserRefDto; reason: string; baseSha256: string | null;
  currentSha256: string | null; replacementSlug: string | null; createdAt: string }
interface BlockedTargetDto { slug: string; title: string; targetPath: string; pageTitle: string; since: string; error: string | null;
  publicationId: string; expected: { sha256: string }; old: { sha256: string | null };
  disk: { sha256: string | null; matches: 'new' | 'old' | 'neither' | 'missing' } | null; waiting: string[] }
interface AuditEventDto { id: string; at: string; action: string; actorKind: 'human' | 'agent' | 'system'; actor: UserRefDto | null;
  subjectType: string; subjectId: string; data: object }
interface EventDto { type: EventType; slug?: string; path?: string; state?: string; phase?: PublicationPhase; at: string }
```

- **Tabs [D-87]** (`tabOf(state, phase, withdrawn)` in `domain/review.ts`): `blocked` = `approved` and latest publication `unknown`; `open` = `pending`, or `approved` and not blocked; `stale`; `published`; `rejected` (incl. withdrawn). `counts` covers every tab (with `state`/`targetPath` filters applied, not the tab filter); `all` = their sum. Order `createdAt desc, id desc`; cursor as §7.2.6 (`<epoch ms>.<uuid>`).
- `diff`: `against=base` compares the frozen base body (`''` for a create) with the artifact the caller would approve (preview while `pending`, else `final`, else `proposed`); `against=current` compares the indexed current version's body instead. Line numbers are those of the stored files (D-33).
- `ProposalDetailDto.can.*` is computed by the API (`domain/permissions.can` + state) so the web never re-derives permissions: `decide` = steps 1, 4, 5, 6 pass; `publish` = `proposal.publish` allowed and `approved` and not blocked; `withdraw`, `resolveConflict` (`conflict` and no resolution), `resolveBlocked` (owner and phase `unknown`).

#### 7.4.9 Audit events [D-90]

Every transition writes one `AuditEvent` in the transaction that makes it (subject `proposal` = proposal id unless noted): `proposal.assigned {assigneeId, reason}` · `proposal.decided {decisionId, approve, bundleHash, artifactHash, previewAt, discussionVersion, disputeVersion}` · `proposal.withdrawn {reason}` · `publication.queued {decisionId, kind}` · `publication.prepared {publicationId, attempt, condition}` · `publication.writing {publicationId}` · `publication.written {publicationId, receiptId, afterSha256, recovered}` · `publication.unknown {publicationId, error}` · `publication.stale {publicationId, error}` · `proposal.published {publicationId, versionLabel, auto, decisionId}` · `publication.resolved {publicationId, outcome, evidence, diskSha256}` · `proposal.conflict_resolved {outcome, replacementSlug, baseSha256, currentSha256}`. Actor: the caller, or `system` (auto-publish, recovery) with `data.decisionId`.

#### 7.4.10 History, recent changes, changed outside review [D-89, D-93]

- `PublicationLookup.lastPublishedSha256(path)` = `artifactHash` of the latest publication of that path in phase `written` or `done` (`writtenAt desc`); `null` = never published through review. The indexer's `changedOutsideReview` (§3.6) becomes real; finish clears it for the published sha.
- `VersionDto` gains `publication: VersionPublicationDto | null` and `RecentChangeDto` gains `{ proposalSlug: string | null, sectionTitle: string | null, summary: string | null }`, where `VersionPublicationDto = { proposalSlug, title, sectionTitle, reviewerKind, decidedAt, publishedAt, auto }`; `summary` = the proposal title, `sectionTitle` = the title of the proposal's section in the published version (null for whole-page proposals). Matched by `(path, versionLabel)` of a `done` publication. Presentation of *Changed outside review* and of these fields belongs to the UI tasks (P5-C, D-47/D-48); the API only provides the data.
- Section labels (§6): `SectionLabels` reads `PublishedSection` rows for `(path, anchor, sectionHash)` as `reviewedVersions` (kind = `reviewerKind`, time = `reviewedAt`), so every section of a published artifact is `reviewed` with its reviewer kind; a later edit (new hash) falls back to `not_reviewed` until reviewed again.

#### 7.4.11 Events (SSE) [D-88]

`GET /events` streams `text/event-stream`; each message has `event: <type>` and `data: EventDto` (JSON). A `ping` event every 25 s keeps proxies open. Events are emitted after the transaction commits, in-process (one API process per deployment, plan.md › Open decisions: one host):

| `type` | Payload | Invalidates (web query keys) | Audience |
| --- | --- | --- | --- |
| `proposal.changed` | `slug, state, phase?` | `['proposals']`, `['proposal', slug]`, `['suggestions']` | role ≥ reviewer, and the submitter |
| `publication.changed` | `slug, phase` | `['proposal', slug]`, `['ops', 'blocked']` | role ≥ reviewer, and the submitter |
| `page.changed` | `path` | `['page', path]`, `['tree']`, `['recent']`, `['search']`, `['history', path]` | everyone with `wiki.read` |
| `ping` | `at` | — | everyone |

#### 7.4.12 Web (F-07, F-09, F-10, F-13, Audit log; P5-C/P5-D) [D-95 … D-104]

| Route | Screen | Data | Writes |
| --- | --- | --- | --- |
| `/work/proposals?tab=` | F-09 Proposals | `GET /proposals?tab&limit=50&cursor` (counts from the first page) | — |
| `/work/proposals/:slug` | F-10 Review | `GET /proposals/{slug}`, `GET /proposals/{slug}/diff?against=base` | `POST …/decisions` (body = `preview.binding` + `approve` + `reason`), `POST …/publish` (`can.publish` only) |
| `/me/suggestions/:id/resolve` (`:id` = slug) | F-07 Conflict | `GET /proposals/{slug}` (`conflict`) | `POST …/conflict`, `POST …/withdraw` (`can.withdraw` only) |
| `/work/ops` | F-13 Operations | `GET /ops/blocked` | `POST /ops/blocked/{slug}/resolution` |
| `/work/ops/audit` | Audit log (derived) | `GET /audit?limit=50&cursor` | — |

- The web never re-derives permissions: decide/publish/withdraw controls follow `ProposalDetailDto.can`; the Workspace link and WorkNav counts follow D-95.
- Query keys: `['proposals', {tab, limit}]`, `['proposal', slug]`, `['proposal', slug, 'diff', against]`, `['ops','blocked']`, `['ops','audit']`. Every write caches the returned detail and invalidates `['proposals']`, `['proposal', slug, 'diff']`, `['me.suggestions']`, `['ops','blocked']`. SSE events invalidate per D-96.
- Decision errors: `DISCUSSION_CHANGED`/`DECISION_BINDING_MISMATCH` lock the form until *Reload* refetches the detail (new preview); every other code shows its `error-copy` text under the form. The reason survives both (sessionStorage, §10).

### 7.5 Phase 6 — Discussions and MCP (full contract, P6-00)

Behavioural spec: `md-wiki/wiki_worker/core/discussions.py` (`create_topic`, `add_discussion_comment`, `close_topic`, `create_discussion`, `add_discussion_message`, `hold_proposal`, `resolve_discussion`, `discuss`, `semantic_discussion`), `md-wiki/wiki_worker/mcp.py` and their tests (`test_mcp.py`, `test_workflow.py` semantic cases, `test_web.py` discussion cases). Decisions D-105 … D-119. UI screens (F-11 Discussions, *Ask a question*, Review › Discussion tab) bind to these contracts in P6-04 … P6-06. Not ported: Slack/Teams mirrors and `reviewer_decision_requests` (chat transports are "later", architecture.md), `open_concurrent_discussion` (Phase 8 escalation), `decision_owners`/`resolve_assignees` (page authors are resolved in Phase 8).

#### 7.5.1 Data model (Prisma) [D-105]

```text
enum TopicStatus    open | on_hold | resolved | rejected
enum EntryKind      open | comment | agreement | close | reopen
enum DisputeAction  open | comment | resolve | reopen

Topic(id, path, anchor?, versionLabel?, title, authorId → User, status default open,
      proposalId? → Proposal unique, bundleHash?, version int default 1, participantIds uuid[],
      closedById? → User, closeReason?, closedAt?, createdAt, updatedAt)
      index(path, anchor)  index(status, updatedAt)  index(updatedAt, id)
DiscussionEvent(id, topicId → Topic, seq int, kind, authorId → User, body, parentSeq?, agreesWith?,
      outcome TopicStatus?, mentions uuid[], bundleHash?, createdAt)        unique(topicId, seq)   append-only
DisputeEvent(id, proposalId → Proposal, seq int, actorId → User, action, reason, resolutionKind?,
      relatedSlugs text[], bundleHash, createdAt)                           unique(proposalId, seq) append-only
```

- architecture.md's `Topic` + `Comment` + `ProposalDiscussion` + `DiscussionEvent` collapse into **`Topic` + `DiscussionEvent`** [D-105]: a *comment* is a `DiscussionEvent` of kind `comment`/`agreement` (with `parentSeq` as the reply relation), and the **proposal discussion** is the one `Topic` whose `proposalId` is set (unique), bound to the frozen `bundleHash`. One entry model gives one version counter and one thread for the Discussions screen, which lists proposal discussions next to page topics (F-11).
- `Topic.version` = the `seq` of its latest entry; the opening body is entry 1 (`kind: open`). Every change (comment, close, reopen) appends exactly one entry with `seq = version + 1` and updates `version`, `status`, `participantIds`, `updatedAt` (and the `closed*` fields) in the same transaction, conditioned on the old version.
- Triggers: `DiscussionEvent` and `DisputeEvent` reject `UPDATE`/`DELETE` (§4). `Topic` rejects `DELETE`, any change of `id, path, anchor, versionLabel, authorId, proposalId, bundleHash, createdAt`, and a decreasing `version`; `CHECK version ≥ 1`, `seq ≥ 1`.
- `participantIds` = the author, everyone who wrote an entry, and everyone mentioned (deduplicated, insertion order).
- `DisputeEvent` is md-wiki's `semantic_discussions` log: `disputeVersion` = its last `seq` (0 when empty).

#### 7.5.2 Rules (`domain/discussions.ts`) [D-106, D-107]

- **Topic transitions** `topicTransition(status, action)` (else `PRECONDITION_FAILED`):

| From | comment / agreement | close `on_hold` | close `resolved` / `rejected` | reopen |
| --- | --- | --- | --- | --- |
| `open` | `open` | `on_hold` | that outcome | ✗ |
| `on_hold` | `on_hold` | ✗ | that outcome | `open` |
| `resolved` / `rejected` | ✗ (reopen first) | ✗ | ✗ | `open` |

  md-wiki `close_topic` outcomes `resolved | on_hold | rejected` map 1:1 (its storage names `blocked`/`decision` are not kept).
- **Hold** `holdsApproval(topic)` = the topic has a `proposalId` and status ≠ `resolved` (md-wiki `discussion_hold`: only *resolved* releases; *rejected* records that the debate went against the proposal and *on hold* keeps it open) [D-106].
- **Dispute log** `disputeState(events)`: disputed = the last `open`/`reopen` is not followed by `resolve`. `disputeStep(events, input)` (after the version matched): `open` only on an empty log, `reopen` only when not disputed and the log is not empty, `comment`/`resolve` only while disputed (each `PRECONDITION_FAILED`); `resolutionKind ∈ supported | scoped | attributed | not_a_conflict` required for `resolve` and forbidden otherwise, `relatedSlugs` ≤ 50 unique slugs (each `VALIDATION_FAILED`, field `resolutionKind` / `relatedSlugs`).
- **Decision facts** `discussionSummary(topic, disputes)` = `{ discussionVersion: topic?.version ?? 0, disputeVersion, held, disputeOpen, disputed: held || disputeOpen }`. This is what `DiscussionState` returns (§7.5.6).
- **Who may close/reopen** `mayCloseTopic` [D-108]: on a proposal topic a reviewer (role ≥ reviewer) who is not the submitter (`FORBIDDEN`, `SELF_REVIEW`; md-wiki `check_reviewer`); on any other topic its author or a reviewer (`FORBIDDEN`).
- **Agreement**: `kind: agreement` requires `agreesWith` = an existing entry seq (1 … version); `agreesWith` on a `comment` is refused; `parentSeq` ≤ version. Each `VALIDATION_FAILED` with field code `UNKNOWN_ENTRY` / `NOT_AGREEMENT`.

#### 7.5.3 Permissions [D-109, D-110]

| Operation | Permission (§5.2) | Extra rule |
| --- | --- | --- |
| read topics, entries, proposal discussion, dispute log | `wiki.read` | proposal topics and the proposal endpoints are visible to the submitter, roles ≥ reviewer (D-63) and the topic's participants; others get `404 NOT_FOUND` / an empty list |
| open a topic (*Ask a question*), open a proposal discussion | `topic.open` (reader, scope `discuss`) | proposal discussion: proposal visible to the caller |
| comment / agreement | `comment` (contributor, `discuss`) | the topic's author may always reply on their own topic with `topic.open` (a reader who asked a question can answer follow-ups) [D-109] |
| close / reopen | `topic.open` | `mayCloseTopic` (§7.5.2) |
| dispute log entry | **new action `dispute.write`** (reviewer, scope `review`) | never on own proposal (`SELF_REVIEW`) [D-110] |

Order of checks for every write (first failure wins): base permission (`FORBIDDEN`) → visibility (`NOT_FOUND`) → resource rule (`FORBIDDEN` / `SELF_REVIEW`) → proposal topics: `version` present (`VALIDATION_FAILED`, field code `REQUIRED`) → proposal `pending` (and, when the body carries it, `bundleHash` = the proposal's, else `PRECONDITION_FAILED`) → `version` = current (`DISCUSSION_CHANGED`) → transition (`PRECONDITION_FAILED`) → entry fields and `mentions` (`VALIDATION_FAILED`). For plain topics `version` is optional; when sent it must match.

#### 7.5.4 DTOs

```ts
type TopicStatus = 'open' | 'on_hold' | 'resolved' | 'rejected';
type CloseOutcome = 'resolved' | 'rejected' | 'on_hold';
interface TopicEntryDto { id: string; seq: number; kind: 'open' | 'comment' | 'agreement' | 'close' | 'reopen';
  author: UserRefDto; body: string; parentSeq: number | null; agreesWith: number | null;
  outcome: CloseOutcome | null /* close entries */; mentions: UserRefDto[]; createdAt: string }
interface TopicListItemDto { id: string; title: string; path: string; pageTitle: string; anchor: string | null;
  sectionTitle: string | null /* in versionLabel, else the current version */; status: TopicStatus;
  proposal: { slug: string; title: string; state: ProposalState; holds: boolean /* pending and holdsApproval */ } | null;
  author: UserRefDto; replies: number /* comment + agreement entries */; version: number; createdAt: string; updatedAt: string }
interface TopicListDto { items: TopicListItemDto[]; nextCursor: string | null; counts: { open: number; mine: number; closed: number; all: number } }
interface TopicDetailDto extends TopicListItemDto { versionLabel: string | null; bundleHash: string | null;
  participants: UserRefDto[]; closed: { by: UserRefDto; outcome: CloseOutcome; reason: string; at: string } | null;
  entries: TopicEntryDto[]; can: { comment: boolean; close: boolean; reopen: boolean } }
interface DisputeEventDto { seq: number; action: 'open' | 'comment' | 'resolve' | 'reopen'; actor: UserRefDto; reason: string;
  resolutionKind: 'supported' | 'scoped' | 'attributed' | 'not_a_conflict' | null; relatedSlugs: string[]; createdAt: string }
interface DisputeLogDto { slug: string; bundleHash: string; disputeVersion: number; disputeOpen: boolean; events: DisputeEventDto[] }
interface ProposalDiscussionDto { slug: string; bundleHash: string; state: ProposalState; discussionVersion: number;
  disputeVersion: number; held: boolean; disputeOpen: boolean; disputed: boolean; topic: TopicDetailDto | null; disputes: DisputeLogDto }
// inputs
interface TopicCreateInput { path: string; anchor?: string | null; title: string /* trimmed 1..120 */; body: string /* 1..20000 */; mentions?: uuid[] /* ≤ 20, unique */ }
interface CommentInput { body: string; kind?: 'comment' | 'agreement'; parentSeq?: int ≥ 1; agreesWith?: int ≥ 1; mentions?: uuid[]; version?: int ≥ 1 }
interface TopicCloseInput { outcome: CloseOutcome; reason: string /* trimmed 1..20000, the rationale */; version?: int ≥ 1 }
interface TopicReopenInput { reason: string; version?: int ≥ 1 }
interface ProposalDiscussionInput { bundleHash: hex64; title?: string /* default "Discussion: <proposal title>" cut to 120 */; body: string;
  anchor?: string | null /* default the proposal's section; must be a section of the base version */; mentions?: uuid[] }
interface DisputeInput { bundleHash: hex64; disputeVersion: int ≥ 0; action: DisputeAction; reason: string; resolutionKind?: string; relatedSlugs?: string[] }
```

- `ProposalDetailDto.discussion` (§7.4.8) gains `held: boolean`, `disputeOpen: boolean`, `topicId: string | null` (additive) [D-111]; `disputed` keeps its meaning "approval is blocked" (= `held || disputeOpen`).
- `mentions`: every id must be an enabled user (`VALIDATION_FAILED`, field `mentions`, code `UNKNOWN_USER`). Notifications for mentions arrive with Phase 9; until then a mention makes the person a participant (visibility + SSE audience).

#### 7.5.5 Endpoints

All under `/api/v1`. Cursor envelope as §2; topics ordered `updatedAt desc, id desc` (cursor `<epoch ms>.<uuid>`), entries `seq asc` (cursor = last seq).

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/topics` | `wiki.read` | `?filter=open\|mine\|closed\|all` (default `open`) `&path&anchor&proposal=<slug>&limit&cursor` | `TopicListDto` | `VALIDATION_FAILED` |
| POST | `/topics` | `topic.open` | `TopicCreateInput` | `201 TopicDetailDto` | `INVALID_PATH`, `NOT_FOUND` (no indexed page), `VALIDATION_FAILED` (`anchor` not in the current version: field code `UNKNOWN_SECTION`; mentions) |
| GET | `/topics/{id}` | `wiki.read` | | `TopicDetailDto` | `NOT_FOUND`, `VALIDATION_FAILED` (id not a uuid) |
| GET | `/topics/{id}/comments` | `wiki.read` | `?limit&cursor` | `{ items: TopicEntryDto[], nextCursor }` | `NOT_FOUND` |
| POST | `/topics/{id}/comments` | `comment` (§7.5.3) | `CommentInput` | `201 TopicDetailDto` | `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `PRECONDITION_FAILED`, `DISCUSSION_CHANGED` |
| POST | `/topics/{id}/close` | §7.5.3 | `TopicCloseInput` | `200 TopicDetailDto` | `FORBIDDEN`, `SELF_REVIEW`, `NOT_FOUND`, `VALIDATION_FAILED`, `PRECONDITION_FAILED`, `DISCUSSION_CHANGED` |
| POST | `/topics/{id}/reopen` | §7.5.3 | `TopicReopenInput` | `200 TopicDetailDto` | as close |
| GET | `/proposals/{slug}/discussion` | `wiki.read` + visible | | `ProposalDiscussionDto` | `NOT_FOUND` |
| POST | `/proposals/{slug}/discussion` | `topic.open` + visible | `ProposalDiscussionInput` | `201 ProposalDiscussionDto` | `NOT_FOUND`, `PRECONDITION_FAILED` (not pending, bundle hash ≠), `ALREADY_EXISTS` (one per proposal), `VALIDATION_FAILED` (`UNKNOWN_SECTION`, mentions) |
| GET | `/proposals/{slug}/disputes` | `wiki.read` + visible | | `DisputeLogDto` | `NOT_FOUND` |
| POST | `/proposals/{slug}/disputes` | `dispute.write` | `DisputeInput` | `201 DisputeLogDto` | `FORBIDDEN`, `NOT_FOUND`, `PRECONDITION_FAILED`, `SELF_REVIEW`, `DISCUSSION_CHANGED`, `VALIDATION_FAILED` |

- Filters: `open` = status `open | on_hold`; `closed` = `resolved | rejected`; `mine` = open statuses and the caller is the author or a participant; `counts` covers all four with the `path/anchor/proposal` filters and visibility applied. An unknown `proposal` slug yields an empty list.
- Topics on a page need an indexed page; a proposal discussion of a *create* has `versionLabel = null` and `anchor = null` unless the proposal's own section.
- Entries on a proposal topic are only accepted while the proposal is `pending` (md-wiki `_current_discussion`); after a decision the thread is read-only history.

#### 7.5.6 Holds, decision lock and return to the assignee [D-91, D-106, D-107]

- `DiscussionState` (port of §7.4.3) is now `PrismaDiscussionState`: inside the decision transaction (after `SELECT … FOR UPDATE` on the proposal) it reads the proposal topic and the dispute log and returns `discussionSummary` plus `topicId`. Step 7 (`DISPUTED`, approval only) uses `disputed`; step 9 (`DISCUSSION_CHANGED`) compares both versions. A rejection is never blocked by a hold.
- **Lock order** for every write to a proposal topic or the dispute log: `Proposal` row `FOR UPDATE` → `Topic` row `FOR UPDATE` → re-read → checks → append. A decision and an entry therefore serialize: an entry that commits before the decision's transaction makes the binding stale (`DISCUSSION_CHANGED`, or `DISPUTED` when it opened a hold); an entry posted while the decision holds the lock waits and is then refused because the proposal is no longer pending (`PRECONDITION_FAILED`). Plain topics lock only their `Topic` row.
- **Return to the assignee** (plan.md Phase 4) [D-107]: when a write releases the last blocker of a pending proposal — the topic closed `resolved`, or a dispute `resolve` — with `disputed` now false: if an assignment is open it stays; otherwise the last assignee (latest `Assignment` by `createdAt`) gets a new one (`reason = 'discussion_resolved'`, audited `proposal.assigned`), falling back to the §7.4.2 rule. Audit `proposal.returned { assigneeId, discussionVersion, disputeVersion }`. The assignee rereads (the preview binding changed) and decides; nothing decides by itself. Phase 8 hooks the reviewer agent's re-run here.

#### 7.5.7 Audit and events [D-115]

- Audit (subject `topic` unless noted): `topic.opened { path, anchor, versionLabel | proposalSlug }` · `topic.closed { outcome, reason, version }` · `topic.reopened { reason, version }` · subject `proposal`: `proposal.discussion_opened { topicId, discussionVersion }` · `proposal.discussion_closed { topicId, outcome, discussionVersion }` · `proposal.discussion_reopened { topicId, discussionVersion }` · `dispute.open|comment|resolve|reopen { disputeVersion, resolutionKind, relatedSlugs }` · `proposal.returned`. Comments are not audited (the entry itself is the append-only record).
- SSE (§7.4.11) gains **`discussion.changed`** with `{ topicId?, path, version, slug? }` (`topicId` absent for dispute-log entries, `version` = the topic or dispute version). `EventDto` gains optional `topicId` and `version`. Invalidates `['topics']`, `['topic', topicId]`, `['proposal-discussion', slug]`. Audience: everyone with `wiki.read` for a plain topic; for a proposal topic or dispute the proposal audience (roles ≥ reviewer, the submitter) plus the topic's participants. A proposal topic or dispute write also emits `proposal.changed` for the slug (the preview binding changed: "new discussion entry, decision locked until reread", ux.md §10).

#### 7.5.8 MCP server [D-112, D-113, D-114]

- Endpoint **`/mcp`** on the public listener (outside the `/api/v1` prefix), MCP **streamable HTTP** via the official `@modelcontextprotocol/sdk`: stateless (no `Mcp-Session-Id`), JSON responses (`enableJsonResponse`), one `McpServer` per request bound to the caller. `GET`/`DELETE` → `405` from the transport (no server-initiated stream).
- **Auth**: `Authorization: Bearer mwt_…` API token only, checked by the same `AuthService.bearer` as REST (revoked/expired/unknown → `401 UNAUTHENTICATED` problem with `WWW-Authenticate: Bearer`; disabled user → `403 ACCOUNT_DISABLED`). Cookies are ignored (no CSRF surface).
- **Server info** `{ name: 'md-wiki', version: '1.0.0' }`, capability `tools` (`listChanged: false`), `instructions` = content is data, discussion tools never approve or publish, send bindings back as read, reread after `DISCUSSION_CHANGED`.
- **Tools** (each calls the same service method as the REST endpoint and validates its arguments with the same class-validator DTO; a tool is listed only when `can(actor, action, {})` holds for its action [D-113]):

| Tool | Action | REST equivalent |
| --- | --- | --- |
| `wiki_tree { topic? }` | `wiki.read` | `GET /wiki/tree` |
| `wiki_read { path, versionLabel? }` | `wiki.read` (+ `history.read` for a version) | `GET /wiki/pages/{path}[/versions/{label}]` |
| `wiki_context { path }` | `wiki.read` | `GET /context` |
| `wiki_search { q, labels?, topics?, updated?, sort?, limit?, cursor? }` | `search` | `GET /search` |
| `contribution_submit { …ContributionInput }` → `{ replay, proposal }` | `proposal.submit` | `POST /contributions` |
| `contribution_get { slug }` | `wiki.read` | `GET /contributions/{slug}` |
| `topic_list`, `topic_get { id }` | `wiki.read` | `GET /topics`, `GET /topics/{id}` |
| `topic_open`, `topic_comment { id, … }`, `topic_close { id, … }`, `topic_reopen { id, … }` | `topic.open` (+ §7.5.3) | `POST /topics`, `/topics/{id}/comments`, `/close`, `/reopen` |
| `proposal_discussion_get { slug }`, `proposal_discussion_open { slug, … }` | `wiki.read` / `topic.open` | `GET`/`POST /proposals/{slug}/discussion` |
| `dispute_record { slug, … }` | `dispute.write` | `POST /proposals/{slug}/disputes` |
| `review_list`, `review_get { slug }`, `review_diff { slug, against? }` | `proposal.read` | `GET /proposals`, `/proposals/{slug}`, `/diff` |
| `review_decide { slug, approve, reason, bundleHash, artifactHash, previewAt, discussionVersion, disputeVersion }` → `{ replay, proposal }` | `proposal.read` to list; the decision runs §7.4.3 in full | `POST /proposals/{slug}/decisions` |

- **Results**: success → `structuredContent` = the REST response body (wrapped as noted) and the same JSON as one text block. **Errors** [D-114]: an `AppError` becomes a tool result with `isError: true` and `structuredContent.error = { code, status, detail, fields }` — the same `code`/`status`/`fields` REST returns; anything else is logged and returned as `INTERNAL` (never a stack). Unknown argument keys are refused by the DTO (`VALIDATION_FAILED`); arguments of the wrong JSON type are refused by the SDK's schema check before the tool runs (JSON-RPC/tool error without a code).
- The server is a protocol adapter only: no tool writes storage or the database except through the services above (md-wiki `mcp.py` "delegates every state transition").

#### 7.5.10 Web (F-11, *Ask a question*, Review › Discussion; P6-04 … P6-06) [D-118 … D-123]

| Route | Screen | Data | Writes |
| --- | --- | --- | --- |
| `/work/discussions?filter=&topic=` | F-11 Discussions | `GET /topics?filter&limit=50`, `GET /topics/{id}` | `POST /topics/{id}/comments` (`kind: comment`), `/close`, `/reopen` — each with `version` |
| `/ask?path=&section=&q=` | *Ask a question* (derived) | `GET /wiki/tree`, `GET /wiki/pages/{path}` | `POST /topics` |
| `/work/proposals/:slug` › Discussion | Review tab (derived) | `GET /proposals/{slug}/discussion` | `POST …/discussion`, `POST …/disputes` (*Hold for discussion*, *Resolve*), topic writes as F-11 |

- Query keys: `['topics', {filter, limit}]`, `['topic', id]`, `['proposal-discussion', slug]`. A topic write caches the returned detail and invalidates `['topics']`; on a proposal topic also `['proposal-discussion', slug]`, `['proposal', slug]`, `['proposals']`. Dispute writes invalidate the same proposal keys.
- Controls follow `TopicDetailDto.can` and `ProposalDetailDto.can.decide` (D-120, D-122). `DISCUSSION_CHANGED` on a topic write locks the thread until *Reload*; on the review screen a version change seen through SSE locks the decision until *Reload* (D-123).

#### 7.5.9 Agent skill (P6-03)

`skills/wiki-knowledge-workflow/` ports md-wiki's skill to this API: `SKILL.md` (roles, scopes ↔ tools, connection, invariant rules), `references/contribution.md`, `reviewer.md`, `discussions.md` (topics, holds, dispute log; replaces `semantic-conflicts.md`), `merge-conflicts.md`, `quality.md` (unchanged), `agents/openai.yaml`. A test (`apps/api/test/skill.test.ts`) fails when the skill names an MCP tool or REST endpoint that does not exist, or omits a tool [D-116].

### 7.6 Phase 7 — Quality check (full contract, P7-00)

Behavioural spec: plan.md › Phase 5, architecture.md › services/worker and Trust boundary, md-wiki `skills/wiki-knowledge-workflow/references/quality.md` (the rules) and `experiments/poisoning/quality.py` (the E3 quality set the eval runs on). Worker foundation: §7.3. Decisions D-130 … D-144. UI tasks (P7-05 Quality card in F-10 and Self-check in F-06, P7-06 Settings › Models, Operations › AI jobs) bind to these contracts.

**AI output is advisory** (architecture.md › Trust boundary): no quality result changes a proposal's state, assignment, preview binding or decision checks (§7.4.3 is unchanged). Review, decide and publish work with the worker stopped, Redis down or the provider failing.

#### 7.6.1 Data model (Prisma) [D-130]

```text
enum AiJobKind      ping | quality_check
enum AiJobTrigger   dev | submit | rerun | self_check
enum FindingSeverity info | warning | blocking
enum FindingOrigin  model | rule

AiJob(+ trigger AiJobTrigger default dev, proposalId? → Proposal, draftId? uuid (no FK: drafts are deleted on submit),
      requestedById? → User, bundleHash?, rulesSha256?, provider?, model?, promptVersion?, tokensIn?, tokensOut?,
      dropped jsonb?)                     index(proposalId, createdAt)  index(draftId, createdAt)  index(kind, createdAt)
                                          index(status, createdAt)
Finding(id, jobId → AiJob, proposalId? → Proposal, draftId? uuid, ord int, rule, severity, message, block, quote,
      lineStart int?, lineEnd int?, origin, original jsonb?, createdAt)
      unique(jobId, ord)  index(proposalId)                                   append-only
```

- architecture.md's `queued_at` is `createdAt`; `error` keeps the §7.1 `{ code, message }` JSON; `explanation` is `message`; `rule_id` is `rule`. **`quote_verified` is not stored**: only verified findings are stored, the dropped ones are counted in `AiJob.dropped = { unknownRule, unknownBlock, emptyQuote, quoteNotFound }` (§7.3, D-73).
- `Finding` rejects `UPDATE`/`DELETE` (trigger, §4). A job's findings are inserted once, in the transaction that moves the job to `succeeded`.
- `bundleHash` binds a run to what was checked: the proposal's frozen `bundleHash`, or for a draft self-check the **draft digest** (§7.6.6). `rulesSha256` is the SHA-256 of the rules file bytes the API sent.
- Idempotency (architecture.md "kind + proposal + bundle hash + prompt version"): at most one **active** run (`queued`/`running`, younger than the lease of 15 min) per subject and kind; asking again returns it (§7.6.5). A finished run is never re-run in place: a re-run is a new row.

#### 7.6.2 Rules file [D-132]

- `rules/quality.md` at the repo root (API env `QUALITY_RULES_PATH`, default `rules/quality.md`, resolved like `WIKI_ROOT`). Format §7.3: each `## ` heading outside code fences is a rule, id = explicit `{#id}` or the heading slug; ≤ 64 KiB UTF-8; duplicate ids / no rules / invalid UTF-8 → invalid. The text before the first rule is the preamble (sent, not a rule).
- Parsed by `domain/quality.ts#parseQualityRules(bytes)` (TS port of the worker parser; both are tested on the same cases and on the real file). The API is the **only reader** of the file: it reads it when a run is created and copies `{ path, sha256, text }` into the job input, so a run always uses the rules it was created with and the worker needs no file access. The worker re-hashes `text` (UTF-8) and refuses a mismatch (`input_invalid`).
- The rule `dropped-hedge` names the deterministic rule of §7.3; it runs only when the rules file declares it.
- An unreadable or invalid rules file never fails a submission: the run is inserted directly as `failed` with `error = { code: 'rules_invalid', message }`; `GET /admin/rules` reports the problem (§7.6.7).

#### 7.6.3 Job kind `quality_check` (wire, §7.1) [D-133, D-134, D-143]

Schemas `packages/contracts/jobs/quality_check.input.schema.json` and `quality_check.output.schema.json`; `envelope.kind` gains `quality_check`; `result.output` becomes `oneOf` the kinds' outputs (each kind's output is validated against its own schema by the API, §7.1).

```ts
interface QualityCheckInput {
  subject: { kind: 'proposal' | 'draft'; id: uuid; slug: string | null; targetPath: string; section: string | null };
  bundleHash: hex64;
  blocks: { id: string /* ^[a-z][a-z0-9-]{0,39}$, unique */; kind: 'proposal' | 'base' | 'source';
            label: string /* path@version, "proposed", "reason", "title" */; text: string }[];   // 1..40
  rules: { path: string; sha256: hex64; text: string /* ≤ 65536 chars */ };
}
interface QualityCheckOutput {
  promptVersion: string /* 1..40 */; provider: string /* 1..40 */; model: string /* 1..200 */;
  rulesSha256: hex64 /* = input.rules.sha256 */;
  usage: { inputTokens: int ≥ 0; outputTokens: int ≥ 0 };
  findings: { rule: string; severity: 'info' | 'warning' | 'blocking'; message: string /* 1..2000 */;
              quote: { block: string; text: string /* 1..4000 */ }; origin: 'model' | 'rule';
              original: { block: string; text: string } | null /* dropped-hedge: the hedged sentence */ }[];   // ≤ 200
  dropped: { unknownRule: int; unknownBlock: int; emptyQuote: int; quoteNotFound: int };
}
```

- **Blocks** (built by the API, in this order): `title` (kind `proposal`, the proposal/draft title; omitted when empty), `reason` (`proposal`; omitted when empty), `proposed` (`proposal`, the proposed file), `base` (`base`, the base snapshot; absent for a create), `source-1` … `source-n` (`source`, each declared source snapshot, in manifest order). Base and source texts have their status block stripped (`domain/status-block`); `proposed` never has one. Bytes are decoded as UTF-8 (they were validated at freeze). Every block is untrusted data and is fenced (§7.3).
- **Worker** (`services/worker/src/mdwiki_worker/quality/job.py`, P7-02): fetch input (§7.1) → validate → parse rules from `text` (sha check) → fence blocks with a fresh nonce → system prompt = instructions + rule ids + rules text + `data_instruction(nonce)`, user = fenced blocks + task → `complete_structured(provider, request, ModelOutput)` with the kind's model config (§7.3) → `verify_findings` (drops counted) → dropped-hedge candidates (`proposed` against `base` and each source; one finding per derived sentence, best match; `severity: warning`, `origin: rule`) → post `ok`. `promptVersion` is the worker constant `quality-v1`.
- **Worker failures** → `{ status: 'failed', error }` with the §7.3 codes (`provider_error`, `provider_timeout`, `rate_limited`, `schema_invalid`) plus `input_invalid` (input fails its schema or the rules sha), `rules_invalid` (rules text does not parse), `worker_error` (any other exception in the handler; message = exception class only). A missing provider credential is `provider_error`. Transport errors to the internal API propagate (BullMQ retries, §7.1).
- **API result handling** (`POST /internal/v1/jobs/{id}/result`, §7.1 order): finished-job replay rules unchanged; `ok` output must match the output schema and `rulesSha256 = job.rulesSha256` (else `400 VALIDATION_FAILED`, job stays `running`). Then the API **re-verifies every finding** against the job's own input [D-134]: `rule` ∈ rule ids of `input.rules.text`, `quote.block` ∈ input blocks (and `original.block` when present), normalised quote (`normalizeQuote` = NFC, whitespace incl. NBSP/ZW/BOM runs → one space, trimmed) is a non-empty substring of the normalised block — a failing finding is **dropped and counted** (the counts are added to the worker's), never stored. Identical findings (rule, block, normalised quote) collapse. `lineStart`/`lineEnd` = 1-based lines of the first occurrence of the quote in the block's text (`locateQuote`). For `proposed` these are lines of the proposed file (the preview artifact adds the status block's lines above them, D-33). One transaction stores findings (`ord` = output order), `provider`, `model`, `promptVersion`, tokens, `dropped`, `status = succeeded`; then SSE `quality.changed`. A `failed` result stores `error` (and nothing else) as in §7.1.

#### 7.6.4 Runs, freshness and flags (`domain/quality.ts`) [D-135, D-138, D-139]

- `runStatus` of a subject = the latest run's status, or `none`. **Current** run = the latest **succeeded** run whose `bundleHash` equals the subject's current hash (proposal: always its frozen `bundleHash`; draft: the current draft digest). A run whose hash differs is **stale**: it is listed in `runs` with `current: false` and never feeds counts, flags or the summary.
- `rulesChanged` = the run's `rulesSha256` ≠ the rules file's current sha (informational; the findings stay current).
- **Severity** vocabulary is `info | warning | blocking` (D-73); the frame's "medium" is `warning` (presentation belongs to P7-05).
- **Flags** `qualityFlags(currentRun, latestRun)` (advisory; Phase 8's escalation triggers read them, nothing else does): `blocking_finding` (current run has a `blocking` finding), `dropped_hedge` (current run has an `origin: rule` finding), `check_failed` (latest run `failed`). Order as listed.
- `QualitySummaryDto = { status: 'none'|'queued'|'running'|'succeeded'|'failed', findings: int, counts: { info, warning, blocking }, flags: QualityFlag[], current: boolean /* a current run exists */ }` — counts/flags from the current run (0 / `[]` without one; `check_failed` from the latest run).
- Lease: an active run older than 15 min (`createdAt`) counts as lost: a new run supersedes it (it is set `failed`, `error = { code: 'superseded', message: 'Superseded by a newer run' }`; a late result for it is then refused as a finished job, §7.1). A self-check whose draft digest changed also supersedes the active run.

#### 7.6.5 Proposal quality check (submit, on demand) [D-131, D-136]

- **On submit**: the single freeze path (§7.2, `ProposalFreezer`) inserts the `quality_check` run (`trigger: submit`, `requestedById: null`) **in the proposal's insert transaction** (an outbox row: the job input is built from the bytes being frozen); after commit the API enqueues the §7.1 envelope best-effort (errors logged, never surfaced; the submit response does not wait for Redis). Replays (§7.2.5) create nothing. Conflict replacements (§7.4.7) are submissions and get a run.
- **Dispatch recovery**: at boot (after publish recovery) every `queued` `quality_check` row is enqueued again (BullMQ job id = row id, so a still-queued job is not duplicated).
- **On demand**: `POST /proposals/{slug}/quality-check` (permission `proposal.read`, i.e. reviewer+, token scope `review`; a submitter without that role gets `FORBIDDEN`, D-136) → state must be `pending` (else `PRECONDITION_FAILED`); an active run within the lease → `200 QualityRunDto` of that run (nothing created); else a new run (`trigger: rerun`, `requestedById` = caller, audit `quality.requested { jobId, trigger }` on the proposal) → `202 QualityRunDto`.
- `GET /proposals/{slug}/findings` (visibility = proposal detail: submitter or role ≥ reviewer, else `NOT_FOUND`) → `QualityReportDto`.
- `ProposalListItemDto.quality` and `ProposalDetailDto.quality` = `QualitySummaryDto`; `ProposalDetailDto.can.rerunQuality` = `proposal.read` allowed and `pending`.

#### 7.6.6 Author self-check on drafts [D-137]

- `POST /drafts/{id}/self-check` (`draft.*`, own draft else `NOT_FOUND`): composes the draft like submit (§7.2.3: `UNKNOWN_SECTION` when the section left the base; a blank reason is allowed) and creates a run (`trigger: self_check`, `draftId`, `requestedById` = author) → `202 QualityRunDto`; an active run of the same draft within the lease **and the same digest** → `200` with it (a different digest supersedes it).
- **Draft digest** `draftDigest({ targetPath, baseSha256, section, proposedSha256, title, reason, sources: [{ path, sha256 }] })` = SHA-256 of the canonical JSON (keys in that order, sources in draft order). Every autosave that changes one of these makes earlier runs stale.
- `GET /drafts/{id}/self-check` (own draft) → `QualityReportDto` (subject `draft`); `current` per §7.6.4 against the draft's current digest.
- Self-check runs and findings are visible only to the draft's author (and, without content, in Operations). Submitting the draft does not carry them over: the proposal gets its own `submit` run.

#### 7.6.7 Endpoints and DTOs

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/proposals/{slug}/quality-check` | `proposal.read` | — | `202 QualityRunDto` · `200` active run | `NOT_FOUND`, `PRECONDITION_FAILED`, `VALIDATION_FAILED` |
| GET | `/proposals/{slug}/findings` | `wiki.read` + visible | — | `QualityReportDto` | `NOT_FOUND`, `VALIDATION_FAILED` |
| POST | `/drafts/{id}/self-check` | `draft.*` + own | — | `202 QualityRunDto` · `200` active run | `NOT_FOUND`, `VALIDATION_FAILED` (`UNKNOWN_SECTION`) |
| GET | `/drafts/{id}/self-check` | `draft.*` + own | — | `QualityReportDto` | `NOT_FOUND` |
| GET | `/admin/models` | `admin.models` | — | `ModelsDto` | |
| GET | `/admin/rules` | `admin.rules` | — | `RulesDto` | |
| GET | `/ops/jobs` | `admin.jobs` | `?kind&status&limit&cursor` | `JobListDto` (`createdAt desc, id desc`, cursor `<epoch ms>.<uuid>`) | `VALIDATION_FAILED` |

```ts
type QualityFlag = 'blocking_finding' | 'dropped_hedge' | 'check_failed';
interface FindingDto { id: string; rule: string; ruleTitle: string | null /* from the run's rules */; severity: 'info'|'warning'|'blocking';
  message: string; block: string; quote: string; lineStart: number | null; lineEnd: number | null;
  origin: 'model' | 'rule'; original: { block: string; text: string } | null }
interface DroppedDto { unknownRule: number; unknownBlock: number; emptyQuote: number; quoteNotFound: number; total: number }
interface QualityRunDto { id: string; trigger: 'submit'|'rerun'|'self_check'; status: 'queued'|'running'|'succeeded'|'failed';
  bundleHash: string; current: boolean /* bundleHash = subject's current hash */; rulesSha256: string | null; rulesChanged: boolean;
  provider: string | null; model: string | null; promptVersion: string | null; tokensIn: number | null; tokensOut: number | null;
  error: { code: string; message: string } | null; dropped: DroppedDto | null; counts: { info; warning; blocking };
  findings: FindingDto[]; requestedBy: UserRefDto | null; createdAt: string; startedAt: string | null; finishedAt: string | null }
interface QualityReportDto { subject: { kind: 'proposal' | 'draft'; id: string; slug: string | null }; bundleHash: string /* current */;
  summary: QualitySummaryDto; current: QualityRunDto | null; latest: QualityRunDto | null;
  runs: QualityRunDto[] /* newest first, ≤ 10; findings only on current and latest, [] otherwise */;
  can: { rerun: boolean } }
interface ModelsDto { jobs: { kind: 'quality_check'; provider: string; model: string; maxTokens: number; timeoutS: number;
    maxAttempts: number; overridden: boolean }[];
  openaiCompat: { baseUrl: string | null /* scheme://host:port only */ };
  lastUsed: { kind: string; provider: string; model: string; promptVersion: string | null; at: string }[] }
interface RulesDto { path: string; sha256: string | null; size: number | null; error: string | null;
  rules: { id: string; title: string; body: string }[]; preamble: string }
interface JobListItemDto { id: string; kind: 'ping' | 'quality_check'; trigger: 'dev'|'submit'|'rerun'|'self_check'; status;
  subject: { kind: 'proposal'; slug: string | null; title: string | null } | { kind: 'draft'; slug: null; title: null } | null;
  provider: string | null; model: string | null; promptVersion: string | null; tokensIn: number | null; tokensOut: number | null;
  findings: number | null; error: { code: string; message: string } | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null }
interface JobKindSummaryDto { kind; queued: number; running: number; failed24h: number; last: JobListItemDto | null /* latest finished */ }
interface JobListDto { kinds: JobKindSummaryDto[] /* quality_check always; ping only when rows exist */; items: JobListItemDto[]; nextCursor: string | null }
```

- **Permissions**: `admin.models`, `admin.rules`, `admin.jobs` are `admin.*` (owner) [D-141]. The F-14 *Models* tab and Operations › Background jobs are owner screens.
- **Models** [D-140] are configured by environment only (shared `.env`: `AI_DEFAULT__*`, `AI_JOBS__QUALITY_CHECK__*`, `OPENAI_COMPAT_BASE_URL`, §7.3); `/admin/models` reports what the API process sees with the worker defaults applied, and `lastUsed` from the latest succeeded run per kind (what the worker really used). Secrets are never returned.
- **Rules** [D-140]: `GET /admin/rules` parses the file at request time; a missing/invalid file → `200` with `error` set, `rules: []`, `sha256` of the bytes when readable.
- `/ops/jobs` lists metadata only (no prompt, input or finding text); a draft subject shows no title or path.
- **Audit** [D-144]: `quality.requested { jobId, trigger }` (subject `proposal`, actor the caller) for on-demand re-runs; submit and self-check runs are not audited (the job row is the record).
- **SSE** [D-144]: `quality.changed { slug }` (proposal runs; audience = proposal audience) or `{ draftId }` (self-check; audience = the author only) after a run is created and after its result is stored. `EventDto` gains optional `draftId`. Invalidates `['proposal', slug]`, `['proposals']`, `['quality', slug]` / `['draft', id, 'self-check']`. Result events are emitted by the internal listener; both Nest apps of one process share one in-process event bus.

#### 7.6.8 Eval command (P7-04) [D-142]

`uv run mdwiki-worker eval DATASET.jsonl [--rules ../../rules/quality.md] [--out report.json] [--limit N]` runs the same prompt, verification and hedge rule as the job (no API, no Redis) with the `quality_check` model config from the environment, and prints a per-rule table. The dataset lives outside the repo (the E3 quality set from md-wiki is converted to this format by the caller); a real-model run spends credits and is only started by the orchestrator.

- **Dataset line**: `{ "id": string, "targetPath"?: string, "title"?: string, "reason": string, "base": string | null, "proposed": string, "sources"?: [{ "path", "text" }], "expected": string[] /* rule ids */ }` or, instead of `expected`, `"class": <E3 class name>` mapped by `E3_CLASS_RULES` (clean classes → `[]`, `real_reverted` → bad with no specific rule). Blank lines are skipped; a bad line stops the run with its line number.
- **Report** (JSON to `--out`, table to stdout): per rule `tp, fp, fn, precision, recall` (a rule is *predicted* for an item when a kept finding cites it; `null` when undefined); per item `{ id, expected, predicted, bad, flagged, dropped, error }`; overall `items: { bad, clean, caught, falseAlarms, detection, falseAlarmRate }` (an item with any expected rule or a bad class counts as bad; flagged by any finding = caught; a clean item with any finding = false alarm), dropped counts by reason, provider, model, prompt version, rules sha. Items whose call fails are counted under `errors` and excluded from P/R and detection.

### 7.7 Phase 9 — Credibility (full contract for 7a, 7c, 7d; 7b outline; P9-00)

Behavioural source: `md-wiki/docs/research/page-credibility.md` (§5 model, §6 reader interactions, §7 E8) and architecture.md › Credibility. Decisions D-160 … D-199. Every number-driven behaviour stays behind a gate (§7.7.10); weights of reader attestations are 0. UI tasks P9-09 … P9-14 bind to these contracts.

#### 7.7.1 Data model (Prisma) [D-160]

```text
enum SourceCheckResult  supported | not_supported | unverifiable
enum AttestationKind    useful | checked | used | report
enum AttestationStatus  withdrawn | confirmed | confirmed_error | dismissed | fixed | downweighted
enum InvalidationKind   retraction | concern | source_changed | version_changed | contradiction | root_wrong
enum ErrorOrigin        report | source_check | flag | spot_check | manual
enum FlagCause          report | retraction | source_changed | version_changed | contradiction | root_wrong | propagated
enum EdgeKind           copy | corroborates | contradicts | lab_data
enum FollowReason       manual | attested | contributed
enum NotificationChannel in_app | email_daily | off
enum FeedbackAnswer     yes | partly | no

SourceCheck(id, path, anchor, sectionHash, versionLabel, sourceRef, sourceTitle?, sourceSnapshotId?, result,
      excerpt?, location?, comparedNumbers bool, note?, checkerId, checkerKind ReviewerKind, proposalId?, createdAt)
      index(path, anchor, sectionHash)  index(sourceRef)                              append-only
OwnerConfirmation(id, path, anchor, sectionHash, versionLabel, ownerId, note, createdAt)   index(path, anchor, sectionHash)  append-only
InvalidationEvent(id, kind, ref, detail, detectedAt, recordedById?, jobId?)          index(ref)     append-only
ConfirmedError(id, path, anchor, sectionHash, reason, origin, originId?, confirmedById, createdAt)
      index(path, anchor, sectionHash)                                                append-only
RecheckFlag(id, path, anchor, sectionHash, cause, causeId?, reason, depth int ≥ 0, createdAt)
      index(path, anchor, sectionHash)  index(causeId)                               append-only
CredibilityResolution(id, subjectType flag|retraction|edge|candidate, subjectId, path?, anchor?, sectionHash?,
      outcome, reason, actorId, createdAt)                                            index(subjectId)  append-only
Attestation(id, path, anchor, sectionHash, versionLabel, actorId, teamId?, role Role, kind, details jsonb,
      blocking bool, note?, sawCounts bool, topicId?, createdAt)
      index(path, anchor, sectionHash)  index(actorId, createdAt)                    append-only (purge, §7.7.7)
AttestationEvent(id, attestationId, seq int ≥ 1, actorId?, status, reason, createdAt)
      unique(attestationId, seq)                                                     append-only (purge)
PageFeedback(id, path, versionLabel, actorId, teamId?, answer, createdAt)  index(path, versionLabel)   append-only (purge)
CredibilityAggregate(path, anchor, sectionHash, versionLabel, metric, teamKey, count, updatedAt)
      pk(path, anchor, sectionHash, versionLabel, metric, teamKey)                   cache of purged raw rows
EdgeCandidate(id, kind, srcPath, srcAnchor, dstPath, dstAnchor, score float, jobId?, detail jsonb, createdAt)   append-only
CredibilityEdge(id, kind, srcPath, srcAnchor, dstPath, dstAnchor, candidateId?, confirmedById, createdAt)       append-only
AnchorLink(id, path, oldAnchor, oldHash, newAnchor, newHash, proposalId?, reviewerId?, createdAt)
      unique(path, newAnchor, newHash, oldAnchor, oldHash)                           append-only
Follow(userId, path, anchor default '', reason, createdAt, mutedAt?)  pk(userId, path, anchor)   state row
NotificationPref(userId, event, channel)  pk(userId, event)                          state row
Notification(id, userId, event, path?, anchor?, data jsonb, createdAt, readAt?, emailedAt?)  index(userId, createdAt)
CredibilityGate(capability pk, enabled bool, runRecord?, runDate date?, actorId?, updatedAt)   state row, audited
```

- Credibility record tables reference users, topics, proposals and snapshots **by id without foreign keys** [D-160]: the retention purge deletes raw rows, and audit/label code never joins through them; ids are validated by the service at write time. They are not declared as Prisma relations.
- Append-only (§4): a trigger rejects `UPDATE` and `DELETE` on `SourceCheck`, `OwnerConfirmation`, `InvalidationEvent`, `ConfirmedError`, `RecheckFlag`, `CredibilityResolution`, `EdgeCandidate`, `CredibilityEdge`, `AnchorLink`. `Attestation`, `AttestationEvent` and `PageFeedback` reject `UPDATE` always and `DELETE` unless the transaction set `SET LOCAL md_wiki.purge = 'on'` (only the retention purge does) [D-169].
- **Status is derived, never stored on the record** [D-160]: an attestation's status is its latest `AttestationEvent` (none = `active`); `on_old_version` = its `sectionHash` is not the section's current hash (after anchor links); `stale` = an invalidation of its source ref happened after it (§7.7.3). A flag is open until a `CredibilityResolution` with outcome `still_correct` or `confirm_error` exists for it; `keep_recheck` records a decision and leaves it open. A candidate is open until resolved (`yes`/`no`); `ask_authors` records the question and leaves it open.

#### 7.7.2 Label engine (`domain/labels.ts#computeSectionLabel`) [D-161, D-179, D-180]

`SectionLabels.forSections(keys)` loads every record for the keys (and their anchor-link aliases) in one round of queries and calls `computeSectionLabel` per key **synchronously in the request**: a write that changes evidence and the read that follows see the same label; nothing waits for the worker. Inputs (all filtered to `sectionHash = currentHash` by the pure function):

| Rule | Input | Records |
| --- | --- | --- |
| 1 *Confirmed error* | `confirmedErrors` | `ConfirmedError` rows; valid human source checks with `not_supported` (reason "A person found the source does not support it") |
| 2 *Under re-check* | `openRecheckReasons` | open `RecheckFlag` rows (confirmed reports, propagated flags, source changes, contradictions); valid **agent** source checks with `not_supported` ("The reviewer agent found the source does not support it"); a cited source with an open retraction (`InvalidationEvent` kind `retraction` on a ref the section text cites, §7.7.5, not resolved `still_correct` for this section hash) ("A cited source was retracted"); a section topic (`Topic.anchor` = anchor, no proposal) with status `on_hold` ("A discussion on this section is on hold") [D-180]; a confirmed `contradicts` edge not resolved, **on the weak side only** (below) |
| 3 *Not reviewed* | `reviewedVersions` | `PublishedSection` rows (§7.4.10) |
| 4 *Checked against source* | `sourceChecks` (`checkerKind = person`, `supported`, `valid`), `ownerConfirmations` (`valid`), optional `threshold` | `SourceCheck`, `OwnerConfirmation` |
| 5 *Reviewed* | latest review; `reason = 'source not checkable'` when the latest valid source check on the hash is `unverifiable` and none is `supported` | |

- `threshold?: { enabled: boolean; theta: number; hysteresis: number; p: number | null; previous: Label | null }` (gate `label_threshold`, §7.7.10). When enabled and `p !== null`, rule 4 also needs `p ≥ θ`, or `p ≥ θ − hysteresis` when `previous = 'checked'`; `p = null` (score not yet computed) leaves rule 4 as without θ. Off by default, so rule 4 is evidence-only.
- **No vote path** [D-161]: attestations (`useful`, `checked`, `used`), page feedback, links, copies and corroboration edges are not inputs of `computeSectionLabel` at all; only an accountable human action (human source check, owner confirmation) reaches rule 4. Agent `supported` checks are shown in *Why* and counted in the shadow score only.
- **Contradiction asymmetry** [D-179] (`contradictionApplies(self, other)`): a confirmed `contradicts` edge puts a side under re-check unless that side is *strong*: `groups(self) ≥ 2` and `groups(self) > groups(other)`, where `groups` = number of distinct provenance roots = external refs with a valid `supported` source check (person or agent) on the current hash. Balanced or common-root contradictions put both sides under re-check.
- Rule 1–2 metadata keeps D-34 (earliest open record); `reviewerKind` is `null` for rules 1–3.
- **Validity** [D-162]: a source check or owner confirmation is valid when bound to the current hash (directly or through anchor links) and no `InvalidationEvent` of kind `retraction`, `source_changed` or `root_wrong` on its `sourceRef` was detected after it (owner confirmations have no ref: only the hash binding applies). `concern` and `version_changed` never invalidate (concern only warns, research §5.6; `version_changed` creates flags instead).
- **Page label** stays `pageLabel(sections)` = worst section + spread (§6).
- `SectionDto.warn.fixProposalSlug` = the newest pending proposal on the path whose `section` is the anchor or `null` (whole page) when the label is `recheck`/`error`.

#### 7.7.3 Evidence writes [D-163, D-164, D-165]

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/source-checks` | **new `source_check.record`** (reviewer, scope `review`) | `SourceCheckInput` | `201 SourceCheckResultDto` | `FORBIDDEN`, `SELF_REVIEW` (author of the section version), `NOT_FOUND`, `INVALID_PATH`, `SECTION_CHANGED`, `VALIDATION_FAILED` |
| POST | `/owner-confirmations` | `credibility.decide` | `OwnerConfirmationInput` | `201 SourceCheckResultDto` | `FORBIDDEN`, `NOT_FOUND`, `INVALID_PATH`, `SECTION_CHANGED`, `VALIDATION_FAILED` |
| POST | `/credibility/anchor-links` | `credibility.decide` | `{ path, oldAnchor, newAnchor }` | `201 AnchorLinkDto` | `FORBIDDEN`, `NOT_FOUND`, `PRECONDITION_FAILED` (bodies differ, or `newAnchor` already exists in the old version), `ALREADY_EXISTS` |

```ts
interface SectionRefInput { path: string; anchor: string; sectionHash: hex64 }
interface SourceCheckInput extends SectionRefInput { sourceRef: string /* 1..500, normalized §7.7.5 */; sourceTitle?: string /* ≤ 200 */;
  result: 'supported' | 'not_supported' | 'unverifiable'; excerpt?: string /* ≤ 4000 */; location?: string /* ≤ 200 */;
  comparedNumbers?: boolean; note?: string /* ≤ 2000 */; proposalSlug?: string; sourceSnapshotId?: uuid }
interface OwnerConfirmationInput extends SectionRefInput { note: string /* trimmed 1..2000 */ }
interface SourceCheckResultDto { id: string; label: LabelDto /* the section's label after the write */; createdAt: string }
interface AnchorLinkDto { path: string; oldAnchor: string; newAnchor: string; oldHash: string; newHash: string; createdAt: string }
```

- `SECTION_CHANGED` (409) whenever `sectionHash` is not the current hash of `(path, anchor)` — the same binding as a decision to its bundle hash; unknown page → `NOT_FOUND`, unknown anchor in the current version → `VALIDATION_FAILED` field `anchor` code `UNKNOWN_SECTION`.
- The response carries the recomputed label (same request). A human `not_supported` check makes it *Confirmed error*.
- **Page authors** [D-164]: the one rule of §7.8.5 (D-206, `domain/page-authors.ts`): the **last** matching row of `wiki-meta/owners.md` (CODEOWNERS order; columns `Pages`/`Path` and `Email`/`Authors`/`Owners`), else the enabled humans whose proposals on the path were published, else the oldest enabled owner. A user with role `owner` always counts as a page author for `credibility.decide`. `credibility.decide` = role ≥ reviewer **and** page author (§5.2). `PageDto.maintainers` = the page authors' names.
- **Anchor relinking** [D-163] (`domain/credibility.ts#detectRenames`): a section of the new version is a *pure rename* of a section of the previous version when their bodies (section text without the heading line, normalized like §3.3) are equal, the old anchor is absent from the new version, the new anchor is absent from the old one, and the match is one-to-one. At publish finish the API records an `AnchorLink` for every pure rename between the proposal's base and the artifact (`reviewerId` = the decision's reviewer, `proposalId`); reviewers can link manually under the same equality rule. Evidence recorded for `(path, oldAnchor, oldHash)` then counts for `(path, newAnchor, newHash)` (transitively). Anything but a pure rename resets evidence ("hash change resets evidence").

#### 7.7.4 Why this label and people who rely on it [D-168, D-184]

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/sections/{path}/{anchor}/why` | `wiki.read` | `?versionLabel` (default current) | `WhyDto` | `NOT_FOUND`, `INVALID_PATH` |
| GET | `/sections/{path}/{anchor}/people` | `wiki.read` | `?reveal=true` | `PeopleDto` | `NOT_FOUND`, `INVALID_PATH` |

```ts
type EvidenceKind = 'review' | 'source_check' | 'owner_confirmation' | 'confirmed_error' | 'flag' | 'retraction' | 'report' | 'edge' | 'anchor_link';
interface EvidenceDto { id: string; kind: EvidenceKind; at: string; actorKind: 'agent' | 'person' | 'system';
  summary: string; result: 'supported' | 'not_supported' | 'unverifiable' | null; sourceRef: string | null; sourceName: string | null;
  valid: boolean; onOldVersion: boolean; contributes: boolean /* counts for the label now */; open: boolean | null /* flags, reports */ }
interface WhyDto { path: string; anchor: string; title: string; versionLabel: string; sectionHash: string; label: LabelDto;
  meaning: string; evidence: EvidenceDto[] /* newest first */; changeIt: string[]; note: string; baseRateCalibrated: false;
  can: { recordSourceCheck: boolean; confirm: boolean; attest: boolean; report: boolean } }
interface TeamCountDto { team: string /* team name, or "No team" */; people: number }
interface PeopleCountDto { people: number; teams: TeamCountDto[] }
interface PeopleDto { hidden: boolean; acted: boolean /* the viewer has an active attestation on this hash */;
  checked: PeopleCountDto | null; used: PeopleCountDto | null; useful: number | null;
  onOldVersion: { checked: number; used: number } | null; purpose: string; mine: AttestationDto[] }
```

- Evidence lists records of the section across versions (old versions marked `onOldVersion`, `contributes: false`), newest first. Summaries describe evidence, never names: "Checked against <source> by a person", "Reviewed by the reviewer agent", "Reviewed by a person". `note` = "Labels follow fixed rules over these records; they are not a score." `changeIt` is derived from the winning rule (e.g. *reviewed* → "A person checks it against its source"; *recheck* → "A page author resolves the re-check"; *error* → "A correction is published"; *not_reviewed* → "A reviewer approves a change that contains it").
- **Hidden counts** [D-168]: `hidden = !acted && !reveal`; when hidden every count field is `null`. Counts include active and downweighted attestations on the current hash plus purged aggregates (§7.7.7); withdrawn ones never count. Readers see team counts only; names are never returned here (reviewers see names in the queue detail, §7.7.8). `purpose` = "For content quality, not for rating people." `mine` = the viewer's own attestations on any version of the section.
- `can` is computed by the API (§1 rule 2): `recordSourceCheck` (`source_check.record` and not the version's author), `confirm` (`credibility.decide`), `attest`/`report` (human, not the version's author/reviewer per §7.7.6).

#### 7.7.5 Sources, tiers and citations [D-175, D-176]

- **Cited sources** (`domain/credibility.ts#citedSources(text)`): DOIs (`10.\d{4,9}/…`, bare or as `doi.org` links) → `doi:<lowercased doi>`; other Markdown/auto links with `http(s)` → `url:<url without fragment>`; wiki links are derivations, not sources. Deduplicated in order. `normalizeSourceRef` applies the same to `SourceCheckInput.sourceRef` (`doi:`/`url:` prefixes kept; other text is kept trimmed as a free reference, e.g. a manual title).
- **Source tiers** (`domain/credibility.ts#parseSourceTiers(markdown, today)`): `wiki-meta/source-tiers.md` (reviewed like content), first table with header columns `Source`, `Match`, `Tier`, `Reason`, `Reviewed` (case-insensitive, any order). `Tier ∈ high | medium | low`; `Match` = a ref prefix (`doi:10.1101/`, `url:https://www.fpbase.org/`); `Reviewed` = `YYYY-MM-DD`. Warnings (never throws): `NO_TABLE`, `MISSING_COLUMN`, `BAD_TIER`, `BAD_DATE`, `DUPLICATE_MATCH`, `STALE_REVIEW` (older than 4 years, WP:RSP), each `{ line, code, message }`. `tierOf(ref, tiers)` = the longest matching prefix, else `null`. **A tier never changes a label** (architecture.md › Source tiers).

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/credibility/source-tiers` | `wiki.read` | | `{ path, versionLabel \| null, tiers: SourceTierDto[], warnings: TierWarningDto[] }` | |
| POST | `/credibility/source-warnings` | `wiki.read` | `{ path, content /* ≤ 1 MiB */ }` | `{ added: { ref, tier: 'high'\|'medium'\|'low'\|null, retracted: boolean, warning: string \| null }[] }` | `INVALID_PATH`, `VALIDATION_FAILED` |

`source-warnings` lists sources cited in `content` but not in the current version of `path` (all when the page is new), with a warning for `low` tier ("Low-tier source: <reason>") and for a retracted ref. The editor and review screens show it; it never blocks a submit.

#### 7.7.6 Reader actions: attestations, reports, feedback [D-166, D-167]

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/attestations` | `attest` (humans only) | `AttestationInput` | `201 AttestationResultDto` | `FORBIDDEN`, `NOT_FOUND`, `INVALID_PATH`, `SECTION_CHANGED`, `ALREADY_EXISTS`, `RATE_LIMITED` (a `contradicts` check opens a report), `VALIDATION_FAILED` |
| POST | `/attestations/{id}/withdraw` | the attestation's actor | `{ reason?: string ≤ 2000 }` | `200 AttestationDto` | `FORBIDDEN`, `NOT_FOUND`, `PRECONDITION_FAILED` (already withdrawn, or a report already decided) |
| POST | `/reports` | `report` (humans only) | `ReportInput` | `201 AttestationResultDto` | as `/attestations` (+ `RATE_LIMITED`) |
| POST | `/page-feedback` | `feedback` (humans only) | `{ path, versionLabel, answer: 'yes'\|'partly'\|'no' }` | `201 { answer, versionLabel, createdAt }` | `FORBIDDEN`, `NOT_FOUND`, `INVALID_PATH`, `VALIDATION_FAILED` |

```ts
type AttestKind = 'useful' | 'checked' | 'used';
interface CheckedDetails { source: { ref: string /* 1..500 */; cited: boolean }; location: string /* 1..200 */;
  result: 'supports' | 'partly' | 'contradicts' | 'unverifiable'; comparedNumbers: boolean }
interface UsedDetails { use: 'acquisition' | 'analysis' | 'training' | 'protocol' | 'other'; worked: 'yes' | 'with_changes' | 'no';
  change?: string /* ≤ 2000, required unless worked = yes */ }
interface AttestationInput extends SectionRefInput { kind: AttestKind; sawCounts: boolean; note?: string /* ≤ 2000 */;
  checked?: CheckedDetails /* required iff kind = checked */; used?: UsedDetails /* required iff kind = used */ }
type ReportKind = 'wrong' | 'outdated' | 'unclear' | 'source' | 'other';
interface ReportInput extends SectionRefInput { kind: ReportKind; quote?: string /* ≤ 2000 */; suggestion?: string /* ≤ 4000 */;
  evidence?: string /* ≤ 4000 */; blocking: boolean; sawCounts: boolean }
type AttestationState = 'active' | 'withdrawn' | 'on_old_version' | 'stale' | 'downweighted' | 'open' | 'confirmed' | 'confirmed_error' | 'dismissed' | 'fixed';
interface AttestationDto { id: string; path: string; pageTitle: string; anchor: string; sectionTitle: string | null; versionLabel: string;
  kind: AttestKind | 'report'; details: object; blocking: boolean; note: string | null; state: AttestationState;
  outcomeReason: string | null; topicId: string | null; createdAt: string; undoUntil: string /* createdAt + 10 min */ }
interface AttestationResultDto { attestation: AttestationDto; report: AttestationDto | null /* the report a contradicts check opened */;
  people: PeopleDto /* revealed */; label: LabelDto; following: boolean }
```

- **Order of checks** (first failure wins): permission (`FORBIDDEN`: agents, token callers, role) → path (`INVALID_PATH`) → page (`NOT_FOUND`) → anchor in the current version (`VALIDATION_FAILED`/`UNKNOWN_SECTION`) → `sectionHash` current (`SECTION_CHANGED`) → own section version (`FORBIDDEN`, D-166) → fields (`VALIDATION_FAILED`) → duplicate (`ALREADY_EXISTS`: an active attestation of the same kind by the same person on the same hash; reports are not deduplicated) → report rate limit (`RATE_LIMITED`).
- **Own section version** [D-166]: the submitter of any `done` publication that produced this `(path, anchor, sectionHash)` may neither attest nor report it; its human reviewer (the decision's reviewer) may report it but not attest (already counted through the review).
- `checked` with `result = contradicts` also creates a report (kind `wrong`, quote = the location, evidence = the note) in the same transaction (`report` in the response). Weights stay 0: nothing here feeds a label.
- **Report** [D-167]: inserts the `Attestation` (kind `report`) and opens a section topic through the Phase 6 discussions service in the same transaction (`title` = "Report: <kind> — <section title>" cut to 120, `body` = kind, quote, suggestion and evidence as Markdown, author = the reporter, mentions = none), audits `report.opened`, notifies every page author (`report_received`, `data.blocking`): blocking reports are sent at once (in-app now, and an immediate email to authors whose channel is `email_daily`); others wait for the daily digest. Rate limit: **5 reports per person per page per 7 days** (`RATE_LIMITED` with `Retry-After` seconds until the oldest of them is 7 days old).
- **Auto-follow** [D-171]: `checked`, `used` and `report` create a `Follow(reason attested)` of the page unless one exists (a muted follow stays muted). `following` in the response.
- **Withdraw**: appends `AttestationEvent(status withdrawn)`; a report can be withdrawn only while open (its topic gets a `close rejected` entry "Withdrawn by the reporter"). Undo in the UI = withdraw within 10 minutes (`undoUntil`).
- Page feedback is stored per page version; the latest answer of a person for a version wins; it counts as *Useful* only and never changes a label.
- Audit: `attestation.created { kind, path, anchor, sectionHash }`, `attestation.withdrawn`, `report.opened { attestationId, topicId, blocking }`, `report.decided { outcome }`, `source_check.recorded { result, sourceRef }`, `owner_confirmation.recorded`, `anchor_link.created`, `credibility.decided { itemType, outcome }`, `credibility.gate_changed`, `credibility.maintenance`.

#### 7.7.7 Retention, rate limits, reciprocal pairs [D-169, D-170, D-183]

- `CredibilityMaintenance.run(now)` runs daily in-process (first run 1 min after boot; disabled when `NODE_ENV=test`) and on `POST /admin/credibility/maintenance` (owner) → `{ purged: { attestations, feedback }, pairs, digests }`.
- **Retention** (default 90 days, `CREDIBILITY_RETENTION_DAYS`): raw `Attestation` rows older than the cutoff whose state is final (`withdrawn`, `dismissed`, `fixed`, or not a report) and `PageFeedback` rows older than the cutoff are folded into `CredibilityAggregate` (`metric` = kind, or `feedback_<answer>`; `teamKey` = team id or `''`; withdrawn rows are dropped, not counted) and deleted with their events in one transaction under `md_wiki.purge`. Open and confirmed reports are kept until final. `retentionPlan(rows, cutoff)` in domain decides which rows go and what they add.
- **Reciprocal pairs** (`domain/credibility.ts#reciprocalPairs`): two people who each have an active `checked`/`used`/`useful` attestation on a section version the other authored (§7.7.6 authorship) form a pair; each such attestation gets one `AttestationEvent(downweighted, reason "Reciprocal attestations between two readers")`, visible to reviewers in the queue (item type `pair`, information only). Nothing is removed. Clusters larger than a pair are a follow-up for the 7b job.

#### 7.7.8 Workspace › Credibility [D-174]

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/credibility/queue` | `proposal.read` (reviewer) | `?type=report\|retraction\|flag\|candidate\|pair\|fix&limit&cursor` | `CredibilityQueueDto` | `VALIDATION_FAILED` |
| GET | `/credibility/queue/{type}/{id}` | `proposal.read` | | `QueueItemDetailDto` | `NOT_FOUND` |
| POST | `/credibility/decisions` | `credibility.decide` (page author of the item's path) | `{ type, id, outcome, reason /* trimmed 1..4000 */, version? }` | `200 QueueItemDetailDto` (with the labels after the decision) | `FORBIDDEN`, `NOT_FOUND`, `PRECONDITION_FAILED` (item already decided, outcome not allowed for the type), `SELF_REVIEW` (deciding on one's own report), `VALIDATION_FAILED` |
| GET | `/credibility/pages` | `proposal.read` | `?limit&cursor` | `{ items: CredibilityPageDto[], nextCursor, tiles: Record<Label, { sections: number; changeThisWeek: number }> }` | |
| GET | `/credibility/sources` | `proposal.read` | `?state&limit&cursor` | `{ items: CredibilitySourceDto[], nextCursor }` | `VALIDATION_FAILED` |
| POST | `/credibility/candidates` | `admin.*` (owner; the 7b worker posts through the internal API) | `EdgeCandidateInput` | `201 { id }` | `FORBIDDEN`, `VALIDATION_FAILED` |
| POST | `/credibility/invalidations` | `admin.*` (owner; the 7b worker posts through the internal API) | `{ kind, ref, detail }` | `201 { id, affected: SectionKeyDto[] }` | `VALIDATION_FAILED` |

Item types and choices (outcomes):

| `type` | Source | Outcomes | Effect |
| --- | --- | --- | --- |
| `report` (open) | `Attestation(kind report)` without decision | `confirm` · `confirm_error` · `dismiss` | `confirm`: `AttestationEvent(confirmed)` + `RecheckFlag(cause report)` → *Under re-check*; `confirm_error`: event `confirmed_error` + `ConfirmedError(origin report)` → *Confirmed error*; `dismiss`: event `dismissed`, topic closed `rejected` with the reason (the reporter can reopen it, §7.5.2). Each tells the reporter (`report_outcome`). *Confirm and fix now* = `confirm`, then the UI opens the editor |
| `retraction` | `InvalidationEvent(retraction)` with affected sections not resolved | `still_correct` · `confirm_error` · `keep_recheck` | per affected section: resolution recorded; `confirm_error` adds `ConfirmedError(origin flag)` |
| `flag` | open `RecheckFlag` (any cause but report) | `still_correct` · `confirm_error` · `keep_recheck` | `still_correct` closes it; `confirm_error` closes it and adds a `ConfirmedError` |
| `candidate` | open `EdgeCandidate` | `yes` · `no` · `ask_authors` | `yes` → `CredibilityEdge` (a `contradicts` edge feeds §7.7.2; `copy` edges make the destination a derivation of the source for flag propagation); `ask_authors` opens a section topic for the page authors and leaves it open |
| `pair` | reciprocal pair (§7.7.7) | — (information) | |
| `fix` | pending proposal on a section with an open issue | — (link to Review) | |

```ts
interface SectionKeyDto { path: string; pageTitle: string; anchor: string; sectionTitle: string | null; sectionHash: string; label: LabelDto }
interface QueueItemDto { type: QueueType; id: string; title: string; why: string; section: SectionKeyDto | null;
  reach: { linkedFrom: number; teams: number }; at: string; outcomes: string[]; blocking: boolean }
interface CredibilityQueueDto { items: QueueItemDto[]; nextCursor: string | null; counts: Record<QueueType | 'all', number> }
interface QueueItemDetailDto extends QueueItemDto { properties: { label: string; value: string }[];
  reporter: UserRefDto | null /* names for reviewers only */; topicId: string | null; downstream: SectionKeyDto[];
  decisions: { outcome: string; reason: string; actor: UserRefDto; at: string }[]; can: { decide: boolean } }
interface CredibilityPageDto { path: string; title: string; pageLabel: { label: Label; spread: Record<Label, number> };
  oldestUnchecked: { anchor: string; title: string; since: string | null } | null; activeReaders30d: number }
interface CredibilitySourceDto { ref: string; name: string | null; tier: 'high' | 'medium' | 'low' | null;
  state: 'retracted' | 'changed' | 'archived' | 'unchecked' | 'ok'; citedBy: number; lastCheck: { at: string; result: string } | null }
interface EdgeCandidateInput { kind: EdgeKind; src: { path: string; anchor: string }; dst: { path: string; anchor: string }; score: number /* 0..1 */; detail?: object }
```

- **Order** [D-174]: by reach (`linkedFrom` = current pages whose text links to the item's page, then `teams` = distinct teams with active `used` attestations on the page), then blocking first, then `at` asc. The E8d gate `recheck_ordering` (off) would switch to lower bound × reach once scores exist (7b). The queue cursor is the base64url of the last item's `(type, id)`; the order is recomputed per request (the queue is small), and an unknown cursor yields an empty page.
- **Propagation** [D-178]: a retraction or `root_wrong` invalidation, a confirmed error and a `confirm_error` outcome create `RecheckFlag(cause propagated, depth n)` for every **transitive descendant** section: B derives from A when a `done` publication of B was produced by a proposal with a `source` ref on A's path (section-scoped proposals: only their section; whole-page proposals: every section the artifact changed) or a confirmed `copy` edge A → B; cycle-safe BFS (`domain/credibility.ts#descendants`). Followers of each flagged page get `section_recheck`. The score moves one step only (shadow model, §7.7.11); flags move to all descendants.
- `downstream` in the detail lists those descendants. Readers see the result at once: every decision recomputes labels in the same request and emits `page.changed` for the affected paths.

#### 7.7.9 Follows, notifications, digests, You [D-171, D-172, D-181]

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/follows` | `follow` | `{ path, anchor?: string \| null, muted?: boolean }` | `201 FollowDto` (upsert; `muted` sets/clears `mutedAt`) | `FORBIDDEN`, `NOT_FOUND`, `INVALID_PATH` |
| DELETE | `/follows` | `follow` | `?path&anchor` | `204` | `NOT_FOUND` |
| GET | `/me/follows` | `follow` | `?limit&cursor` | `{ items: FollowedPageDto[], nextCursor }` | |
| GET | `/me/activity` | `attest` | `?kind=checks\|reports\|all&limit&cursor` | `{ items: AttestationDto[], nextCursor, counts }` | |
| GET | `/me/summary` | `attest` | | `{ year: number, checksCounting: number, reportsConfirmed: number, suggestionsPublished: number }` | |
| GET/PUT | `/me/notification-preferences` | `follow` | PUT `NotificationPrefsDto` | `NotificationPrefsDto` | `VALIDATION_FAILED` |
| GET | `/me/notices` | `follow` | | `{ items: NoticeDto[] }` (Home › *On pages you use*, newest 10) | |
| GET | `/notifications` | `wiki.read` (humans) | `?unread=true&limit&cursor` | `{ items: NotificationDto[], nextCursor, unread: number }` | |
| POST | `/notifications/read` | `wiki.read` (humans) | `{ ids?: uuid[] /* ≤ 100 */, all?: true }` | `{ unread: number }` | `VALIDATION_FAILED` |
| GET | `/wiki/recent?scope=mine` | `wiki.read` | | §6 `RecentChangeDto` page restricted to followed, unmuted pages | |

```ts
type NotificationEvent = 'section_recheck' | 'section_edited' | 'report_outcome' | 'report_received' | 'mention' | 'weekly_summary';
interface NotificationPrefsDto { events: Record<'section_recheck' | 'section_edited' | 'report_outcome' | 'weekly_summary', boolean>;
  channel: 'wiki' | 'wiki_and_daily_email' }
interface NotificationDto { id: string; event: NotificationEvent; path: string | null; pageTitle: string | null; anchor: string | null;
  text: string; data: object; createdAt: string; readAt: string | null }
interface NoticeDto { id: string; event: NotificationEvent; path: string; pageTitle: string; anchor: string | null; text: string;
  action: 'read_section' | 'see_affected' | 'check_again' | 'see_outcome'; createdAt: string }
interface FollowDto { path: string; anchor: string | null; reason: 'manual' | 'attested' | 'contributed'; muted: boolean; createdAt: string }
interface FollowedPageDto extends FollowDto { pageTitle: string; pageLabel: { label: Label; spread: Record<Label, number> };
  lastChange: { versionLabel: string; at: string; summary: string | null }; checkAgain: { anchor: string; title: string }[] }
```

- **Events** [D-172]: `section_recheck` — a section of a followed page went under re-check (flag, confirmed report, retraction, propagation) → followers; `section_edited` — a new version changed or removed a section on which the person has an active `checked`/`used` attestation and they follow the page; `report_outcome` — confirmed / confirmed as error / dismissed (with the reason) / fixed (a new version changed the reported section after confirmation) → reporter; `report_received` → page authors; `mention` → people mentioned in a discussion entry (§7.5.4); `weekly_summary` — digest only. Muted follows get nothing. `report_outcome` and `report_received` ignore the event toggles (a reporter is always told, plus page-author duty) but respect `channel`.
- **Preferences**: defaults = all events on, `channel = 'wiki'`. Stored per event as `NotificationPref(channel in_app | email_daily | off)`: toggled off → `off`; on → `in_app` or `email_daily` from `channel`. Slack/Teams is later.
- **Digests**: `buildDigest(user, notifications, period)` (pure, domain) groups unsent notifications by page into `{ subject, text }`; `DigestService.run(now)` sends one email per user with `email_daily` (and the weekly summary on Mondays) through the `MailTransport` port and sets `emailedAt`. Transports: `log` (default, writes the message to the log) and `noop` (tests capture messages); env `MAIL_TRANSPORT=log|noop`. Blocking reports are sent immediately by the same transport.
- `/me/follows.checkAgain` = sections where the viewer's active `checked` attestation is `on_old_version`. `/me/activity` items carry the derived `state` (counting = `active`, *stopped counting* = `on_old_version`/`stale`, *fixed and published* = `fixed`, *dismissed* with `outcomeReason`).
- **Auto-follow after a suggestion** [D-171]: when a person's proposal is published, they follow the page (`reason contributed`) unless a follow exists.
- `/wiki/recent?scope=mine` (§6) is now real: the recent-change page restricted to the caller's unmuted follows; a caller without a session/human identity gets the empty page.

#### 7.7.10 Gates (7d) [D-177]

| Method | Path | Perm | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/admin/credibility-gates` | `admin.settings` | | `{ items: CredibilityGateDto[] }` | |
| PUT | `/admin/credibility-gates/{capability}` | `admin.settings` | `{ enabled: boolean, runRecord?: string, runDate?: 'YYYY-MM-DD' }` | `CredibilityGateDto` | `NOT_FOUND` (unknown capability), `VALIDATION_FAILED` |

```ts
type GateCapability = 'label_threshold' | 'recheck_ordering' | 'attestation_weights' | 'report_detection' | 'assistant_disclosure';
interface CredibilityGateDto { capability: GateCapability; experiment: 'E8b' | 'E8c' | 'E8d'; enabled: boolean;
  reference: { runRecord: string; runDate: string } | null; updatedAt: string | null; updatedBy: UserRefDto | null; description: string }
```

- `validateGateChange` (domain): enabling needs `runRecord` (trimmed 1..300, a run-record path such as `experiments/runs/e8d/2027-01-10.json`, no `..`, no NUL) and `runDate` (a real calendar date, not in the future); missing → `VALIDATION_FAILED` fields `runRecord` / `runDate` code `REQUIRED`/`INVALID`. Disabling clears nothing (the last reference stays in the audit log) and needs no reference. Every change audits `credibility.gate_changed { capability, enabled, runRecord, runDate }`.
- Experiments: `label_threshold`, `recheck_ordering` → E8d; `attestation_weights`, `report_detection` → E8b; `assistant_disclosure` → E8c. The API only stores and validates them in this phase; consumers (score, ordering, disclosure) read `CredibilityGates.enabled(capability)` and are inert until 7b provides scores.

#### 7.7.11 Shadow score reference model (`domain/credibility-score.ts`) and E8a invariants [D-178]

The worker job `credibility_score` (7b) must reproduce this pure reference model; the E8a invariants are automated tests over it and over the label engine. Placeholder parameters (research §5.4): `a = 0.8`, `W = 2`; reviewed version `r += 1`; valid supported source check `r += 2` (agent checks `r += 2 × agentWeight`, default 0 until measured); owner confirmation `r += 3`; confirmed error or valid not_supported check `s += 3`; reader attestations `r += min(1.5, 0.5 × effective)` only from ≥ 2 teams and **× attestation weight = 0** while the gate is off; derivation B ← A: B receives A's own opinion discounted by `P_own(A)` with the loss moved to `u` (A never rises); confirmed corroboration with disjoint roots: `r += 2 × P_own(other)`; links: nothing (blast radius only); contradictions: asymmetric (strong side × 0.9, weak side `s += k × P_own(strong)`, balanced × 0.5); evidence on another hash contributes 0. `b = r/(r+s+W)`, `d = s/(r+s+W)`, `u = W/(r+s+W)`, `P = b + a·u`. Flags propagate to all transitive descendants of a retracted or wrong root; the score moves one step.

Invariants (tests in `packages/domain/test/e8a-invariants.test.ts` and `apps/api/test/credibility.integration.test.ts`): copy laundering (ten copies, declared or not, leave A unchanged), link stuffing (a hundred inbound links leave A's label and score unchanged; only reach rises), weak contradiction (A with two disjoint provenance groups stays *Checked against source*), suspicion propagation (a retracted root lowers A, lowers what B received from A, and flags every transitive descendant; followers notified), no vote-only path to *Checked against source* (any number of attestations from any number of teams, page feedback, links and copies never give rule 4), hash change resets evidence (evidence on an old hash contributes 0 to label and score); plus: a confirmed error changes the label in the same request.

#### 7.7.12 Phase 9b worker jobs (outline; implemented by P9-06)

- Job kinds `retraction_check` (Crossref REST `filter=update-type:retraction` + Retraction Watch; at submit, at review and weekly; input = refs, output = hits), `copy_candidates` (MinHash + rare-value weighting + edit time), `relation_candidates` (embedding top 20 + re-ranker → corroborates/contradicts), `credibility_score` (the §7.7.11 model; output cached as `SectionScore(path, anchor, sectionHash, p, lower10, u, r, s, modelVersion, paramsSha256, computedAt)`, shadow: Operations and research export only).
- Internal endpoints (service token): `POST /internal/v1/credibility/invalidations` (same body and effect as `/credibility/invalidations`), `POST /internal/v1/credibility/candidates` (same as `/credibility/candidates`), `POST /internal/v1/credibility/scores`. Candidates never change a label before a reviewer's `yes`.
- *Run retraction check now* and *Export* (Workspace › Credibility) arrive with these jobs.

#### 7.7.12a Phase 8 ports served by credibility [D-185]

- `CREDIBILITY_SIGNALS` (§7.8.3): open reports on the touched sections (whole page when none), anchors of the base version labelled *Checked against source*, retracted (`InvalidationEvent retraction`) and `low`-tier refs the proposal **adds**, confirmed `contradicts` edges touching the page.
- `CONFIRMED_ERRORS` (§7.8.7): a failed spot check writes `ConfirmedError(origin spot_check, originId = spot check)` per section and propagates (D-178) in the spot-check transaction.
- `INBOX_CHECK_ITEMS` (§7.8.8): open reports and open re-check flags (cause ≠ report) on pages the user is a page author of.
- `PUBLISH_LISTENER` (§7.4.5 finish transaction): anchor links for pure renames, confirmed reports on changed sections → `fixed` + `report_outcome`, `section_edited`, contributor auto-follow.
- `AUTHOR_NOTIFIER` stays the log notifier: escalations and spot checks reach page authors through the Inbox; no new `NotificationEvent` is added (contract unchanged). Follow-up: an email for `email_daily` users.

#### 7.7.13 Web (P9-09 … P9-14)

| Route / region | Screen | Data | Writes |
| --- | --- | --- | --- |
| Trust drawer (any label / action) | F-04 four tabs + after-submit | `/sections/{path}/{anchor}/why`, `/people` | `/attestations`, `/reports`, `/attestations/{id}/withdraw` |
| Page rail, action row, feedback, Follow | F-03 | `PageDto` (+ maintainers, usedByTeams), `/why`, `/people` | `/attestations`, `/page-feedback`, `/follows` |
| `/me` tabs | F-05 | `/me/follows`, `/me/activity`, `/me/summary`, `/me/notification-preferences`, `/me/suggestions` | `PUT /me/notification-preferences`, `/follows` |
| Home › *On pages you use*, scope toggle | F-01 | `/me/notices`, `/wiki/recent?scope=mine` | — |
| `/work/credibility` | F-12 | `/credibility/queue`, `/queue/{type}/{id}`, `/pages`, `/sources` | `/credibility/decisions` |
| Settings › Trust labels | F-14 | `/admin/credibility-gates` | `PUT /admin/credibility-gates/{capability}` |
| Bell | derived (D-16) | `/notifications` | `/notifications/read` |

Query keys: `['why', path, anchor]`, `['people', path, anchor]`, `['me.follows']`, `['me.activity']`, `['me.notices']`, `['notifications']`, `['credibility', 'queue'|'pages'|'sources']`. Every credibility write invalidates `['wiki.page', {path}]`, `['search']`, `['why', path]`, `['people', path]` and the queue; SSE `page.changed` does the same for other viewers.

### 7.8 Phase 8 — Self-managed review (full contract) [D-200 … D-216]

The reviewer agent reviews proposals by default; people only see what the agent escalates, what a mandatory trigger forces back to them, and sampled spot checks of agent approvals. The agent acts through the **public** API with its own token; every guard of §7.4 applies to it, plus the mandatory triggers. The internal API only receives the record of what it did.

#### 7.8.1 Data

`ReviewSettings` (singleton `id = 1`): `reviewModel self_managed|human` (default `self_managed`), `reviewerAgentId`, `agentPaused`, `pausedAt/ById/Reason`, `agentEditsHumanPages` (default true), `customTriggers` (JSON, ≤ 20), `spotCheckRate` (0…1, steps 0.01, default 0.1), `reminderDays` (1…30, default 2), `autoPublishSeen`. `Escalation` (`kind rereview|discussion`, `triggers[]`, `notes`, `requestedById`, `bundleHash`, `assigneeIds[]`, `topicId?`, `resolvedAt?`, `resolution?`, `reminders`, `lastRemindedAt?`; identity columns immutable, resolved once). `AgentReview` (1:1 with its `agent_review` job; append-only). `SpotCheck` (one per sampled publication; outcome decided once). `PublishFollowUp` (PK = publication id; makes the after-publish step idempotent). `AiJobKind` gains `agent_review`; `AiJobTrigger` gains `after_check | returned | resumed`.

#### 7.8.2 The reviewer agent (D-200, D-201)

Boot seeds a user `kind agent`, role `reviewer`, email `REVIEWER_AGENT_EMAIL` (refused if it belongs to a human) and, when `REVIEWER_AGENT_TOKEN` (`mwt_<8>_<32>`) is set, its token (scopes `read, discuss, review`, stored as a hash; a new value revokes the old seeded token). The agent is **available** when enabled and holding a live `review` token. Assignment of a new proposal (§7.4.2): under `self_managed` with the agent available and not the submitter → the agent; otherwise the human rule (D-75).

#### 7.8.3 Mandatory triggers (D-203, D-204)

Evaluated in the decision transaction after the proposal row lock, **only for agent actors**. Any firing trigger refuses an agent **approval** (a rejection sends work back and is allowed) with `409 ESCALATION_REQUIRED`, `fields[] = { path: "triggers", code: <trigger id>, message: <detail> }`. Defaults (cannot be removed): `quality_missing` (no succeeded run for the bundle), `quality_blocking`, `dispute_or_report`, `sourced_meaning` (a sentence with a citation changed meaning), `dropped_hedge`, `checked_section`, `source_problem`, `contradiction`, `wiki_meta` (paths under `wiki-meta/`), `agent_edits_human_pages` (agent submitter on a page with human authors; the only default the owner may turn off). Owner-added triggers: `{ id, kind: path|term, value, reason }`. `judgement` is the id the agent cites for its own doubt. A cosmetic change (equal after NFC, case folding, dropping emphasis markers and punctuation, collapsing whitespace) does not fire `agent_edits_human_pages`.

#### 7.8.4 Refusals (D-205)

A refused agent decision rolls back; the refusal is then audited on its own as `agent.refused { triggers, code }` so Operations can count it.

#### 7.8.5 Escalations (D-206, D-207, D-208)

`POST /proposals/{slug}/escalations { kind, reason, bundleHash, triggers? }` → 201 `EscalationStateDto`; `GET /proposals/{slug}/escalation`. Allowed for the assignee (agent or human) or the owner; order: paused gate → pending (`PRECONDITION_FAILED`) → bundle hash (`PRECONDITION_FAILED`) → `SELF_REVIEW` → `NOT_ASSIGNED` → one open escalation per kind (`ALREADY_EXISTS`) → unknown trigger ids (`VALIDATION_FAILED`, field code `UNKNOWN_TRIGGER`). Firing triggers are added to the cited ones; none → `["judgement"]`. **Page authors** (D-206): the last matching row of `wiki-meta/owners.md` (CODEOWNERS order), else humans who published the page, else the owner; never the submitter or the requester. `rereview` closes the agent's (and requester's) assignment and assigns every page author (reason `escalation`); any one decides. `discussion` opens a thread on the proposal addressed to them. A page author holding an escalation gets reviewer rights on that proposal only (decide, record disputes, close the thread) (D-208). A decision or withdrawal resolves open escalations; a closed thread resolves the discussion escalation.

#### 7.8.6 Agent runs (D-209, D-210)

`agent_review` input `{ proposal: { id, slug, bundleHash, targetPath }, trigger, round }`; output `{ promptVersion, provider, model, usage, outcome approved|rejected|escalated|left_pending, verdict, decisionId, escalationId, notes, claims[], refusals[] }`. A run is due when the agent holds the open assignment, the proposal is pending, no quality check is queued/running, and no run exists for the current round (round = since assignment or the last return/resubmit: `after_check`, `returned`, `resumed`). Events and boot reconcile; queued jobs are re-sent on boot. The worker reads proposal, diff and findings with the agent token, asks the model for `{ verdict, reason, escalation, claims }` on fenced data, then calls `decisions` or `escalations`; an `ESCALATION_REQUIRED` refusal becomes a `rereview` escalation citing the fired triggers. The stored result is checked against the rows (a claimed decision must be the agent's for that proposal; a claimed escalation must be the agent's) (D-210). Without a token the run fails `agent_unavailable`.

#### 7.8.7 After publish and spot checks (D-213, D-214)

After a publication is `done`, once per publication: page authors are told it was published (digest), and when an agent approved it, it is sampled with `sha256("md-wiki:spot\0" + decisionId)` first 32 bits / 2³² < `spotCheckRate`. A sampled publication gets a `SpotCheck` assigned to the page authors. `GET /spot-checks/{id}`; `POST /spot-checks/{id}/outcome { outcome passed|failed, reason, anchors? }` (200) by an assignee or the owner, never an agent (`FORBIDDEN`) or the reviewer (`SELF_REVIEW`); decided once (`PRECONDITION_FAILED`); unknown anchors `VALIDATION_FAILED`. `failed` records a confirmed error on the sections (default the proposal's section, else every published section) in the same transaction.

#### 7.8.8 Inbox (D-215)

`GET /inbox?tab=decide|check|spot|mentions&limit&cursor` → `{ items[], nextCursor, counts { all, decide, check, spot, mentions, done } }`. Items: open assignments (`decide`), escalations (with the agent's notes and triggers), spot checks (`spot`), discussion mentions (`mentions`), check items (Phase 9). Items done in the last 30 days are listed as `done`. Live updates: SSE `inbox.changed` to the affected users.

#### 7.8.9 Settings, stop switch, metrics (D-202, D-211, D-212, D-216)

`GET/PATCH /admin/review-settings` (`admin.settings`): `reviewModel`, `spotCheckRate`, `reminderDays`, `agentEditsHumanPages`, `customTriggers` (replace); defaults cannot be weakened (D-202). `POST /admin/agent/pause { paused, reason? }` (200): while paused the agent records no decision or escalation (`PRECONDITION_FAILED`), queued/running runs end failed `paused`; resuming reconciles every pending proposal (D-211). An `AUTO_PUBLISH` change between boots is audited. Reminders: an open escalation is reminded every `reminderDays` (hourly sweep); reminders never decide (D-212). `GET /ops/agent?days=1..90` (`admin.jobs`): reviews, decided, approved, autoPublished, sentBack, escalated by kind, refusals, by trigger, leftPending, failed, spot checks, reverts, approval error rate (D-216).

## 8. State machines

### 8.1 Proposal

```text
pending ──decide(approve)──▶ approved ──publish ok──▶ published
pending ──decide(reject)───▶ rejected
approved ─base changed at publish─▶ stale
(any non-terminal) withdraw by submitter ──▶ rejected (reason "withdrawn")
```

- Terminal: `published`, `rejected`, `stale`. A revision is a new proposal. Full transition rules, guards and transactions: §7.4.3–§7.4.4.
- `decide(approve)` preconditions, checked in this order, each with its own code: assignment open (`NOT_ASSIGNED`), not self (`SELF_REVIEW`), no open dispute/hold (`DISPUTED`), bound hashes equal current (`DECISION_BINDING_MISMATCH`), discussion/dispute versions equal current (`DISCUSSION_CHANGED`), sources fresh (`SOURCE_CHANGED`), target not blocked (`TARGET_BLOCKED`), for agents: no mandatory trigger fires (`ESCALATION_REQUIRED`, Phase 8).
- `AUTO_PUBLISH=true`: the approve transaction enqueues publish in the same DB transaction (outbox row); a crash between approval and publish is resumed on boot.

### 8.2 Publication phases

`prepared → writing → written → done`; failures: precondition fails before write → proposal `stale`, publication `stale`; outcome not knowable (crash/timeout after `writing`) → `unknown` and the target path is **blocked** until an owner records a `Resolution(written|not_written, evidence)`. No blind retry, no rollback. Step table, write classification, outbox and boot recovery: §7.4.5–§7.4.6.

## 9. Error codes (`domain/errors.ts`)

`VALIDATION_FAILED 400 · INVALID_PATH 400 · UNAUTHENTICATED 401 · INVALID_CREDENTIALS 401 · CSRF_INVALID 403 · FORBIDDEN 403 · ACCOUNT_DISABLED 403 · NOT_FOUND 404 · ALREADY_EXISTS 409 · PRECONDITION_FAILED 409 · SELF_REVIEW 409 · NOT_ASSIGNED 409 · DISPUTED 409 · DECISION_BINDING_MISMATCH 409 · DISCUSSION_CHANGED 409 · SOURCE_CHANGED 409 · TARGET_BLOCKED 409 · ESCALATION_REQUIRED 409 · SECTION_CHANGED 409 · STALE_BASE 409 · EMAIL_TAKEN 409 · LAST_OWNER 409 · PAYLOAD_TOO_LARGE 413 · RATE_LIMITED 429 · STORAGE_ERROR 500 · VERIFY_FAILED 500 · INTERNAL 500`

The web maps each code to copy through `apps/web/src/lib/error-copy.ts` (one table, unit-tested for completeness against the enum).

## 10. Web state and data flow

```text
route loader ──▶ TanStack Query (queryKey = [resource, params]) ──▶ generated client ──▶ /api/v1
                     ▲                                                        │
          SSE /events invalidates keys (Phase 5+)                   problem+json → ApiError(code)
                     │
feature/model.ts (pure DTO → view model) ──▶ components (render only, local UI state only)
```

- Server state only in TanStack Query. Local UI state (selected section, open tab, drawer) in component state or the URL (`?section=`, `?tab=`), never in a global store. No Redux/Zustand.
- Session: `useSession()` query on `/auth/session`; 401 anywhere → clear cache, redirect `/login?next=`.
- Mutations send `X-CSRF-Token` from the session query automatically (client middleware).
- Forms keep user input on error (ux.md › Empty, loading and error states): drafts autosave; reasons/reports persisted to `sessionStorage` under `mw:form:<route>:<id>`, cleared on success.
- Rendering wiki Markdown: `unified` → `remark-parse` → `remark-gfm` → `remark-wiki-link` → `remark-rehype` → `rehype-sanitize` (default schema + `id` on headings) → React. Section wrappers use `SectionDto.anchor` from the API, never a client-side re-slug.

## 11. Edge cases every phase must test

- Paths: unicode, uppercase, spaces, `..`, symlink out of root, 201-byte path, reserved `.wiki-system`.
- Markdown: no headings; only lead; duplicate headings; heading inside code fence; setext headings; CRLF file; BOM; empty file; 1 MiB + 1 byte file; invalid UTF-8.
- Concurrency: two writes to the same path; publish while an out-of-band edit happens; decision while a discussion entry is posted.
- Auth: disabled user with live session; revoked token; expired token; CSRF missing; last owner demotion.
- Search: empty query, query of only stop words, 200+ chars, special chars `& | ! :*`, filter excluding all labels (recheck still shown).
