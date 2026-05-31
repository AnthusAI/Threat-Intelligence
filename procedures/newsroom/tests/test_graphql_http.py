from __future__ import annotations

import json
import os
import sys
import unittest
from unittest.mock import patch

REPO_ROOT = __import__("pathlib").Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content import graphql_http  # noqa: E402
from papyrus_content.env import lambda_auth_header  # noqa: E402


class GraphQLHttpTests(unittest.TestCase):
    def test_jwt_headers_include_appsync_lambda_lane(self) -> None:
        body = json.dumps({"query": "query { __typename }", "variables": {}}).encode("utf-8")
        with patch.dict(
            os.environ,
            {"PAPYRUS_GRAPHQL_JWT": "abc.def.ghi", "PAPYRUS_GRAPHQL_USE_IAM": "false"},
            clear=False,
        ):
            headers = graphql_http.graphql_request_headers(
                endpoint="https://example.appsync-api.us-east-1.amazonaws.com/graphql",
                body=body,
                token="abc.def.ghi",
            )
        self.assertEqual(headers["Authorization"], lambda_auth_header("abc.def.ghi"))
        self.assertEqual(headers["x-amz-appsync-authtype"], "AWS_LAMBDA")

    def test_newsroom_graphql_uses_shared_client(self) -> None:
        from papyrus_newsroom import newsroom

        with patch(
            "papyrus_content.graphql_http.execute_graphql",
            return_value={"getAssignment": {"id": "a1"}},
        ) as execute:
            data = newsroom._graphql("query {}", {"id": "a1"})
        self.assertEqual(data["getAssignment"]["id"], "a1")
        execute.assert_called_once()


if __name__ == "__main__":
    unittest.main()
