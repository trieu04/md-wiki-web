"""Worker process entry point and configuration."""

from __future__ import annotations

import logging
from urllib.parse import urlsplit

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


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


def run() -> None:
    """Load configuration and log worker startup."""
    settings = Settings()  # type: ignore[call-arg]  # BaseSettings loads required values from env.
    logging.basicConfig(level=logging.INFO)
    logging.getLogger(__name__).info(
        "Starting mdwiki worker (redis=%s, internal_api=%s)",
        _redact_url(settings.redis_url),
        _redact_url(settings.internal_api_url),
    )


if __name__ == "__main__":
    run()
