import json
import pathlib
import subprocess
import sys
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content.categories_steering import (  # noqa: E402
    build_accepted_category_set_payload,
    build_steering_import_records,
    load_steering_bundle_from_biblicus,
)


FIXTURE_PATH = REPO_ROOT / "procedures" / "newsroom" / "tests" / "fixtures" / "steering-export-minimal.json"


class CategoriesSteeringTests(unittest.TestCase):
    def test_build_steering_import_records_matches_node_fixture_shape(self):
        bundle = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        plan = build_steering_import_records(
            bundle,
            {
                "classifierId": "ai-ml-v1",
                "corpusConfig": {"key": "AI-ML-research", "name": "AI-ML-research", "role": "canonical"},
                "importedAt": "2026-01-01T12:00:00.000Z",
            },
        )
        self.assertEqual(plan["corpusId"], "knowledge-corpus-ai-ml-research")
        self.assertEqual(plan["categorySetId"], "category-set-knowledge-corpus-ai-ml-research-ai-ml-v1")
        self.assertEqual(plan["importRunId"], "knowledge-import-knowledge-corpus-ai-ml-research-ai-ml-v1-4bc31e095f4fc34e")
        self.assertEqual(len(plan["records"]), 29)
        model_names = [record["modelName"] for record in plan["records"]]
        self.assertEqual(model_names.count("Category"), 4)
        self.assertEqual(model_names.count("SemanticNode"), 12)
        self.assertEqual(model_names.count("CategorySet"), 1)
        category_set = next(record for record in plan["records"] if record["modelName"] == "CategorySet")
        self.assertEqual(category_set["expected"]["classifierId"], "ai-ml-v1")
        self.assertEqual(category_set["expected"]["categoryCount"], 2)

    def test_build_accepted_category_set_payload_sorts_topics(self):
        category_set = {
            "id": "category-set-test",
            "classifierId": "ai-ml-v1",
            "displayName": "AI/ML Research",
            "description": "desc",
        }
        topics = [
            {"categoryKey": "category.nlp", "displayName": "NLP", "rank": 2},
            {"categoryKey": "category.ml", "displayName": "Machine Learning", "rank": 1},
        ]
        payload = build_accepted_category_set_payload(category_set, topics)
        self.assertEqual([topic["topic_uid"] for topic in payload["topics"]], ["category.ml", "category.nlp"])

    @mock.patch("papyrus_content.categories_steering.subprocess.run")
    def test_load_steering_bundle_from_biblicus_invokes_uv(self, mock_run):
        mock_run.return_value = mock.Mock(returncode=0, stdout='{"generated_at":"2026-01-01T00:00:00Z"}', stderr="")
        bundle = load_steering_bundle_from_biblicus(
            corpus="corpora/AI-ML-research",
            classifier="ai-ml-v1",
            biblicus_workdir="/tmp/Biblicus",
        )
        self.assertEqual(bundle["generated_at"], "2026-01-01T00:00:00Z")
        mock_run.assert_called_once()
        args, kwargs = mock_run.call_args
        self.assertEqual(args[0][:2], ["uv", "run"])
        self.assertIn("biblicus", args[0])
        self.assertIn("steering", args[0])
        self.assertEqual(kwargs["cwd"], pathlib.Path("/tmp/Biblicus"))

    @mock.patch("papyrus_content.categories_steering.subprocess.run")
    def test_load_steering_bundle_from_biblicus_raises_on_failure(self, mock_run):
        mock_run.return_value = mock.Mock(returncode=1, stdout="", stderr="export failed")
        with self.assertRaises(RuntimeError) as context:
            load_steering_bundle_from_biblicus(corpus="corpora/AI-ML-research", classifier="ai-ml-v1")
        self.assertIn("Biblicus steering export failed", str(context.exception))


if __name__ == "__main__":
    unittest.main()
