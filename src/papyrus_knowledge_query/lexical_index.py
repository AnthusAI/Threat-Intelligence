"""Stdlib BM25 lexical index for hybrid retrieval (gzipped JSON in corpora/)."""

from __future__ import annotations

import gzip
import json
import logging
import math
import os
import re
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


LOGGER = logging.getLogger(__name__)

LEXICAL_INDEX_VERSION = 1
DEFAULT_LEXICAL_INDEX_KEY = "corpora/knowledge-index/lexical/v1/index.json.gz"
DEFAULT_LEXICAL_MANIFEST_KEY = "corpora/knowledge-index/lexical/v1/manifest.json"
DEFAULT_K1 = 1.2
DEFAULT_B = 0.75
# Identifier extractors — patterns aligned with papyrus_content.reference_url_text
# normalizers (_normalize_doi / _normalize_arxiv_id / _normalize_isbn / _normalize_pmid).
DOI_RE = re.compile(r"\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)", re.IGNORECASE)
ARXIV_RE = re.compile(r"\b(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)\b", re.IGNORECASE)
ISBN_RE = re.compile(
    r"(?i)\b(?:isbn(?:-1[03])?[:\s]*)?((?:97[89][-\s]*)?(?:\d[-\s]*){8,12}[\dXx])\b"
)
PMID_RE = re.compile(r"\b(?:pmid[:\s]*)?(\d{5,9})\b", re.IGNORECASE)
CVE_RE = re.compile(r"\b(CVE-\d{4}-\d{4,7})\b", re.IGNORECASE)
HASH_RE = re.compile(r"\b([a-fA-F0-9]{32,64})\b")
ATTACK_RE = re.compile(r"\b(T\d{4}(?:\.\d{3})?)\b", re.IGNORECASE)
DOMAIN_RE = re.compile(
    r"\b((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})\b"
)
IP_RE = re.compile(
    r"\b((?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d))\b"
)

LEXICAL_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "into",
    "is", "it", "of", "on", "or", "our", "that", "the", "their", "this", "to", "we",
    "what", "with", "was", "were", "will", "can", "may", "not", "but", "if", "than",
    "pmid", "isbn", "doi", "arxiv",
}

_GENERIC_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9._-]{2,}")

_CACHE_LOCK = threading.Lock()
_CACHED_ARTIFACT: dict[str, Any] | None = None
_CACHED_SOURCE: str | None = None


def normalize_defanged_text(text: str) -> str:
    """One normalizer among several: undo common URL/IOC defanging."""
    if not text:
        return ""
    normalized = text
    normalized = re.sub(r"(?i)\bhxxps://", "https://", normalized)
    normalized = re.sub(r"(?i)\bhxxp://", "http://", normalized)
    normalized = re.sub(r"(?i)\bhxxp\b", "http", normalized)
    normalized = normalized.replace("[.]", ".").replace("(.)", ".")
    normalized = re.sub(r"(?i)\[at\]", "@", normalized)
    normalized = re.sub(r"(?i)\(at\)", "@", normalized)
    return normalized


# Back-compat alias used by earlier tests/callers.
normalize_defanged_iocs = normalize_defanged_text


def normalize_doi(value: Any) -> str:
    """Mirror reference_url_text._normalize_doi (lowercase for BM25)."""
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)", text, flags=re.IGNORECASE)
    if not match:
        return ""
    # Greedy class can swallow sentence punctuation; trim trailing non-DOI chars.
    return match.group(1).rstrip(".,;:)/").lower()


def normalize_arxiv_id(value: Any) -> str:
    """Mirror reference_url_text._normalize_arxiv_id."""
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(\d{4}\.\d{4,5}(?:v\d+)?)", text, flags=re.IGNORECASE)
    return match.group(1).lower() if match else ""


def normalize_isbn(value: Any) -> str:
    """Mirror reference_url_text._normalize_isbn."""
    text = str(value or "").strip()
    if not text:
        return ""
    normalized = re.sub(r"[^0-9Xx]+", "", text)
    if len(normalized) in {10, 13}:
        return normalized.upper()
    return ""


def normalize_pmid(value: Any) -> str:
    """Mirror reference_url_text._normalize_pmid."""
    text = str(value or "").strip()
    if not text:
        return ""
    digits = re.sub(r"[^0-9]+", "", text)
    return digits if len(digits) >= 5 else ""


def tokenize_lexical(text: str) -> list[str]:
    """Preserve publication identifiers as atomic terms for BM25.

    Handles academic identifiers (DOI, ISBN, arXiv, PMID) and security
    identifiers (CVE, hash, ATT&CK, domain, IP). Defanging is applied first as
    one normalizer among several — not the organizing idea.
    """
    source = normalize_defanged_text(text)
    if not source.strip():
        return []
    # Work on original casing for ISBN X-check; emit lowercase tokens except ISBN.
    search_text = source
    tokens: list[str] = []
    occupied: list[tuple[int, int]] = []

    def _occupy(start: int, end: int, token: str) -> None:
        if not token:
            return
        if any(not (end <= left or start >= right) for left, right in occupied):
            return
        tokens.append(token)
        occupied.append((start, end))

    for match in DOI_RE.finditer(search_text):
        token = normalize_doi(match.group(1))
        _occupy(match.start(1), match.end(1), token)

    for match in ARXIV_RE.finditer(search_text):
        token = normalize_arxiv_id(match.group(1))
        _occupy(match.start(1), match.end(1), token)

    for match in ISBN_RE.finditer(search_text):
        token = normalize_isbn(match.group(1))
        if token:
            _occupy(match.start(), match.end(), token.lower())

    for match in PMID_RE.finditer(search_text):
        # Only treat as PMID when explicitly labeled, or when left as bare digits
        # would steal ordinary numbers — require pmid prefix OR standalone long id
        # in a pmid: context. Bare 5-9 digit numbers are too ambiguous; require label.
        raw = match.group(0)
        if not re.match(r"(?i)pmid", raw):
            continue
        token = normalize_pmid(match.group(1))
        if token:
            _occupy(match.start(), match.end(), token)

    for match in CVE_RE.finditer(search_text):
        _occupy(match.start(1), match.end(1), match.group(1).lower())

    for match in HASH_RE.finditer(search_text):
        _occupy(match.start(1), match.end(1), match.group(1).lower())

    for match in ATTACK_RE.finditer(search_text):
        _occupy(match.start(1), match.end(1), match.group(1).lower())

    for match in IP_RE.finditer(search_text):
        _occupy(match.start(1), match.end(1), match.group(1))

    for match in DOMAIN_RE.finditer(search_text):
        _occupy(match.start(1), match.end(1), match.group(1).lower())

    lowered = search_text.lower()
    for match in _GENERIC_TOKEN_RE.finditer(lowered):
        start, end = match.span()
        if any(not (end <= left or start >= right) for left, right in occupied):
            continue
        token = match.group(0)
        if token in LEXICAL_STOPWORDS:
            continue
        # Avoid re-adding identifier fragments already captured.
        tokens.append(token)
    return tokens


def query_has_identifier(query: str) -> bool:
    """True when the query looks like an exact-identifier lookup (any family)."""
    text = normalize_defanged_text(query or "")
    if not text.strip():
        return False
    if normalize_doi(text):
        return True
    if normalize_arxiv_id(text):
        return True
    if normalize_isbn(text):
        return True
    if re.search(r"(?i)\bpmid[:\s]*\d{5,9}\b", text):
        return True
    if CVE_RE.search(text) or HASH_RE.search(text) or ATTACK_RE.search(text):
        return True
    if IP_RE.search(text):
        return True
    # Bare domain-only queries (no spaces) count as identifier lookups.
    stripped = text.strip()
    if DOMAIN_RE.fullmatch(stripped):
        return True
    return False


def _git_source_commit() -> str:
    """Best-effort source commit for the completeness manifest."""
    override = (os.environ.get("PAPYRUS_LEXICAL_SOURCE_COMMIT") or "").strip()
    if override:
        return override
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""
    try:
        dirty = subprocess.check_output(
            ["git", "status", "--porcelain"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        dirty = ""
    return f"{sha}{'+dirty' if dirty else ''}"


def lexical_manifest_from_artifact(artifact: dict[str, Any]) -> dict[str, Any]:
    """Return the completeness manifest embedded in (or derived from) an artifact."""
    embedded = artifact.get("manifest")
    if isinstance(embedded, dict) and embedded:
        return dict(embedded)
    docs = artifact.get("docs") or []
    refs = {
        str(doc.get("referenceLineageId") or "")
        for doc in docs
        if isinstance(doc, dict) and doc.get("referenceLineageId")
    }
    refs.discard("")
    return {
        "version": int(artifact.get("version") or LEXICAL_INDEX_VERSION),
        "referenceCount": len(refs),
        "chunkCount": len(docs),
        "builtAt": artifact.get("builtAt"),
        "sourceCommit": artifact.get("sourceCommit") or "",
    }


def build_lexical_index(
    documents: Iterable[dict[str, Any]],
    *,
    k1: float = DEFAULT_K1,
    b: float = DEFAULT_B,
    source_commit: str | None = None,
    eligible_count: int | None = None,
    skipped: dict[str, int] | None = None,
    corpus_id: str | None = None,
) -> dict[str, Any]:
    """Build a chunk-level BM25 artifact from passage documents.

    Each document requires: key, text, and optional metadata fields
    (referenceLineageId, chunkIndex, corpusId, curationStatus, title, storagePath).

    ``eligible_count`` / ``skipped`` record build-scope attrition so
    ``referenceCount`` has a denominator without a live GraphQL query.
    """
    docs: list[dict[str, Any]] = []
    postings: dict[str, list[list[int]]] = {}
    df: dict[str, int] = {}
    total_dl = 0
    reference_ids: set[str] = set()

    for raw in documents:
        key = str(raw.get("key") or "").strip()
        text = str(raw.get("text") or "")
        if not key or not text.strip():
            continue
        terms = tokenize_lexical(text)
        if not terms:
            continue
        tf: dict[str, int] = {}
        for term in terms:
            tf[term] = tf.get(term, 0) + 1
        doc_idx = len(docs)
        lineage = raw.get("referenceLineageId") or raw.get("lineageId")
        if lineage:
            reference_ids.add(str(lineage))
        docs.append(
            {
                "key": key,
                "referenceLineageId": lineage,
                "chunkIndex": raw.get("chunkIndex"),
                "corpusId": raw.get("corpusId"),
                "curationStatus": raw.get("curationStatus") or raw.get("curationStatusKey"),
                "title": raw.get("title"),
                "storagePath": raw.get("storagePath"),
                "dl": len(terms),
            }
        )
        total_dl += len(terms)
        for term, count in tf.items():
            df[term] = df.get(term, 0) + 1
            postings.setdefault(term, []).append([doc_idx, count])

    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    commit = (source_commit if source_commit is not None else _git_source_commit()).strip()
    avgdl = (total_dl / len(docs)) if docs else 0.0
    skipped_counts = {
        str(reason): int(count)
        for reason, count in (skipped or {}).items()
        if int(count or 0) > 0
    }
    indexed_count = len(reference_ids)
    resolved_eligible = int(eligible_count) if eligible_count is not None else indexed_count + sum(skipped_counts.values())
    manifest = {
        "version": LEXICAL_INDEX_VERSION,
        "referenceCount": indexed_count,
        "eligibleCount": resolved_eligible,
        "skippedTotal": sum(skipped_counts.values()),
        "skipped": skipped_counts,
        "chunkCount": len(docs),
        "builtAt": built_at,
        "sourceCommit": commit,
        "corpusId": (corpus_id or "").strip() or None,
    }
    artifact = {
        "version": LEXICAL_INDEX_VERSION,
        "builtAt": built_at,
        "sourceCommit": commit,
        "manifest": manifest,
        "k1": float(k1),
        "b": float(b),
        "avgdl": float(avgdl),
        "docs": docs,
        "df": df,
        "postings": postings,
    }
    inflated = len(json.dumps(artifact, separators=(",", ":")))
    artifact["inflatedBytes"] = inflated
    manifest["inflatedBytes"] = inflated
    return artifact


def dumps_lexical_index(artifact: dict[str, Any]) -> bytes:
    payload = {key: value for key, value in artifact.items() if key != "inflatedBytes"}
    return gzip.compress(json.dumps(payload, separators=(",", ":")).encode("utf-8"))


def dumps_lexical_manifest(artifact: dict[str, Any]) -> bytes:
    return json.dumps(
        lexical_manifest_from_artifact(artifact),
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def loads_lexical_index(raw: bytes) -> dict[str, Any]:
    text = gzip.decompress(raw).decode("utf-8")
    artifact = json.loads(text)
    if int(artifact.get("version") or 0) != LEXICAL_INDEX_VERSION:
        raise ValueError(f"unsupported lexical index version: {artifact.get('version')}")
    return artifact


def write_lexical_index(path: str | Path, artifact: dict[str, Any]) -> int:
    """Atomically write the gzipped index and a sibling manifest.json."""
    data = dumps_lexical_index(artifact)
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp_path.write_bytes(data)
        os.replace(temp_path, destination)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
    manifest_path = destination.with_name("manifest.json")
    manifest_tmp = destination.with_name(f".manifest.{uuid.uuid4().hex}.tmp")
    try:
        manifest_tmp.write_bytes(dumps_lexical_manifest(artifact))
        os.replace(manifest_tmp, manifest_path)
    finally:
        if manifest_tmp.exists():
            manifest_tmp.unlink(missing_ok=True)
    return len(data)


def read_lexical_index(path: str | Path) -> dict[str, Any]:
    return loads_lexical_index(Path(path).read_bytes())


def bm25_search(
    artifact: dict[str, Any],
    query: str,
    *,
    limit: int,
    scope: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    if limit <= 0 or not artifact.get("docs"):
        return []
    query_terms = tokenize_lexical(query)
    if not query_terms:
        return []
    docs = artifact["docs"]
    df = artifact.get("df") or {}
    postings = artifact.get("postings") or {}
    avgdl = float(artifact.get("avgdl") or 0.0) or 1.0
    k1 = float(artifact.get("k1") or DEFAULT_K1)
    b = float(artifact.get("b") or DEFAULT_B)
    n_docs = len(docs)

    scores: dict[int, float] = {}
    for term in set(query_terms):
        term_df = int(df.get(term) or 0)
        if term_df <= 0:
            continue
        idf = math.log(1.0 + (n_docs - term_df + 0.5) / (term_df + 0.5))
        for doc_idx, tf in postings.get(term) or []:
            doc = docs[int(doc_idx)]
            if not _doc_matches_scope(doc, scope):
                continue
            dl = float(doc.get("dl") or 0.0) or 1.0
            denom = float(tf) + k1 * (1.0 - b + b * dl / avgdl)
            scores[int(doc_idx)] = scores.get(int(doc_idx), 0.0) + idf * (float(tf) * (k1 + 1.0) / denom)

    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:limit]
    if not ranked:
        return []
    max_score = ranked[0][1] or 1.0
    matches: list[dict[str, Any]] = []
    for rank, (doc_idx, raw_score) in enumerate(ranked, start=1):
        doc = docs[doc_idx]
        normalized = max(0.0, min(1.0, float(raw_score) / max_score))
        matches.append(
            {
                "providerRank": rank,
                "rank": rank,
                "score": normalized,
                "bm25Score": float(raw_score),
                "kind": "reference",
                "id": doc.get("referenceLineageId"),
                "lineageId": doc.get("referenceLineageId"),
                "title": doc.get("title"),
                "summary": None,
                "metadata": {
                    "kind": "reference",
                    "lineageId": doc.get("referenceLineageId"),
                    "referenceLineageId": doc.get("referenceLineageId"),
                    "corpusId": doc.get("corpusId"),
                    "curationStatus": doc.get("curationStatus"),
                    "vectorKind": "reference_passage",
                    "chunkIndex": doc.get("chunkIndex"),
                    "storagePath": doc.get("storagePath"),
                    "passageKey": doc.get("key"),
                },
                "key": doc.get("key"),
            }
        )
    return matches


def _doc_matches_scope(doc: dict[str, Any], scope: dict[str, Any] | None) -> bool:
    if not scope:
        return True
    corpus_id = scope.get("corpusId")
    if isinstance(corpus_id, str) and corpus_id and str(doc.get("corpusId") or "") != corpus_id:
        return False
    curation = scope.get("curationStatus")
    if isinstance(curation, str) and curation:
        doc_status = str(doc.get("curationStatus") or "")
        if doc_status and doc_status != curation:
            return False
    return True


def lexical_index_s3_key() -> str:
    return (
        os.environ.get("PAPYRUS_LEXICAL_INDEX_S3_KEY")
        or DEFAULT_LEXICAL_INDEX_KEY
    ).strip()


def lexical_manifest_s3_key(index_key: str | None = None) -> str:
    override = (os.environ.get("PAPYRUS_LEXICAL_MANIFEST_S3_KEY") or "").strip()
    if override:
        return override
    key = (index_key or lexical_index_s3_key()).strip()
    if key.endswith("/index.json.gz"):
        return key[: -len("index.json.gz")] + "manifest.json"
    if "/" in key:
        return key.rsplit("/", 1)[0] + "/manifest.json"
    return DEFAULT_LEXICAL_MANIFEST_KEY


def clear_lexical_index_cache() -> None:
    global _CACHED_ARTIFACT, _CACHED_SOURCE
    with _CACHE_LOCK:
        _CACHED_ARTIFACT = None
        _CACHED_SOURCE = None


def _log_lexical_manifest(source: str, artifact: dict[str, Any]) -> None:
    manifest = lexical_manifest_from_artifact(artifact)
    LOGGER.info(
        "lexical index loaded source=%s references=%s chunks=%s builtAt=%s sourceCommit=%s",
        source,
        manifest.get("referenceCount"),
        manifest.get("chunkCount"),
        manifest.get("builtAt"),
        manifest.get("sourceCommit") or "-",
    )


def load_lexical_artifact(
    *,
    local_path: str | None = None,
    bucket_name: str | None = None,
    s3_key: str | None = None,
    region_name: str | None = None,
) -> dict[str, Any]:
    path = (local_path or os.environ.get("PAPYRUS_LEXICAL_INDEX_PATH") or "").strip()
    if path:
        source = f"file:{path}"
        with _CACHE_LOCK:
            global _CACHED_ARTIFACT, _CACHED_SOURCE
            if _CACHED_SOURCE == source and _CACHED_ARTIFACT is not None:
                return _CACHED_ARTIFACT
            artifact = read_lexical_index(path)
            _CACHED_ARTIFACT = artifact
            _CACHED_SOURCE = source
            _log_lexical_manifest(source, artifact)
            return artifact

    bucket = (bucket_name or os.environ.get("PAPYRUS_STORAGE_BUCKET_NAME") or "").strip()
    key = (s3_key or lexical_index_s3_key()).strip()
    if not bucket:
        raise FileNotFoundError("No PAPYRUS_LEXICAL_INDEX_PATH or PAPYRUS_STORAGE_BUCKET_NAME for lexical index")
    source = f"s3://{bucket}/{key}"
    with _CACHE_LOCK:
        if _CACHED_SOURCE == source and _CACHED_ARTIFACT is not None:
            return _CACHED_ARTIFACT
        import boto3  # type: ignore

        client = boto3.client("s3", region_name=region_name or os.environ.get("AWS_REGION") or "us-east-1")
        body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
        artifact = loads_lexical_index(body)
        _CACHED_ARTIFACT = artifact
        _CACHED_SOURCE = source
        _log_lexical_manifest(source, artifact)
        return artifact


def write_lexical_artifact_to_s3(
    artifact: dict[str, Any],
    *,
    bucket_name: str,
    s3_key: str | None = None,
    region_name: str | None = None,
) -> dict[str, Any]:
    """Write index+manifest via a temp key, then promote — never leave a partial canonical object."""
    key = (s3_key or lexical_index_s3_key()).strip()
    manifest_key = lexical_manifest_s3_key(key)
    data = dumps_lexical_index(artifact)
    manifest_data = dumps_lexical_manifest(artifact)
    import boto3  # type: ignore

    client = boto3.client("s3", region_name=region_name or os.environ.get("AWS_REGION") or "us-east-1")
    staging_key = f"{key}.building.{uuid.uuid4().hex}"
    try:
        client.put_object(Bucket=bucket_name, Key=staging_key, Body=data, ContentType="application/gzip")
        client.copy_object(
            Bucket=bucket_name,
            Key=key,
            CopySource={"Bucket": bucket_name, "Key": staging_key},
            MetadataDirective="COPY",
        )
        client.put_object(
            Bucket=bucket_name,
            Key=manifest_key,
            Body=manifest_data,
            ContentType="application/json",
        )
    finally:
        try:
            client.delete_object(Bucket=bucket_name, Key=staging_key)
        except Exception:  # noqa: BLE001 — best-effort staging cleanup
            LOGGER.warning("failed to delete lexical staging key s3://%s/%s", bucket_name, staging_key)
    clear_lexical_index_cache()
    manifest = lexical_manifest_from_artifact(artifact)
    return {
        "bucket": bucket_name,
        "key": key,
        "manifestKey": manifest_key,
        "bytes": len(data),
        "docs": len(artifact.get("docs") or []),
        "inflatedBytes": artifact.get("inflatedBytes"),
        "builtAt": artifact.get("builtAt"),
        "manifest": manifest,
    }


@dataclass
class BM25LexicalProvider:
    """SemanticSearchProvider-compatible BM25 search over the lexical artifact."""

    local_path: str | None = None
    bucket_name: str | None = None
    s3_key: str | None = None
    region_name: str | None = None
    name: str = "bm25-lexical"
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def search(self, query: str, scope: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        if not query.strip() or limit <= 0:
            return []
        artifact = self._load()
        return bm25_search(artifact, query, limit=limit, scope=scope)

    def _load(self) -> dict[str, Any]:
        with self._lock:
            return load_lexical_artifact(
                local_path=self.local_path,
                bucket_name=self.bucket_name,
                s3_key=self.s3_key,
                region_name=self.region_name,
            )


def _identifier_tokens_from_metadata(metadata: dict[str, Any]) -> list[str]:
    """Extract normalized identifier tokens from reference metadata fields.

    Identifiers often live in sourceUri/path (e.g. arXiv abs URLs) rather than
    body text. Emit only identifier atoms — not full titles — so BM25 does not
    flood natural-language queries with title vocabulary.
    """
    haystack = "\n".join(
        part
        for part in (
            str(metadata.get("title") or "").strip(),
            str(metadata.get("subtitle") or "").strip(),
            str(metadata.get("sourceUri") or "").strip(),
            str(metadata.get("storagePath") or "").strip(),
            str(metadata.get("externalItemId") or "").strip(),
        )
        if part
    )
    if not haystack:
        return []
    # Reuse the full tokenizer so DOI/arXiv/CVE/hash atoms are preserved; then
    # keep only terms that look like identifiers.
    tokens = tokenize_lexical(haystack)
    kept: list[str] = []
    for token in tokens:
        if (
            normalize_doi(token)
            or normalize_arxiv_id(token)
            or normalize_isbn(token)
            or (token.isdigit() and len(token) >= 5)  # PMID digits
            or CVE_RE.fullmatch(token)
            or HASH_RE.fullmatch(token)
            or ATTACK_RE.fullmatch(token)
            or IP_RE.fullmatch(token)
        ):
            kept.append(token)
    return kept


def passage_candidate_to_lexical_doc(candidate: dict[str, Any]) -> dict[str, Any] | None:
    metadata = candidate.get("metadata") if isinstance(candidate.get("metadata"), dict) else {}
    if metadata.get("vectorKind") != "reference_passage":
        return None
    body = str(candidate.get("text") or metadata.get("text") or "")
    key = str(candidate.get("key") or "").strip()
    if not key or not body.strip():
        return None
    id_tokens = _identifier_tokens_from_metadata(metadata)
    text = f"{' '.join(id_tokens)}\n\n{body}" if id_tokens else body
    return {
        "key": key,
        "text": text,
        "referenceLineageId": metadata.get("referenceLineageId") or metadata.get("lineageId"),
        "chunkIndex": metadata.get("chunkIndex"),
        "corpusId": metadata.get("corpusId"),
        "curationStatus": metadata.get("curationStatus") or metadata.get("curationStatusKey"),
        "title": metadata.get("title"),
        "storagePath": metadata.get("storagePath"),
    }


def audit_lexical_artifact(
    artifact: dict[str, Any] | None,
    accepted_reference_lineage_ids: set[str],
) -> dict[str, Any]:
    if artifact is None:
        return {
            "present": False,
            "docs": 0,
            "uniqueReferences": 0,
            "missingReferences": len(accepted_reference_lineage_ids),
            "staleReferences": 0,
            "manifest": None,
            "liveAcceptedReferenceCount": len(accepted_reference_lineage_ids),
            "manifestDrift": None,
        }
    refs = {
        str(doc.get("referenceLineageId") or "")
        for doc in artifact.get("docs") or []
        if doc.get("referenceLineageId")
    }
    refs.discard("")
    missing = sorted(accepted_reference_lineage_ids - refs)
    stale = sorted(refs - accepted_reference_lineage_ids)
    manifest = lexical_manifest_from_artifact(artifact)
    live_count = len(accepted_reference_lineage_ids)
    manifest_refs = int(manifest.get("referenceCount") or 0)
    manifest_chunks = int(manifest.get("chunkCount") or 0)
    eligible = int(manifest.get("eligibleCount") or 0)
    skipped_total = int(manifest.get("skippedTotal") or 0)
    skipped = manifest.get("skipped") if isinstance(manifest.get("skipped"), dict) else {}
    actual_chunks = len(artifact.get("docs") or [])
    warnings: list[str] = []
    if manifest_refs and manifest_refs != len(refs):
        warnings.append(
            f"Lexical manifest referenceCount={manifest_refs} disagrees with indexed unique references={len(refs)}"
        )
    if manifest_chunks and manifest_chunks != actual_chunks:
        warnings.append(
            f"Lexical manifest chunkCount={manifest_chunks} disagrees with indexed chunks={actual_chunks}"
        )
    drift = abs(manifest_refs - live_count) if manifest_refs else abs(len(refs) - live_count)
    internally_complete = bool(
        eligible
        and manifest_refs + skipped_total == eligible
        and skipped_total == sum(int(v or 0) for v in skipped.values())
    )
    if drift:
        if internally_complete and live_count == eligible and skipped:
            warnings.append(
                f"Lexical index covers {manifest_refs}/{eligible} eligible references; "
                f"skippedByReason={json.dumps(skipped, sort_keys=True)} "
                f"(live={live_count}, drift={drift} explained by attrition)"
            )
        else:
            warnings.append(
                f"Lexical index reference count diverges from live accepted listing "
                f"(manifest={manifest_refs or len(refs)}, live={live_count}, drift={drift})"
            )
            if eligible and manifest_refs + skipped_total != eligible:
                warnings.append(
                    f"Lexical manifest is internally incomplete: "
                    f"referenceCount({manifest_refs})+skippedTotal({skipped_total}) != eligibleCount({eligible})"
                )
    return {
        "present": True,
        "docs": actual_chunks,
        "uniqueReferences": len(refs),
        "missingReferences": len(missing),
        "missingReferenceSample": missing[:20],
        "staleReferences": len(stale),
        "staleReferenceSample": stale[:20],
        "builtAt": artifact.get("builtAt"),
        "inflatedBytes": artifact.get("inflatedBytes"),
        "manifest": manifest,
        "liveAcceptedReferenceCount": live_count,
        "manifestDrift": drift,
        "internallyComplete": internally_complete,
        "warnings": warnings,
    }
