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
        actor_label=normalize_string(options.get("actor")) or "papyrus-cli",
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
        actor_label=normalize_string(options.get("actor")) or "papyrus-cli",
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
        actor_label=normalize_string(options.get("actor")) or "papyrus-cli",
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
        actor_label=normalize_string(options.get("actor")) or "papyrus-cli",
        reason=f"analysis run-now create {assignment_plan['assignment']['id']}",
    )
    apply_assignment_action(
        client,
        auth_claims=auth,
        action="claim",
        assignment_id=assignment_plan["assignment"]["id"],
        options=options,
        actor_label=normalize_string(options.get("actor")) or "papyrus-cli",
    )
    execution_result = execute_assignment_by_type(client, assignment_plan["assignment"]["id"], options)
    apply_assignment_action(
        client,
        auth_claims=auth,
        action="complete",
        assignment_id=assignment_plan["assignment"]["id"],
        options=options,
        actor_label=normalize_string(options.get("actor")) or "papyrus-cli",
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
        unresolved_reference_item_ids = result["plan"].get("unresolvedReferenceItemIds") or []
        payload = {
            "ok": True,
            "command": "analysis import-graph-artifact",
            "mode": "dry-run",
            "importRunId": import_run_id,
            "snapshot": result["plan"]["snapshotRef"],
            "storagePath": result["attachment"].get("storagePath"),
            "plannedRecords": len(result["plan"]["records"]),
            "changedRecords": changed_records,
            "mentionEdges": result["plan"]["mentionEdgeCount"],
            "mentionRelations": result["plan"]["mentionRelationCount"],
            "unresolvedReferences": result["plan"]["unresolvedReferences"],
            "unresolvedReferenceItemIds": unresolved_reference_item_ids[:50],
            "next": f"poetry run papyrus analysis import-graph-artifact --import-run {import_run_id} --apply",
        }
        if options.get("json"):
            print(json.dumps(payload, indent=2))
        else:
            print("graph-artifact-import\tmode\tdry-run")
            print(f"graph-artifact-import\timport-run\t{import_run_id}")
            print(f"graph-artifact-import\tsnapshot\t{result['plan']['snapshotRef']}")
            print(f"graph-artifact-import\tchanged-records\t{changed_records}")
            print(f"graph-artifact-import\tmention-edges\t{result['plan']['mentionEdgeCount']}")
            print(f"graph-artifact-import\tmention-relations\t{result['plan']['mentionRelationCount']}")
            print(f"graph-artifact-import\tunresolved-references\t{result['plan']['unresolvedReferences']}")
            if unresolved_reference_item_ids:
                print(
                    "graph-artifact-import\tunresolved-reference-item-ids\t"
                    f"{', '.join(str(value) for value in unresolved_reference_item_ids[:20])}"
                )
            print(f"graph-artifact-import\tnext\t{payload['next']}")
        return
    apply_record_changes(client, result["changes"])
    update_newsroom_summary_after_analysis_import(
        client,
        result["changes"],
        actor_label="papyrus-cli",
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
                    "mentionEdges": result["plan"]["mentionEdgeCount"],
                    "mentionRelations": result["plan"]["mentionRelationCount"],
                    "unresolvedReferences": result["plan"]["unresolvedReferences"],
                    "unresolvedReferenceItemIds": (result["plan"].get("unresolvedReferenceItemIds") or [])[:50],
                },
                indent=2,
            )
        )
    else:
        print_category_import_summary("graph-artifact", import_run_id, result["changes"])
        print(f"graph-artifact-import\timport-run\t{import_run_id}")
        print(f"graph-artifact-import\tsnapshot\t{result['plan']['snapshotRef']}")
        print(f"graph-artifact-import\tchanged-records\t{changed_records}")
        print(f"graph-artifact-import\tmention-edges\t{result['plan']['mentionEdgeCount']}")
        print(f"graph-artifact-import\tmention-relations\t{result['plan']['mentionRelationCount']}")
        print(f"graph-artifact-import\tunresolved-references\t{result['plan']['unresolvedReferences']}")


def analysis_doctor_entity_graph(flags: list[str]) -> None:
    options = parse_options(flags)
    started_at = datetime.now(timezone.utc)
    client, _ = create_authoring_client()
    corpus_id = _graph_artifact_corpus_id_from_options(options)
    references = [
        row
        for row in client.list_records("Reference")
        if (not corpus_id or row.get("corpusId") == corpus_id)
        and row.get("versionState") == "current"
        and row.get("curationStatus") == "accepted"
    ]
    semantic_nodes = [
        row
        for row in client.list_records("SemanticNode")
        if (not corpus_id or row.get("corpusId") == corpus_id) and row.get("versionState") == "current"
    ]
    rows, diagnostics = fetch_graph_artifact_rows_indexed(client, corpus_id=corpus_id)
    graph_import_run_ids = {str(row.get("importRunId")) for row in rows if row.get("importRunId")}
    semantic_relations = client.list_records("SemanticRelation")
    graph_semantic_relations = [
        row
        for row in semantic_relations
        if row.get("relationState") == "current" and row.get("importRunId") in graph_import_run_ids
    ]
    mention_relations = [row for row in graph_semantic_relations if row.get("predicate") == "mentions"]
    unresolved_references = 0
    unresolved_reference_item_ids: list[str] = []
    for row in rows:
        payload_record = row.get("rawPayload") or {}
        payload_blob = payload_record.get("payload")
        if not payload_blob:
            continue
        try:
            parsed = json.loads(payload_blob)
        except json.JSONDecodeError:
            continue
        unresolved_references += int(parsed.get("unresolvedReferences") or 0)
        for value in parsed.get("unresolvedReferenceItemIds") or []:
            normalized = normalize_string(value)
            if normalized and normalized not in unresolved_reference_item_ids:
                unresolved_reference_item_ids.append(normalized)
    semantic_node_kind_counts: dict[str, int] = {}
    for row in semantic_nodes:
        key = normalize_string(row.get("nodeKind")) or "unknown"
        semantic_node_kind_counts[key] = semantic_node_kind_counts.get(key, 0) + 1
    mention_edges = 0
    latest_row = None
    if rows:
        rows.sort(
            key=lambda left: (
                str(left.get("importedAt") or ""),
                str(left.get("importRunId") or ""),
            ),
            reverse=True,
        )
        latest_row = rows[0]
        latest_payload_record = (latest_row.get("rawPayload") or {}).get("payload")
        if isinstance(latest_payload_record, str):
            try:
                latest_payload = json.loads(latest_payload_record)
                mention_edges = int(latest_payload.get("stats", {}).get("mentions_found") or latest_payload.get("edgeCount") or 0)
            except json.JSONDecodeError:
                mention_edges = 0
    blockers: list[str] = []
    if not rows:
        blockers.append("no_graph_artifact")
    if rows and not semantic_nodes:
        blockers.append("graph_artifact_without_semantic_nodes")
    if unresolved_references > 0:
        blockers.append("unresolved_reference_item_ids")
    if rows and not mention_relations:
        blockers.append("no_mentions_relations")
    elapsed_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)
    diagnostics["elapsedMs"] = elapsed_ms
    result = {
        "ok": len(blockers) == 0,
        "command": "analysis doctor-entity-graph",
        "corpusId": corpus_id,
        "counts": {
            "acceptedReferences": len(references),
            "graphArtifacts": len(rows),
            "semanticNodes": len(semantic_nodes),
            "semanticNodesByKind": semantic_node_kind_counts,
            "graphSemanticRelations": len(graph_semantic_relations),
            "mentionsRelations": len(mention_relations),
            "unresolvedReferences": unresolved_references,
            "mentionsEdgesEstimate": mention_edges,
        },
        "latest": {
            "importRunId": (latest_row or {}).get("importRunId"),
            "artifactId": (latest_row or {}).get("artifactId"),
            "snapshotId": (latest_row or {}).get("sourceSnapshotId"),
            "importedAt": (latest_row or {}).get("importedAt"),
        },
        "blockers": blockers,
        "unresolvedReferenceItemIds": unresolved_reference_item_ids[:100],
        "query": diagnostics,
        "next": (
            "poetry run papyrus analysis run-now --profile entity-extraction --apply "
            if not rows
            else (
                "poetry run papyrus analysis import-graph-artifact --import-run <id> --apply"
                if rows and not graph_semantic_relations
                else None
            )
        ),
    }
    if options.get("json"):
        print(json.dumps(result, indent=2))
        return
    print(f"analysis-doctor\tentity-graph\tok\t{result['ok']}")
    print(f"analysis-doctor\tentity-graph\tcorpus\t{corpus_id or '-'}")
    print(f"analysis-doctor\tentity-graph\taccepted-references\t{result['counts']['acceptedReferences']}")
    print(f"analysis-doctor\tentity-graph\tgraph-artifacts\t{result['counts']['graphArtifacts']}")
    print(f"analysis-doctor\tentity-graph\tsemantic-nodes\t{result['counts']['semanticNodes']}")
    print(f"analysis-doctor\tentity-graph\tmentions-relations\t{result['counts']['mentionsRelations']}")
    print(f"analysis-doctor\tentity-graph\tunresolved-references\t{result['counts']['unresolvedReferences']}")
    if blockers:
        print(f"analysis-doctor\tentity-graph\tblockers\t{', '.join(blockers)}")
    if unresolved_reference_item_ids:
        print(
            "analysis-doctor\tentity-graph\tunresolved-item-ids\t"
            f"{', '.join(unresolved_reference_item_ids[:20])}"
        )
    if result["next"]:
        print(f"analysis-doctor\tentity-graph\tnext\t{result['next']}")


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
