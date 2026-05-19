const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const {
  knowledgeCorpusId,
} = require("./papyrus-categories.cjs");
const {
  requireCorpusConfig,
} = require("./papyrus-steering-config.cjs");
const {
  semanticRelationTypeFieldsForPredicate,
} = require("./papyrus-relation-types.cjs");
const {
  getAssignmentTypePolicy,
} = require("./papyrus-assignment-types.cjs");
const {
  assignmentSectionFields,
} = require("./papyrus-assignment-context.cjs");

const DEFAULT_ANALYSIS_PROFILES_PATH = path.join(__dirname, "..", "..", "corpora", "papyrus-analysis-profiles.yml");
const DEFAULT_BIBLICUS_WORKDIR = "/Users/ryan/Projects/Biblicus";

const VALID_SCOPES = new Set([
  "global-topic-model",
  "scoped-topic-model",
  "topic-classifier-train",
  "topic-projection",
  "entity-graph",
]);

const VALID_MODES = new Set([
  "online-update",
  "classifier-retrain",
  "scoped-topic-rebuild",
  "entity-graph-rebuild",
  "generated-analysis-rebuild",
]);

const SAFE_OVERRIDE_KEYS = new Set([
  "text_source.sample_size",
  "text_source.min_text_characters",
  "lexical_processing.enabled",
  "lexical_processing.lowercase",
  "lexical_processing.strip_punctuation",
  "lexical_processing.collapse_whitespace",
  "entity_removal.enabled",
  "entity_removal.model",
  "entity_removal.entity_types",
  "entity_removal.regex_patterns",
  "bertopic_analysis.parameters.nr_topics",
  "bertopic_analysis.parameters.min_topic_size",
  "bertopic_analysis.vectorizer.ngram_range",
  "bertopic_analysis.vectorizer.stop_words",
  "bertopic_analysis.umap_model.parameters.n_neighbors",
  "bertopic_analysis.umap_model.parameters.n_components",
  "bertopic_analysis.umap_model.parameters.min_dist",
  "bertopic_analysis.umap_model.parameters.metric",
  "bertopic_analysis.hdbscan_model.parameters.min_cluster_size",
  "bertopic_analysis.hdbscan_model.parameters.min_samples",
  "bertopic_analysis.hdbscan_model.parameters.cluster_selection_method",
  "bertopic_analysis.representation_model.model",
  "bertopic_analysis.representation_model.nr_docs",
  "bertopic_analysis.representation_model.delay_in_seconds",
  "bertopic_analysis.representation_model",
  "targetTopicRange",
  "seedManifestPath",
  "authorityCorpusKey",
  "topK",
  "reviewThreshold",
  "extractionSnapshot",
  "steeringFeedbackPath",
  "graph.extractor",
  "graph.configurationName",
  "graph.model",
  "graph.min_entity_length",
  "graph.max_entity_length",
  "graph.entity_labels",
  "graph.include_item_node",
  "graph.include_relation_edges",
  "graph.max_relation_entities_per_sentence",
  "graph.min_relation_weight",
  "graph.max_items",
]);

function loadAnalysisProfiles(filepath = DEFAULT_ANALYSIS_PROFILES_PATH) {
  const resolvedPath = path.resolve(filepath);
  const parsed = YAML.parse(fs.readFileSync(resolvedPath, "utf8"));
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.profiles)) {
    throw new Error(`Invalid analysis profile file: ${resolvedPath}`);
  }
  const keys = new Set();
  const profiles = parsed.profiles.map((entry, index) => normalizeAnalysisProfile(entry, index, resolvedPath));
  for (const profile of profiles) {
    if (keys.has(profile.key)) throw new Error(`Duplicate analysis profile key ${profile.key} in ${resolvedPath}.`);
    keys.add(profile.key);
  }
  return {
    schemaVersion: 1,
    filepath: resolvedPath,
    profiles,
  };
}

function normalizeAnalysisProfile(entry, index, filepath) {
  const key = cleanString(entry.key);
  if (!key) throw new Error(`Analysis profile at index ${index} in ${filepath} is missing key.`);
  const scope = cleanString(entry.scope);
  if (!VALID_SCOPES.has(scope)) throw new Error(`Analysis profile ${key} has unsupported scope ${scope}.`);
  const defaultMode = cleanString(entry.defaultMode);
  if (!VALID_MODES.has(defaultMode)) throw new Error(`Analysis profile ${key} has unsupported defaultMode ${defaultMode}.`);
  const allowedOverrides = normalizeStringArray(entry.allowedOverrides);
  for (const overrideKey of allowedOverrides) {
    if (!SAFE_OVERRIDE_KEYS.has(overrideKey)) {
      throw new Error(`Analysis profile ${key} allows unsafe override ${overrideKey}.`);
    }
  }
  const biblicus = entry.biblicus && typeof entry.biblicus === "object" ? entry.biblicus : {};
  return {
    key,
    title: cleanString(entry.title) || key,
    description: cleanString(entry.description) || "",
    scope,
    defaultMode,
    corpusKey: cleanString(entry.corpusKey) || null,
    classifierId: cleanString(entry.classifierId) || null,
    configurationName: cleanString(entry.configurationName) || key,
    biblicus: {
      extractor: cleanString(biblicus.extractor) || null,
      configurations: normalizeStringArray(biblicus.configurations),
    },
    defaults: entry.defaults && typeof entry.defaults === "object" ? { ...entry.defaults } : {},
    execution: normalizeExecutionProfile(entry.execution),
    allowedOverrides,
    expectedOutputs: normalizeStringArray(entry.expectedOutputs),
  };
}

function normalizeExecutionProfile(execution) {
  const source = execution && typeof execution === "object" ? execution : {};
  const maxRuntimeSeconds = source.maxRuntimeSeconds === null || source.maxRuntimeSeconds === undefined
    ? null
    : Number(source.maxRuntimeSeconds);
  if (maxRuntimeSeconds !== null && (!Number.isInteger(maxRuntimeSeconds) || maxRuntimeSeconds <= 0)) {
    throw new Error("Analysis profile execution.maxRuntimeSeconds must be a positive integer.");
  }
  const criteria = source.successCriteria && typeof source.successCriteria === "object" ? source.successCriteria : {};
  return {
    maxRuntimeSeconds,
    successCriteria: {
      minNodes: normalizeOptionalNumber(criteria.minNodes, "execution.successCriteria.minNodes"),
      minEdges: normalizeOptionalNumber(criteria.minEdges, "execution.successCriteria.minEdges"),
      maxErrorRate: normalizeOptionalNumber(criteria.maxErrorRate, "execution.successCriteria.maxErrorRate"),
    },
  };
}

function normalizeOptionalNumber(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Analysis profile ${label} must be numeric.`);
  return parsed;
}

function summarizeAnalysisProfiles(config) {
  return config.profiles.map((profile) => ({
    key: profile.key,
    title: profile.title,
    description: profile.description,
    scope: profile.scope,
    defaultMode: profile.defaultMode,
    corpusKey: profile.corpusKey,
    classifierId: profile.classifierId,
    configurationName: profile.configurationName,
    biblicus: profile.biblicus,
    defaults: profile.defaults,
    execution: profile.execution,
    allowedOverrides: profile.allowedOverrides,
    expectedOutputs: profile.expectedOutputs,
  }));
}

function analysisProfileByKey(config, key) {
  const profile = config.profiles.find((entry) => entry.key === key);
  if (!profile) throw new Error(`Unknown analysis profile ${key}.`);
  return profile;
}

function parseAnalysisOverrides(values, profile) {
  const entries = Array.isArray(values) ? values : values ? [values] : [];
  const parsed = {};
  for (const entry of entries) {
    const text = String(entry ?? "");
    const equalsIndex = text.indexOf("=");
    if (equalsIndex <= 0) throw new Error(`Invalid override ${text}; expected key=value.`);
    const key = text.slice(0, equalsIndex).trim();
    if (!profile.allowedOverrides.includes(key)) throw new Error(`Override ${key} is not allowed for profile ${profile.key}.`);
    parsed[key] = parseOverrideValue(text.slice(equalsIndex + 1).trim());
  }
  return parsed;
}

function buildAnalysisReindexPlan({
  profilesConfig,
  steeringConfig,
  profileKey,
  corpusKey,
  mode,
  overrides = {},
  now = new Date().toISOString(),
  runId,
  biblicusWorkdir,
  categorySetId,
  categoryKey,
} = {}) {
  if (!profilesConfig) throw new Error("profilesConfig is required.");
  if (!steeringConfig) throw new Error("steeringConfig is required.");
  const profile = analysisProfileByKey(profilesConfig, profileKey);
  const selectedMode = mode || profile.defaultMode;
  if (!VALID_MODES.has(selectedMode)) throw new Error(`Unsupported re-index mode ${selectedMode}.`);
  validateOverrideObject(overrides, profile);
  const selectedCorpusKey = corpusKey || profile.corpusKey;
  if (!selectedCorpusKey) throw new Error(`Analysis profile ${profile.key} requires a corpus key.`);
  const corpus = requireCorpusConfig(steeringConfig, selectedCorpusKey, "--corpus-key");
  const corpusId = knowledgeCorpusId(corpus);
  const classifierId = cleanString(overrides.classifierId) || profile.classifierId || resolveClassifierId(steeringConfig, corpus);
  const rawEffective = {
    ...profile.defaults,
    ...overrides,
  };
  const resolvedRunId = runId || `analysis-reindex-${safeId(profile.key)}-${safeId(selectedCorpusKey)}-${hashShort([selectedMode, rawEffective])}`;
  const resolvedBiblicusWorkdir = path.resolve(biblicusWorkdir || process.env.BIBLICUS_WORKDIR || DEFAULT_BIBLICUS_WORKDIR);
  const effective = resolveParameterPlaceholders(rawEffective, {
    runId: resolvedRunId,
    profileKey: profile.key,
    corpusKey: selectedCorpusKey,
    corpusId,
    classifierId,
    biblicusWorkdir: resolvedBiblicusWorkdir,
  });
  if (cleanString(effective.steeringFeedbackPath) && !path.isAbsolute(effective.steeringFeedbackPath)) {
    effective.steeringFeedbackPath = path.resolve(process.cwd(), effective.steeringFeedbackPath);
  }
  const commandPlan = buildCommandPlan({
    profile,
    mode: selectedMode,
    corpus,
    corpusId,
    classifierId,
    effective,
    steeringConfig,
    biblicusWorkdir: resolvedBiblicusWorkdir,
  });
  return {
    schemaVersion: 1,
    kind: "papyrus.analysis.reindex.plan",
    runId: resolvedRunId,
    generatedAt: now,
    profile: {
      key: profile.key,
      title: profile.title,
      description: profile.description,
      scope: profile.scope,
      defaultMode: profile.defaultMode,
    },
    mode: selectedMode,
    corpus: {
      key: corpus.key,
      id: corpusId,
      name: corpus.name,
      path: corpus.path,
      role: corpus.role,
    },
    classifierId,
    categorySetId: categorySetId || null,
    categoryKey: categoryKey || null,
    profilesPath: profilesConfig.filepath,
    steeringConfigPath: steeringConfig.configPath || null,
    biblicusWorkdir: resolvedBiblicusWorkdir,
    parameterOverrides: overrides,
    effectiveParameters: effective,
    execution: profile.execution,
    commandPlan,
    destructivePlan: buildDestructivePlan({
      mode: selectedMode,
      profile,
      corpus,
      corpusId,
      classifierId,
      categorySetId,
      categoryKey,
    }),
    expectedOutputs: profile.expectedOutputs,
    warnings: buildPlanWarnings({ profile, effective }),
  };
}

function buildAnalysisReindexAssignmentRecords(plan, { categorySet = null, sectionTarget = null, existing = {}, now = plan.generatedAt, actorLabel = "papyrus-content-cli" } = {}) {
  const assignmentTypeKey = "analysis.reindex";
  const assignmentTypePolicy = getAssignmentTypePolicy(assignmentTypeKey);
  const assignmentId = `assignment-analysis-reindex-${safeId(plan.corpus.key)}-${safeId(plan.profile.key)}-${hashShort([
    plan.mode,
    plan.parameterOverrides,
    plan.categoryKey || "",
    plan.runId || "",
  ])}`;
  const queueKey = `analysis:reindex:${safeId(plan.corpus.key)}:${plan.profile.scope}`;
  const metadata = {
    kind: "analysis.reindex.requested",
    analysisProfileKey: plan.profile.key,
    analysisProfileTitle: plan.profile.title,
    analysisScope: plan.profile.scope,
    reindexMode: plan.mode,
    corpusKey: plan.corpus.key,
    corpusId: plan.corpus.id,
    classifierId: plan.classifierId,
    categorySetId: plan.categorySetId,
    categoryKey: plan.categoryKey,
    sectionId: sectionTarget?.id ?? null,
    sectionKey: sectionTarget?.id ?? null,
    sectionTitle: sectionTarget?.title ?? null,
    sectionType: sectionTarget?.type === "rotating" ? "floating" : sectionTarget?.type ?? null,
    sectionMission: sectionTarget?.editorialMission ?? null,
    sectionPolicies: sectionTarget?.editorialPolicy ? [sectionTarget.editorialPolicy] : [],
    assignmentGuidance: sectionTarget?.assignmentGuidance ?? null,
    killCriteria: sectionTarget?.killCriteria ?? null,
    visualGuidance: sectionTarget?.visualGuidance ?? null,
    primaryFocusCategoryKey: plan.categoryKey ?? null,
    topicScopeCategoryKeys: [plan.categoryKey].filter(Boolean),
    parameterOverrides: plan.parameterOverrides,
    effectiveParameters: plan.effectiveParameters,
    commandPlan: plan.commandPlan,
    destructivePlan: plan.destructivePlan,
    assignmentTypePolicy,
    expectedOutputs: plan.expectedOutputs,
    execution: plan.execution,
    planRunId: plan.runId,
    profilesPath: plan.profilesPath,
    steeringConfigPath: plan.steeringConfigPath,
    biblicusWorkdir: plan.biblicusWorkdir,
  };
  const assignment = {
    id: assignmentId,
    assignmentTypeKey,
    queueKey,
    queueStatusKey: `${queueKey}#open`,
    status: "open",
    priority: 40,
    title: `Re-index ${plan.profile.title}`,
    brief: `Prepare ${plan.mode} for ${plan.corpus.key} using ${plan.profile.key}.`,
    instructions: "Inspect this dry-run command plan, confirm the generated-analysis cleanup scope, then run Biblicus explicitly. Creating this assignment must not execute analysis or cleanup.",
    assigneeType: null,
    assigneeId: null,
    assigneeKey: null,
    claimedAt: null,
    claimExpiresAt: null,
    completedAt: null,
    canceledAt: null,
    corpusId: plan.corpus.id,
    categorySetId: plan.categorySetId,
    classifierId: plan.classifierId,
    ...assignmentSectionFields({
      sectionTarget,
      status: "open",
      queueKey,
      primaryFocusCategoryKey: plan.categoryKey,
      topicScopeCategoryKeys: [plan.categoryKey].filter(Boolean),
    }),
    sourceSnapshotId: cleanString(plan.effectiveParameters.extractionSnapshot) || null,
    importRunId: null,
    createdBy: actorLabel,
    createdAt: now,
    updatedAt: now,
    metadata: JSON.stringify(metadata),
  };
  const event = {
    id: `assignment-event-${assignmentId}-created`,
    assignmentId,
    assignmentTypeKey: assignment.assignmentTypeKey,
    queueKey,
    eventType: "created",
    fromStatus: null,
    toStatus: "open",
    actorSub: null,
    actorLabel,
    note: "Created re-index assignment from analysis profile.",
    createdAt: now,
    metadata: JSON.stringify({
      kind: "analysis.reindex.assignment_created",
      analysisProfileKey: plan.profile.key,
      reindexMode: plan.mode,
      corpusKey: plan.corpus.key,
      commandCount: plan.commandPlan.length,
    }),
  };
  const records = [
    withAction("Assignment", assignment, existing),
    withAction("AssignmentEvent", event, existing),
  ];
  if (categorySet) {
    records.push(withAction("SemanticRelation", semanticRelationRecord({
      predicate: "requests_work_on",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      subjectVersionNumber: null,
      objectKind: "categorySet",
      objectId: categorySet.id,
      objectLineageId: categorySet.lineageId || categorySet.id,
      objectVersionNumber: categorySet.versionNumber ?? null,
      rank: 1,
      classifierId: plan.classifierId,
      importedAt: now,
      metadata: {
        analysisProfileKey: plan.profile.key,
        reindexMode: plan.mode,
        corpusKey: plan.corpus.key,
      },
    }).expected, existing));
  }
  if (sectionTarget) {
    records.push(withAction("SemanticRelation", semanticRelationRecord({
      predicate: "targets_section",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      subjectVersionNumber: null,
      objectKind: "newsroomSection",
      objectId: sectionTarget.id,
      objectLineageId: sectionTarget.id,
      objectVersionNumber: null,
      rank: 1,
      importedAt: now,
      metadata: {
        analysisProfileKey: plan.profile.key,
        reindexMode: plan.mode,
        corpusKey: plan.corpus.key,
        sectionKey: sectionTarget.id,
        sectionTitle: sectionTarget.title,
      },
    }).expected, existing));
  }
  return {
    assignment,
    records,
    metadata,
  };
}

function buildCommandPlan({ profile, mode, corpus, classifierId, effective, steeringConfig, biblicusWorkdir }) {
  const corpusPath = corpus.path || `corpora/${corpus.key}`;
  const extractionSnapshot = cleanString(effective.extractionSnapshot) || "<extraction-snapshot>";
  const configurationName = cleanString(effective["graph.configurationName"]) || profile.configurationName;
  const configurations = normalizeStringArray(profile.biblicus.configurations);
  if (profile.scope === "global-topic-model") {
    return [command("topic-granularity-sweep", biblicusWorkdir, [
      "analyze", "topic-granularity-sweep",
      "--corpus", corpusPath,
      ...configurationArgs(configurations),
      ...overrideArgs(effective, profile, { exclude: new Set(["targetTopicRange", "extractionSnapshot"]) }),
      "--configuration-name", configurationName,
      "--extraction-snapshot", extractionSnapshot,
      "--target-topic-range", cleanString(effective.targetTopicRange) || "10:20",
      "--format", "json",
    ], { mode })];
  }
  if (profile.scope === "topic-classifier-train") {
    const manifestPath = cleanString(effective.seedManifestPath)
      || path.join(corpusPath, "metadata", "topic-classifiers", classifierId, "seed-manifest.json");
    return [command("topic-classifier-train", biblicusWorkdir, [
      "topic-classifier", "train",
      "--corpus", corpusPath,
      "--manifest", manifestPath,
      ...configurationArgs(configurations),
      ...overrideArgs(effective, profile, { exclude: new Set(["seedManifestPath", "extractionSnapshot"]) }),
      "--configuration-name", configurationName,
      "--extraction-snapshot", extractionSnapshot,
    ], { mode })];
  }
  if (profile.scope === "scoped-topic-model") {
    const steeringFeedbackPath = cleanString(effective.steeringFeedbackPath);
    return [command("taxonomy-discover", biblicusWorkdir, [
      "taxonomy", "discover",
      "--corpus", corpusPath,
      "--classifier", classifierId,
      "--extraction-snapshot", extractionSnapshot,
      ...(steeringFeedbackPath ? ["--steering-feedback", steeringFeedbackPath] : []),
      "--format", "json",
    ], { mode })];
  }
  if (profile.scope === "topic-projection") {
    const authorityCorpusKey = cleanString(effective.authorityCorpusKey) || corpus.canonicalProjection?.authorityCorpusKey || steeringConfig.canonicalTopicSet?.corpusKey;
    const authorityCorpus = authorityCorpusKey ? requireCorpusConfig(steeringConfig, authorityCorpusKey, "authorityCorpusKey") : corpus;
    const authorityPath = authorityCorpus.path || `corpora/${authorityCorpus.key}`;
    return [command("topic-classifier-project", biblicusWorkdir, [
      "topic-classifier", "project",
      "--classifier-corpus", authorityPath,
      "--target-corpus", corpusPath,
      "--classifier", classifierId,
      "--extraction-snapshot", extractionSnapshot,
      "--all",
      "--top-k", String(effective.topK ?? 5),
      "--review-threshold", String(effective.reviewThreshold ?? 0.35),
      "--format", "json",
    ], { mode })];
  }
  if (profile.scope === "entity-graph") {
    const extractor = cleanString(effective["graph.extractor"]) || profile.biblicus.extractor || "ner-entities";
    return [command("graph-extract", biblicusWorkdir, [
      "graph", "extract",
      "--corpus", corpusPath,
      "--extractor", extractor,
      "--extraction-snapshot", extractionSnapshot,
      "--configuration-name", configurationName,
      ...configurationArgs(configurations),
      ...graphOverrideArgs(effective, profile),
    ], { mode, extras: ["topic-modeling", "openai", "neo4j", "ner"] })];
  }
  throw new Error(`Unsupported analysis profile scope ${profile.scope}.`);
}

function buildDestructivePlan({ mode, profile, corpus, corpusId, classifierId, categorySetId, categoryKey }) {
  const generated = [];
  if (mode === "generated-analysis-rebuild" || mode === "classifier-retrain" || mode === "online-update") {
    generated.push({
      modelName: "SemanticRelation",
      relationTypes: ["classified_as"],
      corpusId,
      classifierId,
      note: "Generated projection predictions can be cleared for this profile before importing a fresh projection.",
    });
  }
  if (mode === "entity-graph-rebuild" || (mode === "generated-analysis-rebuild" && profile.scope === "entity-graph")) {
    generated.push({
      modelName: "SemanticNode/SemanticRelation",
      relationDomains: ["ontology"],
      corpusId,
      note: "Generated graph nodes and graph relations should be cleared only by recorded graph import provenance.",
    });
  }
  if (mode === "scoped-topic-rebuild") {
    generated.push({
      modelName: "SteeringProposal",
      corpusId,
      categorySetId: categorySetId || null,
      categoryKey: categoryKey || null,
      note: "Scoped topic discovery emits proposals; reviewed accepted/rejected decisions remain application-owned.",
    });
  }
  return {
    mutatesGraphqlNow: false,
    executesBiblicusNow: false,
    mode,
    profileKey: profile.key,
    targetCorpusId: corpusId,
    generatedOutputs: generated,
    preservedRecords: [
      "Reference",
      "ReferenceAttachment",
      "Message",
      "CategorySet",
      "Category",
      "authoritative labels",
      "review decisions",
    ],
  };
}

function buildPlanWarnings({ profile, effective }) {
  const warnings = [];
  const snapshot = cleanString(effective.extractionSnapshot);
  if (!snapshot || snapshot.includes("<")) warnings.push("Extraction snapshot is a placeholder and must be resolved before execution.");
  if (profile.scope === "scoped-topic-model" && !cleanString(effective.steeringFeedbackPath)) {
    warnings.push("No steering feedback path is configured; Biblicus may re-emit previously rejected topic proposals.");
  }
  return warnings;
}

function resolveParameterPlaceholders(value, context) {
  if (typeof value === "string") {
    return value
      .replaceAll("<run-id>", context.runId)
      .replaceAll("<profile-key>", context.profileKey)
      .replaceAll("<corpus-key>", context.corpusKey)
      .replaceAll("<corpus-id>", context.corpusId)
      .replaceAll("<classifier-id>", context.classifierId)
      .replaceAll("<biblicus-workdir>", context.biblicusWorkdir);
  }
  if (Array.isArray(value)) return value.map((entry) => resolveParameterPlaceholders(entry, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveParameterPlaceholders(entry, context)]));
  }
  return value;
}

function validateOverrideObject(overrides, profile) {
  for (const key of Object.keys(overrides || {})) {
    if (!profile.allowedOverrides.includes(key)) throw new Error(`Override ${key} is not allowed for profile ${profile.key}.`);
  }
}

function configurationArgs(configurations) {
  return configurations.flatMap((configuration) => ["--configuration", configuration]);
}

function overrideArgs(effective, profile, { exclude = new Set() } = {}) {
  return Object.entries(effective)
    .filter(([key]) => profile.allowedOverrides.includes(key))
    .filter(([key]) => !exclude.has(key))
    .filter(([key]) => !key.startsWith("graph."))
    .map(([key, value]) => ["--override", `${key}=${formatOverrideValue(value)}`])
    .flat();
}

function graphOverrideArgs(effective, profile) {
  const graphKeyMap = new Map([
    ["graph.model", "model"],
    ["graph.min_entity_length", "min_entity_length"],
    ["graph.max_entity_length", "max_entity_length"],
    ["graph.entity_labels", "entity_labels"],
    ["graph.include_item_node", "include_item_node"],
    ["graph.include_relation_edges", "include_relation_edges"],
    ["graph.max_relation_entities_per_sentence", "max_relation_entities_per_sentence"],
    ["graph.min_relation_weight", "min_relation_weight"],
  ]);
  const args = Object.entries(effective)
    .filter(([key]) => profile.allowedOverrides.includes(key))
    .filter(([key]) => graphKeyMap.has(key))
    .map(([key, value]) => ["--override", `${graphKeyMap.get(key)}=${formatOverrideValue(value)}`])
    .flat();
  if (profile.allowedOverrides.includes("graph.max_items") && effective["graph.max_items"] !== undefined) {
    args.push("--max-items", String(effective["graph.max_items"]));
  }
  return args;
}

function command(label, cwd, args, metadata = {}) {
  const extras = normalizeStringArray(metadata.extras ?? ["topic-modeling", "openai"]);
  return {
    label,
    cwd,
    executable: "uv",
    args: ["run", ...extras.flatMap((extra) => ["--extra", extra]), "biblicus", ...args],
    metadata: Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "extras")),
  };
}

function resolveClassifierId(config, corpus) {
  if (corpus.localClassifiers?.[0]?.classifierId) return corpus.localClassifiers[0].classifierId;
  if (corpus.canonicalProjection?.classifierId) return corpus.canonicalProjection.classifierId;
  if (config.canonicalTopicSet?.corpusKey === corpus.key && config.canonicalTopicSet.classifierId) return config.canonicalTopicSet.classifierId;
  return `${safeId(corpus.key || corpus.name || "corpus")}-classifier`;
}

function semanticRelationRecord(input) {
  const subjectStateKey = semanticStateKey(input.subjectKind, input.subjectLineageId);
  const objectStateKey = semanticStateKey(input.objectKind, input.objectLineageId);
  const subjectVersionKey = semanticVersionKey(input.subjectKind, input.subjectId);
  const objectVersionKey = semanticVersionKey(input.objectKind, input.objectId);
  return {
    modelName: "SemanticRelation",
    expected: {
      id: `semantic-relation-${hashShort([
        subjectVersionKey,
        input.predicate,
        objectVersionKey,
        input.rank ?? "",
        input.classifierId ?? "",
      ])}`,
      relationState: "current",
      predicate: input.predicate,
      ...semanticRelationTypeFieldsForPredicate(input.predicate),
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      subjectLineageId: input.subjectLineageId,
      subjectVersionNumber: input.subjectVersionNumber,
      objectKind: input.objectKind,
      objectId: input.objectId,
      objectLineageId: input.objectLineageId,
      objectVersionNumber: input.objectVersionNumber,
      subjectStateKey,
      objectStateKey,
      objectSubjectStateKey: `${objectStateKey}#${input.subjectKind}`,
      predicateObjectStateKey: `${input.predicate}#${objectStateKey}`,
      subjectVersionKey,
      objectVersionKey,
      score: Number.isFinite(Number(input.score)) ? Number(input.score) : 1,
      confidence: null,
      rank: input.rank ?? null,
      classifierId: input.classifierId ?? null,
      modelVersion: null,
      reviewRecommended: false,
      sourceSnapshotId: null,
      importRunId: null,
      importedAt: input.importedAt,
      createdAt: input.createdAt ?? input.importedAt,
      updatedAt: input.updatedAt ?? input.importedAt,
      newsroomFeedKey: "semanticRelations",
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  };
}

function withAction(modelName, expected, existing) {
  const current = existing[modelName]?.get(expected.id) ?? null;
  if (current && ["Assignment", "AssignmentEvent", "SemanticRelation"].includes(modelName)) {
    return { modelName, expected: current, current, action: "noop" };
  }
  return { modelName, expected, current, action: current ? "update" : "create" };
}

function mapExistingRecords(recordsByModel) {
  const result = {};
  for (const [modelName, records] of Object.entries(recordsByModel || {})) {
    result[modelName] = new Map((records || []).map((record) => [record.id, record]));
  }
  return result;
}

function parseOverrideValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    return JSON.parse(value);
  }
  return value;
}

function formatOverrideValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value);
  return String(value);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => cleanString(entry)).filter(Boolean);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeId(value) {
  return String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function hashShort(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function semanticStateKey(kind, lineageId) {
  return `${kind}#${lineageId}#current`;
}

function semanticVersionKey(kind, id) {
  return `${kind}#${id}`;
}

module.exports = {
  DEFAULT_ANALYSIS_PROFILES_PATH,
  SAFE_OVERRIDE_KEYS,
  VALID_MODES,
  VALID_SCOPES,
  buildAnalysisReindexAssignmentRecords,
  buildAnalysisReindexPlan,
  loadAnalysisProfiles,
  mapExistingRecords,
  parseAnalysisOverrides,
  summarizeAnalysisProfiles,
};
