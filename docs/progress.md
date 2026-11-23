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
| P1-C | astra | sol | running (attempt 2) | 1 | a1 BLOCKED (fault semantics, publication lookup) → D-36; merges P1-07,P1-08,P1-10; worktree |
| P1-D | astra | sol | pending | 0 | merges P1-09,P1-13 |
| P1-E | sol | astra | pending | 0 | merges P1-11,P1-12,P1-15 |
| P2-A | sol | astra | **done** | 1 | a1 BLOCKED → D-32; a2 no-run (worktree .orchestrate missing); a3 PASS, 152 crops 0 mismatch; terra pass; OPUS unified `Label` type with P1-B on landing |
| P2-B | sol | terra | pending | 0 | merges P2-04,P2-05 |
| P2-C | sol | terra | pending | 0 | merges P2-06,P2-07,P2-08 |
| P3-A | sol | astra | pending | 0 | merges P1-14,P3-01,P3-05 |
| P3-B | sol | terra+astra | pending | 0 | merges P3-02,P3-03 |
| P3-C | sol | terra+astra | pending | 0 | merges P3-04,P3-06 |
| P3-D | sol | terra+astra | pending | 0 | merges P3-07,P3-08 |
| P4-A | astra | sol | pending | 0 | merges P4-01,P4-02,P4-03 |
| P4-B | sol | astra | pending | 0 | merges P4-04 |
| P4-C | sol | terra+astra | pending | 0 | merges P4-05,P4-06 |
| P5-A | astra | OPUS | pending | 0 | merges P5-01,P5-02 |
| P5-B | astra | sol | pending | 0 | merges P5-03,P5-04 |
| P5-C | sol | terra+astra | pending | 0 | merges P5-05,P5-06 |
| P5-D | sol | terra+astra | pending | 0 | merges P5-07,P5-08,P5-09 |
| H-1 | orchestrator (delegated) | — | done | — | decided D-14..D-21, see plan §6.1 |

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
| P2-A | gallery pill labels use the option index, not the current selection (astra) | P2-B |
| P2-A | terra: Mono/Chip crop surroundings white vs light-gray in frame (crop background only; 0% pixel diff) | P2-G |

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
