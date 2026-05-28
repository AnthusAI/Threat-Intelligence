from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from behave import given, then, when


@dataclass
class AssignmentError(Exception):
    code: str
    message: str


class AssignmentStore:
    def __init__(self) -> None:
        self._items: dict[str, dict[str, Any]] = {}

    def create(self, *, title: str, assignment_type: str) -> dict[str, Any]:
        next_id = f"assignment-{len(self._items) + 1:03d}"
        record = {
            "id": next_id,
            "assignmentTypeKey": assignment_type,
            "title": title,
            "status": "open",
        }
        self._items[next_id] = record
        return dict(record)

    def seed(self, records: list[dict[str, Any]]) -> None:
        for record in records:
            self._items[record["id"]] = dict(record)

    def get(self, assignment_id: str) -> dict[str, Any]:
        if assignment_id not in self._items:
            raise AssignmentError(code="not_found", message=f"Assignment {assignment_id} not found")
        return dict(self._items[assignment_id])

    def update_status(self, assignment_id: str, status: str) -> dict[str, Any]:
        record = self.get(assignment_id)
        record["status"] = status
        self._items[assignment_id] = record
        return dict(record)

    def list(
        self,
        *,
        status: str | None = None,
        assignment_type: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        rows = list(self._items.values())
        rows.sort(key=lambda item: item["id"])
        if status:
            rows = [item for item in rows if item.get("status") == status]
        if assignment_type:
            rows = [item for item in rows if item.get("assignmentTypeKey") == assignment_type]
        rows = rows[offset:]
        if limit is not None:
            rows = rows[:limit]
        return [dict(item) for item in rows]


@given("an empty assignment resource")
def step_empty_resource(context):
    context.assignment_store = AssignmentStore()
    context.assignment_response = None
    context.assignment_error = None


@given("the assignment resource has seeded assignments")
def step_seed_assignments(context):
    context.assignment_store.seed(
        [
            {"id": "assignment-001", "assignmentTypeKey": "research", "title": "A", "status": "open"},
            {"id": "assignment-002", "assignmentTypeKey": "research", "title": "B", "status": "claimed"},
            {"id": "assignment-003", "assignmentTypeKey": "copywriting", "title": "C", "status": "open"},
            {"id": "assignment-004", "assignmentTypeKey": "research", "title": "D", "status": "open"},
        ]
    )


@when('I create a research assignment titled "{title}"')
def step_create_assignment(context, title):
    context.assignment_response = context.assignment_store.create(title=title, assignment_type="research")
    context.assignment_error = None


@then('the assignment is created with status "{status}"')
def step_created_with_status(context, status):
    assert context.assignment_response is not None
    assert context.assignment_response["status"] == status


@then("fetching the assignment by id returns the same title")
def step_fetch_same_title(context):
    created = context.assignment_response
    fetched = context.assignment_store.get(created["id"])
    assert fetched["title"] == created["title"]


@when('I list assignments with status "{status}"')
def step_list_with_status(context, status):
    context.assignment_response = context.assignment_store.list(status=status)


@then('I receive only assignments with status "{status}"')
def step_only_status(context, status):
    rows = context.assignment_response or []
    assert rows
    assert all(row.get("status") == status for row in rows)


@when('I list assignments with type "{assignment_type}" and limit {limit:d} offset {offset:d}')
def step_list_with_type_limit_offset(context, assignment_type, limit, offset):
    context.assignment_response = context.assignment_store.list(
        assignment_type=assignment_type,
        limit=limit,
        offset=offset,
    )


@then('I receive {expected_count:d} assignments in deterministic order')
def step_receive_count(context, expected_count):
    rows = context.assignment_response or []
    assert len(rows) == expected_count
    assert [row["id"] for row in rows] == sorted(row["id"] for row in rows)


@when('I update assignment "{assignment_id}" status to "{status}"')
def step_update_status(context, assignment_id, status):
    context.assignment_error = None
    try:
        context.assignment_response = context.assignment_store.update_status(assignment_id, status)
    except AssignmentError as error:
        context.assignment_response = None
        context.assignment_error = {"code": error.code, "message": error.message}


@then('assignment "{assignment_id}" has status "{status}"')
def step_assert_status(context, assignment_id, status):
    assignment = context.assignment_store.get(assignment_id)
    assert assignment["status"] == status


@then('I receive an error with code "{code}"')
def step_assert_error_code(context, code):
    assert context.assignment_error is not None
    assert context.assignment_error.get("code") == code
