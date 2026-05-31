from __future__ import annotations

import pathlib
import sys
import unittest
from unittest.mock import patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content.corpora import (  # noqa: E402
    corpus_sync_from_cloud_decision,
    maybe_sync_corpus_from_cloud_before_analysis,
)


class CorpusAnalysisSyncTests(unittest.TestCase):
    def test_decision_skips_when_catalogs_match(self) -> None:
        corpus = {"key": "demo", "path": "corpora/demo", "s3Prefix": "s3://bucket/corpora/demo/"}
        local = {"exists": True, "items": 10, "sha256": "abc"}
        s3 = {"exists": True, "items": 10, "sha256": "abc"}
        with (
            patch("papyrus_content.corpora.read_local_corpus_catalog_summary", return_value=local),
            patch("papyrus_content.corpora.read_s3_corpus_catalog_summary", return_value=s3),
        ):
            needed, reason, _ = corpus_sync_from_cloud_decision(corpus)
        self.assertFalse(needed)
        self.assertEqual(reason, "already_synced")

    def test_decision_syncs_when_local_missing(self) -> None:
        corpus = {"key": "demo", "path": "corpora/demo", "s3Prefix": "s3://bucket/corpora/demo/"}
        local = {"exists": False, "items": 0, "sha256": None}
        s3 = {"exists": True, "items": 12, "sha256": "def"}
        with (
            patch("papyrus_content.corpora.read_local_corpus_catalog_summary", return_value=local),
            patch("papyrus_content.corpora.read_s3_corpus_catalog_summary", return_value=s3),
        ):
            needed, reason, _ = corpus_sync_from_cloud_decision(corpus)
        self.assertTrue(needed)
        self.assertEqual(reason, "missing_local_catalog")

    def test_maybe_sync_runs_when_stale(self) -> None:
        steering_config = {
            "corpora": [
                {
                    "key": "AI-ML-research",
                    "path": "corpora/AI-ML-research",
                    "s3Prefix": "s3://bucket/corpora/AI-ML-research/",
                    "role": "canonical",
                }
            ]
        }
        local = {"exists": True, "items": 1, "sha256": "old"}
        s3 = {"exists": True, "items": 2, "sha256": "new"}
        with (
            patch("papyrus_content.corpora.read_local_corpus_catalog_summary", return_value=local),
            patch("papyrus_content.corpora.read_s3_corpus_catalog_summary", return_value=s3),
            patch("papyrus_content.corpora.build_corpus_sync_plan", return_value={"mode": "apply", "corpusKey": "AI-ML-research"}),
            patch("papyrus_content.corpora.run_or_print_corpus_sync_plan") as run_sync,
        ):
            result = maybe_sync_corpus_from_cloud_before_analysis(
                steering_config=steering_config,
                corpus_key="AI-ML-research",
                options={},
                log_prefix="analysis-test",
            )
        run_sync.assert_called_once()
        self.assertFalse(result["skipped"])
        self.assertEqual(result["reason"], "local_not_synced_to_s3")

    def test_maybe_sync_honors_skip_flag(self) -> None:
        steering_config = {
            "corpora": [
                {
                    "key": "AI-ML-research",
                    "path": "corpora/AI-ML-research",
                    "s3Prefix": "s3://bucket/corpora/AI-ML-research/",
                    "role": "canonical",
                }
            ]
        }
        with patch("papyrus_content.corpora.run_or_print_corpus_sync_plan") as run_sync:
            result = maybe_sync_corpus_from_cloud_before_analysis(
                steering_config=steering_config,
                corpus_key="AI-ML-research",
                options={"skip-sync-from-cloud": True},
                log_prefix="analysis-test",
            )
        run_sync.assert_not_called()
        self.assertTrue(result["skipped"])


if __name__ == "__main__":
    unittest.main()
