"""Check the worker's ping wire exchange without Redis or a real internal API."""

import asyncio
import json

import httpx
import pytest

from mdwiki_worker.ping import WORKER_VERSION, process_ping

JOB_ID = "019ac174-1da5-738a-a8c2-2f50343a60a3"
ENVELOPE = {"v": 1, "jobId": JOB_ID, "kind": "ping"}
PATH = f"/internal/v1/jobs/{JOB_ID}"


def run_ping(handler: httpx.MockTransport | None = None, data: object = ENVELOPE) -> None:
    async def run() -> None:
        async with httpx.AsyncClient(
            transport=handler,
            base_url="http://internal.example/internal/v1",
            headers={"Authorization": "Bearer test-token"},
        ) as api:
            await process_ping(api, "ping", JOB_ID, data)

    asyncio.run(run())


def test_ping_fetches_input_and_posts_echo() -> None:
    calls: list[tuple[str, str]] = []
    message = " 🔔 "

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer test-token"
        calls.append((request.method, request.url.path))
        if request.method == "GET":
            return httpx.Response(
                200, json={"jobId": JOB_ID, "kind": "ping", "input": {"message": message}}
            )
        assert json.loads(request.content) == {
            "status": "ok",
            "output": {"echo": message, "workerVersion": WORKER_VERSION},
        }
        return httpx.Response(204)

    run_ping(httpx.MockTransport(handle))
    assert calls == [("GET", f"{PATH}/input"), ("POST", f"{PATH}/result")]


@pytest.mark.parametrize(
    "data", [{**ENVELOPE, "v": 2}, {**ENVELOPE, "v": True}, {**ENVELOPE, "message": "extra"}]
)
def test_ping_rejects_invalid_envelope_before_fetch(data: object) -> None:
    def unexpected(_request: httpx.Request) -> httpx.Response:
        pytest.fail("Invalid envelope must not fetch input")

    with pytest.raises(ValueError):
        run_ping(httpx.MockTransport(unexpected), data)


@pytest.mark.parametrize("status", [409, 503])
def test_ping_distinguishes_a_finished_job_from_retryable_failure(status: int) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(status)

    transport = httpx.MockTransport(handle)
    if status == 409:
        run_ping(transport)
    else:
        with pytest.raises(httpx.HTTPStatusError):
            run_ping(transport)


def test_ping_rejects_input_for_another_job() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(
            200, json={"jobId": "someone-else", "kind": "ping", "input": {"message": "hi"}}
        )

    with pytest.raises(ValueError, match="Internal input does not match"):
        run_ping(httpx.MockTransport(handle))
