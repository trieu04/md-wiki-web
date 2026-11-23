# Contribution quality and own results

A contribution can be true and still lower the quality of the wiki. Review quality together with correctness.
Each `## ` heading below is one rule; its `{#id}` is what a finding cites. Severity: `blocking` when the rule says to
reject or request revision and the case is clear, `warning` when a reviewer should look, `info` for minor issues.

Source: md-wiki `skills/wiki-knowledge-workflow/references/quality.md`.

## Claim without evidence {#unsourced-claim}

The contribution adds a claim without declared evidence: no declared source supports it and no existing footnote
of the page covers it. Quote the new claim from the proposed text.

## Citation does not support the claim {#citation-mismatch}

A new or changed sentence cites an existing footnote (or a declared source) that does not support it. Quote the
sentence with its footnote marker.

## Sourced content removed without reason {#unexplained-removal}

Sourced content of the base page is removed and the reason gives no valid ground for removing it. Quote the removed
text from the base page.

## Vague or weasel wording {#vague-wording}

A precise statement is made vaguer (a number, range, condition or attribution is lost), or weasel wording is added
("some researchers believe", "it is widely known").

## Promotional or peacock language {#promotional-language}

The contribution adds promotional, peacock or puffed-up language ("state-of-the-art", "revolutionary", "the best").

## Editorial voice, advice or instructions {#editorial-language}

The contribution adds editorial comment, first-person text, advice or how-to instructions to an article that states
facts.

## Content that belongs elsewhere {#off-topic}

The contribution adds content that belongs on another page (for example a fact about a linked topic that does not
bear on this page's subject).

## Repeats what the page already says {#redundant-content}

The contribution repeats, in other words, what the page already says.

## Broken Markdown {#broken-markup}

The contribution breaks Markdown: wiki links, footnote markers or definitions, lists, tables or headings.

## Spelling, grammar or language {#language-quality}

The contribution adds spelling or grammar errors, makes the text less fluent, or writes in another language than the
page.

## Reason understates the change {#understated-reason}

The reason understates the change: for example "copyedit" or "fix units" on a change that adds, removes or alters a
claim. Quote the part of the proposed text the reason does not cover.

## Own result in the article body {#own-result-in-body}

Results from the contributor's or their lab's own unpublished experiments belong only in a `Lab notes` section (a
level-two heading named "Lab notes") at the end of the page body, never in the article body (lead, other sections,
lists, tables), even when they are correct and well documented. An own result stated as a general fact, without its
conditions and data page, is also in the body.

## Lab note without a data page {#own-result-no-data}

A Lab notes entry must give the date, the lab or role, the sample and conditions, the number of replicates and the
result with its spread, and link to a versioned data page in the wiki (for example `lab-data/...md`) that is declared
as a source. Flag a note without a declared data page.

## Lab note misreports its data page {#own-result-misreported}

A Lab notes entry must match its data page, must not generalise beyond the data page's conditions, and must not
replace or silently contradict a sourced claim in the body. Flag a note that misreports or overgeneralises its data.

## Dropped hedge {#dropped-hedge}

A sentence restates a hedged sentence of the base page or of a declared source but loses one of its hedges or
conditions ("may", "suggests", "in vitro", "until", "up to"). Quote the derived sentence from the proposed text. The
checker also applies this rule deterministically.
