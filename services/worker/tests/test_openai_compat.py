"""OpenAI-compatible provider over a mocked httpx transport (no network)."""

import asyncio
import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from mdwiki_worker.providers import (
    PROVIDER_ERROR,
    PROVIDER_TIMEOUT,
    RATE_LIMITED,
    SCHEMA_INVALID,
    ModelConfig,
    OpenAICompatProvider,
    ProviderError,
    StructuredRequest,
)

SCHEMA = {"type": "object", "properties": {"answer": {"type": "integer"}}, "required": ["answer"]}
REQUEST = StructuredRequest(system="rules", user="data", schema=SCHEMA, schema_name="quality")
CONFIG = ModelConfig(provider="openai_compat", model="qwen3:8b", max_tokens=512, temperature=0)


def completion(content: Any, finish: str = "stop", **message: Any) -> dict[str, Any]:
    return {
        "model": "qwen3:8b",
        "choices": [
            {
                "message": {"role": "assistant", "content": content, **message},
                "finish_reason": finish,
            }
        ],
        "usage": {"prompt_tokens": 20, "completion_tokens": 5},
    }


Handler = Callable[[httpx.Request], httpx.Response]


def call(handler: Handler, api_key: str | None = "key") -> Any:
    provider = OpenAICompatProvider(
        CONFIG,
        base_url="http://llm.local/v1/",
        api_key=api_key,
        transport=httpx.MockTransport(handler),
    )
    return asyncio.run(provider.complete(REQUEST))


def error(handler: Handler) -> ProviderError:
    with pytest.raises(ProviderError) as info:
        call(handler)
    return info.value


def test_posts_json_schema_response_format() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=completion('{"answer": 7}'))

    result = call(handle)
    request = seen[0]
    assert str(request.url) == "http://llm.local/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer key"
    body = json.loads(request.content)
    assert body["model"] == "qwen3:8b" and body["max_tokens"] == 512
    assert body["temperature"] == 0 and body["stream"] is False
    assert body["messages"] == [
        {"role": "system", "content": "rules"},
        {"role": "user", "content": "data"},
    ]
    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "quality", "schema": SCHEMA, "strict": False},
    }
    assert result.data == {"answer": 7}
    assert (result.provider, result.model) == ("openai_compat", "qwen3:8b")
    assert result.usage == {"input_tokens": 20, "output_tokens": 5}


def test_no_auth_header_without_key() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        assert "Authorization" not in request.headers
        return httpx.Response(200, json=completion('{"answer": 1}'))

    call(handle, api_key=None)


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        (completion("{bad"), SCHEMA_INVALID),
        (completion("[]"), SCHEMA_INVALID),
        (completion('{"answer"', finish="length"), SCHEMA_INVALID),
        (completion(None), SCHEMA_INVALID),
        (completion(None, refusal="no"), PROVIDER_ERROR),
        ({"choices": []}, PROVIDER_ERROR),
        ({"error": "x"}, PROVIDER_ERROR),
    ],
)
def test_bad_responses(payload: dict[str, Any], code: str) -> None:
    err = error(lambda _r: httpx.Response(200, json=payload))
    assert err.code == code and not err.retryable


def test_non_json_body_is_provider_error() -> None:
    assert error(lambda _r: httpx.Response(200, text="<html>")).code == PROVIDER_ERROR


@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    [
        (429, RATE_LIMITED, True),
        (408, PROVIDER_TIMEOUT, True),
        (504, PROVIDER_TIMEOUT, True),
        (500, PROVIDER_ERROR, True),
        (503, PROVIDER_ERROR, True),
        (400, PROVIDER_ERROR, False),
        (401, PROVIDER_ERROR, False),
    ],
)
def test_http_status_mapping(status: int, code: str, retryable: bool) -> None:
    err = error(lambda _r: httpx.Response(status, text="prompt echoed here"))
    assert (err.code, err.retryable) == (code, retryable)
    assert "prompt" not in err.message


def test_retry_after_header() -> None:
    err = error(lambda _r: httpx.Response(429, headers={"retry-after": "5"}))
    assert err.retry_after == 5.0
    bad = error(lambda _r: httpx.Response(429, headers={"retry-after": "soon"}))
    assert bad.retry_after is None


def test_transport_errors() -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    assert (error(timeout).code, error(timeout).retryable) == (PROVIDER_TIMEOUT, True)
    assert (error(refused).code, error(refused).retryable) == (PROVIDER_ERROR, True)


def test_base_url_is_required() -> None:
    with pytest.raises(ValueError):
        OpenAICompatProvider(CONFIG, base_url="")
