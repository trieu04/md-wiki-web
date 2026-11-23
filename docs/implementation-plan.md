# Implementation plan (for Pi Agent)

Version 1 · 2026-11-23 · owner of this plan: the orchestrator session (Claude Opus).

Inputs: [architecture.md](architecture.md), [ux.md](ux.md), [plan.md](plan.md) (product phases), [system-logic.md](system-logic.md) (contracts, **binding**), [design-system.md](design-system.md) (tokens, inventory, **binding**), design frames in `design/v4/` (UI source of truth, copied from https://claude.ai/artifact/Lxw6KDBmXBFPYTZRX7DzBh).

How to read this file: §1 rules for every task, §2 model assignment, §3 the task table, §4 per-task specs, §5 orchestration protocol, §6 decisions the plan took, §7 open questions, §8 risks. The live status is in [progress.md](progress.md).

## 1. Rules for every task

1. **Logic before UI.** No UI task starts until the contracts it binds to exist in `packages/contracts` (generated from the API) and the logic behind them passes its tests. UI work in Phase 2 (design system) binds to no API and may run beside Phase 1.
2. **Contracts are binding.** A task that needs a contract change stops and reports; it does not change `system-logic.md` or a DTO on its own.
3. **Tests with every logic task.** Unit tests for every rule and every edge case named in the spec and in system-logic.md §11; integration tests for every endpoint (happy path + each error code it can return).
4. **Design is exact.** UI tasks cite their frame node (`F-xx` / `C-xx` in design-system.md §1), use only tokens from design-system.md §2, implement every drawn variant and every state, at 390/768/1024/1440. Anything not drawn is listed in design-system.md §6: a task that needs it stops and reports instead of inventing it. Deviations are written to the task report under `Deviations:`.
5. **No business logic in components.** Components render props. Data shaping lives in `features/<x>/model.ts` (pure, tested). Rules live in `packages/domain` or `apps/api`.
6. **Never make silent assumptions.** Anything not settled by these documents is listed under `Assumptions:` in the task report; if it changes behaviour visible to users or to the API, the task stops instead.
7. **Done** = build, lint, type-check and all tests pass, the cross-model review passes, and (UI) terra passes at every width.

## 2. Model assignment

| Model | Used for | Reviews |
| --- | --- | --- |
| `gpt-6.2-astra` | architecture-shaping code, core rules, state machines, storage, auth, publish flow, hard bugs | logic of sol tasks |
| `gpt-6.2-sol` | features, endpoints, UI components and screens, API integration | logic of astra and luna tasks |
| ~~`gpt-6-luna`~~ | **retired by user (2026-11-23, D-26)** — its tasks moved to sol | — |
| `gpt-6.1-terra` | visual verification of every UI task against reference renders | all UI tasks |
| **OPUS** (this session) | spec tasks (`-00`), cross-cutting/ambiguous work, final escalation, phase gates | publish-flow and security reviews |

Review pairing rule: the reviewer is never the implementer's model. Default: astra → reviewed by sol; sol → reviewed by astra; (former luna tasks, now sol → reviewed by astra); UI → terra (visual) **and** astra (logic in `model.ts`, data binding).

Escalation ladder: `sol → astra → OPUS` (luna removed, D-26). Two retries per rung with the exact failing output; then the next rung receives the spec, every attempt's diff and errors.

## 3. Task table

**D-30 (user, 2026-11-23): "Giảm phân mảnh task" — tasks merged into larger slices.** Phases 0–5 went from 51 to 26 tasks. Each merged task's brief contains the original specs of its parts (`docs/tasks/merges.tsv`, `tools/orchestrate/brief-spec.py`); §4 keeps the original per-part specs. Parallel groups C/E/F run in git worktrees (D-29).

Status lives in progress.md. `H-n` are human gates. Parallel groups (‖) touch disjoint files.

| ID | Task | Model | Review | Depends on | ‖ group |
| --- | --- | --- | --- | --- | --- |
| **Phase 0 — Foundations** ||||||
| P0-01 | Monorepo scaffold (pnpm, turbo, TS, ESLint, Prettier, Vitest; apps/web, apps/api, packages/domain, packages/contracts) | luna | sol | — | |
| P0-02 | Python worker scaffold (uv, ruff, mypy, pytest, pydantic) | luna | sol | — | A |
| P0-03 | Infra: docker compose (postgres, redis), `.env.example`, Makefile | luna | sol | P0-01 | A |
| P0-04 | Domain error codes + `Result` type | luna | sol | P0-01 | B |
| P0-05 | API base: config, health, problem+json filter, request id, logging, Prisma module | astra | sol | P0-03, P0-04 | |
| P0-06 | Contracts pipeline + ping round trip (job contract system-logic §7.1) *(merges P0-06, P0-07)* | sol | astra | P0-05,P0-02 |  |
| P0-08 | Design reference renderer (`pnpm design:shots`) | sol | terra | P0-01 | B |
| P0-09 | App visual harness (`pnpm visual:shots`, pixel diff report) | sol | terra | P0-08 | |
| P0-G | CI workflow + phase gate *(merges P0-10, P0-G)* | OPUS | — | all P0 |  |
| **Phase 1 — Core logic: read side** ||||||
| P1-A | Domain text rules: paths, status block, sections, snapshot labels, time *(merges P1-01, P1-02, P1-03, P1-04)* | astra | sol | P0-G | C |
| P1-B | Domain permissions + labels *(merges P1-05, P1-06)* | astra | sol | P0-G | C |
| P1-C | Storage adapters, Prisma schema P1 + triggers, indexer/snapshots/topics *(merges P1-07, P1-08, P1-10)* | astra | sol | P1-A |  |
| P1-D | Auth (passwords, sessions, CSRF, tokens, guards, owner seed) + admin endpoints *(merges P1-09, P1-13)* | astra | sol | P1-B,P1-C |  |
| P1-E | Wiki read endpoints + section search + API e2e suite *(merges P1-11, P1-12, P1-15)* | sol | astra | P1-B,P1-C,P1-D |  |
| P1-G | Phase gate | OPUS | — | all P1 | |
| **Phase 2 — Design system** (may run beside Phase 1 after H-1) ||||||
| H-1 | Human: approve states addendum (design-system.md §6.1) and answer Q-UI-1..5 | human | — | — | |
| P2-A | Tokens + trust components + action primitives *(merges P2-01, P2-02, P2-03)* | sol | terra | P0-09 |  |
| P2-B | Form primitives + containers *(merges P2-04, P2-05)* | sol | terra | P2-A |  |
| P2-C | TopBar + WorkNav + layouts, router skeleton, /__gallery *(merges P2-06, P2-07, P2-08)* | sol | terra | P2-A,P2-B |  |
| P2-G | Phase gate: gallery at 4 widths vs reference | OPUS + terra | — | all P2 | |
| **Phase 3 — Reading screens** ||||||
| P3-A | Web data layer + markdown pipeline + Login *(merges P1-14, P3-01, P3-05)* | sol | astra | P1-G,P2-G |  |
| P3-B | Home + Search screens *(merges P3-02, P3-03)* | sol | terra+astra | P3-A | E |
| P3-C | Page reading view + History *(merges P3-04, P3-06)* | sol | terra+astra | P3-A | E |
| P3-D | Settings (people, tokens) + Playwright reader flow *(merges P3-07, P3-08)* | sol | terra+astra | P3-B,P3-C |  |
| P3-G | Phase gate | OPUS + terra | — | all P3 | |
| **Phase 4 — Contribute** (plan.md Phase 2) ||||||
| P4-00 | Spec expansion: contracts + full task briefs | OPUS | — | P3-G | |
| P4-A | Bundle validation + drafts API + submit *(merges P4-01, P4-02, P4-03)* | astra | sol | P4-00 |  |
| P4-B | Agent contributions + .contribution.md v3 import *(merges P4-04)* | sol | astra | P4-A | F |
| P4-C | Editor + You › Your suggestions *(merges P4-05, P4-06)* | sol | terra+astra | P4-A | F |
| P4-G | Gate: human + agent submit identical bundle structure | OPUS | — | | |
| **Phase 5 — Review and publish** (plan.md Phase 3) ||||||
| P5-00 | Spec expansion | OPUS | — | P4-G | |
| P5-A | Assignments, decision guards, publish flow, outbox, recovery *(merges P5-01, P5-02)* | astra | OPUS | P5-00 |  |
| P5-B | Conflicts + audit, history, SSE *(merges P5-03, P5-04)* | astra | sol | P5-A |  |
| P5-C | Workspace shell + Proposals + Review screens *(merges P5-05, P5-06)* | sol | terra+astra | P5-B |  |
| P5-D | Conflict screen + Ops blocked + Playwright publish flow *(merges P5-07, P5-08, P5-09)* | sol | terra+astra | P5-B,P5-C |  |
| P5-G | Gate | OPUS | — | | |
| **Phase 6 — Discussions and MCP** (plan.md 4) | P6-00 spec (OPUS) · P6-01 topics/comments/holds/dispute log (astra) · P6-02 MCP server (sol) · P6-03 agent skill rewrite (sol) · P6-04 Discussions F-11 (sol) · P6-05 *Ask a question* entry points (sol) · P6-06 Review › Discussion tab (derived, D-16) · P6-G |||||
| **Phase 7 — Quality check** (plan.md 5) | P7-00 spec · P7-01 provider interface (astra) · P7-02 `quality_check` job, fencing, quote verification (astra) · P7-03 findings API + re-run (sol) · P7-04 eval command (sol) · P7-05 Quality card in F-10 and self-check in F-06 (sol) · P7-06 Settings › Models (F-14) (sol) · P7-G |||||
| **Phase 8 — Self-managed review** (plan.md 6) | P8-00 spec · P8-01 `domain/escalation-triggers` (astra) · P8-02 `agent_review` job (astra) · P8-03 escalation, page-author resolution, reminders (astra) · P8-04 spot checks + digests (sol) · P8-05 stop switches, agent metrics (sol) · P8-06 Inbox F-08 (sol) · P8-07 Review escalation banner + Agent review card (sol) · P8-08 Settings › Review (sol) · P8-09 seeded eval run (OPUS) · P8-G |||||
| **Phase 9 — Credibility** (plan.md 7) | P9-00 spec · 7a: P9-01 evidence tables (sol) · P9-02 label engine on events (astra) · P9-03 anchor relinking (astra) · P9-04 source tiers (sol) · P9-05 E8a invariants (astra, review OPUS) · 7b: P9-06 worker jobs (astra) · 7c: P9-07 attestation API + rules (astra) · P9-08 follows/notifications (sol) · P9-09 Trust drawer F-04 (sol) · P9-10 Page rail + action row F-03 rest (sol) · P9-11 You F-05 (sol) · P9-12 Home notices F-01 (sol) · P9-13 Credibility F-12 (sol) · 7d: P9-14 gates in Settings › Trust labels (sol) · P9-G |||||
| **Phase 10 — Hardening** (plan.md 8) | P10-01 backup/restore (sol) · P10-02 security pass (OPUS + astra) · P10-03 accessibility pass (terra + sol) · P10-04 docs (sol, was luna) · P10-G |||||

## 4. Per-task specs

Every brief sent to Pi = the common preamble (`tools/orchestrate/preamble.md`) + the task's spec below + the files it names. "Verify" lists the exact commands the gate runs; the task must make them pass.

### Phase 0

#### P0-01 Monorepo scaffold — luna (boilerplate; well-known shape)
- **Goal**: a pnpm + Turborepo workspace where every package builds, lints, type-checks and tests with one command.
- **Files**: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.editorconfig`, `.nvmrc` (22), `.gitignore`, `apps/web/**` (Vite React TS template, `src/main.tsx`, `src/App.tsx` rendering a placeholder `<h1>md-wiki</h1>`), `apps/api/**` (Nest 11 minimal app, `src/main.ts`, `AppModule`), `packages/domain/**` (`src/index.ts`), `packages/contracts/**` (`src/index.ts`).
- **Spec**: package names `@md-wiki/web`, `@md-wiki/api`, `@md-wiki/domain`, `@md-wiki/contracts` (workspace deps via `workspace:*`). Node 22, pnpm 12, TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). ESLint flat config with `typescript-eslint` strict-type-checked + `eslint-plugin-react-hooks` for web. Vitest in domain/contracts/web, Jest-free (Nest tests also with Vitest + `unplugin-swc`). Root scripts: `build`, `lint`, `typecheck`, `test`, `format`, `check` (= lint + typecheck + test). `.gitignore` includes `node_modules`, `dist`, `.turbo`, `.env`, `design/runtime/`, `design/reference/`, `.orchestrate/`, `.pi-sessions/`, `coverage`.
- **Acceptance**: `pnpm install && pnpm build && pnpm check` exit 0; each package has at least one passing test (`expect(true)` not allowed; test the exported placeholder).
- **Verify**: `pnpm install --frozen-lockfile=false && pnpm build && pnpm check`.

#### P0-02 Worker scaffold — luna
- **Files**: `services/worker/pyproject.toml`, `src/mdwiki_worker/__init__.py`, `src/mdwiki_worker/main.py`, `tests/test_smoke.py`, `uv.lock`.
- **Spec**: Python 3.12 (`requires-python = ">=3.12,<3.13"`; uv-managed interpreter, not the system 3.15), deps: pydantic 2, httpx, bullmq, anthropic; dev: pytest, ruff, mypy (strict). `main.py` exposes `run()` that reads env `REDIS_URL`, `INTERNAL_API_URL`, `SERVICE_TOKEN` via a pydantic `Settings` and logs startup.
- **Acceptance/Verify**: `cd services/worker && uv sync && uv run ruff check . && uv run mypy src && uv run pytest` exit 0; test asserts Settings rejects a missing `SERVICE_TOKEN`.

#### P0-03 Infra — luna
- **Files**: `infra/docker-compose.yml`, `.env.example`, `Makefile`.
- **Spec**: services `postgres:17` (healthcheck `pg_isready`), `redis:7` (healthcheck `redis-cli ping`), named volumes; ports 5432/6379 on localhost only. `.env.example`: `DATABASE_URL`, `REDIS_URL`, `API_PORT=3000`, `INTERNAL_PORT=3001`, `SERVICE_TOKEN`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `WIKI_ROOT=./wiki-sample`, `AUTO_PUBLISH=true`, `WEB_PORT=5173`. Makefile: `up` (compose up -d --wait), `down`, `dev` (up + `pnpm dev` + worker), `check` (pnpm check + worker checks), `test`. `wiki-sample/` with 3 small Markdown pages across 2 folders (content: generic microscopy notes; no real people).
- **Verify**: `make up && docker compose -f infra/docker-compose.yml ps` shows both healthy; `make down`.

#### P0-04 Domain errors — luna
- **Files**: `packages/domain/src/errors.ts`, `packages/domain/src/result.ts`, tests.
- **Spec**: `ErrorCode` string-literal union + `ERROR_STATUS: Record<ErrorCode, number>` exactly as system-logic.md §9; `Result<T,E> = {ok:true,value:T}|{ok:false,error:E}` with `ok()`, `err()`.
- **Acceptance**: test asserts every code in §9 is present with its status, and no extra codes.

#### P0-05 API base — astra (sets patterns every endpoint copies)
- **Files**: `apps/api/src/config/*`, `apps/api/src/common/problem.filter.ts`, `apps/api/src/common/request-id.middleware.ts`, `apps/api/src/common/app-error.ts`, `apps/api/src/health/*`, `apps/api/src/prisma/*`, `apps/api/prisma/schema.prisma` (datasource + generator only), tests.
- **Spec**: env validated with zod at boot (fail fast, list all missing vars). `AppError(code, detail?, fields?)` → problem+json via global filter; unknown errors → `INTERNAL` without stack. Validation pipe per system-logic.md §2. `X-Request-Id` middleware; pino logger with request id. Global prefix `/api/v1`. `GET /api/v1/health` per §6 (pings DB and Redis, reports storage root readable). Second Nest app instance (or second listener) on `INTERNAL_PORT` with prefix `/internal/v1` guarded by service token (constant-time compare).
- **Acceptance**: integration tests: health ok with compose up; health `db: down` when DB unreachable (mock); unknown route → 404 problem+json with `NOT_FOUND`; thrown `AppError('SELF_REVIEW')` → 409 body with `requestId`; internal route without token → 401.
- **Also fix (carried from P0-01 review, minor)**: `apps/api/test/app.test.ts` teardown must spawn `process.execPath dist/main.js` directly and await its exit after SIGTERM (no orphan server); `apps/api/package.json` test script must not rebuild domain/contracts/api — keep build ordering in `turbo.json` (`test` dependsOn `build`, `^build`).
- **Verify**: `make up && pnpm --filter api test && pnpm check`.

#### P0-06 Contracts pipeline — sol
- **Files**: `apps/api/scripts/openapi.ts`, `packages/contracts/{openapi.json,src/client.ts,src/schema.d.ts,jobs/*.schema.json}`, `services/worker/src/mdwiki_worker/contracts/*.py`, root script `contracts:gen`, `contracts:check`.
- **Spec**: `@nestjs/swagger` builds the document without starting a server; `openapi-typescript` → `schema.d.ts`; `openapi-fetch` client factory `createApiClient({ baseUrl, getCsrfToken })`; job schemas (JSON Schema 2020-12) → `datamodel-code-generator` pydantic v2 models. `contracts:check` regenerates into a temp dir and fails on diff.
- **Acceptance**: `pnpm contracts:gen` is deterministic (two runs, no diff); `contracts:check` fails when a DTO changes without regen (test by script).

#### P0-07 Ping round trip — sol
- **Spec**: `POST /api/v1/dev/ping` (only when `NODE_ENV!=='production'`) creates `AiJob(kind='ping')` row (add model to Prisma) and enqueues BullMQ job; worker consumes the `JobEnvelope`, fetches `GET /internal/v1/jobs/{id}/input`, posts `JobResult` to `POST /internal/v1/jobs/{id}/result`; API validates and stores it — **wire shapes, statuses, idempotency and dev endpoints exactly as system-logic.md §7.1**; `GET /api/v1/dev/ping/{id}`. Web dev route `/__dev/ping` (unstyled, excluded from design, dev only) shows the round trip.
- **Acceptance**: an integration test with compose up runs the full loop in < 10 s; worker unit test with a fake internal API.

#### P0-08 Design reference renderer — sol
- **Files**: `tools/design-ref/{render.mjs,variants.json,serve.mjs}`, root script `design:shots`.
- **Spec**: serve `design/v4/` with `design/runtime/support.js`; for each frame in `variants.json` (all variants in design-system.md §1; variant pages are generated wrapper `.dc.html` files that `<dc-import>` the frame with the variant props, or set state via the frame's own controls with Playwright clicks for state-only variants) render at widths 390/768/1024/1440, full page, after fonts load and network idle + 1500 ms; write `design/reference/<Frame>/<variant>@<w>.png` and `manifest.json` (frame, variant, width, sha256).
- **Acceptance**: all frames × variants × 4 widths produced; deterministic (two runs → identical sha256 for ≥ 95% of images; report the rest); terra confirms 6 sampled images show the intended variant.

#### P0-09 App visual harness — sol
- **Files**: `tools/visual/{shoot.mjs,diff.mjs,report.mjs}`, `apps/web/src/dev/fixtures/*`, root script `visual:shots`.
- **Spec**: Playwright against `vite preview` with MSW fixtures that reproduce the frame's sample data exactly (copy from the frame's `renderVals`), so screens can be compared to the reference pixel by pixel. Diff with `pixelmatch` (threshold 0.1), mask the TopBar band for full frames (design-system.md §6 item 8); output `visual/report/<task>/index.html` with side-by-side + diff images and per-image mismatch %.
- **Acceptance**: comparing the reference against itself = 0%; a deliberately 1px-shifted element is detected.

#### P0-10 CI — sol (was luna, D-26)
- **Files**: `.github/workflows/ci.yml`.
- **Spec**: jobs: node (install, build, check, contracts:check), worker (uv sync, ruff, mypy, pytest), api-integration (services postgres + redis, prisma migrate, api tests). Cache pnpm and uv.
- **Verify**: `actionlint` if installed, else YAML parse; the same commands pass locally via `make check`.

#### P0-G Gate — OPUS
Clean clone into a temp dir → `make up && pnpm install && pnpm build && make check && pnpm contracts:check && pnpm design:shots`; ping round trip shown at `/__dev/ping` (screenshot).

### Phase 1 (logic only; no UI)

#### P1-01 `domain/paths` — sol (rules are fully specified; security-relevant, so astra reviews)
- **Files**: `packages/domain/src/paths.ts`, `paths.test.ts`.
- **Spec**: system-logic.md §3.1, every error code.
- **Acceptance**: table-driven tests cover every rule and the §11 path cases; property test (fast-check): any accepted path normalises to itself and never contains `..`.

#### P1-02 `domain/status-block` — sol
- **Spec**: §3.4. **Acceptance**: round trip byte-exact; malformed block → warning not throw; CRLF input; marker inside body detected by `containsReservedMarker`.

#### P1-03 `domain/sections` — astra (core rule all evidence binds to)
- **Spec**: §3.3 (D-1, D-2, D-3, D-8). Export `splitSections`, `pageTitle`, `sectionHash`.
- **Acceptance**: tests for every Markdown case in §11; hash stability (CRLF vs LF same hash; trailing spaces same hash; changed word different hash); golden test over `wiki-sample/`.

#### P1-04 `domain/snapshot-label` + `domain/time` — sol (was luna, D-26)
- **Spec**: §3.5 `nextLabel`; `formatRelative(date, now)` [D-9]: `< 1 min` "just now", `< 60 min` "N min ago", `< 24 h` "N h ago", `< 7 d` "N d ago", else `D Mon` (en-GB short month, e.g. "22 Nov"), with year if not the current year; `formatDate` "22 Nov".
- **Acceptance**: boundary tests at each threshold, UTC date rollover for labels.

#### P1-05 `domain/permissions` — astra
- **Spec**: §5.2 table; `can(actor, action, ctx)`. **Acceptance**: exhaustive table test over roles × scopes × actions; agents never attest; self-review denied.

#### P1-06 `domain/labels` — astra
- **Spec**: architecture.md › Label precedence; inputs typed for all five rules (`confirmedErrors`, `openRecheckReasons`, `reviewedVersions`, `sourceChecks` (with `checkerKind`), `ownerConfirmations`, `currentHash`); outputs `LabelDto` (system-logic.md §6). `pageLabel(sections)` = worst + spread. Agent source check alone never yields `checked`. Evidence with a different `sectionHash` contributes nothing.
- **Acceptance**: one test per precedence row, each tie-break, the agent rule, the old-hash rule; property test: adding a `recheck` input never improves the label.

#### P1-07 `LocalFolderStorage` + `FixtureStorage` — astra
- **Spec**: §3.2. Port relevant cases from `../md-wiki/tests/test_local.py` (read it; port behaviour, not Python structure).
- **Acceptance**: tests in a temp dir: create-only conflict, replace precondition, concurrent writes serialised, symlink escape rejected, receipt written and fsynced (spy), verify failure surfaced; FixtureStorage fault at each step produces the documented error.

#### P1-08 Prisma schema P1 — sol
- **Spec**: §4 Phase-1 models + `AiJob` from P0-07; enums `Role`, `Scope`, `Label`, `UserKind`; migration with append-only trigger on `AuditEvent`; `PageSection.search` generated tsvector + GIN.
- **Acceptance**: migration test: `UPDATE AuditEvent` raises; `prisma migrate reset` clean.

#### P1-09 Auth — astra
- **Spec**: §5.1 and the `/auth/*` rows of §6; Nest guard `@Requires(action)` using `domain/permissions`; CSRF middleware; token auth; login rate limit; owner seed; audit events `auth.login`, `auth.login_failed`, `token.created`, `token.revoked`.
- **Acceptance**: integration tests for every error code in those rows; disabled user's session rejected; revoked/expired token rejected; CSRF missing → 403; token requests skip CSRF; timing-safe compare.

#### P1-10 Indexer — sol
- **Spec**: §3.5, §3.6. **Acceptance**: index `wiki-sample` → Page, Snapshot, PageSection rows; second run with no change → 0 changed; edit a file → new snapshot label `-2` same day; topics from `wiki-meta/topics.md`; out-of-band flag set when sha ≠ last publication.

#### P1-11 Wiki read endpoints — sol
- **Spec**: §6 rows `/wiki/*`, `/context`; labels via `domain/labels` (P1-06). **Acceptance**: integration tests: each endpoint happy path + `NOT_FOUND` + `INVALID_PATH` + unauthenticated; status block stripped from `markdown`; `sections` order = document order.

#### P1-12 Search — sol
- **Spec**: §6 `/search` and *Search rules*. **Acceptance**: tests: relevance ordering, `trust` and `recent` sorts, label filter keeps recheck, facets counts, snippet split without HTML, §11 search cases, query param validation.

#### P1-13 Admin — sol
- **Spec**: §6 `/admin/*`. **Acceptance**: `LAST_OWNER` on demoting/disabling last owner, token shown once, scopes validated against role, audit events written.

#### P1-14 Web data layer — sol
- **Files**: `apps/web/src/lib/{api.ts,session.ts,error-copy.ts,query-keys.ts}`, tests.
- **Spec**: system-logic.md §10. `error-copy.ts` covers every `ErrorCode` (test enforces). No UI.
- **Acceptance**: unit tests with MSW: CSRF header on mutations, 401 → session cleared + redirect target computed, problem+json → `ApiError` with code.

#### P1-15 API e2e — sol (was luna, D-26)
- **Spec**: one supertest suite booting the API against compose Postgres and a temp copy of `wiki-sample`, covering login → tree → page → search → admin token → context with token. **Acceptance**: green in CI job `api-integration`.

### Phase 2 (design system; binds to no API)

Common to every P2 task: implement in `apps/web/src/ui/`, add every variant to `/__gallery` with a stable `data-gallery="<Component>/<variant>"` wrapper, unit tests (Testing Library) for roles/aria/keyboard, and a terra check: gallery screenshot of each variant vs the cropped reference element at 390/768/1024/1440. Tokens only (Tailwind theme names), no arbitrary values unless the token table lists them.

| ID | Spec | Design node | Acceptance beyond the common rules |
| --- | --- | --- | --- |
| P2-01 | Tailwind theme from design-system.md §2 (colours, font families, sizes incl. 12.5/17.5, radii, named spacing 5/7/9/14/18/22, max widths), CSS variables on `:root`, base styles (body bg, 14px/1.5, focus ring, `a:hover`), fonts per Q-UI-4 answer | all | a token test snapshot lists every token = table; gallery page "Tokens" with swatches |
| P2-02 | `TrustIcon` (exact paths §3), `TrustBadge` (3 variants), `SpreadBar` (+caption), `labelMeta` in `packages/domain` (label → words) | F-01 labels card, F-02 result badge, F-03 header | SVG path strings byte-equal to the frame; `aria-label` on badge link |
| P2-03 | Button, PillToggle, Chip, CountBadge, AITag, Mono, Mark | F-01, F-02, F-10, C-TopBar | hover/pressed/disabled/loading per approved §6.1 |
| P2-04 | SearchInput (2 sizes), TextInput, Textarea, Select, Checkbox, Radio, RadioCards, Switch | C-TopBar, F-01, F-02, F-04, F-05, F-07, F-10 | keyboard: space toggles checkbox/switch, arrows move radio; label association |
| P2-05 | Card (+header), Tabs (with counts, arrow keys), Table (scroll box), Callout (5 tones), Drawer (non-modal per F-04 / D-39: focus moves in on open, Esc, return focus) | F-01, F-04, F-05, F-09, F-10 | axe: no violations in gallery |
| P2-06 | TopBar all `active` values, reader vs page-author, query value | C-TopBar | compared against C-TopBar frame at full width (not the in-frame import) |
| P2-07 | WorkNav all `active` values, counts, footer | C-WorkNav | |
| P2-08 | `ReadingLayout`, `WorkspaceLayout`, TanStack Router route tree (all routes in design-system.md §1, screens as empty placeholders), `/__gallery` dev-only | F-01, F-08 | layouts wrap like the frames at 390/768 (side columns stack) |

### Phase 3 (reading screens)

Common: bind through generated hooks; view models in `features/<x>/model.ts` with unit tests; MSW fixtures reproduce the frame's sample data exactly for the visual check; live data is used for the Playwright flow. States: loading/empty/error per approved §6.1; a frame region whose data contract does not exist yet (e.g. *On pages you use* before Phase 9) is **not rendered** and is listed in the report — it is implemented in the phase that owns the data (named below).

| ID | Spec | Design node | Data | Deferred regions (owner task) |
| --- | --- | --- | --- | --- |
| P3-01 | `features/markdown`: pipeline per system-logic.md §10, section wrappers keyed by API anchors, wikilinks to `/wiki/...`, XSS test corpus | F-03 article | `PageDto.markdown/sections` | — |
| P3-02 | Home | F-01 | `/wiki/tree`, `/wiki/recent`, `/search` (box), label spread from tree | *On pages you use* (P9-12), *Start here* (Q-D-2), *Often searched* (Q-D-3), scope toggle "Pages you use" (P9-08) |
| P3-03 | Search: filters, sorts, recheck always shown, highlight, *Ask a question* link target (P6-05) | F-02 | `/search` | Ask a question action (P6-05), "used by N teams" meta (P9) |
| P3-04 | Page: topic tree with page labels, *On this page* with section labels, header (breadcrumb, title, maintainers, updated, page label + SpreadBar), Follow/Suggest/Ask/History actions as links to their future routes (disabled with tooltip? **no** — not designed: hidden until owner phase), section headings with TrustBadge, "Use with care" callout, Sources list, *Changed outside review* | F-03 | `/wiki/pages/{path}` | right rail Why/People (P9-10), action row (P9-10), page feedback (P9-10), Follow (P9-08), Suggest (P4-05), Ask (P6-05), History (P3-06), structured Sources list (P9, D-47), *Changed outside review* (Phase 5, D-47) |
| P3-05 | Login — derived screen (D-16): ReadingLayout without nav, Card with TextInput ×2 + primary Button, error Callout. Also adds the API endpoint `GET /meta` (D-44) and its env keys | — | `/auth/*`, `/meta` | |
| P3-06 | History — derived screen (D-16): F-03 structure, Table of versions (Mono labels) | — | `/wiki/pages/{path}/history` | |
| P3-07 | Settings tabs People and teams, Agents and tokens | F-14 | `/admin/*` | other tabs (P7-06, P8-08, P9-14) |
| P3-08 | Playwright: home → search "objective" (D-45: present in `wiki-sample`; "pinhole" stays in the MSW fixtures for visual checks) → open result → section anchor; reader without Workspace link | — | live API | |

### Phases 4–10

Their `-00` task (OPUS) expands system-logic.md §7 into full contracts and writes briefs in the same format as above before any code. Task lists and model choices are fixed in §3; specs come from plan.md phases 2–8 and architecture.md. Their UI tasks cite: P4-05 → F-06, P4-06 → F-05 *Your suggestions*, P5-05 → F-09, P5-06 → F-10, P5-07 → F-07, P5-08 → F-13 *Blocked*, P6-04 → F-11, P7-05 → F-10 *Quality check* + F-06 *Self-check*, P7-06 → F-14 *Models*, P8-06 → F-08, P8-07 → F-10 *Escalation/Agent review*, P8-08 → F-14 *Review and publishing*, P9-09 → F-04 (4 modes + after-submit), P9-10 → F-03 rail/action row/feedback, P9-11 → F-05, P9-12 → F-01 *On pages you use*, P9-13 → F-12, P9-14 → F-14 *Trust labels*.

## 5. Orchestration protocol

Tools in `tools/orchestrate/` (written by OPUS before P0-01):

| Script | Does |
| --- | --- |
| `brief.sh <ID>` | concatenates `preamble.md` + `docs/tasks/<ID>.md` (spec copied from §4, plus any retry context) into `.orchestrate/briefs/<ID>-<attempt>.md` |
| `run.sh <ID> <model> [attempt]` | `pi -p --model cliproxyapi/<model> --thinking high --session-dir .pi-sessions @brief` with the repo as cwd; log to `.orchestrate/logs/<ID>-<attempt>-<model>.log` |
| `gate.sh <ID>` | `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (+ worker checks when `services/` changed); writes `.orchestrate/gates/<ID>-<attempt>.txt`; exit code = pass/fail |
| `review.sh <ID> <model>` | sends spec + `git diff` (staged baseline vs working tree) to the reviewer model, which must answer with a JSON verdict `{pass, issues:[{file,line,severity,detail}]}` and must not edit files |
| `visual.sh <ID>` | runs `visual:shots` for the task's nodes and sends reference + actual + diff images to terra for a JSON verdict per width |
| `pi-guard.sh <events> -- <pi args>` | every pi call goes through it: JSON event stream, stdin closed, watchdog kills the process tree when no session starts within 90 s, no event for 15 min (10 min for reviews/visual), or 60 min total (25/20 min for reviews/visual). Startup/idle hangs are retried up to 2 times automatically and do **not** count as task retries; a hard timeout counts as a failed attempt with the log as context. Hung event logs are kept as `*.jsonl.hangN` |

Loop per task: brief → run → gate → review (→ visual) → **pass**: progress.md updated, then `git add <task files + progress/decision notes>` and `git commit -m "<type>(<ID>): <title>"` (D-27; one commit per task, never push) → **fail**: retry with the exact gate/review output appended (max 2 per model) → escalate up the ladder with all attempts. Parallel dispatch only inside a ‖ group. A task that reports `BLOCKED:` stops its branch of the DAG; OPUS decides whether it is a human question.

Phase end: full suite (`make check`, API integration, Playwright when present), `pnpm design:shots` + full-screen visual check of every screen built so far at all four widths, then a report in progress.md.

## 6. Decisions taken by the plan

Reversible; each is used as written until a human changes it.

| ID | Decision | Where |
| --- | --- | --- |
| D-1 | Sections are a flat partition: each root heading starts a section ending at the next heading of any level | system-logic §3.3 |
| D-2 | Anchors = github-slugger with `-1`, `-2` duplicates; `lead` for text before the first heading | §3.3 |
| D-3 | Section hash normalisation (LF, trailing whitespace, final LF), heading line included | §3.3 |
| D-4 | Status block = HTML comment `<!-- md-wiki:status … -->` with YAML-like keys | §3.4 |
| D-5 | Errors are problem+json with a closed `code` enum | §2, §9 |
| D-6 | Proposals have a slug used in URLs (the frames show slugs like `fix-pinhole-units`) | §2 |
| D-7 | Topic = first folder; names from `wiki-meta/topics.md` | §3.6 |
| D-8 | Page title = first H1, else file name | §3.3 |
| D-9 | Relative/absolute time formats as listed in P1-04 (matches frame copy "3 h ago", "22 Nov") | P1-04 |
| D-10 | Python worker pinned to 3.12 via uv (machine has 3.15) | P0-02 |
| D-11 | Visual references are produced by rendering the frames with the canvas runtime at 4 widths; the frames' flex-wrap rules define the breakpoints | design-system §5 |
| D-12 | Git: the staging area is the per-task checkpoint; no commits or pushes without the user's approval | §5 |
| D-22 | All pi calls run under `pi-guard.sh` (watchdog, auto-retry on hang); runs are always dispatched in the background and never awaited in the foreground | §5 |
| D-23 | Dev containers run on the remote Docker engine `fd` (user's choice, 2026-11-23): compose project `mdwiki-web`, ports bound to remote loopback 55432/56379, SSH tunnel to localhost 5432/6379, repo-local Docker config with a no-op credential helper (public images only). `MW_DOCKER_HOST=` switches to a local engine (CI) | Makefile, infra/ |
| D-24 | `design/runtime/support.js` (canvas runtime, 198 KB, exported with the frames from the same artifact) is tracked in the repo, no longer gitignored, so a clean clone can render references. Its CDN deps are version-pinned (react 18.3.1, babel 7.29.0) | P0-08 review |
| D-25 | Dev launcher env precedence: one rule for all children — process environment overrides `.env` (standard dotenv semantics) | P0-03 review |
| D-26 | **User instruction (2026-11-23):** luna is raised to sol because of too many failed reviews (P0-01 and P0-03 each failed 3 luna attempts). All remaining luna tasks go to sol; their reviewer becomes astra; ladder is sol → astra → OPUS | user |
| D-27 | **User instruction (2026-11-23), resolves Q-P-1:** commit after each task passes its gate and review — one commit per task, message `<type>(<ID>): <title>` with implementer/reviewer in the body, only that task's files (+ the orchestrator's progress/decision notes). No pushes | user |
| D-28 | **User instruction (2026-11-23):** reviewers must not fail tasks over small issues. Review rubric: blocker/major only for unmet acceptance criteria/verify, contract drift, wrong/misplaced rule, missing required test, invented design, security hole reachable in normal use, or a bug breaking normal use. Edge cases outside the spec, hardening, style → minor (max 3), never a retry. Retry reviews check only prior findings + regressions. Minors are logged as follow-ups in progress.md, not sent back | user |
| D-29 | Parallel tasks that share only root `package.json`/lockfile run in separate git worktrees (`../md-wiki-web-wt-<ID>`, branch `task/<ID>`); after review the branch is rebased onto main (lockfile regenerated with `pnpm install` on conflict), gated again and fast-forwarded, then the worktree is removed | orchestrator |
| D-30 | **User instruction (2026-11-23): reduce task fragmentation.** Tasks merged into coherent slices (one module or one producer/consumer pair per task): Phases 0–5 from 51 to 26 tasks, map in `docs/tasks/merges.tsv`. Every `-00` spec task for Phases 6–10 must likewise produce ≤ 5 implementation tasks per phase. Merged briefs keep every part's spec, acceptance and verify | user |
| D-31 | Job wire contract defined (system-logic.md §7.1: queue `mw-jobs`, `JobEnvelope {v, jobId, kind}`, inputs via internal API, `JobResult` ok/failed, idempotent result post, ping input/output) — answers P0-06's BLOCKED question | orchestrator (OPUS) |
| D-32 | P2-A creates a minimal dev-only `/__gallery` route (unstyled shell listing `data-gallery` wrappers) and extends `tools/design-ref` with element crops (`crops` in variants.json: frame, variant, selector → `design/reference/crops/<Component>/<variant>@<w>.png`) so terra can compare components; P2-C later wraps the gallery in the real layouts | orchestrator |
| D-33 | Status block / sections contract gaps (P1-A BLOCKED): `parseStatusBlock` returns `warning?: 'MALFORMED_STATUS_BLOCK'`; section line numbers are 1-based inclusive in the original file; invalid UTF-8 and symlink escape are tested at the storage boundary (system-logic §3.3–3.4) | orchestrator (OPUS) |
| D-34 | Label metadata selection (P1-B BLOCKED): rules 1–2 earliest open record, rules 4–5 most recent valid record, ties person > agent then lower id; `pageLabel([])` = not_reviewed, zero spread (system-logic §6) | orchestrator (OPUS) |
| D-35 | Design-system gaps (P2-A BLOCKED, UI decision delegated): (1) variants/states not drawn in any frame (other icon sizes, approved hover/pressed/loading of §6.1) get **no** reference crop — verified by unit tests and a terra review of the gallery against §6.1; token swatches by snapshot test only; (2) the frames override the inventory: `SpreadBar` has `md` (8px, r4, F-01) and `sm` (120×6, r3, F-03); (3) exact frame values missing from the token table become named tokens in design-system §2.4, each citing its frame | orchestrator (UI delegation) |
| D-36 | Storage faults and out-of-band lookup (P1-C BLOCKED): `beforeRename`/`afterRename`/`receipt` throw `STORAGE_ERROR` (afterRename after the rename happened), `beforeVerify` makes read-back differ → `VERIFY_FAILED`; indexer uses port `PublicationLookup.lastPublishedSha256` returning `null` until Publication exists (system-logic §3.2, §4) | orchestrator (OPUS) |
| D-37 | Callout and Drawer gaps (P2-B BLOCKED, UI decision delegated): info/accent callout = white, 1px `accent.tint`, r10, 16/18 (F-10 Your decision); AI callout = white, 1px `border.default`, r10, 16/18 + AITag in heading (F-10 Agent review), no `ai.bg` fill; Drawer has no open/close animation (the brief's mention was an orchestrator error) | orchestrator (OPUS) |
| D-38 | Admin users contract gap (P1-D BLOCKED): PATCH `/admin/users/{id}` accepts `disabled?: boolean`; `UserDto` defined (no hash, `disabled` flag); disabling deletes sessions, disabled user's tokens → `ACCOUNT_DISABLED`; `LAST_OWNER` when demotion or disabling leaves no enabled owner (system-logic §6) | orchestrator (OPUS) |
| D-39 | Drawer modality (P2-B BLOCKED): F-04 draws a non-modal side panel (`aria-modal="false"`, no scrim) — frame overrides the plan's "focus trap": no trap, background stays interactive, focus moves into the drawer on open, Esc/close return focus to the trigger | orchestrator (OPUS) |
| D-40 | Auth/admin DTO gaps (P1-D BLOCKED): MeDto, TeamDto, ApiTokenDto fields; admin lists use the cursor envelope; `/auth/session` returns nulls for bad cookies, bad bearer → 401, disabled → 403; scope above role → 400 VALIDATION_FAILED (system-logic §6) | orchestrator (OPUS) |
| D-41 | Read DTO gaps pre-empted before P1-E: PageSummaryDto, VersionDto, RecentChangeDto, tree/topic filter, search total/pageCount/facet scope/snippets/meta nulls/validation, /context content (system-logic §6) | orchestrator (OPUS) |
| D-42 | Top-bar search placeholder (P2-B review): frames leave placeholders unstyled (browser #757575, 4.3:1 on canvas — fails AA); top-bar placeholder uses `text.muted` #545B68, accepted pixel deviation on that crop; axe runs on the full /__gallery with color-contrast enabled | orchestrator (OPUS) |
| D-43 | Phone top bar (pre-empted for P2-C): no menu is drawn, so the TopBar wraps intrinsically as the frame does at 390/768; ux.md's collapsed menu stays undesigned (design-system §6 item 5) | orchestrator (OPUS) |
| D-44 | Wiki name/description (pre-empted for Phase 3): D-21 put them in env but no endpoint exposed them; new unauthenticated `GET /api/v1/meta` → `{ wikiName, wikiDescription }` (defaults "Wiki", ""), built in P3-A | orchestrator (OPUS) |
| D-45 | P3-08 live flow searches "objective" — `wiki-sample` has no "pinhole"; frame sample data (pinhole) stays in MSW fixtures for visual checks | orchestrator (OPUS) |
| D-46 | WorkNav idle weight (P2-C visual): frames request 450 but load Inter 400/500/600/700 only, so CSS font matching renders 500; the app (variable Inter) uses 500 to match what the frames draw — WorkNav crops then pixel-exact | orchestrator (OPUS) |
| D-47 | P3-04 regions without data or design (pre-empted): F-03's Sources list is structured (citation + check status) and needs Phase 9 source-check data → not rendered; the page's own Markdown (incl. any "Sources" heading the author wrote) renders as ordinary content. *Changed outside review* is not drawn in any frame and is always false until Publication exists (D-36) → not rendered in Phase 3; its presentation is decided in P5-00 | orchestrator (OPUS) |
| D-48 | Home/Search data gaps (P3-B BLOCKED): (1) Home *Recent changes* rows render what `RecentChangeDto` has (page title link, page TrustBadge, time); the section subline and *What changed* text need the publication summary → added when P5-00 extends `RecentChangeDto` with `{ sectionTitle, summary }`; masked in the F-01 comparison. (2) Search hit meta omits "written in <year>" (no creation date in `SearchHitDto`); masked. (3) *How trust is decided* (Home) and *Why this label* (Search) open the F-04 drawer, which ships in P9-09 → not rendered until then (D-13) | orchestrator (OPUS) |
| D-49 | F-14 tabs (P3-D): the tab bar shows all six tabs as drawn; only *People and teams* and *Agents and tokens* have panels — *Review and publishing*, *Trust labels*, *Models*, *Storage* render an empty tabpanel (D-13, no placeholders) until P8-08, P9-14, P7-06 and their storage owner. Default tab is *People and teams* (the frame's default *Trust labels* has no data); the tab is kept in `?tab=`. The *Roles* row lists all five roles of system-logic §5.2 (the frame omits `publisher`). *Token lifetime* is not rendered: no lifetime setting exists, and the UI creates tokens without `expiresAt` | orchestrator delegation (P3-D) |
| D-50 | F-14 agent rows come from `/admin/tokens`: one row per token, label = the account the token acts as, help = the token's name (what it is for), value `Token …<last 4 of prefix> · scopes a, b` (API order), note = revoked / expired / expires / last used. Revoked tokens are listed last without an action; *Revoke* is an inline two-step confirm (dialogs are not designed) | orchestrator delegation (P3-D) |
| D-51 | Settings is owner-only: anyone else (incl. signed out) gets a derived 403 (D-16: Card *Settings* + error Callout with `errorCopy.FORBIDDEN` / `UNAUTHENTICATED` and a link home / to sign in); no `/admin/*` request is made for non-owners | orchestrator delegation (P3-D) |
| D-52 | Settings management UI is derived (D-16, not drawn): below the drawn rows, *People* table (Edit, Disable/Enable), inline *Edit* form (roles, team), *Add a person*, *Add a team*, *Create a token* (secret shown once in a success Callout, held only in component state). Client validation: non-blank name, email shape, ≥ 1 role; token: account must be enabled, ≥ 1 scope, scopes limited to `roleAllowsScope` of the account. API failures map through `settingsFormError` (EMAIL_TAKEN → email field, ALREADY_EXISTS → team name, VALIDATION_FAILED field paths → fields, else form message incl. LAST_OWNER) using error-copy.ts. The visual MSW build signs m.nguyen in as owner | orchestrator delegation (P3-D) |
| D-53 | `pnpm e2e` (P3-08): `e2e/run.mjs` builds API+web, migrates a throwaway schema `e2e_<uuid>`, copies `wiki-sample` to a temp dir, boots the built API with a generated owner password, seeds a reader via `POST /admin/users`, serves the web build with `vite preview` (proxy to the API) and runs `@playwright/test` 1.61.1 (same version as `playwright`); cleanup drops the schema and the temp wiki. README › End-to-end tests | orchestrator delegation (P3-D) |
| D-54 | New F-14 tokens: `size.settings-label` 300px and `size.settings-value` 320px (row column bases); `size.table-settings` 720px (derived People table min width) | design-system §2.4 |
| D-70 | Worker provider interface (P7 foundation): `Provider.complete(StructuredRequest) → StructuredResult`, `anthropic` uses the SDK's native structured outputs (`output_config.format` json_schema) rather than forced tool use; `openai_compat` sends `response_format` json_schema with `strict: false` (Ollama/vLLM enforce the schema by guided decoding; OpenAI strict mode would forbid optional fields); config per job kind via `AI_DEFAULT__*` / `AI_JOBS__<KIND>__*`, defaults anthropic / `claude-sonnet-5-5` / 4096 tokens / 120 s / 3 attempts; `temperature` is rejected for anthropic because anthropic SDK 2.x `messages.create` has no sampling parameters (system-logic §7.2) | orchestrator delegation (P7-01) |
| D-71 | Provider error codes `provider_error`, `provider_timeout`, `rate_limited`, `schema_invalid` (worker `JobResult.error.code`, not API `ErrorCode`s); only timeouts, 429, 5xx/529 and connection failures are retried, ≤ `max_attempts` calls with 1 s × 2^(n-1) backoff (≥ `Retry-After`), capped at 30 s; `schema_invalid` is not retried (system-logic §7.2) | orchestrator delegation (P7-01) |
| D-72 | Fencing format `<<<DATA id kind nonce>>> … <<<END id nonce>>>` with a 128-bit per-prompt nonce that must not occur in any block; block ids `^[a-z][a-z0-9-]{0,39}$` are what findings cite (system-logic §7.2) | orchestrator delegation (P7-01) |
| D-73 | Rules file format: each `## ` heading is a rule, id = slug or explicit `{#id}`, hash over raw bytes; model output `{findings:[{rule, severity info|warning|blocking, message, quote{block,text}}]}`; quote verified after NFC + whitespace collapse, exact case; drop reasons `unknown_rule`, `unknown_block`, `empty_quote`, `quote_not_found` are counted (system-logic §7.2) | orchestrator delegation (P7-01) |
| D-74 | Dropped-hedge rule = md-wiki's "invention" flag (page-credibility.md › Cờ "phát minh", architecture.md › Who computes what): lexical comparison of new proposal sentences with hedged base/source sentences (Jaccard ≥ 0.6 on content words), hedge list = md-wiki `STRONG_HEDGE` + `suggest(s/ed)`, `có thể`, `giả thuyết`; output is an advisory candidate. The brief's fallback ("drop findings that are only a hedge") was not needed (system-logic §7.2) | orchestrator delegation (P7-01) |
| D-13 | Before Phase 9, Home/Page regions whose data does not exist are not rendered (no placeholders) | §4 Phase 3 |

### 6.1 Decisions on former open questions (2026-11-23, by the orchestrator under the user's delegation)

The user delegated all UI questions and any non-critical question to the orchestrator's recommendation, to be recorded here.

| ID | Decision | Reason |
| --- | --- | --- |
| Q-UI-1 → D-14 | States addendum in design-system.md §6.1 is **approved** as written. Gate H-1 is closed. | Derived only from existing tokens; keeps every state consistent |
| Q-UI-2 → D-15 | Phone top bar follows the **frame** (flex-wrap), not ux.md's collapsed menu. | The canvas is the UI source of truth; no phone frame exists to copy a menu from |
| Q-UI-3 → D-16 | Undesigned screens (Login, History, Browse, Notifications, ⌘K, Review Final/Current/Discussion tabs, dialogs, Audit log, AI jobs, 404/403) are **derived screens**: composed only from inventory components and tokens, following the nearest frame's structure (reading layout or workspace layout). Each is logged as a deviation DV-n in progress.md. terra checks them for consistency with the system instead of pixel match. Browse = Page (F-03) topic tree view, as the top-bar link already points there. ⌘K = focuses the top-bar search field (no palette). | Unblocks P3-05, P3-06, P6-06 without inventing new visual language |
| Q-UI-4 → D-17 | Fonts self-hosted via @fontsource (DV-1 accepted). | No third-party request from an internal app; same glyphs |
| Q-UI-5 → D-18 | Light theme only for now; all colours as CSS variables so dark can be added later. | No dark values were designed |
| Q-D-1 → D-1 kept | Sections stay a flat partition. | Matches the frames' section lists; simplest disjoint hashing |
| Q-D-2 → D-19 | *Start here* comes from `wiki-meta/start-here.md` (table `team | page path`), reviewed like content; the reader's team selects the rows. | Fits "wiki-meta is reviewed content"; no new admin UI |
| Q-D-3 → D-20 | *Often searched* is an owner-configured list in Settings (stored in `Settings.popularSearches`); no per-person query logging. | Avoids a privacy question |
| Q-D-4 → D-21 | Wiki name/description from env `WIKI_NAME`, `WIKI_DESCRIPTION`; team name from `User.team`. | Simple, one wiki per deployment |
| Q-P-1 | **Resolved (D-27):** commit after each task. | user answered 2026-11-23 |

Future non-critical questions are decided the same way and appended to this table.

## 7. Open questions (need a human)

All answered (§6.1; Q-P-1 by D-27). Original list kept for reference:

| ID | Question | Blocks | Default if unanswered |
| --- | --- | --- | --- |
| Q-UI-1 | Approve the states addendum (hover, pressed, disabled, loading, empty, error) in design-system.md §6.1? | all P2+ UI (gate H-1) | none: UI stays blocked |
| Q-UI-2 | Phone top bar: ux.md says nav collapses to a menu and search becomes an icon; the frame only wraps. Which one? A phone frame would settle it. | P2-06 | follow the frame (wrap) |
| Q-UI-3 | Missing frames: Login, Page History, Browse, Notifications, ⌘K palette, Review tabs Final/Current/Discussion, Import dialog, Assign dialog, Audit log, AI jobs, 404/403. Will they be designed? | P3-05, P3-06, P6-06, parts of P5/P7 | blocked |
| Q-UI-4 | Self-host fonts (DV-1) instead of Google Fonts? | P2-01 | self-host |
| Q-UI-5 | Dark theme: build now (needs values) or later? | P2-01 | light only, tokens as CSS variables so dark can be added |
| Q-D-1 | Section model D-1 (flat) vs nested (an H2 section includes its H3s). md-wiki may already define this. | P1-03 | flat |
| Q-D-2 | Where does *Start here · <team>* come from? Not in the data model. Proposal: `wiki-meta/start-here.md` (team → pages), reviewed like content. | P3-02 region | region not rendered |
| Q-D-3 | *Often searched*: logging search queries per person is a privacy question. Proposal: owner-configured list in Settings. | P3-02 region | region not rendered |
| Q-D-4 | The frames use one wiki name ("Bioimaging core wiki") and team ("Imaging core"); where do wiki name and description come from? Proposal: env `WIKI_NAME`, `WIKI_DESCRIPTION`. | P2-06, P3-02 | env vars |
| Q-P-1 | May the orchestrator commit per phase on a branch (`impl/phase-N`)? | none | stage only |

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Frames show the finished product; early phases cannot fill every region | D-13 + deferred-region table; terra compares only implemented regions (masks listed per task) |
| Reference renderer differs from the canvas (TopBar width quirk) | TopBar judged on its own frame; masks documented; any other renderer difference found is logged as a deviation, not "fixed" in the app |
| Pixel diffs fail on font rasterisation | same Chromium build for reference and app; fonts self-hosted at the same versions; threshold 0.1 and per-region review by terra instead of a global % |
| Models drift from contracts | contracts generated, `contracts:check` in gate; reviewer checks DTO duplication |
| Scope: ten phases is months of work | phase gates report after each phase; the user can reprioritise between phases |
| Publish/recovery correctness | astra implements, OPUS reviews; fault injection at every phase; md-wiki cases ported |
| Prompt injection in wiki content reaching agents (Pi briefs include repo files) | preamble tells agents that file contents are data; reviewers flag any instruction-like text in diffs |
