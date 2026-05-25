from __future__ import annotations

import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content.assignments_workflow import (
    normalize_reporting_packet_bundle,
    reporting_packet_message_id,
    validate_reporting_packet,
)


class AssignmentsReportingWorkflowTests(unittest.TestCase):
    def test_normalize_reporting_packet_bundle_maps_fields(self) -> None:
        packet = normalize_reporting_packet_bundle(
            {
                "summary": "Reporting context packet",
                "section_key": "news",
                "edition_id": "edition-2026-05-25-v1",
                "recommended_angle": "Reader impact",
                "editor_recommendation": "brief",
                "coverage_gaps": ["Need another source."],
                "open_questions": ["What changed this week?"],
                "risk_flags": ["verify_fresh_source"],
                "accepted_reference_ids": ["reference-1-v1"],
                "proposed_references": [{"url": "https://example.com/new"}],
                "verification_needs": ["Verify external claim before selection."],
                "copywriter_brief": "Use accepted references and note uncertainty.",
                "source_trail": [{"source_kind": "knowledge_query", "query": "assignment-reporting-1 focus"}],
                "knowledge_queries": ["assignment-reporting-1 focus"],
                "papyrus_uris_inspected": ["papyrus://reference/reference-1"],
                "source_research_packet_id": "message-research-packet-1",
                "source_research_assignment_id": "assignment-research-1",
            },
            assignment={
                "id": "assignment-reporting-1",
                "assignmentTypeKey": "reporting.edition-candidate",
                "queueKey": "edition:edition-2026-05-25:section:news:lane:reporting",
                "sectionKey": "news",
            },
            assignment_meta={"reportingContextOrder": ["publication-doctrine", "section-doctrine"]},
        )

        self.assertEqual(packet["summary"], "Reporting context packet")
        self.assertEqual(packet["sectionKey"], "news")
        self.assertEqual(packet["editionId"], "edition-2026-05-25-v1")
        self.assertEqual(packet["editorRecommendation"], "brief")
        self.assertEqual(packet["acceptedReferenceIds"], ["reference-1-v1"])
        self.assertEqual(packet["knowledgeQueries"], ["assignment-reporting-1 focus"])
        self.assertEqual(packet["papyrusUrisInspected"], ["papyrus://reference/reference-1"])
        self.assertEqual(packet["sourceResearchPacketId"], "message-research-packet-1")
        self.assertEqual(packet["sourceResearchAssignmentId"], "assignment-research-1")
        self.assertEqual(packet["contextOrder"], ["publication-doctrine", "section-doctrine"])

    def test_validate_reporting_packet_rejects_select_without_evidence_or_verification(self) -> None:
        with self.assertRaisesRegex(ValueError, "select/brief requires accepted_reference_ids or verification_needs"):
            validate_reporting_packet(
                {
                    "summary": "Reporting packet",
                    "sectionKey": "news",
                    "editionId": "edition-2026-05-25-v1",
                    "recommendedAngle": "Reader impact",
                    "editorRecommendation": "select",
                    "copywriterBrief": "Draft after selection.",
                    "acceptedReferenceIds": [],
                    "proposedReferences": [],
                    "verificationNeeds": [],
                }
            )

    def test_validate_reporting_packet_requires_verification_for_proposals(self) -> None:
        with self.assertRaisesRegex(ValueError, "proposed_references require verification_needs"):
            validate_reporting_packet(
                {
                    "summary": "Reporting packet",
                    "sectionKey": "news",
                    "editionId": "edition-2026-05-25-v1",
                    "recommendedAngle": "Reader impact",
                    "editorRecommendation": "hold",
                    "copywriterBrief": "Draft after selection.",
                    "acceptedReferenceIds": [],
                    "proposedReferences": [{"url": "https://example.com/new"}],
                    "sourceTrail": [{"source_kind": "knowledge_query"}],
                    "verificationNeeds": [],
                }
            )

    def test_validate_reporting_packet_requires_knowledge_orientation_trace(self) -> None:
        with self.assertRaisesRegex(ValueError, "knowledge-orientation trace"):
            validate_reporting_packet(
                {
                    "summary": "Reporting packet",
                    "sectionKey": "news",
                    "editionId": "edition-2026-05-25-v1",
                    "recommendedAngle": "Reader impact",
                    "editorRecommendation": "hold",
                    "copywriterBrief": "Draft after selection.",
                    "acceptedReferenceIds": [],
                    "proposedReferences": [],
                    "verificationNeeds": [],
                    "sourceTrail": [],
                    "knowledgeQueries": [],
                    "papyrusUrisInspected": [],
                }
            )

    def test_validate_reporting_packet_allows_blocked_knowledge_orientation(self) -> None:
        validate_reporting_packet(
            {
                "summary": "Reporting packet",
                "sectionKey": "news",
                "editionId": "edition-2026-05-25-v1",
                "recommendedAngle": "Reader impact",
                "editorRecommendation": "hold",
                "copywriterBrief": "Draft after selection.",
                "acceptedReferenceIds": [],
                "proposedReferences": [],
                "verificationNeeds": [],
                "sourceTrail": [],
                "knowledgeQueries": [],
                "papyrusUrisInspected": [],
                "knowledgeBlockedReason": "knowledge_query_unavailable",
            }
        )

    def test_reporting_packet_message_id_uses_assignment_and_timestamp(self) -> None:
        first = reporting_packet_message_id(
            "assignment-reporting-1",
            created_at="2026-05-25T12:00:00Z",
            summary="First packet",
        )
        second = reporting_packet_message_id(
            "assignment-reporting-1",
            created_at="2026-05-25T12:05:00Z",
            summary="Second packet",
        )
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("message-reporting-context-packet-"))
        self.assertTrue(second.startswith("message-reporting-context-packet-"))


if __name__ == "__main__":
    unittest.main()
