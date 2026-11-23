#!/usr/bin/env python3
"""Run the API, web app, and worker with safely parsed local environment data."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_KEYS = (
    "DATABASE_URL",
    "REDIS_URL",
    "API_PORT",
    "INTERNAL_PORT",
    "SERVICE_TOKEN",
    "OWNER_EMAIL",
    "OWNER_PASSWORD",
    "WIKI_ROOT",
    "AUTO_PUBLISH",
    "WEB_PORT",
    "WEB_HOST",
    "INTERNAL_API_URL",
    "WIKI_NAME",
    "WIKI_DESCRIPTION",
    "NODE_ENV",
)
WORKER_KEYS = ("REDIS_URL", "INTERNAL_API_URL", "SERVICE_TOKEN")
SHUTDOWN_TIMEOUT = 5


def read_dotenv(path: Path) -> dict[str, str]:
    """Read simple KEY=VALUE records without shell expansion or execution."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not key or not key.replace("_", "").isalnum() or key[0].isdigit():
            raise ValueError(f"Invalid .env record on line {line_number}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        values[key] = value
    return values


def group_exists(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # macOS can report EPERM while the last member of a group is exiting.
        return True
    return True


def refresh_groups(groups: dict[int, subprocess.Popen[bytes]]) -> None:
    """Reap leaders; forget empty groups permanently before their IDs can be reused."""
    for pgid, leader in list(groups.items()):
        if leader.poll() is not None and not group_exists(pgid):
            del groups[pgid]


def stop(groups: dict[int, subprocess.Popen[bytes]], timeout: float = SHUTDOWN_TIMEOUT) -> None:
    """Give entire process groups time to exit before escalating to SIGKILL."""
    refresh_groups(groups)
    for pgid in list(groups):
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            groups.pop(pgid).poll()

    deadline = time.monotonic() + timeout
    while groups:
        refresh_groups(groups)
        remaining = deadline - time.monotonic()
        if not groups or remaining <= 0:
            break
        time.sleep(min(0.05, remaining))

    for pgid in groups:
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for process in groups.values():
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass


def main() -> int:
    try:
        configured = read_dotenv(ROOT / ".env")
    except (OSError, ValueError) as error:
        print(f"Cannot read .env: {error}", file=sys.stderr)
        return 2

    merged_env = {**configured, **os.environ}
    wiki_root = merged_env.get("WIKI_ROOT")
    if wiki_root and not Path(wiki_root).is_absolute():
        merged_env["WIKI_ROOT"] = str((ROOT / wiki_root).resolve())

    app_env = os.environ.copy()
    app_env.update({key: merged_env[key] for key in APP_KEYS if key in merged_env})
    worker_env = {key: merged_env[key] for key in WORKER_KEYS if key in merged_env}
    worker_env.update({key: os.environ[key] for key in ("PATH", "HOME") if key in os.environ})

    commands = [
        (
            "worker",
            ["uv", "run", "--directory", "services/worker", "--", "python", "-m", "mdwiki_worker"],
            worker_env,
        ),
        (
            "api/web",
            ["pnpm", "--parallel", "--filter", "@md-wiki/api", "--filter", "@md-wiki/web", "dev"],
            app_env,
        ),
    ]
    leaders: dict[str, subprocess.Popen[bytes]] = {}
    groups: dict[int, subprocess.Popen[bytes]] = {}
    shutdown_signal = None
    shutdown_signals = (signal.SIGINT, signal.SIGTERM)
    previous_handlers = {signum: signal.getsignal(signum) for signum in shutdown_signals}

    def request_shutdown(signum: int, _frame: object) -> None:
        nonlocal shutdown_signal
        if shutdown_signal is None:
            shutdown_signal = signum

    for signum in shutdown_signals:
        signal.signal(signum, request_shutdown)
    try:
        for name, command, environment in commands:
            process = subprocess.Popen(command, cwd=ROOT, env=environment, start_new_session=True)
            leaders[name] = process
            groups[process.pid] = process
            print(f"Started {name} (pid {process.pid})", flush=True)

        worker_reported_clean_exit = False
        while True:
            refresh_groups(groups)
            if shutdown_signal is not None:
                return 128 + shutdown_signal
            worker_code = leaders["worker"].returncode
            apps_code = leaders["api/web"].returncode
            if worker_code is not None:
                if worker_code != 0:
                    print(f"Worker failed with status {worker_code}; stopping development stack", file=sys.stderr)
                    return worker_code if worker_code > 0 else 1
                if not worker_reported_clean_exit:
                    print("Worker exited cleanly", flush=True)
                    worker_reported_clean_exit = True
            if apps_code is not None:
                return apps_code
            time.sleep(0.2)
    finally:
        try:
            stop(groups)
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)


if __name__ == "__main__":
    raise SystemExit(main())
