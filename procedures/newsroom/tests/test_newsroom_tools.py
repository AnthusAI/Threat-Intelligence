import importlib.util
import json
import pathlib
import sys
import unittest
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "tools" / "papyrus_newsroom.py"
SPEC = importlib.util.spec_from_file_location("papyrus_newsroom", MODULE_PATH)
papyrus_newsroom = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(papyrus_newsroom)

SEMANTIC_MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "tools" / "papyrus_semantic.py"
SEMANTIC_SPEC = importlib.util.spec_from_file_location("papyrus_semantic", SEMANTIC_MODULE_PATH)
papyrus_semantic = importlib.util.module_from_spec(SEMANTIC_SPEC)
sys.modules[SEMANTIC_SPEC.name] = papyrus_semantic
SEMANTIC_SPEC.loader.exec_module(papyrus_semantic)


class NewsroomToolTests(unittest.TestCase):
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
        self.assertEqual(assignment["downstreamReporter"]["procedure"], "procedures/newsroom/reporter.tac")
        evidence_relation = next(record for record in plan["records"] if record["modelName"] == "SemanticRelation")
        self.assertEqual(evidence_relation["input"]["predicate"], "uses_evidence")
        self.assertEqual(evidence_relation["input"]["subjectId"], item["id"])
        self.assertEqual(evidence_relation["input"]["objectId"], "reference-knowledge-corpus-ai-ml-research-research-001-v1")

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
                    "queries": ["agentic research workflows"],
                    "source_snapshots": [{"itemId": "research-001", "title": "Lab agents"}],
                    "research_notes": ["Tie the story to concrete workflow changes."],
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
        self.assertEqual(research["procedure"]["role"], "researcher")
        self.assertEqual(plan["records"][0]["action"], "create")
        self.assertEqual(plan["records"][1]["input"]["versionState"], "superseded")
        relation_records = [record for record in plan["records"] if record["modelName"] == "SemanticRelation"]
        self.assertEqual(len(relation_records), 2)
        self.assertEqual(relation_records[0]["input"]["objectId"], "reference-knowledge-corpus-ai-ml-research-research-001-v1")

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
