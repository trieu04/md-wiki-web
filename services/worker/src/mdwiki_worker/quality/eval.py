"""Offline eval of the quality check (system-logic §7.6.8, D-142).

Runs the same prompt, verification and hedge rule as the job over a JSONL dataset and reports
precision/recall per rule. No API, no Redis; the provider comes from the caller.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..contracts.quality_check_input_schema import QualityCheckInput
from ..providers import ModelConfig, Provider, ProviderError
from .check import PROMPT_VERSION, QualityError, run_check
from .rules import parse_rules

# E3 classes (md-wiki quality set) → the rule ids that should fire. `None` = bad, no rule.
E3_CLASS_RULES: dict[str, list[str] | None] = {
    "unsourced_addition": ["unsourced-claim"],
    "citation_mismatch": ["citation-mismatch"],
    "off_topic": ["off-topic"],
    "redundant_addition": ["redundant-content"],
    "promotional": ["promotional-language"],
    "vague": ["vague-wording"],
    "editorial": ["editorial-language"],
    "language_degraded": ["language-quality"],
    "broken_markup": ["broken-markup"],
    "unexplained_removal": ["unexplained-removal"],
    "own_result_body": ["own-result-in-body"],
    "own_result_unscoped": ["own-result-in-body"],
    "own_result_no_data": ["own-result-no-data"],
    "own_result_misreported": ["own-result-misreported"],
    "real_reverted": None,
    "sourced_addition": [],
    "neutral_rewrite": [],
    "language_fix": [],
    "duplicate_removal": [],
    "markup_fix": [],
    "own_result_section": [],
    "real_clean": [],
}


class DatasetError(ValueError):
    pass


class EvalSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1)
    text: str


class EvalItem(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    id: str = Field(min_length=1)
    target_path: str = Field(default="page.md", alias="targetPath")
    title: str | None = None
    reason: str = ""
    base: str | None = None
    proposed: str
    sources: list[EvalSource] = []
    expected: list[str] | None = None
    class_: str | None = Field(default=None, alias="class")

    @model_validator(mode="after")
    def _labelled(self) -> EvalItem:
        if (self.expected is None) == (self.class_ is None):
            raise ValueError("give exactly one of expected or class")
        if self.class_ is not None and self.class_ not in E3_CLASS_RULES:
            raise ValueError(f"unknown class {self.class_!r}")
        return self

    @property
    def expected_rules(self) -> list[str]:
        if self.expected is not None:
            return sorted(set(self.expected))
        return sorted(set(E3_CLASS_RULES[self.class_ or ""] or []))

    @property
    def bad(self) -> bool:
        if self.expected is not None:
            return bool(self.expected)
        return E3_CLASS_RULES[self.class_ or ""] != []


def load_dataset(lines: Iterable[str]) -> list[EvalItem]:
    items: list[EvalItem] = []
    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            items.append(EvalItem.model_validate(json.loads(line)))
        except (json.JSONDecodeError, ValidationError) as exc:
            raise DatasetError(f"line {number}: {exc}") from exc
    return items


def item_input(item: EvalItem, rules_text: str) -> QualityCheckInput:
    """The job input the API would build for this item (§7.6.3 block order)."""
    blocks: list[dict[str, str]] = []
    if item.title and item.title.strip():
        blocks.append({"id": "title", "kind": "proposal", "label": "Title", "text": item.title})
    if item.reason.strip():
        blocks.append({"id": "reason", "kind": "proposal", "label": "Reason", "text": item.reason})
    blocks.append(
        {"id": "proposed", "kind": "proposal", "label": item.target_path, "text": item.proposed}
    )
    if item.base is not None:
        blocks.append({"id": "base", "kind": "base", "label": item.target_path, "text": item.base})
    for n, source in enumerate(item.sources, start=1):
        blocks.append(
            {"id": f"source-{n}", "kind": "source", "label": source.path, "text": source.text}
        )
    sha = hashlib.sha256(rules_text.encode("utf-8")).hexdigest()
    return QualityCheckInput.model_validate(
        {
            "subject": {
                "kind": "proposal",
                "id": "00000000-0000-4000-8000-000000000000",
                "slug": "eval",
                "targetPath": item.target_path,
                "section": None,
            },
            "bundleHash": "0" * 64,
            "blocks": blocks,
            "rules": {"path": "rules/quality.md", "sha256": sha, "text": rules_text},
        }
    )


@dataclass
class RuleScore:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    def as_dict(self) -> dict[str, Any]:
        p = self.tp / (self.tp + self.fp) if self.tp + self.fp else None
        r = self.tp / (self.tp + self.fn) if self.tp + self.fn else None
        return {"tp": self.tp, "fp": self.fp, "fn": self.fn, "precision": p, "recall": r}


@dataclass
class Report:
    rule_ids: list[str]
    rules_sha256: str
    provider: str | None = None
    model: str | None = None
    items: list[dict[str, Any]] = field(default_factory=list)
    scores: dict[str, RuleScore] = field(default_factory=dict)
    dropped: Counter[str] = field(default_factory=Counter)

    def as_dict(self) -> dict[str, Any]:
        scored = [i for i in self.items if i["error"] is None]
        bad = [i for i in scored if i["bad"]]
        clean = [i for i in scored if not i["bad"]]
        caught = sum(1 for i in bad if i["flagged"])
        alarms = sum(1 for i in clean if i["flagged"])
        return {
            "promptVersion": PROMPT_VERSION,
            "provider": self.provider,
            "model": self.model,
            "rulesSha256": self.rules_sha256,
            "rules": {rule: self.scores[rule].as_dict() for rule in sorted(self.scores)},
            "items": {
                "total": len(self.items),
                "bad": len(bad),
                "clean": len(clean),
                "caught": caught,
                "falseAlarms": alarms,
                "detection": caught / len(bad) if bad else None,
                "falseAlarmRate": alarms / len(clean) if clean else None,
                "errors": len(self.items) - len(scored),
            },
            "dropped": dict(sorted(self.dropped.items())),
            "details": self.items,
        }


async def evaluate(
    items: list[EvalItem], rules_raw: bytes, provider: Provider, config: ModelConfig
) -> dict[str, Any]:
    rules = parse_rules(rules_raw)
    rules_text = rules_raw.decode("utf-8")
    report = Report(rule_ids=[r.id for r in rules.rules], rules_sha256=rules.sha256)
    for item in items:
        expected = item.expected_rules
        unknown = sorted(set(expected) - rules.ids)
        detail: dict[str, Any] = {
            "id": item.id,
            "expected": expected,
            "predicted": [],
            "bad": item.bad,
            "flagged": False,
            "dropped": {},
            "error": None,
        }
        report.items.append(detail)
        if unknown:
            detail["error"] = f"unknown expected rules: {', '.join(unknown)}"
            continue
        try:
            result = await run_check(item_input(item, rules_text), provider, config)
        except (ProviderError, QualityError) as exc:
            detail["error"] = f"{exc.code}: {exc.message}"
            continue
        out = result.output
        report.provider, report.model = out.provider, out.model
        predicted = sorted({f.rule for f in out.findings})
        dropped = {k: v for k, v in out.dropped.model_dump(by_alias=True).items() if v}
        report.dropped.update(dropped)
        detail.update(predicted=predicted, flagged=bool(out.findings), dropped=dropped)
        for rule in set(expected) | set(predicted):
            score = report.scores.setdefault(rule, RuleScore())
            if rule in expected and rule in predicted:
                score.tp += 1
            elif rule in predicted:
                score.fp += 1
            else:
                score.fn += 1
    return report.as_dict()


def _pct(value: float | None) -> str:
    return "  -  " if value is None else f"{value * 100:5.1f}"


def format_table(report: dict[str, Any]) -> str:
    lines = [f"{'rule':<26} {'tp':>4} {'fp':>4} {'fn':>4} {'prec%':>6} {'rec%':>6}"]
    for rule, s in report["rules"].items():
        lines.append(
            f"{rule:<26} {s['tp']:>4} {s['fp']:>4} {s['fn']:>4} "
            f"{_pct(s['precision']):>6} {_pct(s['recall']):>6}"
        )
    it = report["items"]
    lines.append(
        f"items {it['total']}: bad {it['bad']} caught {it['caught']} "
        f"(detection {_pct(it['detection']).strip()}%), clean {it['clean']} "
        f"false alarms {it['falseAlarms']} ({_pct(it['falseAlarmRate']).strip()}%), "
        f"errors {it['errors']}"
    )
    lines.append(
        f"provider {report['provider']} model {report['model']} "
        f"prompt {report['promptVersion']} rules {report['rulesSha256'][:12]} "
        f"dropped {report['dropped'] or '{}'}"
    )
    return "\n".join(lines)


def read_dataset(path: Path, limit: int | None) -> list[EvalItem]:
    with path.open(encoding="utf-8") as handle:
        items = load_dataset(handle)
    return items[:limit] if limit is not None else items
