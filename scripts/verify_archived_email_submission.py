#!/usr/bin/env python3
"""Inspect and optionally re-run find/process for an archived inbound email submission."""

from __future__ import annotations

import argparse
import json
import sys

from papyrus_content.graphql_authoring import PapyrusGraphQLAuthoringClient
from papyrus_content.ids import knowledge_corpus_id
from papyrus_content.reference_metadata_generation import run_reference_metadata_generation_from_extracted_text
from papyrus_content.reference_url_text import run_reference_source_find, run_reference_url_text_extraction
from papyrus_content.steering import load_steering_config, require_corpus_config
from papyrus_newsroom.email_submissions import (
    _load_registered_reference_processing_records,
    _message_metadata,
    inbound_message_id_for_s3,
)
from papyrus_newsroom.reference_curation_signals import _load_reference_metadata_payload


def _references_for_import_run(client: PapyrusGraphQLAuthoringClient, import_run_id: str) -> list[dict]:
    return [
        row
        for row in client.list_records("Reference")
        if str(row.get("importRunId") or "") == import_run_id and str(row.get("versionState") or "") == "current"
    ]


def _print_reference_metadata(reference: dict) -> None:
    payload = _load_reference_metadata_payload(reference)
    print(f"  Reference.id: {reference.get('id')}")
    print(f"  sourceUri: {reference.get('sourceUri')}")
    print(f"  Reference.title: {reference.get('title') or '(empty)'}")
    print(f"  metadata.title: {payload.get('title') or '(empty)'}")
    print(f"  metadata.subtitle: {payload.get('subtitle') or '(empty)'}")
    summary = str(payload.get("summary") or "").strip()
    if summary:
        preview = summary if len(summary) <= 240 else summary[:240] + "..."
        print(f"  metadata.summary: {preview}")
    else:
        print("  metadata.summary: (empty)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive-key", help="SES object id under inbound-email-archived/")
    parser.add_argument("--message-id", help="message-email-submission-... id")
    parser.add_argument("--bucket", default="")
    parser.add_argument("--corpus-key", default="AI-ML-research")
    parser.add_argument("--rerun", action="store_true", help="Run find + process locally (fixed code)")
    args = parser.parse_args()

    bucket = (args.bucket or "").strip()
    if not bucket:
        import os

        bucket = str(os.environ.get("PAPYRUS_MEDIA_BUCKET_NAME") or "").strip()
    if not bucket:
        print("Set PAPYRUS_MEDIA_BUCKET_NAME or pass --bucket", file=sys.stderr)
        return 1

    message_id = (args.message_id or "").strip()
    if not message_id:
        archive_key = (args.archive_key or "").strip().lstrip("/")
        if archive_key.startswith("inbound-email-archived/"):
            archive_key = archive_key.removeprefix("inbound-email-archived/")
        intake_key = f"inbound-email/{archive_key}"
        message_id = inbound_message_id_for_s3(bucket, intake_key)

    client = PapyrusGraphQLAuthoringClient()
    message = client.get_record("Message", message_id)
    if not message:
        print(f"Message not found: {message_id}", file=sys.stderr)
        return 1

    metadata = _message_metadata(message)
    processing = metadata.get("processingResult") if isinstance(metadata.get("processingResult"), dict) else {}
    import_run_id = str(processing.get("importRunId") or "").strip()

    print(f"messageId: {message_id}")
    print(f"status: {message.get('status')} / {message.get('responseStatus')}")
    print(f"sender: {metadata.get('senderEmail')}")
    print(f"archive: {metadata.get('inboundMimeArchiveKey') or metadata.get('s3Key')}")
    print(f"processing.find: {json.dumps(processing.get('find') or {})}")
    print(f"processing.process: {json.dumps(processing.get('process') or {})}")

    if not import_run_id:
        print("No importRunId on message; cannot locate references.", file=sys.stderr)
        return 1

    references = _references_for_import_run(client, import_run_id)
    if not references:
        print(f"No references for importRunId {import_run_id}", file=sys.stderr)
        return 1

    print(f"\nReferences in import run: {len(references)}")
    for reference in references:
        print()
        _print_reference_metadata(reference)

    if not args.rerun:
        print("\nPass --rerun to run find + process locally against production GraphQL (uses fixed code in this repo).")
        return 0

    steering = load_steering_config() or {}
    corpus_config = require_corpus_config(steering, args.corpus_key, "--corpus-key")
    corpus_id = knowledge_corpus_id(corpus_config)
    reference_ids = {str(reference.get("id") or "") for reference in references}
    reference_ids.discard("")

    scoped_references, scoped_attachments, scoped_relations = _load_registered_reference_processing_records(
        client,
        registered_reference_ids=reference_ids,
        import_run_id=import_run_id,
    )

    corpus_key_by_id = {corpus_id: str(corpus_config.get("key") or "")}

    print("\n== Re-running find: source discovery (run_reference_source_find) ==")
    source_find_result = run_reference_source_find(
        client=client,
        references=scoped_references,
        attachments=scoped_attachments,
        corpus_key_by_id=corpus_key_by_id,
        corpus_id=corpus_id,
        reference_ids=reference_ids,
        curation_status="pending",
        apply=True,
    )
    print(
        "source find:",
        f"eligible={source_find_result.get('eligibleCount')}",
        f"changes={source_find_result.get('changeCount')}",
        f"failures={len(source_find_result.get('failures') or [])}",
    )

    scoped_references, scoped_attachments, scoped_relations = _load_registered_reference_processing_records(
        client,
        registered_reference_ids=reference_ids,
        import_run_id=import_run_id,
    )

    print("\n== Re-running find: extracted text (run_reference_url_text_extraction) ==")
    find_result = run_reference_url_text_extraction(
        client=client,
        references=scoped_references,
        attachments=scoped_attachments,
        semantic_relations=scoped_relations,
        corpus_key_by_id=corpus_key_by_id,
        corpus_id=corpus_id,
        reference_ids=reference_ids,
        curation_status="pending",
        apply=True,
    )
    print(
        "extract:",
        f"eligible={find_result.get('eligibleCount')}",
        f"changes={find_result.get('changeCount')}",
        f"failures={len(find_result.get('failures') or [])}",
    )

    scoped_references, scoped_attachments, _ = _load_registered_reference_processing_records(
        client,
        registered_reference_ids=reference_ids,
        import_run_id=import_run_id,
    )

    print("\n== Re-running process (run_reference_metadata_generation_from_extracted_text) ==")
    process_result = run_reference_metadata_generation_from_extracted_text(
        references=scoped_references,
        attachments=scoped_attachments,
        corpus_id=corpus_id,
        reference_ids=reference_ids,
        curation_status="pending",
        apply=True,
    )
    print(
        "process:",
        f"attempted={process_result.get('attemptedCount')}",
        f"generated={process_result.get('generatedCount')}",
        f"skipped_missing_text={process_result.get('skippedMissingTextCount')}",
    )

    print("\n== After re-run ==")
    refreshed = _references_for_import_run(client, import_run_id)
    ok = True
    for reference in refreshed:
        print()
        _print_reference_metadata(reference)
        payload = _load_reference_metadata_payload(reference)
        if not str(payload.get("subtitle") or "").strip() or not str(payload.get("summary") or "").strip():
            ok = False

    if ok and process_result.get("generatedCount", 0) > 0:
        print("\nPASS: subtitle and summary persisted on metadata attachment.")
        return 0
    if process_result.get("generatedCount", 0) == 0:
        print("\nWARN: process did not generate metadata (check find / extracted_text).", file=sys.stderr)
        return 2
    print("\nFAIL: metadata attachment missing subtitle or summary.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
