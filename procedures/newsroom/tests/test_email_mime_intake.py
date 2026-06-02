from __future__ import annotations

import unittest

from papyrus_newsroom.email_mime_intake import (
    extract_direct_citations_from_intake_text,
    extract_href_urls_from_html,
    is_skippable_newsletter_url,
    parse_inbound_mime_for_intake,
)
from papyrus_newsroom.email_submission_replies import classify_new_submission_intake


class EmailMimeIntakeTests(unittest.TestCase):
    def test_extract_href_urls_skips_unsubscribe(self):
        html = """
        <html><body>
        <a href="https://arxiv.org/abs/1706.03762">Paper</a>
        <a href="https://example.us5.list-manage.com/unsubscribe">Unsub</a>
        </body></html>
        """
        urls = extract_href_urls_from_html(html)
        self.assertEqual(urls, ["https://arxiv.org/abs/1706.03762"])
        self.assertTrue(is_skippable_newsletter_url("https://example.us5.list-manage.com/unsubscribe"))

    def test_html_only_newsletter_classifies_as_agent_intake(self):
        html = """
        <html><body>
        <p>Two papers this week.</p>
        <a href="https://arxiv.org/abs/1111.11111">First</a>
        <a href="https://arxiv.org/abs/2222.22222">Second</a>
        </body></html>
        """
        citations = extract_direct_citations_from_intake_text(
            body_text="Two papers this week.",
            html_parts=[html],
        )
        self.assertEqual(len(citations), 2)
        self.assertEqual(
            classify_new_submission_intake("Two papers this week.", citations),
            "agent_intake",
        )

    def test_parse_newsletter_fixture_mime(self):
        raw = b"\r\n".join(
            [
                b"From: tester@example.com",
                b"To: submissions@p.apyr.us",
                b"Subject: Fwd: Newsletter",
                b"MIME-Version: 1.0",
                b'Content-Type: multipart/alternative; boundary="bound"',
                b"",
                b"--bound",
                b"Content-Type: text/html; charset=utf-8",
                b"",
                b'<html><body><a href="https://arxiv.org/abs/3333.33333">Read</a></body></html>',
                b"--bound--",
                b"",
            ]
        )
        parsed = parse_inbound_mime_for_intake(raw)
        self.assertEqual(parsed["subject"], "Fwd: Newsletter")
        self.assertEqual(len(parsed["citations"]), 1)
        self.assertEqual(parsed["citations"][0]["url"], "https://arxiv.org/abs/3333.33333")


if __name__ == "__main__":
    unittest.main()
