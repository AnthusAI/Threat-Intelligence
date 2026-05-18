"""Single-tool Tactus runtime for Papyrus newsroom agents."""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

from . import newsroom


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]

    items = None
    try:
        items = list(value.items())
    except Exception:
        items = None
    if items is not None:
        converted = {key: _jsonable(item) for key, item in items}
        keys = list(converted.keys())
        if keys and all(isinstance(key, int) for key in keys):
            ordered = sorted(keys)
            if ordered == list(range(1, len(ordered) + 1)):
                return [converted[index] for index in ordered]
        return {str(key): item for key, item in converted.items()}

    return str(value)


def _args(args: Any = None) -> dict[str, Any]:
    if args is None:
        return {}
    converted = _jsonable(args)
    if converted is None:
        return {}
    if not isinstance(converted, dict):
        raise ValueError("Papyrus runtime APIs require table/object arguments")
    return converted


def _structured_error(code: str, message: str, exc: BaseException | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
        "retryable": False,
    }
    if exc is not None:
        payload["type"] = exc.__class__.__name__
    return payload


def _response_envelope(
    *,
    ok: bool,
    value: Any,
    trace_id: str,
    started_at: float,
    api_calls: list[str],
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "ok": ok,
        "value": _jsonable(value),
        "error": error,
        "cost": {
            "usd": 0.0,
            "duration_ms": int(round((time.monotonic() - started_at) * 1000)),
            "tool_calls": len(api_calls),
        },
        "trace_id": trace_id,
        "partial": False,
        "api_calls": list(api_calls),
    }


class _Namespace:
    def __init__(
        self,
        dispatcher: Callable[[str, str, Any], Any],
        name: str,
        methods: set[str],
    ) -> None:
        self._dispatcher = dispatcher
        self._name = name
        for method_name in methods:
            setattr(self, method_name, self._make_call(method_name))

    def _make_call(self, method_name: str) -> Callable[[Any], Any]:
        def call(args: Any = None) -> Any:
            return self._dispatcher(self._name, method_name, args)

        return call


API_METHODS: dict[tuple[str, str], Callable[[dict[str, Any]], Any]] = {
    ("edition", "get"): lambda args: newsroom.papyrus_get_edition(args.get("id") or args.get("edition_id")),
    ("edition", "items"): lambda args: newsroom.papyrus_list_edition_items(
        args.get("id") or args.get("edition_id"),
        limit=args.get("limit", 100),
    ),
    ("item", "get"): lambda args: newsroom.papyrus_get_item(args.get("id") or args.get("item_id")),
    ("item", "info"): lambda args: newsroom.papyrus_get_item(args.get("id") or args.get("item_id")),
    ("article", "recent_published"): lambda args: newsroom.papyrus_list_recent_published_articles(
        recent_days=args.get("recent_days") or args.get("recentDays") or 30,
        limit=args.get("limit", 25),
    ),
    ("assignment", "get"): lambda args: newsroom.papyrus_get_assignment(args.get("id") or args.get("assignment_id")),
    ("assignment", "context"): lambda args: newsroom.papyrus_get_assignment_context(
        args.get("id") or args.get("assignment_id")
    ),
    ("assignment", "agent_context"): lambda args: newsroom.papyrus_build_assignment_agent_context(
        assignment_id=args.get("id") or args.get("assignment_id"),
        context_profile=args.get("context_profile") or args.get("contextProfile") or "",
        max_tokens=args.get("max_tokens") or args.get("maxTokens") or 0,
        recent_days=args.get("recent_days") or args.get("recentDays") or 30,
    ),
    ("assignment", "context_to_item"): lambda args: newsroom.papyrus_assignment_context_to_item(
        assignment_context=args.get("assignment_context") or args.get("assignmentContext"),
        assignment_context_json=args.get("assignment_context_json") or args.get("assignmentContextJson") or "",
    ),
    ("track", "list"): lambda args: newsroom.papyrus_list_research_tracks(),
    ("track", "get"): lambda args: newsroom.papyrus_get_research_track(args.get("key") or args.get("track_key")),
    ("reference", "get"): lambda args: newsroom.papyrus_get_reference(args.get("id") or args.get("reference_id")),
    ("semantic", "object"): lambda args: newsroom.papyrus_get_semantic_object(
        kind=args.get("kind"),
        object_id=args.get("id") or args.get("object_id"),
    ),
    ("biblicus", "steering_artifacts"): lambda args: newsroom.biblicus_steering_artifacts(
        corpus_key=args.get("corpus_key") or args.get("corpusKey"),
        config_path=args.get("config_path") or args.get("configPath") or "",
    ),
    ("biblicus", "topic_context"): lambda args: newsroom.biblicus_topic_context(**args),
    ("biblicus", "topic_trends"): lambda args: newsroom.biblicus_topic_trends(**args),
    ("biblicus", "query"): lambda args: newsroom.biblicus_query(**args),
    ("plan", "assignment_record"): lambda args: newsroom.build_assignment_record_plan(**args),
    ("plan", "assignment_dispatch"): lambda args: newsroom.build_assignment_dispatch_plan(**args),
    ("plan", "research_update"): lambda args: newsroom.build_research_update_plan(**args),
    ("plan", "draft_update"): lambda args: newsroom.build_draft_update_plan(**args),
}


DOCS: dict[str, dict[str, Any]] = {
    "mcp.execute-tactus-overview": {
        "id": "mcp.execute-tactus-overview",
        "title": "execute_tactus Overview",
        "summary": "How Papyrus agents use one Tactus execution tool.",
        "namespace": "mcp",
        "status": "stable",
        "tags": ["mcp", "tactus", "newsroom"],
        "content": (
            "Papyrus agents should call execute_tactus with a short Tactus snippet. "
            "The runtime injects a global papyrus host module plus helper aliases. "
            "Use papyrus.api.list{} for available namespaces and papyrus.docs.list{} "
            "before loading focused documentation with papyrus.docs.get{ id = ... }."
        ),
    },
    "newsroom.assignment-context": {
        "id": "newsroom.assignment-context",
        "title": "Assignment Context",
        "summary": "Read live Assignment context and build budgeted agent context packs.",
        "namespace": "newsroom",
        "status": "stable",
        "tags": ["assignment", "context", "desk-memory"],
        "content": (
            "For live queue work, call assignment_context{ id = ... }, then "
            "assignment_agent_context{ id = ..., context_profile = ... }, then "
            "assignment_context_to_item{ assignment_context = context.assignment_context }. "
            "The normalized item is the dry-run compatibility shape used by plan builders."
        ),
    },
    "newsroom.record-plans": {
        "id": "newsroom.record-plans",
        "title": "Dry-Run Record Plans",
        "summary": "Build dry-run assignment, research, and draft record plans.",
        "namespace": "newsroom",
        "status": "stable",
        "tags": ["plans", "dry-run"],
        "content": (
            "Use papyrus.plan.assignment_dispatch, papyrus.plan.research_update, "
            "and papyrus.plan.draft_update to build inspectable dry-run mutation plans. "
            "These helpers do not write GraphQL records."
        ),
    },
    "newsroom.biblicus-evidence": {
        "id": "newsroom.biblicus-evidence",
        "title": "Biblicus Evidence",
        "summary": "Use configured Biblicus corpus tools from Papyrus Tactus snippets.",
        "namespace": "newsroom",
        "status": "stable",
        "tags": ["biblicus", "evidence"],
        "content": (
            "Use biblicus_steering_artifacts, biblicus_query, biblicus_topic_context, "
            "and biblicus_topic_trends for evidence gathering. Keep returned evidence "
            "ids in research packets and draft plans."
        ),
    },
}


HELPER_BINDINGS: tuple[tuple[str, str, str], ...] = (
    ("edition_get", "edition", "get"),
    ("edition_items", "edition", "items"),
    ("item_get", "item", "get"),
    ("assignment_get", "assignment", "get"),
    ("assignment_context", "assignment", "context"),
    ("assignment_agent_context", "assignment", "agent_context"),
    ("assignment_context_to_item", "assignment", "context_to_item"),
    ("recent_published_articles", "article", "recent_published"),
    ("biblicus_steering_artifacts", "biblicus", "steering_artifacts"),
    ("biblicus_topic_context", "biblicus", "topic_context"),
    ("biblicus_topic_trends", "biblicus", "topic_trends"),
    ("biblicus_query", "biblicus", "query"),
    ("plan_assignment_dispatch", "plan", "assignment_dispatch"),
    ("plan_research_update", "plan", "research_update"),
    ("plan_draft_update", "plan", "draft_update"),
    ("docs_list", "docs", "list"),
    ("docs_get", "docs", "get"),
    ("api_list", "api", "list"),
)


class PapyrusRuntimeModule:
    """Tactus host module exposing curated Papyrus newsroom namespaces."""

    def __init__(self) -> None:
        self._api_calls: list[str] = []
        methods_by_namespace: dict[str, set[str]] = {}
        for namespace, method in API_METHODS:
            methods_by_namespace.setdefault(namespace, set()).add(method)
        for namespace, methods in methods_by_namespace.items():
            setattr(self, namespace, _Namespace(self._call, namespace, methods))
        self.docs = _Namespace(self._call_docs, "docs", {"list", "get"})
        self.api = _Namespace(self._call_api, "api", {"list"})

    @property
    def api_calls(self) -> list[str]:
        return list(self._api_calls)

    def _record_api_call(self, namespace: str, method: str) -> None:
        self._api_calls.append(f"papyrus.{namespace}.{method}")

    def _call(self, namespace: str, method: str, args: Any = None) -> Any:
        handler = API_METHODS.get((namespace, method))
        if handler is None:
            raise ValueError(f"Unsupported Papyrus runtime API: papyrus.{namespace}.{method}")
        parsed = _args(args)
        self._record_api_call(namespace, method)
        return handler(parsed)

    def _call_docs(self, namespace: str, method: str, args: Any = None) -> Any:
        parsed = _args(args)
        if method == "list":
            namespace_filter = parsed.get("namespace")
            self._record_api_call("docs", "list")
            entries = []
            for doc in DOCS.values():
                if namespace_filter and doc.get("namespace") != namespace_filter:
                    continue
                entries.append(
                    {
                        key: doc[key]
                        for key in ("id", "title", "summary", "namespace", "status", "tags")
                    }
                )
            return entries
        if method == "get":
            doc_id = parsed.get("id") or parsed.get("key") or parsed.get("name")
            if not doc_id:
                raise ValueError("papyrus.docs.get requires id, key, or name")
            doc = DOCS.get(str(doc_id))
            if doc is None:
                raise FileNotFoundError(f"Unknown Papyrus documentation id: {doc_id}")
            self._record_api_call("docs", "get")
            return {"id": doc["id"], "metadata": {k: v for k, v in doc.items() if k != "content"}, "content": doc["content"]}
        raise ValueError(f"Unsupported Papyrus runtime API: papyrus.docs.{method}")

    def _call_api(self, namespace: str, method: str, args: Any = None) -> Any:
        if method != "list":
            raise ValueError(f"Unsupported Papyrus runtime API: papyrus.api.{method}")
        self._record_api_call("api", "list")
        api: dict[str, list[str]] = {}
        for namespace_name, method_name in API_METHODS:
            api.setdefault(f"papyrus.{namespace_name}", []).append(method_name)
        api.setdefault("papyrus.docs", []).extend(["list", "get"])
        api.setdefault("papyrus.api", []).append("list")
        return {key: sorted(set(values)) for key, values in sorted(api.items())}


def _wrap_tactus_snippet(tactus: str) -> str:
    helper_lines = [
        'local papyrus = require("papyrus")',
        "local __papyrus_last_result = nil",
        "local function __papyrus_capture(value)",
        "  __papyrus_last_result = value",
        "  return value",
        "end",
    ]
    for helper_name, namespace, method in HELPER_BINDINGS:
        helper_lines.extend(
            [
                f"function {helper_name}(args)",
                f"  return __papyrus_capture(papyrus.{namespace}.{method}(args))",
                "end",
            ]
        )
    return "\n".join(
        [
            *helper_lines,
            "local function __execute_tactus_user_snippet()",
            tactus,
            "end",
            "local __papyrus_explicit_result = __execute_tactus_user_snippet()",
            "if __papyrus_explicit_result ~= nil then",
            "  return __papyrus_explicit_result",
            "end",
            "return __papyrus_last_result",
            "",
        ]
    )


def _run_async(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict[str, Any] = {}
    error: dict[str, BaseException] = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001
            error["error"] = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if error:
        raise error["error"]
    return result.get("value")


def execute_tactus(tactus: str) -> dict[str, Any]:
    """Execute a short Papyrus Tactus snippet and return a structured envelope."""

    started = time.monotonic()
    trace_id = str(uuid.uuid4())
    if not isinstance(tactus, str) or not tactus.strip():
        return _response_envelope(
            ok=False,
            value=None,
            trace_id=trace_id,
            started_at=started,
            api_calls=[],
            error=_structured_error("invalid_request", "tactus must be a non-empty string"),
        )

    papyrus = PapyrusRuntimeModule()
    try:
        from tactus.adapters.memory import MemoryStorage
        from tactus.core import TactusRuntime

        async def run() -> Any:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                runtime = TactusRuntime(
                    procedure_id=f"papyrus_execute_tactus_{trace_id}",
                    storage_backend=MemoryStorage(),
                    run_id=trace_id,
                    source_file_path="<papyrus execute_tactus>",
                )
                if not hasattr(runtime, "register_python_module"):
                    raise RuntimeError(
                        "execute_tactus requires TactusRuntime.register_python_module; update tactus."
                    )
                runtime.register_python_module("papyrus", papyrus)
                return await runtime.execute(_wrap_tactus_snippet(tactus), context={}, format="lua")

        runtime_result = _run_async(run())
        if not isinstance(runtime_result, dict):
            return _response_envelope(
                ok=True,
                value=runtime_result,
                trace_id=trace_id,
                started_at=started,
                api_calls=papyrus.api_calls,
            )

        ok = bool(runtime_result.get("success"))
        value = runtime_result.get("result")
        return _response_envelope(
            ok=ok,
            value=value,
            trace_id=trace_id,
            started_at=started,
            api_calls=papyrus.api_calls,
            error=None if ok else _structured_error("tactus_execution_failed", str(runtime_result.get("error") or "Tactus execution failed")),
        )
    except Exception as exc:  # noqa: BLE001
        return _response_envelope(
            ok=False,
            value=None,
            trace_id=trace_id,
            started_at=started,
            api_calls=papyrus.api_calls,
            error=_structured_error("runtime_error", str(exc), exc),
        )


EXECUTE_TACTUS_DESCRIPTION = """Execute a short Tactus snippet inside the Papyrus newsroom runtime.

Use this as the only tool for Papyrus newsroom agent work. The runtime injects a
global `papyrus` host module with namespaces such as `assignment`, `edition`,
`item`, `article`, `biblicus`, `plan`, `docs`, and `api`.

Ground rules:
- `papyrus` is already available; do not require arbitrary Python modules.
- Use table arguments: `assignment_context{ id = "assignment-123" }`.
- The runtime returns the last Papyrus operation if your snippet does not return
  explicitly.
- Use `api_list{}` and `docs_list{}` for discovery instead of guessing.
- Record-plan helpers are dry-run builders; they do not write GraphQL records.

Example:
```tactus
local context = assignment_context{ id = "assignment-live-123" }
local pack = assignment_agent_context{ id = "assignment-live-123", context_profile = "reporting" }
local item = assignment_context_to_item{ assignment_context = context.assignment_context }
return {
  context = pack.assignment_agent_context,
  item = item.item,
}
```
"""
