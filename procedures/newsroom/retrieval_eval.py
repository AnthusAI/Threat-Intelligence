#!/usr/bin/env python3
"""Golden-query retrieval evaluation harness.

See docs/retrieval-eval-environments.md and
procedures/newsroom/tests/fixtures/retrieval_eval_environments.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import boto3

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "procedures" / "newsroom" / "tests" / "fixtures"
ENVIRONMENTS_FILE = FIXTURES_DIR / "retrieval_eval_environments.json"
GOLDEN_FILE = FIXTURES_DIR / "retrieval_golden_queries.json"
DEFAULT_REPORTS_DIR = FIXTURES_DIR / "reports"


def get_openai_api_key() -> str:
    if "OPENAI_API_KEY" in os.environ:
        return os.environ["OPENAI_API_KEY"]

    ssm = boto3.client("ssm", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    response = ssm.get_parameter(Name="/amplify/shared/papyrus/OPENAI_API_KEY", WithDecryption=True)
    return response["Parameter"]["Value"]


def _git_provenance() -> dict[str, Any]:
    """Identify the exact working-tree state used for an eval run."""
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, cwd=REPO_ROOT).strip()
    diff = subprocess.check_output(["git", "diff", "HEAD"], text=True, cwd=REPO_ROOT)
    dirty = bool(diff.strip())
    return {
        "git_sha": sha,
        "git_dirty": dirty,
        "git_diff_sha256": hashlib.sha256(diff.encode("utf-8")).hexdigest() if dirty else None,
    }


def load_environments(path: Path = ENVIRONMENTS_FILE) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_environment(name: str | None = None, path: Path = ENVIRONMENTS_FILE) -> tuple[str, dict[str, Any]]:
    catalog = load_environments(path)
    env_name = (name or os.environ.get("PAPYRUS_RETRIEVAL_EVAL_ENV") or catalog.get("default") or "").strip()
    environments = catalog.get("environments") or {}
    if env_name not in environments:
        known = ", ".join(sorted(environments)) or "(none)"
        raise SystemExit(f"Unknown retrieval eval environment {env_name!r}. Known: {known}")
    return env_name, dict(environments[env_name])


def apply_environment(env: dict[str, Any]) -> list[str]:
    """Fill missing process env vars from the profile. Never overwrite set vars."""
    applied: list[str] = []

    def _set(key: str, value: str | None) -> None:
        if not value:
            return
        if os.environ.get(key):
            return
        os.environ[key] = value
        applied.append(key)

    _set("AWS_PROFILE", env.get("aws_profile"))
    _set("AWS_REGION", env.get("aws_region"))
    _set("AWS_DEFAULT_REGION", env.get("aws_region"))
    _set("PAPYRUS_GRAPHQL_ENDPOINT", env.get("graphql_endpoint"))
    _set("PAPYRUS_JWT_SECRET_SSM_PARAM", env.get("jwt_secret_ssm_param"))
    _set("PAPYRUS_S3_VECTOR_INDEX_ARN", env.get("vector_index_arn"))
    _set("PAPYRUS_STORAGE_BUCKET_NAME", env.get("storage_bucket"))
    _set("PAPYRUS_LEXICAL_INDEX_S3_KEY", env.get("lexical_s3_key"))
    if env.get("require_lexical"):
        _set("PAPYRUS_REQUIRE_LEXICAL", "1")
    os.environ.setdefault("PAPYRUS_SEMANTIC_PROVIDER", "s3-vectors")
    return applied


def lexical_artifact_stats(
    *,
    bucket: str | None = None,
    s3_key: str | None = None,
    local_path: str | None = None,
    region: str | None = None,
) -> dict[str, Any]:
    """Load the lexical artifact and return counts used for preflight/provenance."""
    # Import inside so unit tests can import scoring helpers without AWS deps.
    sys.path.insert(0, str(REPO_ROOT / "src"))
    from papyrus_knowledge_query.lexical_index import load_lexical_artifact  # noqa: WPS433

    artifact = load_lexical_artifact(
        local_path=local_path,
        bucket_name=bucket,
        s3_key=s3_key,
        region_name=region,
    )
    docs = list(artifact.get("docs") or [])
    refs = {str(doc.get("referenceLineageId") or "") for doc in docs if doc.get("referenceLineageId")}
    refs.discard("")
    manifest = artifact.get("manifest") if isinstance(artifact.get("manifest"), dict) else {}
    return {
        "docs": len(docs),
        "unique_references": len(refs),
        "eligible_count": manifest.get("eligibleCount") or artifact.get("eligibleCount"),
        "built_at": artifact.get("builtAt"),
        "source_commit": artifact.get("sourceCommit") or manifest.get("sourceCommit"),
        "skipped": manifest.get("skipped") or artifact.get("skipped"),
    }


def preflight_lexical(env: dict[str, Any]) -> dict[str, Any]:
    if not env.get("require_lexical"):
        return {"required": False, "ok": True}

    local_path = (os.environ.get("PAPYRUS_LEXICAL_INDEX_PATH") or "").strip() or None
    bucket = (os.environ.get("PAPYRUS_STORAGE_BUCKET_NAME") or env.get("storage_bucket") or "").strip() or None
    s3_key = (os.environ.get("PAPYRUS_LEXICAL_INDEX_S3_KEY") or env.get("lexical_s3_key") or "").strip() or None
    region = os.environ.get("AWS_REGION") or env.get("aws_region")

    try:
        stats = lexical_artifact_stats(
            bucket=bucket,
            s3_key=s3_key,
            local_path=local_path,
            region=region,
        )
    except Exception as exc:  # noqa: BLE001 — surface any loader failure as preflight fail
        raise SystemExit(f"Lexical preflight failed (require_lexical): {exc}") from exc

    expected = env.get("expected_lexical") or {}
    min_docs = int(expected.get("min_docs") or 0)
    min_refs = int(expected.get("min_unique_references") or 0)
    if min_docs and int(stats["docs"]) < min_docs:
        raise SystemExit(
            f"Lexical preflight failed: docs={stats['docs']} < min_docs={min_docs}. "
            "Refusing to score a hybrid golden set against a thin/missing lexical arm."
        )
    if min_refs and int(stats["unique_references"]) < min_refs:
        raise SystemExit(
            f"Lexical preflight failed: unique_references={stats['unique_references']} "
            f"< min_unique_references={min_refs}."
        )
    return {"required": True, "ok": True, **stats}


def _rank_of(lineage_id: str, retrieved: list[str]) -> int:
    try:
        return retrieved.index(lineage_id) + 1
    except ValueError:
        return -1


def score_query(q: dict[str, Any], retrieved_lineage_ids: list[str]) -> dict[str, Any]:
    """Score one golden query. Pure function for unit tests."""
    metric = (q.get("metric") or "hit").strip()
    cat = q["category"]

    if metric == "prefer_order":
        pairs = q.get("prefer_before") or []
        if not pairs:
            raise ValueError(f"{q.get('id')}: prefer_order metric requires prefer_before pairs")
        pair_results = []
        statuses = []
        for pair in pairs:
            preferred, deferred = pair[0], pair[1]
            pref_rank = _rank_of(preferred, retrieved_lineage_ids)
            def_rank = _rank_of(deferred, retrieved_lineage_ids)
            if pref_rank < 0 or def_rank < 0:
                status = "incomplete"
            elif pref_rank < def_rank:
                status = "ok"
            else:
                status = "wrong_order"
            statuses.append(status)
            pair_results.append(
                {
                    "preferred": preferred,
                    "deferred": deferred,
                    "preferred_rank": pref_rank,
                    "deferred_rank": def_rank,
                    "status": status,
                }
            )
        # Aggregate: all pairs must be ok for the query to count as a hit.
        overall = "ok" if statuses and all(s == "ok" for s in statuses) else (
            "wrong_order" if any(s == "wrong_order" for s in statuses) else "incomplete"
        )
        # Rank for MRR/Hit@k: best preferred rank among ok pairs; else -1.
        ok_ranks = [p["preferred_rank"] for p in pair_results if p["status"] == "ok"]
        rank = min(ok_ranks) if overall == "ok" and ok_ranks else -1
        hit_5 = overall == "ok" and rank > 0 and rank <= 5
        hit_10 = overall == "ok" and rank > 0 and rank <= 10
        rr = 1.0 / rank if rank > 0 else 0.0
        return {
            "id": q["id"],
            "query": q["query"],
            "category": cat,
            "metric": metric,
            "expected": [p[0] for p in pairs],
            "prefer_before": pairs,
            "pair_results": pair_results,
            "order_status": overall,
            "retrieved_top_10": retrieved_lineage_ids[:10],
            "rank": rank,
            "hit_at_5": hit_5,
            "hit_at_10": hit_10,
            "rr": rr,
        }

    expected_ids = set(q.get("expect_reference_lineage_ids") or [])
    rank = -1
    for i, lid in enumerate(retrieved_lineage_ids):
        if lid in expected_ids:
            rank = i + 1
            break
    hit_5 = rank > 0 and rank <= 5
    hit_10 = rank > 0 and rank <= 10
    rr = 1.0 / rank if rank > 0 else 0.0
    return {
        "id": q["id"],
        "query": q["query"],
        "category": cat,
        "metric": metric,
        "expected": list(expected_ids),
        "retrieved_top_10": retrieved_lineage_ids[:10],
        "rank": rank,
        "hit_at_5": hit_5,
        "hit_at_10": hit_10,
        "rr": rr,
    }


def _empty_metrics() -> dict[str, Any]:
    return {"total": 0, "hit_at_5": 0, "hit_at_10": 0, "mrr_sum": 0.0}


def _finalize_metrics(metrics: dict[str, Any]) -> None:
    if metrics["total"] > 0:
        metrics["mrr"] = metrics["mrr_sum"] / metrics["total"]
        metrics["hit_at_5_rate"] = metrics["hit_at_5"] / metrics["total"]
        metrics["hit_at_10_rate"] = metrics["hit_at_10"] / metrics["total"]


def run_query(query: str) -> tuple[list[str], list[str], dict[str, Any]]:
    cmd = [
        "poetry",
        "run",
        "python3",
        "-m",
        "papyrus_newsroom",
        "knowledge-query",
        "--query",
        query,
        "--execution",
        "local",
        "--format",
        "structured",
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = "src"
    res = subprocess.run(cmd, env=env, capture_output=True, text=True, cwd=REPO_ROOT)
    if res.returncode != 0:
        raise RuntimeError(
            f"knowledge-query failed (exit {res.returncode}):\n"
            f"stdout: {res.stdout[-2000:]}\nstderr: {res.stderr[-2000:]}"
        )
    output = json.loads(res.stdout)
    structured = output.get("structured") or {}
    warnings = list(structured.get("warnings") or output.get("warnings") or [])
    matches = list(structured.get("semanticMatches") or []) + list(structured.get("relatedRecords") or [])
    retrieved: list[str] = []
    for match in matches:
        lid = match.get("lineageId")
        if lid and lid not in retrieved:
            retrieved.append(lid)
    return retrieved, warnings, structured


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Papyrus retrieval golden-query eval")
    parser.add_argument("--env", dest="env_name", default=None, help="Environment profile name")
    parser.add_argument(
        "--skip-lexical-preflight",
        action="store_true",
        help="Skip lexical floor check (not valid for hybrid golden reports)",
    )
    parser.add_argument("--report", default=None, help="Output report path")
    args = parser.parse_args(argv)

    env_name, env = resolve_environment(args.env_name)
    if env.get("mode") == "fixture":
        raise SystemExit(
            f"Environment {env_name!r} is fixture-only. "
            "Use papyrus-main-ai-ml-readonly (or another live profile) for golden scoring."
        )

    applied = apply_environment(env)
    os.environ["OPENAI_API_KEY"] = get_openai_api_key()

    if not os.environ.get("PAPYRUS_GRAPHQL_JWT"):
        print("Minting PAPYRUS_GRAPHQL_JWT via papyrus auth refresh-jwt…")
        jwt = subprocess.check_output(
            ["poetry", "run", "python3", "-m", "papyrus.cli", "auth", "refresh-jwt"],
            text=True,
            cwd=REPO_ROOT,
            env={**os.environ, "PYTHONPATH": "src"},
        ).strip()
        os.environ["PAPYRUS_GRAPHQL_JWT"] = jwt

    lexical_info: dict[str, Any]
    if args.skip_lexical_preflight:
        lexical_info = {"required": bool(env.get("require_lexical")), "ok": None, "skipped": True}
    else:
        print(f"Environment: {env_name} ({env.get('mode')})")
        if applied:
            print(f"Applied env defaults: {', '.join(applied)}")
        lexical_info = preflight_lexical(env)
        if lexical_info.get("required"):
            print(
                f"Lexical preflight ok: docs={lexical_info.get('docs')} "
                f"unique_references={lexical_info.get('unique_references')} "
                f"eligible={lexical_info.get('eligible_count')}"
            )

    with open(GOLDEN_FILE, encoding="utf-8") as f:
        golden_queries = json.load(f)

    results: list[dict[str, Any]] = []
    metrics = _empty_metrics()
    metrics["by_category"] = {}
    all_warnings: list[str] = []
    lexical_warning_seen = False

    print(f"Running eval harness for {len(golden_queries)} queries...")

    for q in golden_queries:
        print(f"Querying [{q['category']}]: {q['query']}")
        start_time = time.time()
        try:
            retrieved, warnings, _structured = run_query(q["query"])
        except Exception as exc:  # noqa: BLE001
            print(f"  -> Error: {exc}")
            return 1
        duration = time.time() - start_time
        for warning in warnings:
            all_warnings.append(warning)
            if "Lexical search unavailable" in warning or "Lexical provider not configured" in warning:
                lexical_warning_seen = True

        scored = score_query(q, retrieved)
        scored["duration_sec"] = round(duration, 2)
        scored["warnings"] = warnings

        metrics["total"] += 1
        if scored["hit_at_5"]:
            metrics["hit_at_5"] += 1
        if scored["hit_at_10"]:
            metrics["hit_at_10"] += 1
        metrics["mrr_sum"] += scored["rr"]

        cat = scored["category"]
        if cat not in metrics["by_category"]:
            metrics["by_category"][cat] = _empty_metrics()
        c_metrics = metrics["by_category"][cat]
        c_metrics["total"] += 1
        if scored["hit_at_5"]:
            c_metrics["hit_at_5"] += 1
        if scored["hit_at_10"]:
            c_metrics["hit_at_10"] += 1
        c_metrics["mrr_sum"] += scored["rr"]

        results.append(scored)
        if scored.get("metric") == "prefer_order":
            print(
                f"  -> order={scored.get('order_status')} rank={scored['rank'] if scored['rank'] > 0 else 'n/a'} "
                f"(Hit@5: {scored['hit_at_5']})"
            )
        else:
            print(f"  -> Rank: {scored['rank'] if scored['rank'] > 0 else 'MISS'} (Hit@5: {scored['hit_at_5']})")

    if env.get("require_lexical") and lexical_warning_seen:
        print(
            "FATAL: lexical arm reported unavailable during scoring. "
            "Report is invalid for hybrid measurement (see TI-b9f6da).",
            file=sys.stderr,
        )
        return 2

    _finalize_metrics(metrics)
    for c_metrics in metrics["by_category"].values():
        _finalize_metrics(c_metrics)

    git_meta = _git_provenance()
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "provenance": {
            "environment": env_name,
            "environment_mode": env.get("mode"),
            "graphql_endpoint": os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT", "unknown"),
            "vector_index_arn": os.environ.get("PAPYRUS_S3_VECTOR_INDEX_ARN", "unknown"),
            "storage_bucket": os.environ.get("PAPYRUS_STORAGE_BUCKET_NAME", "unknown"),
            "corpus_id": env.get("corpus_id") or "unknown",
            "require_lexical": bool(env.get("require_lexical")),
            "lexical": lexical_info,
            "lexical_document_count": lexical_info.get("docs"),
            "lexical_unique_reference_count": lexical_info.get("unique_references"),
            "accepted_reference_count": lexical_info.get("eligible_count"),
            "git_sha": git_meta["git_sha"],
            "git_dirty": git_meta["git_dirty"],
            "git_diff_sha256": git_meta["git_diff_sha256"],
            "warnings_sample": all_warnings[:20],
            "note": (
                "Threat-intel exact-token retrieval (CVE / hash / ATT&CK) is still unmeasured. "
                "This baseline evaluates ai-ml-research only. "
                "See docs/retrieval-eval-environments.md."
            ),
        },
        "metrics": metrics,
        "results": results,
    }

    report_path = Path(
        args.report
        or os.environ.get("PAPYRUS_RETRIEVAL_EVAL_REPORT")
        or (DEFAULT_REPORTS_DIR / "retrieval_baseline.json")
    )
    if not report_path.is_absolute():
        report_path = REPO_ROOT / report_path
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(f"\nEvaluation complete. Report saved to {report_path}")
    print(f"Global MRR: {metrics.get('mrr', 0):.3f}")
    print(f"Global Hit@5: {metrics.get('hit_at_5_rate', 0):.1%}")
    print(
        f"Provenance: env={env_name} sha={git_meta['git_sha'][:12]} "
        f"dirty={git_meta['git_dirty']} lexical_docs={lexical_info.get('docs')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
