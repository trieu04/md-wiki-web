"""Anthropic provider through the real SDK with a mocked HTTP transport (no network)."""

import asyncio
import json
from collections.abc import Callable
from typing import Any

import httpx2
import pytest
from anthropic import AsyncAnthropic

from mdwiki_worker.providers import (
    PROVIDER_ERROR,
    PROVIDER_TIMEOUT,
    RATE_LIMITED,
    SCHEMA_INVALID,
    AnthropicProvider,
    ModelConfig,
    ProviderError,
    StructuredRequest,
)

SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "integer"}},
    "required": ["answer"],
    "additionalProperties": False,
}
REQUEST = StructuredRequest(system="rules", user="<<<DATA ...>>>", schema=SCHEMA)


def message(text: str, stop_reason: str = "end_turn") -> dict[str, Any]:
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 11, "output_tokens": 4},
    }


Handler = Callable[[httpx2.Request], httpx2.Response]


def call(handler: Handler, config: ModelConfig | None = None) -> Any:
    async def go() -> Any:
        client = AsyncAnthropic(
            api_key="sk-test",
            max_retries=0,
            http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
        )
        provider = AnthropicProvider(config or ModelConfig(), api_key=None, client=client)
        return await provider.complete(REQUEST)

    return asyncio.run(go())


def error(handler: Handler) -> ProviderError:
    with pytest.raises(ProviderError) as info:
        call(handler)
    return info.value


def test_sends_schema_as_structured_output_and_parses_text() -> None:
    seen: list[dict[str, Any]] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/v1/messages"
        auth = request.headers.get("x-api-key") or request.headers.get("authorization", "")
        assert auth.endswith("sk-test")
        seen.append(json.loads(request.content))
        return httpx2.Response(200, json=message('{"answer": 42}'))

    result = call(handle, ModelConfig(max_tokens=900))
    body = seen[0]
    assert body["model"] == "claude-sonnet-5-5" and body["max_tokens"] == 900
    assert body["system"] == "rules" and "temperature" not in body
    assert body["messages"] == [{"role": "user", "content": "<<<DATA ...>>>"}]
    assert body["output_config"] == {"format": {"type": "json_schema", "schema": SCHEMA}}
    assert result.data == {"answer": 42}
    assert (result.provider, result.model) == ("anthropic", "claude-sonnet-5-5")
    assert result.usage == {"input_tokens": 11, "output_tokens": 4}


def test_temperature_is_rejected_at_construction() -> None:
    with pytest.raises(ValueError, match="temperature"):
        AnthropicProvider(ModelConfig(temperature=0.2), api_key="sk-test")


@pytest.mark.parametrize(
    ("text", "stop", "code"),
    [
        ("{oops", "end_turn", SCHEMA_INVALID),
        ('{"answer": 1', "max_tokens", SCHEMA_INVALID),
        ("", "refusal", PROVIDER_ERROR),
    ],
)
def test_bad_model_output(text: str, stop: str, code: str) -> None:
    err = error(lambda _r: httpx2.Response(200, json=message(text, stop)))
    assert err.code == code and not err.retryable


def api_error(status: int, headers: dict[str, str] | None = None) -> Handler:
    body = {"type": "error", "error": {"type": "x", "message": "secret prompt text"}}
    return lambda _r: httpx2.Response(status, json=body, headers=headers or {})


@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    [
        (429, RATE_LIMITED, True),
        (500, PROVIDER_ERROR, True),
        (529, PROVIDER_ERROR, True),
        (400, PROVIDER_ERROR, False),
        (401, PROVIDER_ERROR, False),
        (404, PROVIDER_ERROR, False),
    ],
)
def test_http_errors_map_to_codes(status: int, code: str, retryable: bool) -> None:
    err = error(api_error(status))
    assert (err.code, err.retryable) == (code, retryable)
    assert "secret" not in err.message


def test_rate_limit_carries_retry_after() -> None:
    assert error(api_error(429, {"retry-after": "12"})).retry_after == 12.0


def test_timeout_and_connection_errors() -> None:
    def timeout(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("slow", request=request)

    def refused(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused", request=request)

    t = error(timeout)
    assert (t.code, t.retryable) == (PROVIDER_TIMEOUT, True)
    c = error(refused)
    assert (c.code, c.retryable) == (PROVIDER_ERROR, True)
