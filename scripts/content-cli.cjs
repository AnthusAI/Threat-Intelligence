#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
  buildSteeringFeedbackPayload,
  buildSteeringConfigRecords,
  buildProjectionImportRecords,
  buildSteeringImportRecords,
  knowledgeCorpusId,
  loadJsonFile,
  loadLexicalSteeringConfig,
  loadSteeringBundleFromBiblicus,
  mergeReviewedProposalState,
  writeJsonFile,
} = require("./lib/papyrus-categories.cjs");
const {
  buildCurationCyclePlan,
} = require("./lib/papyrus-curation-cycle.cjs");
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
  if (group !== "content" && group !== "categories" && group !== "assignments" && group !== "editions" && group !== "relations" && group !== "references" && group !== "messages") {
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
    case "categories:export-category-set":
      await exportCategorySet(args.slice(2));
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
    case "assignments:list":
      await listAssignments(args.slice(2));
      return;
    case "assignments:for-object":
      await listAssignmentsForObject(args.slice(2));
      return;
    case "assignments:build-context":
      await buildAssignmentContext(args.slice(2));
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
  const { client } = createAuthoringClient();
  const mutation = `
    mutation ReviewReferenceCuration($referenceId: ID!, $action: String!, $note: String, $actorLabel: String) {
      reviewReferenceCuration(referenceId: $referenceId, action: $action, note: $note, actorLabel: $actorLabel) {
        ok action referenceId status messageId relationId
      }
    }
  `;
  const result = await client.graphql(mutation, {
    referenceId,
    action: options.action,
    note: options.note ?? null,
    actorLabel: options.actor ?? "Papyrus content CLI",
  });
  const review = result.reviewReferenceCuration;
  console.log(`references\treview-curation\t${review.referenceId}\t${review.action}\t${review.status}\t${review.messageId ?? ""}`);
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

async function mutateAssignment(action, flags) {
  const options = parseOptions(flags);
  const assignmentId = options.assignment;
  if (!assignmentId) throw new Error(`assignments ${action} requires --assignment.`);
  const { auth, client } = createAuthoringClient();
  const current = await client.getRecord("Assignment", assignmentId);
  if (!current) throw new Error(`Assignment ${assignmentId} was not found.`);
  const now = new Date().toISOString();
  const nextStatus = assignmentStatusForAction(action, current.status);
  const assignee = options.assignee ?? auth.claims.sub ?? "jwt-worker";
  const update = {
    id: assignmentId,
    assignmentTypeKey: current.assignmentTypeKey,
    queueKey: current.queueKey,
    status: nextStatus,
    queueStatusKey: `${current.queueKey}#${nextStatus}`,
    createdAt: current.createdAt,
    updatedAt: now,
  };
  if (current.priority !== undefined && current.priority !== null) update.priority = current.priority;
  if (action === "claim") {
    update.assigneeType = options["assignee-type"] ?? "agent";
    update.assigneeId = assignee;
    update.assigneeKey = `${update.assigneeType}#${assignee}`;
    update.claimedAt = now;
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
    actorSub: auth.claims.sub ?? null,
    actorLabel: options.assignee ?? auth.claims.email ?? auth.claims.sub ?? "jwt-worker",
    note: options.note ?? null,
    createdAt: now,
    metadata: JSON.stringify({ source: "content-cli" }),
  });
  console.log(`assignment\t${action}\t${assignmentId}\t${current.status}->${nextStatus}`);
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
    const records = await client.listRecords(modelName);
    for (const record of records) {
      await client.deleteRecord(modelName, record.id);
    }
    result.push({ modelName, deleted: records.length });
  }

  return result;
}

async function buildRecordChanges(client, records) {
  console.error(`prepare\trecords\t${records.length}`);
  const prepared = await prepareVersionedKnowledgeRecords(client, records);
  console.error(`prepare\tplanned\t${prepared.records.length}\tpostChanges\t${prepared.postChanges.length}`);
  const changes = [];
  const existingByModel = await listExistingRecordsByModel(client, prepared.records);
  for (const record of prepared.records) {
    changes.push(buildRecordChangeFromCurrent(
      record.modelName,
      record.expected,
      existingByModel.get(record.modelName)?.get(record.expected.id) ?? null,
    ));
  }
  changes.push(...prepared.postChanges);
  return changes;
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
        score: null,
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

function buildRecordChangeFromCurrent(modelName, expected, current) {
  if (modelName === "Assignment" && current) {
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

async function applyRecordChanges(client, records) {
  const actionable = records.filter((record) => record.action !== "noop");
  console.error(`apply\tchanges\t${actionable.length}`);
  let applied = 0;
  for (const record of records) {
    if (record.action === "noop") continue;
    await client.upsert(record.modelName, record.expected);
    applied += 1;
    if (applied === actionable.length || applied % 100 === 0) {
      console.error(`apply\tprogress\t${applied}/${actionable.length}`);
    }
  }
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
  const result = spawnSync("uv", ["run", "--extra", "topic-modeling", "biblicus", ...args], {
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
  const classifiedRelations = relations.filter((relation) => relation.relationState === "current" && (relation.relationTypeKey ?? relation.predicate) === "classified_as");
  const categoryLineages = new Set(categories.filter((category) => category.versionState === "current").map((category) => category.lineageId));
  const referenceLineages = new Set(currentReferences.map((reference) => reference.lineageId));
  const unresolvedCategoryRelations = classifiedRelations.filter((relation) => !categoryLineages.has(relation.objectLineageId)).length;
  const unresolvedReferenceRelations = classifiedRelations.filter((relation) => !referenceLineages.has(relation.subjectLineageId)).length;
  const activeCategorySet = categorySets.find((categorySet) => categorySet.id === context.categorySetId) ?? null;
  const failures = [];
  if (!activeCategorySet) failures.push(`accepted category set ${context.categorySetId} is missing`);
  if (!currentReferences.length) failures.push("no current references found");
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

function assignmentSortKey(assignment) {
  return `${String(assignment.priority ?? 999999).padStart(6, "0")}#${assignment.createdAt ?? ""}#${assignment.id}`;
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
  console.log("  npm run content -- categories export-category-set --category-set <id> --output <accepted-category-set.json>");
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
  console.log("  npm run content -- references review-curation --reference <id> --action accept|reject|reopen|archive --note <text>");
  console.log("  npm run content -- assignments list --queue <queue-key> --status open");
  console.log("  npm run content -- assignments for-object --kind reference --lineage <reference-lineage-id>");
  console.log("  npm run content -- assignments build-context --assignment <id> --context-profile reporting");
  console.log("  npm run content -- assignments claim --assignment <id> --assignee <agent-id>");
  console.log("  npm run content -- assignments complete --assignment <id> --note <text>");
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
