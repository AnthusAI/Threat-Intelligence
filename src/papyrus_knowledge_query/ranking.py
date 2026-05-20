from __future__ import annotations

import math
import re
from typing import Any


QUALITY_RELATION_KEYS = {"quality_rating_is"}
QUALITY_NODE_RE = re.compile(r"quality\.rating\.(\d)_star$")
VALID_RANKING_PROFILES = {"balanced", "relevance_first", "quality_forward"}
VALID_DIVERSITY_PROFILES = {"focused", "balanced", "broad"}

PROFILE_WEIGHTS = {
    "balanced": {"relevance": 0.70, "quality": 0.25, "graphContext": 0.05},
    "relevance_first": {"relevance": 0.85, "quality": 0.10, "graphContext": 0.05},
    "quality_forward": {"relevance": 0.55, "quality": 0.40, "graphContext": 0.05},
}

DIVERSITY_PROFILES = {
    "focused": {
        "description": "Prioritize depth from the top-ranked sources.",
        "sourceFloorRatio": 0.30,
        "maxSourceMultiplier": 8.0,
        "passageRepeatCap": 4,
        "seeAlsoMinTokens": 45,
        "seeAlsoMaxTokens": 180,
        "uniqueFirst": False,
    },
    "balanced": {
        "description": "Balance top-source depth with source spread.",
        "sourceFloorRatio": 0.50,
        "maxSourceMultiplier": 3.0,
        "passageRepeatCap": 3,
        "seeAlsoMinTokens": 40,
        "seeAlsoMaxTokens": 120,
        "uniqueFirst": True,
    },
    "broad": {
        "description": "Favor smaller slices from more unique sources.",
        "sourceFloorRatio": 0.72,
        "maxSourceMultiplier": 1.6,
        "passageRepeatCap": 1,
        "seeAlsoMinTokens": 30,
        "seeAlsoMaxTokens": 80,
        "uniqueFirst": True,
    },
}


def normalize_ranking_config(input: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    raw = input.get("ranking") if isinstance(input.get("ranking"), dict) else {}
    profile = str(raw.get("profile") or "balanced").strip()
    if profile not in VALID_RANKING_PROFILES:
        warnings.append(f"Unknown ranking.profile '{profile}', using balanced")
        profile = "balanced"
    diversity = str(raw.get("diversity") or "balanced").strip()
    if diversity not in VALID_DIVERSITY_PROFILES:
        warnings.append(f"Unknown ranking.diversity '{diversity}', using balanced")
        diversity = "balanced"
    weights = dict(PROFILE_WEIGHTS[profile])
    raw_weights = raw.get("weights") if isinstance(raw.get("weights"), dict) else {}
    for key in ("relevance", "quality", "graphContext"):
        if key not in raw_weights:
            continue
        try:
            weights[key] = max(0.0, float(raw_weights[key]))
        except (TypeError, ValueError):
            warnings.append(f"ranking.weights.{key} must be numeric; using default")
    total = sum(weights.values())
    if total <= 0:
        warnings.append("ranking.weights must not all be zero; using balanced defaults")
        weights = dict(PROFILE_WEIGHTS["balanced"])
        total = sum(weights.values())
    weights = {key: value / total for key, value in weights.items()}
    try:
        missing_quality = float(raw.get("missingQuality", 0.5))
    except (TypeError, ValueError):
        warnings.append("ranking.missingQuality must be numeric; using 0.5")
        missing_quality = 0.5
    return {
        "profile": profile,
        "diversity": diversity,
        "diversityConfig": dict(DIVERSITY_PROFILES[diversity]),
        "weights": weights,
        "missingQuality": clamp01(missing_quality),
        "relevanceGate": 0.18,
    }


def is_quality_relation(relation: dict[str, Any]) -> bool:
    relation_key = str(relation.get("relationTypeKey") or relation.get("predicate") or "").strip()
    if relation_key not in QUALITY_RELATION_KEYS:
        return False
    state = relation.get("relationState")
    return state in {None, "", "current"}


def quality_signal_from_relations(
    relations: list[dict[str, Any]],
    missing_quality: float = 0.5,
) -> tuple[dict[str, Any], str | None]:
    quality_relations = [relation for relation in relations if is_quality_relation(relation)]
    if not quality_relations:
        return unknown_quality(missing_quality), None
    relation = sorted(quality_relations, key=_quality_relation_sort_key, reverse=True)[0]
    signal = quality_signal_from_relation(relation, missing_quality)
    warning = None
    if len(quality_relations) > 1:
        subject = relation.get("subjectLineageId") or relation.get("subjectId") or "unknown"
        warning = f"Multiple current quality_rating_is relations found for reference {subject}; using {relation.get('id') or 'best-ranked relation'}"
    return signal, warning


def quality_signal_from_relation(relation: dict[str, Any], missing_quality: float = 0.5) -> dict[str, Any]:
    rating = quality_rating_from_value(relation.get("score"))
    source = "relation_score"
    if rating is None:
        rating = quality_rating_from_node_key(relation.get("objectLineageId") or relation.get("objectId"))
        source = "relation_object"
    if rating is None:
        return unknown_quality(missing_quality)
    return {
        "qualityKnown": True,
        "qualityRating": rating,
        "qualityScore": quality_score_from_rating(rating),
        "qualitySource": source,
        "qualityRelationId": relation.get("id"),
        "qualityObjectLineageId": relation.get("objectLineageId"),
    }


def quality_signal_from_object(obj: dict[str, Any], missing_quality: float = 0.5) -> dict[str, Any]:
    ranking = obj.get("ranking") if isinstance(obj.get("ranking"), dict) else {}
    if ranking.get("qualityKnown"):
        return {
            "qualityKnown": True,
            "qualityRating": ranking.get("qualityRating"),
            "qualityScore": clamp01(float(ranking.get("qualityScore", missing_quality))),
            "qualitySource": ranking.get("qualitySource", "ranking"),
            "qualityRelationId": ranking.get("qualityRelationId"),
            "qualityObjectLineageId": ranking.get("qualityObjectLineageId"),
        }
    metadata = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
    for container, source in ((obj, "object_metadata"), (metadata, "vector_metadata")):
        for key in ("qualityRating", "quality_rating", "quality", "qualityScore"):
            rating = quality_rating_from_value(container.get(key))
            if rating is not None:
                return {
                    "qualityKnown": True,
                    "qualityRating": rating,
                    "qualityScore": quality_score_from_rating(rating),
                    "qualitySource": source,
                    "qualityRelationId": None,
                    "qualityObjectLineageId": None,
                }
        node_key = container.get("qualityNodeKey") or container.get("qualityObjectLineageId")
        rating = quality_rating_from_node_key(node_key)
        if rating is not None:
            return {
                "qualityKnown": True,
                "qualityRating": rating,
                "qualityScore": quality_score_from_rating(rating),
                "qualitySource": source,
                "qualityRelationId": None,
                "qualityObjectLineageId": str(node_key),
            }
    return unknown_quality(missing_quality)


def unknown_quality(missing_quality: float = 0.5) -> dict[str, Any]:
    return {
        "qualityKnown": False,
        "qualityRating": None,
        "qualityScore": clamp01(missing_quality),
        "qualitySource": "unknown",
        "qualityRelationId": None,
        "qualityObjectLineageId": None,
    }


def quality_rating_from_value(value: Any) -> float | None:
    if isinstance(value, bool) or value in {None, ""}:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if 1 <= numeric <= 5:
        return numeric
    if 0 <= numeric <= 1:
        return 1 + (numeric * 4)
    return None


def quality_rating_from_node_key(value: Any) -> float | None:
    if not isinstance(value, str):
        return None
    match = QUALITY_NODE_RE.search(value.strip())
    if not match:
        return None
    return float(match.group(1))


def quality_score_from_rating(rating: float | int | None) -> float:
    if rating is None:
        return 0.5
    return clamp01((float(rating) - 1.0) / 4.0)


def relevance_score_from_record(record: dict[str, Any], semantic_query: str = "") -> float:
    score = record.get("score")
    if isinstance(score, (int, float)):
        raw = float(score)
        if 0 <= raw <= 1:
            return clamp01(raw)
        return clamp01(raw / 25.0)
    distance = record.get("distance")
    if isinstance(distance, (int, float)):
        return clamp01(1.0 - float(distance))
    if semantic_query:
        return lexical_relevance(record, semantic_query)
    return 0.5


def lexical_relevance(record: dict[str, Any], semantic_query: str) -> float:
    query_terms = keyword_set(semantic_query)
    if not query_terms:
        return 0.5
    text_terms = keyword_set(" ".join(_record_text_parts(record)))
    if not text_terms:
        return 0.0
    overlap = len(query_terms & text_terms)
    return clamp01(overlap / max(4, min(len(query_terms), 16)))


def score_record(
    record: dict[str, Any],
    *,
    ranking_config: dict[str, Any],
    semantic_query: str = "",
    graph_context_score: float = 0.0,
    relevance_score: float | None = None,
) -> dict[str, Any]:
    weights = ranking_config.get("weights") or PROFILE_WEIGHTS["balanced"]
    quality = quality_signal_from_object(record, float(ranking_config.get("missingQuality", 0.5)))
    relevance = relevance_score if relevance_score is not None else relevance_score_from_record(record, semantic_query)
    graph_context = clamp01(graph_context_score)
    final_score = (
        float(weights.get("relevance", 0.7)) * clamp01(relevance)
        + float(weights.get("quality", 0.25)) * clamp01(quality["qualityScore"])
        + float(weights.get("graphContext", 0.05)) * graph_context
    )
    return {
        "profile": ranking_config.get("profile", "balanced"),
        "diversity": ranking_config.get("diversity", "balanced"),
        "relevanceScore": round(clamp01(relevance), 4),
        "qualityScore": round(clamp01(quality["qualityScore"]), 4),
        "qualityRating": quality.get("qualityRating"),
        "qualityKnown": bool(quality.get("qualityKnown")),
        "qualitySource": quality.get("qualitySource"),
        "qualityRelationId": quality.get("qualityRelationId"),
        "qualityObjectLineageId": quality.get("qualityObjectLineageId"),
        "graphContextScore": round(graph_context, 4),
        "finalScore": round(clamp01(final_score), 4),
        "weights": weights,
    }


def ranking_sort_key(record: dict[str, Any]) -> tuple[float, float, float, int]:
    ranking = record.get("ranking") if isinstance(record.get("ranking"), dict) else {}
    provider_rank = record.get("rank")
    try:
        provider_rank_int = int(provider_rank)
    except (TypeError, ValueError):
        provider_rank_int = 999999
    return (
        -float(ranking.get("finalScore", 0.0)),
        -float(ranking.get("relevanceScore", 0.0)),
        -float(ranking.get("qualityScore", 0.0)),
        provider_rank_int,
    )


def allocate_token_budgets(
    records: list[dict[str, Any]],
    total_budget: int,
    *,
    min_tokens: int,
    max_tokens: int,
    diversity: str = "balanced",
) -> dict[str, int]:
    if not records or total_budget <= 0:
        return {}
    key_values = [(record_key(record), max(0.05, _record_final_score(record))) for record in records]
    key_values = [(key, value) for key, value in key_values if key]
    if not key_values:
        return {}
    diversity_config = DIVERSITY_PROFILES.get(diversity, DIVERSITY_PROFILES["balanced"])
    source_count = len(key_values)
    floor_tokens = _diversity_floor_tokens(
        total_budget,
        source_count,
        min_tokens,
        max_tokens,
        float(diversity_config["sourceFloorRatio"]),
    )
    max_tokens = _diversity_max_tokens(floor_tokens, max_tokens, float(diversity_config["maxSourceMultiplier"]))
    if total_budget <= floor_tokens * source_count:
        floor = max(1, total_budget // source_count)
        return {key: floor for key, _ in key_values}
    budgets = {key: floor_tokens for key, _ in key_values}
    remaining = total_budget - (floor_tokens * source_count)
    denominator = sum(value for _, value in key_values)
    for key, value in key_values:
        budgets[key] += int(round(remaining * (value / denominator)))
        budgets[key] = min(max_tokens, max(floor_tokens, budgets[key]))
    overflow = sum(budgets.values()) - total_budget
    if overflow > 0:
        for key, _ in sorted(key_values, key=lambda item: item[1]):
            reducible = max(0, budgets[key] - floor_tokens)
            reduction = min(reducible, overflow)
            budgets[key] -= reduction
            overflow -= reduction
            if overflow <= 0:
                break
    return budgets


def select_records_by_diversity(records: list[dict[str, Any]], limit: int, diversity: str = "balanced") -> list[dict[str, Any]]:
    if limit <= 0:
        return []
    ordered = sorted(records, key=ranking_sort_key)
    if diversity == "focused":
        return ordered[:limit]
    selected: list[dict[str, Any]] = []
    selected_indexes: set[int] = set()
    seen_sources: set[str] = set()
    for index, record in enumerate(ordered):
        source = diversity_source_key(record)
        if source in seen_sources:
            continue
        selected.append(record)
        selected_indexes.add(index)
        seen_sources.add(source)
        if len(selected) >= limit:
            return selected
    for index, record in enumerate(ordered):
        if index in selected_indexes:
            continue
        selected.append(record)
        if len(selected) >= limit:
            break
    return selected


def diversity_source_key(record: dict[str, Any]) -> str:
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    ranking = record.get("ranking") if isinstance(record.get("ranking"), dict) else {}
    for container in (record, metadata, ranking):
        for key in ("referenceLineageId", "lineageId", "referenceId", "id", "parentReferenceLineageId"):
            value = container.get(key)
            if value not in {None, ""}:
                return str(value)
    return record_key(record) or str(id(record))


def record_key(record: dict[str, Any]) -> str:
    return str(record.get("lineageId") or record.get("referenceLineageId") or record.get("id") or record.get("referenceId") or "")


def keyword_set(text: str) -> set[str]:
    stopwords = {"a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with"}
    return {
        token.lower()
        for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text or "")
        if token.lower() not in stopwords
    }


def clamp01(value: float) -> float:
    if math.isnan(value):
        return 0.0
    return max(0.0, min(1.0, value))


def _quality_relation_sort_key(relation: dict[str, Any]) -> tuple[float, str, float]:
    confidence = relation.get("confidence")
    confidence_score = float(confidence) if isinstance(confidence, (int, float)) else 0.0
    timestamp = str(relation.get("updatedAt") or relation.get("importedAt") or relation.get("createdAt") or "")
    rating = quality_rating_from_value(relation.get("score")) or quality_rating_from_node_key(relation.get("objectLineageId")) or 0.0
    return (confidence_score, timestamp, rating)


def _record_final_score(record: dict[str, Any]) -> float:
    ranking = record.get("ranking") if isinstance(record.get("ranking"), dict) else {}
    try:
        return float(ranking.get("finalScore", 0.0))
    except (TypeError, ValueError):
        return 0.0


def _record_text_parts(record: dict[str, Any]) -> list[str]:
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    parts: list[str] = []
    for container in (record, metadata):
        for key in ("title", "headline", "displayName", "summary", "description", "deck", "brief", "text", "nodeKey", "categoryKey"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    return parts


def _diversity_floor_tokens(
    total_budget: int,
    source_count: int,
    min_tokens: int,
    max_tokens: int,
    floor_ratio: float,
) -> int:
    if source_count <= 0:
        return 0
    per_source_equal_share = max(1, total_budget // source_count)
    desired_floor = int(round(per_source_equal_share * clamp01(floor_ratio)))
    return max(1, min(max_tokens, min(min_tokens, desired_floor)))


def _diversity_max_tokens(floor_tokens: int, requested_max_tokens: int, multiplier: float) -> int:
    if floor_tokens <= 0:
        return requested_max_tokens
    profile_max = int(round(max(floor_tokens, min(requested_max_tokens, floor_tokens * 2)) * max(1.0, multiplier)))
    return max(floor_tokens, min(requested_max_tokens, profile_max))
