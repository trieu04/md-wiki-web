"""Tokenizing section text for the candidate jobs (no network, no model)."""

from __future__ import annotations

import re

_WORD = re.compile(r"[a-z0-9]+(?:[.,][0-9]+)*", re.IGNORECASE)
_NUMBER = re.compile(r"^\d+(?:[.,]\d+)?$")
_MD = re.compile(r"`[^`]*`|\[([^\]]*)\]\([^)]*\)|[#*_>|]")
_NEGATION = frozenset({"not", "no", "never", "without", "cannot", "neither", "nor"})
STOP = frozenset(
    "a an and are as at be by for from has have in is it its of on or that the this to was "
    "were will with which can may also than then there these those into".split()
)


def plain(text: str) -> str:
    return _MD.sub(lambda m: m.group(1) or " ", text)


def words(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(plain(text))]


def content_words(text: str) -> list[str]:
    return [w for w in words(text) if w not in STOP]


def is_number(token: str) -> bool:
    return bool(_NUMBER.match(token))


def negations(tokens: list[str]) -> int:
    return sum(1 for t in tokens if t in _NEGATION or t.endswith("n't"))


def numbers_with_context(tokens: list[str]) -> dict[str, str]:
    """``unit-or-next-word -> number``: '1.4 na' gives {'na': '1.4'}."""
    out: dict[str, str] = {}
    for i, t in enumerate(tokens):
        if is_number(t) and i + 1 < len(tokens) and not is_number(tokens[i + 1]):
            out.setdefault(tokens[i + 1], t)
    return out
