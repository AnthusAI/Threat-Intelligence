from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

REPO_ROOT = __import__("pathlib").Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content import graphql_authoring  # noqa: E402


class GraphQLAuthModeTests(unittest.TestCase):
    def test_graphql_use_iam_in_lambda(self) -> None:
        with patch.dict(os.environ, {"AWS_LAMBDA_FUNCTION_NAME": "test-fn"}, clear=False):
            self.assertTrue(graphql_authoring.graphql_use_iam())

    def test_graphql_use_jwt_outside_lambda_by_default(self) -> None:
        env = os.environ.copy()
        env.pop("AWS_LAMBDA_FUNCTION_NAME", None)
        env.pop("PAPYRUS_GRAPHQL_USE_IAM", None)
        with patch.dict(os.environ, env, clear=True):
            self.assertFalse(graphql_authoring.graphql_use_iam())


if __name__ == "__main__":
    unittest.main()
