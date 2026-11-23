"""OpenAI-compatible chat completions (Ollama, vLLM) over httpx, ``response_format`` json_schema."""

from __future__ import annotations

from typing import Any

import httpx

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


def _retry_after(response: httpx.Response) -> float | None:
    try:
        value = response.headers.get("retry-after")
        return float(value) if value is not None else None
    except ValueError:
        return None


def map_http_status(response: httpx.Response) -> ProviderError:
    """Non-2xx response → stable job error code (D-71)."""
    status = response.status_code
    if status == 429:
        return ProviderError(
            RATE_LIMITED, "Provider rate limit reached", retryable=True,
            retry_after=_retry_after(response),
        )
    if status in (408, 504):
        return ProviderError(PROVIDER_TIMEOUT, f"Provider returned HTTP {status}", retryable=True)
    return ProviderError(
        PROVIDER_ERROR, f"Provider returned HTTP {status}", retryable=status >= 500
    )


class OpenAICompatProvider:
    """``Provider`` for any server that speaks ``POST {base_url}/chat/completions``."""

    name = "openai_compat"

    def __init__(
        self,
        config: ModelConfig,
        *,
        base_url: str,
        api_key: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        strict: bool = False,
    ) -> None:
        if not base_url:
            raise ValueError("openai_compat needs OPENAI_COMPAT_BASE_URL")
        self.model = config.model
        self._config = config
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._transport = transport
        self._strict = strict

    def _body(self, request: StructuredRequest) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": self._config.model,
            "max_tokens": self._config.max_tokens,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": request.schema_name,
                    "schema": request.schema,
                    "strict": self._strict,
                },
            },
            "stream": False,
        }
        if self._config.temperature is not None:
            body["temperature"] = self._config.temperature
        return body

    async def complete(self, request: StructuredRequest) -> StructuredResult:
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._config.timeout_s,
                transport=self._transport,
                headers=headers,
            ) as client:
                response = await client.post("/chat/completions", json=self._body(request))
        except httpx.TimeoutException as exc:
            raise ProviderError(
                PROVIDER_TIMEOUT, "Provider request timed out", retryable=True
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(
                PROVIDER_ERROR, f"Provider connection failed ({type(exc).__name__})",
                retryable=True,
            ) from exc
        if response.status_code >= 400:
            raise map_http_status(response)
        return self._parse(response)

    def _parse(self, response: httpx.Response) -> StructuredResult:
        try:
            payload = response.json()
            choice = payload["choices"][0]
            message = choice["message"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError(PROVIDER_ERROR, "Provider response has no message") from exc
        if choice.get("finish_reason") == "length":
            raise ProviderError(SCHEMA_INVALID, "Model output was cut off at max_tokens")
        if message.get("refusal"):
            raise ProviderError(PROVIDER_ERROR, "Model refused the request")
        content = message.get("content")
        if not isinstance(content, str):
            raise ProviderError(SCHEMA_INVALID, "Model output is not text")
        raw_usage = payload.get("usage") if isinstance(payload, dict) else None
        usage: dict[str, int] = {}
        if isinstance(raw_usage, dict):
            pairs = (("prompt_tokens", "input_tokens"), ("completion_tokens", "output_tokens"))
            for src, dst in pairs:
                if isinstance(raw_usage.get(src), int):
                    usage[dst] = raw_usage[src]
        model = payload.get("model") if isinstance(payload.get("model"), str) else self.model
        return StructuredResult(
            data=parse_json_object(content), provider=self.name, model=model, usage=usage
        )
