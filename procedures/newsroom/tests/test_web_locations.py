import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_newsroom import tactus_runtime
from papyrus_web.locations import build_web_ui_context, papyrus_uri_to_web_path, web_path_to_papyrus_location


class WebLocationTests(unittest.TestCase):
    def test_web_path_maps_newsroom_tabs_and_object_details(self):
        cases = [
            ("/newsroom", "papyrus://newsroom/overview"),
            ("/newsroom/references", "papyrus://newsroom/references"),
            ("/newsroom/references/reference-1", "papyrus://reference/reference-1"),
            ("/newsroom/messages/message-1", "papyrus://message/message-1"),
            ("/newsroom/assignments/assignment-1", "papyrus://assignment/assignment-1"),
            ("/newsroom/topics?category=category-1", "papyrus://category/category-1"),
            ("/newsroom/concepts?node=node-1", "papyrus://semanticNode/node-1"),
            ("/newsroom/assignments?view=budget", "papyrus://newsroom/assignments/budget"),
            ("/newsroom/administration/users", "papyrus://newsroom/administration/users"),
        ]
        for web_path, expected_uri in cases:
            with self.subTest(web_path=web_path):
                location = web_path_to_papyrus_location(web_path)
                self.assertEqual(location["papyrusLocationUri"], expected_uri)

    def test_papyrus_uri_maps_back_to_web_paths(self):
        cases = [
            ("papyrus://newsroom/overview", "/newsroom"),
            ("papyrus://newsroom/references", "/newsroom/references"),
            ("papyrus://reference/reference-1", "/newsroom/references/reference-1"),
            ("papyrus://category/category-1", "/newsroom/topics?category=category-1"),
            ("papyrus://semanticNode/node-1", "/newsroom/concepts?node=node-1"),
            ("papyrus://newsroom/assignments/budget", "/newsroom/assignments?view=budget"),
        ]
        for uri, expected_path in cases:
            with self.subTest(uri=uri):
                mapped = papyrus_uri_to_web_path(uri)
                self.assertEqual(mapped["webPath"], expected_path)

    def test_build_web_ui_context_includes_focused_object_uri(self):
        context = build_web_ui_context("/newsroom/references/reference-1")
        self.assertEqual(context["papyrusLocationUri"], "papyrus://reference/reference-1")
        self.assertEqual(context["papyrusObjectUri"], "papyrus://reference/reference-1")
        self.assertEqual(context["webPath"], "/newsroom/references/reference-1")

    def test_execute_tactus_web_navigate_returns_navigation_intent(self):
        web_ui = build_web_ui_context("/newsroom/references")
        result = tactus_runtime.execute_tactus(
            'return papyrus.web.navigate{ uri = "papyrus://reference/reference-2" }',
            web_ui_context=web_ui,
        )
        self.assertTrue(result["ok"], result.get("error"))
        navigation = result["value"]["navigation"]
        self.assertEqual(navigation["papyrusLocationUri"], "papyrus://reference/reference-2")
        self.assertEqual(navigation["webPath"], "/newsroom/references/reference-2")
        self.assertIn("papyrus.web.navigate", result["api_calls"])

    def test_execute_tactus_web_current_location_reads_harness_snapshot(self):
        web_ui = build_web_ui_context("/newsroom/assignments/assignment-9")
        result = tactus_runtime.execute_tactus(
            "return papyrus.web.current_location{}",
            web_ui_context=web_ui,
        )
        self.assertTrue(result["ok"], result.get("error"))
        self.assertTrue(result["value"]["available"])
        self.assertEqual(
            result["value"]["location"]["papyrusLocationUri"],
            "papyrus://assignment/assignment-9",
        )


if __name__ == "__main__":
    unittest.main()
