"""The quality check itself (system-logic §7.6.3): prompt, provider call, verification, hedges.

Shared by the ``quality_check`` job and the eval command, so both measure the same thing. No IO
except the provider call.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass

from ..contracts.quality_check_input_schema import QualityBlock, QualityCheckInput
from ..contracts.quality_check_output_schema import (
    FindingOrigin,
    FindingSeverity,
    QualityCheckOutput,
    QualityDropped,
    QualityFinding,
    QualityUsage,
    QuoteRef,
)
from ..providers import (
    ModelConfig,
    Provider,
    StructuredRequest,
    complete_structured,
    output_schema,
)
from .fencing import DataBlock, data_instruction, fence_blocks
from .findings import ModelOutput, normalize_ws, verify_findings
from .hedges import dropped_hedges
from .rules import Rules, RulesError, parse_rules

PROMPT_VERSION = "quality-v1"
HEDGE_RULE = "dropped-hedge"
INPUT_INVALID = "input_invalid"
RULES_INVALID = "rules_invalid"


class QualityError(Exception):
    """The run cannot be done with this input (``input_invalid`` / ``rules_invalid``)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message[:500]


SYSTEM = """You review a proposed change to a page of a reviewed Markdown wiki against the quality \
rules below. Report only real problems the rules name; most good changes have no finding.

For each finding give:
- rule: one of these rule ids: {rule_ids}
- severity: "blocking" when the rule says to reject or request revision and the case is clear, \
"warning" when a reviewer should look, "info" for minor issues
- message: what is wrong and why, in one or two sentences
- quote: the exact text, copied character for character from ONE data block, and that block's id. \
Quote the proposed text (block "proposed") for what the change adds; quote the base page (block \
"base") for what it removes. Keep quotes short: the sentence or phrase at issue.

Return {{"findings": []}} when no rule applies.

<rules sha256="{sha}">
{rules}
</rules>

{data}"""

TASK = (
    "Check the proposed change to `{path}`{section} against the rules. The \"proposed\" block "
    "is the whole proposed file; \"base\" is the page before the change (absent for a new "
    "page); \"title\" and \"reason\" are the author's own description; \"source-N\" blocks "
    "are the sources the author declared."
)


def load_input_rules(job: QualityCheckInput) -> Rules:
    """Rules from the input's text; the API's hash must cover exactly these bytes (D-132)."""
    raw = job.rules.text.encode("utf-8")
    if hashlib.sha256(raw).hexdigest() != job.rules.sha256:
        raise QualityError(INPUT_INVALID, "rules text does not match its sha256")
    try:
        return parse_rules(raw)
    except RulesError as exc:
        raise QualityError(RULES_INVALID, str(exc)) from exc


def build_request(
    job: QualityCheckInput, rules: Rules, nonce: str | None = None
) -> tuple[StructuredRequest, dict[str, str]]:
    """The fenced request and the blocks it carries (``{id: text}``)."""
    blocks = [DataBlock(b.id, b.kind.value, b.text) for b in job.blocks]
    try:
        fenced, nonce = fence_blocks(blocks, nonce)
    except ValueError as exc:
        raise QualityError(INPUT_INVALID, f"blocks cannot be fenced: {exc}") from exc
    system = SYSTEM.format(
        rule_ids=", ".join(r.id for r in rules.rules),
        sha=rules.sha256,
        rules=rules.text.strip(),
        data=data_instruction(nonce),
    )
    section = f" (section `{job.subject.section}`)" if job.subject.section else ""
    user = f"{TASK.format(path=job.subject.target_path, section=section)}\n\n{fenced}\n"
    request = StructuredRequest(
        system=system, user=user, schema=output_schema(ModelOutput), schema_name="quality_findings"
    )
    return request, {b.id: b.content for b in blocks}


def hedge_findings(blocks: Sequence[QualityBlock]) -> list[QualityFinding]:
    """Dropped-hedge candidates (§7.3): proposed vs base and each source, best match once."""
    proposed = next((b for b in blocks if b.id == "proposed"), None)
    if proposed is None:
        return []
    best: dict[str, tuple[float, str, str, tuple[str, ...]]] = {}
    order: list[str] = []
    for original in blocks:
        if original.kind.value not in ("base", "source"):
            continue
        for hit in dropped_hedges(original.text, proposed.text):
            if hit.derived not in best:
                order.append(hit.derived)
            if hit.derived not in best or hit.similarity > best[hit.derived][0]:
                best[hit.derived] = (hit.similarity, original.id, hit.original, hit.hedges)
    out = []
    for derived in order:
        _, block, text, hedges = best[derived]
        words = ", ".join(f'"{h}"' for h in hedges)
        out.append(
            QualityFinding(
                rule=HEDGE_RULE,
                severity=FindingSeverity.warning,
                message=f"Restates a sentence of {block} without {words}.",
                quote=QuoteRef(block="proposed", text=derived[:4000]),
                origin=FindingOrigin.rule,
                original=QuoteRef(block=block, text=text[:4000]),
            )
        )
    return out


@dataclass(frozen=True)
class CheckResult:
    output: QualityCheckOutput
    rules: Rules


async def run_check(
    job: QualityCheckInput, provider: Provider, config: ModelConfig, *, nonce: str | None = None
) -> CheckResult:
    """One quality check. Raises QualityError or ProviderError (with its job error code)."""
    rules = load_input_rules(job)
    request, blocks = build_request(job, rules, nonce)
    parsed, result = await complete_structured(
        provider, request, ModelOutput, max_attempts=config.max_attempts
    )
    verified = verify_findings(parsed.findings, blocks, rules.ids)
    findings = [
        QualityFinding(
            rule=f.rule,
            severity=FindingSeverity(f.severity),
            message=(" ".join(f.message.split()) or f.rule)[:2000],
            quote=QuoteRef(block=f.quote.block, text=normalize_ws(f.quote.text)[:4000]),
            origin=FindingOrigin.model,
            original=None,
        )
        for f in verified.kept
    ]
    if HEDGE_RULE in rules.ids:
        seen = {(f.rule, f.quote.block, f.quote.text) for f in findings}
        for h in hedge_findings(job.blocks):
            if (h.rule, h.quote.block, h.quote.text) not in seen:
                findings.append(h)
    output = QualityCheckOutput(
        promptVersion=PROMPT_VERSION,
        provider=result.provider[:40],
        model=result.model[:200] or config.model,
        rulesSha256=rules.sha256,
        usage=QualityUsage(
            inputTokens=max(0, result.usage.get("input_tokens", 0)),
            outputTokens=max(0, result.usage.get("output_tokens", 0)),
        ),
        findings=findings[:200],
        dropped=QualityDropped(
            unknownRule=verified.dropped["unknown_rule"],
            unknownBlock=verified.dropped["unknown_block"],
            emptyQuote=verified.dropped["empty_quote"],
            quoteNotFound=verified.dropped["quote_not_found"],
        ),
    )
    return CheckResult(output=output, rules=rules)
