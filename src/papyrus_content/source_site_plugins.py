from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable

DEFAULT_IDENTIFIER_PRECEDENCE = (
    "arxiv_id",
    "doi",
    "youtube_video_id",
    "canonical_uri",
    "source_uri",
)


class SourceSitePlugin:
    key = "default"

    def match(self, source_uri: str) -> bool:
        raise NotImplementedError

    def enrich(self, *, reference: dict[str, Any], source_uri: str, fetcher: Callable[[str], str]) -> dict[str, Any]:
        raise NotImplementedError


class ArxivSourcePlugin(SourceSitePlugin):
    key = "arxiv"

    _ID_PATTERN = re.compile(r"^/(?:abs|pdf|html|src)/([^/?#]+)", flags=re.IGNORECASE)

    def match(self, source_uri: str) -> bool:
        parsed = urllib.parse.urlparse(source_uri)
        host = (parsed.hostname or "").lower()
        return host == "arxiv.org" and bool(self._ID_PATTERN.match(parsed.path or ""))

    def enrich(self, *, reference: dict[str, Any], source_uri: str, fetcher: Callable[[str], str]) -> dict[str, Any]:
        paper_id = self._paper_id_from_uri(source_uri)
        if not paper_id:
            return {
                "pluginKey": self.key,
                "canonicalSourceUri": source_uri,
                "sourceVariants": {"inputUrl": source_uri},
                "identifiers": {
                    "resolved": {},
                    "candidates": [],
                    "primary": None,
                    "warnings": [
                        {
                            "code": "arxiv_id_unresolved",
                            "message": "Could not parse arXiv identifier from source URI.",
                        }
                    ],
                },
                "metadata": {},
                "attachmentMetadata": {},
                "warnings": [
                    {
                        "code": "arxiv_id_unresolved",
                        "message": "Could not parse arXiv identifier from source URI.",
                    }
                ],
            }

        canonical_pdf_url = f"https://arxiv.org/pdf/{paper_id}"
        canonical_abs_url = f"https://arxiv.org/abs/{paper_id}"
        canonical_html_url = f"https://arxiv.org/html/{paper_id}"

        abstract = ""
        doi = ""
        warnings: list[dict[str, Any]] = []
        try:
            abs_body = fetcher(canonical_abs_url)
            abstract = _arxiv_abstract_from_html(abs_body)
            doi = _arxiv_doi_from_html(abs_body)
        except Exception as error:  # pragma: no cover - network errors are mocked in tests
            warnings.append(
                {
                    "code": "arxiv_abs_fetch_failed",
                    "message": str(error),
                    "url": canonical_abs_url,
                }
            )

        resolved: dict[str, str] = {"arxiv_id": paper_id}
        if doi:
            resolved["doi"] = doi
        candidates = [
            {
                "type": "arxiv_id",
                "value": paper_id,
                "source": "arxiv_url",
                "confidence": 1.0,
                "rank": 10,
            }
        ]
        if doi:
            candidates.append(
                {
                    "type": "doi",
                    "value": doi,
                    "source": "arxiv_abs_metadata",
                    "confidence": 0.95,
                    "rank": 20,
                }
            )

        now = _utc_now()
        return {
            "pluginKey": self.key,
            "canonicalSourceUri": canonical_pdf_url,
            "sourceVariants": {
                "inputUrl": source_uri,
                "canonicalPdfUrl": canonical_pdf_url,
                "canonicalAbsUrl": canonical_abs_url,
                "canonicalHtmlUrl": canonical_html_url,
            },
            "identifiers": {
                "resolved": resolved,
                "candidates": candidates,
                "primary": {"type": "arxiv_id", "value": paper_id},
                "warnings": list(warnings),
            },
            "metadata": {
                "paperId": paper_id,
                "versionedId": paper_id,
                "doi": doi,
                "canonicalPdfUrl": canonical_pdf_url,
                "canonicalAbsUrl": canonical_abs_url,
                "canonicalHtmlUrl": canonical_html_url,
                "abstract": abstract,
                "abstractSource": "arxiv_abs_structured" if abstract else "",
                "resolvedAt": now,
            },
            "attachmentMetadata": {
                "sitePlugin": self.key,
                "canonicalPdfUrl": canonical_pdf_url,
                "canonicalAbsUrl": canonical_abs_url,
                "canonicalHtmlUrl": canonical_html_url,
                "resolvedAt": now,
            },
            "warnings": warnings,
        }

    def _paper_id_from_uri(self, source_uri: str) -> str:
        parsed = urllib.parse.urlparse(source_uri)
        match = self._ID_PATTERN.match(parsed.path or "")
        if not match:
            return ""
        token = re.sub(r"\.pdf$", "", match.group(1), flags=re.IGNORECASE)
        return token.strip()


class YouTubeSourcePlugin(SourceSitePlugin):
    key = "youtube"

    def match(self, source_uri: str) -> bool:
        parsed = urllib.parse.urlparse(source_uri)
        host = (parsed.hostname or "").lower()
        return host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}

    def enrich(self, *, reference: dict[str, Any], source_uri: str, fetcher: Callable[[str], str]) -> dict[str, Any]:
        video_id = _youtube_video_id_from_uri(source_uri)
        canonical_uri = f"https://www.youtube.com/watch?v={video_id}" if video_id else source_uri
        warnings = [
            {
                "code": "youtube_enrichment_not_implemented",
                "message": "YouTube plugin currently resolves URI + video id only; deeper metadata extraction is not implemented.",
            }
        ]
        resolved = {"youtube_video_id": video_id} if video_id else {}
        candidates = (
            [
                {
                    "type": "youtube_video_id",
                    "value": video_id,
                    "source": "youtube_url",
                    "confidence": 1.0,
                    "rank": 10,
                }
            ]
            if video_id
            else []
        )
        return {
            "pluginKey": self.key,
            "canonicalSourceUri": canonical_uri,
            "sourceVariants": {
                "inputUrl": source_uri,
                "canonicalWatchUrl": canonical_uri,
            },
            "identifiers": {
                "resolved": resolved,
                "candidates": candidates,
                "primary": {"type": "youtube_video_id", "value": video_id} if video_id else None,
                "warnings": list(warnings),
            },
            "metadata": {
                "videoId": video_id,
                "canonicalWatchUrl": canonical_uri,
                "resolvedAt": _utc_now(),
            },
            "attachmentMetadata": {
                "sitePlugin": self.key,
                "canonicalWatchUrl": canonical_uri,
                "resolvedAt": _utc_now(),
            },
            "warnings": warnings,
        }


_PLUGINS: tuple[SourceSitePlugin, ...] = (
    ArxivSourcePlugin(),
    YouTubeSourcePlugin(),
)


def resolve_source_site_enrichment(
    *,
    reference: dict[str, Any],
    source_uri: str,
    fetcher: Callable[[str], str] | None = None,
) -> dict[str, Any]:
    normalized_source = _normalize_http_url(source_uri)
    if not normalized_source:
        return _finalize_enrichment(
            {
                "pluginKey": "default",
                "canonicalSourceUri": source_uri,
                "sourceVariants": {"inputUrl": source_uri},
                "identifiers": {"resolved": {}, "candidates": [], "primary": None, "warnings": []},
                "metadata": {},
                "attachmentMetadata": {},
                "warnings": [],
            },
            source_uri=source_uri,
        )

    active_fetcher = fetcher or _fetch_url_text
    for plugin in _PLUGINS:
        if plugin.match(normalized_source):
            enriched = plugin.enrich(reference=reference, source_uri=normalized_source, fetcher=active_fetcher)
            return _finalize_enrichment(enriched, source_uri=normalized_source)

    return _finalize_enrichment(
        {
            "pluginKey": "default",
            "canonicalSourceUri": normalized_source,
            "sourceVariants": {"inputUrl": normalized_source},
            "identifiers": {
                "resolved": {},
                "candidates": [],
                "primary": None,
                "warnings": [
                    {
                        "code": "no_site_plugin_match",
                        "message": "No site plugin matched source URI; proceeding with generic extraction.",
                    }
                ],
            },
            "metadata": {},
            "attachmentMetadata": {},
            "warnings": [],
        },
        source_uri=normalized_source,
    )


def _finalize_enrichment(enriched: dict[str, Any], *, source_uri: str) -> dict[str, Any]:
    plugin_key = str(enriched.get("pluginKey") or "default")
    canonical_uri = _normalize_http_url(enriched.get("canonicalSourceUri")) or source_uri
    identifiers = enriched.get("identifiers") if isinstance(enriched.get("identifiers"), dict) else {}
    resolved = identifiers.get("resolved") if isinstance(identifiers.get("resolved"), dict) else {}
    resolved = {str(key): str(value) for key, value in resolved.items() if str(value).strip()}
    resolved.setdefault("source_uri", source_uri)
    resolved.setdefault("canonical_uri", canonical_uri)

    candidates = identifiers.get("candidates") if isinstance(identifiers.get("candidates"), list) else []
    normalized_candidates: list[dict[str, Any]] = []
    for row in candidates:
        if not isinstance(row, dict):
            continue
        id_type = str(row.get("type") or "").strip()
        value = str(row.get("value") or "").strip()
        if not id_type or not value:
            continue
        normalized_candidates.append(
            {
                "type": id_type,
                "value": value,
                "source": str(row.get("source") or plugin_key),
                "confidence": float(row.get("confidence") or 0.0),
                "rank": int(row.get("rank") or 999),
            }
        )

    normalized_candidates.extend(
        [
            {
                "type": "source_uri",
                "value": source_uri,
                "source": "reference_source_uri",
                "confidence": 1.0,
                "rank": 900,
            },
            {
                "type": "canonical_uri",
                "value": canonical_uri,
                "source": f"{plugin_key}_canonical_uri",
                "confidence": 1.0,
                "rank": 890,
            },
        ]
    )

    deduped_candidates: list[dict[str, Any]] = []
    seen = set()
    for candidate in sorted(normalized_candidates, key=lambda row: (int(row.get("rank") or 999), row.get("type"), row.get("value"))):
        key = (candidate["type"], candidate["value"], candidate["source"])
        if key in seen:
            continue
        seen.add(key)
        deduped_candidates.append(candidate)

    primary = identifiers.get("primary") if isinstance(identifiers.get("primary"), dict) else None
    if not primary or not primary.get("type") or not primary.get("value"):
        primary = _select_primary_identifier(resolved=resolved, candidates=deduped_candidates)

    identifier_warnings = identifiers.get("warnings") if isinstance(identifiers.get("warnings"), list) else []
    warnings = list(enriched.get("warnings") or [])
    warnings.extend(identifier_warnings)

    metadata = enriched.get("metadata") if isinstance(enriched.get("metadata"), dict) else {}
    attachment_metadata = enriched.get("attachmentMetadata") if isinstance(enriched.get("attachmentMetadata"), dict) else {}

    return {
        "pluginKey": plugin_key,
        "canonicalSourceUri": canonical_uri,
        "sourceVariants": enriched.get("sourceVariants") if isinstance(enriched.get("sourceVariants"), dict) else {"inputUrl": source_uri},
        "identifiers": {
            "resolved": resolved,
            "candidates": deduped_candidates,
            "primary": primary,
            "warnings": warnings,
        },
        "metadata": metadata,
        "attachmentMetadata": attachment_metadata,
        "warnings": warnings,
    }


def _select_primary_identifier(*, resolved: dict[str, str], candidates: list[dict[str, Any]]) -> dict[str, str] | None:
    for key in DEFAULT_IDENTIFIER_PRECEDENCE:
        value = str(resolved.get(key) or "").strip()
        if value:
            return {"type": key, "value": value}
    for candidate in candidates:
        value = str(candidate.get("value") or "").strip()
        if value:
            return {"type": str(candidate.get("type") or "unknown"), "value": value}
    return None


def _youtube_video_id_from_uri(source_uri: str) -> str:
    parsed = urllib.parse.urlparse(source_uri)
    host = (parsed.hostname or "").lower()
    if host == "youtu.be":
        token = (parsed.path or "").strip("/")
        return token.split("/")[0] if token else ""
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        query = urllib.parse.parse_qs(parsed.query or "")
        candidate = ""
        if query.get("v"):
            candidate = str(query["v"][0])
        elif parsed.path.startswith("/shorts/"):
            candidate = parsed.path.removeprefix("/shorts/").split("/")[0]
        return candidate.strip()
    return ""


def _fetch_url_text(url: str, *, timeout: int = 20) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Papyrus source-site plugin"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310 - fixed web fetch URL
        raw = response.read()
    return raw.decode("utf-8", errors="replace")


def _arxiv_abstract_from_html(html: str) -> str:
    for payload in _extract_json_ld_payloads(html):
        abstract = _json_ld_lookup(payload, keys=("description", "abstract"))
        if abstract:
            return _clean_text(abstract)

    meta_match = re.search(
        r'<meta[^>]+name=["\'](?:description|citation_abstract)["\'][^>]+content=["\']([^"\']+)["\']',
        html,
        flags=re.IGNORECASE,
    )
    if meta_match:
        return _clean_text(meta_match.group(1))
    return ""


def _arxiv_doi_from_html(html: str) -> str:
    for payload in _extract_json_ld_payloads(html):
        doi_value = _json_ld_find_doi(payload)
        if doi_value:
            return doi_value

    meta_match = re.search(
        r'<meta[^>]+name=["\']citation_doi["\'][^>]+content=["\']([^"\']+)["\']',
        html,
        flags=re.IGNORECASE,
    )
    if meta_match:
        return _clean_text(meta_match.group(1))
    return ""


def _extract_json_ld_payloads(html: str) -> list[Any]:
    payloads: list[Any] = []
    for match in re.finditer(
        r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        block = (match.group(1) or "").strip()
        if not block:
            continue
        try:
            payload = json.loads(block)
        except json.JSONDecodeError:
            continue
        payloads.append(payload)
    return payloads


def _json_ld_lookup(payload: Any, *, keys: tuple[str, ...]) -> str:
    queue = [payload]
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            for key in keys:
                value = current.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            for value in current.values():
                queue.append(value)
        elif isinstance(current, list):
            queue.extend(current)
    return ""


def _json_ld_find_doi(payload: Any) -> str:
    queue = [payload]
    doi_pattern = re.compile(r"10\.\d{4,9}/\S+", flags=re.IGNORECASE)
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            identifier = current.get("identifier")
            if isinstance(identifier, dict):
                prop = str(identifier.get("propertyID") or "").strip().lower()
                value = str(identifier.get("value") or "").strip()
                if prop == "doi" and value:
                    return value
            if isinstance(identifier, list):
                queue.extend(identifier)
            if isinstance(identifier, str):
                match = doi_pattern.search(identifier)
                if match:
                    return match.group(0)
            same_as = current.get("sameAs")
            if isinstance(same_as, str):
                match = doi_pattern.search(same_as)
                if match:
                    return match.group(0)
            elif isinstance(same_as, list):
                queue.extend(same_as)
            for value in current.values():
                queue.append(value)
        elif isinstance(current, list):
            queue.extend(current)
        elif isinstance(current, str):
            match = doi_pattern.search(current)
            if match:
                return match.group(0)
    return ""


def _normalize_http_url(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return raw


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
