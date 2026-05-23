from __future__ import annotations

import argparse
import json
import os
import sys

from .coverage_theme import (
    coverage_theme_run,
    editions_plan,
    load_json_file,
    parse_csv,
    parse_section_budgets,
    signals_trend_report,
    story_budget_output,
)
from .newsroom import (
    BIBLICUS_ROOT,
    PAPYRUS_ROOT,
    papyrus_build_assignment_agent_context,
    papyrus_search_semantic_nodes,
)
from .reference_curation_signals import (
    reference_curate_recent,
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

    curate_recent_parser = references_subparsers.add_parser(
        "curate-recent",
        help="Curate recent references end-to-end (identifier prepass, title/subtitle, summary, quality)",
    )
    curate_recent_parser.add_argument("--corpus-key", required=True)
    curate_recent_parser.add_argument("--reference", action="append", default=[])
    curate_recent_parser.add_argument("--since-hours", type=int, default=48)
    curate_recent_parser.add_argument("--since", default="")
    curate_recent_parser.add_argument(
        "--all",
        action="store_true",
        help="Select references without a recency window (for bulk post-ingestion enrichment).",
    )
    curate_recent_parser.add_argument("--max-count", type=int, default=0)
    curate_recent_parser.add_argument("--scan-limit", type=int, default=1000)
    curate_recent_parser.add_argument("--max-parallel", type=int, default=1)
    curate_recent_parser.add_argument("--model", default="gpt-5.4-mini")
    curate_recent_parser.add_argument("--summary-max-tokens", type=int, default=500)
    curate_recent_parser.add_argument("--refresh-summary", action="store_true")
    curate_recent_parser.add_argument("--refresh-quality", action="store_true")
    curate_recent_parser.add_argument("--resume", default="")
    curate_recent_parser.add_argument("--apply", action="store_true")
    curate_recent_parser.add_argument("--dry-run", action="store_true")
    curate_recent_parser.add_argument("--json", action="store_true")

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
    summarize_batch_parser.add_argument("--max-parallel", type=int, default=4)
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
    _add_signals_parser(subparsers)
    _add_editions_parser(subparsers)
    _add_coverage_themes_parser(subparsers)
    _add_story_budget_parser(subparsers)
    _add_assignments_parser(subparsers)
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
    elif args.command == "signals":
        payload = _run_signals_command(args)
    elif args.command == "editions":
        payload = _run_editions_command(args)
    elif args.command == "coverage-themes":
        payload = _run_coverage_themes_command(args)
    elif args.command == "story-budget":
        payload = _run_story_budget_command(args)
    elif args.command == "assignments":
        payload = _run_assignments_command(args)
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
    if isinstance(payload, dict) and payload.get("ok") is False:
        return 2
    if isinstance(payload, dict) and payload.get("partialFailure"):
        return 2
    return 0


def _add_signals_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser("signals", help="Knowledge-base signal and trend utilities")
    signal_subparsers = parser.add_subparsers(dest="signals_command")
    trend_parser = signal_subparsers.add_parser(
        "trend-report",
        help="Build a private edition signal report from recent accepted knowledge-base references",
    )
    trend_parser.add_argument("--corpus-key", required=True)
    trend_parser.add_argument("--date", default="")
    trend_parser.add_argument("--category", "--category-key", dest="category_key", default="")
    trend_parser.add_argument("--topic", default="")
    trend_parser.add_argument("--coverage-key", default="")
    trend_parser.add_argument("--sections", default="")
    trend_parser.add_argument("--since-days", type=int, default=30)
    trend_parser.add_argument("--limit", type=int, default=10)
    trend_parser.add_argument("--run-id", default="")
    trend_parser.add_argument("--input", default="", help="Optional fixture JSON with references and semanticNodes")
    trend_parser.add_argument("--apply", action="store_true")
    trend_parser.add_argument("--json", action="store_true")


def _add_editions_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser("editions", help="Edition intelligence and planning utilities")
    edition_subparsers = parser.add_subparsers(dest="editions_command")
    plan_parser = edition_subparsers.add_parser(
        "plan",
        help="Plan an edition story budget from signal reports and section budgets",
    )
    plan_parser.add_argument("--date", required=True)
    plan_parser.add_argument("--sections", default=",".join(["culture", "methods", "business", "law"]))
    plan_parser.add_argument("--section-budgets", default="")
    plan_parser.add_argument("--corpus-key", default="AI-ML-research")
    plan_parser.add_argument("--category", "--category-key", dest="category_key", default="")
    plan_parser.add_argument("--topic", default="")
    plan_parser.add_argument("--coverage-key", default="")
    plan_parser.add_argument("--signal-report", default="", help="Optional signal report JSON path")
    plan_parser.add_argument("--theme-limit", type=int, default=3)
    plan_parser.add_argument("--run-id", default="")
    plan_parser.add_argument("--apply", action="store_true")
    plan_parser.add_argument("--json", action="store_true")


def _add_coverage_themes_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser("coverage-themes", help="Coverage Theme orchestration")
    coverage_subparsers = parser.add_subparsers(dest="coverage_themes_command")
    run_parser = coverage_subparsers.add_parser(
        "run",
        help="Run a Coverage Theme through plan, research, or reporting",
    )
    _add_coverage_theme_run_arguments(run_parser)
    output_parser = coverage_subparsers.add_parser(
        "output",
        help="Rediscover Coverage Theme story-budget output",
    )
    _add_story_budget_output_arguments(output_parser)


def _add_story_budget_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser("story-budget", help="Story Budget discovery utilities")
    story_budget_subparsers = parser.add_subparsers(dest="story_budget_command")
    output_parser = story_budget_subparsers.add_parser(
        "output",
        help="Show story-budget state grouped by section",
    )
    _add_story_budget_output_arguments(output_parser)


def _add_assignments_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser("assignments", help="Compatibility assignment workflow aliases")
    assignment_subparsers = parser.add_subparsers(dest="assignments_command")
    run_parser = assignment_subparsers.add_parser(
        "run-story-cycle",
        help="Compatibility alias for coverage-themes run",
    )
    _add_coverage_theme_run_arguments(run_parser)
    output_parser = assignment_subparsers.add_parser(
        "story-cycle-output",
        help="Compatibility alias for story-budget output",
    )
    _add_story_budget_output_arguments(output_parser)


def _add_coverage_theme_run_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--date", required=True)
    parser.add_argument("--topic", required=True)
    parser.add_argument("--category", "--category-key", dest="category_key", default="AI-ML-research")
    parser.add_argument("--corpus-key", default="")
    parser.add_argument("--coverage-key", default="")
    parser.add_argument("--sections", default="culture,methods,business,law")
    parser.add_argument("--section-budgets", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--through", choices=["plan", "research", "reporting"], default="reporting")
    parser.add_argument("--research-mode", default="source_discovery")
    parser.add_argument("--max-parallel-research", type=int, default=1)
    parser.add_argument("--max-parallel-reporting", type=int, default=1)
    parser.add_argument("--allow-fallback", action="store_true")
    parser.add_argument("--require-agent-success", action="store_true")
    parser.add_argument("--refresh-packets", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--json", action="store_true")


def _add_story_budget_output_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--run-id", default="")
    parser.add_argument("--edition", "--edition-id", dest="edition_id", default="")
    parser.add_argument("--coverage-key", default="")
    parser.add_argument("--section", default="")
    parser.add_argument("--input", default="", help="Optional fixture JSON state")
    parser.add_argument("--json", action="store_true")


def _run_signals_command(args: argparse.Namespace) -> dict:
    if args.signals_command == "trend-report":
        fixture = load_json_file(args.input) if args.input else {}
        return signals_trend_report(
            corpus_key=args.corpus_key,
            date=args.date,
            category_key=args.category_key,
            topic=args.topic,
            coverage_key=args.coverage_key,
            sections=parse_csv(args.sections),
            since_days=args.since_days,
            limit=args.limit,
            run_id=args.run_id,
            references=fixture.get("references") if fixture else None,
            semantic_nodes=(fixture.get("semanticNodes") or fixture.get("semantic_nodes")) if fixture else None,
            apply=args.apply,
        )
    raise SystemExit("Missing or unsupported signals subcommand.")


def _run_editions_command(args: argparse.Namespace) -> dict:
    if args.editions_command == "plan":
        sections = parse_csv(args.sections)
        return editions_plan(
            date=args.date,
            sections=sections,
            section_budgets=parse_section_budgets(args.section_budgets, sections),
            corpus_key=args.corpus_key,
            category_key=args.category_key,
            topic=args.topic,
            coverage_key=args.coverage_key,
            signal_report=load_json_file(args.signal_report) if args.signal_report else None,
            theme_limit=args.theme_limit,
            run_id=args.run_id,
            apply=args.apply,
        )
    raise SystemExit("Missing or unsupported editions subcommand.")


def _run_coverage_themes_command(args: argparse.Namespace) -> dict:
    if args.coverage_themes_command == "run":
        return _run_coverage_theme_run(args)
    if args.coverage_themes_command == "output":
        return _run_story_budget_output(args, command="coverage-themes output")
    raise SystemExit("Missing or unsupported coverage-themes subcommand.")


def _run_story_budget_command(args: argparse.Namespace) -> dict:
    if args.story_budget_command == "output":
        return _run_story_budget_output(args)
    raise SystemExit("Missing or unsupported story-budget subcommand.")


def _run_assignments_command(args: argparse.Namespace) -> dict:
    if args.assignments_command == "run-story-cycle":
        payload = _run_coverage_theme_run(args)
        payload["command"] = "assignments run-story-cycle"
        return payload
    if args.assignments_command == "story-cycle-output":
        return _run_story_budget_output(args, command="assignments story-cycle-output")
    raise SystemExit("Missing or unsupported assignments subcommand.")


def _run_coverage_theme_run(args: argparse.Namespace) -> dict:
    sections = parse_csv(args.sections)
    corpus_key = args.corpus_key or args.category_key
    return coverage_theme_run(
        date=args.date,
        topic=args.topic,
        corpus_key=corpus_key,
        category_key=args.category_key,
        coverage_key=args.coverage_key,
        sections=sections,
        section_budgets=parse_section_budgets(args.section_budgets, sections),
        run_id=args.run_id,
        through=args.through,
        research_mode=args.research_mode,
        allow_fallback=args.allow_fallback,
        require_agent_success=args.require_agent_success,
        refresh_packets=args.refresh_packets,
        apply=args.apply,
    )


def _run_story_budget_output(args: argparse.Namespace, *, command: str = "story-budget output") -> dict:
    fixture = load_json_file(args.input) if args.input else None
    payload = story_budget_output(
        run_id=args.run_id,
        edition_id=args.edition_id,
        coverage_key=args.coverage_key,
        section=args.section,
        state=fixture,
    )
    payload["command"] = command
    return payload


def _run_references_command(args: argparse.Namespace) -> dict:
    if args.references_command == "curate-recent":
        if args.apply and args.dry_run:
            raise ValueError("--apply and --dry-run cannot be used together.")
        if args.all and (args.since or args.reference):
            raise ValueError("--all cannot be combined with --since or --reference.")
        return reference_curate_recent(
            corpus_key=args.corpus_key,
            reference_ids=args.reference,
            since_hours=args.since_hours,
            since=args.since,
            curate_all=args.all,
            max_count=args.max_count,
            scan_limit=args.scan_limit,
            max_parallel=args.max_parallel,
            model=args.model,
            summary_max_tokens=args.summary_max_tokens,
            refresh_summary=args.refresh_summary,
            refresh_quality=args.refresh_quality,
            apply=(args.apply and not args.dry_run),
            resume=args.resume,
        )
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
            max_parallel=args.max_parallel,
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
