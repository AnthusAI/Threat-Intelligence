from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .accession import execute_reference_accession_assignment
from .assignments import assignment_metadata
from .env import PAPYRUS_ROOT
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
        return execute_analysis_reindex_assignment(client, assignment, merged_options)
    if assignment_type == "reference.corpus-accession":
        return execute_reference_accession_assignment(client, assignment, merged_options)
    if assignment_type == "reference.text-extraction":
        return execute_reference_text_extraction_assignment(client, assignment, merged_options)
    if assignment_type in {"reference.identifier-backfill", "reference.doi-backfill"}:
        return execute_reference_identifier_backfill_assignment(client, assignment, merged_options)
    raise ValueError(f"No executor is registered for assignment type {assignment_type}.")


def execute_analysis_reindex_assignment(
    client: PapyrusGraphQLAuthoringClient,
    assignment: dict[str, Any],
    options: dict[str, Any],
) -> dict[str, Any]:
    metadata = assignment_metadata(client, assignment)
    command_plan = metadata.get("commandPlan") if isinstance(metadata.get("commandPlan"), list) else []
    if assignment.get("status") != "claimed":
        raise ValueError(
            f"Assignment {assignment['id']} must be claimed before execution (current={assignment.get('status')})."
        )
    run_id = str(options.get("run-id") or metadata.get("planRunId") or f"analysis-reindex-{assignment['id']}")
    run_dir = PAPYRUS_ROOT / ".papyrus-runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    command_results: list[dict[str, Any]] = []
    for index, command in enumerate(command_plan, start=1):
        argv = [str(part) for part in command.get("argv") or []]
        if not argv:
            continue
        cwd_value = command.get("cwd")
        cwd = Path(cwd_value) if isinstance(cwd_value, str) and cwd_value else PAPYRUS_ROOT
        if not cwd.is_absolute():
            cwd = (PAPYRUS_ROOT / cwd).resolve()
        label = str(command.get("label") or f"command-{index:02d}")
        stdout_log = run_dir / f"{label}.stdout.log"
        stderr_log = run_dir / f"{label}.stderr.log"
        completed = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, check=False)
        stdout_log.write_text(completed.stdout or "", encoding="utf-8")
        stderr_log.write_text(completed.stderr or "", encoding="utf-8")
        command_result = {
            "label": label,
            "argv": argv,
            "cwd": str(cwd),
            "exitStatus": int(completed.returncode or 0),
            "stdoutLogPath": str(stdout_log),
            "stderrLogPath": str(stderr_log),
        }
        command_results.append(command_result)
        if completed.returncode != 0:
            manifest_path = run_dir / "execution-manifest.json"
            manifest = {
                "runId": run_id,
                "assignmentId": assignment["id"],
                "assignmentTypeKey": assignment["assignmentTypeKey"],
                "status": "failed",
                "failedCommand": command_result,
                "commandResults": command_results,
            }
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            raise RuntimeError(f"Analysis reindex command failed: {label}")
    manifest_path = run_dir / "execution-manifest.json"
    manifest = {
        "runId": run_id,
        "assignmentId": assignment["id"],
        "assignmentTypeKey": assignment["assignmentTypeKey"],
        "status": "executed",
        "commandResults": command_results,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {
        "assignmentId": assignment["id"],
        "runId": run_id,
        "runDir": str(run_dir),
        "manifestPath": str(manifest_path),
        "commandResults": command_results,
    }


def execute_reference_identifier_backfill_assignment(
    client: PapyrusGraphQLAuthoringClient,
    assignment: dict[str, Any],
    options: dict[str, Any],
) -> dict[str, Any]:
    metadata = assignment_metadata(client, assignment)
    if assignment.get("status") != "claimed":
        raise ValueError(
            f"Assignment {assignment['id']} must be claimed before execution (current={assignment.get('status')})."
        )
    corpus_key = str(metadata.get("corpusKey") or "").strip()
    if not corpus_key:
        raise ValueError(f"Assignment {assignment['id']} metadata is missing corpusKey.")
    run_id = str(options.get("run-id") or metadata.get("runId") or f"reference-identifier-backfill-{assignment['id']}")
    run_dir = PAPYRUS_ROOT / ".papyrus-runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    max_count = int(options.get("max-count") or metadata.get("maxCount") or 200)
    scan_limit = int(options.get("scan-limit") or max(max_count * 4, 2000))
    model = str(options.get("llm-model") or metadata.get("llmModel") or "gpt-5.4-mini")
    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    args = [
        "poetry",
        "run",
        "papyrus-newsroom",
        "references",
        "curate-recent",
        "--corpus-key",
        corpus_key,
        "--all",
        "--max-count",
        str(max_count),
        "--scan-limit",
        str(scan_limit),
        "--model",
        model,
        "--apply",
        "--json",
    ]
    completed = subprocess.run(args, cwd=PAPYRUS_ROOT, capture_output=True, text=True, check=False)
    stdout_log = run_dir / "identifier-backfill.stdout.log"
    stderr_log = run_dir / "identifier-backfill.stderr.log"
    stdout_log.write_text(completed.stdout or "", encoding="utf-8")
    stderr_log.write_text(completed.stderr or "", encoding="utf-8")
    payload = _extract_last_json(completed.stdout or "")
    summary = payload.get("summary") if isinstance(payload, dict) else {}
    manifest_path = run_dir / "execution-manifest.json"
    manifest = {
        "runId": run_id,
        "assignmentId": assignment["id"],
        "assignmentTypeKey": assignment["assignmentTypeKey"],
        "status": "executed" if completed.returncode == 0 else "failed",
        "startedAt": started_at,
        "completedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "stdoutLogPath": str(stdout_log),
        "stderrLogPath": str(stderr_log),
        "summary": summary,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if completed.returncode != 0:
        raise RuntimeError(f"Identifier backfill execution failed for assignment {assignment['id']}.")
    return {
        "assignmentId": assignment["id"],
        "runId": run_id,
        "runDir": str(run_dir),
        "manifestPath": str(manifest_path),
        "summary": summary,
    }


def _extract_last_json(stdout: str) -> dict[str, Any] | None:
    for line in reversed(stdout.splitlines()):
        text = line.strip()
        if not text.startswith("{"):
            continue
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None
