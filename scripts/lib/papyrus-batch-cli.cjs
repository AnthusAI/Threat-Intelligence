"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const YAML = require("yaml");

const DEFAULT_STEERING_CONFIG = "corpora/papyrus-steering.yml";
const DEFAULT_INGESTION_RATIONALE =
  "Source material registered for knowledge-base extraction, indexing, and analysis.";

const TRANSIENT_FAILURE_PATTERN = /Connection reset|timed out|Temporary failure|ECONNRESET|503|502|504/i;

function safeId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function resolveProjectPath(projectRoot, value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return path.isAbsolute(normalized) ? normalized : path.resolve(projectRoot, normalized);
}

function loadSteeringConfig(projectRoot, configPath) {
  const resolved = resolveProjectPath(projectRoot, configPath || DEFAULT_STEERING_CONFIG);
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(`Steering config not found: ${configPath || DEFAULT_STEERING_CONFIG}`);
  }
  return YAML.parse(fs.readFileSync(resolved, "utf8"));
}

function requireCorpusConfig(steeringConfig, corpusKey) {
  const corpora = Array.isArray(steeringConfig?.corpora) ? steeringConfig.corpora : [];
  const corpus = corpora.find((entry) => String(entry?.key ?? "") === corpusKey);
  if (!corpus) {
    throw new Error(`Unknown corpus key '${corpusKey}' in steering config.`);
  }
  return corpus;
}

function defaultCatalogPath(projectRoot, corpusConfig) {
  return path.resolve(projectRoot, corpusConfig.path, "metadata/catalog.json");
}

function defaultRunDir(projectRoot, prefix, corpusKey) {
  return path.join(projectRoot, ".papyrus-runs", prefix, safeId(corpusKey) || "unknown-corpus");
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function runPoetryWithRetries(projectRoot, args, { env = process.env, maxAttempts = 3 } = {}) {
  let result = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      console.log(`batch-cli\tretry\tattempt\t${attempt}`);
    }
    result = spawnSync("poetry", args, {
      cwd: projectRoot,
      encoding: "utf8",
      env,
      maxBuffer: 1024 * 1024 * 256,
    });
    if (result.status === 0) return result;
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (!TRANSIENT_FAILURE_PATTERN.test(combined) || attempt === maxAttempts) break;
  }
  return result;
}

module.exports = {
  DEFAULT_STEERING_CONFIG,
  DEFAULT_INGESTION_RATIONALE,
  TRANSIENT_FAILURE_PATTERN,
  safeId,
  resolveProjectPath,
  loadSteeringConfig,
  requireCorpusConfig,
  defaultCatalogPath,
  defaultRunDir,
  parsePositiveInteger,
  parseNonNegativeInteger,
  runPoetryWithRetries,
};
