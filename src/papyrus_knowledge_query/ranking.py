from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any


QUALITY_RELATION_KEYS = {"quality_rating_is"}
QUALITY_NODE_RE = re.compile(r"quality\.rating\.(\d)_star$")
DEFAULT_RECENCY_HALF_LIFE_DAYS = 180.0
_UNIX_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# Former balanced weights (graphContext removed → /0.95), then recency 0.07
# taken proportionally from the remaining mass (×0.93). Cap recency ≤ 0.10.
DEFAULT_WEIGHTS = {
    "relevance": (0.70 / 0.95) * (1.0 - 0.07),
    "quality": (0.25 / 0.95) * (1.0 - 0.07),
    "recency": 0.07,
}

# Former balanced diversity constants (focused/broad profiles deleted).
SOURCE_FLOOR_RATIO = 0.50
MAX_SOURCE_MULTIPLIER = 3.0
PASSAGE_REPEAT_CAP = 3
SEE_ALSO_MIN_TOKENS = 40
SEE_ALSO_MAX_TOKENS = 120


def normalize_ranking_config(input: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    raw = input.get("ranking") if isinstance(input.get("ranking"), dict) else {}
    weights = dict(DEFAULT_WEIGHTS)
    raw_weights = raw.get("weights") if isinstance(raw.get("weights"), dict) else {}
    for key in ("relevance", "quality", "recency"):
        if key not in raw_weights:
            continue
        try:
            weights[key] = max(0.0, float(raw_weights[key]))
        except (TypeError, ValueError):
            warnings.append(f"ranking.weights.{key} must be numeric; using default")
    total = sum(weights.values())
    if total <= 0:
        warnings.append("ranking.weights must not all be zero; using defaults")
        weights = dict(DEFAULT_WEIGHTS)
        total = sum(weights.values())
    weights = {key: value / total for key, value in weights.items()}
    try:
        missing_quality = float(raw.get("missingQuality", 0.5))
    except (TypeError, ValueError):
        warnings.append("ranking.missingQuality must be numeric; using 0.5")
        missing_quality = 0.5
    try:
        half_life = float(raw.get("recencyHalfLifeDays", DEFAULT_RECENCY_HALF_LIFE_DAYS))
    except (TypeError, ValueError):
        warnings.append("ranking.recencyHalfLifeDays must be numeric; using 180")
        half_life = DEFAULT_RECENCY_HALF_LIFE_DAYS
    if half_life <= 0:
        warnings.append("ranking.recencyHalfLifeDays must be > 0; using 180")
        half_life = DEFAULT_RECENCY_HALF_LIFE_DAYS
    return {
        "weights": weights,
        "missingQuality": clamp01(missing_quality),
        "recencyHalfLifeDays": float(half_life),
        "relevanceGate": 0.18,
    }


def _datetime_to_epoch_day(value: datetime) -> int:
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return int((aware.astimezone(timezone.utc) - _UNIX_EPOCH).days)


def epoch_day_from_value(value: Any) -> int | None:
    """Parse ISO-8601 / epoch-day into UTC days since 1970-01-01. Naive → UTC."""
    if value in {None, ""}:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        # Already an epoch-day integer (S3 Vectors filterable scalar).
        if 0 <= value < 100000:
            return value
        # Epoch seconds / ms — convert.
        seconds = value / 1000.0 if value > 10_000_000_000 else float(value)
        return _datetime_to_epoch_day(datetime.fromtimestamp(seconds, tz=timezone.utc))
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        as_int = int(value)
        if 0 <= as_int < 100000 and abs(value - as_int) < 1e-9:
            return as_int
        seconds = value / 1000.0 if value > 10_000_000_000 else float(value)
        return _datetime_to_epoch_day(datetime.fromtimestamp(seconds, tz=timezone.utc))
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return epoch_day_from_value(int(text))
    normalized = text.replace("Z", "+00:00") if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return _datetime_to_epoch_day(parsed)


def recency_score(age_days: float | None, half_life: float = DEFAULT_RECENCY_HALF_LIFE_DAYS) -> float:
    """Exponential age decay. Missing date → 0.5 (neutral, like missingQuality)."""
    if age_days is None:
        return 0.5
    if half_life <= 0:
        return 0.5
    age = max(0.0, float(age_days))
    return float(0.5 ** (age / float(half_life)))


def recency_signal_from_record(
    record: dict[str, Any],
    *,
    half_life: float = DEFAULT_RECENCY_HALF_LIFE_DAYS,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Compute recency from epoch-day metadata or ISO reference date fields."""
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    day_candidates: list[int] = []
    for container in (record, metadata):
        for key in ("sourceUpdatedAtDay", "sourcePublishedAtDay", "retrievedAtDay"):
            day = epoch_day_from_value(container.get(key))
            if day is not None:
                day_candidates.append(day)
        for key in ("sourceUpdatedAt", "sourcePublishedAt", "retrievedAt", "importedAt"):
            day = epoch_day_from_value(container.get(key))
            if day is not None:
                day_candidates.append(day)
    if not day_candidates:
        return {
            "recencyScore": 0.5,
            "recencyKnown": False,
            "recencyAgeDays": None,
            "recencySourceDay": None,
        }
    source_day = max(day_candidates)
    clock = now or datetime.now(timezone.utc)
    today = _datetime_to_epoch_day(clock)
    age_days = float(max(0, today - source_day))
    return {
        "recencyScore": round(recency_score(age_days, half_life), 4),
        "recencyKnown": True,
        "recencyAgeDays": age_days,
        "recencySourceDay": source_day,
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


def fuse_ranked_lists(
    lists: list[list[dict[str, Any]]],
    *,
    weights: list[float] | None = None,
    k: int = 60,
    list_names: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Reciprocal rank fusion across N ranked lists.

    ``score(d) = Σ weight_l / (k + rank_l(d))``, normalized to 0..1 by dividing
    by the theoretical max ``Σ weight_l / (k + 1)``. Joins on record key
    (passage key when present, else lineage id). Best (lowest) rank wins per list.
    """
    if not lists:
        return []
    active = [(index, ranked) for index, ranked in enumerate(lists) if ranked]
    if not active:
        return []
    if weights is None:
        weights = [1.0] * len(lists)
    if len(weights) != len(lists):
        raise ValueError("weights must match the number of ranked lists")
    names = list_names or [f"list{index}" for index in range(len(lists))]

    rank_maps: list[dict[str, int]] = []
    record_maps: list[dict[str, dict[str, Any]]] = []
    for ranked in lists:
        ranks: dict[str, int] = {}
        records: dict[str, dict[str, Any]] = {}
        for index, record in enumerate(ranked):
            key = _fusion_join_key(record)
            if not key:
                continue
            rank = int(record.get("rank") or record.get("providerRank") or (index + 1))
            if key not in ranks or rank < ranks[key]:
                ranks[key] = rank
                records[key] = record
        rank_maps.append(ranks)
        record_maps.append(records)

    all_keys = set()
    for ranks in rank_maps:
        all_keys.update(ranks)
    if not all_keys:
        return []

    max_score = sum(float(weight) / float(k + 1) for weight in weights if weight)
    if max_score <= 0:
        max_score = 1.0

    fused: list[dict[str, Any]] = []
    for key in all_keys:
        rrf = 0.0
        fusion_meta: dict[str, Any] = {}
        preferred: dict[str, Any] | None = None
        fallback: dict[str, Any] | None = None
        for list_index, weight in enumerate(weights):
            rank = rank_maps[list_index].get(key)
            name = names[list_index] if list_index < len(names) else f"list{list_index}"
            if rank is None:
                fusion_meta[f"{name}Rank"] = None
                continue
            rrf += float(weight) / float(k + rank)
            fusion_meta[f"{name}Rank"] = rank
            record = dict(record_maps[list_index][key])
            if name == "semantic":
                preferred = record
            elif fallback is None:
                fallback = record
        base = preferred or fallback
        if base is None:
            continue
        normalized = clamp01(rrf / max_score)
        fusion_meta["rrfScore"] = round(normalized, 6)
        fusion_meta["rrfRaw"] = round(rrf, 6)
        base["score"] = normalized
        base["fusion"] = fusion_meta
        base.pop("distance", None)
        fused.append(base)

    fused.sort(
        key=lambda record: (
            -float((record.get("fusion") or {}).get("rrfScore") or 0.0),
            int((record.get("fusion") or {}).get("semanticRank") or 10**9),
            int((record.get("fusion") or {}).get("lexicalRank") or 10**9),
        )
    )
    return [{**record, "rank": index + 1, "providerRank": index + 1} for index, record in enumerate(fused)]


def _fusion_join_key(record: dict[str, Any]) -> str:
    """Join hybrid lists at reference lineage when present.

    Semantic search diversifies to one hit per reference and often omits passage
    keys; lexical hits are passage-keyed. Prefer lineage so the arms fuse.
    Fall back to passage key when lineage is absent.
    """
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    for container in (record, metadata):
        for field in ("referenceLineageId", "lineageId"):
            value = container.get(field)
            if value not in {None, ""}:
                return str(value)
    for container in (record, metadata):
        for field in ("key", "passageKey", "id"):
            value = container.get(field)
            if value not in {None, ""}:
                return str(value)
    return ""


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
    relevance_score: float | None = None,
) -> dict[str, Any]:
    weights = ranking_config.get("weights") or DEFAULT_WEIGHTS
    quality = quality_signal_from_object(record, float(ranking_config.get("missingQuality", 0.5)))
    relevance = relevance_score if relevance_score is not None else relevance_score_from_record(record, semantic_query)
    half_life = float(ranking_config.get("recencyHalfLifeDays", DEFAULT_RECENCY_HALF_LIFE_DAYS))
    recency = recency_signal_from_record(record, half_life=half_life)
    final_score = (
        float(weights.get("relevance", DEFAULT_WEIGHTS["relevance"])) * clamp01(relevance)
        + float(weights.get("quality", DEFAULT_WEIGHTS["quality"])) * clamp01(quality["qualityScore"])
        + float(weights.get("recency", DEFAULT_WEIGHTS["recency"])) * clamp01(recency["recencyScore"])
    )
    return {
        "relevanceScore": round(clamp01(relevance), 4),
        "qualityScore": round(clamp01(quality["qualityScore"]), 4),
        "qualityRating": quality.get("qualityRating"),
        "qualityKnown": bool(quality.get("qualityKnown")),
        "qualitySource": quality.get("qualitySource"),
        "qualityRelationId": quality.get("qualityRelationId"),
        "qualityObjectLineageId": quality.get("qualityObjectLineageId"),
        "recencyScore": round(clamp01(recency["recencyScore"]), 4),
        "recencyKnown": bool(recency.get("recencyKnown")),
        "recencyAgeDays": recency.get("recencyAgeDays"),
        "recencySourceDay": recency.get("recencySourceDay"),
        "finalScore": round(clamp01(final_score), 4),
        "weights": weights,
    }


def ranking_sort_key(record: dict[str, Any]) -> tuple[float, float, float, float, int]:
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
        -float(ranking.get("recencyScore", 0.0)),
        provider_rank_int,
    )


def allocate_token_budgets(
    records: list[dict[str, Any]],
    total_budget: int,
    *,
    min_tokens: int,
    max_tokens: int,
) -> dict[str, int]:
    if not records or total_budget <= 0:
        return {}
    key_values = [(record_key(record), max(0.05, _record_final_score(record))) for record in records]
    key_values = [(key, value) for key, value in key_values if key]
    if not key_values:
        return {}
    source_count = len(key_values)
    floor_tokens = _diversity_floor_tokens(
        total_budget,
        source_count,
        min_tokens,
        max_tokens,
        SOURCE_FLOOR_RATIO,
    )
    max_tokens = _diversity_max_tokens(floor_tokens, max_tokens, MAX_SOURCE_MULTIPLIER)
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


def select_records_by_diversity(records: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Select up to ``limit`` records, unique sources first (former balanced behavior)."""
    if limit <= 0:
        return []
    ordered = sorted(records, key=ranking_sort_key)
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
