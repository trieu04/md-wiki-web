"""``retraction_check``: look up cited DOIs in Crossref (system-logic §7.7.12, D-232).

Crossref ``/works?filter=updates:<doi>`` lists the notices that update a work (retractions,
expressions of concern, corrections); Retraction Watch records are served through the same API
with ``source: retraction-watch``. One request per DOI, a few at a time, no contact details sent.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

import httpx
from pydantic import ValidationError

from ..contracts.retraction_check_input_schema import RetractionCheckInput
from ..contracts.retraction_check_output_schema import RetractionCheckOutput
from .common import failed, fetch_input, ok, post_result

KIND = "retraction_check"
CROSSREF = "https://api.crossref.org/"
CONCURRENCY = 4
USER_AGENT = "mdwiki-worker/0.1 (retraction check)"

# Crossref update types → invalidation kinds. Corrections are not invalidations.
_KINDS = {
    "retraction": "retraction",
    "withdrawal": "retraction",
    "removal": "retraction",
    "expression_of_concern": "concern",
    "expression-of-concern": "concern",
}


def hits_from_crossref(ref: str, payload: Any) -> list[dict[str, Any]]:
    """Hits for one DOI from a ``/works?filter=updates:`` response (pure; unit-tested)."""
    doi = ref.removeprefix("doi:").lower()
    items = payload.get("message", {}).get("items", []) if isinstance(payload, dict) else []
    found: dict[str, dict[str, Any]] = {}
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        for update in item.get("update-to", []) or []:
            if not isinstance(update, dict) or str(update.get("DOI", "")).lower() != doi:
                continue
            kind = _KINDS.get(str(update.get("type", "")).lower())
            if not kind:
                continue
            source = (
                "retraction_watch"
                if str(update.get("source", "")).lower() == "retraction-watch"
                else "crossref"
            )
            notice = item.get("DOI")
            label = "Retraction" if kind == "retraction" else "Expression of concern"
            date = (
                (update.get("updated") or {}).get("date-time")
                if isinstance(update.get("updated"), dict)
                else None
            )
            detail = f"{label} notice {notice or 'without DOI'}" + (
                f" ({date[:10]})" if date else ""
            )
            # Retraction wins over a concern for the same work.
            if kind == "retraction" or doi not in found:
                found[doi] = {
                    "ref": ref,
                    "kind": kind,
                    "detail": detail[:1000],
                    "source": source,
                    "noticeDoi": str(notice).lower()[:300] if notice else None,
                }
    return list(found.values())


async def check_refs(
    client: httpx.AsyncClient, refs: list[str]
) -> tuple[int, list[dict[str, Any]]]:
    """Checked count and hits; refs that could not be looked up are not counted as checked."""
    gate = asyncio.Semaphore(CONCURRENCY)
    hits: list[dict[str, Any]] = []
    checked = 0

    async def one(ref: str) -> None:
        nonlocal checked
        async with gate:
            try:
                response = await client.get(
                    "works",
                    params={"filter": f"updates:{ref.removeprefix('doi:')}", "rows": 20},
                )
            except httpx.HTTPError:
                return
            if response.status_code != 200:
                return
            try:
                payload = response.json()
            except ValueError:
                return
            checked += 1
            hits.extend(hits_from_crossref(ref, payload))

    await asyncio.gather(*(one(r) for r in dict.fromkeys(refs)))
    hits.sort(key=lambda h: h["ref"])
    return checked, hits


def crossref_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=CROSSREF, headers={"User-Agent": USER_AGENT}, timeout=30)


async def process_retraction_check(
    api: httpx.AsyncClient,
    name: str,
    job_id: str | None,
    data: object,
    client_factory: Callable[[], httpx.AsyncClient] = crossref_client,
) -> None:
    claimed = await fetch_input(api, name, job_id, data)
    if claimed is None:
        return
    path, raw = claimed
    try:
        parsed = RetractionCheckInput.model_validate(raw)
    except ValidationError as error:
        await post_result(api, path, failed("input_invalid", str(error)))
        return
    refs = [str(r.root) if hasattr(r, "root") else str(r) for r in parsed.refs]
    async with client_factory() as client:
        checked, hits = await check_refs(client, refs)
    if refs and checked == 0:
        await post_result(api, path, failed("source_unavailable", "Crossref could not be reached"))
        return
    output = RetractionCheckOutput.model_validate({"checked": checked, "hits": hits})
    await post_result(api, path, ok(output))
