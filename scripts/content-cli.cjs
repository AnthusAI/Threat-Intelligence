#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const YAML = require("yaml");

const {
  decodeJwtClaims,
  getGraphQLEndpoint,
  getJwtToken,
  isJwtExpired,
  loadDotEnv,
} = require("./lib/papyrus-env.cjs");
const {
  buildAcceptedCategorySetPayload,
  buildAcceptedCategoryTreePayload,
  buildLexicalSteeringConfigRecords,
  buildLexicalSteeringPayload,
  buildPreparedReferenceCatalog,
  buildReferenceCatalogRegistrationRecords,
  buildSteeringFeedbackPayload,
  buildSteeringConfigRecords,
  buildProjectionImportRecords,
  buildSteeringImportRecords,
  knowledgeCorpusId,
  loadJsonFile,
  loadLexicalSteeringConfig,
  loadSteeringBundleFromBiblicus,
  mergeReviewedProposalState,
  normalizeReferenceCurationStatus,
  normalizeReferenceRejectionReasonCode,
  scopeTrainingLabelForReference,
  writeJsonFile,
} = require("./lib/papyrus-categories.cjs");
const {
  buildCurationCyclePlan,
} = require("./lib/papyrus-curation-cycle.cjs");
const {
  DEFAULT_ANALYSIS_PROFILES_PATH,
  buildAnalysisReindexAssignmentRecords,
  buildAnalysisReindexPlan,
  loadAnalysisProfiles,
  mapExistingRecords,
  parseAnalysisOverrides,
  summarizeAnalysisProfiles,
} = require("./lib/papyrus-analysis-profiles.cjs");
const {
  DEFAULT_RELATION_TYPES_PATH,
  buildSemanticRelationBackfillRecords,
  buildSemanticRelationTypeRecords,
  loadSemanticRelationTypeSeeds,
  semanticRelationTypeFieldsForPredicate,
} = require("./lib/papyrus-relation-types.cjs");
const {
  applyEditionPlanningPlan,
  buildEditionPlanningPlan,
  loadEditionPlanningState,
  verifyEditionPlanningPlan,
  writeEditionPlanningReport,
} = require("./lib/papyrus-edition-planning.cjs");
const {
  NEWSROOM_SUMMARY_PAYLOAD_ID,
  buildNewsroomSummaryPayload,
  buildNewsroomSummaryPayloadRecord,
  computeCurrentReferenceDeltaFromChanges,
  normalizeNewsroomSummaryPayload,
} = require("./lib/papyrus-newsroom-summary.cjs");
const {
  findCorpusConfigByPath,
  loadSteeringConfig,
  requireCorpusConfig,
  requireSteeringConfig,
  resolveClassifierForCorpus,
} = require("./lib/papyrus-steering-config.cjs");
const { PapyrusGraphQLAuthoringClient } = require("./lib/papyrus-graphql-authoring.cjs");
const { getArticleImageAssets, getMarkdownArticle, loadEditionConfig, loadMarkdownArticles } = require("./lib/papyrus-markdown.cjs");

const OPTIONAL_SCHEMA_MODELS = new Set(["CategoryKeyword", "LexicalSteeringRule"]);

async function main() {
  loadDotEnv();

  const args = process.argv.slice(2);
  const [group, command, value] = args;
  if (group !== "content" && group !== "categories" && group !== "assignments" && group !== "editions" && group !== "relations" && group !== "references" && group !== "messages" && group !== "analysis" && group !== "newsroom") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  switch (`${group}:${command}`) {
    case "content:inspect":
      await inspect();
      return;
    case "content:list":
      if (value !== "articles") {
        printUsage();
        process.exitCode = 1;
        return;
      }
      await listArticles();
      return;
    case "content:sync":
      await handleSync(value, process.argv[5]);
      return;
    case "content:diff":
      await handleDiff(value, process.argv[5]);
      return;
    case "content:delete":
      await handleDelete(value, args.slice(3));
      return;
    case "categories:import-steering":
      await importSteering(args.slice(2));
      return;
    case "categories:import-config":
      await importSteeringConfig(args.slice(2));
      return;
    case "categories:sandbox-steering-config":
      await writeSandboxSteeringConfig(args.slice(2));
      return;
    case "categories:export-category-set":
      await exportCategorySet(args.slice(2));
      return;
    case "categories:draft-create":
      await createDraftCategorySet(args.slice(2));
      return;
    case "categories:draft-add-topic":
      await addDraftTopic(args.slice(2));
      return;
    case "categories:draft-update-topic":
      await updateDraftTopic(args.slice(2));
      return;
    case "categories:draft-archive-topic":
      await archiveDraftTopic(args.slice(2));
      return;
    case "categories:draft-promote":
      await promoteDraftCategorySet(args.slice(2));
      return;
    case "categories:export-classifier-seed-manifest":
      await exportClassifierSeedManifest(args.slice(2));
      return;
    case "categories:export-category-tree":
      await exportCategoryTree(args.slice(2));
      return;
    case "categories:export-steering-feedback":
      await exportSteeringFeedback(args.slice(2));
      return;
    case "categories:export-lexical-steering":
      await exportLexicalSteering(args.slice(2));
      return;
    case "categories:import-projection":
      await importProjection(args.slice(2));
      return;
    case "categories:run-curation-cycle":
      await runCurationCycle(args.slice(2));
      return;
    case "relations:import-types":
      await importRelationTypes(args.slice(2));
      return;
    case "relations:backfill":
      await backfillRelationTypes(args.slice(2));
      return;
    case "messages:export-legacy-comments":
      await exportLegacyKnowledgeComments(args.slice(2));
      return;
    case "messages:import-legacy-comments":
      await importLegacyKnowledgeComments(args.slice(2));
      return;
    case "references:review-curation":
      await reviewReferenceCuration(args.slice(2));
      return;
    case "references:list-predictions":
      await listClassificationPredictions(args.slice(2));
      return;
    case "references:review-classification":
      await reviewClassificationPrediction(args.slice(2));
      return;
    case "references:label":
      await labelReference(args.slice(2));
      return;
    case "references:unlabel":
      await unlabelReference(args.slice(2));
      return;
    case "references:labels":
      await listReferenceLabels(args.slice(2));
      return;
    case "references:register-catalog":
      await registerReferenceCatalog(args.slice(2));
      return;
    case "references:prepare-catalog":
      await prepareReferenceCatalog(args.slice(2));
      return;
    case "references:export-analysis-manifest":
      await exportReferenceAnalysisManifest(args.slice(2));
      return;
    case "references:export-scope-training":
      await exportReferenceScopeTraining(args.slice(2));
      return;
    case "assignments:list":
      await listAssignments(args.slice(2));
      return;
    case "assignments:for-object":
      await listAssignmentsForObject(args.slice(2));
      return;
    case "assignments:build-context":
      await buildAssignmentContext(args.slice(2));
      return;
    case "assignments:research-packets":
      await listAssignmentResearchPackets(args.slice(2));
      return;
    case "assignments:process-queue":
      await processAssignmentQueue(args.slice(2));
      return;
    case "analysis:profiles":
      await listAnalysisProfiles(args.slice(2));
      return;
    case "analysis:validate-profiles":
      await validateAnalysisProfiles(args.slice(2));
      return;
    case "analysis:reindex-plan":
    case "analysis:preview-reindex":
      await previewAnalysisReindexPlan(args.slice(2));
      return;
    case "analysis:create-reindex-assignment":
      await createAnalysisReindexAssignment(args.slice(2));
      return;
    case "analysis:run-now":
      await runAnalysisReindexNow(args.slice(2));
      return;
    case "analysis:execute-assignment":
      await executeAnalysisReindexAssignment(args.slice(2));
      return;
    case "newsroom:recount-summary":
      await recountNewsroomSummary(args.slice(2));
      return;
    case "newsroom:backfill-feed-fields":
      await backfillNewsroomFeedFields(args.slice(2));
      return;
    case "assignments:claim":
    case "assignments:release":
    case "assignments:complete":
    case "assignments:cancel":
    case "assignments:reopen":
      await mutateAssignment(command, args.slice(2));
      return;
    case "editions:plan":
      await planEdition(args.slice(2));
      return;
    case "editions:dispatch-research":
      await dispatchEditionResearch(args.slice(2));
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

function createAuthoringClient() {
  const endpoint = getGraphQLEndpoint();
  warnIfEndpointDoesNotMatchAmplifyOutputs(endpoint);
  const token = getJwtToken();
  const claims = decodeJwtClaims(token);
  validateAuthoringClaims(claims);
  return {
    endpoint,
    auth: {
      claims,
      source: "PAPYRUS_GRAPHQL_JWT",
      token,
    },
    client: new PapyrusGraphQLAuthoringClient({ endpoint, authToken: token }),
  };
}

function warnIfEndpointDoesNotMatchAmplifyOutputs(endpoint) {
  if (process.env.PAPYRUS_DISABLE_ENDPOINT_MISMATCH_WARNING === "1") return;
  const outputsPath = path.join(process.cwd(), "amplify_outputs.json");
  if (!fs.existsSync(outputsPath)) return;
  try {
    const outputs = JSON.parse(fs.readFileSync(outputsPath, "utf8"));
    const outputsEndpoint = outputs.data?.url;
    if (outputsEndpoint && endpoint && outputsEndpoint !== endpoint) {
      console.error(`Warning: PAPYRUS_GRAPHQL_ENDPOINT does not match amplify_outputs.json. CLI endpoint=${endpoint} amplify_outputs=${outputsEndpoint}`);
    }
  } catch {
    // Non-fatal; endpoint mismatch warnings should not block authoring commands.
  }
}

async function inspect() {
  const { endpoint, auth, client } = createAuthoringClient();
  const groups = getClaimValues(auth.claims, "groups").concat(getClaimValues(auth.claims, "cognito:groups"));
  const roles = getClaimValues(auth.claims, "roles");
  const scope = auth.claims.scope ?? auth.claims.scp ?? "";

  await client.inspectReachability();

  console.log(`GraphQL endpoint: ${endpoint}`);
  console.log(`Auth source: ${auth.source}`);
  console.log(`JWT issuer: ${auth.claims.iss ?? "unknown"}`);
  console.log(`JWT subject: ${auth.claims.sub ?? "unknown"}`);
  console.log(`JWT audience: ${formatClaim(auth.claims.aud)}`);
  console.log(`JWT expires: ${auth.claims.exp ? new Date(auth.claims.exp * 1000).toISOString() : "unknown"}`);
  console.log(`JWT groups: ${groups.join(", ") || "none"}`);
  console.log(`JWT roles: ${roles.join(", ") || "none"}`);
  console.log(`JWT scope: ${formatClaim(scope)}`);
  console.log("GraphQL reachability: ok");
}

async function listArticles() {
  const { client } = createAuthoringClient();
  const articles = await client.listPublishedArticles();
  for (const article of articles) {
    console.log(`${article.slug}\t${article.headline ?? article.title ?? article.id}`);
  }
}

async function handleSync(subject, slug) {
  const { client } = createAuthoringClient();
  if (subject === "article" && slug) {
    const result = await syncSingleArticle(client, slug);
    printSyncSummary(result);
    return;
  }
  if (subject === "edition" && slug) {
    const result = await syncEdition(client, slug);
    printSyncSummary(result);
    return;
  }
  printUsage();
  process.exitCode = 1;
}

async function handleDiff(subject, slug) {
  const { client } = createAuthoringClient();
  if (subject !== "edition" || !slug) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const result = await diffEdition(client, slug);
  printDiffSummary(result);
}

async function handleDelete(subject, flags) {
  if (subject !== "all" || !flags.includes("--yes")) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { client } = createAuthoringClient();
  const result = await deleteAllContent(client);
  printDeleteSummary(result);
}

async function importSteering(flags) {
  const options = parseOptions(flags);
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const resolvedCorpus = resolveSteeringImportCorpus(steeringConfig, options);
  const bundle = options.bundle
    ? loadJsonFile(options.bundle)
    : loadSteeringBundleFromBiblicus({
        corpus: resolvedCorpus.corpusPath,
        classifier: resolvedCorpus.classifierId,
        topicGovernanceSnapshot: options["topic-governance-snapshot"],
      });
  const { client } = createAuthoringClient();
  const plan = buildSteeringImportRecords(bundle, {
    classifierId: resolvedCorpus.classifierId,
    corpusConfig: resolvedCorpus.corpusConfig,
    corpusPath: resolvedCorpus.corpusPath,
  });
  const changes = await buildRecordChangesToleratingOptionalModels(client, plan.records);
  await applyRecordChanges(client, changes);
  printCategoryImportSummary("steering", plan.importRunId, changes);
}

async function importSteeringConfig(flags) {
  const options = parseOptions(flags);
  const steeringConfig = requireSteeringConfig({ configPath: options.config });
  const { client } = createAuthoringClient();
  const records = buildSteeringConfigRecords(steeringConfig);
  const changes = await buildSteeringConfigRecordChanges(client, records);
  await applyRecordChanges(client, changes);
  printCategoryImportSummary("config", "steering-config", changes);
  await applyLexicalSteeringConfigIfAvailable(client, options);
}

async function writeSandboxSteeringConfig(flags) {
  const options = parseOptions(flags);
  const configPath = options.config ?? "corpora/papyrus-steering.yml";
  if (!options.output) throw new Error("categories sandbox-steering-config requires --output <sandbox-steering.yml>.");
  const bucket = options.bucket ?? sandboxStorageBucketFromAmplifyOutputs(options["amplify-outputs"] ?? "amplify_outputs.json");
  if (!bucket) throw new Error("Could not resolve sandbox storage bucket. Pass --bucket or verify amplify_outputs.json.");
  const source = YAML.parse(fs.readFileSync(configPath, "utf8"));
  if (!source || !Array.isArray(source.corpora)) throw new Error(`Invalid steering config: ${configPath}`);
  const output = {
    ...source,
    corpora: source.corpora.map((corpus) => ({
      ...corpus,
      s3Prefix: `s3://${bucket}/corpora/${corpus.key}/`,
    })),
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, YAML.stringify(output), "utf8");
  console.log(`categories\tsandbox-steering-config\t${options.output}\t${bucket}`);
}

async function importRelationTypes(flags) {
  const options = parseOptions(flags);
  const configPath = options.config || DEFAULT_RELATION_TYPES_PATH;
  const relationTypes = loadSemanticRelationTypeSeeds(configPath);
  const { client } = createAuthoringClient();
  const records = buildSemanticRelationTypeRecords(relationTypes);
  const changes = await buildRecordChanges(client, records);
  await applyRecordChanges(client, changes);
  printCategoryImportSummary("relation-types", path.basename(configPath), changes);
}

async function backfillRelationTypes(flags) {
  const options = parseOptions(flags);
  const configPath = options.config || DEFAULT_RELATION_TYPES_PATH;
  const relationTypes = loadSemanticRelationTypeSeeds(configPath);
  const { client } = createAuthoringClient();
  const relations = await client.listRecords("SemanticRelation");
  const changes = buildSemanticRelationBackfillRecords(relations, relationTypes);
  const runDir = path.join(".papyrus-runs", `relation-type-backfill-${timestampForPath()}`);
  const reportPath = path.join(runDir, "backfill-report.json");
  const report = {
    generatedAt: new Date().toISOString(),
    configPath,
    reportPath,
    apply: Boolean(options.apply),
    relationCount: relations.length,
    changeCount: changes.filter((change) => change.action !== "noop").length,
    unknownTypeCount: changes.filter((change) => change.unknownType).length,
    unknownTypes: Array.from(new Set(changes.filter((change) => change.unknownType).map((change) => change.expected.relationTypeKey))).sort(),
    changes: changes
      .filter((change) => change.action !== "noop")
      .map((change) => ({
        id: change.expected.id,
        action: change.action,
        relationTypeKey: change.expected.relationTypeKey,
        relationDomain: change.expected.relationDomain,
      })),
  };
  writeJsonFile(reportPath, report);
  if (options.apply) {
    await applyRecordChanges(client, changes);
  }
  printRelationBackfillSummary(report);
}

async function exportLegacyKnowledgeComments(flags) {
  const options = parseOptions(flags);
  if (!options.output) throw new Error("messages export-legacy-comments requires --output.");
  const { client } = createAuthoringClient();
  const comments = [];
  let nextToken = null;
  const query = `
    query ListLegacyKnowledgeComments($limit: Int, $nextToken: String) {
      listKnowledgeComments(limit: $limit, nextToken: $nextToken) {
        items {
          id subjectKind subjectId subjectLineageId subjectVersionNumber subjectVersionKey subjectStateKey
          commentKind body status source importRunId authorSub authorUserProfileId authorLabel metadata createdAt
        }
        nextToken
      }
    }
  `;
  do {
    const result = await client.graphql(query, { limit: 100, nextToken });
    const page = result.listKnowledgeComments;
    comments.push(...(page?.items ?? []).filter(Boolean));
    nextToken = page?.nextToken ?? null;
  } while (nextToken);

  writeJsonFile(options.output, {
    schemaVersion: 1,
    exportKind: "legacy-knowledge-comments",
    generatedAt: new Date().toISOString(),
    comments,
  });
  console.log(`messages\texport-legacy-comments\t${comments.length}\t${options.output}`);
}

async function importLegacyKnowledgeComments(flags) {
  const options = parseOptions(flags);
  if (!options.input) throw new Error("messages import-legacy-comments requires --input.");
  const payload = loadJsonFile(options.input);
  const comments = Array.isArray(payload.comments) ? payload.comments : Array.isArray(payload.items) ? payload.items : [];
  const records = comments.flatMap(legacyKnowledgeCommentRecords);
  const { client } = createAuthoringClient();
  const changes = await buildRecordChanges(client, records);
  await applyRecordChanges(client, changes);
  printCategoryImportSummary("legacy-messages", path.basename(options.input), changes);
}

async function reviewReferenceCuration(flags) {
  const options = parseOptions(flags);
  const referenceId = options.reference ?? options["reference-id"];
  if (!referenceId) throw new Error("references review-curation requires --reference <id>.");
  if (!options.action) throw new Error("references review-curation requires --action accept|reject|reopen|archive.");
  const reasonCode = normalizeReferenceRejectionReasonCode(options["reason-code"] ?? options.reasonCode, { required: options.action === "reject" });
  const { client } = createAuthoringClient();
  const mutation = `
    mutation ReviewReferenceCuration($referenceId: ID!, $action: String!, $note: String, $actorLabel: String, $reasonCode: String) {
      reviewReferenceCuration(referenceId: $referenceId, action: $action, note: $note, actorLabel: $actorLabel, reasonCode: $reasonCode) {
        ok action referenceId status reasonCode messageId relationId
      }
    }
  `;
  const result = await client.graphql(mutation, {
    referenceId,
    action: options.action,
    note: options.note ?? null,
    actorLabel: options.actor ?? "Papyrus content CLI",
    reasonCode,
  });
  const review = result.reviewReferenceCuration;
  console.log(`references\treview-curation\t${review.referenceId}\t${review.action}\t${review.status}\t${review.reasonCode ?? ""}\t${review.messageId ?? ""}`);
}

async function listClassificationPredictions(flags) {
  const options = parseOptions(flags);
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : null;
  const status = String(options.status || "current").toLowerCase();
  const corpusKey = options["corpus-key"] ? String(options["corpus-key"]) : null;
  const categorySetId = options["category-set"] ? String(options["category-set"]) : null;

  const steeringConfig = corpusKey ? loadSteeringConfig({ configPath: options.config }) : null;
  const corpusId = corpusKey ? knowledgeCorpusId(requireCorpusConfig(steeringConfig, corpusKey, "--corpus-key")) : null;

  const { client } = createAuthoringClient();
  const [relations, references, categories] = await Promise.all([
    client.listRecords("SemanticRelation"),
    client.listRecords("Reference"),
    client.listRecords("Category"),
  ]);

  const referenceByLineage = new Map(
    references
      .filter((reference) => reference.versionState === "current")
      .map((reference) => [reference.lineageId ?? reference.id, reference]),
  );
  const categoryByLineage = new Map(
    categories
      .filter((category) => category.versionState === "current")
      .map((category) => [category.lineageId ?? category.id, category]),
  );

  const authoritativeKeys = new Set(
    relations
      .filter((relation) => relation.relationState === "current")
      .filter((relation) => (relation.relationTypeKey ?? relation.predicate) === "authoritative_label")
      .map((relation) => `${relation.subjectStateKey}::${relation.objectStateKey}`),
  );

  let predictions = relations
    .filter((relation) => (relation.relationTypeKey ?? relation.predicate) === "classified_as")
    .filter((relation) => status === "all" ? true : relation.relationState === status)
    .filter((relation) => relation.subjectKind === "reference" && relation.objectKind === "category")
    .map((relation) => {
      const reference = referenceByLineage.get(relation.subjectLineageId);
      const category = categoryByLineage.get(relation.objectLineageId);
      return {
        relation,
        reference,
        category,
        hasAuthoritativeLabel: authoritativeKeys.has(`${relation.subjectStateKey}::${relation.objectStateKey}`),
      };
    })
    .filter((entry) => entry.reference && entry.category)
    .filter((entry) => corpusId ? entry.reference.corpusId === corpusId : true)
    .filter((entry) => categorySetId ? entry.category.categorySetId === categorySetId : true)
    .sort((left, right) => (
      String(right.relation.importedAt ?? "").localeCompare(String(left.relation.importedAt ?? ""))
      || String(right.relation.id).localeCompare(String(left.relation.id))
    ));

  if (limit) predictions = predictions.slice(0, limit);

  for (const entry of predictions) {
    console.log([
      entry.relation.id,
      entry.relation.relationState,
      entry.reference.corpusId,
      entry.reference.externalItemId,
      entry.reference.title ?? "-",
      entry.category.categoryKey ?? entry.category.id,
      entry.category.displayName ?? "-",
      entry.hasAuthoritativeLabel ? "authoritative" : "predicted",
    ].join("\t"));
  }
  if (!predictions.length) console.log("references\tlist-predictions\t0");
}

async function reviewClassificationPrediction(flags) {
  const options = parseOptions(flags);
  const relationId = options.relation ?? options["relation-id"];
  const action = String(options.action || "").toLowerCase();
  if (!relationId) throw new Error("references review-classification requires --relation <semantic-relation-id>.");
  if (action !== "accept" && action !== "reject") throw new Error("references review-classification requires --action accept|reject.");

  const { client } = createAuthoringClient();
  const relation = await client.getRecord("SemanticRelation", relationId);
  if (!relation) throw new Error(`SemanticRelation ${relationId} was not found.`);
  if ((relation.relationTypeKey ?? relation.predicate) !== "classified_as") {
    throw new Error(`SemanticRelation ${relationId} is not a classified_as prediction.`);
  }
  if (relation.relationState !== "current") {
    throw new Error(`SemanticRelation ${relationId} is ${relation.relationState}; only current predictions are reviewable.`);
  }
  if (relation.subjectKind !== "reference" || relation.objectKind !== "category") {
    throw new Error(`SemanticRelation ${relationId} must be reference -> category.`);
  }

  if (action === "reject") {
    await client.deleteRecord("SemanticRelation", relationId);
    await client.updateNewsroomSummary({
      source: "incremental",
      countDeltas: {
        semanticRelations: -1,
      },
      facetDeltas: {
        semanticRelations: {
          byRelationTypeKey: { classified_as: -1 },
          byRelationDomain: { [relation.relationDomain ?? "unknown"]: -1 },
          bySubjectKind: { [relation.subjectKind ?? "unknown"]: -1 },
          byObjectKind: { [relation.objectKind ?? "unknown"]: -1 },
        },
      },
    }, {
      actorLabel: "Papyrus content CLI",
      reason: `references review-classification reject ${relationId}`,
    });
    console.log(`references\treview-classification\t${relationId}\treject\tdeleted_prediction`);
    return;
  }

  const subjectVersionKey = semanticVersionKey(relation.subjectKind, relation.subjectId);
  const objectVersionKey = semanticVersionKey(relation.objectKind, relation.objectId);
  const authoritativeRelation = {
    id: `semantic-relation-${hashShort([subjectVersionKey, "authoritative_label", objectVersionKey, relation.subjectStateKey, relation.objectStateKey])}`,
    relationState: "current",
    predicate: "authoritative_label",
    ...semanticRelationTypeFieldsForPredicate("authoritative_label"),
    subjectKind: relation.subjectKind,
    subjectId: relation.subjectId,
    subjectLineageId: relation.subjectLineageId,
    subjectVersionNumber: relation.subjectVersionNumber ?? null,
    objectKind: relation.objectKind,
    objectId: relation.objectId,
    objectLineageId: relation.objectLineageId,
    objectVersionNumber: relation.objectVersionNumber ?? null,
    subjectStateKey: relation.subjectStateKey,
    objectStateKey: relation.objectStateKey,
    objectSubjectStateKey: relation.objectSubjectStateKey,
    predicateObjectStateKey: `authoritative_label#${relation.objectStateKey}`,
    subjectVersionKey,
    objectVersionKey,
    score: Number.isFinite(Number(relation.score)) ? Number(relation.score) : 1,
    confidence: null,
    rank: 1,
    classifierId: relation.classifierId ?? null,
    modelVersion: relation.modelVersion ?? null,
    reviewRecommended: false,
    sourceSnapshotId: relation.sourceSnapshotId ?? null,
    importRunId: relation.importRunId ?? null,
    importedAt: new Date().toISOString(),
    metadata: JSON.stringify({
      kind: "classification.authoritative_label.created",
      sourceClassificationRelationId: relation.id,
      note: options.note ?? null,
    }),
  };

  await client.upsert("SemanticRelation", authoritativeRelation);
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      semanticRelations: 1,
    },
    facetDeltas: {
      semanticRelations: {
        byRelationTypeKey: { authoritative_label: 1 },
        byRelationDomain: { [authoritativeRelation.relationDomain ?? "unknown"]: 1 },
        bySubjectKind: { [authoritativeRelation.subjectKind ?? "unknown"]: 1 },
        byObjectKind: { [authoritativeRelation.objectKind ?? "unknown"]: 1 },
      },
    },
  }, {
    actorLabel: "Papyrus content CLI",
    reason: `references review-classification accept ${relationId}`,
  });
  console.log(`references\treview-classification\t${relationId}\taccept\t${authoritativeRelation.id}`);
}

async function labelReference(flags) {
  const options = parseOptions(flags);
  if (!options.reference) throw new Error("references label requires --reference <reference-id|item-id>.");
  if (!options.category) throw new Error("references label requires --category <category-key|lineage-id|id>.");
  if (!options["category-set"]) throw new Error("references label requires --category-set <id>.");
  if (!options.note) throw new Error("references label requires --note <text>.");

  const { client } = createAuthoringClient();
  const [categorySet, references, categories, relations] = await Promise.all([
    client.getRecord("CategorySet", options["category-set"]),
    client.listRecords("Reference"),
    client.listRecords("Category"),
    client.listRecords("SemanticRelation"),
  ]);
  if (!categorySet) throw new Error(`CategorySet ${options["category-set"]} was not found.`);
  const reference = resolveReferenceForLabel(references, options.reference);
  const category = resolveCategoryInSet(
    categories.filter((entry) => entry.categorySetId === categorySet.id),
    options.category,
    { label: "--category" },
  );
  if (category.status === "deprecated" || category.status === "archived") {
    throw new Error(`Category ${category.id} is ${category.status}; label an active draft/current category.`);
  }

  const authoritativeRelation = buildManualAuthoritativeLabelRelation({
    reference,
    category,
    categorySet,
    note: options.note,
    actor: options.actor ?? "Papyrus content CLI",
  });
  const existing = findCurrentAuthoritativeLabel(relations, authoritativeRelation);
  if (existing) {
    console.log(`references\tlabel\t${reference.id}\t${category.categoryKey}\tidempotent\t${existing.id}`);
    return;
  }

  printReferenceLabelPlan("label", { relations: [authoritativeRelation], apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("references\tlabel\tapply\tskipped\tpass --apply to create the authoritative_label relation");
    return;
  }
  await client.upsert("SemanticRelation", authoritativeRelation);
  await updateNewsroomSummaryDelta(client, semanticRelationCountDelta(authoritativeRelation, 1), `references label ${reference.id} ${category.categoryKey}`);
  console.log(`references\tlabel\t${reference.id}\t${category.categoryKey}\t${authoritativeRelation.id}`);
}

async function unlabelReference(flags) {
  const options = parseOptions(flags);
  const relationId = options.relation ?? options["relation-id"];
  if (!relationId) throw new Error("references unlabel requires --relation <authoritative-label-relation-id>.");
  const { client } = createAuthoringClient();
  const relation = await client.getRecord("SemanticRelation", relationId);
  if (!relation) throw new Error(`SemanticRelation ${relationId} was not found.`);
  if ((relation.relationTypeKey ?? relation.predicate) !== "authoritative_label") {
    throw new Error(`SemanticRelation ${relationId} is not an authoritative_label relation.`);
  }
  printReferenceLabelPlan("unlabel", { relations: [relation], apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("references\tunlabel\tapply\tskipped\tpass --apply to delete only this authoritative_label relation");
    return;
  }
  await client.deleteRecord("SemanticRelation", relation.id);
  await updateNewsroomSummaryDelta(client, semanticRelationCountDelta(relation, -1), `references unlabel ${relation.id}`);
  console.log(`references\tunlabel\t${relation.id}\tdeleted_authoritative_label`);
}

async function listReferenceLabels(flags) {
  const options = parseOptions(flags);
  const { client } = createAuthoringClient();
  const [references, categories, relations] = await Promise.all([
    client.listRecords("Reference"),
    client.listRecords("Category"),
    client.listRecords("SemanticRelation"),
  ]);
  let reference = null;
  if (options.reference) reference = resolveReferenceAny(references, options.reference);
  let category = null;
  if (options.category) {
    const candidates = options["category-set"]
      ? categories.filter((entry) => entry.categorySetId === options["category-set"])
      : categories;
    category = resolveCategoryAny(candidates, options.category);
  }

  const referenceByLineage = new Map(references.map((entry) => [entry.lineageId ?? entry.id, entry]));
  const referenceById = new Map(references.map((entry) => [entry.id, entry]));
  const categoryByLineage = bestCategoryByLineage(categories);
  const categoryById = new Map(categories.map((entry) => [entry.id, entry]));

  const rows = relations
    .filter((relation) => relation.relationState === "current")
    .filter((relation) => ["classified_as", "authoritative_label"].includes(relation.relationTypeKey ?? relation.predicate))
    .filter((relation) => relation.subjectKind === "reference" && relation.objectKind === "category")
    .filter((relation) => reference ? (relation.subjectLineageId === (reference.lineageId ?? reference.id) || relation.subjectId === reference.id) : true)
    .filter((relation) => category ? (relation.objectLineageId === (category.lineageId ?? category.id) || relation.objectId === category.id) : true)
    .map((relation) => {
      const ref = referenceById.get(relation.subjectId) ?? referenceByLineage.get(relation.subjectLineageId);
      const cat = categoryById.get(relation.objectId) ?? categoryByLineage.get(relation.objectLineageId);
      return { relation, reference: ref, category: cat };
    })
    .filter((entry) => entry.reference && entry.category)
    .sort((left, right) => (
      String(left.reference.externalItemId ?? left.reference.id).localeCompare(String(right.reference.externalItemId ?? right.reference.id))
      || String(left.category.categoryKey ?? left.category.id).localeCompare(String(right.category.categoryKey ?? right.category.id))
      || String(left.relation.relationTypeKey ?? left.relation.predicate).localeCompare(String(right.relation.relationTypeKey ?? right.relation.predicate))
    ));

  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : null;
  const limitedRows = limit ? rows.slice(0, limit) : rows;
  for (const row of limitedRows) {
    console.log([
      row.relation.id,
      row.relation.relationTypeKey ?? row.relation.predicate,
      row.reference.curationStatus ?? "-",
      row.reference.externalItemId ?? row.reference.id,
      row.reference.title ?? "-",
      row.category.categoryKey ?? row.category.id,
      row.category.displayName ?? "-",
      row.category.categorySetId ?? "-",
    ].join("\t"));
  }
  if (!limitedRows.length) console.log("references\tlabels\t0");
}

async function registerReferenceCatalog(flags) {
  const options = parseOptions(flags);
  if (!options.catalog) throw new Error("references register-catalog requires --catalog <catalog.json>.");
  if (!options["corpus-key"]) throw new Error("references register-catalog requires --corpus-key <key>.");
  const status = normalizeReferenceCurationStatus(options.status, "pending");
  const reasonCode = normalizeReferenceRejectionReasonCode(options["reason-code"] ?? options.reasonCode, { required: status === "rejected" });
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const catalog = loadJsonFile(options.catalog);
  const plan = buildReferenceCatalogRegistrationRecords(catalog, {
    corpusConfig,
    corpusId: knowledgeCorpusId(corpusConfig),
    classifierId: options.classifier ?? resolveClassifierForCorpus(steeringConfig, corpusConfig),
    status,
    reasonCode,
    note: options.note,
    ingestionRationale: options["ingestion-rationale"] ?? options.ingestionRationale,
    actor: options.actor ?? "Papyrus content CLI",
  });
  assertReferenceCatalogPlanSafety(plan);
  const { client } = createAuthoringClient();
  const changes = await buildRecordChangesToleratingOptionalModels(client, plan.records);
  printReferenceRegistrationSummary(plan, changes, { apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("references\tregister-catalog\tapply\tskipped\tpass --apply to write Reference visibility records");
    return;
  }
  await applyRecordChanges(client, changes);
  await updateNewsroomSummaryAfterReferenceRegistration(client, changes, plan);
}

async function prepareReferenceCatalog(flags) {
  const options = parseOptions(flags);
  if (!options.catalog) throw new Error("references prepare-catalog requires --catalog <catalog.json>.");
  if (!options.output) throw new Error("references prepare-catalog requires --output <prepared-catalog.json>.");
  if (!options["corpus-key"]) throw new Error("references prepare-catalog requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const catalog = loadJsonFile(options.catalog);
  const prepared = buildPreparedReferenceCatalog(catalog, {
    corpusConfig,
    corpusKey: options["corpus-key"],
    steeringConfig,
    publicationName: steeringConfig.publication?.name,
  });
  writeJsonFile(options.output, prepared);
  const items = catalogItemsForSummary(prepared);
  const rationaleCount = items.filter((item) => item.ingestion_rationale || item.ingestionRationale || item.metadata?.ingestion_rationale || item.metadata?.ingestionRationale).length;
  console.log(`references\tprepare-catalog\t${options["corpus-key"]}\t${options.output}\t${items.length} items\t${rationaleCount} rationales`);
}

async function exportReferenceAnalysisManifest(flags) {
  const options = parseOptions(flags);
  if (!options.output) throw new Error("references export-analysis-manifest requires --output <accepted-manifest.json>.");
  if (!options["corpus-key"]) throw new Error("references export-analysis-manifest requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const { client } = createAuthoringClient();
  const [references, attachments] = await Promise.all([
    client.listRecords("Reference"),
    client.listRecords("ReferenceAttachment"),
  ]);
  const payload = buildReferenceAnalysisManifest({
    corpusConfig,
    corpusId,
    references,
    attachments,
  });
  writeJsonFile(options.output, payload);
  console.log(`references\texport-analysis-manifest\t${corpusId}\t${options.output}\t${payload.items.length} accepted`);
}

async function exportReferenceScopeTraining(flags) {
  const options = parseOptions(flags);
  if (!options.output) throw new Error("references export-scope-training requires --output <scope-training.json>.");
  if (!options["corpus-key"]) throw new Error("references export-scope-training requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const { client } = createAuthoringClient();
  const [references, attachments, messages, relations] = await Promise.all([
    client.listRecords("Reference"),
    client.listRecords("ReferenceAttachment"),
    client.listRecords("Message"),
    client.listRecords("SemanticRelation"),
  ]);
  const payload = buildReferenceScopeTrainingExport({
    corpusConfig,
    corpusId,
    references,
    attachments,
    messages,
    relations,
  });
  writeJsonFile(options.output, payload);
  console.log(`references\texport-scope-training\t${corpusId}\t${options.output}\t${payload.counts.positive} positive\t${payload.counts.negative} negative`);
}

async function importProjection(flags) {
  const options = parseOptions(flags);
  if (!options.bundle) throw new Error("categories import-projection requires --bundle.");
  const payload = loadJsonFile(options.bundle);
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const resolvedProjection = resolveProjectionImportCorpora(steeringConfig, options);
  const { client } = createAuthoringClient();
  const categorySet = await resolveAcceptedCategorySet(client, {
    categorySetId: options["category-set"],
    corpusId: resolvedProjection.authorityCorpusId,
    classifierId: resolvedProjection.classifierId,
  });
  const plan = buildProjectionImportRecords(payload, {
    authorityCorpusConfig: resolvedProjection.authorityCorpus,
    authorityCorpusId: resolvedProjection.authorityCorpusId,
    targetCorpusConfig: resolvedProjection.targetCorpus,
    targetCorpusId: resolvedProjection.targetCorpusId,
    classifierId: resolvedProjection.classifierId,
    categorySetId: categorySet?.id,
  });
  const changes = await buildRecordChangesToleratingOptionalModels(client, plan.records);
  await applyRecordChanges(client, changes);
  printCategoryImportSummary("projection", plan.importRunId, changes);
}

async function runCurationCycle(flags) {
  const options = parseOptions(flags);
  const steeringConfig = requireSteeringConfig({ configPath: options.config });
  const plan = buildCurationCyclePlan(steeringConfig, {
    outputDir: options["output-dir"],
    biblicusWorkdir: options["biblicus-workdir"],
  });
  fs.mkdirSync(plan.runDir, { recursive: true });
  const { client } = createAuthoringClient();

  console.log(`Curation cycle: ${plan.runId}`);
  console.log(`Run directory: ${plan.runDir}`);
  validateCycleCorpusPaths(plan);

  const configChanges = await buildSteeringConfigRecordChanges(client, buildSteeringConfigRecords(steeringConfig));
  await applyRecordChanges(client, configChanges);
  printCategoryImportSummary("config", "steering-config", configChanges);
  const lexicalConfig = await applyLexicalSteeringConfigIfAvailable(client, options);

  const canonicalBundle = loadSteeringBundleFromBiblicus({
    corpus: plan.canonical.corpus.path,
    classifier: plan.canonical.classifierId,
  });
  writeJsonFile(plan.canonical.steeringPath, canonicalBundle);
  const steeringImportPlan = buildSteeringImportRecords(canonicalBundle, {
    classifierId: plan.canonical.classifierId,
    corpusConfig: plan.canonical.corpus,
    corpusPath: resolveBiblicusCorpusPath(plan, plan.canonical.corpus),
  });
  const steeringChanges = await buildRecordChangesToleratingOptionalModels(client, steeringImportPlan.records);
  await applyRecordChanges(client, steeringChanges);
  printCategoryImportSummary("steering", steeringImportPlan.importRunId, steeringChanges);

  const categorySet = await resolveAcceptedCategorySet(client, {
    categorySetId: steeringImportPlan.categorySetId,
    corpusId: plan.canonical.corpusId,
    classifierId: plan.canonical.classifierId,
  });
  if (!categorySet) throw new Error(`No accepted category set found for ${plan.canonical.corpusId}/${plan.canonical.classifierId}.`);
  const categories = (await client.listRecords("Category"))
    .filter((category) => category.categorySetId === categorySet.id && category.status !== "archived");
  writeJsonFile(plan.canonical.categorySetPath, buildAcceptedCategorySetPayload(categorySet, categories));
  writeJsonFile(plan.canonical.categoryTreePath, buildAcceptedCategoryTreePayload(categorySet, categories));

  const proposals = (await client.listRecords("SteeringProposal"))
    .filter((proposal) => proposal.categorySetId === categorySet.id);
  const proposalIds = new Set(proposals.map((proposal) => proposal.id));
  const decisions = (await client.listRecords("SteeringDecision"))
    .filter((decision) => decision.categorySetId === categorySet.id || proposalIds.has(decision.proposalId));
  writeJsonFile(plan.canonical.steeringFeedbackPath, buildSteeringFeedbackPayload(categorySet, proposals, decisions));
  await writeLexicalSteeringExportIfAvailable(client, plan.canonical.lexicalSteeringPath, lexicalConfig);

  const canonicalExtractionSnapshot = latestPipelineSnapshot(canonicalBundle);
  if (!canonicalExtractionSnapshot) throw new Error(`No pipeline extraction snapshot found for ${plan.canonical.corpus.key}.`);
  runBiblicus(plan, ["taxonomy", "record", "--corpus", plan.canonical.corpus.path, "--input", plan.canonical.categoryTreePath], "taxonomy-record");
  runBiblicusJson(plan, [
    "taxonomy",
    "discover",
    "--corpus",
    plan.canonical.corpus.path,
    "--classifier",
    plan.canonical.classifierId,
    "--extraction-snapshot",
    canonicalExtractionSnapshot,
    "--steering-feedback",
    plan.canonical.steeringFeedbackPath,
    "--format",
    "json",
  ], "taxonomy-discover", plan.canonical.taxonomyDiscoveryPath);
  recordProposalBundleIfPresent(plan, plan.canonical.taxonomyDiscoveryPath, plan.canonical.corpus.path, "taxonomy-discover");

  runBiblicus(plan, [
    "steering",
    "render-seed-manifest",
    "--input",
    plan.canonical.categorySetPath,
    "--output",
    plan.canonical.seedManifestPath,
  ], "render-seed-manifest");
  runBiblicus(plan, [
    "topic-classifier",
    "train",
    "--corpus",
    plan.canonical.corpus.path,
    "--manifest",
    plan.canonical.seedManifestPath,
    "--configuration",
    "configurations/topic-classifier.yml",
    "--extraction-snapshot",
    canonicalExtractionSnapshot,
  ], "topic-classifier-train");

  for (const projection of plan.sourceProjections) {
    const targetBundle = loadSteeringBundleFromBiblicus({
      corpus: projection.targetCorpus.path,
      classifier: projection.targetCorpus.localClassifiers[0]?.classifierId ?? projection.classifierId,
    });
    writeJsonFile(projection.targetSteeringPath, targetBundle);
    const targetExtractionSnapshot = latestPipelineSnapshot(targetBundle);
    if (!targetExtractionSnapshot) throw new Error(`No pipeline extraction snapshot found for ${projection.targetCorpus.key}.`);
    runBiblicusJson(plan, [
      "topic-classifier",
      "project",
      "--classifier-corpus",
      plan.canonical.corpus.path,
      "--target-corpus",
      projection.targetCorpus.path,
      "--classifier",
      projection.classifierId,
      "--extraction-snapshot",
      targetExtractionSnapshot,
      "--all",
      "--record",
      "--format",
      "json",
    ], `project-${projection.targetCorpus.key}`, projection.projectionPath);
    const projectionPayload = loadJsonFile(projection.projectionPath);
    const projectionCategorySet = await resolveAcceptedCategorySet(client, {
      categorySetId: categorySet.id,
      corpusId: projection.authorityCorpusId,
      classifierId: projection.classifierId,
    });
    const projectionImportPlan = buildProjectionImportRecords(projectionPayload, {
      authorityCorpusConfig: projection.authorityCorpus,
      authorityCorpusId: projection.authorityCorpusId,
      targetCorpusConfig: projection.targetCorpus,
      targetCorpusId: projection.targetCorpusId,
      classifierId: projection.classifierId,
      categorySetId: projectionCategorySet?.id,
    });
    const projectionChanges = await buildRecordChangesToleratingOptionalModels(client, projectionImportPlan.records);
    await applyRecordChanges(client, projectionChanges);
    printCategoryImportSummary(`projection:${projection.targetCorpus.key}`, projectionImportPlan.importRunId, projectionChanges);
  }

  const refreshedBundle = loadSteeringBundleFromBiblicus({
    corpus: plan.canonical.corpus.path,
    classifier: plan.canonical.classifierId,
  });
  const refreshedPlan = buildSteeringImportRecords(refreshedBundle, {
    classifierId: plan.canonical.classifierId,
    corpusConfig: plan.canonical.corpus,
    corpusPath: resolveBiblicusCorpusPath(plan, plan.canonical.corpus),
  });
  const refreshedChanges = await buildRecordChangesToleratingOptionalModels(client, refreshedPlan.records);
  await applyRecordChanges(client, refreshedChanges);
  printCategoryImportSummary("steering:refreshed", refreshedPlan.importRunId, refreshedChanges);

  const verification = await verifyCurationCycle(client, {
    plan,
    categorySetId: categorySet.id,
  });
  writeJsonFile(plan.verificationPath, verification);
  printCurationVerification(verification);
  if (verification.failures.length) {
    throw new Error(`Curation cycle verification failed: ${verification.failures.join("; ")}`);
  }
}

async function exportCategorySet(flags) {
  const options = parseOptions(flags);
  const categorySetId = options["category-set"];
  if (!categorySetId) throw new Error("categories export-category-set requires --category-set.");
  if (!options.output) throw new Error("categories export-category-set requires --output.");
  const { client } = createAuthoringClient();
  const categorySet = await client.getRecord("CategorySet", categorySetId);
  if (!categorySet) throw new Error(`CategorySet ${categorySetId} was not found.`);
  const categories = (await client.listRecords("Category"))
    .filter((category) => category.categorySetId === categorySetId && category.status !== "archived");
  writeJsonFile(options.output, buildAcceptedCategorySetPayload(categorySet, categories));
  console.log(`export\tcategory-set\t${categorySetId}\t${options.output}\t${categories.length} categories`);
}

async function createDraftCategorySet(flags) {
  const options = parseOptions(flags);
  const sourceId = options["from-category-set"];
  if (!sourceId) throw new Error("categories draft-create requires --from-category-set <id>.");
  if (!options.title) throw new Error("categories draft-create requires --title <text>.");

  const actor = options.actor ?? "Papyrus content CLI";
  const now = new Date().toISOString();
  const { client } = createAuthoringClient();
  const [categorySets, categories] = await Promise.all([
    client.listRecords("CategorySet"),
    client.listRecords("Category"),
  ]);
  const source = categorySets.find((set) => set.id === sourceId);
  if (!source) throw new Error(`CategorySet ${sourceId} was not found.`);
  if (source.versionState !== "current" && source.status !== "accepted") {
    throw new Error(`CategorySet ${sourceId} is ${source.versionState}/${source.status}; create drafts from the accepted current set.`);
  }

  const lineageId = source.lineageId ?? source.id;
  const nextVersion = Math.max(
    0,
    ...categorySets
      .filter((set) => (set.lineageId ?? set.id) === lineageId)
      .map((set) => Number(set.versionNumber) || 0),
  ) + 1;
  const draftId = options.id ?? `${slugify(lineageId)}-draft-v${nextVersion}`;
  if (categorySets.some((set) => set.id === draftId)) throw new Error(`Draft CategorySet ${draftId} already exists.`);

  const sourceCategories = categories
    .filter((category) => category.categorySetId === source.id)
    .sort(compareCategoriesForDraft);
  const maxCategoryVersionByLineage = new Map();
  for (const category of categories) {
    const categoryLineage = category.lineageId ?? category.id;
    maxCategoryVersionByLineage.set(
      categoryLineage,
      Math.max(maxCategoryVersionByLineage.get(categoryLineage) ?? 0, Number(category.versionNumber) || 0),
    );
  }

  const draftSet = withVersionFields({
    id: draftId,
    lineageId,
    versionNumber: nextVersion,
    previousVersionId: source.id,
    versionState: "draft",
    corpusId: source.corpusId ?? null,
    classifierId: source.classifierId ?? null,
    displayName: String(options.title).trim(),
    description: options.description ?? source.description ?? "",
    status: "draft",
    generatedAt: now,
    categoryCount: sourceCategories.length,
    importRunId: source.importRunId ?? null,
  }, {
    now,
    actor,
    reason: options.reason ?? `Draft created from ${source.id}`,
  });

  const draftIdBySourceId = new Map();
  const draftIdBySourceLineage = new Map();
  for (const category of sourceCategories) {
    const categoryLineage = category.lineageId ?? category.id;
    const categoryKey = category.categoryKey ?? category.id;
    const clonedId = `${slugify(categoryLineage)}-draft-v${nextVersion}`;
    draftIdBySourceId.set(category.id, clonedId);
    draftIdBySourceLineage.set(categoryLineage, clonedId);
  }

  const draftCategories = sourceCategories.map((category) => {
    const categoryLineage = category.lineageId ?? category.id;
    const categoryKey = category.categoryKey ?? category.id;
    const parentId = category.parentCategoryId ? draftIdBySourceId.get(category.parentCategoryId) ?? null : null;
    return withVersionFields({
      id: draftIdBySourceLineage.get(categoryLineage),
      lineageId: categoryLineage,
      versionNumber: (maxCategoryVersionByLineage.get(categoryLineage) ?? 0) + 1,
      previousVersionId: category.id,
      versionState: "draft",
      categorySetId: draftSet.id,
      corpusId: category.corpusId ?? draftSet.corpusId ?? null,
      categoryKey,
      parentCategoryId: parentId,
      parentCategoryKey: category.parentCategoryKey ?? null,
      displayName: category.displayName ?? categoryKey,
      shortTitle: category.shortTitle ?? null,
      subtitle: category.subtitle ?? null,
      description: category.description ?? "",
      aliases: normalizeStringList(category.aliases),
      status: category.status ?? "accepted",
      seedItemIds: normalizeStringList(category.seedItemIds),
      holdoutItemIds: normalizeStringList(category.holdoutItemIds),
      rank: numberOrNull(category.rank),
      depth: numberOrNull(category.depth) ?? 0,
      isPinned: Boolean(category.isPinned),
      importRunId: category.importRunId ?? null,
      updatedAt: now,
    }, {
      now,
      actor,
      reason: options.reason ?? `Draft clone from ${source.id}`,
    });
  });

  printDraftPlan("draft-create", { categorySets: [draftSet], categories: draftCategories, apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("categories\tdraft-create\tapply\tskipped\tpass --apply to create the draft CategorySet");
    return;
  }
  await client.upsert("CategorySet", draftSet);
  for (const category of draftCategories) await client.upsert("Category", category);
  console.log(`categories\tdraft-create\t${draftSet.id}\t${draftCategories.length} topics`);
}

async function addDraftTopic(flags) {
  const options = parseOptions(flags);
  const categorySetId = options["category-set"];
  if (!categorySetId) throw new Error("categories draft-add-topic requires --category-set <draft-id>.");
  if (!options["display-name"]) throw new Error("categories draft-add-topic requires --display-name <text>.");
  const now = new Date().toISOString();
  const actor = options.actor ?? "Papyrus content CLI";
  const { client } = createAuthoringClient();
  const [categorySet, categories] = await Promise.all([
    client.getRecord("CategorySet", categorySetId),
    client.listRecords("Category"),
  ]);
  requireDraftCategorySet(categorySet, categorySetId);
  const draftCategories = categories.filter((category) => category.categorySetId === categorySet.id);
  const categoryKey = options["category-key"] ?? `category.${slugify(options["display-name"])}`;
  if (draftCategories.some((category) => category.categoryKey === categoryKey)) {
    throw new Error(`Category key ${categoryKey} already exists in draft ${categorySet.id}.`);
  }
  const parent = options["parent-key"]
    ? resolveCategoryInSet(draftCategories, options["parent-key"], { label: "--parent-key" })
    : null;
  const siblings = draftCategories.filter((category) => (category.parentCategoryKey ?? null) === (parent?.categoryKey ?? null));
  const rank = options.rank ? Number(options.rank) : (Math.max(0, ...siblings.map((category) => Number(category.rank) || 0)) + 1);
  const lineageId = options.lineage ?? `category-${slugify(categorySet.lineageId ?? categorySet.id)}-${slugify(categoryKey)}`;
  const category = withVersionFields({
    id: `category-${slugify(categorySet.id)}-${slugify(categoryKey)}`,
    lineageId,
    versionNumber: 1,
    previousVersionId: null,
    versionState: "draft",
    categorySetId: categorySet.id,
    corpusId: categorySet.corpusId ?? null,
    categoryKey,
    parentCategoryId: parent?.id ?? null,
    parentCategoryKey: parent?.categoryKey ?? null,
    displayName: String(options["display-name"]).trim(),
    shortTitle: options["short-title"] ?? null,
    subtitle: options.subtitle ?? null,
    description: options.description ?? options.subtitle ?? String(options["display-name"]).trim(),
    aliases: normalizeStringList(options.aliases ? parseCommaList(options.aliases) : []),
    status: "accepted",
    seedItemIds: [],
    holdoutItemIds: [],
    rank,
    depth: parent ? (Number(parent.depth) || 0) + 1 : 0,
    isPinned: parseBooleanOption(options.pinned, false),
    importRunId: null,
    updatedAt: now,
  }, {
    now,
    actor,
    reason: options.reason ?? "Manual draft topic added",
  });

  printDraftPlan("draft-add-topic", { categories: [category], apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("categories\tdraft-add-topic\tapply\tskipped\tpass --apply to create the draft topic");
    return;
  }
  await client.upsert("Category", category);
  await client.upsert("CategorySet", {
    ...categorySet,
    categoryCount: draftCategories.length + 1,
    changeReason: options.reason ?? "Manual draft topic added",
    contentHash: hashShort({ ...categorySet, categoryCount: draftCategories.length + 1, updatedAt: now }),
  });
  console.log(`categories\tdraft-add-topic\t${category.id}\t${category.categoryKey}`);
}

async function updateDraftTopic(flags) {
  const options = parseOptions(flags);
  const token = options.category;
  if (!token) throw new Error("categories draft-update-topic requires --category <id|lineage|key>.");
  const { client } = createAuthoringClient();
  const [categorySets, categories] = await Promise.all([
    client.listRecords("CategorySet"),
    client.listRecords("Category"),
  ]);
  const category = resolveCategoryAny(categories, token);
  const categorySet = categorySets.find((set) => set.id === category.categorySetId);
  requireDraftCategorySet(categorySet, category.categorySetId);
  const now = new Date().toISOString();
  const updated = {
    ...category,
    ...(options["display-name"] ? { displayName: String(options["display-name"]).trim() } : {}),
    ...(options["short-title"] ? { shortTitle: String(options["short-title"]).trim() } : {}),
    ...(options.subtitle ? { subtitle: String(options.subtitle).trim() } : {}),
    ...(options.description ? { description: String(options.description).trim() } : {}),
    ...(options.aliases ? { aliases: normalizeStringList(parseCommaList(options.aliases)) } : {}),
    ...(options.rank ? { rank: Number(options.rank) } : {}),
    updatedAt: now,
    changeReason: options.reason ?? "Manual draft topic update",
  };
  updated.contentHash = hashShort(normalizeRecord(updated));
  printDraftPlan("draft-update-topic", { categories: [updated], apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("categories\tdraft-update-topic\tapply\tskipped\tpass --apply to update the draft topic");
    return;
  }
  await client.upsert("Category", updated);
  console.log(`categories\tdraft-update-topic\t${updated.id}\t${updated.categoryKey}`);
}

async function archiveDraftTopic(flags) {
  const options = parseOptions(flags);
  const token = options.category;
  if (!token) throw new Error("categories draft-archive-topic requires --category <id|lineage|key>.");
  const { client } = createAuthoringClient();
  const [categorySets, categories] = await Promise.all([
    client.listRecords("CategorySet"),
    client.listRecords("Category"),
  ]);
  const category = resolveCategoryAny(categories, token);
  const categorySet = categorySets.find((set) => set.id === category.categorySetId);
  requireDraftCategorySet(categorySet, category.categorySetId);
  const now = new Date().toISOString();
  const archived = {
    ...category,
    status: "deprecated",
    updatedAt: now,
    changeReason: options.reason ?? "Manual draft topic archived",
  };
  archived.contentHash = hashShort(normalizeRecord(archived));
  printDraftPlan("draft-archive-topic", { categories: [archived], apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("categories\tdraft-archive-topic\tapply\tskipped\tpass --apply to archive the draft topic");
    return;
  }
  await client.upsert("Category", archived);
  console.log(`categories\tdraft-archive-topic\t${archived.id}\t${archived.categoryKey}\tdeprecated`);
}

async function promoteDraftCategorySet(flags) {
  const options = parseOptions(flags);
  const draftId = options["category-set"];
  if (!draftId) throw new Error("categories draft-promote requires --category-set <draft-id>.");
  const now = new Date().toISOString();
  const { client } = createAuthoringClient();
  const [categorySets, categories] = await Promise.all([
    client.listRecords("CategorySet"),
    client.listRecords("Category"),
  ]);
  const draft = categorySets.find((set) => set.id === draftId);
  requireDraftCategorySet(draft, draftId);
  const lineageId = draft.lineageId ?? draft.id;
  const previousCurrent = categorySets.find((set) => set.id !== draft.id && (set.lineageId ?? set.id) === lineageId && set.versionState === "current");
  const draftCategories = categories.filter((category) => category.categorySetId === draft.id);
  const draftLineages = new Set(draftCategories.map((category) => category.lineageId ?? category.id));
  const supersededCategories = categories
    .filter((category) => category.categorySetId !== draft.id)
    .filter((category) => draftLineages.has(category.lineageId ?? category.id))
    .filter((category) => category.versionState === "current")
    .map((category) => ({
      ...category,
      versionState: "superseded",
      updatedAt: now,
      changeReason: options.reason ?? `Superseded by ${draft.id}`,
    }));
  for (const category of supersededCategories) category.contentHash = hashShort(normalizeRecord(category));
  const promotedCategories = draftCategories.map((category) => {
    const promoted = {
      ...category,
      versionState: "current",
      updatedAt: now,
      changeReason: options.reason ?? "Draft category set promoted",
    };
    promoted.contentHash = hashShort(normalizeRecord(promoted));
    return promoted;
  });
  const updates = {
    categorySets: [
      ...(previousCurrent ? [{
        ...previousCurrent,
        versionState: "superseded",
        status: "superseded",
        changeReason: options.reason ?? `Superseded by ${draft.id}`,
        contentHash: hashShort({ ...previousCurrent, versionState: "superseded", status: "superseded", updatedAt: now }),
      }] : []),
      {
        ...draft,
        versionState: "current",
        status: "accepted",
        categoryCount: promotedCategories.filter((category) => category.status !== "deprecated" && category.status !== "archived").length,
        generatedAt: draft.generatedAt ?? now,
        changeReason: options.reason ?? "Draft category set promoted",
        contentHash: hashShort({ ...draft, versionState: "current", status: "accepted", updatedAt: now }),
      },
    ],
    categories: [...supersededCategories, ...promotedCategories],
  };
  printDraftPlan("draft-promote", { ...updates, apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("categories\tdraft-promote\tapply\tskipped\tpass --apply to promote the draft CategorySet");
    return;
  }
  for (const categorySet of updates.categorySets) await client.upsert("CategorySet", categorySet);
  for (const category of updates.categories) await client.upsert("Category", category);
  const previousCurrentCategoryCount = previousCurrent
    ? categories
      .filter((category) => category.categorySetId === previousCurrent.id)
      .filter((category) => category.versionState === "current")
      .filter((category) => category.status !== "deprecated" && category.status !== "archived").length
    : 0;
  const promotedCategoryCount = promotedCategories
    .filter((category) => category.status !== "deprecated" && category.status !== "archived").length;
  const countDeltas = {};
  if (!previousCurrent) countDeltas.categorySets = 1;
  const categoryDelta = promotedCategoryCount - previousCurrentCategoryCount;
  if (categoryDelta) countDeltas.categories = categoryDelta;
  if (Object.keys(countDeltas).length) {
    await updateNewsroomSummaryDelta(client, { countDeltas }, `categories draft-promote ${draft.id}`);
  }
  console.log(`categories\tdraft-promote\t${draft.id}\tcurrent\t${promotedCategories.length} topics`);
}

async function exportCategoryTree(flags) {
  const options = parseOptions(flags);
  const categorySetId = options["category-set"];
  if (!categorySetId) throw new Error("categories export-category-tree requires --category-set.");
  if (!options.output) throw new Error("categories export-category-tree requires --output.");
  const { client } = createAuthoringClient();
  const categorySet = await client.getRecord("CategorySet", categorySetId);
  if (!categorySet) throw new Error(`CategorySet ${categorySetId} was not found.`);
  const nodes = (await client.listRecords("Category"))
    .filter((node) => node.categorySetId === categorySetId && node.status !== "archived");
  writeJsonFile(options.output, buildAcceptedCategoryTreePayload(categorySet, nodes));
  console.log(`export\tcategory-tree\t${categorySetId}\t${options.output}\t${nodes.length} categories`);
}

async function exportSteeringFeedback(flags) {
  const options = parseOptions(flags);
  const categorySetId = options["category-set"];
  if (!categorySetId) throw new Error("categories export-steering-feedback requires --category-set.");
  if (!options.output) throw new Error("categories export-steering-feedback requires --output.");
  const { client } = createAuthoringClient();
  const categorySet = await client.getRecord("CategorySet", categorySetId);
  if (!categorySet) throw new Error(`CategorySet ${categorySetId} was not found.`);
  const proposals = (await client.listRecords("SteeringProposal"))
    .filter((proposal) => proposal.categorySetId === categorySetId);
  const proposalIds = new Set(proposals.map((proposal) => proposal.id));
  const decisions = (await client.listRecords("SteeringDecision"))
    .filter((decision) => decision.categorySetId === categorySetId || proposalIds.has(decision.proposalId));
  const payload = buildSteeringFeedbackPayload(categorySet, proposals, decisions);
  writeJsonFile(options.output, payload);
  console.log(`export\tsteering-feedback\t${categorySetId}\t${options.output}\t${payload.accepted_proposals.length} accepted\t${payload.rejected_proposals.length} rejected`);
}

async function exportLexicalSteering(flags) {
  const options = parseOptions(flags);
  if (!options.output) throw new Error("categories export-lexical-steering requires --output.");
  const { client } = createAuthoringClient();
  const lexicalConfig = loadLexicalSteeringConfig(options["lexical-config"]);
  const rules = await client.listRecords("LexicalSteeringRule");
  const payload = buildLexicalSteeringPayload(rules, { config: lexicalConfig });
  writeJsonFile(options.output, payload);
  console.log(`export\tlexical-steering\t${options.output}\t${payload.ignored_terms.length} active ignored terms`);
}

async function exportClassifierSeedManifest(flags) {
  const options = parseOptions(flags);
  const categorySetId = options["category-set"];
  if (!categorySetId) throw new Error("categories export-classifier-seed-manifest requires --category-set <id>.");
  if (!options["corpus-key"]) throw new Error("categories export-classifier-seed-manifest requires --corpus-key <key>.");
  if (!options.output) throw new Error("categories export-classifier-seed-manifest requires --output <seed-manifest.json>.");

  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const { client } = createAuthoringClient();
  const [categorySet, categories, references, relations] = await Promise.all([
    client.getRecord("CategorySet", categorySetId),
    client.listRecords("Category"),
    client.listRecords("Reference"),
    client.listRecords("SemanticRelation"),
  ]);
  if (!categorySet) throw new Error(`CategorySet ${categorySetId} was not found.`);
  if (categorySet.corpusId && categorySet.corpusId !== corpusId) {
    throw new Error(`CategorySet ${categorySetId} belongs to ${categorySet.corpusId}, not ${corpusId}.`);
  }

  const activeCategories = categories
    .filter((category) => category.categorySetId === categorySet.id)
    .filter((category) => category.status !== "archived" && category.status !== "deprecated")
    .sort(compareCategoriesForDraft);
  const categoryByLineage = new Map(activeCategories.map((category) => [category.lineageId ?? category.id, category]));
  const categoryById = new Map(activeCategories.map((category) => [category.id, category]));
  const acceptedReferenceByLineage = new Map(
    references
      .filter((reference) => reference.corpusId === corpusId)
      .filter(isCurrentAcceptedReference)
      .map((reference) => [reference.lineageId ?? reference.id, reference]),
  );
  const acceptedReferenceById = new Map(
    references
      .filter((reference) => reference.corpusId === corpusId)
      .filter(isCurrentAcceptedReference)
      .map((reference) => [reference.id, reference]),
  );
  const seedIdsByCategoryLineage = new Map();
  for (const relation of relations) {
    if (relation.relationState !== "current") continue;
    if ((relation.relationTypeKey ?? relation.predicate) !== "authoritative_label") continue;
    if (relation.subjectKind !== "reference" || relation.objectKind !== "category") continue;
    const category = categoryById.get(relation.objectId) ?? categoryByLineage.get(relation.objectLineageId);
    if (!category) continue;
    const reference = acceptedReferenceById.get(relation.subjectId) ?? acceptedReferenceByLineage.get(relation.subjectLineageId);
    if (!reference?.externalItemId) continue;
    const categoryLineage = category.lineageId ?? category.id;
    const seeds = seedIdsByCategoryLineage.get(categoryLineage) ?? new Set();
    seeds.add(reference.externalItemId);
    seedIdsByCategoryLineage.set(categoryLineage, seeds);
  }

  const topics = activeCategories
    .map((category) => {
      const seedItemIds = Array.from(seedIdsByCategoryLineage.get(category.lineageId ?? category.id) ?? []).sort();
      if (!seedItemIds.length) return null;
      const holdoutItemIds = normalizeStringList(category.holdoutItemIds)
        .filter((itemId) => !seedItemIds.includes(itemId))
        .sort();
      return {
        topic_uid: String(category.categoryKey ?? category.id),
        display_name: String(category.displayName ?? category.categoryKey ?? category.id),
        description: String(category.description ?? category.subtitle ?? category.displayName ?? category.categoryKey ?? category.id),
        seed_item_ids: seedItemIds,
        holdout_item_ids: holdoutItemIds,
      };
    })
    .filter(Boolean);

  if (!topics.length) {
    throw new Error(`No authoritative labels found for accepted current references in ${categorySetId}; add labels before exporting a classifier seed manifest.`);
  }

  const payload = {
    schema_version: 1,
    classifier_id: categorySet.classifierId ?? resolveClassifierForCorpus(steeringConfig, corpusConfig),
    display_name: categorySet.displayName ?? categorySet.id,
    description: categorySet.description ?? `Papyrus classifier seed manifest for ${categorySet.displayName ?? categorySet.id}.`,
    topics,
    unlabeled_policy: "use_minus_one",
  };
  writeJsonFile(options.output, payload);
  console.log(`export\tclassifier-seed-manifest\t${categorySet.id}\t${options.output}\t${topics.length} topics\t${topics.reduce((sum, topic) => sum + topic.seed_item_ids.length, 0)} labels`);
  if (activeCategories.length > topics.length) {
    console.log(`export\tclassifier-seed-manifest\tunlabeled-topics\t${activeCategories.length - topics.length}`);
  }
}

async function applyLexicalSteeringConfigIfAvailable(client, options = {}) {
  const lexicalConfig = loadLexicalSteeringConfig(options["lexical-config"]);
  try {
    const lexicalChanges = await buildRecordChangesToleratingOptionalModels(client, buildLexicalSteeringConfigRecords(lexicalConfig));
    await applyRecordChanges(client, lexicalChanges);
    printCategoryImportSummary("lexical-config", "papyrus-lexical-steering", lexicalChanges);
  } catch (error) {
    if (!isMissingGraphQLModelError(error, "LexicalSteeringRule")) throw error;
    console.warn("skip\tlexical-config\tLexicalSteeringRule model is not deployed in AppSync yet.");
  }
  return lexicalConfig;
}

async function writeLexicalSteeringExportIfAvailable(client, outputPath, lexicalConfig) {
  try {
    const lexicalRules = await client.listRecords("LexicalSteeringRule");
    writeJsonFile(outputPath, buildLexicalSteeringPayload(lexicalRules, { config: lexicalConfig }));
    console.log(`export\tlexical-steering\t${outputPath}\t${lexicalRules.length} rules`);
  } catch (error) {
    if (!isMissingGraphQLModelError(error, "LexicalSteeringRule")) throw error;
    writeJsonFile(outputPath, buildLexicalSteeringPayload([], { config: lexicalConfig }));
    console.warn("skip\tlexical-export\tLexicalSteeringRule model is not deployed in AppSync yet; wrote empty lexical export.");
  }
}

async function listAssignments(flags) {
  const options = parseOptions(flags);
  const { client } = createAuthoringClient();
  let assignments = await client.listRecords("Assignment");
  if (options.queue) assignments = assignments.filter((assignment) => assignment.queueKey === options.queue);
  if (options.status) assignments = assignments.filter((assignment) => assignment.status === options.status);
  if (options.type) assignments = assignments.filter((assignment) => assignment.assignmentTypeKey === options.type);
  assignments.sort((left, right) => assignmentSortKey(left).localeCompare(assignmentSortKey(right)));
  for (const assignment of assignments) {
    console.log(`${assignment.status}\t${assignment.id}\t${assignment.assignmentTypeKey}\t${assignment.queueKey}\t${assignment.title}`);
  }
}

async function listAssignmentsForObject(flags) {
  const options = parseOptions(flags);
  const kind = options.kind;
  const lineage = options.lineage;
  if (!kind || !lineage) throw new Error("assignments for-object requires --kind and --lineage.");
  const { client } = createAuthoringClient();
  const stateKey = `${kind}#${lineage}#current`;
  const relations = (await client.listRecords("SemanticRelation"))
    .filter((relation) => relation.relationState === "current")
    .filter((relation) => relation.objectStateKey === stateKey)
    .filter((relation) => relation.subjectKind === "assignment")
    .filter((relation) => (relation.relationTypeKey ?? relation.predicate) === "requests_work_on");
  const assignmentIds = new Set(relations.map((relation) => relation.subjectId));
  const assignments = (await client.listRecords("Assignment")).filter((assignment) => assignmentIds.has(assignment.id));
  assignments.sort((left, right) => assignmentSortKey(left).localeCompare(assignmentSortKey(right)));
  for (const assignment of assignments) {
    console.log(`${assignment.status}\t${assignment.id}\t${assignment.assignmentTypeKey}\t${assignment.title}`);
  }
}

async function buildAssignmentContext(flags) {
  const options = parseOptions(flags);
  const assignmentId = options.assignment;
  if (!assignmentId) throw new Error("assignments build-context requires --assignment.");
  const outputPath = options.output || path.join(
    process.cwd(),
    ".papyrus-runs",
    timestampForPath(),
    `assignment-context-${assignmentId}.json`,
  );
  const result = runPapyrusNewsroomTool([
    "build-assignment-agent-context",
    "--assignment-id", assignmentId,
    "--context-profile", String(options["context-profile"] || ""),
    "--max-tokens", String(options["max-tokens"] || 0),
    "--recent-days", String(options["recent-days"] || 30),
  ], "assignment-context");
  const payload = JSON.parse(result);
  writeJsonFile(outputPath, payload);
  const context = payload.assignment_agent_context || {};
  console.log(`assignment-context\tassignment\t${assignmentId}`);
  console.log(`assignment-context\tprofile\t${context.contextProfile || "unknown"}\tbudget=${context.contextTokenBudget || 0}`);
  console.log(`assignment-context\tdesk\t${context.deskCategoryKey || "unknown"}\tfocus=${context.focusCategoryKey || "unknown"}`);
  console.log(`assignment-context\tblocks\tincluded=${(context.includedBlocks || []).length}\tdropped=${(context.droppedBlocks || []).length}`);
  console.log(`assignment-context\ttokens\t${context.totalTokens || 0}`);
  console.log(`assignment-context\toutput\t${outputPath}`);
}

async function listAssignmentResearchPackets(flags) {
  const options = parseOptions(flags);
  const assignmentId = options.assignment;
  if (!assignmentId) throw new Error("assignments research-packets requires --assignment.");
  const { client } = createAuthoringClient();
  const [messages, relations] = await Promise.all([
    client.listRecords("Message"),
    client.listRecords("SemanticRelation"),
  ]);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const packets = relations
    .filter((relation) => relation.relationState === "current")
    .filter((relation) => relation.subjectKind === "message" && relation.objectKind === "assignment")
    .filter((relation) => relation.objectId === assignmentId || relation.objectLineageId === assignmentId)
    .filter((relation) => (relation.relationTypeKey ?? relation.predicate) === "comment")
    .map((relation) => messageById.get(relation.subjectId))
    .filter(Boolean)
    .filter((message) => message.messageKind === "research_packet")
    .filter((message) => {
      const metadata = parseJsonish(message.metadata);
      return metadata.kind === "research.packet.created" || metadata.research;
    })
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));

  for (const message of packets) {
    const metadata = parseJsonish(message.metadata);
    const research = parseJsonish(metadata.research);
    const sources = Array.isArray(research.sourceSnapshots) ? research.sourceSnapshots : [];
    const proposals = Array.isArray(research.proposedReferences) ? research.proposedReferences : [];
    const domains = sources
      .map((source) => source.source_domain ?? source.sourceDomain ?? source.url)
      .filter(Boolean)
      .slice(0, 3)
      .join(",");
    console.log([
      message.createdAt,
      message.id,
      proposals.length,
      sources.length,
      domains || "-",
      message.summary ?? message.body,
    ].join("\t"));
    for (const proposal of proposals) {
      console.log([
        "proposal",
        proposal.title ?? proposal.url ?? "-",
        proposal.url ?? "-",
        proposal.ingestion_rationale ?? proposal.ingestionRationale ?? "-",
      ].join("\t"));
    }
  }
  if (!packets.length) console.log(`assignment-research-packets\t${assignmentId}\t0`);
}

async function mutateAssignment(action, flags) {
  const options = parseOptions(flags);
  const assignmentId = options.assignment;
  if (!assignmentId) throw new Error(`assignments ${action} requires --assignment.`);
  const { auth, client } = createAuthoringClient();
  const result = await applyAssignmentAction({
    client,
    authClaims: auth.claims,
    action,
    assignmentId,
    options,
  });
  console.log(`assignment\t${action}\t${assignmentId}\t${result.fromStatus}->${result.toStatus}`);
}

async function planEdition(flags) {
  const options = parseOptions(flags);
  const { plan, report } = await buildEditionPlanningCommandPlan(options);
  printEditionPlanningSummary(plan, report, "dry-run");
}

async function dispatchEditionResearch(flags) {
  const options = parseOptions(flags);
  const dryRunOnly = !options.apply;
  const { client, plan, report } = await buildEditionPlanningCommandPlan(options);
  if (dryRunOnly) {
    printEditionPlanningSummary(plan, report, "dry-run");
    console.log("edition-planning\tapply\tskipped\tpass --apply to write Edition, Assignment, and SemanticRelation records");
    return;
  }

  const applyResult = await applyEditionPlanningPlan(client, plan);
  const refreshedState = await loadEditionPlanningState(client);
  const verification = verifyEditionPlanningPlan(refreshedState, plan);
  const applyReport = writeEditionPlanningReport(plan, {
    mode: "apply",
    plan,
    applyResult,
    verification,
  }, {
    outputDir: report.outputDir,
    filename: "dispatch-report.json",
  });
  writeEditionPlanningReport(plan, verification, {
    outputDir: report.outputDir,
    filename: "verification.json",
  });
  printEditionPlanningSummary(plan, applyReport, "apply");
  console.log(`edition-planning\tapplied\t${applyResult.applied}`);
  console.log(`edition-planning\tverification\t${verification.ok ? "ok" : "failed"}`);
  if (verification.failures.length) {
    for (const failure of verification.failures) console.log(`failure\t${failure}`);
    throw new Error("Edition planning verification failed.");
  }
}

async function listAnalysisProfiles(flags) {
  const options = parseOptions(flags);
  const config = loadAnalysisProfiles(options.profiles || DEFAULT_ANALYSIS_PROFILES_PATH);
  const summaries = summarizeAnalysisProfiles(config);
  if (options.json) {
    console.log(JSON.stringify({ profilesPath: config.filepath, profiles: summaries }, null, 2));
    return;
  }
  for (const profile of summaries) {
    console.log(`${profile.key}\t${profile.scope}\t${profile.defaultMode}\t${profile.corpusKey || ""}\t${profile.title}`);
  }
}

async function validateAnalysisProfiles(flags) {
  const options = parseOptions(flags);
  const config = loadAnalysisProfiles(options.profiles || DEFAULT_ANALYSIS_PROFILES_PATH);
  console.log(`analysis-profiles\tvalid\t${config.filepath}\t${config.profiles.length}`);
}

async function previewAnalysisReindexPlan(flags) {
  const options = parseOptions(flags);
  const plan = buildAnalysisReindexPlanFromOptions(options, flags);
  if (options.output) writeJsonFile(options.output, plan);
  printAnalysisReindexPlan(plan);
}

async function createAnalysisReindexAssignment(flags) {
  const options = parseOptions(flags);
  const plan = buildAnalysisReindexPlanFromOptions(options, flags);
  const { client } = createAuthoringClient();
  const [assignments, assignmentEvents, semanticRelations, categorySets] = await Promise.all([
    client.listRecords("Assignment"),
    client.listRecords("AssignmentEvent"),
    client.listRecords("SemanticRelation"),
    client.listRecords("CategorySet"),
  ]);
  const categorySet = selectAnalysisCategorySet(categorySets, plan, options["category-set"]);
  const existing = mapExistingRecords({
    Assignment: assignments,
    AssignmentEvent: assignmentEvents,
    SemanticRelation: semanticRelations,
  });
  const assignmentPlan = buildAnalysisReindexAssignmentRecords(plan, {
    categorySet,
    existing,
    actorLabel: options.actor || "papyrus-content-cli",
  });
  if (options.output) writeJsonFile(options.output, { plan, assignment: assignmentPlan.assignment, records: assignmentPlan.records });
  printAnalysisReindexPlan(plan);
  for (const record of assignmentPlan.records) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
  }
  if (!options.apply) {
    console.log("analysis\tcreate-reindex-assignment\tapply\tskipped\tpass --apply to write Assignment records");
    return;
  }
  await applyRecordChanges(client, assignmentPlan.records);
  await updateNewsroomSummaryAfterAssignmentCreates(client, assignmentPlan.records, {
    actorLabel: options.actor || "papyrus-content-cli",
    reason: `analysis create-reindex-assignment ${assignmentPlan.assignment.id}`,
  });
}

async function runAnalysisReindexNow(flags) {
  const options = parseOptions(flags);
  const runNowOptions = {
    ...options,
    apply: true,
    "run-id": options["run-id"] || `analysis-now-${timestampForPath()}`,
  };
  const flagsWithRunId = injectRunIdOverride(flags, runNowOptions["run-id"]);
  const plan = buildAnalysisReindexPlanFromOptions(runNowOptions, flagsWithRunId);
  const { auth, client } = createAuthoringClient();
  const [assignments, assignmentEvents, semanticRelations, categorySets] = await Promise.all([
    client.listRecords("Assignment"),
    client.listRecords("AssignmentEvent"),
    client.listRecords("SemanticRelation"),
    client.listRecords("CategorySet"),
  ]);
  const categorySet = selectAnalysisCategorySet(categorySets, plan, runNowOptions["category-set"]);
  const existing = mapExistingRecords({
    Assignment: assignments,
    AssignmentEvent: assignmentEvents,
    SemanticRelation: semanticRelations,
  });
  const assignmentPlan = buildAnalysisReindexAssignmentRecords(plan, {
    categorySet,
    existing,
    actorLabel: runNowOptions.actor || "papyrus-content-cli",
  });
  await applyRecordChanges(client, assignmentPlan.records);
  await updateNewsroomSummaryAfterAssignmentCreates(client, assignmentPlan.records, {
    actorLabel: runNowOptions.actor || "papyrus-content-cli",
    reason: `analysis run-now create ${assignmentPlan.assignment.id}`,
  });
  const assignmentId = assignmentPlan.assignment.id;
  await applyAssignmentAction({
    client,
    authClaims: auth.claims,
    action: "claim",
    assignmentId,
    options: runNowOptions,
    actorLabel: runNowOptions["assignee-key"] ?? runNowOptions.assignee ?? runNowOptions.actor ?? "papyrus-content-cli",
  });
  console.log(`analysis-run-now\tassignment\t${assignmentId}`);
  console.log(`analysis-run-now\trun\t${runNowOptions["run-id"]}`);
  try {
    const executionResult = await executeAssignmentByType({
      client,
      assignmentId,
      options: runNowOptions,
    });
    await applyAssignmentAction({
      client,
      authClaims: auth.claims,
      action: "complete",
      assignmentId,
      options: runNowOptions,
      actorLabel: runNowOptions["assignee-key"] ?? runNowOptions.assignee ?? runNowOptions.actor ?? "papyrus-content-cli",
    });
    console.log(`analysis-run-now\tassignment\t${assignmentId}`);
    console.log(`analysis-run-now\trun\t${executionResult.runId}`);
    console.log(`analysis-run-now\tmanifest\t${executionResult.manifestPath}`);
    console.log(`analysis-run-now\timport-records\t${executionResult.importSummary.importedRecords}`);
    return;
  } catch (error) {
    const failure = normalizeError(error);
    const artifacts = analysisFailureArtifactsFromError(error);
    await appendAssignmentFailedEvent({
      client,
      assignmentId,
      assignmentTypeKey: "analysis.reindex",
      queueKey: assignmentPlan.assignment.queueKey,
      fromStatus: "claimed",
      toStatus: "claimed",
      actorLabel: runNowOptions["assignee-key"] ?? runNowOptions.assignee ?? runNowOptions.actor ?? "papyrus-content-cli",
      note: failure.message,
      metadata: {
        kind: "assignment.execution.failed",
        runId: artifacts.runId ?? runNowOptions["run-id"] ?? null,
        manifestPath: artifacts.manifestPath ?? null,
        stdoutLogPaths: artifacts.stdoutLogPaths,
        stderrLogPaths: artifacts.stderrLogPaths,
        importRuns: [],
        importedRecords: 0,
        error: failure,
      },
    });
    throw error;
  }
}

async function executeAnalysisReindexAssignment(flags) {
  const options = parseOptions(flags);
  const assignmentId = options.assignment;
  if (!assignmentId) throw new Error("analysis execute-assignment requires --assignment <id>.");
  const { client } = createAuthoringClient();
  try {
    await executeAssignmentByType({ client, assignmentId, options });
  } catch (error) {
    const assignment = await client.getRecord("Assignment", assignmentId);
    const failure = normalizeError(error);
    const artifacts = analysisFailureArtifactsFromError(error);
    await appendAssignmentFailedEvent({
      client,
      assignmentId,
      assignmentTypeKey: assignment?.assignmentTypeKey ?? "analysis.reindex",
      queueKey: assignment?.queueKey ?? null,
      fromStatus: assignment?.status ?? null,
      toStatus: assignment?.status ?? null,
      actorLabel: options.actor || "papyrus-content-cli",
      note: failure.message,
      metadata: {
        kind: "assignment.execution.failed",
        runId: artifacts.runId ?? options["run-id"] ?? null,
        manifestPath: artifacts.manifestPath ?? null,
        stdoutLogPaths: artifacts.stdoutLogPaths,
        stderrLogPaths: artifacts.stderrLogPaths,
        importRuns: [],
        importedRecords: 0,
        error: failure,
      },
    });
    throw error;
  }
}

async function executeAssignmentByType({ client, assignmentId, options = {} }) {
  const assignment = await client.getRecord("Assignment", assignmentId);
  if (!assignment) throw new Error(`Assignment ${assignmentId} was not found.`);
  if (assignment.assignmentTypeKey === "analysis.reindex") {
    return executeAnalysisReindexAssignmentInternal({
      client,
      assignment,
      options,
    });
  }
  throw new Error(`No executor is registered for assignment type ${assignment.assignmentTypeKey}.`);
}

async function executeAnalysisReindexAssignmentInternal({ client, assignment, options = {} }) {
  const assignmentId = assignment.id;
  if (assignment.assignmentTypeKey !== "analysis.reindex") {
    throw new Error(`Assignment ${assignmentId} is ${assignment.assignmentTypeKey}; expected analysis.reindex.`);
  }
  if (assignment.status !== "claimed") {
    throw new Error(`Assignment ${assignmentId} must be claimed before execution (current=${assignment.status}).`);
  }

  const metadata = parseJsonish(assignment.metadata);
  if (metadata.kind !== "analysis.reindex.requested") {
    throw new Error(`Assignment ${assignmentId} metadata is not analysis.reindex.requested.`);
  }
  const commandPlan = Array.isArray(metadata.commandPlan) ? metadata.commandPlan : [];
  if (!commandPlan.length) throw new Error(`Assignment ${assignmentId} has no commandPlan.`);

  const steeringConfig = loadSteeringConfig({ configPath: options.config || metadata.steeringConfigPath || undefined });
  const corpusConfig = requireCorpusConfig(steeringConfig, metadata.corpusKey, "assignment.metadata.corpusKey");
  const classifierId = metadata.classifierId || resolveClassifierForCorpus(steeringConfig, corpusConfig);
  const runId = options["run-id"] || `analysis-assignment-${hashShort([assignment.id, new Date().toISOString()])}`;
  const runDir = path.join(process.cwd(), ".papyrus-runs", runId);
  const manifestPath = path.join(runDir, "execution-manifest.json");
  const actorLabel = options.actor || "papyrus-content-cli";
  const executionControls = resolveAnalysisExecutionControls(options, metadata);
  fs.mkdirSync(runDir, { recursive: true });

  let executionPlan = [];
  const commandResults = [];
  let importSummary = { importedRecords: 0, importRuns: [] };
  try {
    executionPlan = await resolveAnalysisExecutionPlan({
      commandPlan,
      corpusConfig,
      classifierId,
    });
    for (const command of executionPlan) {
      if (isGraphExtractCommand(command)) {
        const preflightResult = await preflightGraphExtractorRuntime({
          command,
          runDir,
          runId,
          fallbackBiblicusWorkdir: metadata.biblicusWorkdir,
        });
        commandResults.push(preflightResult);
        await appendAssignmentPhaseEvent({
          client,
          assignment,
          eventType: "preflight_passed",
          actorLabel,
          note: `Preflight passed for ${command.label}.`,
          metadata: {
            kind: "analysis.reindex.preflight_passed",
            runId,
            manifestPath,
            commandLabel: command.label,
            stdoutLogPaths: [preflightResult.stdoutLogPath],
            stderrLogPaths: [preflightResult.stderrLogPath],
          },
        });
      }
      const commandLogPaths = analysisCommandLogPaths({ command, runDir });
      await appendAssignmentPhaseEvent({
        client,
        assignment,
        eventType: "executing",
        actorLabel,
        note: `Executing ${command.label}.`,
        metadata: {
          kind: "analysis.reindex.executing",
          runId,
          manifestPath,
          commandLabel: command.label,
          stdoutLogPaths: [commandLogPaths.stdoutLogPath],
          stderrLogPaths: [commandLogPaths.stderrLogPath],
          maxRuntimeSeconds: executionControls.maxRuntimeSeconds,
        },
      });
      const commandResult = await runAssignmentBiblicusCommand({
        command,
        runDir,
        runId,
        fallbackBiblicusWorkdir: metadata.biblicusWorkdir,
        executionControls,
      });
      commandResults.push(commandResult);
    }

    importSummary = await importAnalysisAssignmentOutputs({
      client,
      assignment,
      metadata,
      steeringConfig,
      corpusConfig,
      classifierId,
      commandResults,
      runDir,
    });

    const eventTime = new Date().toISOString();
    writeJsonFile(manifestPath, {
      runId,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      corpusKey: metadata.corpusKey,
      classifierId,
      executedAt: eventTime,
      status: "executed",
      commandResults,
      importSummary,
    });
    await appendAssignmentPhaseEvent({
      client,
      assignment,
      eventType: "executed",
      actorLabel,
      note: `Executed ${executionPlan.length} command(s) and imported ${importSummary.importedRecords} record changes.`,
      metadata: {
        kind: "analysis.reindex.executed",
        runId,
        manifestPath,
        commandCount: executionPlan.length,
        importedRecords: importSummary.importedRecords,
        importRuns: importSummary.importRuns,
        outputPaths: commandResults.map((entry) => entry.outputPath).filter(Boolean),
        stdoutLogPaths: commandResults.map((entry) => entry.stdoutLogPath).filter(Boolean),
        stderrLogPaths: commandResults.map((entry) => entry.stderrLogPath).filter(Boolean),
      },
    });
    console.log(`analysis-execute\tassignment\t${assignment.id}`);
    console.log(`analysis-execute\trun\t${runId}`);
    console.log(`analysis-execute\tcommands\t${executionPlan.length}`);
    console.log(`analysis-execute\timport-records\t${importSummary.importedRecords}`);
    console.log(`analysis-execute\tmanifest\t${manifestPath}`);
    return {
      assignmentId: assignment.id,
      runId,
      runDir,
      manifestPath,
      importSummary,
      commandResults,
    };
  } catch (error) {
    const failure = normalizeError(error);
    const artifacts = analysisFailureArtifactsFromError(error);
    const failedCommandResults = artifacts.commandResult
      ? [...commandResults, artifacts.commandResult]
      : commandResults;
    const stdoutLogPaths = uniqueStrings([
      ...failedCommandResults.map((entry) => entry.stdoutLogPath),
      ...artifacts.stdoutLogPaths,
    ]);
    const stderrLogPaths = uniqueStrings([
      ...failedCommandResults.map((entry) => entry.stderrLogPath),
      ...artifacts.stderrLogPaths,
    ]);
    const failureManifest = {
      runId,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      corpusKey: metadata.corpusKey,
      classifierId,
      failedAt: new Date().toISOString(),
      status: "failed",
      error: failure,
      commandResults: failedCommandResults,
      importRuns: importSummary.importRuns ?? [],
      importedRecords: importSummary.importedRecords ?? 0,
      stdoutLogPaths,
      stderrLogPaths,
      nextSuggestedCommand: `npm run content -- assignments list --type ${assignment.assignmentTypeKey} --limit 20`,
    };
    writeJsonFile(manifestPath, failureManifest);
    attachAnalysisFailureArtifacts(error, {
      runId,
      manifestPath,
      stdoutLogPaths,
      stderrLogPaths,
      commandResult: artifacts.commandResult ?? null,
    });
    throw error;
  }
}

async function processAssignmentQueue(flags) {
  const options = parseOptions(flags);
  const { auth, client } = createAuthoringClient();
  const assignmentTypeKey = normalizeCliString(options.type);
  if (!assignmentTypeKey) throw new Error("assignments process-queue requires --type <assignment-type-key>.");
  const queueKey = normalizeCliString(options.queue);
  const targetStatus = normalizeCliString(options.status) ?? "open";
  const stopOnError = parseBooleanOption(options["stop-on-error"], true, "--stop-on-error");
  const dryRun = parseBooleanOption(options["dry-run"], false, "--dry-run");
  const maxCount = normalizeCliPositiveInteger(options["max-count"], "--max-count") ?? 10;
  const actorLabel = normalizeCliString(options["assignee-key"])
    ?? normalizeCliString(options.assignee)
    ?? normalizeCliString(options.actor)
    ?? normalizeCliString(auth.claims.email)
    ?? normalizeCliString(auth.claims.sub)
    ?? "papyrus-content-cli";

  const candidates = (await client.listRecords("Assignment"))
    .filter((assignment) => assignment.assignmentTypeKey === assignmentTypeKey)
    .filter((assignment) => !queueKey || assignment.queueKey === queueKey)
    .filter((assignment) => assignment.status === targetStatus)
    .sort(compareAssignmentQueueOrder);

  const selected = candidates.slice(0, maxCount);
  if (dryRun) {
    console.log(`assignment-process-queue\tdry-run\ttrue`);
    console.log(`assignment-process-queue\ttype\t${assignmentTypeKey}`);
    console.log(`assignment-process-queue\tstatus\t${targetStatus}`);
    console.log(`assignment-process-queue\tcandidates\t${candidates.length}`);
    console.log(`assignment-process-queue\tselected\t${selected.length}`);
    for (const assignment of selected) {
      console.log([
        "assignment-process-candidate",
        assignment.id,
        assignment.status,
        assignment.priority ?? "",
        assignment.createdAt ?? "",
        assignment.queueKey ?? "",
        assignment.title ?? "",
      ].join("\t"));
    }
    return;
  }
  const summary = {
    attempted: selected.length,
    claimed: 0,
    executed: 0,
    completed: 0,
    failed: 0,
    skipped: Math.max(0, candidates.length - selected.length),
  };
  const results = [];

  for (let index = 0; index < selected.length; index += 1) {
    const assignment = selected[index];
    try {
      await applyAssignmentAction({
        client,
        authClaims: auth.claims,
        action: "claim",
        assignmentId: assignment.id,
        options,
        actorLabel,
      });
      summary.claimed += 1;
      const executionResult = await executeAssignmentByType({
        client,
        assignmentId: assignment.id,
        options,
      });
      summary.executed += 1;
      await applyAssignmentAction({
        client,
        authClaims: auth.claims,
        action: "complete",
        assignmentId: assignment.id,
        options,
        actorLabel,
      });
      summary.completed += 1;
      results.push({
        assignmentId: assignment.id,
        status: "completed",
        runId: executionResult.runId,
        manifestPath: executionResult.manifestPath,
        importedRecords: executionResult.importSummary.importedRecords,
      });
    } catch (error) {
      summary.failed += 1;
      const failure = normalizeError(error);
      const artifacts = analysisFailureArtifactsFromError(error);
      const currentAssignment = await client.getRecord("Assignment", assignment.id);
      await appendAssignmentFailedEvent({
        client,
        assignmentId: assignment.id,
        assignmentTypeKey: assignment.assignmentTypeKey,
        queueKey: assignment.queueKey,
        fromStatus: currentAssignment?.status ?? assignment.status,
        toStatus: currentAssignment?.status ?? assignment.status,
        actorLabel,
        note: failure.message,
        metadata: {
          kind: "assignment.execution.failed",
          runId: artifacts.runId ?? options["run-id"] ?? null,
          manifestPath: artifacts.manifestPath ?? null,
          stdoutLogPaths: artifacts.stdoutLogPaths,
          stderrLogPaths: artifacts.stderrLogPaths,
          importRuns: [],
          importedRecords: 0,
          error: failure,
        },
      });
      results.push({
        assignmentId: assignment.id,
        status: "failed",
        error: failure.message,
      });
      if (stopOnError) {
        summary.skipped += selected.length - (index + 1);
        break;
      }
    }
  }

  console.log(`assignment-process-queue\ttype\t${assignmentTypeKey}`);
  console.log(`assignment-process-queue\tstatus\t${targetStatus}`);
  console.log(`assignment-process-queue\tattempted\t${summary.attempted}`);
  console.log(`assignment-process-queue\tclaimed\t${summary.claimed}`);
  console.log(`assignment-process-queue\texecuted\t${summary.executed}`);
  console.log(`assignment-process-queue\tcompleted\t${summary.completed}`);
  console.log(`assignment-process-queue\tfailed\t${summary.failed}`);
  console.log(`assignment-process-queue\tskipped\t${summary.skipped}`);
  for (const result of results) {
    console.log([
      "assignment-process-result",
      result.assignmentId,
      result.status,
      result.runId ?? "-",
      result.importedRecords ?? "-",
      result.manifestPath ?? result.error ?? "-",
    ].join("\t"));
  }
}

async function recountNewsroomSummary(flags) {
  const options = parseOptions(flags);
  const { client } = createAuthoringClient();
  const now = new Date().toISOString();
  const [
    corpora,
    importRuns,
    categorySets,
    categorys,
    proposals,
    artifacts,
    references,
    referenceAttachments,
    semanticNodes,
    messages,
    semanticRelations,
    assignments,
    assignmentEvents,
  ] = await Promise.all([
    client.listRecords("KnowledgeCorpus"),
    client.listRecords("KnowledgeImportRun"),
    client.listRecords("CategorySet"),
    client.listRecords("Category"),
    client.listRecords("SteeringProposal"),
    client.listRecords("KnowledgeArtifact"),
    client.listRecords("Reference"),
    client.listRecords("ReferenceAttachment"),
    client.listRecords("SemanticNode"),
    client.listRecords("Message"),
    client.listRecords("SemanticRelation"),
    client.listRecords("Assignment"),
    client.listRecords("AssignmentEvent"),
  ]);
  const payload = buildNewsroomSummaryPayload({
    corpora,
    importRuns,
    categorySets,
    categories: categorys,
    proposals,
    artifacts,
    references,
    referenceAttachments,
    semanticNodes,
    messages,
    semanticRelations,
    assignments,
    assignmentEvents,
    now,
    source: "recount",
  });
  const expected = buildNewsroomSummaryPayloadRecord(payload, now);
  const current = await client.getRecord("KnowledgeRawPayload", NEWSROOM_SUMMARY_PAYLOAD_ID);
  if (current?.createdAt) expected.createdAt = current.createdAt;
  const change = buildRecordChangeFromCurrent("KnowledgeRawPayload", expected, current);
  printNewsroomSummaryRecount(current, expected, change);
  if (options.output) writeJsonFile(options.output, { current, expected, action: change.action, payload });
  if (!options.apply) {
    console.log("newsroom\trecount-summary\tapply\tskipped\tpass --apply to write KnowledgeRawPayload snapshot");
    return;
  }
  await client.upsert("KnowledgeRawPayload", expected);
  console.log(`newsroom\trecount-summary\t${change.action}\t${expected.id}`);
}

async function backfillNewsroomFeedFields(flags) {
  const options = parseOptions(flags);
  const { client } = createAuthoringClient();
  const models = ["Message", "Assignment", "Reference", "SemanticNode", "SemanticRelation"];
  const recordsByModel = {};
  for (const modelName of models) recordsByModel[modelName] = await client.listRecords(modelName);
  const changes = [];
  for (const [modelName, records] of Object.entries(recordsByModel)) {
    for (const record of records) {
      const patch = newsroomFeedPatchFor(modelName, record);
      if (!Object.keys(patch).some((key) => record[key] !== patch[key])) continue;
      changes.push({ modelName, expected: { ...record, ...patch }, current: record });
    }
  }
  console.log(`newsroom\tbackfill-feed-fields\tplanned\t${changes.length} updates`);
  for (const change of changes.slice(0, 20)) {
    console.log(`${change.modelName}\t${change.current.id}\tcreatedAt=${change.expected.createdAt ?? ""}\tupdatedAt=${change.expected.updatedAt ?? ""}\tfeed=${change.expected.newsroomFeedKey ?? ""}`);
  }
  if (changes.length > 20) console.log(`newsroom\tbackfill-feed-fields\tpreview-truncated\t${changes.length - 20} more`);
  if (!options.apply) {
    console.log("newsroom\tbackfill-feed-fields\tapply\tskipped\tpass --apply to write feed fields");
    return;
  }
  for (const change of changes) await client.upsert(change.modelName, change.expected);
  console.log(`newsroom\tbackfill-feed-fields\tupdated\t${changes.length}`);
}

function newsroomFeedPatchFor(modelName, record) {
  const now = new Date().toISOString();
  if (modelName === "Message") {
    return {
      createdAt: record.createdAt ?? record.updatedAt ?? now,
      updatedAt: record.updatedAt ?? record.createdAt ?? now,
      newsroomFeedKey: "messages",
    };
  }
  if (modelName === "Assignment") {
    return {
      createdAt: record.createdAt ?? record.updatedAt ?? now,
      updatedAt: record.updatedAt ?? record.createdAt ?? now,
      newsroomFeedKey: "assignments",
    };
  }
  if (modelName === "Reference") {
    const createdAt = record.createdAt ?? record.importedAt ?? record.versionCreatedAt ?? record.updatedAt ?? now;
    return {
      createdAt,
      updatedAt: record.updatedAt ?? record.curationStatusUpdatedAt ?? record.importedAt ?? createdAt,
      newsroomFeedKey: "references",
    };
  }
  if (modelName === "SemanticNode") {
    const createdAt = record.createdAt ?? record.versionCreatedAt ?? record.updatedAt ?? now;
    return {
      createdAt,
      updatedAt: record.updatedAt ?? createdAt,
      newsroomFeedKey: "semanticNodes",
    };
  }
  if (modelName === "SemanticRelation") {
    const createdAt = record.createdAt ?? record.importedAt ?? record.updatedAt ?? now;
    return {
      createdAt,
      updatedAt: record.updatedAt ?? record.importedAt ?? createdAt,
      newsroomFeedKey: "semanticRelations",
    };
  }
  return {};
}

function printNewsroomSummaryRecount(current, expected, change) {
  const currentPayload = normalizeNewsroomSummaryPayload(current?.payload);
  const expectedPayload = normalizeNewsroomSummaryPayload(expected.payload);
  console.log("Newsroom summary recount:");
  console.log(`Snapshot: ${NEWSROOM_SUMMARY_PAYLOAD_ID}`);
  console.log(`Action: ${change.action}`);
  console.log(`Current: generatedAt=${currentPayload.generatedAt} source=${currentPayload.source}`);
  console.log(`Expected: generatedAt=${expectedPayload.generatedAt} source=${expectedPayload.source}`);
  for (const [key, value] of Object.entries(expectedPayload.counts).sort(([left], [right]) => left.localeCompare(right))) {
    const currentValue = currentPayload.counts[key] ?? 0;
    if (currentValue !== value) console.log(`count\t${key}\t${currentValue}\t->\t${value}`);
  }
  for (const [key, value] of Object.entries(expectedPayload.referenceStatusCounts).sort(([left], [right]) => left.localeCompare(right))) {
    const currentValue = currentPayload.referenceStatusCounts[key] ?? 0;
    if (currentValue !== value) console.log(`reference-status\t${key}\t${currentValue}\t->\t${value}`);
  }
  for (const [key, value] of Object.entries(expectedPayload.assignmentStatusCounts).sort(([left], [right]) => left.localeCompare(right))) {
    const currentValue = currentPayload.assignmentStatusCounts[key] ?? 0;
    if (currentValue !== value) console.log(`assignment-status\t${key}\t${currentValue}\t->\t${value}`);
  }
}

function buildAnalysisReindexPlanFromOptions(options, flags) {
  if (!options.profile) throw new Error("analysis reindex-plan requires --profile <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const profilesConfig = loadAnalysisProfiles(options.profiles || DEFAULT_ANALYSIS_PROFILES_PATH);
  const profile = profilesConfig.profiles.find((entry) => entry.key === options.profile);
  if (!profile) throw new Error(`Unknown analysis profile ${options.profile}.`);
  const overrides = parseAnalysisOverrides(parseRepeatedOption(flags, "override"), profile);
  return buildAnalysisReindexPlan({
    profilesConfig,
    steeringConfig,
    profileKey: options.profile,
    corpusKey: options["corpus-key"],
    mode: options.mode,
    overrides,
    runId: options["run-id"],
    biblicusWorkdir: options["biblicus-workdir"],
    categorySetId: options["category-set"],
    categoryKey: options["category-key"],
  });
}

function selectAnalysisCategorySet(categorySets, plan, explicitCategorySetId) {
  if (explicitCategorySetId) {
    const categorySet = categorySets.find((entry) => entry.id === explicitCategorySetId) ?? null;
    if (!categorySet) throw new Error(`CategorySet ${explicitCategorySetId} was not found.`);
    return categorySet;
  }
  return categorySets
    .filter((entry) => entry.status === "accepted")
    .filter((entry) => !entry.versionState || entry.versionState === "current")
    .filter((entry) => entry.corpusId === plan.corpus.id)
    .filter((entry) => !plan.classifierId || entry.classifierId === plan.classifierId)
    .sort((left, right) => String(right.generatedAt ?? "").localeCompare(String(left.generatedAt ?? "")) || String(left.displayName ?? "").localeCompare(String(right.displayName ?? "")))[0]
    ?? null;
}

function printAnalysisReindexPlan(plan) {
  console.log(`analysis-reindex\tprofile\t${plan.profile.key}\t${plan.profile.scope}`);
  console.log(`analysis-reindex\tmode\t${plan.mode}`);
  console.log(`analysis-reindex\tcorpus\t${plan.corpus.key}\t${plan.corpus.id}`);
  if (plan.execution?.maxRuntimeSeconds) console.log(`analysis-reindex\tmax-runtime-seconds\t${plan.execution.maxRuntimeSeconds}`);
  const criteria = plan.execution?.successCriteria ?? {};
  for (const [key, value] of Object.entries(criteria)) {
    if (value !== null && value !== undefined) console.log(`analysis-reindex\tsuccess-criteria\t${key}\t${value}`);
  }
  console.log(`analysis-reindex\tcommands\t${plan.commandPlan.length}`);
  for (const command of plan.commandPlan) {
    console.log(`analysis-reindex\tcommand\t${command.label}\t${command.executable} ${command.args.join(" ")}`);
  }
  console.log(`analysis-reindex\tdestructive-now\t${plan.destructivePlan.mutatesGraphqlNow ? "yes" : "no"}`);
  for (const generatedOutput of plan.destructivePlan.generatedOutputs) {
    console.log(`analysis-reindex\tgenerated-output\t${generatedOutput.modelName}\t${generatedOutput.note}`);
  }
  for (const warning of plan.warnings) {
    console.log(`analysis-reindex\twarning\t${warning}`);
  }
}

async function resolveAnalysisExecutionPlan({ commandPlan, corpusConfig, classifierId }) {
  const latestSnapshot = await resolveLatestExtractionSnapshot({ corpusConfig, classifierId });
  return commandPlan.map((command) => {
    const args = Array.isArray(command.args) ? [...command.args] : [];
    const snapshotArgIndex = args.findIndex((entry) => entry === "--extraction-snapshot");
    if (snapshotArgIndex >= 0 && args[snapshotArgIndex + 1] && String(args[snapshotArgIndex + 1]).includes("<")) {
      if (!latestSnapshot) {
        throw new Error(`Command ${command.label} requires a concrete extraction snapshot, but none was discovered for ${corpusConfig.key}.`);
      }
      args[snapshotArgIndex + 1] = latestSnapshot;
    }
    return {
      ...command,
      args,
    };
  });
}

async function resolveLatestExtractionSnapshot({ corpusConfig, classifierId }) {
  try {
    const bundle = loadSteeringBundleFromBiblicus({
      corpus: corpusConfig.path,
      classifier: classifierId,
    });
    return latestPipelineSnapshot(bundle);
  } catch {
    return null;
  }
}

async function runAssignmentBiblicusCommand({ command, runDir, runId, fallbackBiblicusWorkdir, executionControls }) {
  const label = String(command.label || "analysis-command");
  const executable = String(command.executable || "uv");
  const rawArgs = Array.isArray(command.args) ? command.args.map(String) : [];
  const requiredExtras = label === "graph-extract"
    ? ["topic-modeling", "openai", "neo4j", "ner"]
    : ["topic-modeling", "openai"];
  const args = executable === "uv" ? ensureUvBiblicusExtras(rawArgs, requiredExtras) : rawArgs;
  const cwd = normalizeCliString(command.cwd)
    || normalizeCliString(fallbackBiblicusWorkdir)
    || process.env.BIBLICUS_WORKDIR
    || DEFAULT_BIBLICUS_WORKDIR;
  const { logPrefix, stdoutLogPath, stderrLogPath } = analysisCommandLogPaths({ command, runDir });
  const result = await runStreamingProcess({
    executable,
    args,
    cwd,
    label,
    runId,
    logPrefix,
    stdoutLogPath,
    stderrLogPath,
    maxRuntimeSeconds: executionControls?.maxRuntimeSeconds ?? null,
  });
  if (result.status !== 0) {
    const message = result.timedOut
      ? `Analysis command ${label} timed out after ${executionControls?.maxRuntimeSeconds} seconds. See ${stderrLogPath}`
      : `Analysis command ${label} failed. See ${stderrLogPath}`;
    throw createAnalysisCommandError(message, {
      kind: result.timedOut ? "timeout" : "command_failed",
      runId,
      commandResult: result,
      stdoutLogPaths: [stdoutLogPath],
      stderrLogPaths: [stderrLogPath],
    });
  }
  let outputPath = null;
  let outputJson = null;
  const stdoutText = String(result.stdout ?? "");
  const parsedJson = parseJsonFromCommandStdout(stdoutText);
  if (parsedJson) {
    try {
      outputJson = parsedJson;
      outputPath = `${logPrefix}.json`;
      writeJsonFile(outputPath, outputJson);
    } catch {
      outputJson = null;
      outputPath = null;
    }
  }
  const commandResult = {
    label,
    executable,
    args,
    cwd,
    outputPath,
    stdoutLogPath,
    stderrLogPath,
    outputJson,
    elapsedSeconds: result.elapsedSeconds,
    exitStatus: result.exitStatus,
    signal: result.signal,
    timedOut: result.timedOut,
  };
  if (label === "graph-extract") {
    validateGraphCommandSuccess(commandResult, executionControls?.successCriteria ?? {});
  }
  return commandResult;
}

async function preflightGraphExtractorRuntime({ command, runDir, runId, fallbackBiblicusWorkdir }) {
  const label = String(command.label || "graph-extract");
  const rawArgs = Array.isArray(command.args) ? command.args.map(String) : [];
  const requiredExtras = ["topic-modeling", "openai", "neo4j", "ner"];
  const cwd = normalizeCliString(command.cwd)
    || normalizeCliString(fallbackBiblicusWorkdir)
    || process.env.BIBLICUS_WORKDIR
    || DEFAULT_BIBLICUS_WORKDIR;
  const model = resolveGraphExtractorSpacyModel(rawArgs, cwd);
  const script = [
    "import json, sys",
    "import spacy",
    "model = sys.argv[1]",
    "spacy.load(model)",
    "print(json.dumps({'ok': True, 'model': model}))",
  ].join("; ");
  const args = [
    "run",
    ...requiredExtras.flatMap((extra) => ["--extra", extra]),
    "python",
    "-c",
    script,
    model,
  ];
  const paths = analysisCommandLogPaths({ command: { ...command, label: `${label}-preflight` }, runDir });
  const result = await runStreamingProcess({
    executable: "uv",
    args,
    cwd,
    label: `${label}-preflight`,
    runId,
    ...paths,
    maxRuntimeSeconds: 120,
  });
  if (result.status !== 0) {
    throw createAnalysisCommandError(`Analysis command ${label} preflight failed for spaCy model ${model}. See ${paths.stderrLogPath}`, {
      kind: result.timedOut ? "timeout" : "preflight_failed",
      runId,
      commandResult: result,
      stdoutLogPaths: [paths.stdoutLogPath],
      stderrLogPaths: [paths.stderrLogPath],
    });
  }
  return {
    label: `${label}-preflight`,
    executable: "uv",
    args,
    cwd,
    outputPath: null,
    stdoutLogPath: paths.stdoutLogPath,
    stderrLogPath: paths.stderrLogPath,
    outputJson: parseJsonFromCommandStdout(result.stdout),
    elapsedSeconds: result.elapsedSeconds,
    exitStatus: result.exitStatus,
    signal: result.signal,
    timedOut: result.timedOut,
  };
}

function analysisCommandLogPaths({ command, runDir }) {
  const label = String(command.label || "analysis-command");
  const safeLabel = label.replace(/[^A-Za-z0-9_.-]/g, "-");
  const logPrefix = path.join(runDir, safeLabel);
  return {
    logPrefix,
    stdoutLogPath: `${logPrefix}.stdout.log`,
    stderrLogPath: `${logPrefix}.stderr.log`,
  };
}

function runStreamingProcess({
  executable,
  args,
  cwd,
  label,
  runId,
  logPrefix,
  stdoutLogPath,
  stderrLogPath,
  maxRuntimeSeconds,
}) {
  fs.mkdirSync(path.dirname(logPrefix), { recursive: true });
  const startedAt = Date.now();
  const stdoutStream = fs.createWriteStream(stdoutLogPath, { flags: "w" });
  const stderrStream = fs.createWriteStream(stderrLogPath, { flags: "w" });
  const captureLimit = 1024 * 1024 * 64;
  let stdoutCapture = "";
  let stderrCapture = "";
  let timedOut = false;
  let timeoutHandle = null;
  let killHandle = null;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (maxRuntimeSeconds) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killHandle = setTimeout(() => child.kill("SIGKILL"), 5000);
      }, maxRuntimeSeconds * 1000);
    }
    child.stdout.on("data", (chunk) => {
      stdoutStream.write(chunk);
      if (stdoutCapture.length < captureLimit) stdoutCapture += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderrStream.write(chunk);
      if (stderrCapture.length < captureLimit) stderrCapture += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killHandle) clearTimeout(killHandle);
      stdoutStream.end();
      stderrStream.end();
      reject(createAnalysisCommandError(`Analysis command ${label} could not start: ${error.message}. See ${stderrLogPath}`, {
        kind: "spawn_failed",
        runId,
        stdoutLogPaths: [stdoutLogPath],
        stderrLogPaths: [stderrLogPath],
        commandResult: {
          label,
          executable,
          args,
          cwd,
          stdoutLogPath,
          stderrLogPath,
          elapsedSeconds: elapsedSecondsSince(startedAt),
          exitStatus: null,
          signal: null,
          timedOut,
        },
      }));
    });
    child.on("close", (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killHandle) clearTimeout(killHandle);
      stdoutStream.end();
      stderrStream.end();
      resolve({
        label,
        executable,
        args,
        cwd,
        status: timedOut ? 124 : code,
        exitStatus: code,
        signal,
        timedOut,
        elapsedSeconds: elapsedSecondsSince(startedAt),
        stdout: stdoutCapture,
        stderr: stderrCapture,
        stdoutLogPath,
        stderrLogPath,
      });
    });
  });
}

function elapsedSecondsSince(startedAt) {
  return Number(((Date.now() - startedAt) / 1000).toFixed(3));
}

function parseJsonFromCommandStdout(stdoutText) {
  const text = String(stdoutText ?? "").trim();
  if (!text) return null;
  const candidates = [];
  if (text.startsWith("{") || text.startsWith("[")) candidates.push(text);
  const objectIndex = text.lastIndexOf("\n{");
  if (objectIndex >= 0) candidates.push(text.slice(objectIndex + 1));
  const arrayIndex = text.lastIndexOf("\n[");
  if (arrayIndex >= 0) candidates.push(text.slice(arrayIndex + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next plausible JSON boundary.
    }
  }
  return null;
}

function validateGraphCommandSuccess(commandResult, successCriteria = {}) {
  const stats = commandResult.outputJson?.stats;
  if (!stats) return;
  const processed = Number(stats.items_processed ?? stats.itemsProcessed ?? stats.items_total ?? stats.itemsTotal ?? 0);
  const errored = Number(stats.items_errored ?? stats.itemsErrored ?? 0);
  const nodes = Number(stats.nodes ?? 0);
  const edges = Number(stats.edges ?? 0);
  if (processed > 0 && errored >= processed && nodes === 0 && edges === 0) {
    throw createAnalysisCommandError(`Analysis command ${commandResult.label} produced no graph output (${errored}/${processed} items errored). See ${commandResult.stderrLogPath}`, {
      kind: "success_criteria_failed",
      commandResult,
      stdoutLogPaths: [commandResult.stdoutLogPath],
      stderrLogPaths: [commandResult.stderrLogPath],
    });
  }
  if (successCriteria.minNodes !== null && successCriteria.minNodes !== undefined && nodes < Number(successCriteria.minNodes)) {
    throw createAnalysisCommandError(`Analysis command ${commandResult.label} produced ${nodes} graph nodes; expected at least ${successCriteria.minNodes}. See ${commandResult.stderrLogPath}`, {
      kind: "success_criteria_failed",
      commandResult,
      stdoutLogPaths: [commandResult.stdoutLogPath],
      stderrLogPaths: [commandResult.stderrLogPath],
    });
  }
  if (successCriteria.minEdges !== null && successCriteria.minEdges !== undefined && edges < Number(successCriteria.minEdges)) {
    throw createAnalysisCommandError(`Analysis command ${commandResult.label} produced ${edges} graph edges; expected at least ${successCriteria.minEdges}. See ${commandResult.stderrLogPath}`, {
      kind: "success_criteria_failed",
      commandResult,
      stdoutLogPaths: [commandResult.stdoutLogPath],
      stderrLogPaths: [commandResult.stderrLogPath],
    });
  }
  if (successCriteria.maxErrorRate !== null && successCriteria.maxErrorRate !== undefined && processed > 0) {
    const errorRate = errored / processed;
    if (errorRate > Number(successCriteria.maxErrorRate)) {
      throw createAnalysisCommandError(`Analysis command ${commandResult.label} item error rate ${errorRate.toFixed(3)} exceeded ${successCriteria.maxErrorRate}. See ${commandResult.stderrLogPath}`, {
        kind: "success_criteria_failed",
        commandResult,
        stdoutLogPaths: [commandResult.stdoutLogPath],
        stderrLogPaths: [commandResult.stderrLogPath],
      });
    }
  }
}

function createAnalysisCommandError(message, artifacts = {}) {
  const error = new Error(message);
  attachAnalysisFailureArtifacts(error, artifacts);
  return error;
}

function attachAnalysisFailureArtifacts(error, artifacts = {}) {
  if (error && typeof error === "object") {
    error.analysisArtifacts = {
      ...(error.analysisArtifacts ?? {}),
      ...artifacts,
    };
  }
  return error;
}

function isGraphExtractCommand(command) {
  return String(command?.label ?? "") === "graph-extract";
}

async function importAnalysisAssignmentOutputs({
  client,
  assignment,
  metadata,
  steeringConfig,
  corpusConfig,
  classifierId,
  commandResults,
  runDir,
}) {
  const importRuns = [];
  let importedRecords = 0;

  for (const command of commandResults) {
    const payload = command.outputJson;
    if (!payload || typeof payload !== "object") continue;

    if (command.label === "topic-classifier-project") {
      const projectionContext = resolveProjectionImportCorpora(steeringConfig, {
        "target-corpus-key": metadata.corpusKey,
        "authority-corpus-key": normalizeCliString(metadata.effectiveParameters?.authorityCorpusKey) || steeringConfig.canonicalTopicSet?.corpusKey,
        classifier: classifierId,
      });
      const targetReferences = await client.listRecords("Reference");
      const acceptedProjectionPayload = filterProjectionPayloadForAcceptedReferences(
        payload,
        targetReferences,
        projectionContext.targetCorpusId,
      );
      const categorySet = await resolveAcceptedCategorySet(client, {
        categorySetId: metadata.categorySetId || null,
        corpusId: projectionContext.authorityCorpusId,
        classifierId,
      });
      const plan = buildProjectionImportRecords(acceptedProjectionPayload, {
        authorityCorpusConfig: projectionContext.authorityCorpus,
        authorityCorpusId: projectionContext.authorityCorpusId,
        targetCorpusConfig: projectionContext.targetCorpus,
        targetCorpusId: projectionContext.targetCorpusId,
        classifierId,
        categorySetId: categorySet?.id ?? null,
      });
      const changes = await buildRecordChangesToleratingOptionalModels(client, plan.records);
      await applyRecordChanges(client, changes);
      await updateNewsroomSummaryAfterAnalysisImport(client, changes, {
        actorLabel: "papyrus-content-cli",
        reason: `analysis import projection ${plan.importRunId}`,
      });
      printCategoryImportSummary(`projection:${metadata.corpusKey}`, plan.importRunId, changes);
      importRuns.push(plan.importRunId);
      importedRecords += changes.filter((record) => record.action !== "noop").length;
      continue;
    }

    if (command.label === "topic-granularity-sweep" || command.label === "taxonomy-discover") {
      const proposalBundle = normalizeSteeringProposalBundle(payload);
      const proposalCount = Array.isArray(proposalBundle.proposals) ? proposalBundle.proposals.length : 0;
      if (!proposalCount) continue;
      const proposalPath = path.join(runDir, `${command.label}-proposals.json`);
      writeJsonFile(proposalPath, proposalBundle);
      const biblicusPlan = { runDir, biblicusWorkdir: metadata.biblicusWorkdir || DEFAULT_BIBLICUS_WORKDIR };
      runBiblicus(biblicusPlan, ["steering", "proposals", "validate", "--input", proposalPath], `${command.label}-validate`);
      runBiblicus(biblicusPlan, ["steering", "proposals", "record", "--corpus", corpusConfig.path, "--input", proposalPath], `${command.label}-record`);
      const refreshedBundle = loadSteeringBundleFromBiblicus({
        corpus: corpusConfig.path,
        classifier: classifierId,
      });
      const steeringPlan = buildSteeringImportRecords(refreshedBundle, {
        classifierId,
        corpusConfig,
        corpusPath: corpusConfig.path,
      });
      const changes = await buildRecordChangesToleratingOptionalModels(client, steeringPlan.records);
      await applyRecordChanges(client, changes);
      await updateNewsroomSummaryAfterAnalysisImport(client, changes, {
        actorLabel: "papyrus-content-cli",
        reason: `analysis import steering ${steeringPlan.importRunId}`,
      });
      printCategoryImportSummary("steering", steeringPlan.importRunId, changes);
      importRuns.push(steeringPlan.importRunId);
      importedRecords += changes.filter((record) => record.action !== "noop").length;
    }
  }

  return {
    assignmentId: assignment.id,
    importedRecords,
    importRuns,
  };
}

async function buildEditionPlanningCommandPlan(options) {
  const editionDate = options.date;
  if (!editionDate) throw new Error("editions plan/dispatch-research requires --date YYYY-MM-DD.");
  const { client } = createAuthoringClient();
  const state = await loadEditionPlanningState(client);
  const plan = buildEditionPlanningPlan(state, {
    editionDate,
    editionSlug: options.slug,
    topDeskCount: options["top-desks"],
    publicationSlots: options.slots,
    overassignmentRatio: options.ratio,
    maxAssignments: options["max-assignments"],
    focusCategories: parseCommaList(options["focus-categories"] ?? options["track-lenses"]),
    contextProfile: options["context-profile"],
    targetSystemType: options["target-system-type"],
  });
  const report = writeEditionPlanningReport(plan, {
    mode: "dry-run",
    plan,
  }, {
    outputDir: options.output,
    filename: "dry-run-plan.json",
  });
  return { client, plan, report };
}

async function deleteAllContent(client) {
  const deleteOrder = [
    "PublishedMediaAsset",
    "PublishedEditionItem",
    "PublishedItem",
    "PublishedEdition",
    "PublishedCategory",
    "PublishedCategorySet",
    "MediaAsset",
    "ItemTag",
    "EditionItem",
    "Item",
    "Tag",
    "Edition",
    "KnowledgeRawPayload",
    "SteeringDecision",
    "SteeringProposal",
    "SemanticRelation",
    "SemanticRelationType",
    "AssignmentEvent",
    "Assignment",
    "SemanticNode",
    "Message",
    "ReferenceAttachment",
    "Reference",
    "CategoryKeyword",
    "LexicalSteeringRule",
    "Category",
    "CategorySet",
    "KnowledgeArtifact",
    "KnowledgeImportRun",
    "KnowledgeCorpus",
  ];
  const result = [];

  for (const modelName of deleteOrder) {
    let totalDeleted = 0;
    let pass = 0;
    for (;;) {
      pass += 1;
      let records = [];
      try {
        records = await client.listRecords(modelName);
      } catch (error) {
        if (!isMissingGraphQLModelError(error, modelName) && !isDynamoResourceNotFoundError(error)) throw error;
        console.error(`delete\tskip\t${modelName}\t${normalizeError(error).message}`);
        result.push({ modelName, deleted: totalDeleted, skipped: true });
        break;
      }
      console.error(`delete\t${modelName}\tpass=${pass}\t${records.length}`);
      if (records.length === 0) {
        result.push({ modelName, deleted: totalDeleted });
        break;
      }
      for (const record of records) {
        try {
          await client.deleteRecord(modelName, record.id);
          totalDeleted += 1;
        } catch (error) {
          if (!isDynamoResourceNotFoundError(error)) throw error;
          console.error(`delete\tskip-record\t${modelName}\t${record.id}\t${normalizeError(error).message}`);
        }
      }
      if (pass >= 20) throw new Error(`delete all did not drain ${modelName} after ${pass} passes.`);
    }
  }

  return result;
}

async function buildRecordChanges(client, records) {
  console.error(`prepare\trecords\t${records.length}`);
  const prepared = await prepareVersionedKnowledgeRecords(client, records);
  console.error(`prepare\tplanned\t${prepared.records.length}\tpostChanges\t${prepared.postChanges.length}`);
  const changes = [];
  const plannedRecords = dedupePlannedRecords(prepared.records);
  if (plannedRecords.length !== prepared.records.length) {
    console.error(`prepare\tdeduped\t${prepared.records.length - plannedRecords.length}`);
  }
  const existingByModel = await listExistingRecordsByModel(client, plannedRecords);
  for (const record of plannedRecords) {
    changes.push(buildRecordChangeFromCurrent(
      record.modelName,
      record.expected,
      existingByModel.get(record.modelName)?.get(record.expected.id) ?? null,
    ));
  }
  changes.push(...prepared.postChanges);
  return changes;
}

function dedupePlannedRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = `${record.modelName}:${record.expected?.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, record);
      continue;
    }
    if (
      stableJson(existing.expected) !== stableJson(record.expected)
      && !isBenignPlannedDuplicate(record.modelName, existing.expected, record.expected)
    ) {
      throw new Error(`Conflicting planned records for ${key}.`);
    }
  }
  return Array.from(byKey.values());
}

function isBenignPlannedDuplicate(modelName, left, right) {
  if (modelName !== "Category") return false;
  const normalize = (record) => {
    const next = { ...record };
    if (!next.aliases) next.aliases = [];
    if (next.isPinned == null) next.isPinned = false;
    delete next.changeReason;
    delete next.contentHash;
    return next;
  };
  return stableJson(normalize(left)) === stableJson(normalize(right));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function buildRecordChangesToleratingOptionalModels(client, records) {
  let pendingRecords = records;
  const skippedModels = new Set();
  for (;;) {
    try {
      return await buildRecordChanges(client, pendingRecords);
    } catch (error) {
      const missingModel = Array.from(OPTIONAL_SCHEMA_MODELS)
        .find((modelName) => !skippedModels.has(modelName) && isMissingGraphQLModelError(error, modelName));
      if (!missingModel) throw error;
      skippedModels.add(missingModel);
      pendingRecords = pendingRecords.filter((record) => record.modelName !== missingModel);
      console.warn(`skip\t${missingModel}\tmodel is not deployed in AppSync yet; skipped optional records.`);
    }
  }
}

async function listExistingRecordsByModel(client, records) {
  const modelNames = Array.from(new Set(records.map((record) => record.modelName)));
  const existingByModel = new Map();
  for (const modelName of modelNames) {
    console.error(`prefetch\t${modelName}`);
    const existing = await client.listRecords(modelName);
    console.error(`prefetch\t${modelName}\t${existing.length}`);
    existingByModel.set(modelName, new Map(existing.map((record) => [record.id, record])));
  }
  return existingByModel;
}

async function prepareVersionedKnowledgeRecords(client, records) {
  const referenceRecords = records.filter((record) => record.modelName === "Reference");
  if (!referenceRecords.length) return { records, postChanges: [] };

  const existingReferences = await client.listRecords("Reference");
  const currentReferenceByLineage = new Map();
  for (const reference of existingReferences) {
    const lineageId = reference.lineageId;
    if (!lineageId) continue;
    const current = currentReferenceByLineage.get(lineageId);
    if (
      reference.versionState === "current" &&
      (!current || Number(reference.versionNumber ?? 0) > Number(current.versionNumber ?? 0))
    ) {
      currentReferenceByLineage.set(lineageId, reference);
    }
  }

  const referenceIdMap = new Map();
  const changedReferenceLineages = new Set();
  const postChanges = [];
  const preparedRecords = [];

  for (const record of records) {
    if (record.modelName !== "Reference") {
      preparedRecords.push(record);
      continue;
    }

    const expected = record.expected;
    const current = currentReferenceByLineage.get(expected.lineageId);
    if (!current) {
      referenceIdMap.set(expected.id, expected);
      preparedRecords.push(record);
      continue;
    }

    if (current.importRunId && expected.importRunId && current.importRunId === expected.importRunId) {
      referenceIdMap.set(expected.id, current);
      continue;
    }

    if (current.contentHash && current.contentHash === expected.contentHash) {
      referenceIdMap.set(expected.id, current);
      const curationPatch = referenceCurationBackfillPatch(current, expected);
      if (curationPatch) {
        postChanges.push({
          modelName: "Reference",
          expected: curationPatch,
          current,
          action: "update",
        });
      }
      continue;
    }

    const versionNumber = Number(current.versionNumber ?? 1) + 1;
    const next = {
      ...expected,
      id: `${expected.lineageId}-v${versionNumber}`,
      versionNumber,
      previousVersionId: current.id,
      versionState: "current",
    };
    next.contentHash = expected.contentHash;
    referenceIdMap.set(expected.id, next);
    changedReferenceLineages.add(expected.lineageId);
    preparedRecords.push({ ...record, expected: next });
    postChanges.push({
      modelName: "Reference",
      expected: {
        id: current.id,
        versionState: "superseded",
        updatedAt: expected.updatedAt ?? expected.importedAt ?? new Date().toISOString(),
      },
      current,
      action: "update",
    });
  }

  const mappedRecords = preparedRecords.map((record) => {
    if (record.modelName === "SemanticRelation") {
      return { ...record, expected: remapSemanticRelationReferences(record.expected, referenceIdMap) };
    }
    if (record.modelName === "ReferenceAttachment") {
      return { ...record, expected: remapReferenceAttachment(record.expected, referenceIdMap) };
    }
    return record;
  });

  if (changedReferenceLineages.size) {
    const existingRelations = await client.listRecords("SemanticRelation");
    for (const relation of existingRelations) {
      if (
        relation.relationState === "current" &&
        changedReferenceLineages.has(relation.subjectLineageId)
      ) {
        postChanges.push({
          modelName: "SemanticRelation",
          expected: { id: relation.id, relationState: "superseded" },
          current: relation,
          action: "update",
        });
      }
    }
  }

  return { records: mappedRecords, postChanges };
}

function remapSemanticRelationReferences(relation, referenceIdMap) {
  let next = relation;
  const subject = referenceIdMap.get(relation.subjectId);
  if (subject) {
    next = {
      ...next,
      subjectId: subject.id,
      subjectVersionNumber: subject.versionNumber,
      subjectVersionKey: `${relation.subjectKind}#${subject.id}`,
    };
  }
  const object = referenceIdMap.get(relation.objectId);
  if (object) {
    next = {
      ...next,
      objectId: object.id,
      objectVersionNumber: object.versionNumber,
      objectVersionKey: `${relation.objectKind}#${object.id}`,
    };
  }
  if (next !== relation) {
    next = {
      ...next,
      id: `semantic-relation-${hashShort([
        next.subjectVersionKey,
        next.predicate,
        next.objectVersionKey,
        next.rank ?? "",
        next.classifierId ?? "",
        next.modelVersion ?? "",
      ])}`,
    };
  }
  return next;
}

function remapReferenceAttachment(attachment, referenceIdMap) {
  const reference = referenceIdMap.get(attachment.referenceId);
  if (!reference) return attachment;
  const referenceVersionKey = `reference#${reference.id}`;
  const next = {
    ...attachment,
    referenceId: reference.id,
    referenceLineageId: reference.lineageId,
    referenceVersionNumber: reference.versionNumber,
    referenceVersionKey,
  };
  return {
    ...next,
    id: `reference-attachment-${hashShort([
      referenceVersionKey,
      next.role,
      next.sortKey,
      next.storagePath ?? "",
      next.sourceUri ?? "",
    ])}`,
  };
}

function referenceCurationBackfillPatch(current, expected) {
  const status = current.curationStatus ?? expected.curationStatus ?? "accepted";
  const corpusId = current.corpusId ?? expected.corpusId;
  const patch = {
    id: current.id,
    curationStatus: status,
    curationStatusKey: current.curationStatusKey ?? (corpusId ? `${corpusId}#${status}` : null),
    curationStatusUpdatedAt: current.curationStatusUpdatedAt ?? expected.curationStatusUpdatedAt ?? expected.updatedAt ?? new Date().toISOString(),
    curationStatusUpdatedBy: current.curationStatusUpdatedBy ?? expected.curationStatusUpdatedBy ?? "biblicus-import",
    curationStatusReason: current.curationStatusReason ?? expected.curationStatusReason ?? null,
    updatedAt: expected.updatedAt ?? current.updatedAt ?? new Date().toISOString(),
  };
  if (
    current.curationStatus === patch.curationStatus &&
    current.curationStatusKey === patch.curationStatusKey &&
    current.curationStatusUpdatedAt === patch.curationStatusUpdatedAt &&
    current.curationStatusUpdatedBy === patch.curationStatusUpdatedBy &&
    current.curationStatusReason === patch.curationStatusReason
  ) {
    return null;
  }
  return patch;
}

function legacyKnowledgeCommentRecords(comment) {
  if (!comment || typeof comment !== "object") return [];
  const createdAt = comment.createdAt ?? new Date().toISOString();
  const messageKind = comment.commentKind ?? "comment";
  const messageId = `message-legacy-${hashShort([comment.id, messageKind, createdAt])}`;
  const body = comment.body ?? "";
  const message = {
    id: messageId,
    messageKind,
    messageDomain: "commentary",
    status: comment.status ?? "active",
    body,
    summary: body.length > 140 ? `${body.slice(0, 137)}...` : body,
    source: comment.source ?? "legacy-knowledge-comment",
    importRunId: comment.importRunId ?? null,
    authorSub: comment.authorSub ?? null,
    authorUserProfileId: comment.authorUserProfileId ?? null,
    authorLabel: comment.authorLabel ?? null,
    createdAt,
    updatedAt: createdAt,
    metadata: JSON.stringify({
      legacyModel: "KnowledgeComment",
      legacyId: comment.id,
      ...(parseAwsJson(comment.metadata) && typeof parseAwsJson(comment.metadata) === "object" ? parseAwsJson(comment.metadata) : {}),
    }),
  };
  const targetKind = comment.subjectKind;
  const targetId = comment.subjectId;
  const targetLineageId = comment.subjectLineageId;
  if (!targetKind || !targetId || !targetLineageId) return [{ modelName: "Message", expected: message }];
  const relationType = semanticRelationTypeFieldsForPredicate("comment");
  const subjectVersionKey = semanticVersionKey("message", messageId);
  const objectVersionKey = semanticVersionKey(targetKind, targetId);
  const objectStateKey = semanticStateKey(targetKind, targetLineageId);
  return [
    { modelName: "Message", expected: message },
    {
      modelName: "SemanticRelation",
      expected: {
        id: `semantic-relation-${hashShort([subjectVersionKey, "comment", objectVersionKey, comment.id])}`,
        relationState: "current",
        predicate: "comment",
        ...relationType,
        subjectKind: "message",
        subjectId: messageId,
        subjectLineageId: messageId,
        subjectVersionNumber: 1,
        objectKind: targetKind,
        objectId: targetId,
        objectLineageId: targetLineageId,
        objectVersionNumber: comment.subjectVersionNumber ?? null,
        subjectStateKey: semanticStateKey("message", messageId),
        objectStateKey,
        objectSubjectStateKey: `${objectStateKey}#message`,
        predicateObjectStateKey: `comment#${objectStateKey}`,
        subjectVersionKey,
        objectVersionKey,
        score: 1,
        confidence: null,
        rank: 1,
        classifierId: null,
        modelVersion: null,
        reviewRecommended: false,
        sourceSnapshotId: null,
        importRunId: comment.importRunId ?? null,
        importedAt: createdAt,
        metadata: JSON.stringify({
          legacyModel: "KnowledgeComment",
          legacyId: comment.id,
          messageKind,
        }),
      },
    },
  ];
}

async function buildSteeringConfigRecordChanges(client, records) {
  const changes = [];
  for (const record of records) {
    const current = await client.getRecord(record.modelName, record.expected.id);
    if (!current) {
      changes.push({ ...record, current, action: "create" });
      continue;
    }
    const action = current.name === record.expected.name && current.role === record.expected.role ? "noop" : "update";
    changes.push({
      modelName: record.modelName,
      expected: action === "update"
        ? {
            id: record.expected.id,
            name: record.expected.name,
            role: record.expected.role,
            updatedAt: record.expected.updatedAt,
          }
        : record.expected,
      current,
      action,
    });
  }
  return changes;
}

async function syncSingleArticle(client, slug) {
  const editionConfig = loadEditionConfig();
  const article = getMarkdownArticle(slug);
  if (!article) {
    throw new Error(`Could not find local Markdown article ${slug}.`);
  }

  const diff = await buildArticleDiff(client, article, editionConfig, editionConfig.articleOrder.indexOf(article.slug));
  await applyRecordChanges(client, diff.records);
  return diff;
}

async function syncEdition(client, editionSlug) {
  const diff = await diffEdition(client, editionSlug);
  await applyRecordChanges(client, diff.records);
  return diff;
}

async function diffEdition(client, editionSlug) {
  const editionConfig = loadEditionConfig();
  if (editionSlug !== editionConfig.slug) {
    throw new Error(`Local editorial config only defines edition ${editionConfig.slug}.`);
  }

  const articles = loadMarkdownArticles();
  const records = [];
  records.push(...await buildEditionRecordChanges(client, editionConfig));

  for (const [index, article] of articles.entries()) {
    const articleChanges = await buildArticleDiff(client, article, editionConfig, index);
    records.push(...articleChanges.records);
  }

  return { editionSlug, records };
}

async function buildArticleDiff(client, article, editionConfig, index) {
  const records = [];
  const itemLineageId = `item-${article.slug}`;
  const itemId = `${itemLineageId}-v1`;
  const publishedItemId = `published-${itemLineageId}`;
  const sectionSlug = slugify(article.section);
  const tagId = `tag-${sectionSlug}`;
  const articleOrderIndex = index + 1;

  const itemRecord = withVersionFields({
    id: itemId,
    lineageId: itemLineageId,
    type: "article",
    status: "published",
    typeStatus: "article#published",
    slug: article.slug,
    shortSlug: article.shortSlug ?? null,
    section: article.section,
    sectionStatus: `${sectionSlug}#published`,
    title: article.headline,
    headline: article.headline,
    deck: article.deck,
    body: article.body,
    byline: article.byline,
    dateline: article.dateline,
    publishedAt: editionConfig.publishedAt,
    editionDate: editionConfig.publishDate,
    sortTitle: article.headline,
    pullQuotes: article.pullQuotes ?? [],
    layout: toAwsJson({ source: "markdown" }),
    editorial: toAwsJson({}),
    updatedAt: editionConfig.publishedAt,
  }, { now: editionConfig.publishedAt, actor: "papyrus-content-cli", reason: "markdown-sync" });
  records.push(await buildRecordChange(client, "Item", itemRecord));
  records.push(await buildRecordChange(client, "PublishedItem", {
    id: publishedItemId,
    sourceItemId: itemId,
    itemLineageId,
    versionNumber: itemRecord.versionNumber,
    type: itemRecord.type,
    status: itemRecord.status,
    typeStatus: itemRecord.typeStatus,
    slug: itemRecord.slug,
    shortSlug: itemRecord.shortSlug,
    section: itemRecord.section,
    sectionStatus: itemRecord.sectionStatus,
    title: itemRecord.title,
    headline: itemRecord.headline,
    deck: itemRecord.deck,
    body: itemRecord.body,
    byline: itemRecord.byline,
    dateline: itemRecord.dateline,
    publishedAt: itemRecord.publishedAt,
    editionDate: itemRecord.editionDate,
    sortTitle: itemRecord.sortTitle,
    pullQuotes: itemRecord.pullQuotes,
    layout: itemRecord.layout,
    editorial: itemRecord.editorial,
  }));

  const tagRecord = {
    id: tagId,
    slug: sectionSlug,
    label: article.section,
    type: "section",
  };
  records.push(await buildRecordChange(client, "Tag", tagRecord));

  const itemTagRecord = {
      id: `item-tag-${article.slug}-${sectionSlug}-v1`,
      itemId,
    tagId,
    itemType: "article",
    itemStatus: "published",
    tagSlug: sectionSlug,
    publishedAt: editionConfig.publishedAt,
  };
  records.push(await buildRecordChange(client, "ItemTag", itemTagRecord));

  for (const [assetIndex, asset] of getArticleImageAssets(article).entries()) {
    if (!/^https?:\/\//.test(asset.src)) {
      throw new Error(`Media asset ${asset.id} for ${article.slug} must use an external URL for JWT CLI sync.`);
    }

    const mediaRecord = {
      id: `media-${article.slug}-${assetIndex}-v1`,
      itemId,
      type: "image",
      role: (asset.roles ?? ["lead", "continuation", "continuationInset"]).join(","),
      sortKey: `${String(assetIndex + 1).padStart(3, "0")}#${asset.id}`,
      storagePath: null,
      externalUrl: asset.src,
      alt: asset.alt,
      caption: asset.credit,
      credit: asset.credit,
      width: asset.layout ? Math.round(asset.layout.aspectRatio * asset.layout.preferredHeight) : null,
      height: asset.layout?.preferredHeight ?? null,
      aspectRatio: asset.layout?.aspectRatio ?? null,
      focalX: asset.layout?.focalPoint?.x ?? null,
      focalY: asset.layout?.focalPoint?.y ?? null,
      minHeight: asset.layout?.minHeight ?? null,
      preferredHeight: asset.layout?.preferredHeight ?? null,
      maxHeight: asset.layout?.maxHeight ?? null,
      crop: asset.layout?.crop ?? null,
      wrapsText: asset.layout?.wrapsText ?? null,
      metadata: toAwsJson({ sourceUrl: asset.src }),
    };
    records.push(await buildRecordChange(client, "MediaAsset", mediaRecord));
    records.push(await buildRecordChange(client, "PublishedMediaAsset", {
      id: `published-media-${article.slug}-${assetIndex}`,
      sourceMediaAssetId: mediaRecord.id,
      publishedItemId,
      sourceItemId: itemId,
      itemLineageId,
      type: mediaRecord.type,
      role: mediaRecord.role,
      sortKey: mediaRecord.sortKey,
      storagePath: mediaRecord.storagePath,
      externalUrl: mediaRecord.externalUrl,
      alt: mediaRecord.alt,
      caption: mediaRecord.caption,
      credit: mediaRecord.credit,
      width: mediaRecord.width,
      height: mediaRecord.height,
      aspectRatio: mediaRecord.aspectRatio,
      focalX: mediaRecord.focalX,
      focalY: mediaRecord.focalY,
      minHeight: mediaRecord.minHeight,
      preferredHeight: mediaRecord.preferredHeight,
      maxHeight: mediaRecord.maxHeight,
      crop: mediaRecord.crop,
      wrapsText: mediaRecord.wrapsText,
      metadata: mediaRecord.metadata,
    }));
  }

  if (editionConfig.articleOrder.includes(article.slug)) {
    const editionLineageId = editionConfig.id;
    const editionId = `${editionLineageId}-v1`;
    const editionItemRecord = {
      id: `${editionId}-${article.slug}`,
      editionId,
      editionLineageId,
      itemId,
      itemLineageId,
      placementKey: `front:${articleOrderIndex}`,
      sortKey: `${String(articleOrderIndex).padStart(3, "0")}#${article.slug}`,
      pageNumber: 1,
      priority: articleOrderIndex,
      metadata: toAwsJson({}),
    };
    records.push(await buildRecordChange(client, "EditionItem", editionItemRecord));
    records.push(await buildRecordChange(client, "PublishedEditionItem", {
      id: `published-${editionItemRecord.id}`,
      publishedEditionId: `published-${editionLineageId}`,
      publishedItemId,
      sourceEditionItemId: editionItemRecord.id,
      sourceEditionId: editionId,
      sourceItemId: itemId,
      editionLineageId,
      itemLineageId,
      placementKey: editionItemRecord.placementKey,
      sortKey: editionItemRecord.sortKey,
      pageNumber: editionItemRecord.pageNumber,
      priority: editionItemRecord.priority,
      metadata: editionItemRecord.metadata,
    }));
  }

  return { articleSlug: article.slug, records };
}

async function buildEditionRecordChanges(client, editionConfig) {
  const editionLineageId = editionConfig.id;
  const editionId = `${editionLineageId}-v1`;
  const editionRecord = withVersionFields({
    id: editionId,
    lineageId: editionLineageId,
    slug: editionConfig.slug,
    title: editionConfig.title,
    status: "published",
    editionDate: editionConfig.publishDate,
    publishedAt: editionConfig.publishedAt || `${editionConfig.publishDate}T12:00:00.000Z`,
    description: editionConfig.description,
    layoutPlan: toAwsJson(editionConfig.layoutPlan),
    metadata: toAwsJson({ source: "markdown-sync" }),
  }, { now: editionConfig.publishedAt || `${editionConfig.publishDate}T12:00:00.000Z`, actor: "papyrus-content-cli", reason: "markdown-sync" });
  return [
    await buildRecordChange(client, "Edition", editionRecord),
    await buildRecordChange(client, "PublishedEdition", {
      id: `published-${editionLineageId}`,
      sourceEditionId: editionId,
      editionLineageId,
      versionNumber: editionRecord.versionNumber,
      slug: editionRecord.slug,
      title: editionRecord.title,
      status: editionRecord.status,
      editionDate: editionRecord.editionDate,
      publishedAt: editionRecord.publishedAt,
      description: editionRecord.description,
      layoutPlan: editionRecord.layoutPlan,
      metadata: editionRecord.metadata,
    }),
  ];
}

async function buildRecordChange(client, modelName, expected) {
  const current = await client.getRecord(modelName, expected.id);
  return buildRecordChangeFromCurrent(modelName, expected, current);
}

const APPEND_ONLY_EXISTING_NOOP_MODELS = new Set([
  "Assignment",
  "AssignmentEvent",
  "Message",
  "SteeringDecision",
]);

function buildRecordChangeFromCurrent(modelName, expected, current) {
  if (current && APPEND_ONLY_EXISTING_NOOP_MODELS.has(modelName)) {
    return { modelName, expected: current, current, action: "noop" };
  }
  const nextExpected = modelName === "SteeringProposal" ? mergeReviewedProposalState(expected, current) : expected;
  const action = !current ? "create" : recordsEqualForModel(modelName, current, nextExpected) ? "noop" : "update";
  return { modelName, expected: nextExpected, current, action };
}

function isMissingGraphQLModelError(error, modelName) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const listField = `list${modelName}s`;
  const getField = `get${modelName}`;
  return message.includes("FieldUndefined")
    && (message.includes(listField) || message.includes(getField) || message.includes(modelName));
}

function isDynamoResourceNotFoundError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Requested resource not found") || message.includes("ResourceNotFoundException");
}

async function applyRecordChanges(client, records) {
  const actionable = records.filter((record) => record.action !== "noop");
  const concurrency = applyConcurrency();
  console.error(`apply\tchanges\t${actionable.length}`);
  if (concurrency > 1) console.error(`apply\tconcurrency\t${concurrency}`);
  let applied = 0;
  let nextIndex = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < actionable.length) {
      const record = actionable[nextIndex];
      nextIndex += 1;
      try {
        await client.upsert(record.modelName, record.expected);
      } catch (error) {
        const failure = normalizeError(error);
        throw new Error(`Failed to apply ${record.action} ${record.modelName} ${record.expected?.id ?? "<missing-id>"}: ${failure.message}`);
      }
      applied += 1;
      if (applied === actionable.length || applied % 100 === 0) {
        console.error(`apply\tprogress\t${applied}/${actionable.length}`);
      }
    }
  });
  await Promise.all(workers);
}

function applyConcurrency() {
  const raw = process.env.PAPYRUS_APPLY_CONCURRENCY;
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("PAPYRUS_APPLY_CONCURRENCY must be a positive integer.");
  }
  return Math.min(parsed, 16);
}

function printDiffSummary(result) {
  console.log(`Edition: ${result.editionSlug}`);
  for (const record of result.records) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
  }
}

function printSyncSummary(result) {
  for (const record of result.records) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
  }
}

function printDeleteSummary(result) {
  for (const record of result) {
    console.log(`delete\t${record.modelName}\t${record.deleted}`);
  }
}

function printCategoryImportSummary(kind, importRunId, changes) {
  console.log(`Import: ${kind}`);
  console.log(`Run: ${importRunId}`);
  const counts = changes.reduce((memo, record) => {
    memo[record.action] = (memo[record.action] ?? 0) + 1;
    return memo;
  }, {});
  console.log(`Summary: create=${counts.create ?? 0} update=${counts.update ?? 0} noop=${counts.noop ?? 0}`);
  for (const record of changes.filter((entry) => entry.action !== "noop")) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
  }
}

function printReferenceRegistrationSummary(plan, changes, { apply }) {
  console.log("Reference registration:");
  console.log(`Batch: ${plan.batchId}`);
  console.log(`Import run: ${plan.importRunId}`);
  console.log(`Corpus: ${plan.corpusId}`);
  console.log(`Status: ${plan.status}`);
  if (plan.reasonCode) console.log(`Reason: ${plan.reasonCode}`);
  console.log(`Items: ${plan.itemCount}`);
  const modelCounts = changes.reduce((memo, record) => {
    memo[record.modelName] = (memo[record.modelName] ?? 0) + 1;
    return memo;
  }, {});
  console.log(`Models: ${Object.entries(modelCounts).sort(([left], [right]) => left.localeCompare(right)).map(([modelName, count]) => `${modelName}=${count}`).join(" ")}`);
  const counts = changes.reduce((memo, record) => {
    memo[record.action] = (memo[record.action] ?? 0) + 1;
    return memo;
  }, {});
  console.log(`Summary: create=${counts.create ?? 0} update=${counts.update ?? 0} noop=${counts.noop ?? 0}`);
  console.log(`Apply: ${apply ? "yes" : "no"}`);
  for (const record of changes.filter((entry) => entry.action !== "noop")) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
  }
}

function assertReferenceCatalogPlanSafety(plan) {
  const allowedModels = new Set(["KnowledgeCorpus", "KnowledgeImportRun", "KnowledgeRawPayload", "Reference", "ReferenceAttachment", "Message", "Assignment", "SemanticRelation"]);
  const unsafeModels = Array.from(new Set(plan.records.map((record) => record.modelName).filter((modelName) => !allowedModels.has(modelName))));
  if (unsafeModels.length) throw new Error(`references register-catalog produced unsupported models: ${unsafeModels.join(", ")}.`);
  const unsafePredicates = plan.records
    .filter((record) => record.modelName === "SemanticRelation")
    .map((record) => record.expected?.relationTypeKey ?? record.expected?.predicate)
    .filter((predicate) => predicate === "classified_as" || predicate === "uses_evidence");
  if (unsafePredicates.length) throw new Error(`references register-catalog cannot create evidence or classification relations: ${unsafePredicates.join(", ")}.`);
}

async function updateNewsroomSummaryAfterReferenceRegistration(client, changes, plan) {
  const created = changes.filter((record) => record.action === "create").map((record) => record.expected);
  const createdByModel = new Map();
  for (const record of changes.filter((entry) => entry.action === "create")) {
    if (!createdByModel.has(record.modelName)) createdByModel.set(record.modelName, []);
    createdByModel.get(record.modelName).push(record.expected);
  }
  const latestImportRun = createdByModel.get("KnowledgeImportRun")?.[0] ?? plan.records.find((record) => record.modelName === "KnowledgeImportRun")?.expected ?? null;
  const createdAssignments = createdByModel.get("Assignment") ?? [];
  const createdMessages = createdByModel.get("Message") ?? [];
  const createdSemanticRelations = createdByModel.get("SemanticRelation") ?? [];
  const createdImportRuns = createdByModel.get("KnowledgeImportRun") ?? [];
  const referenceDelta = computeCurrentReferenceDeltaFromChanges(changes);
  const delta = {
    source: "incremental",
    latestImportRun,
    countDeltas: {
      corpora: createdByModel.get("KnowledgeCorpus")?.length ?? 0,
      importRuns: createdByModel.get("KnowledgeImportRun")?.length ?? 0,
      referenceAttachments: createdByModel.get("ReferenceAttachment")?.length ?? 0,
      references: referenceDelta.countDelta,
      messages: createdByModel.get("Message")?.length ?? 0,
      assignments: createdByModel.get("Assignment")?.length ?? 0,
      semanticRelations: createdByModel.get("SemanticRelation")?.length ?? 0,
    },
    referenceStatusDeltas: referenceDelta.statusDeltas,
    assignmentStatusDeltas: countDelta(createdAssignments, "status", "unknown"),
    assignmentTypeDeltas: countDelta(createdAssignments, "assignmentTypeKey", "unknown"),
    messageKindDeltas: countDelta(createdMessages, "messageKind", "unknown"),
    messageDomainDeltas: countDelta(createdMessages, "messageDomain", "unknown"),
    facetDeltas: {
      assignments: {
        byStatus: countDelta(createdAssignments, "status", "unknown"),
        byType: countDelta(createdAssignments, "assignmentTypeKey", "unknown"),
        statusByType: nestedCountDelta(createdAssignments, "assignmentTypeKey", "status", "unknown", "unknown"),
      },
      messages: {
        byKind: countDelta(createdMessages, "messageKind", "unknown"),
        byDomain: countDelta(createdMessages, "messageDomain", "unknown"),
        byStatus: countDelta(createdMessages, "status", "unknown"),
        domainByKind: nestedCountDelta(createdMessages, "messageKind", "messageDomain", "unknown", "unknown"),
      },
      references: {
        byCurationStatus: referenceDelta.statusDeltas,
        byCorpus: referenceDelta.corpusDeltas,
        statusByCorpus: referenceDelta.statusByCorpusDeltas,
      },
      semanticRelations: {
        byRelationTypeKey: countDelta(createdSemanticRelations, "relationTypeKey", "unknown"),
        byRelationDomain: countDelta(createdSemanticRelations, "relationDomain", "unknown"),
        bySubjectKind: countDelta(createdSemanticRelations, "subjectKind", "unknown"),
        byObjectKind: countDelta(createdSemanticRelations, "objectKind", "unknown"),
      },
      imports: {
        byCorpus: countDelta(createdImportRuns, "corpusId", "unknown"),
      },
    },
  };
  await client.updateNewsroomSummary(delta, {
    actorLabel: "Papyrus content CLI",
    reason: `references register-catalog ${plan.importRunId}`,
  });
  console.log(`newsroom\tsummary-snapshot\tincremental\t${created.length} created records`);
}

async function updateNewsroomSummaryAfterAssignmentCreates(client, changes, { actorLabel = "Papyrus content CLI", reason = "assignment create" } = {}) {
  const createdByModel = new Map();
  for (const record of changes.filter((entry) => entry.action === "create")) {
    if (!createdByModel.has(record.modelName)) createdByModel.set(record.modelName, []);
    createdByModel.get(record.modelName).push(record.expected);
  }
  const createdAssignments = createdByModel.get("Assignment") ?? [];
  const createdEvents = createdByModel.get("AssignmentEvent") ?? [];
  const createdRelations = createdByModel.get("SemanticRelation") ?? [];
  if (!createdAssignments.length && !createdEvents.length && !createdRelations.length) return;
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      assignments: createdAssignments.length,
      assignmentEvents: createdEvents.length,
      semanticRelations: createdRelations.length,
    },
    assignmentStatusDeltas: countDelta(createdAssignments, "status", "unknown"),
    assignmentTypeDeltas: countDelta(createdAssignments, "assignmentTypeKey", "unknown"),
    facetDeltas: {
      assignments: {
        byType: countDelta(createdAssignments, "assignmentTypeKey", "unknown"),
        statusByType: nestedCountDelta(createdAssignments, "assignmentTypeKey", "status", "unknown", "unknown"),
      },
      semanticRelations: {
        byRelationTypeKey: countDelta(createdRelations, "relationTypeKey", "unknown"),
        byRelationDomain: countDelta(createdRelations, "relationDomain", "unknown"),
        bySubjectKind: countDelta(createdRelations, "subjectKind", "unknown"),
        byObjectKind: countDelta(createdRelations, "objectKind", "unknown"),
      },
    },
  }, {
    actorLabel,
    reason,
  });
  console.log(`newsroom\tsummary-snapshot\tincremental\tassignments=${createdAssignments.length}\tevents=${createdEvents.length}\trelations=${createdRelations.length}`);
}

async function updateNewsroomSummaryAfterAnalysisImport(client, changes, { actorLabel = "Papyrus content CLI", reason = "analysis import" } = {}) {
  const createdByModel = new Map();
  for (const record of changes.filter((entry) => entry.action === "create")) {
    if (!createdByModel.has(record.modelName)) createdByModel.set(record.modelName, []);
    createdByModel.get(record.modelName).push(record.expected);
  }
  const createdImportRuns = createdByModel.get("KnowledgeImportRun") ?? [];
  const createdCategorySets = createdByModel.get("CategorySet") ?? [];
  const createdCategories = createdByModel.get("Category") ?? [];
  const createdProposals = createdByModel.get("SteeringProposal") ?? [];
  const createdNodes = createdByModel.get("SemanticNode") ?? [];
  const createdRelations = createdByModel.get("SemanticRelation") ?? [];
  if (!createdImportRuns.length
    && !createdCategorySets.length
    && !createdCategories.length
    && !createdProposals.length
    && !createdNodes.length
    && !createdRelations.length) {
    return;
  }
  await client.updateNewsroomSummary({
    source: "incremental",
    latestImportRun: createdImportRuns[0] ?? null,
    countDeltas: {
      importRuns: createdImportRuns.length,
      categorySets: createdCategorySets.length,
      categories: createdCategories.length,
      proposals: createdProposals.length,
      openProposals: createdProposals.filter((proposal) => proposal.status === "proposed").length,
      semanticNodes: createdNodes.length,
      semanticRelations: createdRelations.length,
    },
    facetDeltas: {
      imports: {
        byCorpus: countDelta(createdImportRuns, "corpusId", "unknown"),
      },
      semanticNodes: {
        byNodeKind: countDelta(createdNodes, "nodeKind", "unknown"),
        byStatus: countDelta(createdNodes, "status", "unknown"),
        byCorpus: countDelta(createdNodes, "corpusId", "unknown"),
        byCategorySet: countDelta(createdNodes, "categorySetId", "unknown"),
      },
      semanticRelations: {
        byRelationTypeKey: countDelta(createdRelations, "relationTypeKey", "unknown"),
        byRelationDomain: countDelta(createdRelations, "relationDomain", "unknown"),
        bySubjectKind: countDelta(createdRelations, "subjectKind", "unknown"),
        byObjectKind: countDelta(createdRelations, "objectKind", "unknown"),
      },
    },
  }, {
    actorLabel,
    reason,
  });
  console.log(`newsroom\tsummary-snapshot\tincremental\tanalysis-import\truns=${createdImportRuns.length}\tnodes=${createdNodes.length}\trelations=${createdRelations.length}`);
}

function countDelta(items, key, defaultValue) {
  const counts = {};
  for (const item of items) {
    const value = typeof item?.[key] === "string" && item[key].trim() ? item[key].trim() : defaultValue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function nestedCountDelta(items, outerKey, innerKey, outerDefaultValue, innerDefaultValue) {
  const counts = {};
  for (const item of items) {
    const outer = typeof item?.[outerKey] === "string" && item[outerKey].trim() ? item[outerKey].trim() : outerDefaultValue;
    const inner = typeof item?.[innerKey] === "string" && item[innerKey].trim() ? item[innerKey].trim() : innerDefaultValue;
    if (!counts[outer]) counts[outer] = {};
    counts[outer][inner] = (counts[outer][inner] ?? 0) + 1;
  }
  return counts;
}

function buildReferenceAnalysisManifest({ corpusConfig, corpusId, references, attachments }) {
  const acceptedReferences = references
    .filter((reference) => reference.corpusId === corpusId)
    .filter(isCurrentAcceptedReference)
    .sort(compareReferencesForExport);
  return {
    schema_version: 1,
    export_kind: "papyrus-reference-analysis-manifest",
    generated_at: new Date().toISOString(),
    corpus: referenceCorpusExport(corpusConfig, corpusId),
    counts: {
      accepted_references: acceptedReferences.length,
    },
    items: acceptedReferences.map((reference) => referenceManifestItem(reference, attachments)),
  };
}

function buildReferenceScopeTrainingExport({ corpusConfig, corpusId, references, attachments, messages, relations }) {
  const commentsByReferenceLineage = referenceCurationMessagesByReferenceLineage(messages, relations);
  const trainingItems = references
    .filter((reference) => reference.corpusId === corpusId)
    .filter((reference) => reference.versionState === "current")
    .map((reference) => {
      const curationMessages = commentsByReferenceLineage.get(reference.lineageId) ?? [];
      const label = scopeTrainingLabelForReference(reference, curationMessages);
      if (!label) return null;
      const item = referenceManifestItem(reference, attachments);
      return {
        ...item,
        scope_training_label: label === "positive" ? "in_scope" : "out_of_scope",
        curation_status: reference.curationStatus ?? "pending",
        reason_code: latestReferenceReasonCode(reference, curationMessages),
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(left.item_id).localeCompare(String(right.item_id)));
  return {
    schema_version: 1,
    export_kind: "papyrus-reference-scope-training",
    generated_at: new Date().toISOString(),
    corpus: referenceCorpusExport(corpusConfig, corpusId),
    counts: {
      positive: trainingItems.filter((item) => item.scope_training_label === "in_scope").length,
      negative: trainingItems.filter((item) => item.scope_training_label === "out_of_scope").length,
    },
    items: trainingItems,
  };
}

function referenceCorpusExport(corpusConfig, corpusId) {
  return {
    key: corpusConfig.key,
    id: corpusId,
    name: corpusConfig.name,
    role: corpusConfig.role,
    path: corpusConfig.path,
    s3Prefix: corpusConfig.s3Prefix,
  };
}

function referenceManifestItem(reference, attachments) {
  const referenceAttachments = attachments
    .filter((attachment) => attachment.referenceLineageId === reference.lineageId)
    .sort((left, right) => String(left.sortKey ?? "").localeCompare(String(right.sortKey ?? "")));
  return {
    item_id: reference.externalItemId,
    reference_id: reference.id,
    reference_lineage_id: reference.lineageId,
    title: reference.title ?? null,
    authors: reference.authors ?? [],
    source_uri: reference.sourceUri ?? null,
    storage_path: reference.storagePath ?? null,
    media_type: reference.mediaType ?? null,
    byte_size: reference.byteSize ?? null,
    sha256: reference.sha256 ?? null,
    source_published_at: reference.sourcePublishedAt ?? null,
    source_updated_at: reference.sourceUpdatedAt ?? null,
    retrieved_at: reference.retrievedAt ?? null,
    attachments: referenceAttachments.map((attachment) => ({
      role: attachment.role,
      sort_key: attachment.sortKey,
      storage_path: attachment.storagePath ?? null,
      source_uri: attachment.sourceUri ?? null,
      filename: attachment.filename ?? null,
      media_type: attachment.mediaType ?? null,
      byte_size: attachment.byteSize ?? null,
      sha256: attachment.sha256 ?? null,
    })),
  };
}

function filterProjectionPayloadForAcceptedReferences(payload, references, targetCorpusId) {
  const acceptedItemIds = new Set(
    references
      .filter((reference) => reference.corpusId === targetCorpusId)
      .filter(isCurrentAcceptedReference)
      .map((reference) => reference.externalItemId)
      .filter(Boolean)
  );
  const items = Array.isArray(payload.items) ? payload.items : [];
  const acceptedItems = items.filter((item) => acceptedItemIds.has(item?.item_id));
  const skippedForCuration = items
    .filter((item) => !acceptedItemIds.has(item?.item_id))
    .map((item) => ({
      item_id: item?.item_id ?? null,
      title: item?.title ?? null,
      reason: "reference_not_accepted",
    }));
  const skippedItems = [
    ...(Array.isArray(payload.skipped_items) ? payload.skipped_items : []),
    ...skippedForCuration,
  ];
  return {
    ...payload,
    items: acceptedItems,
    skipped_items: skippedItems,
    summary: {
      ...(payload.summary && typeof payload.summary === "object" ? payload.summary : {}),
      projected_items: acceptedItems.length,
      skipped_items: skippedItems.length,
      skipped_for_curation: skippedForCuration.length,
    },
  };
}

function referenceCurationMessagesByReferenceLineage(messages, relations) {
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const commentsByReferenceLineage = new Map();
  for (const relation of relations) {
    if (relation.relationState !== "current") continue;
    if ((relation.relationTypeKey ?? relation.predicate) !== "comment") continue;
    if (relation.subjectKind !== "message" || relation.objectKind !== "reference") continue;
    const message = messageById.get(relation.subjectId);
    if (!message) continue;
    const metadata = parseJsonish(message.metadata);
    if (metadata.messageKind && metadata.messageKind !== "reference_curation") continue;
    if (message.messageKind && message.messageKind !== "reference_curation") continue;
    const entries = commentsByReferenceLineage.get(relation.objectLineageId) ?? [];
    entries.push(message);
    commentsByReferenceLineage.set(relation.objectLineageId, entries);
  }
  return commentsByReferenceLineage;
}

function isCurrentAcceptedReference(reference) {
  return reference.versionState === "current" && normalizeReferenceCurationStatus(reference.curationStatus, "pending") === "accepted";
}

function requireDraftCategorySet(categorySet, label) {
  if (!categorySet) throw new Error(`CategorySet ${label} was not found.`);
  if (categorySet.versionState !== "draft" || categorySet.status !== "draft") {
    throw new Error(`CategorySet ${categorySet.id} is ${categorySet.versionState}/${categorySet.status}; this operation requires a draft CategorySet.`);
  }
}

function compareCategoriesForDraft(left, right) {
  const depthDiff = (Number(left.depth) || 0) - (Number(right.depth) || 0);
  if (depthDiff !== 0) return depthDiff;
  const rankDiff = (Number(left.rank) || 999999) - (Number(right.rank) || 999999);
  if (rankDiff !== 0) return rankDiff;
  return String(left.categoryKey ?? left.id).localeCompare(String(right.categoryKey ?? right.id));
}

function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === "string") {
    const parsed = parseJsonish(value);
    if (Array.isArray(parsed)) return normalizeStringList(parsed);
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveCategoryInSet(categories, token, { label = "--category" } = {}) {
  const matches = categories.filter((category) => (
    category.id === token
    || category.lineageId === token
    || category.categoryKey === token
  ));
  if (!matches.length) throw new Error(`${label} ${token} did not match a category in the selected CategorySet.`);
  if (matches.length > 1) {
    const active = matches.find((category) => category.versionState === "draft")
      ?? matches.find((category) => category.versionState === "current")
      ?? matches[0];
    return active;
  }
  return matches[0];
}

function resolveCategoryAny(categories, token) {
  const matches = categories.filter((category) => (
    category.id === token
    || category.lineageId === token
    || category.categoryKey === token
  ));
  if (!matches.length) throw new Error(`Category ${token} was not found.`);
  return matches.find((category) => category.versionState === "draft")
    ?? matches.find((category) => category.versionState === "current")
    ?? matches[0];
}

function resolveReferenceAny(references, token) {
  const matches = references.filter((reference) => (
    reference.id === token
    || reference.lineageId === token
    || reference.externalItemId === token
  ));
  if (!matches.length) throw new Error(`Reference ${token} was not found.`);
  return matches.find(isCurrentAcceptedReference)
    ?? matches.find((reference) => reference.versionState === "current")
    ?? matches[0];
}

function resolveReferenceForLabel(references, token) {
  const reference = resolveReferenceAny(references, token);
  if (!isCurrentAcceptedReference(reference)) {
    throw new Error(`Reference ${token} is ${reference.versionState}/${reference.curationStatus}; authoritative labels require a current accepted Reference.`);
  }
  return reference;
}

function bestCategoryByLineage(categories) {
  const result = new Map();
  const score = (category) => {
    if (category.versionState === "draft") return 3;
    if (category.versionState === "current") return 2;
    return 1;
  };
  for (const category of categories) {
    const lineageId = category.lineageId ?? category.id;
    const existing = result.get(lineageId);
    if (!existing || score(category) > score(existing)) result.set(lineageId, category);
  }
  return result;
}

function buildManualAuthoritativeLabelRelation({ reference, category, categorySet, note, actor }) {
  const subjectStateKey = semanticStateKey("reference", reference.lineageId ?? reference.id);
  const objectStateKey = semanticStateKey("category", category.lineageId ?? category.id);
  const subjectVersionKey = semanticVersionKey("reference", reference.id);
  const objectVersionKey = semanticVersionKey("category", category.id);
  return {
    id: `semantic-relation-${hashShort([subjectStateKey, "authoritative_label", objectStateKey])}`,
    relationState: "current",
    predicate: "authoritative_label",
    ...semanticRelationTypeFieldsForPredicate("authoritative_label"),
    subjectKind: "reference",
    subjectId: reference.id,
    subjectLineageId: reference.lineageId ?? reference.id,
    subjectVersionNumber: reference.versionNumber ?? null,
    objectKind: "category",
    objectId: category.id,
    objectLineageId: category.lineageId ?? category.id,
    objectVersionNumber: category.versionNumber ?? null,
    subjectStateKey,
    objectStateKey,
    objectSubjectStateKey: `${objectStateKey}#reference`,
    predicateObjectStateKey: `authoritative_label#${objectStateKey}`,
    subjectVersionKey,
    objectVersionKey,
    score: 1,
    confidence: null,
    rank: 1,
    classifierId: categorySet.classifierId ?? null,
    modelVersion: null,
    reviewRecommended: false,
    sourceSnapshotId: null,
    importRunId: null,
    importedAt: new Date().toISOString(),
    metadata: JSON.stringify({
      kind: "classification.authoritative_label.manual",
      note,
      actor,
      categorySetId: categorySet.id,
    }),
  };
}

function findCurrentAuthoritativeLabel(relations, relation) {
  return relations
    .filter((entry) => entry.relationState === "current")
    .filter((entry) => (entry.relationTypeKey ?? entry.predicate) === "authoritative_label")
    .find((entry) => (
      entry.subjectStateKey === relation.subjectStateKey
      && entry.objectStateKey === relation.objectStateKey
    ));
}

function semanticRelationCountDelta(relation, amount) {
  return {
    countDeltas: {
      semanticRelations: amount,
    },
    facetDeltas: {
      semanticRelations: {
        byRelationTypeKey: { [relation.relationTypeKey ?? relation.predicate ?? "unknown"]: amount },
        byRelationDomain: { [relation.relationDomain ?? "unknown"]: amount },
        bySubjectKind: { [relation.subjectKind ?? "unknown"]: amount },
        byObjectKind: { [relation.objectKind ?? "unknown"]: amount },
      },
    },
  };
}

async function updateNewsroomSummaryDelta(client, delta, reason) {
  await client.updateNewsroomSummary({
    source: "incremental",
    ...delta,
  }, {
    actorLabel: "Papyrus content CLI",
    reason,
  });
}

function printDraftPlan(label, { categorySets = [], categories = [], apply = false }) {
  console.log(`categories\t${label}\tmode\t${apply ? "apply" : "dry-run"}`);
  for (const categorySet of categorySets) {
    console.log(`categories\t${label}\tcategory-set\t${categorySet.id}\t${categorySet.versionState}\t${categorySet.status}\t${categorySet.displayName}`);
  }
  for (const category of categories) {
    console.log(`categories\t${label}\tcategory\t${category.id}\t${category.versionState}\t${category.status}\t${category.categoryKey}\t${category.displayName}`);
  }
}

function printReferenceLabelPlan(label, { relations = [], apply = false }) {
  console.log(`references\t${label}\tmode\t${apply ? "apply" : "dry-run"}`);
  for (const relation of relations) {
    console.log(`references\t${label}\trelation\t${relation.id}\t${relation.relationTypeKey ?? relation.predicate}\t${relation.subjectId}\t${relation.objectId}`);
  }
}

function latestReferenceReasonCode(reference, messages) {
  const metadataReason = reasonCodeFromMetadata(reference.metadata);
  if (metadataReason) return metadataReason;
  const sortedMessages = [...messages].sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
  for (const message of sortedMessages) {
    const reason = reasonCodeFromMetadata(message.metadata);
    if (reason) return reason;
  }
  return null;
}

function reasonCodeFromMetadata(metadata) {
  const parsed = parseJsonish(metadata);
  return parsed.reasonCode
    ?? parsed.reason_code
    ?? parsed.curationReasonCode
    ?? parsed.curation_reason_code
    ?? parsed.rejectionReasonCode
    ?? parsed.rejection_reason_code
    ?? null;
}

function parseJsonish(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function compareReferencesForExport(left, right) {
  return String(left.externalItemId ?? left.id).localeCompare(String(right.externalItemId ?? right.id));
}

function printRelationBackfillSummary(report) {
  console.log("Relation type backfill:");
  console.log(`config\t${report.configPath}`);
  console.log(`relations\t${report.relationCount}`);
  console.log(`changes\t${report.changeCount}`);
  console.log(`unknownTypes\t${report.unknownTypeCount}`);
  console.log(`apply\t${report.apply ? "yes" : "no"}`);
  for (const type of report.unknownTypes) console.log(`unknown\t${type}`);
  console.log(`report\t${report.reportPath}`);
}

async function resolveAcceptedCategorySet(client, options) {
  if (options.categorySetId) {
    const categorySet = await client.getRecord("CategorySet", options.categorySetId);
    if (!categorySet) throw new Error(`CategorySet ${options.categorySetId} was not found.`);
    return categorySet;
  }
  const candidates = (await client.listRecords("CategorySet"))
    .filter((categorySet) => !options.corpusId || categorySet.corpusId === options.corpusId)
    .filter((categorySet) => !options.classifierId || categorySet.classifierId === options.classifierId)
    .filter((categorySet) => categorySet.status === "accepted");
  candidates.sort((left, right) => String(right.generatedAt ?? right.versionCreatedAt ?? "").localeCompare(String(left.generatedAt ?? left.versionCreatedAt ?? "")));
  return candidates[0] ?? null;
}

function validateCycleCorpusPaths(plan) {
  const corpora = [plan.canonical.corpus, ...plan.sourceProjections.map((projection) => projection.targetCorpus)];
  for (const corpus of corpora) {
    if (!corpus.path) throw new Error(`Corpus ${corpus.key} does not define a local path in steering config.`);
    const resolved = resolveBiblicusCorpusPath(plan, corpus);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Corpus path for ${corpus.key} was not found: ${resolved}`);
    }
  }
}

function resolveBiblicusCorpusPath(plan, corpus) {
  if (path.isAbsolute(corpus.path)) return corpus.path;
  return path.join(plan.biblicusWorkdir, corpus.path);
}

function latestPipelineSnapshot(bundle) {
  const artifacts = (bundle.artifacts ?? [])
    .filter((artifact) => artifact.kind === "extraction")
    .filter((artifact) => String(artifact.artifact_id ?? "").startsWith("pipeline:"))
    .filter((artifact) => artifact.snapshot_id);
  artifacts.sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
  return artifacts[0] ? `pipeline:${artifacts[0].snapshot_id}` : null;
}

function runBiblicus(plan, args, label) {
  const logPrefix = path.join(plan.runDir, `${label.replace(/[^A-Za-z0-9_.-]/g, "-")}`);
  console.log(`Biblicus: ${label}`);
  const uvArgs = ensureUvBiblicusExtras(["run", "--extra", "topic-modeling", "biblicus", ...args], ["topic-modeling", "openai"]);
  const result = spawnSync("uv", uvArgs, {
    cwd: plan.biblicusWorkdir,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
  });
  fs.writeFileSync(`${logPrefix}.stdout.log`, result.stdout ?? "", "utf8");
  fs.writeFileSync(`${logPrefix}.stderr.log`, result.stderr ?? "", "utf8");
  if (result.status !== 0) {
    throw new Error(`Biblicus ${label} failed. See ${logPrefix}.stderr.log`);
  }
  return result.stdout ?? "";
}

function ensureUvBiblicusExtras(args, requiredExtras) {
  const next = Array.isArray(args) ? [...args] : [];
  if (!next.length || next[0] !== "run") return next;
  const biblicusIndex = next.findIndex((entry) => entry === "biblicus");
  if (biblicusIndex <= 0) return next;
  const extras = new Set();
  for (let index = 1; index < biblicusIndex; index += 1) {
    if (next[index] === "--extra" && index + 1 < biblicusIndex) extras.add(String(next[index + 1]));
  }
  let insertAt = biblicusIndex;
  for (const extra of requiredExtras) {
    if (extras.has(extra)) continue;
    next.splice(insertAt, 0, "--extra", extra);
    insertAt += 2;
  }
  return next;
}

function resolveGraphExtractorSpacyModel(args, cwd) {
  let model = "en_core_web_sm";
  const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    if (normalizedArgs[index] !== "--configuration" || !normalizedArgs[index + 1]) continue;
    const configPath = path.isAbsolute(normalizedArgs[index + 1])
      ? normalizedArgs[index + 1]
      : path.join(cwd, normalizedArgs[index + 1]);
    const config = YAML.parse(fs.readFileSync(configPath, "utf8"));
    if (typeof config?.model === "string" && config.model.trim()) model = config.model.trim();
  }
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    if (normalizedArgs[index] !== "--override" || !normalizedArgs[index + 1]) continue;
    const override = String(normalizedArgs[index + 1]);
    const separatorIndex = override.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = override.slice(0, separatorIndex).trim();
    const value = override.slice(separatorIndex + 1).trim();
    if (key === "model" && value) model = value;
  }
  return model;
}

function runBiblicusJson(plan, args, label, outputPath) {
  const stdout = runBiblicus(plan, args, label);
  writeJsonFile(outputPath, JSON.parse(stdout));
  return outputPath;
}

function recordProposalBundleIfPresent(plan, bundlePath, corpusPath, label) {
  const bundle = normalizeSteeringProposalBundle(loadJsonFile(bundlePath));
  writeJsonFile(bundlePath, bundle);
  const proposalCount = Array.isArray(bundle.proposals) ? bundle.proposals.length : 0;
  if (!proposalCount) return;
  runBiblicus(plan, ["steering", "proposals", "validate", "--input", bundlePath], `${label}-validate`);
  runBiblicus(plan, ["steering", "proposals", "record", "--corpus", corpusPath, "--input", bundlePath], `${label}-record`);
}

function normalizeSteeringProposalBundle(payload) {
  return {
    schema_version: payload.schema_version ?? 1,
    analysis_id: "steering-proposals",
    snapshot_id: null,
    generated_at: payload.generated_at ?? new Date().toISOString(),
    source_artifact_refs: Array.from(new Set([
      payload.taxonomy_snapshot_id ? `taxonomy:${payload.taxonomy_snapshot_id}` : null,
      payload.extraction_snapshot ?? null,
      payload.snapshot_id ? `${payload.analysis_id ?? "analysis"}:${payload.snapshot_id}` : null,
    ].filter(Boolean))),
    signals: Array.isArray(payload.signals) ? payload.signals : [],
    proposals: Array.isArray(payload.proposals) ? payload.proposals : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
  };
}

async function verifyCurationCycle(client, context) {
  const [corpora, categorySets, categories, references, relations, proposals, nodes] = await Promise.all([
    client.listRecords("KnowledgeCorpus"),
    client.listRecords("CategorySet"),
    client.listRecords("Category"),
    client.listRecords("Reference"),
    client.listRecords("SemanticRelation"),
    client.listRecords("SteeringProposal"),
    client.listRecords("SemanticNode"),
  ]);
  const currentReferences = references.filter((reference) => reference.versionState === "current");
  const acceptedReferences = currentReferences.filter(isCurrentAcceptedReference);
  const classifiedRelations = relations.filter((relation) => relation.relationState === "current" && (relation.relationTypeKey ?? relation.predicate) === "classified_as");
  const categoryLineages = new Set(categories.filter((category) => category.versionState === "current").map((category) => category.lineageId));
  const referenceLineages = new Set(acceptedReferences.map((reference) => reference.lineageId));
  const unresolvedCategoryRelations = classifiedRelations.filter((relation) => !categoryLineages.has(relation.objectLineageId)).length;
  const unresolvedReferenceRelations = classifiedRelations.filter((relation) => !referenceLineages.has(relation.subjectLineageId)).length;
  const activeCategorySet = categorySets.find((categorySet) => categorySet.id === context.categorySetId) ?? null;
  const failures = [];
  if (!activeCategorySet) failures.push(`accepted category set ${context.categorySetId} is missing`);
  if (!acceptedReferences.length) failures.push("no current accepted references found");
  if (!classifiedRelations.length) failures.push("no classified_as relations found");
  if (unresolvedCategoryRelations) failures.push(`${unresolvedCategoryRelations} classified_as relations point at missing categories`);
  if (unresolvedReferenceRelations) failures.push(`${unresolvedReferenceRelations} classified_as relations point at missing references`);
  return {
    generatedAt: new Date().toISOString(),
    runId: context.plan.runId,
    categorySetId: context.categorySetId,
    counts: {
      corpora: corpora.length,
      categorySets: categorySets.length,
      currentCategories: categories.filter((category) => category.versionState === "current").length,
      currentReferences: currentReferences.length,
      acceptedReferences: acceptedReferences.length,
      classifiedAsRelations: classifiedRelations.length,
      steeringProposals: proposals.length,
      semanticNodes: nodes.length,
    },
    unresolved: {
      categoryRelations: unresolvedCategoryRelations,
      referenceRelations: unresolvedReferenceRelations,
    },
    failures,
  };
}

function printCurationVerification(verification) {
  console.log("Curation verification:");
  for (const [key, value] of Object.entries(verification.counts)) {
    console.log(`${key}\t${value}`);
  }
  console.log(`unresolved.categoryRelations\t${verification.unresolved.categoryRelations}`);
  console.log(`unresolved.referenceRelations\t${verification.unresolved.referenceRelations}`);
  if (verification.failures.length) {
    for (const failure of verification.failures) console.log(`failure\t${failure}`);
  } else {
    console.log("verification\tok");
  }
}

async function applyAssignmentAction({
  client,
  authClaims = {},
  action,
  assignmentId,
  options = {},
  actorLabel = null,
}) {
  const current = await client.getRecord("Assignment", assignmentId);
  if (!current) throw new Error(`Assignment ${assignmentId} was not found.`);
  const now = new Date().toISOString();
  const nextStatus = assignmentStatusForAction(action, current.status);
  const update = {
    id: assignmentId,
    assignmentTypeKey: current.assignmentTypeKey,
    queueKey: current.queueKey,
    status: nextStatus,
    queueStatusKey: `${current.queueKey}#${nextStatus}`,
    createdAt: current.createdAt,
    updatedAt: now,
    newsroomFeedKey: current.newsroomFeedKey ?? "assignments",
  };
  if (current.priority !== undefined && current.priority !== null) update.priority = current.priority;
  if (action === "claim") {
    const claimIdentity = resolveCliClaimIdentity(options, authClaims);
    if (activeClaimHeldByDifferentAssignee(current, claimIdentity.assigneeKey, now)) {
      throw new Error(`Assignment ${assignmentId} is already claimed by ${current.assigneeKey}.`);
    }
    update.assigneeType = claimIdentity.assigneeType;
    update.assigneeId = claimIdentity.assigneeId;
    update.assigneeKey = claimIdentity.assigneeKey;
    update.claimedAt = current.assigneeKey === claimIdentity.assigneeKey && current.claimedAt ? current.claimedAt : now;
    update.claimExpiresAt = resolveCliClaimExpiresAt(options, now) ?? (current.assigneeKey === claimIdentity.assigneeKey ? current.claimExpiresAt ?? null : null);
  }
  if (action === "release") {
    update.assigneeType = null;
    update.assigneeId = null;
    update.assigneeKey = null;
    update.claimedAt = null;
    update.claimExpiresAt = null;
  }
  if (action === "complete") update.completedAt = now;
  if (action === "cancel") update.canceledAt = now;
  if (action === "reopen") {
    update.completedAt = null;
    update.canceledAt = null;
  }
  await client.upsert("Assignment", update);
  await client.upsert("AssignmentEvent", {
    id: `assignment-event-${assignmentId}-${now.replace(/[^0-9TZ]/g, "")}`,
    assignmentId,
    assignmentTypeKey: current.assignmentTypeKey,
    queueKey: current.queueKey,
    eventType: action,
    fromStatus: current.status,
    toStatus: nextStatus,
    actorSub: authClaims.sub ?? null,
    actorLabel: actorLabel ?? options["assignee-key"] ?? options.assignee ?? authClaims.email ?? authClaims.sub ?? "jwt-worker",
    note: options.note ?? null,
    createdAt: now,
    metadata: JSON.stringify({
      source: "content-cli",
      kind: `assignment.action.${action}`,
      ...(action === "claim" ? {
        assigneeKey: update.assigneeKey ?? null,
        claimExpiresAt: update.claimExpiresAt ?? null,
        previousAssigneeKey: current.assigneeKey ?? null,
      } : {}),
    }),
  });
  const statusDeltas = current.status === nextStatus
    ? {}
    : { [current.status]: -1, [nextStatus]: 1 };
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      assignmentEvents: 1,
    },
    assignmentStatusDeltas: statusDeltas,
    facetDeltas: {
      assignments: {
        statusByType: current.status === nextStatus
          ? {}
          : {
              [current.assignmentTypeKey]: {
                [current.status]: -1,
                [nextStatus]: 1,
              },
            },
      },
    },
  }, {
    actorLabel: actorLabel ?? options["assignee-key"] ?? options.assignee ?? authClaims.email ?? authClaims.sub ?? "jwt-worker",
    reason: `assignments ${action} ${assignmentId}`,
  });
  return {
    assignment: update,
    fromStatus: current.status,
    toStatus: nextStatus,
  };
}

async function appendAssignmentFailedEvent({
  client,
  assignmentId,
  assignmentTypeKey,
  queueKey,
  fromStatus,
  toStatus,
  actorLabel,
  note,
  metadata = {},
}) {
  const now = new Date().toISOString();
  if (metadata.manifestPath) {
    try {
      fs.mkdirSync(path.dirname(metadata.manifestPath), { recursive: true });
      if (!fs.existsSync(metadata.manifestPath)) {
        writeJsonFile(metadata.manifestPath, {
          runId: metadata.runId ?? null,
          assignmentId,
          assignmentTypeKey,
          failedAt: now,
          status: "failed",
          error: metadata.error ?? null,
          importRuns: metadata.importRuns ?? [],
          importedRecords: metadata.importedRecords ?? 0,
          stdoutLogPaths: metadata.stdoutLogPaths ?? [],
          stderrLogPaths: metadata.stderrLogPaths ?? [],
        });
      }
    } catch {
      // The AssignmentEvent still carries log paths if local manifest persistence fails.
    }
  }
  await client.upsert("AssignmentEvent", {
    id: `assignment-event-${assignmentId}-failed-${timestampForPath(now)}`,
    assignmentId,
    assignmentTypeKey,
    queueKey,
    eventType: "failed",
    fromStatus,
    toStatus,
    actorSub: null,
    actorLabel: actorLabel ?? "papyrus-content-cli",
    note: note ?? "Assignment execution failed.",
    createdAt: now,
    metadata: JSON.stringify({
      source: "content-cli",
      ...metadata,
    }),
  });
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      assignmentEvents: 1,
    },
  }, {
    actorLabel: actorLabel ?? "papyrus-content-cli",
    reason: `assignments failed ${assignmentId}`,
  });
}

async function appendAssignmentPhaseEvent({
  client,
  assignment,
  eventType,
  actorLabel,
  note,
  metadata = {},
}) {
  const now = new Date().toISOString();
  await client.upsert("AssignmentEvent", {
    id: `assignment-event-${assignment.id}-${eventType}-${timestampForPath(now)}`,
    assignmentId: assignment.id,
    assignmentTypeKey: assignment.assignmentTypeKey,
    queueKey: assignment.queueKey,
    eventType,
    fromStatus: assignment.status,
    toStatus: assignment.status,
    actorSub: null,
    actorLabel: actorLabel ?? "papyrus-content-cli",
    note: note ?? null,
    createdAt: now,
    metadata: JSON.stringify({
      source: "content-cli",
      ...metadata,
    }),
  });
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      assignmentEvents: 1,
    },
  }, {
    actorLabel: actorLabel ?? "papyrus-content-cli",
    reason: `assignments ${eventType} ${assignment.id}`,
  });
}

function resolveAnalysisExecutionControls(options, metadata) {
  const execution = metadata.execution && typeof metadata.execution === "object" ? metadata.execution : {};
  const criteria = execution.successCriteria && typeof execution.successCriteria === "object" ? execution.successCriteria : {};
  const maxRuntimeSeconds = normalizeCliPositiveInteger(options["max-runtime-seconds"], "--max-runtime-seconds")
    ?? normalizeCliPositiveInteger(execution.maxRuntimeSeconds, "assignment.metadata.execution.maxRuntimeSeconds");
  return {
    maxRuntimeSeconds,
    successCriteria: {
      minNodes: optionalNumber(criteria.minNodes),
      minEdges: optionalNumber(criteria.minEdges),
      maxErrorRate: optionalNumber(criteria.maxErrorRate),
    },
  };
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())));
}

function assignmentSortKey(assignment) {
  return `${String(assignment.priority ?? 999999).padStart(6, "0")}#${assignment.createdAt ?? ""}#${assignment.id}`;
}

function compareAssignmentQueueOrder(left, right) {
  const leftPriority = Number.isFinite(Number(left.priority)) ? Number(left.priority) : 0;
  const rightPriority = Number.isFinite(Number(right.priority)) ? Number(right.priority) : 0;
  if (leftPriority !== rightPriority) return rightPriority - leftPriority;
  const createdCompare = String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
  if (createdCompare !== 0) return createdCompare;
  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function assignmentStatusForAction(action, currentStatus) {
  if (action === "claim") {
    if (currentStatus === "completed" || currentStatus === "canceled") throw new Error(`Cannot claim ${currentStatus} assignment.`);
    return "claimed";
  }
  if (action === "release") {
    if (currentStatus === "completed" || currentStatus === "canceled") throw new Error(`Cannot release ${currentStatus} assignment.`);
    return "open";
  }
  if (action === "complete") {
    if (currentStatus === "canceled") throw new Error("Cannot complete canceled assignment.");
    return "completed";
  }
  if (action === "cancel") {
    if (currentStatus === "completed") throw new Error("Cannot cancel completed assignment.");
    return "canceled";
  }
  if (action === "reopen") return "open";
  throw new Error(`Unsupported assignment action ${action}.`);
}

function resolveCliClaimIdentity(options, claims) {
  const explicitAssigneeKey = normalizeCliString(options["assignee-key"]);
  if (explicitAssigneeKey) {
    return {
      assigneeType: normalizeCliString(options["assignee-type"]),
      assigneeId: normalizeCliString(options.assignee),
      assigneeKey: explicitAssigneeKey,
    };
  }
  const assigneeType = normalizeCliString(options["assignee-type"]) ?? "agent";
  const assigneeId = normalizeCliString(options.assignee) ?? normalizeCliString(claims.sub) ?? "jwt-worker";
  return {
    assigneeType,
    assigneeId,
    assigneeKey: `${assigneeType}#${assigneeId}`,
  };
}

function activeClaimHeldByDifferentAssignee(assignment, requestedAssigneeKey, now) {
  if (assignment.status !== "claimed") return false;
  const currentAssigneeKey = normalizeCliString(assignment.assigneeKey);
  if (!currentAssigneeKey || currentAssigneeKey === requestedAssigneeKey) return false;
  const claimExpiresAt = normalizeCliString(assignment.claimExpiresAt);
  if (!claimExpiresAt) return true;
  const expirationTime = Date.parse(claimExpiresAt);
  if (!Number.isFinite(expirationTime)) return true;
  return expirationTime > Date.parse(now);
}

function resolveCliClaimExpiresAt(options, now) {
  const explicitExpiration = normalizeCliString(options["claim-expires-at"]);
  if (explicitExpiration) {
    const expirationTime = Date.parse(explicitExpiration);
    if (!Number.isFinite(expirationTime)) throw new Error(`Invalid --claim-expires-at value ${explicitExpiration}.`);
    return new Date(expirationTime).toISOString();
  }
  const ttlSeconds = normalizeCliPositiveInteger(options["claim-ttl-seconds"], "--claim-ttl-seconds");
  if (!ttlSeconds) return null;
  return new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
}

function parseBooleanOption(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  throw new Error(`${label} must be true or false.`);
}

function normalizeCliPositiveInteger(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function normalizeCliString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordsEqual(left, right) {
  return recordsEqualForModel(null, left, right);
}

function recordsEqualForModel(modelName, left, right) {
  const ignoredFields = ignoredRecordFields(modelName);
  return stableStringify(normalizeRecord(left, "", ignoredFields)) === stableStringify(normalizeRecord(right, "", ignoredFields));
}

const AWS_JSON_FIELDS = new Set(["layout", "editorial", "metadata", "layoutPlan", "payload"]);
const KNOWLEDGE_MODELS = new Set([
  "Assignment",
  "AssignmentEvent",
  "Category",
  "CategorySet",
  "KnowledgeArtifact",
  "KnowledgeCorpus",
  "KnowledgeImportRun",
  "KnowledgeRawPayload",
  "Message",
  "Reference",
  "ReferenceAttachment",
  "SemanticNode",
  "SemanticRelation",
  "SemanticRelationType",
  "SteeringDecision",
  "SteeringProposal",
]);
const KNOWLEDGE_VOLATILE_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "importedAt",
  "importRunId",
  "latestImportRunId",
  "sourceSnapshotId",
]);

function ignoredRecordFields(modelName) {
  return KNOWLEDGE_MODELS.has(modelName) ? KNOWLEDGE_VOLATILE_FIELDS : null;
}

function normalizeRecord(record, keyName = "", ignoredFields = null) {
  if (Array.isArray(record)) return record.map((entry) => normalizeRecord(entry, keyName, ignoredFields));
  if (typeof record === "string" && AWS_JSON_FIELDS.has(keyName)) {
    return normalizeRecord(parseAwsJson(record), keyName, ignoredFields);
  }
  if (!record || typeof record !== "object") return record;

  const normalized = {};
  for (const key of Object.keys(record).sort()) {
    if (ignoredFields?.has(key)) continue;
    if (record[key] === undefined || record[key] === null) continue;
    normalized[key] = normalizeRecord(record[key], key, ignoredFields);
  }
  return normalized;
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function hashShort(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);
}

function semanticStateKey(kind, lineageId) {
  return `${kind}#${lineageId}#current`;
}

function semanticVersionKey(kind, id) {
  return `${kind}#${id}`;
}

function withVersionFields(record, { now, actor, reason }) {
  const versioned = {
    ...record,
    versionNumber: record.versionNumber ?? 1,
    previousVersionId: record.previousVersionId ?? null,
    versionState: record.versionState ?? "current",
    versionCreatedAt: record.versionCreatedAt ?? now,
    versionCreatedBy: record.versionCreatedBy ?? actor,
    changeReason: record.changeReason ?? reason,
  };
  return {
    ...versioned,
    contentHash: record.contentHash ?? crypto.createHash("sha256").update(stableStringify(normalizeRecord(versioned))).digest("hex"),
  };
}

function toAwsJson(value) {
  return JSON.stringify(value);
}

function parseAwsJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run content -- content inspect");
  console.log("  npm run content -- content list articles");
  console.log("  npm run content -- content diff edition <edition-slug>");
  console.log("  npm run content -- content sync article <slug>");
  console.log("  npm run content -- content sync edition <edition-slug>");
  console.log("  npm run content -- content delete all --yes");
  console.log("  npm run content -- categories import-steering --bundle <steering-export.json>");
  console.log("  npm run content -- categories import-steering --corpus <path> --classifier <classifier-id>");
  console.log("  npm run content -- categories import-steering --config <steering.yml> --corpus-key <key>");
  console.log("  npm run content -- categories import-config --config <steering.yml>");
  console.log("  npm run content -- categories sandbox-steering-config --config <steering.yml> --output .papyrus-runs/<run>/sandbox-steering.yml");
  console.log("  npm run content -- categories export-category-set --category-set <id> --output <accepted-category-set.json>");
  console.log("  npm run content -- categories draft-create --from-category-set <id> --title <text> --apply");
  console.log("  npm run content -- categories draft-add-topic --category-set <draft-id> --display-name <text> --parent-key <key> --short-title <text> --subtitle <text> --apply");
  console.log("  npm run content -- categories draft-update-topic --category <id|lineage|key> --display-name <text> --apply");
  console.log("  npm run content -- categories draft-archive-topic --category <id|lineage|key> --apply");
  console.log("  npm run content -- categories draft-promote --category-set <draft-id> --apply");
  console.log("  npm run content -- categories export-classifier-seed-manifest --category-set <id> --corpus-key <key> --output <seed-manifest.json>");
  console.log("  npm run content -- categories export-category-tree --category-set <id> --output <accepted-category-tree.json>");
  console.log("  npm run content -- categories export-steering-feedback --category-set <id> --output <steering-feedback.json>");
  console.log("  npm run content -- categories export-lexical-steering --output <lexical-steering.json>");
  console.log("  npm run content -- categories import-projection --bundle <projection.json>");
  console.log("  npm run content -- categories import-projection --config <steering.yml> --target-corpus-key <key> --authority-corpus-key <key> --bundle <projection.json>");
  console.log("  npm run content -- categories run-curation-cycle --config <steering.yml>");
  console.log("  npm run content -- relations import-types --config corpora/papyrus-semantic-relation-types.yml");
  console.log("  npm run content -- relations backfill --config corpora/papyrus-semantic-relation-types.yml --apply");
  console.log("  npm run content -- messages export-legacy-comments --output .papyrus-runs/<timestamp>/legacy-knowledge-comments.json");
  console.log("  npm run content -- messages import-legacy-comments --input .papyrus-runs/<timestamp>/legacy-knowledge-comments.json");
  console.log("  npm run content -- references prepare-catalog --config <steering.yml> --corpus-key <key> --catalog <catalog.json> --output <prepared.json>");
  console.log("  npm run content -- references register-catalog --config <steering.yml> --corpus-key <key> --catalog <catalog.json> --status pending --ingestion-rationale <text> --apply");
  console.log("  npm run content -- references register-catalog --config <steering.yml> --corpus-key <key> --catalog <catalog.json> --status rejected --reason-code out_of_scope --note <text> --apply");
  console.log("  npm run content -- references export-analysis-manifest --config <steering.yml> --corpus-key <key> --output <accepted-manifest.json>");
  console.log("  npm run content -- references export-scope-training --config <steering.yml> --corpus-key <key> --output <scope-training.json>");
  console.log("  npm run content -- references review-curation --reference <id> --action accept|reject|reopen|archive --reason-code out_of_scope --note <text>");
  console.log("  npm run content -- references list-predictions --corpus-key <key> --category-set <id> --status current --limit 200");
  console.log("  npm run content -- references review-classification --relation <semantic-relation-id> --action accept|reject --note <text>");
  console.log("  npm run content -- references label --reference <reference-id|item-id> --category <category-key|lineage-id> --category-set <id> --note <text> --apply");
  console.log("  npm run content -- references unlabel --relation <authoritative-label-relation-id> --apply");
  console.log("  npm run content -- references labels --reference <reference-id|item-id>");
  console.log("  npm run content -- assignments list --queue <queue-key> --status open");
  console.log("  npm run content -- assignments for-object --kind reference --lineage <reference-lineage-id>");
  console.log("  npm run content -- assignments build-context --assignment <id> --context-profile reporting");
  console.log("  npm run content -- assignments research-packets --assignment <id>");
  console.log("  npm run content -- assignments process-queue --type analysis.reindex --status open --max-count 10 --dry-run");
  console.log("  npm run content -- assignments process-queue --type analysis.reindex --status open --max-count 10 --max-runtime-seconds 3600 --stop-on-error false");
  console.log("  npm run content -- assignments claim --assignment <id> --assignee-key <worker-run-id> --claim-ttl-seconds 3600");
  console.log("  npm run content -- assignments complete --assignment <id> --note <text>");
  console.log("  npm run content -- analysis profiles --profiles corpora/papyrus-analysis-profiles.yml");
  console.log("  npm run content -- analysis validate-profiles --profiles corpora/papyrus-analysis-profiles.yml");
  console.log("  npm run content -- analysis reindex-plan --profile canonical-topic-classifier --corpus-key AI-ML-research --override bertopic_analysis.parameters.nr_topics=12");
  console.log("  npm run content -- analysis preview-reindex --profile canonical-topic-classifier --corpus-key AI-ML-research --override bertopic_analysis.parameters.nr_topics=12");
  console.log("  npm run content -- analysis create-reindex-assignment --profile canonical-topic-classifier --corpus-key AI-ML-research --apply");
  console.log("  npm run content -- analysis run-now --profile canonical-topic-classifier --corpus-key AI-ML-research --max-runtime-seconds 3600 --override bertopic_analysis.parameters.nr_topics=12");
  console.log("  npm run content -- analysis execute-assignment --assignment <analysis-assignment-id> --max-runtime-seconds 3600");
  console.log("  npm run content -- newsroom recount-summary --apply");
  console.log("  npm run content -- newsroom backfill-feed-fields --apply");
  console.log("  npm run content -- editions plan --date YYYY-MM-DD --dry-run");
  console.log("  npm run content -- editions plan --date YYYY-MM-DD --focus-categories automated-publication-systems,agentic-workflows --context-profile analysis --dry-run");
  console.log("  npm run content -- editions dispatch-research --date YYYY-MM-DD --apply");
  console.log("  npm run content -- editions dispatch-research --date YYYY-MM-DD --focus-categories agentic-workflows,evaluation-qa --context-profile reporting --apply");
}

function printEditionPlanningSummary(plan, report, mode) {
  console.log(`edition-planning\tmode\t${mode}`);
  console.log(`edition-planning\tedition\t${plan.edition.id}\t${plan.edition.slug}\t${plan.edition.status}`);
  console.log(`edition-planning\tcategory-set\t${plan.categorySet.id}\t${plan.categorySet.displayName}`);
  console.log(`edition-planning\tdesks\t${plan.desks.length}`);
  console.log(`edition-planning\tassignments\t${plan.assignments.length}`);
  console.log(`edition-planning\tcontext-backed\t${plan.summary.contextBackedAssignmentCount}`);
  console.log(`edition-planning\trecords\tcreate=${plan.summary.createCount}\tupdate=${plan.summary.updateCount}\tnoop=${plan.summary.noopCount}`);
  console.log(`edition-planning\treport\t${report.filepath}`);
  for (const coverage of plan.focusCoverage || []) {
    console.log(`focus-coverage\t${coverage.deskCategoryKey}\t${coverage.laneKey}\t${coverage.focusCategoryKey}\t${coverage.count}`);
  }
  for (const desk of plan.desks) {
    console.log(`desk\t${desk.categoryKey}\t${desk.opportunityScore}\trefs=${desk.referenceCount}\tsignals=${desk.signalCount}`);
  }
}

function runPapyrusNewsroomTool(args, label) {
  const result = spawnSync("poetry", ["run", "papyrus-newsroom", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Papyrus newsroom ${label} failed: ${result.stderr || result.stdout || "unknown error"}`);
  }
  return result.stdout;
}

function resolveSteeringImportCorpus(config, options) {
  if (options["corpus-key"]) {
    const requiredConfig = config ?? requireSteeringConfig({ configPath: options.config });
    const corpusConfig = requireCorpusConfig(requiredConfig, options["corpus-key"], "--corpus-key");
    return {
      corpusConfig,
      corpusPath: options.corpus ?? corpusConfig.path,
      classifierId: resolveClassifierForCorpus(requiredConfig, corpusConfig, options.classifier),
    };
  }

  const corpusConfig = findCorpusConfigByPath(config, options.corpus);
  return {
    corpusConfig,
    corpusPath: options.corpus,
    classifierId: options.classifier ?? (corpusConfig && config ? resolveClassifierForCorpus(config, corpusConfig, undefined) : undefined),
  };
}

function resolveProjectionImportCorpora(config, options) {
  let targetCorpus = null;
  let authorityCorpus = null;
  if (options["target-corpus-key"]) {
    const requiredConfig = config ?? requireSteeringConfig({ configPath: options.config });
    targetCorpus = requireCorpusConfig(requiredConfig, options["target-corpus-key"], "--target-corpus-key");
    const authorityKey = options["authority-corpus-key"] ?? targetCorpus.canonicalProjection?.authorityCorpusKey;
    if (authorityKey) authorityCorpus = requireCorpusConfig(requiredConfig, authorityKey, "--authority-corpus-key");
    const classifierId = options.classifier ?? targetCorpus.canonicalProjection?.classifierId ?? requiredConfig.canonicalTopicSet.classifierId;
    return {
      targetCorpus,
      authorityCorpus,
      targetCorpusId: options["target-corpus-id"] ?? knowledgeCorpusId(targetCorpus),
      authorityCorpusId: options["authority-corpus-id"] ?? (authorityCorpus ? knowledgeCorpusId(authorityCorpus) : undefined),
      classifierId,
    };
  }
  if (options["authority-corpus-key"]) {
    const requiredConfig = config ?? requireSteeringConfig({ configPath: options.config });
    authorityCorpus = requireCorpusConfig(requiredConfig, options["authority-corpus-key"], "--authority-corpus-key");
  }
  return {
    targetCorpus,
    authorityCorpus,
    targetCorpusId: options["target-corpus-id"],
    authorityCorpusId: options["authority-corpus-id"] ?? (authorityCorpus ? knowledgeCorpusId(authorityCorpus) : undefined),
    classifierId: options.classifier,
  };
}

function sandboxStorageBucketFromAmplifyOutputs(filepath) {
  if (!fs.existsSync(filepath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filepath, "utf8"));
  return parsed.storage?.bucket_name ?? parsed.storage?.bucketName ?? null;
}

function catalogItemsForSummary(catalog) {
  const items = catalog.items ?? catalog.references ?? catalog.records ?? [];
  if (Array.isArray(items)) return items;
  if (items && typeof items === "object") return Object.values(items);
  return [];
}

function parseOptions(flags) {
  const options = {};
  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument ${token}.`);
    const key = token.slice(2);
    const next = flags[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function parseCommaList(value) {
  if (!value) return undefined;
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseRepeatedOption(flags, optionName) {
  const values = [];
  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index];
    if (token !== `--${optionName}`) continue;
    const next = flags[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`--${optionName} requires a value.`);
    values.push(next);
    index += 1;
  }
  return values;
}

function injectRunIdOverride(flags, runId) {
  const next = [];
  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index];
    if (token === "--run-id") {
      if (index + 1 < flags.length && !String(flags[index + 1]).startsWith("--")) index += 1;
      continue;
    }
    next.push(token);
  }
  next.push("--run-id", runId);
  return next;
}

function normalizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack.split("\n").slice(0, 8).join("\n") : null;
  const artifacts = error && typeof error === "object" ? error.analysisArtifacts ?? {} : {};
  return {
    message,
    stack,
    kind: artifacts.kind ?? null,
    commandLabel: artifacts.commandResult?.label ?? null,
    elapsedSeconds: artifacts.commandResult?.elapsedSeconds ?? null,
    exitStatus: artifacts.commandResult?.exitStatus ?? null,
    signal: artifacts.commandResult?.signal ?? null,
  };
}

function analysisFailureArtifactsFromError(error) {
  const attached = error && typeof error === "object" ? error.analysisArtifacts : null;
  if (attached) {
    const stderrLogPaths = attached.stderrLogPaths ?? (attached.commandResult?.stderrLogPath ? [attached.commandResult.stderrLogPath] : []);
    const stdoutLogPaths = attached.stdoutLogPaths ?? (attached.commandResult?.stdoutLogPath ? [attached.commandResult.stdoutLogPath] : []);
    return {
      runId: attached.runId ?? null,
      manifestPath: attached.manifestPath ?? (attached.runId ? path.join(process.cwd(), ".papyrus-runs", attached.runId, "execution-manifest.json") : null),
      stdoutLogPaths,
      stderrLogPaths,
      commandResult: attached.commandResult ?? null,
    };
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/See\s+([^\s]+\.stderr\.log)/i);
  if (!match) {
    return {
      runId: null,
      manifestPath: null,
      stdoutLogPaths: [],
      stderrLogPaths: [],
      commandResult: null,
    };
  }
  const stderrLogPath = match[1];
  const runMatch = stderrLogPath.match(/\.papyrus-runs\/([^/]+)\//);
  const runId = runMatch ? runMatch[1] : null;
  return {
    runId,
    manifestPath: runId ? path.join(process.cwd(), ".papyrus-runs", runId, "execution-manifest.json") : null,
    stdoutLogPaths: [stderrLogPath.replace(/\.stderr\.log$/i, ".stdout.log")],
    stderrLogPaths: [stderrLogPath],
    commandResult: null,
  };
}

function timestampForPath(value = new Date().toISOString()) {
  return String(value).replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
}

function validateAuthoringClaims(claims) {
  if (isJwtExpired(claims)) {
    throw new Error("PAPYRUS_GRAPHQL_JWT is expired.");
  }

  const claimName = process.env.PAPYRUS_JWT_AUTHORING_CLAIM;
  const expectedValue = process.env.PAPYRUS_JWT_AUTHORING_VALUE;
  if (!claimName && !expectedValue) return;
  if (!claimName || !expectedValue) {
    throw new Error("PAPYRUS_JWT_AUTHORING_CLAIM and PAPYRUS_JWT_AUTHORING_VALUE must be set together.");
  }

  const values = getClaimValues(claims, claimName);
  if (!values.includes(expectedValue)) {
    throw new Error(`PAPYRUS_GRAPHQL_JWT does not include ${expectedValue} in claim ${claimName}.`);
  }
}

function getClaimValues(claims, name) {
  const value = claims[name];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  if (value === undefined || value === null) return [];
  return [String(value)];
}

function formatClaim(value) {
  if (Array.isArray(value)) return value.join(", ") || "none";
  if (value === undefined || value === null || value === "") return "none";
  return String(value);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
