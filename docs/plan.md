# Plan

Build in phases. Each phase ends with something that runs end to end and a check that proves it. The `md-wiki` Python tests are the behavioural spec for the workflow guarantees: port each relevant case before the code it covers. Old `md-wiki` state is not migrated.

Sizes are relative: S ≈ a few days, M ≈ one to two weeks, L ≈ two to three weeks for one developer.

## Phase 0. Skeleton (S)

- pnpm workspace + Turborepo: `apps/web`, `apps/api`, `packages/contracts`; `services/worker` with uv.
- `infra/docker-compose.yml`: postgres, redis, api, worker, web. `make dev` / `pnpm dev`. `.env.example` with `AUTO_PUBLISH=true`.
- Lint/format (ESLint, Prettier, Ruff), type checks (tsc, mypy), CI on push.
- OpenAPI generation from Nest, TS client generation, job JSON schemas → pydantic models.
- A `ping` job: Nest enqueues, worker consumes, calls the internal API, Nest stores the result.

**Exit:** a clean clone runs `make dev` and the ping round trip shows in the UI.

## Phase 1. Read the wiki, accounts (M)

- `WikiStorage` port and `LocalFolderStorage` in TS: per-root lock, temp file + fsync + atomic rename, create-only, receipts in `.wiki-system/`. Port the `md-wiki` local adapter tests, plus a `FixtureStorage` for fault injection.
- Snapshots and `YYYYMMDD-N` labels; freshness checks.
- Section splitter (heading anchors, `lead`) and `section_hash`; new status block format.
- Auth: local accounts, roles, teams, sessions, CSRF, API tokens with scopes. Seed owner from env.
- Section-level search (`tsvector` per section) with topic and date filters.
- UI (wiki first, see ux.md): top bar, Home (search, recently updated, browse by topic), Search results by section, Page (topic tree, *On this page*, article, about-this-page rail), History, login, Settings › People and Agents. Labels already render; at this phase everything is *Not reviewed*.

**Exit:** open any Markdown folder; Home, Search and Page work for a reader; pages render as *Not reviewed*; an agent token can read a page and get its version.

## Phase 2. Contribute (M)

- Drafts (autosave), pin target on open, pin sources on add, rebase on target change.
- Submit: freeze into a bundle, validation rules ported from `bundle.py`.
- Agent REST: `context`, `contributions` (submit), `contributions/:id`. `.contribution.md` v3 import kept as a secondary path.
- UI: *Suggest an edit* from a page section (Write/Preview/Changes, reason, sources, scope, applies to, after-you-submit), You › Your suggestions.

**Exit:** a human and an agent each submit a proposal; both appear pending with identical bundle structure.

## Phase 3. Review and publish (L)

- Assignments: who may decide a proposal (reviewer agent by default, page authors on escalation, owner as fallback); no self-review.
- Preview with the exact artifact; decision binding (bundle hash, artifact hash, preview time, discussion versions).
- Publish flow with phases, stale, unknown outcome → blocked target, owner resolution. `AUTO_PUBLISH=true` publishes on approval through the same flow. Fault-injection tests for every phase, including a crash between approval and auto-publish.
- Record `section_hash` per section for every published version.
- Out-of-band change detection; conflicts (v1/v2/proposal and the three outcomes); history; audit events; SSE.
- Until Phase 6 the owner is the assignee, so the flow is testable by hand.
- UI: Workspace shell (top-bar link shown only to people with work there, workspace menu), Proposals, Review with decision panel and publish progress, *The page changed under you*, Operations › Blocked targets and Audit.

**Exit:** API tests port the `md-wiki` review, publish, recovery and conflict cases; Playwright covers edit → approve → auto-publish → label, and a forced timeout → blocked → recovery.

## Phase 4. Discussions and MCP (M)

- Topics and comments on file + section; proposal discussions and semantic dispute log, versioned and append-only; holds block approval; resolution returns a held proposal to its assignee.
- MCP server over streamable HTTP with token auth: wiki read/search/context, contribution submit/get, discussion tools, review tools for reviewer tokens.
- Rewrite the agent skill (`skills/`) for REST/MCP.
- UI: Workspace › Discussions, *Ask a question* on pages and in search, discussion tab in Review, decision lock on new entries.

**Exit:** the `md-wiki` discussion and MCP cases pass against the new API; an MCP client can contribute, discuss and review with the same checks as the UI.

## Phase 5. Quality check (M)

- Worker: provider interface (`anthropic`, `openai_compat`), config per job kind.
- `quality_check`: input from the internal API, fenced data, rules from `rules/quality.md`, JSON-schema output, quote verification, dropped-hedge rule, result posted back.
- Findings bound to the bundle hash, flags, re-run, author self-check on drafts.
- Eval command over labelled datasets (E3 quality set from `md-wiki`, outside the repo).
- UI: Quality card, Settings › Models and Rules, Operations › AI jobs.

**Exit:** fake-provider tests cover schema failure, invented quotes and provider errors; a real-model eval report is recorded; review works with the worker stopped.

## Phase 6. Self-managed review (L)

- Reviewer agent user and token (`read`, `discuss`, `review`). `agent_review` job after the quality check: reads through the public API, approves, rejects, or escalates.
- Mandatory escalation triggers evaluated by the API before it accepts an agent approval (table in architecture.md); owner can add triggers, not weaken defaults.
- Escalation: re-review assignment to page authors, or a discussion with them; page-author resolution (`wiki-meta/owners.md` → published human authors → owner); reminders; never decided by timeout.
- After publication: digest of changes to each author's pages, spot-check sampling (`spot_check_rate`), failed spot check → confirmed error.
- Guards tested: self-review, disputed, stale, changed discussion version, prompt injection in content, a trigger that fires after the agent read the proposal.
- Stop switches; agent metrics in Operations.
- UI: Inbox, escalation banners and Agent review card, Settings › Review.

**Exit:** E3-style seeded contributions run through the agent on a copy of a wiki; every mandatory trigger escalates; outcomes and agent sensitivity on seeded errors are recorded.

## Phase 7. Credibility (L)

Built from `md-wiki/docs/research/page-credibility.md`. Every number-driven behaviour is behind a gate (architecture.md › Modes and gates).

**7a. Evidence and labels.** Source checks (human and agent, `supported` / `not_supported` / `unverifiable`), owner confirmations, invalidation events, anchor relinking on heading rename, label precedence rules computed synchronously, page label = worst section + spread, `wiki-meta/source-tiers.md` with warnings. UI: labels everywhere content appears (Home, Search with trust filter and *Most checked first*, page tree, *On this page*, section headings), "Use with care" notes, *Why this label* in the page rail and Trust panel, Sources list with state, evidence impact in the editor, evidence card in Review, Workspace › Credibility (needs a person, pages, sources).

**7b. Worker jobs.** `retraction_check` (Crossref, at submit, review and weekly), `copy_candidates`, `relation_candidates`, `credibility_score` in shadow (stored, Operations and research export only). Candidates need a reviewer's *Confirm* before they become edges.

**7c. Reader actions.** Useful / Checked / Used in practice / Report with their per-kind fields, bound to `section_hash`; hidden counts with `saw_counts`, team-only visibility, retention, rate limits, reciprocal-pair detection. Weights stay 0; reports open topics and go to page authors (at once when blocking). Page feedback. Follows, notification preferences, in-app notifications and digests; reporters told of the outcome. UI: Trust panel (four tabs and the after-submit state), section action row, People who rely on it, Home › On pages you use, You (followed pages, your checks and reports, your suggestions, Tell me when).

**7d. Gates.** Settings switches that need an experiment result reference: θ and re-check ordering (E8d), attestation weights (E8b), assistant disclosure endpoint (E8c).

**Exit:** the E8a invariants (copy laundering, link stuffing, weak contradiction, suspicion propagation, no vote-only path to *Checked against source*, hash change resets evidence) pass as automated tests; a confirmed error changes the label in the same request; a seeded retracted DOI reaches every transitive descendant in Workspace › Credibility and notifies readers who follow them; Playwright covers a reader reporting a section, a page author confirming it, and the reader being told.

## Phase 8. Hardening (M)

- Backup and restore (Postgres dump + wiki folder + `.wiki-system/`), rehearsed.
- Security pass: auth, CSRF, token scopes, sanitizer, internal API exposure, rate limits, attestation privacy and retention.
- Docs: operations, API, agent skill. Accessibility pass (keyboard, contrast, label shapes).

**Exit:** restore from backup works on a clean host; the pilot can start.

## Later (only for an observed problem or a recorded experiment result)

- Slack and Teams mirrors (port `transports/`).
- OIDC (Entra) login mapped to existing roles and teams.
- SharePoint `WikiStorage` adapter after the SharePoint spike.
- E1 meaning-change signals and Knowledge Unit Tests (KUT red already has a place in the label rules).
- Assistant (RAG) with deterministic per-section disclosure, after E8c.

## Decisions taken 2026-11-23

| Question | Decision |
| --- | --- |
| May the reviewer agent publish what it approves? | Yes. `AUTO_PUBLISH=true` by default; the API publishes any approval through the normal flow. |
| One designated reviewer? | No: self-managed. The agent reviews everything and escalates to page authors by re-review request or discussion. |
| Migrate old SQLite state? | No. Old data is ignored; status block format is free. |
| Who is the UI for? | Every employee, mainly as readers. Wiki first; review tools in a separate Workspace (ux.md, canvas v4). |

## Open decisions (defaults used until changed)

| Question | Default |
| --- | --- |
| Does `AUTO_PUBLISH` also apply to approvals by page authors, or only to the agent's? | All approvals. |
| Can an agent source check give *Checked against source*? | No; it is recorded and shown, and counts in the shadow score. Needs a person or an owner confirmation, as the research requires an accountable action. |
| Is "agent edits a page with human authors" a mandatory escalation trigger? | On by default for non-cosmetic changes; the owner may turn it off. |
| Spot-check rate of agent approvals | 10% (placeholder until agent accuracy is measured). |
| Who are page authors when `wiki-meta/owners.md` has no entry? | Humans whose proposals on that page were published; else the owner. |
| Retention of raw per-person attestation records | 90 days; aggregates kept. |
| Quality check on every submission | Yes, plus on demand and author self-check. |
| Deployment target | One host with docker compose behind a TLS reverse proxy. |
| Multi-file proposals | Out of scope. |
| Can every employee suggest edits? | Yes: `contributor` is the default role; `reader` only for accounts the owner restricts. |
| Follow automatically after an attestation or a suggestion? | Yes, with notifications on re-check and edits; the person can mute it. |
| Notification channels in the MVP | In-app plus daily email; Slack/Teams with the later mirrors. |
