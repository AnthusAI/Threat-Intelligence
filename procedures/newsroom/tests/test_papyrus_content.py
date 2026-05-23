import json
import pathlib
import sys
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content import cli as papyrus_content_cli
from papyrus_content.catalog import build_prepared_reference_catalog, build_reference_catalog_registration_records, catalog_items
from papyrus_content.ids import hash_short, knowledge_corpus_id, reference_lineage_id_for
from papyrus_content.source_readiness import reference_source_readiness
from papyrus_content.steering import load_steering_config, require_corpus_config


class PapyrusContentTests(unittest.TestCase):
    def test_is_ported_command(self) -> None:
        self.assertTrue(papyrus_content_cli.is_ported_command("corpora", "status"))
        self.assertTrue(papyrus_content_cli.is_ported_command("references", "accession-now"))
        self.assertTrue(papyrus_content_cli.is_ported_command("content", "inspect"))
        self.assertTrue(papyrus_content_cli.is_ported_command("assignments", "list"))
        self.assertFalse(papyrus_content_cli.is_ported_command("assignments", "orphan-research-packets"))

    def test_analysis_profiles_load(self) -> None:
        from papyrus_content.analysis_profiles import load_analysis_profiles, summarize_analysis_profiles

        config = load_analysis_profiles(REPO_ROOT / "corpora" / "papyrus-analysis-profiles.yml")
        summaries = summarize_analysis_profiles(config)
        self.assertGreaterEqual(len(summaries), 1)

    def test_steering_config_loads(self) -> None:
        config = load_steering_config(str(REPO_ROOT / "corpora" / "papyrus-steering.yml"))
        self.assertIsNotNone(config)
        assert config is not None
        self.assertGreaterEqual(len(config["corpora"]), 1)

    def test_build_reference_catalog_registration_records(self) -> None:
        config = load_steering_config(str(REPO_ROOT / "corpora" / "papyrus-steering.yml"))
        assert config is not None
        corpus = require_corpus_config(config, config["canonicalTopicSet"]["corpusKey"])
        catalog = {
            "items": [
                {
                    "item_id": "item-1",
                    "title": "Sample paper",
                    "source_uri": "https://arxiv.org/abs/0000.00001",
                    "ingestion_rationale": "Prospect for the pilot corpus.",
                }
            ]
        }
        plan = build_reference_catalog_registration_records(
            catalog,
            {
                "corpusConfig": corpus,
                "corpusId": knowledge_corpus_id(corpus),
                "classifierId": config["canonicalTopicSet"]["classifierId"],
                "status": "pending",
                "actor": "test",
            },
        )
        self.assertEqual(plan["itemCount"], 1)
        models = {entry["modelName"] for entry in plan["records"]}
        self.assertIn("Reference", models)
        self.assertIn("Assignment", models)
        self.assertIn("KnowledgeImportRun", models)

    def test_prepare_catalog_adds_missing_rationale(self) -> None:
        prepared = build_prepared_reference_catalog(
            {"items": [{"item_id": "x", "title": "Title", "source_uri": "https://example.com/paper"}]},
            {"corpusKey": "demo", "publicationName": "Demo Publication"},
        )
        item = catalog_items(prepared)[0]
        self.assertIn("ingestion_rationale", item)

    def test_reference_source_readiness_url_only(self) -> None:
        reference = {
            "id": "reference-1-v1",
            "lineageId": reference_lineage_id_for("knowledge-corpus-demo", "item-1"),
            "externalItemId": "item-1",
            "sourceUri": "https://example.com/paper.pdf",
            "versionState": "current",
        }
        readiness = reference_source_readiness(reference, [], None)
        self.assertEqual(readiness["state"], "url_only")

    def test_hash_short_is_stable(self) -> None:
        self.assertEqual(hash_short(["a", "b"]), hash_short(["a", "b"]))


if __name__ == "__main__":
    unittest.main()
