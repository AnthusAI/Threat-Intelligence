"""Deterministic intake for inbound email with PDF attachment(s) and no body citations."""

from __future__ import annotations

import os
import re
from typing import Any
from xml.etree import ElementTree

import requests

from papyrus_newsroom.email_submission_replies import InboundMimeAttachment, _pdf_attachments

_DOI_PATTERN = re.compile(rb"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
_ARXIV_ID_PATTERN = re.compile(rb"\b(\d{4}\.\d{4,5})(?:v\d+)?\b", re.IGNORECASE)
_ARXIV_URI_PATTERN = re.compile(rb"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})", re.IGNORECASE)

_FIND_REFERENCE_BY_EXTERNAL_ITEM_QUERY = """
query FindReferenceByExternalItem($corpusId: ID!, $externalItemId: String!, $limit: Int) {
  listReferencesByCorpusAndExternalItem(
    corpusId: $corpusId
    externalItemId: { eq: $externalItemId }
    limit: $limit
  ) {
    items {
      id
      lineageId
      corpusId
      externalItemId
      sourceUri
      versionState
      title
    }
  }
}
"""


def extract_pdf_intake_identifiers(pdf_bytes: bytes, *, grobid_url: str | None = None) -> dict[str, Any]:
    """Resolve DOI / arXiv id (and optional title) from PDF bytes."""
    resolved_grobid = str(grobid_url or os.environ.get("BIBLICUS_GROBID_URL") or "").strip()
    if resolved_grobid:
        header = _grobid_header_identifiers(pdf_bytes, resolved_grobid)
        if header.get("doi") or header.get("arxiv_id"):
            return header

    text = pdf_bytes.decode("latin-1", errors="ignore")
    doi = _normalize_doi_from_text(text)
    arxiv_id = _normalize_arxiv_from_bytes(pdf_bytes) or _normalize_arxiv_from_text(text)
    return {
        "doi": doi or None,
        "arxiv_id": arxiv_id or None,
        "title": None,
        "method": "pdf_bytes_regex",
    }


def external_item_id_for_identifiers(identifiers: dict[str, Any]) -> str | None:
    doi = _normalize_doi_from_text(str(identifiers.get("doi") or ""))
    if doi:
        return f"doi:{doi.lower()}"
    arxiv_id = _normalize_arxiv_from_text(str(identifiers.get("arxiv_id") or ""))
    if arxiv_id:
        return f"arxiv:{arxiv_id.lower()}"
    return None


def citation_url_for_identifiers(identifiers: dict[str, Any]) -> str | None:
    doi = _normalize_doi_from_text(str(identifiers.get("doi") or ""))
    if doi:
        return f"https://doi.org/{doi}"
    arxiv_id = _normalize_arxiv_from_text(str(identifiers.get("arxiv_id") or ""))
    if arxiv_id:
        return f"https://arxiv.org/abs/{arxiv_id}"
    return None


def find_reference_by_external_item_id(
    client: Any,
    *,
    corpus_id: str,
    external_item_id: str,
) -> dict[str, Any] | None:
    response = client.graphql(
        _FIND_REFERENCE_BY_EXTERNAL_ITEM_QUERY,
        {"corpusId": corpus_id, "externalItemId": external_item_id, "limit": 5},
    )
    items = (response.get("listReferencesByCorpusAndExternalItem") or {}).get("items") or []
    for item in items:
        if str(item.get("versionState") or "") == "current":
            return item
    return items[0] if items else None


def file_pdf_payloads_against_reference(
    client: Any,
    *,
    reference: dict[str, Any],
    pdf_attachments: list[InboundMimeAttachment],
    corpus_key: str,
    channel: str,
    submission_message_id: str,
    parent_submission_message_id: str | None = None,
) -> dict[str, Any]:
    from papyrus_content.reference_url_text import (
        apply_reference_url_text_attachment_changes,
        run_reference_source_find,
        _reference_source_attachment_record,
    )
    from papyrus_content.records import build_record_changes
    from papyrus_newsroom.email_submissions import _load_registered_reference_processing_records

    reference_id = str(reference.get("id") or "").strip()
    if not reference_id:
        return {"ok": False, "reason": "reference-id-missing"}

    references, attachments, _relations = _load_registered_reference_processing_records(
        client,
        registered_reference_ids={reference_id},
        import_run_id=None,
    )
    if not references:
        return {"ok": False, "reason": "reference-not-found"}
    reference = references[0]
    from papyrus_content.source_readiness import select_reference_attachment_by_role

    existing_source = select_reference_attachment_by_role(reference, attachments, role="source")
    uploaded: list[dict[str, str]] = []
    plans: list[dict[str, Any]] = []
    attachment_records: list[dict[str, Any]] = []
    current_source = existing_source
    for index, attachment in enumerate(pdf_attachments):
        source_uri = str(reference.get("sourceUri") or "").strip() or f"email-intake://{attachment.filename}"
        record = _reference_source_attachment_record(
            reference=reference,
            corpus_key=corpus_key,
            source_uri=source_uri,
            metadata={
                "channel": channel,
                "submissionMessageId": submission_message_id,
                "parentSubmissionMessageId": parent_submission_message_id,
                "attachmentIndex": index,
            },
            content=attachment.payload,
            media_type="application/pdf",
            existing_attachment=current_source if index == 0 else None,
        )
        body = record.pop("__attachmentBody", None)
        if not isinstance(body, (bytes, bytearray)):
            return {"ok": False, "reason": "attachment-body-missing"}
        plans.append({"record": {"expected": record}, "body": bytes(body)})
        attachment_records.append({"modelName": "ReferenceAttachment", "expected": record})
        uploaded.append({"filename": attachment.filename, "attachmentId": str(record.get("id") or "")})
        if index == 0:
            current_source = record

    attachment_changes = build_record_changes(client, attachment_records)
    apply_summary = apply_reference_url_text_attachment_changes(
        client=client,
        changes=attachment_changes,
        plans=plans,
    )
    merged_attachments = attachments + [
        change["expected"] for change in attachment_changes if change.get("expected")
    ]
    find_summary = run_reference_source_find(
        client=client,
        references=references,
        attachments=merged_attachments,
        reference_ids={reference_id},
        apply=True,
        force=True,
        pdf_only=True,
    )
    return {
        "ok": True,
        "reason": "filed",
        "referenceId": reference_id,
        "referenceLineageId": str(reference.get("lineageId") or ""),
        "uploadedAttachments": uploaded,
        "applySummary": apply_summary,
        "findSummary": {
            "changes": find_summary.get("changes"),
            "eligibleCount": find_summary.get("eligibleCount"),
            "plannedCount": find_summary.get("plannedCount"),
        },
    }


def process_pdf_only_intake(
    client: Any,
    *,
    message_id: str,
    message: dict[str, Any],
    envelope: Any,
    corpus_key: str,
    steering_config_path: str,
    apply: bool,
) -> dict[str, Any]:
    from papyrus_content.ids import knowledge_corpus_id
    from papyrus_content.steering import load_steering_config, require_corpus_config
    from papyrus_newsroom.email_submissions import (
        _create_find_process_direct_citations,
        _direct_citation_rationale,
        _load_registered_reference_processing_records,
    )
    from papyrus_content.reference_url_text import run_reference_url_text_extraction
    from papyrus_content.reference_metadata_generation import run_reference_metadata_generation_from_extracted_text

    pdf_attachments = _pdf_attachments(envelope.attachments)
    if len(pdf_attachments) != 1:
        return {"ok": False, "reason": "expected-single-pdf", "pdfCount": len(pdf_attachments)}

    identifiers = extract_pdf_intake_identifiers(pdf_attachments[0].payload)
    external_item_id = external_item_id_for_identifiers(identifiers)
    citation_url = citation_url_for_identifiers(identifiers)
    if not external_item_id or not citation_url:
        return {"ok": False, "reason": "no-identifiers-found", "identifiers": identifiers}

    steering_config = load_steering_config(steering_config_path) or {}
    corpus_config = require_corpus_config(steering_config, corpus_key, "--corpus-key")
    corpus_id = knowledge_corpus_id(corpus_config)
    existing = find_reference_by_external_item_id(
        client,
        corpus_id=corpus_id,
        external_item_id=external_item_id,
    )
    if existing:
        filing = file_pdf_payloads_against_reference(
            client,
            reference=existing,
            pdf_attachments=pdf_attachments,
            corpus_key=corpus_key,
            channel="email_pdf_only",
            submission_message_id=message_id,
        )
        return {
            "ok": filing.get("ok", False),
            "mode": "pdf_only_attach_existing",
            "identifiers": identifiers,
            "externalItemId": external_item_id,
            "filing": filing,
        }

    citations = [
        {
            "kind": "doi" if identifiers.get("doi") else "url",
            "url": citation_url,
            "doi": identifiers.get("doi"),
            "title": identifiers.get("title") or citation_url,
            "ingestion_rationale": _direct_citation_rationale(citation_url)
            + " Identifiers were extracted from an inbound PDF attachment (no URL in the email body).",
        }
    ]
    create_result = _create_find_process_direct_citations(
        client,
        message=message,
        citations=citations,
        corpus_key=corpus_key,
        steering_config_path=steering_config_path,
        apply=apply,
    )
    registered_ids = [
        str(row).strip()
        for row in (create_result.get("registeredReferenceIds") or [])
        if str(row).strip()
    ]
    if not registered_ids:
        return {
            "ok": False,
            "mode": "pdf_only_create_failed",
            "identifiers": identifiers,
            "createResult": create_result,
        }

    references, attachments, _relations = _load_registered_reference_processing_records(
        client,
        registered_reference_ids=set(registered_ids),
        import_run_id=str(create_result.get("importRunId") or "").strip() or None,
    )
    reference = references[0] if references else {}
    filing = file_pdf_payloads_against_reference(
        client,
        reference=reference,
        pdf_attachments=pdf_attachments,
        corpus_key=corpus_key,
        channel="email_pdf_only",
        submission_message_id=message_id,
    )
    if apply and filing.get("ok"):
        corpus_key_by_id = {corpus_id: str(corpus_config.get("key") or "")}
        references, attachments, relations = _load_registered_reference_processing_records(
            client,
            registered_reference_ids=set(registered_ids),
            import_run_id=str(create_result.get("importRunId") or "").strip() or None,
        )
        find_result = run_reference_url_text_extraction(
            client=client,
            references=references,
            attachments=attachments,
            semantic_relations=relations,
            corpus_key_by_id=corpus_key_by_id,
            corpus_id=corpus_id,
            reference_ids=set(registered_ids),
            curation_status="pending",
            apply=True,
        )
        process_result = run_reference_metadata_generation_from_extracted_text(
            references=references,
            attachments=attachments,
            corpus_id=corpus_id,
            reference_ids=set(registered_ids),
            curation_status="pending",
            apply=True,
        )
        create_result["postPdfAttach"] = {
            "find": find_result,
            "process": process_result,
        }

    return {
        "ok": bool(filing.get("ok")),
        "mode": "pdf_only_create_and_attach",
        "identifiers": identifiers,
        "externalItemId": external_item_id,
        "createResult": create_result,
        "filing": filing,
    }


def _grobid_header_identifiers(pdf_bytes: bytes, grobid_url: str) -> dict[str, Any]:
    endpoint = f"{grobid_url.rstrip('/')}/api/processHeaderDocument"
    try:
        response = requests.post(
            endpoint,
            files={"input": ("submission.pdf", pdf_bytes, "application/pdf")},
            timeout=90,
        )
    except requests.RequestException:
        return {"doi": None, "arxiv_id": None, "title": None, "method": "grobid_header_unavailable"}
    if response.status_code != 200:
        return {"doi": None, "arxiv_id": None, "title": None, "method": "grobid_header_failed"}
    try:
        root = ElementTree.fromstring(response.text)
    except ElementTree.ParseError:
        return {"doi": None, "arxiv_id": None, "title": None, "method": "grobid_header_parse_failed"}
    ns = {"tei": "http://www.tei-c.org/ns/1.0"}
    title_node = root.find(".//tei:titleStmt/tei:title", ns)
    title = _normalize_inline_text("".join(title_node.itertext())) if title_node is not None else None
    doi = ""
    arxiv_id = ""
    for idno in root.findall(".//tei:idno", ns):
        id_type = str(idno.get("type") or "").strip().lower()
        value = _normalize_inline_text("".join(idno.itertext()))
        if id_type == "doi" and not doi:
            doi = _normalize_doi_from_text(value)
        if id_type in {"arxiv", "arxivid"} and not arxiv_id:
            arxiv_id = _normalize_arxiv_from_text(value)
    if not doi and not arxiv_id:
        return {"doi": None, "arxiv_id": None, "title": title, "method": "grobid_header_empty"}
    return {
        "doi": doi or None,
        "arxiv_id": arxiv_id or None,
        "title": title,
        "method": "grobid_header",
    }


def _normalize_inline_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _normalize_doi_from_text(text: str) -> str:
    match = re.search(r"(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)", str(text or ""))
    return match.group(1) if match else ""


def _normalize_arxiv_from_text(text: str) -> str:
    match = re.search(r"(\d{4}\.\d{4,5})(?:v\d+)?", str(text or ""), flags=re.IGNORECASE)
    return match.group(1) if match else ""


def _normalize_arxiv_from_bytes(pdf_bytes: bytes) -> str:
    match = _ARXIV_URI_PATTERN.search(pdf_bytes)
    if match:
        return match.group(1).decode("ascii", errors="ignore")
    match = _ARXIV_ID_PATTERN.search(pdf_bytes)
    if match:
        return match.group(1).decode("ascii", errors="ignore")
    return ""
