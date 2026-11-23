"""Scripted provider for tests: each call takes the next step of the script."""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from .base import (
    PROVIDER_ERROR,
    ProviderError,
    StructuredRequest,
    StructuredResult,
    parse_json_object,
)

# A step is a JSON object (returned as is), a string (raw model text, e.g. invalid JSON),
# or an exception (raised; a ProviderError keeps its code, anything else becomes provider_error).
Step = dict[str, Any] | str | BaseException


class FakeProvider:
    """``Provider`` with a fixed script. Records every request it was given."""

    name = "fake"

    def __init__(self, script: Iterable[Step], *, model: str = "fake-model") -> None:
        self.model = model
        self._script = list(script)
        self.requests: list[StructuredRequest] = []

    @property
    def remaining(self) -> int:
        return len(self._script)

    async def complete(self, request: StructuredRequest) -> StructuredResult:
        self.requests.append(request)
        if not self._script:
            raise ProviderError(PROVIDER_ERROR, "Fake provider script is exhausted")
        step = self._script.pop(0)
        if isinstance(step, ProviderError):
            raise step
        if isinstance(step, BaseException):
            raise ProviderError(PROVIDER_ERROR, f"Fake failure ({type(step).__name__})") from step
        text = step if isinstance(step, str) else json.dumps(step)
        return StructuredResult(data=parse_json_object(text), provider=self.name, model=self.model)
