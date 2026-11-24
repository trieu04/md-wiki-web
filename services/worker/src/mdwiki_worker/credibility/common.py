"""Shared plumbing for the credibility jobs: envelope check, input fetch, result post."""

from __future__ import annotations

from typing import Any

import httpx
from pydantic import BaseModel

from ..contracts.envelope_schema import JobEnvelope
from ..contracts.result_schema import JobError, JobResult, JobResultFailed, JobResultOk


def failed(code: str, message: str) -> JobResult:
    return JobResult(
        JobResultFailed(status="failed", error=JobError(code=code, message=message[:500] or code))
    )


def ok(output: BaseModel) -> JobResult:
    return JobResult(JobResultOk.model_validate({"status": "ok", "output": output}))


async def fetch_input(
    api: httpx.AsyncClient, name: str, job_id: str | None, data: object
) -> tuple[str, Any] | None:
    """Validate the envelope and claim the job. ``None`` when it is already finished (409)."""
    if isinstance(data, dict) and isinstance(data.get("v"), bool):
        raise ValueError("Invalid JobEnvelope version")
    job = JobEnvelope.model_validate(data)
    if name != job.kind or job_id != str(job.job_id):
        raise ValueError("BullMQ job metadata does not match JobEnvelope")
    path = f"jobs/{job.job_id}"
    response = await api.get(f"{path}/input")
    if response.status_code == 409:
        return None
    response.raise_for_status()
    payload: object = response.json()
    if (
        not isinstance(payload, dict)
        or payload.get("kind") != job.kind
        or payload.get("jobId") != str(job.job_id)
    ):
        raise ValueError("Internal input does not match JobEnvelope")
    return path, payload["input"]


async def post_result(api: httpx.AsyncClient, path: str, result: JobResult) -> None:
    posted = await api.post(f"{path}/result", json=result.model_dump(mode="json", by_alias=True))
    if posted.status_code == 409:
        return
    posted.raise_for_status()
