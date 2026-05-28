from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .graphql_authoring import create_authoring_client
from .options import parse_options, resolve_mutation_apply
from .records import apply_record_changes, build_record_changes
from .relation_types import (
    DEFAULT_RELATION_TYPES_PATH,
    build_semantic_relation_backfill_records,
    build_semantic_relation_type_records,
    load_semantic_relation_type_seeds,
)


def relations_import_types(flags: list[str]) -> None:
    options = parse_options(flags)
    config_path = options.get("config") or str(DEFAULT_RELATION_TYPES_PATH)
    relation_types = load_semantic_relation_type_seeds(config_path)
    client, _ = create_authoring_client()
    records = build_semantic_relation_type_records(relation_types)
    changes = build_record_changes(client, records)
    apply_record_changes(client, changes)
    print_category_import_summary("relation-types", Path(config_path).name, changes)


def relations_backfill(flags: list[str]) -> None:
    options = parse_options(flags)
    apply = resolve_mutation_apply(options, "knowledge concepts backfill")
    config_path = options.get("config") or str(DEFAULT_RELATION_TYPES_PATH)
    relation_types = load_semantic_relation_type_seeds(config_path)
    client, _ = create_authoring_client()
    relations = client.list_records("SemanticRelation")
    changes = build_semantic_relation_backfill_records(relations, relation_types)
    run_dir = Path(".papyrus-runs") / f"relation-type-backfill-{timestamp_for_path()}"
    report_path = run_dir / "backfill-report.json"
    actionable = [change for change in changes if change.get("action") != "noop"]
    unknown = [change for change in changes if change.get("unknownType")]
    report = {
        "generatedAt": _utc_now(),
        "configPath": config_path,
        "reportPath": str(report_path),
        "apply": apply,
        "relationCount": len(relations),
        "changeCount": len(actionable),
        "unknownTypeCount": len(unknown),
        "unknownTypes": sorted({change["expected"]["relationTypeKey"] for change in unknown}),
        "changes": [
            {
                "id": change["expected"]["id"],
                "action": change["action"],
                "relationTypeKey": change["expected"]["relationTypeKey"],
                "relationDomain": change["expected"]["relationDomain"],
            }
            for change in actionable
        ],
    }
    write_json_file(report_path, report)
    if apply:
        apply_record_changes(client, changes)
    print_relation_backfill_summary(report)


def print_category_import_summary(kind: str, import_run_id: str, changes: list[dict[str, Any]]) -> None:
    print(f"Import: {kind}")
    print(f"Run: {import_run_id}")
    counts: dict[str, int] = {}
    for record in changes:
        action = record.get("action") or "noop"
        counts[action] = counts.get(action, 0) + 1
    print(
        f"Summary: create={counts.get('create', 0)} "
        f"update={counts.get('update', 0)} "
        f"noop={counts.get('noop', 0)}"
    )
    for record in changes:
        if record.get("action") == "noop":
            continue
        print(f"{record['action']}\t{record['modelName']}\t{record['expected']['id']}")


def print_relation_backfill_summary(report: dict[str, Any]) -> None:
    print("Relation type backfill:")
    print(f"config\t{report['configPath']}")
    print(f"relations\t{report['relationCount']}")
    print(f"changes\t{report['changeCount']}")
    print(f"unknownTypes\t{report['unknownTypeCount']}")
    print(f"apply\t{'yes' if report['apply'] else 'no'}")
    for relation_type in report.get("unknownTypes") or []:
        print(f"unknown\t{relation_type}")
    print(f"report\t{report['reportPath']}")


def write_json_file(path: str | Path, payload: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def timestamp_for_path(value: str | None = None) -> str:
    timestamp = value or _utc_now()
    return timestamp.replace(":", "-").replace(".", "-")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
