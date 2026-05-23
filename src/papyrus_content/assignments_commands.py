from __future__ import annotations

from typing import Any

from .graphql_authoring import create_authoring_client
from .options import normalize_string, parse_options


def _assignment_section_key(assignment: dict[str, Any]) -> str | None:
    return normalize_string(assignment.get("sectionKey")) or normalize_string(assignment.get("sectionId"))


def _assignment_sort_key(assignment: dict[str, Any]) -> str:
    priority = str(assignment.get("priority") if assignment.get("priority") is not None else 999999).zfill(6)
    created_at = assignment.get("createdAt") or ""
    record_id = assignment.get("id") or ""
    return f"{priority}#{created_at}#{record_id}"


def assignments_list(flags: list[str]) -> None:
    options = parse_options(flags)
    client, _ = create_authoring_client()
    assignments = client.list_records("Assignment")
    queue = normalize_string(options.get("queue"))
    status = normalize_string(options.get("status"))
    assignment_type = normalize_string(options.get("type"))
    section = normalize_string(options.get("section"))
    if queue:
        assignments = [row for row in assignments if row.get("queueKey") == queue]
    if status:
        assignments = [row for row in assignments if row.get("status") == status]
    if assignment_type:
        assignments = [row for row in assignments if row.get("assignmentTypeKey") == assignment_type]
    if section:
        assignments = [row for row in assignments if _assignment_section_key(row) == section]
    assignments.sort(key=_assignment_sort_key)
    for assignment in assignments:
        section_key = _assignment_section_key(assignment) or ""
        print(
            f"{assignment.get('status')}\t{assignment.get('id')}\t{assignment.get('assignmentTypeKey')}\t"
            f"{assignment.get('queueKey')}\tsection={section_key}\t{assignment.get('title')}"
        )
