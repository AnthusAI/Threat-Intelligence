from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from .env import BIBLICUS_ROOT, load_amplify_outputs, storage_bucket_from_amplify_outputs
from .ids import hash_short
from .source_site_plugins import resolve_source_site_enrichment
from .source_readiness import (
    select_extracted_text_attachment,
    select_extracted_text_raw_attachment,
)

try:
    import boto3
except ModuleNotFoundError:  # pragma: no cover - boto3 exists in normal runtime
    boto3 = None


def build_reference_url_text_attachment_plans(
    *,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    corpus_key_by_id: dict[str, str] | None = None,
    corpus_id: str | None = None,
    reference_ids: set[str] | None = None,
    external_item_ids: set[str] | None = None,
    curation_status: str = "all",
    max_count: int | None = None,
    force: bool = False,
    model: str = "gpt-5.4-nano",
) -> dict[str, Any]:
    corpus_key_by_id = corpus_key_by_id or {}
    selected_reference_ids = set(reference_ids or [])
    selected_external_item_ids = set(external_item_ids or [])
    plans: list[dict[str, Any]] = []
    reference_records: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    filter_fallbacks: list[dict[str, Any]] = []
    skipped_existing = 0
    eligible = 0
    planned_references = 0
    filtered_count = 0
    fallback_raw_count = 0
    seen_lineages: set[str] = set()
    for reference in _iter_candidate_references(
        references=references,
        corpus_id=corpus_id,
        curation_status=curation_status,
        reference_ids=selected_reference_ids,
        external_item_ids=selected_external_item_ids,
    ):
        lineage_id = str(reference.get("lineageId") or "")
        if not lineage_id or lineage_id in seen_lineages:
            continue
        seen_lineages.add(lineage_id)
        source_uri = normalize_http_url(reference.get("sourceUri"))
        if not source_uri:
            continue
        eligible += 1
        existing_canonical = select_extracted_text_attachment(reference, attachments)
        existing_raw = select_extracted_text_raw_attachment(reference, attachments)
        if existing_canonical and not force:
            skipped_existing += 1
            continue
        try:
            enrichment = resolve_source_site_enrichment(
                reference=reference,
                source_uri=source_uri,
            )
            extraction_source_uri = normalize_http_url(enrichment.get("canonicalSourceUri")) or source_uri
            reference_record = _reference_metadata_update_record(
                reference=reference,
                enrichment=enrichment,
                source_uri=source_uri,
                canonical_uri=extraction_source_uri,
            )
            if reference_record is not None:
                reference_records.append(reference_record)

            extracted = _extract_url_text(
                extraction_source_uri,
                reference_title=str(reference.get("title") or ""),
            )
            raw_text = str(extracted.get("text") or "").strip()
            raw_markdown = str(extracted.get("markdown") or raw_text)
            if not raw_text:
                raise ValueError("Biblicus URL text extraction returned empty text.")

            filter_result = _filter_article_text(
                extracted_text=raw_text,
                source_uri=extraction_source_uri,
                reference_title=str(reference.get("title") or ""),
                original_title=str(reference.get("title") or ""),
                original_subtitle=_original_subtitle(reference),
                model=model,
            )
            canonical_text = str(filter_result.get("text") or "").strip() or raw_text
            corpus_key = (
                corpus_key_by_id.get(str(reference.get("corpusId") or ""))
                or _corpus_key_from_reference(reference)
            )

            raw_metadata = {
                "source": "biblicus-url-text",
                "extractorId": "biblicus.extract.url-text",
                "sourceUri": extraction_source_uri,
                "sourceUriOriginal": source_uri,
                "extractedAt": _utc_now(),
                "externalItemId": str(reference.get("externalItemId") or reference.get("id") or "") or None,
                "title": extracted.get("title"),
                "textLength": len(raw_text),
                "sourceKind": extracted.get("sourceKind"),
                "strategy": extracted.get("strategy"),
                "contentType": extracted.get("contentType"),
                "promptVersion": extracted.get("promptVersion"),
                "attempts": extracted.get("attempts"),
            }
            raw_metadata.update(_enrichment_attachment_metadata(enrichment))
            raw_expected = _reference_attachment_record(
                reference=reference,
                role="extracted_text_raw",
                corpus_key=corpus_key,
                storage_namespace="raw",
                markdown=raw_markdown,
                source_uri=None,
                metadata=raw_metadata,
                existing_attachment=existing_raw,
            )
            plans.append(
                {
                    "reference": reference,
                    "record": {"modelName": "ReferenceAttachment", "expected": raw_expected},
                    "body": raw_expected.pop("__attachmentBody"),
                }
            )

            canonical_status = "filtered" if filter_result.get("status") == "ok" else "fallback_raw"
            if canonical_status == "filtered":
                filtered_count += 1
            else:
                fallback_raw_count += 1
                filter_fallback = {
                    "referenceId": reference.get("id"),
                    "externalItemId": reference.get("externalItemId"),
                    "sourceUri": source_uri,
                    "reason": filter_result.get("error")
                    or {"code": "article_filter_failed", "message": "Article-text filter failed."},
                }
                filter_fallbacks.append(filter_fallback)

            canonical_metadata = {
                "source": "biblicus-article-text-filter",
                "extractorId": "biblicus.extract.article-text",
                "sourceUri": extraction_source_uri,
                "sourceUriOriginal": source_uri,
                "filteredAt": _utc_now(),
                "filterStatus": canonical_status,
                "filterPromptVersion": filter_result.get("promptVersion"),
                "filterModel": filter_result.get("model") or model,
                "filterSpanCount": filter_result.get("spanCount"),
                "filterWarnings": filter_result.get("warnings"),
                "filterError": filter_result.get("error"),
                "filterRetryFailureCount": int(filter_result.get("retryFailureCount") or 0),
                "filterRetryRoundsUsed": int(filter_result.get("retryRoundsUsed") or 0),
                "filterRetryLastCode": filter_result.get("retryLastCode"),
                "urlExtraction": {
                    "sourceKind": extracted.get("sourceKind"),
                    "strategy": extracted.get("strategy"),
                    "contentType": extracted.get("contentType"),
                    "promptVersion": extracted.get("promptVersion"),
                },
                "textLength": len(canonical_text),
            }
            canonical_metadata.update(_enrichment_attachment_metadata(enrichment))
            canonical_expected = _reference_attachment_record(
                reference=reference,
                role="extracted_text",
                corpus_key=corpus_key,
                storage_namespace="text",
                markdown=canonical_text,
                source_uri=None,
                metadata=canonical_metadata,
                existing_attachment=existing_canonical,
            )
            plans.append(
                {
                    "reference": reference,
                    "record": {"modelName": "ReferenceAttachment", "expected": canonical_expected},
                    "body": canonical_expected.pop("__attachmentBody"),
                }
            )
            planned_references += 1
            items.append(
                {
                    "reference": _reference_row(reference),
                    "status": canonical_status,
                    "sourcePlugin": enrichment.get("pluginKey"),
                    "filter": {
                        "status": filter_result.get("status"),
                        "spanCount": filter_result.get("spanCount"),
                        "error": filter_result.get("error"),
                    },
                    "urlExtraction": {
                        "sourceKind": extracted.get("sourceKind"),
                        "strategy": extracted.get("strategy"),
                    },
                }
            )
        except Exception as error:
            reason = _reference_url_text_failure_reason(error)
            failures.append(
                {
                    "referenceId": reference.get("id"),
                    "externalItemId": reference.get("externalItemId"),
                    "sourceUri": source_uri,
                    "reason": reason,
                    "error": json.dumps(reason, sort_keys=True),
                }
            )
            items.append(
                {
                    "reference": _reference_row(reference),
                    "status": "failed",
                    "error": reason,
                }
            )
        if max_count and planned_references >= max_count:
            break
    return {
        "plans": plans,
        "referenceRecords": reference_records,
        "failures": failures,
        "items": items,
        "filterFallbacks": filter_fallbacks,
        "eligibleCount": eligible,
        "plannedCount": planned_references,
        "plannedAttachmentCount": len(plans),
        "plannedReferenceMetadataCount": len(reference_records),
        "filteredCount": filtered_count,
        "fallbackRawCount": fallback_raw_count,
        "skippedExistingCount": skipped_existing,
    }


def run_reference_url_text_extraction(
    *,
    client: Any,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    corpus_key_by_id: dict[str, str] | None = None,
    corpus_id: str | None = None,
    reference_ids: set[str] | None = None,
    external_item_ids: set[str] | None = None,
    curation_status: str = "all",
    max_count: int | None = None,
    force: bool = False,
    apply: bool = False,
    bucket: str | None = None,
    model: str = "gpt-5.4-nano",
) -> dict[str, Any]:
    from .records import build_record_changes, build_record_changes_targeted_by_id

    planned = build_reference_url_text_attachment_plans(
        references=references,
        attachments=attachments,
        corpus_key_by_id=corpus_key_by_id,
        corpus_id=corpus_id,
        reference_ids=reference_ids,
        external_item_ids=external_item_ids,
        curation_status=curation_status,
        max_count=max_count,
        force=force,
        model=model,
    )
    attachment_records = [plan["record"] for plan in planned["plans"]]
    attachment_changes = build_record_changes(client, attachment_records)
    reference_changes = build_record_changes_targeted_by_id(client, planned.get("referenceRecords") or [])
    changes = [*reference_changes, *attachment_changes]
    summary = {
        "plans": planned["plans"],
        "referenceRecords": planned.get("referenceRecords") or [],
        "failures": planned["failures"],
        "items": planned["items"],
        "filterFallbacks": planned["filterFallbacks"],
        "eligibleCount": planned["eligibleCount"],
        "plannedCount": planned["plannedCount"],
        "plannedAttachmentCount": planned["plannedAttachmentCount"],
        "plannedReferenceMetadataCount": planned.get("plannedReferenceMetadataCount", 0),
        "filteredCount": planned["filteredCount"],
        "fallbackRawCount": planned["fallbackRawCount"],
        "skippedExistingCount": planned["skippedExistingCount"],
        "changes": changes,
        "attachmentChangeCount": len([change for change in attachment_changes if change.get("action") != "noop"]),
        "referenceMetadataChangeCount": len([change for change in reference_changes if change.get("action") != "noop"]),
        "changeCount": len([change for change in changes if change.get("action") != "noop"]),
    }
    if apply:
        summary["applySummary"] = apply_reference_url_text_attachment_changes(
            client=client,
            changes=changes,
            plans=planned["plans"],
            bucket=bucket,
        )
    return summary


def build_reference_extracted_text_filter_attachment_plans(
    *,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    corpus_id: str | None = None,
    reference_ids: set[str] | None = None,
    external_item_ids: set[str] | None = None,
    curation_status: str = "all",
    max_count: int | None = None,
    force: bool = True,
    model: str = "gpt-5.4-nano",
    bucket: str | None = None,
) -> dict[str, Any]:
    selected_reference_ids = set(reference_ids or [])
    selected_external_item_ids = set(external_item_ids or [])
    plans: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    filter_fallbacks: list[dict[str, Any]] = []
    attempted = 0
    planned_references = 0
    planned_attachments = 0
    filtered_count = 0
    fallback_raw_count = 0
    skipped_missing_source = 0
    seen_lineages: set[str] = set()
    active_bucket = bucket or resolve_storage_bucket_name()
    s3_client = None
    if active_bucket:
        if boto3 is None:
            raise RuntimeError("boto3 is required to read and write reference text attachments.")
        s3_client = boto3.client("s3")

    for reference in _iter_candidate_references(
        references=references,
        corpus_id=corpus_id,
        curation_status=curation_status,
        reference_ids=selected_reference_ids,
        external_item_ids=selected_external_item_ids,
    ):
        lineage_id = str(reference.get("lineageId") or "")
        if not lineage_id or lineage_id in seen_lineages:
            continue
        seen_lineages.add(lineage_id)
        existing_canonical = select_extracted_text_attachment(reference, attachments)
        existing_raw = select_extracted_text_raw_attachment(reference, attachments)
        if existing_canonical and not force:
            items.append(
                {
                    "reference": _reference_row(reference),
                    "status": "skipped_existing",
                }
            )
            continue
        source_uri = normalize_http_url(reference.get("sourceUri")) or ""
        source_attachment = existing_raw
        if source_attachment is None and _canonical_attachment_is_clearly_non_filtered(existing_canonical):
            source_attachment = existing_canonical
        if source_attachment is None and not source_uri:
            skipped_missing_source += 1
            items.append(
                {
                    "reference": _reference_row(reference),
                    "status": "skipped_missing_source",
                    "error": {
                        "code": "missing_source_attachment",
                        "message": "Reference has no extracted_text_raw attachment and no sourceUri for raw text reconstruction.",
                    },
                }
            )
            continue
        attempted += 1
        if max_count and planned_references >= max_count:
            break
        try:
            if not active_bucket or s3_client is None:
                raise RuntimeError("Could not resolve storage bucket for extracted text attachment filtering.")
            source_text = ""
            source_attachment_id = str(source_attachment.get("id") or "") if isinstance(source_attachment, dict) else ""
            if source_attachment is not None:
                source_text = _read_attachment_text_from_s3(
                    s3_client=s3_client,
                    bucket=active_bucket,
                    attachment=source_attachment,
                )
            else:
                extracted = _extract_url_text(
                    source_uri,
                    reference_title=str(reference.get("title") or ""),
                )
                source_text = str(extracted.get("text") or "").strip()
                if not source_text:
                    raise ValueError("Biblicus URL text extraction returned empty text during raw reconstruction.")

            corpus_key = _corpus_key_from_reference(reference)
            raw_metadata = _base_raw_metadata_for_filter(
                existing_raw=existing_raw,
                source_attachment=source_attachment,
                source_uri=source_uri,
                source_text=source_text,
            )
            raw_expected = _reference_attachment_record(
                reference=reference,
                role="extracted_text_raw",
                corpus_key=corpus_key,
                storage_namespace="raw",
                markdown=source_text,
                source_uri=None,
                metadata=raw_metadata,
                existing_attachment=existing_raw,
            )
            plans.append(
                {
                    "reference": reference,
                    "record": {"modelName": "ReferenceAttachment", "expected": raw_expected},
                    "body": raw_expected.pop("__attachmentBody"),
                }
            )
            planned_attachments += 1
            if not source_attachment_id:
                source_attachment_id = str(raw_expected.get("id") or "")

            filter_result = _filter_article_text(
                extracted_text=source_text,
                source_uri=source_uri,
                reference_title=str(reference.get("title") or ""),
                original_title=str(reference.get("title") or ""),
                original_subtitle=_original_subtitle(reference),
                model=model,
            )
            canonical_status = "filtered" if filter_result.get("status") == "ok" else "fallback_raw"
            if canonical_status == "filtered":
                filtered_count += 1
            else:
                fallback_raw_count += 1
                filter_fallbacks.append(
                    {
                        "referenceId": reference.get("id"),
                        "externalItemId": reference.get("externalItemId"),
                        "sourceUri": source_uri,
                        "reason": filter_result.get("error")
                        or {"code": "article_filter_failed", "message": "Article-text filter failed."},
                    }
                )
            canonical_text = str(filter_result.get("text") or "").strip() or source_text

            canonical_metadata = {
                "source": "biblicus-article-text-filter",
                "extractorId": "biblicus.extract.article-text",
                "sourceUri": source_uri or None,
                "filteredAt": _utc_now(),
                "filterStatus": canonical_status,
                "filterPromptVersion": filter_result.get("promptVersion"),
                "filterModel": filter_result.get("model") or model,
                "filterSpanCount": filter_result.get("spanCount"),
                "filterWarnings": filter_result.get("warnings"),
                "filterError": filter_result.get("error"),
                "filterRetryFailureCount": int(filter_result.get("retryFailureCount") or 0),
                "filterRetryRoundsUsed": int(filter_result.get("retryRoundsUsed") or 0),
                "filterRetryLastCode": filter_result.get("retryLastCode"),
                "sourceAttachmentId": source_attachment_id or None,
                "textLength": len(canonical_text),
            }
            canonical_expected = _reference_attachment_record(
                reference=reference,
                role="extracted_text",
                corpus_key=corpus_key,
                storage_namespace="text",
                markdown=canonical_text,
                source_uri=None,
                metadata=canonical_metadata,
                existing_attachment=existing_canonical,
            )
            plans.append(
                {
                    "reference": reference,
                    "record": {"modelName": "ReferenceAttachment", "expected": canonical_expected},
                    "body": canonical_expected.pop("__attachmentBody"),
                }
            )
            planned_references += 1
            planned_attachments += 1
            items.append(
                {
                    "reference": _reference_row(reference),
                    "status": canonical_status,
                    "filter": {
                        "status": filter_result.get("status"),
                        "spanCount": filter_result.get("spanCount"),
                        "error": filter_result.get("error"),
                    },
                    "sourceAttachmentId": source_attachment_id or None,
                }
            )
        except Exception as error:
            reason = _reference_url_text_failure_reason(error)
            failures.append(
                {
                    "referenceId": reference.get("id"),
                    "externalItemId": reference.get("externalItemId"),
                    "sourceUri": source_uri or reference.get("sourceUri"),
                    "reason": reason,
                    "error": json.dumps(reason, sort_keys=True),
                }
            )
            items.append(
                {
                    "reference": _reference_row(reference),
                    "status": "failed",
                    "error": reason,
                }
            )
    processed_reference_ids = [
        str(entry["reference"].get("id"))
        for entry in items
        if entry.get("status") in {"filtered", "fallback_raw"}
        and isinstance(entry.get("reference"), dict)
        and entry["reference"].get("id")
    ]
    return {
        "plans": plans,
        "items": items,
        "failures": failures,
        "filterFallbacks": filter_fallbacks,
        "attemptedCount": attempted,
        "plannedCount": planned_references,
        "plannedAttachmentCount": planned_attachments,
        "filteredCount": filtered_count,
        "fallbackRawCount": fallback_raw_count,
        "skippedMissingSourceCount": skipped_missing_source,
        "processedReferenceIds": processed_reference_ids,
    }


def run_reference_extracted_text_filtering(
    *,
    client: Any,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    corpus_id: str | None = None,
    reference_ids: set[str] | None = None,
    external_item_ids: set[str] | None = None,
    curation_status: str = "all",
    max_count: int | None = None,
    force: bool = True,
    model: str = "gpt-5.4-nano",
    apply: bool = False,
    bucket: str | None = None,
) -> dict[str, Any]:
    from .records import build_record_changes

    planned = build_reference_extracted_text_filter_attachment_plans(
        references=references,
        attachments=attachments,
        corpus_id=corpus_id,
        reference_ids=reference_ids,
        external_item_ids=external_item_ids,
        curation_status=curation_status,
        max_count=max_count,
        force=force,
        model=model,
        bucket=bucket,
    )
    records = [plan["record"] for plan in planned["plans"]]
    changes = build_record_changes(client, records)
    summary = {
        "plans": planned["plans"],
        "items": planned["items"],
        "failures": planned["failures"],
        "filterFallbacks": planned["filterFallbacks"],
        "attemptedCount": planned["attemptedCount"],
        "plannedCount": planned["plannedCount"],
        "plannedAttachmentCount": planned["plannedAttachmentCount"],
        "filteredCount": planned["filteredCount"],
        "fallbackRawCount": planned["fallbackRawCount"],
        "skippedMissingSourceCount": planned["skippedMissingSourceCount"],
        "processedReferenceIds": planned["processedReferenceIds"],
        "changes": changes,
        "changeCount": len([change for change in changes if change.get("action") != "noop"]),
    }
    if apply:
        summary["applySummary"] = apply_reference_url_text_attachment_changes(
            client=client,
            changes=changes,
            plans=planned["plans"],
            bucket=bucket,
        )
    return summary


def apply_reference_url_text_attachment_changes(
    *,
    client: Any,
    changes: list[dict[str, Any]],
    plans: list[dict[str, Any]],
    bucket: str | None = None,
) -> dict[str, Any]:
    from .records import apply_record_changes

    attachment_changes = [
        change
        for change in changes
        if change.get("modelName") == "ReferenceAttachment" and change.get("action") in {"create", "update"}
    ]
    other_changes = [
        change
        for change in changes
        if change.get("modelName") != "ReferenceAttachment" and change.get("action") != "noop"
    ]
    warnings: list[dict[str, Any]] = []
    if attachment_changes:
        upload_plan_bodies_to_s3(
            plans=plans,
            bucket=bucket,
            allowed_attachment_ids={change["expected"]["id"] for change in attachment_changes},
        )
        apply_record_changes(client, attachment_changes)
    for change in other_changes:
        try:
            apply_record_changes(client, [change])
        except Exception as error:
            warnings.append(
                {
                    "code": "non_attachment_change_failed",
                    "modelName": change.get("modelName"),
                    "id": (change.get("expected") or {}).get("id"),
                    "message": str(error),
                }
            )
    return {
        "uploaded": len(attachment_changes),
        "changed": len([change for change in changes if change.get("action") != "noop"]),
        "created": len([change for change in changes if change.get("action") == "create"]),
        "warnings": warnings,
    }


def upload_plan_bodies_to_s3(
    *,
    plans: list[dict[str, Any]],
    bucket: str | None = None,
    allowed_attachment_ids: set[str] | None = None,
) -> None:
    try:
        import boto3
    except ModuleNotFoundError as error:
        raise RuntimeError("boto3 is required to upload extracted reference text attachments.") from error
    target_bucket = bucket or resolve_storage_bucket_name()
    if not target_bucket:
        raise RuntimeError("Could not resolve storage bucket for extracted reference text attachments.")
    allowed_ids = set(allowed_attachment_ids or [])
    s3 = boto3.client("s3")
    for plan in plans:
        expected = (plan.get("record") or {}).get("expected") or {}
        attachment_id = str(expected.get("id") or "")
        if allowed_ids and attachment_id not in allowed_ids:
            continue
        body = plan.get("body")
        if not isinstance(body, (bytes, bytearray)) or not body:
            raise ValueError(f"Missing attachment body for ReferenceAttachment {attachment_id}.")
        storage_path = str(expected.get("storagePath") or "")
        if not storage_path:
            raise ValueError(f"Missing storagePath for ReferenceAttachment {attachment_id}.")
        s3.put_object(
            Bucket=target_bucket,
            Key=storage_path,
            Body=bytes(body),
            ContentType=str(expected.get("mediaType") or "text/markdown"),
        )


def resolve_storage_bucket_name() -> str | None:
    explicit_bucket = (
        os.environ.get("papyrusMedia_BUCKET_NAME")
        or os.environ.get("PAPYRUS_MEDIA_BUCKET_NAME")
        or os.environ.get("STORAGE_BUCKET_NAME")
        or os.environ.get("AMPLIFY_STORAGE_BUCKET_NAME")
    )
    if explicit_bucket:
        return explicit_bucket
    fallback_bucket = storage_bucket_from_amplify_outputs()
    if not fallback_bucket:
        return None
    if _graphql_endpoint_overrides_amplify_outputs():
        explicit_endpoint = str(os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT") or "").strip()
        fallback_endpoint = _graphql_endpoint_from_amplify_outputs() or "unknown"
        raise RuntimeError(
            "PAPYRUS_GRAPHQL_ENDPOINT does not match amplify_outputs.json. "
            f"Refusing to infer storage bucket from amplify_outputs ({fallback_endpoint}) while "
            f"authoring endpoint is {explicit_endpoint}. "
            "Pass --bucket or set PAPYRUS_MEDIA_BUCKET_NAME explicitly."
        )
    return fallback_bucket


def _graphql_endpoint_overrides_amplify_outputs() -> bool:
    explicit = str(os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT") or "").strip()
    if not explicit:
        return False
    fallback = _graphql_endpoint_from_amplify_outputs()
    if not fallback:
        return False
    return _endpoint_authority(explicit) != _endpoint_authority(fallback)


def _graphql_endpoint_from_amplify_outputs() -> str | None:
    try:
        parsed = load_amplify_outputs()
    except Exception:
        return None
    endpoint = parsed.get("data", {}).get("url") or parsed.get("aws_appsync_graphqlEndpoint")
    normalized = str(endpoint or "").strip()
    return normalized or None


def _endpoint_authority(url: str) -> str:
    try:
        parsed = urlparse(url)
    except ValueError:
        return url.strip().lower()
    host = (parsed.netloc or "").strip().lower()
    path = (parsed.path or "").strip()
    return f"{host}{path}"


def normalize_http_url(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.netloc:
        return None
    return raw


class ReferenceUrlTextExtractionError(RuntimeError):
    def __init__(self, *, reason: dict[str, Any]):
        self.reason = dict(reason)
        super().__init__(str(self.reason.get("message") or self.reason.get("code") or "URL text extraction failed."))


def _extract_url_text(source_uri: str, *, reference_title: str = "") -> dict[str, Any]:
    payload = {
        "source_uri": source_uri,
        "reference_title": reference_title or "",
    }
    result = _run_biblicus_url_text(payload)
    status = str(result.get("status") or "").strip().lower()
    if status != "ok":
        reason = result.get("error") if isinstance(result.get("error"), dict) else None
        if not reason:
            reason = {
                "code": "biblicus_url_text_failed",
                "message": "Biblicus URL text extraction failed.",
                "details": {"result": result},
            }
        raise ReferenceUrlTextExtractionError(reason=reason)
    text = str(result.get("text") or "").strip()
    if not text:
        raise ReferenceUrlTextExtractionError(
            reason={
                "code": "empty_text",
                "message": "Biblicus URL text extraction produced empty text.",
                "details": {"sourceUri": source_uri},
            }
        )
    return {
        "text": text,
        "markdown": str(result.get("markdown") or text),
        "title": str(result.get("title") or "") or None,
        "sourceKind": str(result.get("source_kind") or "") or None,
        "strategy": str(result.get("strategy") or "") or None,
        "contentType": str(result.get("content_type") or "") or None,
        "promptVersion": str(result.get("prompt_version") or "") or None,
        "attempts": result.get("attempts") if isinstance(result.get("attempts"), list) else [],
    }


def _filter_article_text(
    *,
    extracted_text: str,
    source_uri: str,
    reference_title: str,
    original_title: str,
    original_subtitle: str,
    model: str,
) -> dict[str, Any]:
    cleaned_text = str(extracted_text or "").replace("\x00", "").strip()
    if not cleaned_text:
        return {
            "status": "failed",
            "text": "",
            "spanCount": 0,
            "promptVersion": None,
            "model": model,
            "warnings": [],
            "retryTrace": [],
            "retryFailureCount": 0,
            "retryRoundsUsed": 0,
            "retryLastCode": None,
            "error": {"code": "empty_extracted_text", "message": "Cannot filter empty extracted text."},
        }
    payload = {
        "extracted_text": cleaned_text,
        "source_uri": source_uri,
        "reference_title": reference_title,
        "original_title": original_title,
        "original_subtitle": original_subtitle,
        "model": model,
    }
    try:
        result = _run_biblicus_article_text(payload)
    except Exception as error:
        return {
            "status": "failed",
            "text": "",
            "spanCount": 0,
            "promptVersion": None,
            "model": model,
            "warnings": [],
            "retryTrace": [],
            "retryFailureCount": 0,
            "retryRoundsUsed": 0,
            "retryLastCode": None,
            "error": {"code": "biblicus_article_text_failed", "message": str(error)},
        }
    retry_trace = _bounded_retry_trace(result.get("retry_trace"), limit=10)
    retry_failure_count = _coerce_non_negative_int(result.get("retry_failure_count"))
    if retry_failure_count is None:
        retry_failure_count = len(retry_trace)
    retry_rounds_used = _coerce_non_negative_int(result.get("retry_rounds_used")) or 0
    retry_last_code = ""
    if retry_trace:
        retry_last_code = str((retry_trace[-1] or {}).get("failure_code") or "").strip()
    status = str(result.get("status") or "").strip().lower()
    filtered_text = str(result.get("text") or "").strip()
    if status == "ok" and filtered_text:
        return {
            "status": "ok",
            "text": filtered_text,
            "spanCount": int(result.get("span_count") or 0),
            "promptVersion": result.get("prompt_version"),
            "model": result.get("model") or model,
            "warnings": result.get("warnings") if isinstance(result.get("warnings"), list) else [],
            "retryTrace": retry_trace,
            "retryFailureCount": retry_failure_count,
            "retryRoundsUsed": retry_rounds_used,
            "retryLastCode": retry_last_code or None,
            "error": None,
        }
    reason = result.get("error") if isinstance(result.get("error"), dict) else None
    if not reason:
        reason = {
            "code": "article_filter_failed",
            "message": "Biblicus article-text filtering failed.",
            "details": {"result": result},
        }
    reason = _attach_retry_trace_to_reason(
        reason=reason,
        retry_trace=retry_trace,
        retry_failure_count=retry_failure_count,
        retry_rounds_used=retry_rounds_used,
    )
    return {
        "status": "failed",
        "text": "",
        "spanCount": int(result.get("span_count") or 0),
        "promptVersion": result.get("prompt_version"),
        "model": result.get("model") or model,
        "warnings": result.get("warnings") if isinstance(result.get("warnings"), list) else [],
        "retryTrace": retry_trace,
        "retryFailureCount": retry_failure_count,
        "retryRoundsUsed": retry_rounds_used,
        "retryLastCode": retry_last_code or None,
        "error": reason,
    }


def _run_biblicus_url_text(payload: dict[str, Any]) -> dict[str, Any]:
    if not BIBLICUS_ROOT.is_dir():
        raise ReferenceUrlTextExtractionError(
            reason={
                "code": "biblicus_checkout_missing",
                "message": f"Biblicus checkout not found at {BIBLICUS_ROOT}.",
            }
        )
    command = [
        str(_biblicus_python_executable()),
        "-m",
        "biblicus",
        "extract",
        "url-text",
        "--input-json",
        "-",
        "--format",
        "json",
    ]
    env = _biblicus_env()
    completed = subprocess.run(
        command,
        cwd=BIBLICUS_ROOT,
        capture_output=True,
        text=True,
        check=False,
        input=json.dumps(payload),
        env=env,
    )
    stdout = (completed.stdout or "").strip()
    stderr = (completed.stderr or "").strip()
    parsed_stdout = _json_object_or_none(stdout)
    if completed.returncode != 0 and _is_missing_markitdown_error(parsed_stdout) and shutil.which("uv"):
        uv_command = [
            "uv",
            "run",
            "--extra",
            "markitdown",
            "biblicus",
            "extract",
            "url-text",
            "--input-json",
            "-",
            "--format",
            "json",
        ]
        completed = subprocess.run(
            uv_command,
            cwd=BIBLICUS_ROOT,
            capture_output=True,
            text=True,
            check=False,
            input=json.dumps(payload),
            env=env,
        )
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        parsed_stdout = _json_object_or_none(stdout)
    if completed.returncode != 0:
        reason = (
            parsed_stdout.get("error")
            if isinstance(parsed_stdout, dict) and isinstance(parsed_stdout.get("error"), dict)
            else {
                "code": "biblicus_cli_failed",
                "message": stderr or stdout or f"Biblicus URL text command exited {completed.returncode}.",
            }
        )
        raise ReferenceUrlTextExtractionError(reason=reason)
    if not isinstance(parsed_stdout, dict):
        raise ReferenceUrlTextExtractionError(
            reason={
                "code": "invalid_biblicus_output",
                "message": "Biblicus URL text command returned invalid JSON output.",
                "details": {"stdout": stdout},
            }
        )
    return parsed_stdout


def _run_biblicus_article_text(payload: dict[str, Any]) -> dict[str, Any]:
    if not BIBLICUS_ROOT.is_dir():
        raise RuntimeError(f"Biblicus checkout not found at {BIBLICUS_ROOT}.")
    command = [
        str(_biblicus_python_executable()),
        "-m",
        "biblicus",
        "extract",
        "article-text",
        "--input-json",
        "-",
        "--format",
        "json",
    ]
    completed = subprocess.run(
        command,
        cwd=BIBLICUS_ROOT,
        capture_output=True,
        text=True,
        check=False,
        input=json.dumps(payload),
        env=_biblicus_env(),
    )
    stdout = (completed.stdout or "").strip()
    stderr = (completed.stderr or "").strip()
    parsed_stdout = _json_object_or_none(stdout)
    if _is_missing_dspy_error(parsed_stdout) and shutil.which("uv"):
        uv_command = [
            "uv",
            "run",
            "--extra",
            "dspy",
            "--extra",
            "openai",
            "biblicus",
            "extract",
            "article-text",
            "--input-json",
            "-",
            "--format",
            "json",
        ]
        completed = subprocess.run(
            uv_command,
            cwd=BIBLICUS_ROOT,
            capture_output=True,
            text=True,
            check=False,
            input=json.dumps(payload),
            env=_biblicus_env(),
        )
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        parsed_stdout = _json_object_or_none(stdout)
    if completed.returncode != 0:
        if isinstance(parsed_stdout, dict) and isinstance(parsed_stdout.get("error"), dict):
            error = parsed_stdout["error"]
            raise RuntimeError(str(error.get("message") or error.get("code") or "Biblicus article-text command failed."))
        raise RuntimeError(stderr or stdout or f"Biblicus article-text command exited {completed.returncode}.")
    if not isinstance(parsed_stdout, dict):
        raise RuntimeError("Biblicus article-text command returned invalid JSON output.")
    return parsed_stdout


def _biblicus_env() -> dict[str, str]:
    env = dict(os.environ)
    biblicus_src = str(BIBLICUS_ROOT / "src")
    env["PYTHONPATH"] = (
        f"{biblicus_src}{os.pathsep}{env['PYTHONPATH']}"
        if env.get("PYTHONPATH")
        else biblicus_src
    )
    return env


def _biblicus_python_executable() -> str:
    for candidate in (
        BIBLICUS_ROOT / ".venv" / "bin" / "python",
        BIBLICUS_ROOT / ".venv" / "bin" / "python3",
    ):
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def _read_attachment_text_from_s3(*, s3_client: Any, bucket: str, attachment: dict[str, Any]) -> str:
    storage_path = str(attachment.get("storagePath") or "").strip()
    if not storage_path:
        raise ValueError("Attachment is missing storagePath.")
    response = s3_client.get_object(Bucket=bucket, Key=storage_path)
    raw = response["Body"].read()
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        raise ValueError(f"Attachment {attachment.get('id') or '-'} is empty.")
    return text


def _json_object_or_none(raw_text: str) -> dict[str, Any] | None:
    if not raw_text:
        return None
    try:
        parsed = json.loads(raw_text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        stripped = raw_text.strip()
        if not stripped:
            return None
        decoder = json.JSONDecoder()
        for index, character in enumerate(stripped):
            if character != "{":
                continue
            try:
                candidate, end_index = decoder.raw_decode(stripped[index:])
            except json.JSONDecodeError:
                continue
            if not isinstance(candidate, dict):
                continue
            if stripped[index + end_index :].strip():
                continue
            return candidate
        return None


def _bounded_retry_trace(value: Any, *, limit: int) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    rows: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        rows.append(
            {
                "attempt": int(entry.get("attempt") or 0),
                "max_rounds": int(entry.get("max_rounds") or 0),
                "retries_left": int(entry.get("retries_left") or 0),
                "failure_code": str(entry.get("failure_code") or ""),
                "error_message": str(entry.get("error_message") or ""),
                "next_action": str(entry.get("next_action") or ""),
            }
        )
    if limit <= 0:
        return rows
    return rows[-limit:]


def _attach_retry_trace_to_reason(
    *,
    reason: dict[str, Any],
    retry_trace: list[dict[str, Any]],
    retry_failure_count: int,
    retry_rounds_used: int,
) -> dict[str, Any]:
    payload = dict(reason)
    details = payload.get("details")
    if not isinstance(details, dict):
        details = {}
    details["retry_trace"] = retry_trace
    details["retry_failure_count"] = int(retry_failure_count)
    details["retry_rounds_used"] = int(retry_rounds_used)
    payload["details"] = details
    return payload


def _coerce_non_negative_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    return parsed


def _is_missing_markitdown_error(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return False
    error = payload.get("error")
    return isinstance(error, dict) and str(error.get("code") or "") == "missing_markitdown_dependency"


def _is_missing_dspy_error(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return False
    error = payload.get("error")
    if not isinstance(error, dict):
        return False
    code = str(error.get("code") or "").strip()
    message = str(error.get("message") or "").lower()
    return code in {"missing_dspy_dependency", "article_text_filter_failed"} and "biblicus[dspy]" in message


def _reference_url_text_failure_reason(error: Exception) -> dict[str, Any]:
    if isinstance(error, ReferenceUrlTextExtractionError):
        return error.reason
    return {
        "code": "url_text_extraction_failed",
        "message": str(error),
    }


def _reference_attachment_record(
    *,
    reference: dict[str, Any],
    role: str,
    corpus_key: str,
    storage_namespace: str,
    markdown: str,
    source_uri: str | None,
    metadata: dict[str, Any],
    existing_attachment: dict[str, Any] | None,
) -> dict[str, Any]:
    now = _utc_now()
    lineage_id = str(reference.get("lineageId") or "")
    filename = _attachment_filename_for_role(role)
    reference_folder = _attachment_reference_folder(reference)
    storage_path = (
        f"corpora/{_safe_token(corpus_key)}/extracted/markitdown/{_safe_token(storage_namespace)}/{reference_folder}/{filename}"
        if corpus_key
        else f"corpora/reference-extracted/markitdown/{_safe_token(storage_namespace)}/{reference_folder}/{filename}"
    )
    body = str(markdown or "").encode("utf-8")
    sha256 = hashlib.sha256(body).hexdigest()
    key = f"{lineage_id}\n{role}"
    sort_key = "900-extracted-text" if role == "extracted_text" else "890-extracted-text-raw"
    return {
        "id": existing_attachment.get("id") if existing_attachment else f"reference-attachment-{hash_short(key)}",
        "referenceId": reference["id"],
        "referenceLineageId": lineage_id,
        "referenceVersionNumber": reference.get("versionNumber"),
        "referenceVersionKey": f"reference#{reference['id']}",
        "role": role,
        "sortKey": sort_key,
        "storagePath": storage_path,
        "sourceUri": source_uri,
        "filename": filename,
        "mediaType": "text/markdown",
        "byteSize": len(body),
        "sha256": sha256,
        "etag": None,
        "importRunId": None,
        "importedAt": now,
        "metadata": json.dumps(metadata),
        "__attachmentBody": body,
    }


def _iter_candidate_references(
    *,
    references: list[dict[str, Any]],
    corpus_id: str | None,
    curation_status: str,
    reference_ids: set[str],
    external_item_ids: set[str],
) -> list[dict[str, Any]]:
    rows = [
        reference
        for reference in references
        if reference.get("versionState") == "current"
        and (not corpus_id or reference.get("corpusId") == corpus_id)
        and (curation_status == "all" or reference.get("curationStatus") == curation_status)
        and (not reference_ids or str(reference.get("id") or "") in reference_ids)
        and (
            not external_item_ids
            or str(reference.get("externalItemId") or "") in external_item_ids
        )
    ]
    rows.sort(
        key=lambda reference: (
            str(reference.get("updatedAt") or reference.get("createdAt") or ""),
            str(reference.get("versionNumber") or ""),
            str(reference.get("id") or ""),
        ),
        reverse=True,
    )
    return rows


def _corpus_key_from_reference(reference: dict[str, Any]) -> str:
    corpus_id = str(reference.get("corpusId") or "")
    if corpus_id.startswith("knowledge-corpus-"):
        return corpus_id.removeprefix("knowledge-corpus-")
    return "unknown"


def _reference_metadata_update_record(
    *,
    reference: dict[str, Any],
    enrichment: dict[str, Any],
    source_uri: str,
    canonical_uri: str,
) -> dict[str, Any] | None:
    reference_id = str(reference.get("id") or "").strip()
    if not reference_id:
        return None
    current_metadata = _reference_metadata_object(reference)
    next_metadata = _merge_reference_metadata_with_enrichment(
        current_metadata=current_metadata,
        enrichment=enrichment,
        source_uri=source_uri,
        canonical_uri=canonical_uri,
    )
    return {
        "modelName": "Reference",
        "expected": {
            "id": reference_id,
            "metadata": json.dumps(next_metadata, sort_keys=True),
            "updatedAt": _utc_now(),
        },
    }


def _reference_metadata_object(reference: dict[str, Any]) -> dict[str, Any]:
    metadata = reference.get("metadata")
    if isinstance(metadata, dict):
        return dict(metadata)
    if isinstance(metadata, str):
        try:
            parsed = json.loads(metadata)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _merge_reference_metadata_with_enrichment(
    *,
    current_metadata: dict[str, Any],
    enrichment: dict[str, Any],
    source_uri: str,
    canonical_uri: str,
) -> dict[str, Any]:
    output = dict(current_metadata)
    plugin_key = str(enrichment.get("pluginKey") or "default")

    papyrus = output.get("papyrus")
    if not isinstance(papyrus, dict):
        papyrus = {}
    source_resolution = papyrus.get("source_resolution")
    if not isinstance(source_resolution, dict):
        source_resolution = {}
    plugin_metadata = enrichment.get("metadata")
    plugin_payload = dict(plugin_metadata) if isinstance(plugin_metadata, dict) else {}
    plugin_payload.setdefault("sourceUri", source_uri)
    plugin_payload.setdefault("canonicalUri", canonical_uri)
    plugin_payload.setdefault("sourceVariants", enrichment.get("sourceVariants") if isinstance(enrichment.get("sourceVariants"), dict) else {})
    source_resolution[plugin_key] = plugin_payload
    papyrus["source_resolution"] = source_resolution
    output["papyrus"] = papyrus

    identifiers = output.get("identifiers")
    if not isinstance(identifiers, dict):
        identifiers = {}
    resolved_existing = identifiers.get("resolved")
    resolved = dict(resolved_existing) if isinstance(resolved_existing, dict) else {}
    enriched_identifiers = enrichment.get("identifiers")
    enriched_identifiers = enriched_identifiers if isinstance(enriched_identifiers, dict) else {}
    resolved.update(
        {
            str(key): str(value)
            for key, value in (enriched_identifiers.get("resolved") or {}).items()
            if str(value).strip()
        }
    )
    resolved["source_uri"] = source_uri
    resolved["canonical_uri"] = canonical_uri

    candidates_existing = identifiers.get("candidates")
    merged_candidates = list(candidates_existing) if isinstance(candidates_existing, list) else []
    if isinstance(enriched_identifiers.get("candidates"), list):
        merged_candidates.extend(enriched_identifiers.get("candidates") or [])
    merged_candidates = _dedupe_identifier_candidates(merged_candidates)

    warnings_existing = identifiers.get("warnings")
    merged_warnings = list(warnings_existing) if isinstance(warnings_existing, list) else []
    if isinstance(enriched_identifiers.get("warnings"), list):
        merged_warnings.extend(enriched_identifiers.get("warnings") or [])
    if isinstance(enrichment.get("warnings"), list):
        merged_warnings.extend(enrichment.get("warnings") or [])
    merged_warnings = _dedupe_warning_objects(merged_warnings)

    primary = enriched_identifiers.get("primary")
    if not isinstance(primary, dict) or not primary.get("type") or not primary.get("value"):
        primary = _primary_identifier_from_candidates(resolved=resolved, candidates=merged_candidates)

    identifiers["resolved"] = resolved
    identifiers["candidates"] = merged_candidates
    identifiers["primary"] = primary
    identifiers["warnings"] = merged_warnings
    identifiers["provenance"] = {
        "sourcePlugin": plugin_key,
        "resolvedAt": _utc_now(),
    }
    output["identifiers"] = identifiers
    return output


def _primary_identifier_from_candidates(*, resolved: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, str] | None:
    precedence = ("arxiv_id", "doi", "youtube_video_id", "canonical_uri", "source_uri")
    for key in precedence:
        value = str(resolved.get(key) or "").strip()
        if value:
            return {"type": key, "value": value}
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        id_type = str(candidate.get("type") or "").strip()
        value = str(candidate.get("value") or "").strip()
        if id_type and value:
            return {"type": id_type, "value": value}
    return None


def _dedupe_identifier_candidates(candidates: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for row in candidates:
        if not isinstance(row, dict):
            continue
        id_type = str(row.get("type") or "").strip()
        value = str(row.get("value") or "").strip()
        source = str(row.get("source") or "").strip()
        if not id_type or not value:
            continue
        key = (id_type, value, source)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "type": id_type,
                "value": value,
                "source": source,
                "confidence": row.get("confidence"),
                "rank": row.get("rank"),
            }
        )
    normalized.sort(key=lambda row: (int(row.get("rank") or 999), row.get("type") or "", row.get("value") or ""))
    return normalized


def _dedupe_warning_objects(rows: list[Any]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        if isinstance(row, dict):
            payload = row
        else:
            payload = {"message": str(row)}
        key = json.dumps(payload, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(payload)
    return deduped


def _enrichment_attachment_metadata(enrichment: dict[str, Any]) -> dict[str, Any]:
    identifiers = enrichment.get("identifiers")
    identifiers = identifiers if isinstance(identifiers, dict) else {}
    payload = {
        "sourcePlugin": enrichment.get("pluginKey"),
        "sourceVariants": enrichment.get("sourceVariants") if isinstance(enrichment.get("sourceVariants"), dict) else {},
        "identifiers": {
            "resolved": identifiers.get("resolved") if isinstance(identifiers.get("resolved"), dict) else {},
            "primary": identifiers.get("primary") if isinstance(identifiers.get("primary"), dict) else None,
        },
        "pluginWarnings": identifiers.get("warnings") if isinstance(identifiers.get("warnings"), list) else [],
    }
    attachment_metadata = enrichment.get("attachmentMetadata")
    if isinstance(attachment_metadata, dict):
        payload.update(attachment_metadata)
    enriched_metadata = enrichment.get("metadata")
    if isinstance(enriched_metadata, dict):
        if str(enriched_metadata.get("abstract") or "").strip():
            payload["abstract"] = str(enriched_metadata.get("abstract") or "")
        if str(enriched_metadata.get("abstractSource") or "").strip():
            payload["abstractSource"] = str(enriched_metadata.get("abstractSource") or "")
        if str(enriched_metadata.get("doi") or "").strip():
            payload["doi"] = str(enriched_metadata.get("doi") or "")
    return payload


def _original_subtitle(reference: dict[str, Any]) -> str:
    metadata = reference.get("metadata")
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    return str(
        metadata.get("original_subtitle")
        or metadata.get("originalSubtitle")
        or metadata.get("subtitle")
        or reference.get("subtitle")
        or ""
    ).strip()


def _reference_row(reference: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": reference.get("id"),
        "lineageId": reference.get("lineageId"),
        "externalItemId": reference.get("externalItemId"),
        "sourceUri": reference.get("sourceUri"),
        "curationStatus": reference.get("curationStatus"),
        "title": reference.get("title"),
    }


def _safe_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return token[:180] or "reference"


def _attachment_filename_for_role(role: str) -> str:
    normalized = str(role or "").strip()
    if normalized == "extracted_text":
        return "extracted_text.md"
    if normalized == "extracted_text_raw":
        return "extracted_text_raw.md"
    return f"{_safe_token(normalized or 'attachment')}.md"


def _attachment_reference_folder(reference: dict[str, Any]) -> str:
    return _safe_token(
        str(
            reference.get("lineageId")
            or reference.get("id")
            or reference.get("externalItemId")
            or "reference"
        )
    )


def _attachment_metadata_object(attachment: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(attachment, dict):
        return {}
    metadata = attachment.get("metadata")
    if isinstance(metadata, dict):
        return dict(metadata)
    if isinstance(metadata, str):
        try:
            parsed = json.loads(metadata)
        except json.JSONDecodeError:
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


def _attachment_filter_status(attachment: dict[str, Any] | None) -> str:
    metadata = _attachment_metadata_object(attachment)
    return str(metadata.get("filterStatus") or metadata.get("filter_status") or "").strip().lower()


def _canonical_attachment_is_clearly_non_filtered(attachment: dict[str, Any] | None) -> bool:
    if not isinstance(attachment, dict):
        return False
    if str(attachment.get("role") or "") != "extracted_text":
        return False
    status = _attachment_filter_status(attachment)
    if status == "filtered":
        return False
    if status in {"fallback_raw", "raw", "unfiltered"}:
        return True
    metadata = _attachment_metadata_object(attachment)
    source = str(metadata.get("source") or "").strip().lower()
    if source == "biblicus-article-text-filter":
        return False
    return source in {"biblicus-url-text", "papyrus-reference-text-filter"}


def _base_raw_metadata_for_filter(
    *,
    existing_raw: dict[str, Any] | None,
    source_attachment: dict[str, Any] | None,
    source_uri: str,
    source_text: str,
) -> dict[str, Any]:
    metadata = _attachment_metadata_object(existing_raw)
    metadata.setdefault("source", "papyrus-reference-text-filter")
    metadata.setdefault("extractorId", "papyrus.references.filter-extracted-text")
    metadata["sourceUri"] = source_uri or metadata.get("sourceUri")
    metadata["importedAt"] = _utc_now()
    metadata["textLength"] = len(source_text)
    if source_attachment is not None:
        metadata["copiedFromAttachmentId"] = source_attachment.get("id")
    else:
        metadata["reconstructedFromSourceUri"] = source_uri or None
    return metadata


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
