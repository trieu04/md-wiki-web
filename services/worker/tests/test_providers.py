"""Provider interface, retry policy, settings and the fake provider (no network)."""

import asyncio
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict

from mdwiki_worker.providers import (
    PROVIDER_ERROR,
    PROVIDER_TIMEOUT,
    RATE_LIMITED,
    SCHEMA_INVALID,
    AiSettings,
    AnthropicProvider,
    FakeProvider,
    ModelConfig,
    OpenAICompatProvider,
    ProviderError,
    StructuredRequest,
    complete_structured,
    make_provider,
    output_schema,
)


class Out(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: int


REQUEST = StructuredRequest(system="sys", user="user", schema=output_schema(Out))


def run(provider: Any, **kw: Any) -> tuple[Out, Any, list[float]]:
    delays: list[float] = []

    async def sleep(d: float) -> None:
        delays.append(d)

    async def go() -> tuple[Out, Any]:
        return await complete_structured(provider, REQUEST, Out, sleep=sleep, **kw)

    parsed, result = asyncio.run(go())
    return parsed, result, delays


def run_error(provider: Any, **kw: Any) -> tuple[ProviderError, list[float]]:
    delays: list[float] = []

    async def sleep(d: float) -> None:
        delays.append(d)

    with pytest.raises(ProviderError) as info:
        asyncio.run(complete_structured(provider, REQUEST, Out, sleep=sleep, **kw))
    return info.value, delays


def test_fake_returns_scripted_object_and_records_request() -> None:
    fake = FakeProvider([{"answer": 42}])
    parsed, result, delays = run(fake)
    assert parsed.answer == 42
    assert (result.provider, result.model) == ("fake", "fake-model")
    assert fake.requests == [REQUEST] and delays == []


def test_invalid_json_is_schema_invalid_and_not_retried() -> None:
    fake = FakeProvider(["{not json", {"answer": 1}])
    err, delays = run_error(fake)
    assert err.code == SCHEMA_INVALID and not err.retryable
    assert fake.remaining == 1 and delays == []


@pytest.mark.parametrize("raw", ["[1, 2]", '"text"', "null"])
def test_json_that_is_not_an_object_is_schema_invalid(raw: str) -> None:
    assert run_error(FakeProvider([raw]))[0].code == SCHEMA_INVALID


@pytest.mark.parametrize("data", [{"answer": "x"}, {}, {"answer": 1, "extra": True}])
def test_object_not_matching_the_model_is_schema_invalid(data: dict[str, Any]) -> None:
    err, _ = run_error(FakeProvider([data]))
    assert err.code == SCHEMA_INVALID
    assert "answer" not in err.message  # message names no content


def test_transient_errors_retry_with_backoff_then_succeed() -> None:
    fake = FakeProvider(
        [
            ProviderError(PROVIDER_TIMEOUT, "t", retryable=True),
            ProviderError(RATE_LIMITED, "r", retryable=True, retry_after=7),
            {"answer": 3},
        ]
    )
    parsed, _, delays = run(fake, max_attempts=3, base_delay=1.0)
    assert parsed.answer == 3
    assert delays == [1.0, 7.0]  # second delay honours Retry-After


def test_retry_is_bounded_and_keeps_last_code() -> None:
    fake = FakeProvider([ProviderError(RATE_LIMITED, "r", retryable=True)] * 5)
    err, delays = run_error(fake, max_attempts=3, base_delay=2.0)
    assert err.code == RATE_LIMITED
    assert delays == [2.0, 4.0] and fake.remaining == 2


def test_retry_delay_is_capped() -> None:
    fake = FakeProvider([ProviderError(RATE_LIMITED, "r", retryable=True, retry_after=3600)])
    _, delays = run_error(fake, max_attempts=2)
    assert delays == [30.0]


def test_non_retryable_error_fails_at_once() -> None:
    fake = FakeProvider([ProviderError(PROVIDER_ERROR, "HTTP 400"), {"answer": 1}])
    err, delays = run_error(fake)
    assert err.code == PROVIDER_ERROR and delays == [] and fake.remaining == 1


def test_unexpected_exception_and_exhausted_script_become_provider_error() -> None:
    assert run_error(FakeProvider([RuntimeError("boom")]))[0].code == PROVIDER_ERROR
    assert run_error(FakeProvider([]))[0].code == PROVIDER_ERROR


def test_max_attempts_must_be_positive() -> None:
    with pytest.raises(ValueError):
        run(FakeProvider([{"answer": 1}]), max_attempts=0)


def test_error_message_is_single_line_and_bounded() -> None:
    err = ProviderError(PROVIDER_ERROR, "a\n\nb " + "x" * 900)
    assert err.message.startswith("a b ") and len(err.message) == 500
    assert ProviderError(PROVIDER_ERROR, "  ").message == PROVIDER_ERROR


def test_output_schema_forbids_extra_properties() -> None:
    schema = output_schema(Out)
    assert schema["additionalProperties"] is False and schema["required"] == ["answer"]


# --- settings ---------------------------------------------------------------


def test_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("AI_DEFAULT__MODEL", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    config = AiSettings().for_kind("quality_check")
    assert config == ModelConfig()
    assert (config.provider, config.model, config.temperature) == (
        "anthropic",
        "claude-sonnet-5-5",
        None,
    )


def test_per_kind_override_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_DEFAULT__MAX_TOKENS", "2000")
    monkeypatch.setenv("AI_DEFAULT__TIMEOUT_S", "30")
    monkeypatch.setenv("AI_JOBS__QUALITY_CHECK__PROVIDER", "openai_compat")
    monkeypatch.setenv("AI_JOBS__QUALITY_CHECK__MODEL", "qwen3:8b")
    monkeypatch.setenv("AI_JOBS__QUALITY_CHECK__TEMPERATURE", "0")
    settings = AiSettings()
    qc = settings.for_kind("quality_check")
    assert (qc.provider, qc.model, qc.temperature, qc.max_tokens, qc.timeout_s) == (
        "openai_compat",
        "qwen3:8b",
        0.0,
        2000,
        30.0,
    )
    other = settings.for_kind("agent_review")
    assert (other.provider, other.model, other.max_tokens) == (
        "anthropic",
        "claude-sonnet-5-5",
        2000,
    )


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("AI_DEFAULT__PROVIDER", "gemini"),
        ("AI_DEFAULT__MAX_TOKENS", "0"),
        ("AI_DEFAULT__TEMPERATURE", "3"),
        ("AI_JOBS__QUALITY_CHECK__MAX_ATTEMPTS", "11"),
    ],
)
def test_invalid_settings_are_rejected(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        AiSettings()


def test_make_provider_picks_the_configured_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_COMPAT_BASE_URL", "http://llm.local/v1")
    monkeypatch.setenv("AI_JOBS__LOCAL__PROVIDER", "openai_compat")
    monkeypatch.setenv("AI_JOBS__TEST__PROVIDER", "fake")
    settings = AiSettings()
    assert isinstance(make_provider("quality_check", settings)[0], AnthropicProvider)
    assert isinstance(make_provider("local", settings)[0], OpenAICompatProvider)
    fake, _ = make_provider("test", settings, fake_script=[{"answer": 1}])
    assert isinstance(fake, FakeProvider) and fake.remaining == 1


def test_make_provider_needs_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_COMPAT_BASE_URL", raising=False)
    monkeypatch.setenv("AI_JOBS__LOCAL__PROVIDER", "openai_compat")
    settings = AiSettings()
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        make_provider("quality_check", settings)
    with pytest.raises(ValueError, match="OPENAI_COMPAT_BASE_URL"):
        make_provider("local", settings)
