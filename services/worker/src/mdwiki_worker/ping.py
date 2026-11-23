"""Run ping jobs using only the versioned queue envelope and internal API."""

from importlib.metadata import version

import httpx

from .contracts.envelope_schema import JobEnvelope
from .contracts.ping_input_schema import PingInput
from .contracts.ping_output_schema import PingOutput
from .contracts.result_schema import JobResult, JobResultOk

QUEUE_NAME = "mw-jobs"
WORKER_VERSION = version("mdwiki-worker")


async def process_ping(api: httpx.AsyncClient, name: str, job_id: str | None, data: object) -> None:
    """Echo the validated input. Let transport errors propagate for BullMQ to retry."""
    # Pydantic's Literal[1] would otherwise coerce true to 1.
    if isinstance(data, dict) and isinstance(data.get("v"), bool):
        raise ValueError("Invalid JobEnvelope version")
    job = JobEnvelope.model_validate(data)
    if name != job.kind or job_id != str(job.job_id):
        raise ValueError("BullMQ job metadata does not match JobEnvelope")

    path = f"jobs/{job.job_id}"
    response = await api.get(f"{path}/input")
    if response.status_code == 409:
        # A prior attempt may have posted its result before losing its acknowledgement.
        return
    response.raise_for_status()
    payload: object = response.json()
    if (
        not isinstance(payload, dict)
        or set(payload) != {"kind", "jobId", "input"}
        or payload["kind"] != job.kind
        or payload["jobId"] != str(job.job_id)
    ):
        raise ValueError("Internal input does not match JobEnvelope")

    ping = PingInput.model_validate(payload["input"])
    output = PingOutput(echo=ping.message, workerVersion=WORKER_VERSION)
    result = JobResult(JobResultOk(status="ok", output=output))
    posted = await api.post(f"{path}/result", json=result.model_dump(mode="json", by_alias=True))
    posted.raise_for_status()
