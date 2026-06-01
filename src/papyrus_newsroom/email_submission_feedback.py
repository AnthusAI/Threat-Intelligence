"""Outbound acknowledgment emails for inbound reference submissions."""

from __future__ import annotations

import html
import json
import os
import re
from email.utils import parseaddr
from typing import Any
from urllib.parse import urlparse

from papyrus_content.papyrus_config import build_newsroom_reference_public_url
from papyrus_content.source_readiness import (
    select_extracted_text_attachment,
    select_reference_attachment_by_role,
)

_ACADEMIC_SOURCE_PLUGINS = frozenset(
    {
        "acm",
        "acl_anthology",
        "arxiv",
        "doi",
        "ieee",
        "springer",
        "default",
    }
)
_NON_PDF_SOURCE_PLUGINS = frozenset({"youtube"})


def feedback_email_enabled() -> bool:
    raw = str(os.environ.get("PAPYRUS_INBOUND_FEEDBACK_EMAIL_ENABLED", "true")).strip().lower()
    return raw not in {"0", "false", "no", "off"}


def default_feedback_from_address() -> str:
    explicit = str(os.environ.get("PAPYRUS_INBOUND_FEEDBACK_FROM_EMAIL") or "").strip()
    if explicit:
        return explicit
    domain = str(os.environ.get("PAPYRUS_INBOUND_EMAIL_DOMAIN") or "p.apyr.us").strip().lower()
    local_part = str(os.environ.get("PAPYRUS_INBOUND_FEEDBACK_FROM_LOCAL_PART") or "submissions").strip()
    return f"Papyrus Submissions <{local_part}@{domain}>"


def parse_attachment_metadata(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def extract_source_plugin_from_attachments(
    reference: dict[str, Any],
    attachments: list[dict[str, Any]],
) -> str | None:
    source_attachment = select_reference_attachment_by_role(reference, attachments, role="source")
    if source_attachment:
        metadata = parse_attachment_metadata(source_attachment.get("metadata"))
        plugin = str(metadata.get("sourcePlugin") or "").strip()
        if plugin:
            return plugin
    for attachment in attachments:
        if str(attachment.get("referenceLineageId") or "") != str(reference.get("lineageId") or ""):
            continue
        metadata = parse_attachment_metadata(attachment.get("metadata"))
        plugin = str(metadata.get("sourcePlugin") or "").strip()
        if plugin:
            return plugin
    return None


def _looks_like_pdf_attachment(attachment: dict[str, Any]) -> bool:
    media_type = str(attachment.get("mediaType") or "").split(";", 1)[0].strip().lower()
    if media_type == "application/pdf":
        return True
    filename = str(attachment.get("filename") or attachment.get("sourceUri") or "").lower()
    return filename.endswith(".pdf")


def pdf_status_for_reference(
    reference: dict[str, Any],
    attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    lineage_id = str(reference.get("lineageId") or reference.get("referenceLineageId") or "")
    source_attachment = select_reference_attachment_by_role(reference, attachments, role="source")
    pdf_attachments = [
        attachment
        for attachment in attachments
        if str(attachment.get("referenceLineageId") or "") == lineage_id and _looks_like_pdf_attachment(attachment)
    ]
    located = bool(source_attachment and _looks_like_pdf_attachment(source_attachment)) or bool(pdf_attachments)
    primary = source_attachment or (pdf_attachments[0] if pdf_attachments else None)
    return {
        "pdfLocated": located,
        "pdfAttachmentId": str(primary.get("id") or "") if primary else None,
        "pdfFilename": str(primary.get("filename") or "") if primary else None,
        "pdfStoragePath": str(primary.get("storagePath") or "") if primary else None,
        "pdfMediaType": str(primary.get("mediaType") or "") if primary else None,
    }


def is_academic_paper_reference(
    reference: dict[str, Any],
    *,
    source_plugin: str | None = None,
) -> bool:
    plugin = str(source_plugin or "").strip().lower()
    if plugin in _NON_PDF_SOURCE_PLUGINS:
        return False
    if plugin in _ACADEMIC_SOURCE_PLUGINS:
        return True
    source_uri = str(reference.get("sourceUri") or "").lower()
    host = (urlparse(source_uri).netloc or "").lower()
    if any(token in host for token in ("arxiv.org", "doi.org", "acm.org", "aclweb.org", "ieee.org", "springer.com")):
        return True
    if re.search(r"\b10\.\d{4,9}/", source_uri):
        return True
    media_type = str(reference.get("mediaType") or "").lower()
    return media_type == "application/pdf"


def summarize_recorded_attachments(
    reference: dict[str, Any],
    attachments: list[dict[str, Any]],
) -> list[dict[str, str]]:
    lineage_id = str(reference.get("lineageId") or reference.get("referenceLineageId") or "")
    rows: list[dict[str, str]] = []
    for attachment in attachments:
        if str(attachment.get("referenceLineageId") or "") != lineage_id:
            continue
        rows.append(
            {
                "id": str(attachment.get("id") or ""),
                "role": str(attachment.get("role") or ""),
                "filename": str(attachment.get("filename") or ""),
                "mediaType": str(attachment.get("mediaType") or ""),
                "storagePath": str(attachment.get("storagePath") or ""),
            }
        )
    rows.sort(key=lambda row: (row.get("role") or "", row.get("id") or ""))
    return rows


def _process_items_by_reference_id(process_result: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    items = (process_result or {}).get("items")
    if not isinstance(items, list):
        return indexed
    for item in items:
        if not isinstance(item, dict):
            continue
        reference = item.get("reference") if isinstance(item.get("reference"), dict) else {}
        reference_id = str(reference.get("id") or "").strip()
        if reference_id:
            indexed[reference_id] = item
    return indexed


def _find_item_by_reference_id(find_result: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    items = (find_result or {}).get("items")
    if not isinstance(items, list):
        return indexed
    for item in items:
        if not isinstance(item, dict):
            continue
        reference = item.get("reference") if isinstance(item.get("reference"), dict) else {}
        reference_id = str(reference.get("id") or "").strip()
        if reference_id:
            indexed[reference_id] = item
    return indexed


def _stored_title_subtitle_summary(reference: dict[str, Any]) -> dict[str, str]:
    try:
        from papyrus_newsroom.reference_curation_signals import _load_reference_metadata_payload

        payload = _load_reference_metadata_payload(reference)
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return {
        "title": str(payload.get("title") or "").strip(),
        "subtitle": str(payload.get("subtitle") or "").strip(),
        "summary": str(payload.get("summary") or "").strip(),
    }


def build_reference_feedback_entries(
    *,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    find_result: dict[str, Any] | None = None,
    process_result: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    find_by_id = _find_item_by_reference_id(find_result)
    process_by_id = _process_items_by_reference_id(process_result)
    entries: list[dict[str, Any]] = []
    for reference in references:
        reference_id = str(reference.get("id") or "").strip()
        if not reference_id:
            continue
        source_plugin = extract_source_plugin_from_attachments(reference, attachments)
        process_item = process_by_id.get(reference_id) or {}
        find_item = find_by_id.get(reference_id) or {}
        generated_subtitle = str(process_item.get("subtitle") or "").strip()
        generated_summary = str(process_item.get("summary") or "").strip()
        generated_title = str(process_item.get("title") or "").strip()
        stored = _stored_title_subtitle_summary(reference) if not (generated_title and generated_subtitle and generated_summary) else {
            "title": "",
            "subtitle": "",
            "summary": "",
        }
        title = generated_title or stored["title"] or str(reference.get("title") or "").strip()
        subtitle = generated_subtitle or stored["subtitle"]
        summary = generated_summary or stored["summary"]
        find_status = str(find_item.get("status") or "").strip()
        summarize_status = str(process_item.get("status") or "").strip()
        has_extracted_text = select_extracted_text_attachment(reference, attachments) is not None
        pdf_info = pdf_status_for_reference(reference, attachments)
        academic = is_academic_paper_reference(reference, source_plugin=source_plugin)
        lineage_id = str(reference.get("lineageId") or reference.get("referenceLineageId") or "").strip()
        newsroom_url = build_newsroom_reference_public_url(lineage_id) if lineage_id else None
        entries.append(
            {
                "referenceId": reference_id,
                "referenceLineageId": lineage_id or None,
                "newsroomUrl": newsroom_url,
                "sourceUri": str(reference.get("sourceUri") or ""),
                "title": title,
                "subtitle": subtitle,
                "summary": summary,
                "sourcePlugin": source_plugin,
                "findStatus": find_status or ("found" if has_extracted_text else "not_run"),
                "summarizeStatus": summarize_status or ("generated" if generated_summary else "not_run"),
                "pdfConfirmationRequired": academic,
                "pdfLocated": pdf_info["pdfLocated"] if academic else None,
                "pdfAttachmentId": pdf_info["pdfAttachmentId"],
                "pdfFilename": pdf_info["pdfFilename"],
                "attachments": summarize_recorded_attachments(reference, attachments),
            }
        )
    return entries


def build_submission_feedback_report(
    *,
    message: dict[str, Any],
    metadata: dict[str, Any],
    processing_result: dict[str, Any] | None = None,
    processing_error: str | None = None,
    reference_entries: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    response_status = str(message.get("responseStatus") or metadata.get("responseStatus") or "").upper()
    result = processing_result if isinstance(processing_result, dict) else metadata.get("processingResult")
    if not isinstance(result, dict):
        result = {}
    find_summary = result.get("find") if isinstance(result.get("find"), dict) else {}
    process_summary = result.get("process") if isinstance(result.get("process"), dict) else {}
    citations = metadata.get("directCitations") if isinstance(metadata.get("directCitations"), list) else []
    return {
        "messageId": str(message.get("id") or ""),
        "subject": str(message.get("summary") or "Email submission"),
        "senderEmail": str(metadata.get("senderEmail") or message.get("authorLabel") or ""),
        "recipientEmail": str(metadata.get("recipientEmail") or ""),
        "responseStatus": response_status,
        "responseError": str(message.get("responseError") or metadata.get("responseError") or processing_error or ""),
        "authorized": metadata.get("authorized") is True,
        "directCitationCount": len(citations),
        "registeredReferenceCount": int(result.get("registeredReferenceCount") or 0),
        "pipeline": {
            "find": {
                "eligible": int(find_summary.get("eligible") or 0),
                "planned": int(find_summary.get("planned") or 0),
                "changes": int(find_summary.get("changes") or 0),
                "failures": int(find_summary.get("failures") or 0),
            },
            "process": {
                "attempted": int(process_summary.get("attempted") or 0),
                "generated": int(process_summary.get("generated") or 0),
            },
        },
        "references": reference_entries or [],
    }


def _feedback_email_subject(report: dict[str, Any]) -> tuple[str, str]:
    subject_line = str(report.get("subject") or "your submission")
    status = str(report.get("responseStatus") or "").upper()
    if status == "COMPLETED":
        subject = f"Re: {subject_line} — processed"
    elif status == "FAILED":
        subject = f"Re: {subject_line} — processing failed"
    elif status == "REJECTED":
        subject = f"Re: {subject_line} — not accepted"
    else:
        subject = f"Re: {subject_line} — update"
    return subject, status


def _status_label_html(status: str) -> str:
    normalized = status or "UNKNOWN"
    palette = {
        "COMPLETED": ("#0f5132", "#d1e7dd"),
        "FAILED": ("#842029", "#f8d7da"),
        "REJECTED": ("#664d03", "#fff3cd"),
        "IN_PROGRESS": ("#055160", "#cff4fc"),
    }
    fg, bg = palette.get(normalized, ("#41464b", "#e2e3e5"))
    return (
        f'<span style="display:inline-block;padding:4px 10px;border-radius:4px;'
        f'font-size:12px;font-weight:600;color:{fg};background:{bg};">{html.escape(normalized)}</span>'
    )


def _append_reference_feedback_plain(lines: list[str], entry: dict[str, Any], index: int) -> None:
    lines.append("")
    lines.append(f"{index}. {entry.get('title') or '(untitled)'}")
    newsroom_url = str(entry.get("newsroomUrl") or "").strip()
    if newsroom_url:
        lines.append(f"   View in Papyrus: {newsroom_url}")
    if entry.get("subtitle"):
        lines.append(f"   Subtitle: {entry.get('subtitle')}")
    if entry.get("summary"):
        lines.append(f"   Summary: {entry.get('summary')}")
    if entry.get("sourceUri"):
        lines.append(f"   Source: {entry.get('sourceUri')}")
    plugin = entry.get("sourcePlugin")
    if plugin:
        lines.append(f"   Fetch plugin: {plugin}")
    find_status = entry.get("findStatus")
    summarize_status = entry.get("summarizeStatus")
    if find_status:
        lines.append(f"   Find: {find_status}")
    if summarize_status:
        lines.append(f"   Summarize: {summarize_status}")
    if entry.get("pdfConfirmationRequired"):
        located = entry.get("pdfLocated")
        if located is True:
            pdf_name = entry.get("pdfFilename") or entry.get("pdfAttachmentId") or "source PDF"
            lines.append(f"   PDF: located ({pdf_name})")
        elif located is False:
            lines.append("   PDF: not located")
        else:
            lines.append("   PDF: unknown")
    attachments = entry.get("attachments") if isinstance(entry.get("attachments"), list) else []
    if attachments:
        lines.append("   Attachments recorded:")
        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            role = attachment.get("role") or "attachment"
            name = attachment.get("filename") or attachment.get("id") or "file"
            media_type = attachment.get("mediaType") or ""
            suffix = f" ({media_type})" if media_type else ""
            lines.append(f"     - {role}: {name}{suffix}")


def _reference_feedback_html_block(entry: dict[str, Any], index: int) -> str:
    title = html.escape(str(entry.get("title") or "(untitled)"))
    newsroom_url = str(entry.get("newsroomUrl") or "").strip()
    parts = [
        '<div style="margin:0 0 20px;padding:16px 18px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;">',
        f'<div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Reference {index}</div>',
        f'<h2 style="margin:8px 0 6px;font-size:18px;line-height:1.35;color:#111827;">{title}</h2>',
    ]
    if newsroom_url:
        escaped_url = html.escape(newsroom_url, quote=True)
        parts.append(
            '<p style="margin:0 0 12px;">'
            f'<a href="{escaped_url}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#ffffff;'
            'text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Open in Papyrus</a>'
            f'<span style="display:block;margin-top:8px;font-size:12px;color:#6b7280;word-break:break-all;">{html.escape(newsroom_url)}</span>'
            "</p>"
        )
    subtitle = str(entry.get("subtitle") or "").strip()
    if subtitle:
        parts.append(
            f'<p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong style="color:#111827;">Subtitle</strong> — {html.escape(subtitle)}</p>'
        )
    summary = str(entry.get("summary") or "").strip()
    if summary:
        parts.append(
            f'<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#374151;"><strong style="color:#111827;">Summary</strong> — {html.escape(summary)}</p>'
        )
    source_uri = str(entry.get("sourceUri") or "").strip()
    if source_uri:
        escaped_source = html.escape(source_uri, quote=True)
        parts.append(
            f'<p style="margin:0 0 8px;font-size:13px;color:#4b5563;"><strong>Source</strong> — '
            f'<a href="{escaped_source}" style="color:#1d4ed8;">{html.escape(source_uri)}</a></p>'
        )
    meta_rows: list[str] = []
    plugin = entry.get("sourcePlugin")
    if plugin:
        meta_rows.append(f"Fetch: {html.escape(str(plugin))}")
    find_status = entry.get("findStatus")
    if find_status:
        meta_rows.append(f"Find: {html.escape(str(find_status))}")
    summarize_status = entry.get("summarizeStatus")
    if summarize_status:
        meta_rows.append(f"Summarize: {html.escape(str(summarize_status))}")
    if entry.get("pdfConfirmationRequired"):
        located = entry.get("pdfLocated")
        if located is True:
            pdf_name = entry.get("pdfFilename") or entry.get("pdfAttachmentId") or "source PDF"
            meta_rows.append(f"PDF: located ({html.escape(str(pdf_name))})")
        elif located is False:
            meta_rows.append("PDF: not located")
        else:
            meta_rows.append("PDF: unknown")
    if meta_rows:
        parts.append(
            f'<p style="margin:0 0 8px;font-size:12px;color:#6b7280;">{" · ".join(meta_rows)}</p>'
        )
    attachments = entry.get("attachments") if isinstance(entry.get("attachments"), list) else []
    if attachments:
        attachment_items: list[str] = []
        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            role = html.escape(str(attachment.get("role") or "attachment"))
            name = html.escape(str(attachment.get("filename") or attachment.get("id") or "file"))
            media_type = str(attachment.get("mediaType") or "").strip()
            suffix = f" <span style=\"color:#9ca3af;\">({html.escape(media_type)})</span>" if media_type else ""
            attachment_items.append(f"<li>{role}: {name}{suffix}</li>")
        if attachment_items:
            parts.append(
                '<p style="margin:8px 0 4px;font-size:12px;font-weight:600;color:#374151;">Attachments</p>'
                f'<ul style="margin:0;padding-left:18px;font-size:12px;color:#4b5563;">{"".join(attachment_items)}</ul>'
            )
    parts.append("</div>")
    return "".join(parts)


def format_submission_feedback_email(report: dict[str, Any]) -> tuple[str, str, str]:
    subject, status = _feedback_email_subject(report)

    lines = [
        "Papyrus received your reference submission.",
        "",
        f"Message ID: {report.get('messageId') or '(unknown)'}",
        f"Status: {status or 'UNKNOWN'}",
    ]
    error = str(report.get("responseError") or "").strip()
    if error:
        lines.extend(["", f"Details: {error}"])

    pipeline = report.get("pipeline") if isinstance(report.get("pipeline"), dict) else {}
    find_summary = pipeline.get("find") if isinstance(pipeline.get("find"), dict) else {}
    process_summary = pipeline.get("process") if isinstance(pipeline.get("process"), dict) else {}
    if status in {"COMPLETED", "FAILED", "IN_PROGRESS"}:
        lines.extend(
            [
                "",
                "Pipeline:",
                (
                    f"- Find: {find_summary.get('changes', 0)} change(s) applied, "
                    f"{find_summary.get('failures', 0)} failure(s) "
                    f"({find_summary.get('eligible', 0)} eligible)"
                ),
                (
                    f"- Summarize: {process_summary.get('generated', 0)} generated of "
                    f"{process_summary.get('attempted', 0)} attempted"
                ),
                f"- References registered: {report.get('registeredReferenceCount', 0)}",
            ]
        )

    references = report.get("references") if isinstance(report.get("references"), list) else []
    reference_blocks_html: list[str] = []
    if references:
        lines.extend(["", "References:"])
        index = 0
        for entry in references:
            if not isinstance(entry, dict):
                continue
            index += 1
            _append_reference_feedback_plain(lines, entry, index)
            reference_blocks_html.append(_reference_feedback_html_block(entry, index))

    lines.extend(
        [
            "",
            "Reply to this message if something looks wrong.",
            "",
            "— Papyrus",
        ]
    )
    body_text = "\n".join(lines)

    message_id = html.escape(str(report.get("messageId") or "(unknown)"))
    error_html = ""
    if error:
        error_html = (
            f'<p style="margin:12px 0;padding:12px 14px;background:#fff3cd;border-left:4px solid #ffc107;'
            f'font-size:14px;line-height:1.45;color:#664d03;">{html.escape(error)}</p>'
        )
    pipeline_html = ""
    if status in {"COMPLETED", "FAILED", "IN_PROGRESS"}:
        pipeline_html = (
            '<table style="width:100%;margin:16px 0;border-collapse:collapse;font-size:14px;">'
            "<tbody>"
            f'<tr><td style="padding:6px 0;color:#6b7280;">Find changes</td><td style="padding:6px 0;text-align:right;font-weight:600;">{find_summary.get("changes", 0)}</td></tr>'
            f'<tr><td style="padding:6px 0;color:#6b7280;">Find failures</td><td style="padding:6px 0;text-align:right;font-weight:600;">{find_summary.get("failures", 0)}</td></tr>'
            f'<tr><td style="padding:6px 0;color:#6b7280;">Summaries generated</td><td style="padding:6px 0;text-align:right;font-weight:600;">{process_summary.get("generated", 0)} / {process_summary.get("attempted", 0)}</td></tr>'
            f'<tr><td style="padding:6px 0;color:#6b7280;">References registered</td><td style="padding:6px 0;text-align:right;font-weight:600;">{report.get("registeredReferenceCount", 0)}</td></tr>'
            "</tbody></table>"
        )
    references_html = "".join(reference_blocks_html)
    if references_html:
        references_html = f'<h3 style="margin:24px 0 12px;font-size:15px;color:#111827;">References</h3>{references_html}'

    body_html = (
        '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;">'
        '<div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:Georgia,\'Times New Roman\',serif;">'
        '<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:28px 32px;">'
        '<p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;">Papyrus</p>'
        '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827;">Your reference submission</h1>'
        f'<p style="margin:0 0 8px;font-size:14px;color:#4b5563;">Message <code style="font-size:12px;background:#f3f4f6;padding:2px 6px;border-radius:4px;">{message_id}</code></p>'
        f'<p style="margin:0 0 16px;">{_status_label_html(status)}</p>'
        f"{error_html}"
        f"{pipeline_html}"
        f"{references_html}"
        '<p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;">'
        "Reply to this message if something looks wrong."
        "</p>"
        "</div>"
        '<p style="margin:16px 0 0;text-align:center;font-size:12px;color:#9ca3af;">— Papyrus</p>'
        "</div></body></html>"
    )
    return subject, body_text, body_html


def send_submission_feedback_email(
    *,
    to_address: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    from_address: str | None = None,
    reply_to: str | None = None,
    ses_client: Any | None = None,
) -> dict[str, Any]:
    recipient = parseaddr(str(to_address or "").strip())[1]
    if not recipient:
        raise ValueError("Feedback email requires a recipient address.")

    sender = from_address or default_feedback_from_address()
    _, sender_email = parseaddr(sender)
    if not sender_email:
        raise ValueError("Feedback email requires a valid From address.")

    import boto3

    client = ses_client or boto3.client("ses")
    destination: dict[str, Any] = {"ToAddresses": [recipient]}
    body: dict[str, Any] = {"Text": {"Data": body_text, "Charset": "UTF-8"}}
    if body_html:
        body["Html"] = {"Data": body_html, "Charset": "UTF-8"}
    message = {
        "Subject": {"Data": subject, "Charset": "UTF-8"},
        "Body": body,
    }
    request: dict[str, Any] = {
        "Source": sender,
        "Destination": destination,
        "Message": message,
    }
    reply_target = str(reply_to or sender_email).strip()
    if reply_target:
        request["ReplyToAddresses"] = [reply_target]

    response = client.send_email(**request)
    return {
        "sent": True,
        "messageId": response.get("MessageId"),
        "to": recipient,
        "from": sender,
    }


def maybe_send_submission_feedback_email(
    client: Any,
    *,
    message_id: str,
    reference_entries: list[dict[str, Any]] | None = None,
    processing_result: dict[str, Any] | None = None,
    processing_error: str | None = None,
    ses_client: Any | None = None,
    force: bool = False,
) -> dict[str, Any]:
    from papyrus_content.newsroom_commands import now_iso
    from papyrus_newsroom.email_submissions import _message_metadata

    if not feedback_email_enabled():
        return {"sent": False, "skipped": True, "reason": "disabled"}

    message = client.get_record("Message", message_id) or {}
    if not message:
        return {"sent": False, "skipped": True, "reason": "message-not-found"}

    metadata = _message_metadata(message)
    if metadata.get("feedbackEmailSentAt") and not force:
        return {
            "sent": False,
            "skipped": True,
            "reason": "already-sent",
            "feedbackEmailMessageId": metadata.get("feedbackEmailMessageId"),
        }

    sender_email = str(metadata.get("senderEmail") or message.get("authorLabel") or "").strip()
    if not sender_email:
        return {"sent": False, "skipped": True, "reason": "missing-sender"}

    report = build_submission_feedback_report(
        message=message,
        metadata=metadata,
        processing_result=processing_result,
        processing_error=processing_error,
        reference_entries=reference_entries,
    )
    subject, body_text, body_html = format_submission_feedback_email(report)
    send_result = send_submission_feedback_email(
        to_address=sender_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        ses_client=ses_client,
    )

    metadata["feedbackEmailSentAt"] = now_iso()
    metadata["feedbackEmailMessageId"] = send_result.get("messageId")
    metadata["feedbackEmailTo"] = send_result.get("to")
    metadata["feedbackEmailFrom"] = send_result.get("from")
    metadata["feedbackReport"] = report
    client.graphql(
        """
        mutation UpdateEmailSubmissionFeedbackMetadata($input: UpdateMessageInput!) {
          updateMessage(input: $input) { id }
        }
        """,
        {
            "input": {
                "id": message_id,
                "metadata": json.dumps(metadata, sort_keys=True),
                "updatedAt": now_iso(),
            }
        },
    )
    return send_result


def send_feedback_only_for_message(
    client: Any,
    *,
    message_id: str,
    ses_client: Any | None = None,
) -> dict[str, Any]:
    """Send acknowledgment for an existing message without re-running processing."""
    from papyrus_newsroom.email_submissions import (
        _load_registered_reference_processing_records,
        _message_metadata,
    )

    message = client.get_record("Message", message_id) or {}
    metadata = _message_metadata(message)
    processing_result = metadata.get("processingResult") if isinstance(metadata.get("processingResult"), dict) else None
    reference_entries: list[dict[str, Any]] = []
    existing_report = metadata.get("feedbackReport")
    if isinstance(existing_report, dict) and isinstance(existing_report.get("references"), list):
        reference_entries = [row for row in existing_report["references"] if isinstance(row, dict)]
    if not reference_entries and isinstance(processing_result, dict):
        stored_feedback = processing_result.get("referenceFeedback")
        if isinstance(stored_feedback, list):
            reference_entries = [row for row in stored_feedback if isinstance(row, dict)]
    if not reference_entries and isinstance(processing_result, dict):
        import_run_id = str(processing_result.get("importRunId") or "").strip() or None
        registered_reference_ids = {
            str(row).strip()
            for row in (processing_result.get("registeredReferenceIds") or [])
            if str(row).strip()
        }
        if registered_reference_ids:
            references, attachments, _relations = _load_registered_reference_processing_records(
                client,
                registered_reference_ids=registered_reference_ids,
                import_run_id=import_run_id,
            )
            if references:
                reference_entries = build_reference_feedback_entries(
                    references=references,
                    attachments=attachments,
                )
    return maybe_send_submission_feedback_email(
        client,
        message_id=message_id,
        reference_entries=reference_entries or None,
        processing_result=processing_result,
        ses_client=ses_client,
    )
