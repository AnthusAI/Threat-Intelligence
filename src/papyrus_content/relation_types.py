from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .env import PAPYRUS_ROOT
from .ids import safe_id

DEFAULT_RELATION_TYPES_PATH = PAPYRUS_ROOT / "corpora" / "papyrus-semantic-relation-types.yml"


@lru_cache(maxsize=4)
def load_relation_type_lookup(filepath: str | None = None) -> dict[str, dict[str, Any]]:
    path = Path(filepath) if filepath else DEFAULT_RELATION_TYPES_PATH
    parsed = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict) or parsed.get("schemaVersion") != 1:
        raise ValueError(f"Invalid semantic relation type seed file: {path}")
    relation_types = parsed.get("relationTypes") or []
    lookup: dict[str, dict[str, Any]] = {}
    for entry in relation_types:
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("key") or "").strip()
        if key:
            lookup[key] = entry
    return lookup


def semantic_relation_type_id_for(key: str) -> str:
    return f"semantic-relation-type-{safe_id(key)}"


def semantic_relation_type_fields_for_predicate(predicate: str) -> dict[str, str]:
    key = normalize_relation_type_key(predicate)
    relation_type = load_relation_type_lookup().get(key)
    if relation_type is None:
        return {"relationTypeKey": key, "relationDomain": "generic"}
    return {
        "relationTypeId": semantic_relation_type_id_for(relation_type["key"]),
        "relationTypeKey": relation_type["key"],
        "relationDomain": relation_type.get("domain") or "generic",
    }


def normalize_relation_type_key(predicate: str) -> str:
    return str(predicate or "").strip().lower().replace(" ", "_")
