"""Unit tests for retrieval eval scoring and environment resolution (no AWS)."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
SRC_ROOT = ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

_EVAL_PATH = ROOT / "procedures" / "newsroom" / "retrieval_eval.py"
_SPEC = importlib.util.spec_from_file_location("retrieval_eval", _EVAL_PATH)
assert _SPEC and _SPEC.loader
retrieval_eval = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(retrieval_eval)

apply_environment = retrieval_eval.apply_environment
resolve_environment = retrieval_eval.resolve_environment
score_query = retrieval_eval.score_query

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class ScoreQueryTests(unittest.TestCase):
    def test_hit_metric_rank(self):
        q = {
            "id": "q1",
            "query": "x",
            "category": "identifier",
            "metric": "hit",
            "expect_reference_lineage_ids": ["a"],
        }
        scored = score_query(q, ["z", "a", "b"])
        self.assertEqual(scored["rank"], 2)
        self.assertTrue(scored["hit_at_5"])
        self.assertAlmostEqual(scored["rr"], 0.5)

    def test_prefer_order_ok(self):
        q = {
            "id": "q-fresh",
            "query": "fresh vs stale",
            "category": "freshness",
            "metric": "prefer_order",
            "prefer_before": [["fresh", "stale"]],
        }
        scored = score_query(q, ["noise", "fresh", "stale"])
        self.assertEqual(scored["order_status"], "ok")
        self.assertEqual(scored["rank"], 2)
        self.assertTrue(scored["hit_at_5"])

    def test_prefer_order_wrong_order(self):
        q = {
            "id": "q-fresh",
            "query": "fresh vs stale",
            "category": "freshness",
            "metric": "prefer_order",
            "prefer_before": [["fresh", "stale"]],
        }
        scored = score_query(q, ["stale", "fresh"])
        self.assertEqual(scored["order_status"], "wrong_order")
        self.assertEqual(scored["rank"], -1)
        self.assertFalse(scored["hit_at_5"])
        self.assertEqual(scored["rr"], 0.0)

    def test_prefer_order_incomplete(self):
        q = {
            "id": "q-fresh",
            "query": "fresh vs stale",
            "category": "freshness",
            "metric": "prefer_order",
            "prefer_before": [["fresh", "stale"]],
        }
        scored = score_query(q, ["fresh", "other"])
        self.assertEqual(scored["order_status"], "incomplete")
        self.assertEqual(scored["rank"], -1)


class EnvironmentTests(unittest.TestCase):
    def test_resolve_default_profile(self):
        name, env = resolve_environment(None, path=FIXTURES / "retrieval_eval_environments.json")
        self.assertEqual(name, "papyrus-main-ai-ml-readonly")
        self.assertTrue(env["require_lexical"])
        self.assertEqual(env["corpus_id"], "knowledge-corpus-ai-ml-research")

    def test_apply_does_not_overwrite(self):
        saved = {
            key: os.environ.pop(key, None)
            for key in (
                "PAPYRUS_GRAPHQL_ENDPOINT",
                "PAPYRUS_STORAGE_BUCKET_NAME",
                "PAPYRUS_REQUIRE_LEXICAL",
            )
        }
        os.environ["PAPYRUS_GRAPHQL_ENDPOINT"] = "https://already.set/graphql"
        try:
            applied = apply_environment(
                {
                    "graphql_endpoint": "https://profile/graphql",
                    "storage_bucket": "bucket-from-profile",
                    "require_lexical": True,
                }
            )
            self.assertNotIn("PAPYRUS_GRAPHQL_ENDPOINT", applied)
            self.assertEqual(os.environ["PAPYRUS_GRAPHQL_ENDPOINT"], "https://already.set/graphql")
            self.assertIn("PAPYRUS_STORAGE_BUCKET_NAME", applied)
            self.assertEqual(os.environ["PAPYRUS_STORAGE_BUCKET_NAME"], "bucket-from-profile")
            self.assertEqual(os.environ.get("PAPYRUS_REQUIRE_LEXICAL"), "1")
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_golden_freshness_all_prefer_order(self):
        goldens = json.loads((FIXTURES / "retrieval_golden_queries.json").read_text(encoding="utf-8"))
        freshness = [q for q in goldens if q["category"] == "freshness"]
        self.assertEqual(len(freshness), 5)
        for q in freshness:
            self.assertEqual(q.get("metric"), "prefer_order")
            self.assertTrue(q.get("prefer_before"))
            for pair in q["prefer_before"]:
                self.assertEqual(len(pair), 2)
                self.assertNotEqual(pair[0], pair[1])


class RequireLexicalEngineTests(unittest.TestCase):
    def test_require_lexical_raises_on_broken_provider(self):
        from papyrus_knowledge_query.engine import run_knowledge_query
        from papyrus_knowledge_query.services import KnowledgeQueryServices

        class Semantic:
            name = "fake-semantic"

            def search(self, query, scope, limit):
                return [{"lineageId": "ref-sem", "rank": 1, "score": 0.8, "title": "S"}]

        class BrokenLexical:
            name = "bm25-lexical"

            def search(self, query, scope, limit):
                raise FileNotFoundError("missing artifact")

        with mock.patch.dict(os.environ, {"PAPYRUS_REQUIRE_LEXICAL": "1"}):
            with self.assertRaises(RuntimeError) as ctx:
                run_knowledge_query(
                    {"semanticQuery": "2401.04088", "output": {"format": "structured"}},
                    KnowledgeQueryServices(semantic=Semantic(), lexical=BrokenLexical()),
                )
        self.assertIn("Lexical search unavailable", str(ctx.exception))

    def test_require_lexical_raises_when_provider_missing(self):
        from papyrus_knowledge_query.engine import run_knowledge_query
        from papyrus_knowledge_query.services import KnowledgeQueryServices

        class Semantic:
            name = "fake-semantic"

            def search(self, query, scope, limit):
                return [{"lineageId": "ref-sem", "rank": 1, "score": 0.8, "title": "S"}]

        with mock.patch.dict(os.environ, {"PAPYRUS_REQUIRE_LEXICAL": "1"}):
            with self.assertRaises(RuntimeError) as ctx:
                run_knowledge_query(
                    {"semanticQuery": "anything", "output": {"format": "structured"}},
                    KnowledgeQueryServices(semantic=Semantic(), lexical=None),
                )
        self.assertIn("Lexical provider not configured", str(ctx.exception))

    def test_missing_provider_warns_by_default(self):
        from papyrus_knowledge_query.engine import run_knowledge_query
        from papyrus_knowledge_query.services import KnowledgeQueryServices

        class Semantic:
            name = "fake-semantic"

            def search(self, query, scope, limit):
                return [{"lineageId": "ref-sem", "rank": 1, "score": 0.8, "title": "S"}]

        with mock.patch.dict(os.environ, {"PAPYRUS_REQUIRE_LEXICAL": ""}, clear=False):
            os.environ.pop("PAPYRUS_REQUIRE_LEXICAL", None)
            result = run_knowledge_query(
                {"semanticQuery": "anything", "output": {"format": "structured"}},
                KnowledgeQueryServices(semantic=Semantic(), lexical=None),
            )
        self.assertTrue(
            any("Lexical provider not configured" in w for w in (result.get("warnings") or []))
        )

    def test_build_environment_services_require_lexical_without_bucket(self):
        from papyrus_knowledge_query import services as svc_mod

        with mock.patch.dict(
            os.environ,
            {
                "PAPYRUS_REQUIRE_LEXICAL": "1",
                "PAPYRUS_SEMANTIC_PROVIDER": "none",
            },
            clear=False,
        ):
            os.environ.pop("PAPYRUS_STORAGE_BUCKET_NAME", None)
            os.environ.pop("PAPYRUS_LEXICAL_INDEX_PATH", None)
            os.environ.pop("papyrusMedia_BUCKET_NAME", None)
            with mock.patch.object(svc_mod, "_semantic_from_environment", return_value=object()):
                with mock.patch.object(svc_mod, "_corpus_text_from_environment", return_value=None):
                    with mock.patch.object(svc_mod, "_graph_from_environment", return_value=None):
                        with mock.patch.object(svc_mod, "_bucket_from_amplify_outputs", return_value=""):
                            with self.assertRaises(RuntimeError) as ctx:
                                svc_mod.build_environment_services()
        self.assertIn("no lexical provider could be constructed", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
