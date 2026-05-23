from __future__ import annotations

import json
import os
import subprocess
from typing import Any

from .env import PAPYRUS_ROOT

BRIDGE_SCRIPT = PAPYRUS_ROOT / "scripts" / "lib" / "papyrus-content-cli-bridge.cjs"


def call_content_cli_export(export_name: str, *args: Any) -> Any:
    if not BRIDGE_SCRIPT.is_file():
        raise FileNotFoundError(f"Missing content CLI bridge at {BRIDGE_SCRIPT}")
    payload = {"exportName": export_name, "args": list(args)}
    env = os.environ.copy()
    env["PAPYRUS_CONTENT_SKIP_PYTHON"] = "1"
    completed = subprocess.run(
        ["node", str(BRIDGE_SCRIPT)],
        input=json.dumps(payload),
        cwd=PAPYRUS_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "content CLI bridge failed"
        raise RuntimeError(message)
    text = completed.stdout.strip()
    if not text:
        return None
    return json.loads(text)
