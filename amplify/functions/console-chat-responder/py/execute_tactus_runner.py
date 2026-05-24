#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
import uuid
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SEARCH_PATHS = [
    Path("/opt/papyrus/src"),
    Path.cwd() / "src",
]
for root in SEARCH_PATHS:
    if root.exists() and str(root) not in sys.path:
        sys.path.insert(0, str(root))

FALLBACK_DOCS: dict[str, dict[str, str]] = {
    "mcp.execute-tactus-overview": {
        "id": "mcp.execute-tactus-overview",
        "title": "Execute Tactus Overview",
        "summary": "How to run Tactus snippets and use progressive docs with docs_list/docs_get.",
        "namespace": "mcp",
        "content": (
            "Use execute_tactus for Papyrus runtime actions. The canonical write API is resource-oriented.\n"
            "Example:\n"
            "return Assignment.create{ type = \"research\", title = \"Research recent AI newsroom reliability metrics\", apply = true }\n"
            "Start with docs_list{ namespace = \"resources\" } to discover resource docs, then call "
            "docs_get{ id = \"resources.Assignment\" } for focused detail before non-trivial writes."
        ),
    },
    "resources.Assignment": {
        "id": "resources.Assignment",
        "title": "Assignment Resource",
        "summary": "Create, read, and list first-class private newsroom Assignment records.",
        "namespace": "resources",
        "content": (
            "Use Assignment.create{ type = \"research\", title = ..., apply = ... } for research work records. "
            "Required: type, title. Supported type: research. Optional: summary, sectionKey, instructions, "
            "corpusKey, researchMode, priority, status, importRunId, actorLabel, apply. apply = false returns "
            "a dry-run plan; apply = true writes one Assignment and one AssignmentEvent."
        ),
    },
    "newsroom.coverage-themes-run": {
        "id": "newsroom.coverage-themes-run",
        "title": "Coverage Themes Run",
        "summary": "Run section-aware coverage themes through planning, research, and reporting.",
        "namespace": "newsroom",
        "content": "Covers planning and story-cycle execution for coverage themes.",
    },
    "newsroom.assignment-packets": {
        "id": "newsroom.assignment-packets",
        "title": "Assignment Packets",
        "summary": "How assignment packets are produced and inspected in Newsroom workflows.",
        "namespace": "newsroom",
        "content": "Assignment packets are private Message work products linked to Assignments.",
    },
}


def _safe_doc_entries() -> list[dict[str, str]]:
    try:
        from papyrus_newsroom.tactus_runtime import DOCS  # type: ignore

        entries: list[dict[str, str]] = []
        for doc in DOCS.values():
            entries.append(
                {
                    "id": str(doc.get("id") or ""),
                    "title": str(doc.get("title") or ""),
                    "summary": str(doc.get("summary") or ""),
                    "namespace": str(doc.get("namespace") or ""),
                }
            )
        entries.sort(key=lambda entry: entry["id"])
        return entries
    except Exception:
        return [
            {
                "id": doc["id"],
                "title": doc["title"],
                "summary": doc["summary"],
                "namespace": doc["namespace"],
            }
            for doc in sorted(FALLBACK_DOCS.values(), key=lambda entry: entry["id"])
        ]


def _docs_get(doc_id: str) -> dict[str, Any]:
    try:
        from papyrus_newsroom.tactus_runtime import DOCS  # type: ignore

        doc = DOCS.get(doc_id)
        if not doc:
            return {
                "ok": False,
                "error": {
                    "code": "doc_not_found",
                    "message": f"Unknown documentation id: {doc_id}",
                    "retryable": False,
                },
            }
        return {
            "ok": True,
            "value": {
                "id": doc.get("id"),
                "metadata": {k: v for k, v in doc.items() if k != "content"},
                "content": doc.get("content") or "",
            },
            "error": None,
            "partial": False,
            "api_calls": ["papyrus.docs.get"],
            "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 1},
        }
    except Exception as exc:
        fallback = FALLBACK_DOCS.get(doc_id)
        if fallback:
            return {
                "ok": True,
                "value": {
                    "id": fallback["id"],
                    "metadata": {
                        "id": fallback["id"],
                        "title": fallback["title"],
                        "summary": fallback["summary"],
                        "namespace": fallback["namespace"],
                    },
                    "content": fallback["content"],
                },
                "error": None,
                "partial": False,
                "api_calls": ["papyrus.docs.get"],
                "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 1},
            }
        return {
            "ok": False,
            "error": {
                "code": "docs_get_failed",
                "message": str(exc),
                "retryable": False,
            },
            "partial": False,
            "api_calls": [],
            "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 0},
        }


def _api_schema() -> dict[str, Any]:
    try:
        from papyrus_newsroom.tactus_runtime import RESOURCE_API_SCHEMA  # type: ignore

        return RESOURCE_API_SCHEMA
    except Exception:
        return {
            "resources": {
                "Assignment": {
                    "verbs": ["create", "get", "list"],
                    "description": "Private newsroom work records.",
                    "create": {
                        "supportedTypes": ["research"],
                        "required": ["type", "title"],
                        "optional": [
                            "summary",
                            "sectionKey",
                            "instructions",
                            "corpusKey",
                            "researchMode",
                            "priority",
                            "status",
                            "importRunId",
                            "actorLabel",
                            "apply",
                        ],
                        "writes": ["Assignment", "AssignmentEvent"],
                        "applyDefault": False,
                    },
                    "get": {"required": ["id"]},
                    "list": {"optional": ["limit", "status", "type", "sectionKey", "importRunId"]},
                },
                "AssignmentEvent": {"verbs": ["get", "list"]},
                "Message": {"verbs": ["get", "list"]},
                "Reference": {"verbs": ["get", "list"]},
                "Item": {"verbs": ["get", "list"]},
                "Edition": {"verbs": ["get", "list"]},
                "NewsroomSection": {"verbs": ["get", "list"]},
            },
            "docs": {"verbs": ["list", "get"], "namespaces": ["mcp", "resources", "newsroom"]},
        }


def _parse_lua_table_fields(text: str) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for key, raw in re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\"(?:\\.|[^\"])*\"|'(?:\\.|[^'])*'|true|false|-?\d+)", text):
        if raw in {"true", "false"}:
            fields[key] = raw == "true"
        elif re.fullmatch(r"-?\d+", raw):
            fields[key] = int(raw)
        else:
            try:
                fields[key] = json.loads(raw if raw.startswith('"') else json.dumps(raw[1:-1]))
            except Exception:
                fields[key] = raw.strip("\"'")
    return fields


def _assignment_create_fallback(fields: dict[str, Any]) -> dict[str, Any]:
    try:
        value = _create_assignment_resource(fields)
        return {
            "ok": bool(value.get("ok", True)),
            "value": value,
            "error": value.get("error"),
            "partial": False,
            "api_calls": ["papyrus.Assignment.create"],
            "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 1},
        }
    except Exception as exc:
        return {
            "ok": False,
            "value": None,
            "error": {
                "code": "assignment_create_failed",
                "message": str(exc),
                "retryable": False,
            },
            "partial": False,
            "api_calls": ["papyrus.Assignment.create"],
            "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 1},
        }


CREATE_ASSIGNMENT_MUTATION = """
mutation CreateAssignment($input: CreateAssignmentInput!) {
  createAssignment(input: $input) {
    id
    assignmentTypeKey
    queueKey
    queueStatusKey
    status
    priority
    title
    summary
    corpusId
    sectionKey
    sectionType
    sectionStatusKey
    sectionQueueStatusKey
    importRunId
    createdBy
    createdAt
    updatedAt
  }
}
"""

CREATE_ASSIGNMENT_EVENT_MUTATION = """
mutation CreateAssignmentEvent($input: CreateAssignmentEventInput!) {
  createAssignmentEvent(input: $input) {
    id
    assignmentId
    assignmentTypeKey
    queueKey
    eventType
    toStatus
    actorSub
    actorLabel
    note
    createdAt
  }
}
"""


def _create_assignment_resource(fields: dict[str, Any]) -> dict[str, Any]:
    assignment_type = str(fields.get("type") or "").strip()
    title = str(fields.get("title") or "").strip()
    if assignment_type != "research":
        raise ValueError('Assignment.create currently supports type = "research" only')
    if not title:
        raise ValueError("Assignment.create requires title")

    plan = _build_assignment_create_plan(fields, title)
    result: dict[str, Any] = {
        "ok": True,
        "resource": "Assignment",
        "verb": "create",
        "applied": False,
        "assignmentId": plan["assignment"]["id"],
        "assignment": plan["assignment"],
        "event": plan["event"],
        "changes": [
            {"model": "Assignment", "operation": "create", "id": plan["assignment"]["id"]},
            {"model": "AssignmentEvent", "operation": "create", "id": plan["event"]["id"]},
        ],
        "api_calls": ["papyrus.Assignment.create"],
        "error": None,
    }
    if not bool(fields.get("apply") or False):
        return result

    assignment = _graphql(CREATE_ASSIGNMENT_MUTATION, {"input": plan["assignment"]}).get("createAssignment") or plan["assignment"]
    event = _graphql(CREATE_ASSIGNMENT_EVENT_MUTATION, {"input": plan["event"]}).get("createAssignmentEvent") or plan["event"]
    result["applied"] = True
    result["assignment"] = assignment
    result["event"] = event
    return result


def _build_assignment_create_plan(fields: dict[str, Any], title: str) -> dict[str, dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    section_key = str(fields.get("sectionKey") or fields.get("section_key") or "").strip()
    corpus_key = str(fields.get("corpusKey") or fields.get("corpus_key") or "AI-ML-research").strip()
    research_mode = str(fields.get("researchMode") or fields.get("research_mode") or "source_discovery").strip()
    status = str(fields.get("status") or "open").strip()
    priority = int(fields.get("priority") or 50)
    actor_label = str(fields.get("actorLabel") or fields.get("actor_label") or "papyrus-console-agent").strip()
    import_run_id = str(fields.get("importRunId") or fields.get("import_run_id") or "").strip()
    summary = str(fields.get("summary") or "").strip() or title
    instructions = str(fields.get("instructions") or "").strip()
    assignment_type_key = "research.edition-candidate"
    queue_key = str(fields.get("queueKey") or fields.get("queue_key") or f"research:{section_key or 'unsectioned'}:exploratory").strip()
    assignment_id = str(fields.get("id") or "").strip() or f"assignment-research-{_safe_id(title)}-{uuid.uuid4().hex[:12]}"

    assignment: dict[str, Any] = {
        "id": assignment_id,
        "assignmentTypeKey": assignment_type_key,
        "queueKey": queue_key,
        "queueStatusKey": f"{queue_key}#{status}",
        "status": status,
        "priority": priority,
        "title": title,
        "summary": summary,
        "corpusId": f"knowledge-corpus-{_safe_id(corpus_key)}",
        "createdBy": actor_label,
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": f"assignment#{status}",
    }
    if import_run_id:
        assignment["importRunId"] = import_run_id
    if section_key:
        assignment["sectionKey"] = section_key
        assignment["sectionType"] = "newsroom_section"
        assignment["sectionStatusKey"] = f"{section_key}#{status}"
        assignment["sectionQueueStatusKey"] = f"{section_key}#{queue_key}#{status}"

    note = [f"Created research assignment: {title}"]
    if research_mode:
        note.append(f"Research mode: {research_mode}")
    if instructions:
        note.append(f"Instructions: {instructions}")
    event = {
        "id": f"assignment-event-{assignment_id}-created",
        "assignmentId": assignment_id,
        "assignmentTypeKey": assignment_type_key,
        "queueKey": queue_key,
        "eventType": "created",
        "toStatus": status,
        "actorSub": actor_label,
        "actorLabel": actor_label,
        "note": "\n".join(note),
        "createdAt": now,
    }
    return {"assignment": assignment, "event": event}


def _safe_id(value: Any) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return (slug or "assignment")[:80]


def _graphql(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    endpoint = os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT")
    if not endpoint:
        raise ValueError("Missing PAPYRUS_GRAPHQL_ENDPOINT for Assignment.create")
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    headers = {"content-type": "application/json"}
    token = os.environ.get("PAPYRUS_GRAPHQL_JWT")
    if token:
        cleaned_token = re.sub(r"^Bearer\s+", "", token.strip(), flags=re.IGNORECASE)
        headers["Authorization"] = f"PapyrusJwt {cleaned_token}"
    else:
        headers.update(_iam_signed_headers(endpoint, body))
    request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GraphQL request failed: {error.code} {error.reason}: {detail}") from error
    if payload.get("errors"):
        raise RuntimeError("; ".join(error.get("message", str(error)) for error in payload["errors"]))
    return payload.get("data") or {}


def _iam_signed_headers(endpoint: str, body: bytes) -> dict[str, str]:
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    from botocore.session import Session

    parsed = urllib.parse.urlparse(endpoint)
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or _region_from_appsync_host(parsed.netloc)
    credentials = Session().get_credentials()
    if credentials is None:
        raise ValueError("AWS credentials are unavailable for IAM AppSync signing")
    request = AWSRequest(
        method="POST",
        url=endpoint,
        data=body,
        headers={"content-type": "application/json", "host": parsed.netloc},
    )
    SigV4Auth(credentials.get_frozen_credentials(), "appsync", region).add_auth(request)
    return {str(key): str(value) for key, value in request.headers.items()}


def _region_from_appsync_host(host: str) -> str:
    match = re.search(r"\.appsync-api\.([a-z0-9-]+)\.amazonaws\.com", host)
    return match.group(1) if match else "us-east-1"


def _execute_tactus_fallback(snippet: str) -> dict[str, Any]:
    text = (snippet or "").strip()
    entries = _safe_doc_entries()
    has_docs_list = bool(re.search(r"docs_list\s*\{", text))
    has_docs_get = bool(re.search(r"docs_get\s*\{", text))
    has_assignment_create = bool(re.search(r"(?:^|[^\w.])Assignment\s*\.\s*create\s*\{", text))

    if has_assignment_create:
        match = re.search(r"Assignment\s*\.\s*create\s*\{(?P<body>.*?)\}", text, re.DOTALL)
        fields = _parse_lua_table_fields(match.group("body") if match else text)
        return _assignment_create_fallback(fields)

    if has_docs_list and has_docs_get:
        ns_match = re.search(r"namespace\s*=\s*\"([^\"]+)\"", text)
        namespace = ns_match.group(1) if ns_match else ""
        list_value = (
            [entry for entry in entries if entry.get("namespace") == namespace]
            if namespace
            else entries
        )
        id_match = re.search(r"id\s*=\s*\"([^\"]+)\"", text)
        key_match = re.search(r"key\s*=\s*\"([^\"]+)\"", text)
        doc_id = id_match.group(1) if id_match else (key_match.group(1) if key_match else "")
        get_value = _docs_get(doc_id)
        return {
            "ok": bool(get_value.get("ok", False)),
            "value": {
                "docs_list": list_value,
                "docs_get": get_value.get("value"),
            },
            "error": get_value.get("error"),
            "partial": bool(get_value.get("partial", False)),
            "api_calls": ["papyrus.docs.list", "papyrus.docs.get"],
            "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 1},
        }

    if has_docs_list:
        ns_match = re.search(r"namespace\s*=\s*\"([^\"]+)\"", text)
        namespace = ns_match.group(1) if ns_match else ""
        if namespace:
            values = [entry for entry in entries if entry.get("namespace") == namespace]
        else:
            values = entries
        return {
            "ok": True,
            "value": values,
            "error": None,
            "partial": False,
            "api_calls": ["papyrus.docs.list"],
            "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 1},
        }

    if has_docs_get:
        id_match = re.search(r"id\s*=\s*\"([^\"]+)\"", text)
        key_match = re.search(r"key\s*=\s*\"([^\"]+)\"", text)
        doc_id = id_match.group(1) if id_match else (key_match.group(1) if key_match else "")
        return _docs_get(doc_id)

    if re.search(r"api_list\s*\{", text):
        return {
            "ok": True,
            "value": _api_schema(),
            "error": None,
            "partial": False,
            "api_calls": ["papyrus.api.list"],
            "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 1},
        }

    return {
        "ok": False,
        "error": {
            "code": "unsupported_snippet",
            "message": "Fallback execute_tactus runner supports docs_list, docs_get, api_list, and Assignment.create snippets.",
            "retryable": False,
        },
        "partial": False,
        "api_calls": [],
        "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 0},
    }


def _execute_tactus(arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        from papyrus_newsroom.tactus_runtime import execute_tactus_harnessed  # type: ignore

        return execute_tactus_harnessed(
            str(arguments.get("tactus") or ""),
            harness=str(arguments.get("harness") or "raw"),
            assignment_id=str(arguments.get("assignment_id") or arguments.get("assignmentId") or ""),
            assignment_item_json=str(arguments.get("assignment_item_json") or arguments.get("assignmentItemJson") or ""),
            corpus_key=str(arguments.get("corpus_key") or arguments.get("corpusKey") or ""),
            max_evidence_items=int(arguments.get("max_evidence_items") or arguments.get("maxEvidenceItems") or 20),
            research_mode=str(arguments.get("research_mode") or arguments.get("researchMode") or ""),
        )
    except Exception:
        return _execute_tactus_fallback(str(arguments.get("tactus") or ""))


def main() -> None:
    raw = sys.stdin.read()
    payload = json.loads(raw or "{}")
    mode = str(payload.get("mode") or "").strip()

    if mode == "docs_index":
        print(json.dumps({"entries": _safe_doc_entries()}))
        return

    if mode == "execute_tactus":
        args = payload.get("arguments") if isinstance(payload.get("arguments"), dict) else {}
        result = _execute_tactus(args)
        print(json.dumps(result))
        return

    print(
        json.dumps(
            {
                "ok": False,
                "error": {
                    "code": "invalid_mode",
                    "message": f"Unsupported mode: {mode}",
                    "retryable": False,
                },
            }
        )
    )


if __name__ == "__main__":
    main()
