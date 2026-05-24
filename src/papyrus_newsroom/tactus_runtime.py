"""Single-tool Tactus runtime for Papyrus newsroom agents."""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

from . import newsroom, reference_curation_signals
from papyrus_knowledge_query.engine import run_knowledge_query
from papyrus_knowledge_query.services import build_environment_services


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]

    items = None
    try:
        items = list(value.items())
    except Exception:
        items = None
    if items is not None:
        converted = {key: _jsonable(item) for key, item in items}
        keys = list(converted.keys())
        if keys and all(isinstance(key, int) for key in keys):
            ordered = sorted(keys)
            if ordered == list(range(1, len(ordered) + 1)):
                return [converted[index] for index in ordered]
        return {str(key): item for key, item in converted.items()}

    return str(value)


def _args(args: Any = None) -> dict[str, Any]:
    if args is None:
        return {}
    converted = _jsonable(args)
    if converted is None:
        return {}
    if not isinstance(converted, dict):
        raise ValueError("Papyrus runtime APIs require table/object arguments")
    return converted


def _structured_error(code: str, message: str, exc: BaseException | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
        "retryable": False,
    }
    if exc is not None:
        payload["type"] = exc.__class__.__name__
    return payload


def _response_envelope(
    *,
    ok: bool,
    value: Any,
    trace_id: str,
    started_at: float,
    api_calls: list[str],
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_value = _normalize_known_empty_arrays(_jsonable(value))
    return {
        "ok": ok,
        "value": normalized_value,
        "error": error,
        "cost": {
            "usd": 0.0,
            "duration_ms": int(round((time.monotonic() - started_at) * 1000)),
            "tool_calls": len(api_calls),
        },
        "trace_id": trace_id,
        "partial": False,
        "api_calls": list(api_calls),
    }


_ARRAY_SHAPED_KEYS = {
    "contextSources",
    "coverageGaps",
    "evidenceItemIds",
    "openQuestions",
    "proposedReferences",
    "queries",
    "researchNotes",
    "rubricAssessments",
    "sourceSnapshots",
    "comparisonFindings",
    "acceptedReferenceIds",
    "confirmedFacts",
    "recentDeskMemoryUsed",
    "riskFlags",
    "sourceTrail",
    "sourceDiversityNotes",
    "verificationNeeds",
    "acceptedEvidenceIds",
    "knowledgeQueries",
    "papyrusUrisInspected",
    "unresolvedGaps",
    "webSearches",
    "context_sources",
    "coverage_gaps",
    "evidence_item_ids",
    "open_questions",
    "proposed_references",
    "research_notes",
    "rubric_assessments",
    "source_snapshots",
    "comparison_findings",
    "accepted_reference_ids",
    "confirmed_facts",
    "recent_desk_memory_used",
    "risk_flags",
    "source_trail",
    "source_diversity_notes",
    "verification_needs",
    "accepted_evidence_ids",
    "knowledge_queries",
    "papyrus_uris_inspected",
    "unresolved_gaps",
    "web_searches",
}


def _normalize_known_empty_arrays(value: Any, key: str | None = None) -> Any:
    if key in _ARRAY_SHAPED_KEYS and value == {}:
        return []
    if isinstance(value, dict):
        return {entry_key: _normalize_known_empty_arrays(entry_value, entry_key) for entry_key, entry_value in value.items()}
    if isinstance(value, list):
        return [_normalize_known_empty_arrays(item, key) for item in value]
    return value


class _Namespace:
    def __init__(
        self,
        dispatcher: Callable[[str, str, Any], Any],
        name: str,
        methods: set[str],
    ) -> None:
        self._dispatcher = dispatcher
        self._name = name
        for method_name in methods:
            setattr(self, method_name, self._make_call(method_name))

    def _make_call(self, method_name: str) -> Callable[[Any], Any]:
        def call(args: Any = None) -> Any:
            return self._dispatcher(self._name, method_name, args)

        return call


API_METHODS: dict[tuple[str, str], Callable[[dict[str, Any]], Any]] = {
    ("edition", "get"): lambda args: newsroom.papyrus_get_edition(args.get("id") or args.get("edition_id")),
    ("edition", "items"): lambda args: newsroom.papyrus_list_edition_items(
        args.get("id") or args.get("edition_id"),
        limit=args.get("limit", 100),
    ),
    ("item", "get"): lambda args: newsroom.papyrus_get_item(args.get("id") or args.get("item_id")),
    ("item", "info"): lambda args: newsroom.papyrus_get_item(args.get("id") or args.get("item_id")),
    ("article", "recent_published"): lambda args: newsroom.papyrus_list_recent_published_articles(
        recent_days=args.get("recent_days") or args.get("recentDays") or 30,
        limit=args.get("limit", 25),
    ),
    ("assignment", "get"): lambda args: newsroom.papyrus_get_assignment(args.get("id") or args.get("assignment_id")),
    ("assignment", "context"): lambda args: newsroom.papyrus_get_assignment_context(
        args.get("id") or args.get("assignment_id")
    ),
    ("assignment", "agent_context"): lambda args: newsroom.papyrus_build_assignment_agent_context(
        assignment_id=args.get("id") or args.get("assignment_id"),
        context_profile=args.get("context_profile") or args.get("contextProfile") or "",
        max_tokens=args.get("max_tokens") or args.get("maxTokens") or 0,
        recent_days=args.get("recent_days") or args.get("recentDays") or 30,
    ),
    ("assignment", "context_to_item"): lambda args: newsroom.papyrus_assignment_context_to_item(
        assignment_context=args.get("assignment_context") or args.get("assignmentContext"),
        assignment_context_json=args.get("assignment_context_json") or args.get("assignmentContextJson") or "",
    ),
    ("track", "list"): lambda args: newsroom.papyrus_list_research_tracks(),
    ("track", "get"): lambda args: newsroom.papyrus_get_research_track(args.get("key") or args.get("track_key")),
    ("reference", "get"): lambda args: newsroom.papyrus_get_reference(args.get("id") or args.get("reference_id")),
    ("reference", "curation_review"): lambda args: newsroom.papyrus_reference_curation_review(
        reference_id=args.get("reference_id") or args.get("referenceId") or args.get("id"),
        action=args.get("action") or "",
        actor_label=args.get("actor_label") or args.get("actorLabel") or "",
        note=args.get("note") or "",
        reason_code=args.get("reason_code") or args.get("reasonCode") or "",
    ),
    ("reference", "list"): lambda args: reference_curation_signals.reference_list(
        corpus_key=args.get("corpus_key") or args.get("corpusKey") or "AI-ML-research",
        limit=args.get("limit") or 25,
        status=args.get("status") or "",
        order=args.get("order") or "newest",
        scan_limit=args.get("scan_limit") or args.get("scanLimit") or 1000,
    ),
    ("reference", "insight_create"): lambda args: newsroom.papyrus_reference_insight_create(
        reference_id=args.get("reference_id") or args.get("referenceId") or args.get("id"),
        summary=args.get("summary") or "",
        body=args.get("body") or "",
        actor_label=args.get("actor_label") or args.get("actorLabel") or "",
    ),
    ("reference", "insight_list"): lambda args: newsroom.papyrus_reference_insight_list(
        args.get("reference_lineage_id") or args.get("referenceLineageId") or args.get("lineage_id") or args.get("lineageId") or ""
    ),
    ("reference", "move_corpus"): lambda args: newsroom.papyrus_reference_move_corpus(
        reference_id=args.get("reference_id") or args.get("referenceId") or args.get("id"),
        corpus_id=args.get("corpus_id") or args.get("corpusId") or "",
        actor_label=args.get("actor_label") or args.get("actorLabel") or "",
        note=args.get("note") or "",
    ),
    ("reference", "curation_start"): lambda args: newsroom.papyrus_reference_curation_start(
        reference_id=args.get("reference_id") or args.get("referenceId") or args.get("id"),
        actor_label=args.get("actor_label") or args.get("actorLabel") or "",
        curation_policy=args.get("curation_policy") or args.get("curationPolicy"),
    ),
    ("reference", "curation_status"): lambda args: newsroom.papyrus_reference_curation_status(
        assignment_id=args.get("assignment_id") or args.get("assignmentId") or args.get("id"),
    ),
    ("reference", "web_search"): lambda args: reference_curation_signals.reference_web_search(
        query=args.get("query") or args.get("q") or "",
        max_results=args.get("max_results") or args.get("maxResults") or args.get("limit") or 20,
        model=args.get("model") or "gpt-5.4-mini",
        return_token_budget=args.get("return_token_budget") or args.get("returnTokenBudget") or "default",
    ),
    ("reference", "doi_backfill_plan"): lambda args: newsroom.papyrus_doi_backfill_plan(
        corpus_key=args.get("corpus_key") or args.get("corpusKey") or "AI-ML-research",
        max_count=args.get("max_count") or args.get("maxCount") or 0,
        use_llm=bool(args.get("use_llm") or args.get("useLlm") or False),
        llm_model=args.get("llm_model") or args.get("llmModel") or "",
        llm_reasoning_effort=args.get("llm_reasoning_effort") or args.get("llmReasoningEffort") or "",
        config_path=args.get("config_path") or args.get("configPath") or "",
    ),
    ("reference", "doi_backfill_run"): lambda args: newsroom.papyrus_doi_backfill_run(
        corpus_key=args.get("corpus_key") or args.get("corpusKey") or "AI-ML-research",
        max_count=args.get("max_count") or args.get("maxCount") or 0,
        use_llm=bool(args.get("use_llm") or args.get("useLlm") or False),
        llm_model=args.get("llm_model") or args.get("llmModel") or "",
        llm_reasoning_effort=args.get("llm_reasoning_effort") or args.get("llmReasoningEffort") or "",
        config_path=args.get("config_path") or args.get("configPath") or "",
    ),
    ("reference", "doi_backfill_manifest"): lambda args: newsroom.papyrus_doi_backfill_manifest(
        run_id=args.get("run_id") or args.get("runId") or "",
        manifest_path=args.get("manifest_path") or args.get("manifestPath") or "",
    ),
    ("reference", "quality_get"): lambda args: reference_curation_signals.reference_quality_get(
        reference_id=args.get("reference") or args.get("reference_id") or args.get("referenceId") or args.get("id"),
    ),
    ("reference", "quality_rate"): lambda args: newsroom.papyrus_reference_quality_rate(
        reference_id=args.get("reference") or args.get("reference_id") or args.get("referenceId") or args.get("id"),
        rating=args.get("rating") or 0,
        note=args.get("note") or "",
        actor_label=args.get("actor_label") or args.get("actorLabel") or "papyrus-tactus",
    ),
    ("reference", "quality_assess"): lambda args: reference_curation_signals.reference_quality_assess(
        reference_id=args.get("reference") or args.get("reference_id") or args.get("referenceId") or args.get("id"),
        model=args.get("model") or "gpt-5.4-mini",
        apply=bool(args.get("apply") or False),
        refresh=bool(args.get("refresh") or False),
        persist_local_metadata=not (args.get("persist_local_metadata") is False or args.get("persistLocalMetadata") is False),
        source_text=args.get("source_text") or args.get("sourceText") or "",
        source_text_file=args.get("source_text_file") or args.get("sourceTextFile") or "",
    ),
    ("reference", "summarize"): lambda args: reference_curation_signals.reference_summarize(
        reference_id=args.get("reference") or args.get("reference_id") or args.get("referenceId") or args.get("id"),
        max_tokens=args.get("max_tokens") or args.get("maxTokens"),
        summary_text=args.get("summary_text") or args.get("summaryText") or "",
        source_text=args.get("source_text") or args.get("sourceText") or "",
        source_text_file=args.get("source_text_file") or args.get("sourceTextFile") or "",
        model=args.get("model") or "gpt-5.4-mini",
        apply=bool(args.get("apply") or False),
        refresh=bool(args.get("refresh") or False),
    ),
    ("reference", "summaries"): lambda args: reference_curation_signals.reference_summaries(
        reference_id=args.get("reference") or args.get("reference_id") or args.get("referenceId") or args.get("id"),
        max_tokens=args.get("max_tokens") or args.get("maxTokens"),
    ),
    ("knowledge", "query"): lambda args: run_knowledge_query(_knowledge_query_input(args), build_environment_services()),
    ("papyrus", "resolve_uri"): lambda args: newsroom.papyrus_resolve_uri(args.get("uri") or args.get("objectUri")),
    ("semantic", "object"): lambda args: newsroom.papyrus_get_semantic_object(
        kind=args.get("kind"),
        object_id=args.get("id") or args.get("object_id"),
    ),
    ("semantic", "search_nodes"): lambda args: newsroom.papyrus_search_semantic_nodes(
        query=args.get("query") or args.get("q") or "",
        limit=args.get("limit", 10),
        category_set_id=args.get("category_set_id") or args.get("categorySetId") or "",
    ),
    ("biblicus", "steering_artifacts"): lambda args: newsroom.biblicus_steering_artifacts(
        corpus_key=args.get("corpus_key") or args.get("corpusKey"),
        config_path=args.get("config_path") or args.get("configPath") or "",
    ),
    ("biblicus", "topic_context"): lambda args: newsroom.biblicus_topic_context(**args),
    ("biblicus", "topic_trends"): lambda args: newsroom.biblicus_topic_trends(**args),
    ("biblicus", "query"): lambda args: newsroom.biblicus_query(**args),
    ("plan", "assignment_record"): lambda args: newsroom.build_assignment_record_plan(**args),
    ("plan", "assignment_dispatch"): lambda args: newsroom.build_assignment_dispatch_plan(**args),
    ("plan", "research_update"): lambda args: newsroom.build_research_update_plan(**args),
    ("plan", "assignment_research_packet"): lambda args: newsroom.build_assignment_research_packet_plan(**args),
    ("plan", "assignment_reporting_context_packet"): lambda args: newsroom.build_assignment_reporting_context_packet_plan(**args),
    ("plan", "draft_update"): lambda args: newsroom.build_draft_update_plan(**args),
}


RESOURCE_METHODS: dict[tuple[str, str], Callable[[dict[str, Any]], Any]] = {
    ("Assignment", "create"): lambda args: newsroom.papyrus_assignment_create(args),
    ("Assignment", "get"): lambda args: newsroom.papyrus_get_assignment(args.get("id") or args.get("assignmentId") or args.get("assignment_id")),
    ("Assignment", "list"): lambda args: newsroom.papyrus_list_assignments(
        limit=args.get("limit", 25),
        status=args.get("status") or "",
        type=args.get("type") or "",
        section_key=args.get("sectionKey") or args.get("section_key") or "",
        import_run_id=args.get("importRunId") or args.get("import_run_id") or "",
    ),
    ("Assignment", "update"): lambda args: newsroom.papyrus_assignment_update(args),
}


RESOURCE_API_SCHEMA: dict[str, Any] = {
    "resources": {
        "Assignment": {
            "verbs": ["create", "get", "list", "update"],
            "description": "Private newsroom work records for research, reporting, copywriting, analysis, and future assignment types.",
            "create": {
                "supportedTypes": ["research"],
                "required": ["type", "title"],
                "optional": [
                    "summary",
                    "sectionKey",
                    "instructions",
                    "corpusKey",
                    "researchMode",
                    "priority",
                    "status",
                    "importRunId",
                    "actorLabel",
                    "apply",
                ],
                "writes": ["Assignment", "AssignmentEvent"],
                "applyDefault": False,
            },
            "get": {"required": ["id"]},
            "list": {"optional": ["limit", "status", "type", "sectionKey", "importRunId"]},
            "update": {
                "required": ["id", "status"],
                "optional": ["note", "actorLabel", "apply"],
                "writes": ["Assignment", "AssignmentEvent"],
                "applyDefault": True,
            },
        },
        "AssignmentEvent": {"verbs": ["get", "list"], "description": "Audit events for Assignment lifecycle changes. Writes happen through Assignment verbs in v1."},
        "Message": {"verbs": ["get", "list"], "description": "Private work-product and console-message records."},
        "Reference": {"verbs": ["get", "list"], "description": "Knowledge-base source material prospects and accepted references."},
        "Item": {"verbs": ["get", "list"], "description": "Reader-facing publication items. Assignments are not Items."},
        "Edition": {"verbs": ["get", "list"], "description": "Dated private or published edition records."},
        "NewsroomSection": {"verbs": ["get", "list"], "description": "Operational desk sections with mission, policies, guidance, and budgets."},
    },
    "docs": {"verbs": ["list", "get"], "namespaces": ["mcp", "resources", "newsroom"]},
}


def _knowledge_query_input(args: dict[str, Any]) -> dict[str, Any]:
    payload = args.get("input")
    if isinstance(payload, dict):
        return payload

    scope = dict(args.get("scope")) if isinstance(args.get("scope"), dict) else {}
    output = dict(args.get("output")) if isinstance(args.get("output"), dict) else {}
    if args.get("depth") is not None:
        scope["depth"] = args.get("depth")
    top_k = args.get("top_k") if args.get("top_k") is not None else args.get("topK")
    if top_k is not None:
        scope["topK"] = top_k
    max_tokens = args.get("max_tokens") if args.get("max_tokens") is not None else args.get("maxTokens")
    if max_tokens is not None:
        output["maxTokens"] = max_tokens
    if args.get("format") and not output.get("format"):
        output["format"] = args.get("format")

    anchors = args.get("anchors") or []
    if args.get("uri") or args.get("objectUri"):
        anchors = [{"uri": args.get("uri") or args.get("objectUri")}]

    return {
        "anchors": anchors,
        "semanticQuery": args.get("query") or args.get("semantic_query") or args.get("semanticQuery") or "",
        "scope": scope,
        "profile": args.get("profile") or "researcher",
        "output": output or {"format": "structured"},
    }


DOCS: dict[str, dict[str, Any]] = {
    "mcp.execute-tactus-overview": {
        "id": "mcp.execute-tactus-overview",
        "title": "execute_tactus Overview",
        "summary": "How Papyrus agents use one Tactus execution tool.",
        "namespace": "mcp",
        "status": "stable",
        "tags": ["mcp", "tactus", "newsroom"],
        "content": (
            "Papyrus agents should call execute_tactus with a short Tactus snippet. "
            "The canonical write surface is resource-oriented: GraphQL-model-style "
            "resources such as Assignment expose consistent verbs such as create, "
            "get, and list. For example:\n\n"
            "return Assignment.create{\n"
            "  type = \"research\",\n"
            "  title = \"Research recent AI newsroom reliability metrics\",\n"
            "  summary = \"Find evidence and angles for an edition-candidate story.\",\n"
            "  sectionKey = \"technology\",\n"
            "  researchMode = \"source_discovery\",\n"
            "  apply = true,\n"
            "}\n\n"
            "Use api_list{} to inspect the resource/verb schema. Use docs_list{ namespace = \"resources\" } "
            "before non-trivial writes, then load focused documentation with "
            "docs_get{ id = \"resources.Assignment\" }."
        ),
    },
    "resources.Assignment": {
        "id": "resources.Assignment",
        "title": "Assignment Resource",
        "summary": "Create, read, and list first-class private newsroom Assignment records.",
        "namespace": "resources",
        "status": "stable",
        "tags": ["assignment", "resource-api", "writes"],
        "content": (
            "Assignment is the first-class private newsroom work record. Use the "
            "PascalCase resource table and consistent verbs; do not invent helper "
            "names like createResearchAssignment. The v1 write path supports "
            "Assignment.create{ type = \"research\", title = ..., apply = ... }.\n\n"
            "Required for create: type, title. Supported type: research. Optional: "
            "summary, sectionKey, instructions, corpusKey, researchMode, priority, "
            "status, importRunId, actorLabel, apply. apply = false returns a dry-run "
            "plan. apply = true writes one Assignment and one AssignmentEvent through "
            "the Papyrus GraphQL authoring lane.\n\n"
            "Example:\n"
            "return Assignment.create{\n"
            "  type = \"research\",\n"
            "  title = \"Research recent AI newsroom reliability metrics\",\n"
            "  summary = \"Find evidence and angles for an edition-candidate story.\",\n"
            "  sectionKey = \"technology\",\n"
            "  researchMode = \"source_discovery\",\n"
            "  apply = true,\n"
            "}\n\n"
            "Use Assignment.get{ id = \"assignment-id\" } to read one assignment. "
            "Use Assignment.list{ type = \"research\", status = \"open\", limit = 10 } "
            "for discovery. Use Assignment.update{ id = \"assignment-id\", status = \"claimed\", apply = true } "
            "to change lifecycle status and append an AssignmentEvent. "
            "For writes beyond simple research assignment creation, "
            "load the relevant resource docs first."
        ),
    },
    "newsroom.assignment-context": {
        "id": "newsroom.assignment-context",
        "title": "Assignment Context",
        "summary": "Read live Assignment context and build budgeted agent context packs.",
        "namespace": "newsroom",
        "status": "stable",
        "tags": ["assignment", "context", "desk-memory"],
        "content": (
            "For live queue work, call assignment_context{ id = ... }, then "
            "assignment_agent_context{ id = ..., context_profile = ... }, then "
            "assignment_context_to_item{ assignment_context = context.assignment_context }. "
            "The normalized item is the dry-run compatibility shape used by plan builders."
        ),
    },
    "newsroom.record-plans": {
        "id": "newsroom.record-plans",
        "title": "Dry-Run Record Plans",
        "summary": "Build dry-run assignment, research, and draft record plans.",
        "namespace": "newsroom",
        "status": "stable",
        "tags": ["plans", "dry-run"],
        "content": (
            "Use papyrus.plan.assignment_dispatch, papyrus.plan.research_update, "
            "papyrus.plan.assignment_research_packet, "
            "papyrus.plan.assignment_reporting_context_packet, and papyrus.plan.draft_update "
            "to build inspectable dry-run mutation plans. "
            "These helpers do not write GraphQL records."
        ),
    },
    "newsroom.biblicus-evidence": {
        "id": "newsroom.biblicus-evidence",
        "title": "Biblicus Evidence",
        "summary": "Use configured Biblicus corpus tools from Papyrus Tactus snippets.",
        "namespace": "newsroom",
        "status": "stable",
        "tags": ["biblicus", "evidence"],
        "content": (
            "Use biblicus_steering_artifacts, biblicus_query, biblicus_topic_context, "
            "and biblicus_topic_trends for evidence gathering. Keep returned evidence "
            "ids in research packets and draft plans. Papyrus context and planning "
            "helpers treat only current accepted references as evidence-eligible."
        ),
    },
    "newsroom.reference-intake": {
        "id": "newsroom.reference-intake",
        "title": "Reference Intake",
        "summary": "Use consistent reference-intake vocabulary and ingestion rationales.",
        "namespace": "newsroom",
        "status": "stable",
        "tags": ["references", "curation", "scope-memory"],
        "content": (
            "New source material becomes a reference prospect until accepted. "
            "When proposing ingestion, include an ingestion rationale with a brief "
            "summary, the link to the current research focus, and the fit with the "
            "publication mission. Rejected references are scope memory, not "
            "publishable evidence."
        ),
    },
    "newsroom.doi-backfill": {
        "id": "newsroom.doi-backfill",
        "title": "DOI Backfill",
        "summary": "Assignment-first DOI resolution and identifier linking workflow.",
        "namespace": "newsroom",
        "status": "stable",
        "tags": ["references", "doi", "identifiers"],
        "content": (
            "Use reference_doi_backfill_plan for canonical commands, then run "
            "reference_doi_backfill_run for immediate mode or process queue claims "
            "for assignment mode. The workflow resolves DOI deterministically first, "
            "uses LLM adjudication only when configured, writes "
            "digital_object_identifier_is relations, and persists DOI metadata."
        ),
    },
    "newsroom.web-research": {
        "id": "newsroom.web-research",
        "title": "Web Research",
        "summary": "Use web_search helper or papyrus.reference.web_search for fresh external evidence.",
        "namespace": "newsroom",
        "status": "stable",
        "tags": ["web", "evidence", "tactus"],
        "content": (
            "Inside research harness snippets, use web_search(query) directly. "
            "Outside that harness, call papyrus.reference.web_search{ query = ..., "
            "max_results = ..., model = ... }. The harness first tries Tactus "
            "stdlib web.search and falls back to papyrus.reference.web_search when "
            "tactus.web is unavailable. Keep web discoveries as reference prospects "
            "until intake accepts them; do not write GraphQL records from search "
            "results alone."
        ),
    },
}


HELPER_BINDINGS: tuple[tuple[str, str, str], ...] = (
    ("edition_get", "edition", "get"),
    ("edition_items", "edition", "items"),
    ("item_get", "item", "get"),
    ("assignment_get", "assignment", "get"),
    ("assignment_context", "assignment", "context"),
    ("assignment_agent_context", "assignment", "agent_context"),
    ("assignment_context_to_item", "assignment", "context_to_item"),
    ("reference_doi_backfill_plan", "reference", "doi_backfill_plan"),
    ("reference_doi_backfill_run", "reference", "doi_backfill_run"),
    ("reference_doi_backfill_manifest", "reference", "doi_backfill_manifest"),
    ("reference_web_search", "reference", "web_search"),
    ("knowledge_query", "knowledge", "query"),
    ("resolve_papyrus_uri", "papyrus", "resolve_uri"),
    ("recent_published_articles", "article", "recent_published"),
    ("biblicus_steering_artifacts", "biblicus", "steering_artifacts"),
    ("biblicus_topic_context", "biblicus", "topic_context"),
    ("biblicus_topic_trends", "biblicus", "topic_trends"),
    ("biblicus_query", "biblicus", "query"),
    ("semantic_search_nodes", "semantic", "search_nodes"),
    ("plan_assignment_dispatch", "plan", "assignment_dispatch"),
    ("plan_research_update", "plan", "research_update"),
    ("plan_assignment_research_packet", "plan", "assignment_research_packet"),
    ("plan_assignment_reporting_context_packet", "plan", "assignment_reporting_context_packet"),
    ("plan_draft_update", "plan", "draft_update"),
    ("docs_list", "docs", "list"),
    ("docs_get", "docs", "get"),
    ("api_list", "api", "list"),
)


class PapyrusRuntimeModule:
    """Tactus host module exposing curated Papyrus newsroom namespaces."""

    def __init__(self) -> None:
        self._api_calls: list[str] = []
        methods_by_namespace: dict[str, set[str]] = {}
        for namespace, method in API_METHODS:
            methods_by_namespace.setdefault(namespace, set()).add(method)
        for namespace, methods in methods_by_namespace.items():
            if namespace != "papyrus":
                setattr(self, namespace, _Namespace(self._call, namespace, methods))
        resource_methods: dict[str, set[str]] = {}
        for resource, method in RESOURCE_METHODS:
            resource_methods.setdefault(resource, set()).add(method)
        for resource, methods in resource_methods.items():
            setattr(self, resource, _Namespace(self._call_resource, resource, methods))
        self.resolve_uri = self._make_root_call("resolve_uri")
        self.docs = _Namespace(self._call_docs, "docs", {"list", "get"})
        self.api = _Namespace(self._call_api, "api", {"list"})

    @property
    def api_calls(self) -> list[str]:
        return list(self._api_calls)

    def _record_api_call(self, namespace: str, method: str) -> None:
        if namespace == "papyrus":
            self._api_calls.append(f"papyrus.{method}")
        else:
            self._api_calls.append(f"papyrus.{namespace}.{method}")

    def _call(self, namespace: str, method: str, args: Any = None) -> Any:
        handler = API_METHODS.get((namespace, method))
        if handler is None:
            raise ValueError(f"Unsupported Papyrus runtime API: papyrus.{namespace}.{method}")
        parsed = _args(args)
        self._record_api_call(namespace, method)
        return handler(parsed)

    def _call_resource(self, resource: str, method: str, args: Any = None) -> Any:
        handler = RESOURCE_METHODS.get((resource, method))
        if handler is None:
            raise ValueError(f"Unsupported Papyrus resource API: {resource}.{method}")
        parsed = _args(args)
        self._api_calls.append(f"papyrus.{resource}.{method}")
        return handler(parsed)

    def _make_root_call(self, method: str) -> Callable[[Any], Any]:
        def call(args: Any = None) -> Any:
            return self._call("papyrus", method, args)

        return call

    def _call_docs(self, namespace: str, method: str, args: Any = None) -> Any:
        parsed = _args(args)
        if method == "list":
            namespace_filter = parsed.get("namespace")
            self._record_api_call("docs", "list")
            entries = []
            for doc in DOCS.values():
                if namespace_filter and doc.get("namespace") != namespace_filter:
                    continue
                entries.append(
                    {
                        key: doc[key]
                        for key in ("id", "title", "summary", "namespace", "status", "tags")
                    }
                )
            return entries
        if method == "get":
            doc_id = parsed.get("id") or parsed.get("key") or parsed.get("name")
            if not doc_id:
                raise ValueError("papyrus.docs.get requires id, key, or name")
            doc = DOCS.get(str(doc_id))
            if doc is None:
                raise FileNotFoundError(f"Unknown Papyrus documentation id: {doc_id}")
            self._record_api_call("docs", "get")
            return {"id": doc["id"], "metadata": {k: v for k, v in doc.items() if k != "content"}, "content": doc["content"]}
        raise ValueError(f"Unsupported Papyrus runtime API: papyrus.docs.{method}")

    def _call_api(self, namespace: str, method: str, args: Any = None) -> Any:
        if method != "list":
            raise ValueError(f"Unsupported Papyrus runtime API: papyrus.api.{method}")
        self._record_api_call("api", "list")
        return RESOURCE_API_SCHEMA


def _wrap_tactus_snippet(tactus: str) -> str:
    helper_lines = [
        'local papyrus = require("papyrus")',
        "local __papyrus_last_result = nil",
        "local function __papyrus_capture(value)",
        "  __papyrus_last_result = value",
        "  return value",
        "end",
    ]
    for helper_name, namespace, method in HELPER_BINDINGS:
        call_expression = f"papyrus.{method}(args)" if namespace == "papyrus" else f"papyrus.{namespace}.{method}(args)"
        helper_lines.extend(
            [
                f"function {helper_name}(args)",
                f"  return __papyrus_capture({call_expression})",
                "end",
            ]
        )
    resource_methods: dict[str, list[str]] = {}
    for resource, method in RESOURCE_METHODS:
        resource_methods.setdefault(resource, []).append(method)
    for resource, methods in sorted(resource_methods.items()):
        helper_lines.append(f"{resource} = {{}}")
        for method in sorted(methods):
            helper_lines.extend(
                [
                    f"function {resource}.{method}(args)",
                    f"  return __papyrus_capture(papyrus.{resource}.{method}(args))",
                    "end",
                ]
            )
    return "\n".join(
        [
            *helper_lines,
            "local function __execute_tactus_user_snippet()",
            tactus,
            "end",
            "local __papyrus_explicit_result = __execute_tactus_user_snippet()",
            "if __papyrus_explicit_result ~= nil then",
            "  return __papyrus_explicit_result",
            "end",
            "return __papyrus_last_result",
            "",
        ]
    )


def _run_async(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict[str, Any] = {}
    error: dict[str, BaseException] = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001
            error["error"] = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if error:
        raise error["error"]
    return result.get("value")


def _lua_string(value: str) -> str:
    return json.dumps(str(value))


def _research_harness(
    *,
    body: str,
    assignment_id: str,
    assignment_item_json: str,
    corpus_key: str,
    max_evidence_items: int,
    research_mode: str = "",
    disable_tactus_web: bool = False,
) -> str:
    assignment_json = assignment_item_json or "{}"
    evidence_limit = max(int(max_evidence_items or 1), 1)
    assignment_loader = (
        f'local assignment = assignment_get{{ id = {_lua_string(assignment_id)} }}.assignment\nlocal assignment_is_live = true'
        if assignment_id and not assignment_item_json
        else f'local assignment = json.decode({_lua_string(assignment_json)})\nlocal assignment_is_live = assignment.assignmentTypeKey ~= nil and assignment.type == nil'
    )
    return f"""
	local json = require("tactus.io.json")
	local __web = nil

	{assignment_loader}
local corpus_key = {_lua_string(corpus_key or "")}
local max_evidence_items = {evidence_limit}
local requested_research_mode = {_lua_string(research_mode or "")}
local disable_tactus_web = {"true" if disable_tactus_web else "false"}

if assignment_is_live and (assignment.queueKey == nil or assignment.queueKey == "") then
    error("live assignment research packets require assignment.queueKey")
end

local function trim_results(results)
    local trimmed = {{}}
    if not results then return trimmed end
    local index = 1
    while results[index] and index <= max_evidence_items do
        trimmed[index] = results[index]
        index = index + 1
    end
    return trimmed
end

local function normalize_research_mode(value)
    local mode = tostring(value or "")
    mode = string.gsub(string.lower(mode), "%-", "_")
    if mode == "internal_brief" or mode == "source_discovery" or mode == "full_research" then
        return mode
    end
    return "source_discovery"
end

local function assignment_metadata()
    local metadata = assignment.metadata or {{}}
    if type(metadata) == "string" then
        local ok, decoded = pcall(json.decode, metadata)
        if ok and type(decoded) == "table" then
            metadata = decoded
        else
            metadata = {{}}
        end
    end
    if type(metadata) ~= "table" then
        metadata = {{}}
    end
    return metadata
end

local __metadata = assignment_metadata()
local research_mode = normalize_research_mode(
    requested_research_mode ~= "" and requested_research_mode or (__metadata.researchMode or __metadata.research_mode)
)
local __web_searches = {{}}

	local function web_search(query)
    local result = nil
	    if not disable_tactus_web then
	    if __web == nil then
        local ok, loaded = pcall(require, "tactus.web")
        if ok then
            __web = loaded
        else
            __web = false
        end
	    end
    if __web and __web.search then
        local ok, fetched = pcall(__web.search, {{
            provider = "openai",
            query = query,
            model = "gpt-5.4-mini",
            return_token_budget = "default",
            max_results = max_evidence_items,
        }})
        if ok and type(fetched) == "table" then
            result = fetched
        end
    end
	    end
    if result == nil then
        result = papyrus.reference.web_search{{
            query = query,
            max_results = max_evidence_items,
            model = "gpt-5.4-mini",
            return_token_budget = "default",
        }}
    end
    result = result or {{}}
    result.query = result.query or query
    result.results = trim_results(result.results)
    __web_searches[#__web_searches + 1] = query
    return result
end

	local function knowledge_search(query, options)
	    options = options or {{}}
	    return knowledge_query{{
	        query = query,
        profile = options.profile or "researcher",
        format = options.format or "both",
        max_tokens = options.max_tokens or options.maxTokens or 1200,
        top_k = options.top_k or options.topK or max_evidence_items,
        depth = options.depth or 1,
	        anchors = options.anchors or {{}},
	    }}
	end

	local function resolve_papyrus_uri(uri)
	    return papyrus.resolve_uri{{ uri = uri }}
	end

	local function knowledge_search_uri(uri, options)
	    options = options or {{}}
	    local anchors = options.anchors or {{ {{ uri = uri }} }}
	    return knowledge_query{{
	        query = options.query or options.semantic_query or options.semanticQuery or "",
	        profile = options.profile or "researcher",
	        format = options.format or "both",
	        max_tokens = options.max_tokens or options.maxTokens or 1000,
	        top_k = options.top_k or options.topK or max_evidence_items,
	        depth = options.depth or 1,
	        anchors = anchors,
	    }}
	end

	local function evidence_item_ids_from_knowledge(knowledge)
	    local ids = {{}}
	    local seen = {{}}
	    local structured = knowledge and knowledge.structured or {{}}
	    local collections = {{
	        structured.semanticMatches or {{}},
	        structured.relatedRecords or {{}},
	        structured.expandedObjects or {{}},
	        structured.anchors or {{}},
	    }}
	    local out_index = 1
	    local collection_index = 1
	    while collections[collection_index] and out_index <= max_evidence_items do
	        local records = collections[collection_index]
	        local index = 1
	        while records[index] and out_index <= max_evidence_items do
	            local record = records[index]
	            if record.kind == "reference" and record.id and record.curationStatus == "accepted" and not seen[record.id] then
	                ids[out_index] = record.id
	                seen[record.id] = true
	                out_index = out_index + 1
	            end
	            index = index + 1
	        end
	        collection_index = collection_index + 1
	    end
	    return ids
	end

local function compact_record_plan(plan)
    local records = {{}}
    local index = 1
    while plan.records and plan.records[index] do
        local record = plan.records[index]
        local input = record.input or {{}}
        records[index] = {{
            modelName = record.modelName,
            action = record.action,
            input = {{
                id = input.id,
                messageKind = input.messageKind,
                messageDomain = input.messageDomain,
                relationTypeKey = input.relationTypeKey,
                relationDomain = input.relationDomain,
                subjectKind = input.subjectKind,
                subjectId = input.subjectId,
                objectKind = input.objectKind,
                objectId = input.objectId,
            }},
        }}
        index = index + 1
    end
    return {{
        dryRun = plan.dryRun,
        lifecycle = plan.lifecycle,
        assignmentId = plan.assignmentId,
        item = plan.item and {{ id = plan.item.id, type = plan.item.type, status = plan.item.status }},
        message = plan.message and {{
            id = plan.message.id,
            messageKind = plan.message.messageKind,
            messageDomain = plan.message.messageDomain,
            status = plan.message.status,
            summary = plan.message.summary,
        }},
        records = records,
        warnings = plan.warnings or {{}},
    }}
end

local function finish_research(research)
    research.research_mode = normalize_research_mode(research.research_mode or research.researchMode or research_mode)
    research.corpus_key = research.corpus_key or corpus_key
    research.evidence_item_ids = research.evidence_item_ids or {{}}
    research.researchTrace = research.researchTrace or {{}}
    research.researchTrace.webSearches = research.researchTrace.webSearches or __web_searches
    research.researchTrace.acceptedEvidenceIds = research.researchTrace.acceptedEvidenceIds or research.evidence_item_ids
    research.internalFindings = research.internalFindings or {{
        summary = research.internal_summary or research.summary or "",
        evidenceItemIds = research.evidence_item_ids,
        queries = research.queries or {{}},
        papyrusUrisInspected = research.researchTrace.papyrusUrisInspected or {{}},
    }}
    research.sourceDiscovery = research.sourceDiscovery or {{
        webSearches = research.researchTrace.webSearches or {{}},
        sourceSnapshots = research.source_snapshots or research.sourceSnapshots or {{}},
        proposedReferences = research.proposed_references or research.proposedReferences or {{}},
        blockedReason = research.blocked_reason or research.blockedReason,
    }}
    research.synthesis = research.synthesis or {{
        summary = research.summary or "",
        recommendedAngle = research.recommended_angle or research.recommendedAngle or "",
        openQuestions = research.open_questions or research.openQuestions or {{}},
        coverageGaps = research.coverage_gaps or research.coverageGaps or {{}},
    }}
    if research.research_mode ~= "internal_brief" then
        local has_web_search = research.researchTrace.webSearches and research.researchTrace.webSearches[1] ~= nil
        local has_source_snapshot = (research.source_snapshots and research.source_snapshots[1] ~= nil)
            or (research.sourceSnapshots and research.sourceSnapshots[1] ~= nil)
            or (research.sourceDiscovery and research.sourceDiscovery.sourceSnapshots and research.sourceDiscovery.sourceSnapshots[1] ~= nil)
        local has_proposed_reference = (research.proposed_references and research.proposed_references[1] ~= nil)
            or (research.proposedReferences and research.proposedReferences[1] ~= nil)
            or (research.sourceDiscovery and research.sourceDiscovery.proposedReferences and research.sourceDiscovery.proposedReferences[1] ~= nil)
        local blocked_reason = research.blocked_reason or research.blockedReason
            or (research.sourceDiscovery and (research.sourceDiscovery.blockedReason or research.sourceDiscovery.blocked_reason))
        if not has_web_search and not has_source_snapshot and not has_proposed_reference and not blocked_reason then
            error("research mode " .. research.research_mode .. " requires web discovery or blockedReason")
        end
    end
    local plan = nil
    if assignment_is_live then
        plan = plan_assignment_research_packet{{
            assignment = assignment,
            research = research,
        }}
    else
        plan = plan_research_update{{
            assignment_item = assignment,
            research = research,
        }}
    end
    return {{
        assignment_item_id = assignment.id,
        corpus_key = corpus_key,
        dry_run = true,
        item_status = "researched",
        research_packet = research,
        research_record_plan = compact_record_plan(plan),
        summary = research.summary or "Created dry-run research packet.",
    }}
end

local function source_title(source)
    if not source then return "Candidate source" end
    return source.title or source.url or source.source_domain or "Candidate source"
end

local function default_ingestion_rationale(source, query, answer)
    local title = source_title(source)
    local focus = assignment.summary or assignment.title or "the current research focus"
    focus = tostring(focus)
    focus = string.gsub(focus, "%s+", " ")
    focus = string.gsub(focus, "[%.%s]+$", "")
    return table.concat({{
        title,
        " was returned by OpenAI web search for ",
        query or "the research query",
        ". The source should be reviewed as a reference prospect because it may provide current context for ",
        focus,
        ". Its fit with the publication mission should be judged during reference intake before it is treated as accepted evidence.",
    }})
end

local function proposed_references_from_search(search)
    local proposals = {{}}
    local results = search.results or {{}}
    local answer = ""
    if search.metadata and search.metadata.answer then
        answer = search.metadata.answer
    end
    local index = 1
    while results[index] do
        local source = results[index]
        proposals[index] = {{
            title = source_title(source),
            url = source.url,
            source_domain = source.source_domain,
            evidence_candidate_id = source.evidence_candidate_id,
            ingestion_rationale = default_ingestion_rationale(source, search.query, answer),
        }}
        index = index + 1
    end
    return proposals
end

local function result_count(results)
    local count = 0
    if not results then return count end
    while results[count + 1] do
        count = count + 1
    end
    return count
end

local function search_summary(search)
    local first = search.results and search.results[1]
    if first then
        return table.concat({{
            "Found ",
            tostring(result_count(search.results)),
            " current reference prospect(s) for ",
            search.query or "the research query",
            "; first source: ",
            first.source_domain or first.url or "web search",
            ". Treat these as reference prospects until reference intake review.",
        }})
    end
    return "No current web reference prospect was returned for " .. (search.query or "the research query") .. "."
end

local function finish_research_from_search(search, options)
    options = options or {{}}
    return finish_research{{
        research_mode = options.research_mode or options.researchMode,
        summary = options.summary or search_summary(search),
        queries = {{ search.query }},
        source_snapshots = search.results or {{}},
        proposed_references = options.proposed_references or proposed_references_from_search(search),
        evidence_item_ids = options.evidence_item_ids or options.evidenceItemIds or {{}},
        recommended_angle = options.recommended_angle or "Assess the source as a reference prospect before using it as evidence.",
        open_questions = options.open_questions or {{}},
        coverage_gaps = options.coverage_gaps or {{}},
        comparison_findings = options.comparison_findings or {{}},
        rubric_assessments = options.rubric_assessments or {{}},
    }}
end

{body}
"""


def execute_tactus_harnessed(
    tactus: str,
    *,
    harness: str = "raw",
    assignment_id: str = "",
    assignment_item_json: str = "",
    corpus_key: str = "",
    max_evidence_items: int = 20,
    research_mode: str = "",
    disable_tactus_web: bool = False,
) -> dict[str, Any]:
    if harness == "raw":
        return execute_tactus(tactus)
    if harness == "research":
        snippet = _research_harness(
            body=tactus,
            assignment_id=assignment_id,
            assignment_item_json=assignment_item_json,
            corpus_key=corpus_key,
            max_evidence_items=max_evidence_items,
            research_mode=research_mode,
            disable_tactus_web=disable_tactus_web,
        )
        return execute_tactus(snippet)
    return _response_envelope(
        ok=False,
        value=None,
        trace_id=str(uuid.uuid4()),
        started_at=time.monotonic(),
        api_calls=[],
        error=_structured_error("invalid_request", f"unknown harness: {harness}"),
    )


def execute_tactus(tactus: str) -> dict[str, Any]:
    """Execute a short Papyrus Tactus snippet and return a structured envelope.

    This is the single Papyrus newsroom agent tool. The snippet receives a
    global ``papyrus`` host module plus helper aliases such as ``api_list``,
    ``docs_list``, ``assignment_context``, ``assignment_agent_context``,
    ``biblicus_query``, ``plan_research_update``, and ``plan_draft_update``.
    """

    started = time.monotonic()
    trace_id = str(uuid.uuid4())
    if not isinstance(tactus, str) or not tactus.strip():
        return _response_envelope(
            ok=False,
            value=None,
            trace_id=trace_id,
            started_at=started,
            api_calls=[],
            error=_structured_error("invalid_request", "tactus must be a non-empty string"),
        )

    papyrus = PapyrusRuntimeModule()
    try:
        from tactus.adapters.memory import MemoryStorage
        from tactus.core import TactusRuntime

        async def run() -> Any:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                runtime = TactusRuntime(
                    procedure_id=f"papyrus_execute_tactus_{trace_id}",
                    storage_backend=MemoryStorage(),
                    run_id=trace_id,
                    source_file_path="<papyrus execute_tactus>",
                )
                if not hasattr(runtime, "register_python_module"):
                    raise RuntimeError(
                        "execute_tactus requires TactusRuntime.register_python_module; update tactus."
                    )
                runtime.register_python_module("papyrus", papyrus)
                return await runtime.execute(_wrap_tactus_snippet(tactus), context={}, format="lua")

        runtime_result = _run_async(run())
        if not isinstance(runtime_result, dict):
            return _response_envelope(
                ok=True,
                value=runtime_result,
                trace_id=trace_id,
                started_at=started,
                api_calls=papyrus.api_calls,
            )

        ok = bool(runtime_result.get("success"))
        value = runtime_result.get("result")
        return _response_envelope(
            ok=ok,
            value=value,
            trace_id=trace_id,
            started_at=started,
            api_calls=papyrus.api_calls,
            error=None if ok else _structured_error("tactus_execution_failed", str(runtime_result.get("error") or "Tactus execution failed")),
        )
    except Exception as exc:  # noqa: BLE001
        return _response_envelope(
            ok=False,
            value=None,
            trace_id=trace_id,
            started_at=started,
            api_calls=papyrus.api_calls,
            error=_structured_error("runtime_error", str(exc), exc),
        )


EXECUTE_TACTUS_DESCRIPTION = """Execute a short Tactus snippet inside the Papyrus newsroom runtime.

Use this as the only tool for Papyrus newsroom agent work. The runtime injects a
global `papyrus` host module and canonical PascalCase resource tables such as
`Assignment`.

Ground rules:
- `papyrus` is already available; do not require arbitrary Python modules.
- Prefer canonical resources for writes: `Assignment.create{ type = "research", title = "...", apply = true }`.
- Use table arguments: `Assignment.get{ id = "assignment-123" }`.
- The runtime returns the last Papyrus operation if your snippet does not return
  explicitly.
- Use `api_list{}` and `docs_list{}` for discovery instead of guessing.
- Load `docs_get{ id = "resources.Assignment" }` before non-trivial Assignment writes.
- Record-plan helpers are dry-run builders; they do not write GraphQL records.

Example:
```tactus
return Assignment.create{
  type = "research",
  title = "Research recent AI newsroom reliability metrics",
  summary = "Find evidence and angles for an edition-candidate story.",
  sectionKey = "technology",
  researchMode = "source_discovery",
  apply = true,
}
```
"""
