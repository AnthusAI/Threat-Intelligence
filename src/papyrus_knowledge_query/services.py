from __future__ import annotations

import json
import os
from pathlib import Path
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Protocol

from .tokens import TokenCounter


SUPPORTED_ANCHOR_KINDS = {
    "assignment",
    "category",
    "categorySet",
    "item",
    "message",
    "reference",
    "semanticNode",
    "semanticRelation",
    "steeringProposal",
}


REFERENCE_FIELDS = """
id lineageId versionNumber versionState contentHash corpusId externalItemId title authors sourceUri storagePath mediaType
sourcePublishedAt sourceUpdatedAt retrievedAt importRunId importedAt curationStatus curationStatusKey updatedAt
"""

MESSAGE_FIELDS = """
id messageKind messageDomain status summary source importRunId authorLabel createdAt updatedAt
"""

RELATION_FIELDS = """
id relationState predicate relationTypeId relationTypeKey relationDomain subjectKind subjectId subjectLineageId subjectVersionNumber
objectKind objectId objectLineageId objectVersionNumber subjectStateKey objectStateKey objectSubjectStateKey predicateObjectStateKey
score confidence rank classifierId modelVersion reviewRecommended sourceSnapshotId importRunId importedAt metadata
"""

REFERENCE_ATTACHMENT_FIELDS = """
id referenceId referenceLineageId referenceVersionNumber referenceVersionKey role sortKey storagePath sourceUri filename mediaType byteSize sha256 etag importRunId importedAt metadata
"""

KNOWLEDGE_RELATION_DOMAINS = {"knowledge", "ontology", "classification", "evidence"}
DEFAULT_EXCLUDED_RELATION_DOMAINS = {"commentary", "workflow", "publication", "generic"}
DEFAULT_EXCLUDED_RELATION_TYPES = {
    "comment",
    "ingestion_rationale",
    "requests_work_on",
    "produces",
    "blocked_by",
    "planned_for_edition",
    "targets_lane",
    "targets_section",
}

OBJECT_FIELD_MAP = {
    "assignment": """
getAssignment(id: $id) {
  id assignmentTypeKey queueKey queueStatusKey status title summary sectionKey sectionStatusKey categorySetId priority
  assigneeKey createdAt updatedAt
}
""",
    "category": """
getCategory(id: $id) {
  id lineageId versionNumber versionState categorySetId corpusId categoryKey parentCategoryId parentCategoryKey displayName
  subtitle description aliases status seedItemIds holdoutItemIds rank depth isPinned importRunId updatedAt
}
""",
    "categorySet": """
getCategorySet(id: $id) {
  id lineageId versionNumber versionState corpusId classifierId displayName description status generatedAt categoryCount importRunId
}
""",
    "item": """
getItem(id: $id) {
  id lineageId versionNumber versionState type status typeStatus slug shortSlug section sectionStatus title headline deck byline
  dateline publishedAt editionDate sortTitle body editorial updatedAt
}
""",
    "message": f"getMessage(id: $id) {{ {MESSAGE_FIELDS} }}",
    "reference": f"getReference(id: $id) {{ {REFERENCE_FIELDS} }}",
    "semanticNode": """
getSemanticNode(id: $id) {
  id lineageId versionNumber versionState contentHash nodeKey nodeKind corpusId categorySetId categoryLineageId categoryKey
  displayName description aliases status importRunId createdAt updatedAt
}
""",
    "semanticRelation": f"getSemanticRelation(id: $id) {{ {RELATION_FIELDS} }}",
    "steeringProposal": """
getSteeringProposal(id: $id) {
  id categorySetId corpusId importRunId proposalKind steeringDomain status title summary categoryKey targetCategoryKey
  graphEntityId relationshipType displayName description sourceSnapshotId proposedAt reviewedAt updatedAt
}
""",
}


LIST_RELATIONS_BY_SUBJECT_QUERY = f"""
query ListRelationsBySubject($subjectStateKey: String!, $limit: Int, $nextToken: String) {{
  listSemanticRelationsBySubjectState(subjectStateKey: $subjectStateKey, limit: $limit, nextToken: $nextToken) {{
    items {{ {RELATION_FIELDS} }}
    nextToken
  }}
}}
"""

LIST_RELATIONS_BY_OBJECT_QUERY = f"""
query ListRelationsByObject($objectStateKey: String!, $limit: Int, $nextToken: String) {{
  listSemanticRelationsByObjectState(objectStateKey: $objectStateKey, limit: $limit, nextToken: $nextToken) {{
    items {{ {RELATION_FIELDS} }}
    nextToken
  }}
}}
"""

LIST_REFERENCE_ATTACHMENTS_BY_LINEAGE_QUERY = f"""
query ListReferenceAttachmentsByLineage($referenceLineageId: ID!, $limit: Int, $nextToken: String) {{
  listReferenceAttachmentsByReferenceLineageAndSortKey(referenceLineageId: $referenceLineageId, limit: $limit, nextToken: $nextToken) {{
    items {{ {REFERENCE_ATTACHMENT_FIELDS} }}
    nextToken
  }}
}}
"""


class SemanticSearchProvider(Protocol):
    name: str

    def search(self, query: str, scope: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        ...


class KnowledgeGraphProvider(Protocol):
    name: str

    def resolve_anchor(self, anchor: dict[str, Any]) -> dict[str, Any] | None:
        ...

    def expand_anchor(self, anchor: dict[str, Any], scope: dict[str, Any]) -> dict[str, Any]:
        ...

    def list_reference_attachments(self, reference: dict[str, Any]) -> list[dict[str, Any]]:
        ...

    def list_outgoing_relations(self, obj: dict[str, Any]) -> list[dict[str, Any]]:
        ...

    def list_incoming_relations(self, obj: dict[str, Any]) -> list[dict[str, Any]]:
        ...


class CorpusTextProvider(Protocol):
    name: str

    def read_text(self, storage_path: str) -> str | None:
        ...


@dataclass
class KnowledgeQueryServices:
    graph: KnowledgeGraphProvider | None = None
    semantic: SemanticSearchProvider | None = None
    corpus_text: CorpusTextProvider | None = None
    token_counter: TokenCounter = field(default_factory=TokenCounter)


@dataclass
class NoopSemanticSearchProvider:
    name: str = "none"

    def search(self, query: str, scope: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        return []


@dataclass
class LocalCorpusTextProvider:
    root: str
    name: str = "local-corpus-text"

    def read_text(self, storage_path: str) -> str | None:
        if not storage_path:
            return None
        candidates = [
            Path(storage_path),
            Path(self.root) / storage_path,
        ]
        for candidate in candidates:
            try:
                if candidate.exists() and candidate.is_file():
                    return candidate.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
        return None


@dataclass
class S3CorpusTextProvider:
    bucket_name: str
    region_name: str | None = None
    max_bytes: int = 2_000_000
    name: str = "s3-corpus-text"

    def read_text(self, storage_path: str) -> str | None:
        if not storage_path:
            return None
        try:
            import boto3  # type: ignore
        except ImportError as exc:  # pragma: no cover - deployment guard
            raise RuntimeError("boto3 is required for S3CorpusTextProvider") from exc
        client = boto3.client("s3", region_name=self.region_name)
        response = client.get_object(Bucket=self.bucket_name, Key=storage_path)
        body = response["Body"].read(self.max_bytes + 1)
        return body[: self.max_bytes].decode("utf-8", errors="replace")


@dataclass
class S3VectorsProvider:
    """S3 Vectors-backed semantic provider.

    The import of boto3 is delayed so the shared core and unit tests remain
    dependency-free. This class is selected only when the deployment explicitly
    configures an S3 vector index.
    """

    vector_index_arn: str
    embedding_model: str = "text-embedding-3-small"
    region_name: str | None = None
    name: str = "s3-vectors"

    def search(self, query: str, scope: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        if not query.strip():
            return []
        vector = self._embed(query)
        try:
            import boto3  # type: ignore
        except ImportError as exc:  # pragma: no cover - deployment guard
            raise RuntimeError("boto3 is required for S3VectorsProvider") from exc
        client = boto3.client("s3vectors", region_name=self.region_name)
        query_limit = max(limit, min(100, limit * 5))
        response = client.query_vectors(
            indexArn=self.vector_index_arn,
            queryVector={"float32": vector},
            topK=query_limit,
            returnDistance=True,
            returnMetadata=True,
            filter=self._metadata_filter(scope),
        )
        matches = []
        for index, vector_match in enumerate(response.get("vectors") or response.get("matches") or []):
            metadata = vector_match.get("metadata") or {}
            matches.append(
                {
                    "providerRank": index + 1,
                    "score": vector_match.get("score"),
                    "distance": vector_match.get("distance"),
                    "kind": metadata.get("kind") or metadata.get("objectKind"),
                    "id": metadata.get("id") or metadata.get("objectId"),
                    "lineageId": metadata.get("lineageId") or metadata.get("objectLineageId"),
                    "title": metadata.get("title") or metadata.get("displayName"),
                    "summary": metadata.get("summary") or metadata.get("text"),
                    "metadata": metadata,
                }
            )
        return diversify_vector_matches(matches, limit)

    def _embed(self, text: str) -> list[float]:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for S3VectorsProvider embeddings")
        body = json.dumps({"model": self.embedding_model, "input": text}).encode("utf-8")
        request = urllib.request.Request(
            "https://api.openai.com/v1/embeddings",
            data=body,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:  # nosec B310 - fixed OpenAI endpoint
            payload = json.loads(response.read().decode("utf-8"))
        return payload["data"][0]["embedding"]

    def _metadata_filter(self, scope: dict[str, Any]) -> dict[str, Any] | None:
        clauses: list[dict[str, Any]] = []
        for key in ("corpusId", "categorySetId", "classifierId", "curationStatus"):
            value = scope.get(key)
            if isinstance(value, str) and value:
                clauses.append({key: {"$eq": value}})
        object_kinds = scope.get("objectKinds")
        if isinstance(object_kinds, list) and object_kinds:
            clauses.append({"kind": {"$in": [str(kind) for kind in object_kinds]}})
        if not clauses:
            return None
        if len(clauses) == 1:
            return clauses[0]
        return {"$and": clauses}


@dataclass
class GraphQLKnowledgeGraphProvider:
    endpoint: str
    token: str = ""
    auth_header_prefix: str = "PapyrusJwt"
    authorization_header: str = ""
    page_limit: int = 100
    name: str = "appsync-graphql"

    def resolve_anchor(self, anchor: dict[str, Any]) -> dict[str, Any] | None:
        kind = str(anchor.get("kind") or "").strip()
        object_id = str(anchor.get("id") or anchor.get("objectId") or "").strip()
        if not kind or not object_id or kind not in OBJECT_FIELD_MAP:
            return normalize_anchor(anchor)
        query = f"query GetKnowledgeObject($id: ID!) {{ {OBJECT_FIELD_MAP[kind]} }}"
        data = self.graphql(query, {"id": object_id})
        field_name = next((key for key in data if key.startswith("get")), "")
        record = data.get(field_name) if field_name else None
        if not record:
            return normalize_anchor(anchor)
        return {"kind": kind, **record}

    def expand_anchor(self, anchor: dict[str, Any], scope: dict[str, Any]) -> dict[str, Any]:
        kind = str(anchor.get("kind") or "").strip()
        lineage_id = str(anchor.get("lineageId") or anchor.get("id") or "").strip()
        if not kind or not lineage_id:
            return {"objects": [], "relations": [], "warnings": [f"Anchor cannot be expanded without kind and lineageId: {anchor!r}"]}
        depth = max(0, min(int(scope.get("depth") or 1), 3))
        top_k = max(1, min(int(scope.get("topK") or 12), 100))
        relation_types = {str(value) for value in scope.get("relationTypes") or [] if value}
        object_kinds = {str(value) for value in scope.get("objectKinds") or [] if value}
        seen_nodes = {(kind, lineage_id)}
        frontier = [(kind, lineage_id, 0)]
        relations: dict[str, dict[str, Any]] = {}
        excluded_relations: dict[str, dict[str, Any]] = {}
        objects: dict[tuple[str, str], dict[str, Any]] = {}
        resolved_objects: dict[tuple[str, str], dict[str, Any]] = {}
        warnings: list[str] = []
        while frontier and len(relations) < top_k:
            current_kind, current_lineage_id, level = frontier.pop(0)
            if level >= depth:
                continue
            try:
                current_relations = self._neighbors(current_kind, current_lineage_id)
            except Exception as exc:  # pragma: no cover - defensive runtime note
                warnings.append(f"Could not expand {current_kind}#{current_lineage_id}: {exc}")
                continue
            for relation in current_relations:
                relation_key = str(relation.get("id") or f"{relation.get('subjectStateKey')}->{relation.get('objectStateKey')}")
                if relation_key in relations:
                    continue
                if relation_types and (relation.get("relationTypeKey") or relation.get("predicate")) not in relation_types:
                    continue
                if not relation_allowed_for_scope(relation, scope):
                    excluded_relations[relation_key] = relation
                    continue
                other = relation_other_side(relation, current_kind, current_lineage_id)
                if object_kinds and other and other.get("kind") not in object_kinds:
                    continue
                relations[relation_key] = relation
                if not other:
                    continue
                node_key = (str(other["kind"]), str(other["lineageId"]))
                if node_key not in seen_nodes:
                    seen_nodes.add(node_key)
                    frontier.append((node_key[0], node_key[1], level + 1))
                if node_key not in objects:
                    stub = {"kind": other.get("kind"), "id": other.get("id"), "lineageId": other.get("lineageId")}
                    objects[node_key] = resolved_objects.setdefault(node_key, self.resolve_anchor(stub) or stub)
                if len(relations) >= top_k:
                    break
        return {
            "objects": list(objects.values()),
            "relations": list(relations.values()),
            "excludedRelations": list(excluded_relations.values()),
            "warnings": warnings,
        }

    def list_reference_attachments(self, reference: dict[str, Any]) -> list[dict[str, Any]]:
        lineage_id = str(reference.get("lineageId") or reference.get("referenceLineageId") or "").strip()
        if not lineage_id:
            return []
        return self._list_connection(
            LIST_REFERENCE_ATTACHMENTS_BY_LINEAGE_QUERY,
            {"referenceLineageId": lineage_id},
            "listReferenceAttachmentsByReferenceLineageAndSortKey",
        )

    def list_outgoing_relations(self, obj: dict[str, Any]) -> list[dict[str, Any]]:
        kind = str(obj.get("kind") or obj.get("subjectKind") or "").strip()
        lineage_id = str(obj.get("lineageId") or obj.get("subjectLineageId") or obj.get("id") or "").strip()
        if not kind or not lineage_id:
            return []
        return self._list_connection(
            LIST_RELATIONS_BY_SUBJECT_QUERY,
            {"subjectStateKey": semantic_state_key(kind, lineage_id)},
            "listSemanticRelationsBySubjectState",
        )

    def list_incoming_relations(self, obj: dict[str, Any]) -> list[dict[str, Any]]:
        kind = str(obj.get("kind") or obj.get("objectKind") or "").strip()
        lineage_id = str(obj.get("lineageId") or obj.get("objectLineageId") or obj.get("id") or "").strip()
        if not kind or not lineage_id:
            return []
        return self._list_connection(
            LIST_RELATIONS_BY_OBJECT_QUERY,
            {"objectStateKey": semantic_state_key(kind, lineage_id)},
            "listSemanticRelationsByObjectState",
        )

    def _neighbors(self, kind: str, lineage_id: str) -> list[dict[str, Any]]:
        state_key = semantic_state_key(kind, lineage_id)
        outgoing = self._list_connection(LIST_RELATIONS_BY_SUBJECT_QUERY, {"subjectStateKey": state_key}, "listSemanticRelationsBySubjectState")
        incoming = self._list_connection(LIST_RELATIONS_BY_OBJECT_QUERY, {"objectStateKey": state_key}, "listSemanticRelationsByObjectState")
        return dedupe_records(outgoing + incoming)

    def _list_connection(self, query: str, variables: dict[str, Any], field_name: str) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        next_token = None
        while True:
            payload = self.graphql(query, {**variables, "limit": self.page_limit, "nextToken": next_token})
            connection = payload.get(field_name) or {}
            records.extend(item for item in connection.get("items") or [] if item)
            next_token = connection.get("nextToken")
            if not next_token:
                break
        return records

    def graphql(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": self.authorization_header or f"{self.auth_header_prefix} {self.token}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:  # nosec B310 - configured AppSync endpoint
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"GraphQL request failed with HTTP {exc.code}: {detail}") from exc
        errors = payload.get("errors")
        if errors:
            messages = "; ".join(str(error.get("message") or error) for error in errors)
            raise RuntimeError(f"GraphQL request failed: {messages}")
        return payload.get("data") or {}


def build_environment_services(event: dict[str, Any] | None = None) -> KnowledgeQueryServices:
    graph = _graph_from_environment(event)
    semantic = _semantic_from_environment()
    corpus_text = _corpus_text_from_environment()
    return KnowledgeQueryServices(graph=graph, semantic=semantic, corpus_text=corpus_text)


def normalize_anchor(anchor: dict[str, Any]) -> dict[str, Any]:
    kind = str(anchor.get("kind") or anchor.get("objectKind") or "").strip()
    normalized = dict(anchor)
    if kind:
        normalized["kind"] = kind
    if "lineageId" not in normalized and anchor.get("objectLineageId"):
        normalized["lineageId"] = anchor.get("objectLineageId")
    return normalized


def semantic_state_key(kind: str, lineage_id: str, state: str = "current") -> str:
    return f"{kind}#{lineage_id}#{state}"


def relation_other_side(relation: dict[str, Any], start_kind: str, start_lineage_id: str) -> dict[str, Any] | None:
    if relation.get("subjectKind") == start_kind and relation.get("subjectLineageId") == start_lineage_id:
        return {"kind": relation.get("objectKind"), "lineageId": relation.get("objectLineageId"), "id": relation.get("objectId")}
    if relation.get("objectKind") == start_kind and relation.get("objectLineageId") == start_lineage_id:
        return {"kind": relation.get("subjectKind"), "lineageId": relation.get("subjectLineageId"), "id": relation.get("subjectId")}
    return None


def dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for record in records:
        key = str(record.get("id") or (record.get("subjectStateKey"), record.get("objectStateKey")))
        deduped[key] = record
    return list(deduped.values())


def diversify_vector_matches(matches: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Prefer source diversity while preserving provider order within each source."""

    if limit <= 0:
        return []
    buckets: dict[str, list[dict[str, Any]]] = {}
    bucket_order: list[str] = []
    for match in matches:
        key = _vector_match_diversity_key(match)
        if key not in buckets:
            buckets[key] = []
            bucket_order.append(key)
        buckets[key].append(match)

    diversified: list[dict[str, Any]] = []
    while bucket_order and len(diversified) < limit:
        next_order: list[str] = []
        for key in bucket_order:
            bucket = buckets.get(key) or []
            if not bucket:
                continue
            diversified.append(bucket.pop(0))
            if bucket:
                next_order.append(key)
            if len(diversified) >= limit:
                break
        bucket_order = next_order

    return [
        {**match, "rank": index + 1}
        for index, match in enumerate(diversified)
    ]


def _vector_match_diversity_key(match: dict[str, Any]) -> str:
    metadata = match.get("metadata") if isinstance(match.get("metadata"), dict) else {}
    return str(
        metadata.get("referenceLineageId")
        or metadata.get("lineageId")
        or match.get("lineageId")
        or metadata.get("referenceId")
        or match.get("id")
        or len(metadata)
    )


def relation_allowed_for_scope(relation: dict[str, Any], scope: dict[str, Any]) -> bool:
    relation_type = str(relation.get("relationTypeKey") or relation.get("predicate") or "").strip()
    relation_domain = str(relation.get("relationDomain") or "").strip()
    relation_types = {str(value) for value in scope.get("relationTypes") or [] if value}
    include_domains = {str(value) for value in scope.get("includeRelationDomains") or [] if value}
    exclude_domains = {str(value) for value in scope.get("excludeRelationDomains") or [] if value}
    include_operational = bool(scope.get("includeOperationalContext"))

    if relation_types:
        return relation_type in relation_types and relation_domain not in exclude_domains
    if include_domains:
        return relation_domain in include_domains and relation_domain not in exclude_domains
    if include_operational:
        return relation_domain not in exclude_domains
    if relation_type in DEFAULT_EXCLUDED_RELATION_TYPES:
        return False
    if relation_domain in DEFAULT_EXCLUDED_RELATION_DOMAINS:
        return False
    return relation_domain in KNOWLEDGE_RELATION_DOMAINS


def _graph_from_environment(event: dict[str, Any] | None = None) -> KnowledgeGraphProvider | None:
    endpoint = (
        os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT")
        or os.environ.get("AMPLIFY_DATA_GRAPHQL_ENDPOINT")
        or os.environ.get("AWS_APPSYNC_GRAPHQL_ENDPOINT")
    )
    authorization_header = _authorization_header_from_event(event)
    if endpoint and authorization_header:
        return GraphQLKnowledgeGraphProvider(endpoint=endpoint, authorization_header=authorization_header)
    token = os.environ.get("PAPYRUS_GRAPHQL_JWT") or os.environ.get("PAPYRUS_KNOWLEDGE_QUERY_JWT")
    if not endpoint or not token:
        return None
    return GraphQLKnowledgeGraphProvider(
        endpoint=endpoint,
        token=token,
        auth_header_prefix=os.environ.get("PAPYRUS_GRAPHQL_AUTH_PREFIX", "PapyrusJwt"),
    )


def _authorization_header_from_event(event: dict[str, Any] | None) -> str:
    if not isinstance(event, dict):
        return ""
    request = event.get("request")
    headers = request.get("headers") if isinstance(request, dict) else None
    if not isinstance(headers, dict):
        return ""
    for key, value in headers.items():
        if str(key).lower() == "authorization" and isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _semantic_from_environment() -> SemanticSearchProvider | None:
    provider = (os.environ.get("PAPYRUS_SEMANTIC_PROVIDER") or "").strip().lower()
    vector_index_arn = os.environ.get("PAPYRUS_S3_VECTOR_INDEX_ARN") or _vector_index_from_amplify_outputs()
    explicit_s3_vectors = provider in {"s3-vectors", "s3vectors"}
    if explicit_s3_vectors or vector_index_arn:
        if not vector_index_arn:
            raise RuntimeError("PAPYRUS_S3_VECTOR_INDEX_ARN is required when PAPYRUS_SEMANTIC_PROVIDER=s3-vectors")
        if not os.environ.get("OPENAI_API_KEY") and not explicit_s3_vectors:
            return None
        return S3VectorsProvider(
            vector_index_arn=vector_index_arn,
            embedding_model=os.environ.get("PAPYRUS_EMBEDDING_MODEL", "text-embedding-3-small"),
            region_name=os.environ.get("AWS_REGION"),
        )
    return None


def _vector_index_from_amplify_outputs() -> str:
    outputs_path = Path.cwd() / "amplify_outputs.json"
    if not outputs_path.exists():
        return ""
    try:
        outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    custom = outputs.get("custom") if isinstance(outputs, dict) else None
    if not isinstance(custom, dict):
        return ""
    knowledge_query = custom.get("knowledgeQuery")
    if not isinstance(knowledge_query, dict):
        return ""
    index_arn = knowledge_query.get("s3VectorIndexArn")
    return index_arn if isinstance(index_arn, str) else ""


def _corpus_text_from_environment() -> CorpusTextProvider | None:
    local_root = os.environ.get("PAPYRUS_CORPUS_TEXT_ROOT")
    if local_root:
        return LocalCorpusTextProvider(local_root)
    bucket = (
        os.environ.get("PAPYRUS_STORAGE_BUCKET_NAME")
        or os.environ.get("papyrusMedia_BUCKET_NAME")
        or _bucket_from_amplify_outputs()
    )
    if bucket:
        return S3CorpusTextProvider(bucket_name=bucket, region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))
    return None


def _bucket_from_amplify_outputs() -> str:
    outputs_path = Path.cwd() / "amplify_outputs.json"
    if not outputs_path.exists():
        return ""
    try:
        outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    storage = outputs.get("storage") if isinstance(outputs, dict) else None
    if not isinstance(storage, dict):
        return ""
    bucket = storage.get("bucket_name")
    if isinstance(bucket, str) and bucket:
        return bucket
    buckets = storage.get("buckets")
    if isinstance(buckets, list):
        for entry in buckets:
            if isinstance(entry, dict) and isinstance(entry.get("bucket_name"), str) and entry["bucket_name"]:
                return entry["bucket_name"]
    return ""
