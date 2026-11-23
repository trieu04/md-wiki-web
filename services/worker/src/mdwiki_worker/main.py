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

from .ping import QUEUE_NAME, process_ping


class Settings(BaseSettings):
    """Required configuration loaded from the process environment."""

    model_config = SettingsConfigDict(extra="ignore", hide_input_in_errors=True)

    redis_url: str
    internal_api_url: str
    service_token: SecretStr


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


async def serve(settings: Settings) -> None:
    """Run the BullMQ consumer until the process is asked to stop."""
    loop = asyncio.get_running_loop()
    signals = (signal.SIGINT, signal.SIGTERM)
    stopping = asyncio.Event()
    for signum in signals:
        loop.add_signal_handler(signum, stopping.set)

    try:
        async with httpx.AsyncClient(
            base_url=settings.internal_api_url,
            headers={"Authorization": f"Bearer {settings.service_token.get_secret_value()}"},
        ) as api:

            async def process(job: Job, _token: str) -> None:
                await process_ping(api, job.name, job.id, job.data)

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
