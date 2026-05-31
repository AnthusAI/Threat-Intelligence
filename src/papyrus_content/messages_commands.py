from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .graphql_authoring import create_authoring_client
from .ids import hash_short
from .message_contract import build_canonical_message_expected
from .model_attachments import parse_jsonish, semantic_version_key
from .options import parse_options
from .records import apply_record_changes, build_record_changes
from .relation_types import semantic_relation_type_fields_for_predicate
from .relations_commands import print_category_import_summary, write_json_file

LIST_LEGACY_KNOWLEDGE_COMMENTS_QUERY = """
query ListLegacyKnowledgeComments($limit: Int, $nextToken: String) {
  listKnowledgeComments(limit: $limit, nextToken: $nextToken) {
    items {
      id subjectKind subjectId subjectLineageId subjectVersionNumber subjectVersionKey subjectStateKey
      commentKind body status source importRunId authorSub authorUserProfileId authorLabel metadata createdAt
    }
    nextToken
  }
}
"""


def messages_export_legacy_comments(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("output"):
        raise ValueError("messages export-legacy-comments requires --output.")
    client, _ = create_authoring_client()
    comments: list[dict[str, Any]] = []
    next_token = None
    while True:
        result = client.graphql(LIST_LEGACY_KNOWLEDGE_COMMENTS_QUERY, {"limit": 100, "nextToken": next_token})
        page = result.get("listKnowledgeComments") or {}
        comments.extend(entry for entry in page.get("items") or [] if entry)
        next_token = page.get("nextToken")
        if not next_token:
            break
    write_json_file(
        options["output"],
        {
            "schemaVersion": 1,
            "exportKind": "legacy-knowledge-comments",
            "generatedAt": _utc_now(),
            "comments": comments,
        },
    )
    print(f"messages\texport-legacy-comments\t{len(comments)}\t{options['output']}")


def messages_import_legacy_comments(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("input"):
        raise ValueError("messages import-legacy-comments requires --input.")
    payload = load_json_file(options["input"])
    comments = payload.get("comments") if isinstance(payload.get("comments"), list) else payload.get("items")
    if not isinstance(comments, list):
        comments = []
    records: list[dict[str, Any]] = []
    for comment in comments:
        records.extend(legacy_knowledge_comment_records(comment))
    client, _ = create_authoring_client()
    changes = build_record_changes(client, records)
    apply_record_changes(client, changes)
    print_category_import_summary("legacy-messages", Path(options["input"]).name, changes)


def legacy_knowledge_comment_records(comment: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not comment or not isinstance(comment, dict):
        return []
    created_at = comment.get("createdAt") or _utc_now()
    message_kind = comment.get("commentKind") or "comment"
    message_id = f"message-legacy-{hash_short([comment.get('id'), message_kind, created_at])}"
    body = comment.get("body") or ""
    metadata = parse_jsonish(comment.get("metadata"))
    message = build_canonical_message_expected(
        {
            "id": message_id,
            "messageKind": message_kind,
            "messageDomain": "commentary",
            "status": comment.get("status") or "active",
            "body": body,
            "summary": body if len(body) <= 140 else f"{body[:137]}...",
            "source": comment.get("source") or "legacy-knowledge-comment",
            "importRunId": comment.get("importRunId"),
            "authorSub": comment.get("authorSub"),
            "authorUserProfileId": comment.get("authorUserProfileId"),
            "authorLabel": comment.get("authorLabel"),
            "createdAt": created_at,
            "updatedAt": created_at,
            "metadata": {
                "legacyModel": "KnowledgeComment",
                "legacyId": comment.get("id"),
                **(metadata if isinstance(metadata, dict) else {}),
            },
            "responseTarget": "none",
            "responseStatus": "COMPLETED",
            "responseOwner": "legacy-import",
        },
        default_source="legacy-knowledge-comment",
        default_author_label="legacy-knowledge-comment",
        default_response_owner="legacy-import",
    )
    target_kind = comment.get("subjectKind")
    target_id = comment.get("subjectId")
    target_lineage_id = comment.get("subjectLineageId")
    if not target_kind or not target_id or not target_lineage_id:
        return [{"modelName": "Message", "expected": message}]
    relation_type = semantic_relation_type_fields_for_predicate("comment")
    subject_version_key = semantic_version_key("message", message_id)
    object_version_key = semantic_version_key(str(target_kind), str(target_id))
    object_state_key = semantic_state_key(str(target_kind), str(target_lineage_id))
    return [
        {"modelName": "Message", "expected": message},
        {
            "modelName": "SemanticRelation",
            "expected": {
                "id": f"semantic-relation-{hash_short([subject_version_key, 'comment', object_version_key, comment.get('id')])}",
                "relationState": "current",
                "predicate": "comment",
                **relation_type,
                "subjectKind": "message",
                "subjectId": message_id,
                "subjectLineageId": message_id,
                "subjectVersionNumber": 1,
                "objectKind": target_kind,
                "objectId": target_id,
                "objectLineageId": target_lineage_id,
                "objectVersionNumber": comment.get("subjectVersionNumber"),
                "subjectStateKey": semantic_state_key("message", message_id),
                "objectStateKey": object_state_key,
                "objectSubjectStateKey": f"{object_state_key}#message",
                "predicateObjectStateKey": f"comment#{object_state_key}",
                "subjectVersionKey": subject_version_key,
                "objectVersionKey": object_version_key,
                "score": 1,
                "confidence": None,
                "rank": 1,
                "classifierId": None,
                "modelVersion": None,
                "reviewRecommended": False,
                "sourceSnapshotId": None,
                "importRunId": comment.get("importRunId"),
                "importedAt": created_at,
                "metadata": json.dumps(
                    {
                        "legacyModel": "KnowledgeComment",
                        "legacyId": comment.get("id"),
                        "messageKind": message_kind,
                    }
                ),
            },
        },
    ]


def semantic_state_key(kind: str, lineage_id: str) -> str:
    return f"{kind}#{lineage_id}#current"


def load_json_file(path: str | Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return payload


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
