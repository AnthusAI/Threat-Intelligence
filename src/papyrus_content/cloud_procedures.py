from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .env import PAPYRUS_ROOT
from .graphql_authoring import PapyrusGraphQLAuthoringClient

REQUIRED_PROCEDURES_CONFIG_PATH = PAPYRUS_ROOT / "corpora" / "papyrus-required-procedures.json"
SEED_REQUIRED_PROCEDURES_COMMAND = (
    "poetry run papyrus procedures seed-required --apply"
)


def seed_required_procedures_remediation() -> str:
    return f"Run {SEED_REQUIRED_PROCEDURES_COMMAND} to preload standard procedures."

GET_PROCEDURE_DEFINITION_QUERY = """
  query GetProcedureDefinition($procedureKey: String!) {
    getNewsroomProcedureDefinition(procedureKey: $procedureKey)
  }
"""

START_PROCEDURE_RUN_MUTATION = """
  mutation StartProcedureRun(
    $procedureKey: String
    $procedureVersionId: ID
    $title: String
    $summary: String
    $actorLabel: String
    $input: AWSJSON
  ) {
    startNewsroomProcedureRun(
      procedureKey: $procedureKey
      procedureVersionId: $procedureVersionId
      title: $title
      summary: $summary
      actorLabel: $actorLabel
      input: $input
    )
  }
"""

UPDATE_PROCEDURE_RUN_MUTATION = """
  mutation UpdateProcedureRun($input: UpdateProcedureRunInput!) {
    updateProcedureRun(input: $input) {
      id
      procedureKey
      procedureVersionId
      procedureVersionNumber
      runStatus
      output
      error
    }
  }
"""


def load_required_cli_procedure_config() -> dict[str, Any]:
    parsed = json.loads(REQUIRED_PROCEDURES_CONFIG_PATH.read_text(encoding="utf-8"))
    required = parsed.get("requiredCliProcedures")
    if not isinstance(required, dict):
        raise ValueError(f"Invalid required procedures config at {REQUIRED_PROCEDURES_CONFIG_PATH}.")
    keys = sorted({str(value).strip() for value in required.values() if str(value or "").strip()})
    return {"map": required, "keys": keys}


def required_procedure_key_for(alias: str) -> str:
    config = load_required_cli_procedure_config()
    key = str(config["map"].get(alias) or "").strip()
    if not key:
        raise ValueError(
            f"Required procedure alias '{alias}' is not configured in {REQUIRED_PROCEDURES_CONFIG_PATH}."
        )
    return key


def normalize_graphql_json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def get_cloud_procedure_definition_by_key(client: PapyrusGraphQLAuthoringClient, procedure_key: str) -> dict[str, Any] | None:
    data = client.graphql(GET_PROCEDURE_DEFINITION_QUERY, {"procedureKey": procedure_key})
    definition = normalize_graphql_json_value(data.get("getNewsroomProcedureDefinition"))
    if not isinstance(definition, dict) or not definition.get("id"):
        return None
    return definition


def current_cloud_procedure_version(definition: dict[str, Any]) -> dict[str, Any] | None:
    current = normalize_graphql_json_value(definition.get("currentVersion"))
    if isinstance(current, dict) and current.get("id"):
        return current
    versions = [
        normalize_graphql_json_value(entry)
        for entry in (definition.get("versions") or [])
        if isinstance(entry, (dict, str))
    ]
    for version in versions:
        if isinstance(version, dict) and version.get("id") == definition.get("currentVersionId"):
            return version
    for version in versions:
        if isinstance(version, dict) and version.get("isCurrent"):
            return version
    return versions[0] if versions and isinstance(versions[0], dict) else None


def cloud_procedure_source_or_throw(alias: str, procedure_key: str, version: dict[str, Any]) -> str:
    source = str(version.get("tactusSource") or "").strip()
    if not source:
        raise ValueError(
            f"Cloud procedure '{procedure_key}' for {alias} has no Tactus source. "
            f"{seed_required_procedures_remediation()}"
        )
    if not re.search(r"\bProcedure\s*\{", source, flags=re.MULTILINE):
        raise ValueError(
            f"Cloud procedure '{procedure_key}' for {alias} does not contain executable Tactus Procedure source. "
            f"{seed_required_procedures_remediation()}"
        )
    return f"{source}\n"


def encode_inline_assignment_param(value: Any) -> str:
    return f"@urljson:{urllib.parse.quote(json.dumps(value), safe='')}"


def tactus_param_value(value: Any) -> str | None:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return encode_inline_assignment_param(value)
    return str(value)


def normalize_cloud_procedure_input(input_payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in input_payload.items()
        if value is not None
    }


def cloud_procedure_tactus_command(source_path: Path, input_payload: dict[str, Any]) -> list[str]:
    command = ["tactus", "run", str(source_path), "--no-sandbox", "--real-all"]
    for key, value in (input_payload or {}).items():
        encoded = tactus_param_value(value)
        if encoded is None:
            continue
        command.extend(["--param", f"{key}={encoded}"])
    command.extend(["--log-format", "raw"])
    return command


def update_cloud_procedure_run_record(client: PapyrusGraphQLAuthoringClient, payload: dict[str, Any]) -> dict[str, Any]:
    output = payload.get("output")
    error = payload.get("error")
    data = client.graphql(
        UPDATE_PROCEDURE_RUN_MUTATION,
        {
            "input": {
                "id": payload["id"],
                "runStatus": payload["runStatus"],
                "startedAt": payload.get("startedAt"),
                "finishedAt": payload.get("finishedAt"),
                "resultSummary": payload.get("resultSummary"),
                "errorSummary": payload.get("errorSummary"),
                "output": None if output is None else json.dumps(output),
                "error": None if error is None else json.dumps(error),
                "attempt": payload.get("attempt"),
            }
        },
    )
    return normalize_graphql_json_value(data.get("updateProcedureRun")) or {}


def try_parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


DEFAULT_PROCEDURE_OUTPUT_MARKERS = (
    "research_packet",
    "researchPacket",
    "reporting_context_packet",
    "reportingContextPacket",
    "draft_record_plan",
    "draftRecordPlan",
    "work_product_kind",
    "assignment_item_id",
)


def normalize_run_payload_candidate(value: Any, *, markers: tuple[str, ...] = DEFAULT_PROCEDURE_OUTPUT_MARKERS) -> dict[str, Any] | None:
    candidate = value
    if isinstance(value, dict) and isinstance(value.get("value"), dict) and not isinstance(value.get("value"), list):
        candidate = value["value"]
    if not isinstance(candidate, dict):
        return None
    reason = candidate.get("reason")
    if isinstance(reason, str):
        reason_payload = normalize_run_payload_candidate(try_parse_json(reason), markers=markers)
        if reason_payload:
            return reason_payload
    if any(marker in candidate for marker in markers):
        return candidate
    return None


def extract_balanced_json_object_at(text: str, start: int) -> str | None:
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            continue
        if char == "{":
            depth += 1
            continue
        if char == "}" and depth > 0:
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def extract_likely_json_payload_objects(text: str) -> list[str]:
    pattern = re.compile(
        r'\n\{\s*\n\s*"(assignment_item_id|dry_run|work_product_kind|research_packet|researchPacket|'
        r'reporting_context_packet|reportingContextPacket|draft_record_plan|draftRecordPlan)"'
    )
    matches: list[str] = []
    for match in pattern.finditer(text):
        start = match.start() + 1
        object_text = extract_balanced_json_object_at(text, start)
        if object_text:
            matches.append(object_text)
    return matches


def extract_balanced_json_objects(text: str) -> list[str]:
    objects: list[str] = []
    start = -1
    depth = 0
    in_string = False
    escaped = False
    for index, char in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            continue
        if char == "{":
            if depth == 0:
                start = index
            depth += 1
            continue
        if char == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                objects.append(text[start : index + 1])
                start = -1
    return objects


def extract_research_run_payload(stdout: str, *, markers: tuple[str, ...] = DEFAULT_PROCEDURE_OUTPUT_MARKERS) -> dict[str, Any] | None:
    text = str(stdout or "").strip()
    if not text:
        return None
    direct_payload = normalize_run_payload_candidate(try_parse_json(text), markers=markers)
    if direct_payload:
        return direct_payload
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in reversed(lines):
        payload = normalize_run_payload_candidate(try_parse_json(line), markers=markers)
        if payload:
            return payload
    for candidate in reversed(extract_likely_json_payload_objects(text)):
        payload = normalize_run_payload_candidate(try_parse_json(candidate), markers=markers)
        if payload:
            return payload
    for candidate in reversed(extract_balanced_json_objects(text)):
        payload = normalize_run_payload_candidate(try_parse_json(candidate), markers=markers)
        if payload:
            return payload
    return None


def line_number_at(text: str, index: int) -> int:
    return text.count("\n", 0, max(index, 0)) + 1


def extract_execute_tactus_call_traces(stdout: str) -> list[dict[str, Any]]:
    text = str(stdout or "")
    if not text:
        return []
    agent_markers: list[tuple[int, str]] = [
        (match.start(), match.group(1))
        for match in re.finditer(r"^→ Agent ([^:]+):", text, flags=re.MULTILINE)
    ]
    traces: list[dict[str, Any]] = []
    for call_index, match in enumerate(re.finditer(r"^→ Tool execute_tactus\s*$", text, flags=re.MULTILINE), start=1):
        start = match.start()
        line = line_number_at(text, start)
        agent = ""
        for agent_pos, agent_name in reversed(agent_markers):
            if agent_pos < start:
                agent = agent_name
                break
        args_marker = re.search(r"^\s*Args:\s*", text[match.end() :], flags=re.MULTILINE)
        args_object_text = None
        args = None
        args_start = -1
        args_end = -1
        if args_marker:
            marker_start = match.end() + args_marker.start()
            brace_start = text.find("{", marker_start)
            if brace_start >= 0:
                args_start = brace_start
                args_object_text = extract_balanced_json_object_at(text, brace_start)
                if args_object_text:
                    args_end = brace_start + len(args_object_text)
                    args = try_parse_json(args_object_text)
        result_line_text = ""
        if args_end >= 0:
            result_line_match = re.search(r"^\s*Result:\s*(.+)$", text[args_end:], flags=re.MULTILINE)
            if result_line_match:
                result_line_text = result_line_match.group(1).strip()
        traces.append(
            {
                "callIndex": call_index,
                "line": line,
                "agent": agent or None,
                "tool": "execute_tactus",
                "args": args if isinstance(args, dict) else {},
                "argsRaw": args_object_text or "",
                "harness": (args or {}).get("harness") if isinstance(args, dict) else None,
                "assignmentId": (args or {}).get("assignment_id") if isinstance(args, dict) else None,
                "contextProfile": (args or {}).get("context_profile") if isinstance(args, dict) else None,
                "corpusKey": (args or {}).get("corpus_key") if isinstance(args, dict) else None,
                "researchMode": (args or {}).get("research_mode") if isinstance(args, dict) else None,
                "tactusSnippet": (args or {}).get("tactus") if isinstance(args, dict) else None,
                "resultPreview": result_line_text,
            }
        )
    return traces


def write_llm_context_trace_artifacts(
    *,
    run_dir: Path,
    alias: str,
    procedure_key: str,
    run_id: str,
    input_payload: dict[str, Any],
    stdout: str,
    stdout_path: Path,
) -> dict[str, Any]:
    llm_dir = run_dir / "llm-context"
    llm_dir.mkdir(parents=True, exist_ok=True)
    calls = extract_execute_tactus_call_traces(stdout)
    calls_path = llm_dir / "execute_tactus_calls.jsonl"
    with calls_path.open("w", encoding="utf-8") as handle:
        for call in calls:
            handle.write(json.dumps(call, sort_keys=True) + "\n")
    summary = {
        "version": 1,
        "alias": alias,
        "procedureKey": procedure_key,
        "runId": run_id,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceStdoutPath": str(stdout_path),
        "inputPayload": input_payload,
        "executeTactusCallCount": len(calls),
        "callsPath": str(calls_path),
        "calls": [
            {
                "callIndex": call.get("callIndex"),
                "line": call.get("line"),
                "agent": call.get("agent"),
                "harness": call.get("harness"),
                "assignmentId": call.get("assignmentId"),
                "contextProfile": call.get("contextProfile"),
                "corpusKey": call.get("corpusKey"),
                "researchMode": call.get("researchMode"),
            }
            for call in calls
        ],
    }
    summary_path = llm_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return {
        "llmContextDir": str(llm_dir),
        "llmContextSummaryPath": str(summary_path),
        "llmContextCallsPath": str(calls_path),
        "llmContextCallCount": len(calls),
    }


def prepend_path_list(entries: list[str], existing: str | None) -> str:
    parts = [*entries, existing]
    return os.pathsep.join(part for part in parts if part)


def start_cloud_procedure_run(
    *,
    client: PapyrusGraphQLAuthoringClient,
    alias: str,
    actor_label: str,
    title: str,
    summary: str,
    input_payload: dict[str, Any],
    run_dir: Path | None = None,
    stdout_path: Path | None = None,
    stderr_path: Path | None = None,
    source_path: Path | None = None,
    output_markers: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    procedure_key = required_procedure_key_for(alias)
    procedure_input = normalize_cloud_procedure_input(input_payload)
    try:
        definition = get_cloud_procedure_definition_by_key(client, procedure_key)
    except Exception as error:
        message = str(error).lower()
        if "not found" in message:
            raise ValueError(
                f"Missing required cloud procedure '{procedure_key}' for {alias}. "
                f"{seed_required_procedures_remediation()}"
            ) from error
        raise
    if not definition:
        raise ValueError(
            f"Missing required cloud procedure '{procedure_key}' for {alias}. "
            f"{seed_required_procedures_remediation()}"
        )
    version = current_cloud_procedure_version(definition)
    if not version or not version.get("id"):
        raise ValueError(
            f"Cloud procedure '{procedure_key}' has no current version. "
            f"{seed_required_procedures_remediation()}"
        )
    tactus_source = cloud_procedure_source_or_throw(alias, procedure_key, version)
    start_data = client.graphql(
        START_PROCEDURE_RUN_MUTATION,
        {
            "procedureKey": procedure_key,
            "procedureVersionId": version["id"],
            "title": title,
            "summary": summary,
            "actorLabel": actor_label,
            "input": json.dumps({**procedure_input, "__papyrusExecutionMode": "external_cli"}),
        },
    )
    started = normalize_graphql_json_value(start_data.get("startNewsroomProcedureRun")) or {}
    run_id = str(started.get("runId") or "").strip()
    if not run_id:
        raise ValueError(f"Cloud procedure '{procedure_key}' did not return runId.")
    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    effective_run_dir = run_dir or (PAPYRUS_ROOT / ".papyrus-runs" / run_id)
    effective_source_path = source_path or (effective_run_dir / f"{procedure_key.replace('.', '-')}.cloud.tac")
    effective_stdout_path = stdout_path or (effective_run_dir / f"{procedure_key.replace('.', '-')}.stdout.log")
    effective_stderr_path = stderr_path or (effective_run_dir / f"{procedure_key.replace('.', '-')}.stderr.log")
    effective_source_path.parent.mkdir(parents=True, exist_ok=True)
    effective_stdout_path.parent.mkdir(parents=True, exist_ok=True)
    effective_stderr_path.parent.mkdir(parents=True, exist_ok=True)
    effective_source_path.write_text(tactus_source, encoding="utf-8")
    command = cloud_procedure_tactus_command(effective_source_path, procedure_input)
    env = os.environ.copy()
    env["PYTHONPATH"] = prepend_path_list(
        [str(PAPYRUS_ROOT.parent / "Tactus"), str(PAPYRUS_ROOT / "src")],
        env.get("PYTHONPATH"),
    )
    completed = subprocess.run(
        command,
        cwd=PAPYRUS_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    effective_stdout_path.write_text(completed.stdout or "", encoding="utf-8")
    effective_stderr_path.write_text(completed.stderr or "", encoding="utf-8")
    llm_context = write_llm_context_trace_artifacts(
        run_dir=effective_run_dir,
        alias=alias,
        procedure_key=procedure_key,
        run_id=run_id,
        input_payload=procedure_input,
        stdout=completed.stdout or "",
        stdout_path=effective_stdout_path,
    )
    finished_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    parsed = extract_research_run_payload(
        completed.stdout or "",
        markers=output_markers or DEFAULT_PROCEDURE_OUTPUT_MARKERS,
    )
    execution_output = None
    if completed.returncode == 0 and isinstance(parsed, dict):
        execution_output = {
            "procedureKey": procedure_key,
            "procedureVersionId": version["id"],
            "procedureVersionNumber": version.get("versionNumber"),
            "executedAt": finished_at,
            "mode": "cli_tactus_source",
            "source": "ProcedureVersion.tactusSource",
            "input": procedure_input,
            "llmContext": llm_context,
            **parsed,
        }
    error = None
    if completed.returncode != 0 or not execution_output:
        error = {
            "message": (
                f"Tactus procedure exited with status {completed.returncode}."
                if completed.returncode != 0
                else "Tactus procedure completed without a JSON procedure payload."
            ),
            "exitStatus": completed.returncode,
            "signal": None,
            "stdoutPath": str(effective_stdout_path),
            "stderrPath": str(effective_stderr_path),
        }
    updated = update_cloud_procedure_run_record(
        client,
        {
            "id": run_id,
            "runStatus": "failed" if error else "completed",
            "startedAt": started_at,
            "finishedAt": finished_at,
            "resultSummary": None
            if error
            else f"Completed cloud Tactus procedure {procedure_key} v{version.get('versionNumber', '')}.",
            "errorSummary": error["message"] if error else None,
            "output": execution_output,
            "error": error,
            "attempt": 1,
        },
    )
    result = {
        **(updated or {}),
        "id": run_id,
        "procedureKey": procedure_key,
        "procedureVersionId": version["id"],
        "procedureVersionNumber": version.get("versionNumber"),
        "runStatus": "failed" if error else "completed",
        "output": execution_output,
        "error": error,
        "exitStatus": completed.returncode,
        "signal": None,
        "commandLine": command,
        "sourcePath": str(effective_source_path),
        "stdoutPath": str(effective_stdout_path),
        "stderrPath": str(effective_stderr_path),
        **llm_context,
    }
    if error:
        raise RuntimeError(error["message"])
    return result
