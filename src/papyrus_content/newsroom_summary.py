from __future__ import annotations

from collections import Counter
from typing import Any

from .graphql_authoring import PapyrusGraphQLAuthoringClient
from .reference_policy import normalize_reference_curation_status


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
        reason=f"references register-catalog {plan['importRunId']}",
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


def _count_delta(records: list[dict[str, Any]], field: str, fallback: str) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for record in records:
        counter[str(record.get(field) or fallback)] += 1
    return dict(counter)
