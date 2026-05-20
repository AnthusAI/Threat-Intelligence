import contextlib
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_knowledge_query.engine import ContextBlock, _render_markdown_context, run_knowledge_query
from papyrus_knowledge_query.lambda_handler import handler as lambda_handler
from papyrus_knowledge_query.services import KnowledgeQueryServices, relation_allowed_for_scope
from papyrus_knowledge_query.tokens import TokenCounter


class FakeSemanticProvider:
    name = "fake-semantic"

    def search(self, query, scope, limit):
        return [
            {
                "rank": 1,
                "score": 0.91,
                "kind": "semanticNode",
                "id": "node-agent-memory-v1",
                "lineageId": "node-agent-memory",
                "title": "Agent Memory",
                "summary": f"Semantic match for {query}",
            }
        ][:limit]


class FakeVectorSemanticProvider:
    name = "fake-vector-semantic"

    def search(self, query, scope, limit):
        return [
            {
                "rank": 1,
                "distance": 0.21,
                "kind": "reference",
                "id": "reference-1-v1",
                "lineageId": "reference-1",
                "title": "Scaling Memo",
                "summary": "Production evaluation evidence for agent systems.",
                "metadata": {
                    "kind": "reference",
                    "id": "reference-1-v1",
                    "lineageId": "reference-1",
                    "referenceId": "reference-1-v1",
                    "referenceLineageId": "reference-1",
                    "title": "Scaling Memo",
                    "summary": "Production agent systems need reliability measurement.",
                    "text": (
                        "Production agent systems need reliable evaluation before deployment. "
                        "Teams measure reliability with task success, human review, and regression checks. "
                        "The study reports that human evaluation remains central for production agents."
                    ),
                    "storagePath": "corpora/test/extracted/pipeline/snapshot/text/reference-1.txt",
                    "chunkIndex": 0,
                    "startChar": 0,
                    "endChar": 260,
                    "corpusId": "test-corpus",
                    "categorySetId": "test-category-set",
                },
            },
            {
                "rank": 2,
                "distance": 0.33,
                "kind": "item",
                "id": "item-agent-eval-v1",
                "lineageId": "item-agent-eval",
                "title": "Production Agent Evaluation",
                "deck": "A newsroom article about measuring agent reliability in deployed systems.",
                "body": ["Article body fallback about production measurement for agent systems."],
                "metadata": {"corpusId": "test-corpus", "categorySetId": "test-category-set"},
            },
        ][:limit]


class RecordingVectorSemanticProvider(FakeVectorSemanticProvider):
    def __init__(self):
        self.queries = []

    def search(self, query, scope, limit):
        self.queries.append(query)
        return super().search(query, scope, limit)


class FakeGraphProvider:
    name = "fake-graph"

    def resolve_anchor(self, anchor):
        if anchor["kind"] == "reference":
            return {
                "kind": "reference",
                "id": anchor["id"],
                "lineageId": anchor.get("lineageId", anchor["id"]),
                "title": "Scaling Memo",
                "authors": ["Ada Reporter"],
                "sourceUri": "https://example.com/scaling",
                "curationStatus": "accepted",
                "corpusId": "test-corpus",
                "categorySetId": "test-category-set",
            }
        if anchor["kind"] == "item":
            return {
                "kind": "item",
                "id": anchor["id"],
                "lineageId": anchor.get("lineageId", anchor["id"]),
                "type": "article",
                "title": "Production Agent Evaluation",
                "deck": "A newsroom article about measuring agent reliability in deployed systems.",
                "body": ["Article body fallback about production measurement for agent systems."],
                "corpusId": "test-corpus",
                "categorySetId": "test-category-set",
            }
        return {
            "kind": anchor["kind"],
            "id": anchor["id"],
            "lineageId": anchor.get("lineageId", anchor["id"]),
            "title": "Scaling Agents",
            "description": "Accepted topic about scaling agent systems.",
            "status": "accepted",
            "corpusId": "test-corpus",
            "categorySetId": "test-category-set",
        }

    def expand_anchor(self, anchor, scope):
        relations = [
            {
                "id": "relation-message-1",
                "predicate": "comment",
                "relationTypeKey": "comment",
                "relationDomain": "commentary",
                "subjectKind": "message",
                "subjectId": "message-1",
                "subjectLineageId": "message-1",
                "objectKind": "category",
                "objectId": anchor["id"],
                "objectLineageId": anchor["lineageId"],
                "metadata": {"summary": "Operational curation note should be excluded by default."},
                "score": 0.8,
            },
            {
                "id": "relation-topic-1",
                "predicate": "classified_as",
                "relationTypeKey": "classified_as",
                "relationDomain": "knowledge",
                "subjectKind": "reference",
                "subjectId": "reference-1-v1",
                "subjectLineageId": "reference-1",
                "objectKind": "category",
                "objectId": anchor["id"],
                "objectLineageId": anchor["lineageId"],
                "metadata": {"summary": "Reference is classified under scaling agent systems."},
                "score": 0.93,
            },
        ]
        return {
            "objects": [
                {
                    "kind": "reference",
                    "id": "reference-1-v1",
                    "lineageId": "reference-1",
                    "title": "Scaling Memo",
                    "authors": ["Ada Reporter"],
                    "sourceUri": "https://example.com/scaling",
                    "curationStatus": "accepted",
                }
            ],
            "relations": [relation for relation in relations if relation_allowed_for_scope(relation, scope)],
            "excludedRelations": [relation for relation in relations if not relation_allowed_for_scope(relation, scope)],
            "warnings": [],
        }

    def list_reference_attachments(self, reference):
        return [
            {
                "id": "attachment-1",
                "referenceId": "reference-1-v1",
                "referenceLineageId": "reference-1",
                "role": "extracted_text",
                "sortKey": "900-extracted-text",
                "storagePath": "corpora/test/extracted/pipeline/snapshot/text/reference-1.txt",
                "mediaType": "text/plain",
            }
        ]


class FakeCorpusTextProvider:
    name = "fake-corpus-text"

    def read_text(self, storage_path):
        return (
            "Abstract\n"
            "Production agent systems need reliable evaluation before deployment. "
            "Teams measure reliability with task success, human review, and regression checks. "
            "The study reports that human evaluation remains central for production agents.\n"
            "1. Results\n"
            "Agent memory systems are useful only when their behavior is observable and repeatable."
        )


class LongFakeCorpusTextProvider(FakeCorpusTextProvider):
    def read_text(self, storage_path):
        return "\n\n".join([super().read_text(storage_path)] * 12)


def fake_services():
    return KnowledgeQueryServices(graph=FakeGraphProvider(), semantic=FakeSemanticProvider(), corpus_text=FakeCorpusTextProvider())


class KnowledgeQueryTests(unittest.TestCase):
    def test_token_counter_matches_tiktoken_default_encoding(self):
        try:
            import tiktoken
        except Exception as exc:  # pragma: no cover - dependency guard
            self.skipTest(f"tiktoken unavailable: {exc}")

        text = "# Context\n\nProduction agents rely on human evaluation, task success, and regression checks."
        counter = TokenCounter()
        encoding = tiktoken.get_encoding("o200k_base")

        self.assertEqual(counter.count(text), len(encoding.encode(text)))
        self.assertEqual(counter.metadata()["provider"], "tiktoken")
        self.assertEqual(counter.metadata()["encoding"], "o200k_base")

    def test_token_counter_truncate_stays_under_budget(self):
        counter = TokenCounter()
        text = "Production measurement and reliability evaluation for LLM agents. " * 20
        truncated = counter.truncate(text, 17)

        self.assertLessEqual(counter.count(truncated), 17)

    def test_token_counter_regex_fallback_can_be_forced(self):
        counter = TokenCounter(use_tiktoken=False)

        self.assertEqual(counter.metadata()["provider"], "regex")
        self.assertEqual(counter.metadata()["encoding"], "regex-word-punctuation")
        self.assertEqual(counter.count("agent memory systems."), 4)
        self.assertEqual(counter.truncate("agent memory systems.", 2), "agent memory")

    def test_core_returns_structured_and_budgeted_markdown(self):
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
                "semanticQuery": "agent memory systems",
                "scope": {"depth": 1, "topK": 5},
                "profile": "editor",
                "output": {"format": "both", "maxTokens": 80},
            },
            fake_services(),
        )

        self.assertEqual(result["provenance"]["graphProvider"], "fake-graph")
        self.assertEqual(result["provenance"]["semanticProvider"], "fake-semantic")
        self.assertEqual(result["structured"]["anchors"][0]["title"], "Scaling Agents")
        self.assertEqual(result["structured"]["semanticMatches"][0]["title"], "Agent Memory")
        self.assertIn("Production agent systems need reliable evaluation", result["context"]["text"])
        self.assertNotIn("Operational curation note", result["context"]["text"])
        self.assertLessEqual(result["context"]["totalTokens"], 80)
        self.assertEqual(result["context"]["tokenizer"]["provider"], "tiktoken")
        self.assertEqual(result["context"]["tokenizer"]["encoding"], "o200k_base")
        self.assertEqual(result["debug"]["tokenizerProvider"], "tiktoken")
        self.assertEqual(result["debug"]["tokenizerEncoding"], "o200k_base")

    def test_output_tokenizer_model_override_is_reported(self):
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
                "output": {"format": "markdown", "maxTokens": 120, "tokenizerModel": "gpt-4o-mini"},
            },
            fake_services(),
        )

        self.assertEqual(result["context"]["tokenizer"]["provider"], "tiktoken")
        self.assertEqual(result["context"]["tokenizer"]["model"], "gpt-4o-mini")
        self.assertEqual(result["debug"]["tokenizerModel"], "gpt-4o-mini")

    def test_anchor_without_semantic_query_derives_query_for_see_also(self):
        semantic = RecordingVectorSemanticProvider()
        services = KnowledgeQueryServices(
            graph=FakeGraphProvider(),
            semantic=semantic,
            corpus_text=FakeCorpusTextProvider(),
        )
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "reference", "id": "reference-1-v1", "lineageId": "reference-1"}],
                "output": {"format": "markdown", "maxTokens": 500},
            },
            services,
        )

        self.assertEqual(result["structured"]["request"]["semanticQuerySource"], "anchor_derived")
        self.assertEqual(result["debug"]["semanticQuerySource"], "anchor_derived")
        self.assertEqual(len(semantic.queries), 1)
        self.assertIn("Scaling Memo", semantic.queries[0])
        self.assertIn("## See Also", result["context"]["text"])
        self.assertIn("Production Agent Evaluation", result["context"]["text"])

    def test_multi_source_markdown_groups_metadata_and_excerpts_by_source(self):
        blocks = [
            ContextBlock("summary", "knowledge_summary", "", "Query focus: agent evaluation.", 120, True),
            ContextBlock(
                "source.a",
                "sources",
                "Source A",
                "Source A\nPapyrus URI: papyrus://reference/a",
                60,
                provenance={"objectUri": "papyrus://reference/a"},
            ),
            ContextBlock(
                "source.b",
                "sources",
                "Source B",
                "Source B\nPapyrus URI: papyrus://reference/b",
                60,
                provenance={"objectUri": "papyrus://reference/b"},
            ),
            ContextBlock(
                "passage.a",
                "source_excerpts",
                "Source A",
                "1. Evidence from source A.",
                110,
                provenance={"objectUri": "papyrus://reference/a", "reason": "semantic_vector", "startChar": 25, "endChar": 50, "truncated": True},
            ),
            ContextBlock(
                "passage.b",
                "source_excerpts",
                "Source B",
                "Evidence from source B.",
                110,
                provenance={"objectUri": "papyrus://reference/b", "reason": "query_overlap"},
            ),
        ]

        result = _render_markdown_context(blocks, 500, KnowledgeQueryServices())
        text = result["text"]

        self.assertIn("## Source Context", text)
        self.assertNotIn("## Source Excerpts", text)
        self.assertNotIn("## Sources", text)
        self.assertNotIn("#### Evidence", text)
        self.assertLess(text.index("### Source A"), text.index("Evidence from source A"))
        self.assertLess(text.index("Evidence from source A"), text.index("### Source B"))
        self.assertLess(text.index("### Source B"), text.index("Evidence from source B."))
        self.assertIn("... Evidence from source A ...", text)
        self.assertNotIn("1. Evidence from source A.", text)

    def test_multi_target_markdown_separates_see_also_records(self):
        blocks = [
            ContextBlock("summary", "knowledge_summary", "", "Query focus: agent evaluation.", 120, True),
            ContextBlock(
                "target.a",
                "target_records",
                "Target A",
                "Target A\nPapyrus URI: papyrus://reference/a",
                60,
                provenance={"objectUri": "papyrus://reference/a"},
            ),
            ContextBlock(
                "target.b",
                "target_records",
                "Target B",
                "Target B\nPapyrus URI: papyrus://reference/b",
                60,
                provenance={"objectUri": "papyrus://reference/b"},
            ),
            ContextBlock(
                "passage.a",
                "source_excerpts",
                "Target A",
                "Target A excerpt.",
                110,
                provenance={"objectUri": "papyrus://reference/a"},
            ),
            ContextBlock(
                "passage.c",
                "source_excerpts",
                "See Also Source",
                "This semantic match excerpt should not be grouped with targets.",
                110,
                provenance={"objectUri": "papyrus://reference/c"},
            ),
            ContextBlock(
                "related.c",
                "related_records",
                "See Also Source",
                "Object: papyrus://reference/c\nWhy related: semantic match.\n" + ("• Related summary. " * 30),
                55,
                provenance={"objectUri": "papyrus://reference/c"},
            ),
        ]

        result = _render_markdown_context(blocks, 700, KnowledgeQueryServices(), see_also_max_tokens=70)
        text = result["text"]

        self.assertIn("## Target Records", text)
        self.assertIn("### Target A", text)
        self.assertIn("### Target B", text)
        self.assertIn("Target A excerpt.", text)
        self.assertNotIn("This semantic match excerpt should not be grouped with targets.", text)
        self.assertIn("## See Also", text)
        self.assertIn("### See Also Source", text)
        self.assertNotIn("• Related summary.", text)
        self.assertLessEqual(result["totalTokens"], 700)
        see_also_text = text.split("## See Also", 1)[1]
        self.assertLessEqual(KnowledgeQueryServices().token_counter.count("## See Also" + see_also_text), 70)

    def test_default_policy_excludes_operational_relations(self):
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
                "output": {"format": "markdown", "maxTokens": 240},
            },
            fake_services(),
        )

        relation_keys = {relation["relationTypeKey"] for relation in result["structured"]["relations"]}
        operational_keys = {relation["relationTypeKey"] for relation in result["structured"]["operationalRelations"]}
        self.assertIn("classified_as", relation_keys)
        self.assertNotIn("comment", relation_keys)
        self.assertIn("comment", operational_keys)
        self.assertNotIn("Operational curation note", result["context"]["text"])
        self.assertNotIn("Operational curation/workflow relations were excluded", result["context"]["text"])
        self.assertNotIn("## Gaps And Limits", result["context"]["text"])

    def test_explicit_relation_types_include_operational_relations(self):
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
                "scope": {"relationTypes": ["comment"]},
                "output": {"format": "markdown", "maxTokens": 240},
            },
            fake_services(),
        )

        relation_keys = {relation["relationTypeKey"] for relation in result["structured"]["relations"]}
        self.assertIn("comment", relation_keys)

    def test_provenance_appendix_renders_operational_relations_when_requested(self):
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
                "output": {"format": "markdown", "maxTokens": 260, "includeProvenanceAppendix": True},
            },
            fake_services(),
        )

        self.assertIn("## Provenance Appendix", result["context"]["text"])
        self.assertIn("Operational curation note", result["context"]["text"])

    def test_evidence_passages_are_structured_output(self):
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
                "semanticQuery": "production reliability evaluation",
                "output": {"format": "both", "maxTokens": 300},
            },
            fake_services(),
        )

        self.assertGreaterEqual(len(result["structured"]["evidencePassages"]), 1)
        self.assertIn("Full Source Text", result["context"]["text"])
        self.assertEqual(result["context"]["sourceTextMode"], "full")
        self.assertNotIn("message#", result["context"]["text"])

    def test_semantic_vector_passages_become_source_excerpts(self):
        services = KnowledgeQueryServices(
            graph=None,
            semantic=FakeVectorSemanticProvider(),
            corpus_text=None,
        )
        result = run_knowledge_query(
            {
                "semanticQuery": "production reliability evaluation for agents",
                "scope": {"depth": 1, "topK": 4},
                "output": {"format": "both", "maxTokens": 320},
            },
            services,
        )

        self.assertGreaterEqual(len(result["structured"]["semanticPassages"]), 1)
        self.assertEqual(result["structured"]["evidencePassages"][0]["selectionReason"], "semantic_vector")
        self.assertIn("## Source Excerpts", result["context"]["text"])
        self.assertNotIn("**Semantic vector match**", result["context"]["text"])
        self.assertIn("Production agent systems need reliable evaluation", result["context"]["text"])
        self.assertIn("papyrus://reference/reference-1", result["context"]["text"])
        self.assertNotIn("### Semantic match", result["context"]["text"])
        self.assertEqual(result["context"]["sourceTextMode"], "excerpted")

    def test_single_source_markdown_starts_with_source_header(self):
        services = KnowledgeQueryServices(
            graph=FakeGraphProvider(),
            semantic=FakeVectorSemanticProvider(),
            corpus_text=FakeCorpusTextProvider(),
        )
        result = run_knowledge_query(
            {
                "semanticQuery": "production reliability evaluation for agents",
                "output": {"format": "markdown", "maxTokens": 500},
            },
            services,
        )

        text = result["context"]["text"]
        self.assertTrue(text.startswith("# Scaling Memo"))
        self.assertIn("Papyrus URI: papyrus://reference/reference-1", text)
        self.assertNotIn("Primary source:", text)
        self.assertNotIn("- Scaling Memo (papyrus://reference/reference-1)", text)
        self.assertIn("## Context Summary", text)
        self.assertIn("## Full Source Text", text)
        self.assertIn("## See Also", text)
        self.assertEqual(result["context"]["sourceTextMode"], "full")

    def test_smaller_budget_falls_back_to_grouped_source_excerpts(self):
        services = KnowledgeQueryServices(
            graph=FakeGraphProvider(),
            semantic=FakeVectorSemanticProvider(),
            corpus_text=LongFakeCorpusTextProvider(),
        )
        result = run_knowledge_query(
            {
                "semanticQuery": "production reliability evaluation for agents",
                "output": {"format": "markdown", "maxTokens": 500},
            },
            services,
        )

        text = result["context"]["text"]
        self.assertIn("## Source Excerpts", text)
        self.assertNotIn("## Full Source Text", text)
        self.assertNotIn("**Semantic vector match**", text)
        source_excerpts = text.split("## Source Excerpts", 1)[1].split("## See Also", 1)[0]
        self.assertEqual(source_excerpts.count("### Scaling Memo"), 1)
        self.assertEqual(result["context"]["sourceTextMode"], "excerpted")
        self.assertLessEqual(result["context"]["totalTokens"], 500)

    def test_semantic_only_query_promotes_matches_to_related_records_and_graph_seed(self):
        services = KnowledgeQueryServices(
            graph=FakeGraphProvider(),
            semantic=FakeVectorSemanticProvider(),
            corpus_text=FakeCorpusTextProvider(),
        )
        result = run_knowledge_query(
            {
                "semanticQuery": "production reliability evaluation for agents",
                "scope": {"depth": 1, "topK": 4, "semanticSeedLimit": 1},
                "output": {"format": "markdown", "maxTokens": 500},
            },
            services,
        )

        related_uris = {record["objectUri"] for record in result["structured"]["relatedRecords"]}
        self.assertIn("papyrus://reference/reference-1", related_uris)
        self.assertIn("papyrus://item/item-agent-eval", related_uris)
        self.assertTrue(any(obj.get("semanticSeedRank") == 1 for obj in result["structured"]["expandedObjects"]))
        self.assertIn("## See Also", result["context"]["text"])
        self.assertIn("A newsroom article about measuring agent reliability", result["context"]["text"])

    def test_anchored_query_uses_same_record_vector_hit_as_evidence_not_related_record(self):
        services = KnowledgeQueryServices(
            graph=FakeGraphProvider(),
            semantic=FakeVectorSemanticProvider(),
            corpus_text=FakeCorpusTextProvider(),
        )
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "reference", "id": "reference-1-v1", "lineageId": "reference-1"}],
                "semanticQuery": "production reliability evaluation for agents",
                "output": {"format": "both", "maxTokens": 500},
            },
            services,
        )

        related_uris = {record["objectUri"] for record in result["structured"]["relatedRecords"]}
        self.assertNotIn("papyrus://reference/reference-1", related_uris)
        self.assertIn("papyrus://item/item-agent-eval", related_uris)
        self.assertEqual(result["structured"]["evidencePassages"][0]["selectionReason"], "semantic_vector")
        self.assertLessEqual(result["context"]["totalTokens"], 500)

    def test_related_article_records_include_summary_and_object_uri(self):
        services = KnowledgeQueryServices(
            graph=FakeGraphProvider(),
            semantic=FakeVectorSemanticProvider(),
            corpus_text=FakeCorpusTextProvider(),
        )
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
                "semanticQuery": "production reliability evaluation for agents",
                "output": {"format": "markdown", "maxTokens": 500},
            },
            services,
        )

        article = next(record for record in result["structured"]["relatedRecords"] if record["kind"] == "item")
        self.assertEqual(article["objectUri"], "papyrus://item/item-agent-eval")
        self.assertIn("newsroom article", article["summary"])
        self.assertIn("Object: papyrus://item/item-agent-eval", result["context"]["text"])

    def test_core_renders_appsync_awsjson_metadata_strings(self):
        services = KnowledgeQueryServices(graph=FakeGraphProvider(), semantic=FakeSemanticProvider())
        original_expand = services.graph.expand_anchor

        def expand_with_awsjson_metadata(anchor, scope):
            expansion = original_expand(anchor, scope)
            expansion["relations"][0]["metadata"] = json.dumps(expansion["relations"][0]["metadata"])
            return expansion

        services.graph.expand_anchor = expand_with_awsjson_metadata
        result = run_knowledge_query(
            {
                "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
                "scope": {"relationTypes": ["comment"]},
                "output": {"format": "markdown", "maxTokens": 140},
            },
            services,
        )

        self.assertIn("Operational curation note should be excluded by default.", result["context"]["text"])

    def test_lambda_handler_parses_appsync_awsjson_input(self):
        event = {
            "arguments": {
                "input": json.dumps(
                    {
                        "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
                        "output": {"format": "markdown", "maxTokens": 100},
                    }
                )
            }
        }
        with mock.patch("papyrus_knowledge_query.lambda_handler.build_environment_services", return_value=fake_services()):
            result = lambda_handler(event, None)

        self.assertIn("context", result)
        self.assertIn("Scaling Agents", result["context"]["text"])

    def test_newsroom_cli_delegates_to_same_engine(self):
        from papyrus_newsroom import cli as newsroom_cli

        payload = {
            "anchors": [{"kind": "category", "id": "category-scaling-v1", "lineageId": "category-scaling"}],
            "semanticQuery": "agent memory systems",
            "output": {"format": "both", "maxTokens": 120},
        }
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json") as handle:
            json.dump(payload, handle)
            handle.flush()
            stdout = io.StringIO()
            with mock.patch("papyrus_knowledge_query.cli.build_environment_services", return_value=fake_services()), \
                 contextlib.redirect_stdout(stdout):
                exit_code = newsroom_cli.main(["knowledge-query", "--input", handle.name])

        self.assertEqual(exit_code, 0)
        result = json.loads(stdout.getvalue())
        direct = run_knowledge_query(payload, fake_services())
        self.assertEqual(result["structured"], direct["structured"])
        self.assertEqual(result["context"]["text"], direct["context"]["text"])


if __name__ == "__main__":
    unittest.main()
