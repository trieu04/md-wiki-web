"""Worker process entry point and configuration."""

from __future__ import annotations

import asyncio
import logging
import signal
from urllib.parse import urlsplit

import httpx
from bullmq import Job, Worker  # type: ignore[import-untyped]
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from .agent.review import KIND as AGENT_REVIEW
from .agent.review import process_agent_review
from .credibility import copies, relations, retraction, score
from .ping import QUEUE_NAME, process_ping
from .providers import AiSettings, ModelConfig, Provider, make_provider
from .quality.job import KIND as QUALITY_CHECK
from .quality.job import process_quality_check


class Settings(BaseSettings):
    """Required configuration loaded from the process environment."""

    model_config = SettingsConfigDict(extra="ignore", hide_input_in_errors=True)

    redis_url: str
    internal_api_url: str
    service_token: SecretStr
    # The reviewer agent acts through the public API with its own token (system-logic §7.8.6).
    public_api_url: str = "http://127.0.0.1:3000/api/v1/"
    reviewer_agent_token: SecretStr | None = None


def _redact_url(url: str) -> str:
    """Return only a URL's scheme and network location, without credentials or path data."""
    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname
        if not parsed.scheme or not hostname:
            return "<invalid-url>"
        if ":" in hostname:
            hostname = f"[{hostname}]"
        port = f":{parsed.port}" if parsed.port is not None else ""
        return f"{parsed.scheme}://{hostname}{port}"
    except ValueError:
        return "<invalid-url>"


def quality_provider() -> tuple[Provider, ModelConfig]:
    """The provider for ``quality_check`` from the shared ``AI_*`` env (D-70)."""
    return make_provider(QUALITY_CHECK, AiSettings())


def agent_provider() -> tuple[Provider, ModelConfig]:
    """The provider for ``agent_review`` (``AI_JOBS__AGENT_REVIEW__*`` overrides)."""
    return make_provider(AGENT_REVIEW, AiSettings())


async def dispatch(
    api: httpx.AsyncClient,
    name: str,
    job_id: str | None,
    data: object,
    public: httpx.AsyncClient | None = None,
) -> None:
    """Route a job by its BullMQ name (= envelope kind) to its handler."""
    if name == QUALITY_CHECK:
        await process_quality_check(api, name, job_id, data, quality_provider)
    elif name == AGENT_REVIEW:
        await process_agent_review(api, public, name, job_id, data, agent_provider)
    elif name == retraction.KIND:
        await retraction.process_retraction_check(api, name, job_id, data)
    elif name == copies.KIND:
        await copies.process_copy_candidates(api, name, job_id, data)
    elif name == relations.KIND:
        await relations.process_relation_candidates(api, name, job_id, data)
    elif name == score.KIND:
        await score.process_credibility_score(api, name, job_id, data)
    else:
        await process_ping(api, name, job_id, data)


async def serve(settings: Settings) -> None:
    """Run the BullMQ consumer until the process is asked to stop."""
    loop = asyncio.get_running_loop()
    signals = (signal.SIGINT, signal.SIGTERM)
    stopping = asyncio.Event()
    for signum in signals:
        loop.add_signal_handler(signum, stopping.set)

    token = settings.reviewer_agent_token
    public = (
        httpx.AsyncClient(
            base_url=settings.public_api_url,
            headers={"Authorization": f"Bearer {token.get_secret_value()}"},
            timeout=60,
        )
        if token is not None and token.get_secret_value()
        else None
    )
    try:
        async with httpx.AsyncClient(
            base_url=settings.internal_api_url,
            headers={"Authorization": f"Bearer {settings.service_token.get_secret_value()}"},
        ) as api:

            async def process(job: Job, _token: str) -> None:
                await dispatch(api, job.name, job.id, job.data, public)

            worker = Worker(
                QUEUE_NAME, process, {"connection": settings.redis_url, "autorun": False}
            )
            work = asyncio.create_task(worker.run())
            stop = asyncio.create_task(stopping.wait())
            try:
                await asyncio.wait({work, stop}, return_when=asyncio.FIRST_COMPLETED)
            finally:
                stop.cancel()
                await worker.close()
                await work
    finally:
        if public is not None:
            await public.aclose()
        for signum in signals:
            loop.remove_signal_handler(signum)


def run() -> None:
    """Load configuration and start the worker."""
    settings = Settings()  # type: ignore[call-arg]  # BaseSettings loads required values from env.
    logging.basicConfig(level=logging.INFO)
    logging.getLogger(__name__).info(
        "Starting mdwiki worker (redis=%s, internal_api=%s)",
        _redact_url(settings.redis_url),
        _redact_url(settings.internal_api_url),
    )
    asyncio.run(serve(settings))


if __name__ == "__main__":
    run()
