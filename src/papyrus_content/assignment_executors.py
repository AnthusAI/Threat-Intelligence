from __future__ import annotations

from typing import Any

from .accession import execute_reference_accession_assignment
from .content_cli_bridge import call_content_cli_export
from .graphql_authoring import PapyrusGraphQLAuthoringClient
from .reference_assignments import execute_reference_text_extraction_assignment


def execute_assignment_by_type(
    client: PapyrusGraphQLAuthoringClient,
    assignment_id: str,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    assignment = client.get_record("Assignment", assignment_id)
    if not assignment:
        raise ValueError(f"Assignment {assignment_id} was not found.")
    assignment_type = assignment.get("assignmentTypeKey")
    merged_options = dict(options or {})
    if assignment_type == "analysis.reindex":
        return call_content_cli_export(
            "executeAssignmentByTypeCli",
            {"assignmentId": assignment_id, "options": merged_options},
        )
    if assignment_type == "reference.corpus-accession":
        return execute_reference_accession_assignment(client, assignment, merged_options)
    if assignment_type == "reference.text-extraction":
        return execute_reference_text_extraction_assignment(client, assignment, merged_options)
    if assignment_type in {"reference.identifier-backfill", "reference.doi-backfill"}:
        return call_content_cli_export(
            "executeAssignmentByTypeCli",
            {"assignmentId": assignment_id, "options": merged_options},
        )
    raise ValueError(f"No executor is registered for assignment type {assignment_type}.")
