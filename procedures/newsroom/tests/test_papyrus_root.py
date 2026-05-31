from __future__ import annotations

import os
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content import env as papyrus_env  # noqa: E402


class PapyrusRootTests(unittest.TestCase):
    def test_resolve_papyrus_root_uses_lambda_task_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            steering = root / "corpora" / "papyrus-steering.yml"
            steering.parent.mkdir(parents=True, exist_ok=True)
            steering.write_text("schemaVersion: 1\n", encoding="utf-8")
            fake_module = root / "papyrus_content" / "env.py"
            fake_module.parent.mkdir(parents=True, exist_ok=True)
            with patch.object(papyrus_env, "__file__", str(fake_module)):
                with patch.dict(os.environ, {}, clear=False):
                    os.environ.pop("PAPYRUS_ROOT", None)
                    self.assertEqual(papyrus_env.resolve_papyrus_root().resolve(), root.resolve())

    def test_resolve_papyrus_root_honors_explicit_env(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            explicit = pathlib.Path(temp_dir)
            with patch.dict(os.environ, {"PAPYRUS_ROOT": str(explicit)}, clear=False):
                self.assertEqual(papyrus_env.resolve_papyrus_root(), explicit)


if __name__ == "__main__":
    unittest.main()
