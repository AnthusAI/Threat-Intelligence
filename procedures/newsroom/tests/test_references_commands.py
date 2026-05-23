import json
import pathlib
import sys
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content.reference_assignments import (  # noqa: E402
    doi_backfill_compatibility_flags,
    normalize_extraction_stages,
    normalize_identifier_types,
    timestamp_for_path,
)
from papyrus_content.reference_exports import (  # noqa: E402
    build_reference_analysis_manifest,
    build_reference_scope_training_export,
    reference_manifest_item,
)
from papyrus_content.reference_labels import (  # noqa: E402
    build_manual_authoritative_label_relation,
    build_classification_prediction_rows,
)
from papyrus_content.references_commands import extract_last_json_object  # noqa: E402


class ReferenceCommandsTests(unittest.TestCase):
    def test_normalize_identifier_types_accepts_aliases(self):
        self.assertEqual(normalize_identifier_types("doi, arxiv, isbn13"), ["doi", "arxiv_id", "isbn13"])

    def test_doi_backfill_compatibility_flags_maps_only_missing_doi(self):
        flags = doi_backfill_compatibility_flags(["--corpus-key", "AI-ML-research", "--only-missing-doi", "true"])
        self.assertIn("--only-missing", flags)
        self.assertIn("true", flags)
        self.assertIn("--types", flags)
        self.assertEqual(flags[flags.index("--types") + 1], "doi")

    def test_normalize_extraction_stages_defaults(self):
        self.assertEqual(
            normalize_extraction_stages(None),
            ["pass-through-text", "pdf-text", "metadata-text"],
        )
        self.assertEqual(normalize_extraction_stages("pdf-text,metadata-text"), ["pdf-text", "metadata-text"])

    def test_timestamp_for_path_strips_punctuation(self):
        self.assertRegex(timestamp_for_path("2026-05-23T12:00:00.000Z"), r"^2026-05-23T12-00-00-000Z$")

    def test_build_reference_analysis_manifest_requires_text_attachments(self):
        corpus_config = {"key": "AI-ML-research", "name": "AI-ML-research", "path": "corpora/AI-ML-research"}
        corpus_id = "knowledge-corpus-ai-ml-research"
        references = [
            {
                "id": "reference-1",
                "lineageId": "reference-lineage-1",
                "corpusId": corpus_id,
                "versionState": "current",
                "curationStatus": "accepted",
                "externalItemId": "item-1",
                "storagePath": "corpora/AI-ML-research/imports/item-1.pdf",
            }
        ]
        attachments = []
        with self.assertRaisesRegex(ValueError, "lack snapshot-backed extracted_text attachments"):
            build_reference_analysis_manifest(
                corpus_config=corpus_config,
                corpus_id=corpus_id,
                references=references,
                attachments=attachments,
            )

    def test_build_reference_scope_training_export_labels(self):
        corpus_config = {"key": "AI-ML-research", "name": "AI-ML-research", "path": "corpora/AI-ML-research"}
        corpus_id = "knowledge-corpus-ai-ml-research"
        references = [
            {
                "id": "reference-accepted",
                "lineageId": "lineage-accepted",
                "corpusId": corpus_id,
                "versionState": "current",
                "curationStatus": "accepted",
                "externalItemId": "accepted-1",
            },
            {
                "id": "reference-rejected",
                "lineageId": "lineage-rejected",
                "corpusId": corpus_id,
                "versionState": "current",
                "curationStatus": "rejected",
                "externalItemId": "rejected-1",
                "metadata": json.dumps({"reasonCode": "out_of_scope"}),
            },
        ]
        payload = build_reference_scope_training_export(
            corpus_config=corpus_config,
            corpus_id=corpus_id,
            references=references,
            attachments=[],
            messages=[],
            relations=[],
        )
        self.assertEqual(payload["counts"]["positive"], 1)
        self.assertEqual(payload["counts"]["negative"], 1)
        labels = {item["item_id"]: item["scope_training_label"] for item in payload["items"]}
        self.assertEqual(labels["accepted-1"], "in_scope")
        self.assertEqual(labels["rejected-1"], "out_of_scope")

    def test_build_manual_authoritative_label_relation_shape(self):
        relation = build_manual_authoritative_label_relation(
            reference={"id": "reference-1", "lineageId": "lineage-1", "versionNumber": 1},
            category={"id": "category-1", "lineageId": "category-lineage-1", "versionNumber": 1, "categoryKey": "topic.ml"},
            category_set={"id": "category-set-1", "classifierId": "ai-ml-v1"},
            note="manual label",
            actor="tester",
        )
        self.assertEqual(relation["predicate"], "authoritative_label")
        self.assertEqual(relation["subjectId"], "reference-1")
        self.assertEqual(relation["objectId"], "category-1")

    def test_build_classification_prediction_rows_filters_by_corpus(self):
        relations = [
            {
                "id": "relation-1",
                "relationState": "current",
                "relationTypeKey": "classified_as",
                "subjectKind": "reference",
                "objectKind": "category",
                "subjectLineageId": "lineage-1",
                "objectLineageId": "category-lineage-1",
                "subjectStateKey": "reference#lineage-1#current",
                "objectStateKey": "category#category-lineage-1#current",
            }
        ]
        references = [
            {
                "id": "reference-1",
                "lineageId": "lineage-1",
                "corpusId": "knowledge-corpus-ai-ml-research",
                "versionState": "current",
                "externalItemId": "item-1",
            }
        ]
        categories = [
            {
                "id": "category-1",
                "lineageId": "category-lineage-1",
                "categorySetId": "category-set-1",
                "versionState": "current",
                "categoryKey": "topic.ml",
            }
        ]
        rows = build_classification_prediction_rows(
            relations=relations,
            references=references,
            categories=categories,
            corpus_id="knowledge-corpus-ai-ml-research",
            category_set_id="category-set-1",
            status="current",
            limit=None,
        )
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["hasAuthoritativeLabel"])

    def test_reference_manifest_item_includes_attachments(self):
        reference = {"id": "reference-1", "lineageId": "lineage-1", "externalItemId": "item-1", "title": "Title"}
        attachments = [
            {"referenceLineageId": "lineage-1", "role": "source", "sortKey": "100-source", "storagePath": "corpora/x/y.pdf"}
        ]
        item = reference_manifest_item(reference, attachments)
        self.assertEqual(item["item_id"], "item-1")
        self.assertEqual(len(item["attachments"]), 1)

    def test_extract_last_json_object_reads_trailing_json_line(self):
        payload = extract_last_json_object('log line\n{"ok": true, "runId": "abc"}\n')
        self.assertEqual(payload, {"ok": True, "runId": "abc"})

    @mock.patch("papyrus_content.references_commands.subprocess.run")
    def test_curate_recent_prints_summary_from_json(self, mock_run):
        from papyrus_content.references_commands import references_curate_recent

        mock_run.return_value = mock.Mock(
            returncode=0,
            stdout='{"runId":"run-1","manifestPath":"/tmp/manifest.json","apply":false,"ok":true,"degraded":false,"summary":{"selectedCount":2,"processedCount":2,"succeededCount":2,"failedCount":0},"items":[],"warnings":[]}\n',
            stderr="",
        )
        with mock.patch("builtins.print") as mock_print:
            references_curate_recent(["--corpus-key", "AI-ML-research"])
        printed = "\n".join(str(call.args[0]) for call in mock_print.call_args_list)
        self.assertIn("references\tcurate-recent\trun\trun-1", printed)
        self.assertIn("references\tcurate-recent\tselected\t2", printed)


if __name__ == "__main__":
    unittest.main()
