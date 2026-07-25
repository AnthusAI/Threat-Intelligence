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

from papyrus_content.assisted_curation_triage import (  # noqa: E402
    apply_mechanical_dispositions,
    build_assisted_triage_plan,
    list_mechanical_dispositions,
    load_triage_plan,
    run_triage_review_session,
    write_triage_plan,
)
from papyrus_content import references_commands  # noqa: E402
from papyrus_newsroom import reference_actions  # noqa: E402


CORPUS_ID = "knowledge-corpus-threat-intelligence"


def _ref(
    *,
    item_id: str,
    title: str,
    status: str = "pending",
    source_uri: str = "",
    metadata: dict | None = None,
) -> dict:
    lineage = f"lineage-{item_id}"
    return {
        "id": f"reference-{item_id}-v1",
        "lineageId": lineage,
        "externalItemId": item_id,
        "corpusId": CORPUS_ID,
        "versionState": "current",
        "versionNumber": 1,
        "title": title,
        "sourceUri": source_uri,
        "curationStatus": status,
        "metadata": metadata or {},
    }


class AssistedCurationTriageTests(unittest.TestCase):
    def test_plan_lanes_dedupe_rationales_and_mechanical_auto_reject(self):
        accepted = _ref(
            item_id="accepted-nist",
            title="NIST AI Risk Management Framework",
            status="accepted",
            source_uri="https://www.nist.gov/itl/ai-risk-management-framework",
        )
        pending_similar = _ref(
            item_id="pending-nist-like",
            title="NIST AI Risk Management Framework overview",
            source_uri="https://www.nist.gov/itl/ai-risk-management-framework/overview",
        )
        pending_dup_a = _ref(
            item_id="pending-dup-a",
            title="PentestGPT an LLM empowered automatic penetration testing tool",
            source_uri="https://arxiv.org/abs/2308.06782",
        )
        pending_dup_b = _ref(
            item_id="pending-dup-b",
            title="PentestGPT: An LLM-empowered Automatic Penetration Testing Tool",
            source_uri="https://doi.org/10.1234/pentestgpt",
        )
        stub = _ref(
            item_id="citation:deadbeef",
            title="Mulval: A logic-based network security analyzer",
            source_uri="",
        )
        exact_accepted_dup = _ref(
            item_id="pending-exact-accepted",
            title="Copy of NIST",
            source_uri="https://www.nist.gov/itl/ai-risk-management-framework",
        )
        exploratory = _ref(
            item_id="pending-exploratory",
            title="Totally unrelated astronomy paper",
            source_uri="https://arxiv.org/abs/0000.00001",
            metadata={"exploratory": True},
        )
        uncertain = _ref(
            item_id="pending-uncertain",
            title="Obscure vendor blog about coffee",
            source_uri="https://example.com/coffee",
        )

        plan = build_assisted_triage_plan(
            corpus_id=CORPUS_ID,
            references=[
                accepted,
                pending_similar,
                pending_dup_a,
                pending_dup_b,
                stub,
                exact_accepted_dup,
                exploratory,
                uncertain,
            ],
            attachments=[],
            messages=[],
            relations=[],
        )

        self.assertTrue(plan["guarantees"]["autoAcceptDisabled"])
        self.assertTrue(plan["guarantees"]["acceptanceRequiresExplicitHumanAction"])
        self.assertTrue(plan["historySignal"]["thinHistory"])

        auto_by_id = {row["referenceId"]: row for row in plan["mechanicalDispositions"]}
        self.assertIn(stub["id"], auto_by_id)
        self.assertEqual(auto_by_id[stub["id"]]["mechanicalRule"], "mechanically_unavailable")
        self.assertEqual(auto_by_id[stub["id"]]["mechanicalAction"], "archive")
        self.assertEqual(auto_by_id[stub["id"]]["autoArchiveRule"], "mechanically_unavailable")
        self.assertIsNone(auto_by_id[stub["id"]]["autoRejectRule"])
        self.assertIn("auto-archive", auto_by_id[stub["id"]]["rationale"].lower())
        self.assertIn(exact_accepted_dup["id"], auto_by_id)
        self.assertEqual(auto_by_id[exact_accepted_dup["id"]]["mechanicalAction"], "reject")
        self.assertEqual(auto_by_id[exact_accepted_dup["id"]]["autoRejectRule"], "duplicate_of_accepted_uri")
        self.assertTrue(plan["guarantees"]["mechanicalUnavailableUsesArchive"])
        self.assertEqual(plan["counts"]["mechanicalArchives"], 1)
        self.assertEqual(plan["counts"]["mechanicalRejects"], 1)

        human_by_id = {row["referenceId"]: row for row in plan["humanQueue"]}
        self.assertIn(pending_similar["id"], human_by_id)
        self.assertEqual(human_by_id[pending_similar["id"]]["lane"], "likely_accept")
        self.assertIn("accepted-nist", human_by_id[pending_similar["id"]]["rationale"])

        self.assertIn(exploratory["id"], human_by_id)
        self.assertEqual(human_by_id[exploratory["id"]]["lane"], "uncertain")
        self.assertTrue(human_by_id[exploratory["id"]]["exploratory"])
        self.assertIn("exempt", human_by_id[exploratory["id"]]["rationale"].lower())

        self.assertIn(uncertain["id"], human_by_id)
        self.assertEqual(human_by_id[uncertain["id"]]["lane"], "uncertain")
        self.assertIn("example.com", human_by_id[uncertain["id"]]["rationale"])
        self.assertIn("Needs editorial judgment", human_by_id[uncertain["id"]]["rationale"])

        # Cluster surfaces one primary; sibling stays out of human queue.
        cluster_primaries = [row for row in plan["humanQueue"] if row.get("clusterSize", 1) > 1]
        self.assertEqual(len(cluster_primaries), 1)
        primary = cluster_primaries[0]
        self.assertEqual(primary["clusterSize"], 2)
        self.assertTrue(primary["clusterPrimary"])
        self.assertNotIn(pending_dup_a["id"] if primary["referenceId"] == pending_dup_b["id"] else pending_dup_b["id"], human_by_id)

    def test_history_based_likely_reject_and_prior_rejected_uri(self):
        accepted = _ref(
            item_id="accepted-owasp",
            title="OWASP Top 10 for LLM Applications",
            status="accepted",
            source_uri="https://owasp.org/www-project-top-10-for-large-language-model-applications/",
        )
        rejected = _ref(
            item_id="rejected-sports",
            title="Championship football preview for next season",
            status="rejected",
            source_uri="https://sports.example.com/football-preview",
            metadata={"reasonCode": "out_of_scope"},
        )
        pending_like_rejected = _ref(
            item_id="pending-sports",
            title="Championship football preview analysis",
            source_uri="https://sports.example.com/football-preview-analysis",
        )
        pending_prior_uri = _ref(
            item_id="pending-prior",
            title="Different title same URL",
            source_uri="https://sports.example.com/football-preview",
        )
        plan = build_assisted_triage_plan(
            corpus_id=CORPUS_ID,
            references=[accepted, rejected, pending_like_rejected, pending_prior_uri],
            attachments=[],
            messages=[],
            relations=[],
        )
        auto_by_id = {row["referenceId"]: row for row in plan["mechanicalDispositions"]}
        self.assertEqual(auto_by_id[pending_prior_uri["id"]]["mechanicalRule"], "prior_rejected_uri")
        self.assertEqual(auto_by_id[pending_prior_uri["id"]]["mechanicalAction"], "reject")
        human_by_id = {row["referenceId"]: row for row in plan["humanQueue"]}
        self.assertEqual(human_by_id[pending_like_rejected["id"]]["lane"], "likely_reject")
        self.assertIn("rejected", human_by_id[pending_like_rejected["id"]]["rationale"].lower())

    def test_attachment_prevents_mechanical_unavailable(self):
        stub = _ref(item_id="citation:with-text", title="Has extracted text", source_uri="")
        attachments = [
            {
                "id": "att-1",
                "referenceLineageId": stub["lineageId"],
                "role": "extracted_text",
                "storagePath": "corpora/threat-intelligence/extracted/text/item.txt",
            }
        ]
        plan = build_assisted_triage_plan(
            corpus_id=CORPUS_ID,
            references=[stub],
            attachments=attachments,
            messages=[],
            relations=[],
        )
        self.assertEqual(plan["counts"]["mechanicalDispositions"], 0)
        self.assertEqual(plan["humanQueue"][0]["referenceId"], stub["id"])

    def test_max_pending_limits_human_queue_not_auto_reject_scan(self):
        accepted = _ref(
            item_id="accepted-nist",
            title="NIST AI Risk Management Framework",
            status="accepted",
            source_uri="https://www.nist.gov/itl/ai-risk-management-framework",
        )
        stubs = [
            _ref(item_id=f"citation:{index:04d}", title=f"Stub paper number {index}", source_uri="")
            for index in range(5)
        ]
        keepers = [
            _ref(
                item_id=f"keep-{index}",
                title=f"Unique keepable {['alpha','bravo','charlie','delta','echo'][index]} manuscript",
                source_uri=f"https://example.com/{index}",
            )
            for index in range(5)
        ]
        plan = build_assisted_triage_plan(
            corpus_id=CORPUS_ID,
            references=[accepted, *stubs, *keepers],
            attachments=[],
            max_pending=2,
        )
        self.assertEqual(plan["counts"]["pendingScanned"], 10)
        self.assertEqual(plan["counts"]["mechanicalDispositions"], 5)
        self.assertEqual(plan["counts"]["mechanicalArchives"], 5)
        self.assertEqual(plan["counts"]["humanQueue"], 2)

    def test_write_and_load_plan_roundtrip(self):
        plan = build_assisted_triage_plan(
            corpus_id=CORPUS_ID,
            references=[_ref(item_id="p1", title="Something unique enough", source_uri="https://example.com/a")],
            attachments=[],
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = write_triage_plan(plan, run_dir=pathlib.Path(tmp))
            loaded = load_triage_plan(path)
            self.assertEqual(loaded["kind"], "assisted-curation-triage-plan")
            self.assertEqual(loaded["counts"]["humanQueue"], 1)
            self.assertTrue((pathlib.Path(tmp) / "human_queue.jsonl").exists())

    def test_apply_mechanical_unavailable_archives_not_rejects(self):
        plan = {
            "kind": "assisted-curation-triage-plan",
            "runId": "assisted-triage-test",
            "runDir": None,
            "guarantees": {"autoAcceptDisabled": True},
            "mechanicalDispositions": [
                {
                    "referenceId": "reference-stub-v1",
                    "mechanicalRule": "mechanically_unavailable",
                    "mechanicalAction": "archive",
                    "rationale": "Mechanical auto-archive: unavailable",
                }
            ],
        }
        graphql = mock.Mock()
        with mock.patch(
            "papyrus_content.assisted_curation_triage.newsroom_reference_actions.review_reference_curation"
        ) as review:
            review.return_value = {
                "action": "archive",
                "status": "archived",
                "messageId": "message-1",
                "referenceId": "reference-stub-v1",
            }
            audit = apply_mechanical_dispositions(graphql, plan, dry_run=False)
        self.assertEqual(audit["count"], 1)
        self.assertEqual(audit["archiveCount"], 1)
        self.assertEqual(audit["rejectCount"], 0)
        review.assert_called_once()
        kwargs = review.call_args.kwargs
        self.assertEqual(kwargs["action"], "archive")
        self.assertEqual(kwargs["auto_archive_rule"], "mechanically_unavailable")
        self.assertNotIn("auto_reject_rule", kwargs)
        self.assertNotEqual(kwargs["action"], "accept")

    def test_list_mechanical_dispositions_includes_archives(self):
        archived = _ref(
            item_id="auto-arch",
            title="Stub",
            status="archived",
            source_uri="",
        )
        message = {
            "id": "message-auto-1",
            "messageKind": "reference_curation",
            "createdAt": "2026-07-25T00:00:00Z",
            "metadata": {
                "autoArchive": True,
                "autoArchiveRule": "mechanically_unavailable",
                "action": "archive",
                "mechanicalDisposition": True,
            },
        }
        relation = {
            "id": "rel-1",
            "relationState": "current",
            "predicate": "comment",
            "relationTypeKey": "comment",
            "subjectKind": "message",
            "subjectId": message["id"],
            "objectKind": "reference",
            "objectLineageId": archived["lineageId"],
        }
        rows = list_mechanical_dispositions(
            references=[archived],
            messages=[message],
            relations=[relation],
            corpus_id=CORPUS_ID,
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["mechanicalAction"], "archive")
        self.assertEqual(rows[0]["autoArchiveRule"], "mechanically_unavailable")
        self.assertTrue(rows[0]["reversible"])

    def test_review_session_accept_requires_explicit_key_and_records_metrics(self):
        plan = {
            "kind": "assisted-curation-triage-plan",
            "runId": "assisted-triage-test",
            "guarantees": {
                "autoAcceptDisabled": True,
                "acceptanceRequiresExplicitHumanAction": True,
            },
            "humanQueue": [
                {
                    "referenceId": "reference-a-v1",
                    "title": "Example",
                    "sourceUri": "https://example.com/a",
                    "lane": "uncertain",
                    "rationale": "Needs judgment.",
                    "exploratory": False,
                    "clusterSize": 1,
                }
            ],
        }
        answers = iter(["a"])
        buffer = io.StringIO()
        session = run_triage_review_session(
            plan,
            dry_run=True,
            input_fn=lambda _prompt: next(answers),
            output=buffer,
            clock=lambda: 10.0,
        )
        self.assertEqual(session["metrics"]["accepted"], 1)
        self.assertEqual(session["metrics"]["prospectsReviewed"], 1)
        self.assertEqual(session["decisions"][0]["action"], "accept")
        self.assertFalse(session["decisions"][0]["applied"])
        self.assertIn("explicit human action", buffer.getvalue().lower())

    def test_review_reference_curation_rejects_auto_rules_on_accept(self):
        with self.assertRaises(ValueError):
            reference_actions.review_reference_curation(
                mock.Mock(),
                reference_id="reference-1",
                action="accept",
                auto_reject_rule="duplicate_of_accepted_uri",
            )
        with self.assertRaises(ValueError):
            reference_actions.review_reference_curation(
                mock.Mock(),
                reference_id="reference-1",
                action="accept",
                auto_archive_rule="mechanically_unavailable",
            )

    def test_load_dotenv_does_not_override_explicit_graphql_endpoint(self):
        import os
        from papyrus_content.env import load_dotenv, PAPYRUS_ROOT

        previous = os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT")
        try:
            os.environ["PAPYRUS_GRAPHQL_ENDPOINT"] = "https://forced-production.example/graphql"
            load_dotenv()
            self.assertEqual(
                os.environ["PAPYRUS_GRAPHQL_ENDPOINT"],
                "https://forced-production.example/graphql",
            )
            # Sanity: worktree has a .env that would otherwise rewrite endpoint.
            self.assertTrue((PAPYRUS_ROOT / ".env").exists() or (PAPYRUS_ROOT / ".env").is_symlink())
        finally:
            if previous is None:
                os.environ.pop("PAPYRUS_GRAPHQL_ENDPOINT", None)
            else:
                os.environ["PAPYRUS_GRAPHQL_ENDPOINT"] = previous


class AssistedCurationTriageCliTests(unittest.TestCase):
    @mock.patch("papyrus_content.references_commands.write_triage_plan")
    @mock.patch("papyrus_content.references_commands.build_assisted_triage_plan")
    @mock.patch("papyrus_content.references_commands.create_authoring_client")
    @mock.patch("papyrus_content.references_commands.require_corpus_config")
    @mock.patch("papyrus_content.references_commands.require_steering_config")
    @mock.patch("papyrus_content.references_commands.load_steering_config")
    def test_triage_plan_command_prints_summary(
        self,
        mock_load,
        mock_require,
        mock_corpus,
        mock_client_factory,
        mock_build,
        mock_write,
    ):
        mock_load.return_value = None
        mock_require.return_value = {"corpora": []}
        mock_corpus.return_value = {"key": "threat-intelligence", "name": "threat-intelligence"}
        mock_client = mock.Mock()
        mock_client.list_records.return_value = []
        mock_client_factory.return_value = (mock_client, {})
        plan = {
            "kind": "assisted-curation-triage-plan",
            "runId": "assisted-triage-cli",
            "counts": {
                "pendingScanned": 3,
                "humanQueue": 2,
                "mechanicalDispositions": 1,
                "mechanicalArchives": 1,
                "mechanicalRejects": 0,
                "autoRejectCandidates": 1,
                "clusterCount": 0,
                "lanes": {"uncertain": 1, "likely_accept": 1, "likely_reject": 0},
            },
            "historySignal": {"thinHistory": True},
            "guarantees": {
                "autoAcceptDisabled": True,
                "acceptanceRequiresExplicitHumanAction": True,
                "mechanicalUnavailableUsesArchive": True,
            },
            "humanQueue": [],
            "mechanicalDispositions": [],
            "autoRejectCandidates": [],
        }
        mock_build.return_value = plan
        with tempfile.TemporaryDirectory() as tmp:
            manifest = pathlib.Path(tmp) / "plan.json"
            plan_with_dir = {**plan, "runDir": tmp}
            manifest.write_text(json.dumps(plan_with_dir), encoding="utf-8")
            mock_write.return_value = manifest
            with mock.patch("sys.stdout", new=io.StringIO()) as stdout:
                references_commands.references_triage_plan(
                    ["--corpus-key", "threat-intelligence", "--output-dir", tmp]
                )
                output = stdout.getvalue()
        self.assertIn("triage-plan\thuman-queue\t2", output)
        self.assertIn("triage-plan\tmechanical-dispositions\t1", output)
        self.assertIn("triage-plan\tmechanical-archives\t1", output)
        self.assertIn("lane-likely-accept\t1", output)


if __name__ == "__main__":
    unittest.main()
