"""The quality_check job and the offline scorer with a scripted provider (no network)."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from mdwiki_worker.cli import DEFAULT_RULES, main
from mdwiki_worker.providers import (
    PROVIDER_TIMEOUT,
    FakeProvider,
    ModelConfig,
    ProviderError,
    Step,
)
from mdwiki_worker.quality import parse_rules
from mdwiki_worker.quality.eval import E3_CLASS_RULES, evaluate, load_dataset
from mdwiki_worker.quality.job import process_quality_check

JOB_ID = "019ac174-1da5-738a-a8c2-2f50343a60a3"
ENVELOPE = {"v": 1, "jobId": JOB_ID, "kind": "quality_check"}
PATH = f"/internal/v1/jobs/{JOB_ID}"
RULES_RAW = DEFAULT_RULES.read_bytes()
RULES_TEXT = RULES_RAW.decode("utf-8")
RULES_SHA = hashlib.sha256(RULES_RAW).hexdigest()
BASE = "# Lens\n\nThe lens may resolve 200 nm in vitro.\n"
PROPOSED = "# Lens\n\nThe lens resolves 200 nm in vitro.\n\nIt is the best lens ever made.\n"
CONFIG = ModelConfig(provider="fake", model="fake-model", max_attempts=2)


def job_input(**over: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "subject": {
            "kind": "proposal",
            "id": "019ac174-1da5-738a-a8c2-2f50343a60a4",
            "slug": "lens",
            "targetPath": "lens.md",
            "section": None,
        },
        "bundleHash": "a" * 64,
        "blocks": [
            {"id": "reason", "kind": "proposal", "label": "Reason", "text": "Tighten wording"},
            {"id": "proposed", "kind": "proposal", "label": "lens.md", "text": PROPOSED},
            {"id": "base", "kind": "base", "label": "lens.md@v1", "text": BASE},
        ],
        "rules": {"path": "rules/quality.md", "sha256": RULES_SHA, "text": RULES_TEXT},
    }
    data.update(over)
    return data


def finding(**over: Any) -> dict[str, Any]:
    return {
        "rule": "promotional-language",
        "severity": "warning",
        "message": "Peacock   wording.",
        "quote": {"block": "proposed", "text": "the best  lens ever made"},
        **over,
    }


def run_job(
    script: list[Step], payload: object | None = None, status: int = 200
) -> tuple[list[dict[str, Any]], FakeProvider]:
    posted: list[dict[str, Any]] = []
    provider = FakeProvider(script)

    def handle(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            assert request.url.path == f"{PATH}/input"
            if status != 200:
                return httpx.Response(status)
            body = payload if payload is not None else job_input()
            return httpx.Response(
                200, json={"jobId": JOB_ID, "kind": "quality_check", "input": body}
            )
        assert request.url.path == f"{PATH}/result"
        posted.append(json.loads(request.content))
        return httpx.Response(204)

    async def go() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handle), base_url="http://internal/internal/v1"
        ) as api:
            await process_quality_check(
                api, "quality_check", JOB_ID, ENVELOPE, lambda: (provider, CONFIG)
            )

    asyncio.run(go())
    return posted, provider


def test_real_rules_file_parses_with_the_contract_ids() -> None:
    ids = [r.id for r in parse_rules(RULES_RAW).rules]
    assert ids[0] == "unsourced-claim" and "dropped-hedge" in ids
    for rules in E3_CLASS_RULES.values():
        assert set(rules or []) <= set(ids)


def test_success_keeps_verified_findings_adds_hedges_and_fences_the_data() -> None:
    script: list[Step] = [
        {
            "findings": [
                finding(),
                finding(quote={"block": "proposed", "text": "resolves 50 nm"}),
                finding(rule="no-such-rule"),
                finding(quote={"block": "nowhere", "text": "best"}),
            ]
        }
    ]
    posted, provider = run_job(script)
    [result] = posted
    assert result["status"] == "ok"
    out = result["output"]
    assert out["promptVersion"] == "quality-v1"
    assert (out["provider"], out["model"], out["rulesSha256"]) == ("fake", "fake-model", RULES_SHA)
    assert out["dropped"] == {
        "unknownRule": 1,
        "unknownBlock": 1,
        "emptyQuote": 0,
        "quoteNotFound": 1,
    }
    first, hedge = out["findings"]
    assert first == {
        "rule": "promotional-language",
        "severity": "warning",
        "message": "Peacock wording.",
        "quote": {"block": "proposed", "text": "the best lens ever made"},
        "origin": "model",
        "original": None,
    }
    assert hedge["rule"] == "dropped-hedge" and hedge["origin"] == "rule"
    assert hedge["quote"]["text"] == "The lens resolves 200 nm in vitro."
    assert hedge["original"] == {"block": "base", "text": "The lens may resolve 200 nm in vitro."}
    [request] = provider.requests
    assert "dropped-hedge" in request.system and RULES_SHA in request.system
    assert 'id="proposed"' in request.user and "Tighten wording" in request.user


def test_schema_failure_posts_schema_invalid() -> None:
    # Output that does not match the schema is not retried (D-71); invalid JSON likewise.
    posted, provider = run_job([{"findings": [{"rule": 1}]}])
    assert posted == [
        {
            "status": "failed",
            "error": {"code": "schema_invalid", "message": posted[0]["error"]["message"]},
        }
    ]
    assert len(provider.requests) == 1
    posted, _ = run_job(["not json"])
    assert posted[0]["error"]["code"] == "schema_invalid"


def test_provider_error_is_posted_with_its_code() -> None:
    posted, _ = run_job([ProviderError(PROVIDER_TIMEOUT, "timed out", retryable=False)])
    assert posted[0]["error"]["code"] == "provider_timeout"


def test_invented_quotes_only_yields_no_model_findings() -> None:
    clean = job_input(
        blocks=[{"id": "proposed", "kind": "proposal", "label": "x.md", "text": "Hello world.\n"}]
    )
    posted, _ = run_job(
        [{"findings": [finding(quote={"block": "proposed", "text": "Goodbye"})]}], clean
    )
    out = posted[0]["output"]
    assert out["findings"] == [] and out["dropped"]["quoteNotFound"] == 1


def test_rules_hash_mismatch_and_bad_rules_fail_without_calling_the_model() -> None:
    bad_sha = job_input(rules={"path": "r.md", "sha256": "b" * 64, "text": RULES_TEXT})
    posted, provider = run_job([], bad_sha)
    assert posted[0]["error"]["code"] == "input_invalid" and provider.requests == []
    text = "# Rules\n\nno headings\n"
    sha = hashlib.sha256(text.encode()).hexdigest()
    posted, _ = run_job([], job_input(rules={"path": "r.md", "sha256": sha, "text": text}))
    assert posted[0]["error"]["code"] == "rules_invalid"


def test_schema_invalid_input_and_missing_key_fail_the_run() -> None:
    posted, _ = run_job([], {"subject": {}})
    assert posted[0]["error"]["code"] == "input_invalid"

    def no_key() -> tuple[FakeProvider, ModelConfig]:
        raise ValueError("anthropic provider needs ANTHROPIC_API_KEY")

    seen: list[dict[str, Any]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200, json={"jobId": JOB_ID, "kind": "quality_check", "input": job_input()}
            )
        seen.append(json.loads(request.content))
        return httpx.Response(204)

    async def go() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handle), base_url="http://internal/internal/v1"
        ) as api:
            await process_quality_check(api, "quality_check", JOB_ID, ENVELOPE, no_key)

    asyncio.run(go())
    assert seen[0]["error"]["code"] == "provider_error"
    assert "ANTHROPIC_API_KEY" in seen[0]["error"]["message"]


def test_finished_job_is_skipped_and_a_server_error_propagates() -> None:
    posted, provider = run_job([], status=409)
    assert posted == [] and provider.requests == []
    with pytest.raises(httpx.HTTPStatusError):
        run_job([], status=503)


def test_envelope_must_match_the_job() -> None:
    async def go() -> None:
        async with httpx.AsyncClient(base_url="http://internal") as api:
            await process_quality_check(
                api,
                "ping",
                JOB_ID,
                {**ENVELOPE, "kind": "ping"},
                lambda: (FakeProvider([]), CONFIG),
            )

    with pytest.raises(ValueError):
        asyncio.run(go())


# Offline scorer (§7.6.8)


def dataset() -> list[str]:
    return [
        json.dumps(
            {"id": "a", "reason": "r", "base": BASE, "proposed": PROPOSED, "class": "promotional"}
        ),
        "",
        json.dumps({"id": "b", "reason": "r", "base": None, "proposed": "Fine.\n", "expected": []}),
        json.dumps(
            {"id": "c", "reason": "r", "base": None, "proposed": "Nice.\n", "class": "real_clean"}
        ),
        json.dumps(
            {"id": "d", "reason": "r", "base": None, "proposed": "Old.\n", "class": "real_reverted"}
        ),
    ]


def test_scorer_reports_precision_recall_and_item_detection() -> None:
    items = load_dataset(dataset())
    provider = FakeProvider(
        [
            {"findings": [finding()]},
            {"findings": []},
            {
                "findings": [
                    finding(rule="vague-wording", quote={"block": "proposed", "text": "Nice."})
                ]
            },
            ProviderError(PROVIDER_TIMEOUT, "timed out"),
        ]
    )
    report = asyncio.run(evaluate(items, RULES_RAW, provider, CONFIG))
    assert report["rules"]["promotional-language"] == {
        "tp": 1,
        "fp": 0,
        "fn": 0,
        "precision": 1.0,
        "recall": 1.0,
    }
    assert report["rules"]["vague-wording"]["fp"] == 1
    assert report["rules"]["vague-wording"]["recall"] is None
    # The hedge rule fires on item a too, though not expected: a false positive.
    assert report["rules"]["dropped-hedge"]["fp"] == 1
    assert report["items"] == {
        "total": 4,
        "bad": 1,
        "clean": 2,
        "caught": 1,
        "falseAlarms": 1,
        "detection": 1.0,
        "falseAlarmRate": 0.5,
        "errors": 1,
    }
    assert report["details"][3]["error"].startswith("provider_timeout")
    assert report["rulesSha256"] == RULES_SHA


def test_dataset_errors_name_the_line() -> None:
    with pytest.raises(ValueError, match="line 2"):
        load_dataset(['{"id":"a","proposed":"x","expected":[]}', '{"id":"b","proposed":"x"}'])
    with pytest.raises(ValueError, match="line 1"):
        load_dataset(['{"id":"a","proposed":"x","class":"nope"}'])


def test_cli_runs_the_scorer_with_the_fake_provider(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    data = tmp_path / "set.jsonl"
    data.write_text(dataset()[2] + "\n", encoding="utf-8")
    out = tmp_path / "report.json"
    monkeypatch.setenv("AI_DEFAULT__PROVIDER", "fake")
    # The fake provider from settings has an empty script: the item errors, the run succeeds.
    assert main(["eval", str(data), "--out", str(out)]) == 0
    report = json.loads(out.read_text())
    assert report["items"]["errors"] == 1
    assert "rule" in capsys.readouterr().out
    assert main(["eval", str(tmp_path / "missing.jsonl")]) == 2
