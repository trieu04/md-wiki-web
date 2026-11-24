"""``copy_candidates``: near-duplicate sections (system-logic §7.7.12, D-233).

MinHash over word 5-shingles with LSH banding finds pairs; the score is the exact shingle
Jaccard plus a bonus for shared rare values (numbers and words found in ≤ 2 sections). The older
section (``updatedAt``) is the source, the newer one the copy. Candidates never change a label.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Callable
from typing import Any

import httpx
from pydantic import ValidationError

from ..contracts.copy_candidates_input_schema import CopyCandidatesInput
from ..contracts.copy_candidates_output_schema import CopyCandidatesOutput
from .common import failed, fetch_input, ok, post_result
from .text import is_number, words

KIND = "copy_candidates"
SHINGLE = 5
PERMUTATIONS = 64
BANDS = 16  # 4 rows per band: pairs with Jaccard ≳ 0.5 almost always collide
MAX_CANDIDATES = 1000
_MASK = (1 << 61) - 1


def shingles(text: str) -> set[str]:
    tokens = words(text)
    if len(tokens) < SHINGLE:
        return {" ".join(tokens)} if tokens else set()
    return {" ".join(tokens[i : i + SHINGLE]) for i in range(len(tokens) - SHINGLE + 1)}


def _h(value: str, seed: int) -> int:
    digest = hashlib.blake2b(value.encode(), digest_size=8, salt=seed.to_bytes(8, "big")).digest()
    return int.from_bytes(digest, "big") & _MASK


def signature(items: set[str]) -> list[int]:
    return [min((_h(s, seed) for s in items), default=_MASK) for seed in range(PERMUTATIONS)]


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def find_copies(sections: list[dict[str, Any]], threshold: float) -> list[dict[str, Any]]:
    sh = [shingles(s["text"]) for s in sections]
    tokens = [set(words(s["text"])) for s in sections]
    df: dict[str, int] = defaultdict(int)
    for ts in tokens:
        for t in ts:
            df[t] += 1
    rows = PERMUTATIONS // BANDS
    buckets: dict[tuple[int, tuple[int, ...]], list[int]] = defaultdict(list)
    for i, items in enumerate(sh):
        if len(items) < 2:
            continue
        sig = signature(items)
        for band in range(BANDS):
            buckets[(band, tuple(sig[band * rows : (band + 1) * rows]))].append(i)
    pairs: set[tuple[int, int]] = set()
    for members in buckets.values():
        for x in range(len(members)):
            for y in range(x + 1, len(members)):
                pairs.add((members[x], members[y]))
    out: list[dict[str, Any]] = []
    for i, j in sorted(pairs):
        a, b = sections[i], sections[j]
        if a["path"] == b["path"]:
            continue
        jac = jaccard(sh[i], sh[j])
        shared_rare = [
            t for t in tokens[i] & tokens[j] if df[t] <= 2 and (is_number(t) or len(t) >= 6)
        ]
        rare = min(1.0, len(shared_rare) / 5)
        score = round(min(1.0, 0.8 * jac + 0.2 * rare), 4)
        if score < threshold:
            continue
        src, dst = (a, b) if (a["updatedAt"], a["path"]) <= (b["updatedAt"], b["path"]) else (b, a)
        out.append(
            {
                "kind": "copy",
                "src": {"path": src["path"], "anchor": src["anchor"]},
                "dst": {"path": dst["path"], "anchor": dst["anchor"]},
                "score": score,
                "detail": {"jaccard": round(jac, 4), "sharedRare": len(shared_rare)},
            }
        )
    out.sort(key=lambda c: (-c["score"], c["src"]["path"], c["dst"]["path"]))
    return out[:MAX_CANDIDATES]


async def process_copy_candidates(
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
        parsed = CopyCandidatesInput.model_validate(raw)
    except ValidationError as error:
        await post_result(api, path, failed("input_invalid", str(error)))
        return
    dumped = parsed.model_dump(mode="json", by_alias=True)
    found = find_copies(dumped["sections"], dumped["threshold"])
    await post_result(api, path, ok(CopyCandidatesOutput.model_validate({"candidates": found})))
