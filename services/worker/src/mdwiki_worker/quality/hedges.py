"""Dropped-hedge rule (D-74), from md-wiki's "invention" flag.

Source: md-wiki docs/research/page-credibility.md › Cờ "phát minh".

A sentence in the derived text (the proposal) that closely matches a sentence of the original (the
base page or a declared source) but has lost one of its hedges or conditions ("may", "suggests",
"in vitro", "until") is flagged for the reviewer. The comparison is lexical: cheap, deterministic,
and advisory — it adds a finding, never changes proposal state.
The hedge list is md-wiki's STRONG_HEDGE
(experiments/poisoning/grounded.py) plus the research note's "suggests", "có thể", "giả thuyết".
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .findings import normalize_ws

HEDGE_TERMS: tuple[str, ...] = (
    # md-wiki grounded.py STRONG_HEDGE
    "may", "might", "some", "most", "many", "often", "usually", "typically", "approximately",
    "up to", "at least", "generally", "mainly", "mostly", "largely", "in vitro", "in vivo",
    "roughly", "rarely", "sometimes", "frequently", "commonly", "partially", "partly", "nearly",
    "almost", "until", "unless", "if", "when", "under", "a portion", "a fraction", "several",
    # page-credibility.md › "phát minh"
    "suggests", "suggest", "suggested", "có thể", "giả thuyết",
)
_HEDGE = re.compile(
    r"(?<!\w)(" + "|".join(re.escape(t) for t in sorted(HEDGE_TERMS, key=len, reverse=True))
    + r")(?!\w)",
    re.I,
)
_SENTENCE_END = re.compile(r"(?<=[.!?])(?:\[\^[^\]]+\])*\s+|\n\s*\n|\n(?=\s*(?:[-*+]|\d+\.|#)\s)")
_WORD = re.compile(r"\w+", re.U)
_STOP = frozenset(
    "the a an and or of to in on for with by at as is are was were be been it its this that "
    "these those from than which who".split()
)
MIN_SIMILARITY = 0.6
MIN_WORDS = 3


@dataclass(frozen=True)
class DroppedHedge:
    original: str  # sentence from the original text (normalised whitespace)
    derived: str  # matching sentence from the derived text (normalised whitespace)
    hedges: tuple[str, ...]  # lower-case hedge terms present in original and missing in derived
    similarity: float


def sentences(text: str) -> list[str]:
    """Sentences and list items of a Markdown text, whitespace-normalised."""
    out = []
    for part in _SENTENCE_END.split(text):
        s = normalize_ws(part)
        if s:
            out.append(s)
    return out


def hedges_in(sentence: str) -> set[str]:
    return {m[1].lower() for m in _HEDGE.finditer(sentence)}


def _content_words(sentence: str) -> set[str]:
    stripped = _HEDGE.sub(" ", sentence)
    return {w for w in (x.lower() for x in _WORD.findall(stripped)) if w not in _STOP}


def similarity(a: str, b: str) -> float:
    """Jaccard similarity of content words, hedges and stop words left out."""
    wa, wb = _content_words(a), _content_words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def dropped_hedges(original: str, derived: str) -> list[DroppedHedge]:
    """Derived sentences that restate a hedged original sentence without (some of) its hedges.

    Sentences that also occur unchanged in the original are skipped: only new wording is compared.
    Each derived sentence is reported at most once, against its most similar hedged original.
    """
    orig = sentences(original)
    hedged = [(s, hedges_in(s)) for s in orig]
    hedged = [(s, h) for s, h in hedged if h and len(_content_words(s)) >= MIN_WORDS]
    unchanged = set(orig)
    out: list[DroppedHedge] = []
    for d in sentences(derived):
        if d in unchanged:
            continue
        best: tuple[float, str, set[str]] | None = None
        for s, h in hedged:
            score = similarity(s, d)
            if score >= MIN_SIMILARITY and (best is None or score > best[0]):
                best = (score, s, h)
        if best is None:
            continue
        lost = best[2] - hedges_in(d)
        if lost:
            out.append(DroppedHedge(best[1], d, tuple(sorted(lost)), round(best[0], 3)))
    return out
