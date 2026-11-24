"""Phase 9b credibility jobs: score parity, retraction lookup, copy and relation candidates."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from mdwiki_worker.credibility import copies, relations, retraction, score

CASES = Path(__file__).resolve().parents[3] / "packages/contracts/jobs/fixtures"
JOB_ID = "019ac174-1da5-738a-a8c2-2f50343a60b1"
H = "a" * 64
PARAMS = {
    "baseRate": 0.8,
    "weight": 2,
    "agentWeight": 0,
    "attestationWeight": 0,
    "delta": 0.05,
    "k": 1,
}


def internal(
    kind: str, job_input: object, posted: list[Any], status: int = 200
) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            if status != 200:
                return httpx.Response(status)
            return httpx.Response(200, json={"jobId": JOB_ID, "kind": kind, "input": job_input})
        posted.append(json.loads(request.content))
        return httpx.Response(204)

    return httpx.AsyncClient(
        base_url="http://internal/internal/v1/", transport=httpx.MockTransport(handler)
    )


def envelope(kind: str) -> dict[str, Any]:
    return {"v": 1, "jobId": JOB_ID, "kind": kind}


# ---- credibility_score ---------------------------------------------------------------------


def shared_cases() -> list[dict[str, Any]]:
    data = json.loads((CASES / "credibility_score.cases.json").read_text())
    assert data["modelVersion"] == score.MODEL_VERSION
    cases: list[dict[str, Any]] = data["cases"]
    return cases


@pytest.mark.parametrize("case", shared_cases(), ids=lambda c: c["name"])
def test_score_matches_the_typescript_reference(case: dict[str, Any]) -> None:
    assert score.score_items(case["graph"], case["params"]) == case["expected"]


def test_score_job_posts_items_and_params_hash() -> None:
    case = shared_cases()[1]
    posted: list[Any] = []

    async def run() -> None:
        async with internal(
            score.KIND,
            {"params": case["params"], "graph": case["graph"], "trigger": "daily"},
            posted,
        ) as api:
            await score.process_credibility_score(api, score.KIND, JOB_ID, envelope(score.KIND))

    asyncio.run(run())
    out = posted[0]["output"]
    assert posted[0]["status"] == "ok"
    assert out["modelVersion"] == "score-v1"
    assert out["paramsSha256"] == score.params_sha256(case["params"])
    assert out["scores"] == case["expected"]


def test_score_job_rejects_bad_input_and_skips_finished_jobs() -> None:
    posted: list[Any] = []

    async def run(status: int) -> None:
        async with internal(score.KIND, {"params": PARAMS}, posted, status) as api:
            await score.process_credibility_score(api, score.KIND, JOB_ID, envelope(score.KIND))

    asyncio.run(run(200))
    assert posted[0]["error"]["code"] == "input_invalid"
    asyncio.run(run(409))
    assert len(posted) == 1


# ---- retraction_check ----------------------------------------------------------------------


def crossref_item(target: str, kind: str, source: str = "publisher") -> dict[str, Any]:
    return {
        "DOI": "10.9/NOTICE",
        "update-to": [
            {
                "DOI": target,
                "type": kind,
                "source": source,
                "updated": {"date-time": "2025-03-01T00:00:00Z"},
            }
        ],
    }


def test_hits_from_crossref_maps_types_and_sources() -> None:
    payload = {
        "message": {
            "items": [
                crossref_item("10.1/ABC", "expression_of_concern"),
                crossref_item("10.1/abc", "retraction", "retraction-watch"),
                crossref_item("10.1/abc", "correction"),
                crossref_item("10.1/other", "retraction"),
            ]
        }
    }
    assert retraction.hits_from_crossref("doi:10.1/abc", payload) == [
        {
            "ref": "doi:10.1/abc",
            "kind": "retraction",
            "detail": "Retraction notice 10.9/NOTICE (2025-03-01)",
            "source": "retraction_watch",
            "noticeDoi": "10.9/notice",
        }
    ]
    assert retraction.hits_from_crossref("doi:10.1/abc", {"message": {"items": []}}) == []
    assert retraction.hits_from_crossref("doi:10.1/abc", "junk") == []


def crossref(responses: dict[str, httpx.Response]) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "@" not in request.headers["user-agent"]  # no contact details are sent
        doi = request.url.params["filter"].removeprefix("updates:")
        return responses.get(doi, httpx.Response(200, json={"message": {"items": []}}))

    return httpx.AsyncClient(base_url=retraction.CROSSREF, transport=httpx.MockTransport(handler))


def test_retraction_job_counts_only_answered_lookups() -> None:
    posted: list[Any] = []
    responses = {
        "10.1000/r": httpx.Response(
            200, json={"message": {"items": [crossref_item("10.1000/r", "retraction")]}}
        ),
        "10.1000/down": httpx.Response(503),
    }

    async def run() -> None:
        async with internal(
            retraction.KIND,
            {
                "refs": ["doi:10.1000/r", "doi:10.1000/ok", "doi:10.1000/down", "doi:10.1000/r"],
                "trigger": "manual",
            },
            posted,
        ) as api:
            await retraction.process_retraction_check(
                api, retraction.KIND, JOB_ID, envelope(retraction.KIND), lambda: crossref(responses)
            )

    asyncio.run(run())
    out = posted[0]["output"]
    assert out["checked"] == 2
    assert [(h["ref"], h["kind"]) for h in out["hits"]] == [("doi:10.1000/r", "retraction")]


def test_retraction_job_fails_when_crossref_is_unreachable() -> None:
    posted: list[Any] = []
    down = {"10.1000/a": httpx.Response(500)}

    async def run() -> None:
        async with internal(
            retraction.KIND, {"refs": ["doi:10.1000/a"], "trigger": "weekly"}, posted
        ) as api:
            await retraction.process_retraction_check(
                api, retraction.KIND, JOB_ID, envelope(retraction.KIND), lambda: crossref(down)
            )

    asyncio.run(run())
    assert posted[0]["error"]["code"] == "source_unavailable"


# ---- copy_candidates / relation_candidates ------------------------------------------------

BASE_TEXT = (
    "Set the pinhole to 1 Airy unit for confocal imaging with the 63x oil objective. "
    "Larger pinholes collect more light but reduce optical sectioning, which matters for "
    "thick specimens such as organoids mounted in glycerol."
)


def section(path: str, anchor: str, text: str, at: str) -> dict[str, Any]:
    return {"path": path, "anchor": anchor, "sectionHash": H, "text": text, "updatedAt": at}


def test_copies_point_from_the_older_section_to_the_newer() -> None:
    sections = [
        section("b.md", "pinhole", BASE_TEXT + " Use lens paper.", "2026-11-02T00:00:00Z"),
        section("a.md", "pinhole", BASE_TEXT, "2026-11-01T00:00:00Z"),
        section("a.md", "other", BASE_TEXT, "2026-11-01T00:00:00Z"),  # same page: ignored
        section(
            "c.md", "lasers", "Class 4 lasers need interlocks and goggles.", "2026-11-01T00:00:00Z"
        ),
    ]
    found = copies.find_copies(sections, 0.5)
    assert [(c["src"]["path"], c["dst"]["path"]) for c in found] == [
        ("a.md", "b.md"),
        ("a.md", "b.md"),
    ]
    assert all(c["kind"] == "copy" and 0.5 <= c["score"] <= 1 for c in found)
    assert copies.find_copies(sections, 0.99) == []


def test_relations_mark_number_and_negation_conflicts() -> None:
    sections = [
        section(
            "a.md", "na", "The objective has a numerical aperture of 1.4 NA for oil imaging.", "x"
        ),
        section(
            "b.md", "na", "The objective has a numerical aperture of 1.2 NA for oil imaging.", "x"
        ),
        section(
            "c.md",
            "na",
            "The objective has a numerical aperture of 1.4 NA for oil imaging work.",
            "x",
        ),
        section(
            "d.md",
            "glycerol",
            "Glycerol mounting is not suitable for oil objectives in imaging.",
            "x",
        ),
        section(
            "e.md", "glycerol", "Glycerol mounting is suitable for oil objectives in imaging.", "x"
        ),
    ]
    found = relations.find_relations(sections, 3)
    by_pair = {(c["src"]["path"], c["dst"]["path"]): c for c in found}
    assert by_pair[("a.md", "b.md")]["kind"] == "contradicts"
    assert by_pair[("a.md", "b.md")]["detail"]["rule"] == "number"
    assert by_pair[("a.md", "c.md")]["kind"] == "corroborates"
    assert by_pair[("d.md", "e.md")]["kind"] == "contradicts"
    assert found[0]["kind"] == "contradicts"


def test_candidate_jobs_post_valid_outputs() -> None:
    posted: list[Any] = []
    sections = [
        section("a.md", "x", BASE_TEXT, "2026-11-01T00:00:00Z"),
        section("b.md", "x", BASE_TEXT, "2026-11-02T00:00:00Z"),
    ]

    async def run() -> None:
        async with internal(
            copies.KIND, {"sections": sections, "threshold": 0.6, "trigger": "daily"}, posted
        ) as api:
            await copies.process_copy_candidates(api, copies.KIND, JOB_ID, envelope(copies.KIND))
        async with internal(
            relations.KIND, {"sections": sections, "topK": 20, "trigger": "daily"}, posted
        ) as api:
            await relations.process_relation_candidates(
                api, relations.KIND, JOB_ID, envelope(relations.KIND)
            )

    asyncio.run(run())
    assert posted[0]["output"]["candidates"][0]["kind"] == "copy"
    assert posted[1]["output"]["candidates"][0]["kind"] == "corroborates"
