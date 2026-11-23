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
| P0-09 | sol | astra | retry (attempt 2, worktree) | 1 | a1 review: Search fixture missing total/pageCount |
| P0-G | OPUS | — | pending | 0 | merges P0-10 (CI) + gate |
| P1-A | astra | sol | pending | 0 | merges P1-01,P1-02,P1-03,P1-04 |
| P1-B | astra | sol | pending | 0 | merges P1-05,P1-06 |
| P1-C | astra | sol | pending | 0 | merges P1-07,P1-08,P1-10 |
| P1-D | astra | sol | pending | 0 | merges P1-09,P1-13 |
| P1-E | sol | astra | pending | 0 | merges P1-11,P1-12,P1-15 |
| P2-A | sol | terra | pending | 0 | merges P2-01,P2-02,P2-03 |
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
| P0-08 | coverage test should assert state-only variants independently of variants.json | P0-09 brief |
