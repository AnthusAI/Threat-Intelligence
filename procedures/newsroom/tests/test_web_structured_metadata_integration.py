"""Integration tests for shared web structured metadata (requires Biblicus checkout)."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from papyrus_content import web_structured_metadata
from papyrus_content.catalog import normalize_catalog_reference_item
from papyrus_content.env import BIBLICUS_ROOT
from papyrus_content.source_site_plugins import resolve_source_site_enrichment
from papyrus_newsroom import reference_curation_signals

_BIBLICUS_FIXTURES = BIBLICUS_ROOT / "tests" / "fixtures" / "html_heuristics"
_BLOG_FIXTURE = _BIBLICUS_FIXTURES / "synthetic_blog_json_ld.html"
_NEWS_FIXTURE = _BIBLICUS_FIXTURES / "synthetic_news_open_graph.html"


def _biblicus_available() -> bool:
    return BIBLICUS_ROOT.is_dir() and _BLOG_FIXTURE.is_file()


@unittest.skipUnless(_biblicus_available(), "Biblicus checkout and HTML fixtures required")
class WebStructuredMetadataIntegrationTests(unittest.TestCase):
    def test_biblicus_cli_matches_python_api(self):
        html = _BLOG_FIXTURE.read_text(encoding="utf-8")
        from biblicus.web_reference_metadata import extract_web_reference_metadata_from_html

        api_payload = extract_web_reference_metadata_from_html(
            html,
            source_uri="https://fixture.test/blog/post",
        )
        proc = subprocess.run(
            [
                str(BIBLICUS_ROOT / ".venv" / "bin" / "python")
                if (BIBLICUS_ROOT / ".venv" / "bin" / "python").is_file()
                else "python3",
                "-m",
                "biblicus",
                "extract",
                "web-metadata",
                "--input-json",
                "-",
            ],
            cwd=BIBLICUS_ROOT,
            input=json.dumps({"source_uri": "https://fixture.test/blog/post", "html_content": html}),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr or proc.stdout)
        cli_payload = json.loads(proc.stdout)
        self.assertEqual(cli_payload.get("status"), "ok")
        self.assertEqual(cli_payload.get("title"), api_payload.get("title"))
        self.assertEqual(cli_payload.get("authors"), api_payload.get("authors"))

    def test_papyrus_subprocess_resolves_blog_fixture(self):
        html = _BLOG_FIXTURE.read_text(encoding="utf-8")
        payload = web_structured_metadata.resolve_web_reference_metadata(
            "https://fixture.test/blog/post",
            html_content=html,
        )
        self.assertEqual(payload.get("title"), "Understanding Sequence Models")
        self.assertGreaterEqual(len(payload.get("authors") or []), 2)
        self.assertIn("json_ld", payload.get("layers") or [])

    def test_reference_curation_local_html_uses_shared_heuristics(self):
        html = _NEWS_FIXTURE.read_text(encoding="utf-8")
        resolved = reference_curation_signals._title_subtitle_from_local_html(html)
        self.assertEqual(resolved.get("title"), "Corpus Audit Checklist")
        self.assertEqual(resolved.get("source"), "local_html_metadata")

    def test_source_site_default_plugin_merges_web_metadata(self):
        html = _NEWS_FIXTURE.read_text(encoding="utf-8")

        def fetcher(_url: str, timeout: int = 20) -> str:
            return html

        enrichment = resolve_source_site_enrichment(
            reference={"id": "ref-1", "title": "", "sourceUri": "https://fixture.test/news/story"},
            source_uri="https://fixture.test/unknown-host.example/article",
            fetcher=fetcher,
        )
        metadata = enrichment.get("metadata") if isinstance(enrichment.get("metadata"), dict) else {}
        self.assertTrue(metadata.get("title") or metadata.get("webStructuredMetadata"))


class WebStructuredMetadataFallbackTests(unittest.TestCase):
    def test_missing_biblicus_raises_clear_error(self):
        with patch.object(web_structured_metadata, "BIBLICUS_ROOT", Path("/nonexistent/biblicus")):
            with self.assertRaises(web_structured_metadata.WebStructuredMetadataError) as ctx:
                web_structured_metadata.resolve_web_reference_metadata(
                    "https://example.test/article",
                    html_content="<html><title>Hi</title></html>",
                )
        self.assertEqual(ctx.exception.reason.get("code"), "biblicus_checkout_missing")


if __name__ == "__main__":
    unittest.main()
