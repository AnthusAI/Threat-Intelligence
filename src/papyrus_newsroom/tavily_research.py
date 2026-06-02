"""Tavily Research API (async deep research tasks)."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Literal

TavilyResearchModel = Literal["mini", "pro", "auto"]
TavilyResearchOutputLength = Literal["short", "standard", "long"]
TAVILY_RESEARCH_CREATE_URL = "https://api.tavily.com/research"
DEFAULT_TAVILY_RESEARCH_MODEL: TavilyResearchModel = "auto"
DEFAULT_TAVILY_RESEARCH_OUTPUT_LENGTH: TavilyResearchOutputLength = "standard"


class TavilyResearchError(RuntimeError):
    pass


class TavilyResearchFailed(TavilyResearchError):
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        request_id = payload.get("request_id") or payload.get("requestId") or "unknown"
        super().__init__(f"Tavily research task {request_id} failed.")


class TavilyResearchTimeout(TavilyResearchError):
    pass


def _api_key() -> str:
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key:
        raise TavilyResearchError("TAVILY_API_KEY is required for Tavily deep research.")
    return api_key


def _request(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    timeout: int = 180,
) -> tuple[int, dict[str, Any]]:
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status_code = int(getattr(response, "status", 200))
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        status_code = int(error.code)
        raw = error.read().decode("utf-8", errors="replace")
        if status_code >= 400:
            raise TavilyResearchError(f"Tavily research HTTP {status_code}: {raw[:400]}") from error
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError as error:
        raise TavilyResearchError(f"Tavily research returned non-JSON body: {raw[:200]}") from error
    if not isinstance(parsed, dict):
        raise TavilyResearchError("Tavily research response must be a JSON object.")
    return status_code, parsed


def create_tavily_research_task(
    *,
    input_text: str,
    model: str = DEFAULT_TAVILY_RESEARCH_MODEL,
    output_length: str = DEFAULT_TAVILY_RESEARCH_OUTPUT_LENGTH,
    include_domains: list[str] | None = None,
    exclude_domains: list[str] | None = None,
    citation_format: str = "numbered",
) -> dict[str, Any]:
    query = str(input_text or "").strip()
    if not query:
        raise ValueError("Tavily research input is required.")
    payload: dict[str, Any] = {
        "input": query,
        "model": model or DEFAULT_TAVILY_RESEARCH_MODEL,
        "output_length": output_length or DEFAULT_TAVILY_RESEARCH_OUTPUT_LENGTH,
        "citation_format": citation_format,
    }
    if include_domains:
        payload["include_domains"] = [str(entry).strip() for entry in include_domains if str(entry).strip()][:20]
    if exclude_domains:
        payload["exclude_domains"] = [str(entry).strip() for entry in exclude_domains if str(entry).strip()][:20]
    status_code, body = _request("POST", TAVILY_RESEARCH_CREATE_URL, payload)
    if status_code not in {200, 201}:
        raise TavilyResearchError(f"Unexpected Tavily create status {status_code}: {body}")
    request_id = str(body.get("request_id") or body.get("requestId") or "").strip()
    if not request_id:
        raise TavilyResearchError(f"Tavily research create response missing request_id: {body}")
    return body


def get_tavily_research_task(request_id: str) -> tuple[int, dict[str, Any]]:
    task_id = str(request_id or "").strip()
    if not task_id:
        raise ValueError("Tavily research request_id is required.")
    url = f"{TAVILY_RESEARCH_CREATE_URL}/{urllib.request.quote(task_id, safe='')}"
    return _request("GET", url)


def poll_tavily_research_task(
    request_id: str,
    *,
    max_wait_seconds: int = 1800,
    initial_interval_seconds: float = 5.0,
    max_interval_seconds: float = 30.0,
    on_progress: Any | None = None,
) -> dict[str, Any]:
    deadline = time.monotonic() + max(30, int(max_wait_seconds))
    interval = max(1.0, float(initial_interval_seconds))
    last_status = ""
    while time.monotonic() < deadline:
        status_code, body = get_tavily_research_task(request_id)
        status = str(body.get("status") or "").strip().lower()
        if status != last_status:
            last_status = status
            if callable(on_progress):
                on_progress(status_code=status_code, status=status, body=body)
        if status == "completed":
            if status_code not in {200, 201}:
                raise TavilyResearchError(f"Unexpected Tavily completed HTTP status {status_code}")
            return body
        if status == "failed":
            raise TavilyResearchFailed(body)
        if status in {"pending", "in_progress", ""}:
            time.sleep(interval)
            interval = min(interval * 1.25, max_interval_seconds)
            continue
        raise TavilyResearchError(f"Unknown Tavily research status {status!r} for {request_id}.")
    raise TavilyResearchTimeout(
        f"Tavily research task {request_id} did not complete within {max_wait_seconds} seconds "
        f"(last status={last_status or 'unknown'})."
    )
