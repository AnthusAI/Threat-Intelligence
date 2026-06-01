from __future__ import annotations

import unittest

from papyrus_newsroom import email_pdf_intake


class EmailPdfIntakeTests(unittest.TestCase):
    def test_extract_doi_from_pdf_bytes(self):
        payload = b"%PDF-1.4\nSome header 10.1038/nature12373 trailing"
        identifiers = email_pdf_intake.extract_pdf_intake_identifiers(payload, grobid_url="")
        self.assertEqual(identifiers.get("doi"), "10.1038/nature12373")
        self.assertEqual(
            email_pdf_intake.external_item_id_for_identifiers(identifiers),
            "doi:10.1038/nature12373",
        )
        self.assertEqual(
            email_pdf_intake.citation_url_for_identifiers(identifiers),
            "https://doi.org/10.1038/nature12373",
        )

    def test_extract_arxiv_from_pdf_bytes(self):
        payload = b"%PDF https://arxiv.org/pdf/1706.03762.pdf"
        identifiers = email_pdf_intake.extract_pdf_intake_identifiers(payload, grobid_url="")
        self.assertEqual(identifiers.get("arxiv_id"), "1706.03762")


if __name__ == "__main__":
    unittest.main()
