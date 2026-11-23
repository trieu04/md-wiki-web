from __future__ import annotations

import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
from contextlib import suppress
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import tools.dev as dev


class FakeProcess:
    def __init__(self, pid: int, results: list[int | None]):
        self.pid = pid
        self.results = results
        self.returncode = None

    def poll(self) -> int | None:
        self.returncode = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        return self.returncode


def run_main(monkeypatch, worker_results: list[int | None], app_results: list[int | None], *, real_stop=False):
    processes = iter((FakeProcess(10001, worker_results), FakeProcess(10002, app_results)))
    popen_calls = []

    def fake_popen(*args, **kwargs):
        popen_calls.append((args, kwargs))
        return next(processes)

    monkeypatch.setattr(dev, "ROOT", Path("/nonexistent"))
    monkeypatch.setattr(dev.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(dev.os, "killpg", lambda _pgid, _signum: None)
    if not real_stop:
        monkeypatch.setattr(dev, "stop", lambda _groups: None)
    monkeypatch.setattr(dev.time, "sleep", lambda _seconds: None)
    return popen_calls


def test_clean_worker_exit_keeps_apps_running(monkeypatch, capsys):
    calls = run_main(monkeypatch, [0], [None, 0])
    assert dev.main() == 0
    assert "Worker exited cleanly" in capsys.readouterr().out
    assert len(calls) == 2
    assert all(call[1]["start_new_session"] is True for call in calls)


@pytest.mark.parametrize("worker_descendant", [False, True])
def test_shutdown_skips_retired_worker_but_stops_app_descendant(monkeypatch, worker_descendant):
    run_main(monkeypatch, [0], [None, None, 0], real_stop=True)
    # A worker descendant, if present, exits on the second launcher iteration.
    # Once the group disappears, treat its ID as reused: not even another probe is safe.
    worker_probes = iter([True, False] if worker_descendant else [False])
    signals = []

    def killpg(pgid, signum):
        if signum:
            signals.append((pgid, signum))
        elif pgid == 10001:
            if not next(worker_probes):
                raise ProcessLookupError
        elif (pgid, signal.SIGTERM) in signals:
            raise ProcessLookupError  # The app descendant exited gracefully.

    monkeypatch.setattr(dev.os, "killpg", killpg)
    assert dev.main() == 0
    assert signals == [(10002, signal.SIGTERM)]
    assert list(worker_probes) == []


def test_failing_worker_stops_stack_with_error(monkeypatch, capsys):
    run_main(monkeypatch, [7], [None])
    assert dev.main() == 7
    assert "Worker failed with status 7" in capsys.readouterr().err


def wait_for_files(*paths: Path) -> None:
    deadline = time.monotonic() + 5
    while not all(path.exists() for path in paths) and time.monotonic() < deadline:
        time.sleep(0.02)
    assert all(path.exists() for path in paths)


def kill_group(pgid: int) -> None:
    with suppress(ProcessLookupError):
        os.killpg(pgid, signal.SIGKILL)


def test_group_probe_treats_eperm_as_existing(monkeypatch):
    def denied(_pgid, _signum):
        raise PermissionError

    monkeypatch.setattr(dev.os, "killpg", denied)
    assert dev.group_exists(42)


def test_stop_kills_group_that_ignores_term(tmp_path):
    ready = tmp_path / "ready"
    child_code = (
        "import pathlib,signal,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        "pathlib.Path(sys.argv[1]).touch(); time.sleep(60)"
    )
    child = subprocess.Popen(
        [sys.executable, "-c", child_code, str(ready)], start_new_session=True
    )
    pgid = child.pid
    try:
        wait_for_files(ready)
        started = time.monotonic()
        dev.stop({pgid: child}, timeout=0.2)
        assert time.monotonic() - started >= 0.2
        assert child.poll() == -signal.SIGKILL
    finally:
        kill_group(pgid)
        child.wait(timeout=5)


@pytest.mark.parametrize("signum", [signal.SIGTERM, signal.SIGINT])
def test_launcher_allows_grandchild_to_finish_term_cleanup(tmp_path, signum):
    ready = tmp_path / "grandchild-ready"
    cleaned = tmp_path / "grandchild-cleaned"
    child_script = tmp_path / "grandchild.py"
    child_script.write_text(
        "import pathlib, signal, sys, time\n"
        "def finish(_signum, _frame):\n"
        "    time.sleep(1)\n"
        f"    pathlib.Path({str(cleaned)!r}).touch()\n"
        "    sys.exit(0)\n"
        "signal.signal(signal.SIGTERM, finish)\n"
        f"pathlib.Path({str(ready)!r}).touch()\n"
        "time.sleep(60)\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_uv = bin_dir / "uv"
    fake_pnpm = bin_dir / "pnpm"
    python = shlex.quote(sys.executable)
    worker_code = (
        "import subprocess,sys,time; subprocess.Popen([sys.executable,sys.argv[1]]); "
        "time.sleep(60)"
    )
    fake_uv.write_text(
        f"#!/bin/sh\nexec {python} -c {shlex.quote(worker_code)} {shlex.quote(str(child_script))}\n"
    )
    fake_pnpm.write_text(f"#!/bin/sh\nexec {python} -c 'import time; time.sleep(60)'\n")
    fake_uv.chmod(0o755)
    fake_pnpm.chmod(0o755)
    # Give the launcher an isolated repo root without the developer's .env.
    launcher_script = tmp_path / "tools" / "dev.py"
    launcher_script.parent.mkdir()
    shutil.copyfile(dev.__file__, launcher_script)
    log_path = tmp_path / "launcher.log"
    with log_path.open("w") as log:
        launcher = subprocess.Popen(
            [sys.executable, str(launcher_script)], env={"PATH": str(bin_dir)}, stdout=log
        )
        try:
            wait_for_files(ready)
            launcher.send_signal(signum)
            assert launcher.wait(timeout=dev.SHUTDOWN_TIMEOUT + 5) == 128 + signum
            assert cleaned.exists(), "grandchild was killed before finishing SIGTERM cleanup"
        finally:
            try:
                if launcher.poll() is None:
                    launcher.kill()
                launcher.wait(timeout=5)
            finally:
                # dev.py reports each group's ID at spawn. Clean up independently of its shutdown.
                pgids = re.findall(r"^Started .+ \(pid (\d+)\)$", log_path.read_text(), re.M)
                for pgid in pgids:
                    kill_group(int(pgid))


@pytest.mark.parametrize("parent_paths", [{"PATH": "/bin", "HOME": "/tmp"}, {}])
@pytest.mark.parametrize(
    "override", [{"REDIS_URL": "redis://process"}, {"SERVICE_TOKEN": "process-token"}]
)
def test_worker_and_app_share_env_precedence(monkeypatch, parent_paths, override):
    configured = {
        "REDIS_URL": "redis://dotenv",
        "INTERNAL_API_URL": "http://127.0.0.1:3001/internal/v1",
        "SERVICE_TOKEN": "dotenv-token",
        "DATABASE_URL": "postgres://dotenv",
        "NOT_ALLOWED": "dotenv-secret",
        "PATH": "/dotenv/bin",
        "HOME": "/dotenv/home",
    }
    popen_calls = run_main(monkeypatch, [0], [0])
    monkeypatch.setattr(dev, "read_dotenv", lambda _path: configured)
    monkeypatch.setattr(dev.os, "environ", {**parent_paths, **override, "ODD": "secret"})
    assert dev.main() == 0
    worker_env, app_env = popen_calls[0][1]["env"], popen_calls[1][1]["env"]
    shared = {key: override.get(key, configured[key]) for key in dev.WORKER_KEYS}
    assert worker_env == {**parent_paths, **shared}
    assert {key: app_env[key] for key in shared} == shared
    assert app_env["DATABASE_URL"] == "postgres://dotenv"
    assert app_env["ODD"] == "secret"
    assert "NOT_ALLOWED" not in app_env
    assert {key: app_env[key] for key in ("PATH", "HOME") if key in app_env} == parent_paths


@pytest.mark.parametrize("exported_root", [None, "./other wiki/../local wiki", "/absolute/wiki"])
def test_wiki_root_uses_repo_root(monkeypatch, tmp_path, exported_root):
    popen_calls = run_main(monkeypatch, [0], [0])
    repo = tmp_path / "repo with spaces"
    repo.mkdir()
    shutil.copyfile(Path(dev.__file__).resolve().parents[1] / ".env.example", repo / ".env")
    monkeypatch.setattr(dev, "ROOT", repo)
    monkeypatch.setattr(dev.os, "environ", {} if exported_root is None else {"WIKI_ROOT": exported_root})
    monkeypatch.chdir(tmp_path)

    assert dev.main() == 0
    if exported_root is None:
        expected = repo / "wiki-sample"
    elif Path(exported_root).is_absolute():
        expected = Path(exported_root)
    else:
        expected = repo / "local wiki"
    assert popen_calls[1][1]["env"]["WIKI_ROOT"] == str(expected)
    assert "WIKI_ROOT" not in popen_calls[0][1]["env"]


def test_dotenv_values_are_literal(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text('# comment\n\nWIKI_NAME="$(echo do-not-run) $HOME"\nSERVICE_TOKEN=a=b\n')
    assert dev.read_dotenv(env_file) == {
        "WIKI_NAME": "$(echo do-not-run) $HOME",
        "SERVICE_TOKEN": "a=b",
    }
