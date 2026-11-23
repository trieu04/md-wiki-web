"""Model providers behind one interface (architecture.md › services/worker, D-70, D-71)."""

from __future__ import annotations

from collections.abc import Iterable

from .anthropic_provider import AnthropicProvider
from .base import (
    PROVIDER_ERROR,
    PROVIDER_TIMEOUT,
    RATE_LIMITED,
    SCHEMA_INVALID,
    Provider,
    ProviderError,
    StructuredRequest,
    StructuredResult,
    complete_structured,
    output_schema,
)
from .fake import FakeProvider, Step
from .openai_compat import OpenAICompatProvider
from .settings import AiSettings, ModelConfig, ModelOverride

__all__ = [
    "PROVIDER_ERROR",
    "PROVIDER_TIMEOUT",
    "RATE_LIMITED",
    "SCHEMA_INVALID",
    "AiSettings",
    "AnthropicProvider",
    "FakeProvider",
    "ModelConfig",
    "ModelOverride",
    "OpenAICompatProvider",
    "Provider",
    "ProviderError",
    "StructuredRequest",
    "StructuredResult",
    "complete_structured",
    "make_provider",
    "output_schema",
]


def make_provider(
    kind: str, settings: AiSettings, *, fake_script: Iterable[Step] = ()
) -> tuple[Provider, ModelConfig]:
    """The configured provider for a job kind, with the config it runs with."""
    config = settings.for_kind(kind)
    if config.provider == "anthropic":
        key = settings.anthropic_api_key
        if key is None:
            raise ValueError("anthropic provider needs ANTHROPIC_API_KEY")
        return AnthropicProvider(config, api_key=key.get_secret_value()), config
    if config.provider == "openai_compat":
        api_key = settings.openai_compat_api_key
        return (
            OpenAICompatProvider(
                config,
                base_url=settings.openai_compat_base_url or "",
                api_key=api_key.get_secret_value() if api_key else None,
            ),
            config,
        )
    return FakeProvider(fake_script, model=config.model), config
