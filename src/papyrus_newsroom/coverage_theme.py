from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_SECTIONS = ["culture", "methods", "business", "law"]
DEFAULT_SECTION_BUDGETS = {
    "culture": 2,
    "arts": 2,
    "methods": 1,
    "business": 1,
    "law": 1,
    "law-policy": 1,
}
SECTION_ALIASES = {
    "culture": "arts",
    "law": "law-policy",
}
SECTION_RESEARCH_LENSES = {
    "culture": "creative workflows, game design, player experience, generative media",
    "arts": "creative workflows, game design, player experience, generative media",
    "methods": "implementation patterns, NPC behavior, procedural generation, evaluation",
    "business": "studios, tooling markets, labor, production economics",
    "law": "copyright, likeness, licensing, liability, platform policy",
    "law-policy": "copyright, likeness, licensing, liability, platform policy",
}
REPORTING_ANGLE_LENSES = [
    {"key": "accountability", "label": "accountability", "prompt": "who is responsible, who is affected, and what changed"},
    {"key": "reader-impact", "label": "reader impact", "prompt": "what a reader can use, decide, or watch next"},
    {"key": "coverage-gap", "label": "coverage gap", "prompt": "what remains underreported and which source trail can close it"},
    {"key": "evidence-check", "label": "evidence check", "prompt": "what is confirmed, contested, or still needs verification"},
]
THROUGH_PHASES = {"plan", "research", "reporting"}
STOPWORDS = {
    "about", "after", "against", "also", "among", "because", "before", "being", "between", "could", "from",
    "have", "into", "more", "over", "than", "that", "their", "there", "these", "this", "through", "with",
    "would", "using", "research", "study", "paper", "report", "analysis", "system", "systems",
}
RELATION_DOMAINS = {
    "classified_as": "classification",
    "uses_evidence": "evidence",
    "uses_signal": "evidence",
    "requests_work_on": "workflow",
    "planned_for_edition": "publication",
    "targets_lane": "editorial",
    "targets_section": "editorial",
    "targets_topic": "editorial",
    "scoped_to_topic": "ontology",
    "produces": "workflow",
    "derived_from": "evidence",
    "comment": "commentary",
}

REFERENCE_FIELDS = """
id lineageId versionNumber versionState corpusId externalItemId title authors sourceUri storagePath mediaType
sourcePublishedAt sourceUpdatedAt retrievedAt importRunId importedAt curationStatus curationStatusKey updatedAt
"""
CATEGORY_FIELDS = """
id lineageId versionNumber versionState categorySetId corpusId categoryKey parentCategoryId parentCategoryKey displayName
shortTitle subtitle description aliases status rank depth importRunId updatedAt
"""
CATEGORY_SET_FIELDS = """
id lineageId versionNumber versionState corpusId classifierId displayName description status generatedAt categoryCount importRunId
"""
NEWSROOM_SECTION_FIELDS = """
id title shortTitle type editorialMission editorialPolicy enabled enabledStatus sortOrder defaultArticleTypes defaultPageBudget
assignmentGuidance killCriteria visualGuidance createdAt updatedAt
"""
EDITION_FIELDS = """
id lineageId versionNumber previousVersionId versionState versionCreatedAt versionCreatedBy changeReason contentHash
slug title status editionDate publishedAt description layoutPlan metadata
"""
ASSIGNMENT_FIELDS = """
id assignmentTypeKey queueKey queueStatusKey status priority title summary assigneeType assigneeId assigneeKey claimedAt claimExpiresAt
completedAt canceledAt corpusId categorySetId classifierId sourceSnapshotId importRunId sectionId sectionKey sectionType sectionStatusKey
sectionQueueStatusKey primaryFocusCategoryKey topicScopeCategoryKeys createdBy createdAt updatedAt newsroomFeedKey
"""
ASSIGNMENT_EVENT_FIELDS = """
id assignmentId assignmentTypeKey queueKey eventType fromStatus toStatus actorSub actorLabel note createdAt
"""
MESSAGE_FIELDS = """
id messageKind messageDomain status summary source importRunId authorLabel newsroomFeedKey createdAt updatedAt
"""
SEMANTIC_NODE_FIELDS = """
id lineageId versionNumber previousVersionId versionState versionCreatedAt versionCreatedBy changeReason contentHash
nodeKey nodeKind corpusId categorySetId categoryLineageId categoryKey displayName description aliases status importRunId createdAt updatedAt
newsroomFeedKey
"""
SEMANTIC_RELATION_FIELDS = """
id relationState predicate relationTypeId relationTypeKey relationDomain subjectKind subjectId subjectLineageId subjectVersionNumber
objectKind objectId objectLineageId objectVersionNumber subjectStateKey objectStateKey objectSubjectStateKey predicateObjectStateKey
subjectVersionKey objectVersionKey score confidence rank classifierId modelVersion reviewRecommended sourceSnapshotId importRunId importedAt
createdAt updatedAt newsroomFeedKey metadata
"""
MODEL_ATTACHMENT_FIELDS = """
id ownerKind ownerId ownerLineageId ownerVersionNumber ownerVersionKey role sortKey storagePath filename mediaType byteSize sha256 etag
importRunId createdAt updatedAt status
"""
ITEM_FIELDS = """
id lineageId versionNumber versionState type status typeStatus slug shortSlug section sectionStatus title headline deck byline dateline
publishedAt editionDate sortTitle body editorial updatedAt
"""
EDITION_ITEM_FIELDS = """
id editionId itemId publishedEditionId publishedItemId sourceEditionId sourceItemId editionLineageId itemLineageId placementKey sortKey
pageNumber priority metadata
"""

LIST_FIELDS = {
    "Reference": ("listReferences", REFERENCE_FIELDS),
    "Category": ("listCategories", CATEGORY_FIELDS),
    "CategorySet": ("listCategorySets", CATEGORY_SET_FIELDS),
    "NewsroomSection": ("listNewsroomSections", NEWSROOM_SECTION_FIELDS),
    "Edition": ("listEditions", EDITION_FIELDS),
    "Assignment": ("listAssignments", ASSIGNMENT_FIELDS),
    "AssignmentEvent": ("listAssignmentEvents", ASSIGNMENT_EVENT_FIELDS),
    "Message": ("listMessages", MESSAGE_FIELDS),
    "SemanticNode": ("listSemanticNodes", SEMANTIC_NODE_FIELDS),
    "SemanticRelation": ("listSemanticRelations", SEMANTIC_RELATION_FIELDS),
    "ModelAttachment": ("listModelAttachments", MODEL_ATTACHMENT_FIELDS),
    "Item": ("listItems", ITEM_FIELDS),
    "EditionItem": ("listEditionItems", EDITION_ITEM_FIELDS),
}
GET_FIELDS = {
    model: (f"get{model}", fields)
    for model, (_, fields) in LIST_FIELDS.items()
}

CREATE_MODEL_ATTACHMENT_UPLOAD_MUTATION = """
mutation CreateModelAttachmentUpload(
  $ownerKind: String!
  $ownerId: ID!
  $ownerLineageId: ID
  $ownerVersionNumber: Int
  $ownerVersionKey: String
  $role: String!
  $sortKey: String
  $filename: String!
  $mediaType: String!
  $byteSize: Int!
  $sha256: String
  $importRunId: ID
  $status: String
) {
  createModelAttachmentUpload(
    ownerKind: $ownerKind
    ownerId: $ownerId
    ownerLineageId: $ownerLineageId
    ownerVersionNumber: $ownerVersionNumber
    ownerVersionKey: $ownerVersionKey
    role: $role
    sortKey: $sortKey
    filename: $filename
    mediaType: $mediaType
    byteSize: $byteSize
    sha256: $sha256
    importRunId: $importRunId
    status: $status
  ) { ok uploadId attachmentId method uploadUrl storagePath requiredHeaders }
}
"""
COMPLETE_MODEL_ATTACHMENT_UPLOAD_MUTATION = """
mutation CompleteModelAttachmentUpload(
  $uploadId: String!
  $ownerKind: String!
  $ownerId: ID!
  $ownerLineageId: ID
  $ownerVersionNumber: Int
  $ownerVersionKey: String
  $role: String!
  $sortKey: String
  $filename: String!
  $mediaType: String!
  $byteSize: Int!
  $sha256: String
  $importRunId: ID
  $status: String
) {
  completeModelAttachmentUpload(
    uploadId: $uploadId
    ownerKind: $ownerKind
    ownerId: $ownerId
    ownerLineageId: $ownerLineageId
    ownerVersionNumber: $ownerVersionNumber
    ownerVersionKey: $ownerVersionKey
    role: $role
    sortKey: $sortKey
    filename: $filename
    mediaType: $mediaType
    byteSize: $byteSize
    sha256: $sha256
    importRunId: $importRunId
    status: $status
  ) { id }
}
"""
CREATE_MODEL_ATTACHMENT_DOWNLOAD_MUTATION = """
mutation CreateModelAttachmentDownload($attachmentId: ID!) {
  createModelAttachmentDownload(attachmentId: $attachmentId) {
    ok attachmentId method downloadUrl storagePath mediaType byteSize sha256 expiresAt requiredHeaders
  }
}
"""


def signals_trend_report(
    *,
    corpus_key: str,
    date: str = "",
    category_key: str = "",
    topic: str = "",
    coverage_key: str = "",
    sections: list[str] | None = None,
    since_days: int = 30,
    limit: int = 10,
    run_id: str = "",
    references: list[dict[str, Any]] | None = None,
    semantic_nodes: list[dict[str, Any]] | None = None,
    apply: bool = False,
    now: str = "",
) -> dict[str, Any]:
    now = now or _now_iso()
    sections = _resolve_section_keys(sections or [])
    if references is None:
        state = load_live_state(models=["Reference", "SemanticNode"])
        references = state.get("references", [])
        semantic_nodes = state.get("semanticNodes", [])
    semantic_nodes = semantic_nodes or []
    run_id = run_id or f"signal-report-{_safe_id(topic or category_key or corpus_key)}-{_timestamp_for_path(now)}"
    signals = build_trend_signals(
        references=references,
        semantic_nodes=semantic_nodes,
        corpus_key=corpus_key,
        category_key=category_key,
        topic=topic,
        coverage_key=coverage_key,
        sections=sections,
        since_days=since_days,
        limit=limit,
        now=now,
    )
    report = {
        "ok": True,
        "command": "signals trend-report",
        "runId": run_id,
        "date": date or _date_from_iso(now),
        "corpusKey": corpus_key,
        "categoryKey": category_key,
        "topic": topic,
        "coverageKey": coverage_key,
        "sections": sections,
        "sinceDays": since_days,
        "generatedAt": now,
        "signals": signals,
        "summary": {
            "signalCount": len(signals),
            "acceptedReferenceCount": len(_accepted_references(references, corpus_key)),
            "createsItemOrEditionItem": False,
        },
    }
    records = build_signal_report_records(report)
    output = {
        **report,
        "records": records,
        "apply": False,
    }
    if apply:
        output = {**output, **apply_records(records)}
    return output


def build_trend_signals(
    *,
    references: list[dict[str, Any]],
    semantic_nodes: list[dict[str, Any]],
    corpus_key: str,
    category_key: str = "",
    topic: str = "",
    coverage_key: str = "",
    sections: list[str] | None = None,
    since_days: int = 30,
    limit: int = 10,
    now: str = "",
) -> list[dict[str, Any]]:
    now_dt = _parse_datetime(now) or dt.datetime.now(dt.UTC)
    accepted = _accepted_references(references, corpus_key)
    if since_days > 0:
        cutoff = now_dt - dt.timedelta(days=since_days)
        accepted = [ref for ref in accepted if (_reference_datetime(ref) or now_dt) >= cutoff]
    sections = sections or []
    topics: dict[str, dict[str, Any]] = {}
    if topic:
        key = _safe_id(topic)
        topics[key] = {
            "label": topic,
            "terms": _terms(topic),
            "references": [],
            "semanticNodes": _matching_nodes(semantic_nodes, topic, coverage_key),
        }
    else:
        term_counts: dict[str, int] = {}
        for ref in accepted:
            for term in _terms(" ".join([str(ref.get("title") or ""), str(ref.get("sourceUri") or "")])):
                term_counts[term] = term_counts.get(term, 0) + 1
        for term, _count in sorted(term_counts.items(), key=lambda item: (-item[1], item[0]))[: max(limit * 2, 1)]:
            topics[term] = {"label": term.replace("-", " ").title(), "terms": [term], "references": [], "semanticNodes": []}
    if not topics and category_key:
        key = _safe_id(category_key)
        topics[key] = {"label": category_key, "terms": _terms(category_key), "references": [], "semanticNodes": []}
    for ref in accepted:
        haystack = " ".join([str(ref.get("title") or ""), str(ref.get("sourceUri") or "")]).lower()
        for candidate in topics.values():
            terms = candidate["terms"] or _terms(candidate["label"])
            if not terms or any(term in haystack for term in terms):
                candidate["references"].append(ref)
    signals: list[dict[str, Any]] = []
    for index, (key, candidate) in enumerate(topics.items(), start=1):
        refs = _dedupe_by_id(candidate["references"])
        if not refs and topic:
            refs = accepted[: min(5, len(accepted))]
        domains = sorted({_domain(ref.get("sourceUri")) for ref in refs if _domain(ref.get("sourceUri"))})
        recency_values = [_recency_score(_reference_datetime(ref), now_dt, since_days) for ref in refs]
        freshness = round(sum(recency_values) / len(recency_values), 3) if recency_values else 0.0
        velocity = len(refs)
        diversity = round(min(1.0, len(domains) / max(len(refs), 1)), 3) if refs else 0.0
        section_fit = _section_fit_scores(candidate["label"], refs, sections)
        average_section_fit = round(sum(section_fit.values()) / len(section_fit), 3) if section_fit else 0.0
        evidence_quality = 1.0 if refs else 0.0
        coverage_gap_value = round(1.0 / (1 + max(len(refs) - 1, 0)), 3) if refs else 1.0
        score = round((velocity * 2.0) + freshness + diversity + average_section_fit + evidence_quality + coverage_gap_value, 3)
        signal_coverage_key = coverage_key if topic and coverage_key else f"coverage.{key.replace('-', '.')}"
        proposed_sections = [section for section, fit in sorted(section_fit.items(), key=lambda item: (-item[1], item[0])) if fit > 0]
        if not proposed_sections:
            proposed_sections = sections[:]
        signals.append({
            "signalId": f"signal-{_hash_short([corpus_key, category_key, signal_coverage_key, candidate['label']])}",
            "rank": index,
            "topic": candidate["label"],
            "coverageKey": signal_coverage_key,
            "categoryKey": category_key,
            "score": score,
            "scoreBreakdown": {
                "velocity": velocity,
                "freshness": freshness,
                "sourceDiversity": diversity,
                "sectionFit": average_section_fit,
                "evidenceQuality": evidence_quality,
                "coverageGapValue": coverage_gap_value,
            },
            "whyNow": _why_now(candidate["label"], refs, domains, since_days),
            "sourceReferenceIds": [ref["id"] for ref in refs if ref.get("id")],
            "acceptedEvidenceCount": len(refs),
            "sourceDomains": domains,
            "sectionFit": section_fit,
            "proposedSections": proposed_sections,
            "coverageGaps": _coverage_gaps(candidate["label"], refs),
            "openQuestions": _open_questions(candidate["label"], sections),
            "suggestedAngles": _suggested_angles(candidate["label"], sections),
        })
    return sorted(signals, key=lambda item: (-float(item["score"]), item["topic"]))[:limit]


def build_signal_report_records(report: dict[str, Any]) -> list[dict[str, Any]]:
    now = str(report.get("generatedAt") or _now_iso())
    run_id = str(report["runId"])
    message_id = f"message-edition-signal-report-{_safe_id(run_id)}"
    summary = f"Edition signal report: {len(report.get('signals') or [])} ranked knowledge-base signal(s)."
    message = {
        "id": message_id,
        "messageKind": "edition_signal_report",
        "messageDomain": "edition_planning",
        "status": "active",
        "summary": summary,
        "source": "papyrus knowledge signals trend-report",
        "importRunId": run_id,
        "authorLabel": "papyrus",
        "newsroomFeedKey": "message#edition_signal_report",
        "createdAt": now,
        "updatedAt": now,
    }
    body = _signal_report_body(report)
    records = [
        _record("Message", message),
        _attachment_record(message_id, "message_body", "message", "message.txt", "text/plain", body, run_id, now),
        _attachment_record(message_id, "metadata", "metadata", "metadata.json", "application/json", {"kind": "edition.signal_report", **report}, run_id, now),
    ]
    for signal in report.get("signals") or []:
        node = coverage_node_record(
            coverage_key=signal["coverageKey"],
            topic=signal["topic"],
            corpus_key=str(report.get("corpusKey") or ""),
            category=None,
            category_set=None,
            now=now,
            change_reason="edition-signal-report",
        )
        records.append(_record("SemanticNode", node))
        records.append(_record("SemanticRelation", semantic_relation(
            predicate="uses_signal",
            subject_kind="message",
            subject_id=message_id,
            object_kind="semanticNode",
            object_id=node["id"],
            object_lineage_id=node["lineageId"],
            object_version_number=node["versionNumber"],
            rank=signal.get("rank"),
            import_run_id=run_id,
            now=now,
            metadata={"signalId": signal["signalId"], "coverageKey": signal["coverageKey"], "topic": signal["topic"]},
        )))
        for rank, reference_id in enumerate(signal.get("sourceReferenceIds") or [], start=1):
            records.append(_record("SemanticRelation", semantic_relation(
                predicate="uses_evidence",
                subject_kind="message",
                subject_id=message_id,
                object_kind="reference",
                object_id=reference_id,
                object_lineage_id=reference_id,
                rank=rank,
                import_run_id=run_id,
                now=now,
                metadata={"signalId": signal["signalId"], "coverageKey": signal["coverageKey"]},
            )))
    return _dedupe_records(records)


def editions_plan(
    *,
    date: str,
    sections: list[str],
    section_budgets: dict[str, int],
    corpus_key: str,
    category_key: str = "",
    topic: str = "",
    coverage_key: str = "",
    signal_report: dict[str, Any] | None = None,
    theme_limit: int = 3,
    run_id: str = "",
    apply: bool = False,
    now: str = "",
) -> dict[str, Any]:
    now = now or _now_iso()
    if signal_report is None:
        signal_report = signals_trend_report(
            corpus_key=corpus_key,
            date=date,
            category_key=category_key,
            topic=topic,
            coverage_key=coverage_key,
            sections=sections,
            limit=max(theme_limit, 1),
            now=now,
        )
    signals = list(signal_report.get("signals") or [])[: max(theme_limit, 1)]
    if not signals:
        signals = [{
            "topic": topic or category_key or corpus_key,
            "coverageKey": coverage_key or f"coverage.{_safe_id(topic or category_key or corpus_key).replace('-', '.')}",
            "categoryKey": category_key,
            "signalId": f"signal-{_hash_short([corpus_key, topic, coverage_key])}",
            "rank": 1,
            "sourceReferenceIds": [],
            "coverageGaps": [],
            "openQuestions": [],
            "suggestedAngles": [],
        }]
    state = load_live_state(models=["NewsroomSection", "Category", "CategorySet"]) if apply else {}
    records: list[dict[str, Any]] = []
    plans = []
    for index, signal in enumerate(signals, start=1):
        theme_run_id = run_id or f"coverage-theme-{_safe_id(date)}-{_safe_id(signal['coverageKey'])}"
        if len(signals) > 1:
            theme_run_id = f"{theme_run_id}-{index:02d}"
        plan = build_coverage_theme_plan(
            date=date,
            topic=str(signal.get("topic") or topic or ""),
            corpus_key=corpus_key,
            category_key=str(signal.get("categoryKey") or category_key or ""),
            coverage_key=str(signal.get("coverageKey") or coverage_key or ""),
            sections=sections,
            section_budgets=section_budgets,
            run_id=theme_run_id,
            now=now,
            state=state,
            signal=signal,
        )
        plans.append(_without_records(plan))
        records.extend(plan["records"])
    output = {
        "ok": True,
        "command": "editions plan",
        "date": date,
        "runId": run_id or f"edition-plan-{_safe_id(date)}",
        "signalReportRunId": signal_report.get("runId"),
        "coverageThemes": plans,
        "records": _dedupe_records(records),
        "summary": {
            "coverageThemeCount": len(plans),
            "assignmentCount": sum(1 for record in _dedupe_records(records) if record["modelName"] == "Assignment"),
            "createsMessage": False,
            "createsItemOrEditionItem": False,
        },
        "apply": False,
    }
    if apply:
        output = {**output, **apply_records(output["records"])}
    return output


def coverage_theme_run(
    *,
    date: str,
    topic: str,
    corpus_key: str,
    category_key: str,
    coverage_key: str,
    sections: list[str],
    section_budgets: dict[str, int],
    run_id: str = "",
    through: str = "reporting",
    research_mode: str = "source_discovery",
    allow_fallback: bool = False,
    require_agent_success: bool = False,
    refresh_packets: bool = False,
    apply: bool = False,
    now: str = "",
) -> dict[str, Any]:
    now = now or _now_iso()
    through = normalize_through(through)
    state_models = ["NewsroomSection", "Category", "CategorySet"]
    state = load_live_state(models=state_models) if apply else {}
    plan = build_coverage_theme_plan(
        date=date,
        topic=topic,
        corpus_key=corpus_key,
        category_key=category_key,
        coverage_key=coverage_key,
        sections=sections,
        section_budgets=section_budgets,
        run_id=run_id,
        research_mode=research_mode,
        now=now,
        state=state,
    )
    records = list(plan["records"])
    packet_runs: dict[str, list[dict[str, Any]]] = {"research": [], "reporting": []}
    degraded = False
    cloud_client = None
    if through in {"research", "reporting"}:
        try:
            cloud_client = _create_cloud_procedure_client()
        except Exception as error:
            if not allow_fallback:
                return _coverage_theme_cloud_error(
                    plan,
                    through,
                    apply,
                    {
                        "code": "cloud_procedure_failed",
                        "message": str(error),
                        "alias": "story-cycle.research",
                        "remediation": "Run poetry run papyrus procedures seed-required to preload standard procedures if the required cloud procedure is missing or stale.",
                    },
                )
    if through in {"research", "reporting"}:
        for assignment in plan["researchAssignments"]:
            packet_plan = run_or_fallback_research_packet_records(
                client=cloud_client,
                run_id=plan["runId"],
                assignment=assignment,
                topic=topic,
                corpus_key=corpus_key,
                coverage_key=coverage_key,
                research_mode=research_mode,
                now=now,
                allow_fallback=allow_fallback,
                refresh_packets=refresh_packets,
            )
            if packet_plan.get("ok") is False:
                return _coverage_theme_cloud_error(plan, through, apply, packet_plan["error"])
            degraded = degraded or bool(packet_plan["degraded"])
            packet_runs["research"].append(packet_plan["run"])
            records.extend(packet_plan["records"])
    if through == "reporting":
        research_by_section = {assignment["sectionKey"]: assignment for assignment in plan["researchAssignments"]}
        research_messages = {run["sectionKey"]: run.get("messageId") for run in packet_runs["research"]}
        for assignment in plan["reportingAssignments"]:
            packet_plan = run_or_fallback_reporting_packet_records(
                client=cloud_client,
                run_id=plan["runId"],
                assignment=assignment,
                topic=topic,
                corpus_key=corpus_key,
                coverage_key=coverage_key,
                source_research_assignment=research_by_section.get(assignment["sectionKey"]),
                source_research_packet_id=research_messages.get(assignment["sectionKey"]),
                now=now,
                allow_fallback=allow_fallback,
                refresh_packets=refresh_packets,
            )
            if packet_plan.get("ok") is False:
                return _coverage_theme_cloud_error(plan, through, apply, packet_plan["error"])
            degraded = degraded or bool(packet_plan["degraded"])
            packet_runs["reporting"].append(packet_plan["run"])
            records.extend(packet_plan["records"])
    if degraded and (require_agent_success or (apply and not allow_fallback)):
        return {
            **_without_records(plan),
            "ok": False,
            "command": "coverage-themes run",
            "through": through,
            "apply": False,
            "degraded": True,
            "error": {
                "code": "agent_success_required",
                "message": "coverage-themes run generated deterministic fallback packets; pass --allow-fallback to persist degraded output.",
            },
        }
    output = {
        **_without_records(plan),
        "ok": True,
        "command": "coverage-themes run",
        "through": through,
        "researchRuns": packet_runs["research"],
        "reportingRuns": packet_runs["reporting"],
        "records": _dedupe_records(records),
        "summary": {
            **plan["summary"],
            "researchPacketCount": len(packet_runs["research"]),
            "reportingPacketCount": len(packet_runs["reporting"]),
            "degraded": degraded,
            "createsItemOrEditionItem": False,
        },
        "apply": False,
        "degraded": degraded,
    }
    if apply:
        output = {**output, **apply_records(output["records"])}
    return output


def _coverage_theme_cloud_error(plan: dict[str, Any], through: str, apply: bool, error: dict[str, Any]) -> dict[str, Any]:
    return {
        **_without_records(plan),
        "ok": False,
        "command": "coverage-themes run",
        "through": through,
        "apply": False,
        "degraded": False,
        "error": error,
        "summary": {
            **(plan.get("summary") or {}),
            "researchPacketCount": 0,
            "reportingPacketCount": 0,
            "degraded": False,
            "createsItemOrEditionItem": False,
            "requestedApply": apply,
        },
    }


def _create_cloud_procedure_client() -> Any:
    from papyrus_content.graphql_authoring import create_authoring_client

    client, _ = create_authoring_client()
    return client


def _start_cloud_procedure_run(**kwargs: Any) -> dict[str, Any]:
    from papyrus_content.cloud_procedures import start_cloud_procedure_run

    return start_cloud_procedure_run(**kwargs)


def run_or_fallback_research_packet_records(
    *,
    client: Any,
    run_id: str,
    assignment: dict[str, Any],
    topic: str,
    corpus_key: str,
    coverage_key: str,
    research_mode: str,
    now: str,
    allow_fallback: bool,
    refresh_packets: bool,
) -> dict[str, Any]:
    if client is None:
        if not allow_fallback:
            return {
                "ok": False,
                "error": _cloud_procedure_error_payload(
                    "story-cycle.research",
                    assignment,
                    ValueError("Cloud procedure client is unavailable."),
                ),
            }
        return build_research_packet_records(
            assignment=assignment,
            topic=topic,
            corpus_key=corpus_key,
            coverage_key=coverage_key,
            research_mode=research_mode,
            now=now,
            degraded=True,
            refresh_packets=refresh_packets,
        )
    try:
        return build_cloud_research_packet_records(
            client=client,
            run_id=run_id,
            assignment=assignment,
            topic=topic,
            corpus_key=corpus_key,
            coverage_key=coverage_key,
            research_mode=research_mode,
            now=now,
            refresh_packets=refresh_packets,
        )
    except Exception as error:
        if not allow_fallback:
            return {"ok": False, "error": _cloud_procedure_error_payload("story-cycle.research", assignment, error)}
        return build_research_packet_records(
            assignment=assignment,
            topic=topic,
            corpus_key=corpus_key,
            coverage_key=coverage_key,
            research_mode=research_mode,
            now=now,
            degraded=True,
            refresh_packets=refresh_packets,
        )


def run_or_fallback_reporting_packet_records(
    *,
    client: Any,
    run_id: str,
    assignment: dict[str, Any],
    topic: str,
    corpus_key: str,
    coverage_key: str,
    source_research_assignment: dict[str, Any] | None,
    source_research_packet_id: str | None,
    now: str,
    allow_fallback: bool,
    refresh_packets: bool,
) -> dict[str, Any]:
    if client is None:
        if not allow_fallback:
            return {
                "ok": False,
                "error": _cloud_procedure_error_payload(
                    "story-cycle.reporting",
                    assignment,
                    ValueError("Cloud procedure client is unavailable."),
                ),
            }
        return build_reporting_packet_records(
            assignment=assignment,
            topic=topic,
            corpus_key=corpus_key,
            coverage_key=coverage_key,
            source_research_assignment=source_research_assignment,
            source_research_packet_id=source_research_packet_id,
            now=now,
            degraded=True,
            refresh_packets=refresh_packets,
        )
    try:
        return build_cloud_reporting_packet_records(
            client=client,
            run_id=run_id,
            assignment=assignment,
            topic=topic,
            corpus_key=corpus_key,
            coverage_key=coverage_key,
            source_research_assignment=source_research_assignment,
            source_research_packet_id=source_research_packet_id,
            now=now,
            refresh_packets=refresh_packets,
        )
    except Exception as error:
        if not allow_fallback:
            return {"ok": False, "error": _cloud_procedure_error_payload("story-cycle.reporting", assignment, error)}
        return build_reporting_packet_records(
            assignment=assignment,
            topic=topic,
            corpus_key=corpus_key,
            coverage_key=coverage_key,
            source_research_assignment=source_research_assignment,
            source_research_packet_id=source_research_packet_id,
            now=now,
            degraded=True,
            refresh_packets=refresh_packets,
        )


def build_cloud_research_packet_records(
    *,
    client: Any,
    run_id: str,
    assignment: dict[str, Any],
    topic: str,
    corpus_key: str,
    coverage_key: str,
    research_mode: str,
    now: str,
    refresh_packets: bool,
) -> dict[str, Any]:
    metadata = _metadata(assignment)
    run_dir = Path(".papyrus-runs") / run_id / _safe_id(assignment["id"])
    cloud_run = _start_cloud_procedure_run(
        client=client,
        alias="story-cycle.research",
        actor_label="papyrus coverage-themes run",
        title=f"Run story-cycle research for {metadata.get('sectionTitle') or assignment.get('sectionKey')}",
        summary=f"Coverage Theme research for {topic}.",
        input_payload={
            "assignment_item_id": assignment["id"],
            "assignment_json": assignment,
            "corpus_key": corpus_key,
            "context_profile": "researcher",
            "research_mode": research_mode,
            "research_questions": metadata.get("researchLens") or "",
            "max_evidence_items": 20,
        },
        run_dir=run_dir,
        source_path=run_dir / "research.cloud.tac",
        stdout_path=run_dir / "research.stdout.log",
        stderr_path=run_dir / "research.stderr.log",
    )
    output = cloud_run.get("output") if isinstance(cloud_run.get("output"), dict) else {}
    packet = output.get("research_packet") or output.get("researchPacket")
    if not isinstance(packet, dict):
        raise ValueError(
            f"Cloud procedure output for {assignment['id']} is missing research_packet. "
            "Run poetry run papyrus procedures seed-required if procedure seeds are stale."
        )
    normalized_packet = normalize_story_cycle_research_packet(
        packet,
        assignment=assignment,
        topic=topic,
        corpus_key=corpus_key,
        coverage_key=coverage_key,
        research_mode=research_mode,
    )
    return build_research_packet_records_from_packet(
        assignment=assignment,
        packet=normalized_packet,
        cloud_run=cloud_run,
        now=now,
        refresh_packets=refresh_packets,
    )


def build_cloud_reporting_packet_records(
    *,
    client: Any,
    run_id: str,
    assignment: dict[str, Any],
    topic: str,
    corpus_key: str,
    coverage_key: str,
    source_research_assignment: dict[str, Any] | None,
    source_research_packet_id: str | None,
    now: str,
    refresh_packets: bool,
) -> dict[str, Any]:
    metadata = _metadata(assignment)
    run_dir = Path(".papyrus-runs") / run_id / _safe_id(assignment["id"])
    cloud_run = _start_cloud_procedure_run(
        client=client,
        alias="story-cycle.reporting",
        actor_label="papyrus coverage-themes run",
        title=f"Run story-cycle reporting for {metadata.get('sectionTitle') or assignment.get('sectionKey')}",
        summary=f"Coverage Theme reporting context for {topic}.",
        input_payload={
            "assignment_item_id": assignment["id"],
            "assignment_json": assignment,
            "corpus_key": corpus_key,
            "context_profile": "reporting",
            "source_research_assignment_id": (source_research_assignment or {}).get("id"),
            "source_research_packet_id": source_research_packet_id,
        },
        run_dir=run_dir,
        source_path=run_dir / "reporting.cloud.tac",
        stdout_path=run_dir / "reporting.stdout.log",
        stderr_path=run_dir / "reporting.stderr.log",
    )
    output = cloud_run.get("output") if isinstance(cloud_run.get("output"), dict) else {}
    packet = output.get("reporting_context_packet") or output.get("reportingContextPacket")
    if not isinstance(packet, dict):
        raise ValueError(
            f"Cloud procedure output for {assignment['id']} is missing reporting_context_packet. "
            "Run poetry run papyrus procedures seed-required if procedure seeds are stale."
        )
    normalized_packet = normalize_story_cycle_reporting_packet(
        packet,
        assignment=assignment,
        topic=topic,
        coverage_key=coverage_key,
        source_research_assignment=source_research_assignment,
        source_research_packet_id=source_research_packet_id,
    )
    return build_reporting_packet_records_from_packet(
        assignment=assignment,
        packet=normalized_packet,
        cloud_run=cloud_run,
        source_research_packet_id=source_research_packet_id,
        now=now,
        refresh_packets=refresh_packets,
    )


def _cloud_procedure_error_payload(alias: str, assignment: dict[str, Any], error: Exception) -> dict[str, Any]:
    return {
        "code": "cloud_procedure_failed",
        "message": str(error),
        "alias": alias,
        "assignmentId": assignment.get("id"),
        "remediation": "Run poetry run papyrus procedures seed-required to preload standard procedures if the required cloud procedure is missing or stale.",
    }


def build_coverage_theme_plan(
    *,
    date: str,
    topic: str,
    corpus_key: str,
    category_key: str,
    coverage_key: str,
    sections: list[str],
    section_budgets: dict[str, int],
    run_id: str = "",
    research_mode: str = "source_discovery",
    now: str = "",
    state: dict[str, list[dict[str, Any]]] | None = None,
    signal: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = now or _now_iso()
    state = state or {}
    run_id = run_id or f"coverage-theme-{_safe_id(topic)}-{_timestamp_for_path(now)}"
    coverage_key = coverage_key or f"coverage.{_safe_id(topic).replace('-', '.')}"
    resolved_sections = resolve_sections(sections or DEFAULT_SECTIONS, state.get("newsroomSections") or [])
    category = find_category(category_key, state.get("categories") or [])
    category_set = find_category_set(category, state.get("categorySets") or [])
    edition = edition_record(date=date, section_budgets=section_budgets, run_id=run_id, now=now)
    coverage_node = coverage_node_record(
        coverage_key=coverage_key,
        topic=topic,
        corpus_key=corpus_key,
        category=category,
        category_set=category_set,
        now=now,
    )
    reporting_lane = lane_node_record("editorial.form.reporting", "Reporting", "reported story", now)
    records = [
        _record("Edition", edition),
        _record("SemanticNode", coverage_node),
        _record("SemanticNode", reporting_lane),
    ]
    if category:
        records.append(_record("SemanticRelation", semantic_relation(
            predicate="scoped_to_topic",
            subject_kind="semanticNode",
            subject_id=coverage_node["id"],
            subject_lineage_id=coverage_node["lineageId"],
            subject_version_number=coverage_node["versionNumber"],
            object_kind="category",
            object_id=category["id"],
            object_lineage_id=category.get("lineageId") or category["id"],
            object_version_number=category.get("versionNumber"),
            classifier_id=category_set.get("classifierId") if category_set else None,
            now=now,
            metadata={"runId": run_id, "coverageKey": coverage_key, "categoryKey": category.get("categoryKey")},
        )))
    research_assignments = []
    reporting_assignments = []
    for section_index, section in enumerate(resolved_sections, start=1):
        research_assignment = research_assignment_record(
            run_id=run_id,
            date=date,
            topic=topic,
            corpus_key=corpus_key,
            category_key=category_key,
            category=category,
            category_set=category_set,
            coverage_node=coverage_node,
            edition=edition,
            section=section,
            research_mode=research_mode,
            signal=signal,
            now=now,
            priority=section_index * 100,
        )
        research_assignments.append(research_assignment)
        records.extend(assignment_records(research_assignment, edition, coverage_node, section, category, category_set, now, signal=signal))
        slots = max(1, int(section_budgets.get(section["id"], DEFAULT_SECTION_BUDGETS.get(section["id"], 1))))
        dispatch_count = math.ceil(slots * 1.5)
        for rank in range(1, dispatch_count + 1):
            angle = REPORTING_ANGLE_LENSES[(rank - 1) % len(REPORTING_ANGLE_LENSES)]
            reporting_assignment = reporting_assignment_record(
                run_id=run_id,
                date=date,
                topic=topic,
                corpus_key=corpus_key,
                category_key=category_key,
                category=category,
                category_set=category_set,
                coverage_node=coverage_node,
                edition=edition,
                section=section,
                slots=slots,
                dispatch_count=dispatch_count,
                angle=angle,
                candidate_rank=rank,
                source_research_assignment=research_assignment,
                signal=signal,
                now=now,
                priority=section_index * 100 + rank,
            )
            reporting_assignments.append(reporting_assignment)
            records.extend(assignment_records(reporting_assignment, edition, coverage_node, section, category, category_set, now, signal=signal))
            records.append(_record("SemanticRelation", semantic_relation(
                predicate="targets_lane",
                subject_kind="assignment",
                subject_id=reporting_assignment["id"],
                object_kind="semanticNode",
                object_id=reporting_lane["id"],
                object_lineage_id=reporting_lane["lineageId"],
                object_version_number=reporting_lane["versionNumber"],
                rank=1,
                classifier_id=category_set.get("classifierId") if category_set else None,
                import_run_id=reporting_assignment.get("importRunId"),
                now=now,
                metadata={
                    "runId": run_id,
                    "laneKey": "reporting",
                    "laneNodeKey": reporting_lane["nodeKey"],
                    "slotTarget": _metadata(reporting_assignment).get("slotTarget"),
                    "angleDiversity": _metadata(reporting_assignment).get("angleDiversity"),
                },
            )))
            records.append(_record("SemanticRelation", semantic_relation(
                predicate="derived_from",
                subject_kind="assignment",
                subject_id=reporting_assignment["id"],
                object_kind="assignment",
                object_id=research_assignment["id"],
                object_lineage_id=research_assignment["id"],
                rank=1,
                classifier_id=category_set.get("classifierId") if category_set else None,
                import_run_id=reporting_assignment.get("importRunId"),
                now=now,
                metadata={"runId": run_id, "sourceKind": "section_research_assignment", "coverageKey": coverage_key},
            )))
    return {
        "ok": True,
        "command": "coverage-themes plan",
        "workflowName": "Coverage Theme",
        "runId": run_id,
        "date": date,
        "topic": topic,
        "corpusKey": corpus_key,
        "categoryKey": category_key,
        "coverageKey": coverage_key,
        "edition": edition,
        "coverageNode": coverage_node,
        "sections": [
            {"key": section["id"], "title": section["title"], "researchLens": section_research_lens(section["id"]), "slots": section_budgets.get(section["id"], DEFAULT_SECTION_BUDGETS.get(section["id"], 1))}
            for section in resolved_sections
        ],
        "researchAssignments": research_assignments,
        "reportingAssignments": reporting_assignments,
        "records": _dedupe_records(records),
        "summary": {
            "sectionCount": len(resolved_sections),
            "researchAssignmentCount": len(research_assignments),
            "reportingAssignmentCount": len(reporting_assignments),
            "createsItemOrEditionItem": False,
        },
    }


def build_research_packet_records(
    *,
    assignment: dict[str, Any],
    topic: str,
    corpus_key: str,
    coverage_key: str,
    research_mode: str,
    now: str,
    degraded: bool,
    refresh_packets: bool,
) -> dict[str, Any]:
    metadata = _metadata(assignment)
    message_id = story_cycle_packet_message_id(assignment, "research_packet")
    packet = {
        "summary": f"Research packet for {topic} through the {metadata.get('sectionTitle') or assignment.get('sectionKey')} lens.",
        "corpus_key": corpus_key,
        "research_mode": research_mode,
        "section_key": assignment.get("sectionKey"),
        "coverage_key": coverage_key,
        "coverage_node_id": metadata.get("coverageConceptId"),
        "section_lens": metadata.get("researchLens"),
        "evidence_item_ids": [],
        "source_snapshots": [],
        "proposed_references": [],
        "open_questions": [
            f"What accepted references best establish the current state of {topic}?",
            "Which fresh source prospects need intake before copywriting?",
        ],
        "coverage_gaps": ["No accepted evidence was attached by the deterministic planner."],
        "recommended_angle": metadata.get("researchLens") or f"Use the {assignment.get('sectionKey')} section lens.",
        "degraded": degraded,
        "fallbackReason": "deterministic_python_planner" if degraded else None,
    }
    message = packet_message(message_id, "research_packet", packet["summary"], "papyrus coverage-themes run", assignment, now)
    records = [
        _record("Message", message),
        _attachment_record(message_id, "message_body", "message", "message.txt", "text/plain", _research_packet_body(packet), assignment.get("importRunId"), now),
        _attachment_record(message_id, "metadata", "metadata", "metadata.json", "application/json", {"kind": "research.packet.created", "assignmentId": assignment["id"], "research": packet}, assignment.get("importRunId"), now),
        _record("SemanticRelation", semantic_relation(
            predicate="produces",
            subject_kind="assignment",
            subject_id=assignment["id"],
            object_kind="message",
            object_id=message_id,
            object_lineage_id=message_id,
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={"workProductKind": "research_packet", "messageKind": "research_packet", "refreshPackets": refresh_packets},
        )),
    ]
    return {
        "degraded": degraded,
        "records": records,
        "run": {
            "ok": not degraded,
            "phase": "research",
            "assignmentId": assignment["id"],
            "sectionKey": assignment.get("sectionKey"),
            "messageId": message_id,
            "packet": packet,
            "degraded": degraded,
            "fallbackReason": "deterministic_python_planner" if degraded else None,
            "fallbackKind": "research_packet" if degraded else None,
        },
    }


def build_research_packet_records_from_packet(
    *,
    assignment: dict[str, Any],
    packet: dict[str, Any],
    cloud_run: dict[str, Any],
    now: str,
    refresh_packets: bool,
) -> dict[str, Any]:
    message_id = story_cycle_packet_message_id(assignment, "research_packet")
    message = packet_message(message_id, "research_packet", packet["summary"], "papyrus coverage-themes run", assignment, now)
    records = [
        _record("Message", message),
        _attachment_record(message_id, "message_body", "message", "message.txt", "text/plain", _research_packet_body(packet), assignment.get("importRunId"), now),
        _attachment_record(message_id, "metadata", "metadata", "metadata.json", "application/json", {
            "kind": "research.packet.created",
            "assignmentId": assignment["id"],
            "research": packet,
            "cloudProcedure": cloud_run_metadata(cloud_run),
        }, assignment.get("importRunId"), now),
        _record("SemanticRelation", semantic_relation(
            predicate="produces",
            subject_kind="assignment",
            subject_id=assignment["id"],
            object_kind="message",
            object_id=message_id,
            object_lineage_id=message_id,
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={
                "workProductKind": "research_packet",
                "messageKind": "research_packet",
                "refreshPackets": refresh_packets,
                "procedureRunId": cloud_run.get("id"),
                "procedureKey": cloud_run.get("procedureKey"),
                "procedureVersionId": cloud_run.get("procedureVersionId"),
            },
        )),
    ]
    return {
        "degraded": False,
        "records": records,
        "run": {
            "ok": True,
            "phase": "research",
            "assignmentId": assignment["id"],
            "sectionKey": assignment.get("sectionKey"),
            "messageId": message_id,
            "packet": packet,
            "degraded": False,
            "cloudProcedure": cloud_run_metadata(cloud_run),
        },
    }


def build_reporting_packet_records(
    *,
    assignment: dict[str, Any],
    topic: str,
    corpus_key: str,
    coverage_key: str,
    source_research_assignment: dict[str, Any] | None,
    source_research_packet_id: str | None,
    now: str,
    degraded: bool,
    refresh_packets: bool,
) -> dict[str, Any]:
    metadata = _metadata(assignment)
    angle = (metadata.get("angleDiversity") or {}).get("lensLabel") or "reader impact"
    message_id = story_cycle_packet_message_id(assignment, "reporting_context_packet")
    packet = {
        "summary": f"Reporting context packet for {topic} / {assignment.get('sectionKey')} / {angle}.",
        "section_key": assignment.get("sectionKey"),
        "edition_id": metadata.get("editionId"),
        "coverage_key": coverage_key,
        "candidate_rank": (metadata.get("slotTarget") or {}).get("candidateRank"),
        "slot_target": metadata.get("slotTarget"),
        "why_now": f"The assignment desk identified {topic} as a Coverage Theme candidate for this edition.",
        "nut_graf_candidate": f"A reported item could explain what {topic} changes for readers through the {assignment.get('sectionKey')} lens.",
        "recommended_angle": angle,
        "confirmed_facts": [],
        "source_trail": [],
        "accepted_reference_ids": [],
        "proposed_references": [],
        "recent_desk_memory_used": [],
        "coverage_gaps": ["Accepted evidence and fresh source intake still need reporter verification."],
        "open_questions": [
            "Which accepted references should anchor the story?",
            "Which fresh source prospects should be registered before copywriting?",
        ],
        "risk_flags": ["degraded_packet" if degraded else "needs_evidence_review"],
        "verification_needs": ["Verify all facts against accepted References before copywriting."],
        "source_diversity_notes": "No source diversity assessment is available until research evidence is attached.",
        "copywriter_brief": f"Do not write final copy from this packet alone. Use it after editor selection with accepted evidence for {topic}.",
        "editor_recommendation": "hold" if degraded else "brief",
        "source_research_assignment_id": source_research_assignment.get("id") if source_research_assignment else metadata.get("sourceResearchAssignmentId"),
        "source_research_packet_id": source_research_packet_id,
        "degraded": degraded,
        "fallbackReason": "deterministic_python_planner" if degraded else None,
    }
    message = packet_message(message_id, "reporting_context_packet", packet["summary"], "papyrus coverage-themes run", assignment, now)
    records = [
        _record("Message", message),
        _attachment_record(message_id, "message_body", "message", "message.txt", "text/plain", _reporting_packet_body(packet), assignment.get("importRunId"), now),
        _attachment_record(message_id, "metadata", "metadata", "metadata.json", "application/json", {"kind": "reporting.context_packet.created", "assignmentId": assignment["id"], "reporting": packet}, assignment.get("importRunId"), now),
        _record("SemanticRelation", semantic_relation(
            predicate="produces",
            subject_kind="assignment",
            subject_id=assignment["id"],
            object_kind="message",
            object_id=message_id,
            object_lineage_id=message_id,
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={"workProductKind": "reporting_context_packet", "messageKind": "reporting_context_packet", "editorRecommendation": packet["editor_recommendation"], "refreshPackets": refresh_packets},
        )),
    ]
    if source_research_packet_id:
        records.append(_record("SemanticRelation", semantic_relation(
            predicate="derived_from",
            subject_kind="message",
            subject_id=message_id,
            object_kind="message",
            object_id=source_research_packet_id,
            object_lineage_id=source_research_packet_id,
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={"sourceKind": "section_research_packet", "coverageKey": coverage_key},
        )))
    return {
        "degraded": degraded,
        "records": records,
        "run": {
            "ok": not degraded,
            "phase": "reporting",
            "assignmentId": assignment["id"],
            "sectionKey": assignment.get("sectionKey"),
            "messageId": message_id,
            "angle": angle,
            "packet": packet,
            "degraded": degraded,
            "fallbackReason": "deterministic_python_planner" if degraded else None,
            "fallbackKind": "reporting_context_packet" if degraded else None,
        },
    }


def build_reporting_packet_records_from_packet(
    *,
    assignment: dict[str, Any],
    packet: dict[str, Any],
    cloud_run: dict[str, Any],
    source_research_packet_id: str | None,
    now: str,
    refresh_packets: bool,
) -> dict[str, Any]:
    message_id = story_cycle_packet_message_id(assignment, "reporting_context_packet")
    message = packet_message(message_id, "reporting_context_packet", packet["summary"], "papyrus coverage-themes run", assignment, now)
    records = [
        _record("Message", message),
        _attachment_record(message_id, "message_body", "message", "message.txt", "text/plain", _reporting_packet_body(packet), assignment.get("importRunId"), now),
        _attachment_record(message_id, "metadata", "metadata", "metadata.json", "application/json", {
            "kind": "reporting.context_packet.created",
            "assignmentId": assignment["id"],
            "reporting": packet,
            "cloudProcedure": cloud_run_metadata(cloud_run),
        }, assignment.get("importRunId"), now),
        _record("SemanticRelation", semantic_relation(
            predicate="produces",
            subject_kind="assignment",
            subject_id=assignment["id"],
            object_kind="message",
            object_id=message_id,
            object_lineage_id=message_id,
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={
                "workProductKind": "reporting_context_packet",
                "messageKind": "reporting_context_packet",
                "editorRecommendation": packet["editor_recommendation"],
                "refreshPackets": refresh_packets,
                "procedureRunId": cloud_run.get("id"),
                "procedureKey": cloud_run.get("procedureKey"),
                "procedureVersionId": cloud_run.get("procedureVersionId"),
            },
        )),
    ]
    if source_research_packet_id:
        records.append(_record("SemanticRelation", semantic_relation(
            predicate="derived_from",
            subject_kind="message",
            subject_id=message_id,
            object_kind="message",
            object_id=source_research_packet_id,
            object_lineage_id=source_research_packet_id,
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={"sourceKind": "section_research_packet", "coverageKey": packet.get("coverage_key")},
        )))
    return {
        "degraded": False,
        "records": records,
        "run": {
            "ok": True,
            "phase": "reporting",
            "assignmentId": assignment["id"],
            "sectionKey": assignment.get("sectionKey"),
            "messageId": message_id,
            "angle": packet.get("recommended_angle"),
            "packet": packet,
            "degraded": False,
            "cloudProcedure": cloud_run_metadata(cloud_run),
        },
    }


def cloud_run_metadata(cloud_run: dict[str, Any]) -> dict[str, Any]:
    return {
        "runId": cloud_run.get("id"),
        "procedureKey": cloud_run.get("procedureKey"),
        "procedureVersionId": cloud_run.get("procedureVersionId"),
        "procedureVersionNumber": cloud_run.get("procedureVersionNumber"),
        "runStatus": cloud_run.get("runStatus"),
        "sourcePath": cloud_run.get("sourcePath"),
        "stdoutPath": cloud_run.get("stdoutPath"),
        "stderrPath": cloud_run.get("stderrPath"),
    }


def normalize_story_cycle_research_packet(
    packet: dict[str, Any],
    *,
    assignment: dict[str, Any],
    topic: str,
    corpus_key: str,
    coverage_key: str,
    research_mode: str,
) -> dict[str, Any]:
    metadata = _metadata(assignment)
    return {
        **packet,
        "summary": _packet_value(packet, "summary") or f"Research packet for {topic}.",
        "corpus_key": _packet_value(packet, "corpus_key", "corpusKey") or corpus_key,
        "research_mode": _packet_value(packet, "research_mode", "researchMode") or research_mode,
        "section_key": _packet_value(packet, "section_key", "sectionKey") or assignment.get("sectionKey"),
        "coverage_key": _packet_value(packet, "coverage_key", "coverageKey") or coverage_key,
        "coverage_node_id": _packet_value(packet, "coverage_node_id", "coverageNodeId") or metadata.get("coverageConceptId"),
        "section_lens": _packet_value(packet, "section_lens", "sectionLens") or metadata.get("researchLens"),
        "evidence_item_ids": _packet_list(packet, "evidence_item_ids", "evidenceItemIds"),
        "source_snapshots": _packet_list(packet, "source_snapshots", "sourceSnapshots"),
        "proposed_references": _packet_list(packet, "proposed_references", "proposedReferences"),
        "open_questions": _packet_list(packet, "open_questions", "openQuestions"),
        "coverage_gaps": _packet_list(packet, "coverage_gaps", "coverageGaps"),
        "recommended_angle": _packet_value(packet, "recommended_angle", "recommendedAngle") or metadata.get("researchLens") or "",
        "degraded": False,
        "fallbackReason": None,
    }


def normalize_story_cycle_reporting_packet(
    packet: dict[str, Any],
    *,
    assignment: dict[str, Any],
    topic: str,
    coverage_key: str,
    source_research_assignment: dict[str, Any] | None,
    source_research_packet_id: str | None,
) -> dict[str, Any]:
    metadata = _metadata(assignment)
    angle = (metadata.get("angleDiversity") or {}).get("lensLabel") or "reader impact"
    return {
        **packet,
        "summary": _packet_value(packet, "summary") or f"Reporting context packet for {topic}.",
        "section_key": _packet_value(packet, "section_key", "sectionKey") or assignment.get("sectionKey"),
        "edition_id": _packet_value(packet, "edition_id", "editionId") or metadata.get("editionId"),
        "coverage_key": _packet_value(packet, "coverage_key", "coverageKey") or coverage_key,
        "recommended_angle": _packet_value(packet, "recommended_angle", "recommendedAngle") or angle,
        "editor_recommendation": _packet_value(packet, "editor_recommendation", "editorRecommendation") or "hold",
        "risk_flags": _packet_list(packet, "risk_flags", "riskFlags"),
        "coverage_gaps": _packet_list(packet, "coverage_gaps", "coverageGaps"),
        "open_questions": _packet_list(packet, "open_questions", "openQuestions"),
        "accepted_reference_ids": _packet_list(packet, "accepted_reference_ids", "acceptedReferenceIds", "accepted_referenceIds"),
        "proposed_references": _packet_list(packet, "proposed_references", "proposedReferences"),
        "copywriter_brief": _packet_value(packet, "copywriter_brief", "copywriterBrief") or "",
        "source_research_assignment_id": _packet_value(packet, "source_research_assignment_id", "sourceResearchAssignmentId") or (source_research_assignment or {}).get("id"),
        "source_research_packet_id": _packet_value(packet, "source_research_packet_id", "sourceResearchPacketId") or source_research_packet_id,
        "degraded": False,
        "fallbackReason": None,
    }


def _packet_value(packet: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = packet.get(key)
        if value not in (None, ""):
            return value
    return None


def _packet_list(packet: dict[str, Any], *keys: str) -> list[Any]:
    value = _packet_value(packet, *keys)
    return value if isinstance(value, list) else []


def story_budget_output(
    *,
    run_id: str = "",
    edition_id: str = "",
    coverage_key: str = "",
    section: str = "",
    state: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    state = state or load_story_budget_state(run_id=run_id)
    assignments = [_decode_record(record) for record in state.get("assignments", [])]
    relations = [_decode_record(record) for record in state.get("semanticRelations", [])]
    messages = {_decode_record(record).get("id"): _decode_record(record) for record in state.get("messages", [])}
    events = [_decode_record(record) for record in state.get("assignmentEvents", [])]
    items = {_decode_record(record).get("id"): _decode_record(record) for record in state.get("items", [])}
    edition_items = state.get("editionItems", [])
    subject_relations = _relations_by_assignment(relations)
    filtered = []
    for assignment in assignments:
        metadata = {**_assignment_graph_metadata(assignment, subject_relations), **_metadata(assignment)}
        if assignment.get("assignmentTypeKey") not in {"research.edition-candidate", "reporting.edition-candidate", "copywriting.article-draft", "copywriting.brief-draft"}:
            continue
        if run_id and run_id not in {assignment.get("importRunId"), metadata.get("storyCycleRunId"), metadata.get("coverageThemeRunId"), metadata.get("runId")}:
            continue
        if edition_id and edition_id not in {metadata.get("editionId"), metadata.get("editionLineageId")}:
            continue
        if coverage_key and coverage_key != metadata.get("coverageConceptKey"):
            continue
        if section and section != assignment.get("sectionKey") and section != metadata.get("sectionKey"):
            continue
        filtered.append(assignment)
    produces = _relations_by_subject(relations, "produces")
    derived_from = _relations_by_subject(relations, "derived_from")
    events_by_assignment: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        events_by_assignment.setdefault(event.get("assignmentId"), []).append(event)
    sections: dict[str, dict[str, Any]] = {}
    for assignment in sorted(filtered, key=lambda item: (item.get("sectionKey") or "", item.get("priority") or 0, item.get("id") or "")):
        metadata = {**_assignment_graph_metadata(assignment, subject_relations), **_metadata(assignment)}
        section_key = assignment.get("sectionKey") or metadata.get("sectionKey") or "unsectioned"
        section_entry = sections.setdefault(section_key, {
            "sectionKey": section_key,
            "sectionTitle": metadata.get("sectionTitle") or section_key,
            "researchAssignments": [],
            "reportingCandidates": [],
            "copywritingAssignments": [],
            "counts": {
                "research": 0,
                "reporting": 0,
                "copywriting": 0,
                "selected": 0,
                "briefed": 0,
                "held": 0,
                "killed": 0,
                "merged": 0,
                "undecided": 0,
                "draftItems": 0,
                "editionItems": 0,
            },
        })
        packet_messages = [messages.get(rel.get("objectId")) for rel in produces.get(assignment["id"], []) if rel.get("objectKind") == "message"]
        packet_messages = [message for message in packet_messages if message]
        latest_decision = latest_reporting_decision(events_by_assignment.get(assignment["id"], []))
        draft_item_ids = [rel.get("objectId") for rel in produces.get(assignment["id"], []) if rel.get("objectKind") == "item"]
        row = {
            "assignmentId": assignment["id"],
            "assignmentTypeKey": assignment.get("assignmentTypeKey"),
            "status": assignment.get("status"),
            "title": assignment.get("title"),
            "sectionKey": section_key,
            "coverageKey": metadata.get("coverageConceptKey"),
            "packetMessageIds": [message.get("id") for message in packet_messages],
            "latestDecision": latest_decision,
            "draftItemIds": draft_item_ids,
            "draftItems": [items.get(item_id) for item_id in draft_item_ids if items.get(item_id)],
            "lineage": derived_from.get(assignment["id"], []),
            "metadata": {
                "slotTarget": metadata.get("slotTarget"),
                "angleDiversity": metadata.get("angleDiversity"),
                "expectedOutput": metadata.get("expectedOutput"),
            },
        }
        if assignment.get("assignmentTypeKey") == "research.edition-candidate":
            section_entry["researchAssignments"].append(row)
            section_entry["counts"]["research"] += 1
        elif assignment.get("assignmentTypeKey") == "reporting.edition-candidate":
            packet = _packet_summary(packet_messages, state.get("modelAttachments", []), "reporting")
            row.update(packet)
            section_entry["reportingCandidates"].append(row)
            section_entry["counts"]["reporting"] += 1
            decision = latest_decision.get("decision") if latest_decision else None
            if decision == "select":
                section_entry["counts"]["selected"] += 1
            elif decision == "brief":
                section_entry["counts"]["briefed"] += 1
            elif decision == "hold":
                section_entry["counts"]["held"] += 1
            elif decision == "kill":
                section_entry["counts"]["killed"] += 1
            elif decision == "merge":
                section_entry["counts"]["merged"] += 1
            else:
                section_entry["counts"]["undecided"] += 1
        else:
            section_entry["copywritingAssignments"].append(row)
            section_entry["counts"]["copywriting"] += 1
            section_entry["counts"]["draftItems"] += len(draft_item_ids)
    placed_item_ids = {record.get("itemId") or record.get("publishedItemId") or record.get("sourceItemId") for record in edition_items}
    for section_entry in sections.values():
        section_entry["counts"]["editionItems"] = sum(
            1
            for assignment in section_entry["copywritingAssignments"]
            for item_id in assignment.get("draftItemIds") or []
            if item_id in placed_item_ids
        )
    return {
        "ok": True,
        "command": "story-budget output",
        "runId": run_id or None,
        "editionId": edition_id or None,
        "coverageKey": coverage_key or None,
        "sections": list(sections.values()),
        "summary": {
            "sectionCount": len(sections),
            "assignmentCount": len(filtered),
            "createsItemOrEditionItem": False,
        },
    }


def assignment_records(
    assignment: dict[str, Any],
    edition: dict[str, Any],
    coverage_node: dict[str, Any],
    section: dict[str, Any],
    category: dict[str, Any] | None,
    category_set: dict[str, Any] | None,
    now: str,
    *,
    signal: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    records = [
        _record("Assignment", assignment),
        _record("AssignmentEvent", assignment_event_record(assignment, now)),
        _record("SemanticRelation", semantic_relation(
            predicate="planned_for_edition",
            subject_kind="assignment",
            subject_id=assignment["id"],
            object_kind="edition",
            object_id=edition["id"],
            object_lineage_id=edition["lineageId"],
            object_version_number=edition["versionNumber"],
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={"editionDate": edition["editionDate"], "editionSlug": edition["slug"], "assignmentTypeKey": assignment["assignmentTypeKey"]},
        )),
        _record("SemanticRelation", semantic_relation(
            predicate="targets_section",
            subject_kind="assignment",
            subject_id=assignment["id"],
            object_kind="newsroomSection",
            object_id=section["id"],
            object_lineage_id=section["id"],
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={"sectionKey": section["id"], "sectionTitle": section["title"], "runId": _metadata(assignment).get("coverageThemeRunId")},
        )),
        _record("SemanticRelation", semantic_relation(
            predicate="requests_work_on",
            subject_kind="assignment",
            subject_id=assignment["id"],
            object_kind="semanticNode",
            object_id=coverage_node["id"],
            object_lineage_id=coverage_node["lineageId"],
            object_version_number=coverage_node["versionNumber"],
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={"coverageConceptKey": coverage_node["nodeKey"], "coverageConceptTitle": coverage_node["displayName"]},
        )),
    ]
    if category:
        records.append(_record("SemanticRelation", semantic_relation(
            predicate="targets_topic",
            subject_kind="assignment",
            subject_id=assignment["id"],
            object_kind="category",
            object_id=category["id"],
            object_lineage_id=category.get("lineageId") or category["id"],
            object_version_number=category.get("versionNumber"),
            rank=1,
            classifier_id=assignment.get("classifierId"),
            import_run_id=assignment.get("importRunId"),
            now=now,
            metadata={"categoryKey": category.get("categoryKey"), "sectionKey": section["id"]},
        )))
    if signal:
        for rank, reference_id in enumerate(signal.get("sourceReferenceIds") or [], start=1):
            records.append(_record("SemanticRelation", semantic_relation(
                predicate="uses_evidence",
                subject_kind="assignment",
                subject_id=assignment["id"],
                object_kind="reference",
                object_id=reference_id,
                object_lineage_id=reference_id,
                rank=rank,
                classifier_id=assignment.get("classifierId"),
                import_run_id=assignment.get("importRunId"),
                now=now,
                metadata={"signalId": signal.get("signalId"), "coverageKey": signal.get("coverageKey")},
            )))
    return records


def edition_record(*, date: str, section_budgets: dict[str, int], run_id: str, now: str) -> dict[str, Any]:
    slug = f"edition-{date}"
    lineage_id = f"edition-{_safe_id(slug)}"
    metadata = {
        "planningKind": "edition-intelligence-coverage-theme-planning",
        "coverageThemeRunId": run_id,
        "generatedAt": now,
        "sectionBudgets": [{"sectionKey": key, "slots": value} for key, value in sorted(section_budgets.items())],
        "publicReaderVisible": False,
        "createdBy": "papyrus editions plan",
    }
    record = {
        "id": f"{lineage_id}-v1",
        "lineageId": lineage_id,
        "versionNumber": 1,
        "previousVersionId": None,
        "versionState": "current",
        "versionCreatedAt": now,
        "versionCreatedBy": "papyrus",
        "changeReason": "edition-intelligence-planning",
        "slug": slug,
        "title": f"Edition Planning: {date}",
        "status": "planning",
        "editionDate": date,
        "publishedAt": None,
        "description": "Private Newsroom planning edition for signal-driven Coverage Theme assignment dispatch.",
        "layoutPlan": None,
        "metadata": metadata,
    }
    record["contentHash"] = _hash_stable({"slug": slug, "editionDate": date, "metadata": metadata})
    return record


def coverage_node_record(
    *,
    coverage_key: str,
    topic: str,
    corpus_key: str,
    category: dict[str, Any] | None,
    category_set: dict[str, Any] | None,
    now: str,
    change_reason: str = "coverage-theme-coverage-concept",
) -> dict[str, Any]:
    lineage_id = f"semantic-node-{_safe_id(coverage_key)}"
    record = {
        "id": f"{lineage_id}-v1",
        "lineageId": lineage_id,
        "versionNumber": 1,
        "previousVersionId": None,
        "versionState": "current",
        "versionCreatedAt": now,
        "versionCreatedBy": "papyrus",
        "changeReason": change_reason,
        "nodeKey": coverage_key,
        "nodeKind": "coverageQuestion",
        "corpusId": (category_set or {}).get("corpusId") or f"knowledge-corpus-{_safe_id(corpus_key)}",
        "categorySetId": (category_set or {}).get("id"),
        "categoryLineageId": (category or {}).get("lineageId"),
        "categoryKey": (category or {}).get("categoryKey"),
        "displayName": topic,
        "description": f"Coverage concept for edition intelligence, research, and reporting: {topic}.",
        "aliases": [],
        "status": "accepted",
        "importRunId": None,
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": "semanticNodes",
    }
    record["contentHash"] = _hash_stable({"nodeKey": coverage_key, "nodeKind": record["nodeKind"], "displayName": topic})
    return {key: value for key, value in record.items() if value is not None}


def lane_node_record(node_key: str, display_name: str, alias: str, now: str) -> dict[str, Any]:
    lineage_id = f"semantic-node-{_safe_id(node_key)}"
    record = {
        "id": f"{lineage_id}-v1",
        "lineageId": lineage_id,
        "versionNumber": 1,
        "previousVersionId": None,
        "versionState": "current",
        "versionCreatedAt": now,
        "versionCreatedBy": "papyrus",
        "changeReason": "coverage-theme-lane-seed",
        "nodeKey": node_key,
        "nodeKind": "editorialForm",
        "displayName": display_name,
        "description": f"Editorial form lane for {display_name.lower()} assignments.",
        "aliases": [alias],
        "status": "accepted",
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": "semanticNodes",
    }
    record["contentHash"] = _hash_stable({"nodeKey": node_key, "displayName": display_name, "aliases": [alias]})
    return record


def research_assignment_record(**kwargs: Any) -> dict[str, Any]:
    section = kwargs["section"]
    coverage_node = kwargs["coverage_node"]
    category = kwargs.get("category")
    category_set = kwargs.get("category_set")
    edition = kwargs["edition"]
    run_id = kwargs["run_id"]
    date = kwargs["date"]
    topic = kwargs["topic"]
    corpus_key = kwargs["corpus_key"]
    category_key = kwargs["category_key"]
    research_mode = kwargs["research_mode"]
    now = kwargs["now"]
    metadata = assignment_metadata(
        kind="coverage_theme.research_assignment",
        run_id=run_id,
        date=date,
        topic=topic,
        corpus_key=corpus_key,
        category_key=category_key,
        category=category,
        category_set=category_set,
        coverage_node=coverage_node,
        edition=edition,
        section=section,
        context_profile="researcher",
        expected_output="Private research packet for section-shaped reporting context, not reader copy.",
        research_mode=research_mode,
        research_lens=section_research_lens(section["id"]),
        signal=kwargs.get("signal"),
    )
    queue_key = f"coverage-theme:{date}:section:{section['id']}:lane:research"
    return {
        "id": f"assignment-coverage-theme-research-{_safe_id(run_id)}-{_safe_id(section['id'])}",
        "assignmentTypeKey": "research.edition-candidate",
        "queueKey": queue_key,
        "queueStatusKey": f"{queue_key}#open",
        "status": "open",
        "priority": kwargs["priority"],
        "title": f"Research {topic} for {section['title']}",
        "summary": f"Section-shaped research on {topic} for {section['title']}.",
        "brief": f"{section['title']} research lens: {section_research_lens(section['id'])}.",
        "instructions": f"Research {topic} through the {section['title']} section lens. Produce a private research_packet only.",
        "metadata": metadata,
        "corpusId": (category_set or {}).get("corpusId") or f"knowledge-corpus-{_safe_id(corpus_key)}",
        "categorySetId": (category_set or {}).get("id"),
        "classifierId": (category_set or {}).get("classifierId"),
        "sourceSnapshotId": None,
        "importRunId": run_id,
        "sectionId": section["id"],
        "sectionKey": section["id"],
        "sectionType": _normalize_section_type(section.get("type")),
        "sectionStatusKey": f"{section['id']}#open",
        "sectionQueueStatusKey": f"{section['id']}#{queue_key}#open",
        "primaryFocusCategoryKey": (category or {}).get("categoryKey") or category_key,
        "topicScopeCategoryKeys": [value for value in [(category or {}).get("categoryKey") or category_key] if value],
        "createdBy": "papyrus",
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": "assignment#open",
    }


def reporting_assignment_record(**kwargs: Any) -> dict[str, Any]:
    section = kwargs["section"]
    coverage_node = kwargs["coverage_node"]
    category = kwargs.get("category")
    category_set = kwargs.get("category_set")
    edition = kwargs["edition"]
    run_id = kwargs["run_id"]
    date = kwargs["date"]
    topic = kwargs["topic"]
    corpus_key = kwargs["corpus_key"]
    category_key = kwargs["category_key"]
    now = kwargs["now"]
    angle = kwargs["angle"]
    metadata = assignment_metadata(
        kind="coverage_theme.reporting_assignment",
        run_id=run_id,
        date=date,
        topic=topic,
        corpus_key=corpus_key,
        category_key=category_key,
        category=category,
        category_set=category_set,
        coverage_node=coverage_node,
        edition=edition,
        section=section,
        context_profile="reporting",
        expected_output="Private reporting context packet for editor selection and copywriting, not reader copy.",
        research_mode=None,
        research_lens=section_research_lens(section["id"]),
        source_research_assignment_id=(kwargs.get("source_research_assignment") or {}).get("id"),
        slot_target={
            "sectionKey": section["id"],
            "slots": kwargs["slots"],
            "candidateRank": kwargs["candidate_rank"],
            "dispatchCount": kwargs["dispatch_count"],
        },
        angle_diversity={
            "lensKey": angle["key"],
            "lensLabel": angle["label"],
            "lensPrompt": angle["prompt"],
            "diversityKey": f"{section['id']}:{coverage_node['nodeKey']}:{angle['key']}:{kwargs['candidate_rank']}",
            "duplicateAnglePenalty": 0,
        },
        signal=kwargs.get("signal"),
    )
    queue_key = f"coverage-theme:{date}:section:{section['id']}:lane:reporting"
    return {
        "id": f"assignment-coverage-theme-reporting-{_safe_id(run_id)}-{_safe_id(section['id'])}-{kwargs['candidate_rank']:02d}-{_safe_id(angle['key'])}",
        "assignmentTypeKey": "reporting.edition-candidate",
        "queueKey": queue_key,
        "queueStatusKey": f"{queue_key}#open",
        "status": "open",
        "priority": kwargs["priority"],
        "title": f"Report {topic} for {section['title']}: {angle['label']}",
        "summary": f"Reporting candidate on {topic} for {section['title']}, angle: {angle['label']}.",
        "brief": f"Build a private reporting context packet. Angle: {angle['prompt']}.",
        "instructions": f"Use the {section['title']} doctrine and section research packet. Produce reporting_context_packet only.",
        "metadata": metadata,
        "corpusId": (category_set or {}).get("corpusId") or f"knowledge-corpus-{_safe_id(corpus_key)}",
        "categorySetId": (category_set or {}).get("id"),
        "classifierId": (category_set or {}).get("classifierId"),
        "sourceSnapshotId": None,
        "importRunId": run_id,
        "sectionId": section["id"],
        "sectionKey": section["id"],
        "sectionType": _normalize_section_type(section.get("type")),
        "sectionStatusKey": f"{section['id']}#open",
        "sectionQueueStatusKey": f"{section['id']}#{queue_key}#open",
        "primaryFocusCategoryKey": (category or {}).get("categoryKey") or category_key,
        "topicScopeCategoryKeys": [value for value in [(category or {}).get("categoryKey") or category_key] if value],
        "createdBy": "papyrus",
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": "assignment#open",
    }


def assignment_metadata(**kwargs: Any) -> dict[str, Any]:
    section = kwargs["section"]
    coverage_node = kwargs["coverage_node"]
    category = kwargs.get("category")
    category_set = kwargs.get("category_set")
    edition = kwargs["edition"]
    signal = kwargs.get("signal") or {}
    return {
        "kind": kwargs["kind"],
        "coverageThemeKind": "coverage_theme",
        "storyCycleRunId": kwargs["run_id"],
        "coverageThemeRunId": kwargs["run_id"],
        "coverageThemeLabel": kwargs["topic"],
        "storyCycleDate": kwargs["date"],
        "topic": kwargs["topic"],
        "corpusKey": kwargs["corpus_key"],
        "editionDate": kwargs["date"],
        "editionId": edition["id"],
        "editionLineageId": edition["lineageId"],
        "coverageConceptId": coverage_node["id"],
        "coverageConceptLineageId": coverage_node["lineageId"],
        "coverageConceptKey": coverage_node["nodeKey"],
        "coverageConceptTitle": coverage_node["displayName"],
        "categoryKey": (category or {}).get("categoryKey") or kwargs["category_key"],
        "focusCategoryKey": (category or {}).get("categoryKey") or kwargs["category_key"],
        "focusCategoryLineageId": (category or {}).get("lineageId"),
        "focusCategoryTitle": (category or {}).get("displayName") or (category or {}).get("shortTitle") or kwargs["category_key"],
        "categorySetId": (category_set or {}).get("id"),
        "classifierId": (category_set or {}).get("classifierId"),
        "sectionId": section["id"],
        "sectionKey": section["id"],
        "sectionTitle": section["title"],
        "sectionType": _normalize_section_type(section.get("type")),
        "sectionMission": section.get("editorialMission"),
        "sectionPolicies": [section["editorialPolicy"]] if section.get("editorialPolicy") else [],
        "assignmentGuidance": section.get("assignmentGuidance"),
        "killCriteria": section.get("killCriteria"),
        "visualGuidance": section.get("visualGuidance"),
        "contextProfile": kwargs["context_profile"],
        "contextSources": ["publication-doctrine", "section-doctrine", "assignment-brief", "accepted-knowledge-base-evidence", "recent-section-memory", "fresh-source-needs"],
        "researchMode": kwargs.get("research_mode"),
        "researchLens": kwargs.get("research_lens"),
        "sourceResearchAssignmentId": kwargs.get("source_research_assignment_id"),
        "slotTarget": kwargs.get("slot_target"),
        "angleDiversity": kwargs.get("angle_diversity"),
        "signalId": signal.get("signalId"),
        "signalRank": signal.get("rank"),
        "signalWhyNow": signal.get("whyNow"),
        "expectedOutput": kwargs["expected_output"],
        "publicReaderVisible": False,
        "createdBy": "papyrus coverage-themes run",
    }


def assignment_event_record(assignment: dict[str, Any], now: str) -> dict[str, Any]:
    return {
        "id": f"assignment-event-{assignment['id']}-created",
        "assignmentId": assignment["id"],
        "assignmentTypeKey": assignment["assignmentTypeKey"],
        "queueKey": assignment["queueKey"],
        "eventType": "created",
        "fromStatus": None,
        "toStatus": "open",
        "actorSub": None,
        "actorLabel": "Papyrus newsroom CLI",
        "note": f"Created Coverage Theme {assignment['assignmentTypeKey']} assignment.",
        "createdAt": now,
    }


def packet_message(message_id: str, kind: str, summary: str, source: str, assignment: dict[str, Any], now: str) -> dict[str, Any]:
    return {
        "id": message_id,
        "messageKind": kind,
        "messageDomain": "assignment_work",
        "status": "active",
        "summary": summary,
        "source": source,
        "importRunId": assignment.get("importRunId"),
        "authorLabel": "papyrus",
        "newsroomFeedKey": f"message#{kind}",
        "createdAt": now,
        "updatedAt": now,
    }


def story_cycle_packet_message_id(assignment: dict[str, Any], message_kind: str) -> str:
    suffix = "research_packet" if message_kind == "research_packet" else "reporting_context_packet"
    return f"message-{message_kind.replace('_', '-')}-{_hash_short([assignment['id'], suffix])}"


def semantic_relation(
    *,
    predicate: str,
    subject_kind: str,
    subject_id: str,
    object_kind: str,
    object_id: str,
    subject_lineage_id: str | None = None,
    subject_version_number: int | None = None,
    object_lineage_id: str | None = None,
    object_version_number: int | None = None,
    score: float | None = None,
    confidence: float | None = None,
    rank: int | None = None,
    classifier_id: str | None = None,
    model_version: str | None = None,
    source_snapshot_id: str | None = None,
    import_run_id: str | None = None,
    now: str = "",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = now or _now_iso()
    subject_lineage_id = subject_lineage_id or subject_id
    object_lineage_id = object_lineage_id or object_id
    subject_state_key = semantic_state_key(subject_kind, subject_lineage_id)
    object_state_key = semantic_state_key(object_kind, object_lineage_id)
    subject_version_key = semantic_version_key(subject_kind, subject_id)
    object_version_key = semantic_version_key(object_kind, object_id)
    key = _normalize_relation_key(predicate)
    relation = {
        "id": f"semantic-relation-{_hash_short([subject_version_key, key, object_version_key, rank or '', classifier_id or '', model_version or ''])}",
        "relationState": "current",
        "predicate": key,
        "relationTypeId": f"semantic-relation-type-{_safe_id(key)}",
        "relationTypeKey": key,
        "relationDomain": RELATION_DOMAINS.get(key, "generic"),
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
        "predicateObjectStateKey": f"{key}#{object_state_key}",
        "subjectVersionKey": subject_version_key,
        "objectVersionKey": object_version_key,
        "score": score if score is not None else confidence if confidence is not None else 1,
        "confidence": confidence,
        "rank": rank,
        "classifierId": classifier_id,
        "modelVersion": model_version,
        "reviewRecommended": False,
        "sourceSnapshotId": source_snapshot_id,
        "importRunId": import_run_id,
        "importedAt": now,
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": "semanticRelations",
        "metadata": metadata or {},
    }
    return {key: value for key, value in relation.items() if value is not None}


def apply_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    applied = []
    warnings = []
    for record in records:
        model_name = record["modelName"]
        action = record.get("action") or "upsert"
        input_payload = record.get("input") or {}
        try:
            if action == "noop":
                applied.append({"modelName": model_name, "action": "noop", "id": input_payload.get("id")})
                continue
            if model_name == "ModelAttachment":
                _upload_model_attachment(input_payload, str(record.get("body") or ""))
                applied.append({"modelName": model_name, "action": "upload", "id": input_payload.get("id")})
                continue
            if action == "create":
                _create_record(model_name, input_payload)
                applied.append({"modelName": model_name, "action": "create", "id": input_payload.get("id")})
            elif action == "update":
                _update_record(model_name, input_payload)
                applied.append({"modelName": model_name, "action": "update", "id": input_payload.get("id")})
            elif action == "upsert":
                if _record_exists(model_name, str(input_payload.get("id"))):
                    _update_record(model_name, input_payload)
                    applied.append({"modelName": model_name, "action": "update", "id": input_payload.get("id")})
                else:
                    _create_record(model_name, input_payload)
                    applied.append({"modelName": model_name, "action": "create", "id": input_payload.get("id")})
            else:
                raise ValueError(f"Unsupported action {action}")
        except Exception as exc:  # pragma: no cover - live GraphQL behavior varies by deployment
            warnings.append(f"{model_name} {input_payload.get('id')} failed: {exc}")
            raise
    return {"apply": True, "applied": applied, "warnings": warnings}


def load_live_state(*, models: list[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    model_names = models or list(LIST_FIELDS.keys())
    state: dict[str, list[dict[str, Any]]] = {}
    for model in model_names:
        state[_state_key(model)] = _list_records(model)
    return state


def load_story_budget_state(*, run_id: str = "") -> dict[str, list[dict[str, Any]]]:
    if not run_id:
        return load_live_state(models=["Edition", "Assignment", "AssignmentEvent", "Message", "SemanticRelation", "ModelAttachment", "Item", "EditionItem", "NewsroomSection"])
    assignments = _list_assignments_by_import_run(run_id)
    relations: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    messages_by_id: dict[str, dict[str, Any]] = {}
    attachments: list[dict[str, Any]] = []
    items_by_id: dict[str, dict[str, Any]] = {}
    for assignment in assignments:
        assignment_id = assignment.get("id")
        if not assignment_id:
            continue
        assignment_relations = _list_relations_by_subject("assignment", assignment_id)
        relations.extend(assignment_relations)
        events.extend(_list_assignment_events(assignment_id))
        for relation in assignment_relations:
            relation_type = relation.get("relationTypeKey") or relation.get("predicate")
            if relation_type != "produces":
                continue
            if relation.get("objectKind") == "message":
                message = _get_record("Message", relation.get("objectId"))
                if message:
                    messages_by_id[message["id"]] = message
                    attachments.extend(_list_model_attachments_by_owner(message["id"]))
            elif relation.get("objectKind") == "item":
                item = _get_record("Item", relation.get("objectId"))
                if item:
                    items_by_id[item["id"]] = item
    return {
        "assignments": assignments,
        "semanticRelations": _dedupe_by_id(relations),
        "assignmentEvents": _dedupe_by_id(events),
        "messages": list(messages_by_id.values()),
        "modelAttachments": _dedupe_by_id(attachments),
        "items": list(items_by_id.values()),
        "editionItems": [],
        "newsroomSections": [],
    }


def resolve_sections(section_keys: list[str], newsroom_sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {
        str(section.get("id")): section
        for section in newsroom_sections
        if section.get("enabled") is not False and section.get("enabledStatus") != "disabled"
    }
    sections = []
    for index, raw_key in enumerate(_resolve_section_keys(section_keys)):
        key = SECTION_ALIASES.get(raw_key, raw_key)
        section = by_id.get(key) or by_id.get(raw_key)
        if not section:
            section = synthetic_section(key, index)
        sections.append(_decode_record(section))
    return sections


def synthetic_section(key: str, index: int) -> dict[str, Any]:
    title = " ".join(part.capitalize() for part in re.split(r"[-_\s]+", key) if part) or key
    return {
        "id": key,
        "title": title,
        "shortTitle": title,
        "type": "canonical",
        "editorialMission": f"Cover {title}.",
        "editorialPolicy": f"Use the {title} section lens.",
        "assignmentGuidance": None,
        "killCriteria": None,
        "visualGuidance": None,
        "enabled": True,
        "sortOrder": index + 1,
        "defaultArticleTypes": ["article"],
        "defaultPageBudget": DEFAULT_SECTION_BUDGETS.get(key, 1),
    }


def find_category(category_key: str, categories: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not category_key:
        return None
    for category in categories:
        if category.get("versionState") not in {None, "current"} or category.get("status") in {"archived", "rejected"}:
            continue
        if category_key in {category.get("id"), category.get("lineageId"), category.get("categoryKey"), category.get("displayName")}:
            return _decode_record(category)
    return None


def find_category_set(category: dict[str, Any] | None, category_sets: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not category:
        return None
    category_set_id = category.get("categorySetId")
    for category_set in category_sets:
        if category_set.get("id") == category_set_id:
            return _decode_record(category_set)
    return None


def latest_reporting_decision(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    decision_events = [
        event for event in events
        if str(event.get("eventType") or "").startswith("reporting_")
    ]
    if not decision_events:
        return None
    latest = sorted(decision_events, key=lambda item: str(item.get("createdAt") or ""), reverse=True)[0]
    decision = str(latest.get("eventType") or "").replace("reporting_", "", 1)
    return {
        "eventId": latest.get("id"),
        "decision": decision,
        "note": latest.get("note"),
        "createdAt": latest.get("createdAt"),
    }


def normalize_through(value: str) -> str:
    normalized = str(value or "reporting").strip().lower().replace("-", "_")
    if normalized not in THROUGH_PHASES:
        raise ValueError(f"Invalid --through {value!r}. Expected plan, research, or reporting.")
    return normalized


def parse_section_budgets(value: str, sections: list[str] | None = None) -> dict[str, int]:
    result = {}
    for section in _resolve_section_keys(sections or []):
        result[SECTION_ALIASES.get(section, section)] = DEFAULT_SECTION_BUDGETS.get(section, 1)
    for part in str(value or "").split(","):
        if not part.strip():
            continue
        key, _, raw_slots = part.partition(":")
        section_key = SECTION_ALIASES.get(key.strip(), key.strip())
        try:
            slots = max(1, int(raw_slots.strip()))
        except ValueError as exc:
            raise ValueError(f"Invalid section budget {part!r}; expected section:slots.") from exc
        result[section_key] = slots
    return result


def parse_csv(value: str) -> list[str]:
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def load_json_file(path: str) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"{path} must contain a JSON object")
    return payload


def _signal_report_body(report: dict[str, Any]) -> str:
    lines = [
        f"Edition Signal Report: {report.get('date')}",
        f"Corpus: {report.get('corpusKey')}",
        "",
    ]
    for signal in report.get("signals") or []:
        lines.extend([
            f"{signal.get('rank')}. {signal.get('topic')} ({signal.get('coverageKey')})",
            f"Score: {signal.get('score')}",
            f"Why now: {signal.get('whyNow')}",
            f"Accepted references: {signal.get('acceptedEvidenceCount')}",
            "",
        ])
    return "\n".join(lines).strip() + "\n"


def _research_packet_body(packet: dict[str, Any]) -> str:
    return "\n".join([
        packet["summary"],
        "",
        f"Section: {packet.get('section_key')}",
        f"Coverage: {packet.get('coverage_key')}",
        f"Recommended angle: {packet.get('recommended_angle')}",
        "",
        "Open questions:",
        *[f"- {item}" for item in packet.get("open_questions") or []],
        "",
        "Coverage gaps:",
        *[f"- {item}" for item in packet.get("coverage_gaps") or []],
    ]).strip() + "\n"


def _reporting_packet_body(packet: dict[str, Any]) -> str:
    return "\n".join([
        packet["summary"],
        "",
        f"Section: {packet.get('section_key')}",
        f"Angle: {packet.get('recommended_angle')}",
        f"Recommendation: {packet.get('editor_recommendation')}",
        "",
        "Risk flags:",
        *[f"- {item}" for item in packet.get("risk_flags") or []],
        "",
        "Coverage gaps:",
        *[f"- {item}" for item in packet.get("coverage_gaps") or []],
        "",
        "Copywriter brief:",
        str(packet.get("copywriter_brief") or ""),
    ]).strip() + "\n"


def _packet_summary(messages: list[dict[str, Any]], attachments: list[dict[str, Any]], kind: str) -> dict[str, Any]:
    if not messages:
        return {"packetAvailable": False}
    message = messages[0]
    packet = {}
    for attachment in attachments:
        if attachment.get("ownerId") == message.get("id") and attachment.get("role") == "metadata":
            try:
                metadata = _download_attachment_json(attachment["id"])
                packet = metadata.get(kind) or metadata.get("reporting") or metadata.get("research") or {}
            except Exception:
                packet = {}
            break
    return {
        "packetAvailable": True,
        "packetSummary": message.get("summary"),
        "editorRecommendation": packet.get("editor_recommendation") or packet.get("editorRecommendation"),
        "recommendedAngle": packet.get("recommended_angle") or packet.get("recommendedAngle"),
        "riskFlags": packet.get("risk_flags") or packet.get("riskFlags") or [],
        "coverageGaps": packet.get("coverage_gaps") or packet.get("coverageGaps") or [],
        "openQuestions": packet.get("open_questions") or packet.get("openQuestions") or [],
        "acceptedEvidenceCount": len(packet.get("accepted_reference_ids") or packet.get("acceptedReferenceIds") or []),
        "proposedReferenceCount": len(packet.get("proposed_references") or packet.get("proposedReferences") or []),
        "copywriterBrief": packet.get("copywriter_brief") or packet.get("copywriterBrief"),
        "degraded": bool(packet.get("degraded")),
        "fallbackReason": packet.get("fallbackReason") or packet.get("fallback_reason"),
    }


def _record(model_name: str, input_payload: dict[str, Any], action: str = "upsert") -> dict[str, Any]:
    return {"modelName": model_name, "action": action, "input": _clean_none(input_payload)}


def _attachment_record(owner_id: str, role: str, sort_key: str, filename: str, media_type: str, content: Any, import_run_id: str | None, now: str) -> dict[str, Any]:
    body = content if isinstance(content, str) else json.dumps(content, indent=2, sort_keys=True) + "\n"
    body_bytes = body.encode("utf-8")
    attachment = {
        "id": f"model-attachment-message-{_safe_id(owner_id)}-{_safe_id(role)}-{_safe_id(sort_key)}",
        "ownerKind": "message",
        "ownerId": owner_id,
        "ownerLineageId": owner_id,
        "ownerVersionNumber": None,
        "ownerVersionKey": None,
        "role": role,
        "sortKey": sort_key,
        "storagePath": f"newsroom/payloads/message/{_safe_id(owner_id)}/{_safe_id(role)}/{filename}",
        "filename": filename,
        "mediaType": media_type,
        "byteSize": len(body_bytes),
        "sha256": hashlib.sha256(body_bytes).hexdigest(),
        "etag": None,
        "importRunId": import_run_id,
        "createdAt": now,
        "updatedAt": now,
        "status": "active",
    }
    return {"modelName": "ModelAttachment", "action": "upload", "input": attachment, "body": body}


def _accepted_references(references: list[dict[str, Any]], corpus_key: str) -> list[dict[str, Any]]:
    corpus_id = f"knowledge-corpus-{_safe_id(corpus_key)}"
    accepted = []
    for ref in references:
        ref = _decode_record(ref)
        if ref.get("versionState") not in {None, "current"}:
            continue
        if str(ref.get("curationStatus") or "").lower() != "accepted":
            continue
        if corpus_key and ref.get("corpusId") not in {None, "", corpus_id, corpus_key}:
            continue
        accepted.append(ref)
    return accepted


def _terms(value: str) -> list[str]:
    seen = set()
    result = []
    for term in re.findall(r"[a-z0-9][a-z0-9-]{2,}", str(value or "").lower()):
        if term in STOPWORDS or term in seen:
            continue
        seen.add(term)
        result.append(term)
    return result


def _matching_nodes(nodes: list[dict[str, Any]], topic: str, coverage_key: str) -> list[dict[str, Any]]:
    terms = _terms(topic)
    matches = []
    for node in nodes:
        haystack = " ".join([str(node.get("nodeKey") or ""), str(node.get("displayName") or ""), str(node.get("description") or "")]).lower()
        if coverage_key and node.get("nodeKey") == coverage_key:
            matches.append(node)
        elif terms and any(term in haystack for term in terms):
            matches.append(node)
    return matches


def _section_fit_scores(topic: str, refs: list[dict[str, Any]], sections: list[str]) -> dict[str, float]:
    text = " ".join([topic, *[str(ref.get("title") or "") for ref in refs]]).lower()
    scores = {}
    for section in sections:
        lens_terms = _terms(section_research_lens(section))
        if not lens_terms:
            scores[section] = 0.0
            continue
        score = sum(1 for term in lens_terms if term in text) / len(lens_terms)
        scores[section] = round(score, 3)
    return scores


def _why_now(topic: str, refs: list[dict[str, Any]], domains: list[str], since_days: int) -> str:
    if refs:
        return f"{len(refs)} accepted reference(s) in the last {since_days} day(s) mention {topic}; source domains include {', '.join(domains[:3]) or 'unknown'}."
    return f"{topic} is a candidate coverage gap; no accepted recent references matched the signal window."


def _coverage_gaps(topic: str, refs: list[dict[str, Any]]) -> list[str]:
    if not refs:
        return [f"No accepted recent references currently anchor {topic}."]
    if len({_domain(ref.get("sourceUri")) for ref in refs if _domain(ref.get("sourceUri"))}) < 2:
        return ["Source diversity needs review before publication."]
    return ["Confirm whether the signal is genuinely new or part of an existing desk thread."]


def _open_questions(topic: str, sections: list[str]) -> list[str]:
    if sections:
        return [f"What does {topic} mean for the {section} desk?" for section in sections[:3]]
    return [f"What is the most reportable angle on {topic}?"]


def _suggested_angles(topic: str, sections: list[str]) -> list[dict[str, str]]:
    angles = []
    for section in sections[:4]:
        angles.append({
            "sectionKey": section,
            "angle": f"{section_research_lens(section)}: {topic}",
        })
    return angles


def _recency_score(value: dt.datetime | None, now: dt.datetime, since_days: int) -> float:
    if not value:
        return 0.0
    age_days = max(0.0, (now - value).total_seconds() / 86400)
    return round(max(0.0, 1.0 - (age_days / max(since_days, 1))), 3)


def _reference_datetime(ref: dict[str, Any]) -> dt.datetime | None:
    for key in ("sourcePublishedAt", "sourceUpdatedAt", "retrievedAt", "importedAt", "updatedAt"):
        parsed = _parse_datetime(ref.get(key))
        if parsed:
            return parsed
    return None


def _domain(value: Any) -> str:
    parsed = urllib.parse.urlparse(str(value or ""))
    return parsed.netloc.lower().removeprefix("www.")


def _dedupe_by_id(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    result = []
    for record in records:
        key = record.get("id") or json.dumps(record, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        result.append(record)
    return result


def _dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    result = []
    for record in records:
        key = (record.get("modelName"), (record.get("input") or {}).get("id"), record.get("action"))
        if key in seen:
            continue
        seen.add(key)
        result.append(record)
    return result


def _without_records(plan: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in plan.items() if key != "records"}


def _relations_by_subject(relations: list[dict[str, Any]], predicate: str) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for relation in relations:
        if relation.get("relationState") != "current":
            continue
        if (relation.get("relationTypeKey") or relation.get("predicate")) != predicate:
            continue
        grouped.setdefault(relation.get("subjectId"), []).append(relation)
    return grouped


def _relations_by_assignment(relations: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for relation in relations:
        if relation.get("relationState") != "current" or relation.get("subjectKind") != "assignment":
            continue
        grouped.setdefault(relation.get("subjectId"), []).append(relation)
    return grouped


def _assignment_graph_metadata(assignment: dict[str, Any], relations_by_assignment: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    if assignment.get("importRunId"):
        metadata["coverageThemeRunId"] = assignment.get("importRunId")
        metadata["storyCycleRunId"] = assignment.get("importRunId")
        metadata["runId"] = assignment.get("importRunId")
    if assignment.get("sectionKey"):
        metadata["sectionKey"] = assignment.get("sectionKey")
    for relation in relations_by_assignment.get(assignment.get("id"), []):
        relation_type = relation.get("relationTypeKey") or relation.get("predicate")
        relation_metadata = _jsonish(relation.get("metadata")) or {}
        if relation_type == "planned_for_edition":
            metadata["editionId"] = relation.get("objectId")
            metadata["editionLineageId"] = relation.get("objectLineageId")
            if relation_metadata.get("editionDate"):
                metadata["editionDate"] = relation_metadata.get("editionDate")
        elif relation_type == "requests_work_on":
            metadata["coverageConceptId"] = relation.get("objectId")
            metadata["coverageConceptLineageId"] = relation.get("objectLineageId")
            if relation_metadata.get("coverageConceptKey"):
                metadata["coverageConceptKey"] = relation_metadata.get("coverageConceptKey")
            if relation_metadata.get("coverageConceptTitle"):
                metadata["coverageConceptTitle"] = relation_metadata.get("coverageConceptTitle")
        elif relation_type == "targets_section":
            metadata["sectionId"] = relation.get("objectId")
            metadata["sectionKey"] = relation_metadata.get("sectionKey") or relation.get("objectId")
            if relation_metadata.get("sectionTitle"):
                metadata["sectionTitle"] = relation_metadata.get("sectionTitle")
        elif relation_type == "targets_topic":
            metadata["focusCategoryLineageId"] = relation.get("objectLineageId")
            if relation_metadata.get("categoryKey"):
                metadata["categoryKey"] = relation_metadata.get("categoryKey")
                metadata["focusCategoryKey"] = relation_metadata.get("categoryKey")
        elif relation_type == "targets_lane":
            if relation_metadata.get("slotTarget"):
                metadata["slotTarget"] = relation_metadata.get("slotTarget")
            if relation_metadata.get("angleDiversity"):
                metadata["angleDiversity"] = relation_metadata.get("angleDiversity")
        elif relation_type == "derived_from" and relation.get("objectKind") == "assignment":
            metadata["sourceResearchAssignmentId"] = relation.get("objectId")
    return metadata


def _metadata(record: dict[str, Any]) -> dict[str, Any]:
    metadata = _jsonish(record.get("metadata"))
    return metadata if isinstance(metadata, dict) else {}


def _decode_record(record: dict[str, Any]) -> dict[str, Any]:
    decoded = dict(record or {})
    for key in ("metadata", "layoutPlan", "editorial"):
        if key in decoded:
            decoded[key] = _jsonish(decoded[key])
    return decoded


def _jsonish(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _clean_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def _prepare_input(model_name: str, input_payload: dict[str, Any]) -> dict[str, Any]:
    prepared = _clean_none(input_payload)
    if model_name == "Assignment":
        for key in ("brief", "instructions", "metadata"):
            prepared.pop(key, None)
    for key in ("metadata", "layoutPlan", "editorial"):
        if key in prepared and not isinstance(prepared[key], str):
            prepared[key] = json.dumps(prepared[key], sort_keys=True)
    return prepared


def _list_records(model_name: str) -> list[dict[str, Any]]:
    field_name, fields = LIST_FIELDS[model_name]
    query = f"""
query List{model_name}s($limit: Int, $nextToken: String) {{
  {field_name}(limit: $limit, nextToken: $nextToken) {{
    items {{ {fields} }}
    nextToken
  }}
}}
"""
    records: list[dict[str, Any]] = []
    next_token = None
    while True:
        payload = _graphql(query, {"limit": 1000, "nextToken": next_token})
        connection = payload.get(field_name) or {}
        records.extend(_decode_record(item) for item in connection.get("items") or [] if item)
        next_token = connection.get("nextToken")
        if not next_token:
            return records


def _list_assignments_by_import_run(run_id: str) -> list[dict[str, Any]]:
    query = f"""
query ListAssignmentsByImportRun($importRunId: ID!, $limit: Int, $nextToken: String) {{
  listAssignmentsByImportRunAndCreatedAt(importRunId: $importRunId, limit: $limit, nextToken: $nextToken) {{
    items {{ {ASSIGNMENT_FIELDS} }}
    nextToken
  }}
}}
"""
    return _list_connection(query, {"importRunId": run_id}, "listAssignmentsByImportRunAndCreatedAt")


def _list_relations_by_subject(kind: str, lineage_id: str) -> list[dict[str, Any]]:
    query = f"""
query ListRelationsBySubject($subjectStateKey: String!, $limit: Int, $nextToken: String) {{
  listSemanticRelationsBySubjectState(subjectStateKey: $subjectStateKey, limit: $limit, nextToken: $nextToken) {{
    items {{ {SEMANTIC_RELATION_FIELDS} }}
    nextToken
  }}
}}
"""
    return _list_connection(query, {"subjectStateKey": semantic_state_key(kind, lineage_id)}, "listSemanticRelationsBySubjectState")


def _list_assignment_events(assignment_id: str) -> list[dict[str, Any]]:
    query = f"""
query ListAssignmentEventsByAssignment($assignmentId: ID!, $limit: Int, $nextToken: String) {{
  listAssignmentEventsByAssignmentAndCreatedAt(assignmentId: $assignmentId, limit: $limit, nextToken: $nextToken) {{
    items {{ {ASSIGNMENT_EVENT_FIELDS} }}
    nextToken
  }}
}}
"""
    return _list_connection(query, {"assignmentId": assignment_id}, "listAssignmentEventsByAssignmentAndCreatedAt")


def _list_model_attachments_by_owner(owner_id: str) -> list[dict[str, Any]]:
    query = f"""
query ListModelAttachmentsByOwner($ownerId: ID!, $limit: Int, $nextToken: String) {{
  listModelAttachmentsByOwnerRoleAndSortKey(ownerId: $ownerId, limit: $limit, nextToken: $nextToken) {{
    items {{ {MODEL_ATTACHMENT_FIELDS} }}
    nextToken
  }}
}}
"""
    return _list_connection(query, {"ownerId": owner_id}, "listModelAttachmentsByOwnerRoleAndSortKey")


def _list_connection(query: str, variables: dict[str, Any], field_name: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    next_token = None
    while True:
        payload = _graphql(query, {**variables, "limit": 1000, "nextToken": next_token})
        connection = payload.get(field_name) or {}
        records.extend(_decode_record(item) for item in connection.get("items") or [] if item)
        next_token = connection.get("nextToken")
        if not next_token:
            return records


def _get_record(model_name: str, record_id: Any) -> dict[str, Any] | None:
    if not record_id:
        return None
    field_name, fields = GET_FIELDS[model_name]
    query = f"""
query Get{model_name}($id: ID!) {{
  {field_name}(id: $id) {{ {fields} }}
}}
"""
    record = _graphql(query, {"id": record_id}).get(field_name)
    return _decode_record(record) if record else None


def _record_exists(model_name: str, record_id: str) -> bool:
    if not record_id:
        return False
    return bool(_get_record(model_name, record_id))


def _create_record(model_name: str, input_payload: dict[str, Any]) -> dict[str, Any]:
    query = f"""
mutation Create{model_name}($input: Create{model_name}Input!) {{
  create{model_name}(input: $input) {{ id }}
}}
"""
    return _graphql(query, {"input": _prepare_input(model_name, input_payload)})


def _update_record(model_name: str, input_payload: dict[str, Any]) -> dict[str, Any]:
    query = f"""
mutation Update{model_name}($input: Update{model_name}Input!) {{
  update{model_name}(input: $input) {{ id }}
}}
"""
    return _graphql(query, {"input": _prepare_input(model_name, input_payload)})


def _upload_model_attachment(attachment: dict[str, Any], body: str) -> None:
    body_bytes = body.encode("utf-8")
    upload_args = {
        "ownerKind": attachment["ownerKind"],
        "ownerId": attachment["ownerId"],
        "ownerLineageId": attachment.get("ownerLineageId"),
        "ownerVersionNumber": attachment.get("ownerVersionNumber"),
        "ownerVersionKey": attachment.get("ownerVersionKey"),
        "role": attachment["role"],
        "sortKey": attachment["sortKey"],
        "filename": attachment["filename"],
        "mediaType": attachment["mediaType"],
        "byteSize": len(body_bytes),
        "sha256": hashlib.sha256(body_bytes).hexdigest(),
        "importRunId": attachment.get("importRunId"),
        "status": attachment.get("status") or "active",
    }
    slot = (_graphql(CREATE_MODEL_ATTACHMENT_UPLOAD_MUTATION, upload_args).get("createModelAttachmentUpload") or {})
    upload_url = slot.get("uploadUrl")
    if not upload_url:
        raise RuntimeError("createModelAttachmentUpload did not return uploadUrl")
    headers = _jsonish(slot.get("requiredHeaders")) or {}
    request = urllib.request.Request(upload_url, data=body_bytes, headers={str(key): str(value) for key, value in headers.items()}, method="PUT")
    with urllib.request.urlopen(request, timeout=120) as response:  # nosec B310 - configured signed URL
        if response.status >= 400:
            raise RuntimeError(f"ModelAttachment upload failed with HTTP {response.status}")
    _graphql(COMPLETE_MODEL_ATTACHMENT_UPLOAD_MUTATION, {"uploadId": slot["uploadId"], **upload_args})


def _download_attachment_json(attachment_id: str) -> dict[str, Any]:
    slot = (_graphql(CREATE_MODEL_ATTACHMENT_DOWNLOAD_MUTATION, {"attachmentId": attachment_id}).get("createModelAttachmentDownload") or {})
    download_url = slot.get("downloadUrl")
    if not download_url:
        return {}
    request = urllib.request.Request(download_url, method="GET")
    with urllib.request.urlopen(request, timeout=60) as response:  # nosec B310 - configured signed URL
        payload = json.loads(response.read().decode("utf-8"))
    return payload if isinstance(payload, dict) else {}


def _graphql(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    endpoint = os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT", "").strip()
    token = os.environ.get("PAPYRUS_GRAPHQL_JWT", "").strip() or os.environ.get("PAPYRUS_KNOWLEDGE_QUERY_JWT", "").strip()
    if not endpoint:
        raise RuntimeError("PAPYRUS_GRAPHQL_ENDPOINT is required")
    if not token:
        raise RuntimeError("PAPYRUS_GRAPHQL_JWT is required")
    auth_prefix = os.environ.get("PAPYRUS_GRAPHQL_AUTH_PREFIX", "PapyrusJwt").strip()
    sanitized_token = re.sub(r"^Bearer\s+", "", token, flags=re.IGNORECASE)
    auth_header = f"{auth_prefix} {sanitized_token}" if auth_prefix else sanitized_token
    request = urllib.request.Request(
        endpoint,
        data=json.dumps({"query": query, "variables": variables}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": auth_header,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:  # nosec B310 - configured AppSync endpoint
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GraphQL request failed with HTTP {exc.code}: {detail[:500]}") from exc
    if payload.get("errors"):
        messages = "; ".join(str(error.get("message") or error) for error in payload["errors"])
        raise RuntimeError(f"GraphQL request failed: {messages}")
    return payload.get("data") or {}


def _resolve_section_keys(sections: list[str]) -> list[str]:
    source = sections or DEFAULT_SECTIONS
    result = []
    for section in source:
        key = str(section or "").strip()
        if not key:
            continue
        result.append(SECTION_ALIASES.get(key, key))
    return result


def section_research_lens(section_key: str) -> str:
    return SECTION_RESEARCH_LENSES.get(section_key, f"section-specific evidence, doctrine, and recent desk memory for {section_key}")


def semantic_state_key(kind: str, lineage_id: str) -> str:
    return f"{kind}#{lineage_id}#current"


def semantic_version_key(kind: str, object_id: str) -> str:
    return f"{kind}#{object_id}"


def _normalize_section_type(value: Any) -> str:
    text = str(value or "canonical").strip().lower()
    return "floating" if text == "rotating" else text


def _normalize_relation_key(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", "_")


def _safe_id(value: Any) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()))[:140] or _hash_short(value)


def _hash_stable(value: Any) -> str:
    return hashlib.sha256((value if isinstance(value, str) else json.dumps(value, sort_keys=True)).encode("utf-8")).hexdigest()


def _hash_short(value: Any) -> str:
    return _hash_stable(value)[:16]


def _now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _date_from_iso(value: str) -> str:
    parsed = _parse_datetime(value)
    return parsed.date().isoformat() if parsed else dt.date.today().isoformat()


def _timestamp_for_path(value: str) -> str:
    return re.sub(r"[^0-9TZ]", "", str(value)).removesuffix("Z") + "Z"


def _parse_datetime(value: Any) -> dt.datetime | None:
    if not value:
        return None
    text = str(value).strip()
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = dt.datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.UTC)
    except ValueError:
        return None


def _state_key(model_name: str) -> str:
    irregular = {
        "Category": "categories",
        "NewsroomSection": "newsroomSections",
        "AssignmentEvent": "assignmentEvents",
        "SemanticNode": "semanticNodes",
        "SemanticRelation": "semanticRelations",
        "ModelAttachment": "modelAttachments",
        "EditionItem": "editionItems",
    }
    if model_name in irregular:
        return irregular[model_name]
    key = model_name[:1].lower() + model_name[1:]
    return f"{key}s"
