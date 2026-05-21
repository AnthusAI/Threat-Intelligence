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
from .reference_curation_signals import (
    reference_title_subtitle_batch,
    reference_title_subtitle_enrich_catalog_file,
    reference_title_subtitle_resolve,
    reference_quality_assess,
    reference_quality_assess_batch,
    reference_quality_get,
    reference_quality_list,
    reference_quality_set,
    reference_summarize,
    reference_summarize_batch,
    reference_list,
    reference_summaries,
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
    execute_parser.add_argument("--max-evidence-items", type=int, default=20)
    execute_parser.add_argument("--research-mode", default="")

    semantic_search_parser = subparsers.add_parser(
        "search-semantic-nodes",
        help="Search semantic nodes/entities by text query",
    )
    semantic_search_parser.add_argument("--query", required=True)
    semantic_search_parser.add_argument("--limit", type=int, default=10)
    semantic_search_parser.add_argument("--category-set-id", default="")

    references_parser = subparsers.add_parser(
        "references",
        help="Reference curation utilities",
    )
    references_subparsers = references_parser.add_subparsers(dest="references_command")

    list_parser = references_subparsers.add_parser(
        "list",
        help="List current References in a corpus, newest first by default",
    )
    list_parser.add_argument("--corpus-key", required=True)
    list_parser.add_argument("--limit", type=int, default=25)
    list_parser.add_argument("--status", default="")
    list_parser.add_argument("--order", choices=["newest", "oldest"], default="newest")
    list_parser.add_argument("--scan-limit", type=int, default=1000)

    summaries_parser = references_subparsers.add_parser(
        "summaries",
        help="List budgeted summary Messages linked to one Reference",
    )
    summaries_parser.add_argument("--reference", required=True)
    summaries_parser.add_argument("--max-tokens", type=int)

    summarize_parser = references_subparsers.add_parser(
        "summarize",
        help="Create or refresh one budgeted Reference summary Message",
    )
    summarize_parser.add_argument("--reference", required=True)
    summarize_parser.add_argument("--max-tokens", type=int, required=True)
    summarize_parser.add_argument("--summary-text", default="")
    summarize_parser.add_argument("--source-text", default="")
    summarize_parser.add_argument("--source-text-file", default="")
    summarize_parser.add_argument("--model", default="gpt-5.4-mini")
    summarize_parser.add_argument("--apply", action="store_true")
    summarize_parser.add_argument("--refresh", action="store_true")

    summarize_batch_parser = references_subparsers.add_parser(
        "summarize-batch",
        help="Create budgeted summaries for references in a corpus",
    )
    summarize_batch_parser.add_argument("--corpus-key", required=True)
    summarize_batch_parser.add_argument("--budgets", default="100,200,500")
    summarize_batch_parser.add_argument("--only-missing", default="true")
    summarize_batch_parser.add_argument("--max-count", type=int, default=0)
    summarize_batch_parser.add_argument("--status", default="accepted")
    summarize_batch_parser.add_argument("--scan-limit", type=int, default=5000)
    summarize_batch_parser.add_argument("--model", default="gpt-5.4-mini")
    summarize_batch_parser.add_argument("--apply", action="store_true")
    summarize_batch_parser.add_argument("--refresh", action="store_true")

    quality_parser = references_subparsers.add_parser(
        "quality",
        help="Reference quality curation utilities",
    )
    quality_subparsers = quality_parser.add_subparsers(dest="quality_command")

    quality_set_parser = quality_subparsers.add_parser(
        "set",
        help="Set the accepted one-to-five-star quality rating for a Reference",
    )
    quality_set_parser.add_argument("--reference", required=True)
    quality_set_parser.add_argument("--rating", type=int, required=True)
    quality_set_parser.add_argument("--note", default="")
    quality_set_parser.add_argument("--actor-label", default="papyrus-newsroom")
    quality_set_parser.add_argument("--apply", action="store_true")
    quality_set_parser.add_argument("--refresh", action="store_true")
    quality_set_parser.add_argument("--persist-local-metadata", default="true")

    quality_assess_parser = quality_subparsers.add_parser(
        "assess",
        help="Use an LLM to assess and optionally set one Reference quality rating",
    )
    quality_assess_parser.add_argument("--reference", required=True)
    quality_assess_parser.add_argument("--model", default="gpt-5.4-mini")
    quality_assess_parser.add_argument("--source-text", default="")
    quality_assess_parser.add_argument("--source-text-file", default="")
    quality_assess_parser.add_argument("--apply", action="store_true")
    quality_assess_parser.add_argument("--refresh", action="store_true")
    quality_assess_parser.add_argument("--persist-local-metadata", default="true")

    quality_assess_batch_parser = quality_subparsers.add_parser(
        "assess-batch",
        help="Use an LLM to assess quality ratings for recent References in a corpus",
    )
    quality_assess_batch_parser.add_argument("--corpus-key", required=True)
    quality_assess_batch_parser.add_argument("--max-count", type=int, default=10)
    quality_assess_batch_parser.add_argument("--status", default="accepted")
    quality_assess_batch_parser.add_argument("--model", default="gpt-5.4-mini")
    quality_assess_batch_parser.add_argument("--only-missing", default="true")
    quality_assess_batch_parser.add_argument("--scan-limit", type=int, default=1000)
    quality_assess_batch_parser.add_argument("--apply", action="store_true")
    quality_assess_batch_parser.add_argument("--refresh", action="store_true")
    quality_assess_batch_parser.add_argument("--persist-local-metadata", default="true")

    quality_get_parser = quality_subparsers.add_parser(
        "get",
        help="Get the current accepted quality rating for a Reference",
    )
    quality_get_parser.add_argument("--reference", required=True)

    quality_list_parser = quality_subparsers.add_parser(
        "list",
        help="List Reference quality ratings for a corpus",
    )
    quality_list_parser.add_argument("--corpus-key", required=True)
    quality_list_parser.add_argument("--rating", type=int)
    quality_list_parser.add_argument("--min-rating", type=int)
    quality_list_parser.add_argument("--limit", type=int, default=100)

    title_subtitle_parser = references_subparsers.add_parser(
        "title-subtitle",
        help="Resolve and persist missing Reference titles/subtitles",
    )
    title_subtitle_subparsers = title_subtitle_parser.add_subparsers(dest="title_subtitle_command")

    title_subtitle_resolve_parser = title_subtitle_subparsers.add_parser(
        "resolve",
        help="Resolve title/subtitle for one Reference",
    )
    title_subtitle_resolve_parser.add_argument("--reference", required=True)
    title_subtitle_resolve_parser.add_argument("--model", default="gpt-5.4-mini")
    title_subtitle_resolve_parser.add_argument("--web-search", default="true")
    title_subtitle_resolve_parser.add_argument("--source-text", default="")
    title_subtitle_resolve_parser.add_argument("--source-text-file", default="")
    title_subtitle_resolve_parser.add_argument("--apply", action="store_true")
    title_subtitle_resolve_parser.add_argument("--refresh", action="store_true")
    title_subtitle_resolve_parser.add_argument("--summary", default="true")
    title_subtitle_resolve_parser.add_argument("--summary-max-tokens", type=int, default=500)
    title_subtitle_resolve_parser.add_argument("--refresh-summary", action="store_true")
    title_subtitle_resolve_parser.add_argument("--persist-local-metadata", default="true")
    title_subtitle_resolve_parser.add_argument("--vector-sync", default="true")

    title_subtitle_batch_parser = title_subtitle_subparsers.add_parser(
        "batch",
        help="Resolve title/subtitle for a batch of References",
    )
    title_subtitle_batch_parser.add_argument("--corpus-key", required=True)
    title_subtitle_batch_parser.add_argument("--status", default="all")
    title_subtitle_batch_parser.add_argument("--max-count", type=int, default=10)
    title_subtitle_batch_parser.add_argument("--model", default="gpt-5.4-mini")
    title_subtitle_batch_parser.add_argument("--web-search", default="true")
    title_subtitle_batch_parser.add_argument("--only-missing", default="true")
    title_subtitle_batch_parser.add_argument("--scan-limit", type=int, default=1000)
    title_subtitle_batch_parser.add_argument("--apply", action="store_true")
    title_subtitle_batch_parser.add_argument("--refresh", action="store_true")
    title_subtitle_batch_parser.add_argument("--summary", default="true")
    title_subtitle_batch_parser.add_argument("--summary-max-tokens", type=int, default=500)
    title_subtitle_batch_parser.add_argument("--refresh-summary", action="store_true")
    title_subtitle_batch_parser.add_argument("--persist-local-metadata", default="true")
    title_subtitle_batch_parser.add_argument("--vector-sync", default="true")

    title_subtitle_catalog_parser = title_subtitle_subparsers.add_parser(
        "enrich-catalog",
        help="Enrich a reference intake catalog with title/subtitle fields",
    )
    title_subtitle_catalog_parser.add_argument("--catalog", required=True)
    title_subtitle_catalog_parser.add_argument("--output", required=True)
    title_subtitle_catalog_parser.add_argument("--model", default="gpt-5.4-mini")
    title_subtitle_catalog_parser.add_argument("--web-search", default="true")
    title_subtitle_catalog_parser.add_argument("--summary", default="true")
    title_subtitle_catalog_parser.add_argument("--summary-max-tokens", type=int, default=500)
    title_subtitle_catalog_parser.add_argument("--refresh-summary", action="store_true")
    title_subtitle_catalog_parser.add_argument("--only-missing", default="true")
    title_subtitle_catalog_parser.add_argument("--max-count", type=int, default=0)
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
            research_mode=args.research_mode,
        )
    elif args.command == "search-semantic-nodes":
        payload = papyrus_search_semantic_nodes(
            query=args.query,
            limit=args.limit,
            category_set_id=args.category_set_id,
        )
    elif args.command == "references":
        payload = _run_references_command(args)
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
    if isinstance(payload, dict) and payload.get("partialFailure"):
        return 2
    return 0


def _run_references_command(args: argparse.Namespace) -> dict:
    if args.references_command == "summarize":
        return reference_summarize(
            reference_id=args.reference,
            max_tokens=args.max_tokens,
            summary_text=args.summary_text,
            source_text=args.source_text,
            source_text_file=args.source_text_file,
            model=args.model,
            apply=args.apply,
            refresh=args.refresh,
        )
    if args.references_command == "list":
        return reference_list(
            corpus_key=args.corpus_key,
            limit=args.limit,
            status=args.status,
            order=args.order,
            scan_limit=args.scan_limit,
        )
    if args.references_command == "summaries":
        return reference_summaries(
            reference_id=args.reference,
            max_tokens=args.max_tokens,
        )
    if args.references_command == "summarize-batch":
        return reference_summarize_batch(
            corpus_key=args.corpus_key,
            budgets=_parse_int_list(args.budgets),
            only_missing=_parse_bool(args.only_missing),
            max_count=args.max_count,
            status=args.status,
            scan_limit=args.scan_limit,
            model=args.model,
            apply=args.apply,
            refresh=args.refresh,
        )
    if args.references_command == "quality":
        if args.quality_command == "set":
            return reference_quality_set(
                reference_id=args.reference,
                rating=args.rating,
                note=args.note,
                actor_label=args.actor_label,
                apply=args.apply,
                refresh=args.refresh,
                persist_local_metadata=_parse_bool(args.persist_local_metadata),
            )
        if args.quality_command == "assess":
            return reference_quality_assess(
                reference_id=args.reference,
                model=args.model,
                source_text=args.source_text,
                source_text_file=args.source_text_file,
                apply=args.apply,
                refresh=args.refresh,
                persist_local_metadata=_parse_bool(args.persist_local_metadata),
            )
        if args.quality_command == "assess-batch":
            return reference_quality_assess_batch(
                corpus_key=args.corpus_key,
                max_count=args.max_count,
                status=args.status,
                model=args.model,
                apply=args.apply,
                refresh=args.refresh,
                only_missing=_parse_bool(args.only_missing),
                persist_local_metadata=_parse_bool(args.persist_local_metadata),
                scan_limit=args.scan_limit,
            )
        if args.quality_command == "get":
            return reference_quality_get(reference_id=args.reference)
        if args.quality_command == "list":
            return reference_quality_list(
                corpus_key=args.corpus_key,
                rating=args.rating,
                min_rating=args.min_rating,
                limit=args.limit,
            )
    if args.references_command == "title-subtitle":
        if args.title_subtitle_command == "resolve":
            return reference_title_subtitle_resolve(
                reference_id=args.reference,
                model=args.model,
                apply=args.apply,
                refresh=args.refresh,
                summary=_parse_bool(args.summary),
                summary_max_tokens=args.summary_max_tokens,
                refresh_summary=args.refresh_summary,
                web_search=_parse_bool(args.web_search),
                persist_local_metadata=_parse_bool(args.persist_local_metadata),
                vector_sync=_parse_bool(args.vector_sync),
                source_text=args.source_text,
                source_text_file=args.source_text_file,
            )
        if args.title_subtitle_command == "batch":
            return reference_title_subtitle_batch(
                corpus_key=args.corpus_key,
                max_count=args.max_count,
                status=args.status,
                model=args.model,
                apply=args.apply,
                refresh=args.refresh,
                summary=_parse_bool(args.summary),
                summary_max_tokens=args.summary_max_tokens,
                refresh_summary=args.refresh_summary,
                only_missing=_parse_bool(args.only_missing),
                web_search=_parse_bool(args.web_search),
                persist_local_metadata=_parse_bool(args.persist_local_metadata),
                vector_sync=_parse_bool(args.vector_sync),
                scan_limit=args.scan_limit,
            )
        if args.title_subtitle_command == "enrich-catalog":
            return reference_title_subtitle_enrich_catalog_file(
                catalog_path=args.catalog,
                output_path=args.output,
                model=args.model,
                web_search=_parse_bool(args.web_search),
                summary=_parse_bool(args.summary),
                summary_max_tokens=args.summary_max_tokens,
                refresh_summary=args.refresh_summary,
                only_missing=_parse_bool(args.only_missing),
                max_count=args.max_count,
            )
    raise SystemExit("Missing or unsupported references subcommand.")


def _parse_int_list(value: str) -> list[int]:
    return [int(entry.strip()) for entry in str(value or "").split(",") if entry.strip()]


def _parse_bool(value: str | bool) -> bool:
    if isinstance(value, bool):
        return value
    normalized = str(value or "").strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    raise ValueError(f"Invalid boolean value: {value}")
