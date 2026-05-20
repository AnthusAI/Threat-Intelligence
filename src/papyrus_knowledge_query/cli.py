from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .engine import run_knowledge_query
from .services import build_environment_services
from .vector_index import VectorIndexOptions, index_reference_passages


def add_knowledge_query_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser(
        "knowledge-query",
        help="Run the shared Papyrus knowledge query engine",
    )
    parser.add_argument("--input", default="", help="JSON input file, or '-' for stdin")
    parser.add_argument("--query", default="", help="Semantic query text")
    parser.add_argument("--anchor", action="append", default=[], help="Anchor as kind:id or kind:lineageId")
    parser.add_argument("--profile", default="researcher", choices=["researcher", "reporter", "editor", "reviewer", "chat"])
    parser.add_argument("--format", default="structured", choices=["structured", "markdown", "both"])
    parser.add_argument("--max-tokens", type=int, default=0)
    parser.add_argument("--depth", type=int, default=None)
    parser.add_argument("--top-k", type=int, default=None)


def add_knowledge_vector_index_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser(
        "knowledge-vector-index",
        help="Index accepted reference extracted-text passages into the configured S3 vector index",
    )
    parser.add_argument("--corpus-id", default="")
    parser.add_argument("--category-set-id", default="")
    parser.add_argument("--reference-id", action="append", default=[], help="Reference id, lineageId, or externalItemId to index")
    parser.add_argument("--max-references", type=int, default=0)
    parser.add_argument("--max-chunks-per-reference", type=int, default=8)
    parser.add_argument("--chunk-words", type=int, default=180)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--dry-run", action="store_true")


def run_knowledge_query_cli(args: argparse.Namespace) -> dict[str, Any]:
    payload = _load_input(args.input) if args.input else _input_from_args(args)
    return run_knowledge_query(payload, build_environment_services())


def run_knowledge_vector_index_cli(args: argparse.Namespace) -> dict[str, Any]:
    options = VectorIndexOptions(
        corpus_id=args.corpus_id,
        category_set_id=args.category_set_id,
        reference_ids=tuple(args.reference_id or ()),
        max_references=args.max_references or None,
        max_chunks_per_reference=max(1, args.max_chunks_per_reference),
        chunk_words=max(80, args.chunk_words),
        batch_size=max(1, min(args.batch_size, 500)),
        dry_run=bool(args.dry_run),
    )
    return index_reference_passages(build_environment_services(), options)


def _load_input(path: str) -> dict[str, Any]:
    if path == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(path).read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise TypeError("knowledge-query input file must contain a JSON object")
    return payload


def _input_from_args(args: argparse.Namespace) -> dict[str, Any]:
    scope: dict[str, Any] = {}
    if args.depth is not None:
        scope["depth"] = args.depth
    if args.top_k is not None:
        scope["topK"] = args.top_k
    output: dict[str, Any] = {"format": args.format}
    if args.max_tokens:
        output["maxTokens"] = args.max_tokens
    return {
        "anchors": [_parse_anchor(value) for value in args.anchor],
        "semanticQuery": args.query,
        "scope": scope,
        "profile": args.profile,
        "output": output,
    }


def _parse_anchor(value: str) -> dict[str, Any]:
    if ":" not in value:
        raise ValueError("--anchor must use kind:id")
    kind, object_id = value.split(":", 1)
    kind = kind.strip()
    object_id = object_id.strip()
    if not kind or not object_id:
        raise ValueError("--anchor must use kind:id")
    return {"kind": kind, "id": object_id, "lineageId": object_id}
