#!/usr/bin/env node
/**
 * Backfill missing 100-token reference summaries via parallel summarize-batch waves.
 * Usage:
 *   node scripts/run-post-ingestion-enrichment-batches.cjs [--batch-size 50] [--max-parallel 6]
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RUN_DIR = path.join(PROJECT_ROOT, ".papyrus-runs", "post-ingestion-enrichment-bulk");

function parseArgs(argv) {
  const options = {
    batchSize: 50,
    maxParallel: 6,
    scanLimit: 5000,
    maxWaves: 0,
    corpusKey: "AI-ML-research",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--batch-size") options.batchSize = Number(argv[++index]);
    else if (arg === "--max-parallel") options.maxParallel = Number(argv[++index]);
    else if (arg === "--scan-limit") options.scanLimit = Number(argv[++index]);
    else if (arg === "--max-waves") options.maxWaves = Number(argv[++index]);
    else if (arg === "--corpus-key") options.corpusKey = argv[++index];
  }
  if (!Number.isFinite(options.batchSize) || options.batchSize < 1) {
    throw new Error("--batch-size must be a positive integer.");
  }
  if (!Number.isFinite(options.maxParallel) || options.maxParallel < 1) {
    throw new Error("--max-parallel must be a positive integer.");
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

  console.log(`summary-backfill\tmode\tsummarize-batch`);
  console.log(`summary-backfill\tcorpus\t${options.corpusKey}`);
  console.log(`summary-backfill\tbatch-size\t${options.batchSize}`);
  console.log(`summary-backfill\tmax-parallel\t${options.maxParallel}`);
  console.log(`summary-backfill\tscan-limit\t${options.scanLimit}`);

  let waveIndex = 0;
  let totalCreated = 0;
  while (true) {
    if (options.maxWaves && waveIndex >= options.maxWaves) break;

    const args = [
      "run",
      "papyrus-newsroom",
      "references",
      "summarize-batch",
      "--corpus-key",
      options.corpusKey,
      "--budgets",
      "100",
      "--only-missing",
      "true",
      "--max-count",
      String(options.batchSize),
      "--max-parallel",
      String(options.maxParallel),
      "--scan-limit",
      String(options.scanLimit),
      "--apply",
    ];

    console.log(`summary-backfill\twave\t${waveIndex + 1}`);
    const startedAt = Date.now();
    let result = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) {
        console.log(`summary-backfill\tretry\twave\t${waveIndex + 1}\tattempt\t${attempt}`);
      }
      result = spawnSync("poetry", args, {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 1024 * 1024 * 256,
      });
      if (result.status === 0) break;
      const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
      const transient = /Connection reset|timed out|Temporary failure|ECONNRESET|503|502|504|429/i.test(combined);
      if (!transient || attempt === 3) break;
    }

    const elapsedMs = Date.now() - startedAt;
    const payload = extractJson(result.stdout);
    const created = payload?.created ?? 0;
    const selected = payload?.selectedCount ?? 0;
    const skippedExisting = payload?.skippedExisting ?? null;
    const blocked = payload?.blocked ?? 0;

    manifest.batches.push({
      waveIndex,
      created,
      selectedCount: selected,
      skippedExisting,
      blocked,
      exitCode: result.status,
      elapsedMs,
      completedAt: new Date().toISOString(),
    });
    manifest.updatedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    if (result.status !== 0) {
      console.error(result.stdout || "");
      console.error(result.stderr || "");
      throw new Error(`Wave ${waveIndex + 1} failed with exit code ${result.status}.`);
    }

    if (payload) {
      console.log(
        JSON.stringify(
          {
            created: payload.created,
            selectedCount: payload.selectedCount,
            skippedExisting: payload.skippedExisting,
            blocked: payload.blocked,
            maxParallel: payload.maxParallel,
            elapsedMs,
          },
          null,
          2,
        ),
      );
    }

    totalCreated += created;
    waveIndex += 1;

    if (!selected || created === 0) {
      console.log("summary-backfill\tcomplete\tno remaining missing summaries");
      break;
    }
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.totalCreated = totalCreated;
  manifest.wavesProcessed = waveIndex;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`summary-backfill\twaves-processed\t${waveIndex}`);
  console.log(`summary-backfill\ttotal-created\t${totalCreated}`);
}

main();
