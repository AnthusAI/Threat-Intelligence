"""Publication-date helpers for Reference registration and backfill (TI-06361a).

Recency ranking must never treat ingestion/crawl time as publication time
(TI-f1cc13). These helpers only accept dates that come from source metadata
(Biblicus catalog ``metadata.dates`` with an allowlisted provenance) or from
content/URL identity (e.g. arXiv id month). ``retrievedAt`` / ``importedAt`` /
GraphQL ``updatedAt`` are never candidates for ``sourcePublishedAt``.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

# Provenances observed on Biblicus AI/ML catalog items that mean a real source
# date — not an ingest/crawl stamp.
ALLOWED_CATALOG_DATE_PROVENANCES = frozenset(
    {
        "source-metadata",
        "curator",
        "source-metadata-month-imputed",
    }
)

_FORBIDDEN_PROVENANCE_MARKERS = (
    "import",
    "retriev",
    "ingest",
    "crawl",
    "access",
    "download",
    "fetched",
    "scrape",
)

_ARXIV_ID_RE = re.compile(
    r"(?:arxiv\.org/(?:abs|pdf)/|arxiv:)(\d{4})\.(\d{4,5})",
    flags=re.IGNORECASE,
)


def is_allowed_catalog_date_provenance(value: Any) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return False
    if text in ALLOWED_CATALOG_DATE_PROVENANCES:
        return True
    if any(marker in text for marker in _FORBIDDEN_PROVENANCE_MARKERS):
        return False
    return False


def normalize_publication_datetime(value: Any) -> str | None:
    """Normalize a publication/update date to UTC ISO-8601, or None if unusable."""
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        # Reject bare years — too coarse and often confused with other fields.
        if re.fullmatch(r"\d{4}", text):
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            text = f"{text}T00:00:00+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def publication_dates_from_catalog_item(item: dict[str, Any]) -> dict[str, Any]:
    """Pull allowlisted publication dates out of a Biblicus catalog item.

    Reads ``metadata.dates`` + ``metadata.date_provenance``. Never falls back to
    operational timestamps.
    """
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    dates = metadata.get("dates") if isinstance(metadata.get("dates"), dict) else {}
    provenance = metadata.get("date_provenance") if isinstance(metadata.get("date_provenance"), dict) else {}

    published = None
    published_source = None
    nested_published = dates.get("published_at") or dates.get("publishedAt")
    pub_prov = provenance.get("published_at") or provenance.get("publishedAt")
    if nested_published and (not pub_prov or is_allowed_catalog_date_provenance(pub_prov)):
        published = normalize_publication_datetime(nested_published)
        if published:
            published_source = f"catalog.dates.published_at:{pub_prov or 'source-metadata'}"
    elif not nested_published:
        top_published = item.get("published_at") or item.get("publishedAt")
        published = normalize_publication_datetime(top_published)
        if published:
            published_source = "catalog.published_at"

    updated = None
    updated_source = None
    nested_updated = dates.get("updated_at") or dates.get("updatedAt")
    upd_prov = provenance.get("updated_at") or provenance.get("updatedAt")
    if nested_updated and (not upd_prov or is_allowed_catalog_date_provenance(upd_prov)):
        updated = normalize_publication_datetime(nested_updated)
        if updated:
            updated_source = f"catalog.dates.updated_at:{upd_prov or 'source-metadata'}"

    return {
        "sourcePublishedAt": published,
        "sourceUpdatedAt": updated,
        "publishedSource": published_source,
        "updatedSource": updated_source,
    }


def publication_date_from_arxiv_uri(uri: str | None) -> dict[str, Any]:
    """Impute YYYY-MM-01 from an arXiv id embedded in a URI.

    Month-level only; never invents a day from crawl time. Prefer catalog /
    header extraction when available.
    """
    text = str(uri or "").strip()
    if not text:
        return {"sourcePublishedAt": None, "publishedSource": None}
    match = _ARXIV_ID_RE.search(text)
    if not match:
        return {"sourcePublishedAt": None, "publishedSource": None}
    year = int(match.group(1)[:2])
    month = int(match.group(1)[2:4])
    # arXiv ids are YYMM.nnnnn
    full_year = 1900 + year if year >= 90 else 2000 + year
    if month < 1 or month > 12:
        return {"sourcePublishedAt": None, "publishedSource": None}
    published = f"{full_year:04d}-{month:02d}-01T00:00:00Z"
    return {"sourcePublishedAt": published, "publishedSource": "arxiv.id"}


def assert_not_operational_timestamp(*, candidate: str | None, operational: dict[str, Any]) -> str | None:
    """Drop a candidate if it equals retrievedAt/importedAt/updatedAt (f1cc13 guard)."""
    if not candidate:
        return None
    normalized = normalize_publication_datetime(candidate)
    if not normalized:
        return None
    for key in ("retrievedAt", "importedAt", "updatedAt"):
        other = normalize_publication_datetime(operational.get(key))
        if other and other == normalized:
            return None
    return normalized
