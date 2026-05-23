from __future__ import annotations

from typing import Any


def parse_options(flags: list[str]) -> dict[str, Any]:
    options: dict[str, Any] = {}
    index = 0
    while index < len(flags):
        token = flags[index]
        if not token.startswith("--"):
            raise ValueError(f"Unexpected argument {token}.")
        key = token[2:]
        next_value = flags[index + 1] if index + 1 < len(flags) else None
        if not next_value or next_value.startswith("--"):
            options[key] = True
            index += 1
            continue
        options[key] = next_value
        index += 2
    return options


def parse_boolean_option(value: Any, default: bool, label: str) -> bool:
    if value is None or value is True or value is False:
        if value is True:
            return True
        if value is False:
            return False
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{label} must be a boolean value.")


def normalize_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_positive_integer(value: Any, label: str) -> int | None:
    if value is None or value is True:
        return None
    parsed = int(str(value).strip())
    if parsed <= 0:
        raise ValueError(f"{label} must be a positive integer.")
    return parsed


def parse_comma_list(value: Any) -> list[str] | None:
    if value is None or value is True:
        return None
    parts = [part.strip() for part in str(value).split(",")]
    cleaned = [part for part in parts if part]
    return cleaned or None


def normalize_non_negative_integer(value: Any, label: str) -> int | None:
    if value is None or value is True:
        return None
    parsed = int(str(value).strip())
    if parsed < 0:
        raise ValueError(f"{label} must be a non-negative integer.")
    return parsed
