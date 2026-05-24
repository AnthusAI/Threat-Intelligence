#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
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
            "Use execute_tactus for Papyrus runtime actions.\n"
            "Start with docs_list{} to discover topic ids, then call docs_get{ id = \"...\" }"
            " for full detail on one topic."
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


def _execute_tactus_fallback(snippet: str) -> dict[str, Any]:
    text = (snippet or "").strip()
    entries = _safe_doc_entries()
    has_docs_list = bool(re.search(r"docs_list\s*\{", text))
    has_docs_get = bool(re.search(r"docs_get\s*\{", text))

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
            "value": {
                "papyrus.docs": ["list", "get"],
                "papyrus.api": ["list"],
            },
            "error": None,
            "partial": False,
            "api_calls": ["papyrus.api.list"],
            "cost": {"usd": 0.0, "duration_ms": 0, "tool_calls": 1},
        }

    return {
        "ok": False,
        "error": {
            "code": "unsupported_snippet",
            "message": "Fallback execute_tactus runner supports docs_list, docs_get, and api_list snippets.",
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
