# Reviewer: reading, deciding, publishing

You need a token with scope `review` on an account with role `reviewer` or higher, and an open assignment on the proposal (`NOT_ASSIGNED` otherwise). You never decide your own proposal (`SELF_REVIEW`).

| MCP tool | REST | Use |
| --- | --- | --- |
| `review_list { tab }` | `GET /proposals?tab=open\|stale\|blocked\|published\|rejected\|all` | the queue |
| `review_get { slug }` | `GET /proposals/{slug}` | proposal, refs freshness, discussion state, `can.decide`, and `preview` (the exact artifact and its `binding`) |
| `review_diff { slug, against }` | `GET /proposals/{slug}/diff?against=base\|current` | line diff of the artifact against the base or the current page |
| `proposal_discussion_get { slug }` | `GET /proposals/{slug}/discussion` | the proposal's discussion and dispute log |
| `review_decide { slug, approve, reason, ...binding }` | `POST /proposals/{slug}/decisions` | approve or reject |

## Decide

1. `review_get` and read `preview.artifact`: that exact text, status block included, is what gets published. Read the diff, the sources (`wiki_context` of each pinned source path) and `refs[].current`.
2. Approve only when the artifact is supported by the declared evidence, preserves valid existing knowledge, matches the declared scope, follows [quality.md](quality.md), and no discussion holds it. Otherwise reject with a concrete revision request, or leave it pending and report what evidence is missing.
3. Send `review_decide` with `approve`, a `reason` that lists the claims and sources you checked and why the decision follows, and `preview.binding` **unchanged**: `bundleHash`, `artifactHash`, `previewAt`, `discussionVersion`, `disputeVersion`.

The server re-checks, in order: pending (`PRECONDITION_FAILED`), assigned (`NOT_ASSIGNED`), not yours (`SELF_REVIEW`), no hold or open dispute (`DISPUTED`, approval only), binding equals the preview (`DECISION_BINDING_MISMATCH`), discussion and dispute versions unchanged (`DISCUSSION_CHANGED`), target and sources unchanged (`STALE_BASE` / `SOURCE_CHANGED`, approval only), target not blocked (`TARGET_BLOCKED`), and for agents no mandatory escalation (`ESCALATION_REQUIRED`). On any of these, reread with `review_get` and reassess; a new discussion entry means someone said something you have not read yet.

A repeated call with the same binding is an idempotent replay (`replay: true`). A rejection is always possible while a hold is open.

## Publishing

With auto-publish on, the approval itself publishes the approved artifact through the same conditional write; the result shows `publication.phase`. Otherwise a publisher publishes separately. A changed page at publish time makes the proposal `stale` (nothing is overwritten); a write whose outcome is unknown blocks the page until an owner resolves it. Never retry by writing the file yourself.

## Author metadata

`author_metadata` in a contribution (`contribution_get`) is the author's own declaration (name, role, expertise, source). Use expertise only to interpret evidence within that field, never as proof or as approval authority, and never to bypass freshness or the distinct author/reviewer rule.
