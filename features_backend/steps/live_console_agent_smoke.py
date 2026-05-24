from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
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
CONSOLE_RESPONSE_TARGET_CLOUD = "cloud"
CONSOLE_RESPONSE_TARGET_LOCAL = "local"
LIVE_AGENT_MARKER = "behave-live-agent"
DEFAULT_AGENT_MODEL = "gpt-5-nano"
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
  assignmentType: __type(name: "Assignment") { fields { name } }
}
"""
CREATE_ASSIGNMENT_FOR_UPDATE_MUTATION = """
mutation CreateAssignmentForUpdateScenario($input: CreateAssignmentInput!) {
  createAssignment(input: $input) { id }
}
"""
_LOCAL_BINARY_CACHE: Path | None = None


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


def _collect_errors(value: Any, errors: list[dict[str, Any]]) -> None:
    if isinstance(value, dict):
        error = value.get("error")
        if isinstance(error, dict):
            errors.append(error)
        for nested in value.values():
            if isinstance(nested, dict):
                _collect_errors(nested, errors)


def _local_responder_enabled() -> bool:
    return os.environ.get("PAPYRUS_LIVE_AGENT_LOCAL_RESPONDER") == "1"


def _local_responder_binary(repo_root: Path) -> Path:
    global _LOCAL_BINARY_CACHE
    if _LOCAL_BINARY_CACHE and _LOCAL_BINARY_CACHE.exists():
        return _LOCAL_BINARY_CACHE
    manifest = repo_root / "amplify/functions/console-chat-responder/Cargo.toml"
    subprocess.run(
        ["cargo", "build", "--release", "--manifest-path", str(manifest)],
        check=True,
        cwd=repo_root,
    )
    binary = repo_root / "amplify/functions/console-chat-responder/target/release/papyrus_console_chat_responder"
    if not binary.exists():
        raise RuntimeError(f"Local console responder binary not found at {binary}")
    _LOCAL_BINARY_CACHE = binary
    return binary


def _invoke_local_responder(
    *,
    repo_root: Path,
    thread_id: str,
    message_id: str,
    content: str,
    sequence_number: int,
    created_at: str,
    metadata: dict[str, Any],
) -> None:
    payload = {
        "threadId": thread_id,
        "messageId": message_id,
        "content": content,
        "sequenceNumber": sequence_number,
        "createdAt": created_at,
        "metadata": metadata,
    }
    binary = _local_responder_binary(repo_root)
    runner_path = repo_root / "amplify/functions/console-chat-responder/py/execute_tactus_runner.py"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
        json.dump(payload, handle)
        local_input_path = handle.name
    try:
        env = os.environ.copy()
        env.setdefault("PAPYRUS_CONSOLE_MODEL", DEFAULT_AGENT_MODEL)
        env.setdefault("PAPYRUS_CONSOLE_RESPONSE_TARGET", CONSOLE_RESPONSE_TARGET_LOCAL)
        env["PAPYRUS_LOCAL_RESPONDER_INPUT_JSON"] = local_input_path
        env["PAPYRUS_EXECUTE_TACTUS_RUNNER"] = str(runner_path)
        subprocess.run(
            [str(binary)],
            check=True,
            cwd=repo_root,
            env=env,
        )
    finally:
        try:
            os.unlink(local_input_path)
        except OSError:
            pass


def scenario_prompt(name: str, run_id: str, seeded_assignment_id: str | None = None) -> str:
    marker = f"{LIVE_AGENT_MARKER}-{run_id}"
    if name == "hello":
        return "\n".join(
            [
                f"Model policy: use {DEFAULT_AGENT_MODEL}.",
                f"Marker: {marker}",
                "Say hello in one short sentence.",
            ]
        )
    if name == "docs-progressive":
        return "\n".join(
            [
                f"Model policy: use {DEFAULT_AGENT_MODEL}.",
                f"Marker: {marker}",
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
                f"Model policy: use {DEFAULT_AGENT_MODEL}.",
                f"Marker: {marker}",
                "Use execute_tactus to create exactly one research Assignment. Do not answer until the Assignment.create tool call has succeeded.",
                "This is a live integration test: a natural-language response without an execute_tactus tool call is a failure.",
                "If you inspect docs first, continue immediately afterward and perform the write.",
                "Idempotency rule: do not call Assignment.create more than once for the same importRunId marker.",
                "The required Tactus snippet is:",
                (
                    f"return Assignment.create{{ type = \"research\", title = \"{marker} create\", "
                    f"summary = \"Smoke-test assignment created by the console agent.\", sectionKey = \"technology\", "
                    f"researchMode = \"source_discovery\", importRunId = \"{marker}\", apply = true }}"
                ),
                "After the tool result succeeds, reply with only the created assignment id.",
            ]
        )
    if name == "list-research-assignments":
        return "\n".join(
            [
                f"Model policy: use {DEFAULT_AGENT_MODEL}.",
                f"Marker: {marker}",
                "Use execute_tactus for Assignment CRUD test. Do not answer until all required tool calls succeed.",
                "Do not call docs_list or docs_get.",
                "Idempotency rule: do not call Assignment.create more than once for the same importRunId marker.",
                "Execute exactly two tool calls: first create, then list.",
                "Step 1 required snippet:",
                (
                    f"return Assignment.create{{ type = 'research', title = '{marker} list', summary = 'list smoke', "
                    f"sectionKey = 'technology', researchMode = 'source_discovery', importRunId = '{marker}', apply = true }}"
                ),
                "Step 2 required snippet:",
                f"return Assignment.list{{ importRunId = '{marker}', limit = 20 }}",
                "After both tool calls succeed, reply with only the created assignment id from step 1.",
            ]
        )
    if name == "get-research-assignment":
        return "\n".join(
            [
                f"Model policy: use {DEFAULT_AGENT_MODEL}.",
                f"Marker: {marker}",
                "Use execute_tactus for Assignment CRUD test. Do not answer until all required tool calls succeed.",
                "Do not call docs_list or docs_get.",
                "Idempotency rule: do not call Assignment.create more than once for the same importRunId marker.",
                "Execute exactly two tool calls: first create, then get.",
                "Step 1 required snippet:",
                (
                    f"return Assignment.create{{ type = 'research', title = '{marker} get', summary = 'get smoke', "
                    f"sectionKey = 'technology', researchMode = 'source_discovery', importRunId = '{marker}', apply = true }}"
                ),
                "Step 2 required snippet:",
                "return Assignment.get{ id = '<assignment id from step 1>' }",
                "After both tool calls succeed, reply with only the created assignment id from step 1.",
            ]
        )
    if name == "update-research-assignment":
        if not seeded_assignment_id:
            raise RuntimeError("Update scenario requires a seeded assignment id")
        return "\n".join(
            [
                f"Model policy: use {DEFAULT_AGENT_MODEL}.",
                f"Marker: {marker}",
                "Use execute_tactus for Assignment status update test.",
                "Do not call docs_list or docs_get.",
                "Do not call Assignment.create for this scenario.",
                "Execute exactly one tool call and do not retry with alternate snippets.",
                "Required snippet:",
                f"return Assignment.update{{ id = '{seeded_assignment_id}', status = 'claimed', apply = true }}",
                "After the tool call succeeds, reply with only the assignment id.",
            ]
        )
    if name == "invalid-assignment-input":
        return "\n".join(
            [
                f"Model policy: use {DEFAULT_AGENT_MODEL}.",
                f"Marker: {marker}",
                "Use execute_tactus and intentionally call Assignment.create with invalid input.",
                "Execute exactly one tool call.",
                "Required snippet:",
                "return Assignment.create{ type = 'research', apply = true }",
                "Do not mask or paraphrase errors; return tool result as-is.",
                "After the failing tool call, reply with only `invalid-input-tested`.",
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
            "assignmentFields": {
                entry["name"] for entry in data.get("assignmentType", {}).get("fields", []) if entry.get("name")
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


def _list_assignments_for_marker(client: GraphqlClient, marker: str) -> list[str]:
    schema = client.schema()
    selection_fields = [
        field
        for field in ("id", "title", "importRunId", "createdAt")
        if field in schema.get("assignmentFields", set())
    ]
    if "id" not in selection_fields:
        return []
    selection = "\n            ".join(selection_fields)
    query_fields = schema.get("queryFields", set())

    def scan_list_assignments() -> list[dict[str, Any]]:
        if "listAssignments" not in query_fields:
            return []
        query = f"""
        query ListAssignments($limit: Int, $nextToken: String) {{
          listAssignments(limit: $limit, nextToken: $nextToken) {{
            items {{
              {selection}
            }}
            nextToken
          }}
        }}
        """
        items: list[dict[str, Any]] = []
        next_token: str | None = None
        while True:
            connection = client.graphql(
                query,
                {"limit": 500, "nextToken": next_token},
                "listAssignments",
            ) or {}
            items.extend([entry for entry in (connection.get("items") or []) if entry])
            next_token = connection.get("nextToken")
            if not next_token:
                break
        return items

    def scan_by_import_run_id() -> list[dict[str, Any]]:
        if "listAssignmentsByImportRunId" not in query_fields:
            return []
        query = f"""
        query ListAssignmentsByImportRunId($importRunId: String!, $limit: Int, $nextToken: String) {{
          listAssignmentsByImportRunId(importRunId: $importRunId, limit: $limit, nextToken: $nextToken) {{
            items {{
              {selection}
            }}
            nextToken
          }}
        }}
        """
        items: list[dict[str, Any]] = []
        next_token: str | None = None
        while True:
            connection = client.graphql(
                query,
                {"importRunId": marker, "limit": 500, "nextToken": next_token},
                "listAssignmentsByImportRunId",
            ) or {}
            items.extend([entry for entry in (connection.get("items") or []) if entry])
            next_token = connection.get("nextToken")
            if not next_token:
                break
        return items

    candidates = scan_by_import_run_id() or scan_list_assignments()
    matched: list[str] = []
    for item in candidates:
        import_run_id = str(item.get("importRunId") or "")
        title = str(item.get("title") or "")
        assignment_id = str(item.get("id") or "")
        if not assignment_id:
            continue
        if import_run_id == marker or marker in title:
            matched.append(assignment_id)
    return sorted(set(matched))


def _seed_update_assignment(client: GraphqlClient, marker: str) -> str:
    now = _now_iso()
    assignment_id = f"assignment-research-{marker}-seed-{uuid.uuid4().hex[:8]}"
    assignment_input = {
        "id": assignment_id,
        "assignmentTypeKey": "research.edition-candidate",
        "queueKey": "research:technology:exploratory",
        "queueStatusKey": "research:technology:exploratory#open",
        "status": "open",
        "priority": 50,
        "title": f"{marker} update seed",
        "summary": "seed assignment for update scenario",
        "corpusId": "knowledge-corpus-ai-ml-research",
        "sectionKey": "technology",
        "sectionType": "newsroom_section",
        "sectionStatusKey": "technology#open",
        "sectionQueueStatusKey": "technology#research:technology:exploratory#open",
        "importRunId": marker,
        "createdBy": "agent-smoke",
        "createdAt": now,
        "updatedAt": now,
        "newsroomFeedKey": "assignment#open",
    }
    client.graphql(
        CREATE_ASSIGNMENT_FOR_UPDATE_MUTATION,
        {"input": assignment_input},
        "createAssignment",
    )
    return assignment_id


def run_scenario(
    scenario_name: str,
    *,
    repo_root: Path,
    keep: bool = True,
    timeout_ms: int = 120_000,
    run_id: str | None = None,
) -> dict[str, Any]:
    client = GraphqlClient.from_env(repo_root)
    run_id = run_id or f"agent-smoke-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
    assignment_ids: set[str] = set()
    assignment_event_ids: set[str] = set()
    errors: list[dict[str, Any]] = []
    marker = f"{LIVE_AGENT_MARKER}-{run_id}"
    seeded_assignment_id: str | None = None
    response_target = CONSOLE_RESPONSE_TARGET_LOCAL if _local_responder_enabled() else CONSOLE_RESPONSE_TARGET_CLOUD
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
        if scenario_name == "update-research-assignment":
            seeded_assignment_id = _seed_update_assignment(client, marker)
            assignment_ids.add(seeded_assignment_id)
        prompt = scenario_prompt(scenario_name, run_id, seeded_assignment_id=seeded_assignment_id)
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
            "responseTarget": response_target,
            "responseStatus": "PENDING",
            "metadata": json.dumps(
                {
                    "threadId": thread_id,
                    "sequenceNumber": 1,
                    "role": "USER",
                    "smokeRunId": run_id,
                    "marker": marker,
                    "model": DEFAULT_AGENT_MODEL,
                }
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
        if _local_responder_enabled():
            _invoke_local_responder(
                repo_root=repo_root,
                thread_id=thread_id,
                message_id=message_input["id"],
                content=prompt,
                sequence_number=int(message_input["sequenceNumber"]),
                created_at=now,
                metadata=json.loads(message_input["metadata"]),
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
                    if (
                        (_message_role(msg) == "ASSISTANT" or "assistant" in str(msg.get("id", "")).lower())
                        and str(msg.get("parentMessageId") or "") == str(message_input["id"])
                    )
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
            if str(message.get("parentMessageId") or "") != str(message_input["id"]):
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
            _collect_errors(parsed, errors)

        content = _message_content(assistant).strip()
        if not content:
            raise RuntimeError("Assistant response is empty.")

        if scenario_name in {
            "create-research-assignment",
            "list-research-assignments",
            "get-research-assignment",
            "update-research-assignment",
        }:
            marker_assignment_ids = _list_assignments_for_marker(client, marker)
            if marker_assignment_ids:
                assignment_ids.update(marker_assignment_ids)
            if len(assignment_ids) > 1:
                raise RuntimeError(
                    f"Idempotency guard failed for marker {marker}: expected 1 assignment, found {len(assignment_ids)} "
                    f"({', '.join(sorted(assignment_ids))}). Assistant said: {content}"
                )
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
        if scenario_name == "list-research-assignments":
            if "papyrus.Assignment.list" not in api_calls:
                raise RuntimeError(
                    f"Expected Assignment.list tool call. Saw: {', '.join(api_calls)}. Assistant said: {content}"
                )
            if len(assignment_ids) != 1:
                raise RuntimeError(
                    f"Expected exactly one created Assignment, found {len(assignment_ids)}. Assistant said: {content}"
                )
        if scenario_name == "get-research-assignment":
            if "papyrus.Assignment.get" not in api_calls:
                raise RuntimeError(
                    f"Expected Assignment.get tool call. Saw: {', '.join(api_calls)}. Assistant said: {content}"
                )
            if len(assignment_ids) != 1:
                raise RuntimeError(
                    f"Expected exactly one created Assignment, found {len(assignment_ids)}. Assistant said: {content}"
                )
        if scenario_name == "update-research-assignment":
            if "papyrus.Assignment.update" not in api_calls:
                raise RuntimeError(
                    f"Expected Assignment.update tool call. Saw: {', '.join(api_calls)}. Assistant said: {content}"
                )
            if len(assignment_ids) != 1:
                raise RuntimeError(
                    f"Expected exactly one created Assignment, found {len(assignment_ids)}. Assistant said: {content}"
                )
        if scenario_name in {
            "create-research-assignment",
            "list-research-assignments",
            "get-research-assignment",
            "update-research-assignment",
        } and errors:
            raise RuntimeError(
                f"Expected no structured tool errors for {scenario_name}, saw: {json.dumps(errors)}. Assistant said: {content}"
            )
        if scenario_name == "invalid-assignment-input" and not errors:
            raise RuntimeError("Expected structured error payload for invalid assignment input, but saw none.")

        if (
            response_target == CONSOLE_RESPONSE_TARGET_LOCAL
            and scenario_name
            in {
                "create-research-assignment",
                "list-research-assignments",
                "get-research-assignment",
                "update-research-assignment",
            }
            and not errors
            and len(assignment_ids) == 1
        ):
            expected_assignment_id = sorted(assignment_ids)[0]
            if content != expected_assignment_id:
                raise RuntimeError(
                    f"Expected deterministic local response content to equal assignment id {expected_assignment_id}, got: {content}"
                )

        model = DEFAULT_AGENT_MODEL
        try:
            model = str(json.loads(assistant.get("metadata") or "{}").get("model") or DEFAULT_AGENT_MODEL)
        except Exception:
            model = DEFAULT_AGENT_MODEL

        return {
            "ok": True,
            "scenario": scenario_name,
            "runId": run_id,
            "assistantMessageId": assistant.get("id"),
            "assignmentIds": sorted(assignment_ids),
            "apiCalls": api_calls,
            "content": content,
            "errors": errors,
            "model": model,
            "responseTarget": response_target,
            "triggerMessageId": message_input["id"],
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
