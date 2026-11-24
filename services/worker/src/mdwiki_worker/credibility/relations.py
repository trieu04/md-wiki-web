"""``relation_candidates``: sections that may corroborate or contradict each other (D-233).

TF-IDF cosine stands in for the embedding (top-K neighbours per section, other pages only);
the re-ranker is a rule: the same quantity with a different number, or a negation on one side
only, marks ``contradicts``; otherwise a close neighbour is ``corroborates``. No model is called.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Callable
from typing import Any

import httpx
from pydantic import ValidationError

from ..contracts.relation_candidates_input_schema import RelationCandidatesInput
from ..contracts.relation_candidates_output_schema import RelationCandidatesOutput
from .common import failed, fetch_input, ok, post_result
from .text import content_words, negations, numbers_with_context, words

KIND = "relation_candidates"
MIN_SIMILARITY = 0.3
MAX_CANDIDATES = 1000


def vectors(texts: list[str]) -> list[dict[str, float]]:
    docs = [Counter(content_words(t)) for t in texts]
    df: Counter[str] = Counter()
    for d in docs:
        df.update(d.keys())
    n = len(docs)
    out: list[dict[str, float]] = []
    for d in docs:
        v = {t: (1 + math.log(c)) * (math.log((1 + n) / (1 + df[t])) + 1) for t, c in d.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        out.append({t: x / norm for t, x in v.items() if x > 0})
    return out


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(x * b.get(t, 0.0) for t, x in a.items())


def classify(a: str, b: str) -> tuple[str, dict[str, str | int]]:
    ta, tb = words(a), words(b)
    na, nb = numbers_with_context(ta), numbers_with_context(tb)
    for unit in sorted(set(na) & set(nb)):
        if na[unit] != nb[unit]:
            return "contradicts", {"rule": "number", "unit": unit, "a": na[unit], "b": nb[unit]}
    ga, gb = negations(ta), negations(tb)
    if (ga == 0) != (gb == 0):
        return "contradicts", {"rule": "negation", "a": ga, "b": gb}
    return "corroborates", {"rule": "similar"}


def find_relations(sections: list[dict[str, Any]], top_k: int) -> list[dict[str, Any]]:
    vs = vectors([s["text"] for s in sections])
    seen: set[tuple[int, int]] = set()
    out: list[dict[str, Any]] = []
    for i, v in enumerate(vs):
        near = sorted(
            (
                (cosine(v, vs[j]), j)
                for j in range(len(vs))
                if j != i and sections[j]["path"] != sections[i]["path"]
            ),
            reverse=True,
        )[:top_k]
        for sim, j in near:
            pair = (min(i, j), max(i, j))
            if sim < MIN_SIMILARITY or pair in seen:
                continue
            seen.add(pair)
            a, b = sections[pair[0]], sections[pair[1]]
            kind, detail = classify(a["text"], b["text"])
            out.append(
                {
                    "kind": kind,
                    "src": {"path": a["path"], "anchor": a["anchor"]},
                    "dst": {"path": b["path"], "anchor": b["anchor"]},
                    "score": round(min(1.0, sim), 4),
                    "detail": {**detail, "similarity": round(sim, 4)},
                }
            )
    out.sort(key=lambda c: (c["kind"] != "contradicts", -c["score"], c["src"]["path"]))
    return out[:MAX_CANDIDATES]


async def process_relation_candidates(
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
        parsed = RelationCandidatesInput.model_validate(raw)
    except ValidationError as error:
        await post_result(api, path, failed("input_invalid", str(error)))
        return
    dumped = parsed.model_dump(mode="json", by_alias=True)
    found = find_relations(dumped["sections"], dumped["topK"])
    await post_result(api, path, ok(RelationCandidatesOutput.model_validate({"candidates": found})))
