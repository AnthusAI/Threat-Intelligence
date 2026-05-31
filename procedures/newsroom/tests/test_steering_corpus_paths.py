from __future__ import annotations

import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content.steering import (  # noqa: E402
    looks_like_biblicus_project,
    resolve_biblicus_runtime_dir,
    resolve_corpus_local_path,
)


class SteeringCorpusPathTests(unittest.TestCase):
    def test_resolve_corpus_local_path_uses_steering_config_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            steering_path = root / "corpora" / "papyrus-steering.yml"
            steering_path.parent.mkdir(parents=True, exist_ok=True)
            corpus_dir = root / "corpora" / "demo-corpus"
            corpus_dir.mkdir(parents=True)
            (corpus_dir / "metadata").mkdir()
            (corpus_dir / "metadata" / "catalog.json").write_text('{"items": {}}', encoding="utf-8")
            steering_config = {"configPath": str(steering_path)}
            corpus = {"key": "demo-corpus", "path": "corpora/demo-corpus"}
            resolved = resolve_corpus_local_path(corpus, steering_config)
            self.assertEqual(resolved, corpus_dir.resolve())

    def test_resolve_biblicus_runtime_dir_rejects_corpus_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            corpus_checkout = pathlib.Path(temp_dir)
            (corpus_checkout / "corpora").mkdir()
            with patch("papyrus_content.steering.PAPYRUS_ROOT", corpus_checkout):
                with patch("papyrus_content.steering.looks_like_biblicus_project", return_value=False):
                    with self.assertRaisesRegex(ValueError, "Biblicus project directory"):
                        resolve_biblicus_runtime_dir({"biblicus-workdir": str(corpus_checkout)})

    def test_looks_like_biblicus_project_detects_repo_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            (root / "src" / "biblicus").mkdir(parents=True)
            self.assertTrue(looks_like_biblicus_project(root))


if __name__ == "__main__":
    unittest.main()
