# Architecture

md-wiki-web rebuilds the reviewed Markdown wiki from `md-wiki` as a web application and moves it toward a **self-managed** wiki: **submit → reviewer agent reviews → publish exactly what was approved (automatically) → escalate to the page's authors when needed → trace and correct**. The guarantees of `md-wiki` stay: frozen proposals, decisions bound to what was read, no self-review, conditional writes, full history. The shape changes: a React app for people, a NestJS service that owns all state and every wiki write, and a Python worker that does the AI work, including the reviewer agent.

## Decisions (2026-11-23)

| Topic | Decision |
| --- | --- |
| Who writes the wiki | **NestJS only.** It owns the storage adapter, the publish/recovery flow and all state. The worker never writes the wiki or the database. |
| State and jobs | **Postgres** for state and history, **Redis + BullMQ** for AI jobs. |
| Identity | **Local accounts with roles**, plus API tokens for agents. Designed so OIDC (Entra) can be added later without changing roles. |
| Contributing | **Web editor + agent API.** `.contribution.md` v3 import stays supported. |
| AI in the MVP | **Quality check** (LLM, rules from `quality.md`) and a **reviewer agent**. E1 signals and KUT stay in `md-wiki` research until their experiments justify them. |
| Credibility | **Designed in now** from `md-wiki/docs/research/page-credibility.md`. Evidence records and rule-based section labels are built in Phase 7. The numeric score runs in shadow, and every number-driven behaviour stays off until its E8 experiment records a result (see [Credibility](#credibility)). |
| Models | **Provider adapter**: Claude API and local OpenAI-compatible servers (Ollama, vLLM), chosen by configuration. |
| Integrations | **Discussions and MCP now**; Slack and Teams mirrors later. |
| UI language | **English only.** |
| Audience (2026-11-23) | **Wiki first.** Users are company employees who mostly come to read. The default UI is the wiki (home, search, pages) with trust labels and reader actions on every section; contributing starts from a page; review tools live in a separate Workspace shown only to page authors, reviewers and the owner. See [ux.md](ux.md). |
| Storage | **Local folder adapter** first; the `WikiStorage` contract stays ready for SharePoint. |
| Review model (2026-11-23, revised) | **Self-managed.** The reviewer agent reviews every contribution. It approves, rejects with a revision request, or escalates to the page's authors as a re-review request or a discussion. Humans decide what is escalated to them. See [Self-managed review](#self-managed-review). |
| Publishing | **`AUTO_PUBLISH=true` by default**: an approval is published at once by the API, with the same conditional write. `false` restores a manual Publish step. |
| Old data | **Not migrated.** No importer for `md-wiki` SQLite state. Any Markdown folder can be opened; pages without a status block start as *Not reviewed*. The status block format is free to change. |

## Services

```text
                    ┌──────────────── browser ────────────────┐
                    │ apps/web  React + Vite + TS             │
                    └───────────────┬─────────────────────────┘
                         REST + SSE │ cookie session + CSRF
 agents (REST / MCP, API token) ────┤
                    ┌───────────────▼─────────────────────────┐
                    │ apps/api  NestJS                        │
                    │  auth · wiki · context · contributions  │
                    │  review · publish · discussions · jobs  │
                    │  audit · mcp · events · credibility     │
                    │  search · notifications                 │
                    └───┬───────────┬───────────────┬─────────┘
                        │           │ BullMQ        │ WikiStorage
                 Postgres        Redis              │
                                    │        LocalFolderStorage ── wiki/ (Markdown)
                    ┌───────────────▼─────────────────────────┐
                    │ services/worker  Python                 │
                    │  quality_check · agent_review           │
                    │  providers: anthropic · openai-compat   │
                    └─────────────────────────────────────────┘
                     reads inputs and posts results through the
                     internal API only (service token)
```

### apps/web (React)

- Vite, React, TypeScript, TanStack Router and TanStack Query, Tailwind + shadcn/ui (Radix).
- CodeMirror 6 for the Markdown editor and `@codemirror/merge` for diffs (side by side and inline).
- unified/remark (GFM, footnotes, `[[wikilinks]]`) + rehype-sanitize for rendering. Rendered wiki content is untrusted.
- Client generated from the API's OpenAPI spec (`packages/contracts`).
- SSE subscription for live state (proposal changed, discussion entry, job finished) that invalidates queries.

### apps/api (NestJS)

| Module | Responsibility |
| --- | --- |
| `auth`, `users` | Login, sessions, roles, API tokens with scopes |
| `wiki` | `WikiStorage` port, `LocalFolderStorage`, tree, read, rendered status |
| `search` | Section-level full-text search (Postgres `tsvector` per `PageSection`), filters by label, topic and date, sorts by relevance, label or recency. The label filters and sorts only when the reader asks; it is never mixed into relevance |
| `notifications` | Follows, notification preferences, in-app notifications, daily and weekly digests; fed by credibility and publish events ("a section you used went under re-check", "your report was confirmed") |
| `context` | Immutable `YYYYMMDD-N` snapshots, freshness checks |
| `contributions` | Drafts, submit (freeze into a bundle), v3 import, bundle validation |
| `review` | Preview with the exact artifact, decision bound to hashes and discussion versions |
| `publish` | Conditional write with phases, stale detection, blocked targets, operator recovery |
| `conflicts` | v1 / v2 / proposal comparison and `keep_current` / `use_incoming` / `merge` |
| `discussions` | Topics, proposal discussions, semantic dispute log, holds |
| `jobs` | Enqueue AI jobs, receive results, store findings, expose job status |
| `audit` | Append-only audit events and per-page history |
| `credibility` | Section hashes, source checks, attestations, edges, invalidation events, label rules, score cache, re-check queue |
| `mcp` | MCP server over streamable HTTP for agents, same guards as REST |
| `events` | SSE fan-out of state changes |

Prisma on Postgres. Bundle bytes (manifest, base, proposed, artifact) are stored as `bytea`, exactly as received, never reserialized.

### services/worker (Python)

- Python 3.12, `uv`, pydantic v2, the `bullmq` Python client, `anthropic`, `httpx`.
- Jobs: `quality_check` and `agent_review`. Each is idempotent on `kind + proposal_id + bundle_hash + prompt_version`.
- Credibility jobs (Phase 7): `retraction_check`, `copy_candidates`, `relation_candidates`, `credibility_score`. They read records through the internal API and post events, candidates or cached scores back; none of them changes a label directly.
- Providers behind one interface: `anthropic` (Claude) and `openai_compat` (Ollama, vLLM). Provider, model and parameters come from configuration, and every result records them.
- Prompts and rules are versioned files. Each result records `prompt_version` and the SHA-256 of the rules file it used.
- An eval command runs the quality check against labelled datasets (for example the E3 quality set from `md-wiki`). Datasets stay outside the repo.

## Trust boundary

- Only `apps/api` writes the wiki folder and the database. The worker has neither database credentials nor write access to the wiki.
- The worker reads its inputs from `GET /internal/...` and posts results to `POST /internal/jobs/:id/result` with a service token. The internal API listens on a separate port that is not exposed.
- **AI output is advisory.** A finding can add a flag and never changes proposal state. The reviewer agent is a normal user with the `reviewer` role and an API token. It decides through the same public endpoint as a human, with the same checks: no self-review, approval blocked while disputed, decision bound to the hashes it read.
- Proposal content, sources and discussion text are data. They enter prompts fenced with nonce-delimited markers and an instruction to treat them as data. Model output must match a JSON schema; a finding whose quoted text is not in the proposal is dropped and counted.
- Passwords use argon2id. API tokens are random, shown once and stored hashed. Sessions are httpOnly, SameSite=Lax cookies with a CSRF token. Login is rate limited.

## Roles and scopes

| Role | Can |
| --- | --- |
| `reader` | Read the wiki, history and discussions; search; follow pages; attest (*Useful*, *Checked*, *Used in practice*), report problems, give page feedback; ask questions (open a topic) |
| `contributor` | + drafts, submit proposals, comment. Default role for every employee account |
| `reviewer` | + decide proposals assigned to them (the reviewer agent for every proposal; humans for proposals escalated to them), semantic disputes, resolve proposal discussions, conflict resolution |
| `publisher` | + publish approved proposals manually (only used when `AUTO_PUBLISH=false`) |
| *page author* (derived, not a role) | Escalation target for a page: listed in `wiki-meta/owners.md`, else the humans whose proposals on that page were published, else the owner. Gets `reviewer` rights for proposals escalated to them |
| `owner` | + users, tokens, settings, recovery of blocked targets |

Agent tokens carry scopes (`read`, `contribute`, `discuss`, `review`, `publish`) that are intersected with the role. The reviewer agent token has `read`, `discuss`, `review`. It does not need `publish`: with `AUTO_PUBLISH=true` the API publishes an approval itself, through the same publish flow, recorded as `system (auto-publish after <decision id>)`.

## Workflow rules carried over unchanged

These come from `md-wiki/docs/architecture.md`, and the Python test suite there is the behavioural spec for the port:

- One proposal changes or creates one Markdown file. Proposals are immutable; revisions are new proposals.
- Bundle validation: path escapes, portable names (lowercase ASCII, `.md`), duplicate JSON keys, 1 MiB limit, UTF-8, no reserved status markers in proposed content.
- Freshness is checked at submit, approval and publication. A changed source blocks submit and approval; a change after approval makes publication `stale`.
- A decision binds bundle hash, artifact hash, preview time and both discussion versions. A concurrent discussion entry invalidates it.
- Publication: re-verify, read once (content, item, version), compare with `base_hash`, persist `writing`, write conditionally, verify, record `written`, register the new version, `done`. An unknown outcome blocks the target until an owner records evidence and a written / not-written conclusion. No blind retry, no ETag refresh, no rollback.
- The published artifact starts with a status block between reserved markers (proposal, reviewer, decision date). Its format is new; `md-wiki` compatibility is not required.
- Silence never counts as a decision. An escalation that nobody answers stays pending and sends reminders; it is never approved by timeout.
- States: `pending`, `approved`, `published`, `rejected`, `stale`. Phase, errors, investigation and holds are stored separately.

## New in the web version

- **Drafts.** A draft is mutable and private to its author. It pins the target version when opened and each source version when added. Submit freezes it into a bundle and runs the same validation as an import.
- **Out-of-band change detection.** If the file on disk no longer matches the last artifact the worker published, the reader shows "Changed outside review" and the next publish to it goes `stale` as before.
- **Live state** over SSE, so a reviewer sees a new discussion entry before deciding instead of getting a rejected decision.

## Self-managed review

The reviewer agent is the default decider; humans are pulled in by escalation instead of reading a queue.

```text
submitted ─▶ quality_check ─▶ agent_review ─┬─ approve ─▶ auto-publish ─▶ page authors notified (digest)
                                            ├─ reject (revision request to the author)
                                            └─ escalate ─┬─ re-review: assigned to page authors, one of them decides
                                                         └─ discussion: topic with page authors, holds approval;
                                                            agent reviews again when it is resolved
```

**The agent's decision** goes through the public review endpoint with the guards of a human decision: no self-review, decision bound to the bundle hash, artifact hash and discussion versions it read, approval blocked while disputed or stale. Its reason must list the claims and sources it checked. Content is fenced data; a proposal that tells the agent to approve it is a test fixture.

**Mandatory escalation.** The API evaluates deterministic triggers before accepting an agent approval. If any fires, the approval is refused and the agent must escalate. All triggers only add scrutiny, and the owner can add but not weaken them below the defaults:

| Trigger (default on) | Why |
| --- | --- |
| Open dispute, hold or unresolved report on a touched section | Already blocks approval |
| Quality finding of severity high | The agent should not overrule its own checker |
| Removes or rewrites a section labelled *Checked against source* | That evidence was a human's accountable check |
| Removes sourced content, or changes a number, unit or negation in a sourced sentence | Meaning-changing edits that E1 showed are easy to miss |
| A cited source is retracted, or a low-tier source is added | Source problems |
| A confirmed or candidate contradiction with another page | Needs the people who know the domain |
| The page is in `wiki-meta/` (owners, source tiers) | Changes who decides and what counts as evidence |
| The author is an agent and the page has human authors, and the change is not cosmetic | Keeps humans aware of agent edits to their pages (owner may turn off) |

The agent may also escalate on its own judgement ("uncertain", "needs domain owner"), with a reason.

**Page authors.** Resolved per page: `wiki-meta/owners.md` (path patterns → people, reviewed like content), else the humans whose proposals on that page were published, else the owner. Agents are never escalation targets. The proposal's own author is excluded; if nobody is left, the owner gets it. Any one assignee can decide a re-review. All assignees see a discussion.

**After publication.** Page authors get a digest of auto-published changes to their pages, with a one-click *Report* or *Propose correction*. A configurable share of agent approvals (`spot_check_rate`, placeholder 10%) is sampled into page authors' inbox for an after-the-fact check; a failed spot check is a confirmed error (credibility) and a data point for measuring the agent's accuracy.

**Stop switches.** Pause the reviewer agent (proposals wait, escalation to page authors continues by hand). `AUTO_PUBLISH=false` (approvals wait for a publisher). Both are audit events.

**Measuring the agent.** Every agent decision, escalation and spot-check outcome is stored, so its sensitivity and specificity can be estimated over time (the same `Sp/(1 − Se)` the credibility research uses for a review step). The E3 seeded-contribution sets from `md-wiki` run against the agent as an eval before each prompt or model change.

## Credibility

Source: `md-wiki/docs/research/page-credibility.md` and `page-credibility-research.md` (2026-11-23). Weights and intervals there are placeholders until E8a–E8d measure them, and this design treats them that way.

### Rules taken as constraints

1. **Unit is the section.** A section is the body under a Markdown heading, identified by `(path, anchor)`; text before the first heading is `lead`. Every published version stores `section_hash` (SHA-256 of the section without the status block) per section. Evidence is bound to `(path, anchor, section_hash)`: it follows a section while the hash stays the same and stops counting when it changes ("on old version").
2. **Four concepts stay separate:** credibility, quality (`quality.md`), blast radius (inbound links, retrievals) and usefulness (reads, "useful"). They are never combined into one score. High blast radius means a section *needs* stronger evidence, not that it *has* it.
3. **Readers see a label, not a number.** The label describes evidence ("checked against the source archive on X"), not people. The page label is the **worst** section label plus the share of sections per label, never an average.
4. **One way only.** Low credibility adds scrutiny. High credibility never reduces review, never approves, publishes or reverts, never makes a wiki page a source for another page, and never reweights an assistant's retrieval.
5. **Author reputation is never an input**, for humans or agents.
6. **Staleness is driven by events**: source snapshot changed, source retracted, a declared `applies_to` version changed, a confirmed contradiction published, a provenance root confirmed wrong. A fallback interval per page type is only a safety net, as a step with a 30-day warning band.
7. **Related pages count only through independent provenance.** Links never raise credibility. Derivation passes opinion with discounting (loss goes to uncertainty) and never raises the source. Score moves one step; "needs re-check" flags move to all transitive descendants. Copy, corroboration and contradiction candidates count only after a reviewer confirms the edge. Contradictions follow the asymmetric rule, so a weak page cannot drag a well-sourced section into uncertainty.
8. **Attestations are split.** *Useful* feeds human search only. *Checked against a source* and *Used in practice* are structured, need fields, count only from at least two teams, are capped below one reviewer source check, and never lift a section to the top label alone. *Report wrong or outdated* opens a discussion topic and changes nothing until a reviewer confirms it. There is no plain downvote.

### Who computes what

| Piece | Where | Why |
| --- | --- | --- |
| Section hashes, source checks, attestations, confirmed edges, invalidation events | `apps/api`, append-only tables | They are state; credibility is always recomputable from them |
| **Label** | `apps/api`, deterministic precedence rules, recomputed synchronously on every relevant event | A confirmed error, a retraction or an open flag must show at once and must never depend on the worker being up |
| **Score** (`P`, 10th-percentile lower bound, `u`, reasons) | Worker job `credibility_score`, cached in the API with `model_version` and `params_sha256` | It is a model whose base rates and weights will be learned (E8d); it can lag without making a label false |
| Candidates: undeclared copies (MinHash + rare-value weighting + edit time), corroboration and contradiction (embedding top 20 + re-ranker), dropped hedges ("may", "suggests") | Worker jobs `copy_candidates`, `relation_candidates`, and a rule inside `quality_check` | Retrieval and NLP; output is a list for the reviewer, never applied to scores directly |
| Retraction check | Worker job `retraction_check` (Crossref REST, `update-type:retraction`, Retraction Watch source), at submit, at review and weekly | External fetch; each hit is posted as an invalidation event through the internal API |

### Label precedence (computed by the API)

| Order | Condition | Label |
| --- | --- | --- |
| 1 | Confirmed error not yet corrected, or a pinned KUT is red (when KUT exists) | **Confirmed error** (date) |
| 2 | Unresolved contradiction, discussion hold, open report, or a cited source retracted | **Under re-check**: reason |
| 3 | No published version containing this section was reviewed (imported content) | **Not reviewed** |
| 4 | A valid passed source check or a valid owner confirmation (and, once calibrated, `P ≥ θ` with hysteresis) | **Checked against source** (date) |
| 5 | Otherwise | **Reviewed, not checked against source** (date; "source not checkable" when that was the result) |

**Agent evidence in a self-managed wiki.** Most reviews and many source checks will come from the reviewer agent, so labels say which kind of reviewer acted ("Reviewed by the reviewer agent on X", "Reviewed by a page author on X"), never a name. Default: an agent source check is recorded (`checker_kind = agent`), shown in *Why this label*, and counted in the shadow score with its own weight, but **does not by itself give *Checked against source***; that label needs a human source check or an owner confirmation, as the research requires an accountable action. The agent's measured accuracy (spot checks, E3 evals) is what can later justify a weight.

Labels from community evidence change after a 24 h delay and then lock for a few days; labels from confirmed errors, retractions and red tests change immediately. Until the first calibration round every page type uses one placeholder base rate and the label detail says "base rate not calibrated".

### Modes and gates

| Capability | Default | Turned on only when |
| --- | --- | --- |
| Section hashes, source checks, reports → discussions, retraction job, invalidation events, rule-based labels | On in Phase 7 | Phase 7 tests pass |
| Score computed in shadow (stored, visible in Operations and research export only) | On in Phase 7 | E8a invariants pass as automated tests |
| `θ` and hysteresis in label rule 4; re-check queue ordered by lower bound × blast radius | Off | E8d records lift > 1 over the three baselines and labels monotone in error rate |
| Weight of *Checked* / *Used in practice* attestations | 0 (recorded, shown to reviewers, no effect) | E8b: wrong *Checked* ≤ 10% |
| Reports counted as a detection layer in health metrics | Off | E8b: reports catch ≥ 50% of seeded errors within 30 days |
| Assistant disclosure endpoint | Off | E8c |

An owner switches a gated capability on in Settings by entering the experiment result reference (run record path and date). The switch and its reference are audit events.

### Invariants tested in CI (from E8a)

- Copy laundering: ten pages copying a wrong sentence from A, declared or not, leave A's credibility unchanged.
- Link stuffing: a hundred pages linking to A leave A's credibility unchanged; only blast radius rises.
- Weak contradiction: a weak page contradicting a section with two disjoint provenance groups does not move it off *Checked against source*.
- Suspicion propagation: a confirmed error or retracted root lowers A, lowers what B received from A, and flags every transitive descendant.
- No path from votes or related pages alone to *Checked against source*.
- A changed section hash makes earlier evidence "on old version" and contributes 0.

### Attestation rules

- One person, one account; agents cannot attest (agent retrievals are blast-radius data). The author of a section version cannot attest it; its reviewer is already counted through the review.
- An attestation carries the `section_hash` the person saw; the API rejects it if that hash is no longer current, like a review decision bound to a bundle hash.
- Counts, names and kinds are hidden until the viewer acts or chooses to reveal them; `saw_counts` is stored to measure herding (E8b).
- Readers see team counts only ("2 people in Imaging core"). Names are visible to reviewers and in the audit log. Raw per-person records are kept for a configurable short period; aggregates are kept. The per-person calibration factor is used only inside the aggregation and is never displayed or exported. The attest dialog states the purpose: content quality, not performance evaluation. Where a works council applies (§87(1) no. 6 BetrVG), this needs its agreement before a pilot.
- Fields per kind. *Checked*: source (cited or new), location, result `supports | partly | contradicts | unverifiable`, `compared_numbers`. A *contradicts* result also creates a report. *Used in practice*: use kind, `worked yes | with_changes | no`, optional note. *Report*: kind `wrong | outdated | unclear | source | other`, quote, suggested text and evidence, `blocking`. A blocking report notifies page authors at once; others go into their daily summary.
- The reporter is told when a report is confirmed, dismissed (with the reason, and a reply opens on the topic) or fixed. A person who checked or used a section is told when it is edited or goes under re-check, if they follow it (following is automatic after an attestation, and can be turned off).
- Page feedback ("Did this page help?" yes / partly / no) is stored per page version and counts as *Useful* only; it never changes a label.
- *Used* means an explicit attestation. Page views are never recorded per person.
- Reports are rate limited per person, page and week. A dismissed report lowers the reporter's calibration factor; a confirmed one raises it. Reciprocal attestation pairs and clusters are detected by a periodic job and down-weighted visibly, with a reason, and reported to reviewers; nothing is removed silently.

### Source tiers

A versioned wiki page (default `wiki-meta/source-tiers.md`) lists source types with status, reason and last review date, and goes through review like any content. The editor and the review screen warn when a contribution adds a low-tier source. A good tier never raises credibility; only a passed source check does.

## Data model (first cut)

```text
User(id, email, name, kind human|agent, roles[], password_hash?, disabled_at)
ApiToken(id, user_id, token_hash, scopes[], expires_at, revoked_at, last_used_at)
Settings(review_model self_managed|human, reviewer_agent_id, owner_id, storage_root, quality_check_mode,
         escalation_triggers jsonb, spot_check_rate, reminder_days)            AUTO_PUBLISH comes from env
Assignment(proposal_id, assignee_id, reason, trigger?, created_by, created_at, closed_at)   who may decide
Escalation(id, proposal_id, kind rereview|discussion, triggers[], agent_notes, topic_id?, created_at, resolved_at)
Snapshot(id, path, label YYYYMMDD-N, sha256, content bytea, captured_at)        unique(path, label)
Draft(id, author_id, target, base_snapshot_id?, content, reason, scope jsonb, sources jsonb, updated_at)
Proposal(id, target, submitter_id, state, bundle_hash, manifest bytea, base bytea?, proposed bytea,
         artifact bytea?, artifact_hash, created_at)
ProposalRef(proposal_id, snapshot_id, role target|scope|source, impact)
Decision(id, proposal_id, reviewer_id, approve, reason, bundle_hash, artifact_hash,
         preview_at, discussion_version, dispute_version, created_at)
Publication(proposal_id, phase prepared|writing|written|done|unknown|stale, condition jsonb,
            receipt jsonb, error, started_at, finished_at)
Resolution(proposal_id, actor_id, outcome written|not_written, evidence, created_at)
Topic(id, document_path, section_anchor, topic_key, author_id, status, body, decision_owners[], ...)
Comment(id, topic_id, parent_id?, author_id, body, created_at)
ProposalDiscussion(proposal_id, bundle_hash, status, version) + DiscussionEvent(seq, actor, action, message, ...)
DisputeEvent(proposal_id, seq, actor, action open|comment|resolve|reopen, reason, related_ids[])
ConflictResolution(proposal_id, actor_id, outcome, base_hash, current_hash, replacement_id?, reason)
AiJob(id, kind, proposal_id, bundle_hash, status, provider, model, prompt_version, rules_sha256,
      tokens_in, tokens_out, error, queued_at, started_at, finished_at)
Finding(id, job_id, proposal_id, rule_id, severity, line_start, line_end, quote, explanation, quote_verified)
AgentReview(job_id, proposal_id, outcome decided|left_pending|failed, decision_id?, notes)
AuditEvent(id, actor_id, action, subject, data jsonb, at)                        append-only

-- credibility (append-only; label and score are derived)
User.team, Settings.credibility_mode, Settings.page_types jsonb (path prefix → type, base rate, fallback interval)
PageSection(path, version_label, anchor, section_hash)                         pk(path, version_label, anchor)
SourceCheck(id, path, anchor, section_hash, source_ref, source_snapshot_id?, result supported|not_supported|unverifiable,
            excerpt_ref, location, checker_id, checker_kind human|agent, proposal_id?, created_at)
OwnerConfirmation(id, path, anchor, section_hash, owner_id, note, created_at)
Attestation(id, path, anchor, section_hash, version_label, actor_id, team, role, kind useful|checked|used|report,
            evidence_ref?, details jsonb (per-kind fields above), blocking bool, note?, saw_counts bool, topic_id?, created_at)
PageFeedback(id, path, version_label, actor_id, team, answer yes|partly|no, created_at)

-- reading
Follow(user_id, path, anchor?, reason manual|attested|contributed, created_at, muted_at)
NotificationPref(user_id, event, channel in_app|email_daily|email_weekly|chat)
Notification(id, user_id, event, subject_path, subject_anchor?, data jsonb, created_at, read_at)
AttestationEvent(attestation_id, seq, actor_id, status withdrawn|stale|on_old_version|confirmed|dismissed|downweighted, reason, at)
EdgeCandidate(id, kind copy|corroborates|contradicts|lab_data, src, dst, score, job_id, status open|confirmed|dismissed)
CredibilityEdge(src_path, src_anchor, dst_path, dst_anchor, kind, confirmed_by, created_at)
AnchorLink(path, old_anchor, new_anchor, proposal_id, reviewer_id)              evidence moved on heading rename
InvalidationEvent(id, kind retraction|concern|source_changed|version_changed|contradiction|root_wrong, ref, detail, detected_at)
SectionLabel(path, anchor, section_hash, label, reasons jsonb, computed_at)     cache, rebuilt from records
SectionScore(path, anchor, section_hash, p, lower10, u, r, s, model_version, params_sha256, computed_at)   cache, shadow
```

Declared derivation edges need no table: they are the `sources` and `context` rows of each proposal. Proposals may also declare `applies_to: [{name, version}]` (instrument, software, protocol).

## Repository layout

```text
apps/web/             React app
apps/api/             NestJS service
services/worker/      Python AI worker
packages/contracts/   OpenAPI spec, job JSON schemas, generated TS client and pydantic models
rules/quality.md      review quality rules, versioned; used by the worker and shown in the UI
skills/               agent skill rewritten for the REST/MCP API
infra/                docker-compose (postgres, redis, api, worker, web), env examples
docs/                 architecture, ux, plan
```
