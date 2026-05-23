from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .ids import hash_short
from .source_readiness import ExtractionIndex, select_extracted_text_attachment


def build_extracted_text_attachment_plans(
    *,
    corpus_config: dict[str, Any],
    corpus_id: str,
    references: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    extraction_index: ExtractionIndex,
) -> list[dict[str, Any]]:
    now = _utc_now()
    plans: list[dict[str, Any]] = []
    seen_lineages: set[str] = set()
    current_references = sorted(
        [
            reference
            for reference in references
            if reference.get("corpusId") == corpus_id
            and reference.get("versionState") == "current"
            and reference.get("externalItemId")
            and reference["externalItemId"] in extraction_index.item_ids
        ],
        key=_compare_reference_versions_by_freshness,
        reverse=True,
    )
    for reference in current_references:
        lineage_id = reference.get("lineageId")
        if not lineage_id or lineage_id in seen_lineages:
            continue
        seen_lineages.add(lineage_id)
        extracted = extraction_index.text_by_item_id.get(reference["externalItemId"])
        if not extracted or not extracted.get("storagePath"):
            continue
        storage_path = extracted["storagePath"]
        existing = select_extracted_text_attachment(reference, attachments)
        local_path = Path(extracted["localPath"])
        try:
            body = local_path.read_bytes()
        except OSError:
            continue
        byte_size = len(body)
        sha256 = hashlib.sha256(body).hexdigest()
        key = f"{lineage_id}\nextracted_text"
        record = {
            "modelName": "ReferenceAttachment",
            "expected": {
                "id": existing.get("id") if existing else f"reference-attachment-{hash_short(key)}",
                "referenceId": reference["id"],
                "referenceLineageId": lineage_id,
                "referenceVersionNumber": reference.get("versionNumber"),
                "referenceVersionKey": f"reference#{reference['id']}",
                "role": "extracted_text",
                "sortKey": "900-extracted-text",
                "storagePath": storage_path,
                "sourceUri": None,
                "filename": local_path.name,
                "mediaType": "text/plain",
                "byteSize": byte_size,
                "sha256": sha256,
                "etag": None,
                "importRunId": None,
                "importedAt": now,
                "metadata": json.dumps(
                    {
                        "source": "biblicus-extraction-snapshot",
                        "extractorId": extracted.get("extractorId") or "pipeline",
                        "snapshotId": extracted.get("snapshotId"),
                        "extractionSnapshotId": extracted.get("snapshotId"),
                        "snapshotLocalPath": str(local_path),
                    }
                ),
            },
        }
        plans.append(
            {
                "reference": reference,
                "extracted": extracted,
                "storagePath": storage_path,
                "byteSize": byte_size,
                "sha256": sha256,
                "record": record,
            }
        )
    return plans


def _compare_reference_versions_by_freshness(reference: dict[str, Any]) -> tuple[int, str, str]:
    return (
        int(reference.get("versionNumber") or 0),
        str(reference.get("updatedAt") or reference.get("createdAt") or ""),
        str(reference.get("id") or ""),
    )


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
