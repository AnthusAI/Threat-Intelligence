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
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - exercised only in stripped envs
    yaml = None


PAPYRUS_ROOT = Path(__file__).resolve().parents[3]
BIBLICUS_ROOT = PAPYRUS_ROOT.parent / "Biblicus"
STEERING_CONFIG_PATH = PAPYRUS_ROOT / "corpora" / "papyrus-steering.yml"
NEWSROOM_VERSION = "newsroom-v1"
ASSIGNMENT_TYPE = "assignment"
ASSIGNMENT_DISPATCH_STATUS = "dispatched"
ASSIGNMENT_RESEARCH_STATUS = "researched"
ASSIGNMENT_DRAFT_STATUS = "drafted"
ARTICLE_TYPE = "article"
ARTICLE_DRAFT_STATUS = "draft"
DEFAULT_ASSIGNMENT_RATIO = 1.5
REPORTER_PROCEDURE = "procedures/newsroom/reporter.tac"


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

    return {
        "dryRun": True,
        "lifecycle": "assignment-dispatch",
        "item": item,
        "editionItem": edition_item,
        "records": [
            {"modelName": "Item", "action": "create", "input": item},
            {"modelName": "EditionItem", "action": "create", "input": edition_item},
        ],
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

    editorial = _normalize_jsonish(item.get("editorial") or {})
    if not isinstance(editorial, dict):
        editorial = {}
    newsroom = editorial.setdefault("newsroom", {})
    newsroom["research"] = {
        "status": "researched",
        "summary": summary,
        "corpusKey": corpus_key,
        "categoryKey": category_key,
        "evidenceItemIds": evidence_item_ids,
        "queries": _normalize_jsonish(research_payload.get("queries") or []),
        "sourceSnapshots": _normalize_jsonish(
            research_payload.get("source_snapshots") or research_payload.get("sourceSnapshots") or []
        ),
        "researchNotes": _normalize_jsonish(
            research_payload.get("research_notes") or research_payload.get("researchNotes") or []
        ),
        "openQuestions": _normalize_jsonish(
            research_payload.get("open_questions") or research_payload.get("openQuestions") or []
        ),
        "coverageGaps": _normalize_jsonish(
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
    if not evidence_item_ids:
        warnings.append("research.evidenceItemIds is empty")

    return {
        "dryRun": True,
        "lifecycle": "assignment-research",
        "item": updated_item,
        "records": [
            {"modelName": "Item", "action": "create", "input": updated_item},
            {"modelName": "Item", "action": "update", "input": _supersede_update(item, now)},
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

    return {
        "dryRun": True,
        "lifecycle": "draft",
        "assignmentItem": assignment_update,
        "item": draft_item,
        "draftItem": draft_item,
        "records": [
            {"modelName": "Item", "action": "create", "input": assignment_update},
            {"modelName": "Item", "action": "update", "input": _supersede_update(item, now)},
            {"modelName": "Item", "action": "create", "input": draft_item},
        ],
        "warnings": [],
    }


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


def _run_biblicus(args: list[str], corpus: dict[str, Any]) -> dict[str, Any]:
    python = BIBLICUS_ROOT / ".venv" / "bin" / "python"
    if not python.exists():
        raise ValueError(f"Biblicus virtualenv python not found: {python}")
    command = [str(python), "-m", "biblicus", *args]
    result = subprocess.run(
        command,
        cwd=BIBLICUS_ROOT,
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


if __name__ == "__main__":
    json.dump(
        {
            "module": "papyrus_newsroom",
            "python": sys.executable,
            "papyrusRoot": str(PAPYRUS_ROOT),
            "biblicusRoot": str(BIBLICUS_ROOT),
        },
        sys.stdout,
    )
    sys.stdout.write("\n")
