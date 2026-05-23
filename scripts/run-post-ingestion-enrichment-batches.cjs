#!/usr/bin/env node
/**
 * Run reference curation (identifiers, title/subtitle, summaries) in batches via Python newsroom CLI.
 *
 * Usage:
 *   node scripts/run-post-ingestion-enrichment-batches.cjs \
 *     --corpus-key <corpus-key> \
 *     [--batch-size 25] [--start-batch 0] [--max-batches 0] \
 *     [--scan-limit 5000] [--summary-max-tokens 100] [--model gpt-5.4-mini] \
 *     [--recent-only]
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
    batchSize: 25,
    startBatch: 0,
    maxBatches: 0,
    scanLimit: 5000,
    summaryMaxTokens: 100,
    model: "gpt-5.4-mini",
    curateAll: true,
    runDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--batch-size") options.batchSize = parsePositiveInteger(argv[++index], "--batch-size");
    else if (arg === "--start-batch") options.startBatch = parseNonNegativeInteger(argv[++index], "--start-batch");
    else if (arg === "--max-batches") options.maxBatches = parseNonNegativeInteger(argv[++index], "--max-batches");
    else if (arg === "--corpus-key") options.corpusKey = String(argv[++index] ?? "").trim();
    else if (arg === "--scan-limit") options.scanLimit = parsePositiveInteger(argv[++index], "--scan-limit");
    else if (arg === "--summary-max-tokens") {
      options.summaryMaxTokens = parsePositiveInteger(argv[++index], "--summary-max-tokens");
    } else if (arg === "--model") options.model = String(argv[++index] ?? "").trim();
    else if (arg === "--all") options.curateAll = true;
    else if (arg === "--recent-only") options.curateAll = false;
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

  console.log(`post-ingestion-enrichment\tcorpus\t${options.corpusKey}`);
  console.log(`post-ingestion-enrichment\tbatch-size\t${options.batchSize}`);
  console.log(`post-ingestion-enrichment\tstart-batch\t${options.startBatch}`);
  console.log(`post-ingestion-enrichment\tscan-limit\t${options.scanLimit}`);
  console.log(`post-ingestion-enrichment\tall-references\t${options.curateAll}`);
  console.log(`post-ingestion-enrichment\trun-dir\t${runDir}`);

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
      options.corpusKey,
      "--max-count",
      String(options.batchSize),
      "--scan-limit",
      String(options.scanLimit),
      "--summary-max-tokens",
      String(options.summaryMaxTokens),
      "--model",
      options.model,
      "--apply",
      "--json",
    ];
    if (options.curateAll) {
      args.push("--all");
    } else {
      args.push("--since-hours", "48");
    }

    console.log(`post-ingestion-enrichment\twave\t${batchIndex + 1}`);
    const startedAt = Date.now();
    const result = runPoetryWithRetries(PROJECT_ROOT, args);
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
    manifest.updatedAt = new Date().toISOString();
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
