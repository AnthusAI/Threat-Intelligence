#!/usr/bin/env node
/**
 * Backfill missing 100-token reference summaries in batches via Python newsroom CLI.
 *
 * Usage:
 *   node scripts/run-post-ingestion-enrichment-batches.cjs \
 *     --corpus-key <corpus-key> \
 *     [--batch-size 50] [--max-parallel 6] [--start-wave 0] [--max-waves 0] \
 *     [--scan-limit 5000] [--run-dir .papyrus-runs/post-ingestion-enrichment-bulk/<corpus>]
 */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const {
  defaultRunDir,
  parseNonNegativeInteger,
  parsePositiveInteger,
  runPoetryWithRetries,
} = require("./lib/papyrus-batch-cli.cjs");

function parseArgs(argv) {
  const options = {
    corpusKey: null,
    batchSize: 50,
    maxParallel: 6,
    startWave: 0,
    maxWaves: 0,
    scanLimit: 5000,
    runDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--batch-size") options.batchSize = parsePositiveInteger(argv[++index], "--batch-size");
    else if (arg === "--max-parallel") options.maxParallel = parsePositiveInteger(argv[++index], "--max-parallel");
    else if (arg === "--start-wave" || arg === "--start-batch") {
      options.startWave = parseNonNegativeInteger(argv[++index], arg);
    } else if (arg === "--max-waves" || arg === "--max-batches") {
      options.maxWaves = parseNonNegativeInteger(argv[++index], arg);
    } else if (arg === "--scan-limit") options.scanLimit = parsePositiveInteger(argv[++index], "--scan-limit");
    else if (arg === "--corpus-key") options.corpusKey = String(argv[++index] ?? "").trim();
    else if (arg === "--run-dir") options.runDir = path.resolve(PROJECT_ROOT, argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.corpusKey) {
    throw new Error("--corpus-key is required.");
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
  const runDir = options.runDir || defaultRunDir(PROJECT_ROOT, "post-ingestion-enrichment-bulk", options.corpusKey);
  fs.mkdirSync(runDir, { recursive: true });
  const manifestPath = path.join(runDir, "manifest.json");
  let manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { corpusKey: options.corpusKey, batches: [] };

  console.log("summary-backfill\tmode\tsummarize-batch");
  console.log(`summary-backfill\tcorpus\t${options.corpusKey}`);
  console.log(`summary-backfill\tbatch-size\t${options.batchSize}`);
  console.log(`summary-backfill\tmax-parallel\t${options.maxParallel}`);
  console.log(`summary-backfill\tstart-wave\t${options.startWave}`);
  console.log(`summary-backfill\tscan-limit\t${options.scanLimit}`);
  console.log(`summary-backfill\trun-dir\t${runDir}`);

  let waveIndex = options.startWave;
  let processed = 0;
  let totalCreated = 0;
  while (true) {
    if (options.maxWaves && processed >= options.maxWaves) break;

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
    const result = runPoetryWithRetries(PROJECT_ROOT, args);
    const elapsedMs = Date.now() - startedAt;
    const payload = extractJson(result.stdout);
    const created = payload?.created ?? 0;
    const selected = payload?.selectedCount ?? 0;
    const skippedExisting = payload?.skippedExisting ?? null;
    const blocked = payload?.blocked ?? 0;

    manifest.batches = manifest.batches.filter((row) => row.waveIndex !== waveIndex);
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
    processed += 1;
    waveIndex += 1;

    if (!selected || created === 0) {
      console.log("summary-backfill\tcomplete\tno remaining missing summaries");
      break;
    }
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.totalCreated = totalCreated;
  manifest.wavesProcessed = processed;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`summary-backfill\twaves-processed\t${processed}`);
  console.log(`summary-backfill\ttotal-created\t${totalCreated}`);
}

main();
