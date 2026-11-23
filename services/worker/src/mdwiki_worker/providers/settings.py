"""Model configuration per job kind, loaded from the environment (D-70).

    AI_DEFAULT__PROVIDER=anthropic           anthropic | openai_compat | fake
    AI_DEFAULT__MODEL=claude-sonnet-5-5
    AI_DEFAULT__MAX_TOKENS=4096
    AI_DEFAULT__TIMEOUT_S=120
    AI_DEFAULT__TEMPERATURE=                 unset = provider default
    AI_DEFAULT__MAX_ATTEMPTS=3
    AI_JOBS__QUALITY_CHECK__MODEL=...        per-kind override of any field above
    ANTHROPIC_API_KEY=...
    OPENAI_COMPAT_BASE_URL=http://ollama:11434/v1
    OPENAI_COMPAT_API_KEY=...                optional
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["anthropic", "openai_compat", "fake"]
DEFAULT_MODEL = "claude-sonnet-5-5"


class ModelConfig(BaseModel):
    """Everything a provider call needs except credentials."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: ProviderName = "anthropic"
    model: str = Field(default=DEFAULT_MODEL, min_length=1, max_length=200)
    max_tokens: int = Field(default=4096, ge=1, le=128_000)
    timeout_s: float = Field(default=120.0, gt=0, le=1800)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_attempts: int = Field(default=3, ge=1, le=10)


class ModelOverride(BaseModel):
    """Per-kind override: only the fields that are set replace the default."""

    model_config = ConfigDict(extra="forbid")

    provider: ProviderName | None = None
    model: str | None = Field(default=None, min_length=1, max_length=200)
    max_tokens: int | None = Field(default=None, ge=1, le=128_000)
    timeout_s: float | None = Field(default=None, gt=0, le=1800)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_attempts: int | None = Field(default=None, ge=1, le=10)


class AiSettings(BaseSettings):
    """Provider settings; job kinds are lower-case keys of ``ai_jobs`` (env is case-blind)."""

    model_config = SettingsConfigDict(
        extra="ignore", hide_input_in_errors=True, env_nested_delimiter="__"
    )

    ai_default: ModelConfig = ModelConfig()
    ai_jobs: dict[str, ModelOverride] = {}
    anthropic_api_key: SecretStr | None = None
    openai_compat_base_url: str | None = None
    openai_compat_api_key: SecretStr | None = None

    def for_kind(self, kind: str) -> ModelConfig:
        """The default config with the kind's override applied."""
        override = self.ai_jobs.get(kind.lower())
        if override is None:
            return self.ai_default
        changes = override.model_dump(exclude_unset=True, exclude_none=True)
        return self.ai_default.model_copy(update=changes)
