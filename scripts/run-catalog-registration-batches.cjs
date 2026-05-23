#!/usr/bin/env node
/**
 * Register a large Biblicus catalog into GraphQL in batches.
 * Usage:
 *   node scripts/run-catalog-registration-batches.cjs [--dry-run] [--batch-size 75] [--start-batch 0]
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(PROJECT_ROOT, "corpora/AI-ML-research/metadata/catalog.json");
const RUN_DIR = path.join(PROJECT_ROOT, ".papyrus-runs", "catalog-registration-bulk");
const RATIONALE =
  "Canonical AI/ML research corpus source material for knowledge-base extraction, indexing, and analysis.";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    batchSize: 75,
    startBatch: 0,
    maxBatches: 0,
    catalogPath: CATALOG_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--batch-size") options.batchSize = Number(argv[++index]);
    else if (arg === "--start-batch") options.startBatch = Number(argv[++index]);
    else if (arg === "--max-batches") options.maxBatches = Number(argv[++index]);
    else if (arg === "--catalog") options.catalogPath = path.resolve(PROJECT_ROOT, argv[++index]);
  }
  if (!Number.isFinite(options.batchSize) || options.batchSize < 1) {
    throw new Error("--batch-size must be a positive integer.");
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
  const catalog = JSON.parse(fs.readFileSync(options.catalogPath, "utf8"));
  const items = catalogItems(catalog);
  fs.mkdirSync(RUN_DIR, { recursive: true });

  const manifestPath = path.join(RUN_DIR, "manifest.json");
  let manifest = { batches: [], startedAt: new Date().toISOString() };
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  }

  const totalBatches = Math.ceil(items.length / options.batchSize);
  console.log(`catalog-registration\titems\t${items.length}`);
  console.log(`catalog-registration\tbatch-size\t${options.batchSize}`);
  console.log(`catalog-registration\ttotal-batches\t${totalBatches}`);
  console.log(`catalog-registration\tstart-batch\t${options.startBatch}`);
  console.log(`catalog-registration\tcatalog\t${options.catalogPath}`);

  console.log(`catalog-registration\tdry-run\t${options.dryRun}`);

  let processed = 0;
  for (let batchIndex = options.startBatch; batchIndex < totalBatches; batchIndex += 1) {
    if (options.maxBatches && processed >= options.maxBatches) break;
    const offset = batchIndex * options.batchSize;
    const slice = items.slice(offset, offset + options.batchSize);
    const batchPath = path.join(RUN_DIR, `catalog-batch-${String(batchIndex).padStart(4, "0")}.json`);
    const batchCatalog = buildBatchCatalog(catalog, slice);
    fs.writeFileSync(batchPath, `${JSON.stringify(batchCatalog, null, 2)}\n`, "utf8");

    const args = [
      "run",
      "papyrus-content",
      "references",
      "register-catalog",
      "--config",
      "corpora/papyrus-steering.yml",
      "--corpus-key",
      "AI-ML-research",
      "--catalog",
      batchPath,
      "--status",
      "accepted",
      "--ingestion-rationale",
      RATIONALE,
    ];
    if (!options.dryRun) args.push("--apply");
    args.push("--title-subtitle-enrichment", "false");

    console.log(`catalog-registration\tbatch\t${batchIndex + 1}/${totalBatches}\toffset\t${offset}\tcount\t${slice.length}`);
    const startedAt = Date.now();
    const result = spawnSync("poetry", args, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PAPYRUS_APPLY_CONCURRENCY: process.env.PAPYRUS_APPLY_CONCURRENCY ?? "8",
      },
      maxBuffer: 1024 * 1024 * 256,
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
