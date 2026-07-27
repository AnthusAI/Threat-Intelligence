"""Unit tests for publication-date extraction/backfill helpers (TI-06361a)."""

from __future__ import annotations

import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content.catalog import reference_record  # noqa: E402
from papyrus_content.publication_dates import (  # noqa: E402
    assert_not_operational_timestamp,
    is_allowed_catalog_date_provenance,
    publication_date_from_arxiv_uri,
    publication_dates_from_catalog_item,
)
from papyrus_content.accession import resolve_accession_dates  # noqa: E402


class PublicationDatesTests(unittest.TestCase):
    def test_catalog_item_reads_nested_dates_with_allowlisted_provenance(self):
        item = {
            "id": "item-1",
            "metadata": {
                "dates": {"published_at": "2025-02-05", "updated_at": "2025-02-06"},
                "date_provenance": {
                    "published_at": "source-metadata",
                    "updated_at": "source-metadata",
                },
            },
        }
        dates = publication_dates_from_catalog_item(item)
        self.assertEqual(dates["sourcePublishedAt"], "2025-02-05T00:00:00Z")
        self.assertEqual(dates["sourceUpdatedAt"], "2025-02-06T00:00:00Z")
        self.assertIn("source-metadata", dates["publishedSource"])

    def test_catalog_item_rejects_ingestion_provenance(self):
        item = {
            "metadata": {
                "dates": {"published_at": "2026-05-23T15:08:00Z"},
                "date_provenance": {"published_at": "imported-at"},
            }
        }
        dates = publication_dates_from_catalog_item(item)
        self.assertIsNone(dates["sourcePublishedAt"])

    def test_reference_record_maps_nested_catalog_dates(self):
        item = {
            "id": "b9102904-4e11-41bc-a444-6df13075d9f4",
            "title": "Example",
            "sha256": "abc",
            "media_type": "application/pdf",
            "metadata": {
                "dates": {"published_at": "2025-02-05"},
                "date_provenance": {"published_at": "source-metadata"},
            },
        }
        context = {
            "corpusId": "knowledge-corpus-ai-ml-research",
            "importRunId": "import-1",
            "now": "2026-07-27T00:00:00Z",
            "actor": "test",
        }
        record = reference_record(item, context)["expected"]
        self.assertEqual(record["sourcePublishedAt"], "2025-02-05T00:00:00Z")
        self.assertEqual(record["importedAt"], "2026-07-27T00:00:00Z")

    def test_assert_not_operational_timestamp_blocks_f1cc13_collision(self):
        stamp = "2026-05-23T15:08:00.972027Z"
        self.assertIsNone(
            assert_not_operational_timestamp(
                candidate=stamp,
                operational={"importedAt": stamp, "retrievedAt": None, "updatedAt": None},
            )
        )
        self.assertEqual(
            assert_not_operational_timestamp(
                candidate="2021-06-01T00:00:00Z",
                operational={"importedAt": stamp},
            ),
            "2021-06-01T00:00:00Z",
        )

    def test_arxiv_uri_month_imputation(self):
        dates = publication_date_from_arxiv_uri("https://arxiv.org/abs/1712.06560")
        self.assertEqual(dates["sourcePublishedAt"], "2017-12-01T00:00:00Z")
        self.assertEqual(dates["publishedSource"], "arxiv.id")

    def test_resolve_accession_dates_does_not_use_last_modified(self):
        dates = resolve_accession_dates(
            reference={},
            source_bytes=b"<html></html>",
            media_type="text/html",
            download_uri="https://example.com/post",
            last_modified="2026-07-27T12:00:00Z",
            now="2026-07-27T12:00:00Z",
        )
        self.assertIsNone(dates["sourcePublishedAt"])
        self.assertEqual(dates["retrievedAt"], "2026-07-27T12:00:00Z")

    def test_provenance_allowlist(self):
        self.assertTrue(is_allowed_catalog_date_provenance("source-metadata"))
        self.assertTrue(is_allowed_catalog_date_provenance("curator"))
        self.assertFalse(is_allowed_catalog_date_provenance("retrieved-at"))
        self.assertFalse(is_allowed_catalog_date_provenance("import-batch"))


if __name__ == "__main__":
    unittest.main()
