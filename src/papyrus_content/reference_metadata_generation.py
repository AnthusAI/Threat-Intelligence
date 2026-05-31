from __future__ import annotations

import json
from typing import Any

from papyrus_newsroom import reference_curation_signals

from .model_defaults import DEFAULT_REFERENCE_SUMMARY_MODEL
from .reference_url_text import resolve_storage_bucket_name
from .source_readiness import select_extracted_text_attachment

try:
    import boto3
except ModuleNotFoundError:  # pragma: no cover - boto3 exists in normal runtime
    class _Boto3Stub:
        @staticmethod
        def client(_name: str) -> Any:
            raise ModuleNotFoundError("boto3")

    boto3 = _Boto3Stub()


def run_reference_metadata_generation_from_extracted_text(
    *,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    corpus_id: str | None = None,
    reference_ids: set[str] | None = None,
    external_item_ids: set[str] | None = None,
    curation_status: str = "all",
    max_count: int | None = None,
    model: str = DEFAULT_REFERENCE_SUMMARY_MODEL,
    apply: bool = False,
    bucket: str | None = None,
) -> dict[str, Any]:
    selected_reference_ids = set(reference_ids or [])
    selected_external_item_ids = set(external_item_ids or [])
    attempted = 0
    generated = 0
    skipped_missing_text = 0
    generation_failures = 0
    items: list[dict[str, Any]] = []

    active_bucket = bucket
    s3_client = None

    for reference in _iter_candidate_references(
        references=references,
        corpus_id=corpus_id,
        curation_status=curation_status,
        reference_ids=selected_reference_ids,
        external_item_ids=selected_external_item_ids,
    ):
        attempted += 1
        if max_count and attempted > max_count:
            attempted -= 1
            break

        context = _resolve_reference_text_context(
            reference=reference,
            attachments=attachments,
            s3_client=s3_client,
            bucket=active_bucket,
        )
        if context.get("s3Client") is not None and s3_client is None:
            s3_client = context["s3Client"]
        if context.get("bucket") and not active_bucket:
            active_bucket = str(context["bucket"])

        if context.get("missingText"):
            skipped_missing_text += 1
            items.append(
                {
                    "reference": _reference_row(reference),
                    "status": "skipped_missing_text",
                    "error": context.get("error"),
                    "attachment": context.get("attachment"),
                }
            )
            continue

        try:
            result = reference_curation_signals.reference_generate_metadata_from_extracted_text(
                reference_id=str(reference.get("id") or ""),
                extracted_text=str(context.get("extractedText") or ""),
                original_title=str(context.get("originalTitle") or ""),
                original_subtitle=str(context.get("originalSubtitle") or ""),
                model=model,
                apply=apply,
                refresh=True,
            )
        except Exception as error:
            generation_failures += 1
            items.append(
                {
                    "reference": _reference_row(reference),
                    "status": "generation_failed",
                    "error": str(error),
                    "attachment": context.get("attachment"),
                }
            )
            continue

        if result.get("status") == "generated":
            generated += 1
        elif result.get("status") == "skipped_missing_text":
            skipped_missing_text += 1
        else:
            generation_failures += 1
        items.append(
            {
                "reference": _reference_row(reference),
                "status": result.get("status") or "generation_failed",
                "error": result.get("error") or "",
                "attachment": context.get("attachment"),
                "title": (result.get("generated") or {}).get("title"),
                "subtitle": (result.get("generated") or {}).get("subtitle"),
                "summary": (result.get("generated") or {}).get("summary"),
            }
        )

    return {
        "attemptedCount": attempted,
        "generatedCount": generated,
        "skippedMissingTextCount": skipped_missing_text,
        "generationFailureCount": generation_failures,
        "items": items,
    }


def _iter_candidate_references(
    *,
    references: list[dict[str, Any]],
    corpus_id: str | None,
    curation_status: str,
    reference_ids: set[str],
    external_item_ids: set[str],
):
    normalized_status = str(curation_status or "all").strip().lower()
    for reference in references:
        if str(reference.get("versionState") or "") != "current":
            continue
        if corpus_id and str(reference.get("corpusId") or "") != str(corpus_id):
            continue
        if normalized_status != "all" and str(reference.get("curationStatus") or "").lower() != normalized_status:
            continue
        reference_id = str(reference.get("id") or "")
        external_item_id = str(reference.get("externalItemId") or "")
        if reference_ids and reference_id not in reference_ids:
            continue
        if external_item_ids and external_item_id not in external_item_ids:
            continue
        yield reference


def _resolve_reference_text_context(
    *,
    reference: dict[str, Any],
    attachments: list[dict[str, Any]],
    s3_client: Any,
    bucket: str | None,
) -> dict[str, Any]:
    attachment = select_extracted_text_attachment(reference, attachments)
    if not attachment:
        return {
            "missingText": True,
            "error": {
                "code": "missing_extracted_text_attachment",
                "message": "Reference has no extracted_text attachment.",
            },
            "attachment": None,
        }
    storage_path = str(attachment.get("storagePath") or "").strip()
    if not storage_path:
        return {
            "missingText": True,
            "error": {
                "code": "missing_storage_path",
                "message": "Extracted text attachment is missing storagePath.",
            },
            "attachment": {"id": attachment.get("id")},
        }

    target_bucket = bucket
    if not target_bucket:
        target_bucket = resolve_storage_bucket_name()
    if not target_bucket:
        return {
            "missingText": True,
            "error": {
                "code": "missing_storage_bucket",
                "message": "Could not resolve storage bucket for extracted text attachment.",
            },
            "attachment": {"id": attachment.get("id"), "storagePath": storage_path},
        }

    client = s3_client
    if client is None:
        try:
            client = boto3.client("s3")
        except ModuleNotFoundError as error:
            raise RuntimeError("boto3 is required to read extracted text attachments from S3.") from error

    try:
        response = client.get_object(Bucket=target_bucket, Key=storage_path)
        raw = response["Body"].read()
        text = raw.decode("utf-8", errors="replace").strip()
    except Exception as error:
        return {
            "missingText": True,
            "error": {
                "code": "attachment_read_failed",
                "message": str(error),
            },
            "attachment": {
                "id": attachment.get("id"),
                "storagePath": storage_path,
                "bucket": target_bucket,
            },
            "s3Client": client,
            "bucket": target_bucket,
        }

    if not text:
        return {
            "missingText": True,
            "error": {
                "code": "empty_extracted_text",
                "message": "Extracted text attachment content is empty.",
            },
            "attachment": {
                "id": attachment.get("id"),
                "storagePath": storage_path,
                "bucket": target_bucket,
            },
            "s3Client": client,
            "bucket": target_bucket,
        }

    generation_context = reference_curation_signals.resolve_reference_text_generation_context(
        extracted_text=text,
        original_title=str(reference.get("title") or "").strip(),
        original_subtitle=_original_subtitle(reference),
    )
    if not generation_context.get("ok"):
        return {
            "missingText": True,
            "error": {
                "code": "missing_extracted_text",
                "message": "Extracted text is required before metadata generation.",
            },
            "attachment": {
                "id": attachment.get("id"),
                "storagePath": storage_path,
                "bucket": target_bucket,
            },
            "s3Client": client,
            "bucket": target_bucket,
        }

    return {
        "missingText": False,
        "extractedText": generation_context["extractedText"],
        "originalTitle": generation_context["originalTitle"],
        "originalSubtitle": generation_context["originalSubtitle"],
        "attachment": {
            "id": attachment.get("id"),
            "storagePath": storage_path,
            "bucket": target_bucket,
        },
        "s3Client": client,
        "bucket": target_bucket,
    }


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
