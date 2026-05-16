const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const DEFAULT_STEERING_CONFIG = "corpora/papyrus-steering.yml";
const VALID_CORPUS_ROLES = new Set(["canonical", "source", "supporting", "archive"]);

function resolveSteeringConfigPath(options = {}) {
  const explicitPath = options.configPath || options.config;
  const configuredPath = explicitPath || process.env.PAPYRUS_STEERING_CONFIG || DEFAULT_STEERING_CONFIG;
  const resolvedPath = path.resolve(configuredPath);
  if (!fs.existsSync(resolvedPath)) {
    if (explicitPath || process.env.PAPYRUS_STEERING_CONFIG) {
      throw new Error(`Steering config was not found: ${configuredPath}`);
    }
    return null;
  }
  return resolvedPath;
}

function loadSteeringConfig(options = {}) {
  const configPath = resolveSteeringConfigPath(options);
  if (!configPath) return null;
  const parsed = YAML.parse(fs.readFileSync(configPath, "utf8"));
  return normalizeSteeringConfig(parsed, configPath);
}

function requireSteeringConfig(options = {}) {
  const config = loadSteeringConfig(options);
  if (!config) throw new Error(`Steering config was not found: ${DEFAULT_STEERING_CONFIG}`);
  return config;
}

function normalizeSteeringConfig(rawConfig, configPath) {
  if (!rawConfig || typeof rawConfig !== "object") throw new Error("Steering config must be a YAML object.");
  if (rawConfig.schemaVersion !== 1) throw new Error("Steering config schemaVersion must be 1.");

  const canonicalTopicSet = rawConfig.canonicalTopicSet ?? {};
  const canonicalCorpusKey = requiredString(canonicalTopicSet.corpusKey, "canonicalTopicSet.corpusKey");
  const canonicalClassifierId = requiredString(canonicalTopicSet.classifierId, "canonicalTopicSet.classifierId");
  const corpora = rawConfig.corpora;
  if (!Array.isArray(corpora) || corpora.length === 0) throw new Error("Steering config corpora must include at least one corpus.");

  const seenKeys = new Set();
  const normalizedCorpora = corpora.map((corpus, index) => normalizeCorpusConfig(corpus, index, seenKeys));
  if (!normalizedCorpora.some((corpus) => corpus.key === canonicalCorpusKey)) {
    throw new Error(`canonicalTopicSet.corpusKey does not match a configured corpus: ${canonicalCorpusKey}`);
  }

  return {
    configPath,
    schemaVersion: 1,
    publication: {
      name: optionalString(rawConfig.publication?.name) ?? "Papyrus",
    },
    canonicalTopicSet: {
      corpusKey: canonicalCorpusKey,
      classifierId: canonicalClassifierId,
    },
    corpora: normalizedCorpora,
  };
}

function normalizeCorpusConfig(corpus, index, seenKeys) {
  if (!corpus || typeof corpus !== "object") throw new Error(`corpora[${index}] must be an object.`);
  const key = requiredString(corpus.key, `corpora[${index}].key`);
  if (seenKeys.has(key)) throw new Error(`Duplicate corpus key in steering config: ${key}`);
  seenKeys.add(key);

  const role = optionalString(corpus.role) ?? "source";
  if (!VALID_CORPUS_ROLES.has(role)) {
    throw new Error(`Unsupported role for corpus ${key}: ${role}`);
  }

  const localClassifiers = Array.isArray(corpus.localClassifiers)
    ? corpus.localClassifiers.map((classifier, classifierIndex) => ({
        classifierId: requiredString(classifier?.classifierId, `corpora[${index}].localClassifiers[${classifierIndex}].classifierId`),
        label: optionalString(classifier?.label) ?? requiredString(classifier?.classifierId, `corpora[${index}].localClassifiers[${classifierIndex}].classifierId`),
      }))
    : [];

  const canonicalProjection = corpus.canonicalProjection && typeof corpus.canonicalProjection === "object"
    ? {
        authorityCorpusKey: requiredString(corpus.canonicalProjection.authorityCorpusKey, `corpora[${index}].canonicalProjection.authorityCorpusKey`),
        classifierId: requiredString(corpus.canonicalProjection.classifierId, `corpora[${index}].canonicalProjection.classifierId`),
      }
    : null;

  return {
    key,
    name: optionalString(corpus.name) ?? key,
    path: optionalString(corpus.path),
    s3Prefix: optionalString(corpus.s3Prefix),
    role,
    localClassifiers,
    canonicalProjection,
  };
}

function findCorpusConfig(config, corpusKey) {
  if (!config || !corpusKey) return null;
  return config.corpora.find((corpus) => corpus.key === corpusKey) ?? null;
}

function requireCorpusConfig(config, corpusKey, fieldName = "corpus key") {
  const corpus = findCorpusConfig(config, corpusKey);
  if (!corpus) throw new Error(`Unknown ${fieldName}: ${corpusKey}`);
  return corpus;
}

function findCorpusConfigByPath(config, corpusPath) {
  if (!config || !corpusPath) return null;
  const normalizedInput = normalizePathLike(corpusPath);
  return config.corpora.find((corpus) => normalizePathLike(corpus.path) === normalizedInput) ?? null;
}

function resolveClassifierForCorpus(config, corpus, explicitClassifier) {
  if (explicitClassifier) return explicitClassifier;
  if (corpus.key === config.canonicalTopicSet.corpusKey) return config.canonicalTopicSet.classifierId;
  if (corpus.localClassifiers.length === 1) return corpus.localClassifiers[0].classifierId;
  throw new Error(`--classifier is required for corpus ${corpus.key}; config does not identify exactly one classifier.`);
}

function normalizePathLike(value) {
  const normalized = String(value ?? "").replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized || normalized.startsWith("s3://")) return normalized;
  return path.resolve(normalized).replace(/\\/g, "/");
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

module.exports = {
  DEFAULT_STEERING_CONFIG,
  findCorpusConfig,
  findCorpusConfigByPath,
  loadSteeringConfig,
  requireCorpusConfig,
  requireSteeringConfig,
  resolveSteeringConfigPath,
  resolveClassifierForCorpus,
};
