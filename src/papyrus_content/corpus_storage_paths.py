from __future__ import annotations

import re

from .ids import safe_id


def corpus_storage_segment(corpus_key: str) -> str:
    """Canonical lowercase kebab segment for S3 keys and local corpus roots."""
    return safe_id(corpus_key)


def corpus_storage_path_prefix(corpus_key: str) -> str:
    return f"corpora/{corpus_storage_segment(corpus_key)}"


def legacy_mixed_case_corpus_segment(canonical_segment: str) -> str:
    """Historical steering-key style segment (e.g. ai-ml-research -> AI-ML-research)."""
    parts = [part for part in canonical_segment.split("-") if part]
    if not parts:
        return canonical_segment
    return "-".join(part.upper() if len(part) <= 3 else part for part in parts)


def legacy_corpus_storage_segment(corpus_key: str) -> str:
    token = re.sub(r"[^A-Za-z0-9._-]+", "-", str(corpus_key or "").strip()).strip("-")
    return token[:180] or corpus_storage_segment(corpus_key)


def rewrite_corpus_storage_path(storage_path: str | None, *, corpus_key: str | None = None) -> str | None:
    if not storage_path or not isinstance(storage_path, str):
        return storage_path
    trimmed = storage_path.strip()
    if not trimmed.startswith("corpora/"):
        return trimmed
    parts = trimmed.split("/", 2)
    if len(parts) < 3:
        return trimmed
    _, segment, tail = parts
    canonical_segment = corpus_storage_segment(corpus_key or segment)
    return f"corpora/{canonical_segment}/{tail}"


def corpus_storage_path_read_candidates(storage_path: str) -> list[str]:
    if not storage_path or not storage_path.strip():
        return []
    trimmed = storage_path.strip()
    candidates = [trimmed]
    if not trimmed.startswith("corpora/"):
        return candidates
    parts = trimmed.split("/", 2)
    if len(parts) < 3:
        return candidates
    _, segment, tail = parts
    canonical_segment = safe_id(segment)
    if canonical_segment and canonical_segment != segment:
        candidates.append(f"corpora/{canonical_segment}/{tail}")
    legacy_segment = legacy_mixed_case_corpus_segment(canonical_segment or segment)
    if legacy_segment and legacy_segment != segment:
        candidates.append(f"corpora/{legacy_segment}/{tail}")
    legacy_token_segment = legacy_corpus_storage_segment(segment)
    if legacy_token_segment and legacy_token_segment not in {segment, canonical_segment, legacy_segment}:
        candidates.append(f"corpora/{legacy_token_segment}/{tail}")
    return list(dict.fromkeys(candidates))


def default_corpus_path(corpus: dict[str, object]) -> str:
    key = str(corpus.get("key") or corpus.get("name") or "").strip()
    configured = corpus.get("path")
    if isinstance(configured, str) and configured.strip():
        return configured.strip()
    if not key:
        raise ValueError("Corpus is missing key.")
    return corpus_storage_path_prefix(key)
