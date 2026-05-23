from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from .accession import (
    build_reference_accession_assignment_records,
    execute_reference_accession_assignment,
    find_reference_for_source_accession,
    next_reference_source_command,
    print_reference_accession_assignment_summary,
    require_corpus_config_by_id_or_key,
    reference_accession_assignment_id,
)
from .analysis_profiles import analysis_profiles, validate_analysis_profiles
from .assignments import apply_assignment_action
from .assignments_commands import assignments_list
from .content_commands import content_inspect, content_list, content_schema_check
from .node_delegate import delegate_or_raise
from .catalog import (
    assert_reference_catalog_plan_safety,
    build_prepared_reference_catalog,
    build_reference_catalog_registration_records,
    catalog_items,
)
from .corpora import (
    build_corpus_status,
    build_corpus_sync_plan,
    next_corpus_bootstrap_command,
    print_corpus_status,
    print_corpus_worker_bootstrap,
    run_or_print_corpus_sync_plan,
)
from .env import PAPYRUS_ROOT, graphql_endpoint, load_dotenv, storage_bucket_from_amplify_outputs
from .graphql_authoring import create_authoring_client
from .ids import knowledge_corpus_id
from .newsroom_summary import (
    update_newsroom_summary_after_assignment_creates,
    update_newsroom_summary_after_reference_registration,
)
from .options import normalize_non_negative_integer, normalize_string, parse_boolean_option, parse_options
from .records import apply_record_changes, build_record_changes
from .reference_policy import (
    normalize_reference_curation_status,
    normalize_reference_rejection_reason_code,
)
from .source_readiness import (
    SOURCE_READINESS_STATES,
    SOURCE_TEXT_STATES,
    build_extraction_index,
    build_reference_source_status_rows,
    reference_source_readiness,
)
from .steering import (
    load_steering_config,
    require_corpus_config,
    require_steering_config,
    resolve_classifier_for_corpus,
    selected_corpus_configs,
)

PORTED_COMMANDS = frozenset(
    {
        "content:inspect",
        "content:schema-check",
        "content:list",
        "corpora:status",
        "corpora:worker-bootstrap",
        "corpora:sync-from-cloud",
        "corpora:sync-to-cloud",
        "references:make-catalog",
        "references:prepare-catalog",
        "references:register-catalog",
        "references:register-catalog-split",
        "references:source-status",
        "references:create-accession-assignments",
        "references:accession-now",
        "assignments:list",
        "analysis:profiles",
        "analysis:validate-profiles",
    }
)


def is_ported_command(group: str, command: str) -> bool:
    return f"{group}:{command}" in PORTED_COMMANDS


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = list(argv if argv is not None else sys.argv[1:])
    if len(args) < 2:
        print_usage()
        return 1
    group, command, *rest = args
    try:
        dispatch(group, command, rest)
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


def dispatch(group: str, command: str, flags: list[str]) -> None:
    route = f"{group}:{command}"
    if not is_ported_command(group, command):
        delegate_or_raise(group, command, flags)
        return
    if route == "content:inspect":
        content_inspect(flags)
    elif route == "content:schema-check":
        content_schema_check(flags)
    elif route == "content:list":
        positional = [token for token in flags if not token.startswith("--")]
        content_list(positional[0] if positional else None, flags)
    elif route == "corpora:status":
        corpora_status(flags)
    elif route == "corpora:worker-bootstrap":
        corpora_worker_bootstrap(flags)
    elif route == "corpora:sync-from-cloud":
        corpora_sync(flags, direction="from-cloud")
    elif route == "corpora:sync-to-cloud":
        corpora_sync(flags, direction="to-cloud")
    elif route == "references:make-catalog":
        references_make_catalog(flags)
    elif route == "references:prepare-catalog":
        references_prepare_catalog(flags)
    elif route == "references:register-catalog":
        references_register_catalog(flags)
    elif route == "references:register-catalog-split":
        references_register_catalog_split(flags)
    elif route == "references:source-status":
        references_source_status(flags)
    elif route == "references:create-accession-assignments":
        references_create_accession_assignments(flags)
    elif route == "references:accession-now":
        references_accession_now(flags)
    elif route == "assignments:list":
        assignments_list(flags)
    elif route == "analysis:profiles":
        analysis_profiles(flags)
    elif route == "analysis:validate-profiles":
        validate_analysis_profiles(flags)
    else:
        raise ValueError(f"Unsupported papyrus-content command: {group} {command}")


def corpora_status(flags: list[str]) -> None:
    options = parse_options(flags)
    steering_config = require_steering_config(options.get("config"))
    client, _ = create_authoring_client()
    graph_state = load_corpus_graph_state(client)
    statuses = [
        build_corpus_status(
            corpus,
            graph_state=graph_state,
            endpoint=graphql_endpoint(),
            force=bool(options.get("force")),
        )
        for corpus in selected_corpus_configs(steering_config, options.get("corpus-key"))
    ]
    payload = {
        "ok": all(status["readiness"]["readyForWorker"] for status in statuses),
        "command": "corpora status",
        "endpoint": graphql_endpoint(),
        "expectedBucket": storage_bucket_from_amplify_outputs(),
        "configPath": steering_config["configPath"],
        "corpora": statuses,
    }
    if options.get("json"):
        print(json.dumps(payload, indent=2))
    else:
        print_corpus_status(payload)


def corpora_worker_bootstrap(flags: list[str]) -> None:
    options = parse_options(flags)
    steering_config = require_steering_config(options.get("config"))
    client, _ = create_authoring_client()
    graph_state = load_corpus_graph_state(client)
    statuses = []
    for corpus in selected_corpus_configs(steering_config, options.get("corpus-key")):
        status = build_corpus_status(
            corpus,
            graph_state=graph_state,
            endpoint=graphql_endpoint(),
            force=bool(options.get("force")),
        )
        status["next"] = next_corpus_bootstrap_command(status)
        statuses.append(status)
    payload = {
        "ok": all(status["target"]["ok"] and status["local"]["exists"] for status in statuses),
        "command": "corpora worker-bootstrap",
        "endpoint": graphql_endpoint(),
        "expectedBucket": storage_bucket_from_amplify_outputs(),
        "configPath": steering_config["configPath"],
        "corpora": statuses,
    }
    if options.get("json"):
        print(json.dumps(payload, indent=2))
    else:
        print_corpus_worker_bootstrap(payload)


def corpora_sync(flags: list[str], *, direction: str) -> None:
    options = parse_options(flags)
    if not options.get("corpus-key"):
        raise ValueError(f"corpora sync-{direction.replace('_', '-')} requires --corpus-key <key>.")
    steering_config = require_steering_config(options.get("config"))
    corpus = require_corpus_config(steering_config, options["corpus-key"], "--corpus-key")
    plan = build_corpus_sync_plan(corpus, direction=direction, options=options)
    run_or_print_corpus_sync_plan(plan, options)


def references_make_catalog(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("input"):
        raise ValueError("references make-catalog requires --input <sources.txt|sources.md>.")
    if not options.get("output"):
        raise ValueError("references make-catalog requires --output <catalog.json>.")
    text = Path(options["input"]).read_text(encoding="utf-8")
    url_regex = re.compile(r"(https?://[^\s)]+)(?:\))?")
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        for match in url_regex.finditer(line):
            url = match.group(1).strip()
            if not url or url in seen:
                continue
            seen.add(url)
            before = line.split(url, 1)[0].strip(" \t>-*0123456789.:—")
            items.append({"source_uri": url, "title": before or None})
    catalog = {"schema_version": 1, "items": items}
    Path(options["output"]).write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"references\tmake-catalog\t{len(items)}\t{options['output']}")


def references_prepare_catalog(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("catalog"):
        raise ValueError("references prepare-catalog requires --catalog <catalog.json>.")
    if not options.get("output"):
        raise ValueError("references prepare-catalog requires --output <prepared-catalog.json>.")
    if not options.get("corpus-key"):
        raise ValueError("references prepare-catalog requires --corpus-key <key>.")
    steering_config = require_steering_config(options.get("config"))
    corpus_config = require_corpus_config(steering_config, options["corpus-key"], "--corpus-key")
    catalog = load_json_file(options["catalog"])
    prepared = build_prepared_reference_catalog(
        catalog,
        {
            "corpusConfig": corpus_config,
            "corpusKey": options["corpus-key"],
            "publicationName": steering_config["publication"]["name"],
        },
    )
    write_json_file(options["output"], prepared)
    items = catalog_items(prepared)
    rationale_count = sum(1 for item in items if item.get("ingestion_rationale") or item.get("ingestionRationale"))
    print(
        f"references\tprepare-catalog\t{options['corpus-key']}\t{options['output']}\t"
        f"{len(items)} items\t{rationale_count} rationales"
    )


def references_register_catalog(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("catalog"):
        raise ValueError("references register-catalog requires --catalog <catalog.json>.")
    if not options.get("corpus-key"):
        raise ValueError("references register-catalog requires --corpus-key <key>.")
    client, _ = create_authoring_client()
    result = plan_reference_catalog_registration(client, options)
    print_reference_registration_summary(result["plan"], result["changes"], apply=bool(options.get("apply")))
    if not options.get("apply"):
        print("references\tregister-catalog\tapply\tskipped\tpass --apply to write Reference visibility records")
        return
    apply_record_changes(client, result["changes"])
    update_newsroom_summary_after_reference_registration(client, result["changes"], result["plan"])
    for line in sync_reference_vectors_after_registration(result, options).get("lines", []):
        print(line)


def references_register_catalog_split(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("catalog"):
        raise ValueError("references register-catalog-split requires --catalog <catalog.json>.")
    steering_config = require_steering_config(options.get("config"))
    research_key = options.get("research-corpus-key") or steering_config["canonicalTopicSet"]["corpusKey"]
    news_key = options.get("news-corpus-key") or "AI-ML-journalism"
    catalog = maybe_enrich_reference_catalog_title_subtitle(load_json_file(options["catalog"]), options)
    items = catalog_items(catalog)
    buckets = {"research": [], "news": []}
    for item in items:
        bucket = infer_reference_corpus_bucket(item)
        buckets["research" if bucket == "research" else "news"].append(item)
    client, _ = create_authoring_client()
    for bucket_name, corpus_key, bucket_items in (
        ("research", research_key, buckets["research"]),
        ("news", news_key, buckets["news"]),
    ):
        if not bucket_items:
            continue
        bucket_options = dict(options)
        bucket_options["corpus-key"] = corpus_key
        bucket_catalog = {**catalog, "items": bucket_items}
        write_json_file(
            str(Path(tempfile.gettempdir()) / f"papyrus-register-{bucket_name}.json"),
            bucket_catalog,
        )
        result = plan_reference_catalog_registration(
            client,
            {
                **bucket_options,
                "catalog": bucket_catalog,
            },
        )
        print(
            f"references\tregister-catalog-split\tbucket\t{bucket_name}\tcorpus\t{corpus_key}\t"
            f"items\t{result['plan']['itemCount']}\tapply\t{'yes' if options.get('apply') else 'no'}"
        )
        print_reference_registration_summary(result["plan"], result["changes"], apply=bool(options.get("apply")))
        if options.get("apply"):
            apply_record_changes(client, result["changes"])
            update_newsroom_summary_after_reference_registration(client, result["changes"], result["plan"])
            for line in sync_reference_vectors_after_registration(result, options).get("lines", []):
                print(line)


def references_source_status(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("corpus-key"):
        raise ValueError("references source-status requires --corpus-key <key>.")
    steering_config = load_steering_config(options.get("config")) or require_steering_config()
    corpus_config = require_corpus_config(steering_config, options["corpus-key"], "--corpus-key")
    corpus_id = knowledge_corpus_id(corpus_config)
    status = normalize_source_status_filter(options.get("status"))
    client, _ = create_authoring_client()
    references = client.list_records("Reference")
    attachments = client.list_records("ReferenceAttachment")
    extraction_index = build_extraction_index(corpus_config.get("path"))
    rows = build_reference_source_status_rows(
        references=references,
        attachments=attachments,
        corpus_id=corpus_id,
        curation_status=status,
        extraction_index=extraction_index,
    )
    counts: dict[str, int] = {}
    text_counts: dict[str, int] = {}
    for row in rows:
        counts[row["state"]] = counts.get(row["state"], 0) + 1
        text_state = row["readiness"].get("textState") or SOURCE_TEXT_STATES["NOT_APPLICABLE"]
        text_counts[text_state] = text_counts.get(text_state, 0) + 1
    limit = normalize_non_negative_integer(options.get("limit"), "--limit")
    if limit is None:
        limit = 50
    selected = rows if limit == 0 else rows[:limit]
    print(f"references\tsource-status\tcorpus\t{corpus_id}")
    print(f"references\tsource-status\tstatus\t{status}")
    for state in SOURCE_READINESS_STATES.values():
        print(f"references\tsource-status\t{state}\t{counts.get(state, 0)}")
    for state in SOURCE_TEXT_STATES.values():
        print(f"references\tsource-status\t{state}\t{text_counts.get(state, 0)}")
    print(f"references\tsource-status\textraction-snapshots\t{len(extraction_index.snapshot_ids)}")
    print(f"references\tsource-status\trows\t{len(rows)}")
    for row in selected:
        reference = row["reference"]
        print(
            "\t".join(
                [
                    "reference-source",
                    row["state"],
                    row["readiness"].get("textState") or SOURCE_TEXT_STATES["NOT_APPLICABLE"],
                    reference.get("curationStatus") or "-",
                    reference.get("id") or "-",
                    reference.get("externalItemId") or "-",
                    row["readiness"].get("storagePath") or "-",
                    row["readiness"].get("textStoragePath") or "-",
                    reference.get("sourceUri") or "-",
                    next_reference_source_command(row),
                    reference.get("title") or "-",
                ]
            )
        )
    if len(rows) > len(selected):
        print(f"references\tsource-status\tomitted\t{len(rows) - len(selected)}\tpass --limit {len(rows)} to print every row")


def references_create_accession_assignments(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("corpus-key"):
        raise ValueError("references create-accession-assignments requires --corpus-key <key>.")
    steering_config = load_steering_config(options.get("config")) or require_steering_config()
    corpus_config = require_corpus_config(steering_config, options["corpus-key"], "--corpus-key")
    corpus_id = knowledge_corpus_id(corpus_config)
    status = normalize_source_status_filter(options.get("status") or "pending")
    if status == "all":
        raise ValueError(
            "references create-accession-assignments requires --status pending|accepted|rejected|archived, not all."
        )
    client, _ = create_authoring_client()
    references = client.list_records("Reference")
    attachments = client.list_records("ReferenceAttachment")
    assignments = client.list_records("Assignment")
    rows = build_reference_source_status_rows(
        references=references,
        attachments=attachments,
        corpus_id=corpus_id,
        curation_status=status,
        extraction_index=None,
    )
    rows = [row for row in rows if row["state"] == SOURCE_READINESS_STATES["URL_ONLY"]]
    now = _utc_now()
    actor_label = normalize_string(options.get("actor")) or "Papyrus content CLI"
    records = build_reference_accession_assignment_records(
        rows,
        corpus_config=corpus_config,
        corpus_id=corpus_id,
        assignments=assignments,
        actor_label=actor_label,
        now=now,
    )
    changes = build_record_changes(client, records)
    print_reference_accession_assignment_summary(rows, changes, apply=bool(options.get("apply")))
    if not options.get("apply"):
        print("references\tcreate-accession-assignments\tapply\tskipped\tpass --apply to write Assignment records")
        return
    apply_record_changes(client, changes)
    update_newsroom_summary_after_assignment_creates(
        client,
        changes,
        actor_label=actor_label,
        reason=f"references create-accession-assignments {corpus_id}",
    )


def references_accession_now(flags: list[str]) -> None:
    options = parse_options(flags)
    if not options.get("reference"):
        raise ValueError("references accession-now requires --reference <reference-id>.")
    client, auth = create_authoring_client()
    references = client.list_records("Reference")
    reference = find_reference_for_source_accession(references, options["reference"])
    if not reference:
        raise ValueError(f"Reference {options['reference']} was not found.")
    steering_config = load_steering_config(options.get("config")) or require_steering_config()
    corpus_config = require_corpus_config_by_id_or_key(
        steering_config,
        reference["corpusId"],
        options.get("corpus-key"),
    )
    corpus_id = knowledge_corpus_id(corpus_config)
    attachments = client.list_records("ReferenceAttachment")
    assignments = client.list_records("Assignment")
    readiness = reference_source_readiness(reference, attachments, None)
    if readiness["state"] != SOURCE_READINESS_STATES["URL_ONLY"]:
        raise ValueError(
            f"Reference {reference['id']} is {readiness['state']}, not url_only; accession is only needed for URL-only source material."
        )
    rows = [{"reference": reference, "readiness": readiness, "state": readiness["state"]}]
    now = _utc_now()
    actor_label = (
        normalize_string(options.get("assignee-key"))
        or normalize_string(options.get("assignee"))
        or normalize_string(options.get("actor"))
        or "Papyrus content CLI"
    )
    records = build_reference_accession_assignment_records(
        rows,
        corpus_config=corpus_config,
        corpus_id=corpus_id,
        assignments=assignments,
        actor_label=actor_label,
        now=now,
    )
    changes = build_record_changes(client, records)
    if any(change.get("action") != "noop" for change in changes):
        apply_record_changes(client, changes)
        update_newsroom_summary_after_assignment_creates(
            client,
            changes,
            actor_label=actor_label,
            reason=f"references accession-now create {reference['id']}",
        )
    assignment_id = reference_accession_assignment_id(reference, corpus_id)
    apply_assignment_action(
        client,
        auth_claims=auth,
        action="claim",
        assignment_id=assignment_id,
        options=options,
        actor_label=actor_label,
    )
    assignment = client.get_record("Assignment", assignment_id)
    if not assignment:
        raise ValueError(f"Assignment {assignment_id} was not found after planning.")
    execution = execute_reference_accession_assignment(client, assignment, options)
    apply_assignment_action(
        client,
        auth_claims=auth,
        action="complete",
        assignment_id=assignment_id,
        options=options,
        actor_label=actor_label,
    )
    print(f"reference-accession-now\tassignment\t{assignment_id}")
    print(f"reference-accession-now\trun\t{execution['runId']}")
    print(f"reference-accession-now\tmanifest\t{execution['manifestPath']}")
    print(f"reference-accession-now\tstorage-path\t{execution.get('storagePath') or '-'}")


def plan_reference_catalog_registration(client, options: dict[str, Any]) -> dict[str, Any]:
    steering_config = load_steering_config(options.get("config")) or require_steering_config()
    corpus_config = require_corpus_config(steering_config, options["corpus-key"], "--corpus-key")
    catalog_path = options.get("catalog")
    catalog = maybe_enrich_reference_catalog_title_subtitle(
        load_json_file(catalog_path) if catalog_path else options["catalog"],
        options,
        persist=bool(options.get("apply") and catalog_path),
    )
    if options.get("skip-existing", True) is not False and str(options.get("skip-existing", "true")).lower() != "false":
        existing = client.list_records("Reference")
        corpus_id = knowledge_corpus_id(corpus_config)
        existing_ids = {
            ref["externalItemId"]
            for ref in existing
            if ref.get("corpusId") == corpus_id and ref.get("externalItemId")
        }
        filtered = [
            item
            for item in catalog_items(catalog)
            if (item.get("item_id") or item.get("externalItemId") or item.get("id")) not in existing_ids
        ]
        skipped = len(catalog_items(catalog)) - len(filtered)
        if skipped:
            print(f"references\tregister-catalog\tskip-existing\t{skipped} duplicates")
        catalog = {**catalog, "items": filtered}
    plan_options = {
        "corpusConfig": corpus_config,
        "corpusId": knowledge_corpus_id(corpus_config),
        "classifierId": options.get("classifier") or resolve_classifier_for_corpus(steering_config, corpus_config, None),
        "status": normalize_reference_curation_status(options.get("status"), "pending"),
        "reasonCode": normalize_reference_rejection_reason_code(
            options.get("reason-code") or options.get("reasonCode"),
            required=normalize_reference_curation_status(options.get("status"), "pending") == "rejected",
        ),
        "note": options.get("note"),
        "ingestionRationale": options.get("ingestion-rationale") or options.get("ingestionRationale"),
        "actor": options.get("actor") or "Papyrus content CLI",
    }
    plan = build_reference_catalog_registration_records(catalog, plan_options)
    existing_run = client.get_record("KnowledgeImportRun", plan["importRunId"])
    if existing_run and existing_run.get("importedAt"):
        plan = build_reference_catalog_registration_records(
            catalog,
            {**plan_options, "importedAt": existing_run["importedAt"]},
        )
    assert_reference_catalog_plan_safety(plan)
    changes = build_record_changes(client, plan["records"])
    return {"plan": plan, "changes": changes, "corpusConfig": corpus_config, "options": options}


def print_reference_registration_summary(plan: dict[str, Any], changes: list[dict[str, Any]], *, apply: bool) -> None:
    action_counts = {"create": 0, "update": 0, "noop": 0}
    for change in changes:
        action_counts[change.get("action", "noop")] = action_counts.get(change.get("action", "noop"), 0) + 1
    print(f"references\tregister-catalog\timport-run\t{plan['importRunId']}")
    print(f"references\tregister-catalog\titems\t{plan['itemCount']}")
    print(
        f"references\tregister-catalog\tsummary\tcreate={action_counts['create']}\t"
        f"update={action_counts['update']}\tnoop={action_counts['noop']}"
    )
    print(f"references\tregister-catalog\tapply\t{'yes' if apply else 'no'}")


def sync_reference_vectors_after_registration(result: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    if parse_boolean_option(options.get("vector-sync"), True, "--vector-sync") is False:
        return {"lines": ["references\tvector-sync\tdisabled"]}
    reference_ids = sorted(
        {
            change["expected"].get("lineageId") or change["expected"].get("id")
            for change in result["changes"]
            if change.get("modelName") == "Reference" and change.get("action") in {"create", "update"}
        }
    )
    if not reference_ids:
        return {"lines": ["references\tvector-sync\tskipped\tno GraphQL Reference changes"]}
    lines = []
    for index in range(0, len(reference_ids), 100):
        batch = reference_ids[index : index + 100]
        args = [
            "run",
            "papyrus-newsroom",
            "knowledge-vector-index",
            "--action",
            "sync",
            "--force",
            "--progress-every",
            "0",
            *sum([["--reference-id", reference_id] for reference_id in batch], []),
        ]
        completed = subprocess.run(["poetry", *args], cwd=PAPYRUS_ROOT, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            message = completed.stderr.strip() or completed.stdout.strip() or "vector sync failed"
            lines.append(f"references\tvector-sync\tfailed\t{len(batch)}\t{message}")
            raise RuntimeError(f"Reference registration updated GraphQL state but vector sync failed: {message}")
        lines.append(f"references\tvector-sync\tsynced\t{len(batch)}")
    return {"lines": lines}


def maybe_enrich_reference_catalog_title_subtitle(
    catalog: dict[str, Any],
    options: dict[str, Any],
    *,
    persist: bool = False,
) -> dict[str, Any]:
    if parse_boolean_option(options.get("title-subtitle-enrichment"), True, "--title-subtitle-enrichment") is False:
        return catalog
    with tempfile.TemporaryDirectory(prefix="papyrus-title-subtitle-") as temp_dir:
        input_path = Path(temp_dir) / "catalog-input.json"
        output_path = Path(temp_dir) / "catalog-output.json"
        input_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
        args = [
            "run",
            "papyrus-newsroom",
            "references",
            "title-subtitle",
            "enrich-catalog",
            "--catalog",
            str(input_path),
            "--output",
            str(output_path),
            "--model",
            normalize_string(options.get("title-subtitle-model")) or "gpt-5.4-mini",
            "--web-search",
            str(parse_boolean_option(options.get("title-subtitle-web-search"), True, "--title-subtitle-web-search")),
            "--only-missing",
            str(parse_boolean_option(options.get("title-subtitle-only-missing"), True, "--title-subtitle-only-missing")),
        ]
        completed = subprocess.run(["poetry", *args], cwd=PAPYRUS_ROOT, check=False)
        if completed.returncode != 0:
            raise RuntimeError(f"Reference title/subtitle enrichment failed: {completed.stderr or completed.stdout}")
        enriched = load_json_file(str(output_path))
        if persist and options.get("catalog"):
            write_json_file(str(options["catalog"]), enriched)
        return enriched


def infer_reference_corpus_bucket(item: dict[str, Any]) -> str:
    source_uri = normalize_string(item.get("source_uri") or item.get("sourceUri") or item.get("url")) or ""
    media_type = normalize_string(item.get("media_type") or item.get("mediaType")) or ""
    host = ""
    pathname = ""
    try:
        from urllib.parse import urlparse

        parsed = urlparse(source_uri)
        host = parsed.hostname or ""
        pathname = parsed.path.lower()
    except ValueError:
        pass
    uri = source_uri.lower()
    if media_type == "application/pdf" or uri.endswith(".pdf") or pathname.endswith(".pdf"):
        return "research"
    research_hosts = {
        "arxiv.org",
        "aclanthology.org",
        "openreview.net",
        "proceedings.neurips.cc",
        "neurips.cc",
        "dl.acm.org",
        "doi.org",
        "pmc.ncbi.nlm.nih.gov",
        "drops.dagstuhl.de",
    }
    if host in research_hosts or host.endswith(".ijcai.org"):
        return "research"
    if host.endswith("nature.com") and "/articles/" in pathname:
        return "research"
    return "news"


def load_corpus_graph_state(client) -> dict[str, Any]:
    return {
        "corpora": client.list_records("KnowledgeCorpus"),
        "references": client.list_records("Reference"),
        "referenceAttachments": client.list_records("ReferenceAttachment"),
        "importRuns": client.list_records("KnowledgeImportRun"),
    }


def normalize_source_status_filter(value: Any) -> str:
    normalized = str(value or "all").strip().lower()
    if normalized in {"pending", "accepted", "rejected", "archived", "all"}:
        return normalized
    raise ValueError("--status must be pending, accepted, rejected, archived, or all.")


def load_json_file(path: str) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return payload


def write_json_file(path: str, payload: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def print_usage() -> None:
    print("Usage: poetry run papyrus-content <group> <command> [options]")
    print("Python-native: content inspect, content schema-check, content list articles,")
    print("  corpora status/worker-bootstrap/sync-*, references catalog/accession commands,")
    print("  assignments list, analysis profiles/validate-profiles")
    print("All other routes delegate to scripts/content-cli.cjs (Node).")
