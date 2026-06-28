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
from papyrus_content.auth_commands import _jwt_secret_ssm_fallback_paths  # noqa: E402
from papyrus_content.env import decode_jwt_claims, ensure_graphql_authoring_jwt, lambda_auth_header  # noqa: E402


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

    def test_graphql_use_iam_prefers_jwt_in_lambda(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AWS_LAMBDA_FUNCTION_NAME": "test-fn",
                "PAPYRUS_GRAPHQL_JWT": "abc.def.ghi",
            },
            clear=False,
        ):
            self.assertFalse(graphql_http.graphql_use_iam())

    def test_jwt_secret_fallback_prefers_production_path_on_main_appsync(self) -> None:
        with patch.dict(
            os.environ,
            {
                "PAPYRUS_GRAPHQL_ENDPOINT": "https://64hviw44q5cq5nwjcigmasowlq.appsync-api.us-east-1.amazonaws.com/graphql",
            },
            clear=True,
        ):
            paths = _jwt_secret_ssm_fallback_paths()
        self.assertEqual(
            paths[0],
            "/amplify/dbsyytcm9drqa/main-branch-cb38ada667/PAPYRUS_JWT_SECRET",
        )

    def test_jwt_secret_fallback_honors_explicit_ssm_param(self) -> None:
        with patch.dict(
            os.environ,
            {"PAPYRUS_JWT_SECRET_SSM_PARAM": "/custom/PAPYRUS_JWT_SECRET"},
            clear=True,
        ):
            self.assertEqual(_jwt_secret_ssm_fallback_paths(), ["/custom/PAPYRUS_JWT_SECRET"])

    def test_ensure_graphql_authoring_jwt_mints_when_missing(self) -> None:
        with patch("papyrus_content.auth_commands._resolve_secret", return_value="test-secret"), patch.dict(
            os.environ,
            {},
            clear=True,
        ):
            os.environ.pop("PAPYRUS_GRAPHQL_JWT", None)
            token = ensure_graphql_authoring_jwt(ttl_seconds=120)
            claims = decode_jwt_claims(token)
            self.assertEqual(claims.get("aud"), "papyrus-authoring")
            self.assertIn("editor", claims.get("groups") or [])
            self.assertEqual(os.environ.get("PAPYRUS_GRAPHQL_JWT"), token)

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
