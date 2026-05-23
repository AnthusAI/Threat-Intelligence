from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from .env import PAPYRUS_ROOT
from .options import parse_options

DEFAULT_ANALYSIS_PROFILES_PATH = PAPYRUS_ROOT / "corpora" / "papyrus-analysis-profiles.yml"
VALID_SCOPES = frozenset(
    {
        "global-topic-model",
        "scoped-topic-model",
        "topic-classifier-train",
        "topic-projection",
        "entity-graph",
    }
)
VALID_MODES = frozenset(
    {
        "online-update",
        "classifier-retrain",
        "scoped-topic-rebuild",
        "entity-graph-rebuild",
        "generated-analysis-rebuild",
    }
)


def load_analysis_profiles(filepath: str | Path | None = None) -> dict[str, Any]:
    resolved = Path(filepath or DEFAULT_ANALYSIS_PROFILES_PATH).resolve()
    parsed = yaml.safe_load(resolved.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict) or parsed.get("schemaVersion") != 1 or not isinstance(parsed.get("profiles"), list):
        raise ValueError(f"Invalid analysis profile file: {resolved}")
    keys: set[str] = set()
    profiles = [_normalize_profile(entry, index, resolved) for index, entry in enumerate(parsed["profiles"])]
    for profile in profiles:
        key = profile["key"]
        if key in keys:
            raise ValueError(f"Duplicate analysis profile key {key} in {resolved}.")
        keys.add(key)
    return {"schemaVersion": 1, "filepath": str(resolved), "profiles": profiles}


def summarize_analysis_profiles(config: dict[str, Any]) -> list[dict[str, Any]]:
    summaries = []
    for profile in config["profiles"]:
        summaries.append(
            {
                "key": profile["key"],
                "title": profile["title"],
                "scope": profile["scope"],
                "defaultMode": profile["defaultMode"],
                "corpusKey": profile.get("corpusKey"),
            }
        )
    return summaries


def analysis_profiles(flags: list[str]) -> None:
    options = parse_options(flags)
    profiles_path = options.get("profiles") or str(DEFAULT_ANALYSIS_PROFILES_PATH)
    config = load_analysis_profiles(profiles_path)
    summaries = summarize_analysis_profiles(config)
    if options.get("json"):
        print(json.dumps({"profilesPath": config["filepath"], "profiles": summaries}, indent=2))
        return
    for profile in summaries:
        print(
            f"{profile['key']}\t{profile['scope']}\t{profile['defaultMode']}\t"
            f"{profile.get('corpusKey') or ''}\t{profile['title']}"
        )


def validate_analysis_profiles(flags: list[str]) -> None:
    options = parse_options(flags)
    profiles_path = options.get("profiles") or str(DEFAULT_ANALYSIS_PROFILES_PATH)
    config = load_analysis_profiles(profiles_path)
    print(f"analysis-profiles\tvalid\t{config['filepath']}\t{len(config['profiles'])}")


def _normalize_profile(entry: Any, index: int, filepath: Path) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise ValueError(f"Profile at index {index} in {filepath} must be an object.")
    key = _require_string(entry, "key", filepath, index)
    scope = _require_string(entry, "scope", filepath, index)
    default_mode = _require_string(entry, "defaultMode", filepath, index)
    if scope not in VALID_SCOPES:
        raise ValueError(f"Profile {key} has invalid scope {scope}.")
    if default_mode not in VALID_MODES:
        raise ValueError(f"Profile {key} has invalid defaultMode {default_mode}.")
    return {
        "key": key,
        "title": _require_string(entry, "title", filepath, index),
        "scope": scope,
        "defaultMode": default_mode,
        "corpusKey": entry.get("corpusKey"),
        "configurationName": entry.get("configurationName"),
        "defaults": entry.get("defaults") if isinstance(entry.get("defaults"), dict) else {},
        "allowedOverrides": entry.get("allowedOverrides") if isinstance(entry.get("allowedOverrides"), list) else [],
    }


def _require_string(entry: dict[str, Any], field: str, filepath: Path, index: int) -> str:
    value = entry.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Profile at index {index} in {filepath} requires {field}.")
    return value.strip()
