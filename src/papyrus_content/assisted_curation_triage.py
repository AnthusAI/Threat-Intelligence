"""Assisted curation triage: automate around the decision, never the decision.

Builds a three-lane review queue (likely-accept / likely-reject / uncertain),
grounded rationales, near-duplicate clusters, and mechanical dispositions.

Mechanical stubs with no locatable source are **archived** (set aside, not
judged) so they do not poison rejection history used for lane calibration.
URI duplicates of already-judged sources may still be auto-rejected.
Acceptance always requires an explicit human action.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, TextIO
from urllib.parse import urlparse

from papyrus_newsroom import reference_actions as newsroom_reference_actions

from .env import PAPYRUS_ROOT
from .model_attachments import parse_jsonish
from .reference_exports import reference_curation_messages_by_reference_lineage
from .reference_policy import (
    SCOPE_TRAINING_NEGATIVE_REASON_CODES,
    normalize_reference_curation_status,
    reference_reason_code,
)

TRIAGE_LANES = ("uncertain", "likely_accept", "likely_reject")
# rule -> curation action + optional reject reason_code.
# mechanically_unavailable archives (not rejected) so rejection history stays editorial.
MECHANICAL_DISPOSITIONS = {
    "duplicate_of_accepted_uri": {"action": "reject", "reasonCode": "duplicate"},
    "prior_rejected_uri": {"action": "reject", "reasonCode": "duplicate"},
    "mechanically_unavailable": {"action": "archive", "reasonCode": ""},
}
# Backward-compatible alias used by older plan JSON / tests.
AUTO_REJECT_RULES = {
    rule: (spec["reasonCode"] or "unavailable") for rule, spec in MECHANICAL_DISPOSITIONS.items()
}

# Title Jaccard thresholds. Kept conservative so thin history does not overfit.
_TITLE_CLUSTER_JACCARD = 0.92
_LIKELY_ACCEPT_TITLE_JACCARD = 0.42
_LIKELY_REJECT_TITLE_JACCARD = 0.5
_MIN_TITLE_TOKEN_OVERLAP_FOR_DOMAIN = 2
_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "for",
        "from",
        "in",
        "of",
        "on",
        "or",
        "the",
        "to",
        "with",
        "using",
        "via",
    }
)


@dataclass
class TriageProspect:
    reference: dict[str, Any]
    lane: str
    rationale: str
    exploratory: bool = False
    cluster_id: str | None = None
    cluster_primary: bool = True
    cluster_size: int = 1
    cluster_sibling_ids: list[str] = field(default_factory=list)
    mechanical_rule: str | None = None
    mechanical_action: str | None = None
    mechanical_reason_code: str | None = None
    evidence: dict[str, Any] = field(default_factory=dict)

    @property
    def reference_id(self) -> str:
        return str(self.reference.get("id") or "")

    @property
    def auto_reject_rule(self) -> str | None:
        """Legacy alias — true only for reject dispositions."""
        return self.mechanical_rule if self.mechanical_action == "reject" else None

    def to_dict(self) -> dict[str, Any]:
        reference = self.reference
        return {
            "referenceId": self.reference_id,
            "lineageId": reference.get("lineageId"),
            "externalItemId": reference.get("externalItemId"),
            "title": reference.get("title"),
            "sourceUri": reference.get("sourceUri"),
            "lane": self.lane,
            "rationale": self.rationale,
            "exploratory": self.exploratory,
            "clusterId": self.cluster_id,
            "clusterPrimary": self.cluster_primary,
            "clusterSize": self.cluster_size,
            "clusterSiblingIds": list(self.cluster_sibling_ids),
            "mechanicalRule": self.mechanical_rule,
            "mechanicalAction": self.mechanical_action,
            "mechanicalReasonCode": self.mechanical_reason_code,
            # Compatibility keys for older plan consumers / CLI printers.
            "autoRejectRule": self.mechanical_rule if self.mechanical_action == "reject" else None,
            "autoArchiveRule": self.mechanical_rule if self.mechanical_action == "archive" else None,
            "autoRejectReasonCode": self.mechanical_reason_code if self.mechanical_action == "reject" else None,
            "evidence": self.evidence,
        }


def build_assisted_triage_plan(
    *,
    corpus_id: str,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    messages: list[dict[str, Any]] | None = None,
    relations: list[dict[str, Any]] | None = None,
    categories: list[dict[str, Any]] | None = None,
    max_pending: int | None = None,
) -> dict[str, Any]:
    """Build a deterministic triage plan from GraphQL records. Pure: no I/O."""
    current = [
        reference
        for reference in references
        if reference.get("versionState") == "current" and reference.get("corpusId") == corpus_id
    ]
    accepted = [
        reference
        for reference in current
        if normalize_reference_curation_status(reference.get("curationStatus")) == "accepted"
    ]
    rejected = [
        reference
        for reference in current
        if normalize_reference_curation_status(reference.get("curationStatus")) == "rejected"
    ]
    pending = [
        reference
        for reference in current
        if normalize_reference_curation_status(reference.get("curationStatus")) == "pending"
    ]
    pending.sort(key=lambda reference: str(reference.get("importedAt") or reference.get("createdAt") or ""), reverse=True)
    # max_pending caps the human-facing queue after full scan/scoring, not the scan itself.
    human_queue_limit = max_pending if max_pending is not None and max_pending > 0 else None

    attachments_by_lineage = _attachments_by_lineage(attachments)
    comments_by_lineage = reference_curation_messages_by_reference_lineage(messages or [], relations or [])
    rejected_by_uri = _index_by_normalized_uri(rejected)
    accepted_by_uri = _index_by_normalized_uri(accepted)
    accepted_index = [_reference_index_entry(reference) for reference in accepted]
    rejected_scope_index = [
        _reference_index_entry(reference)
        for reference in rejected
        if reference_reason_code(reference, comments_by_lineage.get(reference.get("lineageId"), []))
        in SCOPE_TRAINING_NEGATIVE_REASON_CODES
    ]
    accepted_by_lineage = {
        str(reference.get("lineageId") or reference.get("id") or ""): reference for reference in accepted
    }
    citation_links_by_lineage = _citation_links_by_lineage(relations or [], accepted_by_lineage)
    accepted_categories_by_lineage = _accepted_category_labels_by_lineage(
        relations or [],
        categories or [],
        accepted_by_lineage,
    )

    clusters = cluster_pending_references(pending)
    cluster_by_id = {cluster["clusterId"]: cluster for cluster in clusters}
    primary_ids = {cluster["primaryReferenceId"] for cluster in clusters}

    prospects: list[TriageProspect] = []
    for reference in pending:
        lineage_id = str(reference.get("lineageId") or "")
        reference_attachments = attachments_by_lineage.get(lineage_id, [])
        exploratory = is_exploratory_reference(reference)
        cluster = cluster_by_id.get(_cluster_id_for_reference(reference, clusters))
        cluster_id = cluster["clusterId"] if cluster else None
        cluster_size = int(cluster["size"]) if cluster else 1
        cluster_primary = (not cluster) or reference.get("id") in primary_ids
        sibling_ids = [
            sibling_id
            for sibling_id in (cluster.get("memberIds") if cluster else [])
            if sibling_id != reference.get("id")
        ]

        mechanical = detect_mechanical_disposition(
            reference,
            attachments=reference_attachments,
            accepted_by_uri=accepted_by_uri,
            rejected_by_uri=rejected_by_uri,
        )
        if mechanical:
            rule, action, reason_code, mech_evidence = mechanical
            prospects.append(
                TriageProspect(
                    reference=reference,
                    lane="likely_reject" if action == "reject" else "uncertain",
                    rationale=_mechanical_rationale(rule, mech_evidence, action=action),
                    exploratory=exploratory,
                    cluster_id=cluster_id,
                    cluster_primary=cluster_primary,
                    cluster_size=cluster_size,
                    cluster_sibling_ids=sibling_ids,
                    mechanical_rule=rule,
                    mechanical_action=action,
                    mechanical_reason_code=reason_code or None,
                    evidence=mech_evidence,
                )
            )
            continue

        lane, rationale, evidence = assign_review_lane(
            reference,
            accepted_index=accepted_index,
            rejected_scope_index=rejected_scope_index,
            exploratory=exploratory,
            cluster=cluster,
            cluster_primary=cluster_primary,
            citation_links=citation_links_by_lineage.get(lineage_id) or [],
            accepted_category_labels=accepted_categories_by_lineage,
        )
        prospects.append(
            TriageProspect(
                reference=reference,
                lane=lane,
                rationale=rationale,
                exploratory=exploratory,
                cluster_id=cluster_id,
                cluster_primary=cluster_primary,
                cluster_size=cluster_size,
                cluster_sibling_ids=sibling_ids,
                evidence=evidence,
            )
        )

    human_queue = [
        prospect
        for prospect in prospects
        if not prospect.mechanical_rule and prospect.cluster_primary
    ]
    human_queue.sort(key=_human_queue_sort_key)
    if human_queue_limit is not None:
        human_queue = human_queue[:human_queue_limit]
    mechanical = [prospect for prospect in prospects if prospect.mechanical_rule]
    lane_counts = {lane: 0 for lane in TRIAGE_LANES}
    for prospect in human_queue:
        lane_counts[prospect.lane] = lane_counts.get(prospect.lane, 0) + 1
    disposition_counts = {
        "archive": sum(1 for prospect in mechanical if prospect.mechanical_action == "archive"),
        "reject": sum(1 for prospect in mechanical if prospect.mechanical_action == "reject"),
    }

    mechanical_dicts = [prospect.to_dict() for prospect in mechanical]
    return {
        "schemaVersion": 1,
        "kind": "assisted-curation-triage-plan",
        "generatedAt": _utc_now(),
        "corpusId": corpus_id,
        "historySignal": {
            "acceptedCount": len(accepted),
            "rejectedCount": len(rejected),
            "scopeNegativeRejectedCount": len(rejected_scope_index),
            "thinHistory": len(rejected) == 0 or len(accepted) < 10,
        },
        "counts": {
            "pendingScanned": len(pending),
            "humanQueue": len(human_queue),
            "mechanicalDispositions": len(mechanical),
            "mechanicalArchives": disposition_counts["archive"],
            "mechanicalRejects": disposition_counts["reject"],
            # Compatibility alias — total mechanical dispositions (archives + rejects).
            "autoRejectCandidates": len(mechanical),
            "clusterCount": len(clusters),
            "lanes": lane_counts,
            "exploratoryExempted": sum(1 for prospect in human_queue if prospect.exploratory),
        },
        "clusters": clusters,
        "mechanicalDispositions": mechanical_dicts,
        # Compatibility alias for older CLI / plan readers.
        "autoRejectCandidates": mechanical_dicts,
        "humanQueue": [prospect.to_dict() for prospect in human_queue],
        "allProspects": [prospect.to_dict() for prospect in prospects],
        "guarantees": {
            "autoAcceptDisabled": True,
            "acceptanceRequiresExplicitHumanAction": True,
            "mechanicalDispositionsOnly": True,
            "mechanicalUnavailableUsesArchive": True,
            "mechanicalDispositionsLoggedAndReversible": True,
            "autoRejectMechanicalOnly": True,
            "autoRejectsLoggedAndReversible": True,
        },
    }


def cluster_pending_references(pending: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cluster near-duplicates; primary is the best-sourced member."""
    if not pending:
        return []
    parent = {str(reference.get("id")): str(reference.get("id")) for reference in pending if reference.get("id")}

    def find(node: str) -> str:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(left: str, right: str) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    by_uri: dict[str, list[str]] = defaultdict(list)
    by_doi: dict[str, list[str]] = defaultdict(list)
    by_title: dict[str, list[str]] = defaultdict(list)
    indexed = []
    for reference in pending:
        reference_id = str(reference.get("id") or "")
        if not reference_id:
            continue
        uri = normalize_source_uri(reference.get("sourceUri"))
        if uri:
            by_uri[uri].append(reference_id)
        doi = normalize_doi(reference)
        if doi:
            by_doi[doi].append(reference_id)
        title_key = normalize_title_key(reference.get("title"))
        tokens = title_tokens(reference.get("title"))
        if title_key and len(tokens) >= 3:
            by_title[title_key].append(reference_id)
        indexed.append((reference_id, tokens, reference))

    for group in (*by_uri.values(), *by_doi.values(), *by_title.values()):
        head = group[0]
        for other in group[1:]:
            union(head, other)

    # Soft near-duplicate pass for remaining singles with high title overlap.
    for index, (left_id, left_tokens, _) in enumerate(indexed):
        if len(left_tokens) < 4:
            continue
        for right_id, right_tokens, _ in indexed[index + 1 :]:
            if find(left_id) == find(right_id):
                continue
            if title_jaccard(left_tokens, right_tokens) >= _TITLE_CLUSTER_JACCARD:
                union(left_id, right_id)

    members_by_root: dict[str, list[dict[str, Any]]] = defaultdict(list)
    reference_by_id = {str(reference.get("id")): reference for reference in pending if reference.get("id")}
    for reference_id in parent:
        members_by_root[find(reference_id)].append(reference_by_id[reference_id])

    clusters: list[dict[str, Any]] = []
    for root, members in members_by_root.items():
        if len(members) < 2:
            continue
        ranked = sorted(members, key=source_quality_score, reverse=True)
        primary = ranked[0]
        cluster_id = f"cluster-{_stable_short(root)}"
        clusters.append(
            {
                "clusterId": cluster_id,
                "size": len(members),
                "primaryReferenceId": primary.get("id"),
                "primaryTitle": primary.get("title"),
                "memberIds": [member.get("id") for member in ranked],
                "memberTitles": [member.get("title") for member in ranked],
                "memberSourceUris": [member.get("sourceUri") for member in ranked],
            }
        )
    clusters.sort(key=lambda cluster: (-int(cluster["size"]), str(cluster["primaryReferenceId"])))
    return clusters


def detect_mechanical_disposition(
    reference: dict[str, Any],
    *,
    attachments: list[dict[str, Any]],
    accepted_by_uri: dict[str, dict[str, Any]],
    rejected_by_uri: dict[str, dict[str, Any]],
) -> tuple[str, str, str, dict[str, Any]] | None:
    """Return (rule, action, reason_code, evidence) for a mechanical disposition.

    `mechanically_unavailable` → archive (set aside, not judged).
    URI duplicates of already-judged sources → reject.
    """
    uri = normalize_source_uri(reference.get("sourceUri"))
    if uri and uri in accepted_by_uri:
        match = accepted_by_uri[uri]
        spec = MECHANICAL_DISPOSITIONS["duplicate_of_accepted_uri"]
        return (
            "duplicate_of_accepted_uri",
            spec["action"],
            spec["reasonCode"],
            {
                "matchedReferenceId": match.get("id"),
                "matchedTitle": match.get("title"),
                "sourceUri": uri,
            },
        )
    if uri and uri in rejected_by_uri:
        match = rejected_by_uri[uri]
        spec = MECHANICAL_DISPOSITIONS["prior_rejected_uri"]
        return (
            "prior_rejected_uri",
            spec["action"],
            spec["reasonCode"],
            {
                "matchedReferenceId": match.get("id"),
                "matchedTitle": match.get("title"),
                "sourceUri": uri,
            },
        )
    if is_mechanically_unavailable(reference, attachments):
        spec = MECHANICAL_DISPOSITIONS["mechanically_unavailable"]
        return (
            "mechanically_unavailable",
            spec["action"],
            spec["reasonCode"],
            {
                "missingSourceUri": not bool(uri),
                "missingDoi": not bool(normalize_doi(reference)),
                "attachmentRoles": sorted(
                    {str(attachment.get("role") or "") for attachment in attachments if attachment.get("role")}
                ),
            },
        )
    return None


def detect_mechanical_auto_reject(
    reference: dict[str, Any],
    *,
    attachments: list[dict[str, Any]],
    accepted_by_uri: dict[str, dict[str, Any]],
    rejected_by_uri: dict[str, dict[str, Any]],
) -> tuple[str | None, str | None, dict[str, Any]]:
    """Legacy wrapper — prefer detect_mechanical_disposition."""
    result = detect_mechanical_disposition(
        reference,
        attachments=attachments,
        accepted_by_uri=accepted_by_uri,
        rejected_by_uri=rejected_by_uri,
    )
    if not result:
        return None, None, {}
    rule, _action, reason_code, evidence = result
    return rule, reason_code or None, evidence


def assign_review_lane(
    reference: dict[str, Any],
    *,
    accepted_index: list[dict[str, Any]],
    rejected_scope_index: list[dict[str, Any]],
    exploratory: bool,
    cluster: dict[str, Any] | None,
    cluster_primary: bool,
    citation_links: list[dict[str, Any]] | None = None,
    accepted_category_labels: dict[str, list[str]] | None = None,
) -> tuple[str, str, dict[str, Any]]:
    """Assign a human-review lane. Never accepts. Exploratory skips history scoring."""
    tokens = title_tokens(reference.get("title"))
    summary_tokens = _reference_summary_tokens(reference)
    domain = source_domain(reference.get("sourceUri"))
    evidence: dict[str, Any] = {"exploratory": exploratory}
    registration_note = _reference_registration_note(reference)
    citation_links = list(citation_links or [])
    accepted_category_labels = accepted_category_labels or {}

    def _done(lane: str, rationale: str, extra_evidence: dict[str, Any] | None = None) -> tuple[str, str, dict[str, Any]]:
        merged = {**evidence, **(extra_evidence or {})}
        if registration_note:
            merged["registrationNote"] = registration_note
        if citation_links:
            merged["citationLinks"] = citation_links
        return lane, _with_registration_note(rationale, registration_note), merged

    if exploratory:
        rationale = (
            "Labeled exploratory — exempt from history-based lane assignment; "
            "review as uncertain so past accept/reject patterns do not suppress discovery."
        )
        if cluster and not cluster_primary:
            rationale += (
                f" Near-duplicate of cluster {cluster['clusterId']} "
                f"(primary {cluster['primaryReferenceId']})."
            )
        return _done("uncertain", rationale)

    best_accept = _best_similarity(tokens, domain, accepted_index, summary_tokens=summary_tokens)
    best_reject = _best_similarity(tokens, domain, rejected_scope_index)
    if best_accept and (
        best_accept["score"] > 0
        or best_accept.get("sharedDomain")
        or best_accept.get("summaryOverlap", 0) > 0
    ):
        evidence["acceptedMatch"] = best_accept
    if best_reject and (best_reject["score"] > 0 or best_reject.get("sharedDomain")):
        evidence["rejectedMatch"] = best_reject

    if best_reject and best_reject["score"] >= _LIKELY_REJECT_TITLE_JACCARD:
        if not best_accept or best_reject["score"] >= ((best_accept or {}).get("score") or 0) + 0.05:
            return _done(
                "likely_reject",
                (
                    f"Title closely matches previously rejected out-of-scope reference "
                    f"“{best_reject['title']}” ({best_reject['referenceId']}; "
                    f"jaccard={best_reject['score']:.2f}). Confirm before rejecting."
                ),
            )

    if best_accept and (
        best_accept["score"] >= _LIKELY_ACCEPT_TITLE_JACCARD
        or (
            best_accept.get("sharedDomain")
            and best_accept.get("tokenOverlap", 0) >= _MIN_TITLE_TOKEN_OVERLAP_FOR_DOMAIN
        )
    ):
        parts = [
            f"Overlaps accepted reference “{best_accept['title']}” ({best_accept['referenceId']})"
        ]
        if best_accept.get("sharedDomain"):
            parts.append(f"shared domain {best_accept['domain']}")
        if best_accept.get("overlappingTokens"):
            parts.append("shared tokens: " + ", ".join(best_accept["overlappingTokens"][:6]))
        parts.append(f"title jaccard={best_accept['score']:.2f}")
        return _done("likely_accept", "; ".join(parts) + ". Human accept still required.")

    if cluster and cluster_primary and int(cluster.get("size") or 0) > 1:
        corpus_lead = _corpus_connection_lead(
            reference,
            best_accept=best_accept,
            citation_links=citation_links,
            accepted_category_labels=accepted_category_labels,
            accepted_index=accepted_index,
        )
        cluster_sentence = (
            f"Best-sourced member of near-duplicate cluster {cluster['clusterId']} "
            f"({cluster['size']} members). Sibling titles: "
            + "; ".join(str(title) for title in (cluster.get("memberTitles") or [])[:3] if title)
            + "."
        )
        rationale = f"{corpus_lead} {cluster_sentence}".strip() if corpus_lead else (
            cluster_sentence + " No strong accepted/rejected history match."
        )
        return _done(
            "uncertain",
            rationale,
            {"clusterId": cluster["clusterId"], "clusterSize": cluster["size"]},
        )

    if domain and accepted_index:
        accepted_domains = sorted({entry["domain"] for entry in accepted_index if entry.get("domain")})
        if domain in accepted_domains:
            match = next(entry for entry in accepted_index if entry.get("domain") == domain)
            return _done(
                "uncertain",
                (
                    f"Same domain as accepted reference “{match['title']}” ({match['referenceId']}) "
                    f"but title overlap is weak; treat as uncertain rather than likely-accept."
                ),
                {
                    "sharedDomainOnly": domain,
                    "acceptedMatch": {
                        "referenceId": match["referenceId"],
                        "title": match["title"],
                        "domain": match["domain"],
                        "score": 0.0,
                        "sharedDomain": True,
                        "tokenOverlap": 0,
                        "overlappingTokens": [],
                    },
                },
            )

    corpus_lead = _corpus_connection_lead(
        reference,
        best_accept=best_accept,
        citation_links=citation_links,
        accepted_category_labels=accepted_category_labels,
        accepted_index=accepted_index,
    )
    if corpus_lead:
        return _done("uncertain", corpus_lead)

    facts: list[str] = []
    if domain:
        facts.append(f"source domain {domain}")
    elif normalize_doi(reference):
        facts.append(f"DOI {normalize_doi(reference)}")
    else:
        facts.append("no sourceUri")
    external = str(reference.get("externalItemId") or "")
    if external.startswith("citation:"):
        facts.append(f"citation stub {external}")
    elif external:
        facts.append(f"item {external}")
    if accepted_index:
        facts.append(f"{len(accepted_index)} accepted refs available for comparison; none matched closely")
    else:
        facts.append("accepted set is empty — no positive history signal")
    return _done(
        "uncertain",
        "Needs editorial judgment. Concrete facts: " + "; ".join(facts) + ".",
    )


def _reference_registration_note(reference: dict[str, Any]) -> str | None:
    metadata = parse_jsonish(reference.get("metadata")) or {}
    if not isinstance(metadata, dict):
        metadata = {}
    for key in (
        "registration_note",
        "registrationNote",
        "ingestion_rationale",
        "ingestionRationale",
    ):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _with_registration_note(rationale: str, registration_note: str | None) -> str:
    note = str(registration_note or "").strip()
    if not note:
        return rationale
    clipped = note if len(note) <= 280 else note[:277].rstrip() + "…"
    # Corpus-connection lead first; ingestion note is supporting context (kanbus-ec5555).
    return f"{rationale} Ingestion note: {clipped}"


def _corpus_connection_lead(
    reference: dict[str, Any],
    *,
    best_accept: dict[str, Any] | None,
    citation_links: list[dict[str, Any]],
    accepted_category_labels: dict[str, list[str]],
    accepted_index: list[dict[str, Any]],
) -> str:
    """1–2 sentences grounded in checkable accepted-corpus facts for uncertain leads."""
    sentences: list[str] = []
    if citation_links:
        link = citation_links[0]
        direction = str(link.get("direction") or "cites")
        title = str(link.get("title") or "").strip() or "accepted reference"
        ref_id = str(link.get("referenceId") or "").strip()
        if direction == "cited_by":
            sentences.append(f"Cited by accepted reference “{title}” ({ref_id}).")
        else:
            sentences.append(f"Cites accepted reference “{title}” ({ref_id}).")

    if best_accept and (
        best_accept.get("summaryOverlap", 0) >= 2
        or (best_accept.get("score") or 0) > 0
        or best_accept.get("sharedDomain")
    ):
        title = str(best_accept.get("title") or "").strip() or "accepted reference"
        ref_id = str(best_accept.get("referenceId") or "").strip()
        summary_overlap = int(best_accept.get("summaryOverlap") or 0)
        score = float(best_accept.get("score") or 0.0)
        if summary_overlap >= 2:
            shared = ", ".join((best_accept.get("summaryOverlappingTokens") or [])[:5])
            sentences.append(
                f"Summary overlap with accepted “{title}” ({ref_id})"
                + (f" on {shared}." if shared else ".")
            )
        elif score > 0:
            sentences.append(
                f"Closest accepted neighbor is “{title}” ({ref_id}; title jaccard={score:.2f}) — "
                "not strong enough for likely-accept."
            )
        elif best_accept.get("sharedDomain"):
            sentences.append(
                f"Shares publisher domain with accepted “{title}” ({ref_id}) but title overlap is weak."
            )

    if not sentences and accepted_index:
        # Coverage gap: name a few accepted category labels the corpus already owns.
        label_counts: dict[str, int] = defaultdict(int)
        for labels in accepted_category_labels.values():
            for label in labels:
                label_counts[label] += 1
        if label_counts:
            top = sorted(label_counts.items(), key=lambda item: (-item[1], item[0]))[:3]
            label_text = ", ".join(f"“{name}”" for name, _count in top)
            sentences.append(
                f"No close accepted neighbor; corpus coverage today clusters around {label_text} "
                f"across {len(accepted_index)} accepted refs — judge whether this fills a gap."
            )
        else:
            domain = source_domain(reference.get("sourceUri"))
            domain_bit = f" from {domain}" if domain else ""
            sentences.append(
                f"No close accepted neighbor among {len(accepted_index)} accepted refs{domain_bit}; "
                "treat as a potential coverage gap pending editorial scope check."
            )

    return " ".join(sentences[:2]).strip()


def _reference_summary_tokens(reference: dict[str, Any]) -> set[str]:
    metadata = parse_jsonish(reference.get("metadata")) or {}
    if not isinstance(metadata, dict):
        metadata = {}
    chunks: list[str] = []
    for key in ("summary", "abstract", "deck", "subtitle"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            chunks.append(value)
    # Nested papyrus / generated metadata shapes.
    for container_key in ("generated", "papyrus"):
        container = metadata.get(container_key)
        if isinstance(container, dict):
            for key in ("summary", "abstract"):
                value = container.get(key)
                if isinstance(value, str) and value.strip():
                    chunks.append(value)
    return title_tokens(" ".join(chunks))


def _citation_links_by_lineage(
    relations: list[dict[str, Any]],
    accepted_by_lineage: dict[str, dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Map pending lineage -> accepted citation neighbors (cites / cited_by)."""
    links: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for relation in relations:
        if str(relation.get("relationState") or "") != "current":
            continue
        predicate = str(relation.get("relationTypeKey") or relation.get("predicate") or "").strip()
        if predicate != "cites":
            continue
        subject = str(relation.get("subjectLineageId") or "").strip()
        obj = str(relation.get("objectLineageId") or "").strip()
        if not subject or not obj:
            continue
        if obj in accepted_by_lineage and subject not in accepted_by_lineage:
            accepted = accepted_by_lineage[obj]
            links[subject].append(
                {
                    "direction": "cites",
                    "referenceId": accepted.get("id"),
                    "lineageId": obj,
                    "title": accepted.get("title"),
                }
            )
        if subject in accepted_by_lineage and obj not in accepted_by_lineage:
            accepted = accepted_by_lineage[subject]
            links[obj].append(
                {
                    "direction": "cited_by",
                    "referenceId": accepted.get("id"),
                    "lineageId": subject,
                    "title": accepted.get("title"),
                }
            )
    return links


def _accepted_category_labels_by_lineage(
    relations: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    accepted_by_lineage: dict[str, dict[str, Any]],
) -> dict[str, list[str]]:
    category_by_lineage = {
        str(category.get("lineageId") or category.get("id") or ""): category
        for category in categories
        if str(category.get("versionState") or "current") == "current"
    }
    labels: dict[str, list[str]] = defaultdict(list)
    for relation in relations:
        if str(relation.get("relationState") or "") != "current":
            continue
        predicate = str(relation.get("relationTypeKey") or relation.get("predicate") or "").strip()
        if predicate not in {"classified_as", "authoritative_label"}:
            continue
        if relation.get("subjectKind") != "reference" or relation.get("objectKind") != "category":
            continue
        subject = str(relation.get("subjectLineageId") or "").strip()
        if subject not in accepted_by_lineage:
            continue
        category = category_by_lineage.get(str(relation.get("objectLineageId") or "").strip())
        if not category:
            continue
        label = str(category.get("label") or category.get("categoryKey") or category.get("id") or "").strip()
        if label and label not in labels[subject]:
            labels[subject].append(label)
    return labels


def is_exploratory_reference(reference: dict[str, Any]) -> bool:
    metadata = parse_jsonish(reference.get("metadata")) or {}
    if not isinstance(metadata, dict):
        metadata = {}
    for key in ("exploratory", "isExploratory", "exploratoryProspect"):
        if metadata.get(key) in {True, "true", "1", "yes"}:
            return True
    provenance = str(metadata.get("provenance") or reference.get("provenance") or "").lower()
    source = str(metadata.get("source") or metadata.get("discoverySource") or "").lower()
    blob = f"{provenance} {source}"
    return "exploratory" in blob


def is_mechanically_unavailable(reference: dict[str, Any], attachments: list[dict[str, Any]]) -> bool:
    if normalize_source_uri(reference.get("sourceUri")):
        return False
    if normalize_doi(reference):
        return False
    usable_roles = {"source", "extracted_text", "extracted_text_raw", "pdf", "html"}
    for attachment in attachments:
        role = str(attachment.get("role") or "").lower()
        if role in usable_roles and (attachment.get("storagePath") or attachment.get("sourceUri")):
            return False
    if reference.get("storagePath") or reference.get("corpusStoragePath"):
        return False
    return True


def source_quality_score(reference: dict[str, Any]) -> tuple[int, int, int, str]:
    """Higher is better-sourced for cluster primary selection."""
    uri = 1 if normalize_source_uri(reference.get("sourceUri")) else 0
    doi = 1 if normalize_doi(reference) else 0
    title = 1 if str(reference.get("title") or "").strip() else 0
    # Prefer non-citation stubs, then stable id for determinism.
    external = str(reference.get("externalItemId") or "")
    not_citation_stub = 0 if external.startswith("citation:") else 1
    return (uri + doi, not_citation_stub, title, str(reference.get("id") or ""))


def normalize_source_uri(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if not parsed.scheme and not parsed.netloc:
        return text.lower().rstrip("/")
    host = (parsed.netloc or "").lower().removeprefix("www.")
    path = (parsed.path or "").rstrip("/")
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{parsed.scheme.lower()}://{host}{path}{query}"


def source_domain(value: Any) -> str:
    uri = normalize_source_uri(value)
    if not uri:
        return ""
    parsed = urlparse(uri)
    return (parsed.netloc or "").lower().removeprefix("www.")


def normalize_doi(reference: dict[str, Any]) -> str:
    metadata = parse_jsonish(reference.get("metadata")) or {}
    if not isinstance(metadata, dict):
        metadata = {}
    candidates = [
        reference.get("doi"),
        metadata.get("doi"),
        metadata.get("DOI"),
        ((metadata.get("identifiers") or {}) if isinstance(metadata.get("identifiers"), dict) else {}).get("doi"),
    ]
    uri = str(reference.get("sourceUri") or "")
    if "doi.org/" in uri.lower():
        candidates.append(uri.lower().split("doi.org/", 1)[-1])
    for candidate in candidates:
        text = str(candidate or "").strip().lower()
        text = re.sub(r"^https?://(dx\.)?doi\.org/", "", text)
        text = text.removeprefix("doi:")
        if text.startswith("10."):
            return text
    return ""


def title_tokens(value: Any) -> set[str]:
    words = re.findall(r"[a-z0-9]+", str(value or "").lower())
    return {word for word in words if len(word) > 2 and word not in _STOPWORDS}


def normalize_title_key(value: Any) -> str:
    return " ".join(sorted(title_tokens(value)))


def title_jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    union = left | right
    if not union:
        return 0.0
    return len(left & right) / len(union)


def write_triage_plan(plan: dict[str, Any], *, run_dir: Path | None = None) -> Path:
    run_id = f"assisted-triage-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    directory = run_dir or (PAPYRUS_ROOT / ".papyrus-runs" / run_id)
    directory.mkdir(parents=True, exist_ok=True)
    plan = {
        **plan,
        "runId": run_id,
        "runDir": str(directory),
    }
    manifest_path = directory / "plan.json"
    manifest_path.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (directory / "human_queue.jsonl").write_text(
        "".join(json.dumps(item, sort_keys=True) + "\n" for item in plan.get("humanQueue") or []),
        encoding="utf-8",
    )
    dispositions = plan.get("mechanicalDispositions") or plan.get("autoRejectCandidates") or []
    (directory / "mechanical_dispositions.jsonl").write_text(
        "".join(json.dumps(item, sort_keys=True) + "\n" for item in dispositions),
        encoding="utf-8",
    )
    # Compatibility filename for older tooling.
    (directory / "auto_reject_candidates.jsonl").write_text(
        "".join(json.dumps(item, sort_keys=True) + "\n" for item in dispositions),
        encoding="utf-8",
    )
    return manifest_path


def load_triage_plan(path: str | Path) -> dict[str, Any]:
    manifest = Path(path)
    if manifest.is_dir():
        manifest = manifest / "plan.json"
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("kind") != "assisted-curation-triage-plan":
        raise ValueError(f"Not an assisted triage plan: {manifest}")
    return payload


def apply_mechanical_dispositions(
    graphql: Any,
    plan: dict[str, Any],
    *,
    actor_label: str = "Papyrus assisted triage",
    dry_run: bool = True,
    limit: int | None = None,
) -> dict[str, Any]:
    """Apply mechanical archive/reject dispositions from a plan. Never accepts."""
    if plan.get("guarantees", {}).get("autoAcceptDisabled") is not True:
        raise ValueError("Refusing to apply mechanical dispositions from a plan that does not disable auto-accept.")
    candidates = list(plan.get("mechanicalDispositions") or plan.get("autoRejectCandidates") or [])
    if limit is not None and limit >= 0:
        candidates = candidates[:limit]
    results: list[dict[str, Any]] = []
    for candidate in candidates:
        rule = str(
            candidate.get("mechanicalRule")
            or candidate.get("autoArchiveRule")
            or candidate.get("autoRejectRule")
            or ""
        )
        action = str(candidate.get("mechanicalAction") or "").strip().lower()
        if not action:
            action = str((MECHANICAL_DISPOSITIONS.get(rule) or {}).get("action") or "reject")
        if action not in {"archive", "reject"}:
            raise ValueError(f"Unsupported mechanical action {action!r} for rule {rule!r}.")
        reason_code = str(
            candidate.get("mechanicalReasonCode")
            or candidate.get("autoRejectReasonCode")
            or (MECHANICAL_DISPOSITIONS.get(rule) or {}).get("reasonCode")
            or ""
        )
        reference_id = str(candidate.get("referenceId") or "")
        label = "auto-archive" if action == "archive" else "auto-reject"
        note = (f"[assisted-triage {label}:{rule}] {candidate.get('rationale') or ''}").strip()
        entry = {
            "referenceId": reference_id,
            "mechanicalRule": rule,
            "mechanicalAction": action,
            "reasonCode": reason_code or None,
            "dryRun": dry_run,
            "rationale": candidate.get("rationale"),
        }
        if dry_run:
            entry["status"] = "planned"
            results.append(entry)
            continue
        review_kwargs: dict[str, Any] = {
            "reference_id": reference_id,
            "action": action,
            "note": note,
            "actor_label": actor_label,
            "reason_code": reason_code,
        }
        if action == "archive":
            review_kwargs["auto_archive_rule"] = rule
        else:
            review_kwargs["auto_reject_rule"] = rule
        review = newsroom_reference_actions.review_reference_curation(graphql, **review_kwargs)
        entry.update(
            {
                "status": review.get("status") or ("archived" if action == "archive" else "rejected"),
                "messageId": review.get("messageId"),
                "action": review.get("action"),
            }
        )
        results.append(entry)

    audit = {
        "kind": "assisted-curation-mechanical-disposition-audit",
        "generatedAt": _utc_now(),
        "dryRun": dry_run,
        "planRunId": plan.get("runId"),
        "count": len(results),
        "archiveCount": sum(1 for row in results if row.get("mechanicalAction") == "archive"),
        "rejectCount": sum(1 for row in results if row.get("mechanicalAction") == "reject"),
        "results": results,
    }
    run_dir = Path(plan["runDir"]) if plan.get("runDir") else None
    if run_dir:
        run_dir.mkdir(parents=True, exist_ok=True)
        suffix = "dry-run" if dry_run else "applied"
        (run_dir / f"mechanical_dispositions.{suffix}.json").write_text(
            json.dumps(audit, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        # Compatibility filename.
        (run_dir / f"auto_rejects.{suffix}.json").write_text(
            json.dumps(audit, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return audit


def apply_mechanical_auto_rejects(
    graphql: Any,
    plan: dict[str, Any],
    *,
    actor_label: str = "Papyrus assisted triage",
    dry_run: bool = True,
    limit: int | None = None,
) -> dict[str, Any]:
    """Compatibility alias for apply_mechanical_dispositions."""
    return apply_mechanical_dispositions(
        graphql,
        plan,
        actor_label=actor_label,
        dry_run=dry_run,
        limit=limit,
    )


def list_mechanical_dispositions(
    *,
    references: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    corpus_id: str | None = None,
) -> list[dict[str, Any]]:
    """Enumerate current mechanical archives and rejects (reversible)."""
    comments_by_lineage = reference_curation_messages_by_reference_lineage(messages, relations)
    rows: list[dict[str, Any]] = []
    for reference in references:
        if reference.get("versionState") != "current":
            continue
        if corpus_id and reference.get("corpusId") != corpus_id:
            continue
        status = normalize_reference_curation_status(reference.get("curationStatus"))
        if status not in {"rejected", "archived"}:
            continue
        lineage_id = reference.get("lineageId")
        auto_messages = [
            message
            for message in comments_by_lineage.get(lineage_id, [])
            if _message_mechanical_rule(message)
        ]
        if not auto_messages:
            continue
        latest = sorted(auto_messages, key=lambda message: str(message.get("createdAt") or ""), reverse=True)[0]
        metadata = parse_jsonish(latest.get("metadata")) or {}
        rule = _message_mechanical_rule(latest)
        action = "archive" if metadata.get("autoArchive") or status == "archived" else "reject"
        if metadata.get("action") in {"archive", "reject"}:
            action = str(metadata.get("action"))
        rows.append(
            {
                "referenceId": reference.get("id"),
                "lineageId": lineage_id,
                "title": reference.get("title"),
                "sourceUri": reference.get("sourceUri"),
                "curationStatus": status,
                "mechanicalAction": action,
                "reasonCode": metadata.get("reasonCode") or reference_reason_code(reference, [latest]),
                "mechanicalRule": rule,
                "autoRejectRule": rule if action == "reject" else None,
                "autoArchiveRule": rule if action == "archive" else None,
                "messageId": latest.get("id"),
                "disposedAt": latest.get("createdAt") or reference.get("curationStatusUpdatedAt"),
                "rejectedAt": latest.get("createdAt") or reference.get("curationStatusUpdatedAt"),
                "reversible": True,
            }
        )
    rows.sort(key=lambda row: str(row.get("disposedAt") or ""), reverse=True)
    return rows


def list_auto_rejects(
    *,
    references: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    corpus_id: str | None = None,
) -> list[dict[str, Any]]:
    """Compatibility alias — includes mechanical archives and rejects."""
    return list_mechanical_dispositions(
        references=references,
        messages=messages,
        relations=relations,
        corpus_id=corpus_id,
    )


def reverse_mechanical_disposition(
    graphql: Any,
    *,
    reference_id: str,
    actor_label: str = "Papyrus assisted triage",
    note: str = "Reopened assisted-triage mechanical disposition.",
) -> dict[str, Any]:
    return newsroom_reference_actions.review_reference_curation(
        graphql,
        reference_id=reference_id,
        action="reopen",
        note=note,
        actor_label=actor_label,
        reason_code="",
    )


def reverse_auto_reject(
    graphql: Any,
    *,
    reference_id: str,
    actor_label: str = "Papyrus assisted triage",
    note: str = "Reopened assisted-triage mechanical disposition.",
) -> dict[str, Any]:
    """Compatibility alias for reverse_mechanical_disposition."""
    return reverse_mechanical_disposition(
        graphql,
        reference_id=reference_id,
        actor_label=actor_label,
        note=note,
    )


def run_triage_review_session(
    plan: dict[str, Any],
    *,
    graphql: Any | None = None,
    lanes: Iterable[str] | None = None,
    limit: int | None = None,
    dry_run: bool = True,
    actor_label: str = "Papyrus assisted triage",
    input_fn: Callable[[str], str] | None = None,
    output: TextIO | None = None,
    clock: Callable[[], float] | None = None,
) -> dict[str, Any]:
    """Keyboard-driven one-screen review. Accept only on explicit human 'a'."""
    if plan.get("guarantees", {}).get("acceptanceRequiresExplicitHumanAction") is not True:
        raise ValueError("Refusing review session for a plan that does not require explicit human acceptance.")
    selected_lanes = {lane.replace("-", "_") for lane in (lanes or TRIAGE_LANES)}
    queue = [
        item
        for item in (plan.get("humanQueue") or [])
        if str(item.get("lane") or "").replace("-", "_") in selected_lanes
    ]
    if limit is not None and limit >= 0:
        queue = queue[:limit]

    read = input_fn or input
    write = output.write if output is not None else print  # type: ignore[assignment]
    now = clock or time.monotonic
    decisions: list[dict[str, Any]] = []
    started = _utc_now()

    def emit(text: str = "") -> None:
        if output is not None:
            output.write(text + ("\n" if not text.endswith("\n") else ""))
        else:
            print(text)

    emit("assisted-triage review")
    emit("keys: a=accept  r=reject  s=skip  q=quit")
    emit("Acceptance is always an explicit human action. No auto-accept.")
    emit("")

    for index, item in enumerate(queue, start=1):
        shown_at = now()
        emit("=" * 72)
        emit(f"[{index}/{len(queue)}] lane={item.get('lane')} exploratory={bool(item.get('exploratory'))}")
        emit(f"RATIONALE: {item.get('rationale')}")
        emit(f"title: {item.get('title') or '-'}")
        emit(f"uri:   {item.get('sourceUri') or '-'}")
        emit(f"id:    {item.get('referenceId')}")
        if item.get("clusterSize", 1) > 1:
            emit(
                f"cluster: {item.get('clusterId')} size={item.get('clusterSize')} "
                f"siblings={', '.join(item.get('clusterSiblingIds') or [])}"
            )
        emit("")
        while True:
            answer = str(read("decision [a/r/s/q]> ") or "").strip().lower()
            if answer in {"a", "accept"}:
                action = "accept"
                reason_code = ""
                note = "Accepted during assisted-triage review session."
                break
            if answer in {"r", "reject"}:
                action = "reject"
                reason_code = str(read("reason-code [out_of_scope|policy_exclusion|duplicate|low_quality|unavailable|provenance|other]> ") or "").strip()
                note = str(read("note> ") or "").strip() or "Rejected during assisted-triage review session."
                break
            if answer in {"s", "skip"}:
                action = "skip"
                reason_code = ""
                note = ""
                break
            if answer in {"q", "quit"}:
                action = "quit"
                reason_code = ""
                note = ""
                break
            emit("Unrecognized key. Use a/r/s/q.")

        elapsed = max(0.0, now() - shown_at)
        decision = {
            "referenceId": item.get("referenceId"),
            "lane": item.get("lane"),
            "action": action,
            "reasonCode": reason_code or None,
            "note": note or None,
            "secondsToDecision": round(elapsed, 3),
            "decidedAt": _utc_now(),
            "dryRun": dry_run,
            "applied": False,
        }
        if action == "quit":
            decisions.append(decision)
            break
        if action in {"accept", "reject"} and not dry_run:
            if graphql is None:
                raise ValueError("graphql client required when applying review decisions.")
            # Accept is only reached after an explicit human keypress above.
            review = newsroom_reference_actions.review_reference_curation(
                graphql,
                reference_id=str(item.get("referenceId")),
                action=action,
                note=note,
                actor_label=actor_label,
                reason_code=reason_code,
            )
            decision["applied"] = True
            decision["messageId"] = review.get("messageId")
            decision["status"] = review.get("status")
        decisions.append(decision)

    session = summarize_review_session(decisions, started_at=started, plan_run_id=plan.get("runId"))
    run_dir = Path(plan["runDir"]) if plan.get("runDir") else None
    if run_dir:
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "review_session.json").write_text(
            json.dumps(session, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return session


def summarize_review_session(
    decisions: list[dict[str, Any]],
    *,
    started_at: str,
    plan_run_id: Any = None,
) -> dict[str, Any]:
    reviewed = [decision for decision in decisions if decision.get("action") in {"accept", "reject", "skip"}]
    timed = [decision for decision in reviewed if isinstance(decision.get("secondsToDecision"), (int, float))]
    by_lane: dict[str, dict[str, int]] = defaultdict(lambda: {"reviewed": 0, "accepted": 0, "rejected": 0, "skipped": 0})
    for decision in reviewed:
        lane = str(decision.get("lane") or "uncertain")
        by_lane[lane]["reviewed"] += 1
        action = str(decision.get("action"))
        if action == "accept":
            by_lane[lane]["accepted"] += 1
        elif action == "reject":
            by_lane[lane]["rejected"] += 1
        elif action == "skip":
            by_lane[lane]["skipped"] += 1
    accept_rate_by_lane = {}
    for lane, counts in by_lane.items():
        decided = counts["accepted"] + counts["rejected"]
        accept_rate_by_lane[lane] = (counts["accepted"] / decided) if decided else None
    return {
        "kind": "assisted-curation-review-session",
        "startedAt": started_at,
        "completedAt": _utc_now(),
        "planRunId": plan_run_id,
        "metrics": {
            "prospectsReviewed": len(reviewed),
            "accepted": sum(1 for decision in reviewed if decision.get("action") == "accept"),
            "rejected": sum(1 for decision in reviewed if decision.get("action") == "reject"),
            "skipped": sum(1 for decision in reviewed if decision.get("action") == "skip"),
            "meanSecondsToDecision": (sum(float(d["secondsToDecision"]) for d in timed) / len(timed)) if timed else None,
            "acceptRateByLane": accept_rate_by_lane,
            "countsByLane": dict(by_lane),
        },
        "decisions": decisions,
        "guarantees": {
            "autoAcceptDisabled": True,
            "acceptanceRequiresExplicitHumanAction": True,
        },
    }


def _best_similarity(
    tokens: set[str],
    domain: str,
    index: list[dict[str, Any]],
    *,
    summary_tokens: set[str] | None = None,
) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    summary_tokens = summary_tokens or set()
    for entry in index:
        score = title_jaccard(tokens, entry["tokens"])
        overlap = sorted(tokens & entry["tokens"])
        shared_domain = bool(domain and entry.get("domain") and domain == entry["domain"])
        entry_summary = entry.get("summaryTokens") or set()
        summary_overlap_tokens = sorted(summary_tokens & entry_summary) if summary_tokens and entry_summary else []
        summary_overlap = len(summary_overlap_tokens)
        if score <= 0 and not shared_domain and summary_overlap < 2:
            continue
        candidate = {
            "referenceId": entry["referenceId"],
            "title": entry["title"],
            "score": score,
            "tokenOverlap": len(overlap),
            "overlappingTokens": overlap,
            "sharedDomain": shared_domain,
            "domain": entry.get("domain") or "",
            "summaryOverlap": summary_overlap,
            "summaryOverlappingTokens": summary_overlap_tokens,
        }
        rank = (score, summary_overlap, 1 if shared_domain else 0, len(overlap))
        best_rank = (
            (
                best["score"],
                best.get("summaryOverlap") or 0,
                1 if best.get("sharedDomain") else 0,
                best.get("tokenOverlap") or 0,
            )
            if best
            else (-1, 0, 0, 0)
        )
        if rank > best_rank:
            best = candidate
    return best


def _reference_index_entry(reference: dict[str, Any]) -> dict[str, Any]:
    return {
        "referenceId": reference.get("id"),
        "title": reference.get("title"),
        "tokens": title_tokens(reference.get("title")),
        "summaryTokens": _reference_summary_tokens(reference),
        "domain": source_domain(reference.get("sourceUri")),
        "sourceUri": normalize_source_uri(reference.get("sourceUri")),
    }


def _attachments_by_lineage(attachments: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for attachment in attachments:
        lineage_id = attachment.get("referenceLineageId")
        if lineage_id:
            grouped[str(lineage_id)].append(attachment)
    return grouped


def _index_by_normalized_uri(references: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for reference in references:
        uri = normalize_source_uri(reference.get("sourceUri"))
        if uri and uri not in indexed:
            indexed[uri] = reference
    return indexed


def _cluster_id_for_reference(reference: dict[str, Any], clusters: list[dict[str, Any]]) -> str | None:
    reference_id = reference.get("id")
    for cluster in clusters:
        if reference_id in (cluster.get("memberIds") or []):
            return cluster.get("clusterId")
    return None


def _mechanical_rationale(rule: str, evidence: dict[str, Any], *, action: str = "reject") -> str:
    if rule == "duplicate_of_accepted_uri":
        return (
            f"Mechanical auto-reject: sourceUri already accepted as "
            f"“{evidence.get('matchedTitle')}” ({evidence.get('matchedReferenceId')})."
        )
    if rule == "prior_rejected_uri":
        return (
            f"Mechanical auto-reject: sourceUri previously rejected as "
            f"“{evidence.get('matchedTitle')}” ({evidence.get('matchedReferenceId')})."
        )
    if rule == "mechanically_unavailable":
        return (
            "Mechanical auto-archive: no sourceUri, DOI, corpus storage path, or "
            "source/extracted_text attachment — set aside (not judged) until resolvable. "
            "Does not enter rejection history."
        )
    label = "auto-archive" if action == "archive" else "auto-reject"
    return f"Mechanical {label}: {rule}."


def _human_queue_sort_key(prospect: TriageProspect) -> tuple[int, int, str]:
    lane_order = {"uncertain": 0, "likely_accept": 1, "likely_reject": 2}
    return (
        lane_order.get(prospect.lane, 9),
        0 if prospect.exploratory else 1,
        prospect.reference_id,
    )


def _message_mechanical_rule(message: dict[str, Any]) -> str | None:
    metadata = parse_jsonish(message.get("metadata")) or {}
    if not isinstance(metadata, dict):
        return None
    rule = (
        metadata.get("autoArchiveRule")
        or metadata.get("auto_archive_rule")
        or metadata.get("autoRejectRule")
        or metadata.get("auto_reject_rule")
    )
    if rule:
        return str(rule)
    if metadata.get("autoArchive") or metadata.get("auto_archive"):
        return str(metadata.get("autoArchiveRule") or "unspecified")
    if metadata.get("autoReject") or metadata.get("auto_reject") or metadata.get("mechanicalDisposition"):
        return str(metadata.get("autoRejectRule") or metadata.get("autoArchiveRule") or "unspecified")
    body = str(message.get("content") or message.get("body") or "")
    match = re.search(r"\[assisted-triage auto-(?:reject|archive):([^\]]+)\]", body)
    if match:
        return match.group(1).strip()
    return None


def _message_auto_reject_rule(message: dict[str, Any]) -> str | None:
    """Legacy alias for _message_mechanical_rule."""
    return _message_mechanical_rule(message)


def _stable_short(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())[-12:] or uuid.uuid4().hex[:12]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
