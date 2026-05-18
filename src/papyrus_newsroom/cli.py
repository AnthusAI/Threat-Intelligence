from __future__ import annotations

import argparse
import json
import sys

from .newsroom import BIBLICUS_ROOT, PAPYRUS_ROOT, papyrus_build_assignment_agent_context
from .tactus_runtime import execute_tactus


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Papyrus newsroom helper entrypoint")
    subparsers = parser.add_subparsers(dest="command")

    build_context_parser = subparsers.add_parser(
        "build-assignment-agent-context",
        help="Build a budgeted live agent context pack for one assignment",
    )
    build_context_parser.add_argument("--assignment-id", required=True)
    build_context_parser.add_argument("--context-profile", default="")
    build_context_parser.add_argument("--max-tokens", type=int, default=0)
    build_context_parser.add_argument("--recent-days", type=int, default=30)

    execute_parser = subparsers.add_parser(
        "execute-tactus",
        help="Execute a short Papyrus Tactus snippet",
    )
    execute_parser.add_argument("tactus", nargs="?", default="")
    execute_parser.add_argument("--file", default="")

    args = parser.parse_args(argv)
    if args.command == "build-assignment-agent-context":
        payload = papyrus_build_assignment_agent_context(
            assignment_id=args.assignment_id,
            context_profile=args.context_profile,
            max_tokens=args.max_tokens,
            recent_days=args.recent_days,
        )
    elif args.command == "execute-tactus":
        if args.file:
            with open(args.file, "r", encoding="utf-8") as handle:
                tactus = handle.read()
        else:
            tactus = args.tactus or sys.stdin.read()
        payload = execute_tactus(tactus)
    else:
        payload = {
            "module": "papyrus_newsroom",
            "python": sys.executable,
            "papyrusRoot": str(PAPYRUS_ROOT),
            "biblicusRoot": str(BIBLICUS_ROOT),
        }
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    return 0
