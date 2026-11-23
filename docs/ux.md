# UI/UX design

Mockups: the **md-wiki-web UI v4** canvas (https://claude.ai/artifact/Lxw6KDBmXBFPYTZRX7DzBh). This file is the written spec behind it. Earlier rounds (v1 cluttered, v2 too sparse, v3 contributor-first) are superseded.

## Who it is for

The users are company employees. **Most visits are someone looking something up**, so the wiki is the product: search, read, and know how far to trust what you read. Anyone can suggest a change from a page, but it is not the main path. Reviewing is the job of page authors and the reviewer agent and lives in a separate **Workspace** that readers never need to see.

| Person | Share of visits | What they come for | Screens |
| --- | --- | --- | --- |
| Reader (every employee) | Most | Find the answer, judge how far to rely on it, say when it is wrong | Home, Search, Page, Trust panel, You |
| Contributor (any employee) | Some | Suggest an edit with a source | Page → Suggest an edit, Conflict, You › Your suggestions |
| Page author / human reviewer | Few | Decide what the agent escalated, confirm or dismiss reports, re-check sections | Workspace: Inbox, Proposals, Review, Discussions, Credibility |
| Reviewer agent | — | Review every proposal; approve, reject or escalate | (activity shown in Workspace and Operations) |
| Owner | One or two | Recovery, stop switches, configuration | Workspace: Operations, Settings |

## Principles

1. **The wiki comes first.** The default screen is the wiki. Review tools never appear in a reader's way; the only trace of them is a *Workspace* link for people who have work there.
2. **Trust is visible wherever content is.** Every place that shows wiki content (home lists, search results, the table of contents, section headings, the side menu) shows its section or page label with the same icon and words.
3. **Say only what is true.** A label describes evidence ("checked against Pawley Table 2.1 by a person on 12 Nov"), not people and not correctness. The UI never says "verified", "trusted" or "safe". No number is shown to readers.
4. **Every label explains itself.** Clicking a label opens *Why this label*: the evidence, newest first, and what would change it.
5. **Readers can act on trust in one click.** Each section offers *Useful*, *I checked a source*, *I used it in practice* and *Report a problem*. Each action says what happens next.
6. **Don't steer judgement.** Counts stay hidden until the reader has answered or chooses *Show anyway*. Readers see team counts, never names. No leaderboards or points; a person's own totals are visible only to them.
7. **Warn without alarm.** *Under re-check* and *Confirmed error* sections carry a short "Use with care" note with the reason and the fix in progress. *Not reviewed* stays visible so unlabelled text is not read as trusted. An empty attestation list is neutral.
8. **Nothing happens implicitly for people.** Opening, previewing or reading never changes state. Every human decision is a button with a reason. Automatic steps (agent decision, auto-publish, retraction found) are events with their actor.
9. **AI output looks different.** Agent and model output carries the same small **AI** tag everywhere, with model and prompt version where it matters.
10. **One structure per kind of screen.** Reading screens: top bar, page tree, content, about-this-page rail. Workspace screens: top bar, workspace menu, header with title, status line and labelled actions, tabs with counts, main area plus a context panel of titled label/value lists.

## Navigation

**Top bar** on every screen:

```text
[md-wiki · Bioimaging core]  Home  Browse  Recent changes   [ Search pages, methods, instruments  ⌘K ]   [Workspace 4]  (bell)  (avatar → You)
```

- *Workspace*, with the count of things waiting for you, appears only for people with page-author, reviewer or owner duties.
- The bell holds notifications from followed pages and from your reports and checks.
- At phone width the nav links collapse into a menu and search becomes an icon.

**Workspace menu** (left, only inside Workspace): *Your work*: Inbox, Proposals, Discussions · *Trust*: Credibility · *Owner*: Operations, Settings · footer: reviewer agent state and `AUTO_PUBLISH`.

## Trust labels

One visual system, used everywhere. Shape carries the meaning; colour supports it.

| Label | Icon | Meaning shown to readers |
| --- | --- | --- |
| Checked against source | filled green circle with tick | A person compared this version with its source and it matched |
| Reviewed | half-filled amber circle | A reviewer (agent or person, always said which) approved the change; nobody has checked it against the source yet |
| Not reviewed | hollow grey circle | Written before review started, or never approved |
| Under re-check | orange triangle with bar | A report was confirmed, a source was retracted or changed, or pages contradict each other. Use with care |
| Confirmed error | red octagon with cross | Known to be wrong. Don't rely on it until it is fixed |

- The page label is the **worst** section label, always shown with the spread ("1 under re-check · 1 checked · 2 reviewed · 1 not reviewed") and a small bar.
- Precedence and rules are in architecture.md › Credibility. An agent's source check alone never gives *Checked against source*.

## Reading screens (everyone)

### 1. Home (`/`)

- **Search first**: a large search box with "Often searched" suggestions.
- **On pages you use**: trust notices for pages the person follows or has used: a section went under re-check, a cited source was retracted, *your source check counted*, a section you checked was edited. Each notice has one link (*Read the section*, *See what is affected*, *Check again*).
- **Recently updated**: page, section, what changed in one line, trust label now, when. Toggle *Pages you use* / *All pages*.
- Right column: **Start here** for the reader's team (pages with label and spread), **Browse by topic** with counts, **How to read trust labels** (one line per label) and the wiki-wide spread ("41% checked · 46% reviewed · 3% under re-check · 10% not reviewed") with a link to *How trust is decided*.

### 2. Search (`/search?q=`)

- Results are **sections**, not whole pages: page › section, label, snippet with the match highlighted, and a meta line ("checked against the LSM 980 manual by 2 people · updated 12 Nov · used by 5 teams").
- Results under re-check or with a confirmed error are always shown, with their warning inside the result.
- Filters: **Trust** (a checkbox per label, with counts), Topic, Updated. Sort: *Best match* (default), *Most checked first*, *Newest*. The label never silently changes ranking; only a sort the reader chooses does.
- The label on each result opens *Why this label*.
- Footer: "Didn't find what you need? *Ask a question*". This opens a discussion topic for the page authors of the closest topic.

### 3. Page (`/wiki/*path`)

- **Left**: pages in the same topic, each with its page label, then *On this page*: the section list with each section's label. Clicking a section selects it.
- **Article** (serif body):
  - Header: breadcrumb, title, "Maintained by m.nguyen and h.pham · updated 23 Nov · used by 4 teams", the page label with its spread bar, and the actions **Follow**, **Suggest an edit**, **Ask a question**, **History**. There is no filled primary button: reading is the job.
  - Each section heading has its **label button**, which opens *Why this label* in the rail.
  - A section *Under re-check* or with a *Confirmed error* shows a "Use with care" note: the reason, who confirmed it, and *See the proposed fix* when one is in review.
  - The selected section shows its action row: **Useful · I checked a source · I used it in practice · Report a problem**.
  - A **Sources** list at the end gives each source's tier and state (archived copy, changed since cited, retracted).
  - Page feedback: "Did this page help with your work?" *Yes / Partly / No*. *Partly* and *No* point the reader to reporting the section that failed.
- **Right rail**:
  - **Why "<section>" has this label**: the label, the evidence with its validity ("on previous version" contributes nothing), and what would change it.
  - **People who rely on it**: hidden until the reader answers, or presses *Show anyway*. Then it shows team counts ("2 people in 2 teams checked this version · 1 used it in practice") and says it is for content quality, not for rating people.
  - **Maintained by**: page authors, changes in review, open questions, linked-from count (reach only; links never count as evidence), version label.

### 4. Trust panel (drawer over the page)

Opens from any label or action button. Header: page › section, current label and version. Four tabs:

- **Why this label**: one sentence on what the label means for this section, the evidence newest first (source checks, publications, confirmed links, reviews), *What would change it*, and the note "Labels follow fixed rules over these records; they are not a score."
- **I checked a source**:
  - Which source (one the section cites, or another given by link or file) and where in it.
  - The result: *supports the text*, *partly*, *contradicts it*, *couldn't check*.
  - "I compared the numbers, not only the wording", and an optional note.
  - The check is saved against the section version. If the section changes, the check stops counting and the person is asked to look again. *Contradicts* also sends a report.
- **I used it in practice**: what for (setting up an acquisition, analysing data, training someone, writing a protocol), whether it worked as written (*yes / with changes / no*), and what had to change. It is recorded and shown, but has no effect on the label until E8b.
- **Report a problem**:
  - The kind of problem: *wrong, outdated, unclear, missing or weak source, something else*.
  - The quoted part (filled from the selection), what it should say, and how the reader knows.
  - "This is blocking my work now": page authors are told at once instead of in their daily summary.
  - The panel says who sees the reporter's name (page authors) and what other readers see ("a reader in Imaging core").
- **After submitting**:
  - A confirmation and *What happens next*. For a report: page authors confirm or dismiss it with a reason, the reporter is told either way, and a confirmed report puts the section under re-check for everyone.
  - The counts, now revealed.
  - **Undo (10 min)** and a link to *You*.

The panel's actions are not offered to agents, to the author of that section version, or when the section changed since the page loaded. In that last case the drawer asks the reader to reload.

### 5. You (`/me`)

- Tabs:
  - **Followed pages**: last change, label now, and what to do (*Check again* when a section you checked was edited).
  - **Your checks and reports**: what you did and the outcome (counting, stopped counting, fixed and published, or dismissed with the reason and a *Reply* link).
  - **Your suggestions**: published, draft, needs your attention.
- **Tell me when**:
  - Events: a section I used goes under re-check · a section I checked is edited · my report is confirmed, dismissed or fixed · a weekly summary.
  - Channel: in the wiki plus a daily email, wiki only, or Slack/Teams (later).
- **Your part this year**: checks still counting, reports confirmed, suggestions published. Only the person sees this.

A section counts as used only when the reader presses *I used it in practice* or *Useful*, never from page views.

## Suggesting a change (anyone)

### 6. Suggest an edit (`/wiki/*path/edit?section=`)

- Opens on the selected section; *Whole page* switches the scope.
- Tabs **Write · Preview · Changes**, with a Markdown toolbar.
- Right panel:
  - **Reason** (required): say every claim you add.
  - **Sources you read**: pinned at the version you read, with tier and retraction state.
  - **What happens to evidence**: "Under re-check → not reviewed until your change is reviewed", "1 check on the old text stops counting", "9 pages see 'source section changed'".
  - **Self-check (AI)**: advice, including "this will be escalated because it adds a claim to a sourced sentence".
  - **After you submit**: quality check → the reviewer agent decides or escalates to named page authors → published automatically.
- If the page changed meanwhile, a banner offers *Compare and rebase*, and submit stays disabled until it is resolved. The draft autosaves; *Export .contribution.md* stays available.

### 7. The page changed under you (`/me/suggestions/:id/resolve`)

- Three panes: *What you read*, *What changed since* (with who approved it), *Your proposal*.
- Choose **Combine both**, **Replace with mine** or **Drop my change**, edit the result, then submit it as a new proposal (reviewed again) or withdraw with a reason. Nothing is merged automatically.

## Workspace (page authors, reviewers, owner)

### 8. Inbox (`/work`)

- Lists things assigned to *you*:
  - re-review requests and discussions the agent escalated;
  - re-check items on your pages;
  - spot checks of agent approvals;
  - reports to confirm;
  - mentions.
- Two panes:
  - the list, with type, age and place;
  - the detail: why the item is here, its properties, the agent's notes (AI) and the one next action.
- Tabs with counts: All, Decide, Check, Spot checks, Mentions, Done.
- Reminders run on a schedule. Nothing is ever decided by timeout.

### 9. Proposals (`/work/proposals`)

- Summary tiles: published by the agent today, escalated, sent back, blocked.
- A table with tabs *Open, Stale, Blocked, Published, Rejected, All*, and filters.
  - Columns: proposal, page · section, author (person or agent), status with detail, who it is with, quality findings, age.
- *Import .contribution.md*.

### 10. Review (`/work/proposals/:id`)

- **Header**:
  - Breadcrumb, title, status, author, base version.
  - Actions: *Compare with current*, *Discuss*, *Re-run quality check*, *Assign*.
  - A status banner for each case: escalated to you, disputed, new discussion entry (decision locked until reread), publishing, blocked.
- **Main area**:
  - Tabs: **Changes** (line diff with the flagged phrase marked), **Final page**, **Current page**, **Discussion**, **History**.
  - Below the tabs: the author's reason, and a table of the sources the author read (version, "current" meaning unchanged, retraction and tier).
- **Context panel**:
  - **Escalation**: trigger, assignees, waiting since.
  - **Agent review** (AI).
  - **Quality check** (AI): findings linked to lines; dropped findings are counted.
  - **Evidence on changed sections**: the section's label now, what publishing does to it, related-page candidates, and *Record source check*.
  - **Your decision**: *Approve and publish*, *Request changes* or *Hold for discussion*, a required reason, and the binding line (bundle, artifact, preview time, discussion and dispute versions).

### 11. Discussions (`/work/discussions`)

- **Topic list**: filters Open, Mine, Closed, All. Each topic shows its place, whether it holds a proposal, and its replies.
- **Thread**: participants, related sections and version.
- **Reply**: posting a reply locks open decisions until reviewers reread.
- **Close** as *Resolved / Rejected / On hold*, with a rationale.

Readers' *Ask a question* topics land here too; readers see their own topics from the page.

### 12. Credibility (`/work/credibility`)

- **Tiles**: sections per label across the page authors' area, with the change this week.
- **Needs a person**: a queue of confirmed and new reports, retractions, possible copies (AI), possible contradictions (AI) and fixes in review.
  - Ordered by reach (pages linking, teams using) until E8d tunes the order.
  - Each item's detail: why it is here, its properties, the affected downstream sections, and a decision with a reason. Readers see the result at once.
  - Choices for a retraction: *Still correct with another source / Mark as confirmed error / Keep under re-check*.
  - Choices for a report: *Confirm / Confirm and fix now / Dismiss with a reason*.
  - Choices for a candidate link: *Yes / No / Ask the authors*.
- **Pages**: page label, section spread, oldest unchecked section, readers in the last 30 days.
- **Sources**: tier, state (retracted, changed since cited, OK with archived copy), sections citing it, last check.
- Actions: *Run retraction check now*, *Export*.

### 13. Operations (`/work/ops`, owner)

- **Health tiles**: API and storage, blocked targets, worker queue, model provider, backups.
- **Blocked publish**: the three possible conclusions, worked out from file hashes.
- **Reviewer agent, last 7 days**: decided, auto-published, sent back, escalated, refused by triggers, spot checks, reverts.
- **Background jobs**: quality_check, agent_review, retraction_check, copy_candidates, relation_candidates, and credibility_score (shadow).
- Actions: *Pause the reviewer agent*, *Audit log*.

### 14. Settings (`/work/settings`, owner)

Tabs:
- **Review and publishing**:
  - review model;
  - `AUTO_PUBLISH` (read-only, from env);
  - mandatory escalation triggers;
  - where page authors come from;
  - spot-check rate;
  - reminders;
  - quality check.
- **Trust labels**:
  - rule order (read-only);
  - reader actions;
  - hidden counts and team-only visibility;
  - report urgency;
  - who can confirm reports;
  - retraction schedule;
  - attestation retention;
  - gated switches with their experiment reference.
- **People and teams**.
- **Agents and tokens**.
- **Models**.
- **Storage**.

## Key flows

1. **Look something up**: Home → search → a result shows *Checked against source* → read the section → optionally *I used it in practice*.
2. **Hit a doubtful section**: read a section under re-check → "Use with care" note → *See the proposed fix* or follow the page.
3. **Report**:
   - section → *Report a problem* → page authors get it (at once, if blocking) → *Confirm* in Credibility;
   - the section goes under re-check for everyone, and the reporter is told;
   - fix suggested → reviewed → published → label recomputed, and the reporter is told.
4. **Check a source**: *I checked a source* → supports → the label becomes *Checked against source* (when the rules allow) → the reader sees it in *You*. If the section is edited later, the reader is asked to check again.
5. **Retraction**: the daily job finds a retracted paper → sections citing it and their copies go under re-check → readers who used them get a notice on Home → page authors decide in Credibility.
6. **Suggest an edit**: page → *Suggest an edit* → submit → quality check → the reviewer agent approves and auto-publishes, or escalates to page authors, who decide in Review.
7. **Concurrent edit** and **unknown publish outcome** work as in `md-wiki`.

## Empty, loading and error states

- Home with nothing followed: "Follow pages you rely on to hear when they change." with the team's *Start here* list.
- No search results: suggestions plus *Ask a question*.
- No attestations: "No one has said they rely on this section yet." in neutral text.
- Empty Inbox: "Nothing needs you right now."
- AI unavailable: proposals wait with "Reviewer agent unavailable since 10:42". Owners can switch to the human review model.
- API errors keep the user's input: drafts autosave, and reasons and report text are kept in session storage.

## Visual system

- Inter for UI, Source Serif 4 for wiki content, JetBrains Mono for paths, hashes and versions.
- Ground `#F6F7F9`, white surfaces, borders `#E4E7EC`, text `#14161B`, secondary text `#545B68`. Accent `#2453D6`, for actions and selection only.
- Label colours: checked `#1E7F45`, reviewed `#7A5A00`, not reviewed `#6B7280`, under re-check `#C25A0A`, confirmed error `#C33027`. AI tag `#5B3FB8`.
- Status is always icon plus words, never a filled colour chip. All text pairs meet 4.5:1.
- 14 px base, 17.5 px serif body, 44 px touch targets on phone.
- Layouts wrap: side menus stack above content, and tables scroll inside their panel.
- Light and dark themes come from the same tokens.
