from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from .graphql_authoring import PapyrusGraphQLAuthoringClient
from .model_attachments import download_attachment_buffer, model_attachment_id
from .reference_policy import normalize_reference_curation_status

NEWSROOM_SUMMARY_PAYLOAD_ID = "knowledge-raw-payload-newsroom-summary-current"
NEWSROOM_SUMMARY_OWNER_TYPE = "newsroom"
NEWSROOM_SUMMARY_OWNER_ID = "newsroom"
NEWSROOM_SUMMARY_PAYLOAD_KIND = "summary-snapshot"
SUMMARY_STALE_AFTER_MS = 15 * 60 * 1000


def update_newsroom_summary_after_reference_registration(
    client: PapyrusGraphQLAuthoringClient,
    changes: list[dict[str, Any]],
    plan: dict[str, Any],
) -> None:
    created_by_model: dict[str, list[dict[str, Any]]] = {}
    for change in changes:
        if change.get("action") != "create":
            continue
        created_by_model.setdefault(change["modelName"], []).append(change["expected"])

    reference_delta = compute_current_reference_delta_from_changes(changes)
    created_assignments = created_by_model.get("Assignment", [])
    created_messages = created_by_model.get("Message", [])
    created_relations = created_by_model.get("SemanticRelation", [])
    created_import_runs = created_by_model.get("KnowledgeImportRun", [])

    delta = {
        "source": "incremental",
        "latestImportRun": created_import_runs[0] if created_import_runs else None,
        "countDeltas": {
            "corpora": len(created_by_model.get("KnowledgeCorpus", [])),
            "importRuns": len(created_import_runs),
            "referenceAttachments": len(created_by_model.get("ReferenceAttachment", [])),
            "references": reference_delta["countDelta"],
            "messages": len(created_messages),
            "modelAttachments": len(created_by_model.get("ModelAttachment", [])),
            "assignments": len(created_assignments),
            "semanticRelations": len(created_relations),
        },
        "referenceStatusDeltas": reference_delta["statusDeltas"],
        "assignmentStatusDeltas": _count_delta(created_assignments, "status", "unknown"),
        "assignmentTypeDeltas": _count_delta(created_assignments, "assignmentTypeKey", "unknown"),
        "messageKindDeltas": _count_delta(created_messages, "messageKind", "unknown"),
        "messageDomainDeltas": _count_delta(created_messages, "messageDomain", "unknown"),
    }
    client.update_newsroom_summary(
        delta,
        actor_label="Papyrus content CLI",
        reason=f"references create-from-catalog {plan['importRunId']}",
    )


def update_newsroom_summary_after_assignment_creates(
    client: PapyrusGraphQLAuthoringClient,
    changes: list[dict[str, Any]],
    *,
    actor_label: str,
    reason: str,
) -> None:
    created_assignments = [change["expected"] for change in changes if change.get("modelName") == "Assignment" and change.get("action") == "create"]
    if not created_assignments:
        return
    client.update_newsroom_summary(
        {
            "source": "incremental",
            "countDeltas": {"assignments": len(created_assignments)},
            "assignmentStatusDeltas": _count_delta(created_assignments, "status", "unknown"),
            "assignmentTypeDeltas": _count_delta(created_assignments, "assignmentTypeKey", "unknown"),
        },
        actor_label=actor_label,
        reason=reason,
    )


def compute_current_reference_delta_from_changes(changes: list[dict[str, Any]]) -> dict[str, Any]:
    status_counter: Counter[str] = Counter()
    corpus_counter: Counter[str] = Counter()
    status_by_corpus: Counter[str] = Counter()
    count_delta = 0
    for change in changes:
        if change.get("modelName") != "Reference":
            continue
        if change.get("action") not in {"create", "update"}:
            continue
        expected = change.get("expected") or {}
        if expected.get("versionState") and expected.get("versionState") != "current":
            continue
        count_delta += 1 if change["action"] == "create" else 0
        status = normalize_reference_curation_status(expected.get("curationStatus"), "pending")
        corpus_id = expected.get("corpusId") or "unknown"
        status_counter[status] += 1
        corpus_counter[corpus_id] += 1
        status_by_corpus[f"{corpus_id}#{status}"] += 1
    return {
        "countDelta": count_delta,
        "statusDeltas": dict(status_counter),
        "corpusDeltas": dict(corpus_counter),
        "statusByCorpusDeltas": dict(status_by_corpus),
    }


def update_newsroom_summary_after_extracted_text_attachments(
    client: PapyrusGraphQLAuthoringClient,
    changes: list[dict[str, Any]],
    *,
    actor_label: str,
    reason: str,
) -> None:
    created = [
        change["expected"]
        for change in changes
        if change.get("modelName") == "ReferenceAttachment" and change.get("action") == "create"
    ]
    if not created:
        return
    client.update_newsroom_summary(
        {
            "source": "incremental",
            "countDeltas": {"referenceAttachments": len(created)},
        },
        actor_label=actor_label,
        reason=reason,
    )


def semantic_relation_count_delta(relation: dict[str, Any], amount: int) -> dict[str, Any]:
    relation_type = relation.get("relationTypeKey") or relation.get("predicate") or "unknown"
    return {
        "countDeltas": {"semanticRelations": amount},
        "facetDeltas": {
            "semanticRelations": {
                "byRelationTypeKey": {relation_type: amount},
                "byRelationDomain": {relation.get("relationDomain") or "unknown": amount},
                "bySubjectKind": {relation.get("subjectKind") or "unknown": amount},
                "byObjectKind": {relation.get("objectKind") or "unknown": amount},
            },
        },
    }


def update_newsroom_summary_delta(
    client: PapyrusGraphQLAuthoringClient,
    delta: dict[str, Any],
    reason: str,
    *,
    actor_label: str = "Papyrus content CLI",
) -> None:
    client.update_newsroom_summary(
        {"source": "incremental", **delta},
        actor_label=actor_label,
        reason=reason,
    )


def _count_delta(records: list[dict[str, Any]], field: str, fallback: str) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for record in records:
        counter[str(record.get(field) or fallback)] += 1
    return dict(counter)


def build_newsroom_summary_payload(
    *,
    corpora: list[dict[str, Any]] | None = None,
    import_runs: list[dict[str, Any]] | None = None,
    category_sets: list[dict[str, Any]] | None = None,
    categories: list[dict[str, Any]] | None = None,
    proposals: list[dict[str, Any]] | None = None,
    artifacts: list[dict[str, Any]] | None = None,
    references: list[dict[str, Any]] | None = None,
    reference_attachments: list[dict[str, Any]] | None = None,
    semantic_nodes: list[dict[str, Any]] | None = None,
    messages: list[dict[str, Any]] | None = None,
    model_attachments: list[dict[str, Any]] | None = None,
    semantic_relations: list[dict[str, Any]] | None = None,
    assignments: list[dict[str, Any]] | None = None,
    assignment_events: list[dict[str, Any]] | None = None,
    now: str | None = None,
    source: str = "recount",
) -> dict[str, Any]:
    timestamp = now or _utc_now()
    current_category_sets = _select_current_versioned_records(category_sets or [])
    current_categories = _select_current_versioned_records(categories or [])
    current_references = _select_current_versioned_records(references or [])
    current_semantic_nodes = _select_current_versioned_records(semantic_nodes or [])
    current_semantic_relations = [
        relation for relation in (semantic_relations or []) if _is_current_relation_state(relation.get("relationState"))
    ]
    latest_import_run = sorted(
        import_runs or [],
        key=lambda entry: str(entry.get("importedAt") or ""),
        reverse=True,
    )[0] if import_runs else None
    facets = build_newsroom_summary_facets(
        import_runs=import_runs or [],
        references=current_references,
        semantic_nodes=current_semantic_nodes,
        messages=messages or [],
        model_attachments=model_attachments or [],
        semantic_relations=current_semantic_relations,
        assignments=assignments or [],
    )
    return {
        "generatedAt": timestamp,
        "staleAt": (datetime.fromisoformat(timestamp.replace("Z", "+00:00")) + timedelta(milliseconds=SUMMARY_STALE_AFTER_MS)).isoformat().replace("+00:00", "Z"),
        "source": source,
        "latestImportRun": latest_import_run,
        "counts": {
            "corpora": len(corpora or []),
            "importRuns": len(import_runs or []),
            "categorySets": len(current_category_sets),
            "categories": len(current_categories),
            "proposals": len(proposals or []),
            "openProposals": sum(1 for proposal in (proposals or []) if proposal.get("status") == "proposed"),
            "artifacts": len(artifacts or []),
            "references": len(current_references),
            "referenceAttachments": len(reference_attachments or []),
            "semanticNodes": len(current_semantic_nodes),
            "messages": len(messages or []),
            "modelAttachments": len(model_attachments or []),
            "semanticRelations": len(current_semantic_relations),
            "assignments": len(assignments or []),
            "assignmentEvents": len(assignment_events or []),
        },
        "facets": facets,
        "assignmentStatusCounts": dict(facets["assignments"]["byStatus"]),
        "assignmentTypeCounts": dict(facets["assignments"]["byType"]),
        "referenceStatusCounts": dict(facets["references"]["byCurationStatus"]),
        "messageKindCounts": dict(facets["messages"]["byKind"]),
        "messageDomainCounts": dict(facets["messages"]["byDomain"]),
    }


def build_newsroom_summary_payload_record(payload: dict[str, Any], now: str | None = None) -> dict[str, Any]:
    timestamp = now or _utc_now()
    latest_import_run = payload.get("latestImportRun") if isinstance(payload.get("latestImportRun"), dict) else None
    return {
        "id": NEWSROOM_SUMMARY_PAYLOAD_ID,
        "ownerType": NEWSROOM_SUMMARY_OWNER_TYPE,
        "ownerId": NEWSROOM_SUMMARY_OWNER_ID,
        "payloadKind": NEWSROOM_SUMMARY_PAYLOAD_KIND,
        "importRunId": (latest_import_run or {}).get("id"),
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }


def build_newsroom_summary_facets(
    *,
    import_runs: list[dict[str, Any]],
    references: list[dict[str, Any]],
    semantic_nodes: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    model_attachments: list[dict[str, Any]],
    semantic_relations: list[dict[str, Any]],
    assignments: list[dict[str, Any]],
) -> dict[str, Any]:
    facets = _create_empty_newsroom_summary_facets()
    for assignment in assignments:
        status = _string_or_default(assignment.get("status"), "unknown")
        assignment_type = _string_or_default(assignment.get("assignmentTypeKey"), "unknown")
        section = _assignment_section_key(assignment)
        _increment(facets["assignments"]["byStatus"], status, 1)
        _increment(facets["assignments"]["byType"], assignment_type, 1)
        _increment_nested(facets["assignments"]["statusByType"], assignment_type, status, 1)
        _increment(facets["assignments"]["bySection"], section, 1)
        _increment_nested(facets["assignments"]["statusBySection"], section, status, 1)
        _increment_nested(facets["assignments"]["typeBySection"], section, assignment_type, 1)
    for message in messages:
        kind = _string_or_default(message.get("messageKind"), "unknown")
        domain = _string_or_default(message.get("messageDomain"), "unknown")
        status = _string_or_default(message.get("status"), "unknown")
        _increment(facets["messages"]["byKind"], kind, 1)
        _increment(facets["messages"]["byDomain"], domain, 1)
        _increment(facets["messages"]["byStatus"], status, 1)
        _increment_nested(facets["messages"]["domainByKind"], kind, domain, 1)
    for attachment in model_attachments:
        _increment(facets["modelAttachments"]["byOwnerKind"], _string_or_default(attachment.get("ownerKind"), "unknown"), 1)
        _increment(facets["modelAttachments"]["byRole"], _string_or_default(attachment.get("role"), "unknown"), 1)
        _increment(facets["modelAttachments"]["byMediaType"], _string_or_default(attachment.get("mediaType"), "unknown"), 1)
        _increment(facets["modelAttachments"]["byStatus"], _string_or_default(attachment.get("status"), "unknown"), 1)
    for reference in references:
        status = _string_or_default(reference.get("curationStatus"), "pending")
        corpus = _string_or_default(reference.get("corpusId"), "unknown")
        _increment(facets["references"]["byCurationStatus"], status, 1)
        _increment(facets["references"]["byCorpus"], corpus, 1)
        _increment_nested(facets["references"]["statusByCorpus"], corpus, status, 1)
    for node in semantic_nodes:
        _increment(facets["semanticNodes"]["byNodeKind"], _string_or_default(node.get("nodeKind"), "unknown"), 1)
        _increment(facets["semanticNodes"]["byStatus"], _string_or_default(node.get("status"), "unknown"), 1)
        _increment(facets["semanticNodes"]["byCorpus"], _string_or_default(node.get("corpusId"), "unknown"), 1)
        _increment(facets["semanticNodes"]["byCategorySet"], _string_or_default(node.get("categorySetId"), "unknown"), 1)
    for relation in semantic_relations:
        _increment(
            facets["semanticRelations"]["byRelationTypeKey"],
            _string_or_default(relation.get("relationTypeKey") or relation.get("predicate"), "unknown"),
            1,
        )
        _increment(facets["semanticRelations"]["byRelationDomain"], _string_or_default(relation.get("relationDomain"), "unknown"), 1)
        _increment(facets["semanticRelations"]["bySubjectKind"], _string_or_default(relation.get("subjectKind"), "unknown"), 1)
        _increment(facets["semanticRelations"]["byObjectKind"], _string_or_default(relation.get("objectKind"), "unknown"), 1)
    for import_run in import_runs:
        _increment(facets["imports"]["byCorpus"], _string_or_default(import_run.get("corpusId"), "unknown"), 1)
    return facets


def newsroom_summary_diff(current_payload: dict[str, Any] | None, expected_payload: dict[str, Any]) -> dict[str, int]:
    current = _normalize_newsroom_summary_payload(current_payload or {})
    expected = _normalize_newsroom_summary_payload(expected_payload)
    count_keys = set(current.get("counts") or {}) | set(expected.get("counts") or {})
    counts_changed = sum(1 for key in count_keys if (current.get("counts") or {}).get(key, 0) != (expected.get("counts") or {}).get(key, 0))
    facet_keys = set((current.get("facets") or {}).keys()) | set((expected.get("facets") or {}).keys())
    facet_sections_changed = sum(
        1
        for key in facet_keys
        if json.dumps((current.get("facets") or {}).get(key, {}), sort_keys=True)
        != json.dumps((expected.get("facets") or {}).get(key, {}), sort_keys=True)
    )
    return {"countsChanged": counts_changed, "facetSectionsChanged": facet_sections_changed}


def print_newsroom_summary_recount(
    current_payload: dict[str, Any] | None,
    expected_payload: dict[str, Any],
    change: dict[str, Any],
) -> None:
    current = _normalize_newsroom_summary_payload(current_payload or {})
    expected = _normalize_newsroom_summary_payload(expected_payload)
    print("Newsroom summary recount:")
    print(f"Snapshot: {NEWSROOM_SUMMARY_PAYLOAD_ID}")
    print(f"Action: {change.get('action')}")
    print(f"Current: generatedAt={current.get('generatedAt')} source={current.get('source')}")
    print(f"Expected: generatedAt={expected.get('generatedAt')} source={expected.get('source')}")
    for key, value in sorted((expected.get("counts") or {}).items()):
        current_value = (current.get("counts") or {}).get(key, 0)
        if current_value != value:
            print(f"count\t{key}\t{current_value}\t->\t{value}")
    for key, value in sorted((expected.get("referenceStatusCounts") or {}).items()):
        current_value = (current.get("referenceStatusCounts") or {}).get(key, 0)
        if current_value != value:
            print(f"reference-status\t{key}\t{current_value}\t->\t{value}")
    for key, value in sorted((expected.get("assignmentStatusCounts") or {}).items()):
        current_value = (current.get("assignmentStatusCounts") or {}).get(key, 0)
        if current_value != value:
            print(f"assignment-status\t{key}\t{current_value}\t->\t{value}")


def read_json_model_payload(
    client: PapyrusGraphQLAuthoringClient,
    owner_kind: str,
    owner_id: str,
    role: str,
    sort_key: str | None = None,
) -> dict[str, Any] | None:
    attachment = client.get_record(
        "ModelAttachment",
        model_attachment_id(owner_kind, owner_id, role, sort_key or role),
    )
    if not attachment:
        return None
    buffer = download_attachment_buffer(client, attachment)
    if not buffer:
        return None
    try:
        parsed = json.loads(buffer.decode("utf-8"))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def update_newsroom_summary_after_analysis_import(
    client: PapyrusGraphQLAuthoringClient,
    changes: list[dict[str, Any]],
    *,
    actor_label: str = "Papyrus content CLI",
    reason: str = "analysis import",
) -> None:
    created_by_model: dict[str, list[dict[str, Any]]] = {}
    for change in changes:
        if change.get("action") != "create":
            continue
        created_by_model.setdefault(change["modelName"], []).append(change["expected"])
    created_import_runs = created_by_model.get("KnowledgeImportRun", [])
    created_category_sets = created_by_model.get("CategorySet", [])
    created_categories = created_by_model.get("Category", [])
    created_proposals = created_by_model.get("SteeringProposal", [])
    created_artifacts = created_by_model.get("KnowledgeArtifact", [])
    created_attachments = created_by_model.get("ModelAttachment", [])
    semantic_node_delta = _current_semantic_node_delta_from_changes(changes)
    semantic_relation_delta = _current_semantic_relation_delta_from_changes(changes)
    if not any(
        [
            created_import_runs,
            created_category_sets,
            created_categories,
            created_proposals,
            created_artifacts,
            created_attachments,
            semantic_node_delta["count"],
            semantic_relation_delta["count"],
        ]
    ):
        return
    client.update_newsroom_summary(
        {
            "source": "incremental",
            "latestImportRun": created_import_runs[0] if created_import_runs else None,
            "countDeltas": {
                "importRuns": len(created_import_runs),
                "categorySets": len(created_category_sets),
                "categories": len(created_categories),
                "proposals": len(created_proposals),
                "openProposals": sum(1 for proposal in created_proposals if proposal.get("status") == "proposed"),
                "artifacts": len(created_artifacts),
                "modelAttachments": len(created_attachments),
                "semanticNodes": semantic_node_delta["count"],
                "semanticRelations": semantic_relation_delta["count"],
            },
            "facetDeltas": {
                "imports": {"byCorpus": _count_delta(created_import_runs, "corpusId", "unknown")},
                "modelAttachments": _model_attachment_facet_delta(created_attachments),
                "semanticNodes": semantic_node_delta["facets"],
                "semanticRelations": semantic_relation_delta["facets"],
            },
        },
        actor_label=actor_label,
        reason=reason,
    )
    print(
        "newsroom\tsummary-snapshot\tincremental\tanalysis-import\t"
        f"runs={len(created_import_runs)}\tartifacts={len(created_artifacts)}\t"
        f"proposals={len(created_proposals)}\tnodes={semantic_node_delta['count']}\t"
        f"relations={semantic_relation_delta['count']}"
    )


def _normalize_newsroom_summary_payload(value: Any) -> dict[str, Any]:
    parsed = _parse_jsonish(value)
    now = _utc_now()
    facets = _normalize_newsroom_summary_facets(parsed.get("facets"), parsed)
    return {
        "generatedAt": _string_or_default(parsed.get("generatedAt"), now),
        "staleAt": _string_or_default(parsed.get("staleAt"), now),
        "source": _string_or_default(parsed.get("source"), "missing"),
        "latestImportRun": parsed.get("latestImportRun") if isinstance(parsed.get("latestImportRun"), dict) else None,
        "counts": _number_record(parsed.get("counts")),
        "facets": facets,
        "assignmentStatusCounts": dict(facets["assignments"]["byStatus"]),
        "assignmentTypeCounts": dict(facets["assignments"]["byType"]),
        "referenceStatusCounts": dict(facets["references"]["byCurationStatus"]),
        "messageKindCounts": dict(facets["messages"]["byKind"]),
        "messageDomainCounts": dict(facets["messages"]["byDomain"]),
    }


def _normalize_newsroom_summary_facets(value: Any, legacy: dict[str, Any] | None = None) -> dict[str, Any]:
    legacy = legacy or {}
    facets = _create_empty_newsroom_summary_facets()
    parsed = _parse_jsonish(value)
    _merge_facet_section(facets["assignments"], parsed.get("assignments"), ["statusByType", "statusBySection", "typeBySection"])
    _merge_facet_section(facets["messages"], parsed.get("messages"), ["domainByKind"])
    _merge_facet_section(facets["modelAttachments"], parsed.get("modelAttachments"))
    _merge_facet_section(facets["references"], parsed.get("references"), ["statusByCorpus"])
    _merge_facet_section(facets["semanticNodes"], parsed.get("semanticNodes"))
    _merge_facet_section(facets["semanticRelations"], parsed.get("semanticRelations"))
    _merge_facet_section(facets["imports"], parsed.get("imports"))
    facets["assignments"]["byStatus"].update(_number_record(legacy.get("assignmentStatusCounts")))
    facets["assignments"]["byType"].update(_number_record(legacy.get("assignmentTypeCounts")))
    facets["references"]["byCurationStatus"].update(_number_record(legacy.get("referenceStatusCounts")))
    facets["messages"]["byKind"].update(_number_record(legacy.get("messageKindCounts")))
    facets["messages"]["byDomain"].update(_number_record(legacy.get("messageDomainCounts")))
    return facets


def _create_empty_newsroom_summary_facets() -> dict[str, Any]:
    return {
        "assignments": {
            "byStatus": {},
            "byType": {},
            "bySection": {},
            "statusByType": {},
            "statusBySection": {},
            "typeBySection": {},
        },
        "messages": {"byKind": {}, "byDomain": {}, "byStatus": {}, "domainByKind": {}},
        "modelAttachments": {"byOwnerKind": {}, "byRole": {}, "byMediaType": {}, "byStatus": {}},
        "references": {"byCurationStatus": {}, "byCorpus": {}, "statusByCorpus": {}},
        "semanticNodes": {"byNodeKind": {}, "byStatus": {}, "byCorpus": {}, "byCategorySet": {}},
        "semanticRelations": {
            "byRelationTypeKey": {},
            "byRelationDomain": {},
            "bySubjectKind": {},
            "byObjectKind": {},
        },
        "imports": {"byCorpus": {}},
    }


def _select_current_versioned_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_lineage: dict[str, dict[str, Any]] = {}
    for record in records:
        if not _is_current_version_state(record.get("versionState")):
            continue
        lineage_id = _string_or_default(record.get("lineageId") or record.get("id"), "")
        if not lineage_id:
            continue
        current = by_lineage.get(lineage_id)
        if not current or int(record.get("versionNumber") or 0) > int(current.get("versionNumber") or 0):
            by_lineage[lineage_id] = record
    return list(by_lineage.values())


def _current_semantic_node_delta_from_changes(changes: list[dict[str, Any]]) -> dict[str, Any]:
    delta = {"count": 0, "facets": {"byNodeKind": {}, "byStatus": {}, "byCorpus": {}, "byCategorySet": {}}}
    for change in changes:
        if change.get("modelName") != "SemanticNode" or change.get("action") == "noop":
            continue
        _apply_semantic_node_contribution(delta, change.get("current"), -1)
        _apply_semantic_node_contribution(delta, change.get("expected"), 1)
    return delta


def _current_semantic_relation_delta_from_changes(changes: list[dict[str, Any]]) -> dict[str, Any]:
    delta = {
        "count": 0,
        "facets": {
            "byRelationTypeKey": {},
            "byRelationDomain": {},
            "bySubjectKind": {},
            "byObjectKind": {},
        },
    }
    for change in changes:
        if change.get("modelName") != "SemanticRelation" or change.get("action") == "noop":
            continue
        _apply_semantic_relation_contribution(delta, change.get("current"), -1)
        _apply_semantic_relation_contribution(delta, change.get("expected"), 1)
    return delta


def _apply_semantic_node_contribution(delta: dict[str, Any], node: dict[str, Any] | None, amount: int) -> None:
    if not node or node.get("versionState") != "current":
        return
    delta["count"] += amount
    _increment(delta["facets"]["byNodeKind"], _string_or_default(node.get("nodeKind"), "unknown"), amount)
    _increment(delta["facets"]["byStatus"], _string_or_default(node.get("status"), "unknown"), amount)
    _increment(delta["facets"]["byCorpus"], _string_or_default(node.get("corpusId"), "unknown"), amount)
    _increment(delta["facets"]["byCategorySet"], _string_or_default(node.get("categorySetId"), "unknown"), amount)


def _apply_semantic_relation_contribution(delta: dict[str, Any], relation: dict[str, Any] | None, amount: int) -> None:
    if not relation or relation.get("relationState") != "current":
        return
    delta["count"] += amount
    _increment(
        delta["facets"]["byRelationTypeKey"],
        _string_or_default(relation.get("relationTypeKey") or relation.get("predicate"), "unknown"),
        amount,
    )
    _increment(delta["facets"]["byRelationDomain"], _string_or_default(relation.get("relationDomain"), "unknown"), amount)
    _increment(delta["facets"]["bySubjectKind"], _string_or_default(relation.get("subjectKind"), "unknown"), amount)
    _increment(delta["facets"]["byObjectKind"], _string_or_default(relation.get("objectKind"), "unknown"), amount)


def _model_attachment_facet_delta(attachments: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    facets = {"byOwnerKind": {}, "byRole": {}, "byMediaType": {}, "byStatus": {}}
    for attachment in attachments:
        _increment(facets["byOwnerKind"], _string_or_default(attachment.get("ownerKind"), "unknown"), 1)
        _increment(facets["byRole"], _string_or_default(attachment.get("role"), "unknown"), 1)
        _increment(facets["byMediaType"], _string_or_default(attachment.get("mediaType"), "unknown"), 1)
        _increment(facets["byStatus"], _string_or_default(attachment.get("status"), "unknown"), 1)
    return facets


def _merge_facet_section(target: dict[str, Any], source: Any, nested_keys: list[str] | None = None) -> None:
    nested_keys = nested_keys or []
    parsed = _parse_jsonish(source)
    for key in target:
        if key in nested_keys:
            target[key] = _nested_number_record(parsed.get(key))
        else:
            target[key] = _number_record(parsed.get(key))


def _nested_number_record(value: Any) -> dict[str, dict[str, int]]:
    parsed = _parse_jsonish(value)
    result: dict[str, dict[str, int]] = {}
    if not isinstance(parsed, dict):
        return result
    for key, nested in parsed.items():
        record = _number_record(nested)
        if record:
            result[key] = record
    return result


def _number_record(value: Any) -> dict[str, int]:
    parsed = _parse_jsonish(value)
    if not isinstance(parsed, dict):
        return {}
    result: dict[str, int] = {}
    for key, entry in parsed.items():
        try:
            number = int(entry)
        except (TypeError, ValueError):
            continue
        if number == number:
            result[key] = number
    return result


def _parse_jsonish(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _string_or_default(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _assignment_section_key(assignment: dict[str, Any]) -> str:
    return _string_or_default(assignment.get("sectionKey"), _string_or_default(assignment.get("sectionId"), "unsectioned"))


def _is_current_version_state(value: Any) -> bool:
    return _string_or_default(value, "current") == "current"


def _is_current_relation_state(value: Any) -> bool:
    return _string_or_default(value, "current") == "current"


def _increment(target: dict[str, int], key: str, delta: int) -> None:
    value = (target.get(key) or 0) + delta
    next_value = max(0, value)
    if next_value == 0:
        target.pop(key, None)
    else:
        target[key] = next_value


def _increment_nested(target: dict[str, dict[str, int]], outer_key: str, inner_key: str, delta: int) -> None:
    if outer_key not in target:
        target[outer_key] = {}
    _increment(target[outer_key], inner_key, delta)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
