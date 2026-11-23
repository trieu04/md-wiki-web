"""Quote verification and the dropped-hedge rule."""

import pytest

from mdwiki_worker.providers import FakeProvider, StructuredRequest, complete_structured
from mdwiki_worker.providers.base import output_schema
from mdwiki_worker.quality import (
    ModelFinding,
    ModelOutput,
    Quote,
    dropped_hedges,
    hedges_in,
    normalize_ws,
    verify_findings,
)

BLOCKS = {
    "base": "Oil objectives give the highest resolution.\n",
    "proposed": (
        "Oil  objectives\ngive the highest\u00a0resolution"
        " and are the best choice for everyone."
    ),
    "source-1": "Water objectives are preferred for live cells.",
}
RULES = {"promotional", "unsourced-claim"}


def finding(block: str, text: str, rule: str = "promotional") -> ModelFinding:
    quote = Quote(block=block, text=text)
    return ModelFinding(rule=rule, severity="warning", message="m", quote=quote)


def test_normalize_ws() -> None:
    assert normalize_ws("  a  b\r\n\tc​ ") == "a b c"
    assert normalize_ws("é") == "é"


def test_quote_must_occur_in_the_cited_block_after_whitespace_normalisation() -> None:
    result = verify_findings(
        [
            finding("proposed", "best choice for everyone"),
            finding("proposed", "objectives give the highest resolution"),  # spacing differs
            finding("proposed", "the best choice for all labs"),  # invented quote
            finding("base", "best choice for everyone"),  # real text, wrong block
            finding("source-2", "Water objectives"),  # block does not exist
            finding("proposed", " \n "),  # empty after normalisation
            finding("proposed", "best choice", rule="made-up"),  # rule not loaded
        ],
        BLOCKS,
        RULES,
    )
    assert [f.quote.text for f in result.kept] == [
        "best choice for everyone",
        "objectives give the highest resolution",
    ]
    assert dict(result.dropped) == {
        "quote_not_found": 2,
        "unknown_block": 1,
        "empty_quote": 1,
        "unknown_rule": 1,
    }
    assert result.dropped_total == 5


def test_quote_match_is_case_and_punctuation_exact() -> None:
    result = verify_findings(
        [finding("source-1", "water objectives"), finding("source-1", "live cells")],
        BLOCKS,
        RULES,
    )
    assert [f.quote.text for f in result.kept] == ["live cells"]
    assert result.dropped["quote_not_found"] == 1


def test_identical_findings_are_kept_once() -> None:
    a = finding("proposed", "best choice for everyone")
    b = finding("proposed", "best  choice for\neveryone")
    assert len(verify_findings([a, b], BLOCKS, RULES).kept) == 1


def test_no_findings() -> None:
    result = verify_findings([], BLOCKS, RULES)
    assert result.kept == [] and result.dropped_total == 0


def test_model_output_schema_through_the_fake_provider() -> None:
    import asyncio

    request = StructuredRequest(system="s", user="u", schema=output_schema(ModelOutput))
    script = [
        {
            "findings": [
                {
                    "rule": "promotional",
                    "severity": "warning",
                    "message": "Puffery.",
                    "quote": {"block": "proposed", "text": "best choice for everyone"},
                }
            ]
        }
    ]
    parsed, _ = asyncio.run(complete_structured(FakeProvider(script), request, ModelOutput))
    assert verify_findings(parsed.findings, BLOCKS, RULES).kept == parsed.findings
    bad = [{"findings": [{"rule": "x", "severity": "fatal", "message": "m", "quote": {}}]}]
    with pytest.raises(Exception, match="schema"):
        asyncio.run(complete_structured(FakeProvider(bad), request, ModelOutput))


# --- dropped hedges ----------------------------------------------------------


def test_hedge_terms_ported_from_md_wiki_strong_hedge() -> None:
    # md-wiki grounded.py STRONG_HEDGE; "can", "only", "since" were left out on purpose.
    assert hedges_in("The drug may reduce pain in vitro.") == {"may", "in vitro"}
    assert hedges_in("Up to 30% of cases, at least until 2015.") == {"up to", "at least", "until"}
    assert hedges_in("It can only work since 2015.") == set()
    assert hedges_in("Data suggests a link; có thể đúng.") == {"suggests", "có thể"}
    assert hedges_in("Mayor Smith, somewhere, mostlyness") == set()  # whole words only


def test_dropped_hedge_is_flagged() -> None:
    base = "Vitamin C may shorten colds in adults. Oil objectives are used in microscopy."
    proposed = "Vitamin C shortens colds in adults. Oil objectives are used in microscopy."
    [hit] = dropped_hedges(base, proposed)
    assert hit.original == "Vitamin C may shorten colds in adults."
    assert hit.derived == "Vitamin C shortens colds in adults."
    assert hit.hedges == ("may",)


def test_kept_hedge_or_unchanged_sentence_is_not_flagged() -> None:
    base = "The effect was seen in vitro in some patients."
    assert dropped_hedges(base, base) == []
    assert dropped_hedges(base, "The effect was seen in vitro in some of the patients.") == []
    # Replacing one hedge with another keeps the claim hedged only if the original's terms stay.
    assert dropped_hedges("Results may vary by lab.", "Results might vary by lab.")[0].hedges == (
        "may",
    )


def test_only_some_hedges_lost() -> None:
    base = "Up to 30% of patients may respond in vitro."
    [hit] = dropped_hedges(base, "Up to 30% of patients respond.")
    assert hit.hedges == ("in vitro", "may")


def test_unrelated_new_sentence_is_not_compared() -> None:
    base = "Vitamin C may shorten colds in adults."
    assert dropped_hedges(base, base + " Zinc lozenges taste metallic to children.") == []


def test_derived_sentence_reported_once_against_best_match() -> None:
    base = "Vitamin C may shorten colds. Vitamin C may shorten colds in adults."
    hits = dropped_hedges(base, "Vitamin C shortens colds in adults.")
    assert len(hits) == 1 and hits[0].original == "Vitamin C may shorten colds in adults."


def test_sentences_split_on_footnotes_and_list_items() -> None:
    base = "- Aspirin may prevent strokes in older adults.[^r1]\n- Other item here."
    proposed = "- Aspirin prevents strokes in older adults.[^r1]\n- Other item here."
    [hit] = dropped_hedges(base, proposed)
    assert hit.hedges == ("may",)


def test_vietnamese_hedge() -> None:
    base = "Thuốc này có thể làm giảm đau ở người lớn."
    [hit] = dropped_hedges(base, "Thuốc này làm giảm đau ở người lớn.")
    assert hit.hedges == ("có thể",)


@pytest.mark.parametrize("text", ["", "   ", "May."])
def test_empty_or_tiny_inputs(text: str) -> None:
    assert dropped_hedges(text, "Something else entirely here.") == []
    assert dropped_hedges("Vitamin C may shorten colds.", text) == []
