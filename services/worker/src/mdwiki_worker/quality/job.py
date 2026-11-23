"""The ``quality_check`` job (system-logic §7.6.3): fetch input, check, post the result."""

from __future__ import annotations

import logging
from collections.abc import Callable

import httpx
from pydantic import ValidationError

from ..contracts.envelope_schema import JobEnvelope
from ..contracts.quality_check_input_schema import QualityCheckInput
from ..contracts.result_schema import JobError, JobResult, JobResultFailed, JobResultOk
from ..providers import PROVIDER_ERROR, ModelConfig, Provider, ProviderError
from .check import INPUT_INVALID, QualityError, run_check

KIND = "quality_check"
WORKER_ERROR = "worker_error"
log = logging.getLogger(__name__)

ProviderFactory = Callable[[], tuple[Provider, ModelConfig]]


def _failed(code: str, message: str) -> JobResult:
    return JobResult(
        JobResultFailed(status="failed", error=JobError(code=code, message=message[:500] or code))
    )


async def _post(api: httpx.AsyncClient, path: str, result: JobResult) -> None:
    posted = await api.post(f"{path}/result", json=result.model_dump(mode="json", by_alias=True))
    posted.raise_for_status()


async def process_quality_check(
    api: httpx.AsyncClient,
    name: str,
    job_id: str | None,
    data: object,
    provider_factory: ProviderFactory,
) -> None:
    """Run one check. Every check failure is posted as a failed result; transport errors
    (internal API unreachable or 5xx) propagate so BullMQ retries the job."""
    if isinstance(data, dict) and isinstance(data.get("v"), bool):
        raise ValueError("Invalid JobEnvelope version")
    envelope = JobEnvelope.model_validate(data)
    if name != envelope.kind.value or name != KIND or job_id != str(envelope.job_id):
        raise ValueError("BullMQ job metadata does not match JobEnvelope")

    path = f"jobs/{envelope.job_id}"
    response = await api.get(f"{path}/input")
    if response.status_code == 409:
        # Finished, superseded, or a prior attempt already posted its result.
        return
    response.raise_for_status()
    payload: object = response.json()
    if (
        not isinstance(payload, dict)
        or set(payload) != {"kind", "jobId", "input"}
        or payload["kind"] != KIND
        or payload["jobId"] != str(envelope.job_id)
    ):
        raise ValueError("Internal input does not match JobEnvelope")

    try:
        job = QualityCheckInput.model_validate(payload["input"])
    except ValidationError as exc:
        await _post(api, path, _failed(INPUT_INVALID, f"input does not match the schema: {exc}"))
        return

    try:
        provider, config = provider_factory()
        checked = await run_check(job, provider, config)
        result = JobResult(JobResultOk(status="ok", output=checked.output))
    except QualityError as exc:
        result = _failed(exc.code, exc.message)
    except ProviderError as exc:
        result = _failed(exc.code, str(exc))
    except ValueError as exc:
        # Provider misconfiguration, e.g. no API key for the configured provider.
        result = _failed(PROVIDER_ERROR, str(exc))
    except Exception as exc:  # noqa: BLE001 - any other bug fails the run, never the queue
        log.exception("quality check %s failed", envelope.job_id)
        result = _failed(WORKER_ERROR, f"worker error ({type(exc).__name__})")
    await _post(api, path, result)
