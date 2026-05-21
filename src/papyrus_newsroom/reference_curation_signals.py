"""Reference summary and quality curation signals.

The module owns the reusable planning/writing contract for budgeted reference
summaries and one-to-five quality ratings. It intentionally uses the same
SemanticRelation state-key shape as the rest of Papyrus so Tactus, CLI, and
ranking code can share one graph contract.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

try:
    import tiktoken
except ModuleNotFoundError:  # pragma: no cover - dependency exists in normal envs
    tiktoken = None

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - PyYAML is a project dependency
    yaml = None

from .semantic import PapyrusSemanticClient, semantic_state_key, semantic_version_key


PAPYRUS_ROOT = Path(__file__).resolve().parents[2]
BIBLICUS_ROOT = PAPYRUS_ROOT.parent / "Biblicus"
SUMMARY_TOKEN_BUDGETS = (100, 200, 500)
SUMMARY_MESSAGE_KIND = "reference_summary"
SUMMARY_MESSAGE_DOMAIN = "summarization"
SUMMARY_SOURCE = "papyrus-summary-generator"
SUMMARY_PROMPT_VERSION = "reference-summary-v2-publication-doctrine"
PUBLICATION_DOCTRINE_SLUGS = ("editorial-doctrine-mission", "editorial-doctrine-policy")
DOCTRINE_POLICY_USE = "context_only_not_reference_rubric"
QUALITY_RELATION_TYPE_KEY = "quality_rating_is"
QUALITY_NODE_KIND = "qualityRating"
QUALITY_ASSESSMENT_SOURCE = "papyrus-quality-assessor"
QUALITY_ASSESSMENT_PROMPT_VERSION = "reference-quality-v1-publication-doctrine"
QUALITY_ASSESSMENT_RUBRIC = """
Rate the source quality of this Reference from 1 to 5.

5 = Landmark or very strong primary source: rigorous research, important method/result, high relevance, clear evidence.
4 = Strong useful source: credible, substantive, relevant, and likely valuable for context packs or editorial research.
3 = Adequate source: credible or useful but limited, narrow, derivative, preliminary, or only moderately relevant.
2 = Weak source: low evidentiary value, shallow, noisy, unclear provenance, or only tangentially useful.
1 = Very weak source: unreliable, spammy, mostly irrelevant, content-free, or not useful as knowledge-base evidence.

Assess the Reference as source material. Do not punish a Reference for disagreeing with Papyrus editorial policies; those policies are context only.
"""
QUALITY_NODE_KEYS = {
    1: "quality.rating.1_star",
    2: "quality.rating.2_star",
    3: "quality.rating.3_star",
    4: "quality.rating.4_star",
    5: "quality.rating.5_star",
}
TITLE_SUBTITLE_SOURCE = "papyrus-title-subtitle-enricher"
TITLE_SUBTITLE_PROMPT_VERSION = "reference-title-subtitle-v1-verbatim-source"
TITLE_SUBTITLE_SUMMARY_PROMPT_VERSION = "reference-title-subtitle-summary-v1-outcome"
TITLE_SUBTITLE_SUMMARY_TOKEN_BUDGET_DEFAULT = 500


REFERENCE_FIELDS = """
id lineageId versionNumber previousVersionId versionState versionCreatedAt versionCreatedBy changeReason contentHash
corpusId externalItemId title authors sourceUri storagePath mediaType byteSize sha256 sourcePublishedAt sourceUpdatedAt
retrievedAt importRunId importedAt curationStatus curationStatusKey curationStatusUpdatedAt curationStatusUpdatedBy curationStatusReason updatedAt
"""

LIST_REFERENCES_BY_CORPUS_QUERY = f"""
query ListReferencesByCorpus($corpusId: ID!, $limit: Int, $nextToken: String) {{
  listReferencesByCorpusAndExternalItem(corpusId: $corpusId, limit: $limit, nextToken: $nextToken) {{
    items {{ {REFERENCE_FIELDS} }}
    nextToken
  }}
}}
"""

CREATE_MODEL_ATTACHMENT_UPLOAD_MUTATION = """
mutation CreateModelAttachmentUpload(
  $ownerKind: String!
  $ownerId: ID!
  $ownerLineageId: ID
  $ownerVersionNumber: Int
  $ownerVersionKey: String
  $role: String!
  $sortKey: String
  $filename: String!
  $mediaType: String!
  $byteSize: Int!
  $sha256: String
  $importRunId: ID
  $status: String
) {
  createModelAttachmentUpload(
    ownerKind: $ownerKind
    ownerId: $ownerId
    ownerLineageId: $ownerLineageId
    ownerVersionNumber: $ownerVersionNumber
    ownerVersionKey: $ownerVersionKey
    role: $role
    sortKey: $sortKey
    filename: $filename
    mediaType: $mediaType
    byteSize: $byteSize
    sha256: $sha256
    importRunId: $importRunId
    status: $status
  ) {
    uploadId
    uploadUrl
    storagePath
    requiredHeaders
  }
}
"""

COMPLETE_MODEL_ATTACHMENT_UPLOAD_MUTATION = """
mutation CompleteModelAttachmentUpload(
  $uploadId: String!
  $ownerKind: String!
  $ownerId: ID!
  $ownerLineageId: ID
  $ownerVersionNumber: Int
  $ownerVersionKey: String
  $role: String!
  $sortKey: String
  $filename: String!
  $mediaType: String!
  $byteSize: Int!
  $sha256: String
  $importRunId: ID
  $status: String
) {
  completeModelAttachmentUpload(
    uploadId: $uploadId
    ownerKind: $ownerKind
    ownerId: $ownerId
    ownerLineageId: $ownerLineageId
    ownerVersionNumber: $ownerVersionNumber
    ownerVersionKey: $ownerVersionKey
    role: $role
    sortKey: $sortKey
    filename: $filename
    mediaType: $mediaType
    byteSize: $byteSize
    sha256: $sha256
    importRunId: $importRunId
    status: $status
  ) {
    id
  }
}
"""

UPDATE_NEWSROOM_SUMMARY_MUTATION = """
mutation UpdateNewsroomSummary($delta: AWSJSON!, $actorLabel: String, $reason: String) {
  updateNewsroomSummary(delta: $delta, actorLabel: $actorLabel, reason: $reason) {
    generatedAt
  }
}
"""

LIST_DOCTRINE_ITEMS_BY_SLUG_QUERY = """
query ListDoctrineItemsBySlug($slug: String!, $limit: Int, $nextToken: String) {
  itemBySlug(slug: $slug, limit: $limit, nextToken: $nextToken) {
    items {
      id
      lineageId
      versionNumber
      versionState
      type
      status
      typeStatus
      slug
      title
      headline
      body
      editorial
      updatedAt
    }
    nextToken
  }
}
"""


def summary_relation_type_key(max_tokens: int) -> str:
    budget = normalize_summary_budget(max_tokens)
    return f"reference_summary_{budget}_tokens"


def normalize_summary_budget(value: Any) -> int:
    try:
        budget = int(value)
    except (TypeError, ValueError):
        raise ValueError("summary max tokens must be one of 100, 200, or 500") from None
    if budget not in SUMMARY_TOKEN_BUDGETS:
        raise ValueError("summary max tokens must be one of 100, 200, or 500")
    return budget


def normalize_title_subtitle_summary_budget(value: Any) -> int:
    try:
        budget = int(value)
    except (TypeError, ValueError):
        raise ValueError("summary max tokens must be a positive integer") from None
    if budget <= 0:
        raise ValueError("summary max tokens must be a positive integer")
    return budget


def normalize_quality_rating(value: Any) -> int:
    try:
        rating = int(value)
    except (TypeError, ValueError):
        raise ValueError("quality rating must be an integer from 1 to 5") from None
    if rating < 1 or rating > 5:
        raise ValueError("quality rating must be an integer from 1 to 5")
    return rating


def quality_node_key(rating: int) -> str:
    return QUALITY_NODE_KEYS[normalize_quality_rating(rating)]


def quality_node_lineage_id(rating: int) -> str:
    return f"semantic-node-{_safe_id(quality_node_key(rating))}"


def quality_node_id(rating: int) -> str:
    return f"{quality_node_lineage_id(rating)}-v1"


def build_reference_quality_plan(
    *,
    reference: dict[str, Any],
    rating: int,
    note: str = "",
    actor_label: str = "papyrus-newsroom",
    source: str = "manual",
    refresh: bool = False,
    run_id: str = "",
    assignment_id: str = "",
    now: str | None = None,
    semantic_client: PapyrusSemanticClient | None = None,
) -> dict[str, Any]:
    now = now or _now()
    rating = normalize_quality_rating(rating)
    reference = _require_reference(reference)
    semantic = semantic_client or _semantic_client()
    existing = _current_relations(
        semantic.list_outgoing("reference", reference["lineageId"])["relations"],
        QUALITY_RELATION_TYPE_KEY,
    )
    target_node_id = quality_node_id(rating)
    quality_node_record = None
    try:
        semantic.get_semantic_object("semanticNode", target_node_id)
    except ValueError:
        quality_node_record = _quality_semantic_node_record(rating, now)
    same_current = [
        relation for relation in existing
        if relation.get("objectLineageId") == quality_node_lineage_id(rating)
        and _number_or_none(relation.get("score")) == float(rating)
    ]
    if same_current and not refresh:
        return {
            "kind": "reference.quality-rating.plan",
            "action": "noop",
            "reference": _reference_summary(reference),
            "rating": rating,
            "existingRelationId": same_current[0].get("id"),
            "records": [],
            "warnings": [],
        }

    metadata = _compact_dict({
        "kind": "reference.quality-rating.linked",
        "qualityRating": rating,
        "source": source,
        "actorLabel": actor_label,
        "note": note,
        "runId": run_id,
        "assignmentId": assignment_id,
        "ratedAt": now,
    })
    stale_updates = [
        _supersede_relation_record(relation, now, {"supersededByRating": rating, "supersededAt": now})
        for relation in existing
    ]
    relation = _semantic_relation(
        predicate=QUALITY_RELATION_TYPE_KEY,
        subject_kind="reference",
        subject_id=reference["id"],
        subject_lineage_id=reference["lineageId"],
        subject_version_number=reference.get("versionNumber"),
        object_kind="semanticNode",
        object_id=target_node_id,
        object_lineage_id=quality_node_lineage_id(rating),
        object_version_number=1,
        score=rating,
        confidence=None,
        rank=1,
        classifier_id=None,
        model_version=None,
        import_run_id=reference.get("importRunId"),
        imported_at=now,
        metadata=metadata,
    )
    return {
        "kind": "reference.quality-rating.plan",
        "action": "create",
        "reference": _reference_summary(reference),
        "rating": rating,
        "records": [
            *([{"modelName": "SemanticNode", "action": "create", "input": quality_node_record}] if quality_node_record else []),
            {"modelName": "SemanticRelation", "action": "create", "input": relation},
            *stale_updates,
        ],
        "summaryDelta": _summary_delta_for_plan(
            messages=0,
            model_attachments=0,
            created_relations=1,
            superseded_relations=len(stale_updates),
            relation_type_key=QUALITY_RELATION_TYPE_KEY,
            relation_domain="curation",
            subject_kind="reference",
            object_kind="semanticNode",
            semantic_nodes=1 if quality_node_record else 0,
        ),
        "warnings": [],
    }


def build_reference_summary_plan(
    *,
    reference: dict[str, Any],
    max_tokens: int,
    summary_text: str,
    source_text: str = "",
    model: str = "",
    tokenizer: str = "tiktoken",
    prompt_version: str = SUMMARY_PROMPT_VERSION,
    rationale: str = "",
    doctrine_context: dict[str, Any] | None = None,
    actor_label: str = "papyrus-summary-generator",
    refresh: bool = False,
    run_id: str = "",
    assignment_id: str = "",
    now: str | None = None,
    semantic_client: PapyrusSemanticClient | None = None,
) -> dict[str, Any]:
    now = now or _now()
    max_tokens = normalize_summary_budget(max_tokens)
    summary_text = _required(summary_text, "summary_text")
    reference = _require_reference(reference)
    semantic = semantic_client or _semantic_client()
    relation_key = summary_relation_type_key(max_tokens)
    existing = _current_relations(
        semantic.list_incoming("reference", reference["lineageId"])["relations"],
        relation_key,
    )
    if existing and not refresh:
        return {
            "kind": "reference.summary.plan",
            "action": "noop",
            "reference": _reference_summary(reference),
            "maxTokens": max_tokens,
            "existingRelationId": existing[0].get("id"),
            "records": [],
            "warnings": [],
        }
    actual_tokens = estimate_tokens(summary_text, model=model)
    source_content_hash = _hash_text(source_text) if source_text else str(reference.get("contentHash") or reference.get("sha256") or "")
    doctrine_metadata = doctrine_summary_metadata(
        doctrine_context or manual_summary_doctrine_context()
    )
    metadata = _compact_dict({
        "kind": "reference.summary.generated",
        "maxTokens": max_tokens,
        "actualTokenEstimate": actual_tokens,
        "tokenizer": tokenizer,
        "model": model,
        "promptVersion": prompt_version,
        "sourceContentHash": source_content_hash,
        "referenceLineageId": reference["lineageId"],
        "runId": run_id,
        "assignmentId": assignment_id,
        "generatedAt": now,
        "rationale": rationale,
    })
    metadata.update(doctrine_metadata)
    message_id = f"message-reference-summary-{_safe_id(reference['lineageId'])}-{max_tokens}-{_hash_short([summary_text, now, run_id])}"
    message = {
        "id": message_id,
        "messageKind": SUMMARY_MESSAGE_KIND,
        "messageDomain": SUMMARY_MESSAGE_DOMAIN,
        "status": "active",
        "summary": summary_text,
        "source": SUMMARY_SOURCE,
        "importRunId": reference.get("importRunId"),
        "authorLabel": actor_label,
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": "messages",
    }
    metadata_attachment = _model_attachment(
        owner_kind="message",
        owner_id=message_id,
        role="metadata",
        sort_key="metadata",
        filename="metadata.json",
        media_type="application/json",
        content=metadata,
        import_run_id=reference.get("importRunId"),
        now=now,
    )
    stale_updates = [
        _supersede_relation_record(relation, now, {"supersededByMessageId": message_id, "supersededAt": now})
        for relation in existing
    ]
    relation = _semantic_relation(
        predicate=relation_key,
        subject_kind="message",
        subject_id=message_id,
        subject_lineage_id=message_id,
        subject_version_number=1,
        object_kind="reference",
        object_id=reference["id"],
        object_lineage_id=reference["lineageId"],
        object_version_number=reference.get("versionNumber"),
        score=float(actual_tokens),
        confidence=None,
        rank=1,
        classifier_id=None,
        model_version=model or None,
        import_run_id=reference.get("importRunId"),
        imported_at=now,
        metadata=metadata,
    )
    return {
        "kind": "reference.summary.plan",
        "action": "create",
        "reference": _reference_summary(reference),
        "maxTokens": max_tokens,
        "message": message,
        "metadata": metadata,
        "records": [
            {"modelName": "Message", "action": "create", "input": message},
            {"modelName": "ModelAttachment", "action": "create", "input": metadata_attachment["record"], "body": metadata_attachment["body"]},
            {"modelName": "SemanticRelation", "action": "create", "input": relation},
            *stale_updates,
        ],
        "summaryDelta": _summary_delta_for_plan(
            messages=1,
            model_attachments=1,
            created_relations=1,
            superseded_relations=len(stale_updates),
            relation_type_key=relation_key,
            relation_domain="summarization",
            subject_kind="message",
            object_kind="reference",
        ),
        "warnings": [],
    }


def resolve_reference_title_subtitle(
    reference: dict[str, Any] | None = None,
    catalog_entry: dict[str, Any] | None = None,
    sidecar: dict[str, Any] | None = None,
    source_text: str = "",
    web_search_enabled: bool = True,
    model: str = "gpt-5.4-mini",
    refresh: bool = False,
    include_summary: bool = True,
    summary_max_tokens: int = TITLE_SUBTITLE_SUMMARY_TOKEN_BUDGET_DEFAULT,
    refresh_summary: bool = False,
    run_id: str = "",
    now: str | None = None,
    fetcher: Any | None = None,
    llm_resolver: Any | None = None,
    summary_resolver: Any | None = None,
) -> dict[str, Any]:
    """Resolve original title/subtitle metadata for a Reference-like record.

    The resolver is intentionally conservative: local/catalog/sidecar metadata
    wins, web/LLM evidence is provenance-marked, and generated subtitles are
    never represented as original source copy.
    """
    now = now or _now()
    fetcher = fetcher or _fetch_url_text
    llm_resolver = llm_resolver or generate_title_subtitle_with_web_search
    summary_resolver = summary_resolver or generate_outcome_summary
    reference = reference or {}
    catalog_entry = catalog_entry or {}
    sidecar = sidecar or {}
    warnings: list[str] = []
    summary_budget = normalize_title_subtitle_summary_budget(summary_max_tokens)
    local = _title_subtitle_from_local(reference=reference, catalog_entry=catalog_entry, sidecar=sidecar)
    existing_reference_title = _normalize_reference_title_candidate(reference.get("title"))
    title = local.get("title") if refresh or not existing_reference_title else existing_reference_title
    subtitle = _normalize_subtitle_candidate(local.get("subtitle"))
    local_summary = _normalize_outcome_summary_candidate(local.get("summary"))
    summary = "" if (refresh or refresh_summary) else local_summary
    title_mode = local.get("titleMode") if title else None
    subtitle_mode = local.get("subtitleMode") if subtitle else None
    source_urls: list[str] = []
    source = local.get("source") or "unresolved"
    rationale = local.get("rationale") or ""
    summary_source = local.get("summarySource") or source
    summary_rationale = local.get("summaryRationale") or ("Resolved from local metadata summary." if summary else "")

    if title and subtitle and (summary if include_summary else True) and not refresh and not refresh_summary:
        return _title_subtitle_resolution(
            status="resolved",
            title=title,
            subtitle=subtitle,
            title_mode=title_mode or "original_metadata",
            subtitle_mode=subtitle_mode or "original_metadata",
            source=source,
            model=model,
            web_search_used=False,
            source_urls=source_urls,
            rationale=rationale or "Title and subtitle were available from local metadata.",
            summary=summary,
            summary_resolution=_summary_resolution(
                summary=summary,
                summary_token_budget=summary_budget,
                model=model,
                source=summary_source or "local_metadata",
                source_urls=source_urls,
                run_id=run_id,
                resolved_at=now,
                rationale=summary_rationale,
                prompt_version=TITLE_SUBTITLE_SUMMARY_PROMPT_VERSION if summary_source == "llm_outcome_summary" else "",
            ) if include_summary else {},
            run_id=run_id,
            resolved_at=now,
            warnings=warnings,
        )

    deterministic = _resolve_title_subtitle_deterministic(
        reference=reference,
        catalog_entry=catalog_entry,
        source_text=source_text,
        fetcher=fetcher,
    )
    if deterministic.get("sourceUrls"):
        source_urls.extend(deterministic["sourceUrls"])
    if not title and deterministic.get("title"):
        title = deterministic["title"]
        title_mode = deterministic.get("titleMode") or "original_web_metadata"
    if not subtitle and deterministic.get("subtitle"):
        subtitle = _normalize_subtitle_candidate(deterministic["subtitle"])
        subtitle_mode = deterministic.get("subtitleMode") or "original_web_metadata"
    if include_summary and not summary and deterministic.get("summary"):
        summary = _normalize_outcome_summary_candidate(deterministic.get("summary"))
        summary_source = deterministic.get("summarySource") or deterministic.get("source") or summary_source
        summary_rationale = deterministic.get("summaryRationale") or deterministic.get("rationale") or summary_rationale
    if deterministic.get("rationale"):
        rationale = deterministic["rationale"]
        source = deterministic.get("source") or source

    if title and subtitle and (summary if include_summary else True):
        return _title_subtitle_resolution(
            status="resolved",
            title=title,
            subtitle=subtitle,
            title_mode=title_mode or "original_web_metadata",
            subtitle_mode=subtitle_mode or "original_web_metadata",
            source=source or "deterministic_metadata",
            model=model,
            web_search_used=False,
            source_urls=source_urls,
            rationale=rationale or "Title and subtitle were resolved deterministically.",
            summary=summary,
            summary_resolution=_summary_resolution(
                summary=summary,
                summary_token_budget=summary_budget,
                model=model,
                source=summary_source or source or "deterministic_metadata",
                source_urls=source_urls,
                run_id=run_id,
                resolved_at=now,
                rationale=summary_rationale or "Resolved summary from deterministic metadata.",
                prompt_version="",
            ) if include_summary else {},
            run_id=run_id,
            resolved_at=now,
            warnings=warnings,
        )

    if web_search_enabled:
        try:
            llm = llm_resolver(
                reference=reference,
                catalog_entry=catalog_entry,
                source_text=source_text,
                known_title=title or "",
                known_subtitle=subtitle or "",
                model=model,
            )
            if llm.get("source_urls"):
                source_urls.extend(str(url) for url in llm.get("source_urls") or [] if str(url or "").strip())
            if not title and llm.get("title"):
                title = _clean_text(llm.get("title"))
                title_mode = _title_subtitle_mode(llm.get("title_mode"), default="original_web_metadata")
            if not subtitle and llm.get("subtitle"):
                subtitle = _normalize_subtitle_candidate(llm.get("subtitle"))
                subtitle_mode = _title_subtitle_mode(llm.get("subtitle_mode"), default="generated_fallback")
            rationale = _clean_text(llm.get("rationale")) or rationale
            source = "llm_web_search"
        except Exception as exc:
            warnings.append(f"title/subtitle web+LLM resolution failed: {exc}")

    title = _normalize_reference_title_candidate(title)
    if _placeholder_title_or_subtitle(title):
        title = ""
        title_mode = "unresolved"
    colon_subtitle = _title_colon_subtitle_candidate(title)
    if colon_subtitle and (not subtitle or subtitle_mode == "generated_fallback"):
        subtitle = colon_subtitle
        subtitle_mode = title_mode or "original_metadata"
    subtitle = _normalize_subtitle_candidate(subtitle)

    if include_summary and not summary:
        try:
            summary = _normalize_outcome_summary_candidate(summary_resolver(
                source_text,
                reference=reference,
                title=title,
                subtitle=subtitle,
                max_tokens=summary_budget,
                model=model,
            ))
            if summary:
                summary_source = "llm_outcome_summary"
                summary_rationale = "Generated outcome-focused summary from source text."
        except Exception as exc:
            warnings.append(f"summary generation failed: {exc}")

    summary_resolution = _summary_resolution(
        summary=summary if include_summary else "",
        summary_token_budget=summary_budget,
        model=model,
        source=summary_source if summary else "unresolved",
        source_urls=source_urls,
        run_id=run_id,
        resolved_at=now,
        rationale=summary_rationale if summary else "No reliable summary was produced.",
        prompt_version=TITLE_SUBTITLE_SUMMARY_PROMPT_VERSION if summary_source == "llm_outcome_summary" else "",
    ) if include_summary else {}

    status = "resolved" if title else "unresolved"
    return _title_subtitle_resolution(
        status=status,
        title=title or "",
        subtitle=subtitle or "",
        title_mode=title_mode or ("original_web_metadata" if title else "unresolved"),
        subtitle_mode=subtitle_mode or ("unresolved" if not subtitle else "generated_fallback"),
        source=source if status == "resolved" else "unresolved",
        model=model,
        web_search_used=web_search_enabled,
        source_urls=source_urls,
        rationale=rationale or ("Resolved title/subtitle." if status == "resolved" else "No reliable title candidate was found."),
        summary=summary if include_summary else "",
        summary_resolution=summary_resolution,
        run_id=run_id,
        resolved_at=now,
        warnings=warnings,
    )


def build_reference_title_subtitle_plan(
    *,
    reference: dict[str, Any],
    catalog_entry: dict[str, Any] | None = None,
    sidecar: dict[str, Any] | None = None,
    source_text: str = "",
    web_search_enabled: bool = True,
    model: str = "gpt-5.4-mini",
    refresh: bool = False,
    include_summary: bool = True,
    summary_max_tokens: int = TITLE_SUBTITLE_SUMMARY_TOKEN_BUDGET_DEFAULT,
    refresh_summary: bool = False,
    run_id: str = "",
    now: str | None = None,
    semantic_client: PapyrusSemanticClient | None = None,
) -> dict[str, Any]:
    now = now or _now()
    reference = _require_reference(reference)
    run_id = run_id or f"title-subtitle-{_hash_short([reference.get('id'), now])}"
    metadata = _jsonish(reference.get("metadata")) or {}
    existing_title = _clean_text(reference.get("title"))
    existing_subtitle = _normalize_subtitle_candidate(metadata.get("subtitle") or reference.get("subtitle"))
    existing_summary = _normalize_outcome_summary_candidate(metadata.get("summary"))
    if existing_title and existing_subtitle and ((existing_summary and include_summary) or not include_summary) and not refresh and not refresh_summary:
        return {
            "kind": "reference.title-subtitle.plan",
            "action": "noop",
            "reference": _reference_summary(reference),
            "title": existing_title,
            "subtitle": existing_subtitle,
            "summary": existing_summary if include_summary else "",
            "resolution": _title_subtitle_resolution(
                status="resolved",
                title=existing_title,
                subtitle=existing_subtitle,
                title_mode="existing_reference",
                subtitle_mode="existing_reference_metadata",
                source="existing_reference",
                model=model,
                web_search_used=False,
                source_urls=[],
                rationale="Reference already has title and subtitle.",
                summary=existing_summary if include_summary else "",
                summary_resolution=_summary_resolution(
                    summary=existing_summary if include_summary else "",
                    summary_token_budget=normalize_title_subtitle_summary_budget(summary_max_tokens),
                    model=model,
                    source="existing_reference_metadata",
                    source_urls=[],
                    run_id=run_id,
                    resolved_at=now,
                    rationale="Reference already has a metadata summary.",
                    prompt_version="",
                ) if include_summary else {},
                run_id=run_id,
                resolved_at=now,
                warnings=[],
            ),
            "records": [],
            "warnings": [],
        }
    resolution = resolve_reference_title_subtitle(
        reference=reference,
        catalog_entry=catalog_entry,
        sidecar=sidecar,
        source_text=source_text,
        web_search_enabled=web_search_enabled,
        model=model,
        refresh=refresh,
        include_summary=include_summary,
        summary_max_tokens=summary_max_tokens,
        refresh_summary=refresh_summary,
        run_id=run_id,
        now=now,
    )
    if resolution["status"] != "resolved" or not resolution.get("title"):
        return {
            "kind": "reference.title-subtitle.plan",
            "action": "unresolved",
            "reference": _reference_summary(reference),
            "resolution": resolution,
            "records": [],
            "warnings": resolution.get("warnings") or [],
        }
    next_metadata = {
        **metadata,
        "title": resolution["title"],
        "subtitle": resolution.get("subtitle") or existing_subtitle or "",
        "title_subtitle_resolution": _title_subtitle_provenance(resolution),
    }
    if include_summary:
        next_metadata["summary"] = resolution.get("summary") or existing_summary or ""
        next_metadata["summary_resolution"] = _summary_resolution_provenance(resolution)
    records = []
    summary_changed = (
        include_summary
        and (
            refresh
            or refresh_summary
            or existing_summary != (resolution.get("summary") or "")
            or metadata.get("summary_resolution") != next_metadata.get("summary_resolution")
        )
    )
    if (
        refresh
        or not existing_title
        or existing_title != resolution["title"]
        or existing_subtitle != (resolution.get("subtitle") or "")
        or metadata.get("title_subtitle_resolution") != next_metadata.get("title_subtitle_resolution")
        or summary_changed
    ):
        records.append({
            "modelName": "Reference",
            "action": "update",
            "input": {
                "id": reference["id"],
                "title": resolution["title"],
                "updatedAt": now,
            },
        })
    metadata_attachment = _model_attachment(
        owner_kind="reference",
        owner_id=reference["id"],
        role="metadata",
        sort_key="metadata",
        filename="metadata.json",
        media_type="application/json",
        content=next_metadata,
        import_run_id=reference.get("importRunId"),
        now=now,
    )
    records.append({"modelName": "ModelAttachment", "action": "create", "input": metadata_attachment["record"], "body": metadata_attachment["body"]})
    return {
        "kind": "reference.title-subtitle.plan",
        "action": "update" if records else "noop",
        "reference": _reference_summary(reference),
        "title": resolution["title"],
        "subtitle": next_metadata.get("subtitle") or "",
        "summary": next_metadata.get("summary") or "",
        "resolution": resolution,
        "records": records,
        "warnings": resolution.get("warnings") or [],
    }


def reference_title_subtitle_resolve(
    *,
    reference_id: str,
    model: str = "gpt-5.4-mini",
    apply: bool = False,
    refresh: bool = False,
    summary: bool = True,
    summary_max_tokens: int = TITLE_SUBTITLE_SUMMARY_TOKEN_BUDGET_DEFAULT,
    refresh_summary: bool = False,
    web_search: bool = True,
    persist_local_metadata: bool = True,
    vector_sync: bool = True,
    source_text: str = "",
    source_text_file: str = "",
) -> dict[str, Any]:
    semantic = _semantic_client()
    reference = _resolve_reference(semantic, reference_id)
    source = _resolve_source_text(reference, source_text=source_text, source_text_file=source_text_file) if (source_text or source_text_file or summary) else ""
    sidecar = _read_reference_sidecar(reference)
    catalog_entry = _read_reference_catalog_entry(reference)
    plan = build_reference_title_subtitle_plan(
        reference=reference,
        catalog_entry=catalog_entry,
        sidecar=sidecar,
        source_text=source,
        web_search_enabled=web_search,
        model=model,
        refresh=refresh,
        include_summary=summary,
        summary_max_tokens=summary_max_tokens,
        refresh_summary=refresh_summary,
        semantic_client=semantic,
    )
    result = _apply_plan_if_requested(plan, apply=apply, actor_label=TITLE_SUBTITLE_SOURCE, reason="references title-subtitle resolve")
    result["localMetadata"] = build_title_subtitle_local_metadata_plan(reference=reference, resolution=plan.get("resolution") or {})
    if apply and persist_local_metadata and plan.get("resolution", {}).get("status") == "resolved":
        result["localMetadata"] = apply_title_subtitle_local_metadata(reference=reference, resolution=plan["resolution"])
    elif apply and not persist_local_metadata:
        result["localMetadata"] = {**result["localMetadata"], "skipped": True, "reason": "local_metadata_persistence_disabled"}
    return _attach_title_subtitle_surface_statuses(
        result,
        references=[reference],
        apply=apply,
        vector_sync=vector_sync,
    )


def reference_title_subtitle_batch(
    *,
    corpus_key: str,
    max_count: int = 10,
    status: str = "all",
    model: str = "gpt-5.4-mini",
    apply: bool = False,
    refresh: bool = False,
    summary: bool = True,
    summary_max_tokens: int = TITLE_SUBTITLE_SUMMARY_TOKEN_BUDGET_DEFAULT,
    refresh_summary: bool = False,
    only_missing: bool = True,
    web_search: bool = True,
    persist_local_metadata: bool = True,
    vector_sync: bool = True,
    scan_limit: int = 1000,
) -> dict[str, Any]:
    references = _select_references_for_curation_batch(
        corpus_key=corpus_key,
        status=status,
        max_count=max_count,
        scan_limit=scan_limit,
    )
    items = []
    for reference in references:
        metadata = _jsonish(reference.get("metadata")) or {}
        has_title = bool(_normalize_reference_title_candidate(reference.get("title")))
        has_subtitle = bool(_normalize_subtitle_candidate(metadata.get("subtitle") or reference.get("subtitle")))
        has_summary = bool(_normalize_outcome_summary_candidate(metadata.get("summary")))
        if only_missing and has_title and has_subtitle and (has_summary if summary else True) and not refresh and not refresh_summary:
            items.append({
                "kind": "reference.title-subtitle.resolve",
                "action": "noop",
                "reference": _reference_summary(reference),
                "title": _normalize_reference_title_candidate(reference.get("title")),
                "subtitle": _normalize_subtitle_candidate(metadata.get("subtitle") or reference.get("subtitle")),
                "summary": _normalize_outcome_summary_candidate(metadata.get("summary")),
                "apply": False,
            })
            continue
        try:
            item = reference_title_subtitle_resolve(
                reference_id=reference["id"],
                model=model,
                apply=apply,
                refresh=refresh,
                summary=summary,
                summary_max_tokens=summary_max_tokens,
                refresh_summary=refresh_summary,
                web_search=web_search,
                persist_local_metadata=persist_local_metadata,
                vector_sync=False,
            )
            items.append(item)
        except Exception as exc:
            items.append({
                "kind": "reference.title-subtitle.resolve",
                "action": "error",
                "reference": _reference_summary(reference),
                "error": str(exc),
                "apply": False,
            })
    result = _title_subtitle_batch_result(
        kind="reference.title-subtitle.batch",
        corpus_key=corpus_key,
        status=status,
        model=model,
        apply=apply,
        web_search=web_search,
        items=items,
    )
    if apply and vector_sync:
        changed_references = [
            reference for reference, item in zip(references, items)
            if item.get("action") == "update" and item.get("apply")
        ]
        vector_result = _sync_reference_vectors(changed_references)
        result["vectorSync"] = vector_result
        _apply_vector_sync_results_to_items(items, vector_result)
        if vector_result.get("failed"):
            result["partialFailure"] = True
            result.setdefault("warnings", []).append(vector_result["message"])
    else:
        result["vectorSync"] = {
            "resultsByLineageId": {},
            "resultsByReferenceId": {},
            "skippedReason": "vector_sync_disabled" if not vector_sync else "not_applied",
        }
        _apply_vector_sync_results_to_items(items, result["vectorSync"])
    return result


def _title_subtitle_batch_result(
    *,
    kind: str,
    corpus_key: str,
    status: str,
    model: str,
    apply: bool,
    web_search: bool,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "kind": kind,
        "corpusKey": corpus_key,
        "status": status or "all",
        "model": model,
        "apply": apply,
        "webSearch": web_search,
        "count": len(items),
        "updated": sum(1 for item in items if item.get("action") == "update"),
        "summaryGenerated": sum(
            1 for item in items
            if item.get("action") == "update" and _clean_text((item.get("resolution") or {}).get("summary"))
        ),
        "unresolved": sum(1 for item in items if item.get("action") == "unresolved"),
        "noop": sum(1 for item in items if item.get("action") == "noop"),
        "errors": sum(1 for item in items if item.get("action") == "error"),
        "items": items,
    }


def enrich_reference_catalog_title_subtitle(
    *,
    catalog: dict[str, Any],
    web_search: bool = True,
    model: str = "gpt-5.4-mini",
    summary: bool = True,
    summary_max_tokens: int = TITLE_SUBTITLE_SUMMARY_TOKEN_BUDGET_DEFAULT,
    refresh_summary: bool = False,
    only_missing: bool = True,
    max_count: int = 0,
) -> dict[str, Any]:
    items_value = catalog.get("items") if isinstance(catalog, dict) else []
    entries = _catalog_entries(items_value)
    entries.sort(key=lambda entry: _catalog_entry_chrono_key(entry[1]), reverse=True)
    output_items = items_value.copy() if isinstance(items_value, list) else dict(items_value or {})
    results = []
    processed = 0
    for key, item in entries:
        if max_count and processed >= max_count:
            break
        if not isinstance(item, dict):
            continue
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        has_durable_title = bool(_clean_text(item.get("title")) and _clean_text(metadata.get("title")))
        has_durable_subtitle = bool(_normalize_subtitle_candidate(item.get("subtitle")) and _normalize_subtitle_candidate(metadata.get("subtitle")))
        has_durable_summary = bool(_normalize_outcome_summary_candidate(item.get("summary")) and _normalize_outcome_summary_candidate(metadata.get("summary")))
        if only_missing and has_durable_title and has_durable_subtitle and (has_durable_summary if summary else True) and not refresh_summary:
            results.append({
                "action": "noop",
                "itemKey": key,
                "title": item.get("title"),
                "subtitle": item.get("subtitle") or metadata.get("subtitle"),
                "summary": item.get("summary") or metadata.get("summary"),
            })
            continue
        processed += 1
        resolution = resolve_reference_title_subtitle(
            reference=_reference_from_catalog_item(item),
            catalog_entry=item,
            sidecar={},
            source_text=_catalog_source_text(item),
            web_search_enabled=web_search,
            model=model,
            include_summary=summary,
            summary_max_tokens=summary_max_tokens,
            refresh_summary=refresh_summary,
        )
        if resolution["status"] != "resolved":
            results.append({"action": "unresolved", "itemKey": key, "resolution": resolution})
            continue
        enriched = apply_title_subtitle_to_catalog_item(item, resolution=resolution)
        if isinstance(output_items, list):
            output_items[int(key)] = enriched
        else:
            output_items[key] = enriched
        results.append({"action": "update", "itemKey": key, "resolution": resolution})
    output = {
        **catalog,
        "items": output_items,
        "title_subtitle_enrichment": {
            "tool": TITLE_SUBTITLE_SOURCE,
            "model": model,
            "web_search": web_search,
            "summary": summary,
            "summary_max_tokens": summary_max_tokens,
            "updated_at": _now(),
            "processed": processed,
            "updated": sum(1 for item in results if item.get("action") == "update"),
            "summary_generated": sum(
                1 for item in results
                if item.get("action") == "update" and _clean_text((item.get("resolution") or {}).get("summary"))
            ),
            "unresolved": sum(1 for item in results if item.get("action") == "unresolved"),
            "noop": sum(1 for item in results if item.get("action") == "noop"),
        },
    }
    return {"kind": "reference.title-subtitle.enrich-catalog", "catalog": output, "items": results, **output["title_subtitle_enrichment"]}


def reference_title_subtitle_enrich_catalog_file(
    *,
    catalog_path: str,
    output_path: str,
    web_search: bool = True,
    model: str = "gpt-5.4-mini",
    summary: bool = True,
    summary_max_tokens: int = TITLE_SUBTITLE_SUMMARY_TOKEN_BUDGET_DEFAULT,
    refresh_summary: bool = False,
    only_missing: bool = True,
    max_count: int = 0,
) -> dict[str, Any]:
    path = Path(catalog_path).expanduser()
    catalog = json.loads(path.read_text(encoding="utf-8"))
    result = enrich_reference_catalog_title_subtitle(
        catalog=catalog,
        web_search=web_search,
        model=model,
        summary=summary,
        summary_max_tokens=summary_max_tokens,
        refresh_summary=refresh_summary,
        only_missing=only_missing,
        max_count=max_count,
    )
    output = Path(output_path).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result["catalog"], indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return {key: value for key, value in result.items() if key != "catalog"} | {"outputPath": str(output)}


def reference_quality_set(
    *,
    reference_id: str,
    rating: int,
    note: str = "",
    actor_label: str = "papyrus-newsroom",
    apply: bool = False,
    refresh: bool = False,
    persist_local_metadata: bool = True,
) -> dict[str, Any]:
    semantic = _semantic_client()
    reference = _resolve_reference(semantic, reference_id)
    plan = build_reference_quality_plan(
        reference=reference,
        rating=rating,
        note=note,
        actor_label=actor_label,
        refresh=refresh,
        semantic_client=semantic,
    )
    local_metadata_plan = build_quality_local_metadata_plan(
        reference=reference,
        rating=rating,
        note=note,
        actor_label=actor_label,
    )
    result = _apply_plan_if_requested(plan, apply=apply, actor_label=actor_label, reason="references quality set")
    result["localMetadata"] = local_metadata_plan
    if apply and persist_local_metadata:
        local_result = apply_quality_local_metadata(reference=reference, rating=rating, note=note, actor_label=actor_label)
        result["localMetadata"] = local_result
        if local_result.get("errors"):
            result.setdefault("warnings", []).append(f"Quality local metadata persistence had {len(local_result['errors'])} error(s).")
    elif apply and not persist_local_metadata:
        result["localMetadata"] = {**local_metadata_plan, "skipped": True, "reason": "local_metadata_persistence_disabled"}
    return result


def reference_quality_assess(
    *,
    reference_id: str,
    model: str = "gpt-5.4-mini",
    apply: bool = False,
    refresh: bool = False,
    persist_local_metadata: bool = True,
    source_text: str = "",
    source_text_file: str = "",
) -> dict[str, Any]:
    semantic = _semantic_client()
    reference = _resolve_reference(semantic, reference_id)
    existing = _current_relations(
        semantic.list_outgoing("reference", reference["lineageId"])["relations"],
        QUALITY_RELATION_TYPE_KEY,
    )
    if existing and not refresh:
        quality = _quality_from_relation(existing[0])
        return {
            "kind": "reference.quality.assess",
            "action": "noop",
            "reference": _reference_summary(reference),
            "quality": quality,
            "existingRelationId": existing[0].get("id"),
            "warnings": [],
            "apply": False,
        }
    source = _resolve_source_text(reference, source_text=source_text, source_text_file=source_text_file)
    doctrine_context = load_publication_doctrine_context()
    assessment = generate_quality_assessment(
        source,
        reference=reference,
        model=model,
        doctrine_context=doctrine_context,
    )
    note = _quality_assessment_note(assessment)
    plan = build_reference_quality_plan(
        reference=reference,
        rating=assessment["rating"],
        note=note,
        actor_label=QUALITY_ASSESSMENT_SOURCE,
        source=QUALITY_ASSESSMENT_SOURCE,
        refresh=refresh,
        semantic_client=semantic,
    )
    plan["kind"] = "reference.quality.assess"
    plan["assessment"] = assessment
    plan["model"] = model
    plan["promptVersion"] = QUALITY_ASSESSMENT_PROMPT_VERSION
    plan["doctrineContext"] = doctrine_summary_metadata(doctrine_context)
    result = _apply_plan_if_requested(plan, apply=apply, actor_label=QUALITY_ASSESSMENT_SOURCE, reason="references quality assess")
    result = _with_doctrine_warnings(result, doctrine_context)
    result["localMetadata"] = build_quality_local_metadata_plan(
        reference=reference,
        rating=assessment["rating"],
        note=note,
        actor_label=QUALITY_ASSESSMENT_SOURCE,
    )
    if apply and persist_local_metadata:
        local_result = apply_quality_local_metadata(
            reference=reference,
            rating=assessment["rating"],
            note=note,
            actor_label=QUALITY_ASSESSMENT_SOURCE,
        )
        result["localMetadata"] = local_result
        if local_result.get("errors"):
            result.setdefault("warnings", []).append(f"Quality local metadata persistence had {len(local_result['errors'])} error(s).")
    elif apply and not persist_local_metadata:
        result["localMetadata"] = {**result["localMetadata"], "skipped": True, "reason": "local_metadata_persistence_disabled"}
    return result


def reference_quality_assess_batch(
    *,
    corpus_key: str,
    max_count: int = 10,
    status: str = "accepted",
    model: str = "gpt-5.4-mini",
    apply: bool = False,
    refresh: bool = False,
    only_missing: bool = True,
    persist_local_metadata: bool = True,
    scan_limit: int = 1000,
) -> dict[str, Any]:
    semantic = _semantic_client()
    references = _select_references_for_curation_batch(
        corpus_key=corpus_key,
        status=status,
        max_count=max_count,
        scan_limit=scan_limit,
    )
    doctrine_context = load_publication_doctrine_context()
    items = []
    rating_counts: dict[str, int] = {}
    for reference in references:
        existing = _current_relations(
            semantic.list_outgoing("reference", reference["lineageId"])["relations"],
            QUALITY_RELATION_TYPE_KEY,
        )
        if existing and only_missing and not refresh:
            quality = _quality_from_relation(existing[0])
            item = {
                "kind": "reference.quality.assess",
                "action": "noop",
                "reference": _reference_summary(reference),
                "quality": quality,
                "existingRelationId": existing[0].get("id"),
                "warnings": [],
                "apply": False,
            }
            items.append(item)
            if quality and quality.get("rating") is not None:
                key = str(quality["rating"])
                rating_counts[key] = rating_counts.get(key, 0) + 1
            continue
        try:
            source = _resolve_source_text(reference)
            assessment = generate_quality_assessment(
                source,
                reference=reference,
                model=model,
                doctrine_context=doctrine_context,
            )
            note = _quality_assessment_note(assessment)
            plan = build_reference_quality_plan(
                reference=reference,
                rating=assessment["rating"],
                note=note,
                actor_label=QUALITY_ASSESSMENT_SOURCE,
                source=QUALITY_ASSESSMENT_SOURCE,
                refresh=refresh or bool(existing and not only_missing),
                semantic_client=semantic,
            )
            plan["kind"] = "reference.quality.assess"
            plan["assessment"] = assessment
            plan["model"] = model
            plan["promptVersion"] = QUALITY_ASSESSMENT_PROMPT_VERSION
            plan["doctrineContext"] = doctrine_summary_metadata(doctrine_context)
            item = _apply_plan_if_requested(plan, apply=apply, actor_label=QUALITY_ASSESSMENT_SOURCE, reason="references quality assess-batch")
            item = _with_doctrine_warnings(item, doctrine_context)
            item["localMetadata"] = build_quality_local_metadata_plan(
                reference=reference,
                rating=assessment["rating"],
                note=note,
                actor_label=QUALITY_ASSESSMENT_SOURCE,
            )
            if apply and persist_local_metadata:
                local_result = apply_quality_local_metadata(
                    reference=reference,
                    rating=assessment["rating"],
                    note=note,
                    actor_label=QUALITY_ASSESSMENT_SOURCE,
                )
                item["localMetadata"] = local_result
                if local_result.get("errors"):
                    item.setdefault("warnings", []).append(f"Quality local metadata persistence had {len(local_result['errors'])} error(s).")
            elif apply and not persist_local_metadata:
                item["localMetadata"] = {**item["localMetadata"], "skipped": True, "reason": "local_metadata_persistence_disabled"}
            items.append(item)
            key = str(assessment["rating"])
            rating_counts[key] = rating_counts.get(key, 0) + 1
        except Exception as exc:
            items.append({
                "kind": "reference.quality.assess",
                "action": "error",
                "reference": _reference_summary(reference),
                "error": str(exc),
                "warnings": [],
                "apply": False,
            })
    return {
        "kind": "reference.quality.assess-batch",
        "corpusKey": corpus_key,
        "status": status,
        "model": model,
        "apply": apply,
        "doctrineContext": doctrine_summary_metadata(doctrine_context),
        "warnings": list(doctrine_context.get("warnings") or []),
        "count": len(items),
        "created": sum(1 for item in items if item.get("action") == "create"),
        "noop": sum(1 for item in items if item.get("action") == "noop"),
        "errors": sum(1 for item in items if item.get("action") == "error"),
        "ratingCounts": dict(sorted(rating_counts.items())),
        "items": items,
    }


def reference_quality_get(*, reference_id: str) -> dict[str, Any]:
    semantic = _semantic_client()
    reference = _resolve_reference(semantic, reference_id)
    relations = _current_relations(
        semantic.list_outgoing("reference", reference["lineageId"])["relations"],
        QUALITY_RELATION_TYPE_KEY,
    )
    relation = relations[0] if relations else None
    return {
        "kind": "reference.quality.get",
        "reference": _reference_summary(reference),
        "quality": _quality_from_relation(relation) if relation else None,
        "relation": _quality_relation_for_output(relation),
    }


def build_quality_local_metadata_plan(
    *,
    reference: dict[str, Any],
    rating: int,
    note: str = "",
    actor_label: str = "papyrus-newsroom",
) -> dict[str, Any]:
    reference = _require_reference(reference)
    sidecar_path = _sidecar_path_for_reference(reference)
    catalog_path, catalog_item_key = _catalog_location_for_reference(reference)
    return {
        "kind": "reference.quality.local-metadata.plan",
        "referenceId": reference.get("id"),
        "externalItemId": reference.get("externalItemId"),
        "rating": normalize_quality_rating(rating),
        "qualityNodeKey": quality_node_key(rating),
        "sidecarPath": str(sidecar_path) if sidecar_path else None,
        "catalogPath": str(catalog_path) if catalog_path else None,
        "catalogItemKey": catalog_item_key,
        "note": note,
        "actorLabel": actor_label,
    }


def apply_quality_local_metadata(
    *,
    reference: dict[str, Any],
    rating: int,
    note: str = "",
    actor_label: str = "papyrus-newsroom",
) -> dict[str, Any]:
    now = _now()
    rating = normalize_quality_rating(rating)
    payload = _quality_local_metadata_payload(rating=rating, note=note, actor_label=actor_label, now=now)
    sidecar_path = _sidecar_path_for_reference(reference)
    catalog_path, catalog_item_key = _catalog_location_for_reference(reference)
    updated = []
    skipped = []
    errors = []

    if sidecar_path:
        try:
            existed = sidecar_path.exists()
            parsed = _read_yaml_file(sidecar_path) if existed else {}
            current_rating = _quality_rating_from_metadata(parsed)
            if current_rating == rating:
                skipped.append({"target": "sidecar", "path": str(sidecar_path), "reason": "quality_rating_already_present"})
            else:
                parsed["quality"] = {
                    **(parsed.get("quality") if isinstance(parsed.get("quality"), dict) else {}),
                    "rating": rating,
                    "rating_node_key": quality_node_key(rating),
                }
                parsed["papyrus"] = {
                    **(parsed.get("papyrus") if isinstance(parsed.get("papyrus"), dict) else {}),
                    "quality_rating": payload,
                }
                sidecar_path.parent.mkdir(parents=True, exist_ok=True)
                sidecar_path.write_text(_dump_yaml(parsed), encoding="utf-8")
                updated.append({"target": "sidecar", "path": str(sidecar_path), "created": not existed})
        except Exception as exc:
            errors.append({"target": "sidecar", "path": str(sidecar_path), "error": str(exc)})
    else:
        skipped.append({"target": "sidecar", "reason": "missing_local_source_path"})

    if catalog_path and catalog_item_key:
        try:
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            items = catalog.get("items") if isinstance(catalog, dict) else None
            item = items.get(catalog_item_key) if isinstance(items, dict) else None
            if not isinstance(item, dict):
                skipped.append({"target": "catalog", "path": str(catalog_path), "reason": "catalog_item_not_found"})
            else:
                metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
                current_rating = _quality_rating_from_metadata(metadata) or _quality_rating_from_metadata(item)
                if current_rating == rating:
                    skipped.append({"target": "catalog", "path": str(catalog_path), "reason": "quality_rating_already_present"})
                else:
                    metadata["quality"] = {
                        **(metadata.get("quality") if isinstance(metadata.get("quality"), dict) else {}),
                        "rating": rating,
                        "rating_node_key": quality_node_key(rating),
                    }
                    metadata["papyrus"] = {
                        **(metadata.get("papyrus") if isinstance(metadata.get("papyrus"), dict) else {}),
                        "quality_rating": payload,
                    }
                    item["metadata"] = metadata
                    item["quality"] = {
                        **(item.get("quality") if isinstance(item.get("quality"), dict) else {}),
                        "rating": rating,
                        "rating_node_key": quality_node_key(rating),
                    }
                    catalog_path.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n", encoding="utf-8")
                    updated.append({"target": "catalog", "path": str(catalog_path), "itemKey": catalog_item_key})
        except Exception as exc:
            errors.append({"target": "catalog", "path": str(catalog_path), "error": str(exc)})
    else:
        skipped.append({"target": "catalog", "reason": "catalog_not_found"})

    return {
        "kind": "reference.quality.local-metadata.applied",
        "referenceId": reference.get("id"),
        "externalItemId": reference.get("externalItemId"),
        "rating": rating,
        "qualityNodeKey": quality_node_key(rating),
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    }


def reference_quality_list(*, corpus_key: str, rating: int | None = None, min_rating: int | None = None, limit: int = 100) -> dict[str, Any]:
    semantic = _semantic_client()
    references = list_references_by_corpus(_knowledge_corpus_id(corpus_key), limit=limit)
    rows = []
    for reference in references:
        relations = _current_relations(
            semantic.list_outgoing("reference", reference["lineageId"])["relations"],
            QUALITY_RELATION_TYPE_KEY,
        )
        quality = _quality_from_relation(relations[0]) if relations else None
        if rating is not None and (not quality or quality["rating"] != normalize_quality_rating(rating)):
            continue
        if min_rating is not None and (not quality or quality["rating"] < normalize_quality_rating(min_rating)):
            continue
        rows.append({"reference": _reference_summary(reference), "quality": quality})
    return {"kind": "reference.quality.list", "corpusKey": corpus_key, "count": len(rows), "items": rows}


def reference_list(
    *,
    corpus_key: str,
    limit: int = 25,
    status: str = "",
    order: str = "newest",
    scan_limit: int = 1000,
) -> dict[str, Any]:
    references = list_references_by_corpus(_knowledge_corpus_id(corpus_key), limit=max(scan_limit, limit))
    if status:
        normalized_status = status.strip().lower()
        references = [reference for reference in references if str(reference.get("curationStatus") or "").lower() == normalized_status]
    reverse = order != "oldest"
    references.sort(key=_reference_chrono_key, reverse=reverse)
    selected = references[:max(int(limit or 25), 1)]
    return {
        "kind": "reference.list",
        "corpusKey": corpus_key,
        "status": status or "all",
        "order": "newest" if reverse else "oldest",
        "count": len(selected),
        "scanned": len(references),
        "items": [_reference_summary(reference) | {
            "sourceUri": reference.get("sourceUri"),
            "storagePath": reference.get("storagePath"),
            "importedAt": reference.get("importedAt"),
            "updatedAt": reference.get("updatedAt"),
        } for reference in selected],
    }


def _select_references_for_curation_batch(
    *,
    corpus_key: str,
    status: str,
    max_count: int,
    scan_limit: int,
) -> list[dict[str, Any]]:
    references = list_references_by_corpus(_knowledge_corpus_id(corpus_key), limit=max(scan_limit, max_count or 1))
    if status and str(status).strip().lower() not in {"all", "*"}:
        normalized_status = status.strip().lower()
        references = [reference for reference in references if str(reference.get("curationStatus") or "").lower() == normalized_status]
    references.sort(key=_reference_chrono_key, reverse=True)
    return references[:max(int(max_count or 10), 1)]


def reference_summaries(*, reference_id: str, max_tokens: int | None = None) -> dict[str, Any]:
    semantic = _semantic_client()
    reference = _resolve_reference(semantic, reference_id)
    result = semantic.list_reference_summaries(reference["lineageId"], max_tokens=max_tokens)
    return {
        "kind": "reference.summaries",
        "reference": _reference_summary(reference),
        "maxTokens": max_tokens,
        "count": len(result["summaries"]),
        "summaries": result["summaries"],
    }


def reference_summarize(
    *,
    reference_id: str,
    max_tokens: int,
    summary_text: str = "",
    source_text: str = "",
    source_text_file: str = "",
    model: str = "gpt-5.4-mini",
    apply: bool = False,
    refresh: bool = False,
) -> dict[str, Any]:
    semantic = _semantic_client()
    reference = _resolve_reference(semantic, reference_id)
    relation_key = summary_relation_type_key(max_tokens)
    existing = _current_relations(semantic.list_incoming("reference", reference["lineageId"])["relations"], relation_key)
    if existing and not refresh:
        return {
            "kind": "reference.summary.plan",
            "action": "noop",
            "reference": _reference_summary(reference),
            "maxTokens": normalize_summary_budget(max_tokens),
            "existingRelationId": existing[0].get("id"),
            "records": [],
            "warnings": [],
            "apply": False,
        }
    source = (
        _resolve_source_text(reference, source_text=source_text, source_text_file=source_text_file)
        if (not summary_text or source_text or source_text_file)
        else ""
    )
    doctrine_context = manual_summary_doctrine_context() if summary_text else load_publication_doctrine_context()
    generated = summary_text or generate_summary(source, max_tokens=max_tokens, model=model, reference=reference, doctrine_context=doctrine_context)
    plan = build_reference_summary_plan(
        reference=reference,
        max_tokens=max_tokens,
        summary_text=generated,
        source_text=source,
        model=model if not summary_text else "manual",
        doctrine_context=doctrine_context,
        refresh=refresh,
        semantic_client=semantic,
    )
    result = _apply_plan_if_requested(plan, apply=apply, actor_label=SUMMARY_SOURCE, reason="references summarize")
    return _with_doctrine_warnings(result, doctrine_context)


def reference_summarize_batch(
    *,
    corpus_key: str,
    budgets: list[int],
    only_missing: bool = True,
    max_count: int = 0,
    model: str = "gpt-5.4-mini",
    apply: bool = False,
    refresh: bool = False,
) -> dict[str, Any]:
    semantic = _semantic_client()
    references = list_references_by_corpus(_knowledge_corpus_id(corpus_key), limit=max_count or 1000)
    doctrine_context = load_publication_doctrine_context()
    plans = []
    for reference in references:
        for budget in budgets:
            relation_key = summary_relation_type_key(budget)
            existing = _current_relations(semantic.list_incoming("reference", reference["lineageId"])["relations"], relation_key)
            if existing and only_missing and not refresh:
                plans.append({
                    "kind": "reference.summary.plan",
                    "action": "noop",
                    "reference": _reference_summary(reference),
                    "maxTokens": budget,
                    "existingRelationId": existing[0].get("id"),
                    "records": [],
                    "warnings": [],
                })
                continue
            source = _resolve_source_text(reference)
            generated = generate_summary(source, max_tokens=budget, model=model, reference=reference, doctrine_context=doctrine_context)
            plans.append(build_reference_summary_plan(
                reference=reference,
                max_tokens=budget,
                summary_text=generated,
                source_text=source,
                model=model,
                doctrine_context=doctrine_context,
                refresh=refresh or bool(existing and not only_missing),
                semantic_client=semantic,
            ))
    applied = []
    for plan in plans:
        applied.append(_apply_plan_if_requested(plan, apply=apply, actor_label=SUMMARY_SOURCE, reason="references summarize-batch"))
    return {
        "kind": "reference.summary.batch",
        "corpusKey": corpus_key,
        "budgets": budgets,
        "apply": apply,
        "doctrineContext": doctrine_summary_metadata(doctrine_context),
        "warnings": list(doctrine_context.get("warnings") or []),
        "count": len(applied),
        "created": sum(1 for item in applied if item.get("action") == "create"),
        "noop": sum(1 for item in applied if item.get("action") == "noop"),
        "items": applied,
    }


def list_references_by_corpus(corpus_id: str, limit: int = 1000) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    next_token = None
    while True:
        data = _graphql(LIST_REFERENCES_BY_CORPUS_QUERY, {"corpusId": corpus_id, "limit": min(max(limit - len(records), 1), 100), "nextToken": next_token})
        connection = data.get("listReferencesByCorpusAndExternalItem") or {}
        records.extend(connection.get("items") or [])
        next_token = connection.get("nextToken")
        if not next_token or len(records) >= limit:
            break
    return [record for record in records if record.get("versionState") == "current"]


def load_publication_doctrine_context(*, graphql_func: Any | None = None) -> dict[str, Any]:
    graphql = graphql_func or _graphql
    records = []
    warnings = []
    for slug in PUBLICATION_DOCTRINE_SLUGS:
        try:
            record = _get_current_doctrine_item_by_slug(slug, graphql)
        except Exception as exc:
            warnings.append(f"Could not load publication doctrine {slug}: {exc}")
            record = None
        if record:
            records.append(_doctrine_context_record(record))
        else:
            warnings.append(f"Publication doctrine {slug} is missing.")
    found_slugs = [record["slug"] for record in records]
    if len(found_slugs) == len(PUBLICATION_DOCTRINE_SLUGS):
        status = "loaded"
    elif found_slugs:
        status = "partial"
    else:
        status = "missing"
    content_hash = _hash_text(json.dumps(records, sort_keys=True)) if records else ""
    return {
        "status": status,
        "scope": "publication",
        "policyUse": DOCTRINE_POLICY_USE,
        "slugs": found_slugs,
        "records": records,
        "contentHash": content_hash,
        "warnings": warnings,
    }


def manual_summary_doctrine_context() -> dict[str, Any]:
    return {
        "status": "not_used_manual_summary",
        "scope": "publication",
        "policyUse": DOCTRINE_POLICY_USE,
        "slugs": [],
        "records": [],
        "contentHash": "",
        "warnings": [],
    }


def doctrine_summary_metadata(doctrine_context: dict[str, Any] | None) -> dict[str, Any]:
    context = doctrine_context or {}
    return {
        "doctrineContextStatus": context.get("status") or "missing",
        "doctrineSlugs": context.get("slugs") or [],
        "doctrineContentHash": context.get("contentHash") or "",
        "doctrineScope": context.get("scope") or "publication",
        "policyUse": context.get("policyUse") or DOCTRINE_POLICY_USE,
    }


def build_summary_prompt(
    source_text: str,
    *,
    max_tokens: int,
    reference: dict[str, Any],
    doctrine_context: dict[str, Any] | None = None,
) -> str:
    budget = normalize_summary_budget(max_tokens)
    context = doctrine_context or load_publication_doctrine_context()
    doctrine_block = _format_publication_doctrine_prompt_block(context)
    return "\n".join([
        f"Write a concise summary of this reference in no more than {budget} tokens.",
        "Preserve the central contribution, method, evidence type, and relevance to the knowledge base.",
        "Do not add citations or claims that are not supported by the provided text.",
        "",
        "Publication Context:",
        doctrine_block,
        "",
        "Important policy-use rule: Editorial policies describe standards for downstream published Papyrus content. They are included only as publication context for this Reference summary and should not be treated as rules that the Reference itself must satisfy.",
        "",
        f"Title: {reference.get('title') or ''}",
        f"Source URI: {reference.get('sourceUri') or ''}",
        "",
        source_text[:50000],
    ])


def build_quality_assessment_prompt(
    source_text: str,
    *,
    reference: dict[str, Any],
    rubric: str,
    doctrine_context: dict[str, Any] | None = None,
) -> str:
    context = doctrine_context or load_publication_doctrine_context()
    return "\n".join([
        "Assess this Reference's source quality using the supplied quality rubric.",
        "Return only JSON with keys: rating, rationale, evidence, caveats.",
        "The rating must be an integer from 1 to 5.",
        "",
        "Publication Context:",
        _format_publication_doctrine_prompt_block(context),
        "",
        "Important policy-use rule: Do not score the Reference by whether it complies with publication policies. Score source quality under the quality rubric; doctrine is only background about the publication's interests.",
        "",
        "Quality Rubric:",
        rubric.strip(),
        "",
        f"Title: {reference.get('title') or ''}",
        f"Source URI: {reference.get('sourceUri') or ''}",
        "",
        source_text[:50000],
    ])


def build_title_subtitle_prompt(
    *,
    reference: dict[str, Any],
    catalog_entry: dict[str, Any],
    source_text: str = "",
    known_title: str = "",
    known_subtitle: str = "",
) -> str:
    return "\n".join([
        "Resolve the original title and subtitle for this Reference.",
        "Use the original title verbatim if available. Use the original subtitle verbatim if available. Do not paraphrase original titles or subtitles.",
        "If the known title includes citation wrappers or source labels like leading arXiv ids, trailing '- arXiv', trailing publisher branding, or 'accessed <date>', remove that noise and recover the original work title.",
        "If no original subtitle exists, you may write a concise generated fallback subtitle, but set subtitle_mode to generated_fallback.",
        "A generated fallback subtitle must be informative, grounded in the source, and usually 4 to 12 words.",
        "Subtitle must be one short prose line. Do not use Markdown. Do not use bullet points. Do not use numbered lists. Do not include line breaks.",
        "Do not return placeholder subtitles like 'No subtitle available', 'generated fallback subtitle', 'arXiv preprint', or source-brand labels.",
        "Return strict JSON with keys: title, subtitle, title_mode, subtitle_mode, source_urls, rationale.",
        "Allowed modes: original_metadata, original_web_metadata, original_source_heading, generated_fallback, unresolved.",
        "",
        f"Known title: {known_title}",
        f"Known subtitle: {known_subtitle}",
        f"Reference title: {reference.get('title') or ''}",
        f"External item id: {reference.get('externalItemId') or catalog_entry.get('item_id') or catalog_entry.get('id') or ''}",
        f"Source URI: {reference.get('sourceUri') or catalog_entry.get('source_uri') or catalog_entry.get('sourceUri') or catalog_entry.get('url') or ''}",
        f"Authors: {', '.join(_string_list(reference.get('authors') or catalog_entry.get('authors') or []))}",
        f"Catalog metadata: {json.dumps(_compact_catalog_prompt_metadata(catalog_entry), sort_keys=True)[:2000]}",
        "",
        "Source text excerpt:",
        _source_excerpt(source_text, max_chars=3000) or "(none)",
    ])


def build_outcome_summary_prompt(
    *,
    reference: dict[str, Any],
    source_text: str,
    title: str,
    subtitle: str,
    max_tokens: int = TITLE_SUBTITLE_SUMMARY_TOKEN_BUDGET_DEFAULT,
) -> str:
    budget = normalize_title_subtitle_summary_budget(max_tokens)
    media_type = _clean_text(reference.get("mediaType"))
    source_uri = _clean_text(reference.get("sourceUri"))
    return "\n".join([
        f"Write an outcome-focused summary of this reference in no more than {budget} tokens.",
        "This is not a teaser and not a topical overview. Explain what the reference is actually saying.",
        "Focus on findings, conclusions, outcomes, recommendations, or the central message.",
        "If this is a research paper, emphasize method-backed findings, evidence, and conclusions.",
        "If this is an institutional report, emphasize main claims, recommendations, and operational implications.",
        "If this is a news/article/blog/document source, begin with a concise explanatory paragraph about the point being made.",
        "Bullet points are allowed only after that opening explanatory paragraph.",
        "If you include bullets, put them on separate lines after a blank line following the opening paragraph.",
        "Do not start with bullets. Do not add unsupported claims.",
        "",
        f"Known title: {title}",
        f"Known subtitle: {subtitle}",
        f"Reference media type: {media_type}",
        f"Source URI: {source_uri}",
        "",
        source_text[:50000],
    ])


def generate_outcome_summary(
    source_text: str,
    *,
    reference: dict[str, Any],
    title: str,
    subtitle: str,
    max_tokens: int = TITLE_SUBTITLE_SUMMARY_TOKEN_BUDGET_DEFAULT,
    model: str = "gpt-5.4-mini",
) -> str:
    source_text = _required(source_text, "source_text")
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required to generate metadata summary.")
    budget = normalize_title_subtitle_summary_budget(max_tokens)
    prompt = build_outcome_summary_prompt(
        reference=reference,
        source_text=source_text,
        title=title,
        subtitle=subtitle,
        max_tokens=budget,
    )
    payload = {
        "model": model,
        "input": [
            {"role": "system", "content": "You write concise outcome summaries for editorial curation metadata."},
            {"role": "user", "content": prompt},
        ],
        "max_output_tokens": budget + 120,
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            parsed = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI outcome summary request failed: {error.code} {body[:400]}") from error
    text = _extract_response_text(parsed)
    if not text:
        raise RuntimeError("OpenAI outcome summary request returned no text.")
    return text.strip()


def generate_title_subtitle_with_web_search(
    *,
    reference: dict[str, Any],
    catalog_entry: dict[str, Any] | None = None,
    source_text: str = "",
    known_title: str = "",
    known_subtitle: str = "",
    model: str = "gpt-5.4-mini",
) -> dict[str, Any]:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for title/subtitle web+LLM enrichment.")
    catalog_entry = catalog_entry or {}
    prompt = build_title_subtitle_prompt(
        reference=reference,
        catalog_entry=catalog_entry,
        source_text=source_text,
        known_title=known_title,
        known_subtitle=known_subtitle,
    )
    payload = {
        "model": model,
        "input": [
            {"role": "system", "content": "You resolve bibliographic title metadata for a private editorial knowledge base. Return strict JSON only."},
            {"role": "user", "content": prompt},
        ],
        "tools": [{"type": "web_search"}],
        "tool_choice": "auto",
        "include": ["web_search_call.action.sources"],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "reference_title_subtitle",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["title", "subtitle", "title_mode", "subtitle_mode", "source_urls", "rationale"],
                    "properties": {
                        "title": {"type": "string"},
                        "subtitle": {"type": "string"},
                        "title_mode": {"type": "string"},
                        "subtitle_mode": {"type": "string"},
                        "source_urls": {"type": "array", "items": {"type": "string"}},
                        "rationale": {"type": "string"},
                    },
                },
            },
        },
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            parsed = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI title/subtitle request failed: {error.code} {body[:400]}") from error
    text = _extract_response_text(parsed)
    if not text:
        raise RuntimeError("OpenAI title/subtitle request returned no text.")
    try:
        result = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("OpenAI title/subtitle request did not return JSON.") from exc
    urls = _string_list(result.get("source_urls") or [])
    urls.extend(_web_search_source_urls(parsed))
    return {
        "title": _clean_text(result.get("title")),
        "subtitle": _clean_text(result.get("subtitle")),
        "title_mode": _title_subtitle_mode(result.get("title_mode"), default="original_web_metadata"),
        "subtitle_mode": _title_subtitle_mode(result.get("subtitle_mode"), default="generated_fallback"),
        "source_urls": sorted(set(urls)),
        "rationale": _clean_text(result.get("rationale")),
        "promptVersion": TITLE_SUBTITLE_PROMPT_VERSION,
        "model": model,
    }


def generate_quality_assessment(
    source_text: str,
    *,
    reference: dict[str, Any],
    model: str,
    doctrine_context: dict[str, Any] | None = None,
    rubric: str = QUALITY_ASSESSMENT_RUBRIC,
) -> dict[str, Any]:
    source_text = _required(source_text, "source_text")
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for automated quality assessment.")
    prompt = build_quality_assessment_prompt(
        source_text,
        reference=reference,
        rubric=rubric,
        doctrine_context=doctrine_context,
    )
    payload = {
        "model": model,
        "input": [
            {"role": "system", "content": "You assess source quality for a private editorial knowledge base. You return strict JSON."},
            {"role": "user", "content": prompt},
        ],
        "max_output_tokens": 500,
        "text": {"format": {"type": "json_object"}},
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            parsed = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI quality assessment request failed: {error.code} {body[:400]}") from error
    text = _extract_response_text(parsed)
    if not text:
        raise RuntimeError("OpenAI quality assessment request returned no text.")
    assessment = _jsonish(text)
    if not isinstance(assessment, dict):
        raise RuntimeError("OpenAI quality assessment did not return a JSON object.")
    rating = normalize_quality_rating(assessment.get("rating"))
    return {
        "rating": rating,
        "rationale": str(assessment.get("rationale") or "").strip(),
        "evidence": _string_list(assessment.get("evidence") or []),
        "caveats": _string_list(assessment.get("caveats") or []),
        "model": model,
        "promptVersion": QUALITY_ASSESSMENT_PROMPT_VERSION,
        "doctrine": doctrine_summary_metadata(doctrine_context),
    }


def generate_summary(
    source_text: str,
    *,
    max_tokens: int,
    model: str,
    reference: dict[str, Any],
    doctrine_context: dict[str, Any] | None = None,
) -> str:
    source_text = _required(source_text, "source_text")
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required unless --summary-text is provided.")
    budget = normalize_summary_budget(max_tokens)
    prompt = build_summary_prompt(source_text, max_tokens=budget, reference=reference, doctrine_context=doctrine_context)
    payload = {
        "model": model,
        "input": [
            {"role": "system", "content": "You summarize research and source material for a private editorial knowledge base."},
            {"role": "user", "content": prompt},
        ],
        "max_output_tokens": budget + 80,
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            parsed = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI summary request failed: {error.code} {body[:400]}") from error
    text = _extract_response_text(parsed)
    if not text:
        raise RuntimeError("OpenAI summary request returned no text.")
    return text.strip()


def estimate_tokens(text: str, *, model: str = "") -> int:
    if not text:
        return 0
    if tiktoken is not None:
        try:
            encoding = tiktoken.encoding_for_model(model or "gpt-5.4-mini")
        except Exception:
            encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    return max(1, round(len(text.split()) * 1.33))


def _semantic_client() -> PapyrusSemanticClient:
    return PapyrusSemanticClient(_graphql)


def _resolve_reference(semantic: PapyrusSemanticClient, reference_id: str) -> dict[str, Any]:
    reference_id = _required(reference_id, "reference")
    try:
        return semantic.get_reference(reference_id)["reference"]
    except Exception:
        current = semantic._resolve_current_by_lineage("reference", reference_id)
        if current:
            return current
        raise


def _resolve_source_text(reference: dict[str, Any], *, source_text: str = "", source_text_file: str = "") -> str:
    if source_text:
        return source_text
    if source_text_file:
        return Path(source_text_file).expanduser().read_text(encoding="utf-8", errors="replace")
    storage_path = str(reference.get("storagePath") or "").strip()
    if storage_path:
        candidates = [
            Path(storage_path).expanduser(),
            PAPYRUS_ROOT / storage_path,
            PAPYRUS_ROOT.parent / "Biblicus" / storage_path,
        ]
        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                return candidate.read_text(encoding="utf-8", errors="replace")
    title = str(reference.get("title") or "").strip()
    source_uri = str(reference.get("sourceUri") or "").strip()
    fallback = "\n".join(part for part in [title, source_uri] if part)
    if fallback:
        return fallback
    raise RuntimeError("Could not resolve source text for reference; pass --source-text-file or --summary-text.")


def _get_current_doctrine_item_by_slug(slug: str, graphql_func: Any) -> dict[str, Any] | None:
    records: list[dict[str, Any]] = []
    next_token = None
    while True:
        data = graphql_func(LIST_DOCTRINE_ITEMS_BY_SLUG_QUERY, {"slug": slug, "limit": 100, "nextToken": next_token})
        connection = data.get("itemBySlug") or {}
        records.extend(connection.get("items") or [])
        next_token = connection.get("nextToken")
        if not next_token:
            break
    doctrine_records = [
        record for record in records
        if record and record.get("type") == "doctrine" and record.get("status") == "private"
    ] or [
        record for record in records
        if record and record.get("type") == "doctrine"
    ]
    return _select_current_record(doctrine_records)


def _select_current_record(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    def rank(record: dict[str, Any]) -> tuple[int, int]:
        state = record.get("versionState")
        state_rank = 0 if state == "current" else 1 if state == "draft" else 8 if state == "superseded" else 5
        try:
            version = int(record.get("versionNumber") or 0)
        except (TypeError, ValueError):
            version = 0
        return (state_rank, -version)

    candidates = [record for record in records if record and record.get("status") != "deprecated"]
    return sorted(candidates, key=rank)[0] if candidates else None


def _doctrine_context_record(record: dict[str, Any]) -> dict[str, Any]:
    editorial = _jsonish(record.get("editorial")) or {}
    body = _string_list(record.get("body") or [])
    return _compact_dict({
        "id": record.get("id"),
        "lineageId": record.get("lineageId"),
        "slug": record.get("slug"),
        "kind": editorial.get("kind") or _doctrine_kind_from_slug(record.get("slug")),
        "label": record.get("headline") or record.get("title") or record.get("slug"),
        "body": body,
        "updatedAt": record.get("updatedAt"),
    })


def _doctrine_kind_from_slug(slug: Any) -> str:
    text = str(slug or "")
    if "policy" in text:
        return "policy"
    if "mission" in text:
        return "mission"
    return "doctrine"


def _format_publication_doctrine_prompt_block(doctrine_context: dict[str, Any]) -> str:
    records = doctrine_context.get("records") if isinstance(doctrine_context, dict) else []
    if not records:
        return "No publication doctrine records were available. Continue using only the Reference text and title."
    sections = []
    for record in records:
        label = str(record.get("label") or record.get("slug") or "Publication Doctrine")
        body = _string_list(record.get("body") or [])
        sections.append("\n".join([f"{label}:", *[f"- {paragraph}" for paragraph in body]]))
    return "\n\n".join(sections)


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item or "").strip()]


def _with_doctrine_warnings(result: dict[str, Any], doctrine_context: dict[str, Any]) -> dict[str, Any]:
    warnings = [*list(result.get("warnings") or []), *list(doctrine_context.get("warnings") or [])]
    return {**result, "warnings": warnings}


def _quality_assessment_note(assessment: dict[str, Any]) -> str:
    pieces = [
        f"Automated quality assessment ({assessment.get('model')}, {assessment.get('promptVersion')}): {assessment.get('rationale') or ''}".strip(),
    ]
    evidence = _string_list(assessment.get("evidence") or [])
    caveats = _string_list(assessment.get("caveats") or [])
    if evidence:
        pieces.append("Evidence: " + "; ".join(evidence[:3]))
    if caveats:
        pieces.append("Caveats: " + "; ".join(caveats[:3]))
    return "\n".join(piece for piece in pieces if piece)


def _apply_plan_if_requested(plan: dict[str, Any], *, apply: bool, actor_label: str, reason: str) -> dict[str, Any]:
    if not apply or plan.get("action") == "noop":
        return {**plan, "apply": False}
    applied = []
    for record in plan.get("records") or []:
        action = record.get("action")
        model_name = record.get("modelName")
        if model_name == "ModelAttachment":
            _upload_model_attachment(record["input"], record.get("body") or "")
        elif action == "create":
            _create_record(model_name, record["input"])
        elif action == "update":
            _update_record(model_name, record["input"])
        else:
            raise ValueError(f"Unsupported record action: {action}")
        applied.append({"modelName": model_name, "action": action, "id": record.get("input", {}).get("id")})
    summary_delta = plan.get("summaryDelta")
    warnings = list(plan.get("warnings") or [])
    if summary_delta:
        try:
            _update_newsroom_summary(summary_delta, actor_label=actor_label, reason=reason)
        except Exception as exc:  # pragma: no cover - depends on deployed sandbox state
            warnings.append(f"Could not update Newsroom summary snapshot: {exc}")
    return {**plan, "apply": True, "applied": applied, "warnings": warnings}


def _attach_title_subtitle_surface_statuses(
    result: dict[str, Any],
    *,
    references: list[dict[str, Any]],
    apply: bool,
    vector_sync: bool,
) -> dict[str, Any]:
    updated = dict(result)
    local_metadata = updated.get("localMetadata") if isinstance(updated.get("localMetadata"), dict) else {}
    updated["localUpdated"] = bool(local_metadata.get("updated"))
    updated["graphqlUpdated"] = bool(updated.get("applied"))
    if apply and vector_sync and updated["graphqlUpdated"]:
        vector_result = _sync_reference_vectors(references)
    else:
        vector_result = {
            "resultsByLineageId": {},
            "resultsByReferenceId": {},
            "skippedReason": "vector_sync_disabled" if not vector_sync else "not_applied" if not apply else "graphql_not_updated",
        }
    updated["vectorSync"] = vector_result
    _apply_vector_sync_results_to_items([updated], vector_result, default_reference=references[0] if references else None)
    if vector_result.get("failed"):
        updated["partialFailure"] = True
        updated.setdefault("warnings", []).append(vector_result["message"])
    return updated


def _apply_vector_sync_results_to_items(
    items: list[dict[str, Any]],
    vector_result: dict[str, Any],
    *,
    default_reference: dict[str, Any] | None = None,
) -> None:
    by_lineage = vector_result.get("resultsByLineageId") if isinstance(vector_result.get("resultsByLineageId"), dict) else {}
    by_id = vector_result.get("resultsByReferenceId") if isinstance(vector_result.get("resultsByReferenceId"), dict) else {}
    skipped_reason = vector_result.get("skippedReason")
    failed = bool(vector_result.get("failed"))
    for item in items:
        reference = item.get("reference") if isinstance(item.get("reference"), dict) else default_reference or {}
        lineage_id = reference.get("lineageId")
        reference_id = reference.get("id")
        status = (
            by_lineage.get(str(lineage_id)) if lineage_id is not None else None
        ) or (
            by_id.get(str(reference_id)) if reference_id is not None else None
        )
        if status:
            item["vectorIndexUpdated"] = bool(status.get("updated"))
            item["vectorIndexSkipped"] = status.get("skipped")
            item["vectorIndexFailed"] = status.get("failed")
            continue
        item["vectorIndexUpdated"] = False
        item["vectorIndexSkipped"] = skipped_reason or ("failed" if failed else "not_requested")
        item["vectorIndexFailed"] = vector_result.get("message") if failed else None


def _sync_reference_vectors(references: list[dict[str, Any]]) -> dict[str, Any]:
    references = [reference for reference in references if isinstance(reference, dict)]
    if not references:
        return {
            "requested": 0,
            "eligible": 0,
            "resultsByLineageId": {},
            "resultsByReferenceId": {},
            "skippedReason": "no_graphql_updates",
        }
    results_by_lineage: dict[str, dict[str, Any]] = {}
    results_by_reference: dict[str, dict[str, Any]] = {}
    eligible: list[dict[str, Any]] = []
    for reference in references:
        lineage_id = str(reference.get("lineageId") or "")
        reference_id = str(reference.get("id") or "")
        if not _reference_is_vector_eligible(reference):
            result = {"updated": False, "skipped": "not_accepted", "failed": None}
            if lineage_id:
                results_by_lineage[lineage_id] = result
            if reference_id:
                results_by_reference[reference_id] = result
            continue
        eligible.append(reference)
    if not eligible:
        return {
            "requested": len(references),
            "eligible": 0,
            "resultsByLineageId": results_by_lineage,
            "resultsByReferenceId": results_by_reference,
            "skippedReason": "not_accepted",
        }

    from papyrus_knowledge_query.services import build_environment_services
    from papyrus_knowledge_query.vector_index import VectorIndexOptions, index_reference_passages

    reference_ids = tuple(
        str(reference.get("lineageId") or reference.get("id"))
        for reference in eligible
        if reference.get("lineageId") or reference.get("id")
    )
    try:
        payload = index_reference_passages(
            build_environment_services(),
            VectorIndexOptions(
                action="sync",
                reference_ids=reference_ids,
                force=True,
                progress_every=0,
            ),
        )
    except Exception as exc:
        command = _reference_vector_sync_command(reference_ids)
        message = f"Vector index sync failed after GraphQL/local updates. Retry with: {command}. Error: {exc}"
        for reference in eligible:
            lineage_id = str(reference.get("lineageId") or "")
            reference_id = str(reference.get("id") or "")
            result = {"updated": False, "skipped": None, "failed": message}
            if lineage_id:
                results_by_lineage[lineage_id] = result
            if reference_id:
                results_by_reference[reference_id] = result
        return {
            "requested": len(references),
            "eligible": len(eligible),
            "failed": True,
            "message": message,
            "nextSuggestedCommand": command,
            "resultsByLineageId": results_by_lineage,
            "resultsByReferenceId": results_by_reference,
        }

    for reference_result in payload.get("referenceResults") or []:
        lineage_id = str(reference_result.get("referenceLineageId") or "")
        reference_id = str(reference_result.get("referenceId") or "")
        status = str(reference_result.get("status") or "")
        mapped = {
            "updated": status == "indexed",
            "skipped": None if status == "indexed" else status or "unknown",
            "failed": None,
        }
        if lineage_id:
            results_by_lineage[lineage_id] = mapped
        if reference_id:
            results_by_reference[reference_id] = mapped
    for reference in eligible:
        lineage_id = str(reference.get("lineageId") or "")
        reference_id = str(reference.get("id") or "")
        if lineage_id and lineage_id not in results_by_lineage:
            result = {"updated": False, "skipped": "not_reported", "failed": None}
            results_by_lineage[lineage_id] = result
            if reference_id:
                results_by_reference[reference_id] = result
    return {
        "requested": len(references),
        "eligible": len(eligible),
        "failed": False,
        "payload": payload,
        "resultsByLineageId": results_by_lineage,
        "resultsByReferenceId": results_by_reference,
    }


def _reference_vector_sync_command(reference_ids: tuple[str, ...]) -> str:
    flags = " ".join(f"--reference-id {reference_id}" for reference_id in reference_ids)
    return f"poetry run papyrus-newsroom knowledge-vector-index --action sync --force --progress-every 0 {flags}".strip()


def _reference_is_vector_eligible(reference: dict[str, Any]) -> bool:
    return (
        reference.get("versionState") == "current"
        and str(reference.get("curationStatus") or "").lower() == "accepted"
    )


def _create_record(model_name: str, input_payload: dict[str, Any]) -> dict[str, Any]:
    query = f"""
mutation Create{model_name}($input: Create{model_name}Input!) {{
  create{model_name}(input: $input) {{ id }}
}}
"""
    return _graphql(query, {"input": _prepare_graphql_input(input_payload)})


def _update_record(model_name: str, input_payload: dict[str, Any]) -> dict[str, Any]:
    query = f"""
mutation Update{model_name}($input: Update{model_name}Input!) {{
  update{model_name}(input: $input) {{ id }}
}}
"""
    return _graphql(query, {"input": _prepare_graphql_input(input_payload)})


def _upload_model_attachment(attachment: dict[str, Any], body: str) -> None:
    body_bytes = body.encode("utf-8")
    upload_args = {
        "ownerKind": attachment["ownerKind"],
        "ownerId": attachment["ownerId"],
        "ownerLineageId": attachment.get("ownerLineageId"),
        "ownerVersionNumber": attachment.get("ownerVersionNumber"),
        "ownerVersionKey": attachment.get("ownerVersionKey"),
        "role": attachment["role"],
        "sortKey": attachment["sortKey"],
        "filename": attachment["filename"],
        "mediaType": attachment["mediaType"],
        "byteSize": len(body_bytes),
        "sha256": hashlib.sha256(body_bytes).hexdigest(),
        "importRunId": attachment.get("importRunId"),
        "status": attachment.get("status") or "active",
    }
    slot = _graphql(CREATE_MODEL_ATTACHMENT_UPLOAD_MUTATION, upload_args).get("createModelAttachmentUpload") or {}
    upload_url = slot.get("uploadUrl")
    if not upload_url:
        raise RuntimeError("createModelAttachmentUpload did not return uploadUrl")
    headers = _jsonish(slot.get("requiredHeaders")) or {}
    request = urllib.request.Request(upload_url, data=body_bytes, headers={str(k): str(v) for k, v in headers.items()}, method="PUT")
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status >= 400:
            raise RuntimeError(f"ModelAttachment upload failed with HTTP {response.status}")
    _graphql(COMPLETE_MODEL_ATTACHMENT_UPLOAD_MUTATION, {"uploadId": slot["uploadId"], **upload_args})


def _update_newsroom_summary(delta: dict[str, Any], *, actor_label: str, reason: str) -> None:
    _graphql(UPDATE_NEWSROOM_SUMMARY_MUTATION, {
        "delta": json.dumps(delta, sort_keys=True),
        "actorLabel": actor_label,
        "reason": reason,
    })


def _summary_delta_for_plan(
    *,
    messages: int,
    model_attachments: int,
    created_relations: int,
    superseded_relations: int,
    relation_type_key: str,
    relation_domain: str,
    subject_kind: str,
    object_kind: str,
    semantic_nodes: int = 0,
) -> dict[str, Any]:
    relation_delta = created_relations - superseded_relations
    return {
        "source": "incremental",
        "countDeltas": {
            "messages": messages,
            "modelAttachments": model_attachments,
            "semanticRelations": relation_delta,
            "semanticNodes": semantic_nodes,
        },
        "messageKindDeltas": {"reference_summary": messages} if messages else {},
        "messageDomainDeltas": {"summarization": messages} if messages else {},
        "facetDeltas": {
            "messages": {
                "byKind": {"reference_summary": messages} if messages else {},
                "byDomain": {"summarization": messages} if messages else {},
                "byStatus": {"active": messages} if messages else {},
                "domainByKind": {"reference_summary": {"summarization": messages}} if messages else {},
            },
            "semanticRelations": {
                "byRelationTypeKey": {relation_type_key: relation_delta} if relation_delta else {},
                "byRelationDomain": {relation_domain: relation_delta} if relation_delta else {},
                "bySubjectKind": {subject_kind: relation_delta} if relation_delta else {},
                "byObjectKind": {object_kind: relation_delta} if relation_delta else {},
            },
        },
    }


def _semantic_relation(
    *,
    predicate: str,
    subject_kind: str,
    subject_id: str,
    subject_lineage_id: str,
    subject_version_number: int | None,
    object_kind: str,
    object_id: str,
    object_lineage_id: str,
    object_version_number: int | None,
    score: float | None,
    confidence: float | None,
    rank: int | None,
    classifier_id: str | None,
    model_version: str | None,
    import_run_id: str | None,
    imported_at: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    subject_state_key = semantic_state_key(subject_kind, subject_lineage_id)
    object_state_key = semantic_state_key(object_kind, object_lineage_id)
    relation = {
        "id": "semantic-relation-" + _hash_short([semantic_version_key(subject_kind, subject_id), predicate, semantic_version_key(object_kind, object_id), imported_at]),
        "relationState": "current",
        "predicate": predicate,
        **_relation_type_fields(predicate),
        "subjectKind": subject_kind,
        "subjectId": subject_id,
        "subjectLineageId": subject_lineage_id,
        "subjectVersionNumber": subject_version_number,
        "objectKind": object_kind,
        "objectId": object_id,
        "objectLineageId": object_lineage_id,
        "objectVersionNumber": object_version_number,
        "subjectStateKey": subject_state_key,
        "objectStateKey": object_state_key,
        "objectSubjectStateKey": f"{object_state_key}#{subject_kind}",
        "predicateObjectStateKey": f"{predicate}#{object_state_key}",
        "subjectVersionKey": semantic_version_key(subject_kind, subject_id),
        "objectVersionKey": semantic_version_key(object_kind, object_id),
        "score": score,
        "confidence": confidence,
        "rank": rank,
        "classifierId": classifier_id,
        "modelVersion": model_version,
        "reviewRecommended": False,
        "importRunId": import_run_id,
        "importedAt": imported_at,
        "createdAt": imported_at,
        "updatedAt": imported_at,
        "newsroomFeedKey": "semanticRelations",
        "metadata": metadata,
    }
    return {key: value for key, value in relation.items() if value is not None}


def _quality_semantic_node_record(rating: int, now: str) -> dict[str, Any]:
    rating = normalize_quality_rating(rating)
    names = {
        1: ("One-Star Quality", "The lowest accepted quality rating for a reference."),
        2: ("Two-Star Quality", "A low quality rating for a reference."),
        3: ("Three-Star Quality", "A neutral or adequate quality rating for a reference."),
        4: ("Four-Star Quality", "A strong quality rating for a reference."),
        5: ("Five-Star Quality", "The highest accepted quality rating for a reference."),
    }
    display_name, description = names[rating]
    node_key = quality_node_key(rating)
    record = {
        "id": quality_node_id(rating),
        "lineageId": quality_node_lineage_id(rating),
        "versionNumber": 1,
        "previousVersionId": None,
        "versionState": "current",
        "versionCreatedAt": now,
        "versionCreatedBy": "papyrus-newsroom",
        "changeReason": "qualityRating-seed",
        "contentHash": _hash_short([node_key, QUALITY_NODE_KIND, display_name, description]),
        "nodeKey": node_key,
        "nodeKind": QUALITY_NODE_KIND,
        "corpusId": None,
        "categorySetId": None,
        "categoryLineageId": None,
        "categoryKey": None,
        "displayName": display_name,
        "description": description,
        "aliases": [f"{rating} star", f"{rating} stars"],
        "status": "accepted",
        "createdAt": now,
        "newsroomFeedKey": "semanticNodes",
        "updatedAt": now,
    }
    return {key: value for key, value in record.items() if value is not None}


def _relation_type_fields(predicate: str) -> dict[str, str]:
    key = _normalize_relation_type_key(predicate)
    domain = "curation" if key == QUALITY_RELATION_TYPE_KEY else "summarization" if key.startswith("reference_summary_") else "generic"
    return {
        "relationTypeId": f"semantic-relation-type-{_safe_id(key)}",
        "relationTypeKey": key,
        "relationDomain": domain,
    }


def _model_attachment(
    *,
    owner_kind: str,
    owner_id: str,
    role: str,
    sort_key: str,
    filename: str,
    media_type: str,
    content: Any,
    import_run_id: str | None,
    now: str,
) -> dict[str, Any]:
    body = content if isinstance(content, str) else json.dumps(content or {}, indent=2, sort_keys=True) + "\n"
    body_bytes = body.encode("utf-8")
    attachment = {
        "id": f"model-attachment-{_safe_id(owner_kind)}-{_safe_id(owner_id)}-{_safe_id(role)}-{_safe_id(sort_key)}",
        "ownerKind": owner_kind,
        "ownerId": owner_id,
        "ownerLineageId": owner_id,
        "ownerVersionNumber": None,
        "ownerVersionKey": None,
        "role": role,
        "sortKey": sort_key,
        "storagePath": f"newsroom/payloads/{_safe_id(owner_kind)}/{_safe_id(owner_id)}/{_safe_id(role)}/{filename}",
        "filename": filename,
        "mediaType": media_type,
        "byteSize": len(body_bytes),
        "sha256": hashlib.sha256(body_bytes).hexdigest(),
        "etag": None,
        "importRunId": import_run_id,
        "createdAt": now,
        "updatedAt": now,
        "status": "active",
    }
    return {"record": attachment, "body": body}


def _supersede_relation_record(relation: dict[str, Any], now: str, metadata_patch: dict[str, Any]) -> dict[str, Any]:
    metadata = _jsonish(relation.get("metadata")) or {}
    metadata.update(metadata_patch)
    return {
        "modelName": "SemanticRelation",
        "action": "update",
        "input": {
            "id": relation["id"],
            "relationState": "superseded",
            "updatedAt": now,
            "metadata": metadata,
        },
    }


def _current_relations(relations: list[dict[str, Any]], relation_type_key: str) -> list[dict[str, Any]]:
    return [
        relation for relation in relations
        if relation.get("relationState") == "current"
        and (relation.get("relationTypeKey") == relation_type_key or relation.get("predicate") == relation_type_key)
    ]


def _quality_from_relation(relation: dict[str, Any] | None) -> dict[str, Any] | None:
    if not relation:
        return None
    score = _number_or_none(relation.get("score"))
    rating = int(score) if score and score.is_integer() else _rating_from_node_key(relation.get("objectLineageId") or relation.get("objectId"))
    return {
        "rating": rating,
        "relationId": relation.get("id"),
        "nodeLineageId": relation.get("objectLineageId"),
        "score": rating,
        "metadata": _jsonish(relation.get("metadata")) or {},
    }


def _quality_relation_for_output(relation: dict[str, Any] | None) -> dict[str, Any] | None:
    if not relation:
        return None
    output = dict(relation)
    output.pop("confidence", None)
    quality = _quality_from_relation(relation)
    if quality and quality.get("rating") is not None:
        output["score"] = quality["rating"]
    return output


def _rating_from_node_key(value: Any) -> int | None:
    match = re.search(r"([1-5])[-_.]?star", str(value or ""))
    return int(match.group(1)) if match else None


def _prepare_graphql_input(input_payload: dict[str, Any]) -> dict[str, Any]:
    prepared = {key: value for key, value in input_payload.items() if value is not None}
    if "metadata" in prepared and not isinstance(prepared["metadata"], str):
        prepared["metadata"] = json.dumps(prepared["metadata"], sort_keys=True)
    return prepared


def _graphql(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    endpoint = os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT", "").strip()
    token = os.environ.get("PAPYRUS_GRAPHQL_JWT", "").strip()
    if not endpoint:
        raise RuntimeError("PAPYRUS_GRAPHQL_ENDPOINT is required")
    if not token:
        raise RuntimeError("PAPYRUS_GRAPHQL_JWT is required")
    request = urllib.request.Request(
        endpoint,
        data=json.dumps({"query": query, "variables": variables}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": _lambda_auth_token(token),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GraphQL request failed: {error.code} {body[:500]}") from error
    if payload.get("errors"):
        messages = "; ".join(str(entry.get("message") or entry) for entry in payload["errors"])
        raise RuntimeError(f"GraphQL request failed: {messages}")
    return payload.get("data") or {}


def _lambda_auth_token(token: str) -> str:
    return f"PapyrusJwt {re.sub(r'^Bearer\\s+', '', token.strip(), flags=re.IGNORECASE)}"


def _extract_response_text(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    chunks = []
    for item in payload.get("output") or []:
        for content in item.get("content") or []:
            if isinstance(content.get("text"), str):
                chunks.append(content["text"])
    return "\n".join(chunks)


def _reference_summary(reference: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": reference.get("id"),
        "lineageId": reference.get("lineageId"),
        "versionNumber": reference.get("versionNumber"),
        "corpusId": reference.get("corpusId"),
        "externalItemId": reference.get("externalItemId"),
        "title": reference.get("title"),
        "curationStatus": reference.get("curationStatus"),
    }


def _reference_chrono_key(reference: dict[str, Any]) -> str:
    return str(
        reference.get("importedAt")
        or reference.get("updatedAt")
        or reference.get("retrievedAt")
        or reference.get("sourceUpdatedAt")
        or reference.get("sourcePublishedAt")
        or reference.get("id")
        or ""
    )


def _catalog_entry_chrono_key(item: dict[str, Any]) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    dates = item.get("dates") if isinstance(item.get("dates"), dict) else {}
    metadata_dates = metadata.get("dates") if isinstance(metadata.get("dates"), dict) else {}
    return str(
        item.get("created_at")
        or item.get("updated_at")
        or item.get("imported_at")
        or item.get("retrieved_at")
        or dates.get("updated_at")
        or dates.get("retrieved_at")
        or dates.get("published_at")
        or metadata.get("created_at")
        or metadata.get("updated_at")
        or metadata.get("imported_at")
        or metadata.get("retrieved_at")
        or metadata_dates.get("updated_at")
        or metadata_dates.get("retrieved_at")
        or metadata_dates.get("published_at")
        or item.get("id")
        or ""
    )


def build_title_subtitle_local_metadata_plan(*, reference: dict[str, Any], resolution: dict[str, Any]) -> dict[str, Any]:
    sidecar_path = _sidecar_path_for_reference(reference)
    catalog_path, catalog_item_key = _catalog_location_for_reference(reference)
    return {
        "kind": "reference.title-subtitle.local-metadata.plan",
        "referenceId": reference.get("id"),
        "externalItemId": reference.get("externalItemId"),
        "title": resolution.get("title"),
        "subtitle": resolution.get("subtitle"),
        "summary": resolution.get("summary"),
        "sidecarPath": str(sidecar_path) if sidecar_path else None,
        "catalogPath": str(catalog_path) if catalog_path else None,
        "catalogItemKey": catalog_item_key,
    }


def apply_title_subtitle_local_metadata(*, reference: dict[str, Any], resolution: dict[str, Any]) -> dict[str, Any]:
    sidecar_path = _sidecar_path_for_reference(reference)
    catalog_path, catalog_item_key = _catalog_location_for_reference(reference)
    updated = []
    skipped = []
    errors = []
    if sidecar_path:
        try:
            existed = sidecar_path.exists()
            parsed = _read_yaml_file(sidecar_path) if existed else {}
            _apply_title_subtitle_to_mapping(parsed, resolution)
            sidecar_path.parent.mkdir(parents=True, exist_ok=True)
            sidecar_path.write_text(_dump_yaml(parsed), encoding="utf-8")
            updated.append({"target": "sidecar", "path": str(sidecar_path), "created": not existed})
        except Exception as exc:
            errors.append({"target": "sidecar", "path": str(sidecar_path), "error": str(exc)})
    else:
        skipped.append({"target": "sidecar", "reason": "missing_local_source_path"})
    if catalog_path and catalog_item_key:
        try:
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            items = catalog.get("items") if isinstance(catalog, dict) else None
            item = items.get(catalog_item_key) if isinstance(items, dict) else None
            if not isinstance(item, dict):
                skipped.append({"target": "catalog", "path": str(catalog_path), "reason": "catalog_item_not_found"})
            else:
                items[catalog_item_key] = apply_title_subtitle_to_catalog_item(item, resolution=resolution)
                catalog_path.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n", encoding="utf-8")
                updated.append({"target": "catalog", "path": str(catalog_path), "itemKey": catalog_item_key})
        except Exception as exc:
            errors.append({"target": "catalog", "path": str(catalog_path), "error": str(exc)})
    else:
        skipped.append({"target": "catalog", "reason": "catalog_not_found"})
    return {
        "kind": "reference.title-subtitle.local-metadata.applied",
        "referenceId": reference.get("id"),
        "externalItemId": reference.get("externalItemId"),
        "title": resolution.get("title"),
        "subtitle": resolution.get("subtitle"),
        "summary": resolution.get("summary"),
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    }


def apply_title_subtitle_to_catalog_item(item: dict[str, Any], *, resolution: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(item)
    metadata = dict(enriched.get("metadata") if isinstance(enriched.get("metadata"), dict) else {})
    _apply_title_subtitle_to_mapping(enriched, resolution)
    _apply_title_subtitle_to_mapping(metadata, resolution)
    enriched["metadata"] = metadata
    return enriched


def _apply_title_subtitle_to_mapping(target: dict[str, Any], resolution: dict[str, Any]) -> None:
    title = _clean_text(resolution.get("title"))
    subtitle = _normalize_subtitle_candidate(resolution.get("subtitle"))
    summary = _normalize_outcome_summary_candidate(resolution.get("summary"))
    if title:
        target["title"] = title
    if subtitle:
        target["subtitle"] = subtitle
    if summary:
        target["summary"] = summary
    papyrus = target.get("papyrus") if isinstance(target.get("papyrus"), dict) else {}
    papyrus["title_subtitle"] = {
        "title": title,
        "subtitle": subtitle,
        "summary": summary,
        **_title_subtitle_provenance(resolution),
    }
    if summary:
        papyrus["title_subtitle"]["summary_resolution"] = _summary_resolution_provenance(resolution)
    target["papyrus"] = papyrus
    target["title_subtitle_resolution"] = _title_subtitle_provenance(resolution)
    if summary:
        target["summary_resolution"] = _summary_resolution_provenance(resolution)


def _quality_local_metadata_payload(*, rating: int, note: str, actor_label: str, now: str) -> dict[str, Any]:
    return _compact_dict({
        "rating": rating,
        "rating_node_key": quality_node_key(rating),
        "relation_type_key": QUALITY_RELATION_TYPE_KEY,
        "rated_at": now,
        "updated_by": actor_label,
        "note": note,
    })


def _quality_rating_from_metadata(value: Any) -> int | None:
    if not isinstance(value, dict):
        return None
    for container in (
        value.get("quality"),
        value.get("papyrus", {}).get("quality_rating") if isinstance(value.get("papyrus"), dict) else None,
    ):
        if isinstance(container, dict):
            try:
                return normalize_quality_rating(container.get("rating"))
            except ValueError:
                continue
    return None


def _title_subtitle_from_local(*, reference: dict[str, Any], catalog_entry: dict[str, Any], sidecar: dict[str, Any]) -> dict[str, Any]:
    sources = [
        ("reference", reference),
        ("catalog", catalog_entry),
        ("sidecar", sidecar),
        ("reference_metadata", _jsonish(reference.get("metadata")) or {}),
        ("catalog_metadata", catalog_entry.get("metadata") if isinstance(catalog_entry.get("metadata"), dict) else {}),
        ("sidecar_papyrus", sidecar.get("papyrus", {}).get("title_subtitle") if isinstance(sidecar.get("papyrus"), dict) else {}),
    ]
    title = ""
    subtitle = ""
    summary = ""
    title_source = ""
    subtitle_source = ""
    summary_source = ""
    for label, value in sources:
        if not isinstance(value, dict):
            continue
        if not title:
            title = _normalize_reference_title_candidate(value.get("title") or value.get("original_title") or value.get("originalTitle"))
            if title:
                title_source = label
        if not subtitle:
            subtitle = _normalize_subtitle_candidate(value.get("subtitle") or value.get("sub_title") or value.get("subTitle") or value.get("deck"))
            if subtitle:
                subtitle_source = label
        if not summary:
            summary = _normalize_outcome_summary_candidate(value.get("summary"))
            if summary:
                summary_source = label
    if title and not subtitle:
        colon_subtitle = _title_colon_subtitle_candidate(title)
        if colon_subtitle:
            subtitle = colon_subtitle
            subtitle_source = subtitle_source or title_source
    return {
        "title": title,
        "subtitle": subtitle,
        "summary": summary,
        "titleMode": "original_metadata" if title else None,
        "subtitleMode": "original_metadata" if subtitle else None,
        "summarySource": summary_source,
        "source": title_source or subtitle_source or "",
        "rationale": f"Resolved from local {title_source or subtitle_source} metadata." if (title or subtitle) else "",
        "summaryRationale": f"Resolved summary from local {summary_source} metadata." if summary else "",
    }


def _resolve_title_subtitle_deterministic(*, reference: dict[str, Any], catalog_entry: dict[str, Any], source_text: str, fetcher: Any) -> dict[str, Any]:
    source_uri = _clean_text(reference.get("sourceUri") or catalog_entry.get("source_uri") or catalog_entry.get("sourceUri") or catalog_entry.get("url") or catalog_entry.get("uri"))
    if source_text:
        local_html = _title_subtitle_from_local_html(source_text)
        if local_html.get("title"):
            return local_html
        heading = _title_subtitle_from_source_heading(source_text)
        if heading.get("title"):
            return heading
    if source_uri:
        arxiv = _title_subtitle_from_arxiv(source_uri, fetcher=fetcher)
        if arxiv.get("title"):
            return arxiv
        doi = _title_subtitle_from_crossref(source_uri, fetcher=fetcher)
        if doi.get("title"):
            return doi
        html_meta = _title_subtitle_from_html(source_uri, fetcher=fetcher)
        if html_meta.get("title"):
            return html_meta
    return {}


def _title_subtitle_from_source_heading(source_text: str) -> dict[str, Any]:
    lines = [_clean_text(line) for line in source_text.splitlines()[:30]]
    lines = [line for line in lines if line and len(line) >= 8]
    if not lines:
        return {}
    title = lines[0]
    subtitle = _normalize_subtitle_candidate(lines[1] if len(lines) > 1 and len(lines[1]) <= 180 else "")
    return {
        "title": title,
        "subtitle": subtitle,
        "titleMode": "original_source_heading",
        "subtitleMode": "original_source_heading" if subtitle else "unresolved",
        "source": "source_heading",
        "sourceUrls": [],
        "rationale": "Resolved from the first clear source-text heading lines.",
    }


def _title_subtitle_from_local_html(source_text: str) -> dict[str, Any]:
    text = source_text or ""
    if "<html" not in text.lower():
        return {}
    title = (
        _html_meta_content_from_text(text, "citation_title")
        or _html_meta_content_from_text(text, "og:title", property_name=True)
        or _html_meta_content_from_text(text, "twitter:title")
        or _clean_html_title(_html_title_from_text(text))
    )
    title = _normalize_reference_title_candidate(title)
    subtitle = _normalize_subtitle_candidate(_title_colon_subtitle_candidate(title))
    if not title:
        return {}
    return {
        "title": title,
        "subtitle": subtitle,
        "titleMode": "original_source_heading",
        "subtitleMode": "original_source_heading" if subtitle else "unresolved",
        "source": "local_html_metadata",
        "sourceUrls": [],
        "rationale": "Resolved from local imported HTML metadata.",
    }


def _title_subtitle_from_arxiv(source_uri: str, *, fetcher: Any) -> dict[str, Any]:
    match = re.search(r"arxiv\.org/(?:abs|pdf|html|src)/([^?#/]+)", source_uri, flags=re.IGNORECASE)
    if not match:
        return {}
    arxiv_id = re.sub(r"\.pdf$", "", match.group(1), flags=re.IGNORECASE)
    api = f"https://export.arxiv.org/api/query?id_list={urllib.parse.quote(arxiv_id)}"
    try:
        body = fetcher(api, timeout=20)
        root = ET.fromstring(body)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        entry = root.find("atom:entry", ns)
        if entry is None:
            return {}
        title = _clean_text(" ".join((entry.findtext("atom:title", default="", namespaces=ns) or "").split()))
        summary = _clean_text(" ".join((entry.findtext("atom:summary", default="", namespaces=ns) or "").split()))
        return {
            "title": title,
            "subtitle": "",
            "summary": _normalize_outcome_summary_candidate(summary),
            "titleMode": "original_web_metadata",
            "subtitleMode": "unresolved",
            "source": "arxiv_metadata",
            "sourceUrls": [api, source_uri],
            "rationale": f"Resolved title from arXiv metadata. Abstract available: {bool(summary)}.",
            "summarySource": "arxiv_metadata" if summary else "",
            "summaryRationale": "Resolved summary from arXiv abstract metadata." if summary else "",
        } if title else {}
    except Exception:
        return {}


def _title_subtitle_from_crossref(source_uri: str, *, fetcher: Any) -> dict[str, Any]:
    doi = _doi_from_text(source_uri)
    if not doi:
        return {}
    api = f"https://api.crossref.org/works/{urllib.parse.quote(doi)}"
    try:
        payload = json.loads(fetcher(api, timeout=20))
        message = payload.get("message") or {}
        title = _clean_text((message.get("title") or [""])[0])
        subtitle = _normalize_subtitle_candidate((message.get("subtitle") or [""])[0])
        return {
            "title": title,
            "subtitle": subtitle,
            "titleMode": "original_web_metadata",
            "subtitleMode": "original_web_metadata" if subtitle else "unresolved",
            "source": "crossref_metadata",
            "sourceUrls": [api, source_uri],
            "rationale": "Resolved from Crossref work metadata.",
        } if title else {}
    except Exception:
        return {}


def _title_subtitle_from_html(source_uri: str, *, fetcher: Any) -> dict[str, Any]:
    if not re.match(r"^https?://", source_uri, flags=re.IGNORECASE):
        return {}
    try:
        body = fetcher(source_uri, timeout=20)
    except Exception:
        return {}
    title = _html_meta_content(body, "citation_title") or _html_meta_content(body, "og:title") or _html_title(body)
    subtitle = _html_meta_content(body, "description") or _html_meta_content(body, "og:description")
    title = _clean_html_title(title)
    subtitle = _normalize_subtitle_candidate(subtitle)
    if subtitle and subtitle == title:
        subtitle = ""
    return {
        "title": title,
        "subtitle": subtitle,
        "titleMode": "original_web_metadata",
        "subtitleMode": "original_web_metadata" if subtitle else "unresolved",
        "source": "html_metadata",
        "sourceUrls": [source_uri],
        "rationale": "Resolved from HTML title/meta tags.",
    } if title else {}


def _html_meta_content(body: str, key: str) -> str:
    return _html_meta_content_from_text(body, key)


def _html_meta_content_from_text(body: str, key: str, *, property_name: bool = False) -> str:
    attr = "property" if property_name else "(?:name|property)"
    pattern = rf"<meta\b[^>]*{attr}=[\"']{re.escape(key)}[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>"
    match = re.search(pattern, body, flags=re.IGNORECASE)
    if not match:
        pattern = rf"<meta\b[^>]*content=[\"']([^\"']+)[\"'][^>]*{attr}=[\"']{re.escape(key)}[\"'][^>]*>"
        match = re.search(pattern, body, flags=re.IGNORECASE)
    return html.unescape(match.group(1)).strip() if match else ""


def _html_title(body: str) -> str:
    return _html_title_from_text(body)


def _html_title_from_text(body: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", body, flags=re.IGNORECASE | re.DOTALL)
    return html.unescape(re.sub(r"\s+", " ", match.group(1))).strip() if match else ""


def _clean_html_title(value: str) -> str:
    text = _clean_text(value)
    if " | " in text:
        return _clean_text(text.split(" | ")[0])
    return text


def _doi_from_text(value: str) -> str:
    match = re.search(r"10\.\d{4,9}/[^\s\"'<>]+", value or "", flags=re.IGNORECASE)
    return match.group(0).rstrip(".,);]") if match else ""


def _fetch_url_text(url: str, *, timeout: int = 20) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Papyrus reference title subtitle enrichment"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def _title_subtitle_resolution(
    *,
    status: str,
    title: str,
    subtitle: str,
    title_mode: str,
    subtitle_mode: str,
    source: str,
    model: str,
    web_search_used: bool,
    source_urls: list[str],
    rationale: str,
    run_id: str,
    resolved_at: str,
    warnings: list[str],
    summary: str = "",
    summary_resolution: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "title": _clean_text(title),
        "subtitle": _normalize_subtitle_candidate(subtitle),
        "title_mode": _title_subtitle_mode(title_mode, default="unresolved"),
        "subtitle_mode": _title_subtitle_mode(subtitle_mode, default="unresolved"),
        "summary": _normalize_outcome_summary_candidate(summary),
        "summary_resolution": summary_resolution or {},
        "source": source,
        "model": model,
        "web_search_used": web_search_used,
        "source_urls": sorted(set(_string_list(source_urls))),
        "rationale": rationale,
        "run_id": run_id,
        "resolved_at": resolved_at,
        "prompt_version": TITLE_SUBTITLE_PROMPT_VERSION if source == "llm_web_search" else "",
        "warnings": warnings,
    }


def _title_subtitle_provenance(resolution: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": resolution.get("run_id"),
        "resolved_at": resolution.get("resolved_at"),
        "source": resolution.get("source"),
        "model": resolution.get("model"),
        "web_search_used": bool(resolution.get("web_search_used")),
        "source_urls": resolution.get("source_urls") or [],
        "title_mode": resolution.get("title_mode"),
        "subtitle_mode": resolution.get("subtitle_mode"),
        "rationale": resolution.get("rationale"),
        "prompt_version": resolution.get("prompt_version") or TITLE_SUBTITLE_PROMPT_VERSION,
    }


def _summary_resolution(
    *,
    summary: str,
    summary_token_budget: int,
    model: str,
    source: str,
    source_urls: list[str],
    run_id: str,
    resolved_at: str,
    rationale: str,
    prompt_version: str,
) -> dict[str, Any]:
    text = _normalize_outcome_summary_candidate(summary)
    return {
        "summaryTokenBudget": normalize_title_subtitle_summary_budget(summary_token_budget),
        "actualTokenEstimate": estimate_tokens(text, model=model) if text else 0,
        "model": model,
        "promptVersion": prompt_version or TITLE_SUBTITLE_SUMMARY_PROMPT_VERSION,
        "source": source,
        "source_urls": sorted(set(_string_list(source_urls))),
        "run_id": run_id,
        "resolved_at": resolved_at,
        "rationale": _clean_text(rationale),
    }


def _summary_resolution_provenance(resolution: dict[str, Any]) -> dict[str, Any]:
    candidate = resolution.get("summary_resolution")
    return candidate if isinstance(candidate, dict) else {}


def _title_subtitle_mode(value: Any, *, default: str) -> str:
    allowed = {"original_metadata", "original_web_metadata", "original_source_heading", "generated_fallback", "existing_reference", "existing_reference_metadata", "unresolved"}
    text = _clean_text(value)
    return text if text in allowed else default


def _web_search_source_urls(payload: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for item in payload.get("output") or []:
        action = item.get("action") if isinstance(item, dict) else None
        sources = action.get("sources") if isinstance(action, dict) else None
        if isinstance(sources, list):
            urls.extend(str(source.get("url") or "") for source in sources if isinstance(source, dict))
    return [url for url in urls if url]


def _compact_catalog_prompt_metadata(catalog_entry: dict[str, Any]) -> dict[str, Any]:
    metadata = catalog_entry.get("metadata") if isinstance(catalog_entry.get("metadata"), dict) else {}
    keys = ("title", "subtitle", "abstract", "summary", "source_uri", "sourceUri", "doi", "arxiv_id", "publisher_item")
    return {key: metadata.get(key) for key in keys if metadata.get(key)}


def _source_excerpt(value: str, *, max_chars: int) -> str:
    return _clean_text(value)[:max_chars]


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _looks_like_list_line(value: str) -> bool:
    return bool(re.match(r"^(?:[-*•]\s+|\d+[.)]\s+)", _clean_text(value)))


def _subtitle_has_list_shape(value: Any) -> bool:
    raw = str(value or "")
    lines = [line.strip() for line in re.split(r"[\r\n]+", raw) if line.strip()]
    if len(lines) > 1:
        return True
    text = _clean_text(_strip_html_fragments(lines[0] if lines else raw))
    if not text:
        return False
    if _looks_like_list_line(text):
        return True
    if re.search(r"(?:^|\s)[•▪◦‣](?:\s|$)", text):
        return True
    return bool(re.search(r"(?:^|\s)[-*]\s+\S+.*(?:\s[-*]\s+\S+)", text))


def _normalize_subtitle_candidate(value: Any) -> str:
    if _subtitle_has_list_shape(value):
        return ""
    text = _clean_text(_strip_html_fragments(value))
    if len(text) > 220:
        return ""
    if _subtitle_is_boilerplate(text):
        return ""
    return "" if _placeholder_title_or_subtitle(text) else text


def _strip_html_fragments(value: Any) -> str:
    raw = str(value or "")
    if not raw:
        return ""
    stripped = re.sub(r"<[^>]+>", " ", raw)
    stripped = html.unescape(stripped)
    return stripped.replace("\xa0", " ")


def _normalize_outcome_summary_candidate(value: Any) -> str:
    raw = str(value or "")
    lines = [line.strip() for line in re.split(r"[\r\n]+", raw) if line.strip()]
    if lines and _looks_like_list_line(lines[0]):
        return ""
    return _clean_text(raw)


def _subtitle_is_boilerplate(value: str) -> bool:
    text = _clean_text(value).lower()
    if not text:
        return False
    if text.startswith("<<") and text.endswith(">>") and len(re.findall(r"/[a-z]+", text)) >= 3:
        return True
    patterns = (
        r"^abstract page for arxiv paper\b",
        r"^join the discussion on this paper page\b",
        r"^this paper page\b",
        r"^paper page\b",
        r"^<<\s*/metadata\b",
    )
    return any(re.match(pattern, text) for pattern in patterns)


def _normalize_reference_title_candidate(value: Any) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    if re.match(r"^https?://", text, flags=re.IGNORECASE):
        return ""
    if re.match(r"^arxiv:\d{4}\.\d{4,5}(?:v\d+)?\s+\[[^\]]+\]\s+\d{1,2}\s+\w+\s+\d{4}$", text, flags=re.IGNORECASE):
        return ""
    text = re.sub(r"^\[(?:\d{4}\.\d{4,5}(?:v\d+)?)\]\s*", "", text)
    text = re.sub(r"^arXiv:\s*(?:\d{4}\.\d{4,5}(?:v\d+)?)\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^NeurIPS Poster\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r",?\s*accessed\s+[A-Za-z]+\s+\d{1,2},\s+\d{4},?\s*$", "", text, flags=re.IGNORECASE)
    while True:
        updated = re.sub(
            r"(?:\s+-\s+|\s+\|\s+)(?:arXiv|ACL Anthology|Microsoft|OpenReview|Semantic Scholar|GitHub|Medium|Salesforce|Google DeepMind|DeepMind|Stanford HAI|Hugging Face|ResearchGate|PMC|Wikipedia|Reddit|Meta AI|Amazon Science|ScienceDirect|Nature|Frontiers|NeurIPS|IJCAI|NIST|OpenAI)\s*$",
            "",
            text,
            flags=re.IGNORECASE,
        )
        if updated == text:
            break
        text = updated.strip()
    if re.match(r"^\[[^\]]+\]\s+\d{1,2}\s+\w+\s+\d{4}$", text):
        return ""
    return _clean_text(text.rstrip(" ,;:-|"))


def _title_colon_subtitle_candidate(title: str) -> str:
    text = _clean_text(title)
    if ":" not in text:
        return ""
    _, right = text.split(":", 1)
    candidate = _clean_text(right)
    return candidate if len(candidate.split()) >= 2 else ""


def _placeholder_title_or_subtitle(value: Any) -> bool:
    if _subtitle_has_list_shape(value):
        return True
    text = _clean_text(value).lower()
    return text in {
        "",
        "unresolved",
        "no title found",
        "unknown",
        "title unavailable",
        "subtitle unavailable",
        "generated fallback subtitle",
        "no subtitle available",
        "science direct article metadata unavailable",
        "sciencedirect article metadata unavailable",
    }


def _catalog_entries(items_value: Any) -> list[tuple[str, dict[str, Any]]]:
    if isinstance(items_value, list):
        return [(str(index), item) for index, item in enumerate(items_value) if isinstance(item, dict)]
    if isinstance(items_value, dict):
        return [(str(key), item) for key, item in items_value.items() if isinstance(item, dict)]
    return []


def _reference_from_catalog_item(item: dict[str, Any]) -> dict[str, Any]:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    return {
        "id": item.get("id") or item.get("item_id") or item.get("externalItemId") or _hash_short([item]),
        "lineageId": item.get("lineageId") or item.get("id") or item.get("item_id") or item.get("externalItemId") or _hash_short([item]),
        "versionNumber": item.get("versionNumber") or 1,
        "externalItemId": item.get("item_id") or item.get("externalItemId") or item.get("id"),
        "title": item.get("title") or metadata.get("title"),
        "authors": item.get("authors") or metadata.get("authors") or [],
        "sourceUri": item.get("source_uri") or item.get("sourceUri") or metadata.get("source_uri") or metadata.get("sourceUri") or item.get("url") or item.get("uri"),
        "storagePath": item.get("storage_path") or item.get("storagePath") or item.get("relpath"),
        "metadata": metadata,
    }


def _catalog_source_text(item: dict[str, Any]) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    local_source = _catalog_local_source_text(item)
    parts = [
        local_source,
        metadata.get("abstract"),
        metadata.get("summary"),
        metadata.get("description"),
        item.get("summary"),
        item.get("description"),
    ]
    return "\n\n".join(part for part in (_clean_text(value) for value in parts) if part)


def _catalog_local_source_text(item: dict[str, Any]) -> str:
    relpath = _clean_text(item.get("relpath"))
    if not relpath:
        return ""
    path = None
    if relpath.startswith("/"):
        path = Path(relpath)
    else:
        for candidate in (BIBLICUS_ROOT / "corpora").iterdir():
            candidate_path = candidate / relpath
            if candidate_path.exists() and candidate_path.is_file():
                path = candidate_path
                break
    if not path or not path.exists() or not path.is_file():
        return ""
    media_type = _clean_text(item.get("media_type") or (item.get("metadata") or {}).get("media_type")).lower()
    if media_type and not media_type.startswith("text/"):
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def _read_reference_sidecar(reference: dict[str, Any]) -> dict[str, Any]:
    path = _sidecar_path_for_reference(reference)
    if not path or not path.exists():
        return {}
    try:
        return _read_yaml_file(path)
    except Exception:
        return {}


def _read_reference_catalog_entry(reference: dict[str, Any]) -> dict[str, Any]:
    catalog_path, catalog_item_key = _catalog_location_for_reference(reference)
    if not catalog_path or not catalog_item_key:
        return {}
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        items = catalog.get("items") if isinstance(catalog, dict) else None
        item = items.get(catalog_item_key) if isinstance(items, dict) else None
        return item if isinstance(item, dict) else {}
    except Exception:
        return {}


def _sidecar_path_for_reference(reference: dict[str, Any]) -> Path | None:
    local_source = _local_source_path_for_reference(reference)
    if not local_source:
        return None
    return Path(f"{local_source}.biblicus.yml")


def _local_source_path_for_reference(reference: dict[str, Any]) -> Path | None:
    storage_path = str(reference.get("storagePath") or "").replace("\\", "/").lstrip("/")
    if not storage_path:
        return None
    parts = storage_path.split("/")
    if len(parts) >= 3 and parts[0] == "corpora":
        return BIBLICUS_ROOT / "corpora" / parts[1] / Path(*parts[2:])
    candidate = BIBLICUS_ROOT / storage_path
    return candidate


def _catalog_location_for_reference(reference: dict[str, Any]) -> tuple[Path | None, str | None]:
    local_source = _local_source_path_for_reference(reference)
    if not local_source:
        return None, None
    corpus_path = _corpus_path_for_local_source(local_source)
    if not corpus_path:
        return None, None
    catalog_path = corpus_path / "metadata" / "catalog.json"
    if not catalog_path.exists():
        alt_path = corpus_path / ".biblicus" / "catalog.json"
        catalog_path = alt_path if alt_path.exists() else catalog_path
    external_item_id = str(reference.get("externalItemId") or "").strip()
    return (catalog_path if catalog_path.exists() else None), (external_item_id or None)


def _corpus_path_for_local_source(local_source: Path) -> Path | None:
    try:
        relative = local_source.resolve().relative_to((BIBLICUS_ROOT / "corpora").resolve())
    except Exception:
        return None
    parts = relative.parts
    if not parts:
        return None
    return BIBLICUS_ROOT / "corpora" / parts[0]


def _read_yaml_file(filepath: Path) -> dict[str, Any]:
    if yaml is None:
        raise RuntimeError("PyYAML is required to update Biblicus sidecars")
    parsed = yaml.safe_load(filepath.read_text(encoding="utf-8")) if filepath.exists() else {}
    return parsed if isinstance(parsed, dict) else {}


def _dump_yaml(value: dict[str, Any]) -> str:
    if yaml is None:
        raise RuntimeError("PyYAML is required to update Biblicus sidecars")
    return yaml.safe_dump(value, sort_keys=False, allow_unicode=False)


def _require_reference(reference: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(reference, dict) or not reference.get("id") or not reference.get("lineageId"):
        raise ValueError("reference must include id and lineageId")
    return reference


def _knowledge_corpus_id(corpus_key: str) -> str:
    return f"knowledge-corpus-{_safe_id(corpus_key)}"


def _normalize_relation_type_key(value: Any) -> str:
    return re.sub(r"(^_+|_+$)", "", re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()))


def _safe_id(value: Any) -> str:
    return re.sub(r"(^-+|-+$)", "", re.sub(r"[^a-z0-9]+", "-", str(value or "").lower())).strip("-") or _hash_short(value)


def _hash_short(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:16]


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _now() -> str:
    return _dt.datetime.now(_dt.UTC).isoformat().replace("+00:00", "Z")


def _required(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} is required")
    return value.strip()


def _jsonish(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return value


def _compact_dict(value: dict[str, Any]) -> dict[str, Any]:
    return {key: entry for key, entry in value.items() if entry not in (None, "", [], {})}


def _number_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def print_json(payload: dict[str, Any]) -> None:
    json.dump(payload, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
