from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

from .env import PAPYRUS_ROOT

DEFAULT_PAPYRUS_CONFIG = ".papyrus/config.yaml"
DEFAULT_STEERING_CONFIG_PATH = "corpora/papyrus-steering.yml"
DEFAULT_LEXICAL_STEERING_PATH = "corpora/papyrus-lexical-steering.yml"
DEFAULT_TOPIC_IGNORE_TERMS = (
    "et",
    "al",
    "fig",
    "figure",
    "table",
    "appendix",
    "references",
    "abstract",
    "introduction",
    "preprint",
    "arxiv",
    "doi",
    "http",
    "https",
    "document",
    "candidate",
    "paper",
    "url",
    "research",
)


def resolve_papyrus_config_path(config_path: str | None = None, *, required: bool = False) -> Path | None:
    configured = config_path or os.environ.get("PAPYRUS_CONFIG") or DEFAULT_PAPYRUS_CONFIG
    resolved = Path(configured)
    if not resolved.is_absolute():
        resolved = PAPYRUS_ROOT / resolved
    if not resolved.exists():
        if required or config_path or os.environ.get("PAPYRUS_CONFIG"):
            raise ValueError(f"Papyrus config was not found: {configured}")
        return None
    return resolved


def load_papyrus_config(config_path: str | None = None) -> dict[str, Any] | None:
    resolved = resolve_papyrus_config_path(config_path)
    if resolved is None:
        return None
    parsed = yaml.safe_load(resolved.read_text(encoding="utf-8"))
    return normalize_papyrus_config(parsed, str(resolved))


def normalize_papyrus_config(raw_config: Any, config_path: str) -> dict[str, Any]:
    if not isinstance(raw_config, dict):
        raise ValueError("Papyrus config must be a YAML object.")
    if raw_config.get("schemaVersion") != 1:
        raise ValueError("Papyrus config schemaVersion must be 1.")
    topics = raw_config.get("topics") or {}
    if not isinstance(topics, dict):
        raise ValueError("Papyrus config topics must be an object.")
    ignore_terms = normalize_ignore_terms(topics.get("ignoreTerms"))
    return {
        "configPath": config_path,
        "schemaVersion": 1,
        "topics": {
            "steeringConfigPath": _optional_string(topics.get("steeringConfigPath")) or DEFAULT_STEERING_CONFIG_PATH,
            "lexicalConfigPath": _optional_string(topics.get("lexicalConfigPath")) or DEFAULT_LEXICAL_STEERING_PATH,
            "ignoreTerms": ignore_terms or list(DEFAULT_TOPIC_IGNORE_TERMS),
        },
    }


def resolve_topics_steering_config_path() -> str:
    config = load_papyrus_config()
    if config:
        return str(config["topics"]["steeringConfigPath"])
    return DEFAULT_STEERING_CONFIG_PATH


def resolve_topics_lexical_config_path() -> str:
    config = load_papyrus_config()
    if config:
        return str(config["topics"]["lexicalConfigPath"])
    return DEFAULT_LEXICAL_STEERING_PATH


def resolve_topics_ignore_terms() -> list[str]:
    config = load_papyrus_config()
    if config:
        return list(config["topics"]["ignoreTerms"] or [])
    return list(DEFAULT_TOPIC_IGNORE_TERMS)


def normalize_ignore_terms(raw_value: Any) -> list[str]:
    if raw_value is None:
        return []
    if not isinstance(raw_value, list):
        raise ValueError("Papyrus config topics.ignoreTerms must be a list.")
    normalized: list[str] = []
    seen: set[str] = set()
    for index, entry in enumerate(raw_value):
        term_value = entry
        if isinstance(entry, dict):
            term_value = entry.get("term")
        term = _optional_string(term_value)
        if not term:
            raise ValueError(f"Papyrus config topics.ignoreTerms[{index}] must be a non-empty string.")
        lowered = term.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(lowered)
    return normalized


def _optional_string(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()
