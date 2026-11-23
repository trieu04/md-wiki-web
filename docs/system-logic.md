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
  The indexer reads the last published hash through a port `PublicationLookup.lastPublishedSha256(path) → Promise<string | null>` [D-36]. Until the `Publication` model exists (Phase 3/5) the production implementation returns `null`, and `null` means "never published through review" → `changedOutsideReview = false`. Tests inject a lookup that returns a hash.

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
-- Phase 2
Draft(authorId, targetPath, baseSnapshotId?, scope jsonb, content text, reason, sources jsonb, appliesTo jsonb, updatedAt)
Proposal(slug unique, targetPath, submitterId, state, bundleHash, manifest bytea, base bytea?, proposed bytea,
         artifact bytea?, artifactHash?, baseSha256?, createdAt)
ProposalRef(proposalId, snapshotId, role target|scope|source, impact?)
-- Phase 3
Assignment, Decision, Publication, Resolution, ConflictResolution   (fields as architecture.md › Data model)
```

Later phases (Discussions, AI jobs, agent review, credibility, reading) use the architecture.md data model verbatim; their `-00` spec task turns it into Prisma with indexes.

**Append-only enforcement**: `AuditEvent`, `DiscussionEvent`, `DisputeEvent`, and all credibility record tables get a Postgres trigger rejecting `UPDATE` and `DELETE` (migration test asserts it).

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
| `topic.open`, `comment` | reader / contributor | discuss | |
| `draft.*`, `proposal.submit` | contributor | contribute | |
| `proposal.decide` | reviewer | review | must hold an open `Assignment`; never own proposal (`SELF_REVIEW`) |
| `proposal.publish` | publisher | publish | only when `AUTO_PUBLISH=false` |
| `credibility.decide` | reviewer + page author of path | — | |
| `admin.*` (users, tokens, settings, reindex, recovery) | owner | — | |

`can(actor, action, ctx) → { ok: true } | { ok: false, code: ErrorCode }` is pure and exhaustively tested (table-driven).

## 6. Public API — Phase 1 (full contract)

| Method | Path | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/health` | none | | `{ status: 'ok', db: 'ok'\|'down', redis, storage, version }` | |
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
| P4 Contribute | `GET/POST/PATCH/DELETE /drafts[/{id}]` (autosave `PATCH` with `If-Match: <updatedAt>`), `POST /drafts/{id}/sources`, `POST /drafts/{id}/rebase`, `POST /drafts/{id}/submit` → `ProposalDto`, `POST /contributions` (agent bundle), `GET /contributions/{slug}`, `POST /contributions/import` (`.contribution.md` v3), `GET /drafts/{id}/export` |
| P5 Review/publish | `GET /proposals?state&tab&cursor`, `GET /proposals/{slug}` (incl. `preview` artifact + hashes), `GET /proposals/{slug}/diff`, `POST /proposals/{slug}/decisions` `{ approve, reason, bundleHash, artifactHash, previewAt, discussionVersion, disputeVersion }`, `POST /proposals/{slug}/publish`, `POST /proposals/{slug}/conflict` `{ outcome: keep_current\|use_incoming\|merge, replacement? }`, `GET /ops/blocked`, `POST /ops/blocked/{slug}/resolution`, `GET /audit`, `GET /events` (SSE) |
| P6 Discussions/MCP | `/topics`, `/topics/{id}/comments`, `/proposals/{slug}/discussion`, `/proposals/{slug}/disputes`, MCP at `/mcp` (streamable HTTP) |
| P7 Quality | `POST /proposals/{slug}/quality-check`, `GET /proposals/{slug}/findings`, internal `GET /internal/v1/jobs/{id}/input`, `POST /internal/v1/jobs/{id}/result`, `/admin/models`, `/admin/rules` |
| P8 Agent review | `GET /inbox?tab`, `POST /proposals/{slug}/escalations`, `/admin/review-settings`, `POST /admin/agent/pause` |
| P9 Credibility | `/sections/{path}/{anchor}/why`, `/attestations`, `/reports`, `/source-checks`, `/owner-confirmations`, `/page-feedback`, `/follows`, `/notifications`, `/me/*`, `/credibility/queue`, `/credibility/pages`, `/credibility/sources`, internal invalidation/candidate endpoints |

### 7.1 Job wire contract (binding from Phase 0; later job kinds add an input/output pair only)

- **Queue**: one BullMQ queue `mw-jobs` on `REDIS_URL`. BullMQ job **name** = `kind`, BullMQ job **id** = `AiJob.id` (UUIDv7, so re-enqueueing the same row is a no-op). Attempts 3, exponential backoff 5 s; the API owns retries of the row state, the worker never writes to Postgres.
- **Queue payload** `JobEnvelope` (JSON Schema `packages/contracts/jobs/envelope.schema.json`): `{ "v": 1, "jobId": uuid, "kind": JobKind }`. Nothing else travels through Redis; inputs are fetched from the internal API so secrets and large inputs never sit in Redis.
- `JobKind` (Phase 0): `"ping"`. Later phases add `quality_check`, `agent_review`, credibility kinds.
- **Input**: `GET /internal/v1/jobs/{id}/input` → `200 { "jobId", "kind", "input": <kind input> }`; `404 NOT_FOUND` unknown id; `409 PRECONDITION_FAILED` when the job is not `queued`/`running` (already finished). First fetch moves the row `queued → running` and sets `startedAt`.
- **Result**: `POST /internal/v1/jobs/{id}/result` body `JobResult` = `{ "status": "ok", "output": <kind output> }` or `{ "status": "failed", "error": { "code": string (1..64, `^[a-z0-9_]+$`), "message": string (1..500) } }` → `204`. Output validated against the kind's schema (`400 VALIDATION_FAILED` otherwise). Posting to a finished job: identical body → `204` (idempotent), different body → `409 PRECONDITION_FAILED`.
- **Ping** (dev only): `PingInput { "message": string 1..200 }`, `PingOutput { "echo": string (must equal input.message), "workerVersion": string 1..40 }`. The API rejects an `ok` result whose `echo` ≠ `message` with `400 VALIDATION_FAILED` (row stays running).
- **Row**: `AiJob(id, kind, status queued|running|succeeded|failed, input Json, output Json?, error Json?, createdAt, startedAt?, finishedAt?)` for Phase 0; the proposal-related columns of architecture.md are added by P7-00.
- Dev endpoints (only `NODE_ENV !== "production"`, otherwise 404): `POST /api/v1/dev/ping { message }` → `201 { id, status }`; `GET /api/v1/dev/ping/{id}` → `{ id, status, input, output?, error?, createdAt, finishedAt? }`.
- Schemas live in `packages/contracts/jobs/*.schema.json` (JSON Schema 2020-12): `envelope`, `result`, `ping.input`, `ping.output`. TS types and pydantic v2 models are generated from them; neither side hand-writes these shapes.

## 8. State machines

### 8.1 Proposal

```text
pending ──decide(approve)──▶ approved ──publish ok──▶ published
pending ──decide(reject)───▶ rejected
approved ─base changed at publish─▶ stale
(any non-terminal) withdraw by submitter ──▶ rejected (reason "withdrawn")
```

- Terminal: `published`, `rejected`, `stale`. A revision is a new proposal.
- `decide(approve)` preconditions, checked in this order, each with its own code: assignment open (`NOT_ASSIGNED`), not self (`SELF_REVIEW`), no open dispute/hold (`DISPUTED`), bound hashes equal current (`DECISION_BINDING_MISMATCH`), discussion/dispute versions equal current (`DISCUSSION_CHANGED`), sources fresh (`SOURCE_CHANGED`), target not blocked (`TARGET_BLOCKED`), for agents: no mandatory trigger fires (`ESCALATION_REQUIRED`, Phase 8).
- `AUTO_PUBLISH=true`: the approve transaction enqueues publish in the same DB transaction (outbox row); a crash between approval and publish is resumed on boot.

### 8.2 Publication phases

`prepared → writing → written → done`; failures: precondition fails before write → proposal `stale`, publication `stale`; outcome not knowable (crash/timeout after `writing`) → `unknown` and the target path is **blocked** until an owner records a `Resolution(written|not_written, evidence)`. No blind retry, no rollback.

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
