# Orchestration handoff — 2026-11-23

Paused by the user during Phase 3 (stopped mid P3-B attempt 3). This file is the entry point for the next orchestrator session. Status of every task: `docs/progress.md`. Decisions: `docs/implementation-plan.md` §6 (D-1…D-48).

## Where things stand

| Phase | State |
| --- | --- |
| 0 Foundations, 1 Core API, 2 UI kit | done, phase gates passed (reports in progress.md) |
| 3 Reader screens | P3-A done (7eafe4c), P3-C done (cf60896), **P3-B in flight**, P3-D pending, then P3-G gate |
| 4–10 | not started; each begins with a `-00` spec task by OPUS, ≤5 impl tasks (D-30) |

`main` is at 611647b. The only uncommitted change on main is `tools/orchestrate/history.py` (staged "A"): **it belongs to the user — keep it staged, never commit it, never `git commit -a`.**

## P3-B (Home F-01 + Search F-02) — resume here

- Worktree `../md-wiki-web-wt-P3-B`, branch `task/P3-B`, HEAD 719ff6f `wip(P3-B): attempt 2` (already rebased onto main incl. P3-C).
- Attempt 2: gate PASS, astra PASS (2 minors). Implements Home, Search, TopBar initials from session (P3-A follow-up), D-48 deferrals.
- OPUS hand-merged the P3-B/P3-C conflicts (router, App.test, design-system §2.4 token rows, a single MSW `/wiki/tree` handler serving Page topic + Home tree, and visual tooling supporting both P3-B `phase3.maskRects` and P3-C `topBarSelector` → `alignBelowTopBars`). After the merge the P3-B gate passed and P3-C reading scores were unchanged (0.0000/0.0000/0.0026/0.0000 %).
- **Why attempt 3:** Home/Search whole-screen mismatch was 8.6–23 % / 2–11 %, scored with only a fixed 56px TopBar mask; the frame's TopBar renders ~976px wide and wraps taller (design-system §6 item 8), so the score is not meaningful yet.
- Attempt 3 brief: `.orchestrate/P3-B-ctx3.md` (align below measured TopBar and translate maskRects; keep Search TrustBadges in the comparison; name masked regions in the report; fix real differences to ≈0 %; rerun P3-C visual). It was **stopped by the user partway**: uncommitted partial edits exist in the worktree (search/model.ts + test, render.mjs, screen-comparisons.mjs, tools/visual/*). Log: `.orchestrate/logs/P3-B-3-gpt-6.2-sol.log`.
- **To resume:** either rerun attempt 3 on top of the partial edits
  `cd ../md-wiki-web-wt-P3-B && tools/orchestrate/task.sh P3-B gpt-6.2-sol gpt-6.2-astra 3 .orchestrate/P3-B-ctx3.md "apps/web tools"`
  or discard them first (`git checkout -- . ` in the worktree, after looking at the diff) to restart from the merged attempt-2 state.
- Land when scores are ≈0 % (or residuals explained per state): write a message file, `tools/orchestrate/land.sh P3-B <msg-file>`. Then update progress.md (P3-B row still says "running (attempt 1)"; mark the P3-A initials follow-up fixed).

## Next after P3-B

1. **P3-D** Settings + Playwright `pnpm e2e` (live reader flow; search "objective", D-45). Verify script `docs/tasks/P3-D.verify.sh`. Dispatch with a ctx file like P3-B/C (common notes: build on main, model.ts + tests, frame-exact fixtures, whole-screen comparison aligned below TopBar, §6.1 states, no progress.md edits).
2. **P3-G** phase gate: `pnpm check`, all Phase 3 visual reports, terra review of screens (tile tall screenshots; pass images via bash arrays), append the Phase 3 report to progress.md.
3. Phases 4–10 per implementation-plan; pre-empt contract/design gaps in the `-00` spec before dispatch (as D-47/D-48 did).

## Standing rules (from the user and decisions)

- Models: astra = core logic, sol = features/UI (luna retired, D-26), terra = visual checks, OPUS = orchestration/complex/merges. Reviewer is always a different model than the implementer.
- Decide UI and non-critical questions yourself; record them as D-n in implementation-plan §6.
- Commit one commit per task after gate + review (D-27), naming files explicitly; **never push**. Agents never commit.
- Reviewer fails only real defects; minors go to the progress.md follow-ups table (D-28).
- Remote Docker engine `fd`; Postgres/Redis are on localhost 5432/6379 — do not edit global Docker config.
- Never `make down` or `prisma migrate reset` without explicit user consent for that occasion.
- Run Pi agents only via `tools/orchestrate/pi-guard.sh` (hang protection: HARD_SEC / IDLE_SEC).
- Visual mode needs `vite build --mode visual` + `vite preview` (MSW worker exists only in builds).

## Tooling quick reference

`tools/orchestrate/`: `wt.sh <ID>` (worktree), `task.sh <ID> <impl> <reviewer> <attempt> <ctx> "<paths>"` (agent → gate → review), `gate.sh`, `review.sh`, `land.sh <ID> <msg|/dev/null>` (commit, rebase, auto-resolve lockfile/export/plan-doc conflicts, gate, ff-merge, remove worktree), `pi-guard.sh`, `brief-spec.py`, `union-exports.py`. Logs `.orchestrate/logs/`, reviews `.orchestrate/reviews/`, visual reports `visual/report/<ID>/index.html`.
