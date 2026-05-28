from __future__ import annotations

import pathlib
import sys
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus import cli as papyrus_cli


class PapyrusCliRootGuardTests(unittest.TestCase):
    def test_enforce_root_guard_blocks_cross_root(self) -> None:
        module_root = pathlib.Path("/tmp/module-root").resolve()
        operator_root = pathlib.Path("/tmp/operator-root").resolve()
        with (
            mock.patch.object(papyrus_cli, "PAPYRUS_ROOT", module_root),
            mock.patch.object(papyrus_cli, "_find_operator_repo_root", return_value=operator_root),
        ):
            with self.assertRaises(ValueError) as raised:
                papyrus_cli._enforce_root_guard(["knowledge", "ontology", "status"], cwd=operator_root)
        message = str(raised.exception)
        self.assertIn("papyrus-root-guard\tblocked", message)
        self.assertIn(f"papyrus-root-guard\tmodule-root\t{module_root}", message)
        self.assertIn(f"papyrus-root-guard\toperator-root\t{operator_root}", message)
        self.assertIn("poetry run papyrus knowledge ontology status", message)

    def test_enforce_root_guard_allows_matching_root(self) -> None:
        module_root = pathlib.Path("/tmp/module-root").resolve()
        with (
            mock.patch.object(papyrus_cli, "PAPYRUS_ROOT", module_root),
            mock.patch.object(papyrus_cli, "_find_operator_repo_root", return_value=module_root),
        ):
            papyrus_cli._enforce_root_guard(["help"], cwd=module_root)

    def test_consume_cross_root_override_env_and_flag(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=False):
            allow, args = papyrus_cli._consume_cross_root_override(["--allow-cross-root", "knowledge", "ontology", "rank"])
            self.assertTrue(allow)
            self.assertEqual(args, ["knowledge", "ontology", "rank"])
        with mock.patch.dict("os.environ", {"PAPYRUS_ALLOW_CROSS_ROOT": "1"}, clear=False):
            allow, args = papyrus_cli._consume_cross_root_override(["knowledge", "ontology", "rank"])
            self.assertTrue(allow)
            self.assertEqual(args, ["knowledge", "ontology", "rank"])

    def test_main_honors_allow_cross_root_flag(self) -> None:
        with (
            mock.patch.object(papyrus_cli, "_enforce_root_guard") as guard,
            mock.patch.object(papyrus_cli, "_usage"),
        ):
            exit_code = papyrus_cli.main(["--allow-cross-root", "help"])
        self.assertEqual(exit_code, 0)
        guard.assert_not_called()


if __name__ == "__main__":
    unittest.main()
