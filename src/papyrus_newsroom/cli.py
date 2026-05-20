from __future__ import annotations

import argparse
import json
import os
import sys

from .newsroom import (
    BIBLICUS_ROOT,
    PAPYRUS_ROOT,
    papyrus_build_assignment_agent_context,
    papyrus_search_semantic_nodes,
)
from .tactus_runtime import execute_tactus_harnessed
from papyrus_knowledge_query.cli import (
    add_knowledge_query_parser,
    add_knowledge_vector_index_parser,
    run_knowledge_query_cli,
    run_knowledge_vector_index_cli,
)


def _load_repo_dotenv() -> None:
    dotenv_path = PAPYRUS_ROOT / ".env"
    if not dotenv_path.exists():
        return
    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and ((value[0] == value[-1]) and value[0] in {"'", '"'}):
            value = value[1:-1]
        os.environ[key] = value


def main(argv: list[str] | None = None) -> int:
    _load_repo_dotenv()
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
    execute_parser.add_argument("--harness", default="raw")
    execute_parser.add_argument("--assignment-id", default="")
    execute_parser.add_argument("--assignment-item-json", default="")
    execute_parser.add_argument("--corpus-key", default="")
    execute_parser.add_argument("--max-evidence-items", type=int, default=8)

    semantic_search_parser = subparsers.add_parser(
        "search-semantic-nodes",
        help="Search semantic nodes/entities by text query",
    )
    semantic_search_parser.add_argument("--query", required=True)
    semantic_search_parser.add_argument("--limit", type=int, default=10)
    semantic_search_parser.add_argument("--category-set-id", default="")
    add_knowledge_query_parser(subparsers)
    add_knowledge_vector_index_parser(subparsers)

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
        payload = execute_tactus_harnessed(
            tactus,
            harness=args.harness,
            assignment_id=args.assignment_id,
            assignment_item_json=args.assignment_item_json,
            corpus_key=args.corpus_key,
            max_evidence_items=args.max_evidence_items,
        )
    elif args.command == "search-semantic-nodes":
        payload = papyrus_search_semantic_nodes(
            query=args.query,
            limit=args.limit,
            category_set_id=args.category_set_id,
        )
    elif args.command == "knowledge-query":
        payload = run_knowledge_query_cli(args)
    elif args.command == "knowledge-vector-index":
        payload = run_knowledge_vector_index_cli(args)
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
