"""Unit tests for shared web structured metadata helpers."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from papyrus_content import web_structured_metadata as wsm


class WebStructuredMetadataTests(unittest.TestCase):
    def test_resolve_web_title_subtitle_from_payload(self):
        with patch.object(wsm, "resolve_web_reference_metadata") as mock_resolve:
            mock_resolve.return_value = {
                "title": "Corpus Audit Checklist",
                "subtitle": "A short guide",
                "method": "html-heuristics",
                "layers": ["open_graph"],
                "sourceUri": "https://fixture.test/news/story",
            }
            resolved = wsm.resolve_web_title_subtitle(
                "https://fixture.test/news/story",
                html_content="<html><title>ignored</title></html>",
            )
        self.assertEqual(resolved["title"], "Corpus Audit Checklist")
        self.assertEqual(resolved["subtitle"], "A short guide")
        self.assertEqual(resolved["titleMode"], "original_web_metadata")

    def test_merge_web_metadata_into_enrichment(self):
        with patch.object(wsm, "resolve_web_reference_metadata") as mock_resolve:
            mock_resolve.return_value = {
                "title": "Blog Post",
                "authors": ["Alex Example"],
                "method": "html-heuristics",
                "layers": ["json_ld"],
                "structured": {"authors": [{"name": "Alex Example"}], "citations": []},
            }
            merged = wsm.merge_web_metadata_into_enrichment(
                {"metadata": {}},
                source_uri="https://fixture.test/blog",
            )
        metadata = merged.get("metadata") or {}
        self.assertEqual(metadata.get("title"), "Blog Post")
        summary = metadata.get("webStructuredMetadata") or {}
        self.assertEqual(summary.get("method"), "html-heuristics")
        self.assertIn("structured", summary)

    def test_enrich_catalog_item_fills_missing_fields(self):
        with patch.object(wsm, "resolve_web_reference_metadata") as mock_resolve:
            mock_resolve.return_value = {
                "title": "Filled Title",
                "authors": ["Casey Reviewer"],
                "method": "html-heuristics",
                "layers": [],
            }
            item = wsm.enrich_catalog_item_web_metadata(
                {"url": "https://fixture.test/item", "title": "", "metadata": {}}
            )
        self.assertEqual(item.get("title"), "Filled Title")
        self.assertEqual(item.get("authors"), ["Casey Reviewer"])


if __name__ == "__main__":
    unittest.main()
