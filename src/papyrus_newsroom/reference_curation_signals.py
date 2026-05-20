"""Reference summary and quality curation signals.

The module owns the reusable planning/writing contract for budgeted reference
summaries and one-to-five quality ratings. It intentionally uses the same
SemanticRelation state-key shape as the rest of Papyrus so Tactus, CLI, and
ranking code can share one graph contract.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
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
    if status:
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
    return semantic.get_reference(_required(reference_id, "reference"))["reference"]


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
