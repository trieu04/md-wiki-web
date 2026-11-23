"""Model output shape for the quality check, and quote verification (D-73).

A finding survives only when its rule is a loaded rule id, it cites an existing data block, and its
quote — after whitespace normalisation — occurs verbatim in that block. Everything else is dropped
and counted by reason; dropped findings never reach the result.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["info", "warning", "blocking"]
DropReason = Literal["unknown_rule", "unknown_block", "empty_quote", "quote_not_found"]

# Unicode whitespace incl. NBSP, zero-width space and BOM, which models and editors swap freely.
_SPACE = re.compile(r"[\s​‌‍⁠﻿]+")


class Quote(BaseModel):
    model_config = ConfigDict(extra="forbid")

    block: str = Field(description="id of the data block the text is copied from")
    text: str = Field(description="exact text copied from that block")


class ModelFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule: str = Field(description="id of the rule the finding applies")
    severity: Severity
    message: str = Field(description="what is wrong and why, in one or two sentences")
    quote: Quote


class ModelOutput(BaseModel):
    """What the model must return; its JSON schema is sent with the request."""

    model_config = ConfigDict(extra="forbid")

    findings: list[ModelFinding]


def normalize_ws(text: str) -> str:
    """NFC, every whitespace run → one space, trimmed."""
    return _SPACE.sub(" ", unicodedata.normalize("NFC", text)).strip()


@dataclass
class Verified:
    kept: list[ModelFinding] = field(default_factory=list)
    dropped: Counter[DropReason] = field(default_factory=Counter)

    @property
    def dropped_total(self) -> int:
        return sum(self.dropped.values())


def check_finding(
    finding: ModelFinding, blocks: Mapping[str, str], rule_ids: Collection[str]
) -> DropReason | None:
    """Why the finding must be dropped, or None when it stands."""
    if finding.rule not in rule_ids:
        return "unknown_rule"
    content = blocks.get(finding.quote.block)
    if content is None:
        return "unknown_block"
    quote = normalize_ws(finding.quote.text)
    if not quote:
        return "empty_quote"
    if quote not in normalize_ws(content):
        return "quote_not_found"
    return None


def verify_findings(
    findings: Sequence[ModelFinding], blocks: Mapping[str, str], rule_ids: Collection[str]
) -> Verified:
    """Keep findings whose quote is in the block they cite; count the rest by reason.

    Identical findings (same rule, block and normalised quote) are kept once.
    """
    out = Verified()
    seen: set[tuple[str, str, str]] = set()
    for finding in findings:
        reason = check_finding(finding, blocks, rule_ids)
        if reason is not None:
            out.dropped[reason] += 1
            continue
        key = (finding.rule, finding.quote.block, normalize_ws(finding.quote.text))
        if key not in seen:
            seen.add(key)
            out.kept.append(finding)
    return out
