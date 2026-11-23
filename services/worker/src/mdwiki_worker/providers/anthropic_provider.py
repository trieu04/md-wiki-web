"""Claude through the official SDK, with native structured outputs forcing the JSON schema."""

from __future__ import annotations

from typing import Any

import anthropic
from anthropic import AsyncAnthropic

from .base import (
    PROVIDER_ERROR,
    PROVIDER_TIMEOUT,
    RATE_LIMITED,
    SCHEMA_INVALID,
    ProviderError,
    StructuredRequest,
    StructuredResult,
    parse_json_object,
)
from .settings import ModelConfig


def _retry_after(headers: Any) -> float | None:
    try:
        value = headers.get("retry-after")
        return float(value) if value is not None else None
    except (TypeError, ValueError, AttributeError):
        return None


def map_anthropic_error(exc: Exception) -> ProviderError:
    """SDK exception → stable job error code (D-71)."""
    if isinstance(exc, anthropic.APITimeoutError):
        return ProviderError(PROVIDER_TIMEOUT, "Anthropic request timed out", retryable=True)
    if isinstance(exc, anthropic.RateLimitError):
        return ProviderError(
            RATE_LIMITED,
            "Anthropic rate limit reached",
            retryable=True,
            retry_after=_retry_after(exc.response.headers),
        )
    if isinstance(exc, anthropic.APIConnectionError):
        return ProviderError(PROVIDER_ERROR, "Anthropic connection failed", retryable=True)
    if isinstance(exc, anthropic.APIStatusError):
        status = exc.status_code
        transient = status >= 500 or status in (408, 409)
        return ProviderError(
            PROVIDER_ERROR, f"Anthropic returned HTTP {status}", retryable=transient
        )
    return ProviderError(PROVIDER_ERROR, f"Anthropic call failed ({type(exc).__name__})")


class AnthropicProvider:
    """``Provider`` for Claude. The SDK's own retries are off: ``complete_structured`` retries."""

    name = "anthropic"

    def __init__(
        self, config: ModelConfig, *, api_key: str | None, client: AsyncAnthropic | None = None
    ) -> None:
        if config.temperature is not None:
            # SDK 2.x / current Claude models take no sampling parameters (D-70).
            raise ValueError("temperature is not supported by the anthropic provider")
        self.model = config.model
        self._config = config
        self._client = client or AsyncAnthropic(
            api_key=api_key, max_retries=0, timeout=config.timeout_s
        )

    async def complete(self, request: StructuredRequest) -> StructuredResult:
        try:
            message = await self._client.messages.create(
                model=self._config.model,
                max_tokens=self._config.max_tokens,
                system=request.system,
                messages=[{"role": "user", "content": request.user}],
                output_config={"format": {"type": "json_schema", "schema": request.schema}},
                timeout=self._config.timeout_s,
            )
        except Exception as exc:  # every SDK failure maps to a job error code
            raise map_anthropic_error(exc) from exc
        if message.stop_reason == "max_tokens":
            raise ProviderError(SCHEMA_INVALID, "Model output was cut off at max_tokens")
        if message.stop_reason == "refusal":
            raise ProviderError(PROVIDER_ERROR, "Model refused the request")
        text = "".join(block.text for block in message.content if block.type == "text")
        usage = {
            "input_tokens": message.usage.input_tokens,
            "output_tokens": message.usage.output_tokens,
        }
        return StructuredResult(
            data=parse_json_object(text), provider=self.name, model=message.model, usage=usage
        )
