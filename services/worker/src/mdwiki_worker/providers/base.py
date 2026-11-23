"""Provider interface: one structured (JSON-schema) call, stable error codes, bounded retry."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Final, Literal, Protocol

from pydantic import BaseModel, ValidationError

PROVIDER_ERROR: Final = "provider_error"
PROVIDER_TIMEOUT: Final = "provider_timeout"
SCHEMA_INVALID: Final = "schema_invalid"
RATE_LIMITED: Final = "rate_limited"

ErrorCode = Literal["provider_error", "provider_timeout", "schema_invalid", "rate_limited"]

# JobResult.error.message is limited to 1..500 characters (system-logic §7.1).
MAX_MESSAGE: Final = 500
MAX_RETRY_DELAY: Final = 30.0


class ProviderError(Exception):
    """A provider failure mapped to a stable job error code.

    Messages never carry content or secrets.
    """

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        retryable: bool = False,
        retry_after: float | None = None,
    ) -> None:
        text = " ".join(message.split()) or code
        super().__init__(text[:MAX_MESSAGE])
        self.code: ErrorCode = code
        self.message = text[:MAX_MESSAGE]
        self.retryable = retryable
        self.retry_after = retry_after


@dataclass(frozen=True)
class StructuredRequest:
    """One call: trusted system text, one user message (fenced data), and the output JSON schema."""

    system: str
    user: str
    schema: dict[str, Any]
    schema_name: str = "output"


@dataclass(frozen=True)
class StructuredResult:
    """Parsed JSON object plus what produced it (recorded with every job result)."""

    data: dict[str, Any]
    provider: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)


class Provider(Protocol):
    """A model backend. Implementations raise only ProviderError."""

    name: str
    model: str

    async def complete(self, request: StructuredRequest) -> StructuredResult: ...


def parse_json_object(text: str) -> dict[str, Any]:
    """Model text → JSON object, else schema_invalid."""
    try:
        value: object = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ProviderError(SCHEMA_INVALID, "Model output is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ProviderError(SCHEMA_INVALID, "Model output is not a JSON object")
    return value


def output_schema(model: type[BaseModel]) -> dict[str, Any]:
    """The JSON schema sent to the provider for a pydantic output model."""
    return model.model_json_schema()


Sleep = Callable[[float], Awaitable[None]]


async def complete_structured[M: BaseModel](
    provider: Provider,
    request: StructuredRequest,
    output_model: type[M],
    *,
    max_attempts: int = 3,
    base_delay: float = 1.0,
    sleep: Sleep = asyncio.sleep,
) -> tuple[M, StructuredResult]:
    """Call the provider, retrying transient errors with bounded exponential backoff, and validate.

    Only errors marked retryable (timeouts, rate limits, 5xx, connection failures) are retried;
    schema_invalid and other 4xx failures are returned at once.
    """
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    attempt = 0
    while True:
        attempt += 1
        try:
            result = await provider.complete(request)
            break
        except ProviderError as exc:
            if not exc.retryable or attempt >= max_attempts:
                raise
            delay = base_delay * 2 ** (attempt - 1)
            if exc.retry_after is not None:
                delay = max(delay, exc.retry_after)
            await sleep(min(delay, MAX_RETRY_DELAY))
    try:
        parsed = output_model.model_validate(result.data)
    except ValidationError as exc:
        raise ProviderError(
            SCHEMA_INVALID, f"Model output does not match the schema ({exc.error_count()} errors)"
        ) from exc
    return parsed, result
