from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _dynamodb_string(value: dict[str, Any] | None) -> str:
    if not isinstance(value, dict):
        return ""
    if "S" in value:
        return str(value["S"] or "")
    return ""


def _image_to_message(image: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(image, dict):
        return None
    message_id = _dynamodb_string(image.get("id"))
    if not message_id:
        return None
    metadata_raw = _dynamodb_string(image.get("metadata"))
    metadata: dict[str, Any] = {}
    if metadata_raw.strip():
        try:
            parsed = json.loads(metadata_raw)
            if isinstance(parsed, dict):
                metadata = parsed
        except json.JSONDecodeError:
            metadata = {}
    return {
        "id": message_id,
        "threadId": _dynamodb_string(image.get("threadId")),
        "role": _dynamodb_string(image.get("role")),
        "messageKind": _dynamodb_string(image.get("messageKind")),
        "responseStatus": _dynamodb_string(image.get("responseStatus")),
        "content": _dynamodb_string(image.get("content")),
        "summary": _dynamodb_string(image.get("summary")),
        "metadata": metadata,
    }


def handler(event: dict[str, Any], _context: Any = None) -> dict[str, Any]:
    from papyrus_content.graphql_authoring import PapyrusGraphQLAuthoringClient
    from papyrus_newsroom.slack_agent import deliver_slack_reply_for_assistant_message

    endpoint = os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT", "").strip()
    client = PapyrusGraphQLAuthoringClient(endpoint=endpoint or None)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []

    for record in event.get("Records") or []:
        if not isinstance(record, dict):
            continue
        event_name = str(record.get("eventName") or "")
        if event_name not in {"INSERT", "MODIFY"}:
            continue
        dynamodb = record.get("dynamodb")
        if not isinstance(dynamodb, dict):
            continue
        image = dynamodb.get("NewImage")
        if not isinstance(image, dict):
            continue
        message = _image_to_message(image)
        if not message:
            continue
        if str(message.get("messageKind") or "") != "console_chat_turn":
            continue
        if str(message.get("role") or "").upper() != "ASSISTANT":
            continue
        if str(message.get("responseStatus") or "").upper() != "COMPLETED":
            continue
        sequence = str(record.get("eventID") or message.get("id") or "")
        try:
            outcome = deliver_slack_reply_for_assistant_message(client, assistant_message=message)
            logger.info(
                "slack-delivery message=%s outcome=%s",
                message.get("id"),
                outcome,
            )
            results.append({"eventId": sequence, **outcome})
        except Exception as error:  # noqa: BLE001
            logger.exception(
                "slack-delivery failed message=%s",
                message.get("id"),
            )
            failures.append({"itemIdentifier": sequence, "error": str(error)})

    if failures:
        return {"batchItemFailures": failures}
    return {"ok": True, "results": results}
