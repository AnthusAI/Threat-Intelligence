from __future__ import annotations

import json
from typing import Any

from .ids import hash_short
from .model_attachments import semantic_version_key
from .newsroom_summary import semantic_relation_count_delta, update_newsroom_summary_delta
from .reference_policy import is_current_accepted_reference
from .relation_types import semantic_relation_type_fields_for_predicate


def resolve_reference_any(references: list[dict[str, Any]], token: str) -> dict[str, Any]:
    matches = [
        reference
        for reference in references
        if reference.get("id") == token
        or reference.get("lineageId") == token
        or reference.get("externalItemId") == token
    ]
    if not matches:
        raise ValueError(f"Reference {token} was not found.")
    return next(
        (reference for reference in matches if is_current_accepted_reference(reference)),
        matches[0] if matches else None,
    )


def resolve_reference_for_label(references: list[dict[str, Any]], token: str) -> dict[str, Any]:
    reference = resolve_reference_any(references, token)
    if not is_current_accepted_reference(reference):
        raise ValueError(
            f"Reference {token} is {reference.get('versionState')}/{reference.get('curationStatus')}; "
            "authoritative labels require a current accepted Reference."
        )
    return reference


def resolve_category_in_set(categories: list[dict[str, Any]], token: str, *, label: str = "--category") -> dict[str, Any]:
    matches = [
        category
        for category in categories
        if category.get("id") == token or category.get("lineageId") == token or category.get("categoryKey") == token
    ]
    if not matches:
        raise ValueError(f"{label} {token} did not match a category in the selected CategorySet.")
    if len(matches) > 1:
        return (
            next((category for category in matches if category.get("versionState") == "draft"), None)
            or next((category for category in matches if category.get("versionState") == "current"), None)
            or matches[0]
        )
    return matches[0]


def resolve_category_any(categories: list[dict[str, Any]], token: str) -> dict[str, Any]:
    matches = [
        category
        for category in categories
        if category.get("id") == token or category.get("lineageId") == token or category.get("categoryKey") == token
    ]
    if not matches:
        raise ValueError(f"Category {token} was not found.")
    return (
        next((category for category in matches if category.get("versionState") == "draft"), None)
        or next((category for category in matches if category.get("versionState") == "current"), None)
        or matches[0]
    )


def best_category_by_lineage(categories: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}

    def score(category: dict[str, Any]) -> int:
        if category.get("versionState") == "draft":
            return 3
        if category.get("versionState") == "current":
            return 2
        return 1

    for category in categories:
        lineage_id = category.get("lineageId") or category.get("id")
        existing = result.get(lineage_id)
        if not existing or score(category) > score(existing):
            result[lineage_id] = category
    return result


def build_manual_authoritative_label_relation(
    *,
    reference: dict[str, Any],
    category: dict[str, Any],
    category_set: dict[str, Any],
    note: str,
    actor: str,
) -> dict[str, Any]:
    subject_state_key = f"reference#{reference.get('lineageId') or reference['id']}#current"
    object_state_key = f"category#{category.get('lineageId') or category['id']}#current"
    subject_version_key = semantic_version_key("reference", reference["id"])
    object_version_key = semantic_version_key("category", category["id"])
    return {
        "id": f"semantic-relation-{hash_short([subject_state_key, 'authoritative_label', object_state_key])}",
        "relationState": "current",
        "predicate": "authoritative_label",
        **semantic_relation_type_fields_for_predicate("authoritative_label"),
        "subjectKind": "reference",
        "subjectId": reference["id"],
        "subjectLineageId": reference.get("lineageId") or reference["id"],
        "subjectVersionNumber": reference.get("versionNumber"),
        "objectKind": "category",
        "objectId": category["id"],
        "objectLineageId": category.get("lineageId") or category["id"],
        "objectVersionNumber": category.get("versionNumber"),
        "subjectStateKey": subject_state_key,
        "objectStateKey": object_state_key,
        "objectSubjectStateKey": f"{object_state_key}#reference",
        "predicateObjectStateKey": f"authoritative_label#{object_state_key}",
        "subjectVersionKey": subject_version_key,
        "objectVersionKey": object_version_key,
        "score": 1,
        "confidence": None,
        "rank": 1,
        "classifierId": category_set.get("classifierId"),
        "modelVersion": None,
        "reviewRecommended": False,
        "sourceSnapshotId": None,
        "importRunId": None,
        "importedAt": _utc_now(),
        "metadata": json.dumps(
            {
                "kind": "classification.authoritative_label.manual",
                "note": note,
                "actor": actor,
                "categorySetId": category_set.get("id"),
            }
        ),
    }


def find_current_authoritative_label(relations: list[dict[str, Any]], relation: dict[str, Any]) -> dict[str, Any] | None:
    for entry in relations:
        if entry.get("relationState") != "current":
            continue
        if (entry.get("relationTypeKey") or entry.get("predicate")) != "authoritative_label":
            continue
        if entry.get("subjectStateKey") == relation.get("subjectStateKey") and entry.get("objectStateKey") == relation.get(
            "objectStateKey"
        ):
            return entry
    return None


def build_accept_authoritative_label_from_prediction(
    relation: dict[str, Any],
    *,
    note: str | None,
) -> dict[str, Any]:
    subject_version_key = semantic_version_key(relation["subjectKind"], relation["subjectId"])
    object_version_key = semantic_version_key(relation["objectKind"], relation["objectId"])
    return {
        "id": f"semantic-relation-{hash_short([subject_version_key, 'authoritative_label', object_version_key, relation.get('subjectStateKey'), relation.get('objectStateKey')])}",
        "relationState": "current",
        "predicate": "authoritative_label",
        **semantic_relation_type_fields_for_predicate("authoritative_label"),
        "subjectKind": relation["subjectKind"],
        "subjectId": relation["subjectId"],
        "subjectLineageId": relation["subjectLineageId"],
        "subjectVersionNumber": relation.get("subjectVersionNumber"),
        "objectKind": relation["objectKind"],
        "objectId": relation["objectId"],
        "objectLineageId": relation["objectLineageId"],
        "objectVersionNumber": relation.get("objectVersionNumber"),
        "subjectStateKey": relation.get("subjectStateKey"),
        "objectStateKey": relation.get("objectStateKey"),
        "objectSubjectStateKey": relation.get("objectSubjectStateKey"),
        "predicateObjectStateKey": f"authoritative_label#{relation.get('objectStateKey')}",
        "subjectVersionKey": subject_version_key,
        "objectVersionKey": object_version_key,
        "score": float(relation["score"]) if relation.get("score") is not None else 1,
        "confidence": None,
        "rank": 1,
        "classifierId": relation.get("classifierId"),
        "modelVersion": relation.get("modelVersion"),
        "reviewRecommended": False,
        "sourceSnapshotId": relation.get("sourceSnapshotId"),
        "importRunId": relation.get("importRunId"),
        "importedAt": _utc_now(),
        "metadata": json.dumps(
            {
                "kind": "classification.authoritative_label.created",
                "sourceClassificationRelationId": relation["id"],
                "note": note,
            }
        ),
    }


def print_reference_label_plan(label: str, relations: list[dict[str, Any]], *, apply: bool) -> None:
    print(f"references\t{label}\tmode\t{'apply' if apply else 'dry-run'}")
    for relation in relations:
        print(
            f"references\t{label}\trelation\t{relation['id']}\t"
            f"{relation.get('relationTypeKey') or relation.get('predicate')}\t"
            f"{relation.get('subjectId')}\t{relation.get('objectId')}"
        )


def apply_label_relation(client, relation: dict[str, Any], *, reference_id: str, category_key: str) -> None:
    client.upsert("SemanticRelation", relation)
    update_newsroom_summary_delta(
        client,
        semantic_relation_count_delta(relation, 1),
        f"references label {reference_id} {category_key}",
    )


def apply_unlabel_relation(client, relation: dict[str, Any]) -> None:
    client.delete_record("SemanticRelation", relation["id"])
    update_newsroom_summary_delta(
        client,
        semantic_relation_count_delta(relation, -1),
        f"references unlabel {relation['id']}",
    )


def build_classification_prediction_rows(
    *,
    relations: list[dict[str, Any]],
    references: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    corpus_id: str | None,
    category_set_id: str | None,
    status: str,
    limit: int | None,
) -> list[dict[str, Any]]:
    reference_by_lineage = {
        reference.get("lineageId") or reference["id"]: reference
        for reference in references
        if reference.get("versionState") == "current"
    }
    category_by_lineage = {
        category.get("lineageId") or category["id"]: category
        for category in categories
        if category.get("versionState") == "current"
    }
    authoritative_keys = {
        f"{relation.get('subjectStateKey')}::{relation.get('objectStateKey')}"
        for relation in relations
        if relation.get("relationState") == "current"
        and (relation.get("relationTypeKey") or relation.get("predicate")) == "authoritative_label"
    }
    predictions = []
    for relation in relations:
        if (relation.get("relationTypeKey") or relation.get("predicate")) != "classified_as":
            continue
        if status != "all" and relation.get("relationState") != status:
            continue
        if relation.get("subjectKind") != "reference" or relation.get("objectKind") != "category":
            continue
        reference = reference_by_lineage.get(relation.get("subjectLineageId"))
        category = category_by_lineage.get(relation.get("objectLineageId"))
        if not reference or not category:
            continue
        if corpus_id and reference.get("corpusId") != corpus_id:
            continue
        if category_set_id and category.get("categorySetId") != category_set_id:
            continue
        predictions.append(
            {
                "relation": relation,
                "reference": reference,
                "category": category,
                "hasAuthoritativeLabel": f"{relation.get('subjectStateKey')}::{relation.get('objectStateKey')}"
                in authoritative_keys,
            }
        )
    predictions.sort(
        key=lambda entry: (
            str(entry["relation"].get("importedAt") or ""),
            str(entry["relation"].get("id") or ""),
        ),
        reverse=True,
    )
    if limit:
        predictions = predictions[:limit]
    return predictions


def build_label_rows(
    *,
    relations: list[dict[str, Any]],
    references: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    reference: dict[str, Any] | None,
    category: dict[str, Any] | None,
    limit: int | None,
) -> list[dict[str, Any]]:
    reference_by_lineage = {reference.get("lineageId") or reference["id"]: reference for reference in references}
    reference_by_id = {reference["id"]: reference for reference in references}
    category_by_lineage = best_category_by_lineage(categories)
    category_by_id = {category["id"]: category for category in categories}
    rows = []
    for relation in relations:
        if relation.get("relationState") != "current":
            continue
        predicate = relation.get("relationTypeKey") or relation.get("predicate")
        if predicate not in {"classified_as", "authoritative_label"}:
            continue
        if relation.get("subjectKind") != "reference" or relation.get("objectKind") != "category":
            continue
        if reference and relation.get("subjectLineageId") not in {
            reference.get("lineageId") or reference["id"],
            reference["id"],
        } and relation.get("subjectId") != reference["id"]:
            continue
        if category and relation.get("objectLineageId") not in {
            category.get("lineageId") or category["id"],
            category["id"],
        } and relation.get("objectId") != category["id"]:
            continue
        ref = reference_by_id.get(relation.get("subjectId")) or reference_by_lineage.get(relation.get("subjectLineageId"))
        cat = category_by_id.get(relation.get("objectId")) or category_by_lineage.get(relation.get("objectLineageId"))
        if ref and cat:
            rows.append({"relation": relation, "reference": ref, "category": cat})
    rows.sort(
        key=lambda row: (
            str(row["reference"].get("externalItemId") or row["reference"]["id"]),
            str(row["category"].get("categoryKey") or row["category"]["id"]),
            str(row["relation"].get("relationTypeKey") or row["relation"].get("predicate")),
        )
    )
    if limit:
        rows = rows[:limit]
    return rows


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
