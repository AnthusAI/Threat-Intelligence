from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from typing import Any

from .graphql_authoring import PapyrusGraphQLAuthoringClient, strip_unsupported_payload_fields
from .ids import safe_id


def model_payload_storage_path(owner_kind: str, owner_id: str, role: str, filename: str) -> str:
    return f"newsroom/payloads/{safe_id(owner_kind)}/{safe_id(owner_id)}/{safe_id(role)}/{filename}"


def model_attachment_id(owner_kind: str, owner_id: str, role: str, sort_key: str) -> str:
    return f"model-attachment-{safe_id(owner_kind)}-{safe_id(owner_id)}-{safe_id(role)}-{safe_id(sort_key)}"


def build_text_model_payload_attachment(input_payload: dict[str, Any]) -> dict[str, Any]:
    content = str(input_payload.get("content") or "")
    filename = input_payload.get("filename") or f"{safe_id(input_payload.get('sortKey') or input_payload.get('role'))}.txt"
    media_type = input_payload.get("mediaType") or "text/plain"
    return build_model_payload_attachment(
        {
            **input_payload,
            "filename": filename,
            "mediaType": media_type,
            "content": content,
        }
    )


def build_json_model_payload_attachment(input_payload: dict[str, Any]) -> dict[str, Any]:
    content = input_payload.get("content") or {}
    return build_text_model_payload_attachment(
        {
            **input_payload,
            "filename": input_payload.get("filename") or "metadata.json",
            "mediaType": "application/json",
            "content": f"{json.dumps(content, indent=2, sort_keys=True)}\n",
        }
    )


def build_model_payload_attachment(input_payload: dict[str, Any]) -> dict[str, Any]:
    content = input_payload.get("content")
    if isinstance(content, str):
        body = content.encode("utf-8")
    elif isinstance(content, (bytes, bytearray)):
        body = bytes(content)
    else:
        body = json.dumps(content, sort_keys=True, separators=(",", ":")).encode("utf-8")
    owner_kind = input_payload["ownerKind"]
    owner_id = input_payload["ownerId"]
    role = input_payload["role"]
    sort_key = input_payload.get("sortKey") or role
    filename = input_payload["filename"]
    now = input_payload.get("now")
    attachment = {
        "id": model_attachment_id(owner_kind, owner_id, role, sort_key),
        "ownerKind": owner_kind,
        "ownerId": owner_id,
        "ownerLineageId": input_payload.get("ownerLineageId") or owner_id,
        "ownerVersionNumber": input_payload.get("ownerVersionNumber"),
        "ownerVersionKey": input_payload.get("ownerVersionKey"),
        "role": role,
        "sortKey": sort_key,
        "storagePath": model_payload_storage_path(owner_kind, owner_id, role, filename),
        "filename": filename,
        "mediaType": input_payload.get("mediaType") or "application/octet-stream",
        "byteSize": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "etag": None,
        "importRunId": input_payload.get("importRunId"),
        "createdAt": now,
        "updatedAt": now,
        "status": input_payload.get("status") or "ready",
    }
    return {"attachment": attachment, "body": body}


def attachment_record(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "modelName": "ModelAttachment",
        "expected": entry["attachment"],
        "attachmentBody": entry["body"],
    }


def upload_attachment_body(
    client: PapyrusGraphQLAuthoringClient,
    attachment: dict[str, Any],
    body: bytes | str,
) -> dict[str, Any]:
    buffer = body if isinstance(body, (bytes, bytearray)) else str(body).encode("utf-8")
    slot = client.create_model_attachment_upload(attachment)
    headers = {str(key): str(value) for key, value in (slot.get("requiredHeaders") or {}).items()}
    request = urllib.request.Request(
        slot["uploadUrl"],
        data=buffer,
        headers=headers,
        method=slot.get("method") or "PUT",
    )
    try:
        with urllib.request.urlopen(request) as response:
            if response.status >= 400:
                raise RuntimeError(f"Upload failed with status {response.status}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Failed to upload ModelAttachment {attachment['id']} to {slot.get('storagePath')}: "
            f"{error.code} {error.reason} {detail[:240]}"
        ) from error
    return client.complete_model_attachment_upload(slot["uploadId"], attachment)


def expand_private_payload_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    expanded: list[dict[str, Any]] = []
    for record in records:
        expected = dict(record.get("expected") or {})
        now = expected.get("updatedAt") or expected.get("createdAt")
        if record["modelName"] == "Message":
            if "body" in expected:
                body = str(expected.pop("body"))
                expanded.append(
                    attachment_record(
                        build_text_model_payload_attachment(
                            {
                                "ownerKind": "message",
                                "ownerId": expected["id"],
                                "ownerLineageId": expected["id"],
                                "role": "message_body",
                                "sortKey": "message",
                                "filename": "message.json" if body.strip().startswith("{") else "message.txt",
                                "mediaType": "application/json" if body.strip().startswith("{") else "text/plain",
                                "content": body,
                                "importRunId": expected.get("importRunId"),
                                "now": now,
                            }
                        )
                    )
                )
            if "metadata" in expected:
                metadata = parse_jsonish(expected.pop("metadata"))
                expanded.append(
                    attachment_record(
                        build_json_model_payload_attachment(
                            {
                                "ownerKind": "message",
                                "ownerId": expected["id"],
                                "ownerLineageId": expected["id"],
                                "role": "metadata",
                                "sortKey": "metadata",
                                "content": metadata,
                                "importRunId": expected.get("importRunId"),
                                "now": now,
                            }
                        )
                    )
                )
        elif record["modelName"] == "Reference" and "metadata" in expected:
            metadata = parse_jsonish(expected.pop("metadata"))
            expanded.append(
                attachment_record(
                    build_json_model_payload_attachment(
                        {
                            "ownerKind": "reference",
                            "ownerId": expected["id"],
                            "ownerLineageId": expected.get("lineageId") or expected["id"],
                            "ownerVersionNumber": expected.get("versionNumber"),
                            "ownerVersionKey": semantic_version_key("reference", expected["id"]),
                            "role": "metadata",
                            "sortKey": "metadata",
                            "content": metadata,
                            "importRunId": expected.get("importRunId"),
                            "now": now,
                        }
                    )
                )
            )
        elif record["modelName"] == "KnowledgeRawPayload" and "payload" in expected:
            payload = parse_jsonish(expected.pop("payload"))
            expanded.append(
                attachment_record(
                    build_json_model_payload_attachment(
                        {
                            "ownerKind": "knowledgeRawPayload",
                            "ownerId": expected["id"],
                            "ownerLineageId": expected["id"],
                            "role": "raw_payload",
                            "sortKey": expected.get("payloadKind") or "payload",
                            "filename": f"{safe_id(expected.get('payloadKind') or 'payload')}.json",
                            "content": payload,
                            "importRunId": expected.get("importRunId"),
                            "now": now,
                        }
                    )
                )
            )
        expanded.append({**record, "expected": expected})
    return expanded


def parse_jsonish(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def semantic_version_key(kind: str, version_id: str) -> str:
    return f"{kind}#{version_id}"
