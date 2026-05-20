from __future__ import annotations

import json
from typing import Any

from .engine import run_knowledge_query
from .services import build_environment_services


def handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    input_payload = _extract_input(event)
    return run_knowledge_query(input_payload, build_environment_services(event))


def _extract_input(event: dict[str, Any]) -> dict[str, Any]:
    arguments = event.get("arguments") if isinstance(event, dict) else None
    raw_input = arguments.get("input") if isinstance(arguments, dict) and "input" in arguments else event
    if isinstance(raw_input, str):
        try:
            raw_input = json.loads(raw_input)
        except json.JSONDecodeError as exc:
            raise ValueError(f"knowledgeQuery input must be valid JSON: {exc}") from exc
    if not isinstance(raw_input, dict):
        raise TypeError("knowledgeQuery input must be a JSON object")
    return raw_input
