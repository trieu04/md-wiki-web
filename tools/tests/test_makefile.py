import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def tunnel_sock(repo):
    """Mirror of the Makefile's TUNNEL_SOCK (short /tmp path keyed by checkout path)."""
    digest = hashlib.sha1(str(repo).encode()).hexdigest()[:12]
    return f"/tmp/mw-tunnel-{digest}.sock"


@pytest.mark.parametrize("local", [False, True])
def test_docker_target_and_ports(tmp_path, local):
    repo = tmp_path / "repo with spaces"
    repo.mkdir()
    shutil.copyfile(ROOT / "Makefile", repo / "Makefile")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    trace = tmp_path / "trace.jsonl"
    keys = ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "PG_HOST_PORT", "REDIS_HOST_PORT")
    for name in ("docker", "ssh"):
        tool = bin_dir / name
        code = (
            "import json, os, sys\n"
            f"with open(os.environ['TRACE'], 'a') as log:\n"
            f"    log.write(json.dumps([{name!r}, sys.argv[1:], "
            f"[os.environ.get(key) for key in {keys!r}]]) + '\\n')\n"
            f"sys.exit({name == 'ssh'} and 'check' in sys.argv)\n"
        )
        tool.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} -c {shlex.quote(code)} \"$@\"\n")
        tool.chmod(0o755)
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.defpath}",
        "DOCKER_HOST": "ssh://other-engine",
        "DOCKER_CONTEXT": "saved-remote",
        "TRACE": str(trace),
    }
    args = ["MW_DOCKER_HOST="] if local else []
    subprocess.run(["make", *args, "up", "ps", "down"], cwd=repo, env=env, check=True, timeout=15)

    calls = [json.loads(line) for line in trace.read_text().splitlines()]
    config_dir = repo / ".docker-local"
    compose = ["compose", "-f", str(repo / "infra" / "docker-compose.yml")]
    expected_env = (
        [None, "default", None, "5432", "6379"]
        if local
        else ["ssh://fd", None, str(config_dir), "55432", "56379"]
    )
    assert [call for call in calls if call[0] == "docker"] == [
        ["docker", compose + ["up", "-d", "--wait"], expected_env],
        ["docker", compose + ["ps", "--format", "{{.Service}} {{.Health}}"], expected_env],
        ["docker", compose + ["down"], expected_env],
    ]

    ssh_args = [args for name, args, _ in calls if name == "ssh"]
    if local:
        assert ssh_args == []
    else:
        socket_arg = ["-S", tunnel_sock(config_dir.parent)]
        assert ssh_args == [
            socket_arg + ["-O", "check", "fd"],
            ["-f", "-N", "-M", *socket_arg, "-o", "ExitOnForwardFailure=yes", "-o",
             "ServerAliveInterval=30", "-L", "127.0.0.1:5432:127.0.0.1:55432", "-L",
             "127.0.0.1:6379:127.0.0.1:56379", "fd"],
            socket_arg + ["-O", "exit", "fd"],
        ]
        config = json.loads((config_dir / "config.json").read_text())
        assert config["credsStore"] == "mwnone"
        assert os.access(config_dir / "bin" / "docker-credential-mwnone", os.X_OK)
        assert not (config_dir / "tunnel.spec").exists()


@pytest.mark.parametrize("engine,override,host,port", [
    ("ssh://builder", None, "builder", None),
    ("ssh://dev@builder:2222", None, "dev@builder", "2222"),
    ("ssh://dev@builder:2222", "relay", "relay", "2222"),
])
def test_tunnel_uses_engine_ssh_destination(engine, override, host, port):
    args = [f"MW_DOCKER_HOST={engine}"]
    if override:
        args.append(f"MW_TUNNEL_HOST={override}")
    recipe = subprocess.check_output(
        ["make", "-n", *args, "tunnel", "tunnel-down"], cwd=ROOT,
        env={"PATH": os.defpath}, text=True, timeout=5,
    ).replace("\\\n", " ")
    # Check all control and launch commands, including the standalone tunnel-down.
    commands = [
        shlex.split(fragment.splitlines()[0].split(";", 1)[0].split(" 2>", 1)[0])
        for fragment in recipe.split("ssh ")[1:]
    ]
    assert len(commands) == 4
    for command in commands:
        assert command[-1] == host
        if port:
            assert command[command.index("-p") + 1] == port
        else:
            assert "-p" not in command


@pytest.mark.parametrize("port_override", ["PG_HOST_PORT=55433", "REDIS_HOST_PORT=56380"])
def test_tunnel_reuses_matching_forwards_and_reopens_changed_ones(tmp_path, port_override):
    shutil.copyfile(ROOT / "Makefile", tmp_path / "Makefile")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    trace = tmp_path / "trace.jsonl"
    code = (
        "import json, os, sys\n"
        "from pathlib import Path\n"
        "args = sys.argv[1:]\n"
        "with open(os.environ['TRACE'], 'a') as log:\n"
        "    log.write(json.dumps(args) + '\\n')\n"
        "socket = Path(args[args.index('-S') + 1])\n"
        "if 'check' in args:\n"
        "    sys.exit(not socket.exists())\n"
        "if 'exit' in args:\n"
        "    socket.unlink()\n"
        "else:\n"
        "    socket.touch(exist_ok=False)\n"
    )
    ssh = bin_dir / "ssh"
    ssh.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} -c {shlex.quote(code)} \"$@\"\n")
    ssh.chmod(0o755)
    env = {"PATH": f"{bin_dir}{os.pathsep}{os.defpath}", "TRACE": str(trace)}

    def make(*args):
        return subprocess.run(
            ["make", *args], cwd=tmp_path, env=env, check=True, timeout=15,
            capture_output=True, text=True,
        )

    make("docker-config", "tunnel")
    assert "tunnel already open" in make("tunnel").stdout
    make(port_override, "tunnel")
    assert "tunnel already open" in make(port_override, "tunnel").stdout

    calls = [json.loads(line) for line in trace.read_text().splitlines()]
    config_dir = tmp_path / ".docker-local"
    socket_arg = ["-S", tunnel_sock(config_dir.parent)]
    check = socket_arg + ["-O", "check", "fd"]
    exit_master = socket_arg + ["-O", "exit", "fd"]
    launch = ["-f", "-N", "-M", *socket_arg, "-o", "ExitOnForwardFailure=yes", "-o",
              "ServerAliveInterval=30"]
    pg_port = "55433" if port_override.startswith("PG_HOST_PORT=") else "55432"
    redis_port = "56380" if port_override.startswith("REDIS_HOST_PORT=") else "56379"
    pg_forward = f"127.0.0.1:5432:127.0.0.1:{pg_port}"
    redis_forward = f"127.0.0.1:6379:127.0.0.1:{redis_port}"
    assert calls == [
        check, launch + ["-L", "127.0.0.1:5432:127.0.0.1:55432", "-L",
                         "127.0.0.1:6379:127.0.0.1:56379", "fd"],
        check,
        check, exit_master, launch + ["-L", pg_forward, "-L", redis_forward, "fd"],
        check,
    ]
    assert (config_dir / "tunnel.spec").read_text().splitlines() == ["fd", pg_forward, redis_forward]
