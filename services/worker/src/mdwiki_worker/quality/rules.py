"""Load the quality rules file (``rules/quality.md``): prompt text, SHA-256, rule ids (D-73).

A rule is a level-2 heading. Its id is the heading slug (lower-case ASCII letters and digits, other
runs → ``-``), unless the heading ends with an explicit ``{#id}``. Findings must cite one of
these ids.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

MAX_RULES_BYTES = 64 * 1024
HEADING = re.compile(r"^##[ \t]+(.+?)[ \t]*#*[ \t]*$")
EXPLICIT_ID = re.compile(r"\s*\{#([a-z0-9][a-z0-9-]*)\}$")
FENCE = re.compile(r"^\s*(```|~~~)")


class RulesError(ValueError):
    """The rules file cannot be used."""


@dataclass(frozen=True)
class Rule:
    id: str
    title: str
    body: str


@dataclass(frozen=True)
class Rules:
    text: str
    sha256: str
    rules: tuple[Rule, ...]

    @property
    def ids(self) -> frozenset[str]:
        return frozenset(r.id for r in self.rules)


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def parse_rules(raw: bytes) -> Rules:
    """Parse rules from the file's exact bytes; the hash covers those bytes."""
    if len(raw) > MAX_RULES_BYTES:
        raise RulesError("rules file is larger than 64 KiB")
    digest = hashlib.sha256(raw).hexdigest()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RulesError("rules file is not valid UTF-8") from exc
    text = text.removeprefix("﻿").replace("\r\n", "\n").replace("\r", "\n")
    rules: list[Rule] = []
    current: tuple[str, str] | None = None
    body: list[str] = []
    in_fence = False

    def close() -> None:
        if current is not None:
            rules.append(Rule(current[0], current[1], "\n".join(body).strip()))

    for line in text.split("\n"):
        if FENCE.match(line):
            in_fence = not in_fence
        match = None if in_fence else HEADING.match(line)
        if match:
            close()
            title = match[1]
            explicit = EXPLICIT_ID.search(title)
            if explicit:
                rule_id, title = explicit[1], title[: explicit.start()].strip()
            else:
                rule_id = slug(title)
            if not rule_id:
                raise RulesError(f"rule heading {title!r} has no usable id")
            if any(r.id == rule_id for r in rules):
                raise RulesError(f"duplicate rule id {rule_id!r}")
            current, body = (rule_id, title), []
        elif current is not None:
            body.append(line)
    close()
    if not rules:
        raise RulesError("rules file has no '## ' rule headings")
    return Rules(text=text, sha256=digest, rules=tuple(rules))


def load_rules(path: str | Path) -> Rules:
    try:
        raw = Path(path).read_bytes()
    except OSError as exc:
        raise RulesError(f"cannot read rules file ({type(exc).__name__})") from exc
    return parse_rules(raw)
