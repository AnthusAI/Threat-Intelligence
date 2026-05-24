from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


CONSOLE_THREAD_ANCHOR_KEY = "site#papyrus"
CONSOLE_NEWSROOM_FEED_KEY = "consoleChat"
CONSOLE_MESSAGE_KIND = "console_chat_turn"
CONSOLE_MESSAGE_DOMAIN = "conversation"
MESSAGE_FIELD_CANDIDATES = [
    "id",
    "threadId",
    "parentMessageId",
    "sequenceNumber",
    "role",
    "messageKind",
    "messageType",
    "content",
    "summary",
    "responseStatus",
    "responseOwner",
    "responseStartedAt",
    "responseCompletedAt",
    "responseError",
    "messageDomain",
    "source",
    "importRunId",
    "authorLabel",
    "newsroomFeedKey",
    "metadata",
    "body",
    "createdAt",
    "updatedAt",
]
SCHEMA_INTROSPECTION = """
query ConsoleAgentSmokeSchema {
  queryType: __type(name: "Query") { fields { name } }
  messageType: __type(name: "Message") { fields { name } }
  createMessageInputType: __type(name: "CreateMessageInput") { inputFields { name } }
}
"""


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", trimmed)
        if not match:
            continue
        key, value = match.group(1), match.group(2).strip()
        if key in os.environ:
            continue
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        os.environ[key] = value


def _endpoint_from_outputs(repo_root: Path) -> str:
    outputs_path = repo_root / "amplify_outputs.json"
    if not outputs_path.exists():
        return ""
    payload = json.loads(outputs_path.read_text(encoding="utf-8"))
    return payload.get("data", {}).get("url") or payload.get("data", {}).get("aws_appsync_graphqlEndpoint") or ""


def _required_env(name: str, fallback: str = "") -> str:
    value = os.environ.get(name) or fallback
    if not value:
        raise RuntimeError(f"Missing {name}. Set it in the environment or .env.")
    return value


def _message_content(message: dict[str, Any]) -> str:
    content = message.get("content")
    if content:
        return str(content)
    body = message.get("body")
    if body:
        return str(body)
    try:
        return str(json.loads(message.get("metadata") or "{}").get("content") or "")
    except Exception:
        return ""


def _message_role(message: dict[str, Any]) -> str:
    role = message.get("role")
    if role:
        return str(role)
    try:
        return str(json.loads(message.get("metadata") or "{}").get("role") or "")
    except Exception:
        return ""


def _collect_created_assignment_ids(value: Any, assignment_ids: set[str], event_ids: set[str]) -> None:
    if not isinstance(value, dict):
        return
    assignment_id = value.get("assignmentId") or value.get("assignment", {}).get("id")
    event_id = value.get("event", {}).get("id")
    if assignment_id:
        assignment_ids.add(str(assignment_id))
    if event_id:
        event_ids.add(str(event_id))
    for nested in value.values():
        if isinstance(nested, dict):
            _collect_created_assignment_ids(nested, assignment_ids, event_ids)


def scenario_prompt(name: str, run_id: str) -> str:
    if name == "hello":
        return "Say hello in one short sentence."
    if name == "docs-progressive":
        return "\n".join(
            [
                "Use execute_tactus to inspect Papyrus docs progressively.",
                "This is a strict live integration test: if you answer without tool calls, the test fails.",
                "Do not answer from memory or prior context; call tools first.",
                "First call exactly: docs_list{ namespace = \"resources\" }.",
                "Then call exactly: docs_get{ id = \"resources.Assignment\" }.",
                "Only after both tool calls succeed, reply with one sentence describing the Assignment resource.",
            ]
        )
    if name == "create-research-assignment":
        return "\n".join(
            [
                "Use execute_tactus to create exactly one research Assignment. Do not answer until the Assignment.create tool call has succeeded.",
                "This is a live integration test: a natural-language response without an execute_tactus tool call is a failure.",
                "If you inspect docs first, continue immediately afterward and perform the write.",
                "The required Tactus snippet is:",
                (
                    f"return Assignment.create{{ type = \"research\", title = \"Live smoke research assignment {run_id}\", "
                    f"summary = \"Smoke-test assignment created by the console agent.\", sectionKey = \"technology\", "
                    f"researchMode = \"source_discovery\", importRunId = \"{run_id}\", apply = true }}"
                ),
                "After the tool result succeeds, reply with only the created assignment id.",
            ]
        )
    raise RuntimeError(f"Unknown scenario: {name}")


@dataclass
class GraphqlClient:
    endpoint: str
    jwt: str
    schema_cache: dict[str, set[str]] | None = None

    @classmethod
    def from_env(cls, repo_root: Path) -> "GraphqlClient":
        _load_env_file(repo_root / ".env.local")
        _load_env_file(repo_root / ".env")
        endpoint = _required_env("PAPYRUS_GRAPHQL_ENDPOINT", _endpoint_from_outputs(repo_root))
        jwt = _required_env("PAPYRUS_GRAPHQL_JWT")
        return cls(endpoint=endpoint, jwt=re.sub(r"^Bearer\s+", "", jwt.strip(), flags=re.IGNORECASE))

    def graphql(self, query: str, variables: dict[str, Any] | None = None, field: str | None = None) -> Any:
        response = requests.post(
            self.endpoint,
            headers={"content-type": "application/json", "authorization": f"PapyrusJwt {self.jwt}"},
            json={"query": query, "variables": variables or {}},
            timeout=60,
        )
        payload: dict[str, Any] = {}
        try:
            payload = response.json()
        except Exception:
            payload = {}
        if response.status_code >= 400 or payload.get("errors"):
            raise RuntimeError(
                f"GraphQL {field or 'request'} failed: {response.status_code} {response.reason} {json.dumps(payload)}"
            )
        data = payload.get("data") or {}
        return data.get(field) if field else data

    def schema(self) -> dict[str, set[str]]:
        if self.schema_cache is not None:
            return self.schema_cache
        data = self.graphql(SCHEMA_INTROSPECTION)
        self.schema_cache = {
            "queryFields": {entry["name"] for entry in data.get("queryType", {}).get("fields", []) if entry.get("name")},
            "messageFields": {entry["name"] for entry in data.get("messageType", {}).get("fields", []) if entry.get("name")},
            "createMessageInputFields": {
                entry["name"] for entry in data.get("createMessageInputType", {}).get("inputFields", []) if entry.get("name")
            },
        }
        return self.schema_cache

    def choose_message_selection(self) -> str:
        fields = self.schema()["messageFields"]
        selected = [field for field in MESSAGE_FIELD_CANDIDATES if field in fields]
        if "id" not in selected:
            selected.insert(0, "id")
        if "createdAt" in fields and "createdAt" not in selected:
            selected.append("createdAt")
        return "\n          ".join(selected)

    def sanitize_input(self, payload: dict[str, Any]) -> dict[str, Any]:
        allowed = self.schema()["createMessageInputFields"]
        return {key: value for key, value in payload.items() if key in allowed and value is not None}


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _list_messages(client: GraphqlClient, thread_id: str) -> list[dict[str, Any]]:
    schema = client.schema()
    selection = client.choose_message_selection()
    attempts: list[dict[str, Any]] = []
    if "listMessagesByThreadAndSequence" in schema["queryFields"]:
        attempts.append(
            {
                "field": "listMessagesByThreadAndSequence",
                "args": "threadId: $threadId, limit: $limit, nextToken: $nextToken",
                "vars": "($threadId: ID!, $limit: Int, $nextToken: String)",
                "variables": {"threadId": thread_id, "limit": 500},
                "scoped": True,
            }
        )
    if "listMessagesByThreadAndCreatedAt" in schema["queryFields"]:
        attempts.append(
            {
                "field": "listMessagesByThreadAndCreatedAt",
                "args": "threadId: $threadId, limit: $limit, nextToken: $nextToken",
                "vars": "($threadId: ID!, $limit: Int, $nextToken: String)",
                "variables": {"threadId": thread_id, "limit": 500},
                "scoped": True,
            }
        )
    if "listMessagesByNewsroomFeedAndCreatedAt" in schema["queryFields"]:
        attempts.append(
            {
                "field": "listMessagesByNewsroomFeedAndCreatedAt",
                "args": "newsroomFeedKey: $newsroomFeedKey, limit: $limit, nextToken: $nextToken",
                "vars": "($newsroomFeedKey: String!, $limit: Int, $nextToken: String)",
                "variables": {"newsroomFeedKey": CONSOLE_NEWSROOM_FEED_KEY, "limit": 500},
            }
        )
    if "listMessages" in schema["queryFields"]:
        attempts.append(
            {
                "field": "listMessages",
                "args": "limit: $limit, nextToken: $nextToken",
                "vars": "($limit: Int, $nextToken: String)",
                "variables": {"limit": 500},
            }
        )

    for attempt in attempts:
        query = f"""
        query ListMessages{attempt["vars"]} {{
          {attempt["field"]}({attempt["args"]}) {{
            items {{ {selection} }}
            nextToken
          }}
        }}
        """
        items: list[dict[str, Any]] = []
        next_token: str | None = None
        while True:
            variables = dict(attempt["variables"])
            variables["nextToken"] = next_token
            connection = client.graphql(query, variables, attempt["field"]) or {}
            items.extend([entry for entry in (connection.get("items") or []) if entry])
            next_token = connection.get("nextToken")
            if not next_token:
                break
        if not attempt.get("scoped"):
            scoped_items: list[dict[str, Any]] = []
            for item in items:
                if item.get("threadId") == thread_id:
                    scoped_items.append(item)
                    continue
                try:
                    if json.loads(item.get("metadata") or "{}").get("threadId") == thread_id:
                        scoped_items.append(item)
                except Exception:
                    pass
            items = scoped_items
        return sorted(
            items,
            key=lambda item: (
                int(item.get("sequenceNumber") or 0),
                str(item.get("createdAt") or ""),
            ),
        )
    raise RuntimeError("No listMessages query is available in the GraphQL schema.")


def _delete_record(client: GraphqlClient, model: str, record_id: str | None) -> None:
    if not record_id:
        return
    mutation = f"""
    mutation Delete{model}($input: Delete{model}Input!) {{
      delete{model}(input: $input) {{ id }}
    }}
    """
    try:
        client.graphql(mutation, {"input": {"id": record_id}}, f"delete{model}")
    except Exception:
        pass


def run_scenario(
    scenario_name: str,
    *,
    repo_root: Path,
    keep: bool = False,
    timeout_ms: int = 120_000,
    run_id: str | None = None,
) -> dict[str, Any]:
    client = GraphqlClient.from_env(repo_root)
    run_id = run_id or f"agent-smoke-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
    assignment_ids: set[str] = set()
    assignment_event_ids: set[str] = set()
    thread_id = f"thread-console-smoke-{run_id}"
    thread_record: dict[str, Any] | None = None
    try:
        now = _now_iso()
        thread_input = {
            "id": thread_id,
            "threadKind": "console",
            "status": "active",
            "title": f"Agent smoke {run_id}",
            "summary": "Live console agent smoke test",
            "primaryAnchorKind": "site",
            "primaryAnchorId": "papyrus",
            "primaryAnchorLineageId": "papyrus",
            "primaryAnchorKey": CONSOLE_THREAD_ANCHOR_KEY,
            "createdByLabel": "agent-smoke",
            "messageCount": 0,
            "metadata": json.dumps({"smokeRunId": run_id}),
            "createdAt": now,
            "updatedAt": now,
            "newsroomFeedKey": CONSOLE_NEWSROOM_FEED_KEY,
        }
        client.graphql(
            """
            mutation CreateThread($input: CreateMessageThreadInput!) {
              createMessageThread(input: $input) { id createdAt updatedAt }
            }
            """,
            {"input": thread_input},
            "createMessageThread",
        )
        thread_record = thread_input
        prompt = scenario_prompt(scenario_name, run_id)
        message_input = {
            "id": f"message-console-user-smoke-{uuid.uuid4()}",
            "threadId": thread_id,
            "parentMessageId": None,
            "sequenceNumber": 1,
            "role": "USER",
            "messageKind": CONSOLE_MESSAGE_KIND,
            "messageDomain": CONSOLE_MESSAGE_DOMAIN,
            "messageType": "MESSAGE",
            "content": prompt,
            "body": prompt,
            "status": "active",
            "summary": prompt[:180],
            "source": "console",
            "authorLabel": "Agent Smoke",
            "semanticLayer": "working_memory",
            "searchVisibility": "private",
            "responseTarget": "cloud",
            "responseStatus": "PENDING",
            "metadata": json.dumps(
                {"threadId": thread_id, "sequenceNumber": 1, "role": "USER", "smokeRunId": run_id}
            ),
            "createdAt": now,
            "updatedAt": now,
            "newsroomFeedKey": CONSOLE_NEWSROOM_FEED_KEY,
        }
        selection = client.choose_message_selection()
        client.graphql(
            f"""
            mutation CreateMessage($input: CreateMessageInput!) {{
              createMessage(input: $input) {{
                {selection}
              }}
            }}
            """,
            {"input": client.sanitize_input(message_input)},
            "createMessage",
        )

        deadline = time.time() + (timeout_ms / 1000)
        assistant: dict[str, Any] | None = None
        messages: list[dict[str, Any]] = []
        while time.time() < deadline:
            messages = _list_messages(client, thread_id)
            assistants = sorted(
                [
                    msg
                    for msg in messages
                    if _message_role(msg) == "ASSISTANT" or "assistant" in str(msg.get("id", "")).lower()
                ],
                key=lambda msg: str(msg.get("createdAt") or ""),
            )
            assistant = assistants[-1] if assistants else None
            if assistant and assistant.get("responseStatus") == "FAILED":
                raise RuntimeError(f"Assistant failed: {assistant.get('responseError') or _message_content(assistant)}")
            if assistant and assistant.get("responseStatus") == "COMPLETED" and _message_content(assistant).strip():
                break
            time.sleep(2.5)
        if not assistant:
            raise RuntimeError(f"Timed out waiting for assistant. Last messages: {json.dumps(messages)}")

        api_calls: list[str] = []
        for message in messages:
            if message.get("messageKind") != "console_tool_result":
                continue
            try:
                parsed = json.loads(_message_content(message))
            except Exception:
                continue
            for call in parsed.get("api_calls") or []:
                api_calls.append(str(call))
            value = parsed.get("value")
            if isinstance(value, dict):
                for call in value.get("api_calls") or []:
                    api_calls.append(str(call))
            _collect_created_assignment_ids(parsed, assignment_ids, assignment_event_ids)

        content = _message_content(assistant).strip()
        if not content:
            raise RuntimeError("Assistant response is empty.")
        if scenario_name == "docs-progressive":
            required = {"papyrus.docs.list", "papyrus.docs.get"}
            if not required.issubset(set(api_calls)):
                raise RuntimeError(
                    f"Expected docs_list and docs_get tool calls. Saw: {', '.join(api_calls)}. Assistant said: {content}"
                )
        if scenario_name == "create-research-assignment":
            if "papyrus.Assignment.create" not in api_calls:
                raise RuntimeError(
                    f"Expected Assignment.create tool call. Saw: {', '.join(api_calls)}. Assistant said: {content}"
                )
            if len(assignment_ids) != 1:
                raise RuntimeError(
                    f"Expected exactly one created Assignment, found {len(assignment_ids)}. Assistant said: {content}"
                )

        return {
            "ok": True,
            "scenario": scenario_name,
            "runId": run_id,
            "assistantMessageId": assistant.get("id"),
            "assignmentIds": sorted(assignment_ids),
            "apiCalls": api_calls,
            "content": content,
        }
    finally:
        if not keep:
            for event_id in assignment_event_ids:
                _delete_record(client, "AssignmentEvent", event_id)
            for assignment_id in assignment_ids:
                _delete_record(client, "Assignment", assignment_id)
            if thread_record is not None:
                try:
                    messages = _list_messages(client, thread_id)
                except Exception:
                    messages = []
                for message in messages:
                    _delete_record(client, "Message", str(message.get("id") or ""))
                _delete_record(client, "MessageThread", thread_id)
