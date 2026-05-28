from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from .model_attachments import parse_jsonish
from .reference_policy import (
    is_current_accepted_reference,
    normalize_reference_curation_status,
    reference_reason_code,
    scope_training_label_for_reference,
)
from .source_readiness import (
    source_storage_path_for_reference,
    text_storage_path_for_reference,
)


def build_reference_analysis_manifest(
    *,
    corpus_config: dict[str, Any],
    corpus_id: str,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    accepted = sorted(
        [
            reference
            for reference in references
            if reference.get("corpusId") == corpus_id and is_current_accepted_reference(reference)
        ],
        key=lambda reference: str(reference.get("externalItemId") or reference.get("id") or ""),
    )
    missing_source = [reference for reference in accepted if not source_storage_path_for_reference(reference, attachments)]
    if missing_source:
        examples = ", ".join(
            f"{reference['id']}:{reference.get('sourceUri') or 'no-source-uri'}"
            for reference in missing_source[:5]
        )
        raise ValueError(
            f"Cannot export analysis manifest: {len(missing_source)} accepted current references in "
            f"{corpus_id} lack corpus source material. Run references source-status and accession URL-only "
            f"references first. Examples: {examples}"
        )
    missing_text = [reference for reference in accepted if not text_storage_path_for_reference(reference, attachments)]
    if missing_text:
        examples = ", ".join(
            f"{reference['id']}:{reference.get('externalItemId') or 'no-item-id'}"
            for reference in missing_text[:5]
        )
        raise ValueError(
            f"Cannot export analysis manifest: {len(missing_text)} accepted current references in {corpus_id} "
            f"lack extracted_text attachments. Run references source-status and then "
            f"references fetch-url-text, references extract-text-now, or references attach-extracted-text. "
            f"Examples: {examples}"
        )
    return {
        "schema_version": 1,
        "export_kind": "papyrus-reference-analysis-manifest",
        "generated_at": _utc_now(),
        "corpus": reference_corpus_export(corpus_config, corpus_id),
        "counts": {"accepted_references": len(accepted)},
        "items": [reference_manifest_item(reference, attachments) for reference in accepted],
    }


def build_reference_scope_training_export(
    *,
    corpus_config: dict[str, Any],
    corpus_id: str,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    relations: list[dict[str, Any]],
) -> dict[str, Any]:
    hydrated_messages = messages
    hydrated_references = references
    comments_by_lineage = reference_curation_messages_by_reference_lineage(hydrated_messages, relations)
    training_items = []
    for reference in hydrated_references:
        if reference.get("corpusId") != corpus_id or reference.get("versionState") != "current":
            continue
        curation_messages = comments_by_lineage.get(reference.get("lineageId"), [])
        label = scope_training_label_for_reference(reference, curation_messages)
        if not label:
            continue
        item = reference_manifest_item(reference, attachments)
        item.update(
            {
                "scope_training_label": "in_scope" if label == "positive" else "out_of_scope",
                "curation_status": reference.get("curationStatus") or "pending",
                "reason_code": reference_reason_code(reference, curation_messages),
            }
        )
        training_items.append(item)
    training_items.sort(key=lambda item: str(item.get("item_id") or ""))
    positive = sum(1 for item in training_items if item["scope_training_label"] == "in_scope")
    negative = len(training_items) - positive
    return {
        "schema_version": 1,
        "export_kind": "papyrus-reference-scope-training",
        "generated_at": _utc_now(),
        "corpus": reference_corpus_export(corpus_config, corpus_id),
        "counts": {"positive": positive, "negative": negative},
        "items": training_items,
    }


def reference_corpus_export(corpus_config: dict[str, Any], corpus_id: str) -> dict[str, Any]:
    return {
        "key": corpus_config.get("key"),
        "id": corpus_id,
        "name": corpus_config.get("name"),
        "role": corpus_config.get("role"),
        "path": corpus_config.get("path"),
        "s3Prefix": corpus_config.get("s3Prefix"),
    }


def reference_manifest_item(reference: dict[str, Any], attachments: list[dict[str, Any]]) -> dict[str, Any]:
    reference_attachments = sorted(
        [
            attachment
            for attachment in attachments
            if attachment.get("referenceLineageId") == reference.get("lineageId")
        ],
        key=lambda attachment: str(attachment.get("sortKey") or ""),
    )
    return {
        "item_id": reference.get("externalItemId"),
        "reference_id": reference.get("id"),
        "reference_lineage_id": reference.get("lineageId"),
        "title": reference.get("title"),
        "authors": reference.get("authors") or [],
        "source_uri": reference.get("sourceUri"),
        "storage_path": reference.get("storagePath"),
        "media_type": reference.get("mediaType"),
        "byte_size": reference.get("byteSize"),
        "sha256": reference.get("sha256"),
        "source_published_at": reference.get("sourcePublishedAt"),
        "source_updated_at": reference.get("sourceUpdatedAt"),
        "retrieved_at": reference.get("retrievedAt"),
        "attachments": [
            {
                "role": attachment.get("role"),
                "sort_key": attachment.get("sortKey"),
                "storage_path": attachment.get("storagePath"),
                "source_uri": attachment.get("sourceUri"),
                "filename": attachment.get("filename"),
                "media_type": attachment.get("mediaType"),
                "byte_size": attachment.get("byteSize"),
                "sha256": attachment.get("sha256"),
            }
            for attachment in reference_attachments
        ],
    }


def reference_curation_messages_by_reference_lineage(
    messages: list[dict[str, Any]],
    relations: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    message_by_id = {message["id"]: message for message in messages}
    comments_by_lineage: dict[str, list[dict[str, Any]]] = {}
    for relation in relations:
        if relation.get("relationState") != "current":
            continue
        if (relation.get("relationTypeKey") or relation.get("predicate")) != "comment":
            continue
        if relation.get("subjectKind") != "message" or relation.get("objectKind") != "reference":
            continue
        message = message_by_id.get(relation.get("subjectId"))
        if not message:
            continue
        metadata = parse_jsonish(message.get("metadata"))
        if metadata.get("messageKind") and metadata.get("messageKind") != "reference_curation":
            continue
        if message.get("messageKind") and message.get("messageKind") != "reference_curation":
            continue
        lineage_id = relation.get("objectLineageId")
        if not lineage_id:
            continue
        comments_by_lineage.setdefault(lineage_id, []).append(message)
    return comments_by_lineage


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
