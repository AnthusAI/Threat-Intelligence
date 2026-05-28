import json
import io
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
from papyrus_content.reference_url_text import (  # noqa: E402
    ReferenceUrlTextExtractionError,
    _extract_url_text,
    _filter_article_text,
    build_reference_url_text_attachment_plans,
    build_reference_extracted_text_filter_attachment_plans,
    resolve_storage_bucket_name,
)
from papyrus_content.reference_metadata_generation import (  # noqa: E402
    run_reference_metadata_generation_from_extracted_text,
)
from papyrus_content.source_site_plugins import resolve_source_site_enrichment  # noqa: E402
from papyrus_content.source_readiness import select_extracted_text_attachment  # noqa: E402
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
        with self.assertRaisesRegex(ValueError, "lack extracted_text attachments"):
            build_reference_analysis_manifest(
                corpus_config=corpus_config,
                corpus_id=corpus_id,
                references=references,
                attachments=attachments,
            )

    def test_select_extracted_text_attachment_accepts_non_snapshot_paths(self):
        reference = {"id": "reference-1", "lineageId": "lineage-1", "externalItemId": "item-1"}
        attachments = [
            {
                "id": "attachment-1",
                "referenceLineageId": "lineage-1",
                "role": "extracted_text",
                "storagePath": "corpora/AI-ML-research/extracted/markitdown/text/lineage-1/extracted_text.md",
                "importedAt": "2026-05-27T00:00:00Z",
            }
        ]
        selected = select_extracted_text_attachment(reference, attachments)
        self.assertIsNotNone(selected)
        self.assertEqual(selected["id"], "attachment-1")

    @mock.patch("papyrus_content.reference_url_text._extract_url_text")
    @mock.patch("papyrus_content.reference_url_text._filter_article_text")
    def test_build_reference_url_text_attachment_plans(self, mock_filter, mock_extract):
        mock_extract.return_value = {
            "text": "Example plain text",
            "markdown": "# Example plain text",
            "title": "Example Title",
        }
        mock_filter.return_value = {
            "status": "ok",
            "text": "Filtered article text",
            "spanCount": 1,
            "promptVersion": "article-text-v1",
            "warnings": [],
            "retryTrace": [],
            "retryFailureCount": 0,
            "retryRoundsUsed": 2,
            "retryLastCode": None,
            "error": None,
            "model": "gpt-5.4-nano",
        }
        references = [
            {
                "id": "reference-1",
                "lineageId": "lineage-1",
                "versionNumber": 1,
                "versionState": "current",
                "corpusId": "knowledge-corpus-ai-ml-research",
                "externalItemId": "item-1",
                "sourceUri": "https://example.com/article",
            }
        ]
        result = build_reference_url_text_attachment_plans(
            references=references,
            attachments=[],
            corpus_key_by_id={"knowledge-corpus-ai-ml-research": "AI-ML-research"},
            corpus_id="knowledge-corpus-ai-ml-research",
            curation_status="all",
            force=False,
        )
        self.assertEqual(result["plannedCount"], 1)
        self.assertEqual(result["plannedAttachmentCount"], 2)
        by_role = {plan["record"]["expected"]["role"]: plan for plan in result["plans"]}
        self.assertIn("extracted_text_raw", by_role)
        self.assertIn("extracted_text", by_role)

        raw_expected = by_role["extracted_text_raw"]["record"]["expected"]
        self.assertEqual(raw_expected["mediaType"], "text/markdown")
        self.assertIn("markitdown/raw/lineage-1/extracted_text_raw.md", raw_expected["storagePath"])
        self.assertEqual(raw_expected["filename"], "extracted_text_raw.md")
        raw_metadata = json.loads(raw_expected["metadata"])
        self.assertEqual(raw_metadata["source"], "biblicus-url-text")
        self.assertEqual(raw_metadata["sourceUri"], "https://example.com/article")

        canonical_expected = by_role["extracted_text"]["record"]["expected"]
        self.assertIn("markitdown/text/lineage-1/extracted_text.md", canonical_expected["storagePath"])
        self.assertEqual(canonical_expected["filename"], "extracted_text.md")
        canonical_metadata = json.loads(canonical_expected["metadata"])
        self.assertEqual(canonical_metadata["source"], "biblicus-article-text-filter")
        self.assertEqual(canonical_metadata["filterStatus"], "filtered")
        self.assertEqual(canonical_metadata["filterRetryFailureCount"], 0)
        self.assertEqual(canonical_metadata["filterRetryRoundsUsed"], 2)
        self.assertIsNone(canonical_metadata["filterRetryLastCode"])

    @mock.patch("papyrus_content.reference_url_text._extract_url_text")
    @mock.patch("papyrus_content.reference_url_text._filter_article_text")
    def test_build_reference_url_text_attachment_plans_falls_back_to_raw_when_filter_fails(
        self,
        mock_filter,
        mock_extract,
    ):
        mock_extract.return_value = {
            "text": "Raw extracted text",
            "markdown": "Raw extracted text",
            "title": "Raw title",
        }
        mock_filter.return_value = {
            "status": "failed",
            "text": "",
            "spanCount": 0,
            "promptVersion": "article-text-v1",
            "warnings": [],
            "retryTrace": [
                {
                    "attempt": 1,
                    "max_rounds": 8,
                    "retries_left": 7,
                    "failure_code": "old_str_not_unique",
                    "error_message": "not unique",
                    "next_action": "Use longer unique old_str",
                }
            ],
            "retryFailureCount": 1,
            "retryRoundsUsed": 3,
            "retryLastCode": "old_str_not_unique",
            "error": {
                "code": "empty_spans",
                "message": "No spans",
                "details": {"retry_trace": [{"failure_code": "old_str_not_unique"}]},
            },
            "model": "gpt-5.4-nano",
        }
        references = [
            {
                "id": "reference-1",
                "lineageId": "lineage-1",
                "versionNumber": 1,
                "versionState": "current",
                "corpusId": "knowledge-corpus-ai-ml-research",
                "externalItemId": "item-1",
                "sourceUri": "https://example.com/article",
            }
        ]
        result = build_reference_url_text_attachment_plans(
            references=references,
            attachments=[],
            corpus_key_by_id={"knowledge-corpus-ai-ml-research": "AI-ML-research"},
            corpus_id="knowledge-corpus-ai-ml-research",
            curation_status="all",
            force=False,
        )

        self.assertEqual(result["fallbackRawCount"], 1)
        self.assertEqual(len(result["filterFallbacks"]), 1)
        canonical_plan = next(
            plan for plan in result["plans"] if plan["record"]["expected"]["role"] == "extracted_text"
        )
        canonical_body = canonical_plan["body"].decode("utf-8")
        self.assertEqual(canonical_body, "Raw extracted text")
        metadata = json.loads(canonical_plan["record"]["expected"]["metadata"])
        self.assertEqual(metadata["filterStatus"], "fallback_raw")
        self.assertEqual(metadata["filterRetryFailureCount"], 1)
        self.assertEqual(metadata["filterRetryRoundsUsed"], 3)
        self.assertEqual(metadata["filterRetryLastCode"], "old_str_not_unique")
        self.assertEqual(result["filterFallbacks"][0]["reason"]["details"]["retry_trace"][0]["failure_code"], "old_str_not_unique")

    @mock.patch("papyrus_content.reference_url_text.resolve_storage_bucket_name", return_value="test-bucket")
    @mock.patch("papyrus_content.reference_url_text._filter_article_text")
    @mock.patch("papyrus_content.reference_url_text.boto3")
    def test_build_reference_extracted_text_filter_attachment_plans_uses_raw_then_refreshes_canonical(
        self,
        mock_boto3,
        mock_filter,
        _mock_bucket,
    ):
        mock_s3 = mock.Mock()
        mock_s3.get_object.return_value = {"Body": io.BytesIO(b"Raw attachment body text")}
        mock_boto3.client.return_value = mock_s3
        mock_filter.return_value = {
            "status": "ok",
            "text": "Filtered canonical text",
            "spanCount": 1,
            "promptVersion": "article-text-v1",
            "warnings": [],
            "retryTrace": [],
            "retryFailureCount": 0,
            "retryRoundsUsed": 1,
            "retryLastCode": None,
            "error": None,
            "model": "gpt-5.4-nano",
        }
        references = [
            {
                "id": "reference-1",
                "lineageId": "lineage-1",
                "versionState": "current",
                "versionNumber": 1,
                "corpusId": "knowledge-corpus-ai-ml-research",
                "curationStatus": "accepted",
                "externalItemId": "item-1",
                "sourceUri": "https://example.com/article",
            }
        ]
        attachments = [
            {
                "id": "attachment-raw",
                "referenceLineageId": "lineage-1",
                "role": "extracted_text_raw",
                "storagePath": "corpora/AI-ML-research/extracted/markitdown/raw/lineage-1/extracted_text_raw.md",
            },
            {
                "id": "attachment-canonical",
                "referenceLineageId": "lineage-1",
                "role": "extracted_text",
                "storagePath": "corpora/AI-ML-research/extracted/markitdown/text/lineage-1/extracted_text.md",
            },
        ]
        result = build_reference_extracted_text_filter_attachment_plans(
            references=references,
            attachments=attachments,
            corpus_id="knowledge-corpus-ai-ml-research",
            curation_status="all",
            model="gpt-5.4-nano",
        )

        self.assertEqual(result["plannedCount"], 1)
        self.assertEqual(result["filteredCount"], 1)
        self.assertEqual(result["fallbackRawCount"], 0)
        self.assertEqual(result["processedReferenceIds"], ["reference-1"])
        self.assertEqual(result["plannedAttachmentCount"], 2)
        by_role = {plan["record"]["expected"]["role"]: plan for plan in result["plans"]}
        self.assertIn("extracted_text_raw", by_role)
        self.assertIn("extracted_text", by_role)
        canonical_plan = by_role["extracted_text"]
        self.assertEqual(canonical_plan["body"].decode("utf-8"), "Filtered canonical text")
        canonical_metadata = json.loads(canonical_plan["record"]["expected"]["metadata"])
        self.assertEqual(canonical_metadata["filterRetryFailureCount"], 0)
        self.assertEqual(canonical_metadata["filterRetryRoundsUsed"], 1)
        raw_plan = by_role["extracted_text_raw"]
        self.assertEqual(raw_plan["body"].decode("utf-8"), "Raw attachment body text")
        self.assertIn("markitdown/raw/lineage-1/extracted_text_raw.md", raw_plan["record"]["expected"]["storagePath"])

    @mock.patch("papyrus_content.reference_url_text.resolve_storage_bucket_name", return_value="test-bucket")
    @mock.patch("papyrus_content.reference_url_text._extract_url_text")
    @mock.patch("papyrus_content.reference_url_text._filter_article_text")
    @mock.patch("papyrus_content.reference_url_text.boto3")
    def test_filter_plans_reconstruct_raw_from_source_uri_when_canonical_is_filtered(
        self,
        mock_boto3,
        mock_filter,
        mock_extract,
        _mock_bucket,
    ):
        mock_boto3.client.return_value = mock.Mock()
        mock_extract.return_value = {
            "text": "Reconstructed raw text",
            "markdown": "Reconstructed raw text",
            "title": "Example title",
        }
        mock_filter.return_value = {
            "status": "ok",
            "text": "Filtered canonical text",
            "spanCount": 1,
            "promptVersion": "article-text-v1",
            "warnings": [],
            "retryTrace": [],
            "retryFailureCount": 0,
            "retryRoundsUsed": 1,
            "retryLastCode": None,
            "error": None,
            "model": "gpt-5.4-nano",
        }
        references = [
            {
                "id": "reference-1",
                "lineageId": "lineage-1",
                "versionState": "current",
                "versionNumber": 1,
                "corpusId": "knowledge-corpus-ai-ml-research",
                "curationStatus": "accepted",
                "externalItemId": "item-1",
                "sourceUri": "https://example.com/article",
            }
        ]
        attachments = [
            {
                "id": "attachment-canonical",
                "referenceLineageId": "lineage-1",
                "role": "extracted_text",
                "storagePath": "corpora/AI-ML-research/extracted/markitdown/text/lineage-1/extracted_text.md",
                "metadata": json.dumps({"filterStatus": "filtered", "source": "biblicus-article-text-filter"}),
            },
        ]
        result = build_reference_extracted_text_filter_attachment_plans(
            references=references,
            attachments=attachments,
            corpus_id="knowledge-corpus-ai-ml-research",
            curation_status="all",
            model="gpt-5.4-nano",
        )

        self.assertEqual(result["plannedCount"], 1)
        self.assertEqual(result["plannedAttachmentCount"], 2)
        mock_extract.assert_called_once_with("https://example.com/article", reference_title="")
        by_role = {plan["record"]["expected"]["role"]: plan for plan in result["plans"]}
        raw_plan = by_role["extracted_text_raw"]
        self.assertEqual(raw_plan["body"].decode("utf-8"), "Reconstructed raw text")
        raw_metadata = json.loads(raw_plan["record"]["expected"]["metadata"])
        self.assertEqual(raw_metadata["reconstructedFromSourceUri"], "https://example.com/article")

    @mock.patch("papyrus_content.reference_url_text.resolve_storage_bucket_name", return_value="test-bucket")
    @mock.patch("papyrus_content.reference_url_text.boto3")
    def test_filter_plans_skip_when_raw_missing_and_source_uri_missing_for_filtered_canonical(
        self,
        mock_boto3,
        _mock_bucket,
    ):
        mock_boto3.client.return_value = mock.Mock()
        references = [
            {
                "id": "reference-1",
                "lineageId": "lineage-1",
                "versionState": "current",
                "versionNumber": 1,
                "corpusId": "knowledge-corpus-ai-ml-research",
                "curationStatus": "accepted",
                "externalItemId": "item-1",
                "sourceUri": None,
            }
        ]
        attachments = [
            {
                "id": "attachment-canonical",
                "referenceLineageId": "lineage-1",
                "role": "extracted_text",
                "storagePath": "corpora/AI-ML-research/extracted/markitdown/text/lineage-1/extracted_text.md",
                "metadata": json.dumps({"filterStatus": "filtered", "source": "biblicus-article-text-filter"}),
            },
        ]
        result = build_reference_extracted_text_filter_attachment_plans(
            references=references,
            attachments=attachments,
            corpus_id="knowledge-corpus-ai-ml-research",
            curation_status="all",
            model="gpt-5.4-nano",
        )

        self.assertEqual(result["plannedCount"], 0)
        self.assertEqual(result["skippedMissingSourceCount"], 1)
        self.assertEqual(result["items"][0]["status"], "skipped_missing_source")

    @mock.patch("papyrus_content.reference_url_text._run_biblicus_article_text")
    def test_filter_article_text_includes_bounded_retry_trace_in_failure_reason(self, mock_run_article_text):
        mock_run_article_text.return_value = {
            "status": "failed",
            "text": "",
            "span_count": 0,
            "prompt_version": "article-text-v1",
            "warnings": [],
            "retry_failure_count": 3,
            "retry_rounds_used": 8,
            "retry_trace": [
                {
                    "attempt": 1,
                    "max_rounds": 8,
                    "retries_left": 7,
                    "failure_code": "old_str_not_found",
                    "error_message": "not found",
                    "next_action": "Call view",
                },
                {
                    "attempt": 2,
                    "max_rounds": 8,
                    "retries_left": 6,
                    "failure_code": "old_str_not_unique",
                    "error_message": "not unique",
                    "next_action": "Use longer old_str",
                },
            ],
            "error": {"code": "empty_spans", "message": "No spans"},
        }
        result = _filter_article_text(
            extracted_text="Noisy text",
            source_uri="https://example.com/article",
            reference_title="Title",
            original_title="Original title",
            original_subtitle="Original subtitle",
            model="gpt-5.4-nano",
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["retryFailureCount"], 3)
        self.assertEqual(result["retryRoundsUsed"], 8)
        self.assertEqual(result["retryLastCode"], "old_str_not_unique")
        self.assertEqual(result["error"]["details"]["retry_trace"][0]["failure_code"], "old_str_not_found")

    @mock.patch("papyrus_content.reference_metadata_generation.resolve_storage_bucket_name", return_value="test-bucket")
    @mock.patch("papyrus_content.reference_metadata_generation.reference_curation_signals.reference_generate_metadata_from_extracted_text")
    @mock.patch("papyrus_content.reference_metadata_generation.boto3.client")
    def test_run_reference_metadata_generation_from_extracted_text_skips_missing_and_generates(
        self,
        mock_boto_client,
        mock_generate,
        _mock_bucket,
    ):
        mock_s3 = mock.Mock()
        mock_s3.get_object.return_value = {"Body": io.BytesIO(b"Full extracted text from attachment")}
        mock_boto_client.return_value = mock_s3
        mock_generate.return_value = {
            "status": "generated",
            "generated": {"title": "Generated title", "subtitle": "Generated subtitle", "summary": "Generated summary"},
        }
        references = [
            {
                "id": "reference-1",
                "lineageId": "lineage-1",
                "versionState": "current",
                "corpusId": "knowledge-corpus-ai-ml-research",
                "curationStatus": "accepted",
                "externalItemId": "item-1",
                "title": "Original title",
            },
            {
                "id": "reference-2",
                "lineageId": "lineage-2",
                "versionState": "current",
                "corpusId": "knowledge-corpus-ai-ml-research",
                "curationStatus": "accepted",
                "externalItemId": "item-2",
            },
        ]
        attachments = [
            {
                "id": "attachment-1",
                "referenceLineageId": "lineage-1",
                "role": "extracted_text",
                "storagePath": "corpora/AI-ML-research/extracted/markitdown/text/lineage-1/extracted_text.md",
            }
        ]
        result = run_reference_metadata_generation_from_extracted_text(
            references=references,
            attachments=attachments,
            corpus_id="knowledge-corpus-ai-ml-research",
            curation_status="all",
            model="gpt-5.4-nano",
            apply=True,
        )

        self.assertEqual(result["attemptedCount"], 2)
        self.assertEqual(result["generatedCount"], 1)
        self.assertEqual(result["skippedMissingTextCount"], 1)
        self.assertEqual(result["generationFailureCount"], 0)
        mock_generate.assert_called_once()
        call_kwargs = mock_generate.call_args.kwargs
        self.assertEqual(call_kwargs["reference_id"], "reference-1")
        self.assertEqual(call_kwargs["original_title"], "Original title")
        self.assertIn("Full extracted text", call_kwargs["extracted_text"])
        statuses = [item["status"] for item in result["items"]]
        self.assertIn("generated", statuses)
        self.assertIn("skipped_missing_text", statuses)

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

    @mock.patch("papyrus_content.reference_url_text.storage_bucket_from_amplify_outputs", return_value="outputs-bucket")
    @mock.patch("papyrus_content.reference_url_text._graphql_endpoint_overrides_amplify_outputs", return_value=True)
    def test_resolve_storage_bucket_name_requires_explicit_bucket_when_endpoint_overridden(
        self,
        _mock_endpoint_override,
        _mock_outputs_bucket,
    ):
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "Pass --bucket or set PAPYRUS_MEDIA_BUCKET_NAME"):
                resolve_storage_bucket_name()

    @mock.patch("papyrus_content.reference_url_text.storage_bucket_from_amplify_outputs", return_value="outputs-bucket")
    @mock.patch("papyrus_content.reference_url_text._graphql_endpoint_overrides_amplify_outputs", return_value=True)
    def test_resolve_storage_bucket_name_prefers_explicit_bucket_when_endpoint_overridden(
        self,
        _mock_endpoint_override,
        _mock_outputs_bucket,
    ):
        with mock.patch.dict("os.environ", {"PAPYRUS_MEDIA_BUCKET_NAME": "explicit-bucket"}, clear=True):
            self.assertEqual(resolve_storage_bucket_name(), "explicit-bucket")

    @mock.patch("papyrus_content.reference_url_text._biblicus_python_executable", return_value="/usr/bin/python3")
    @mock.patch("papyrus_content.reference_url_text.BIBLICUS_ROOT", pathlib.Path("/tmp"))
    @mock.patch("papyrus_content.reference_url_text.subprocess.run")
    def test_extract_url_text_uses_biblicus_cli_success(self, mock_run, _mock_python):
        mock_run.return_value = mock.Mock(
            returncode=0,
            stdout=json.dumps(
                {
                    "status": "ok",
                    "text": "Extracted from Biblicus",
                    "markdown": "# Extracted from Biblicus",
                    "title": "Example",
                    "source_kind": "web",
                    "strategy": "markdown-then-html-then-direct",
                    "content_type": "text/html",
                    "prompt_version": "url-text-v1",
                    "attempts": [{"step": "web_markdown_fetch", "result": "ok"}],
                }
            ),
            stderr="",
        )
        extracted = _extract_url_text("https://example.com/article", reference_title="Example")
        self.assertEqual(extracted["text"], "Extracted from Biblicus")
        self.assertEqual(extracted["sourceKind"], "web")
        self.assertEqual(extracted["strategy"], "markdown-then-html-then-direct")
        self.assertEqual(extracted["promptVersion"], "url-text-v1")

    @mock.patch("papyrus_content.reference_url_text._biblicus_python_executable", return_value="/usr/bin/python3")
    @mock.patch("papyrus_content.reference_url_text.BIBLICUS_ROOT", pathlib.Path("/tmp"))
    @mock.patch("papyrus_content.reference_url_text.subprocess.run")
    def test_extract_url_text_uses_biblicus_structured_failure(self, mock_run, _mock_python):
        mock_run.return_value = mock.Mock(
            returncode=2,
            stdout=json.dumps({"status": "failed", "error": {"code": "blocked", "message": "blocked by source"}}),
            stderr="blocked by source",
        )
        with self.assertRaises(ReferenceUrlTextExtractionError) as context:
            _extract_url_text("https://example.com/article")
        self.assertEqual(context.exception.reason["code"], "blocked")

    def test_source_site_enrichment_default_tracks_uri_identifiers(self):
        result = resolve_source_site_enrichment(
            reference={"id": "reference-1"},
            source_uri="https://example.com/story",
        )
        self.assertEqual(result["pluginKey"], "default")
        self.assertEqual(result["canonicalSourceUri"], "https://example.com/story")
        self.assertEqual(result["identifiers"]["resolved"]["source_uri"], "https://example.com/story")
        self.assertEqual(result["identifiers"]["resolved"]["canonical_uri"], "https://example.com/story")
        self.assertEqual(result["identifiers"]["primary"]["type"], "canonical_uri")

    def test_source_site_enrichment_arxiv_resolves_urls_abstract_and_identifiers(self):
        abs_html = """
            <html><head>
            <script type=\"application/ld+json\">
            {
              \"@context\": \"https://schema.org\",
              \"@type\": \"ScholarlyArticle\",
              \"description\": \"A structured abstract from JSON-LD.\",
              \"identifier\": {\"@type\": \"PropertyValue\", \"propertyID\": \"doi\", \"value\": \"10.1234/example-doi\"}
            }
            </script>
            </head></html>
        """
        result = resolve_source_site_enrichment(
            reference={"id": "reference-1"},
            source_uri="https://arxiv.org/html/2504.16736v2",
            fetcher=lambda _url: abs_html,
        )
        self.assertEqual(result["pluginKey"], "arxiv")
        self.assertEqual(result["canonicalSourceUri"], "https://arxiv.org/pdf/2504.16736v2")
        self.assertEqual(result["identifiers"]["resolved"]["arxiv_id"], "2504.16736v2")
        self.assertEqual(result["identifiers"]["resolved"]["doi"], "10.1234/example-doi")
        self.assertEqual(result["metadata"]["abstract"], "A structured abstract from JSON-LD.")
        self.assertEqual(result["identifiers"]["primary"], {"type": "arxiv_id", "value": "2504.16736v2"})

    def test_source_site_enrichment_youtube_stub_resolves_video_id(self):
        result = resolve_source_site_enrichment(
            reference={"id": "reference-yt"},
            source_uri="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )
        self.assertEqual(result["pluginKey"], "youtube")
        self.assertEqual(result["canonicalSourceUri"], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertEqual(result["identifiers"]["resolved"]["youtube_video_id"], "dQw4w9WgXcQ")
        warning_codes = {str(entry.get("code") or "") for entry in result["warnings"] if isinstance(entry, dict)}
        self.assertIn("youtube_enrichment_not_implemented", warning_codes)

    @mock.patch("papyrus_content.reference_url_text.resolve_source_site_enrichment")
    @mock.patch("papyrus_content.reference_url_text._extract_url_text")
    @mock.patch("papyrus_content.reference_url_text._filter_article_text")
    def test_build_reference_url_text_attachment_plans_uses_enrichment_canonical_uri_and_reference_metadata(
        self,
        mock_filter,
        mock_extract,
        mock_enrich,
    ):
        mock_enrich.return_value = {
            "pluginKey": "arxiv",
            "canonicalSourceUri": "https://arxiv.org/pdf/2504.16736v2",
            "sourceVariants": {
                "inputUrl": "https://arxiv.org/html/2504.16736v2",
                "canonicalPdfUrl": "https://arxiv.org/pdf/2504.16736v2",
                "canonicalAbsUrl": "https://arxiv.org/abs/2504.16736v2",
                "canonicalHtmlUrl": "https://arxiv.org/html/2504.16736v2",
            },
            "identifiers": {
                "resolved": {
                    "arxiv_id": "2504.16736v2",
                    "source_uri": "https://arxiv.org/html/2504.16736v2",
                    "canonical_uri": "https://arxiv.org/pdf/2504.16736v2",
                },
                "candidates": [
                    {
                        "type": "arxiv_id",
                        "value": "2504.16736v2",
                        "source": "arxiv_url",
                        "confidence": 1.0,
                        "rank": 10,
                    }
                ],
                "primary": {"type": "arxiv_id", "value": "2504.16736v2"},
                "warnings": [],
            },
            "metadata": {
                "paperId": "2504.16736v2",
                "abstract": "An abstract.",
            },
            "attachmentMetadata": {
                "sitePlugin": "arxiv",
            },
            "warnings": [],
        }
        mock_extract.return_value = {
            "text": "Example plain text",
            "markdown": "# Example plain text",
            "title": "Example Title",
        }
        mock_filter.return_value = {
            "status": "ok",
            "text": "Filtered article text",
            "spanCount": 1,
            "promptVersion": "article-text-v1",
            "warnings": [],
            "retryTrace": [],
            "retryFailureCount": 0,
            "retryRoundsUsed": 2,
            "retryLastCode": None,
            "error": None,
            "model": "gpt-5.4-nano",
        }
        references = [
            {
                "id": "reference-1",
                "lineageId": "lineage-1",
                "versionNumber": 1,
                "versionState": "current",
                "corpusId": "knowledge-corpus-ai-ml-research",
                "externalItemId": "item-1",
                "sourceUri": "https://arxiv.org/html/2504.16736v2",
                "metadata": json.dumps({}),
            }
        ]
        result = build_reference_url_text_attachment_plans(
            references=references,
            attachments=[],
            corpus_key_by_id={"knowledge-corpus-ai-ml-research": "AI-ML-research"},
            corpus_id="knowledge-corpus-ai-ml-research",
            curation_status="all",
            force=False,
        )
        mock_extract.assert_called_once_with(
            "https://arxiv.org/pdf/2504.16736v2",
            reference_title="",
        )
        self.assertEqual(result["plannedReferenceMetadataCount"], 1)
        reference_record = result["referenceRecords"][0]["expected"]
        metadata = json.loads(reference_record["metadata"])
        self.assertEqual(metadata["papyrus"]["source_resolution"]["arxiv"]["paperId"], "2504.16736v2")
        self.assertEqual(metadata["identifiers"]["resolved"]["source_uri"], "https://arxiv.org/html/2504.16736v2")
        self.assertEqual(metadata["identifiers"]["resolved"]["canonical_uri"], "https://arxiv.org/pdf/2504.16736v2")
        raw_plan = next(plan for plan in result["plans"] if plan["record"]["expected"]["role"] == "extracted_text_raw")
        raw_metadata = json.loads(raw_plan["record"]["expected"]["metadata"])
        self.assertEqual(raw_metadata["sourceUri"], "https://arxiv.org/pdf/2504.16736v2")
        self.assertEqual(raw_metadata["sourceUriOriginal"], "https://arxiv.org/html/2504.16736v2")
        self.assertEqual(raw_metadata["sourcePlugin"], "arxiv")

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
        self.assertRegex(printed, r"references\tcurate-recent\tselected\t\d+")


if __name__ == "__main__":
    unittest.main()
