const path = require("node:path");
const {
  knowledgeCorpusId,
} = require("./papyrus-categories.cjs");
const {
  requireCorpusConfig,
} = require("./papyrus-steering-config.cjs");

const DEFAULT_BIBLICUS_WORKDIR = "/Users/ryan/Projects/Biblicus";

function buildCurationCyclePlan(config, options = {}) {
  if (!config) throw new Error("A steering config is required to run the curation cycle.");
  const runId = options.runId ?? timestampRunId(new Date());
  const runDir = path.resolve(options.outputDir ?? path.join(".papyrus-runs", runId));
  const biblicusWorkdir = path.resolve(options.biblicusWorkdir ?? process.env.BIBLICUS_WORKDIR ?? DEFAULT_BIBLICUS_WORKDIR);
  const canonicalCorpus = requireCorpusConfig(config, config.canonicalTopicSet.corpusKey, "canonicalTopicSet.corpusKey");
  const canonicalClassifierId = config.canonicalTopicSet.classifierId;
  const sourceProjections = config.corpora
    .filter((corpus) => corpus.key !== canonicalCorpus.key)
    .filter((corpus) => corpus.canonicalProjection?.authorityCorpusKey === canonicalCorpus.key)
    .map((corpus) => ({
      targetCorpus: corpus,
      targetCorpusId: knowledgeCorpusId(corpus),
      authorityCorpus: canonicalCorpus,
      authorityCorpusId: knowledgeCorpusId(canonicalCorpus),
      classifierId: corpus.canonicalProjection.classifierId,
      projectionPath: path.join(runDir, `${corpus.key}-projection.json`),
      targetSteeringPath: path.join(runDir, `${corpus.key}-steering-export.json`),
    }));

  return {
    runId,
    runDir,
    biblicusWorkdir,
    configPath: config.configPath,
    canonical: {
      corpus: canonicalCorpus,
      corpusId: knowledgeCorpusId(canonicalCorpus),
      classifierId: canonicalClassifierId,
      steeringPath: path.join(runDir, `${canonicalCorpus.key}-steering-export.json`),
      categorySetPath: path.join(runDir, `${canonicalCorpus.key}-accepted-category-set.json`),
      categoryTreePath: path.join(runDir, `${canonicalCorpus.key}-accepted-category-tree.json`),
      steeringFeedbackPath: path.join(runDir, `${canonicalCorpus.key}-steering-feedback.json`),
      lexicalSteeringPath: path.join(runDir, `${canonicalCorpus.key}-lexical-steering.json`),
      taxonomyDiscoveryPath: path.join(runDir, `${canonicalCorpus.key}-taxonomy-discovery.json`),
      seedManifestPath: path.join(biblicusWorkdir, canonicalCorpus.path ?? "", "metadata", "topic-classifiers", canonicalClassifierId, "seed-manifest.json"),
    },
    sourceProjections,
    verificationPath: path.join(runDir, "verification.json"),
  };
}

function timestampRunId(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

module.exports = {
  DEFAULT_BIBLICUS_WORKDIR,
  buildCurationCyclePlan,
  timestampRunId,
};
