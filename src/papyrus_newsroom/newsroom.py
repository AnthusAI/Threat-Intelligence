"""
Papyrus automated newsroom tools for Tactus procedures.

The v1 tools are intentionally dry-run first. GraphQL helpers only read from
Papyrus, while record builders return mutation plans that callers can inspect
before any live authoring path is added.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .semantic import PapyrusSemanticClient
from .reference_policy import is_evidence_eligible_reference

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - exercised only in stripped envs
    yaml = None


PAPYRUS_ROOT = Path(__file__).resolve().parents[2]
BIBLICUS_ROOT = PAPYRUS_ROOT.parent / "Biblicus"
STEERING_CONFIG_PATH = PAPYRUS_ROOT / "corpora" / "papyrus-steering.yml"
RESEARCH_TRACKS_PATH = PAPYRUS_ROOT / "procedures" / "newsroom" / "tracks"
NEWSROOM_VERSION = "newsroom-v1"
ASSIGNMENT_TYPE = "assignment"
ASSIGNMENT_DISPATCH_STATUS = "dispatched"
ASSIGNMENT_RESEARCH_STATUS = "researched"
ASSIGNMENT_DRAFT_STATUS = "drafted"
ARTICLE_TYPE = "article"
ARTICLE_DRAFT_STATUS = "draft"
DEFAULT_ASSIGNMENT_RATIO = 1.5
REPORTER_PROCEDURE = "procedures/newsroom/reporter.tac"
RELATION_TYPE_FIELDS = {
    "comment": {
        "relationTypeId": "semantic-relation-type-comment",
        "relationTypeKey": "comment",
        "relationDomain": "commentary",
    },
    "uses_evidence": {
        "relationTypeId": "semantic-relation-type-uses-evidence",
        "relationTypeKey": "uses_evidence",
        "relationDomain": "evidence",
    },
}


GET_EDITION_QUERY = """
query GetEdition($id: ID!) {
  getEdition(id: $id) {
    id
    lineageId
    versionNumber
    previousVersionId
    versionState
    versionCreatedAt
    versionCreatedBy
    changeReason
    contentHash
    slug
    title
    status
    editionDate
    publishedAt
    description
    layoutPlan
    metadata
  }
}
"""

LIST_EDITION_ITEMS_QUERY = """
query ListEditionItemsByEdition($editionId: ID!, $limit: Int, $nextToken: String) {
  listEditionItemsByEditionAndSortKey(
    editionId: $editionId
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      id
      editionId
      editionLineageId
      itemId
      itemLineageId
      placementKey
      sortKey
      pageNumber
      priority
      metadata
    }
    nextToken
  }
}
"""

GET_ITEM_QUERY = """
query GetItem($id: ID!) {
  getItem(id: $id) {
    id
    lineageId
    versionNumber
    previousVersionId
    versionState
    versionCreatedAt
    versionCreatedBy
    changeReason
    contentHash
    type
    status
    typeStatus
    slug
    shortSlug
    section
    sectionStatus
    title
    headline
    deck
    body
    byline
    dateline
    publishedAt
    editionDate
    sortTitle
    pullQuotes
    layout
    editorial
  }
}
"""

GET_ASSIGNMENT_QUERY = """
query GetAssignment($id: ID!) {
  getAssignment(id: $id) {
    id
    assignmentTypeKey
    queueKey
    queueStatusKey
    status
    priority
    title
    brief
    instructions
    assigneeType
    assigneeId
    assigneeKey
    claimedAt
    claimExpiresAt
    completedAt
    canceledAt
    corpusId
    categorySetId
    classifierId
    sectionId
    sectionKey
    sectionType
    sectionStatusKey
    sectionQueueStatusKey
    primaryFocusCategoryKey
    topicScopeCategoryKeys
    sourceSnapshotId
    importRunId
    createdBy
    createdAt
    updatedAt
    metadata
  }
}
"""

GET_ASSIGNMENT_CONTEXT_QUERY = """
query GetAssignmentContext($assignmentId: ID!) {
  getAssignmentContext(assignmentId: $assignmentId) {
    assignment {
      id
      assignmentTypeKey
      queueKey
      queueStatusKey
      status
      priority
      title
      brief
      instructions
      assigneeType
      assigneeId
      assigneeKey
      claimedAt
      claimExpiresAt
      completedAt
      canceledAt
      corpusId
      categorySetId
      classifierId
      sectionId
      sectionKey
      sectionType
      sectionStatusKey
      sectionQueueStatusKey
      primaryFocusCategoryKey
      topicScopeCategoryKeys
      sourceSnapshotId
      importRunId
      createdBy
      createdAt
      updatedAt
      metadata
    }
    doctrine {
      scope
      kind
      label
      slug
      body
      categoryKey
      categoryLineageId
    }
    targets {
      kind
      id
      lineageId
      label
      detail
    }
    events {
      id
      assignmentId
      assignmentTypeKey
      queueKey
      eventType
      fromStatus
      toStatus
      actorSub
      actorLabel
      note
      createdAt
      metadata
    }
  }
}
"""

LIST_ASSIGNMENTS_QUERY = """
query ListAssignments($limit: Int, $nextToken: String) {
  listAssignments(limit: $limit, nextToken: $nextToken) {
    items {
      id
      assignmentTypeKey
      queueKey
      queueStatusKey
      status
      priority
      title
      brief
      instructions
      assigneeType
      assigneeId
      assigneeKey
      claimedAt
      claimExpiresAt
      completedAt
      canceledAt
      corpusId
      categorySetId
      classifierId
      sectionId
      sectionKey
      sectionType
      sectionStatusKey
      sectionQueueStatusKey
      primaryFocusCategoryKey
      topicScopeCategoryKeys
      sourceSnapshotId
      importRunId
      createdBy
      createdAt
      updatedAt
      metadata
    }
    nextToken
  }
}
"""

LIST_PUBLISHED_ITEMS_QUERY = """
query ListPublishedItems($limit: Int, $nextToken: String) {
  listPublishedItems(limit: $limit, nextToken: $nextToken) {
    items {
      id
      sourceItemId
      itemLineageId
      versionNumber
      type
      status
      typeStatus
      slug
      shortSlug
      section
      sectionStatus
      title
      headline
      deck
      publishedAt
      editionDate
      editorial
    }
    nextToken
  }
}
"""

LIST_CATEGORIES_QUERY = """
query ListCategories($limit: Int, $nextToken: String) {
  listCategories(limit: $limit, nextToken: $nextToken) {
    items {
      id
      lineageId
      versionNumber
      versionState
      categorySetId
      corpusId
      categoryKey
      parentCategoryKey
      displayName
      shortTitle
      subtitle
      description
      aliases
      status
      rank
      depth
      isPinned
      updatedAt
    }
    nextToken
  }
}
"""

LIST_CATEGORY_KEYWORDS_QUERY = """
query ListCategoryKeywords($limit: Int, $nextToken: String) {
  listCategoryKeywords(limit: $limit, nextToken: $nextToken) {
    items {
      id
      categorySetId
      corpusId
      categoryKey
      categoryLineageId
      categoryId
      keyword
      normalizedKeyword
      weight
      rank
      source
      sourceTopicId
      importRunId
      metadata
      createdAt
      updatedAt
    }
    nextToken
  }
}
"""

LIST_SEMANTIC_NODES_QUERY = """
query ListSemanticNodes($limit: Int, $nextToken: String) {
  listSemanticNodes(limit: $limit, nextToken: $nextToken) {
    items {
      id
      lineageId
      versionNumber
      versionState
      nodeKey
      nodeKind
      categorySetId
      categoryLineageId
      categoryKey
      displayName
      description
      aliases
      status
      updatedAt
    }
    nextToken
  }
}
"""

LIST_MESSAGES_QUERY = """
query ListMessages($limit: Int, $nextToken: String) {
  listMessages(limit: $limit, nextToken: $nextToken) {
    items {
      id
      messageKind
      messageDomain
      status
      body
      summary
      source
      importRunId
      authorSub
      authorUserProfileId
      authorLabel
      createdAt
      updatedAt
      metadata
    }
    nextToken
  }
}
"""

LIST_ARTICLES_QUERY = """
query ListPublishedItemsByTypeStatusAndPublishedAt(
  $typeStatus: String!
  $limit: Int
  $nextToken: String
) {
  listPublishedItemsByTypeStatusAndPublishedAt(
    typeStatus: $typeStatus
    limit: $limit
    nextToken: $nextToken
    sortDirection: DESC
  ) {
    items {
      id
      sourceItemId
      itemLineageId
      versionNumber
      slug
      title
      headline
      deck
      section
      status
      typeStatus
      publishedAt
      editionDate
      editorial
    }
    nextToken
  }
}
"""


def papyrus_get_edition(edition_id: str) -> dict[str, Any]:
    """
    Read one Papyrus Edition by id through the authoring GraphQL endpoint.
    """
    data = _graphql(GET_EDITION_QUERY, {"id": _required(edition_id, "edition_id")})
    edition = data.get("getEdition")
    if not edition:
        raise ValueError(f"Edition not found: {edition_id}")
    return {"edition": _decode_record_json(edition)}


def papyrus_list_edition_items(edition_id: str, limit: int = 100) -> dict[str, Any]:
    """
    Read EditionItem rows for one edition. This does not fetch linked Item rows.
    """
    items: list[dict[str, Any]] = []
    next_token = None
    while True:
        data = _graphql(
            LIST_EDITION_ITEMS_QUERY,
            {"editionId": _required(edition_id, "edition_id"), "limit": limit, "nextToken": next_token},
        )
        connection = data.get("listEditionItemsByEditionAndSortKey") or {}
        items.extend(_decode_record_json(item) for item in connection.get("items") or [])
        next_token = connection.get("nextToken")
        if not next_token:
            break
    return {"edition_id": edition_id, "items": items}


def papyrus_get_item(item_id: str) -> dict[str, Any]:
    """
    Read one Papyrus Item by id through the authoring GraphQL endpoint.
    """
    data = _graphql(GET_ITEM_QUERY, {"id": _required(item_id, "item_id")})
    item = data.get("getItem")
    if not item:
        raise ValueError(f"Item not found: {item_id}")
    return {"item": _decode_record_json(item)}


def papyrus_get_assignment(assignment_id: str) -> dict[str, Any]:
    """
    Read one live Papyrus Assignment by id through the authoring GraphQL endpoint.
    """
    data = _graphql(GET_ASSIGNMENT_QUERY, {"id": _required(assignment_id, "assignment_id")})
    assignment = data.get("getAssignment")
    if not assignment:
        raise ValueError(f"Assignment not found: {assignment_id}")
    return {"assignment": _decode_record_json(assignment)}


def papyrus_get_assignment_context(assignment_id: str) -> dict[str, Any]:
    """
    Read live Assignment context, including doctrine, targets, and events.
    """
    assignment_id = _required(assignment_id, "assignment_id")
    try:
        data = _graphql(GET_ASSIGNMENT_CONTEXT_QUERY, {"assignmentId": assignment_id})
        context = data.get("getAssignmentContext")
        if not context:
            raise ValueError(f"Assignment context not found: {assignment_id}")
        return {"assignment_context": _decode_record_json(context)}
    except RuntimeError as error:
        message = str(error)
        if "data environment variables are malformed" not in message:
            raise
        # Fallback path when the assignment-action Lambda resolver is misconfigured.
        return {"assignment_context": _fallback_assignment_context(assignment_id)}


def papyrus_build_assignment_agent_context(
    assignment_id: str,
    context_profile: str = "",
    max_tokens: int | str = 0,
    recent_days: int = 30,
) -> dict[str, Any]:
    """
    Build a budgeted live agent-context bundle for one Assignment.
    """
    context = papyrus_get_assignment_context(assignment_id)["assignment_context"]
    assignment = _decode_record_json(context.get("assignment") or {})
    metadata = _normalize_assignment_metadata(assignment.get("metadata") or {})
    section_key = (
        assignment.get("sectionKey")
        or metadata.get("sectionKey")
        or assignment.get("sectionId")
        or metadata.get("sectionId")
    )
    lane_key = _assignment_lane_key(assignment, metadata)
    profile_key = _normalize_context_profile(context_profile or metadata.get("contextProfile"), lane_key)
    token_budget = _context_token_budget(profile_key, max_tokens or metadata.get("contextTokenBudget"))
    categories = _list_categories(assignment.get("categorySetId"))
    desk_category = _resolve_assignment_category(
        categories,
        metadata.get("deskCategoryLineageId") or metadata.get("rootCategoryLineageId"),
        metadata.get("deskCategoryKey") or metadata.get("rootCategoryKey"),
    )
    explicit_focus_key = (
        metadata.get("focusCategoryKey")
        or metadata.get("categoryKey")
        or metadata.get("researchLens")
    )
    focus_category = _resolve_assignment_category(
        categories,
        metadata.get("focusCategoryLineageId") or metadata.get("categoryLineageId"),
        explicit_focus_key,
    ) or desk_category
    semantic_query_terms = _context_semantic_terms(assignment, metadata, desk_category, focus_category)
    semantic_node_matches = _search_semantic_nodes(
        semantic_query_terms,
        category_set_id=assignment.get("categorySetId"),
        limit=8,
    )
    focus_resolution = "category"
    if focus_category and semantic_node_matches:
        focus_resolution = "category+semantic-node"
    elif not focus_category and semantic_node_matches:
        focus_resolution = "semantic-node"
    elif not focus_category and explicit_focus_key:
        focus_resolution = "temporary-focus-key"
    elif not focus_category:
        focus_resolution = "none"
    keywords = _list_category_keywords(
        assignment.get("categorySetId"),
        [category_key for category_key in [desk_category.get("categoryKey") if desk_category else None, focus_category.get("categoryKey") if focus_category else None] if category_key],
    )
    recent_assignments = _list_assignments()
    desk_assignments = _assignments_for_desk(recent_assignments, metadata, desk_category, focus_category, section_key=section_key)
    assignment_events = _assignment_events_for_assignments([entry.get("id") for entry in desk_assignments][:8])
    recent_published_items = _recent_published_items(recent_days)
    desk_published_items = _published_items_for_desk(recent_published_items, desk_category, focus_category)
    semantic = _semantic_client()
    reference_summaries = _desk_reference_summaries(semantic, desk_category, focus_category)
    comment_summaries = _desk_comment_summaries(semantic, reference_summaries)
    coverage_gaps: list[str] = []
    if focus_resolution == "none":
        coverage_gaps.append("No accepted focus category or semantic node match was found.")
    elif focus_resolution == "temporary-focus-key":
        coverage_gaps.append("Focus category key is metadata-only and not present in the accepted category set.")
    if not reference_summaries:
        coverage_gaps.append("No accepted desk-memory references matched this assignment context.")
    context_blocks = _build_assignment_context_blocks(
        assignment=assignment,
        metadata=metadata,
        doctrine=_normalize_jsonish(context.get("doctrine") or []),
        desk_category=desk_category,
        focus_category=focus_category,
        semantic_nodes=semantic_node_matches,
        category_keywords=keywords,
        desk_assignments=desk_assignments,
        assignment_events=assignment_events,
        published_items=desk_published_items,
        references=reference_summaries,
        comments=comment_summaries,
        lane_key=lane_key,
        profile_key=profile_key,
    )
    compaction = _build_biblicus_block_context_pack(
        blocks=context_blocks,
        profile_key=profile_key,
        max_tokens=token_budget,
    )
    return {
        "assignment_agent_context": {
            "assignmentId": assignment.get("id"),
            "sectionKey": section_key,
            "sectionId": assignment.get("sectionId") or metadata.get("sectionId") or section_key,
            "sectionTitle": metadata.get("sectionTitle") or section_key,
            "sectionType": assignment.get("sectionType") or metadata.get("sectionType"),
            "topicScopeCategoryKeys": _string_list(assignment.get("topicScopeCategoryKeys") or metadata.get("topicScopeCategoryKeys") or []),
            "primaryFocusCategoryKey": assignment.get("primaryFocusCategoryKey") or metadata.get("primaryFocusCategoryKey") or explicit_focus_key,
            "deskCategoryKey": desk_category.get("categoryKey") if desk_category else metadata.get("deskCategoryKey"),
            "deskCategoryLineageId": desk_category.get("lineageId") if desk_category else metadata.get("deskCategoryLineageId"),
            "focusCategoryKey": (
                focus_category.get("categoryKey")
                if focus_category
                else explicit_focus_key
            ),
            "focusCategoryLineageId": (
                focus_category.get("lineageId")
                if focus_category
                else metadata.get("focusCategoryLineageId")
            ),
            "focusCategoryTitle": (
                (focus_category.get("displayName") or focus_category.get("shortTitle"))
                if focus_category
                else metadata.get("focusCategoryTitle") or explicit_focus_key
            ),
            "contextProfile": profile_key,
            "contextTokenBudget": token_budget,
            "contextSources": metadata.get("contextSources") or ["doctrine", "focus-category", "desk-memory", "fresh-evidence"],
            "focusResolution": focus_resolution,
            "semanticNodeMatches": semantic_node_matches,
            "semanticQueryTerms": semantic_query_terms,
            "coverageGaps": coverage_gaps,
            "contextCoverage": {
                "deskFocusCategory": bool(desk_category or focus_category),
                "semanticNodeEntity": bool(semantic_node_matches),
                "acceptedEvidenceMemory": bool(reference_summaries),
                "doctrineFallbackOnly": not bool(desk_category or focus_category or semantic_node_matches or reference_summaries),
                "focusResolution": focus_resolution,
            },
            "blocks": context_blocks,
            "includedBlocks": compaction.get("included_blocks") or [],
            "droppedBlocks": compaction.get("dropped_blocks") or [],
            "sectionTokenCounts": compaction.get("section_token_counts") or {},
            "text": compaction.get("text") or "",
            "totalTokens": compaction.get("total_tokens") or 0,
            "totalCharacters": compaction.get("total_characters") or 0,
            "assignmentContext": context,
        }
    }


def papyrus_assignment_context_to_item(
    assignment_context_json: str = "",
    assignment_context: dict[str, Any] | None = None,
    generated_at: str = "",
) -> dict[str, Any]:
    """
    Normalize a live AssignmentContext into the dry-run Item-shaped procedure contract.
    """
    context = _decode_record_json(_coerce_payload(assignment_context, assignment_context_json, "assignment_context"))
    assignment = _decode_record_json(_coerce_payload(context.get("assignment"), "", "assignment_context.assignment"))
    return {
        "item": _procedure_assignment_item_from_live_assignment(
            assignment=assignment,
            doctrine=_normalize_jsonish(context.get("doctrine") or []),
            targets=_normalize_jsonish(context.get("targets") or []),
            events=_normalize_jsonish(context.get("events") or []),
            generated_at=generated_at or _now_iso(),
        )
    }


def papyrus_list_recent_published_articles(recent_days: int = 30, limit: int = 25) -> dict[str, Any]:
    """
    List recent published article Items for repetition avoidance.
    """
    cutoff = _utc_now() - _dt.timedelta(days=max(int(recent_days), 0))
    items: list[dict[str, Any]] = []
    next_token = None
    while len(items) < limit:
        data = _graphql(
            LIST_ARTICLES_QUERY,
            {
                "typeStatus": "article#published",
                "limit": min(max(limit, 1), 100),
                "nextToken": next_token,
            },
        )
        connection = data.get("listPublishedItemsByTypeStatusAndPublishedAt") or {}
        for item in connection.get("items") or []:
            decoded = _decode_record_json(item)
            published_at = _parse_datetime(decoded.get("publishedAt"))
            if published_at is None or published_at >= cutoff:
                items.append(decoded)
            if len(items) >= limit:
                break
        next_token = connection.get("nextToken")
        if not next_token:
            break
    return {
        "recent_days": int(recent_days),
        "cutoff": cutoff.isoformat().replace("+00:00", "Z"),
        "items": items,
    }


def papyrus_list_research_tracks() -> dict[str, Any]:
    """
    List available private newsroom research-track definitions.
    """
    tracks: list[dict[str, Any]] = []
    if not RESEARCH_TRACKS_PATH.exists():
        return {"tracks": tracks}
    for path in sorted(RESEARCH_TRACKS_PATH.glob("*.json")):
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            continue
        tracks.append(
            {
                "key": payload.get("key") or path.stem,
                "title": payload.get("title") or path.stem,
                "summary": payload.get("summary") or "",
                "path": str(path),
            }
        )
    return {"tracks": tracks}


def papyrus_get_research_track(track_key: str) -> dict[str, Any]:
    """
    Read one private newsroom research-track definition.
    """
    return {"track": _load_research_track(track_key)}


def papyrus_get_reference(reference_id: str) -> dict[str, Any]:
    """
    Read one private Reference metadata record through the authoring endpoint.
    """
    return _semantic_client().get_reference(reference_id)


def papyrus_find_reference(corpus_id: str, external_item_id: str) -> dict[str, Any]:
    """
    Find Reference metadata by corpus id plus external item id.
    """
    return _semantic_client().find_reference(corpus_id, external_item_id)


def papyrus_list_reference_attachments(
    reference_lineage_id: str | None = None,
    reference_version_key: str | None = None,
) -> dict[str, Any]:
    """
    List private attachment metadata for one Reference lineage or exact version.
    """
    return _semantic_client().list_reference_attachments(
        reference_lineage_id=reference_lineage_id,
        reference_version_key=reference_version_key,
    )


def papyrus_list_reference_messages(reference_lineage_id: str) -> dict[str, Any]:
    """
    List private messages attached to one Reference lineage.
    """
    return _semantic_client().list_reference_messages(reference_lineage_id)


def papyrus_get_semantic_object(kind: str, object_id: str) -> dict[str, Any]:
    """
    Read a graph-addressable private object by kind and exact version id.
    """
    return _semantic_client().get_semantic_object(kind, object_id)


def papyrus_semantic_outgoing(subject_kind: str, subject_lineage_id: str) -> dict[str, Any]:
    """
    List current SemanticRelation rows leaving one subject lineage.
    """
    return _semantic_client().list_outgoing(subject_kind, subject_lineage_id)


def papyrus_semantic_incoming(object_kind: str, object_lineage_id: str) -> dict[str, Any]:
    """
    List current SemanticRelation rows pointing at one object lineage.
    """
    return _semantic_client().list_incoming(object_kind, object_lineage_id)


def papyrus_semantic_neighbors(kind: str, lineage_id: str, direction: str = "both") -> dict[str, Any]:
    """
    List one-hop semantic neighbors around a Reference, Item, Category, or SemanticNode.
    """
    return _semantic_client().neighbors(kind, lineage_id, direction=direction)


def papyrus_references_for_category(category_lineage_id: str) -> dict[str, Any]:
    """
    List Reference relations classified under a category lineage.
    """
    return _semantic_client().references_for_category(category_lineage_id)


def papyrus_references_for_semantic_node(node_lineage_id: str, predicate: str | None = None) -> dict[str, Any]:
    """
    List Reference relations attached to a semantic node, optionally predicate-scoped.
    """
    return _semantic_client().references_for_semantic_node(node_lineage_id, predicate=predicate)


def papyrus_items_using_reference(reference_lineage_id: str) -> dict[str, Any]:
    """
    List Item relations that point at a Reference as evidence or context.
    """
    return _semantic_client().items_using_reference(reference_lineage_id)


def papyrus_semantic_walk(
    start_kind: str,
    start_lineage_id: str,
    depth: int = 2,
    predicates: list[str] | None = None,
    kinds: list[str] | None = None,
) -> dict[str, Any]:
    """
    Walk the private semantic graph from one lineage with bounded depth.
    """
    return _semantic_client().walk(
        start_kind=start_kind,
        start_lineage_id=start_lineage_id,
        depth=depth,
        predicates=predicates,
        kinds=kinds,
    )


def papyrus_search_semantic_nodes(query: str, limit: int = 10, category_set_id: str = "") -> dict[str, Any]:
    """
    Search current semantic nodes by term match against key, title, description, and aliases.
    """
    query_terms = _match_terms_from_text(query)
    if not query_terms:
        return {"query": query, "terms": [], "nodes": []}
    nodes = _search_semantic_nodes(query_terms, category_set_id=category_set_id, limit=limit)
    return {"query": query, "terms": query_terms, "nodes": nodes}


def biblicus_steering_artifacts(corpus_key: str, config_path: str = "") -> dict[str, Any]:
    """
    Discover Biblicus steering artifacts for a configured Papyrus corpus.
    """
    corpus = _resolve_corpus(corpus_key, config_path)
    return _run_biblicus(["steering", "artifacts", "--corpus", corpus["path"]], corpus)


def biblicus_topic_context(
    corpus_key: str,
    topic_modeling_snapshot: str = "",
    max_topics: int = 20,
    examples_per_topic: int = 3,
    summary_model: str = "gpt-5.4-mini",
    config_path: str = "",
) -> dict[str, Any]:
    """
    Generate a compact topic-context report from a configured Biblicus corpus.
    """
    corpus = _resolve_corpus(corpus_key, config_path)
    command = [
        "analyze",
        "topic-context",
        "--corpus",
        corpus["path"],
        "--max-topics",
        str(max_topics),
        "--examples-per-topic",
        str(examples_per_topic),
        "--summary-model",
        summary_model,
        "--format",
        "markdown",
    ]
    if topic_modeling_snapshot:
        command.extend(["--topic-modeling-snapshot", topic_modeling_snapshot])
    return _run_biblicus(command, corpus)


def biblicus_topic_trends(
    corpus_key: str,
    topic_modeling_snapshot: str = "",
    limit: int = 20,
    config_path: str = "",
) -> dict[str, Any]:
    """
    Generate temporal topic signals from a configured Biblicus corpus.
    """
    corpus = _resolve_corpus(corpus_key, config_path)
    command = [
        "analyze",
        "topic-trends",
        "--corpus",
        corpus["path"],
        "--limit",
        str(limit),
    ]
    if topic_modeling_snapshot:
        command.extend(["--topic-modeling-snapshot", topic_modeling_snapshot])
    return _run_biblicus(command, corpus)


def biblicus_query(
    corpus_key: str,
    query: str,
    max_total_items: int = 5,
    maximum_total_characters: int = 2000,
    config_path: str = "",
) -> dict[str, Any]:
    """
    Query a configured Biblicus corpus through the supported Biblicus CLI surface.
    """
    corpus = _resolve_corpus(corpus_key, config_path)
    command = [
        "query",
        "--corpus",
        corpus["path"],
        "--query",
        _required(query, "query"),
        "--max-total-items",
        str(max_total_items),
        "--maximum-total-characters",
        str(maximum_total_characters),
    ]
    return _run_biblicus(command, corpus)


def build_assignment_record_plan(
    edition_id: str,
    assignment_json: str = "",
    assignment: dict[str, Any] | None = None,
    corpus_key: str = "",
    placement_index: int = 1,
    generated_at: str = "",
) -> dict[str, Any]:
    """
    Build a dry-run create plan for an assignment Item and EditionItem link.
    """
    payload = _coerce_payload(assignment, assignment_json, "assignment")
    now = generated_at or _now_iso()
    edition_id = _required(edition_id, "edition_id")
    title = _required(payload.get("title") or payload.get("headline"), "assignment.title")
    slug = _slugify(payload.get("slug") or title)
    section = str(payload.get("section") or "News")
    priority = int(payload.get("priority") or placement_index or 1)
    resolved_corpus_key = corpus_key or str(payload.get("corpus_key") or payload.get("corpusKey") or "")
    category_key = payload.get("category_key") or payload.get("categoryKey") or payload.get("topic_uid") or payload.get("topicUid")
    evidence_item_ids = _string_list(
        payload.get("evidence_item_ids") or payload.get("evidenceItemIds")
    )
    assignment_id = str(payload.get("id") or f"assignment-{_hash_short([edition_id, slug])}")
    edition_item_id = str(
        payload.get("edition_item_id") or f"edition-assignment-{_hash_short([edition_id, assignment_id])}"
    )
    target_article_slots = _optional_int(
        payload.get("target_article_slots")
        or payload.get("targetArticleSlots")
        or payload.get("target_articles")
        or payload.get("targetArticles")
    )
    assignment_ratio = _optional_float(
        payload.get("assignment_ratio")
        or payload.get("assignmentRatio")
        or payload.get("overassignment_ratio")
        or payload.get("overassignmentRatio")
    )
    track_contract = _assignment_track_contract(payload)

    assignment_state = {
        "brief": str(payload.get("brief") or payload.get("deck") or ""),
        "angle": str(payload.get("angle") or ""),
        "corpusKey": resolved_corpus_key or None,
        "categoryKey": category_key,
        "evidenceItemIds": evidence_item_ids,
        "targetArticleSlots": target_article_slots,
        "overassignmentRatio": assignment_ratio,
        "sourceSnapshots": _normalize_jsonish(payload.get("source_snapshots") or payload.get("sourceSnapshots") or []),
        "recentArticleAvoidance": _normalize_jsonish(
            payload.get("recent_article_avoidance")
            or payload.get("recentArticleAvoidance")
            or payload.get("recent_article_notes")
            or payload.get("recentArticleNotes")
            or []
        ),
        "procedure": {
            "role": "editor",
            "name": "procedures/newsroom/editor.tac",
            "version": NEWSROOM_VERSION,
            "generatedAt": now,
        },
        "downstreamReporter": {
            "procedure": REPORTER_PROCEDURE,
            "inputItemId": assignment_id,
        },
    }
    assignment_state.update(track_contract)

    item = _with_initial_version({
        "id": assignment_id,
        "type": ASSIGNMENT_TYPE,
        "status": ASSIGNMENT_DISPATCH_STATUS,
        "typeStatus": f"{ASSIGNMENT_TYPE}#{ASSIGNMENT_DISPATCH_STATUS}",
        "slug": slug,
        "shortSlug": payload.get("shortSlug") or payload.get("short_slug"),
        "section": section,
        "sectionStatus": f"{_slugify(section)}#{ASSIGNMENT_DISPATCH_STATUS}",
        "title": title,
        "headline": title,
        "deck": str(payload.get("brief") or payload.get("deck") or ""),
        "body": [],
        "byline": str(payload.get("byline") or "Papyrus Staff"),
        "dateline": str(payload.get("dateline") or "NEWSROOM"),
        "publishedAt": None,
        "editionDate": payload.get("editionDate") or payload.get("edition_date"),
        "sortTitle": _sort_title(title),
        "pullQuotes": [],
        "layout": {"source": "newsroom-assignment"},
        "editorial": {"newsroom": {"assignment": assignment_state}},
    }, now=now, actor="newsroom-editor", reason="assignment dispatch")
    item = {
        key: value
        for key, value in item.items()
        if value is not None or key in {"publishedAt"}
    }

    edition_item = {
        "id": edition_item_id,
        "editionId": edition_id,
        "editionLineageId": payload.get("editionLineageId") or payload.get("edition_lineage_id") or edition_id,
        "itemId": assignment_id,
        "itemLineageId": item["lineageId"],
        "placementKey": f"assignment:{slug}",
        "sortKey": f"assignment:{priority:04d}:{slug}",
        "pageNumber": payload.get("pageNumber") or payload.get("page_number"),
        "priority": priority,
        "metadata": {
            "newsroom": {
                "role": "assignment",
                "status": ASSIGNMENT_DISPATCH_STATUS,
                "createdByProcedure": "procedures/newsroom/editor.tac",
                "generatedAt": now,
                "targetArticleSlots": target_article_slots,
                "overassignmentRatio": assignment_ratio,
                "downstreamProcedure": REPORTER_PROCEDURE,
            }
        },
    }
    edition_item = {key: value for key, value in edition_item.items() if value is not None}

    records = [
        {"modelName": "Item", "action": "create", "input": item},
        {"modelName": "EditionItem", "action": "create", "input": edition_item},
    ]
    records.extend(
        _evidence_relation_records(
            item=item,
            evidence_item_ids=evidence_item_ids,
            corpus_key=resolved_corpus_key,
            now=now,
            lifecycle="assignment-dispatch",
        )
    )

    return {
        "dryRun": True,
        "lifecycle": "assignment-dispatch",
        "item": item,
        "editionItem": edition_item,
        "records": records,
        "warnings": [],
    }


def build_assignment_dispatch_plan(
    edition_id: str,
    section_targets_json: str = "",
    section_targets: Any = None,
    assignments_json: str = "",
    assignments: Any = None,
    corpus_key: str = "",
    assignment_ratio: float | str = DEFAULT_ASSIGNMENT_RATIO,
    generated_at: str = "",
) -> dict[str, Any]:
    """
    Build a dry-run section-capped assignment dispatch plan.

    The editor may produce more candidate assignments than the final edition
    needs, but this helper limits reviewer load to the requested per-section
    target multiplied by the overassignment ratio.
    """
    now = generated_at or _now_iso()
    edition_id = _required(edition_id, "edition_id")
    ratio = _positive_float(assignment_ratio, "assignment_ratio")
    normalized_targets = _normalize_section_targets(section_targets, section_targets_json, ratio)
    candidate_assignments = _coerce_payload_list(assignments, assignments_json, "assignments")
    candidates_by_section: dict[str, list[dict[str, Any]]] = {}
    for candidate in candidate_assignments:
        section_key = _slugify(candidate.get("section") or "News")
        candidates_by_section.setdefault(section_key, []).append(candidate)

    record_plans: list[dict[str, Any]] = []
    reporter_dispatches: list[dict[str, Any]] = []
    assignment_summaries: list[dict[str, Any]] = []
    warnings: list[str] = []
    total_target_articles = 0
    total_suppressed = 0
    placement_index = 1

    for target in normalized_targets:
        section_key = target["sectionKey"]
        candidates = candidates_by_section.get(section_key, [])
        target_articles = target["targetArticles"]
        dispatch_count = target["dispatchCount"]
        total_target_articles += target_articles
        if len(candidates) < dispatch_count:
            warnings.append(
                f"section {target['section']} supplied {len(candidates)} assignment candidate(s) for {dispatch_count} dispatch slot(s)"
            )
        selected = candidates[:dispatch_count]
        suppressed = max(len(candidates) - len(selected), 0)
        total_suppressed += suppressed
        target["selectedAssignments"] = len(selected)
        target["suppressedCandidates"] = suppressed

        for section_index, candidate in enumerate(selected, start=1):
            candidate_payload = dict(candidate)
            candidate_payload.setdefault("section", target["section"])
            candidate_payload["targetArticleSlots"] = target_articles
            candidate_payload["overassignmentRatio"] = ratio
            candidate_payload["sectionAssignmentIndex"] = section_index
            plan = build_assignment_record_plan(
                edition_id=edition_id,
                assignment=candidate_payload,
                corpus_key=corpus_key,
                placement_index=placement_index,
                generated_at=now,
            )
            item = plan["item"]
            record_plans.append(plan)
            assignment_summaries.append(
                {
                    "id": item["id"],
                    "slug": item["slug"],
                    "title": item["title"],
                    "section": item.get("section"),
                    "status": item["status"],
                    "type": item["type"],
                    "targetArticleSlots": target_articles,
                }
            )
            reporter_dispatches.append(
                {
                    "dryRun": True,
                    "procedure": REPORTER_PROCEDURE,
                    "assignmentItemId": item["id"],
                    "section": item.get("section"),
                    "input": {
                        "assignment_item_id": item["id"],
                        "assignment_json": json.dumps(item, sort_keys=True),
                        "corpus_key": corpus_key or _assignment_corpus_key(item),
                    },
                }
            )
            placement_index += 1

    return {
        "dryRun": True,
        "lifecycle": "assignment-dispatch",
        "editionId": edition_id,
        "corpusKey": corpus_key,
        "assignmentRatio": ratio,
        "sectionTargets": [
            {
                "section": target["section"],
                "targetArticles": target["targetArticles"],
                "dispatchCount": target["dispatchCount"],
                "selectedAssignments": target["selectedAssignments"],
                "suppressedCandidates": target["suppressedCandidates"],
            }
            for target in normalized_targets
        ],
        "assignments": assignment_summaries,
        "recordPlans": record_plans,
        "reporterDispatches": reporter_dispatches,
        "reviewerLoad": {
            "targetArticleCount": total_target_articles,
            "dispatchedAssignmentCount": len(record_plans),
            "suppressedCandidateCount": total_suppressed,
            "assignmentRatio": ratio,
        },
        "warnings": warnings,
    }


def build_research_update_plan(
    assignment_item_json: str = "",
    assignment_item: dict[str, Any] | None = None,
    research_json: str = "",
    research: dict[str, Any] | None = None,
    generated_at: str = "",
) -> dict[str, Any]:
    """
    Build a dry-run update plan that attaches research to an assignment Item.
    """
    item = _decode_record_json(_coerce_payload(assignment_item, assignment_item_json, "assignment_item"))
    research_payload = _coerce_payload(research, research_json, "research")
    now = generated_at or _now_iso()

    if item.get("type") != ASSIGNMENT_TYPE:
        raise ValueError("assignment item must have type 'assignment'")
    if item.get("status") not in {ASSIGNMENT_DISPATCH_STATUS, ASSIGNMENT_RESEARCH_STATUS}:
        raise ValueError("research can only be attached to dispatched assignment Items in v1")

    summary = _required(research_payload.get("summary"), "research.summary")
    corpus_key = research_payload.get("corpus_key") or research_payload.get("corpusKey")
    category_key = (
        research_payload.get("category_key")
        or research_payload.get("categoryKey")
        or research_payload.get("topic_uid")
        or research_payload.get("topicUid")
    )
    evidence_item_ids = _string_list(
        research_payload.get("evidence_item_ids") or research_payload.get("evidenceItemIds")
    )
    source_snapshots = _jsonish_list(
        research_payload.get("source_snapshots") or research_payload.get("sourceSnapshots") or []
    )
    proposed_references = _jsonish_list(
        research_payload.get("proposed_references") or research_payload.get("proposedReferences") or []
    )

    editorial = _normalize_jsonish(item.get("editorial") or {})
    if not isinstance(editorial, dict):
        editorial = {}
    newsroom = editorial.setdefault("newsroom", {})
    assignment_state = newsroom.get("assignment")
    if not isinstance(assignment_state, dict):
        assignment_state = {}
    doctrine_context = _normalize_jsonish(
        research_payload.get("doctrine_context") or research_payload.get("doctrineContext") or {}
    )
    comparison_findings = _jsonish_list(
        research_payload.get("comparison_findings") or research_payload.get("comparisonFindings") or []
    )
    rubric_assessments = _jsonish_list(
        research_payload.get("rubric_assessments") or research_payload.get("rubricAssessments") or []
    )
    newsroom["research"] = {
        "status": "researched",
        "summary": summary,
        "corpusKey": corpus_key,
        "categoryKey": category_key,
        "evidenceItemIds": evidence_item_ids,
        "deskCategoryKey": assignment_state.get("deskCategoryKey"),
        "deskCategoryLineageId": assignment_state.get("deskCategoryLineageId"),
        "focusCategoryKey": assignment_state.get("focusCategoryKey") or category_key,
        "focusCategoryLineageId": assignment_state.get("focusCategoryLineageId"),
        "focusCategoryTitle": assignment_state.get("focusCategoryTitle"),
        "contextProfile": assignment_state.get("contextProfile"),
        "contextTokenBudget": assignment_state.get("contextTokenBudget"),
        "contextSources": _jsonish_list(assignment_state.get("contextSources") or []),
        "researchTrackKey": assignment_state.get("researchTrackKey"),
        "researchLens": assignment_state.get("researchLens"),
        "targetSystemType": assignment_state.get("targetSystemType"),
        "comparisonQuestions": _normalize_jsonish(assignment_state.get("comparisonQuestions") or []),
        "doctrineContext": doctrine_context,
        "queries": _jsonish_list(research_payload.get("queries") or []),
        "sourceSnapshots": source_snapshots,
        "proposedReferences": proposed_references,
        "researchNotes": _jsonish_list(
            research_payload.get("research_notes") or research_payload.get("researchNotes") or []
        ),
        "comparisonFindings": comparison_findings,
        "rubricAssessments": rubric_assessments,
        "openQuestions": _jsonish_list(
            research_payload.get("open_questions") or research_payload.get("openQuestions") or []
        ),
        "coverageGaps": _jsonish_list(
            research_payload.get("coverage_gaps") or research_payload.get("coverageGaps") or []
        ),
        "recommendedAngle": str(
            research_payload.get("recommended_angle")
            or research_payload.get("recommendedAngle")
            or ""
        ),
        "procedure": {
            "role": "researcher",
            "name": "procedures/newsroom/researcher.tac",
            "version": NEWSROOM_VERSION,
            "generatedAt": now,
        },
    }

    updated_item = _next_version(
        item,
        {
            "status": ASSIGNMENT_RESEARCH_STATUS,
            "typeStatus": f"{ASSIGNMENT_TYPE}#{ASSIGNMENT_RESEARCH_STATUS}",
            "sectionStatus": f"{_slugify(item.get('section') or 'news')}#{ASSIGNMENT_RESEARCH_STATUS}",
            "publishedAt": None,
            "editorial": editorial,
        },
        now=now,
        actor="newsroom-researcher",
        reason="assignment research",
    )

    warnings = []
    if not evidence_item_ids and not source_snapshots and not proposed_references:
        warnings.append("research.evidenceItemIds is empty")
    if assignment_state.get("researchTrackKey") and not doctrine_context:
        warnings.append("research.doctrineContext is empty")
    if assignment_state.get("researchTrackKey") and not rubric_assessments:
        warnings.append("research.rubricAssessments is empty")

    records = [
        {"modelName": "Item", "action": "create", "input": updated_item},
        {"modelName": "Item", "action": "update", "input": _supersede_update(item, now)},
    ]
    records.extend(
        _evidence_relation_records(
            item=updated_item,
            evidence_item_ids=evidence_item_ids,
            corpus_key=str(corpus_key or _assignment_corpus_key(item) or ""),
            now=now,
            lifecycle="assignment-research",
        )
    )

    return {
        "dryRun": True,
        "lifecycle": "assignment-research",
        "item": updated_item,
        "records": records,
        "warnings": warnings,
    }


def build_assignment_research_packet_plan(
    assignment_json: str = "",
    assignment: dict[str, Any] | None = None,
    research_json: str = "",
    research: dict[str, Any] | None = None,
    generated_at: str = "",
) -> dict[str, Any]:
    """
    Build a dry-run Message work-product plan for a live Assignment.
    """
    assignment_payload = _decode_record_json(_coerce_payload(assignment, assignment_json, "assignment"))
    research_payload = _coerce_payload(research, research_json, "research")
    now = generated_at or _now_iso()

    assignment_id = _required(assignment_payload.get("id"), "assignment.id")
    if not assignment_payload.get("assignmentTypeKey"):
        raise ValueError("live assignment research packets require assignment.assignmentTypeKey")
    if not assignment_payload.get("queueKey"):
        raise ValueError("live assignment research packets require assignment.queueKey")

    summary = _required(research_payload.get("summary"), "research.summary")
    research_packet = _research_packet_metadata(research_payload, assignment_payload, now)
    message_id = f"message-research-packet-{_hash_short([assignment_id, summary, now])}"
    message = {
        "id": message_id,
        "messageKind": "research_packet",
        "messageDomain": "assignment_work",
        "status": "active",
        "body": summary,
        "summary": summary,
        "source": "procedures/newsroom/researcher.tac",
        "importRunId": assignment_payload.get("importRunId"),
        "authorLabel": "newsroom-researcher",
        "createdAt": now,
        "updatedAt": now,
        "metadata": {
            "kind": "research.packet.created",
            "assignmentId": assignment_id,
            "assignmentTypeKey": assignment_payload.get("assignmentTypeKey"),
            "queueKey": assignment_payload.get("queueKey"),
            "research": research_packet,
        },
    }
    relation = _semantic_relation(
        predicate="comment",
        subject_kind="message",
        subject_id=message_id,
        subject_lineage_id=message_id,
        subject_version_number=None,
        object_kind="assignment",
        object_id=assignment_id,
        object_lineage_id=assignment_id,
        object_version_number=None,
        rank=1,
        score=None,
        confidence=None,
        classifier_id=assignment_payload.get("classifierId"),
        model_version=None,
        review_recommended=False,
        source_snapshot_id=assignment_payload.get("sourceSnapshotId"),
        import_run_id=assignment_payload.get("importRunId"),
        imported_at=now,
        metadata={
            "lifecycle": "assignment-research-packet",
            "messageKind": "research_packet",
            "metadataKind": "research.packet.created",
            "assignmentTypeKey": assignment_payload.get("assignmentTypeKey"),
            "queueKey": assignment_payload.get("queueKey"),
        },
    )

    warnings = []
    if not research_packet["evidenceItemIds"] and not research_packet["sourceSnapshots"] and not research_packet["proposedReferences"]:
        warnings.append("research packet has no accepted evidence ids, source snapshots, or proposed references")

    return {
        "dryRun": True,
        "lifecycle": "assignment-research-packet",
        "assignmentId": assignment_id,
        "message": message,
        "records": [
            {"modelName": "Message", "action": "create", "input": message},
            {"modelName": "SemanticRelation", "action": "create", "input": relation},
        ],
        "warnings": warnings,
    }


def build_draft_update_plan(
    assignment_item_json: str = "",
    assignment_item: dict[str, Any] | None = None,
    draft_json: str = "",
    draft: dict[str, Any] | None = None,
    generated_at: str = "",
) -> dict[str, Any]:
    """
    Build a dry-run plan that marks an assignment drafted and creates an article draft.
    """
    item = _decode_record_json(_coerce_payload(assignment_item, assignment_item_json, "assignment_item"))
    draft_payload = _coerce_payload(draft, draft_json, "draft")
    now = generated_at or _now_iso()

    if item.get("type") != ASSIGNMENT_TYPE:
        raise ValueError("assignment item must have type 'assignment'")
    if item.get("status") not in {ASSIGNMENT_DISPATCH_STATUS, ASSIGNMENT_RESEARCH_STATUS, ASSIGNMENT_DRAFT_STATUS}:
        raise ValueError("assignment item status must be 'dispatched', 'researched', or 'drafted'")

    headline = _required(draft_payload.get("headline") or draft_payload.get("title"), "draft.headline")
    body = _string_list(draft_payload.get("body"))
    if not body:
        raise ValueError("draft.body must contain at least one paragraph")

    editorial = _normalize_jsonish(item.get("editorial") or {})
    if not isinstance(editorial, dict):
        editorial = {}
    newsroom = editorial.setdefault("newsroom", {})
    newsroom["draft"] = {
        "deck": str(draft_payload.get("deck") or ""),
        "evidenceItemIds": _string_list(
            draft_payload.get("evidence_item_ids") or draft_payload.get("evidenceItemIds")
        ),
        "sourceNotes": _normalize_jsonish(draft_payload.get("source_notes") or draft_payload.get("sourceNotes") or []),
        "procedure": {
            "role": "reporter",
            "name": "procedures/newsroom/reporter.tac",
            "version": NEWSROOM_VERSION,
            "generatedAt": now,
        },
    }

    slug = _slugify(draft_payload.get("slug") or item.get("slug") or headline)
    section = str(draft_payload.get("section") or item.get("section") or "News")
    draft_item_id = str(draft_payload.get("id") or f"item-{slug}")
    newsroom["draft"]["articleItemId"] = draft_item_id
    assignment_update = _next_version(
        item,
        {
            "status": ASSIGNMENT_DRAFT_STATUS,
            "typeStatus": f"{ASSIGNMENT_TYPE}#{ASSIGNMENT_DRAFT_STATUS}",
            "sectionStatus": f"{_slugify(section)}#{ASSIGNMENT_DRAFT_STATUS}",
            "publishedAt": None,
            "editorial": editorial,
        },
        now=now,
        actor="newsroom-reporter",
        reason="assignment drafted",
    )

    draft_item = _with_initial_version({
        "id": draft_item_id,
        "type": ARTICLE_TYPE,
        "status": ARTICLE_DRAFT_STATUS,
        "typeStatus": f"{ARTICLE_TYPE}#{ARTICLE_DRAFT_STATUS}",
        "slug": slug,
        "shortSlug": draft_payload.get("shortSlug") or draft_payload.get("short_slug") or item.get("shortSlug"),
        "section": section,
        "sectionStatus": f"{_slugify(section)}#{ARTICLE_DRAFT_STATUS}",
        "title": draft_payload.get("title") or headline,
        "headline": headline,
        "deck": str(draft_payload.get("deck") or item.get("deck") or ""),
        "body": body,
        "byline": str(draft_payload.get("byline") or item.get("byline") or "Papyrus Staff"),
        "dateline": str(draft_payload.get("dateline") or item.get("dateline") or "NEWSROOM"),
        "publishedAt": None,
        "editionDate": draft_payload.get("editionDate") or draft_payload.get("edition_date") or item.get("editionDate"),
        "sortTitle": _sort_title(draft_payload.get("title") or headline),
        "pullQuotes": _string_list(draft_payload.get("pullQuotes") or draft_payload.get("pull_quotes")),
        "layout": {"source": "newsroom-reporter"},
        "editorial": {
            "newsroom": {
                "assignmentItemId": assignment_update.get("id"),
                "assignment": newsroom.get("assignment", {}),
                "research": newsroom.get("research"),
                "draft": newsroom["draft"],
            }
        },
    }, now=now, actor="newsroom-reporter", reason="assignment draft")
    draft_item = {
        key: value
        for key, value in draft_item.items()
        if value is not None or key in {"publishedAt"}
    }

    draft_evidence_item_ids = _string_list(
        draft_payload.get("evidence_item_ids") or draft_payload.get("evidenceItemIds")
    )
    records = [
        {"modelName": "Item", "action": "create", "input": assignment_update},
        {"modelName": "Item", "action": "update", "input": _supersede_update(item, now)},
        {"modelName": "Item", "action": "create", "input": draft_item},
    ]
    relation_corpus_key = str(draft_payload.get("corpus_key") or draft_payload.get("corpusKey") or _assignment_corpus_key(item) or "")
    records.extend(
        _evidence_relation_records(
            item=assignment_update,
            evidence_item_ids=draft_evidence_item_ids,
            corpus_key=relation_corpus_key,
            now=now,
            lifecycle="assignment-draft",
        )
    )
    records.extend(
        _evidence_relation_records(
            item=draft_item,
            evidence_item_ids=draft_evidence_item_ids,
            corpus_key=relation_corpus_key,
            now=now,
            lifecycle="draft",
        )
    )

    return {
        "dryRun": True,
        "lifecycle": "draft",
        "assignmentItem": assignment_update,
        "item": draft_item,
        "draftItem": draft_item,
        "records": records,
        "warnings": [],
    }


def _evidence_relation_records(
    *,
    item: dict[str, Any],
    evidence_item_ids: list[str],
    corpus_key: str,
    now: str,
    lifecycle: str,
) -> list[dict[str, Any]]:
    if not evidence_item_ids or not corpus_key:
        return []

    subject_kind = "item"
    subject_id = str(item["id"])
    subject_lineage_id = str(item.get("lineageId") or subject_id)
    subject_version_number = _optional_int(item.get("versionNumber"))
    records: list[dict[str, Any]] = []
    for rank, evidence_item_id in enumerate(evidence_item_ids, start=1):
        reference_lineage_id = _reference_lineage_id(corpus_key, evidence_item_id)
        reference_id = f"{reference_lineage_id}-v1"
        relation = _semantic_relation(
            predicate="uses_evidence",
            subject_kind=subject_kind,
            subject_id=subject_id,
            subject_lineage_id=subject_lineage_id,
            subject_version_number=subject_version_number,
            object_kind="reference",
            object_id=reference_id,
            object_lineage_id=reference_lineage_id,
            object_version_number=1,
            rank=rank,
            score=None,
            confidence=None,
            classifier_id=None,
            model_version=None,
            review_recommended=False,
            source_snapshot_id=None,
            import_run_id=None,
            imported_at=now,
            metadata={
                "lifecycle": lifecycle,
                "corpusKey": corpus_key,
                "externalItemId": evidence_item_id,
            },
        )
        records.append({"modelName": "SemanticRelation", "action": "create", "input": relation})
    return records


def _research_packet_metadata(research_payload: dict[str, Any], assignment: dict[str, Any], now: str) -> dict[str, Any]:
    evidence_item_ids = _string_list(
        research_payload.get("evidence_item_ids") or research_payload.get("evidenceItemIds")
    )
    metadata = _normalize_jsonish(assignment.get("metadata") or {})
    if not isinstance(metadata, dict):
        metadata = {}
    return {
        "status": "researched",
        "summary": str(research_payload.get("summary") or ""),
        "corpusKey": research_payload.get("corpus_key") or research_payload.get("corpusKey") or assignment.get("corpusId"),
        "categoryKey": (
            research_payload.get("category_key")
            or research_payload.get("categoryKey")
            or metadata.get("focusCategoryKey")
            or metadata.get("deskCategoryKey")
        ),
        "evidenceItemIds": evidence_item_ids,
        "deskCategoryKey": metadata.get("deskCategoryKey"),
        "deskCategoryLineageId": metadata.get("deskCategoryLineageId"),
        "focusCategoryKey": metadata.get("focusCategoryKey"),
        "focusCategoryLineageId": metadata.get("focusCategoryLineageId"),
        "focusCategoryTitle": metadata.get("focusCategoryTitle"),
        "contextProfile": metadata.get("contextProfile"),
        "contextTokenBudget": metadata.get("contextTokenBudget"),
        "contextSources": _jsonish_list(metadata.get("contextSources") or []),
        "doctrineContext": _normalize_jsonish(
            research_payload.get("doctrine_context") or research_payload.get("doctrineContext") or {}
        ),
        "queries": _jsonish_list(research_payload.get("queries") or []),
        "sourceSnapshots": _jsonish_list(
            research_payload.get("source_snapshots") or research_payload.get("sourceSnapshots") or []
        ),
        "proposedReferences": _jsonish_list(
            research_payload.get("proposed_references") or research_payload.get("proposedReferences") or []
        ),
        "researchNotes": _jsonish_list(
            research_payload.get("research_notes") or research_payload.get("researchNotes") or []
        ),
        "comparisonFindings": _jsonish_list(
            research_payload.get("comparison_findings") or research_payload.get("comparisonFindings") or []
        ),
        "rubricAssessments": _jsonish_list(
            research_payload.get("rubric_assessments") or research_payload.get("rubricAssessments") or []
        ),
        "openQuestions": _jsonish_list(
            research_payload.get("open_questions") or research_payload.get("openQuestions") or []
        ),
        "coverageGaps": _jsonish_list(
            research_payload.get("coverage_gaps") or research_payload.get("coverageGaps") or []
        ),
        "recommendedAngle": str(
            research_payload.get("recommended_angle")
            or research_payload.get("recommendedAngle")
            or ""
        ),
        "procedure": {
            "role": "researcher",
            "name": "procedures/newsroom/researcher.tac",
            "version": NEWSROOM_VERSION,
            "generatedAt": now,
        },
    }


def _semantic_relation(
    *,
    predicate: str,
    subject_kind: str,
    subject_id: str,
    subject_lineage_id: str,
    subject_version_number: int | None,
    object_kind: str,
    object_id: str,
    object_lineage_id: str,
    object_version_number: int | None,
    rank: int | None,
    score: float | None,
    confidence: float | None,
    classifier_id: str | None,
    model_version: str | None,
    review_recommended: bool,
    source_snapshot_id: str | None,
    import_run_id: str | None,
    imported_at: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    relation_type_fields = RELATION_TYPE_FIELDS.get(predicate)
    if relation_type_fields is None:
        raise ValueError(f"unsupported semantic relation predicate: {predicate}")
    subject_state_key = _semantic_state_key(subject_kind, subject_lineage_id)
    object_state_key = _semantic_state_key(object_kind, object_lineage_id)
    predicate_object_state_key = f"{predicate}#{object_state_key}"
    subject_version_key = _semantic_version_key(subject_kind, subject_id)
    object_version_key = _semantic_version_key(object_kind, object_id)
    relation_id = "semantic-relation-" + _hash_short(
        [
            subject_version_key,
            predicate,
            object_version_key,
            rank,
            classifier_id,
            model_version,
        ]
    )
    relation: dict[str, Any] = {
        "id": relation_id,
        "relationState": "current",
        "predicate": predicate,
        **relation_type_fields,
        "subjectKind": subject_kind,
        "subjectId": subject_id,
        "subjectLineageId": subject_lineage_id,
        "subjectVersionNumber": subject_version_number,
        "objectKind": object_kind,
        "objectId": object_id,
        "objectLineageId": object_lineage_id,
        "objectVersionNumber": object_version_number,
        "subjectStateKey": subject_state_key,
        "objectStateKey": object_state_key,
        "objectSubjectStateKey": f"{object_state_key}#{subject_kind}",
        "predicateObjectStateKey": predicate_object_state_key,
        "subjectVersionKey": subject_version_key,
        "objectVersionKey": object_version_key,
        "score": score,
        "confidence": confidence,
        "rank": rank,
        "classifierId": classifier_id,
        "modelVersion": model_version,
        "reviewRecommended": review_recommended,
        "sourceSnapshotId": source_snapshot_id,
        "importRunId": import_run_id,
        "importedAt": imported_at,
        "metadata": metadata,
    }
    return {key: value for key, value in relation.items() if value is not None}


def _reference_lineage_id(corpus_key: str, external_item_id: str) -> str:
    return f"reference-{_knowledge_corpus_id(corpus_key)}-{_slugify(external_item_id)}"


def _knowledge_corpus_id(corpus_key: str) -> str:
    return f"knowledge-corpus-{_slugify(corpus_key)}"


def _semantic_state_key(kind: str, lineage_id: str) -> str:
    return f"{kind}#{lineage_id}#current"


def _semantic_version_key(kind: str, version_id: str) -> str:
    return f"{kind}#{version_id}"


def _with_initial_version(
    record: dict[str, Any],
    *,
    now: str,
    actor: str,
    reason: str,
) -> dict[str, Any]:
    versioned = dict(record)
    lineage_id = str(versioned.get("lineageId") or versioned["id"])
    versioned.update(
        {
            "lineageId": lineage_id,
            "versionNumber": int(versioned.get("versionNumber") or 1),
            "previousVersionId": versioned.get("previousVersionId"),
            "versionState": versioned.get("versionState") or "current",
            "versionCreatedAt": versioned.get("versionCreatedAt") or now,
            "versionCreatedBy": versioned.get("versionCreatedBy") or actor,
            "changeReason": versioned.get("changeReason") or reason,
        }
    )
    versioned["contentHash"] = _content_hash(versioned)
    return versioned


def _next_version(
    current: dict[str, Any],
    updates: dict[str, Any],
    *,
    now: str,
    actor: str,
    reason: str,
) -> dict[str, Any]:
    lineage_id = str(current.get("lineageId") or current["id"])
    version_number = int(current.get("versionNumber") or 1) + 1
    versioned = dict(current)
    versioned.update(updates)
    versioned.update(
        {
            "id": f"{lineage_id}-v{version_number}",
            "lineageId": lineage_id,
            "versionNumber": version_number,
            "previousVersionId": current["id"],
            "versionState": "current",
            "versionCreatedAt": now,
            "versionCreatedBy": actor,
            "changeReason": reason,
        }
    )
    versioned["contentHash"] = _content_hash(versioned)
    return versioned


def _supersede_update(current: dict[str, Any], now: str) -> dict[str, Any]:
    return {
        "id": current["id"],
        "versionState": "superseded",
        "updatedAt": now,
    }


def _content_hash(record: dict[str, Any]) -> str:
    payload = {key: value for key, value in record.items() if key != "contentHash"}
    return "sha256:" + hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _graphql(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    endpoint = os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT")
    token = os.environ.get("PAPYRUS_GRAPHQL_JWT")
    if not endpoint:
        raise ValueError("Missing PAPYRUS_GRAPHQL_ENDPOINT for Papyrus GraphQL read tool.")
    if not token:
        raise ValueError("Missing PAPYRUS_GRAPHQL_JWT for Papyrus GraphQL read tool.")

    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "content-type": "application/json",
            "Authorization": _lambda_auth_token(token),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GraphQL request failed: {error.code} {error.reason}: {detail}") from error

    if payload.get("errors"):
        raise RuntimeError("; ".join(error.get("message", str(error)) for error in payload["errors"]))
    return payload.get("data") or {}


def _lambda_auth_token(token: str) -> str:
    return f"PapyrusJwt {re.sub(r'^Bearer\s+', '', token.strip(), flags=re.IGNORECASE)}"


def _resolve_corpus(corpus_key: str, config_path: str = "") -> dict[str, Any]:
    config = _load_steering_config(config_path)
    key = _required(corpus_key, "corpus_key")
    for corpus in config.get("corpora") or []:
        if corpus.get("key") == key:
            resolved = dict(corpus)
            path_value = _required(resolved.get("path"), f"corpora[{key}].path")
            path = Path(path_value)
            if not path.is_absolute():
                path = BIBLICUS_ROOT / path
            resolved["path"] = str(path)
            return resolved
    raise ValueError(f"Unknown corpus_key in steering config: {key}")


def _load_research_track(track_key: str) -> dict[str, Any]:
    key = _slugify(_required(track_key, "track_key"))
    path = RESEARCH_TRACKS_PATH / f"{key}.json"
    if not path.exists():
        raise ValueError(f"Unknown research track: {key}")
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Research track must be a JSON object: {path}")
    payload_key = _slugify(payload.get("key") or path.stem)
    if payload_key != key:
        raise ValueError(f"Research track key mismatch for {path}")
    return payload


def _assignment_track_contract(payload: dict[str, Any]) -> dict[str, Any]:
    track_key = payload.get("research_track_key") or payload.get("researchTrackKey")
    if not track_key:
        return {}

    track = _load_research_track(str(track_key))
    template = _research_track_template(
        track,
        payload.get("research_lens")
        or payload.get("researchLens")
        or payload.get("assignment_template_key")
        or payload.get("assignmentTemplateKey")
        or payload.get("template_key")
        or payload.get("templateKey"),
    )
    target_system_type = _required(
        payload.get("target_system_type")
        or payload.get("targetSystemType")
        or payload.get("case_study_type")
        or payload.get("caseStudyType"),
        "assignment.targetSystemType",
    )
    expected_evidence_classes = _string_list(
        payload.get("expected_evidence_classes")
        or payload.get("expectedEvidenceClasses")
        or template.get("expectedEvidenceClasses")
    )
    if not expected_evidence_classes:
        raise ValueError("assignment.expectedEvidenceClasses is required")
    comparison_questions = _string_list(
        payload.get("comparison_questions")
        or payload.get("comparisonQuestions")
        or template.get("comparisonQuestions")
    )
    if not comparison_questions:
        raise ValueError("assignment.comparisonQuestions is required")

    return {
        "researchTrackKey": track["key"],
        "researchTrackTitle": track.get("title"),
        "researchLens": template["lens"],
        "researchLensTitle": template.get("title"),
        "assignmentTemplateKey": template["lens"],
        "assignmentTemplateTitle": template.get("title"),
        "targetSystemType": target_system_type,
        "expectedEvidenceClasses": expected_evidence_classes,
        "comparisonQuestions": comparison_questions,
        "evidenceRubric": _normalize_jsonish(track.get("evidenceRubric") or []),
    }


def _research_track_template(track: dict[str, Any], lens_value: Any) -> dict[str, Any]:
    lens = _slugify(_required(lens_value, "assignment.researchLens"))
    for template in track.get("assignmentTemplates") or []:
        if not isinstance(template, dict):
            continue
        if _slugify(template.get("lens")) == lens:
            return template
    raise ValueError(f"Unknown research lens '{lens}' for track {track.get('key')}")


def _load_steering_config(config_path: str = "") -> dict[str, Any]:
    path = Path(config_path) if config_path else STEERING_CONFIG_PATH
    if not path.is_absolute():
        path = PAPYRUS_ROOT / path
    if yaml is None:
        raise ValueError("PyYAML is required to read corpora/papyrus-steering.yml")
    if not path.exists():
        raise ValueError(f"Steering config not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}
    if not isinstance(payload, dict):
        raise ValueError(f"Steering config must be a YAML object: {path}")
    return payload


def _list_connection(query: str, variables: dict[str, Any], field_name: str, limit: int = 100) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    next_token = None
    while True:
        payload = dict(variables)
        payload.update({"limit": limit, "nextToken": next_token})
        data = _graphql(query, payload)
        connection = data.get(field_name) or {}
        items.extend(_decode_record_json(item) for item in connection.get("items") or [])
        next_token = connection.get("nextToken")
        if not next_token:
            break
    return items


def _list_assignments() -> list[dict[str, Any]]:
    return _list_connection(LIST_ASSIGNMENTS_QUERY, {}, "listAssignments")


def _recent_published_items(recent_days: int) -> list[dict[str, Any]]:
    cutoff = _utc_now() - _dt.timedelta(days=max(int(recent_days), 0))
    items = _list_connection(LIST_PUBLISHED_ITEMS_QUERY, {}, "listPublishedItems")
    return [
        item for item in items
        if (published_at := _parse_datetime(item.get("publishedAt"))) is not None and published_at >= cutoff
    ]


def _list_categories(category_set_id: Any) -> list[dict[str, Any]]:
    category_set_id = _required(category_set_id, "assignment.categorySetId")
    items = _list_connection(LIST_CATEGORIES_QUERY, {}, "listCategories")
    return [
        item for item in items
        if item.get("categorySetId") == category_set_id
        and item.get("versionState") == "current"
        and item.get("status") != "archived"
    ]


def _list_category_keywords(category_set_id: Any, category_keys: list[str]) -> list[dict[str, Any]]:
    if not category_keys:
        return []
    try:
        items = _list_connection(LIST_CATEGORY_KEYWORDS_QUERY, {}, "listCategoryKeywords")
    except RuntimeError:
        return []
    return [
        item for item in items
        if item.get("categorySetId") == category_set_id and item.get("categoryKey") in set(category_keys)
    ]


def _list_semantic_nodes(category_set_id: Any) -> list[dict[str, Any]]:
    try:
        items = _list_connection(LIST_SEMANTIC_NODES_QUERY, {}, "listSemanticNodes")
    except (RuntimeError, ValueError):
        return []
    accepted: list[dict[str, Any]] = []
    for item in items:
        if item.get("versionState") != "current":
            continue
        if item.get("status") in {"rejected", "archived"}:
            continue
        if category_set_id and item.get("categorySetId") and item.get("categorySetId") != category_set_id:
            continue
        accepted.append(item)
    return accepted


def _list_messages() -> list[dict[str, Any]]:
    return _list_connection(LIST_MESSAGES_QUERY, {}, "listMessages")


def _assignment_events_for_assignments(assignment_ids: list[str]) -> list[dict[str, Any]]:
    if not assignment_ids:
        return []
    events: list[dict[str, Any]] = []
    for assignment_id in assignment_ids:
        data = _graphql(
            """
query ListAssignmentEventsByAssignment($assignmentId: ID!, $limit: Int, $nextToken: String) {
  listAssignmentEventsByAssignmentAndCreatedAt(assignmentId: $assignmentId, limit: $limit, nextToken: $nextToken) {
    items {
      id
      assignmentId
      assignmentTypeKey
      queueKey
      eventType
      fromStatus
      toStatus
      actorSub
      actorLabel
      note
      createdAt
      metadata
    }
    nextToken
  }
}
""",
            {"assignmentId": assignment_id, "limit": 100, "nextToken": None},
        )
        connection = data.get("listAssignmentEventsByAssignmentAndCreatedAt") or {}
        events.extend(_decode_record_json(item) for item in connection.get("items") or [])
    return sorted(events, key=lambda item: item.get("createdAt") or "", reverse=True)


def _fallback_assignment_context(assignment_id: str) -> dict[str, Any]:
    assignment = papyrus_get_assignment(assignment_id).get("assignment") or {}
    relations = _list_connection(
        """
query ListSemanticRelationsBySubjectState($subjectStateKey: String!, $limit: Int, $nextToken: String) {
  listSemanticRelationsBySubjectState(subjectStateKey: $subjectStateKey, limit: $limit, nextToken: $nextToken) {
    items {
      id
      relationState
      predicate
      relationTypeKey
      subjectKind
      subjectId
      subjectLineageId
      objectKind
      objectId
      objectLineageId
      metadata
    }
    nextToken
  }
}
""",
        {"subjectStateKey": _semantic_state_key("assignment", assignment_id)},
        "listSemanticRelationsBySubjectState",
    )
    targets = [
        {
            "kind": relation.get("objectKind"),
            "id": relation.get("objectId"),
            "lineageId": relation.get("objectLineageId"),
            "label": relation.get("objectLineageId") or relation.get("objectId"),
            "detail": relation.get("relationTypeKey") or relation.get("predicate"),
        }
        for relation in relations
        if relation.get("relationState") == "current"
    ]
    events = _assignment_events_for_assignments([assignment_id])
    return {
        "assignment": assignment,
        "doctrine": [],
        "targets": targets,
        "events": events,
    }


def _normalize_assignment_metadata(value: Any) -> dict[str, Any]:
    metadata = _normalize_jsonish(value or {})
    return metadata if isinstance(metadata, dict) else {}


def _match_terms_from_text(value: Any) -> list[str]:
    text = str(value or "").lower()
    if not text:
        return []
    seen: set[str] = set()
    terms: list[str] = []
    for term in re.findall(r"[a-z0-9][a-z0-9\\-]{2,}", text):
        if term in seen:
            continue
        seen.add(term)
        terms.append(term)
    return terms


def _context_semantic_terms(
    assignment: dict[str, Any],
    metadata: dict[str, Any],
    desk_category: dict[str, Any] | None,
    focus_category: dict[str, Any] | None,
) -> list[str]:
    candidates = [
        assignment.get("title"),
        assignment.get("brief"),
        assignment.get("instructions"),
        metadata.get("focusCategoryKey"),
        metadata.get("focusCategoryTitle"),
        metadata.get("researchLens"),
        metadata.get("researchLensTitle"),
        metadata.get("targetSystemType"),
        (desk_category or {}).get("displayName"),
        (desk_category or {}).get("categoryKey"),
        (focus_category or {}).get("displayName"),
        (focus_category or {}).get("categoryKey"),
    ]
    seen: set[str] = set()
    terms: list[str] = []
    for candidate in candidates:
        for term in _match_terms_from_text(candidate):
            if term in seen:
                continue
            seen.add(term)
            terms.append(term)
    return terms


def _search_semantic_nodes(
    query_terms: list[str],
    *,
    category_set_id: Any,
    limit: int = 8,
) -> list[dict[str, Any]]:
    if not query_terms:
        return []
    nodes = _list_semantic_nodes(category_set_id)
    scored: list[tuple[int, dict[str, Any]]] = []
    for node in nodes:
        search_text = " ".join(
            [
                str(node.get("nodeKey") or ""),
                str(node.get("displayName") or ""),
                str(node.get("description") or ""),
                " ".join(_string_list(node.get("aliases") or [])),
                str(node.get("categoryKey") or ""),
            ]
        ).lower()
        score = sum(1 for term in query_terms if term in search_text)
        if score <= 0:
            continue
        scored.append((score, node))
    scored.sort(key=lambda entry: (-entry[0], str(entry[1].get("nodeKey") or ""), str(entry[1].get("id") or "")))
    return [entry[1] for entry in scored[: max(int(limit), 0)]]


def _assignment_lane_key(assignment: dict[str, Any], metadata: dict[str, Any]) -> str:
    lane_key = metadata.get("laneKey")
    if lane_key:
        return str(lane_key)
    queue_key = str(assignment.get("queueKey") or "")
    match = re.search(r":lane:([^:]+)$", queue_key)
    return match.group(1) if match else "reporting"


def _normalize_context_profile(profile_key: Any, lane_key: str) -> str:
    value = _slugify(profile_key or "")
    if value in {"reporting", "analysis", "briefs"}:
        return value
    if lane_key == "analysis":
        return "analysis"
    if lane_key == "briefs":
        return "briefs"
    return "reporting"


def _context_token_budget(profile_key: str, override: Any) -> int:
    defaults = {"reporting": 4000, "analysis": 6000, "briefs": 2500}
    explicit = _optional_int(override)
    return explicit if explicit and explicit > 0 else defaults.get(profile_key, 4000)


def _resolve_assignment_category(
    categories: list[dict[str, Any]],
    lineage_id: Any,
    category_key: Any,
) -> dict[str, Any] | None:
    lineage_text = str(lineage_id) if lineage_id else ""
    key_text = str(category_key) if category_key else ""
    for category in categories:
        if lineage_text and category.get("lineageId") == lineage_text:
            return category
    for category in categories:
        if key_text and category.get("categoryKey") == key_text:
            return category
    return None


def _assignments_for_desk(
    assignments: list[dict[str, Any]],
    metadata: dict[str, Any],
    desk_category: dict[str, Any] | None,
    focus_category: dict[str, Any] | None,
    section_key: Any = None,
) -> list[dict[str, Any]]:
    desk_key = (desk_category or {}).get("categoryKey") or metadata.get("deskCategoryKey") or metadata.get("rootCategoryKey")
    focus_key = (focus_category or {}).get("categoryKey") or metadata.get("focusCategoryKey") or metadata.get("researchLens")
    normalized_section_key = str(section_key or "").strip()
    result = []
    for assignment in assignments:
        assignment_metadata = _normalize_assignment_metadata(assignment.get("metadata") or {})
        assignment_section_key = str(
            assignment.get("sectionKey")
            or assignment_metadata.get("sectionKey")
            or assignment.get("sectionId")
            or assignment_metadata.get("sectionId")
            or ""
        ).strip()
        if normalized_section_key and assignment_section_key == normalized_section_key:
            result.append(assignment)
            continue
        assignment_desk_key = assignment_metadata.get("deskCategoryKey") or assignment_metadata.get("rootCategoryKey")
        assignment_focus_key = assignment_metadata.get("focusCategoryKey") or assignment_metadata.get("researchLens")
        if desk_key and assignment_desk_key == desk_key:
            result.append(assignment)
            continue
        if focus_key and assignment_focus_key == focus_key:
            result.append(assignment)
    return sorted(result, key=lambda entry: (entry.get("updatedAt") or "", entry.get("id") or ""), reverse=True)


def _published_items_for_desk(
    items: list[dict[str, Any]],
    desk_category: dict[str, Any] | None,
    focus_category: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    desk_key = (desk_category or {}).get("categoryKey")
    focus_key = (focus_category or {}).get("categoryKey")
    result = []
    for item in items:
        category_keys = set(_category_keys_from_editorial(item.get("editorial") or {}))
        section_key = _slugify(item.get("section") or "")
        if desk_key and desk_key in category_keys:
            result.append(item)
            continue
        if focus_key and focus_key in category_keys:
            result.append(item)
            continue
        if desk_key and section_key == _slugify(desk_key):
            result.append(item)
    return sorted(result, key=lambda entry: entry.get("publishedAt") or "", reverse=True)


def _category_keys_from_editorial(editorial_value: Any) -> list[str]:
    editorial = _normalize_jsonish(editorial_value or {})
    if not isinstance(editorial, dict):
        return []
    newsroom = editorial.get("newsroom")
    if not isinstance(newsroom, dict):
        return []
    category_keys: list[str] = []
    for value in [newsroom.get("assignment"), newsroom.get("research"), newsroom.get("draft")]:
        if not isinstance(value, dict):
            continue
        for key in ["deskCategoryKey", "focusCategoryKey", "rootCategoryKey", "categoryKey", "researchLens"]:
            if value.get(key):
                category_keys.append(str(value.get(key)))
    return [value for value in category_keys if value]


def _desk_reference_summaries(
    semantic: Any,
    desk_category: dict[str, Any] | None,
    focus_category: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    lineage_ids = [entry.get("lineageId") for entry in [focus_category, desk_category] if isinstance(entry, dict)]
    seen: set[str] = set()
    references: list[dict[str, Any]] = []
    for lineage_id in lineage_ids:
        if not lineage_id:
            continue
        try:
            relation_items = semantic.references_for_category(lineage_id)["relations"]
        except ValueError:
            continue
        for relation in relation_items:
            subject_id = relation.get("subjectId")
            subject_lineage_id = relation.get("subjectLineageId")
            if not subject_id or not subject_lineage_id or subject_lineage_id in seen:
                continue
            try:
                reference = semantic.get_reference(subject_id)["reference"]
            except ValueError:
                continue
            if not is_evidence_eligible_reference(reference):
                continue
            seen.add(subject_lineage_id)
            references.append(reference)
    references.sort(
        key=lambda reference: reference.get("sourcePublishedAt")
        or reference.get("sourceUpdatedAt")
        or reference.get("retrievedAt")
        or reference.get("importedAt")
        or "",
        reverse=True,
    )
    return references[:8]


def _desk_comment_summaries(semantic: Any, references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    comments: list[dict[str, Any]] = []
    for reference in references[:5]:
        lineage_id = reference.get("lineageId")
        if not lineage_id:
            continue
        try:
            messages = semantic.list_reference_messages(lineage_id)["messages"]
        except ValueError:
            continue
        comments.extend(messages[:2])
    comments.sort(key=lambda message: message.get("createdAt") or "", reverse=True)
    return comments[:6]


def _build_assignment_context_blocks(
    *,
    assignment: dict[str, Any],
    metadata: dict[str, Any],
    doctrine: list[dict[str, Any]],
    desk_category: dict[str, Any] | None,
    focus_category: dict[str, Any] | None,
    semantic_nodes: list[dict[str, Any]],
    category_keywords: list[dict[str, Any]],
    desk_assignments: list[dict[str, Any]],
    assignment_events: list[dict[str, Any]],
    published_items: list[dict[str, Any]],
    references: list[dict[str, Any]],
    comments: list[dict[str, Any]],
    lane_key: str,
    profile_key: str,
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    publication_doctrine = [entry for entry in doctrine if entry.get("scope") == "publication"]
    desk_doctrine = [entry for entry in doctrine if entry.get("scope") == "desk"]
    blocks.append(
        _context_block(
            "doctrine-publication",
            "doctrine",
            _format_doctrine_block("Publication Doctrine", publication_doctrine),
            required=True,
            metadata={"scope": "publication"},
        )
    )
    if desk_doctrine:
        blocks.append(
            _context_block(
                "doctrine-desk",
                "doctrine",
                _format_doctrine_block("Desk Doctrine", desk_doctrine),
                required=True,
                metadata={"scope": "desk", "deskCategoryKey": (desk_category or {}).get("categoryKey")},
            )
        )
    section_key = assignment.get("sectionKey") or metadata.get("sectionKey") or assignment.get("sectionId") or metadata.get("sectionId")
    if section_key:
        blocks.append(
            _context_block(
                "doctrine-section",
                "doctrine",
                "\n".join([
                    f"Section: {metadata.get('sectionTitle') or section_key}",
                    f"section_key: {section_key}",
                    f"section_type: {assignment.get('sectionType') or metadata.get('sectionType') or 'unknown'}",
                    f"mission: {metadata.get('sectionMission') or metadata.get('editorialMission') or ''}",
                    f"policy: {metadata.get('sectionPolicies') or metadata.get('editorialPolicy') or metadata.get('sectionPolicy') or ''}",
                    f"guidance: {metadata.get('assignmentGuidance') or ''}",
                    f"kill_criteria: {metadata.get('killCriteria') or ''}",
                ]),
                required=True,
                metadata={"scope": "section", "sectionKey": section_key},
            )
        )
    blocks.append(
        _context_block(
            "doctrine-inclusion",
            "doctrine",
            _format_inclusion_risk_block(
                assignment,
                lane_key=lane_key,
                profile_key=profile_key,
                publication_doctrine=publication_doctrine,
                desk_doctrine=desk_doctrine,
            ),
            required=True,
            metadata={"scope": "generated"},
        )
    )
    if desk_category:
        blocks.append(
            _context_block(
                "taxonomy-desk",
                "taxonomy",
                _format_category_block("Desk", desk_category),
                required=True,
                metadata={"categoryKey": desk_category.get("categoryKey")},
            )
        )
    if focus_category:
        blocks.append(
            _context_block(
                "taxonomy-focus",
                "taxonomy",
                _format_category_block("Focus", focus_category),
                required=True,
                metadata={"categoryKey": focus_category.get("categoryKey")},
            )
        )
    if category_keywords:
        keyword_lines = [
            f"- {entry.get('keyword')} ({entry.get('source') or 'keyword'})"
            for entry in sorted(category_keywords, key=lambda item: (item.get("rank") or 999999, str(item.get("keyword") or "")))[:8]
        ]
        blocks.append(
            _context_block(
                "taxonomy-keywords",
                "taxonomy",
                "Keyword hints:\n" + "\n".join(keyword_lines),
                metadata={"keywordCount": len(category_keywords)},
            )
        )
    if semantic_nodes:
        semantic_lines = [
            f"- {(node.get('displayName') or node.get('nodeKey') or node.get('id'))} [{node.get('nodeKind') or 'node'}]"
            for node in semantic_nodes[:8]
        ]
        blocks.append(
            _context_block(
                "taxonomy-semantic-nodes",
                "taxonomy",
                "Semantic node/entity matches:\n" + "\n".join(semantic_lines),
                metadata={"semanticNodeCount": len(semantic_nodes)},
            )
        )
    linked_reference_ids = _string_list(metadata.get("referenceLineageIds") or [])
    linked_signal_ids = _string_list(metadata.get("semanticNodeLineageIds") or [])
    if linked_reference_ids or linked_signal_ids:
        lines = ["Assignment-linked context"]
        if linked_reference_ids:
            lines.append(f"reference_lineage_ids: {', '.join(linked_reference_ids)}")
        if linked_signal_ids:
            lines.append(f"semantic_node_lineage_ids: {', '.join(linked_signal_ids)}")
        blocks.append(
            _context_block(
                "desk-linked-context",
                "desk_memory",
                "\n".join(lines),
                metadata={"sourceKind": "assignment_metadata"},
            )
        )
    for assignment_entry in desk_assignments[:6]:
        assignment_metadata = _normalize_assignment_metadata(assignment_entry.get("metadata") or {})
        blocks.append(
            _context_block(
                f"desk-assignment-{assignment_entry.get('id')}",
                "desk_memory",
                "\n".join([
                    f"Assignment: {assignment_entry.get('title') or assignment_entry.get('id')}",
                    f"status: {assignment_entry.get('status')}",
                    f"desk: {assignment_metadata.get('deskCategoryKey') or assignment_metadata.get('rootCategoryKey') or 'unknown'}",
                    f"focus: {assignment_metadata.get('focusCategoryKey') or assignment_metadata.get('researchLens') or 'unknown'}",
                    f"brief: {assignment_entry.get('brief') or ''}",
                ]),
                metadata={"sourceKind": "assignment", "assignmentId": assignment_entry.get("id")},
            )
        )
    for event in assignment_events[:6]:
        blocks.append(
            _context_block(
                f"desk-event-{event.get('id')}",
                "desk_memory",
                "\n".join([
                    f"Assignment event: {event.get('eventType')}",
                    f"assignment_id: {event.get('assignmentId')}",
                    f"created_at: {event.get('createdAt')}",
                    f"note: {event.get('note') or ''}",
                ]),
                metadata={"sourceKind": "assignment_event", "assignmentId": event.get("assignmentId")},
            )
        )
    for item in published_items[:4]:
        blocks.append(
            _context_block(
                f"desk-published-{item.get('id')}",
                "desk_memory",
                "\n".join([
                    f"Published item: {item.get('headline') or item.get('title') or item.get('id')}",
                    f"published_at: {item.get('publishedAt') or item.get('editionDate') or 'unknown'}",
                    f"section: {item.get('section') or 'unknown'}",
                    f"deck: {item.get('deck') or ''}",
                ]),
                metadata={"sourceKind": "published_item", "itemId": item.get("id")},
            )
        )
    for reference in references[:5]:
        blocks.append(
            _context_block(
                f"desk-reference-{reference.get('id')}",
                "desk_memory",
                "\n".join([
                    f"Reference: {reference.get('title') or reference.get('externalItemId') or reference.get('id')}",
                    f"published_at: {reference.get('sourcePublishedAt') or reference.get('sourceUpdatedAt') or 'unknown'}",
                    f"source_uri: {reference.get('sourceUri') or reference.get('storagePath') or 'unknown'}",
                ]),
                metadata={"sourceKind": "reference", "referenceId": reference.get("id")},
            )
        )
    for comment in comments[:4]:
        blocks.append(
            _context_block(
                f"desk-comment-{comment.get('id')}",
                "desk_memory",
                "\n".join([
                    f"Knowledge comment: {comment.get('summary') or comment.get('messageKind') or comment.get('id')}",
                    f"created_at: {comment.get('createdAt') or 'unknown'}",
                    f"body: {comment.get('body') or ''}",
                ]),
                metadata={"sourceKind": "message", "messageId": comment.get("id")},
            )
        )
    blocks.append(
        _context_block(
            "fresh-evidence-request",
            "fresh_evidence",
            _format_fresh_evidence_block(
                assignment=assignment,
                metadata=metadata,
                desk_category=desk_category,
                focus_category=focus_category,
                lane_key=lane_key,
            ),
            required=True,
            metadata={"sourceKind": "generated"},
        )
    )
    return [block for block in blocks if block.get("text")]


def _format_doctrine_block(title: str, records: list[dict[str, Any]]) -> str:
    lines = [title]
    for record in records:
        lines.append(f"- {record.get('label')}: {' '.join(_string_list(record.get('body') or []))}")
    return "\n".join(lines)


def _format_category_block(label: str, category: dict[str, Any]) -> str:
    lines = [
        f"{label}: {category.get('displayName') or category.get('categoryKey')}",
        f"category_key: {category.get('categoryKey')}",
    ]
    if category.get("subtitle"):
        lines.append(f"subtitle: {category.get('subtitle')}")
    if category.get("description"):
        lines.append(f"description: {category.get('description')}")
    aliases = _string_list(category.get("aliases") or [])
    if aliases:
        lines.append(f"aliases: {', '.join(aliases[:8])}")
    return "\n".join(lines)


def _format_inclusion_risk_block(
    assignment: dict[str, Any],
    *,
    lane_key: str,
    profile_key: str,
    publication_doctrine: list[dict[str, Any]],
    desk_doctrine: list[dict[str, Any]],
) -> str:
    checks_by_lane = {
        "reporting": [
            "Prefer verifiable and recent developments over broad thesis claims.",
            "Prioritize concrete operational evidence, cited outputs, and audit trails.",
            "Surface human review boundaries, failure modes, and unresolved uncertainty.",
        ],
        "analysis": [
            "Prefer patterns that can be compared across multiple systems or episodes.",
            "Include counterevidence, uncertainty, and where the evidence base is thin.",
            "Distinguish operational facts from interpretation or extrapolation.",
        ],
        "briefs": [
            "Prefer concise developments with a clear why-now and evidence trail.",
            "Avoid speculative framing when the evidence only supports a narrow update.",
            "Keep the evidence ask compact enough for a short-form publication lane.",
        ],
    }
    checks = checks_by_lane.get(lane_key, checks_by_lane["reporting"])
    doctrine_summary = []
    if publication_doctrine:
        doctrine_summary.append("Apply publication mission and policies as the primary inclusion standard.")
    if desk_doctrine:
        doctrine_summary.append("Apply root-desk doctrine as the local beat standard before narrowing the angle.")
    else:
        doctrine_summary.append("No desk doctrine is available; fall back to publication doctrine.")
    return "\n".join([
        f"Inclusion and risk profile: {profile_key}",
        f"assignment: {assignment.get('title') or assignment.get('id')}",
        *[f"- {entry}" for entry in doctrine_summary],
        *[f"- {entry}" for entry in checks],
    ])


def _format_fresh_evidence_block(
    *,
    assignment: dict[str, Any],
    metadata: dict[str, Any],
    desk_category: dict[str, Any] | None,
    focus_category: dict[str, Any] | None,
    lane_key: str,
) -> str:
    desk_name = (desk_category or {}).get("displayName") or (desk_category or {}).get("categoryKey") or "Desk"
    focus_name = (focus_category or {}).get("displayName") or (focus_category or {}).get("categoryKey") or desk_name
    search_terms = [desk_name, focus_name, lane_key, "latest", "operational evidence", "human review", "failure modes"]
    return "\n".join([
        f"Fresh evidence request: {assignment.get('title') or assignment.get('id')}",
        f"desk: {desk_name}",
        f"focus: {focus_name}",
        f"lane: {lane_key}",
        f"existing_reference_lineage_ids: {', '.join(_string_list(metadata.get('referenceLineageIds') or [])) or 'none'}",
        f"suggested_query_terms: {', '.join(dict.fromkeys(search_terms))}",
    ])


def _context_block(
    block_id: str,
    section: str,
    text: str,
    *,
    required: bool = False,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cleaned = text.strip()
    return {
        "block_id": block_id,
        "section": section,
        "text": cleaned,
        "required": required,
        "priority": 100 if required else 10,
        "metadata": metadata or {},
    }


def _build_biblicus_block_context_pack(
    *,
    blocks: list[dict[str, Any]],
    profile_key: str,
    max_tokens: int,
) -> dict[str, Any]:
    section_shares = {
        "doctrine": 0.15,
        "taxonomy": 0.20,
        "desk_memory": 0.25,
        "fresh_evidence": 0.40,
    }
    request_payload = {
        "blocks": blocks,
        "max_tokens": max_tokens,
        "section_budgets": [{"section": section, "share": share} for section, share in section_shares.items()],
    }
    result = _run_biblicus(
        ["context-pack", "build-blocks"],
        {"profile": profile_key},
        stdin_text=json.dumps(request_payload),
    )
    if result["status"] != "ok":
        raise RuntimeError(result["stderr"] or f"Biblicus block context build failed for profile {profile_key}")
    return json.loads(result["stdout"])


def _run_biblicus(args: list[str], corpus: dict[str, Any], stdin_text: str | None = None) -> dict[str, Any]:
    python = BIBLICUS_ROOT / ".venv" / "bin" / "python"
    if not python.exists():
        raise ValueError(f"Biblicus virtualenv python not found: {python}")
    command = [str(python), "-m", "biblicus", *args]
    result = subprocess.run(
        command,
        cwd=BIBLICUS_ROOT,
        input=stdin_text,
        text=True,
        capture_output=True,
        check=False,
    )
    return {
        "status": "ok" if result.returncode == 0 else "error",
        "returnCode": result.returncode,
        "corpus": corpus,
        "command": command,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def _coerce_payload(
    value: dict[str, Any] | None,
    json_value: str,
    label: str,
) -> dict[str, Any]:
    if value is not None:
        if not isinstance(value, dict):
            raise ValueError(f"{label} must be an object")
        return value
    if not json_value:
        raise ValueError(f"{label}_json is required")
    payload = json.loads(json_value)
    if not isinstance(payload, dict):
        raise ValueError(f"{label}_json must decode to an object")
    return payload


def _coerce_payload_list(value: Any, json_value: str, label: str) -> list[dict[str, Any]]:
    if value is not None:
        payload = value
    else:
        if not json_value:
            raise ValueError(f"{label}_json is required")
        payload = json.loads(json_value)
    if isinstance(payload, dict) and isinstance(payload.get(label), list):
        payload = payload[label]
    if not isinstance(payload, list):
        raise ValueError(f"{label}_json must decode to an array")
    result: list[dict[str, Any]] = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"{label}[{index}] must be an object")
        result.append(item)
    return result


def _normalize_section_targets(value: Any, json_value: str, assignment_ratio: float) -> list[dict[str, Any]]:
    if value is not None:
        payload = value
    else:
        if not json_value:
            raise ValueError("section_targets_json is required")
        payload = json.loads(json_value)
    if isinstance(payload, dict) and isinstance(payload.get("sections"), list):
        payload = payload["sections"]
    elif isinstance(payload, dict):
        payload = [
            {"section": section, "targetArticles": target}
            for section, target in payload.items()
        ]
    if not isinstance(payload, list):
        raise ValueError("section_targets_json must decode to an object or array")

    targets: list[dict[str, Any]] = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"section_targets[{index}] must be an object")
        section = _required(item.get("section") or item.get("name"), f"section_targets[{index}].section")
        target_articles = _positive_int(
            item.get("target_articles")
            or item.get("targetArticles")
            or item.get("target")
            or item.get("slots"),
            f"section_targets[{index}].targetArticles",
        )
        dispatch_count = _optional_int(item.get("dispatch_count") or item.get("dispatchCount"))
        if dispatch_count is None:
            dispatch_count = _ceil(target_articles * assignment_ratio)
        dispatch_count = max(dispatch_count, target_articles)
        targets.append(
            {
                "section": section,
                "sectionKey": _slugify(section),
                "targetArticles": target_articles,
                "dispatchCount": dispatch_count,
                "selectedAssignments": 0,
                "suppressedCandidates": 0,
            }
        )
    if not targets:
        raise ValueError("section_targets_json must include at least one section")
    return targets


def _decode_record_json(record: dict[str, Any]) -> dict[str, Any]:
    decoded = dict(record)
    for field in ("layout", "editorial", "metadata", "layoutPlan", "payload"):
        if isinstance(decoded.get(field), str):
            decoded[field] = _normalize_jsonish(decoded[field])
    return decoded


def _normalize_jsonish(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _jsonish_list(value: Any) -> list[Any]:
    normalized = _normalize_jsonish(value)
    if normalized is None:
        return []
    if isinstance(normalized, list):
        return normalized
    if isinstance(normalized, tuple):
        return list(normalized)
    if isinstance(normalized, dict):
        if not normalized:
            return []
        if all(isinstance(key, int) for key in normalized):
            keys = sorted(normalized)
            if keys == list(range(1, len(keys) + 1)):
                return [normalized[key] for key in keys]
        return [normalized]
    return [normalized]


def _required(value: Any, label: str) -> str:
    if value is None or str(value).strip() == "":
        raise ValueError(f"{label} is required")
    return str(value).strip()


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item is not None and str(item) != ""]
    if isinstance(value, tuple):
        return [str(item) for item in value if item is not None and str(item) != ""]
    if isinstance(value, dict):
        if not value:
            return []
        if all(isinstance(key, int) for key in value):
            return [str(value[key]) for key in sorted(value) if value[key] is not None and str(value[key]) != ""]
    return [str(value)]


def _assignment_corpus_key(item: dict[str, Any]) -> str:
    editorial = _normalize_jsonish(item.get("editorial") or {})
    if not isinstance(editorial, dict):
        return ""
    newsroom = editorial.get("newsroom")
    if not isinstance(newsroom, dict):
        return ""
    assignment = newsroom.get("assignment")
    if not isinstance(assignment, dict):
        return ""
    return str(assignment.get("corpusKey") or "")


def _procedure_assignment_item_from_live_assignment(
    *,
    assignment: dict[str, Any],
    doctrine: Any,
    targets: Any,
    events: Any,
    generated_at: str,
) -> dict[str, Any]:
    metadata = _normalize_jsonish(assignment.get("metadata") or {})
    if not isinstance(metadata, dict):
        metadata = {}

    assignment_status = str(assignment.get("status") or "open")
    mapped_status = ASSIGNMENT_DISPATCH_STATUS
    if assignment_status == "completed":
        mapped_status = ASSIGNMENT_RESEARCH_STATUS
    elif assignment_status == "canceled":
        mapped_status = ASSIGNMENT_DISPATCH_STATUS

    title = str(assignment.get("title") or assignment.get("id") or "Assignment")
    section = str(
        metadata.get("sectionKey")
        or metadata.get("deskCategoryKey")
        or metadata.get("rootCategoryKey")
        or metadata.get("laneLabel")
        or assignment.get("queueKey")
        or "News"
    )
    assignment_editorial = {
        "brief": str(assignment.get("brief") or ""),
        "angle": str(metadata.get("candidateAngle") or assignment.get("brief") or ""),
        "corpusId": assignment.get("corpusId"),
        "corpusKey": metadata.get("corpusKey"),
        "categoryKey": (
            metadata.get("focusCategoryKey")
            or metadata.get("categoryKey")
            or metadata.get("deskCategoryKey")
            or metadata.get("rootCategoryKey")
            or metadata.get("topicUid")
        ),
        "deskCategoryKey": metadata.get("deskCategoryKey") or metadata.get("rootCategoryKey"),
        "deskCategoryLineageId": metadata.get("deskCategoryLineageId") or metadata.get("rootCategoryLineageId"),
        "focusCategoryKey": metadata.get("focusCategoryKey") or metadata.get("researchLens") or metadata.get("categoryKey"),
        "focusCategoryLineageId": metadata.get("focusCategoryLineageId") or metadata.get("categoryLineageId"),
        "focusCategoryTitle": metadata.get("focusCategoryTitle") or metadata.get("researchLensTitle"),
        "contextProfile": metadata.get("contextProfile"),
        "contextTokenBudget": metadata.get("contextTokenBudget"),
        "contextSources": _string_list(metadata.get("contextSources") or []),
        "evidenceItemIds": _string_list(metadata.get("evidenceItemIds")),
        "referenceLineageIds": _string_list(metadata.get("referenceLineageIds")),
        "semanticNodeLineageIds": _string_list(metadata.get("semanticNodeLineageIds")),
        "researchTrackKey": metadata.get("researchTrackKey"),
        "researchTrackTitle": metadata.get("researchTrackTitle"),
        "researchLens": metadata.get("researchLens"),
        "researchLensTitle": metadata.get("researchLensTitle"),
        "assignmentTemplateKey": metadata.get("assignmentTemplateKey"),
        "assignmentTemplateTitle": metadata.get("assignmentTemplateTitle"),
        "targetSystemType": metadata.get("targetSystemType"),
        "expectedEvidenceClasses": _normalize_jsonish(metadata.get("expectedEvidenceClasses") or []),
        "comparisonQuestions": _normalize_jsonish(metadata.get("comparisonQuestions") or []),
        "evidenceRubric": _normalize_jsonish(metadata.get("evidenceRubric") or []),
        "liveAssignment": {
            "id": assignment.get("id"),
            "assignmentTypeKey": assignment.get("assignmentTypeKey"),
            "queueKey": assignment.get("queueKey"),
            "queueStatusKey": assignment.get("queueStatusKey"),
            "status": assignment_status,
            "assigneeKey": assignment.get("assigneeKey"),
            "createdAt": assignment.get("createdAt"),
            "updatedAt": assignment.get("updatedAt"),
            "doctrine": doctrine,
            "targets": targets,
            "events": events,
            "generatedAt": generated_at,
        },
    }
    return {
        "id": str(assignment.get("id")),
        "type": ASSIGNMENT_TYPE,
        "status": mapped_status,
        "typeStatus": f"{ASSIGNMENT_TYPE}#{mapped_status}",
        "slug": _slugify(metadata.get("candidateAngle") or title),
        "shortSlug": None,
        "section": section,
        "sectionStatus": f"{_slugify(section)}#{mapped_status}",
        "title": title,
        "headline": title,
        "deck": str(assignment.get("brief") or ""),
        "body": [],
        "byline": "Papyrus Staff",
        "dateline": "NEWSROOM",
        "publishedAt": None,
        "editionDate": metadata.get("editionDate"),
        "sortTitle": _sort_title(title),
        "pullQuotes": [],
        "layout": {"source": "newsroom-live-assignment"},
        "editorial": {"newsroom": {"assignment": assignment_editorial}},
    }


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def _positive_int(value: Any, label: str) -> int:
    result = _optional_int(value)
    if result is None or result <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return result


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _positive_float(value: Any, label: str) -> float:
    result = _optional_float(value)
    if result is None or result <= 0:
        raise ValueError(f"{label} must be a positive number")
    return result


def _ceil(value: float) -> int:
    whole = int(value)
    return whole if value == whole else whole + 1


def _slugify(value: Any) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return slug or "assignment"


def _sort_title(title: str) -> str:
    return re.sub(r"^(the|a|an)\s+", "", title.strip(), flags=re.IGNORECASE).lower()


def _hash_short(parts: list[Any]) -> str:
    payload = json.dumps(parts, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def _now_iso() -> str:
    return _utc_now().isoformat().replace("+00:00", "Z")


def _utc_now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _parse_datetime(value: Any) -> _dt.datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = _dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=_dt.timezone.utc)
    return parsed.astimezone(_dt.timezone.utc)


def _semantic_client():
    return PapyrusSemanticClient(_graphql, decode_record=_decode_record_json)
