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
| `proposal.read` (workspace lists, §7.4.8) | reviewer | review | [D-86] |
| `proposal.decide` | reviewer | review | must hold an open `Assignment`; never own proposal (`SELF_REVIEW`) |
| `proposal.publish` | publisher | publish | only when `AUTO_PUBLISH=false` |
| `credibility.decide` | reviewer + page author of path | — | |
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
| 7 | no open dispute or hold (`DiscussionState.disputed`, Phase 6 port → `false`) | `DISPUTED` | approve |
| 8 | `bundleHash = proposal.bundleHash`, recomputed `artifactHash` = sent `artifactHash`, `previewAt` parses and is ≤ now + 5 s | `DECISION_BINDING_MISMATCH` | both |
| 9 | `discussionVersion`, `disputeVersion` = `DiscussionState` versions (Phase 6 port → `0`, `0`) | `DISCUSSION_CHANGED` | both |
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
