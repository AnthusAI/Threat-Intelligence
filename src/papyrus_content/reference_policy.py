from __future__ import annotations

import re
from typing import Any

REFERENCE_CURATION_STATUSES = frozenset({"pending", "accepted", "rejected", "archived"})
REFERENCE_REJECTION_REASON_CODES = frozenset(
    {
        "out_of_scope",
        "policy_exclusion",
        "duplicate",
        "low_quality",
        "unavailable",
        "provenance",
        "other",
    }
)


def normalize_policy_token(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def normalize_reference_curation_status(value: Any, default_status: str = "pending") -> str:
    normalized = normalize_policy_token(value if value is not None else default_status)
    if normalized in {"accepted", "accept", "ready", "trusted"}:
        return "accepted"
    if normalized in {"rejected", "reject", "discarded"}:
        return "rejected"
    if normalized in {"archived", "archive"}:
        return "archived"
    return "pending"


def normalize_reference_rejection_reason_code(value: Any, *, required: bool = False) -> str | None:
    normalized = normalize_policy_token(value)
    if not normalized:
        if required:
            raise ValueError("--reason-code is required for rejected references.")
        return None
    if normalized not in REFERENCE_REJECTION_REASON_CODES:
        raise ValueError(
            f"Unsupported reference rejection reason code '{value}'. "
            f"Use one of: {', '.join(sorted(REFERENCE_REJECTION_REASON_CODES))}."
        )
    return normalized
