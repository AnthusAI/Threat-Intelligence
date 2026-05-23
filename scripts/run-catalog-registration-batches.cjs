#!/usr/bin/env node
/**
 * Register a large Biblicus catalog into GraphQL in batches.
 *
 * Usage:
 *   node scripts/run-catalog-registration-batches.cjs \
 *     --corpus-key <corpus-key> \
 *     [--config corpora/papyrus-steering.yml] \
 *     [--catalog path/to/catalog.json] \
 *     [--ingestion-rationale "text"] \
 *     [--batch-size 75] [--start-batch 0] [--max-batches 0] \
 *     [--dry-run]
 */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const {
  DEFAULT_STEERING_CONFIG,
  DEFAULT_INGESTION_RATIONALE,
  defaultCatalogPath,
  defaultRunDir,
  loadSteeringConfig,
  parseNonNegativeInteger,
  parsePositiveInteger,
  requireCorpusConfig,
  resolveProjectPath,
  runPoetryWithRetries,
} = require("./lib/papyrus-batch-cli.cjs");

function parseArgs(argv) {
  const options = {
    dryRun: false,
    batchSize: 75,
    startBatch: 0,
    maxBatches: 0,
    config: DEFAULT_STEERING_CONFIG,
    corpusKey: null,
    catalogPath: null,
    ingestionRationale: DEFAULT_INGESTION_RATIONALE,
    runDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--batch-size") options.batchSize = parsePositiveInteger(argv[++index], "--batch-size");
    else if (arg === "--start-batch") options.startBatch = parseNonNegativeInteger(argv[++index], "--start-batch");
    else if (arg === "--max-batches") options.maxBatches = parseNonNegativeInteger(argv[++index], "--max-batches");
    else if (arg === "--config") options.config = argv[++index];
    else if (arg === "--corpus-key") options.corpusKey = String(argv[++index] ?? "").trim();
    else if (arg === "--catalog") options.catalogPath = resolveProjectPath(PROJECT_ROOT, argv[++index]);
    else if (arg === "--ingestion-rationale") options.ingestionRationale = String(argv[++index] ?? "").trim();
    else if (arg === "--run-dir") options.runDir = resolveProjectPath(PROJECT_ROOT, argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.corpusKey) {
    throw new Error("--corpus-key is required.");
  }
  return options;
}

function catalogItems(catalog) {
  const items = catalog.items ?? catalog.references ?? catalog.records ?? [];
  if (Array.isArray(items)) return items;
  if (items && typeof items === "object") return Object.values(items);
  return [];
}

function buildBatchCatalog(catalog, slice) {
  const itemsField = catalog.items ?? catalog.references ?? catalog.records ?? [];
  const useObjectItems = itemsField && typeof itemsField === "object" && !Array.isArray(itemsField);
  if (useObjectItems) {
    const nextItems = {};
    for (const item of slice) {
      const key = item.item_id || item.externalItemId || item.id;
      if (key) nextItems[key] = item;
    }
    return {
      schema_version: catalog.schema_version ?? 2,
      generated_at: catalog.generated_at ?? new Date().toISOString(),
      corpus_uri: catalog.corpus_uri ?? null,
      items: nextItems,
    };
  }
  return {
    schema_version: catalog.schema_version ?? 2,
    generated_at: catalog.generated_at ?? new Date().toISOString(),
    corpus_uri: catalog.corpus_uri ?? null,
    items: slice,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const steeringConfig = loadSteeringConfig(PROJECT_ROOT, options.config);
  const corpusConfig = requireCorpusConfig(steeringConfig, options.corpusKey);
  const catalogPath = options.catalogPath || defaultCatalogPath(PROJECT_ROOT, corpusConfig);
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog not found at ${catalogPath}. Pass --catalog or fix the corpus path in ${options.config}.`);
  }
  const runDir = options.runDir || defaultRunDir(PROJECT_ROOT, "catalog-registration-bulk", options.corpusKey);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const items = catalogItems(catalog);
  fs.mkdirSync(runDir, { recursive: true });

  const manifestPath = path.join(runDir, "manifest.json");
  let manifest = {
    corpusKey: options.corpusKey,
    config: options.config,
    catalogPath,
    batches: [],
    startedAt: new Date().toISOString(),
  };
  if (fs.existsSync(manifestPath)) {
    manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, "utf8")) };
  }

  const totalBatches = Math.ceil(items.length / options.batchSize);
  console.log(`catalog-registration\tcorpus\t${options.corpusKey}`);
  console.log(`catalog-registration\tconfig\t${options.config}`);
  console.log(`catalog-registration\titems\t${items.length}`);
  console.log(`catalog-registration\tbatch-size\t${options.batchSize}`);
  console.log(`catalog-registration\ttotal-batches\t${totalBatches}`);
  console.log(`catalog-registration\tstart-batch\t${options.startBatch}`);
  console.log(`catalog-registration\tcatalog\t${catalogPath}`);
  console.log(`catalog-registration\trun-dir\t${runDir}`);
  console.log(`catalog-registration\tdry-run\t${options.dryRun}`);

  let processed = 0;
  for (let batchIndex = options.startBatch; batchIndex < totalBatches; batchIndex += 1) {
    if (options.maxBatches && processed >= options.maxBatches) break;
    const offset = batchIndex * options.batchSize;
    const slice = items.slice(offset, offset + options.batchSize);
    const batchPath = path.join(runDir, `catalog-batch-${String(batchIndex).padStart(4, "0")}.json`);
    const batchCatalog = buildBatchCatalog(catalog, slice);
    fs.writeFileSync(batchPath, `${JSON.stringify(batchCatalog, null, 2)}\n`, "utf8");

    const args = [
      "run",
      "papyrus-content",
      "references",
      "register-catalog",
      "--config",
      options.config,
      "--corpus-key",
      options.corpusKey,
      "--catalog",
      batchPath,
      "--status",
      "accepted",
      "--ingestion-rationale",
      options.ingestionRationale,
      "--title-subtitle-enrichment",
      "false",
    ];
    if (!options.dryRun) args.push("--apply");

    console.log(
      `catalog-registration\tbatch\t${batchIndex + 1}/${totalBatches}\toffset\t${offset}\tcount\t${slice.length}`,
    );
    const startedAt = Date.now();
    const result = runPoetryWithRetries(PROJECT_ROOT, args, {
      env: {
        ...process.env,
        PAPYRUS_APPLY_CONCURRENCY: process.env.PAPYRUS_APPLY_CONCURRENCY ?? "8",
      },
    });
    const elapsedMs = Date.now() - startedAt;
    const entry = {
      batchIndex,
      offset,
      count: slice.length,
      batchPath,
      exitCode: result.status,
      elapsedMs,
      completedAt: new Date().toISOString(),
    };
    manifest.batches = manifest.batches.filter((row) => row.batchIndex !== batchIndex);
    manifest.batches.push(entry);
    manifest.updatedAt = entry.completedAt;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    if (result.status !== 0) {
      console.error(result.stdout || "");
      console.error(result.stderr || "");
      throw new Error(`Batch ${batchIndex} failed with exit code ${result.status}.`);
    }
    const tail = (result.stdout || "").trim().split("\n").slice(-8).join("\n");
    if (tail) console.log(tail);
    processed += 1;
  }

  manifest.finishedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`catalog-registration\tcomplete\tbatches-processed\t${processed}`);
}

main();
