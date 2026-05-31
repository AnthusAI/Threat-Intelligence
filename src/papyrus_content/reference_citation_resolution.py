from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any


def build_reference_citation_resolution_records(
    *,
    references: list[dict[str, Any]],
    corpus_id: str | None = None,
    reference_ids: set[str] | None = None,
    external_item_ids: set[str] | None = None,
    curation_status: str = "all",
    max_count: int | None = None,
    force: bool = False,
    promote_external_id: bool = False,
) -> dict[str, Any]:
    selected_reference_ids = set(reference_ids or [])
    selected_external_item_ids = set(external_item_ids or [])
    rows = [
        reference
        for reference in references
        if str(reference.get("versionState") or "") == "current"
        and (not corpus_id or str(reference.get("corpusId") or "") == str(corpus_id))
        and (curation_status == "all" or str(reference.get("curationStatus") or "") == curation_status)
        and (not selected_reference_ids or str(reference.get("id") or "") in selected_reference_ids)
        and (not selected_external_item_ids or str(reference.get("externalItemId") or "") in selected_external_item_ids)
    ]
    rows.sort(
        key=lambda reference: (
            str(reference.get("updatedAt") or reference.get("createdAt") or ""),
            str(reference.get("id") or ""),
        ),
        reverse=True,
    )
    records: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    attempted = 0
    resolved = 0
    skipped_existing = 0
    skipped_non_citation = 0
    failures = 0
    for reference in rows:
        reference_id = str(reference.get("id") or "")
        external_item_id = str(reference.get("externalItemId") or "")
        if not reference_id:
            continue
        if not external_item_id.startswith("citation:"):
            skipped_non_citation += 1
            continue
        metadata = _metadata_object(reference)
        resolution_state = metadata.get("citationResolution") if isinstance(metadata.get("citationResolution"), dict) else {}
        if resolution_state.get("status") == "resolved" and not force:
            skipped_existing += 1
            continue
        attempted += 1
        try:
            resolution = resolve_citation_reference(reference)
        except Exception as error:
            failures += 1
            items.append(
                {
                    "referenceId": reference_id,
                    "externalItemId": external_item_id,
                    "status": "failed",
                    "error": str(error),
                }
            )
            if max_count and attempted >= max_count:
                break
            continue

        if resolution.get("status") == "resolved":
            resolved += 1
        updated_metadata = dict(metadata)
        updated_metadata["citationResolution"] = {
            "status": resolution.get("status"),
            "resolvedAt": _utc_now(),
            "resolverVersion": "citation-resolver-v1",
            "bestCandidate": resolution.get("bestCandidate"),
            "candidateCount": len(resolution.get("candidates") or []),
            "notes": resolution.get("notes") or [],
        }
        identifiers = updated_metadata.get("identifiers")
        if not isinstance(identifiers, dict):
            identifiers = {}
        resolved_identifiers = identifiers.get("resolved")
        if not isinstance(resolved_identifiers, dict):
            resolved_identifiers = {}
        best = resolution.get("bestCandidate") if isinstance(resolution.get("bestCandidate"), dict) else {}
        for key in ("doi", "arxiv_id", "isbn"):
            value = str(best.get(key) or "").strip()
            if value:
                resolved_identifiers[key] = value
        if str(best.get("source_uri") or "").strip():
            resolved_identifiers["canonical_uri"] = str(best["source_uri"])
            resolved_identifiers.setdefault("source_uri", str(best["source_uri"]))
        identifiers["resolved"] = resolved_identifiers
        primary = _primary_identifier_from_candidate(best)
        if primary:
            identifiers["primary"] = primary
        updated_metadata["identifiers"] = identifiers

        expected: dict[str, Any] = {
            "id": reference_id,
            "metadata": json.dumps(updated_metadata, sort_keys=True),
            "updatedAt": _utc_now(),
        }
        source_uri = str(reference.get("sourceUri") or "").strip()
        if not source_uri and str(best.get("source_uri") or "").strip():
            expected["sourceUri"] = str(best["source_uri"])
        if promote_external_id and external_item_id.startswith("citation:"):
            doi = str(best.get("doi") or "").strip()
            arxiv_id = str(best.get("arxiv_id") or "").strip()
            isbn = str(best.get("isbn") or "").strip()
            if doi:
                expected["externalItemId"] = f"doi:{doi.lower()}"
            elif arxiv_id:
                expected["externalItemId"] = f"arxiv:{arxiv_id.lower()}"
            elif isbn:
                expected["externalItemId"] = f"isbn:{isbn.lower()}"
        records.append({"modelName": "Reference", "expected": expected})
        items.append(
            {
                "referenceId": reference_id,
                "externalItemId": external_item_id,
                "status": resolution.get("status"),
                "bestCandidate": resolution.get("bestCandidate"),
                "candidateCount": len(resolution.get("candidates") or []),
            }
        )
        if max_count and attempted >= max_count:
            break
    return {
        "records": records,
        "items": items,
        "attemptedCount": attempted,
        "resolvedCount": resolved,
        "skippedExistingCount": skipped_existing,
        "skippedNonCitationCount": skipped_non_citation,
        "failureCount": failures,
    }


def resolve_citation_reference(reference: dict[str, Any]) -> dict[str, Any]:
    title = str(reference.get("title") or "").strip()
    authors = [str(value).strip() for value in (reference.get("authors") or []) if str(value).strip()]
    if not title:
        return {
            "status": "unresolved",
            "bestCandidate": None,
            "candidates": [],
            "notes": ["missing_title"],
        }
    candidates = []
    candidates.extend(_crossref_candidates(title=title, authors=authors))
    candidates.extend(_openalex_candidates(title=title, authors=authors))
    scored = [_score_candidate(candidate, title=title, authors=authors) for candidate in candidates]
    scored.sort(key=lambda row: float(row.get("score") or 0.0), reverse=True)
    best = scored[0] if scored else None
    if not best:
        return {
            "status": "unresolved",
            "bestCandidate": None,
            "candidates": [],
            "notes": ["no_candidates"],
        }
    has_identifier = bool(str(best.get("doi") or "").strip() or str(best.get("arxiv_id") or "").strip() or str(best.get("isbn") or "").strip())
    if float(best.get("score") or 0.0) < 0.55 or not has_identifier:
        return {
            "status": "unresolved",
            "bestCandidate": best,
            "candidates": scored[:10],
            "notes": ["low_confidence_or_missing_identifier"],
        }
    return {
        "status": "resolved",
        "bestCandidate": best,
        "candidates": scored[:10],
        "notes": [],
    }


def _crossref_candidates(*, title: str, authors: list[str]) -> list[dict[str, Any]]:
    params = {
        "query.title": title,
        "rows": "10",
    }
    if authors:
        params["query.author"] = authors[0]
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode(params)
    payload = _fetch_json(url)
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    items = message.get("items") if isinstance(message.get("items"), list) else []
    rows: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        row_title = str((item.get("title") or [""])[0] if isinstance(item.get("title"), list) else item.get("title") or "").strip()
        doi = _normalize_doi(item.get("DOI"))
        url = str(item.get("URL") or "").strip() or None
        year = _extract_crossref_year(item)
        row_authors = _crossref_authors(item.get("author"))
        isbn = _normalize_isbn((item.get("ISBN") or [None])[0] if isinstance(item.get("ISBN"), list) else item.get("ISBN"))
        rows.append(
            {
                "source": "crossref",
                "title": row_title,
                "authors": row_authors,
                "year": year,
                "doi": doi or None,
                "isbn": isbn or None,
                "arxiv_id": None,
                "source_uri": url,
            }
        )
    return rows


def _openalex_candidates(*, title: str, authors: list[str]) -> list[dict[str, Any]]:
    query = title if not authors else f"{title} {authors[0]}"
    params = {"search": query, "per-page": "10"}
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params)
    payload = _fetch_json(url)
    results = payload.get("results") if isinstance(payload.get("results"), list) else []
    rows: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        doi = _normalize_doi(item.get("doi"))
        row_authors = _openalex_authors(item.get("authorships"))
        location = item.get("primary_location") if isinstance(item.get("primary_location"), dict) else {}
        source_uri = str(location.get("pdf_url") or location.get("landing_page_url") or "").strip() or None
        rows.append(
            {
                "source": "openalex",
                "title": str(item.get("display_name") or "").strip(),
                "authors": row_authors,
                "year": _coerce_year(item.get("publication_year")),
                "doi": doi or None,
                "isbn": None,
                "arxiv_id": _normalize_arxiv_id(item.get("ids", {}).get("arxiv") if isinstance(item.get("ids"), dict) else None) or None,
                "source_uri": source_uri,
            }
        )
    return rows


def _score_candidate(candidate: dict[str, Any], *, title: str, authors: list[str]) -> dict[str, Any]:
    title_score = _token_overlap_score(title, str(candidate.get("title") or ""))
    author_score = _author_overlap_score(authors, candidate.get("authors") if isinstance(candidate.get("authors"), list) else [])
    year_score = 0.1 if candidate.get("year") else 0.0
    identifier_score = 0.2 if str(candidate.get("doi") or "").strip() else 0.1 if str(candidate.get("arxiv_id") or "").strip() else 0.05 if str(candidate.get("isbn") or "").strip() else 0.0
    score = min(1.0, (title_score * 0.6) + (author_score * 0.2) + year_score + identifier_score)
    return {
        **candidate,
        "score": round(score, 4),
        "titleScore": round(title_score, 4),
        "authorScore": round(author_score, 4),
    }


def _token_overlap_score(left: str, right: str) -> float:
    left_tokens = _tokens(left)
    right_tokens = _tokens(right)
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = left_tokens.intersection(right_tokens)
    return len(overlap) / max(len(left_tokens), len(right_tokens))


def _author_overlap_score(left: list[str], right: list[str]) -> float:
    left_tokens = {_author_key(value) for value in left if _author_key(value)}
    right_tokens = {_author_key(value) for value in right if _author_key(value)}
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens.intersection(right_tokens)) / max(len(left_tokens), len(right_tokens))


def _author_key(value: Any) -> str:
    text = re.sub(r"[^a-z0-9 ]+", " ", str(value or "").strip().lower())
    parts = [part for part in text.split() if part]
    return parts[-1] if parts else ""


def _tokens(value: Any) -> set[str]:
    text = re.sub(r"[^a-z0-9 ]+", " ", str(value or "").strip().lower())
    return {part for part in text.split() if len(part) > 2}


def _crossref_authors(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    rows: list[str] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        given = str(entry.get("given") or "").strip()
        family = str(entry.get("family") or "").strip()
        literal = str(entry.get("name") or "").strip()
        label = " ".join(part for part in [given, family] if part).strip() or literal
        if label:
            rows.append(label)
    return rows


def _openalex_authors(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    rows: list[str] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        author = entry.get("author") if isinstance(entry.get("author"), dict) else {}
        label = str(author.get("display_name") or "").strip()
        if label:
            rows.append(label)
    return rows


def _extract_crossref_year(item: dict[str, Any]) -> int | None:
    for key in ("published-print", "published-online", "issued"):
        payload = item.get(key)
        if not isinstance(payload, dict):
            continue
        parts = payload.get("date-parts")
        if not isinstance(parts, list) or not parts:
            continue
        first = parts[0]
        if not isinstance(first, list) or not first:
            continue
        year = _coerce_year(first[0])
        if year is not None:
            return year
    return None


def _fetch_json(url: str, *, timeout: int = 20) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Papyrus citation resolver/1.0"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Failed to fetch citation metadata from {url}: {error}") from error
    return payload if isinstance(payload, dict) else {}


def _metadata_object(reference: dict[str, Any]) -> dict[str, Any]:
    metadata = reference.get("metadata")
    if isinstance(metadata, dict):
        return dict(metadata)
    if isinstance(metadata, str):
        try:
            parsed = json.loads(metadata)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _primary_identifier_from_candidate(candidate: dict[str, Any]) -> dict[str, str] | None:
    for key in ("doi", "arxiv_id", "isbn"):
        value = str(candidate.get(key) or "").strip()
        if value:
            return {"type": key, "value": value}
    source_uri = str(candidate.get("source_uri") or "").strip()
    if source_uri:
        return {"type": "canonical_uri", "value": source_uri}
    return None


def _normalize_doi(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)", text)
    if match:
        return match.group(1)
    return ""


def _normalize_arxiv_id(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(\d{4}\.\d{4,5}(?:v\d+)?)", text, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    return ""


def _normalize_isbn(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    normalized = re.sub(r"[^0-9Xx]+", "", text)
    if len(normalized) in {10, 13}:
        return normalized.upper()
    return ""


def _coerce_year(value: Any) -> int | None:
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    if 1800 <= year <= 2200:
        return year
    return None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
