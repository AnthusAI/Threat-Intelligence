import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path
import boto3

def get_openai_api_key():
    if "OPENAI_API_KEY" in os.environ:
        return os.environ["OPENAI_API_KEY"]
    
    ssm = boto3.client("ssm", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    response = ssm.get_parameter(Name="/amplify/shared/papyrus/OPENAI_API_KEY", WithDecryption=True)
    return response["Parameter"]["Value"]

def main():
    os.environ["OPENAI_API_KEY"] = get_openai_api_key()
    os.environ["PAPYRUS_SEMANTIC_PROVIDER"] = "s3-vectors"
    
    fixtures_dir = Path("procedures/newsroom/tests/fixtures")
    golden_file = fixtures_dir / "retrieval_golden_queries.json"
    reports_dir = fixtures_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    
    with open(golden_file, "r") as f:
        golden_queries = json.load(f)
    
    results = []
    
    metrics = {
        "total": 0,
        "hit_at_5": 0,
        "hit_at_10": 0,
        "mrr_sum": 0.0,
        "by_category": {}
    }
    
    print(f"Running eval harness for {len(golden_queries)} queries...")
    
    for q in golden_queries:
        print(f"Querying [{q['category']}]: {q['query']}")
        
        # We can either use subprocess or python module. Let's use subprocess to ensure clean state
        # mimicking the CLI exactly.
        cmd = [
            "poetry", "run", "python3", "-m", "papyrus_newsroom", "knowledge-query",
            "--query", q["query"],
            "--execution", "local",
            "--format", "structured"
        ]
        
        env = os.environ.copy()
        env["PYTHONPATH"] = "src"
        
        start_time = time.time()
        res = subprocess.run(cmd, env=env, capture_output=True, text=True)
        duration = time.time() - start_time
        
        try:
            output = json.loads(res.stdout)
            structured = output.get("structured", {})
            
            # Combine all records that might represent a match
            matches = structured.get("semanticMatches", []) + structured.get("relatedRecords", [])
            
            # Extract unique lineageIds in rank order
            retrieved_lineage_ids = []
            for match in matches:
                lid = match.get("lineageId")
                if lid and lid not in retrieved_lineage_ids:
                    retrieved_lineage_ids.append(lid)
                    
            # Check against expected
            expected_ids = set(q.get("expect_reference_lineage_ids", []))
            
            rank = -1
            for i, lid in enumerate(retrieved_lineage_ids):
                if lid in expected_ids:
                    rank = i + 1
                    break
                    
            hit_5 = rank > 0 and rank <= 5
            hit_10 = rank > 0 and rank <= 10
            rr = 1.0 / rank if rank > 0 else 0.0
            
            # Global metrics
            metrics["total"] += 1
            if hit_5: metrics["hit_at_5"] += 1
            if hit_10: metrics["hit_at_10"] += 1
            metrics["mrr_sum"] += rr
            
            # Category metrics
            cat = q["category"]
            if cat not in metrics["by_category"]:
                metrics["by_category"][cat] = {"total": 0, "hit_at_5": 0, "hit_at_10": 0, "mrr_sum": 0.0}
            
            metrics["by_category"][cat]["total"] += 1
            if hit_5: metrics["by_category"][cat]["hit_at_5"] += 1
            if hit_10: metrics["by_category"][cat]["hit_at_10"] += 1
            metrics["by_category"][cat]["mrr_sum"] += rr
            
            results.append({
                "id": q["id"],
                "query": q["query"],
                "category": cat,
                "expected": list(expected_ids),
                "retrieved_top_10": retrieved_lineage_ids[:10],
                "rank": rank,
                "duration_sec": round(duration, 2)
            })
            
            print(f"  -> Rank: {rank if rank > 0 else 'MISS'} (Hit@5: {hit_5}, Hit@10: {hit_10})")
            
        except json.JSONDecodeError as exc:
            print(f"  -> Error parsing output for query {q['id']}: {exc}")
            print(f"     Stdout: {res.stdout}")
            print(f"     Stderr: {res.stderr}")
            continue

    # Finalize metrics
    if metrics["total"] > 0:
        metrics["mrr"] = metrics["mrr_sum"] / metrics["total"]
        metrics["hit_at_5_rate"] = metrics["hit_at_5"] / metrics["total"]
        metrics["hit_at_10_rate"] = metrics["hit_at_10"] / metrics["total"]
        
    for cat, c_metrics in metrics["by_category"].items():
        if c_metrics["total"] > 0:
            c_metrics["mrr"] = c_metrics["mrr_sum"] / c_metrics["total"]
            c_metrics["hit_at_5_rate"] = c_metrics["hit_at_5"] / c_metrics["total"]
            c_metrics["hit_at_10_rate"] = c_metrics["hit_at_10"] / c_metrics["total"]

    report = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "provenance": {
            "graphql_endpoint": os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT", "unknown"),
            "vector_index_arn": os.environ.get("PAPYRUS_S3_VECTOR_INDEX_ARN", "unknown"),
            "corpus_id": "knowledge-corpus-ai-ml-research",
            "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"]).decode("utf-8").strip(),
            "note": "Threat-intel exact-token retrieval (CVE / hash / ATT&CK) is still unmeasured. This baseline evaluates ai-ml-research only."
        },
        "metrics": metrics,
        "results": results
    }
    
    report_path = reports_dir / "retrieval_baseline.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
        
    print(f"\nEvaluation complete. Report saved to {report_path}")
    print(f"Global MRR: {metrics.get('mrr', 0):.3f}")
    print(f"Global Hit@5: {metrics.get('hit_at_5_rate', 0):.1%}")

if __name__ == "__main__":
    main()
