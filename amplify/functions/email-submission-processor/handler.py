from __future__ import annotations

import json
import os
from typing import Any


def _authoring_token() -> str:
    explicit = str(os.environ.get("PAPYRUS_GRAPHQL_JWT") or "").strip()
    if explicit:
        return explicit
    from papyrus_content.auth_commands import _mint_jwt, _resolve_secret

    secret = _resolve_secret({})
    return _mint_jwt(
        secret=secret,
        issuer=os.environ.get("PAPYRUS_JWT_ISSUER", "papyrus-cli"),
        subject=os.environ.get("PAPYRUS_INBOUND_EMAIL_ACTOR_SUB", "papyrus-inbound-email"),
        audience=os.environ.get("PAPYRUS_JWT_AUDIENCE", "papyrus-authoring"),
        scope=os.environ.get("PAPYRUS_JWT_REQUIRED_SCOPE", "papyrus:write"),
        groups=["editor", "admin"],
        ttl_seconds=int(os.environ.get("PAPYRUS_JWT_TTL_SECONDS", "3600")),
    )


def handler(event: dict[str, Any], _context: Any = None) -> dict[str, Any]:
    if isinstance(event.get("Records"), list):
        record = event["Records"][0]
        body = record.get("body") if isinstance(record, dict) else None
        if isinstance(body, str):
            event = json.loads(body)
        elif isinstance(body, dict):
            event = body

    message_id = str(event.get("messageId") or event.get("message_id") or "").strip()
    if not message_id:
        raise ValueError("messageId is required.")

    corpus_key = str(
        event.get("corpusKey")
        or event.get("corpus_key")
        or os.environ.get("PAPYRUS_INBOUND_EMAIL_CORPUS_KEY")
        or "AI-ML-research"
    ).strip()

    from papyrus_content.graphql_authoring import PapyrusGraphQLAuthoringClient
    from papyrus_newsroom.email_submissions import process_email_submission_message

    endpoint = os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT", "").strip()
    client = PapyrusGraphQLAuthoringClient(endpoint=endpoint or None, auth_token=_authoring_token())
    return process_email_submission_message(
        client,
        message_id=message_id,
        corpus_key=corpus_key,
        apply=True,
    )
