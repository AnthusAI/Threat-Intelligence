import gzip
import json
import pathlib
import sys
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_knowledge_query.lexical_index import (
    audit_lexical_artifact,
    bm25_search,
    build_lexical_index,
    dumps_lexical_index,
    lexical_manifest_from_artifact,
    loads_lexical_index,
    normalize_defanged_iocs,
    passage_candidate_to_lexical_doc,
    query_has_identifier,
    tokenize_lexical,
    write_lexical_index,
)
from papyrus_knowledge_query.ranking import fuse_ranked_lists
from papyrus_knowledge_query.engine import _hybrid_semantic_search, run_knowledge_query
from papyrus_knowledge_query.services import KnowledgeQueryServices


class LexicalIndexTests(unittest.TestCase):
    def test_tokenizer_preserves_security_identifiers(self):
        tokens = tokenize_lexical(
            "See CVE-2024-3400 and hash c399862d3b9d6b76c8436e924a68c45b "
            "plus T1059.001 at evil.example.com and 192.0.2.1"
        )
        self.assertIn("cve-2024-3400", tokens)
        self.assertIn("c399862d3b9d6b76c8436e924a68c45b", tokens)
        self.assertIn("t1059.001", tokens)
        self.assertIn("evil.example.com", tokens)
        self.assertIn("192.0.2.1", tokens)

    def test_tokenizer_preserves_academic_identifiers(self):
        doi_tokens = tokenize_lexical("10.1145/3442188.3445922")
        self.assertEqual(doi_tokens, ["10.1145/3442188.3445922"])
        self.assertIn(
            "10.1145/3442188.3445922",
            tokenize_lexical("See DOI 10.1145/3442188.3445922 in the abstract."),
        )
        isbn_tokens = tokenize_lexical("978-0-13-235088-4")
        self.assertEqual(isbn_tokens, ["9780132350884"])
        self.assertEqual(tokenize_lexical("2401.04088"), ["2401.04088"])
        self.assertEqual(tokenize_lexical("arXiv:2401.04088"), ["2401.04088"])
        pmid_tokens = tokenize_lexical("PMID:31452104")
        self.assertEqual(pmid_tokens, ["31452104"])

    def test_bm25_finds_exact_doi(self):
        artifact = build_lexical_index(
            [
                {
                    "key": "reference-passage-doi",
                    "text": "We cite 10.1145/3442188.3445922 as the primary source.",
                    "referenceLineageId": "reference-doi",
                    "chunkIndex": 0,
                    "corpusId": "corpus-a",
                    "curationStatus": "accepted",
                    "title": "DOI paper",
                },
                {
                    "key": "reference-passage-other",
                    "text": "Unrelated discussion of memory safety in agents.",
                    "referenceLineageId": "reference-other",
                    "chunkIndex": 0,
                    "corpusId": "corpus-a",
                    "curationStatus": "accepted",
                    "title": "Other",
                },
            ]
        )
        hits = bm25_search(artifact, "10.1145/3442188.3445922", limit=5)
        self.assertGreaterEqual(len(hits), 1)
        self.assertEqual(hits[0]["lineageId"], "reference-doi")

    def test_defang_normalization_round_trip(self):
        fanged = normalize_defanged_iocs("hxxp://example[.]com")
        self.assertIn("http://example.com", fanged)
        tokens = tokenize_lexical("visit hxxp://example[.]com now")
        self.assertIn("example.com", tokens)

    def test_bm25_finds_exact_cve(self):
        artifact = build_lexical_index(
            [
                {
                    "key": "reference-passage-aaa",
                    "text": "Exploitation of CVE-2024-3400 was observed in the wild.",
                    "referenceLineageId": "reference-cve",
                    "chunkIndex": 0,
                    "corpusId": "corpus-a",
                    "curationStatus": "accepted",
                    "title": "CVE note",
                    "storagePath": "corpora/a/extracted.txt",
                },
                {
                    "key": "reference-passage-bbb",
                    "text": "Unrelated discussion of memory safety in agents.",
                    "referenceLineageId": "reference-other",
                    "chunkIndex": 0,
                    "corpusId": "corpus-a",
                    "curationStatus": "accepted",
                    "title": "Other",
                    "storagePath": "corpora/b/extracted.txt",
                },
            ]
        )
        hits = bm25_search(artifact, "CVE-2024-3400", limit=5)
        self.assertGreaterEqual(len(hits), 1)
        self.assertEqual(hits[0]["lineageId"], "reference-cve")
        self.assertLessEqual(hits[0]["score"], 1.0)

    def test_defanged_query_matches_fanged_text(self):
        artifact = build_lexical_index(
            [
                {
                    "key": "reference-passage-dom",
                    "text": "Payload fetched from http://evil.example.com/path",
                    "referenceLineageId": "reference-dom",
                    "chunkIndex": 0,
                    "corpusId": "corpus-a",
                    "curationStatus": "accepted",
                }
            ]
        )
        hits = bm25_search(artifact, "hxxp://evil[.]example[.]com", limit=5)
        self.assertEqual(hits[0]["lineageId"], "reference-dom")

    def test_scope_filters_corpus(self):
        artifact = build_lexical_index(
            [
                {
                    "key": "reference-passage-a",
                    "text": "token marker alpha",
                    "referenceLineageId": "ref-a",
                    "corpusId": "corpus-a",
                    "curationStatus": "accepted",
                },
                {
                    "key": "reference-passage-b",
                    "text": "token marker beta",
                    "referenceLineageId": "ref-b",
                    "corpusId": "corpus-b",
                    "curationStatus": "accepted",
                },
            ]
        )
        hits = bm25_search(artifact, "token marker", limit=10, scope={"corpusId": "corpus-a"})
        self.assertEqual([hit["lineageId"] for hit in hits], ["ref-a"])

    def test_passage_keys_match_vector_key_shape(self):
        candidate = {
            "key": "reference-passage-deadbeefdeadbeefdead",
            "text": "chunk body " * 20,
            "metadata": {
                "vectorKind": "reference_passage",
                "referenceLineageId": "reference-1",
                "chunkIndex": 2,
                "corpusId": "corpus-a",
                "curationStatus": "accepted",
                "storagePath": "corpora/x/extracted.txt",
                "title": "T",
            },
        }
        doc = passage_candidate_to_lexical_doc(candidate)
        self.assertIsNotNone(doc)
        self.assertEqual(doc["key"], candidate["key"])
        artifact = build_lexical_index([doc])
        self.assertEqual(artifact["docs"][0]["key"], candidate["key"])

    def test_passage_lexical_doc_indexes_source_uri_identifiers(self):
        candidate = {
            "key": "reference-passage-arxivmeta",
            "text": "Body text without the identifier string.",
            "metadata": {
                "vectorKind": "reference_passage",
                "referenceLineageId": "reference-arxiv",
                "chunkIndex": 0,
                "corpusId": "corpus-a",
                "curationStatus": "accepted",
                "title": "A Simple Neural Attentive Meta-Learner",
                "sourceUri": "https://arxiv.org/abs/1707.03141",
                "storagePath": "corpora/x/arxiv_1707.03141.pdf",
            },
        }
        doc = passage_candidate_to_lexical_doc(candidate)
        self.assertIn("1707.03141", doc["text"])
        # Title prose must not be copied wholesale into the lexical text.
        self.assertNotIn("Attentive Meta-Learner", doc["text"])
        artifact = build_lexical_index([doc])
        hits = bm25_search(artifact, "1707.03141", limit=3)
        self.assertEqual(hits[0]["lineageId"], "reference-arxiv")

    def test_rrf_fusion_normalizes_and_joins_on_lineage(self):
        semantic = [
            {"lineageId": "ref-b", "rank": 1, "score": 0.4, "title": "B"},
            {"lineageId": "ref-a", "rank": 2, "score": 0.3, "title": "A"},
        ]
        lexical = [
            {
                "key": "reference-passage-1",
                "lineageId": "ref-a",
                "rank": 1,
                "score": 0.9,
                "metadata": {"referenceLineageId": "ref-a", "passageKey": "reference-passage-1"},
            }
        ]
        fused = fuse_ranked_lists(
            [semantic, lexical],
            weights=[1.0, 1.5],
            list_names=["semantic", "lexical"],
        )
        self.assertEqual(fused[0]["lineageId"], "ref-a")
        self.assertGreaterEqual(fused[0]["score"], 0.0)
        self.assertLessEqual(fused[0]["score"], 1.0)
        self.assertEqual(fused[0]["fusion"]["semanticRank"], 2)
        self.assertEqual(fused[0]["fusion"]["lexicalRank"], 1)

    def test_gzip_round_trip(self):
        artifact = build_lexical_index(
            [
                {
                    "key": "reference-passage-x",
                    "text": "hello lexical world",
                    "referenceLineageId": "ref-x",
                    "chunkIndex": 0,
                }
            ],
            source_commit="abc123",
            eligible_count=3,
            skipped={"missing_extracted_text": 2},
            corpus_id="corpus-a",
        )
        raw = dumps_lexical_index(artifact)
        self.assertTrue(raw[:2] == gzip.compress(b"x")[:2] or raw[:2] == b"\x1f\x8b")
        loaded = loads_lexical_index(raw)
        self.assertEqual(len(loaded["docs"]), 1)
        self.assertEqual(loaded["manifest"]["referenceCount"], 1)
        self.assertEqual(loaded["manifest"]["eligibleCount"], 3)
        self.assertEqual(loaded["manifest"]["skippedTotal"], 2)
        self.assertEqual(loaded["manifest"]["skipped"]["missing_extracted_text"], 2)
        self.assertEqual(loaded["manifest"]["chunkCount"], 1)
        self.assertEqual(loaded["manifest"]["sourceCommit"], "abc123")
        self.assertEqual(loaded["manifest"]["corpusId"], "corpus-a")

    def test_atomic_local_write_emits_manifest_sidecar(self):
        artifact = build_lexical_index(
            [
                {
                    "key": "reference-passage-x",
                    "text": "hello lexical world",
                    "referenceLineageId": "ref-x",
                    "chunkIndex": 0,
                }
            ],
            source_commit="deadbeef",
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "index.json.gz"
            write_lexical_index(path, artifact)
            self.assertTrue(path.exists())
            sidecar = path.with_name("manifest.json")
            self.assertTrue(sidecar.exists())
            manifest = json.loads(sidecar.read_text())
            self.assertEqual(manifest["sourceCommit"], "deadbeef")
            self.assertEqual(manifest["chunkCount"], 1)

    def test_audit_compares_manifest_to_live_listing(self):
        artifact = build_lexical_index(
            [
                {
                    "key": "reference-passage-a",
                    "text": "token alpha",
                    "referenceLineageId": "ref-a",
                },
                {
                    "key": "reference-passage-b",
                    "text": "token beta",
                    "referenceLineageId": "ref-b",
                },
            ],
            source_commit="cafebabe",
            eligible_count=3,
            skipped={"missing_extracted_text": 1},
        )
        report = audit_lexical_artifact(artifact, {"ref-a", "ref-b", "ref-c"})
        self.assertEqual(report["manifest"]["referenceCount"], 2)
        self.assertEqual(report["manifest"]["eligibleCount"], 3)
        self.assertEqual(report["liveAcceptedReferenceCount"], 3)
        self.assertEqual(report["manifestDrift"], 1)
        self.assertTrue(report["internallyComplete"])
        self.assertTrue(any("explained by attrition" in w for w in report["warnings"]))
        self.assertEqual(lexical_manifest_from_artifact(artifact)["sourceCommit"], "cafebabe")

    def test_query_without_artifact_stays_semantic_only(self):
        class Semantic:
            name = "fake-semantic"

            def search(self, query, scope, limit):
                return [{"lineageId": "ref-sem", "rank": 1, "score": 0.8, "title": "S"}]

        class BrokenLexical:
            name = "bm25-lexical"

            def search(self, query, scope, limit):
                raise FileNotFoundError("missing artifact")

        result = run_knowledge_query(
            {"semanticQuery": "anything", "output": {"format": "structured"}},
            KnowledgeQueryServices(semantic=Semantic(), lexical=BrokenLexical()),
        )
        self.assertEqual(result["structured"]["semanticMatches"][0]["lineageId"], "ref-sem")
        self.assertTrue(any("Lexical search unavailable" in warning for warning in result["warnings"]))
        self.assertNotIn("fusion", result["structured"]["semanticMatches"][0])

    def test_identifier_query_detected(self):
        self.assertTrue(query_has_identifier("look up CVE-2024-3400 please"))
        self.assertTrue(query_has_identifier("10.1145/3442188.3445922"))
        self.assertTrue(query_has_identifier("2401.04088"))
        self.assertTrue(query_has_identifier("PMID:31452104"))
        self.assertTrue(query_has_identifier("978-0-13-235088-4"))
        self.assertFalse(query_has_identifier("general agent reliability survey"))

    def test_hybrid_fuses_only_for_identifier_queries(self):
        class Semantic:
            def search(self, query, scope, limit):
                return [
                    {"lineageId": "sem-1", "rank": 1, "score": 0.9},
                    {"lineageId": "sem-2", "rank": 2, "score": 0.8},
                ]

        class Lexical:
            name = "bm25-lexical"

            def search(self, query, scope, limit):
                return [
                    {
                        "lineageId": "sem-2",
                        "rank": 1,
                        "score": 1.0,
                        "metadata": {"referenceLineageId": "sem-2"},
                    }
                ]

        warnings: list[str] = []
        paraphrased = _hybrid_semantic_search(
            request={"semanticQuery": "meta learning with attention", "scope": {"topK": 10}},
            semantic_provider=Semantic(),
            lexical_provider=Lexical(),
            warnings=warnings,
        )
        self.assertEqual(paraphrased[0]["lineageId"], "sem-1")
        self.assertNotIn("fusion", paraphrased[0])

        fused = _hybrid_semantic_search(
            request={"semanticQuery": "CVE-2024-3400", "scope": {"topK": 10}},
            semantic_provider=Semantic(),
            lexical_provider=Lexical(),
            warnings=warnings,
        )
        self.assertEqual(fused[0]["lineageId"], "sem-2")
        self.assertEqual(fused[0]["fusion"]["lexicalRank"], 1)


if __name__ == "__main__":
    unittest.main()
