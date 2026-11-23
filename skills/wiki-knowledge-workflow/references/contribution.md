# For agent contributor

## Find and read

- `wiki_search { q }` (REST `GET /search?q=`) finds sections; `wiki_tree` lists topics and pages; `wiki_read { path }` (REST `GET /wiki/pages/{path}`) shows sections and their trust labels.
- Before drafting, read the target with `wiki_context { path }` (REST `GET /context?path=`). Keep `versionLabel` and `sha256`: they are the **base** you are editing. Read every source you will cite the same way and keep its `versionLabel`.
- A page that does not exist yet has no context; submit it with `base: null`.

## Submit

`contribution_submit` (REST `POST /contributions`, scope `contribute`):

```json
{
  "targetPath": "imaging/confocal.md",
  "base": { "versionLabel": "20261123-1", "sha256": "<64 hex from wiki_context>" },
  "content": "<the complete proposed Markdown of the page>",
  "reason": "Claim, evidence and scope of the change",
  "title": "Optional short title",
  "slug": "optional-stable-id",
  "section": "anchor-of-the-edited-section or null",
  "sources": [{ "path": "sources/handbook.md", "versionLabel": "20261120-2" }],
  "scope": [{ "path": "imaging/sted.md", "versionLabel": "20261121-1", "impact": "Update the cross-reference" }],
  "appliesTo": [{ "name": "Zeiss LSM 980", "version": "ZEN 3.8" }]
}
```

- `content` is the whole page as you want it published, without any `<!-- md-wiki:status` block (that marker is reserved: `VALIDATION_FAILED` field code `RESERVED_MARKER`).
- `reason` is required: state the claim, the evidence (source path and version) and the scope and uncertainty. It is shown to the reviewer and to readers of the history.
- Declare every versioned document you used as evidence in `sources`, and every other affected page in `scope` with a concrete impact. Unknown versions fail with field code `UNKNOWN_VERSION`.
- With an explicit `slug`, a retry of the identical submission returns the same proposal (`replay: true`); the same slug with different content is `ALREADY_EXISTS`.
- The result is a pending proposal. Submitting never approves or publishes anything. Check it later with `contribution_get { slug }`.

## When the page changed

- `STALE_BASE`: the target changed since you read it. Reread with `wiki_context`, reassess your change against the new text, and submit again. Do not just copy the new version label onto old content.
- `SOURCE_CHANGED` (fields name `sources[i]` / `scope[i]`): a pinned source changed. Reread it and reassess the claims that rely on it.
- `NO_CHANGE`: the content equals the current page.

## Contribution files

A `.contribution.md` (format `wiki-contribution-v3`) is an alternative for offline delivery: REST `POST /contributions/import { file }`. The service checks the same rules; the verified submitter is always the caller, never the file's Author cell.
