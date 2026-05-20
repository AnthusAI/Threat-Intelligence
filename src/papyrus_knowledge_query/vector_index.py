from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

from .engine import _chunk_text, _clean_text, object_title
from .services import GraphQLKnowledgeGraphProvider, KnowledgeQueryServices


LIST_REFERENCES_QUERY = """
query ListReferences($limit: Int, $nextToken: String) {
  listReferences(limit: $limit, nextToken: $nextToken) {
    items {
      id lineageId versionNumber versionState corpusId externalItemId title authors sourceUri storagePath mediaType
      sourcePublishedAt sourceUpdatedAt curationStatus curationStatusKey updatedAt
    }
    nextToken
  }
}
"""


@dataclass(frozen=True)
class VectorIndexOptions:
    action: str = "sync"
    corpus_id: str = ""
    category_set_id: str = ""
    reference_ids: tuple[str, ...] = ()
    max_references: int | None = None
    max_chunks_per_reference: int = 8
    chunk_words: int = 180
    batch_size: int = 50
    include_source_vectors: bool = True
    include_passage_vectors: bool = True
    force: bool = False
    dry_run: bool = False
    progress_every: int = 25
    worker_count: int = 8


def index_reference_passages(services: KnowledgeQueryServices, options: VectorIndexOptions) -> dict[str, Any]:
    if not hasattr(services.graph, "graphql") or not hasattr(services.graph, "list_reference_attachments"):
        raise RuntimeError("knowledge vector indexing requires an AppSync GraphQL provider")
    if services.corpus_text is None:
        raise RuntimeError("knowledge vector indexing requires a corpus text provider")
    if options.action not in {"audit", "sync", "rebuild"}:
        raise RuntimeError(f"unsupported vector index action: {options.action}")

    vector_index_arn = os.environ.get("PAPYRUS_S3_VECTOR_INDEX_ARN") or _vector_index_from_outputs()
    if not vector_index_arn:
        raise RuntimeError("Missing PAPYRUS_S3_VECTOR_INDEX_ARN and custom.knowledgeQuery.s3VectorIndexArn")

    all_references = _list_references(services.graph)
    accepted_references = [reference for reference in all_references if _reference_is_accepted(reference)]
    references = [
        reference for reference in accepted_references
        if (not options.corpus_id or reference.get("corpusId") == options.corpus_id)
        and (not options.reference_ids or _reference_matches(reference, options.reference_ids))
    ]
    if options.max_references:
        references = references[: options.max_references]

    existing_vectors = _list_index_vectors(vector_index_arn)
    existing_keys = {str(vector.get("key")) for vector in existing_vectors if vector.get("key")}
    existing_reference_keys = _indexed_reference_keys(existing_vectors)
    stats = {
        "action": options.action,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "totalReferences": len(all_references),
        "acceptedReferences": len(accepted_references),
        "referencesScanned": len(references),
        "existingVectors": len(existing_vectors),
        "existingIndexedReferences": len(existing_reference_keys),
        "referencesWithExtractedText": 0,
        "referencesPrepared": 0,
        "sourceVectorsPrepared": 0,
        "passageVectorsPrepared": 0,
        "vectorsPrepared": 0,
        "vectorsSkippedExisting": 0,
        "vectorsToWrite": 0,
        "vectorsWritten": 0,
        "embeddingRequests": 0,
        "embeddingInputCharacters": 0,
        "dryRun": options.dry_run,
        "vectorIndexArn": vector_index_arn,
        "indexedReferenceSample": sorted(existing_reference_keys)[:20],
        "failures": [],
        "warnings": [],
    }
    started = time.perf_counter()
    if options.action == "audit":
        selected_keys = _reference_key_set(references)
        missing = sorted(selected_keys - existing_reference_keys)
        stats["missingIndexedReferences"] = len(missing)
        stats["missingIndexedReferenceSample"] = missing[:20]
        return stats

    if options.action == "rebuild" and existing_keys and not options.dry_run:
        _delete_vectors(vector_index_arn, sorted(existing_keys))
        existing_keys = set()
        existing_reference_keys = set()
        stats["vectorsDeleted"] = len(existing_vectors)

    pending_vectors: list[dict[str, Any]] = []
    completed = 0
    worker_count = max(1, int(options.worker_count or 1))
    if worker_count == 1 or len(references) <= 1:
        prepared_results = (_prepare_reference_for_indexing(services, reference, options) for reference in references)
        for result in prepared_results:
            completed += 1
            pending_vectors = _consume_prepared_reference(result, stats, existing_keys, pending_vectors, vector_index_arn, options)
            _maybe_report_progress(completed, len(references), stats, options)
    else:
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(_prepare_reference_for_indexing, services, reference, options) for reference in references]
            for future in as_completed(futures):
                completed += 1
                pending_vectors = _consume_prepared_reference(future.result(), stats, existing_keys, pending_vectors, vector_index_arn, options)
                _maybe_report_progress(completed, len(references), stats, options)

    if pending_vectors and not options.dry_run:
        stats["vectorsWritten"] += _embed_and_put_vectors(vector_index_arn, pending_vectors)
        stats["embeddingRequests"] += 1
        stats["embeddingInputCharacters"] += sum(len(vector["text"]) for vector in pending_vectors)
    selected_keys = _reference_key_set(references)
    stats["missingIndexedReferencesBeforeRun"] = len(selected_keys - existing_reference_keys)
    stats["elapsedSeconds"] = round(time.perf_counter() - started, 3)
    stats["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return stats


def _prepare_reference_for_indexing(
    services: KnowledgeQueryServices,
    reference: dict[str, Any],
    options: VectorIndexOptions,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "referenceId": reference.get("id"),
        "referenceLineageId": reference.get("lineageId"),
        "hasExtractedText": False,
        "candidates": [],
        "warnings": [],
        "failures": [],
    }
    try:
        attachments = services.graph.list_reference_attachments(reference)  # type: ignore[union-attr]
    except Exception as exc:  # pragma: no cover - defensive runtime reporting
        result["failures"].append({"referenceId": reference.get("id"), "stage": "attachments", "error": str(exc)})
        return result
    extracted = next(
        (attachment for attachment in attachments if attachment.get("role") == "extracted_text" and attachment.get("storagePath")),
        None,
    )
    if not extracted:
        result["warnings"].append(f"missing extracted text attachment for {reference.get('id')}")
        return result
    result["hasExtractedText"] = True
    try:
        text = services.corpus_text.read_text(str(extracted["storagePath"]))  # type: ignore[union-attr]
    except Exception as exc:  # pragma: no cover - defensive runtime reporting
        result["failures"].append({"referenceId": reference.get("id"), "stage": "read_text", "error": str(exc)})
        return result
    if not text:
        result["warnings"].append(f"empty extracted text for {reference.get('id')}")
        return result
    result["candidates"] = _prepare_reference_vectors(text, reference, str(extracted["storagePath"]), options)
    return result


def _consume_prepared_reference(
    result: dict[str, Any],
    stats: dict[str, Any],
    existing_keys: set[str],
    pending_vectors: list[dict[str, Any]],
    vector_index_arn: str,
    options: VectorIndexOptions,
) -> list[dict[str, Any]]:
    stats["warnings"].extend(result.get("warnings") or [])
    stats["failures"].extend(result.get("failures") or [])
    if result.get("hasExtractedText"):
        stats["referencesWithExtractedText"] += 1
    candidates = [candidate for candidate in result.get("candidates") or [] if isinstance(candidate, dict)]
    if candidates:
        stats["referencesPrepared"] += 1
    for candidate in candidates:
        stats["vectorsPrepared"] += 1
        if candidate["metadata"].get("vectorKind") == "reference_summary":
            stats["sourceVectorsPrepared"] += 1
        elif candidate["metadata"].get("vectorKind") == "reference_passage":
            stats["passageVectorsPrepared"] += 1
        if not options.force and candidate["key"] in existing_keys:
            stats["vectorsSkippedExisting"] += 1
            continue
        stats["vectorsToWrite"] += 1
        if options.dry_run:
            continue
        pending_vectors.append(candidate)
        if len(pending_vectors) >= options.batch_size:
            stats["vectorsWritten"] += _embed_and_put_vectors(vector_index_arn, pending_vectors)
            stats["embeddingRequests"] += 1
            stats["embeddingInputCharacters"] += sum(len(vector["text"]) for vector in pending_vectors)
            pending_vectors = []
    return pending_vectors


def _maybe_report_progress(completed: int, total: int, stats: dict[str, Any], options: VectorIndexOptions) -> None:
    if not options.progress_every or completed % options.progress_every != 0:
        return
    _progress(
        f"vector-index {completed}/{total} refs; prepared={stats['vectorsPrepared']} "
        f"skipped={stats['vectorsSkippedExisting']} to_write={stats['vectorsToWrite']} written={stats['vectorsWritten']}"
    )


def _prepare_reference_vectors(
    text: str,
    reference: dict[str, Any],
    storage_path: str,
    options: VectorIndexOptions,
) -> list[dict[str, Any]]:
    vectors: list[dict[str, Any]] = []
    if options.include_source_vectors:
        source_vector = _prepare_source_vector(text, reference, storage_path, options)
        if source_vector:
            vectors.append(source_vector)
    if options.include_passage_vectors:
        vectors.extend(_prepare_chunks(text, reference, storage_path, options))
    return vectors


def _prepare_source_vector(
    text: str,
    reference: dict[str, Any],
    storage_path: str,
    options: VectorIndexOptions,
) -> dict[str, Any] | None:
    clean = _clean_text(text)
    if len(clean) < 80:
        return None
    title = object_title(reference) or reference.get("id") or "Reference"
    source_text = _clean_text(
        "\n\n".join(
            part for part in (
                str(title),
                _authors_text(reference),
                str(reference.get("sourceUri") or ""),
                clean[:2400],
            )
            if part
        )
    )
    digest = hashlib.sha256(str(reference.get("lineageId") or reference.get("id") or title).encode("utf-8")).hexdigest()[:20]
    return {
        "key": f"reference-summary-{digest}",
        "text": source_text,
        "metadata": {
            **_base_reference_metadata(reference, options),
            "vectorKind": "reference_summary",
            "summary": source_text[:900],
            "text": source_text[:2400],
            "sourceUri": reference.get("sourceUri"),
            "storagePath": storage_path,
        },
    }


def _prepare_chunks(text: str, reference: dict[str, Any], storage_path: str, options: VectorIndexOptions) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for index, chunk in enumerate(_chunk_text(text, target_words=options.chunk_words)):
        clean = _clean_text(chunk["text"])
        if len(clean) < 120:
            continue
        digest = hashlib.sha256(f"{reference.get('lineageId') or reference.get('id')}:{storage_path}:{index}".encode("utf-8")).hexdigest()[:20]
        chunks.append({
            "key": f"reference-passage-{digest}",
            "text": clean,
            "metadata": {
                **_base_reference_metadata(reference, options),
                "vectorKind": "reference_passage",
                "summary": clean[:600],
                "text": clean[:1800],
                "sourceUri": reference.get("sourceUri"),
                "storagePath": storage_path,
                "chunkIndex": index,
                "startChar": chunk.get("start"),
                "endChar": chunk.get("end"),
            },
        })
        if len(chunks) >= options.max_chunks_per_reference:
            break
    return chunks


def _base_reference_metadata(reference: dict[str, Any], options: VectorIndexOptions) -> dict[str, Any]:
    title = object_title(reference) or reference.get("id") or "Reference"
    return {
        "kind": "reference",
        "id": reference.get("id"),
        "lineageId": reference.get("lineageId"),
        "referenceId": reference.get("id"),
        "referenceLineageId": reference.get("lineageId"),
        "corpusId": reference.get("corpusId"),
        "categorySetId": options.category_set_id,
        "title": title,
        "curationStatus": reference.get("curationStatus"),
        "curationStatusKey": reference.get("curationStatusKey"),
    }


def _authors_text(reference: dict[str, Any]) -> str:
    authors = reference.get("authors")
    if isinstance(authors, list):
        return ", ".join(str(author) for author in authors if author)
    return str(authors or "")


def _reference_is_accepted(reference: dict[str, Any]) -> bool:
    return (
        reference.get("versionState") == "current"
        and (
            reference.get("curationStatus") == "accepted"
            or str(reference.get("curationStatusKey") or "").endswith("#accepted")
        )
    )


def _reference_matches(reference: dict[str, Any], reference_ids: tuple[str, ...]) -> bool:
    values = {
        str(reference.get("id") or ""),
        str(reference.get("lineageId") or ""),
        str(reference.get("externalItemId") or ""),
    }
    return any(reference_id in values for reference_id in reference_ids)


def _list_references(graph: GraphQLKnowledgeGraphProvider) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    next_token = None
    while True:
        payload = graph.graphql(LIST_REFERENCES_QUERY, {"limit": 100, "nextToken": next_token})
        connection = payload.get("listReferences") or {}
        records.extend(item for item in connection.get("items") or [] if item)
        next_token = connection.get("nextToken")
        if not next_token:
            return records


def _reference_key_set(references: list[dict[str, Any]]) -> set[str]:
    return {str(reference.get("lineageId") or reference.get("id")) for reference in references if reference.get("lineageId") or reference.get("id")}


def _indexed_reference_keys(vectors: list[dict[str, Any]]) -> set[str]:
    keys: set[str] = set()
    for vector in vectors:
        metadata = vector.get("metadata") if isinstance(vector.get("metadata"), dict) else {}
        key = (
            metadata.get("referenceLineageId")
            or metadata.get("lineageId")
            or metadata.get("referenceId")
            or metadata.get("id")
        )
        if key:
            keys.add(str(key))
    return keys


def _list_index_vectors(index_arn: str) -> list[dict[str, Any]]:
    import boto3  # type: ignore

    client = boto3.client("s3vectors", region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))
    vectors: list[dict[str, Any]] = []
    next_token = None
    while True:
        kwargs: dict[str, Any] = {"indexArn": index_arn, "returnMetadata": True}
        if next_token:
            kwargs["nextToken"] = next_token
        response = client.list_vectors(**kwargs)
        vectors.extend(response.get("vectors") or [])
        next_token = response.get("nextToken")
        if not next_token:
            return vectors


def _embed(texts: list[str]) -> list[list[float]]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required to embed vectors")
    body = json.dumps({
        "model": os.environ.get("PAPYRUS_EMBEDDING_MODEL", "text-embedding-3-small"),
        "input": texts,
    }).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:  # nosec B310 - fixed OpenAI endpoint
        payload = json.loads(response.read().decode("utf-8"))
    return [item["embedding"] for item in sorted(payload["data"], key=lambda entry: entry["index"])]


def _embed_and_put_vectors(index_arn: str, candidates: list[dict[str, Any]]) -> int:
    embeddings = _embed([candidate["text"] for candidate in candidates])
    vectors = []
    for candidate, embedding in zip(candidates, embeddings):
        vectors.append({
            "key": candidate["key"],
            "data": {"float32": embedding},
            "metadata": candidate["metadata"],
        })
    _put_vectors(index_arn, vectors)
    return len(vectors)


def _put_vectors(index_arn: str, vectors: list[dict[str, Any]]) -> None:
    import boto3  # type: ignore

    client = boto3.client("s3vectors", region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))
    client.put_vectors(indexArn=index_arn, vectors=vectors)


def _delete_vectors(index_arn: str, keys: list[str]) -> None:
    import boto3  # type: ignore

    client = boto3.client("s3vectors", region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))
    for batch in _batched([{"key": key} for key in keys], 500):
        client.delete_vectors(indexArn=index_arn, keys=[item["key"] for item in batch])


def _batched(items: list[dict[str, Any]], batch_size: int) -> list[list[dict[str, Any]]]:
    return [items[index : index + batch_size] for index in range(0, len(items), batch_size)]


def _progress(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _vector_index_from_outputs() -> str:
    try:
        with open("amplify_outputs.json", "r", encoding="utf-8") as handle:
            outputs = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return ""
    custom = outputs.get("custom") if isinstance(outputs, dict) else None
    knowledge_query = custom.get("knowledgeQuery") if isinstance(custom, dict) else None
    index_arn = knowledge_query.get("s3VectorIndexArn") if isinstance(knowledge_query, dict) else None
    return index_arn if isinstance(index_arn, str) else ""
