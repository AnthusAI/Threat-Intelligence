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
from papyrus_newsroom import semantic as papyrus_semantic
from papyrus_newsroom import tactus_runtime


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
        self.assertEqual(
            result["api_calls"],
            ["papyrus.api.list", "papyrus.docs.list"],
        )

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
                    return {"relations": [{"subjectId": "reference-1-v1", "subjectLineageId": "reference-1"}]}
                return {"relations": []}

            def get_reference(self, reference_id):
                self_ref = {
                    "id": reference_id,
                    "lineageId": "reference-1",
                    "title": "Scaling Agent Memo",
                    "sourceUri": "https://example.com/scaling-agent-memo",
                    "sourcePublishedAt": "2026-05-13T12:00:00Z",
                }
                return {"reference": self_ref}

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
        self.assertEqual(research["comparisonFindings"], ["Release still requires a human approval gate."])
        self.assertEqual(research["rubricAssessments"][0]["key"], "autonomy-scope")
        self.assertEqual(research["procedure"]["role"], "researcher")
        self.assertEqual(plan["records"][0]["action"], "create")
        self.assertEqual(plan["records"][1]["input"]["versionState"], "superseded")
        relation_records = [record for record in plan["records"] if record["modelName"] == "SemanticRelation"]
        self.assertEqual(len(relation_records), 2)
        self.assertEqual(relation_records[0]["input"]["objectId"], "reference-knowledge-corpus-ai-ml-research-research-001-v1")

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
