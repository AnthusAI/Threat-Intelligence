from __future__ import annotations

import os
import subprocess

from .env import PAPYRUS_ROOT

CONTENT_CLI = PAPYRUS_ROOT / "scripts" / "content-cli.cjs"
SKIP_PYTHON_ENV = "PAPYRUS_CONTENT_SKIP_PYTHON"


def run_node_content_cli(group: str, command: str, flags: list[str]) -> int:
    if not CONTENT_CLI.is_file():
        raise FileNotFoundError(f"Missing Node content CLI at {CONTENT_CLI}")
    env = {**os.environ, SKIP_PYTHON_ENV: "1"}
    argv = ["node", str(CONTENT_CLI), group, command, *flags]
    completed = subprocess.run(argv, cwd=PAPYRUS_ROOT, env=env)
    return int(completed.returncode or 0)


def delegate_or_raise(group: str, command: str, flags: list[str]) -> None:
    exit_code = run_node_content_cli(group, command, flags)
    if exit_code != 0:
        raise RuntimeError(f"Node content CLI exited with status {exit_code}")
