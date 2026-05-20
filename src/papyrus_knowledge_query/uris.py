from __future__ import annotations

from typing import Any
from urllib.parse import unquote, urlparse


PAPYRUS_URI_SCHEME = "papyrus"

PAPYRUS_URI_KIND_ALIASES = {
    "assignment": "assignment",
    "category": "category",
    "categoryset": "categorySet",
    "categorySet": "categorySet",
    "item": "item",
    "message": "message",
    "reference": "reference",
    "semanticnode": "semanticNode",
    "semanticNode": "semanticNode",
    "semanticrelation": "semanticRelation",
    "semanticRelation": "semanticRelation",
    "steeringproposal": "steeringProposal",
    "steeringProposal": "steeringProposal",
}


def parse_papyrus_uri(uri: str) -> dict[str, str]:
    """Parse the compact Papyrus object URI used in model-facing context packs."""

    raw = str(uri or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme != PAPYRUS_URI_SCHEME:
        raise ValueError(f"Papyrus URI must use papyrus:// scheme: {raw}")
    if parsed.params or parsed.query or parsed.fragment:
        raise ValueError(f"Papyrus URI must not include params, query, or fragment: {raw}")
    kind = _canonical_kind(unquote(parsed.netloc))
    object_id = unquote(parsed.path[1:] if parsed.path.startswith("/") else parsed.path)
    if not kind:
        raise ValueError(f"Papyrus URI kind is required: {raw}")
    if not object_id:
        raise ValueError(f"Papyrus URI object id is required: {raw}")
    return {
        "kind": kind,
        "id": object_id,
        "lineageId": object_id,
        "objectUri": raw,
    }


def normalize_anchor_uri(anchor: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(anchor)
    uri = normalized.get("uri") or normalized.get("objectUri")
    if isinstance(uri, str) and uri.strip():
        parsed = parse_papyrus_uri(uri)
        parsed.update({key: value for key, value in normalized.items() if key not in {"kind", "id", "lineageId", "objectUri", "uri"}})
        return parsed
    return normalized


def _canonical_kind(kind: str) -> str:
    if kind in PAPYRUS_URI_KIND_ALIASES:
        return PAPYRUS_URI_KIND_ALIASES[kind]
    lowered = kind.lower()
    return PAPYRUS_URI_KIND_ALIASES.get(lowered, "")
