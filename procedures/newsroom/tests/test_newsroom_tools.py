import importlib.util
import json
import pathlib
import unittest
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "tools" / "papyrus_newsroom.py"
SPEC = importlib.util.spec_from_file_location("papyrus_newsroom", MODULE_PATH)
papyrus_newsroom = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(papyrus_newsroom)


class NewsroomToolTests(unittest.TestCase):
    def test_assignment_plan_uses_status_lifecycle(self):
        plan = papyrus_newsroom.build_assignment_record_plan(
            edition_id="edition-1",
            corpus_key="AI-ML-research",
            generated_at="2026-05-16T12:00:00Z",
            assignment_json=json.dumps(
                {
                    "title": "AI Agents Enter the Lab",
                    "brief": "Explain how agentic systems are changing research workflows.",
                    "angle": "Focus on practical scientific workflow changes.",
                    "topic_uid": "automated-scientific-discovery",
                    "evidence_item_ids": ["research-001"],
                    "recent_article_notes": ["Avoid yesterday's benchmark roundup."],
                }
            ),
        )

        item = plan["item"]
        self.assertTrue(plan["dryRun"])
        self.assertEqual(item["type"], "article")
        self.assertEqual(item["status"], "assignment")
        self.assertEqual(item["typeStatus"], "article#assignment")
        self.assertEqual(item["body"], [])
        self.assertIsNone(item["publishedAt"])
        self.assertEqual(plan["editionItem"]["editionId"], "edition-1")
        self.assertEqual(plan["editionItem"]["placementKey"], "assignment:ai-agents-enter-the-lab")
        assignment = item["editorial"]["newsroom"]["assignment"]
        self.assertEqual(assignment["corpusKey"], "AI-ML-research")
        self.assertEqual(assignment["topicUid"], "automated-scientific-discovery")
        self.assertEqual(assignment["evidenceItemIds"], ["research-001"])

    def test_draft_plan_advances_same_item_to_draft(self):
        plan = papyrus_newsroom.build_draft_update_plan(
            generated_at="2026-05-16T12:30:00Z",
            assignment_item_json=json.dumps(
                {
                    "id": "assignment-1",
                    "type": "article",
                    "status": "assignment",
                    "typeStatus": "article#assignment",
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

        item = plan["item"]
        self.assertTrue(plan["dryRun"])
        self.assertEqual(item["id"], "assignment-1")
        self.assertEqual(item["type"], "article")
        self.assertEqual(item["status"], "draft")
        self.assertEqual(item["typeStatus"], "article#draft")
        self.assertEqual(item["sectionStatus"], "research#draft")
        self.assertIsNone(item["publishedAt"])
        self.assertIn("assignment", item["editorial"]["newsroom"])
        self.assertEqual(item["editorial"]["newsroom"]["draft"]["evidenceItemIds"], ["research-001"])

    def test_research_plan_preserves_assignment_lifecycle(self):
        plan = papyrus_newsroom.build_research_update_plan(
            generated_at="2026-05-16T12:15:00Z",
            assignment_item_json=json.dumps(
                {
                    "id": "assignment-1",
                    "type": "article",
                    "status": "assignment",
                    "typeStatus": "article#assignment",
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
                    "topic_uid": "automated-scientific-discovery",
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
        self.assertEqual(item["id"], "assignment-1")
        self.assertEqual(item["type"], "article")
        self.assertEqual(item["status"], "assignment")
        self.assertEqual(item["typeStatus"], "article#assignment")
        self.assertIsNone(item["publishedAt"])
        self.assertIn("assignment", item["editorial"]["newsroom"])
        research = item["editorial"]["newsroom"]["research"]
        self.assertEqual(research["status"], "researched")
        self.assertEqual(research["corpusKey"], "AI-ML-research")
        self.assertEqual(research["evidenceItemIds"], ["research-001", "research-002"])
        self.assertEqual(research["procedure"]["role"], "researcher")

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


if __name__ == "__main__":
    unittest.main()
