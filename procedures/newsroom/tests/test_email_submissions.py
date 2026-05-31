from __future__ import annotations

import unittest
from unittest import mock

from papyrus_newsroom import email_submissions


class EmailSubmissionTests(unittest.TestCase):
    def test_extract_direct_citations_finds_urls_and_dois(self):
        text = (
            "Please add https://example.com/paper-one and doi 10.1234/example.5678 "
            "to the knowledge base."
        )
        citations = email_submissions.extract_direct_citations(text)
        urls = {entry["url"] for entry in citations}
        self.assertIn("https://example.com/paper-one", urls)
        self.assertIn("https://doi.org/10.1234/example.5678", urls)

    def test_rejects_research_assignment_without_citations(self):
        text = "Can you do a research assignment to find sources on transformer scaling laws?"
        self.assertTrue(email_submissions.looks_like_research_assignment_request(text, citation_count=0))
        self.assertFalse(email_submissions.looks_like_research_assignment_request(text, citation_count=1))

    def test_normalize_email_address_extracts_angle_addr(self):
        self.assertEqual(
            email_submissions.normalize_email_address("Editor <editor@example.com>"),
            "editor@example.com",
        )

    def test_should_process_inbound_s3_key_filters_setup_and_archive(self):
        self.assertTrue(
            email_submissions.should_process_inbound_s3_key(
                "inbound-email/fefi1oj53eir1crt5gl02aep0fh41c9kc0c8ld01",
            ),
        )
        self.assertFalse(email_submissions.should_process_inbound_s3_key("inbound-email/AMAZON_SES_SETUP_NOTIFICATION"))
        self.assertFalse(
            email_submissions.should_process_inbound_s3_key(
                "inbound-email-archived/fefi1oj53eir1crt5gl02aep0fh41c9kc0c8ld01",
            ),
        )
        self.assertFalse(email_submissions.should_process_inbound_s3_key("inbound-email/processed/example"))

    def test_inbound_message_id_for_s3_is_stable(self):
        message_id = email_submissions.inbound_message_id_for_s3(
            "media-bucket",
            "inbound-email/example",
        )
        self.assertTrue(message_id.startswith("message-email-submission-"))
        self.assertEqual(
            message_id,
            email_submissions.inbound_message_id_for_s3("media-bucket", "inbound-email/example"),
        )

    def test_message_response_index_fields_includes_gsi_sort_keys(self):
        fields = email_submissions._message_response_index_fields(
            {
                "createdAt": "2026-05-31T10:00:00.000Z",
                "responseTarget": "email_submission_processor",
            },
        )
        self.assertEqual(fields["createdAt"], "2026-05-31T10:00:00.000Z")
        self.assertEqual(fields["responseTarget"], "email_submission_processor")

    def test_archive_inbound_mime_object_copies_then_deletes(self):
        s3 = mock.Mock()
        key = "inbound-email/ses-object-id"
        result = email_submissions.archive_inbound_mime_object(
            bucket="media-bucket",
            key=key,
            s3_client=s3,
        )
        self.assertTrue(result["archived"])
        self.assertEqual(result["archiveKey"], "inbound-email-archived/ses-object-id")
        s3.copy_object.assert_called_once_with(
            Bucket="media-bucket",
            Key="inbound-email-archived/ses-object-id",
            CopySource={"Bucket": "media-bucket", "Key": key},
        )
        s3.delete_object.assert_called_once_with(Bucket="media-bucket", Key=key)

    def test_archive_inbound_mime_object_skips_ineligible_keys(self):
        s3 = mock.Mock()
        result = email_submissions.archive_inbound_mime_object(
            bucket="media-bucket",
            key="inbound-email/AMAZON_SES_SETUP_NOTIFICATION",
            s3_client=s3,
        )
        self.assertFalse(result["archived"])
        s3.copy_object.assert_not_called()


if __name__ == "__main__":
    unittest.main()
