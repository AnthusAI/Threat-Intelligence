"""Shared console chat enqueue helpers for multi-channel agents (web, email, Slack)."""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

CONSOLE_MESSAGE_KIND = "console_chat_turn"
CONSOLE_MESSAGE_DOMAIN = "conversation"
CONSOLE_NEWSROOM_FEED_KEY = "consoleChat"
CONSOLE_THREAD_ANCHOR_KEY = "site#papyrus"


def default_response_target() -> str:
    return str(os.environ.get("PAPYRUS_CONSOLE_RESPONSE_TARGET") or "cloud").strip() or "cloud"


def enqueue_console_chat_turn(
    client: Any,
    *,
    thread_id: str,
    thread_title: str,
    thread_summary: str,
    primary_anchor_kind: str,
    primary_anchor_id: str,
    created_by_label: str,
    prompt: str,
    message_summary: str,
    source: str,
    channel: str,
    channel_metadata: dict[str, Any],
    thread_metadata: dict[str, Any] | None = None,
    response_target: str | None = None,
    capture_model_context: bool = False,
    chat_message_id: str | None = None,
) -> dict[str, Any]:
    """Create or extend a console thread and enqueue a USER console_chat_turn for the responder."""
    from papyrus_content.newsroom_commands import now_iso

    now = now_iso()
    target = (response_target or default_response_target()).strip() or "cloud"
    thread_meta = {"channel": channel, **(thread_metadata or {})}
    message_meta: dict[str, Any] = {"channel": channel, **channel_metadata}
    if capture_model_context:
        message_meta["captureModelContext"] = True

    thread_input = {
        "id": thread_id,
        "threadKind": "console",
        "status": "active",
        "title": thread_title,
        "summary": thread_summary,
        "primaryAnchorKind": primary_anchor_kind,
        "primaryAnchorId": primary_anchor_id,
        "primaryAnchorLineageId": primary_anchor_id,
        "primaryAnchorKey": CONSOLE_THREAD_ANCHOR_KEY,
        "createdByLabel": created_by_label,
        "messageCount": 0,
        "metadata": json.dumps(thread_meta, sort_keys=True),
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": CONSOLE_NEWSROOM_FEED_KEY,
    }
    existing_thread = client.get_record("MessageThread", thread_id)
    if not existing_thread:
        client.graphql(
            """
            mutation CreateConsoleAgentThread($input: CreateMessageThreadInput!) {
              createMessageThread(input: $input) { id }
            }
            """,
            {"input": thread_input},
        )

    sequence_number = int(existing_thread.get("messageCount") or 0) + 1 if existing_thread else 1
    resolved_message_id = chat_message_id or f"message-console-{channel}-{uuid.uuid4().hex[:20]}"
    message_input = {
        "id": resolved_message_id,
        "threadId": thread_id,
        "parentMessageId": None,
        "sequenceNumber": sequence_number,
        "role": "USER",
        "messageKind": CONSOLE_MESSAGE_KIND,
        "messageDomain": CONSOLE_MESSAGE_DOMAIN,
        "messageType": "MESSAGE",
        "content": prompt.strip(),
        "status": "active",
        "summary": message_summary[:180],
        "source": source,
        "authorLabel": created_by_label,
        "semanticLayer": "working_memory",
        "searchVisibility": "private",
        "responseTarget": target,
        "responseStatus": "PENDING",
        "metadata": json.dumps(message_meta, sort_keys=True),
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": CONSOLE_NEWSROOM_FEED_KEY,
    }
    client.graphql(
        """
        mutation CreateConsoleAgentTurn($input: CreateMessageInput!) {
          createMessage(input: $input) { id }
        }
        """,
        {"input": message_input},
    )
    return {
        "queued": True,
        "threadId": thread_id,
        "chatMessageId": resolved_message_id,
        "responseTarget": target,
    }
