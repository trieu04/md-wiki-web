# Discussions, holds and the dispute log

Discussions are coordination records. They can hold a proposal's approval, but they never approve, reject, edit or publish anything. Every entry is append-only and bumps the topic's `version`.

## Topics on a page or section (ask a question)

| MCP tool | REST | Notes |
| --- | --- | --- |
| `topic_open { path, anchor?, title, body, mentions? }` | `POST /topics` | `path` must be an indexed page; `anchor` a section of its current version (`UNKNOWN_SECTION`). Role reader + scope `discuss` |
| `topic_list { filter, path?, anchor?, proposal? }` | `GET /topics?filter=open\|mine\|closed\|all` | `counts` per filter |
| `topic_get { id }` | `GET /topics/{id}` (entries: `GET /topics/{id}/comments`) | entries oldest first, `version`, `can` |
| `topic_comment { id, body, kind?, agreesWith?, parentSeq?, mentions?, version? }` | `POST /topics/{id}/comments` | `kind: agreement` needs `agreesWith` (an earlier entry). Contributors comment anywhere; the topic's author may always reply |
| `topic_close { id, outcome, reason, version? }` | `POST /topics/{id}/close` | `resolved`, `rejected` or `on_hold`, with a rationale. Plain topic: its author or a reviewer |
| `topic_reopen { id, reason, version? }` | `POST /topics/{id}/reopen` | |

`mentions` are user ids; mentioned people become participants. A closed (`resolved`/`rejected`) topic takes no replies until reopened (`PRECONDITION_FAILED`). Silence never closes a topic.

## The discussion that holds a proposal

- Open it with `proposal_discussion_open { slug, bundleHash, body, anchor?, title? }` (REST `POST /proposals/{slug}/discussion`). `bundleHash` is the one you read in `review_get`/`contribution_get`; the proposal must be pending. One per proposal (`ALREADY_EXISTS`: reply to it instead).
- It is a topic with `proposal` set. While its status is anything but `resolved` it **holds approval** (`DISPUTED` on approve). `rejected` records that the debate went against the proposal and keeps the hold: the reviewer should then reject the proposal. `on_hold` keeps it open for more evidence.
- Every entry on it needs the `version` you read (`VALIDATION_FAILED` field `version` when missing, `DISCUSSION_CHANGED` when stale) and takes the proposal's lock, so an entry posted while a decision is being made either lands first (the decision fails with `DISCUSSION_CHANGED`) or waits and is refused once the proposal is decided. Reread after a conflict; never guess the next version.
- Only a reviewer who did not submit the proposal closes or reopens it (`FORBIDDEN`, `SELF_REVIEW`). Resolving it returns the proposal to its assignee, who rereads and decides.
- Read it all with `proposal_discussion_get { slug }` (REST `GET /proposals/{slug}/discussion`): `discussionVersion`, `disputeVersion`, `held`, `disputeOpen`, `disputed`, the topic and the dispute log.

## Dispute log (semantic disagreements, reviewers only)

Use it when claims disagree, including claims in separate paragraphs or pages. Fresh hashes and a clean text merge do not establish that two claims are compatible.

`dispute_record { slug, bundleHash, disputeVersion, action, reason, resolutionKind?, relatedSlugs? }` (REST `POST /proposals/{slug}/disputes`, scope `review`, never on your own proposal):

- `open` starts the dispute and holds approval; `reopen` starts it again after a resolution (`open` twice is `PRECONDITION_FAILED`).
- `comment` adds evidence or records no consensus; the hold stays.
- `resolve` needs `resolutionKind`: `supported`, `scoped`, `attributed` or `not_a_conflict`. It releases this dispute's hold on this exact frozen proposal; it does not approve or edit it.
- `relatedSlugs` names competing proposals (≤ 50).

Write the reason in this shape:

```text
Question: [neutral question]
Claim A / Claim B: [wording, location and proposal slugs]
Scope: [subject, conditions, effective dates]
Evidence A/B: [source path@version and the supporting passage]
Alternatives: [choose / narrow scope / attribute / revise]
Objections: [unanswered concerns]
Independent input: [who, and where it came from]
Outcome: [resolution or no consensus]
Next step: [missing evidence or decision]
```

For each position name the source path, exact version and passage. Compare subject, definition, conditions, units, effective time and modality (`must`, `should`, `may`); claims for distinct scopes can coexist, opposite instructions for the same scope cannot. Expertise helps interpret evidence but is not proof, and headcount or seniority are not votes. If wording or evidence must change, that is a new contribution with fresh context that links the old slug and this discussion in its reason. Rejecting while a dispute is open is allowed as a revision request.

The hold belongs to one proposal. It does not carry over to another proposal or to a published page; a correction after publication is another contribution.
