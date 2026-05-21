import json
import pathlib
import sys
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_newsroom import newsroom as papyrus_newsroom
from papyrus_newsroom import reference_curation_signals
from papyrus_newsroom import semantic as papyrus_semantic
from papyrus_newsroom import tactus_runtime
from papyrus_knowledge_query.uris import parse_papyrus_uri


class NewsroomToolTests(unittest.TestCase):
    def test_wrapper_shim_exports_newsroom_functions(self):
        import importlib.util

        module_path = REPO_ROOT / "procedures" / "newsroom" / "tools" / "papyrus_newsroom.py"
        spec = importlib.util.spec_from_file_location("papyrus_newsroom_wrapper", module_path)
        wrapper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(wrapper)

        self.assertTrue(callable(wrapper.papyrus_build_assignment_agent_context))
        self.assertTrue(callable(wrapper.main))

    def test_execute_tactus_exposes_single_papyrus_host_module(self):
        result = tactus_runtime.execute_tactus(
            'local api = api_list{}; local docs = docs_list{ namespace = "newsroom" }; return { api = api, docs = docs }'
        )

        self.assertTrue(result["ok"])
        self.assertIn("papyrus.assignment", result["value"]["api"])
        self.assertIn("context", result["value"]["api"]["papyrus.assignment"])
        self.assertIn("assignment_research_packet", result["value"]["api"]["papyrus.plan"])
        self.assertIn("doi_backfill_plan", result["value"]["api"]["papyrus.reference"])
        self.assertIn("quality_set", result["value"]["api"]["papyrus.reference"])
        self.assertIn("quality_assess", result["value"]["api"]["papyrus.reference"])
        self.assertIn("summarize", result["value"]["api"]["papyrus.reference"])
        self.assertIn("list", result["value"]["api"]["papyrus.reference"])
        self.assertIn("summaries", result["value"]["api"]["papyrus.reference"])
        self.assertIn("query", result["value"]["api"]["papyrus.knowledge"])
        self.assertIn("resolve_uri", result["value"]["api"]["papyrus"])
        self.assertEqual(
            result["api_calls"],
            ["papyrus.api.list", "papyrus.docs.list"],
        )

    def test_parse_papyrus_uri_supports_agent_visible_kinds(self):
        cases = {
            "papyrus://reference/reference-1": ("reference", "reference-1"),
            "papyrus://item/item-1": ("item", "item-1"),
            "papyrus://category/category-1": ("category", "category-1"),
            "papyrus://semanticNode/node-1": ("semanticNode", "node-1"),
            "papyrus://message/message-1": ("message", "message-1"),
            "papyrus://assignment/assignment-1": ("assignment", "assignment-1"),
        }
        for uri, expected in cases.items():
            with self.subTest(uri=uri):
                parsed = parse_papyrus_uri(uri)
                self.assertEqual((parsed["kind"], parsed["id"]), expected)
                self.assertEqual(parsed["lineageId"], expected[1])
                self.assertEqual(parsed["objectUri"], uri)

    def test_parse_papyrus_uri_rejects_invalid_uri(self):
        for uri in ["https://reference/reference-1", "papyrus://unknown/object-1", "papyrus://reference/"]:
            with self.subTest(uri=uri):
                with self.assertRaises(ValueError):
                    parse_papyrus_uri(uri)

    def test_execute_tactus_composes_dry_run_plan_code(self):
        result = tactus_runtime.execute_tactus(
            """
local assignment = {
  id = "assignment-123",
  type = "assignment",
  status = "dispatched",
  typeStatus = "assignment#dispatched",
  section = "Research",
  title = "Research Assignment",
  editorial = { newsroom = { assignment = { brief = "Research the topic." } } },
}
local research = {
  summary = "The topic has enough evidence for a focused brief.",
  corpus_key = "AI-ML-research",
  evidence_item_ids = { "research-001" },
  recommended_angle = "Use a workflow angle.",
}
return plan_research_update{ assignment_item = assignment, research = research }
"""
        )

        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["value"]["lifecycle"], "assignment-research")
        self.assertEqual(result["api_calls"], ["papyrus.plan.research_update"])

    def test_build_assignment_agent_context_assembles_live_desk_context(self):
        assignment_context = {
            "assignment": {
                "id": "assignment-live-123",
                "assignmentTypeKey": "research.edition-candidate",
                "queueKey": "edition:edition-2026-05-16:desk:topic-scaling:lane:analysis",
                "queueStatusKey": "edition:edition-2026-05-16:desk:topic-scaling:lane:analysis#open",
                "status": "open",
                "title": "Analysis candidate: Scaling Agents",
                "brief": "Compare how agentic systems are changing scaling workflows.",
                "categorySetId": "category-set-1",
                "metadata": {
                    "editionDate": "2026-05-16",
                    "deskCategoryKey": "topic.scaling",
                    "deskCategoryLineageId": "category-topic-scaling",
                    "focusCategoryKey": "topic.scaling-agents",
                    "focusCategoryLineageId": "category-topic-scaling-agents",
                    "focusCategoryTitle": "Scaling Agents",
                    "contextProfile": "analysis",
                    "contextTokenBudget": 6000,
                    "contextSources": ["doctrine", "focus-category", "desk-memory", "fresh-evidence"],
                    "referenceLineageIds": ["reference-1"],
                },
            },
            "doctrine": [
                {"scope": "publication", "kind": "mission", "label": "Editorial Mission", "body": ["Study systems as operational systems."]},
                {"scope": "desk", "kind": "policy", "label": "Scaling Desk Policy", "body": ["Prefer concrete operational evidence."]},
            ],
            "targets": [],
            "events": [],
        }
        categories = [
            {
                "id": "category-topic-scaling-v1",
                "lineageId": "category-topic-scaling",
                "categoryKey": "topic.scaling",
                "displayName": "Scaling",
                "depth": 0,
                "categorySetId": "category-set-1",
                "versionState": "current",
                "status": "accepted",
            },
            {
                "id": "category-topic-scaling-agents-v1",
                "lineageId": "category-topic-scaling-agents",
                "categoryKey": "topic.scaling-agents",
                "displayName": "Scaling Agents",
                "shortTitle": "Scaling Agents",
                "parentCategoryKey": "topic.scaling",
                "depth": 1,
                "categorySetId": "category-set-1",
                "versionState": "current",
                "status": "accepted",
            },
            {
                "id": "category-topic-foreign-v1",
                "lineageId": "category-topic-foreign",
                "categoryKey": "topic.foreign",
                "displayName": "Foreign Desk",
                "depth": 0,
                "categorySetId": "category-set-1",
                "versionState": "current",
                "status": "accepted",
            },
        ]
        assignments = [
            {
                "id": "assignment-match-1",
                "title": "Desk assignment",
                "brief": "Relevant desk memory.",
                "status": "completed",
                "updatedAt": "2026-05-15T12:00:00Z",
                "metadata": {
                    "deskCategoryKey": "topic.scaling",
                    "focusCategoryKey": "topic.scaling-agents",
                },
            },
            {
                "id": "assignment-foreign-1",
                "title": "Foreign Desk",
                "brief": "Should not leak into context.",
                "status": "open",
                "updatedAt": "2026-05-15T11:00:00Z",
                "metadata": {
                    "deskCategoryKey": "topic.foreign",
                    "focusCategoryKey": "topic.foreign",
                },
            },
        ]
        published_items = [
            {
                "id": "item-1",
                "headline": "Scaling Agents Review",
                "section": "topic.scaling",
                "publishedAt": "2026-05-14T12:00:00Z",
                "editorial": {"newsroom": {"draft": {"deskCategoryKey": "topic.scaling"}}},
            },
            {
                "id": "item-foreign",
                "headline": "Foreign Desk Review",
                "section": "topic.foreign",
                "publishedAt": "2026-05-14T11:00:00Z",
                "editorial": {"newsroom": {"draft": {"deskCategoryKey": "topic.foreign"}}},
            },
        ]

        class FakeSemanticClient:
            def references_for_category(self, category_lineage_id):
                if category_lineage_id == "category-topic-scaling-agents":
                    return {
                        "relations": [
                            {"subjectId": "reference-1-v1", "subjectLineageId": "reference-1"},
                            {"subjectId": "reference-2-v1", "subjectLineageId": "reference-2"},
                        ]
                    }
                return {"relations": []}

            def get_reference(self, reference_id):
                if reference_id == "reference-2-v1":
                    return {
                        "reference": {
                            "id": reference_id,
                            "lineageId": "reference-2",
                            "versionState": "current",
                            "curationStatus": "rejected",
                            "title": "Rejected Scope Memo",
                            "sourceUri": "https://example.com/rejected",
                            "sourcePublishedAt": "2026-05-13T12:00:00Z",
                        }
                    }
                accepted_ref = {
                    "id": reference_id,
                    "lineageId": "reference-1",
                    "versionState": "current",
                    "curationStatus": "accepted",
                    "title": "Scaling Agent Memo",
                    "sourceUri": "https://example.com/scaling-agent-memo",
                    "sourcePublishedAt": "2026-05-13T12:00:00Z",
                }
                return {"reference": accepted_ref}

            def list_reference_messages(self, reference_lineage_id):
                if reference_lineage_id != "reference-1":
                    return {"messages": []}
                return {
                    "messages": [
                        {
                            "id": "message-1",
                            "summary": "Desk note",
                            "body": "Operational evidence remains stronger than broad claims.",
                            "createdAt": "2026-05-13T13:00:00Z",
                        }
                    ]
                }

        def fake_compaction(*, blocks, profile_key, max_tokens):
            included = blocks[:6]
            return {
                "included_blocks": included,
                "dropped_blocks": blocks[6:],
                "section_token_counts": {"doctrine": 120, "taxonomy": 90, "desk_memory": 140, "fresh_evidence": 80},
                "text": "\n\n".join(block["text"] for block in included),
                "total_tokens": 430,
                "total_characters": 1800,
            }

        with mock.patch.object(papyrus_newsroom, "papyrus_get_assignment_context", return_value={"assignment_context": assignment_context}), \
             mock.patch.object(papyrus_newsroom, "_list_categories", return_value=categories), \
             mock.patch.object(papyrus_newsroom, "_list_category_keywords", return_value=[{"keyword": "scaling agents", "source": "accepted-category-set", "rank": 1}]), \
             mock.patch.object(papyrus_newsroom, "_list_assignments", return_value=assignments), \
             mock.patch.object(papyrus_newsroom, "_assignment_events_for_assignments", return_value=[{"id": "event-1", "assignmentId": "assignment-match-1", "eventType": "completed", "createdAt": "2026-05-15T13:00:00Z"}]), \
             mock.patch.object(papyrus_newsroom, "_recent_published_items", return_value=published_items), \
             mock.patch.object(papyrus_newsroom, "_semantic_client", return_value=FakeSemanticClient()), \
             mock.patch.object(papyrus_newsroom, "_build_biblicus_block_context_pack", side_effect=fake_compaction):
            result = papyrus_newsroom.papyrus_build_assignment_agent_context("assignment-live-123")

        context = result["assignment_agent_context"]
        self.assertEqual(context["deskCategoryKey"], "topic.scaling")
        self.assertEqual(context["focusCategoryKey"], "topic.scaling-agents")
        self.assertEqual(context["contextProfile"], "analysis")
        self.assertEqual(context["contextTokenBudget"], 6000)
        self.assertEqual(context["contextSources"], ["doctrine", "focus-category", "desk-memory", "fresh-evidence"])
        self.assertEqual(context["totalTokens"], 430)
        self.assertIn("Publication Doctrine", context["text"])
        self.assertIn("Desk Doctrine", context["text"])
        self.assertIn("Desk: Scaling", "\n".join(block["text"] for block in context["blocks"]))
        self.assertIn("Focus: Scaling Agents", "\n".join(block["text"] for block in context["blocks"]))
        self.assertIn("Scaling Agent Memo", "\n".join(block["text"] for block in context["blocks"]))
        self.assertNotIn("Rejected Scope Memo", "\n".join(block["text"] for block in context["blocks"]))
        self.assertNotIn("Foreign Desk", context["text"])

    def test_assignment_plan_uses_assignment_type(self):
        plan = papyrus_newsroom.build_assignment_record_plan(
            edition_id="edition-1",
            corpus_key="AI-ML-research",
            generated_at="2026-05-16T12:00:00Z",
            assignment_json=json.dumps(
                {
                    "title": "AI Agents Enter the Lab",
                    "brief": "Explain how agentic systems are changing research workflows.",
                    "angle": "Focus on practical scientific workflow changes.",
                    "research_track_key": "automated-publication-systems",
                    "research_lens": "agent-workflow",
                    "target_system_type": "research newsroom",
                    "category_key": "automated-scientific-discovery",
                    "evidence_item_ids": ["research-001"],
                    "recent_article_notes": ["Avoid yesterday's benchmark roundup."],
                }
            ),
        )

        item = plan["item"]
        self.assertTrue(plan["dryRun"])
        self.assertEqual(plan["lifecycle"], "assignment-dispatch")
        self.assertEqual(item["type"], "assignment")
        self.assertEqual(item["status"], "dispatched")
        self.assertEqual(item["typeStatus"], "assignment#dispatched")
        self.assertEqual(item["lineageId"], item["id"])
        self.assertEqual(item["versionNumber"], 1)
        self.assertEqual(item["versionState"], "current")
        self.assertRegex(item["contentHash"], r"^sha256:[a-f0-9]{64}$")
        self.assertEqual(item["body"], [])
        self.assertIsNone(item["publishedAt"])
        self.assertEqual(plan["editionItem"]["editionId"], "edition-1")
        self.assertEqual(plan["editionItem"]["editionLineageId"], "edition-1")
        self.assertEqual(plan["editionItem"]["itemLineageId"], item["lineageId"])
        self.assertEqual(plan["editionItem"]["placementKey"], "assignment:ai-agents-enter-the-lab")
        assignment = item["editorial"]["newsroom"]["assignment"]
        self.assertEqual(assignment["corpusKey"], "AI-ML-research")
        self.assertEqual(assignment["categoryKey"], "automated-scientific-discovery")
        self.assertEqual(assignment["evidenceItemIds"], ["research-001"])
        self.assertEqual(assignment["researchTrackKey"], "automated-publication-systems")
        self.assertEqual(assignment["researchLens"], "agent-workflow")
        self.assertEqual(assignment["targetSystemType"], "research newsroom")
        self.assertIn("execution traces or logs", assignment["expectedEvidenceClasses"])
        self.assertIn("Where does the system branch, retry, pause, or escalate to a human?", assignment["comparisonQuestions"])
        self.assertEqual(assignment["evidenceRubric"][0]["key"], "autonomy-scope")
        self.assertEqual(assignment["downstreamReporter"]["procedure"], "procedures/newsroom/reporter.tac")
        evidence_relation = next(record for record in plan["records"] if record["modelName"] == "SemanticRelation")
        self.assertEqual(evidence_relation["input"]["predicate"], "uses_evidence")
        self.assertEqual(evidence_relation["input"]["subjectId"], item["id"])
        self.assertEqual(evidence_relation["input"]["objectId"], "reference-knowledge-corpus-ai-ml-research-research-001-v1")

    def test_track_assignment_requires_target_system_type(self):
        with self.assertRaisesRegex(ValueError, "assignment.targetSystemType is required"):
            papyrus_newsroom.build_assignment_record_plan(
                edition_id="edition-1",
                corpus_key="AI-ML-research",
                generated_at="2026-05-16T12:00:00Z",
                assignment_json=json.dumps(
                    {
                        "title": "AI Agents Enter the Lab",
                        "research_track_key": "automated-publication-systems",
                        "research_lens": "agent-workflow",
                    }
                ),
            )

    def test_doi_backfill_plan_is_assignment_first(self):
        payload = papyrus_newsroom.papyrus_doi_backfill_plan(
            corpus_key="AI-ML-research",
            max_count=25,
            use_llm=False,
        )["doi_backfill_plan"]
        self.assertEqual(payload["mode"], "assignment-first")
        self.assertIn("create-doi-backfill-assignment", payload["commands"]["create_assignment"])
        self.assertIn("doi-backfill-now", payload["commands"]["run_now"])
        self.assertIn("reference.doi-backfill", payload["commands"]["process_queue"])

    def test_dispatch_plan_caps_assignments_by_section_ratio(self):
        plan = papyrus_newsroom.build_assignment_dispatch_plan(
            edition_id="edition-1",
            corpus_key="AI-ML-research",
            generated_at="2026-05-16T12:00:00Z",
            assignment_ratio=1.5,
            section_targets_json=json.dumps(
                [
                    {"section": "Research", "target_articles": 2},
                    {"section": "Markets", "target_articles": 1},
                ]
            ),
            assignments_json=json.dumps(
                [
                    {"section": "Research", "title": "Research 1"},
                    {"section": "Research", "title": "Research 2"},
                    {"section": "Research", "title": "Research 3"},
                    {"section": "Markets", "title": "Markets 1"},
                    {"section": "Markets", "title": "Markets 2"},
                    {"section": "Markets", "title": "Markets 3"},
                ]
            ),
        )

        self.assertTrue(plan["dryRun"])
        self.assertEqual(plan["lifecycle"], "assignment-dispatch")
        self.assertEqual(plan["reviewerLoad"]["targetArticleCount"], 3)
        self.assertEqual(plan["reviewerLoad"]["dispatchedAssignmentCount"], 5)
        self.assertEqual(plan["reviewerLoad"]["suppressedCandidateCount"], 1)
        self.assertEqual(len(plan["recordPlans"]), 5)
        self.assertEqual(len(plan["reporterDispatches"]), 5)
        self.assertEqual(plan["sectionTargets"][0]["dispatchCount"], 3)
        self.assertEqual(plan["sectionTargets"][1]["dispatchCount"], 2)
        self.assertEqual(plan["recordPlans"][0]["item"]["type"], "assignment")
        self.assertEqual(plan["reporterDispatches"][0]["procedure"], "procedures/newsroom/reporter.tac")
        self.assertIn('"type": "assignment"', plan["reporterDispatches"][0]["input"]["assignment_json"])

    def test_draft_plan_creates_article_from_assignment_item(self):
        plan = papyrus_newsroom.build_draft_update_plan(
            generated_at="2026-05-16T12:30:00Z",
            assignment_item_json=json.dumps(
                {
                    "id": "assignment-1",
                    "type": "assignment",
                    "status": "dispatched",
                    "typeStatus": "assignment#dispatched",
                    "slug": "ai-agents-enter-the-lab",
                    "section": "Research",
                    "title": "AI Agents Enter the Lab",
                    "editorial": {
                        "newsroom": {
                            "assignment": {
                                "brief": "Explain research agents.",
                                "researchTrackKey": "automated-publication-systems",
                                "researchLens": "agent-workflow",
                                "targetSystemType": "research newsroom",
                                "comparisonQuestions": [
                                    "What is the end-to-end handoff sequence from signal detection to published output?"
                                ],
                                "corpusKey": "AI-ML-research",
                            }
                        }
                    },
                }
            ),
            draft_json=json.dumps(
                {
                    "headline": "AI Agents Enter the Lab",
                    "deck": "Research teams are handing more lab work to autonomous systems.",
                    "body": [
                        "Agentic systems are moving from demos into research workflows.",
                        "The strongest evidence comes from scientific discovery and evaluation corpora.",
                    ],
                    "byline": "Papyrus Staff",
                    "evidence_item_ids": ["research-001"],
                }
            ),
        )

        assignment = plan["assignmentItem"]
        item = plan["draftItem"]
        self.assertTrue(plan["dryRun"])
        self.assertEqual(assignment["id"], "assignment-1-v2")
        self.assertEqual(assignment["previousVersionId"], "assignment-1")
        self.assertEqual(assignment["type"], "assignment")
        self.assertEqual(assignment["status"], "drafted")
        self.assertEqual(assignment["typeStatus"], "assignment#drafted")
        self.assertEqual(item["id"], "item-ai-agents-enter-the-lab")
        self.assertEqual(item["type"], "article")
        self.assertEqual(item["status"], "draft")
        self.assertEqual(item["typeStatus"], "article#draft")
        self.assertEqual(item["sectionStatus"], "research#draft")
        self.assertIsNone(item["publishedAt"])
        self.assertIn("assignment", item["editorial"]["newsroom"])
        self.assertEqual(item["editorial"]["newsroom"]["assignmentItemId"], "assignment-1-v2")
        self.assertEqual(item["editorial"]["newsroom"]["draft"]["evidenceItemIds"], ["research-001"])
        self.assertEqual(plan["records"][0]["action"], "create")
        self.assertEqual(plan["records"][1]["action"], "update")
        self.assertEqual(plan["records"][1]["input"]["versionState"], "superseded")
        self.assertEqual(plan["records"][2]["action"], "create")
        relation_records = [record for record in plan["records"] if record["modelName"] == "SemanticRelation"]
        self.assertEqual(len(relation_records), 2)
        self.assertEqual({record["input"]["subjectId"] for record in relation_records}, {"assignment-1-v2", "item-ai-agents-enter-the-lab"})

    def test_research_plan_preserves_assignment_type(self):
        plan = papyrus_newsroom.build_research_update_plan(
            generated_at="2026-05-16T12:15:00Z",
            assignment_item_json=json.dumps(
                {
                    "id": "assignment-1",
                    "type": "assignment",
                    "status": "dispatched",
                    "typeStatus": "assignment#dispatched",
                    "slug": "ai-agents-enter-the-lab",
                    "section": "Research",
                    "title": "AI Agents Enter the Lab",
                    "editorial": {
                        "newsroom": {
                            "assignment": {
                                "brief": "Explain research agents.",
                                "researchTrackKey": "automated-publication-systems",
                                "researchLens": "agent-workflow",
                                "targetSystemType": "research newsroom",
                                "comparisonQuestions": [
                                    "What is the end-to-end handoff sequence from signal detection to published output?"
                                ],
                            }
                        }
                    },
                }
            ),
            research_json=json.dumps(
                {
                    "summary": "Evidence supports a practical research-workflow angle.",
                    "corpus_key": "AI-ML-research",
                    "category_key": "automated-scientific-discovery",
                    "evidence_item_ids": ["research-001", "research-002"],
                    "doctrine_context": {
                        "publication": {"available": True},
                        "desk": {"available": False, "fallback": "publication"},
                    },
                    "queries": ["agentic research workflows"],
                    "source_snapshots": [{"itemId": "research-001", "title": "Lab agents"}],
                    "proposed_references": [
                        {
                            "title": "Candidate source",
                            "url": "https://example.com/candidate",
                            "ingestion_rationale": "Candidate source relates to the research focus and publication mission.",
                        }
                    ],
                    "research_notes": ["Tie the story to concrete workflow changes."],
                    "comparison_findings": ["Release still requires a human approval gate."],
                    "rubric_assessments": [
                        {"key": "autonomy-scope", "finding": "Partial autonomy only."},
                        {"key": "editorial-control", "finding": "Editors can veto publication."},
                    ],
                    "open_questions": ["Which examples are strongest for the edition?"],
                    "coverage_gaps": ["Need one skeptical source."],
                    "recommended_angle": "Focus on lab workflow delegation.",
                }
            ),
        )

        item = plan["item"]
        self.assertTrue(plan["dryRun"])
        self.assertEqual(plan["lifecycle"], "assignment-research")
        self.assertEqual(item["id"], "assignment-1-v2")
        self.assertEqual(item["previousVersionId"], "assignment-1")
        self.assertEqual(item["type"], "assignment")
        self.assertEqual(item["status"], "researched")
        self.assertEqual(item["typeStatus"], "assignment#researched")
        self.assertIsNone(item["publishedAt"])
        self.assertIn("assignment", item["editorial"]["newsroom"])
        research = item["editorial"]["newsroom"]["research"]
        self.assertEqual(research["status"], "researched")
        self.assertEqual(research["corpusKey"], "AI-ML-research")
        self.assertEqual(research["evidenceItemIds"], ["research-001", "research-002"])
        self.assertEqual(research["researchTrackKey"], "automated-publication-systems")
        self.assertEqual(research["researchLens"], "agent-workflow")
        self.assertEqual(research["targetSystemType"], "research newsroom")
        self.assertEqual(research["doctrineContext"]["desk"]["fallback"], "publication")
        self.assertEqual(research["proposedReferences"][0]["url"], "https://example.com/candidate")
        self.assertEqual(research["comparisonFindings"], ["Release still requires a human approval gate."])
        self.assertEqual(research["rubricAssessments"][0]["key"], "autonomy-scope")
        self.assertEqual(research["procedure"]["role"], "researcher")
        self.assertEqual(plan["records"][0]["action"], "create")
        self.assertEqual(plan["records"][1]["input"]["versionState"], "superseded")
        relation_records = [record for record in plan["records"] if record["modelName"] == "SemanticRelation"]
        self.assertEqual(len(relation_records), 2)
        self.assertEqual(relation_records[0]["input"]["objectId"], "reference-knowledge-corpus-ai-ml-research-research-001-v1")
        self.assertEqual(relation_records[0]["input"]["relationTypeKey"], "uses_evidence")

    def test_live_assignment_research_packet_plan_creates_message_and_comment_relation(self):
        plan = papyrus_newsroom.build_assignment_research_packet_plan(
            generated_at="2026-05-18T15:30:00Z",
            assignment={
                "id": "assignment-live-123",
                "assignmentTypeKey": "research.edition-candidate",
                "queueKey": "edition:edition-2026-05-18:desk:automation:lane:reporting",
                "queueStatusKey": "edition:edition-2026-05-18:desk:automation:lane:reporting#open",
                "status": "open",
                "title": "Research automated publication systems",
                "brief": "Find current source material.",
                "corpusId": "knowledge-corpus-ai-ml-research",
                "metadata": {
                    "deskCategoryKey": "automation",
                    "focusCategoryKey": "automated-publication-systems",
                    "contextProfile": "reporting",
                    "contextTokenBudget": 4000,
                },
            },
            research={
                "summary": "Found one current source prospect.",
                "corpus_key": "AI-ML-research",
                "queries": ["automated publication systems newsroom"],
                "source_snapshots": [
                    {
                        "url": "https://example.com/source",
                        "source_domain": "example.com",
                        "evidence_candidate_id": "evidence-candidate-1",
                    }
                ],
                "proposed_references": [
                    {
                        "title": "Candidate source",
                        "url": "https://example.com/source",
                        "ingestion_rationale": "Candidate source relates to the focus and publication mission.",
                    }
                ],
                "evidence_item_ids": [],
                "research_mode": "source_discovery",
                "internalFindings": {
                    "summary": "Internal evidence is thin.",
                    "evidenceItemIds": [],
                    "queries": ["automated publication systems newsroom"],
                },
                "sourceDiscovery": {
                    "webSearches": ["automated publication systems newsroom"],
                    "sourceSnapshots": [
                        {
                            "url": "https://example.com/source",
                            "source_domain": "example.com",
                        }
                    ],
                },
                "synthesis": {
                    "summary": "Found one current source prospect.",
                    "recommendedAngle": "Review as intake candidate.",
                },
                "recommended_angle": "Review as intake candidate.",
            },
        )

        self.assertTrue(plan["dryRun"])
        self.assertEqual(plan["lifecycle"], "assignment-research-packet")
        self.assertEqual([record["modelName"] for record in plan["records"]], ["Message", "ModelAttachment", "ModelAttachment", "SemanticRelation"])
        message = plan["records"][0]["input"]
        self.assertEqual(message["messageKind"], "research_packet")
        self.assertEqual(message["messageDomain"], "assignment_work")
        metadata_attachment = plan["records"][2]
        self.assertEqual(metadata_attachment["input"]["role"], "metadata")
        metadata = json.loads(metadata_attachment["body"])
        self.assertEqual(metadata["kind"], "research.packet.created")
        self.assertEqual(metadata["assignmentId"], "assignment-live-123")
        self.assertEqual(metadata["research"]["researchMode"], "source_discovery")
        self.assertEqual(metadata["research"]["internalFindings"]["summary"], "Internal evidence is thin.")
        self.assertEqual(metadata["research"]["sourceDiscovery"]["webSearches"], ["automated publication systems newsroom"])
        self.assertEqual(metadata["research"]["synthesis"]["recommendedAngle"], "Review as intake candidate.")
        self.assertEqual(metadata["research"]["sourceSnapshots"][0]["source_domain"], "example.com")
        self.assertEqual(metadata["research"]["proposedReferences"][0]["ingestion_rationale"], "Candidate source relates to the focus and publication mission.")
        relation = plan["records"][3]["input"]
        self.assertEqual(relation["predicate"], "comment")
        self.assertEqual(relation["relationTypeKey"], "comment")
        self.assertEqual(relation["relationDomain"], "commentary")
        self.assertEqual(relation["subjectKind"], "message")
        self.assertEqual(relation["objectKind"], "assignment")
        self.assertEqual(relation["objectId"], "assignment-live-123")

    def test_execute_tactus_can_plan_live_assignment_research_packet(self):
        result = tactus_runtime.execute_tactus(
            """
local assignment = {
  id = "assignment-live-123",
  assignmentTypeKey = "research.edition-candidate",
  queueKey = "edition:edition-2026-05-18:desk:automation:lane:reporting",
  status = "open",
  title = "Research automated publication systems",
}
local research = {
  summary = "Found one source prospect.",
  corpus_key = "AI-ML-research",
  source_snapshots = { { url = "https://example.com/source", source_domain = "example.com" } },
  proposed_references = { { title = "Candidate source", url = "https://example.com/source", ingestion_rationale = "Review for intake." } },
  evidence_item_ids = {},
}
return plan_assignment_research_packet{ assignment = assignment, research = research }
"""
        )

        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["value"]["lifecycle"], "assignment-research-packet")
        self.assertEqual(result["value"]["records"][0]["modelName"], "Message")
        self.assertEqual(result["value"]["records"][3]["input"]["relationTypeKey"], "comment")
        self.assertEqual(result["api_calls"], ["papyrus.plan.assignment_research_packet"])

    def test_live_assignment_reporting_context_packet_plan_creates_private_message_only(self):
        plan = papyrus_newsroom.build_assignment_reporting_context_packet_plan(
            generated_at="2026-05-18T16:00:00Z",
            assignment={
                "id": "assignment-reporting-123",
                "assignmentTypeKey": "reporting.edition-candidate",
                "queueKey": "edition:edition-2026-05-23:section:news:lane:reporting",
                "queueStatusKey": "edition:edition-2026-05-23:section:news:lane:reporting#open",
                "status": "open",
                "title": "News reporting candidate",
                "sectionKey": "news",
                "classifierId": "demo-classifier",
                "metadata": {
                    "editionId": "edition-2026-05-23-v1",
                    "candidateRank": 1,
                    "slotTarget": {"sectionKey": "news", "slots": 2, "candidateRank": 1},
                    "reportingContextOrder": [
                        "publication-doctrine",
                        "section-doctrine",
                        "assignment-brief",
                        "accepted-knowledge-base-evidence",
                        "recent-section-memory",
                        "fresh-source-needs",
                    ],
                },
            },
            reporting={
                "summary": "A reported candidate is ready for editor selection.",
                "why_now": "The source material changed this week.",
                "nut_graf_candidate": "The article should explain what changed and why it matters.",
                "recommended_angle": "Focus on practical reader impact.",
                "confirmed_facts": ["The accepted reference confirms the release date."],
                "source_trail": [{"title": "Accepted source", "reference_id": "reference-1-v1"}],
                "accepted_reference_ids": ["reference-1-v1"],
                "proposed_references": [{"title": "Fresh source prospect", "url": "https://example.com/source"}],
                "recent_desk_memory_used": ["Prior News coverage emphasized verification."],
                "coverage_gaps": ["Need comment from affected users."],
                "open_questions": ["Is the rollout complete?"],
                "risk_flags": ["Avoid promotional framing."],
                "verification_needs": ["Verify the fresh prospect before copywriting."],
                "source_diversity_notes": ["Accepted evidence is single-source so far."],
                "copywriter_brief": "Use the accepted source and clearly label unresolved questions.",
                "editor_recommendation": "hold",
            },
        )

        self.assertTrue(plan["dryRun"])
        self.assertEqual(plan["lifecycle"], "assignment-reporting-context-packet")
        self.assertEqual([record["modelName"] for record in plan["records"]], ["Message", "ModelAttachment", "ModelAttachment", "SemanticRelation"])
        self.assertFalse(any(record["modelName"] in {"Item", "EditionItem"} for record in plan["records"]))
        message = plan["records"][0]["input"]
        self.assertEqual(message["messageKind"], "reporting_context_packet")
        self.assertEqual(message["messageDomain"], "assignment_work")
        metadata = json.loads(plan["records"][2]["body"])
        self.assertEqual(metadata["kind"], "reporting.context_packet.created")
        self.assertEqual(metadata["assignmentId"], "assignment-reporting-123")
        self.assertEqual(metadata["reporting"]["sectionKey"], "news")
        self.assertEqual(metadata["reporting"]["editionId"], "edition-2026-05-23-v1")
        self.assertEqual(metadata["reporting"]["acceptedReferenceIds"], ["reference-1-v1"])
        self.assertEqual(metadata["reporting"]["editorRecommendation"], "hold")
        relation = plan["records"][3]["input"]
        self.assertEqual(relation["predicate"], "comment")
        self.assertEqual(relation["subjectKind"], "message")
        self.assertEqual(relation["objectKind"], "assignment")

    def test_execute_tactus_can_plan_reporting_context_packet(self):
        result = tactus_runtime.execute_tactus(
            """
local assignment = {
  id = "assignment-reporting-123",
  assignmentTypeKey = "reporting.edition-candidate",
  queueKey = "edition:edition-2026-05-23:section:news:lane:reporting",
  status = "open",
  sectionKey = "news",
  metadata = { editionId = "edition-2026-05-23-v1", candidateRank = 1 },
}
local reporting = {
  summary = "Reporting context ready.",
  section_key = "news",
  edition_id = "edition-2026-05-23-v1",
  confirmed_facts = { "Accepted source confirms the date." },
  accepted_reference_ids = { "reference-1-v1" },
  copywriter_brief = "Draft only after editor selection.",
  editor_recommendation = "select",
}
return plan_assignment_reporting_context_packet{ assignment = assignment, reporting = reporting }
"""
        )

        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["value"]["lifecycle"], "assignment-reporting-context-packet")
        self.assertEqual(result["value"]["records"][0]["input"]["messageKind"], "reporting_context_packet")
        self.assertEqual(result["value"]["records"][3]["input"]["relationTypeKey"], "comment")
        self.assertEqual(result["api_calls"], ["papyrus.plan.assignment_reporting_context_packet"])

    def test_execute_tactus_exposes_knowledge_query_helper(self):
        with mock.patch("papyrus_newsroom.tactus_runtime.build_environment_services", return_value=object()), \
             mock.patch("papyrus_newsroom.tactus_runtime.run_knowledge_query") as run_query:
            run_query.return_value = {
                "structured": {"semanticMatches": []},
                "context": {"text": "Accepted context."},
                "warnings": [],
            }
            result = tactus_runtime.execute_tactus(
                'return knowledge_query{ query = "agent memory", max_tokens = 200, top_k = 3, format = "both" }'
            )

        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["value"]["context"]["text"], "Accepted context.")
        self.assertEqual(result["api_calls"], ["papyrus.knowledge.query"])
        run_query.assert_called_once()
        query_input = run_query.call_args.args[0]
        self.assertEqual(query_input["semanticQuery"], "agent memory")
        self.assertEqual(query_input["scope"]["topK"], 3)
        self.assertEqual(query_input["output"]["maxTokens"], 200)

    def test_execute_tactus_exposes_papyrus_uri_resolver(self):
        with mock.patch("papyrus_newsroom.tactus_runtime.newsroom.papyrus_resolve_uri") as resolve_uri:
            resolve_uri.return_value = {
                "uri": "papyrus://reference/reference-1",
                "kind": "reference",
                "lineageId": "reference-1",
                "object": {"id": "reference-1-v1", "lineageId": "reference-1", "curationStatus": "accepted"},
            }
            result = tactus_runtime.execute_tactus('return papyrus.resolve_uri{ uri = "papyrus://reference/reference-1" }')

        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["value"]["object"]["id"], "reference-1-v1")
        self.assertEqual(result["api_calls"], ["papyrus.resolve_uri"])
        resolve_uri.assert_called_once_with("papyrus://reference/reference-1")

    def test_knowledge_query_helper_accepts_uri_anchor(self):
        with mock.patch("papyrus_newsroom.tactus_runtime.build_environment_services", return_value=object()), \
             mock.patch("papyrus_newsroom.tactus_runtime.run_knowledge_query") as run_query:
            run_query.return_value = {
                "structured": {"anchors": [{"kind": "reference", "lineageId": "reference-1"}]},
                "context": {"text": "Anchored context."},
                "warnings": [],
            }
            result = tactus_runtime.execute_tactus(
                'return knowledge_query{ uri = "papyrus://reference/reference-1", max_tokens = 200, top_k = 3 }'
            )

        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["value"]["context"]["text"], "Anchored context.")
        query_input = run_query.call_args.args[0]
        self.assertEqual(query_input["anchors"], [{"uri": "papyrus://reference/reference-1"}])

    def test_research_harness_supports_uri_anchored_knowledge_trace(self):
        assignment = {
            "id": "assignment-live-123",
            "assignmentTypeKey": "research.edition-candidate",
            "queueKey": "research#open",
            "status": "open",
            "title": "Explore internal evidence",
        }
        with mock.patch("papyrus_newsroom.tactus_runtime.build_environment_services", return_value=object()), \
             mock.patch("papyrus_newsroom.tactus_runtime.run_knowledge_query") as run_query:
            run_query.return_value = {
                "structured": {
                    "anchors": [
                        {"kind": "reference", "id": "reference-1-v1", "lineageId": "reference-1", "curationStatus": "accepted"}
                    ],
                    "semanticMatches": [],
                },
                "context": {"text": "Accepted anchored context."},
                "warnings": [],
            }
            result = tactus_runtime.execute_tactus_harnessed(
                """
local knowledge = knowledge_search_uri("papyrus://reference/reference-1", { max_tokens = 300 })
local ids = evidence_item_ids_from_knowledge(knowledge)
return finish_research{
  summary = "Built exploratory packet from internal evidence.",
  queries = {"anchored query"},
  source_snapshots = {},
  proposed_references = {},
  evidence_item_ids = ids,
  recommended_angle = "Start with accepted internal evidence.",
  researchTrace = {
    knowledgeQueries = {"anchored query"},
    papyrusUrisInspected = {"papyrus://reference/reference-1"},
    webSearches = {},
    acceptedEvidenceIds = ids,
    unresolvedGaps = {},
  },
}
""",
                harness="research",
                assignment_item_json=json.dumps(assignment),
                corpus_key="AI-ML-research",
                max_evidence_items=8,
                research_mode="internal_brief",
            )

        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["value"]["research_packet"]["evidence_item_ids"], ["reference-1-v1"])
        self.assertEqual(result["value"]["research_packet"]["research_mode"], "internal_brief")
        self.assertEqual(result["value"]["research_packet"]["researchTrace"]["webSearches"], [])
        self.assertEqual(result["value"]["research_record_plan"]["records"][0]["modelName"], "Message")
        self.assertEqual(result["api_calls"], ["papyrus.knowledge.query", "papyrus.plan.assignment_research_packet"])

    def test_research_harness_requires_discovery_for_source_discovery_mode(self):
        assignment = {
            "id": "assignment-live-123",
            "assignmentTypeKey": "research.edition-candidate",
            "queueKey": "research#open",
            "status": "open",
            "title": "Explore source discovery",
        }
        result = tactus_runtime.execute_tactus_harnessed(
            """
return finish_research{
  summary = "Internal-only packet should fail in source discovery mode.",
  queries = {"agent catalog"},
  source_snapshots = {},
  proposed_references = {},
  evidence_item_ids = {},
  recommended_angle = "Find external source prospects.",
  researchTrace = {
    knowledgeQueries = {"agent catalog"},
    papyrusUrisInspected = {},
    webSearches = {},
    acceptedEvidenceIds = {},
    unresolvedGaps = {},
  },
}
""",
            harness="research",
            assignment_item_json=json.dumps(assignment),
            corpus_key="AI-ML-research",
            max_evidence_items=8,
            research_mode="source_discovery",
        )

        self.assertFalse(result["ok"])
        self.assertIn("requires web discovery", result["error"]["message"])

    def test_research_harness_accepts_source_discovery_bundle_with_prospects(self):
        assignment = {
            "id": "assignment-live-123",
            "assignmentTypeKey": "research.edition-candidate",
            "queueKey": "research#open",
            "status": "open",
            "title": "Explore source discovery",
        }
        result = tactus_runtime.execute_tactus_harnessed(
            """
return finish_research{
  research_mode = "source_discovery",
  summary = "Internal orientation plus external prospect.",
  queries = {"agent catalog"},
  source_snapshots = { { url = "https://example.com/source", source_domain = "example.com" } },
  proposed_references = { { title = "Candidate", url = "https://example.com/source", ingestion_rationale = "Candidate supports the research focus." } },
  evidence_item_ids = {},
  recommended_angle = "Compare current terminology.",
  researchTrace = {
    knowledgeQueries = {"agent catalog"},
    papyrusUrisInspected = {},
    webSearches = {"agent catalog business process automation"},
    acceptedEvidenceIds = {},
    unresolvedGaps = {},
  },
}
""",
            harness="research",
            assignment_item_json=json.dumps(assignment),
            corpus_key="AI-ML-research",
            max_evidence_items=8,
            research_mode="source_discovery",
        )

        self.assertTrue(result["ok"], result.get("error"))
        packet = result["value"]["research_packet"]
        self.assertEqual(packet["research_mode"], "source_discovery")
        self.assertEqual(packet["sourceDiscovery"]["webSearches"], ["agent catalog business process automation"])
        self.assertEqual(packet["sourceDiscovery"]["proposedReferences"][0]["title"], "Candidate")

    def test_track_research_warns_when_doctrine_context_and_rubric_are_missing(self):
        plan = papyrus_newsroom.build_research_update_plan(
            generated_at="2026-05-16T12:15:00Z",
            assignment_item_json=json.dumps(
                {
                    "id": "assignment-1",
                    "type": "assignment",
                    "status": "dispatched",
                    "typeStatus": "assignment#dispatched",
                    "slug": "ai-agents-enter-the-lab",
                    "section": "Research",
                    "title": "AI Agents Enter the Lab",
                    "editorial": {
                        "newsroom": {
                            "assignment": {
                                "brief": "Explain research agents.",
                                "researchTrackKey": "automated-publication-systems",
                                "researchLens": "agent-workflow",
                                "targetSystemType": "research newsroom",
                            }
                        }
                    },
                }
            ),
            research_json=json.dumps(
                {
                    "summary": "Evidence supports a practical research-workflow angle.",
                    "corpus_key": "AI-ML-research",
                    "evidence_item_ids": ["research-001"],
                    "queries": ["agentic research workflows"],
                    "source_snapshots": [{"itemId": "research-001", "title": "Lab agents"}],
                    "recommended_angle": "Focus on lab workflow delegation.",
                }
            ),
        )

        self.assertIn("research.doctrineContext is empty", plan["warnings"])
        self.assertIn("research.rubricAssessments is empty", plan["warnings"])

    def test_live_assignment_context_normalizes_to_procedure_item(self):
        result = papyrus_newsroom.papyrus_assignment_context_to_item(
            generated_at="2026-05-16T12:15:00Z",
            assignment_context_json=json.dumps(
                {
                    "assignment": {
                        "id": "assignment-live-123",
                        "assignmentTypeKey": "research.edition-candidate",
                        "queueKey": "edition:edition-2026-05-16:desk:automated-scientific-discovery:lane:reporting",
                        "queueStatusKey": "edition:edition-2026-05-16:desk:automated-scientific-discovery:lane:reporting#open",
                        "status": "open",
                        "title": "Reporting candidate 1: Automated Scientific Discovery",
                        "brief": "Report a fresh evidence-led candidate story.",
                        "metadata": {
                            "editionDate": "2026-05-16",
                            "deskCategoryKey": "automated-scientific-discovery",
                            "deskCategoryLineageId": "category-1",
                            "deskCategoryTitle": "Automated Scientific Discovery",
                            "focusCategoryKey": "agent-workflow",
                            "focusCategoryLineageId": "category-focus-1",
                            "focusCategoryTitle": "Agent Workflow",
                            "contextProfile": "reporting",
                            "contextTokenBudget": 4000,
                            "contextSources": ["doctrine", "focus-category", "desk-memory", "fresh-evidence"],
                            "rootCategoryKey": "automated-scientific-discovery",
                            "researchTrackKey": "automated-publication-systems",
                            "researchTrackTitle": "Fully-Automated Publication Systems",
                            "researchLens": "agent-workflow",
                            "researchLensTitle": "Agent Workflow",
                            "assignmentTemplateKey": "agent-workflow",
                            "assignmentTemplateTitle": "Agent Workflow",
                            "targetSystemType": "research newsroom",
                            "expectedEvidenceClasses": ["runbooks or workflow descriptions"],
                            "comparisonQuestions": ["What is the end-to-end handoff sequence from signal detection to published output?"],
                            "evidenceRubric": [{"key": "autonomy-scope"}],
                            "referenceLineageIds": ["reference-1"],
                        },
                    },
                    "doctrine": [{"scope": "publication", "kind": "mission", "label": "Editorial Mission", "slug": "editorial-doctrine-mission", "body": ["Study publication systems as operational systems."]}],
                    "targets": [{"kind": "category", "id": "category-1", "lineageId": "category-1", "label": "Automated Scientific Discovery", "detail": "requests_work_on"}],
                    "events": [{"id": "assignment-event-1", "assignmentId": "assignment-live-123", "assignmentTypeKey": "research.edition-candidate", "queueKey": "edition:edition-2026-05-16:desk:automated-scientific-discovery:lane:reporting", "eventType": "created", "createdAt": "2026-05-16T12:00:00Z"}],
                }
            ),
        )

        item = result["item"]
        self.assertEqual(item["id"], "assignment-live-123")
        self.assertEqual(item["type"], "assignment")
        self.assertEqual(item["status"], "dispatched")
        self.assertEqual(item["section"], "automated-scientific-discovery")
        assignment = item["editorial"]["newsroom"]["assignment"]
        self.assertEqual(assignment["deskCategoryKey"], "automated-scientific-discovery")
        self.assertEqual(assignment["deskCategoryLineageId"], "category-1")
        self.assertEqual(assignment["focusCategoryKey"], "agent-workflow")
        self.assertEqual(assignment["focusCategoryTitle"], "Agent Workflow")
        self.assertEqual(assignment["contextProfile"], "reporting")
        self.assertEqual(assignment["contextTokenBudget"], 4000)
        self.assertEqual(assignment["contextSources"], ["doctrine", "focus-category", "desk-memory", "fresh-evidence"])
        self.assertEqual(assignment["researchTrackKey"], "automated-publication-systems")
        self.assertEqual(assignment["researchLens"], "agent-workflow")
        self.assertEqual(assignment["targetSystemType"], "research newsroom")
        self.assertEqual(assignment["expectedEvidenceClasses"], ["runbooks or workflow descriptions"])
        self.assertEqual(assignment["comparisonQuestions"][0], "What is the end-to-end handoff sequence from signal detection to published output?")
        self.assertEqual(assignment["liveAssignment"]["status"], "open")
        self.assertEqual(assignment["liveAssignment"]["doctrine"][0]["scope"], "publication")
        self.assertEqual(item["layout"]["source"], "newsroom-live-assignment")

    def test_lambda_auth_header_matches_authoring_lane(self):
        token = papyrus_newsroom._lambda_auth_token("Bearer abc.def.ghi")
        self.assertEqual(token, "PapyrusJwt abc.def.ghi")

    def test_biblicus_tool_resolves_config_and_uses_project_venv(self):
        completed = mock.Mock(returncode=0, stdout="ok", stderr="")
        with mock.patch.object(papyrus_newsroom.subprocess, "run", return_value=completed) as run:
            result = papyrus_newsroom.biblicus_steering_artifacts("AI-ML-research")

        self.assertEqual(result["status"], "ok")
        command = run.call_args.args[0]
        self.assertEqual(command[1:4], ["-m", "biblicus", "steering"])
        self.assertIn("/Users/ryan/Projects/Biblicus/.venv/bin/python", command[0])
        self.assertIn("/Users/ryan/Projects/Biblicus/corpora/AI-ML-research", command)

    def test_semantic_key_builders_match_relation_indexes(self):
        self.assertEqual(
            papyrus_semantic.semantic_state_key("reference", "reference-1"),
            "reference#reference-1#current",
        )
        self.assertEqual(
            papyrus_semantic.semantic_object_subject_state_key("category", "category-1", "reference"),
            "category#category-1#current#reference",
        )
        self.assertEqual(
            papyrus_semantic.semantic_predicate_object_state_key("classified_as", "category", "category-1"),
            "classified_as#category#category-1#current",
        )

    def test_semantic_client_resolves_papyrus_uri_by_lineage(self):
        def fake_graphql(query, variables):
            if "getReference" in query:
                self.assertEqual(variables["id"], "reference-1")
                return {"getReference": None}
            if "listReferencesByLineageAndVersion" in query:
                self.assertEqual(variables["lineageId"], "reference-1")
                return {
                    "listReferencesByLineageAndVersion": {
                        "items": [
                            {"id": "reference-1-v1", "lineageId": "reference-1", "versionNumber": 1, "versionState": "current", "title": "Reference 1"}
                        ],
                        "nextToken": None,
                    }
                }
            raise AssertionError(f"Unexpected query {query}")

        client = papyrus_semantic.PapyrusSemanticClient(fake_graphql)
        resolved = client.resolve_uri("papyrus://reference/reference-1")

        self.assertEqual(resolved["kind"], "reference")
        self.assertEqual(resolved["lineageId"], "reference-1")
        self.assertEqual(resolved["object"]["id"], "reference-1-v1")

    def test_reference_quality_plan_uses_score_and_supersedes_stale_relation(self):
        reference = {
            "id": "reference-a-v1",
            "lineageId": "reference-a",
            "versionNumber": 1,
            "corpusId": "knowledge-corpus-test",
            "externalItemId": "item-a",
            "title": "Reference A",
            "importRunId": "import-1",
        }

        class FakeSemantic:
            def get_semantic_object(self, _kind, _object_id):
                return {"object": {"id": _object_id}}

            def list_outgoing(self, _kind, _lineage_id):
                return {
                    "relations": [
                        {
                            "id": "quality-old",
                            "relationState": "current",
                            "relationTypeKey": "quality_rating_is",
                            "predicate": "quality_rating_is",
                            "objectLineageId": "semantic-node-quality-rating-2-star",
                            "score": 2,
                            "metadata": "{}",
                        }
                    ]
                }

        plan = reference_curation_signals.build_reference_quality_plan(
            reference=reference,
            rating=4,
            note="strong source",
            now="2026-05-19T12:00:00Z",
            semantic_client=FakeSemantic(),
        )

        self.assertEqual(plan["action"], "create")
        create, update = plan["records"]
        self.assertEqual(update["action"], "update")
        self.assertEqual(update["input"]["relationState"], "superseded")
        self.assertEqual(create["input"]["relationTypeKey"], "quality_rating_is")
        self.assertEqual(create["input"]["objectLineageId"], "semantic-node-quality-rating-4-star")
        self.assertEqual(create["input"]["score"], 4)

    def test_reference_summary_plan_is_budget_specific_message_relation(self):
        reference = {
            "id": "reference-a-v1",
            "lineageId": "reference-a",
            "versionNumber": 1,
            "corpusId": "knowledge-corpus-test",
            "externalItemId": "item-a",
            "title": "Reference A",
            "importRunId": "import-1",
        }

        class FakeSemantic:
            def list_incoming(self, _kind, _lineage_id):
                return {"relations": []}

        plan = reference_curation_signals.build_reference_summary_plan(
            reference=reference,
            max_tokens=100,
            summary_text="A short summary.",
            source_text="Long source text.",
            model="manual",
            now="2026-05-19T12:00:00Z",
            semantic_client=FakeSemantic(),
        )

        self.assertEqual(plan["action"], "create")
        self.assertEqual(plan["message"]["messageKind"], "reference_summary")
        relation = plan["records"][-1]["input"]
        self.assertEqual(relation["relationTypeKey"], "reference_summary_100_tokens")
        self.assertEqual(relation["subjectKind"], "message")
        self.assertEqual(relation["objectKind"], "reference")
        self.assertEqual(relation["metadata"]["maxTokens"], 100)

    def test_publication_doctrine_context_loads_mission_and_policy(self):
        def fake_graphql(_query, variables):
            slug = variables["slug"]
            body_by_slug = {
                "editorial-doctrine-mission": ["Study publication systems as operational systems."],
                "editorial-doctrine-policy": ["Published stories should distinguish evidence from speculation."],
            }
            return {
                "itemBySlug": {
                    "items": [
                        {
                            "id": f"item-{slug}-v1",
                            "lineageId": f"item-{slug}",
                            "versionNumber": 1,
                            "versionState": "current",
                            "type": "doctrine",
                            "status": "private",
                            "slug": slug,
                            "title": "Editorial Mission" if "mission" in slug else "Editorial Policy",
                            "body": body_by_slug[slug],
                            "editorial": json.dumps({"kind": "mission" if "mission" in slug else "policy"}),
                        }
                    ],
                    "nextToken": None,
                }
            }

        context = reference_curation_signals.load_publication_doctrine_context(graphql_func=fake_graphql)

        self.assertEqual(context["status"], "loaded")
        self.assertEqual(context["scope"], "publication")
        self.assertEqual(context["policyUse"], "context_only_not_reference_rubric")
        self.assertEqual(context["slugs"], ["editorial-doctrine-mission", "editorial-doctrine-policy"])
        self.assertTrue(context["contentHash"])

    def test_summary_prompt_includes_doctrine_and_policy_use_warning(self):
        context = {
            "status": "loaded",
            "scope": "publication",
            "policyUse": "context_only_not_reference_rubric",
            "slugs": ["editorial-doctrine-mission", "editorial-doctrine-policy"],
            "records": [
                {"slug": "editorial-doctrine-mission", "label": "Editorial Mission", "body": ["Study operational publication systems."]},
                {"slug": "editorial-doctrine-policy", "label": "Editorial Policy", "body": ["Published items should be evidence-backed."]},
            ],
            "contentHash": "hash-1",
            "warnings": [],
        }
        prompt = reference_curation_signals.build_summary_prompt(
            "Reference source text.",
            max_tokens=100,
            reference={"title": "Reference A", "sourceUri": "https://example.test/ref"},
            doctrine_context=context,
        )

        self.assertIn("Publication Context:", prompt)
        self.assertIn("Study operational publication systems.", prompt)
        self.assertIn("Published items should be evidence-backed.", prompt)
        self.assertIn("should not be treated as rules that the Reference itself must satisfy", prompt)

    def test_summary_metadata_records_doctrine_context(self):
        reference = {
            "id": "reference-a-v1",
            "lineageId": "reference-a",
            "versionNumber": 1,
            "corpusId": "knowledge-corpus-test",
            "externalItemId": "item-a",
            "title": "Reference A",
            "importRunId": "import-1",
        }

        class FakeSemantic:
            def list_incoming(self, _kind, _lineage_id):
                return {"relations": []}

        doctrine_context = {
            "status": "loaded",
            "scope": "publication",
            "policyUse": "context_only_not_reference_rubric",
            "slugs": ["editorial-doctrine-mission", "editorial-doctrine-policy"],
            "records": [],
            "contentHash": "hash-1",
            "warnings": [],
        }
        plan = reference_curation_signals.build_reference_summary_plan(
            reference=reference,
            max_tokens=100,
            summary_text="A short summary.",
            source_text="Long source text.",
            model="gpt-5.4-mini",
            doctrine_context=doctrine_context,
            now="2026-05-19T12:00:00Z",
            semantic_client=FakeSemantic(),
        )

        self.assertEqual(plan["metadata"]["promptVersion"], "reference-summary-v2-publication-doctrine")
        self.assertEqual(plan["metadata"]["doctrineContextStatus"], "loaded")
        self.assertEqual(plan["metadata"]["doctrineScope"], "publication")
        self.assertEqual(plan["metadata"]["policyUse"], "context_only_not_reference_rubric")
        self.assertEqual(plan["metadata"]["doctrineSlugs"], ["editorial-doctrine-mission", "editorial-doctrine-policy"])
        self.assertEqual(plan["metadata"]["doctrineContentHash"], "hash-1")

    def test_manual_summary_metadata_records_doctrine_not_used(self):
        reference = {
            "id": "reference-a-v1",
            "lineageId": "reference-a",
            "versionNumber": 1,
            "corpusId": "knowledge-corpus-test",
            "externalItemId": "item-a",
            "title": "Reference A",
            "importRunId": "import-1",
        }

        class FakeSemantic:
            def list_incoming(self, _kind, _lineage_id):
                return {"relations": []}

        plan = reference_curation_signals.build_reference_summary_plan(
            reference=reference,
            max_tokens=100,
            summary_text="Manual summary.",
            model="manual",
            doctrine_context=reference_curation_signals.manual_summary_doctrine_context(),
            now="2026-05-19T12:00:00Z",
            semantic_client=FakeSemantic(),
        )

        self.assertEqual(plan["metadata"]["doctrineContextStatus"], "not_used_manual_summary")
        self.assertEqual(plan["metadata"]["policyUse"], "context_only_not_reference_rubric")

    def test_quality_assessment_prompt_includes_doctrine_but_excludes_policy_as_rubric(self):
        context = {
            "status": "loaded",
            "scope": "publication",
            "policyUse": "context_only_not_reference_rubric",
            "slugs": ["editorial-doctrine-mission", "editorial-doctrine-policy"],
            "records": [
                {"slug": "editorial-doctrine-mission", "label": "Editorial Mission", "body": ["Study operational publication systems."]},
                {"slug": "editorial-doctrine-policy", "label": "Editorial Policy", "body": ["Published items should be evidence-backed."]},
            ],
            "contentHash": "hash-1",
            "warnings": [],
        }
        prompt = reference_curation_signals.build_quality_assessment_prompt(
            "Reference source text.",
            reference={"title": "Reference A", "sourceUri": "https://example.test/ref"},
            rubric="Rate 1 to 5 based on source quality.",
            doctrine_context=context,
        )

        self.assertIn("Study operational publication systems.", prompt)
        self.assertIn("Do not score the Reference by whether it complies with publication policies.", prompt)
        self.assertIn("Rate 1 to 5 based on source quality.", prompt)

    def test_quality_assessment_result_normalizes_structured_output(self):
        response_payload = {
            "output_text": json.dumps({
                "rating": 4,
                "rationale": "Strong peer-reviewed source.",
                "evidence": ["Clear method", "Relevant findings"],
                "caveats": ["Narrow benchmark"],
            })
        }

        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return json.dumps(response_payload).encode("utf-8")

        with mock.patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), \
             mock.patch("papyrus_newsroom.reference_curation_signals.urllib.request.urlopen", return_value=FakeResponse()):
            result = reference_curation_signals.generate_quality_assessment(
                "Reference source text.",
                reference={"title": "Reference A"},
                model="gpt-5.4-mini",
                doctrine_context=reference_curation_signals.manual_summary_doctrine_context(),
            )

        self.assertEqual(result["rating"], 4)
        self.assertNotIn("confidence", result)
        self.assertEqual(result["promptVersion"], "reference-quality-v1-publication-doctrine")
        self.assertEqual(result["evidence"], ["Clear method", "Relevant findings"])

    def test_title_subtitle_prompt_requires_verbatim_originals(self):
        prompt = reference_curation_signals.build_title_subtitle_prompt(
            reference={"title": "", "sourceUri": "https://example.test/paper"},
            catalog_entry={"item_id": "item-1", "metadata": {"doi": "10.1234/example"}},
            source_text="Original Paper Title\nOriginal subtitle text",
        )

        self.assertIn("Use the original title verbatim if available.", prompt)
        self.assertIn("Use the original subtitle verbatim if available.", prompt)
        self.assertIn("Do not paraphrase original titles or subtitles.", prompt)
        self.assertIn("Subtitle must be one short prose line.", prompt)
        self.assertIn("Do not use Markdown.", prompt)
        self.assertIn("Do not use bullet points.", prompt)
        self.assertIn("Do not use numbered lists.", prompt)
        self.assertIn("Do not include line breaks.", prompt)

    def test_subtitle_normalizer_rejects_list_shaped_values(self):
        self.assertEqual(reference_curation_signals._normalize_subtitle_candidate("- First bullet"), "")
        self.assertEqual(reference_curation_signals._normalize_subtitle_candidate("* First bullet"), "")
        self.assertEqual(reference_curation_signals._normalize_subtitle_candidate("1. First bullet"), "")
        self.assertEqual(reference_curation_signals._normalize_subtitle_candidate("• First bullet"), "")
        self.assertEqual(reference_curation_signals._normalize_subtitle_candidate("Line one\nLine two"), "")
        self.assertEqual(
            reference_curation_signals._normalize_subtitle_candidate("Abstract page for arXiv paper 2506.01232"),
            "",
        )
        self.assertEqual(
            reference_curation_signals._normalize_subtitle_candidate("Join the discussion on this paper page"),
            "",
        )
        self.assertEqual(
            reference_curation_signals._normalize_subtitle_candidate(
                "<< /Metadata 3 0 R /Names 4 0 R /OpenAction 5 0 R /Outlines 6 0 R /PageMode /UseOutlines /Pages 7 0 R /Type /Catalog >>"
            ),
            "",
        )
        self.assertEqual(
            reference_curation_signals._normalize_subtitle_candidate("Concise prose subtitle"),
            "Concise prose subtitle",
        )

    def test_title_subtitle_resolver_preserves_local_metadata_verbatim(self):
        result = reference_curation_signals.resolve_reference_title_subtitle(
            reference={"id": "reference-1-v1", "title": ""},
            catalog_entry={
                "title": "Exact Source Title",
                "metadata": {"subtitle": "Exact Source Subtitle"},
            },
            web_search_enabled=False,
            now="2026-05-20T12:00:00Z",
        )

        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["title"], "Exact Source Title")
        self.assertEqual(result["subtitle"], "Exact Source Subtitle")
        self.assertEqual(result["title_mode"], "original_metadata")
        self.assertEqual(result["subtitle_mode"], "original_metadata")

    def test_title_subtitle_plan_updates_title_and_metadata_attachment(self):
        reference = {
            "id": "reference-a-v1",
            "lineageId": "reference-a",
            "versionNumber": 1,
            "externalItemId": "item-a",
            "title": "",
            "sourceUri": "https://example.test/ref",
            "metadata": {},
        }

        class FakeSemantic:
            pass

        with mock.patch(
            "papyrus_newsroom.reference_curation_signals.resolve_reference_title_subtitle",
            return_value={
                "status": "resolved",
                "title": "Exact Source Title",
                "subtitle": "Exact Source Subtitle",
                "title_mode": "original_web_metadata",
                "subtitle_mode": "original_web_metadata",
                "source": "html_metadata",
                "model": "gpt-5.4-mini",
                "web_search_used": False,
                "source_urls": ["https://example.test/ref"],
                "rationale": "Resolved from metadata.",
                "summary": "This work reports the main finding and why it matters.",
                "summary_resolution": {
                    "summaryTokenBudget": 500,
                    "actualTokenEstimate": 20,
                    "model": "gpt-5.4-mini",
                    "promptVersion": "reference-title-subtitle-summary-v1-outcome",
                    "source": "llm_outcome_summary",
                    "source_urls": ["https://example.test/ref"],
                    "run_id": "run-1",
                    "resolved_at": "2026-05-20T12:00:00Z",
                    "rationale": "Outcome summary generated from source text.",
                },
                "run_id": "run-1",
                "resolved_at": "2026-05-20T12:00:00Z",
                "prompt_version": "",
                "warnings": [],
            },
        ):
            plan = reference_curation_signals.build_reference_title_subtitle_plan(
                reference=reference,
                web_search_enabled=False,
                now="2026-05-20T12:00:00Z",
                semantic_client=FakeSemantic(),
            )

        self.assertEqual(plan["action"], "update")
        self.assertEqual(plan["records"][0]["modelName"], "Reference")
        self.assertEqual(plan["records"][0]["input"]["title"], "Exact Source Title")
        self.assertEqual(plan["records"][1]["modelName"], "ModelAttachment")
        metadata = json.loads(plan["records"][1]["body"])
        self.assertEqual(metadata["subtitle"], "Exact Source Subtitle")
        self.assertEqual(metadata["summary"], "This work reports the main finding and why it matters.")
        self.assertEqual(metadata["title_subtitle_resolution"]["title_mode"], "original_web_metadata")
        self.assertEqual(metadata["summary_resolution"]["summaryTokenBudget"], 500)

    def test_title_subtitle_resolve_reports_vector_sync_surface_status(self):
        reference = {
            "id": "reference-a-v1",
            "lineageId": "reference-a",
            "versionState": "current",
            "curationStatus": "accepted",
            "externalItemId": "item-a",
            "title": "",
            "sourceUri": "https://example.test/ref",
            "metadata": {},
        }

        with mock.patch(
            "papyrus_newsroom.reference_curation_signals._semantic_client",
            return_value=mock.Mock(get_reference=mock.Mock(return_value={"reference": reference})),
        ), mock.patch(
            "papyrus_newsroom.reference_curation_signals._read_reference_sidecar",
            return_value={},
        ), mock.patch(
            "papyrus_newsroom.reference_curation_signals._read_reference_catalog_entry",
            return_value={},
        ), mock.patch(
            "papyrus_newsroom.reference_curation_signals.build_reference_title_subtitle_plan",
            return_value={
                "kind": "reference.title-subtitle.plan",
                "action": "update",
                "reference": {"id": "reference-a-v1", "lineageId": "reference-a"},
                "resolution": {"status": "resolved", "title": "Resolved Title", "subtitle": "Resolved Subtitle"},
                "records": [{"modelName": "Reference", "action": "update", "input": {"id": "reference-a-v1", "title": "Resolved Title"}}],
                "warnings": [],
            },
        ), mock.patch(
            "papyrus_newsroom.reference_curation_signals._apply_plan_if_requested",
            return_value={"action": "update", "apply": True, "applied": [{"modelName": "Reference", "action": "update", "id": "reference-a-v1"}], "warnings": []},
        ), mock.patch(
            "papyrus_newsroom.reference_curation_signals.apply_title_subtitle_local_metadata",
            return_value={"updated": [{"target": "catalog"}], "errors": [], "skipped": []},
        ), mock.patch(
            "papyrus_newsroom.reference_curation_signals._sync_reference_vectors",
            return_value={
                "failed": False,
                "resultsByLineageId": {"reference-a": {"updated": True, "skipped": None, "failed": None}},
                "resultsByReferenceId": {"reference-a-v1": {"updated": True, "skipped": None, "failed": None}},
            },
        ):
            result = reference_curation_signals.reference_title_subtitle_resolve(
                reference_id="reference-a-v1",
                apply=True,
            )

        self.assertTrue(result["localUpdated"])
        self.assertTrue(result["graphqlUpdated"])
        self.assertTrue(result["vectorIndexUpdated"])
        self.assertIsNone(result["vectorIndexSkipped"])
        self.assertIsNone(result["vectorIndexFailed"])

    def test_title_subtitle_resolve_marks_partial_failure_when_vector_sync_fails(self):
        with mock.patch(
            "papyrus_newsroom.reference_curation_signals._sync_reference_vectors",
            return_value={
                "failed": True,
                "message": "Vector index sync failed after GraphQL/local updates.",
                "resultsByLineageId": {"reference-a": {"updated": False, "skipped": None, "failed": "Vector index sync failed after GraphQL/local updates."}},
                "resultsByReferenceId": {"reference-a-v1": {"updated": False, "skipped": None, "failed": "Vector index sync failed after GraphQL/local updates."}},
            },
        ):
            annotated = reference_curation_signals._attach_title_subtitle_surface_statuses(
                {
                    "action": "update",
                    "apply": True,
                    "applied": [{"modelName": "Reference", "action": "update", "id": "reference-a-v1"}],
                    "localMetadata": {"updated": [{"target": "catalog"}]},
                    "warnings": [],
                },
                references=[{
                    "id": "reference-a-v1",
                    "lineageId": "reference-a",
                    "versionState": "current",
                    "curationStatus": "accepted",
                }],
                apply=True,
                vector_sync=True,
            )

        self.assertIn("vectorSync", annotated)
        self.assertIsNotNone(annotated["vectorIndexFailed"])
        self.assertTrue(annotated["partialFailure"])

    def test_catalog_title_subtitle_enrichment_writes_metadata_without_web(self):
        result = reference_curation_signals.enrich_reference_catalog_title_subtitle(
            catalog={
                "items": [
                    {
                        "item_id": "item-1",
                        "metadata": {
                            "title": "Verbatim Catalog Title",
                            "subtitle": "Verbatim Catalog Subtitle",
                            "summary": "Existing metadata summary.",
                        },
                    }
                ]
            },
            web_search=False,
        )

        item = result["catalog"]["items"][0]
        self.assertEqual(item["title"], "Verbatim Catalog Title")
        self.assertEqual(item["subtitle"], "Verbatim Catalog Subtitle")
        self.assertEqual(item["metadata"]["subtitle"], "Verbatim Catalog Subtitle")
        self.assertEqual(item["summary"], "Existing metadata summary.")
        self.assertEqual(item["metadata"]["summary"], item["summary"])
        self.assertEqual(item["metadata"]["title_subtitle_resolution"]["title_mode"], "original_metadata")
        self.assertIn("summary_resolution", item["metadata"])

    def test_resolver_ignores_bullet_list_subtitle_from_local_metadata(self):
        result = reference_curation_signals.resolve_reference_title_subtitle(
            reference={"id": "reference-1-v1", "title": "Reliable Title"},
            catalog_entry={
                "title": "Reliable Title",
                "metadata": {"subtitle": "- one\n- two", "summary": "A valid local summary."},
            },
            web_search_enabled=False,
            now="2026-05-20T12:00:00Z",
        )

        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["title"], "Reliable Title")
        self.assertEqual(result["subtitle"], "")
        self.assertEqual(result["subtitle_mode"], "unresolved")
        self.assertEqual(result["summary"], "A valid local summary.")

    def test_catalog_title_subtitle_enrichment_prefers_newest_items(self):
        result = reference_curation_signals.enrich_reference_catalog_title_subtitle(
            catalog={
                "items": [
                    {
                        "id": "older-item",
                        "created_at": "2026-01-01T00:00:00Z",
                        "title": "Older Title",
                        "metadata": {},
                    },
                    {
                        "id": "newer-item",
                        "created_at": "2026-05-20T00:00:00Z",
                        "title": "Newer Title",
                        "metadata": {},
                    },
                ]
            },
            web_search=False,
            max_count=1,
        )

        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["itemKey"], "1")

    def test_catalog_only_missing_requires_title_subtitle_and_summary(self):
        with mock.patch(
            "papyrus_newsroom.reference_curation_signals.generate_outcome_summary",
            return_value="Generated summary for only-missing test.",
        ):
            result = reference_curation_signals.enrich_reference_catalog_title_subtitle(
                catalog={
                    "items": [
                        {
                            "id": "item-1",
                            "title": "Existing Title",
                            "subtitle": "Existing Subtitle",
                            "metadata": {
                                "title": "Existing Title",
                                "subtitle": "Existing Subtitle",
                            },
                        }
                    ]
                },
                web_search=False,
                only_missing=True,
            )

        self.assertEqual(result["items"][0]["action"], "update")
        enriched = result["catalog"]["items"][0]
        self.assertTrue(enriched.get("summary"))
        self.assertTrue(enriched.get("metadata", {}).get("summary"))

    def test_refresh_summary_updates_metadata_summary_even_with_existing_title_subtitle(self):
        reference = {
            "id": "reference-a-v1",
            "lineageId": "reference-a",
            "versionNumber": 1,
            "externalItemId": "item-a",
            "title": "Existing Title",
            "sourceUri": "https://example.test/ref",
            "metadata": {
                "subtitle": "Existing Subtitle",
                "summary": "Old summary.",
                "summary_resolution": {"summaryTokenBudget": 500},
            },
        }

        class FakeSemantic:
            pass

        with mock.patch(
            "papyrus_newsroom.reference_curation_signals.resolve_reference_title_subtitle",
            return_value={
                "status": "resolved",
                "title": "Existing Title",
                "subtitle": "Existing Subtitle",
                "title_mode": "existing_reference",
                "subtitle_mode": "existing_reference_metadata",
                "source": "llm_outcome_summary",
                "model": "gpt-5.4-mini",
                "web_search_used": False,
                "source_urls": [],
                "rationale": "Summary refresh.",
                "summary": "New summary content.",
                "summary_resolution": {
                    "summaryTokenBudget": 500,
                    "actualTokenEstimate": 10,
                    "model": "gpt-5.4-mini",
                    "promptVersion": "reference-title-subtitle-summary-v1-outcome",
                    "source": "llm_outcome_summary",
                    "source_urls": [],
                    "run_id": "run-1",
                    "resolved_at": "2026-05-20T12:00:00Z",
                    "rationale": "Refreshed summary.",
                },
                "run_id": "run-1",
                "resolved_at": "2026-05-20T12:00:00Z",
                "prompt_version": "",
                "warnings": [],
            },
        ):
            plan = reference_curation_signals.build_reference_title_subtitle_plan(
                reference=reference,
                web_search_enabled=False,
                refresh=False,
                refresh_summary=True,
                now="2026-05-20T12:00:00Z",
                semantic_client=FakeSemantic(),
            )

        self.assertEqual(plan["action"], "update")
        self.assertEqual(plan["records"][0]["modelName"], "Reference")
        self.assertEqual(plan["records"][0]["input"]["title"], "Existing Title")
        metadata = json.loads(plan["records"][1]["body"])
        self.assertEqual(metadata["subtitle"], "Existing Subtitle")
        self.assertEqual(metadata["summary"], "New summary content.")

    def test_local_title_normalization_strips_citation_wrappers(self):
        result = reference_curation_signals.resolve_reference_title_subtitle(
            reference={},
            catalog_entry={
                "title": "[2408.15247] AutoGen Studio: A No-Code Developer Tool for Building and Debugging Multi-Agent Systems - arXiv, accessed May 19, 2026,",
                "metadata": {},
            },
            sidecar={},
            web_search_enabled=False,
        )

        self.assertEqual(
            result["title"],
            "AutoGen Studio: A No-Code Developer Tool for Building and Debugging Multi-Agent Systems",
        )
        self.assertEqual(
            result["subtitle"],
            "A No-Code Developer Tool for Building and Debugging Multi-Agent Systems",
        )

    def test_placeholder_title_is_not_written(self):
        result = reference_curation_signals.resolve_reference_title_subtitle(
            reference={},
            catalog_entry={},
            sidecar={},
            web_search_enabled=True,
            llm_resolver=lambda **_: {
                "title": "Unresolved",
                "subtitle": "ScienceDirect article metadata unavailable",
                "title_mode": "unresolved",
                "subtitle_mode": "generated_fallback",
                "source_urls": [],
                "rationale": "Could not verify.",
                "promptVersion": "test",
                "model": "gpt-5.4-mini",
            },
        )

        self.assertEqual(result["status"], "unresolved")
        self.assertEqual(result["title"], "")
        self.assertEqual(result["subtitle"], "")

    def test_semantic_neighbors_and_walk_use_graph_indexes(self):
        calls = []

        def fake_graphql(query, variables):
            calls.append(variables)
            if "listSemanticRelationsBySubjectState" in query:
                return {
                    "listSemanticRelationsBySubjectState": {
                        "items": [
                            {
                                "id": "rel-1",
                                "relationState": "current",
                                "predicate": "classified_as",
                                "subjectKind": "reference",
                                "subjectId": "ref-v1",
                                "subjectLineageId": "ref",
                                "objectKind": "category",
                                "objectId": "cat-v1",
                                "objectLineageId": "cat",
                                "subjectStateKey": "reference#ref#current",
                                "objectStateKey": "category#cat#current",
                                "predicateObjectStateKey": "classified_as#category#cat#current",
                            }
                        ],
                        "nextToken": None,
                    }
                }
            if "listSemanticRelationsByObjectState" in query:
                return {"listSemanticRelationsByObjectState": {"items": [], "nextToken": None}}
            raise AssertionError(f"Unexpected query {query}")

        client = papyrus_semantic.PapyrusSemanticClient(fake_graphql)
        neighbors = client.neighbors("reference", "ref")
        self.assertEqual(neighbors["neighborRefs"], [{"kind": "category", "lineageId": "cat", "id": "cat-v1"}])
        walked = client.walk("reference", "ref", depth=1)
        self.assertIn({"kind": "category", "lineageId": "cat"}, walked["nodes"])
        self.assertEqual(calls[0]["subjectStateKey"], "reference#ref#current")


if __name__ == "__main__":
    unittest.main()
