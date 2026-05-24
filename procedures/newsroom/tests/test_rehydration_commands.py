import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_content.rehydration_commands import (  # noqa: E402
    build_record_attachment_record,
    canonical_json_bytes,
    canonicalize_value,
    compute_inline_field_candidates,
    owner_from_record_key,
    resolve_rehydration_models,
)


class RehydrationCommandTests(unittest.TestCase):
    def test_canonicalize_value_drops_null_and_stabilizes_order(self) -> None:
        payload = {
            "z": 4,
            "a": {
                "k": None,
                "b": 2,
                "a": 1,
            },
            "list": [{"b": 2, "a": 1, "x": None}],
        }
        canonical = canonicalize_value(payload)
        self.assertEqual(list(canonical.keys()), ["a", "list", "z"])
        self.assertEqual(canonical["a"], {"a": 1, "b": 2})
        self.assertEqual(canonical["list"], [{"a": 1, "b": 2}])

    def test_record_attachment_payload_is_deterministic(self) -> None:
        now = "2026-05-23T20:00:00Z"
        left = {
            "id": "item-1",
            "lineageId": "item-1",
            "versionNumber": 1,
            "type": "article",
            "status": "draft",
            "title": "Hello",
            "metadata": {"z": 1, "a": 2},
            "updatedAt": "2026-05-23T19:00:00Z",
            "nullable": None,
        }
        right = {
            "status": "draft",
            "metadata": {"a": 2, "z": 1},
            "versionNumber": 1,
            "id": "item-1",
            "type": "article",
            "lineageId": "item-1",
            "title": "Hello",
            "updatedAt": "2026-05-23T19:00:00Z",
            "nullable": None,
        }

        left_attachment = build_record_attachment_record(model_name="Item", record=left, now=now)
        right_attachment = build_record_attachment_record(model_name="Item", record=right, now="2026-05-23T21:00:00Z")

        self.assertEqual(left_attachment["attachment"]["id"], right_attachment["attachment"]["id"])
        self.assertEqual(left_attachment["attachment"]["sha256"], right_attachment["attachment"]["sha256"])
        self.assertEqual(canonical_json_bytes(left_attachment["payload"]), canonical_json_bytes(right_attachment["payload"]))

    def test_resolve_rehydration_models_validates_input(self) -> None:
        models = resolve_rehydration_models({"models": "Item,Edition"})
        self.assertEqual(models, ["Item", "Edition"])
        with self.assertRaises(ValueError):
            resolve_rehydration_models({"models": "Nope"})

    def test_owner_from_record_key(self) -> None:
        owner_kind, owner_id = owner_from_record_key("newsroom/payloads/item/item-1/record/record.json")
        self.assertEqual(owner_kind, "item")
        self.assertEqual(owner_id, "item-1")
        self.assertEqual(owner_from_record_key("newsroom/payloads/item/item-1/metadata/metadata.json"), (None, None))

    def test_inline_candidate_summary(self) -> None:
        rows = {
            "Message": [{"id": "m1", "content": "hello", "metadata": {"a": 1}}],
            "Item": [{"id": "i1", "body": ["one", "two"]}],
        }
        candidates = compute_inline_field_candidates(rows)
        keys = {(entry["modelName"], entry["field"]) for entry in candidates}
        self.assertIn(("Message", "content"), keys)
        self.assertIn(("Message", "metadata"), keys)
        self.assertIn(("Item", "body"), keys)


if __name__ == "__main__":
    unittest.main()
