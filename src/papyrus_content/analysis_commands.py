from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .analysis_graph import compact_graph_artifact_row, fetch_graph_artifact_rows_indexed, plan_graph_artifact_import
from .analysis_profiles import (
    DEFAULT_ANALYSIS_PROFILES_PATH,
    analysis_profile_by_key,
    build_analysis_reindex_assignment_records,
    build_analysis_reindex_plan,
    load_analysis_profiles,
    parse_analysis_overrides,
    print_analysis_reindex_plan,
)
from .graphql_authoring import create_authoring_client
from .ids import knowledge_corpus_id, safe_id
from .options import normalize_string, parse_options
from .records import apply_record_changes, build_record_changes_tolerating_optional_models
from .newsroom_summary import update_newsroom_summary_after_analysis_import, update_newsroom_summary_after_assignment_creates
from .relations_commands import print_category_import_summary
from .steering import require_corpus_config, require_steering_config, load_steering_config


def analysis_reindex_plan(flags: list[str]) -> None:
    options = parse_options(flags)
    plan = _build_analysis_reindex_plan_from_options(options, flags)
    if options.get("output"):
        _write_json_file(options["output"], plan)
    print_analysis_reindex_plan(plan)


def analysis_create_reindex_assignment(flags: list[str]) -> None:
    options = parse_options(flags)
    plan = _build_analysis_reindex_plan_from_options(options, flags)
    client, _ = create_authoring_client()
    category_sets = client.list_records("CategorySet")
    newsroom_sections = client.safe_list_records("NewsroomSection")
    category_set = _select_analysis_category_set(category_sets, plan, options.get("category-set"))
    section_target = _resolve_newsroom_section_target(newsroom_sections, options.get("section"))
    assignment_plan = build_analysis_reindex_assignment_records(
        plan,
        category_set=category_set,
        section_target=section_target,
        actor_label=normalize_string(options.get("actor")) or "papyrus-content-cli",
    )
    if options.get("output"):
        _write_json_file(
            options["output"],
            {"plan": plan, "assignment": assignment_plan["assignment"], "records": assignment_plan["records"]},
        )
    print_analysis_reindex_plan(plan)
    assignment_changes = build_record_changes_tolerating_optional_models(
        client,
        [{"modelName": record["modelName"], "expected": record["expected"]} for record in assignment_plan["records"]],
    )
    for change in assignment_changes:
        print(f"{change['action']}\t{change['modelName']}\t{change['expected']['id']}")
    if not options.get("apply"):
        print("analysis\tcreate-reindex-assignment\tapply\tskipped\tpass --apply to write Assignment records")
        return
    apply_record_changes(client, assignment_changes)
    update_newsroom_summary_after_assignment_creates(
        client,
        assignment_changes,
        actor_label=normalize_string(options.get("actor")) or "papyrus-content-cli",
        reason=f"analysis create-reindex-assignment {assignment_plan['assignment']['id']}",
    )


def analysis_run_now(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("profile"):
        raise ValueError("analysis run-now requires --profile <key>.")
    plan = _build_analysis_reindex_plan_from_options(options, flags)
    client, auth = create_authoring_client()
    category_sets = client.list_records("CategorySet")
    newsroom_sections = client.safe_list_records("NewsroomSection")
    category_set = _select_analysis_category_set(category_sets, plan, options.get("category-set"))
    section_target = _resolve_newsroom_section_target(newsroom_sections, options.get("section"))
    assignment_plan = build_analysis_reindex_assignment_records(
        plan,
        category_set=category_set,
        section_target=section_target,
        actor_label=normalize_string(options.get("actor")) or "papyrus-content-cli",
    )
    from .assignments import apply_assignment_action
    from .assignment_executors import execute_assignment_by_type

    assignment_changes = build_record_changes_tolerating_optional_models(
        client,
        [{"modelName": record["modelName"], "expected": record["expected"]} for record in assignment_plan["records"]],
    )
    apply_record_changes(client, assignment_changes)
    update_newsroom_summary_after_assignment_creates(
        client,
        assignment_changes,
        actor_label=normalize_string(options.get("actor")) or "papyrus-content-cli",
        reason=f"analysis run-now create {assignment_plan['assignment']['id']}",
    )
    apply_assignment_action(
        client,
        auth_claims=auth,
        action="claim",
        assignment_id=assignment_plan["assignment"]["id"],
        options=options,
        actor_label=normalize_string(options.get("actor")) or "papyrus-content-cli",
    )
    execution_result = execute_assignment_by_type(client, assignment_plan["assignment"]["id"], options)
    apply_assignment_action(
        client,
        auth_claims=auth,
        action="complete",
        assignment_id=assignment_plan["assignment"]["id"],
        options=options,
        actor_label=normalize_string(options.get("actor")) or "papyrus-content-cli",
    )
    print(json.dumps(execution_result, indent=2))


def analysis_execute_assignment(flags: list[str]) -> None:
    options = parse_options(flags)
    assignment_id = normalize_string(options.get("assignment"))
    if not assignment_id:
        raise ValueError("analysis execute-assignment requires --assignment <id>.")
    client, _ = create_authoring_client()
    from .assignment_executors import execute_assignment_by_type

    result = execute_assignment_by_type(client, assignment_id, options)
    print(json.dumps(result, indent=2))


def analysis_graph_artifacts(flags: list[str]) -> None:
    options = parse_options(flags)
    started_at = datetime.now(timezone.utc)
    client, _ = create_authoring_client()
    corpus_id = _graph_artifact_corpus_id_from_options(options)
    rows, diagnostics = fetch_graph_artifact_rows_indexed(client, corpus_id=corpus_id)
    rows.sort(
        key=lambda left: (
            str(left.get("importedAt") or ""),
            str(left.get("importRunId") or ""),
        ),
        reverse=True,
    )
    diagnostics["elapsedMs"] = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)
    if options.get("json"):
        print(
            json.dumps(
                {
                    "ok": True,
                    "command": "analysis graph-artifacts",
                    "corpusId": corpus_id,
                    "query": diagnostics,
                    "count": len(rows),
                    "artifacts": [compact_graph_artifact_row(row) for row in rows],
                },
                indent=2,
            )
        )
        return
    print(f"graph-artifacts\tcount\t{len(rows)}")
    for row in rows:
        attachment = row.get("attachment") or {}
        print(
            "\t".join(
                [
                    "graph-artifact",
                    str(row.get("importRunId") or "-"),
                    str(row.get("corpusId") or "-"),
                    str(row.get("artifactId") or row.get("sourceSnapshotId") or "-"),
                    str(row.get("importedAt") or "-"),
                    str(attachment.get("storagePath") or "-"),
                    str(attachment.get("byteSize") or "-"),
                ]
            )
        )


def analysis_import_graph_artifact(flags: list[str]) -> None:
    options = parse_options(flags)
    import_run_id = normalize_string(options.get("import-run"))
    if not import_run_id:
        raise ValueError("analysis import-graph-artifact requires --import-run <id>.")
    apply = bool(options.get("apply"))
    client, _ = create_authoring_client()
    result = plan_graph_artifact_import(client, import_run_id)
    changed_records = sum(1 for change in result["changes"] if change.get("action") != "noop")
    if not apply:
        payload = {
            "ok": True,
            "command": "analysis import-graph-artifact",
            "mode": "dry-run",
            "importRunId": import_run_id,
            "snapshot": result["plan"]["snapshotRef"],
            "storagePath": result["attachment"].get("storagePath"),
            "plannedRecords": len(result["plan"]["records"]),
            "changedRecords": changed_records,
            "next": f"poetry run papyrus-content analysis import-graph-artifact --import-run {import_run_id} --apply",
        }
        if options.get("json"):
            print(json.dumps(payload, indent=2))
        else:
            print("graph-artifact-import\tmode\tdry-run")
            print(f"graph-artifact-import\timport-run\t{import_run_id}")
            print(f"graph-artifact-import\tsnapshot\t{result['plan']['snapshotRef']}")
            print(f"graph-artifact-import\tchanged-records\t{changed_records}")
            print(f"graph-artifact-import\tnext\t{payload['next']}")
        return
    apply_record_changes(client, result["changes"])
    update_newsroom_summary_after_analysis_import(
        client,
        result["changes"],
        actor_label="papyrus-content-cli",
        reason=f"analysis reimport graph artifact {result['plan']['importRunId']}",
    )
    if options.get("json"):
        print(
            json.dumps(
                {
                    "ok": True,
                    "command": "analysis import-graph-artifact",
                    "mode": "apply",
                    "importRunId": import_run_id,
                    "snapshot": result["plan"]["snapshotRef"],
                    "storagePath": result["attachment"].get("storagePath"),
                    "changedRecords": changed_records,
                    "semanticNodes": result["plan"]["semanticNodeCount"],
                    "semanticRelations": result["plan"]["semanticRelationCount"],
                },
                indent=2,
            )
        )
    else:
        print_category_import_summary("graph-artifact", import_run_id, result["changes"])
        print(f"graph-artifact-import\timport-run\t{import_run_id}")
        print(f"graph-artifact-import\tsnapshot\t{result['plan']['snapshotRef']}")
        print(f"graph-artifact-import\tchanged-records\t{changed_records}")


def _build_analysis_reindex_plan_from_options(options: dict[str, Any], flags: list[str]) -> dict[str, Any]:
    if not options.get("profile"):
        raise ValueError("analysis reindex-plan requires --profile <key>.")
    steering_config = require_steering_config(options.get("config"))
    profiles_config = load_analysis_profiles(options.get("profiles") or str(DEFAULT_ANALYSIS_PROFILES_PATH))
    overrides = parse_analysis_overrides(
        _parse_repeated_option(flags, "override"),
        analysis_profile_by_key(profiles_config, options["profile"]),
    )
    return build_analysis_reindex_plan(
        profiles_config=profiles_config,
        steering_config=steering_config,
        profile_key=options["profile"],
        corpus_key=options.get("corpus-key"),
        mode=options.get("mode"),
        overrides=overrides,
        run_id=options.get("run-id"),
        biblicus_workdir=options.get("biblicus-workdir"),
        category_set_id=options.get("category-set"),
        category_key=options.get("category-key"),
    )


def _select_analysis_category_set(
    category_sets: list[dict[str, Any]],
    plan: dict[str, Any],
    explicit_category_set_id: str | None,
) -> dict[str, Any] | None:
    if explicit_category_set_id:
        category_set = next((entry for entry in category_sets if entry.get("id") == explicit_category_set_id), None)
        if category_set is None:
            raise ValueError(f"CategorySet {explicit_category_set_id} was not found.")
        return category_set
    accepted = [
        entry
        for entry in category_sets
        if entry.get("status") == "accepted"
        and (not entry.get("versionState") or entry.get("versionState") == "current")
        and entry.get("corpusId") == plan["corpus"]["id"]
        and (not plan.get("classifierId") or entry.get("classifierId") == plan["classifierId"])
    ]
    accepted.sort(
        key=lambda left: (
            str(left.get("generatedAt") or ""),
            str(left.get("displayName") or ""),
        ),
        reverse=True,
    )
    return accepted[0] if accepted else None


def _resolve_newsroom_section_target(
    newsroom_sections: list[dict[str, Any]],
    section_key: str | None,
) -> dict[str, Any] | None:
    normalized = normalize_string(section_key)
    if not normalized:
        return None
    section = next(
        (
            entry
            for entry in newsroom_sections
            if entry.get("id") == normalized
            or entry.get("sectionKey") == normalized
            or safe_id(entry.get("title") or "") == normalized
        ),
        None,
    )
    if section is None:
        raise ValueError(f"Unknown NewsroomSection '{normalized}'.")
    if section.get("enabled") is False or section.get("enabledStatus") == "disabled":
        raise ValueError(f"NewsroomSection '{normalized}' is disabled.")
    return {
        "id": section["id"],
        "title": section.get("title"),
        "type": "floating" if section.get("type") == "rotating" else section.get("type"),
        "editorialMission": section.get("editorialMission"),
        "editorialPolicy": section.get("editorialPolicy"),
        "assignmentGuidance": section.get("assignmentGuidance"),
        "killCriteria": section.get("killCriteria"),
        "visualGuidance": section.get("visualGuidance"),
    }


def _graph_artifact_corpus_id_from_options(options: dict[str, Any]) -> str | None:
    if not options.get("corpus-key"):
        return None
    steering_config = load_steering_config(options.get("config")) or require_steering_config()
    corpus_config = require_corpus_config(steering_config, options["corpus-key"], "--corpus-key")
    return knowledge_corpus_id(corpus_config)


def _parse_repeated_option(flags: list[str], key: str) -> list[str]:
    values: list[str] = []
    index = 0
    while index < len(flags):
        if flags[index] == f"--{key}" and index + 1 < len(flags):
            values.append(flags[index + 1])
            index += 2
        else:
            index += 1
    return values


def _write_json_file(path: str, payload: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
