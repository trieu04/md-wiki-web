# Progress

Live tracker for [implementation-plan.md](implementation-plan.md). Updated by the orchestrator after every attempt.

| Task | Model | Reviewer | Status | Retries | Notes |
| --- | --- | --- | --- | --- | --- |
| P0-01 | luna → sol | sol → astra | **done** | 3 | astra PASS on attempt 4; 2 minors carried into P0-05 brief |
| P0-02 | luna | sol | **done** | 1 | attempt 2 fixed secret leaks; review-2 'major' (uv-managed Python) overruled by orchestrator: spec intent is 3.12, met; 2 minors (pydantic <3, caplog INFO) fixed by OPUS |
| P0-03 | luna → sol → astra | sol | **done** | 5 | a6 (astra) gate PASS, sol PASS no issues under D-28 rubric |
| P0-04 | luna | sol | **done** | 0 | sol PASS, no issues |
| P0-05 | astra | sol | **done** | 1 | a1 review: body-parser 413 → 500, internal bind hardcoded; a2 PASS (12 tests) |
| P0-06 | sol | astra | **done** | 2 | merged with P0-07 (D-30). a1 BLOCKED → D-31; a2: verify filter + problem bodies; a3 gate PASS; astra's internal-API OpenAPI body finding overruled as minor (worker types come from job JSON schemas, §7.1) → follow-up |
| P0-08 | sol | astra | **done** | 1 | a1 review: runtime not in clean clone (D-24), non-atomic publish, tests not in pnpm test; a2 PASS, 504/504 deterministic. Minor carried to P0-09: assert state-only variants independent of variants.json |
| P0-09 | sol | astra | **done** | 1 | worktree (D-29). a1: Search fixture totals; a2: hand-written wire types → OPUS fix; astra PASS; rebased twice (lockfile regenerated) |
| P0-G | OPUS | — | **done** | 0 | merges P0-10 (CI). Clean clone: make up, install, build, make check, contracts:check, design:shots all PASS; references byte-identical across clones; ping round trip succeeded at /__dev/ping (69 ms); launcher SIGTERM leaves no processes. Found + fixed: tunnel socket path too long |
| P1-A | astra | sol | **done** | 1 | a1 BLOCKED (status-block warning, line base, boundary tests) → D-33; a2 PASS, 74 tests |
| P1-B | astra | sol | **done** | 1 | a1 BLOCKED (label metadata, empty page) → D-34; a2 review: ordering test gap → OPUS added test; PASS |
| P1-C | astra | sol | **done** | 2 | a1 BLOCKED → D-36; a2: raw-byte precondition (real), gate tunnel/env (tooling); a3 PASS. `prisma migrate reset` verified at P1-G on a throwaway schema with user consent |
| P1-D | astra | sol | **done** | 3 | a1 BLOCKED → D-38; a2 BLOCKED → D-40; a3 review: last-owner lockout, rate-limit tests, user.created, calendar dates; a4 PASS. Fixed P0-G follow-up (API binds 127.0.0.1) |
| P1-E | sol | astra | **done** | 1 | D-41 pre-empted DTO gaps; a1 review: CI env, recheck predicate → domain; a2 PASS |
| P2-A | sol | astra | **done** | 1 | a1 BLOCKED → D-32; a2 no-run (worktree .orchestrate missing); a3 PASS, 152 crops 0 mismatch; terra pass; OPUS unified `Label` type with P1-B on landing |
| P2-B | sol | astra | **done** | 3 | a1 BLOCKED → D-37; a2 BLOCKED → D-39; a3 review: placeholder contrast → D-42; a4 PASS; 267/272 exact, axe 0; terra pass |
| P2-C | sol | astra | **done** | 0 | a1 PASS (2 minors); OPUS fixes on landing: WorkNav idle weight 500 (D-46, 36 → 0 WorkNav diffs), notification dot box-content. 304/340 exact. Fixed P0-G follow-up (Vite binds 127.0.0.1) |
| P3-A | sol | astra | **done** | 0 | a1 PASS (3 minors: token fixed by OPUS; initials → P3-B; Browse fixture → P3-C); terra derived-screen Login pass; DV-3 Login |
| P3-B | sol | terra+astra | **done** | 2 | merges P3-02,P3-03. a2 gate PASS, astra PASS (2 minors); landed by OPUS as 0cc666e with a3's count-line copy fix. a3's partial visual-tooling edits (TopBar-aligned Home/Search scoring) were not landed: kept in `git stash` "P3-B attempt 3 partial visual tooling edits" |
| P3-C | sol | astra | **done** | 1 | a1 FAIL (section badge not a button; local date formatting); a2 PASS 0 issues. F-03 aligned below TopBar: 0.0000% at 390/768/1440, 0.0026% at 1024; DV-5 History; D-47 deferrals |
| P3-D | Claude agent | OPUS | **done** | 0 | merges P3-07,P3-08. 1c81996. Settings People/Agents (F-14), derived 403 + management forms (DV candidates in D-49..D-52), `pnpm e2e` 2/2 (D-53). Follow-ups: no token expiry/copy button, agent users not creatable from UI, e2e/*.mjs not linted |
| P4-00..C | Claude agent | OPUS | **done** | 0 | one commit 4213402 (P4-00 contract §7.2, D-55..D-69; bundles/drafts/submit; contributions + v3 import; F-06 Editor, F-05 Your suggestions, F-03 Suggest link). P4-G: integration test — editor, agent and import freeze identical manifests, all `pending`. Follow-ups: visual shots don't cover F-05/F-06; autosave/submit race → PRECONDITION_FAILED; F-07 still placeholder |
| P7-01 | Claude agent | OPUS | **done** | 0 | d91f288 worker providers + fencing + quote verification + hedge rule (§7.3, D-70..D-74); not wired to a job yet; `rules/quality.md` to create in P7 |
| P5-00,A,B | Claude agent | OPUS | **done** | 0 | one commit (§7.4, D-75..D-94). 36 review integration tests incl. every storage fault, crash per phase + recovery, crash between approval and auto-publish. OPUS review of publish flow: PASS. Follow-ups: no periodic outbox sweeper (boot + after resolution only); SSE single-process; crash in `writing` with disk = base is classified unknown (conservative, per §8.2) |
| P5-C,D | Claude agent | OPUS | **done** | 0 | 9d25e3e. F-09/F-10/F-07/F-13 + derived audit log, SSE invalidation, e2e 4/4 (auto-publish + forced blocked → recovery via read-only folder). D-95..D-104. Follow-ups: "Approve and publish" copy ignores AUTO_PUBLISH=false (not exposed); History lacks publication info |
| P6-00..03 | Claude agent | OPUS | **done** | 0 | discussions/disputes/holds (real DiscussionState), MCP at /mcp (20 tools, same services/errors as REST), skill rewrite + drift test. D-105..D-117. Follow-ups: MCP GET/DELETE 405 untested; mention notifications wait for P9 |
| P6-04..06 | Claude agent | OPUS | **done** | 0 | F-11 Discussions, derived /ask, F-10 disputed + derived Discussion tab, SSE version lock; e2e 5/5. D-118..D-123. Follow-ups: agreements/mentions not in UI; F-11 doesn't list dispute-log rows |
| P7-00,02..04 | Claude agent | OPUS | **done** | 0 | quality_check job end to end (fake-provider tests: schema failure, invented quotes, provider errors), findings re-verified by API and bound to bundle hash, self-check, eval CLI; review works with worker stopped. D-130..D-144. Real-model eval NOT run (needs E3 JSONL + user go-ahead for credits) |
| P7-05,06 | Claude agent → OPUS | — | **done** | 0 | Quality card, Self-check, Models tab, AI jobs; finished by OPUS after the agent hit the usage limit (e2e 6/6). D-145..D-152 |
| P8 backend | OPUS (direct) | — | **done** | 0 | Reviewer agent seeded from env, mandatory triggers (agents only, in the decision tx), escalations rereview/discussion to page authors, inbox, spot checks + confirmed errors, stop switch, reminders, Ops metrics; worker `agent_review` acts via the public API (fake-provider tests incl. prompt injection). API 193, worker 126, e2e 6/6. D-200..D-216 |
| P9 backend (7a, 7c, 7d) | Claude agent → OPUS (direct) | — | **done** | 0 | Evidence writes, why/people, attestations/reports/feedback, Workspace queue + decisions, follows/notifications/digests, gates, daily maintenance (retention, pairs); P8 ports now credibility-backed (trigger facts, confirmed errors, Inbox Check). One page-author rule (D-206). Fixed NUL in advisory-lock keys. API 207, domain 323, e2e 6/6. 7b worker jobs and P9 UI pending. D-160..D-186 |
| P8 UI | Claude agent → OPUS (direct) | — | **done** | 0 | F-08 Inbox (`/work?tab=&item=`, spot-check pass/fail, WorkNav count), F-10 Escalation + Agent review cards (manual escalation when allowed), F-14 Review and publishing (model, optional trigger, spot-check %, reminders, pause/resume), F-13 reviewer-agent metrics, MSW fixtures, SSE `inbox.changed`. Also fixed missing request-body schemas on P8/P9 writes + OpenAPI name clash (f06d10c). Web 361, API 207, domain 323, e2e 6/6. D-220..D-222 |
| P9 7b | Claude agent → OPUS (direct) | — | **done** | 0 | Worker jobs `retraction_check` (Crossref `updates:` incl. Retraction Watch), `copy_candidates` (MinHash), `relation_candidates` (TF-IDF + rule re-ranker, no model), `credibility_score` (Python port pinned to the TS model by shared cases); internal `/credibility/{invalidations,candidates,scores}`; owner run-now, shadow scores, export; daily/weekly schedules; boot recovery. API 217, domain 333, worker 142, e2e 6/6. D-230..D-233 |
| P9 UI (P9-09…14) | OPUS (direct) | — | **done** | 0 | F-04 Trust drawer (why/check/use/report + after-submit, undo), F-03 rail + *This section:* row + Follow + page feedback, F-05 You (followed pages, checks and reports, Tell me when, yearly summary), F-01 *On pages you use* + scope toggle, F-12 Credibility (queue/detail/decision, pages, sources, run-now, export), F-14 Trust labels gates, derived bell `/notifications`. Phase 9 fixtures + MSW handlers. Web 391, e2e 7/7 (new credibility flow). D-240..D-246. Follow-ups: rail facts (changes in review, open questions, linked from) and F-03 *Sources* list need an endpoint; unread count is polled |
| P10-01 backup/restore | OPUS (direct) | — | **done** | 0 | `tools/backup/` (backup, restore with verification, rehearsal), `make backup / restore FROM= / rehearse-backup`, docs/operations.md. Rehearsal PASS 2026-11-24 (48 tables, API on the restored copy serves identical page/labels/follows/audit). 11 unit tests in `pnpm test`. D-250 |
| P10-02 security pass | OPUS (direct) | — | **done** | 0 | docs/security.md (every Phase 8 area → rule, code, test). Fixed: API security headers + no `X-Powered-By`, request-id validation, production refuses example/short secrets, web CSP via `vite preview` (e2e 7/7 under it). New tests: headers, request id, secrets, token callers cannot attest/report, report 429 + Retry-After, retention purge. API 223. D-251. Follow-ups: rate limits beyond login/reports only if abuse is observed |
| P10-03 accessibility pass | OPUS (direct) | — | **done** | 0 | `tools/a11y/audit.mjs` (`pnpm a11y`): 58 axe scans + 4 keyboard checks, 0 violations after fixes (gutter and `trust.none` contrast, skip link, Drawer focus restore on unmount). `test/a11y.test.tsx` (token contrast pairs, label shapes/words). Web 411. D-252 |
| P10-04 docs | OPUS (direct) | — | **done** | 0 | docs/api.md (endpoints, auth, conventions, groups → system-logic sections; every path checked against openapi.json), docs/operations.md (run, health, production checklist, backup/restore), agent skill › Credibility labels (agents never attest/report; source checks with `review` scope), README status/docs/commands. `skill.test.ts` passes |
| H-1 | orchestrator (delegated) | — | done | — | decided D-14..D-21, see plan §6.1 |

**Orchestration change (user, 2026-11-23):** from P3-D on, the Pi workflow (implementation-plan §5) is skipped; tasks run as Claude subagents in worktrees, the orchestrator reviews and commits (D-27 kept). Briefs: `.orchestrate/claude-common.md`.

## Incidents

| When | What | Action |
| --- | --- | --- |
| 2026-11-23 | P0-03: no local container runtime; Docker keychain helper unusable non-interactively | asked user → remote engine `fd` (D-23) |
| 2026-11-23 | P0-01 and P0-02 attempt 2 hung > 5 h in pi startup (no session created, no network socket) | killed; added `pi-guard.sh` watchdog (D-22); attempts re-dispatched (hang not counted as retry) |

**D-30 (user, 2026-11-23): task fragmentation reduced — Phases 0–5 from 51 to 26 tasks (see docs/tasks/merges.tsv).**

**DV-4 (D-35):** design-system inventory gave SpreadBar one geometry; F-03 draws a second (120×6, r3). Frames win; inventory corrected.

## Escalations

**D-26 (user, 2026-11-23):** gpt-6-luna retired; all remaining luna tasks (P0-10, P1-04, P1-15, P2-01, P3-08, P5-09, P10-04) reassigned to gpt-6.2-sol, reviewed by astra.

| Task | From → to | Reason |
| --- | --- | --- |
| P0-01 | luna → sol | sol → astra | **done** | 3 | astra PASS on attempt 4; 2 minors carried into P0-05 brief |

## Design deviations

| ID | Deviation | Status |
| --- | --- | --- |
| DV-1 | Self-hosted fonts instead of Google Fonts link | accepted (D-17) |
| DV-2 | Phone top bar wraps (frame) instead of ux.md collapsed menu | accepted (D-15) |
| DV-3 | Derived screens for undesigned views (Login, History, Browse, …) | accepted (D-16); each logged when built |

## Phase reports

none yet

## Follow-ups (minor review findings, not blocking — D-28)

| Task | Finding | Planned in |
| --- | --- | --- |
| P0-01 | API test teardown signals pnpm wrapper; test script rebuilds deps | P0-05 brief |
| P0-05 | internal route auth test used an unregistered path (fixed in a2) | — |
| P0-06 | internal job endpoints (GET input, POST result) have no OpenAPI bodies; document with the job schemas when a TS caller needs them (P7-00) | P7-00 |
| P0-G | public API listens on all interfaces (`*:3000`) in dev; bind to 127.0.0.1 unless configured | P1-D |
| P0-G | Vite dev server listens on IPv6 `localhost` only; `127.0.0.1:5173` is refused | P2-C |
| P0-08 | coverage test should assert state-only variants independently of variants.json | P0-09 brief |
| P2-A | gallery pill labels use the option index, not the current selection (astra) | P2-B — **fixed** |
| P2-A | terra: Mono/Chip crop surroundings white vs light-gray in frame (crop background only; 0% pixel diff) | P2-G — closed (rows pixel-identical; terra P2-G found nothing) |
| P2-C | wiki name was a build-time define missing from turbo inputs (astra) | P3-A — **fixed** (`/meta`, D-44) |
| P2-C | Table/scroll crop at 390/768 clipped by the gallery's layout padding (harness, not component) | recheck on the Main/mine screen (P8) |
| P3-A | TopBar shows fixture initials for signed-in users (astra) | P3-B — **fixed** |
| P3-A | visual-mode Browse link opens a page the fixtures don't serve (astra) | P3-C — **fixed** |

## Phase report — Phase 0 (Foundations), 2026-11-23

**Result: PASS.** Gate run by OPUS from a clean clone (P0-G).

| Check | Result |
| --- | --- |
| `make up` (remote engine `fd`, SSH tunnel) | postgres + redis healthy |
| `pnpm install --frozen-lockfile && pnpm build` | pass |
| `make check` (lint, typecheck, all Node tests, worker ruff/mypy/pytest, tooling tests) | pass |
| `pnpm contracts:check` | pass (no drift) |
| `pnpm design:shots` | 504 references; manifest byte-identical to the main checkout |
| Ping round trip at `/__dev/ping` | `succeeded`, echo matches, 69 ms |
| `make dev` shutdown (SIGTERM) | no leftover processes or ports |
| CI workflow | YAML valid (actionlint not installed); jobs mirror `make check` |

**Tasks:** 10 delivered as 9 commits (P0-07 merged into P0-06, P0-10 into P0-G — D-30).

**Escalations:** P0-01 luna → sol (3 rejected reviews); P0-03 luna → sol → astra (5 rejected reviews, mostly edge cases — led to D-28 review rubric). Luna retired (D-26).

**Blockers resolved by OPUS:** P0-03 Docker runtime (user chose remote engine, D-23); P0-06 job wire contract undefined (D-31, system-logic §7.1).

**Design deviations:** none in Phase 0 (no screens yet). DV-1..DV-3 from planning stand.

**Gate finding fixed:** SSH control socket path exceeded the Unix limit in long checkout paths (commit bc57a91).

**Open follow-ups:** see the Follow-ups table (all minor, each assigned to a later task).

## Phase 1 report (P1-G, 2026-11-23)

Clean clone of main (a9c3e12): `pnpm install --frozen-lockfile`, `uv sync --frozen`, `pnpm build`, `prisma migrate deploy`, `make check` (web 55, API 102, domain, worker, tooling 23), `contracts:check` — all PASS.
Live smoke: built API on a disposable schema against `wiki-sample`, listening on 127.0.0.1 only. Flow verified with real HTTP: anonymous session nulls; unauthenticated → 401 UNAUTHENTICATED; wrong password → 401 INVALID_CREDENTIALS; login → MeDto + csrfToken; tree; page (status block stripped, section labels `not_reviewed`, spread); traversal path → 400 INVALID_PATH; missing → 404; search (snippets split before/hit/after, facets, label filter); missing q → 400 VALIDATION_FAILED; admin POST without CSRF → 403 CSRF_INVALID; token created once; /context and /auth/session with bearer; bad bearer → 401; demoting last owner → 409 LAST_OWNER; logout → 401 afterwards. Schema dropped afterwards.
`prisma migrate reset` (P1-C acceptance) run with user consent on throwaway schema `mw_reset_check`: all 3 migrations applied; schema dropped.
Decisions this phase: D-33 … D-41 (contract gaps found by BLOCKED reports) — all recorded in system-logic.md / implementation-plan.md.

## Phase 2 report (P2-G, 2026-11-23)

Clean clone of main (f05c3de): install, build, `make check` (domain 126, web 107, API 102, contracts 2, worker, tooling 23), `contracts:check`, `design:shots` — all PASS.
Component crops vs design frames: 340 comparisons at 390/768/1024/1440, **304 pixel-identical**; the 36 others are explained: D-42 top-bar placeholder colour (TopBar ×28, SearchInput/topbar ×4), sub-pixel antialiasing (TrustIcon/13-not_reviewed@1440, Callout/info@1440), Table/scroll@390/768 clipped by the gallery's layout padding (follow-up on the real Main/mine screen).
axe with color-contrast on the full gallery: 0 violations at all four widths.
terra, gallery tiles per width (states not in frames, wrapping, nothing invented): PASS at 390, 768, 1024, 1440. Minor: top-bar placeholder truncated at 768/1024 — identical truncation in the C-TopBar frame (as drawn).
Orchestrator fixes this phase: D-46 (WorkNav idle weight renders 500), notification dot box-content. Decisions D-32, D-35, D-37, D-39, D-42, D-43, D-46.
