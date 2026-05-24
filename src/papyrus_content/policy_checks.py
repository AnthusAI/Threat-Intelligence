from __future__ import annotations

from pathlib import Path

from .env import PAPYRUS_ROOT


ALLOWED_BACKEND_NODE_SCRIPT_FILES = {
    "scripts/test-newsroom-card-layout.cjs",
    "scripts/test-newsroom-session.cjs",
    "scripts/favicon/generate-favicon.mjs",
}


def check_backend_node_scripts(_flags: list[str]) -> None:
    scripts_dir = PAPYRUS_ROOT / "scripts"
    violations: list[str] = []
    for path in scripts_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in {".js", ".cjs", ".mjs"}:
            continue
        relative = path.relative_to(PAPYRUS_ROOT).as_posix()
        if relative.startswith("scripts/lib/"):
            violations.append(relative)
            continue
        if relative not in ALLOWED_BACKEND_NODE_SCRIPT_FILES:
            violations.append(relative)
    if violations:
        rendered = "\n".join(f"- {entry}" for entry in sorted(set(violations)))
        raise RuntimeError(
            "Backend Node utility policy violation: non-frontend JS scripts detected under scripts/.\n"
            "Allowed frontend JS scripts are limited to explicit UI/test/build harness files.\n"
            f"Violations:\n{rendered}"
        )
    print("policy\tbackend-node-scripts\tok")
