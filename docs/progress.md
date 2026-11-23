# Progress

Live tracker for [implementation-plan.md](implementation-plan.md). Updated by the orchestrator after every attempt.

| Task | Model | Reviewer | Status | Retries | Notes |
| --- | --- | --- | --- | --- | --- |
| P0-01 | luna → sol | sol → astra | **done** | 3 | astra PASS on attempt 4; 2 minors carried into P0-05 brief |
| P0-02 | luna | sol | **done** | 1 | attempt 2 fixed secret leaks; review-2 'major' (uv-managed Python) overruled by orchestrator: spec intent is 3.12, met; 2 minors (pydantic <3, caplog INFO) fixed by OPUS |
| P0-03 | luna | sol | review (attempt 1) | 0 | luna BLOCKED on docker env; user chose remote engine `fd` (D-23); OPUS adapted Makefile/compose (tunnel, no-op cred helper); verify PASS |
| P0-04 | luna | sol | running | 0 | parallel with P0-08 |
| P0-05 | astra | sol | todo | 0 | |
| P0-06 | sol | astra | todo | 0 | |
| P0-07 | sol | astra | todo | 0 | |
| P0-08 | sol | terra | running | 0 | parallel with P0-04 |
| P0-09 | sol | terra | todo | 0 | |
| P0-10 | luna | sol | todo | 0 | |
| H-1 | orchestrator (delegated) | — | done | — | decided D-14..D-21, see plan §6.1 |

## Incidents

| When | What | Action |
| --- | --- | --- |
| 2026-11-23 | P0-03: no local container runtime; Docker keychain helper unusable non-interactively | asked user → remote engine `fd` (D-23) |
| 2026-11-23 | P0-01 and P0-02 attempt 2 hung > 5 h in pi startup (no session created, no network socket) | killed; added `pi-guard.sh` watchdog (D-22); attempts re-dispatched (hang not counted as retry) |

## Escalations

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
