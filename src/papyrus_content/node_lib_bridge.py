from __future__ import annotations

import json
import subprocess
from typing import Any

from .env import PAPYRUS_ROOT

BRIDGE_SCRIPT = PAPYRUS_ROOT / "scripts" / "lib" / "papyrus-python-bridge.cjs"


def call_node_export(module_relative_path: str, export_name: str, *args: Any) -> Any:
    module_path = PAPYRUS_ROOT / module_relative_path
    if not module_path.is_file():
        raise FileNotFoundError(f"Missing Node module at {module_path}")
    if not BRIDGE_SCRIPT.is_file():
        raise FileNotFoundError(f"Missing Node bridge at {BRIDGE_SCRIPT}")
    payload = {
        "modulePath": str(module_path),
        "exportName": export_name,
        "args": list(args),
    }
    completed = subprocess.run(
        ["node", str(BRIDGE_SCRIPT)],
        input=json.dumps(payload),
        cwd=PAPYRUS_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Node bridge failed"
        raise RuntimeError(message)
    text = completed.stdout.strip()
    if not text:
        return None
    return json.loads(text)
