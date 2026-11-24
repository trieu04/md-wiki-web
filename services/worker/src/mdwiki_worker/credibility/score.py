"""``credibility_score``: the §7.7.11 shadow score, a port of ``domain/credibility-score.ts``.

The shared cases in ``packages/contracts/jobs/fixtures/credibility_score.cases.json`` pin both
implementations to the same output (D-231).
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import ValidationError

from ..contracts.credibility_score_input_schema import CredibilityScoreInput
from ..contracts.credibility_score_output_schema import CredibilityScoreOutput
from .common import failed, fetch_input, ok, post_result

KIND = "credibility_score"
MODEL_VERSION = "score-v1"
Z10 = 1.2815515655446004

Json = dict[str, Any]


@dataclass
class _Ev:
    r: float = 0.0
    s: float = 0.0


def _opinion(e: _Ev, p: Json) -> tuple[float, float, float, float]:
    total = e.r + e.s + p["weight"]
    b = e.r / total
    d = e.s / total
    u = p["weight"] / total
    return b, d, u, b + p["baseRate"] * u


def _roots(node: Json, retracted: set[str]) -> list[str]:
    return sorted(
        {
            c["sourceRef"]
            for c in node["sourceChecks"]
            if c["sectionHash"] == node["currentHash"]
            and c["result"] == "supported"
            and c["sourceRef"] not in retracted
        }
    )


def own_evidence(node: Json, retracted: set[str], p: Json) -> _Ev:
    h = node["currentHash"]
    r = 0.0
    s = 0.0
    if any(x["sectionHash"] == h for x in node["reviews"]):
        r += 1
    by_ref: dict[str, float] = {}
    for c in node["sourceChecks"]:
        if c["sectionHash"] != h or c["sourceRef"] in retracted:
            continue
        w = 1.0 if c["checkerKind"] == "person" else p["agentWeight"]
        if c["result"] == "supported":
            by_ref[c["sourceRef"]] = max(by_ref.get(c["sourceRef"], 0.0), w)
        if c["result"] == "not_supported":
            s += 3 * w
    for w in by_ref.values():
        r += 2 * w
    if any(x["sectionHash"] == h for x in node["ownerConfirmations"]):
        r += 3
    s += 3 * sum(1 for x in node["errors"] if x["sectionHash"] == h)
    teams: dict[str, float] = {}
    for a in node["attestations"]:
        if a["sectionHash"] != h or a["kind"] == "useful":
            continue
        teams[a["team"]] = (
            teams.get(a["team"], 0.0) + (0.5 if a["kind"] == "used" else 1) * a["weight"]
        )
    if len(teams) >= 2:
        effective = sum(math.sqrt(w) for w in teams.values())
        r += min(1.5, 0.5 * effective) * p["attestationWeight"]
    return _Ev(r, s)


def _descendants(roots: list[str], edges: list[Json]) -> set[str]:
    seen = set(roots)
    out: set[str] = set()
    frontier = list(roots)
    while frontier:
        nxt: list[str] = []
        for frm in frontier:
            for e in edges:
                if e["from"] == frm and e["to"] not in seen:
                    seen.add(e["to"])
                    out.add(e["to"])
                    nxt.append(e["to"])
        frontier = nxt
    return out


def lower10(r: float, s: float, prob: float, p: Json) -> float:
    alpha = r + p["baseRate"] * p["weight"]
    beta = s + (1 - p["baseRate"]) * p["weight"]
    n = alpha + beta
    variance = (alpha * beta) / (n * n * (n + 1))
    return min(1.0, max(0.0, prob - Z10 * math.sqrt(variance)))


def _round6(x: float) -> float:
    # Same as JS Math.round(x * 1e6) / 1e6 (round half up, not banker's rounding).
    return math.floor(x * 1e6 + 0.5) / 1e6


def score_items(graph: Json, p: Json) -> list[Json]:
    retracted = set(graph["retractedRefs"])
    nodes: list[Json] = graph["nodes"]
    own = {n["key"]: own_evidence(n, retracted, p) for n in nodes}

    def p_own(key: str) -> float:
        return _opinion(own.get(key, _Ev()), p)[3]

    roots = {n["key"]: _roots(n, retracted) for n in nodes}
    total = {k: _Ev(e.r, e.s) for k, e in own.items()}
    received = {n["key"]: _Ev() for n in nodes}

    for c in graph["corroborations"]:
        ra, rb = roots.get(c["a"], []), roots.get(c["b"], [])
        if not ra or not rb or any(x in rb for x in ra):
            continue
        ea, eb = total.get(c["a"]), total.get(c["b"])
        if ea:
            ea.r += 2 * p_own(c["b"])
        if eb:
            eb.r += 2 * p_own(c["a"])
    for dv in graph["derivations"]:
        sb, sd, _su, _sp = _opinion(own.get(dv["from"], _Ev()), p)
        t = p_own(dv["from"])
        b = t * sb
        d = t * sd
        u = 1 - b - d
        add_r = (p["weight"] * b) / u
        add_s = (p["weight"] * d) / u
        target, got = total.get(dv["to"]), received.get(dv["to"])
        if target and got:
            target.r += add_r
            target.s += add_s
            got.r += add_r
            got.s += add_s
    for c in graph["contradictions"]:
        a, b_ = c["a"], c["b"]
        ga, gb = len(roots.get(a, [])), len(roots.get(b_, []))
        shared = any(x in roots.get(b_, []) for x in roots.get(a, []))
        pa, pb = p_own(a), p_own(b_)
        ea, eb = total.get(a), total.get(b_)
        if not ea or not eb:
            continue
        strong_a = not shared and (ga > gb or pa - pb >= p["delta"])
        strong_b = not shared and (gb > ga or pb - pa >= p["delta"])
        if strong_a and not strong_b:
            ea.r *= 0.9
            ea.s *= 0.9
            eb.s += p["k"] * pa
        elif strong_b and not strong_a:
            eb.r *= 0.9
            eb.s *= 0.9
            ea.s += p["k"] * pb
        else:
            for e in (ea, eb):
                e.r *= 0.5
                e.s *= 0.5
    source_roots = [
        n["key"]
        for n in nodes
        if n["key"] in graph["wrongRoots"]
        or any(
            c["sectionHash"] == n["currentHash"] and c["sourceRef"] in retracted
            for c in n["sourceChecks"]
        )
    ]
    flagged = set(source_roots) | _descendants(source_roots, graph["derivations"])
    reach: dict[str, int] = {}
    for link in graph["links"]:
        reach[link["to"]] = reach.get(link["to"], 0) + 1

    # Later duplicate keys win, as in the reference Map.
    by_key = {n["key"]: n for n in nodes}
    items: list[Json] = []
    for key in sorted(by_key):
        e = total.get(key, _Ev())
        _b, _d, u, prob = _opinion(e, p)
        items.append(
            {
                "key": key,
                "p": _round6(prob),
                "lower10": _round6(lower10(e.r, e.s, prob, p)),
                "u": _round6(u),
                "r": _round6(e.r),
                "s": _round6(e.s),
                "flagged": key in flagged,
                "reach": reach.get(key, 0),
            }
        )
    return items


def params_sha256(params: Json) -> str:
    # Numbers as floats so 2 and 2.0 hash alike.
    canonical = json.dumps(
        {k: float(v) for k, v in params.items()}, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def compute(data: CredibilityScoreInput) -> CredibilityScoreOutput:
    raw = data.model_dump(mode="json", by_alias=True)
    items = score_items(raw["graph"], raw["params"])
    return CredibilityScoreOutput.model_validate(
        {
            "modelVersion": MODEL_VERSION,
            "paramsSha256": params_sha256(raw["params"]),
            "scores": items,
        }
    )


async def process_credibility_score(
    api: httpx.AsyncClient,
    name: str,
    job_id: str | None,
    data: object,
    _deps: Callable[[], object] | None = None,
) -> None:
    claimed = await fetch_input(api, name, job_id, data)
    if claimed is None:
        return
    path, raw = claimed
    try:
        parsed = CredibilityScoreInput.model_validate(raw)
    except ValidationError as error:
        await post_result(api, path, failed("input_invalid", str(error)))
        return
    try:
        result = ok(compute(parsed))
    except (ValueError, ZeroDivisionError) as error:
        await post_result(api, path, failed("worker_error", str(error)))
        return
    await post_result(api, path, result)
