"""Smoke tests for worker configuration."""

import logging

import pytest
from pydantic import ValidationError

from mdwiki_worker.main import Settings


def test_module_entry_point_calls_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """Running the package as a module delegates to the worker run function."""
    import runpy

    import mdwiki_worker.main as worker_main

    called = False

    def fake_run() -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(worker_main, "run", fake_run)
    runpy.run_module("mdwiki_worker.__main__", run_name="__main__")

    assert called


def test_settings_reject_missing_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """The service token must be configured before the worker starts."""
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379")
    monkeypatch.setenv("INTERNAL_API_URL", "http://localhost:3001")
    monkeypatch.delenv("SERVICE_TOKEN", raising=False)

    with pytest.raises(ValidationError) as error:
        Settings()

    assert "service_token" in str(error.value)


def test_startup_validation_error_does_not_expose_service_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A startup configuration error must not reveal the configured token."""
    from mdwiki_worker.main import run

    monkeypatch.setenv("SERVICE_TOKEN", "test-secret-token")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("INTERNAL_API_URL", "http://localhost:3001")

    with pytest.raises(ValidationError) as error:
        run()

    assert "test-secret-token" not in str(error.value)


def test_startup_logs_redact_url_credentials(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Startup logs must not include URL credentials or paths."""
    from mdwiki_worker.main import run

    monkeypatch.setenv("REDIS_URL", "redis://user:password@localhost:6379/0")
    monkeypatch.setenv("INTERNAL_API_URL", "https://token:secret@example.com/api")
    monkeypatch.setenv("SERVICE_TOKEN", "test-secret-token")

    with caplog.at_level(logging.INFO):
        run()

    messages = [r.getMessage() for r in caplog.records]
    assert any("localhost:6379" in m for m in messages), "startup record not captured"
    assert "password" not in caplog.text
    assert "secret" not in caplog.text
    assert "user:" not in caplog.text
    assert "/api" not in caplog.text
