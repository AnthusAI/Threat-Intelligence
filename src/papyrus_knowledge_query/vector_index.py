from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

from .engine import _chunk_text, _clean_text, object_title
from .services import GraphQLKnowledgeGraphProvider, KnowledgeQueryServices

SUMMARY_RELATION_RE = re.compile(r"^reference_summary_(\d+)_tokens$")

MAX_FILTERABLE_METADATA_CHARS = 480
MAX_FILTERABLE_SUMMARY_CHARS = 320
MAX_FILTERABLE_REFERENCE_SUMMARY_CHARS = 320
MAX_FILTERABLE_TITLE_CHARS = 180
MAX_FILTERABLE_SUBTITLE_CHARS = 180


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

LIST_INSIGHT_MESSAGES_QUERY = """
query ListInsightMessages($messageKind: String!, $limit: Int, $nextToken: String) {
  listMessagesByKindAndCreatedAt(messageKind: $messageKind, limit: $limit, nextToken: $nextToken) {
    items {
      id messageKind messageDomain status summary source importRunId authorLabel createdAt updatedAt
    }
    nextToken
  }
}
"""

MODEL_ATTACHMENT_FIELDS = """
id ownerKind ownerId ownerLineageId role sortKey storagePath filename mediaType byteSize sha256 status createdAt updatedAt
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
    existing_insight_keys = _indexed_insight_message_keys(existing_vectors)
    stats = {
        "action": options.action,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "totalReferences": len(all_references),
        "acceptedReferences": len(accepted_references),
        "referencesScanned": len(references),
        "existingVectors": len(existing_vectors),
        "existingIndexedReferences": len(existing_reference_keys),
        "existingIndexedInsightMessages": len(existing_insight_keys),
        "referencesWithExtractedText": 0,
        "referencesPrepared": 0,
        "sourceVectorsPrepared": 0,
        "passageVectorsPrepared": 0,
        "insightPassageVectorsPrepared": 0,
        "insightVectorsPrepared": 0,
        "vectorsPrepared": 0,
        "vectorsSkippedExisting": 0,
        "vectorsToWrite": 0,
        "vectorsWritten": 0,
        "embeddingRequests": 0,
        "embeddingInputCharacters": 0,
        "dryRun": options.dry_run,
        "vectorIndexArn": vector_index_arn,
        "indexedReferenceSample": sorted(existing_reference_keys)[:20],
        "indexedInsightMessageSample": sorted(existing_insight_keys)[:20],
        "totalMessages": 0,
        "insightMessagesScanned": 0,
        "eligibleInsightMessages": 0,
        "excludedInsightMessages": 0,
        "insightMessagesMissingBody": 0,
        "insightSourceVectorsPrepared": 0,
        "insightResults": [],
        "failures": [],
        "warnings": [],
        "referenceResults": [],
    }
    insight_messages = _list_insight_messages(services.graph)
    prepared_insights = _prepare_insight_messages(services, insight_messages)
    eligible_insights = [entry for entry in prepared_insights if entry.get("relation") and _insight_body_text(entry)]
    missing_body_insights = [
        entry for entry in prepared_insights
        if entry.get("relation") and not _insight_body_text(entry)
    ]
    stats["totalMessages"] = len(insight_messages)
    stats["insightMessagesScanned"] = len(prepared_insights)
    stats["eligibleInsightMessages"] = len(eligible_insights)
    stats["excludedInsightMessages"] = max(0, len(prepared_insights) - len(eligible_insights))
    stats["insightMessagesMissingBody"] = len(missing_body_insights)
    started = time.perf_counter()
    if options.action == "audit":
        selected_keys = _reference_key_set(references)
        missing = sorted(selected_keys - existing_reference_keys)
        stats["missingIndexedReferences"] = len(missing)
        stats["missingIndexedReferenceSample"] = missing[:20]
        selected_insight_keys = _insight_message_key_set(eligible_insights)
        missing_insight = sorted(selected_insight_keys - existing_insight_keys)
        stats["missingIndexedInsightMessages"] = len(missing_insight)
        stats["missingIndexedInsightMessageSample"] = missing_insight[:20]
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
        pending_vectors = _flush_pending_vectors(stats, vector_index_arn, pending_vectors)
    for prepared in prepared_insights:
        pending_vectors = _consume_prepared_insight(prepared, stats, existing_keys, pending_vectors, vector_index_arn, options)
    if pending_vectors and not options.dry_run:
        pending_vectors = _flush_pending_vectors(stats, vector_index_arn, pending_vectors)
    selected_keys = _reference_key_set(references)
    stats["missingIndexedReferencesBeforeRun"] = len(selected_keys - existing_reference_keys)
    selected_insight_keys = _insight_message_key_set(eligible_insights)
    stats["missingIndexedInsightMessagesBeforeRun"] = len(selected_insight_keys - existing_insight_keys)
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
        "externalItemId": reference.get("externalItemId"),
        "hasExtractedText": False,
        "candidates": [],
        "warnings": [],
        "failures": [],
        "status": "pending",
    }
    try:
        attachments = services.graph.list_reference_attachments(reference)  # type: ignore[union-attr]
    except Exception as exc:  # pragma: no cover - defensive runtime reporting
        result["status"] = "attachment_error"
        result["failures"].append({"referenceId": reference.get("id"), "stage": "attachments", "error": str(exc)})
        return result
    extracted = next(
        (attachment for attachment in attachments if attachment.get("role") == "extracted_text" and attachment.get("storagePath")),
        None,
    )
    if not extracted:
        result["status"] = "missing_extracted_text"
        result["warnings"].append(f"missing extracted text attachment for {reference.get('id')}")
        return result
    result["hasExtractedText"] = True
    try:
        text = services.corpus_text.read_text(str(extracted["storagePath"]))  # type: ignore[union-attr]
    except Exception as exc:  # pragma: no cover - defensive runtime reporting
        result["status"] = "read_text_error"
        result["failures"].append({"referenceId": reference.get("id"), "stage": "read_text", "error": str(exc)})
        return result
    if not text:
        result["status"] = "empty_extracted_text"
        result["warnings"].append(f"empty extracted text for {reference.get('id')}")
        return result
    summary_payload = _reference_summary_payload_for_indexing(services, reference)
    result["candidates"] = _prepare_reference_vectors(
        text,
        reference,
        str(extracted["storagePath"]),
        options,
        reference_summary_payload=summary_payload,
    )
    result["status"] = "prepared"
    return result


def _consume_prepared_reference(
    result: dict[str, Any],
    stats: dict[str, Any],
    existing_keys: set[str],
    pending_vectors: list[dict[str, Any]],
    vector_index_arn: str,
    options: VectorIndexOptions,
) -> list[dict[str, Any]]:
    reference_result = {
        "referenceId": result.get("referenceId"),
        "referenceLineageId": result.get("referenceLineageId"),
        "externalItemId": result.get("externalItemId"),
        "status": result.get("status") or "pending",
        "candidateCount": 0,
        "sourceVectorCount": 0,
        "passageVectorCount": 0,
        "skippedExisting": 0,
        "warnings": list(result.get("warnings") or []),
        "failures": list(result.get("failures") or []),
    }
    stats["warnings"].extend(result.get("warnings") or [])
    stats["failures"].extend(result.get("failures") or [])
    if result.get("hasExtractedText"):
        stats["referencesWithExtractedText"] += 1
    candidates = [candidate for candidate in result.get("candidates") or [] if isinstance(candidate, dict)]
    if candidates:
        stats["referencesPrepared"] += 1
    reference_result["candidateCount"] = len(candidates)
    wrote_any = False
    for candidate in candidates:
        stats["vectorsPrepared"] += 1
        if candidate["metadata"].get("vectorKind") == "reference_summary":
            stats["sourceVectorsPrepared"] += 1
            reference_result["sourceVectorCount"] += 1
        elif candidate["metadata"].get("vectorKind") == "reference_passage":
            stats["passageVectorsPrepared"] += 1
            reference_result["passageVectorCount"] += 1
        if not options.force and candidate["key"] in existing_keys:
            stats["vectorsSkippedExisting"] += 1
            reference_result["skippedExisting"] += 1
            continue
        stats["vectorsToWrite"] += 1
        if options.dry_run:
            continue
        wrote_any = True
        pending_vectors.append(candidate)
        if len(pending_vectors) >= options.batch_size:
            stats["vectorsWritten"] += _embed_and_put_vectors(vector_index_arn, pending_vectors)
            stats["embeddingRequests"] += 1
            stats["embeddingInputCharacters"] += sum(len(vector["text"]) for vector in pending_vectors)
            pending_vectors = []
    if candidates:
        if wrote_any:
            reference_result["status"] = "indexed"
        elif reference_result["skippedExisting"] == len(candidates):
            reference_result["status"] = "skipped_existing"
        elif options.dry_run:
            reference_result["status"] = "prepared"
    stats["referenceResults"].append(reference_result)
    return pending_vectors


def _flush_pending_vectors(
    stats: dict[str, Any],
    vector_index_arn: str,
    pending_vectors: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not pending_vectors:
        return pending_vectors
    stats["vectorsWritten"] += _embed_and_put_vectors(vector_index_arn, pending_vectors)
    stats["embeddingRequests"] += 1
    stats["embeddingInputCharacters"] += sum(len(vector["text"]) for vector in pending_vectors)
    return []


def _prepare_insight_messages(
    services: KnowledgeQueryServices,
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    graph = services.graph
    if not graph:
        return []
    message_body_texts = _read_insight_message_bodies(services, messages)
    message_stubs = [
        {
            "kind": "message",
            "id": message.get("id"),
            "lineageId": message.get("lineageId") or message.get("id"),
        }
        for message in messages
        if message.get("id")
    ]
    outgoing_by_message: dict[str, list[dict[str, Any]]] = {}
    if message_stubs and hasattr(graph, "list_outgoing_relations_batch"):
        outgoing_by_message = graph.list_outgoing_relations_batch(message_stubs)  # type: ignore[attr-defined]
    prepared: list[dict[str, Any]] = []
    for message in messages:
        message_lineage_id = str(message.get("lineageId") or message.get("id") or "")
        if message_lineage_id in message_body_texts:
            message = {**message, "body": message_body_texts[message_lineage_id]}
        relations = outgoing_by_message.get(message_lineage_id)
        if relations is None and hasattr(graph, "list_outgoing_relations"):
            relations = graph.list_outgoing_relations(
                {"kind": "message", "id": message.get("id"), "lineageId": message_lineage_id}
            )  # type: ignore[attr-defined]
        relation = next(
            (
                candidate for candidate in relations or []
                if isinstance(candidate, dict)
                and str(candidate.get("relationTypeKey") or candidate.get("predicate") or "") == "insight_about"
                and candidate.get("relationState") in {None, "", "current"}
                and str(candidate.get("subjectKind") or "message") == "message"
            ),
            None,
        )
        prepared.append({"message": message, "relation": relation})
    return prepared


def _read_insight_message_bodies(
    services: KnowledgeQueryServices,
    messages: list[dict[str, Any]],
) -> dict[str, str]:
    graph = services.graph
    if not graph or not hasattr(graph, "graphql") or services.corpus_text is None:
        return {}
    message_ids = [
        str(message.get("id"))
        for message in messages
        if message.get("id")
    ]
    if not message_ids:
        return {}
    attachments_by_owner = _list_message_body_attachments(graph, message_ids)
    bodies: dict[str, str] = {}
    for message in messages:
        message_id = str(message.get("id") or "")
        message_lineage_id = str(message.get("lineageId") or message_id)
        attachment = attachments_by_owner.get(message_id)
        if not attachment:
            continue
        storage_path = str(attachment.get("storagePath") or "")
        if not storage_path:
            continue
        try:
            text = services.corpus_text.read_text(storage_path)  # type: ignore[union-attr]
        except Exception:
            continue
        clean = _clean_text(text or "")
        if clean:
            bodies[message_lineage_id] = clean
    return bodies


def _list_message_body_attachments(graph: Any, message_ids: list[str]) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    unique_ids = []
    seen: set[str] = set()
    for message_id in message_ids:
        if not message_id or message_id in seen:
            continue
        seen.add(message_id)
        unique_ids.append(message_id)
    for batch in _batched_scalar(unique_ids, 20):
        variables: dict[str, Any] = {"limit": 25}
        variable_defs = ["$limit: Int"]
        fields: list[str] = []
        alias_to_id: dict[str, str] = {}
        for index, message_id in enumerate(batch):
            var_name = f"m{index}"
            alias = f"a{index}"
            variables[var_name] = message_id
            variable_defs.append(f"${var_name}: ID!")
            fields.append(
                f"""
  {alias}: listModelAttachmentsByOwnerRoleAndSortKey(ownerId: ${var_name}, limit: $limit) {{
    items {{ {MODEL_ATTACHMENT_FIELDS} }}
    nextToken
  }}
"""
            )
            alias_to_id[alias] = message_id
        query = f"query BatchInsightMessageBodies({', '.join(variable_defs)}) {{\n{''.join(fields)}\n}}"
        payload = graph.graphql(query, variables)
        for alias, message_id in alias_to_id.items():
            connection = payload.get(alias) or {}
            candidates = [
                item for item in connection.get("items") or []
                if item
                and item.get("ownerKind") == "message"
                and item.get("role") == "message_body"
                and item.get("status") != "deleted"
                and item.get("storagePath")
            ]
            if not candidates:
                continue
            results[message_id] = sorted(candidates, key=lambda item: str(item.get("sortKey") or ""))[0]
    return results


def _consume_prepared_insight(
    prepared: dict[str, Any],
    stats: dict[str, Any],
    existing_keys: set[str],
    pending_vectors: list[dict[str, Any]],
    vector_index_arn: str,
    options: VectorIndexOptions,
) -> list[dict[str, Any]]:
    message = prepared.get("message") if isinstance(prepared.get("message"), dict) else {}
    relation = prepared.get("relation") if isinstance(prepared.get("relation"), dict) else None
    message_id = str(message.get("id") or "")
    message_lineage_id = str(message.get("lineageId") or message_id)
    result = {
        "messageId": message_id,
        "messageLineageId": message_lineage_id,
        "status": "excluded",
        "candidateCount": 0,
        "sourceVectorCount": 0,
        "passageVectorCount": 0,
        "skippedExisting": 0,
        "relationTypeKey": relation.get("relationTypeKey") if relation else None,
        "aboutKind": relation.get("objectKind") if relation else None,
        "aboutLineageId": relation.get("objectLineageId") if relation else None,
    }
    if not relation:
        stats["insightResults"].append(result)
        return pending_vectors
    if not _clean_text(str(message.get("body") or "")):
        result["status"] = "missing_message_body"
        stats["insightResults"].append(result)
        return pending_vectors
    candidates = _prepare_insight_vectors(message, relation, options)
    result["candidateCount"] = len(candidates)
    wrote_any = False
    for candidate in candidates:
        stats["vectorsPrepared"] += 1
        stats["insightVectorsPrepared"] += 1
        vector_kind = candidate["metadata"].get("vectorKind")
        if vector_kind == "insight_source":
            stats["insightSourceVectorsPrepared"] += 1
            result["sourceVectorCount"] += 1
        elif vector_kind == "insight_passage":
            stats["insightPassageVectorsPrepared"] += 1
            result["passageVectorCount"] += 1
        if not options.force and candidate["key"] in existing_keys:
            stats["vectorsSkippedExisting"] += 1
            result["skippedExisting"] += 1
            continue
        stats["vectorsToWrite"] += 1
        if options.dry_run:
            continue
        wrote_any = True
        pending_vectors.append(candidate)
        if len(pending_vectors) >= options.batch_size:
            pending_vectors = _flush_pending_vectors(stats, vector_index_arn, pending_vectors)
    if candidates:
        if wrote_any:
            result["status"] = "indexed"
        elif result["skippedExisting"] == len(candidates):
            result["status"] = "skipped_existing"
        elif options.dry_run:
            result["status"] = "prepared"
        else:
            result["status"] = "eligible"
    stats["insightResults"].append(result)
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
    reference_summary_payload: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    vectors: list[dict[str, Any]] = []
    if options.include_source_vectors:
        source_vector = _prepare_source_vector(
            text,
            reference,
            storage_path,
            options,
            reference_summary_payload=reference_summary_payload,
        )
        if source_vector:
            vectors.append(source_vector)
    if options.include_passage_vectors:
        vectors.extend(
            _prepare_chunks(
                text,
                reference,
                storage_path,
                options,
                reference_summary_payload=reference_summary_payload,
            )
        )
    return vectors


def _prepare_insight_vectors(
    message: dict[str, Any],
    relation: dict[str, Any],
    options: VectorIndexOptions,
) -> list[dict[str, Any]]:
    summary = _clean_text(str(message.get("summary") or ""))
    body = _clean_text(str(message.get("body") or ""))
    if not body:
        return []
    message_lineage_id = str(message.get("lineageId") or message.get("id") or "")
    about_kind = str(relation.get("objectKind") or "")
    about_lineage_id = str(relation.get("objectLineageId") or relation.get("objectId") or "")
    metadata = _base_insight_metadata(message, relation, options)
    vectors: list[dict[str, Any]] = []
    if options.include_source_vectors and len(body) >= 30:
        digest = hashlib.sha256(
            f"{message_lineage_id}:{about_kind}:{about_lineage_id}:insight_source".encode("utf-8")
        ).hexdigest()[:20]
        vectors.append(
            {
                "key": f"insight-source-{digest}",
                "text": body,
                "metadata": {
                    **metadata,
                    "vectorKind": "insight_source",
                    "summary": summary[:900],
                    "text": body[:2400],
                },
            }
        )
    if options.include_passage_vectors:
        for index, chunk in enumerate(_chunk_text(body, target_words=max(35, options.chunk_words // 3))):
            clean = _clean_text(chunk["text"])
            if len(clean) < 40:
                continue
            digest = hashlib.sha256(f"{message_lineage_id}:{about_kind}:{about_lineage_id}:{index}".encode("utf-8")).hexdigest()[:20]
            vectors.append(
                {
                    "key": f"insight-passage-{digest}",
                    "text": clean,
                    "metadata": {
                        **metadata,
                        "vectorKind": "insight_passage",
                        "summary": clean[:600],
                        "text": clean[:1800],
                        "chunkIndex": index,
                        "startChar": chunk.get("start"),
                        "endChar": chunk.get("end"),
                    },
                }
            )
            if len(vectors) >= (1 + max(1, options.max_chunks_per_reference // 2)):
                break
    return vectors


def _prepare_source_vector(
    text: str,
    reference: dict[str, Any],
    storage_path: str,
    options: VectorIndexOptions,
    reference_summary_payload: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    clean = _clean_text(text)
    title = object_title(reference) or reference.get("id") or "Reference"
    subtitle = _reference_subtitle(reference)
    summary_text = str((reference_summary_payload or {}).get("summary") or "")
    source_text = _clean_text(
        "\n\n".join(
            part for part in (
                str(title),
                str(subtitle),
                summary_text,
                _authors_text(reference),
                str(reference.get("sourceUri") or ""),
                clean[:2400],
            )
            if part
        )
    )
    if len(source_text) < 80:
        return None
    digest = hashlib.sha256(str(reference.get("lineageId") or reference.get("id") or title).encode("utf-8")).hexdigest()[:20]
    return {
            "key": f"reference-summary-{digest}",
        "text": source_text,
        "metadata": {
            **_base_reference_metadata(reference, options, reference_summary_payload=reference_summary_payload),
            "vectorKind": "reference_summary",
            "summary": _truncate_filterable_metadata(source_text, MAX_FILTERABLE_SUMMARY_CHARS),
            "text": _truncate_filterable_metadata(source_text, MAX_FILTERABLE_METADATA_CHARS),
            "sourceUri": reference.get("sourceUri"),
            "storagePath": storage_path,
        },
    }


def _prepare_chunks(
    text: str,
    reference: dict[str, Any],
    storage_path: str,
    options: VectorIndexOptions,
    reference_summary_payload: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
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
                **_base_reference_metadata(reference, options, reference_summary_payload=reference_summary_payload),
                "vectorKind": "reference_passage",
                "summary": _truncate_filterable_metadata(clean, MAX_FILTERABLE_SUMMARY_CHARS),
                "text": _truncate_filterable_metadata(clean, MAX_FILTERABLE_METADATA_CHARS),
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


def _base_reference_metadata(
    reference: dict[str, Any],
    options: VectorIndexOptions,
    reference_summary_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    title = object_title(reference) or reference.get("id") or "Reference"
    subtitle = _reference_subtitle(reference)
    summary_payload = reference_summary_payload or {}
    reference_summary = str(summary_payload.get("summary") or "")
    return {
        "kind": "reference",
        "id": reference.get("id"),
        "lineageId": reference.get("lineageId"),
        "referenceId": reference.get("id"),
        "referenceLineageId": reference.get("lineageId"),
        "corpusId": reference.get("corpusId"),
        "categorySetId": options.category_set_id,
        "title": _truncate_filterable_metadata(str(title), MAX_FILTERABLE_TITLE_CHARS),
        "subtitle": _truncate_filterable_metadata(str(subtitle), MAX_FILTERABLE_SUBTITLE_CHARS),
        "referenceSummary": _truncate_filterable_metadata(reference_summary, MAX_FILTERABLE_REFERENCE_SUMMARY_CHARS) if reference_summary else "",
        "referenceSummaryMaxTokens": summary_payload.get("maxTokens"),
        "referenceSummaryMessageId": summary_payload.get("messageId"),
        "referenceSummaryRelationId": summary_payload.get("relationId"),
        "referenceSummaryRelationTypeKey": summary_payload.get("relationTypeKey"),
        "curationStatus": reference.get("curationStatus"),
        "curationStatusKey": reference.get("curationStatusKey"),
    }


def _truncate_filterable_metadata(value: str, limit: int) -> str:
    clean = _clean_text(value)
    if len(clean) <= limit:
        return clean
    if limit <= 1:
        return clean[:limit]
    return clean[: limit - 1].rstrip() + "…"


def _reference_summary_payload_for_indexing(
    services: KnowledgeQueryServices,
    reference: dict[str, Any],
) -> dict[str, Any]:
    graph = services.graph
    if not graph or not hasattr(graph, "list_incoming_relations") or not hasattr(graph, "resolve_anchor"):
        return {}
    reference_anchor = {
        **reference,
        "kind": "reference",
        "id": reference.get("id"),
        "lineageId": reference.get("lineageId") or reference.get("id"),
    }
    try:
        incoming = graph.list_incoming_relations(reference_anchor)  # type: ignore[union-attr]
    except Exception:
        return {}
    candidates: list[dict[str, Any]] = []
    for relation in incoming or []:
        if not isinstance(relation, dict):
            continue
        relation_key = str(relation.get("relationTypeKey") or relation.get("predicate") or "")
        token_match = SUMMARY_RELATION_RE.match(relation_key)
        if not token_match:
            continue
        if relation.get("relationState") not in {None, "", "current"}:
            continue
        if relation.get("subjectKind") != "message" or relation.get("objectKind") != "reference":
            continue
        message_id = relation.get("subjectId")
        if not message_id:
            continue
        try:
            message = graph.resolve_anchor(  # type: ignore[union-attr]
                {"kind": "message", "id": message_id, "lineageId": relation.get("subjectLineageId")}
            ) or {}
        except Exception:
            message = {}
        if message.get("messageKind") not in {None, "reference_summary"}:
            continue
        if message.get("messageDomain") not in {None, "summarization"}:
            continue
        if message.get("status") not in {None, "", "active"}:
            continue
        summary = _clean_text(str(message.get("summary") or ""))
        if not summary:
            continue
        candidates.append(
            {
                "summary": summary,
                "maxTokens": int(token_match.group(1)),
                "createdAt": str(message.get("createdAt") or relation.get("importedAt") or ""),
                "messageId": message.get("id") or message_id,
                "relationId": relation.get("id"),
                "relationTypeKey": relation_key,
            }
        )
    if not candidates:
        return {}
    return sorted(
        candidates,
        key=lambda item: (
            int(item.get("maxTokens") or 0),
            str(item.get("createdAt") or ""),
        ),
        reverse=True,
    )[0]


def _base_insight_metadata(message: dict[str, Any], relation: dict[str, Any], options: VectorIndexOptions) -> dict[str, Any]:
    message_id = message.get("id")
    message_lineage_id = message.get("lineageId") or message_id
    about_kind = relation.get("objectKind")
    about_id = relation.get("objectId")
    about_lineage_id = relation.get("objectLineageId") or about_id
    metadata = {
        "kind": "message",
        "id": message_id,
        "lineageId": message_lineage_id,
        "messageId": message_id,
        "messageLineageId": message_lineage_id,
        "messageKind": message.get("messageKind"),
        "messageDomain": message.get("messageDomain"),
        "status": message.get("status"),
        "relationTypeKey": "insight_about",
        "aboutKind": about_kind,
        "aboutId": about_id,
        "aboutLineageId": about_lineage_id,
        "categorySetId": options.category_set_id,
        "corpusId": options.corpus_id,
    }
    if about_kind == "reference":
        metadata["referenceId"] = about_id
        metadata["referenceLineageId"] = about_lineage_id
    return metadata


def _reference_subtitle(reference: dict[str, Any]) -> str:
    metadata = reference.get("metadata")
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    subtitle = metadata.get("subtitle")
    if subtitle is None:
        subtitle = (
            metadata.get("papyrus", {}).get("title_subtitle", {}).get("subtitle")
            if isinstance(metadata.get("papyrus"), dict) and isinstance(metadata.get("papyrus", {}).get("title_subtitle"), dict)
            else None
        )
    subtitle_text = _clean_text(subtitle or "")
    title_text = _clean_text(reference.get("title") or "")
    if subtitle_text and subtitle_text != title_text:
        return subtitle_text
    return ""


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


def _list_insight_messages(graph: GraphQLKnowledgeGraphProvider) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    next_token = None
    while True:
        payload = graph.graphql(
            LIST_INSIGHT_MESSAGES_QUERY,
            {"messageKind": "insight", "limit": 100, "nextToken": next_token},
        )
        connection = payload.get("listMessagesByKindAndCreatedAt") or {}
        records.extend(
            item for item in connection.get("items") or []
            if item and str(item.get("messageDomain") or "") == "knowledge"
        )
        next_token = connection.get("nextToken")
        if not next_token:
            return records


def _reference_key_set(references: list[dict[str, Any]]) -> set[str]:
    return {str(reference.get("lineageId") or reference.get("id")) for reference in references if reference.get("lineageId") or reference.get("id")}


def _indexed_reference_keys(vectors: list[dict[str, Any]]) -> set[str]:
    keys: set[str] = set()
    for vector in vectors:
        metadata = vector.get("metadata") if isinstance(vector.get("metadata"), dict) else {}
        vector_kind = str(metadata.get("vectorKind") or "")
        kind = str(metadata.get("kind") or "")
        if kind != "reference" and not vector_kind.startswith("reference_"):
            continue
        key = (
            metadata.get("referenceLineageId")
            or metadata.get("lineageId")
            or metadata.get("referenceId")
            or metadata.get("id")
        )
        if key:
            keys.add(str(key))
    return keys


def _indexed_insight_message_keys(vectors: list[dict[str, Any]]) -> set[str]:
    keys: set[str] = set()
    for vector in vectors:
        metadata = vector.get("metadata") if isinstance(vector.get("metadata"), dict) else {}
        vector_kind = str(metadata.get("vectorKind") or "")
        kind = str(metadata.get("kind") or "")
        if kind != "message" and not vector_kind.startswith("insight_"):
            continue
        if str(metadata.get("relationTypeKey") or "") != "insight_about":
            continue
        if str(metadata.get("messageKind") or "") != "insight":
            continue
        if str(metadata.get("messageDomain") or "") != "knowledge":
            continue
        key = metadata.get("messageLineageId") or metadata.get("lineageId") or metadata.get("messageId") or metadata.get("id")
        if key:
            keys.add(str(key))
    return keys


def _insight_message_key_set(prepared_insights: list[dict[str, Any]]) -> set[str]:
    keys: set[str] = set()
    for entry in prepared_insights:
        if not _insight_body_text(entry):
            continue
        message = entry.get("message") if isinstance(entry.get("message"), dict) else {}
        key = message.get("lineageId") or message.get("id")
        if key:
            keys.add(str(key))
    return keys


def _insight_body_text(prepared_insight: dict[str, Any]) -> str:
    message = prepared_insight.get("message") if isinstance(prepared_insight.get("message"), dict) else {}
    return _clean_text(str(message.get("body") or ""))


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


def _batched_scalar(items: list[str], batch_size: int) -> list[list[str]]:
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
