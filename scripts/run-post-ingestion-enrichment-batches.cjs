#!/usr/bin/env node
/**
 * Run reference curation (identifiers, title/subtitle, summaries) in batches via Python newsroom CLI.
 * Usage:
 *   node scripts/run-post-ingestion-enrichment-batches.cjs [--batch-size 25] [--start-batch 0]
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RUN_DIR = path.join(PROJECT_ROOT, ".papyrus-runs", "post-ingestion-enrichment-bulk");

function parseArgs(argv) {
  const options = { batchSize: 25, startBatch: 0, maxBatches: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--batch-size") options.batchSize = Number(argv[++index]);
    else if (arg === "--start-batch") options.startBatch = Number(argv[++index]);
    else if (arg === "--max-batches") options.maxBatches = Number(argv[++index]);
  }
  return options;
}

function extractJson(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // keep scanning
    }
  }
  return null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const manifestPath = path.join(RUN_DIR, "manifest.json");
  let manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { batches: [] };

  console.log(`post-ingestion-enrichment\tbatch-size\t${options.batchSize}`);
  console.log(`post-ingestion-enrichment\tstart-batch\t${options.startBatch}`);

  let batchIndex = options.startBatch;
  let processed = 0;
  while (true) {
    if (options.maxBatches && processed >= options.maxBatches) break;
    const args = [
      "run",
      "papyrus-newsroom",
      "references",
      "curate-recent",
      "--corpus-key",
      "AI-ML-research",
      "--since-hours",
      "87600",
      "--max-count",
      String(options.batchSize),
      "--scan-limit",
      "5000",
      "--summary-max-tokens",
      "100",
      "--apply",
      "--json",
    ];

    console.log(`post-ingestion-enrichment\twave\t${batchIndex + 1}`);
    const startedAt = Date.now();
    const result = spawnSync("poetry", args, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 1024 * 1024 * 256,
    });
    const elapsedMs = Date.now() - startedAt;
    const payload = extractJson(result.stdout);
    const selected = payload?.summary?.selectedCount ?? null;
    const succeeded = payload?.summary?.succeededCount ?? null;

    manifest.batches.push({
      batchIndex,
      selectedCount: selected,
      succeededCount: succeeded,
      exitCode: result.status,
      elapsedMs,
      completedAt: new Date().toISOString(),
    });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    if (result.status !== 0) {
      console.error(result.stdout || "");
      console.error(result.stderr || "");
      throw new Error(`Wave ${batchIndex + 1} failed with exit code ${result.status}.`);
    }

    if (payload) {
      console.log(JSON.stringify(payload.summary || payload, null, 2));
    }

    if (!selected || selected === 0) {
      console.log("post-ingestion-enrichment\tcomplete\tno remaining references");
      break;
    }
    if (succeeded === 0 && payload?.summary?.failedCount > 0) {
      console.log("post-ingestion-enrichment\tcomplete\tbatch failed without successes");
      break;
    }

    batchIndex += 1;
    processed += 1;
  }

  manifest.finishedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`post-ingestion-enrichment\twaves-processed\t${processed}`);
}

main();
