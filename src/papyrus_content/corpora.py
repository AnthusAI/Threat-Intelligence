from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .catalog import catalog_items
from .env import PAPYRUS_ROOT, graphql_endpoint, storage_bucket_from_amplify_outputs
from .ids import knowledge_corpus_id
from .options import parse_boolean_option
from .reference_policy import normalize_reference_curation_status
from .source_readiness import SOURCE_READINESS_STATES, text_storage_path_for_reference


def build_corpus_status(
    corpus: dict[str, Any],
    *,
    graph_state: dict[str, Any],
    endpoint: str,
    force: bool = False,
) -> dict[str, Any]:
    corpus_id = knowledge_corpus_id(corpus)
    local_catalog = read_local_corpus_catalog_summary(corpus)
    s3_catalog = read_s3_corpus_catalog_summary(corpus)
    graph = graph_corpus_summary(corpus, corpus_id, graph_state)
    expected_bucket = storage_bucket_from_amplify_outputs()
    parsed_prefix = parse_s3_uri(corpus.get("s3Prefix"))
    configured_bucket = parsed_prefix["bucket"] if parsed_prefix else None
    target_ok = bool(force or not expected_bucket or not configured_bucket or expected_bucket == configured_bucket)
    issues: list[str] = []
    if not target_ok:
        issues.append("wrong_bucket_for_endpoint")
    if not local_catalog["exists"]:
        issues.append("missing_local_catalog")
    if not s3_catalog["exists"]:
        issues.append("missing_s3_catalog")
    if local_catalog["exists"] and s3_catalog["exists"] and local_catalog["sha256"] != s3_catalog["sha256"]:
        issues.append("local_not_synced_to_s3")
    if s3_catalog["exists"] and graph["references"]["total"] != s3_catalog["items"]:
        issues.append("s3_not_registered_in_graphql")
    if graph["references"]["accepted"] == 0:
        issues.append("accepted_manifest_not_ready")
    if graph["references"]["accepted"] > 0 and graph["acceptedWithExtractedText"] < graph["references"]["accepted"]:
        issues.append("missing_extracted_text")
    return {
        "key": corpus["key"],
        "corpusId": corpus_id,
        "role": corpus.get("role"),
        "localPath": corpus.get("path"),
        "s3Prefix": corpus.get("s3Prefix"),
        "target": {
            "endpoint": endpoint,
            "expectedBucket": expected_bucket,
            "configuredBucket": configured_bucket,
            "ok": target_ok,
        },
        "local": local_catalog,
        "s3": s3_catalog,
        "graph": graph,
        "issues": issues,
        "readiness": {
            "readyForWorker": not issues,
            "readyForGraphqlRegistration": target_ok
            and local_catalog["exists"]
            and s3_catalog["exists"]
            and local_catalog["sha256"] == s3_catalog["sha256"],
            "readyForAcceptedAnalysis": graph["references"]["accepted"] > 0
            and graph["acceptedWithExtractedText"] == graph["references"]["accepted"],
        },
    }


def graph_corpus_summary(corpus: dict[str, Any], corpus_id: str, graph_state: dict[str, Any]) -> dict[str, Any]:
    corpus_record = next((entry for entry in graph_state["corpora"] if entry.get("id") == corpus_id), None)
    references = [reference for reference in graph_state["references"] if reference.get("corpusId") == corpus_id]
    import_runs = [run for run in graph_state["importRuns"] if run.get("corpusId") == corpus_id]
    current_references = [reference for reference in references if reference.get("versionState") == "current"]
    reference_ids = {reference["id"] for reference in current_references}
    reference_lineage_ids = {reference.get("lineageId") for reference in current_references if reference.get("lineageId")}
    attachments = [
        attachment
        for attachment in graph_state["referenceAttachments"]
        if attachment.get("referenceId") in reference_ids
        or attachment.get("referenceLineageId") in reference_lineage_ids
    ]
    accepted = [
        reference
        for reference in current_references
        if normalize_reference_curation_status(reference.get("curationStatus"), "pending") == "accepted"
    ]
    accepted_with_text = sum(
        1 for reference in accepted if text_storage_path_for_reference(reference, attachments)
    )
    by_status: dict[str, int] = {}
    for reference in current_references:
        status = normalize_reference_curation_status(reference.get("curationStatus"), "pending")
        by_status[status] = by_status.get(status, 0) + 1
    latest_import = sorted(import_runs, key=lambda run: str(run.get("importedAt") or ""), reverse=True)
    return {
        "corpusExists": bool(corpus_record),
        "itemCount": (corpus_record or {}).get("itemCount"),
        "importRuns": len(import_runs),
        "latestImportRunId": latest_import[0]["id"] if latest_import else None,
        "references": {
            "total": len(current_references),
            "byStatus": by_status,
            "accepted": len(accepted),
        },
        "referenceAttachments": len(attachments),
        "acceptedWithExtractedText": accepted_with_text,
    }


def read_local_corpus_catalog_summary(corpus: dict[str, Any]) -> dict[str, Any]:
    from .corpus_storage_paths import default_corpus_path

    catalog_path = Path(default_corpus_path(corpus)) / "metadata" / "catalog.json"
    if not catalog_path.exists():
        return {
            "exists": False,
            "path": str(catalog_path),
            "items": 0,
            "bytes": 0,
            "sha256": None,
            "updatedAt": None,
        }
    body = catalog_path.read_bytes()
    parsed = json.loads(body.decode("utf-8"))
    return {
        "exists": True,
        "path": str(catalog_path),
        "items": len(catalog_items(parsed)),
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "updatedAt": catalog_path.stat().st_mtime,
    }


def read_s3_corpus_catalog_summary(corpus: dict[str, Any]) -> dict[str, Any]:
    parsed_prefix = parse_s3_uri(corpus.get("s3Prefix"))
    if not parsed_prefix:
        return {"exists": False, "uri": None, "items": 0, "bytes": 0, "sha256": None, "updatedAt": None}
    key = f"{parsed_prefix['key'].rstrip('/')}/metadata/catalog.json".lstrip("/")
    uri = f"s3://{parsed_prefix['bucket']}/{key}"
    result = subprocess.run(
        ["aws", "s3", "cp", uri, "-"],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        error = (result.stderr or result.stdout or b"").decode("utf-8", errors="replace").strip() or "s3_catalog_unavailable"
        return {"exists": False, "uri": uri, "items": 0, "bytes": 0, "sha256": None, "updatedAt": None, "error": error}
    body = result.stdout
    parsed = json.loads(body.decode("utf-8"))
    return {
        "exists": True,
        "uri": uri,
        "items": len(catalog_items(parsed)),
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "updatedAt": None,
    }


def build_corpus_sync_plan(corpus: dict[str, Any], *, direction: str, options: dict[str, Any]) -> dict[str, Any]:
    parsed_prefix = parse_s3_uri(corpus.get("s3Prefix"))
    if not parsed_prefix:
        raise ValueError(f"Corpus {corpus['key']} does not define a valid s3Prefix.")
    from .corpus_storage_paths import default_corpus_path

    local_path = default_corpus_path(corpus)
    s3_uri = normalized_s3_uri(corpus["s3Prefix"])
    expected_bucket = storage_bucket_from_amplify_outputs()
    if not options.get("force") and expected_bucket and parsed_prefix["bucket"] != expected_bucket:
        raise ValueError(
            f"Refusing {direction}: corpus {corpus['key']} points at bucket {parsed_prefix['bucket']}, "
            f"but amplify_outputs.json expects {expected_bucket}."
        )
    args = ["s3", "sync"]
    if direction == "from-cloud":
        args.extend([s3_uri, local_path])
    else:
        args.extend([local_path, s3_uri])
    args.extend(["--exclude", ".DS_Store", "--exclude", "*/.DS_Store"])
    if not options.get("include-analysis"):
        args.extend(["--exclude", "analysis/*", "--exclude", "*/analysis/*"])
    if options.get("delete"):
        args.append("--delete")
    dry_run = parse_boolean_option(options.get("dry-run"), default=False, label="--dry-run")
    if dry_run:
        args.append("--dryrun")
    return {
        "command": f"corpora {'sync-from-cloud' if direction == 'from-cloud' else 'sync-to-cloud'}",
        "corpusKey": corpus["key"],
        "localPath": local_path,
        "s3Uri": s3_uri,
        "expectedBucket": expected_bucket,
        "configuredBucket": parsed_prefix["bucket"],
        "mode": "dry-run" if dry_run else "apply",
        "args": args,
    }


def corpus_sync_from_cloud_decision(
    corpus: dict[str, Any],
    *,
    force: bool = False,
) -> tuple[bool, str, dict[str, Any]]:
    local = read_local_corpus_catalog_summary(corpus)
    s3 = read_s3_corpus_catalog_summary(corpus)
    snapshot = {"local": local, "s3": s3}
    if force:
        if not s3["exists"]:
            return False, "missing_s3_catalog", snapshot
        return True, "forced", snapshot
    if not local["exists"]:
        if not s3["exists"]:
            return False, "missing_s3_catalog", snapshot
        return True, "missing_local_catalog", snapshot
    if not s3["exists"]:
        return False, "missing_s3_catalog", snapshot
    if local["sha256"] != s3["sha256"]:
        return True, "local_not_synced_to_s3", snapshot
    return False, "already_synced", snapshot


def maybe_sync_corpus_from_cloud_before_analysis(
    *,
    steering_config: dict[str, Any],
    corpus_key: str,
    options: dict[str, Any],
    log_prefix: str = "analysis",
) -> dict[str, Any]:
    from .steering import require_corpus_config

    corpus = require_corpus_config(steering_config, corpus_key, "--corpus-key")
    force = parse_boolean_option(options.get("sync-from-cloud"), default=False, label="--sync-from-cloud")
    skip = parse_boolean_option(options.get("skip-sync-from-cloud"), default=False, label="--skip-sync-from-cloud")
    if skip:
        print(f"{log_prefix}\tsync-from-cloud\tskipped\t--skip-sync-from-cloud", flush=True)
        return {"skipped": True, "reason": "skip-sync-from-cloud", "corpusKey": corpus_key}

    needed, reason, catalogs = corpus_sync_from_cloud_decision(corpus, force=force)
    if not needed:
        print(f"{log_prefix}\tsync-from-cloud\tskipped\t{reason}", flush=True)
        return {
            "skipped": True,
            "reason": reason,
            "corpusKey": corpus_key,
            "localItems": catalogs["local"].get("items"),
            "s3Items": catalogs["s3"].get("items"),
        }

    sync_options = dict(options)
    if parse_boolean_option(options.get("dry-run"), default=False, label="--dry-run"):
        sync_options["dry-run"] = True
    plan = build_corpus_sync_plan(corpus, direction="from-cloud", options=sync_options)
    print(
        f"{log_prefix}\tsync-from-cloud\tstart\treason={reason}\t"
        f"corpus={corpus_key}\tlocalItems={catalogs['local'].get('items')}\t"
        f"s3Items={catalogs['s3'].get('items')}",
        flush=True,
    )
    run_or_print_corpus_sync_plan(plan, sync_options)
    print(f"{log_prefix}\tsync-from-cloud\tcomplete\tcorpus={corpus_key}\tmode={plan['mode']}", flush=True)
    return {
        "skipped": False,
        "reason": reason,
        "corpusKey": corpus_key,
        "plan": plan,
        "localItems": catalogs["local"].get("items"),
        "s3Items": catalogs["s3"].get("items"),
    }


def run_or_print_corpus_sync_plan(plan: dict[str, Any], options: dict[str, Any]) -> None:
    if options.get("json"):
        if plan["mode"] == "apply":
            result = subprocess.run(["aws", *plan["args"]], capture_output=True, text=True, check=False)
            print(json.dumps({
                "ok": result.returncode == 0,
                "command": plan["command"],
                "corpusKey": plan["corpusKey"],
                "mode": plan["mode"],
                "localPath": plan["localPath"],
                "s3Uri": plan["s3Uri"],
                "status": result.returncode,
            }))
            if result.returncode != 0:
                raise SystemExit(result.returncode)
            return
        print(json.dumps({
            "ok": True,
            "command": plan["command"],
            "corpusKey": plan["corpusKey"],
            "mode": plan["mode"],
            "localPath": plan["localPath"],
            "s3Uri": plan["s3Uri"],
            "args": ["aws", *plan["args"]],
        }))
        return

    command_name = plan["command"].split(" ", 1)[1]
    print(f"corpora\t{command_name}\tcorpus\t{plan['corpusKey']}")
    print(f"corpora\t{command_name}\tmode\t{plan['mode']}")
    print(f"corpora\t{command_name}\tlocal\t{plan['localPath']}")
    print(f"corpora\t{command_name}\ts3\t{plan['s3Uri']}")
    print(f"corpora\t{command_name}\tcommand\taws {' '.join(_shell_quote(arg) for arg in plan['args'])}")
    result = subprocess.run(["aws", *plan["args"]], check=False)
    if result.returncode != 0:
        raise RuntimeError(f"aws {' '.join(plan['args'])} failed with status {result.returncode}.")


def next_corpus_bootstrap_command(status: dict[str, Any]) -> str:
    if not status["target"]["ok"]:
        return "generate a sandbox steering config or pass the correct --config for this endpoint"
    if not status["local"]["exists"] or status["local"]["sha256"] != status["s3"]["sha256"]:
        return (
            f"poetry run papyrus ops corpora sync-from-cloud --config <steering.yml> "
            f"--corpus-key {status['key']} --dry-run"
        )
    if status["graph"]["references"]["total"] != status["s3"]["items"]:
        return (
            f"poetry run papyrus references create-from-catalog --config <steering.yml> "
            f"--corpus-key {status['key']} --catalog {status['local']['path']}"
        )
    if not status["readiness"]["readyForAcceptedAnalysis"]:
        return (
            f"poetry run papyrus references process-status --config <steering.yml> "
            f"--corpus-key {status['key']} --status accepted"
        )
    return (
        "poetry run papyrus analysis create-reindex-assignment --config <steering.yml> "
        f"--corpus-key {status['key']} --profile <profile>"
    )


def print_corpus_status(payload: dict[str, Any]) -> None:
    print(f"corpora\tstatus\tendpoint\t{payload['endpoint']}")
    print(f"corpora\tstatus\texpected-bucket\t{payload.get('expectedBucket') or '-'}")
    for status in payload["corpora"]:
        ready = "yes" if status["readiness"]["readyForWorker"] else "no"
        print(f"corpus\t{status['key']}\t{status['corpusId']}\trole={status['role']}\tready={ready}")
        print(
            f"corpus\t{status['key']}\tlocal\titems={status['local']['items']}\t"
            f"sha256={status['local'].get('sha256') or '-'}\tpath={status['local']['path']}"
        )
        print(
            f"corpus\t{status['key']}\ts3\titems={status['s3']['items']}\t"
            f"sha256={status['s3'].get('sha256') or '-'}\turi={status['s3'].get('uri') or '-'}"
        )
        print(
            f"corpus\t{status['key']}\tgraphql\treferences={status['graph']['references']['total']}\t"
            f"accepted={status['graph']['references']['accepted']}\t"
            f"attachments={status['graph']['referenceAttachments']}\timports={status['graph']['importRuns']}"
        )
        if status["issues"]:
            print(f"corpus\t{status['key']}\tissues\t{','.join(status['issues'])}")


def print_corpus_worker_bootstrap(payload: dict[str, Any]) -> None:
    print(f"corpora\tworker-bootstrap\tendpoint\t{payload['endpoint']}")
    print(f"corpora\tworker-bootstrap\texpected-bucket\t{payload.get('expectedBucket') or '-'}")
    for status in payload["corpora"]:
        target = "ok" if status["target"]["ok"] else "mismatch"
        print(
            f"corpus\t{status['key']}\ttarget\t{target}\t"
            f"configured={status['target'].get('configuredBucket') or '-'}\t"
            f"expected={status['target'].get('expectedBucket') or '-'}"
        )
        print(f"corpus\t{status['key']}\tlocal\t{'present' if status['local']['exists'] else 'missing'}\t{status['local']['path']}")
        print(f"corpus\t{status['key']}\ts3\t{'present' if status['s3']['exists'] else 'missing'}\t{status['s3'].get('uri') or '-'}")
        print(
            f"corpus\t{status['key']}\tgraphql\treferences={status['graph']['references']['total']}\t"
            f"accepted={status['graph']['references']['accepted']}"
        )
        if status["issues"]:
            print(f"corpus\t{status['key']}\tissues\t{','.join(status['issues'])}")
        print(f"corpus\t{status['key']}\tnext\t{status['next']}")


def parse_s3_uri(value: str | None) -> dict[str, str] | None:
    raw = (value or "").strip()
    if not raw.startswith("s3://"):
        return None
    parsed = urlparse(raw)
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    if not bucket:
        return None
    return {"bucket": bucket, "key": key}


def normalized_s3_uri(value: str) -> str:
    parsed = parse_s3_uri(value)
    if not parsed:
        raise ValueError(f"Invalid S3 URI: {value}")
    return f"s3://{parsed['bucket']}/{parsed['key'].rstrip('/')}/"


def _shell_quote(value: str) -> str:
    if all(char.isalnum() or char in "._/:=@%+-" for char in value):
        return value
    return "'" + value.replace("'", "'\\''") + "'"
