# Merge and conflict logic

## Classify before deciding

| Situation | What you see | Action |
| --- | --- | --- |
| Target and sources current | `refs[].current` all true | Assess evidence and the exact artifact ([reviewer.md](reviewer.md)) |
| Target changed | `conflict` set on the proposal; approval fails with `STALE_BASE` | Compare base, current and proposed; resolve through the conflict endpoint or ask for a new contribution |
| Source changed | a `refs[]` entry with `current: false`; approval fails with `SOURCE_CHANGED` | Reread old and current evidence, reassess the claims that rely on it |
| Text conflict | both edits change the same passage | Resolve from evidence; there is no automatic winner |
| Semantic conflict | edits contradict each other, even in different passages | Dispute log ([discussions.md](discussions.md)), then a new contribution that updates every affected passage |
| Evidence insufficient | no supported resolution | Leave pending and say what is missing, or reject with reasons |
| Write outcome unknown | proposal in tab `blocked`, publication phase `unknown` | Owner recovery only; this is not a text conflict |

A pending proposal with a changed page stays pending; approval is refused. An approved proposal becomes `stale` when publishing finds the page or a source changed. Nothing is merged automatically and nothing overwrites a change made after the base was read.

## Three-way comparison

1. `review_get { slug }` gives `conflict.baseText`, `conflict.currentText` and `conflict.proposedText` (the section when the proposal edits one section that still exists, else the whole page) and `conflict.current.publishedBy` (which proposal produced the current text). `review_diff { slug, against: 'current' }` diffs the artifact against the current page.
2. Compare base→proposed (the author's intent) with base→current (work already published). Keep compatible edits from both sides; for incompatible claims apply the evidence rules. Never pick the last writer, a title or an expertise label automatically.
3. Resolve with REST `POST /proposals/{slug}/conflict { outcome, reason, replacement? }` (submitter or reviewer): `keep_current` drops the change, `use_incoming` replays the proposed region onto the current page, `merge` takes your combined `replacement` region. Each creates a **new** proposal on the current version (same submitter, sources and scope pins; a changed pin is `SOURCE_CHANGED`) that is reviewed again; the old proposal is closed. The reason must link the old slug, the versions compared and the evidence for each choice.
4. If the page changes again before the new proposal is approved, repeat against the newer version. Never relabel old content with a newer version.
