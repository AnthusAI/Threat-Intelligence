from __future__ import annotations

import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content.corpus_storage_paths import (  # noqa: E402
    corpus_storage_path_prefix,
    corpus_storage_path_read_candidates,
    corpus_storage_segment,
    legacy_mixed_case_corpus_segment,
    rewrite_corpus_storage_path,
)


class CorpusStoragePathTests(unittest.TestCase):
    def test_corpus_storage_segment_matches_corpus_id_slug(self) -> None:
        self.assertEqual(corpus_storage_segment("AI-ML-research"), "ai-ml-research")

    def test_rewrite_legacy_mixed_case_path(self) -> None:
        legacy = "corpora/AI-ML-research/source/ref-1/paper.pdf"
        self.assertEqual(
            rewrite_corpus_storage_path(legacy, corpus_key="AI-ML-research"),
            "corpora/ai-ml-research/source/ref-1/paper.pdf",
        )

    def test_read_candidates_include_legacy_and_canonical(self) -> None:
        candidates = corpus_storage_path_read_candidates(
            "corpora/AI-ML-research/extracted/markitdown/text/ref/extracted_text.md"
        )
        self.assertIn("corpora/AI-ML-research/extracted/markitdown/text/ref/extracted_text.md", candidates)
        self.assertIn("corpora/ai-ml-research/extracted/markitdown/text/ref/extracted_text.md", candidates)

    def test_legacy_mixed_case_segment(self) -> None:
        self.assertEqual(legacy_mixed_case_corpus_segment("ai-ml-research"), "AI-ML-research")

    def test_default_prefix(self) -> None:
        self.assertEqual(corpus_storage_path_prefix("AI-ML-research"), "corpora/ai-ml-research")


if __name__ == "__main__":
    unittest.main()
