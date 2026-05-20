from __future__ import annotations

import hashlib
import json
import os
import urllib.request
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
    corpus_id: str = ""
    category_set_id: str = ""
    reference_ids: tuple[str, ...] = ()
    max_references: int | None = None
    max_chunks_per_reference: int = 8
    chunk_words: int = 180
    batch_size: int = 50
    dry_run: bool = False


def index_reference_passages(services: KnowledgeQueryServices, options: VectorIndexOptions) -> dict[str, Any]:
    if not isinstance(services.graph, GraphQLKnowledgeGraphProvider):
        raise RuntimeError("knowledge vector indexing requires an AppSync GraphQL provider")
    if services.corpus_text is None:
        raise RuntimeError("knowledge vector indexing requires a corpus text provider")

    vector_index_arn = os.environ.get("PAPYRUS_S3_VECTOR_INDEX_ARN") or _vector_index_from_outputs()
    if not vector_index_arn:
        raise RuntimeError("Missing PAPYRUS_S3_VECTOR_INDEX_ARN and custom.knowledgeQuery.s3VectorIndexArn")

    references = _list_references(services.graph)
    references = [
        reference for reference in references
        if reference.get("versionState") == "current"
        and (reference.get("curationStatus") == "accepted" or reference.get("curationStatusKey", "").endswith("#accepted"))
        and (not options.corpus_id or reference.get("corpusId") == options.corpus_id)
        and (not options.reference_ids or _reference_matches(reference, options.reference_ids))
    ]
    if options.max_references:
        references = references[: options.max_references]

    vectors: list[dict[str, Any]] = []
    stats = {
        "referencesScanned": len(references),
        "referencesWithExtractedText": 0,
        "chunksPrepared": 0,
        "vectorsWritten": 0,
        "dryRun": options.dry_run,
        "vectorIndexArn": vector_index_arn,
        "warnings": [],
    }

    for reference in references:
        attachments = services.graph.list_reference_attachments(reference)
        extracted = next(
            (attachment for attachment in attachments if attachment.get("role") == "extracted_text" and attachment.get("storagePath")),
            None,
        )
        if not extracted:
            continue
        text = services.corpus_text.read_text(str(extracted["storagePath"]))
        if not text:
            stats["warnings"].append(f"empty extracted text for {reference.get('id')}")
            continue
        stats["referencesWithExtractedText"] += 1
        chunks = _prepare_chunks(text, reference, str(extracted["storagePath"]), options)
        stats["chunksPrepared"] += len(chunks)
        if options.dry_run:
            continue
        for batch in _batched(chunks, options.batch_size):
            embeddings = _embed([chunk["text"] for chunk in batch])
            for chunk, embedding in zip(batch, embeddings):
                vectors.append({
                    "key": chunk["key"],
                    "data": {"float32": embedding},
                    "metadata": chunk["metadata"],
                })
            if len(vectors) >= options.batch_size:
                _put_vectors(vector_index_arn, vectors)
                stats["vectorsWritten"] += len(vectors)
                vectors = []

    if vectors and not options.dry_run:
        _put_vectors(vector_index_arn, vectors)
        stats["vectorsWritten"] += len(vectors)
    return stats


def _prepare_chunks(text: str, reference: dict[str, Any], storage_path: str, options: VectorIndexOptions) -> list[dict[str, Any]]:
    chunks = []
    for index, chunk in enumerate(_chunk_text(text, target_words=options.chunk_words)):
        clean = _clean_text(chunk["text"])
        if len(clean) < 120:
            continue
        digest = hashlib.sha256(f"{reference.get('lineageId')}:{storage_path}:{index}:{clean[:200]}".encode("utf-8")).hexdigest()[:20]
        title = object_title(reference) or reference.get("id") or "Reference"
        chunks.append({
            "key": f"reference-passage-{digest}",
            "text": clean,
            "metadata": {
                "kind": "reference",
                "id": reference.get("id"),
                "lineageId": reference.get("lineageId"),
                "referenceId": reference.get("id"),
                "referenceLineageId": reference.get("lineageId"),
                "corpusId": reference.get("corpusId"),
                "categorySetId": options.category_set_id,
                "title": title,
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


def _put_vectors(index_arn: str, vectors: list[dict[str, Any]]) -> None:
    import boto3  # type: ignore

    client = boto3.client("s3vectors", region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))
    client.put_vectors(indexArn=index_arn, vectors=vectors)


def _batched(items: list[dict[str, Any]], batch_size: int) -> list[list[dict[str, Any]]]:
    return [items[index : index + batch_size] for index in range(0, len(items), batch_size)]


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
