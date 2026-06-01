from __future__ import annotations

import unittest
from unittest import mock

from papyrus_newsroom import email_submission_feedback


class EmailSubmissionFeedbackTests(unittest.TestCase):
    def test_build_reference_feedback_entries_includes_plugin_and_pdf(self):
        references = [
            {
                "id": "ref-1",
                "lineageId": "lineage-1",
                "title": "Attention Is All You Need",
                "sourceUri": "https://arxiv.org/abs/1706.03762",
            }
        ]
        attachments = [
            {
                "id": "att-source",
                "referenceLineageId": "lineage-1",
                "role": "source",
                "filename": "paper.pdf",
                "mediaType": "application/pdf",
                "storagePath": "corpora/AI-ML-research/refs/paper.pdf",
                "metadata": '{"sourcePlugin":"arxiv"}',
            },
            {
                "id": "att-text",
                "referenceLineageId": "lineage-1",
                "role": "extracted_text",
                "filename": "paper.txt",
                "mediaType": "text/plain",
                "storagePath": "corpora/AI-ML-research/refs/paper.txt",
            },
        ]
        entries = email_submission_feedback.build_reference_feedback_entries(
            references=references,
            attachments=attachments,
            find_result={"items": [{"reference": {"id": "ref-1"}, "status": "planned"}]},
            process_result={
                "items": [
                    {
                        "reference": {"id": "ref-1"},
                        "status": "generated",
                        "title": "Attention Is All You Need",
                        "subtitle": "Transformer architecture",
                        "summary": "Introduces the Transformer.",
                    }
                ]
            },
        )
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry["sourcePlugin"], "arxiv")
        self.assertTrue(entry["pdfLocated"])
        self.assertEqual(entry["subtitle"], "Transformer architecture")
        self.assertEqual(entry["summarizeStatus"], "generated")
        self.assertEqual(len(entry["attachments"]), 2)

    def test_format_submission_feedback_email_completed(self):
        report = {
            "messageId": "message-email-submission-abc",
            "subject": "New paper",
            "responseStatus": "COMPLETED",
            "registeredReferenceCount": 1,
            "pipeline": {
                "find": {"eligible": 1, "planned": 1, "changes": 1, "failures": 0},
                "process": {"attempted": 1, "generated": 1},
            },
            "references": [
                {
                    "title": "Example",
                    "subtitle": "Sub",
                    "summary": "Sum",
                    "sourceUri": "https://example.com",
                    "sourcePlugin": "default",
                    "findStatus": "planned",
                    "summarizeStatus": "generated",
                    "pdfConfirmationRequired": False,
                    "attachments": [{"role": "source", "filename": "x.pdf"}],
                }
            ],
        }
        subject, body = email_submission_feedback.format_submission_feedback_email(report)
        self.assertIn("processed", subject)
        self.assertIn("Example", body)
        self.assertIn("Fetch plugin: default", body)

    def test_maybe_send_skips_when_already_sent(self):
        client = mock.Mock()
        client.get_record.return_value = {
            "id": "message-1",
            "metadata": '{"feedbackEmailSentAt":"2026-01-01T00:00:00.000Z"}',
        }
        result = email_submission_feedback.maybe_send_submission_feedback_email(
            client,
            message_id="message-1",
        )
        self.assertFalse(result["sent"])
        self.assertEqual(result["reason"], "already-sent")
        client.graphql.assert_not_called()

    def test_maybe_send_records_metadata_on_success(self):
        client = mock.Mock()
        client.get_record.return_value = {
            "id": "message-1",
            "summary": "Paper link",
            "responseStatus": "COMPLETED",
            "metadata": '{"senderEmail":"editor@example.com","authorized":true}',
        }
        ses = mock.Mock()
        ses.send_email.return_value = {"MessageId": "ses-123"}
        with mock.patch.dict(
            "os.environ",
            {
                "PAPYRUS_INBOUND_FEEDBACK_EMAIL_ENABLED": "true",
                "PAPYRUS_INBOUND_FEEDBACK_FROM_EMAIL": "submissions@p.apyr.us",
            },
            clear=False,
        ):
            result = email_submission_feedback.maybe_send_submission_feedback_email(
                client,
                message_id="message-1",
                processing_result={"registeredReferenceCount": 0},
                ses_client=ses,
            )
        self.assertTrue(result["sent"])
        ses.send_email.assert_called_once()
        client.graphql.assert_called_once()


if __name__ == "__main__":
    unittest.main()
