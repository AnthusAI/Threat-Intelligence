#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn, spawnSync } = require("node:child_process");

const PYTHON_PORTED_COMMANDS = new Set([
  "content:inspect",
  "content:schema-check",
  "content:list",
  "corpora:status",
  "corpora:worker-bootstrap",
  "corpora:sync-from-cloud",
  "corpora:sync-to-cloud",
  "references:make-catalog",
  "references:prepare-catalog",
  "references:register-catalog",
  "references:register-catalog-split",
  "references:source-status",
  "references:create-accession-assignments",
  "references:accession-now",
  "assignments:list",
  "analysis:profiles",
  "analysis:validate-profiles",
]);
const YAML = require("yaml");

const PROJECT_ROOT = path.resolve(__dirname, "..");

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
  normalizeRelationTypeKey,
  semanticRelationTypeFieldsForPredicate,
} = require("./lib/papyrus-relation-types.cjs");
const {
  DEFAULT_NEWSROOM_SECTIONS_PATH,
  buildNewsroomSectionRecords,
  loadNewsroomSectionSeeds,
} = require("./lib/papyrus-newsroom-sections.cjs");
const {
  buildReportingPacketReviewPlan,
  normalizeReportingReviewDecision,
} = require("./lib/papyrus-reporting-packet-review.cjs");
const {
  COPYWRITING_ASSIGNMENT_TYPES,
  buildCopywritingRunPlan,
} = require("./lib/papyrus-copywriting.cjs");
const {
  buildStoryCycleOutput,
  buildStoryCyclePlan,
  normalizeStoryCycleThrough,
} = require("./lib/papyrus-story-cycle.cjs");
const {
  REPORTING_EDITION_ASSIGNMENT_TYPE,
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
  attachmentRecord,
  buildBinaryModelPayloadAttachment,
  buildJsonModelPayloadAttachment,
  buildTextModelPayloadAttachment,
  deleteAttachmentStoragePaths,
  downloadAttachmentBody,
  downloadAttachmentBuffer,
  listAttachmentStoragePaths,
  modelAttachmentId,
  stripPrivatePayloadFields,
  uploadAttachmentBody,
} = require("./lib/papyrus-model-attachments.cjs");
const {
  SOURCE_READINESS_STATES,
  SOURCE_TEXT_STATES,
  buildExtractionIndex,
  buildReferenceSourceStatusRows,
  isExtractableMediaType,
  referenceSourceReadiness,
  selectExtractedTextAttachment,
  sourceStoragePathForReference,
  textStoragePathForReference,
} = require("./lib/papyrus-reference-source-readiness.cjs");
const {
  DEFAULT_QUERY_TERMS,
  runCitationLedDiscovery,
} = require("./lib/papyrus-reference-discovery.cjs");
const {
  IDENTIFIER_TYPE_CONFIG,
  normalizeIdentifier,
  normalizeIdentifierTypes,
  identifiersFromObject,
  parseCatalogItems,
  resolveIdentifierForReference,
  sidecarIdentifier,
} = require("./lib/papyrus-identifier-backfill.cjs");
const {
  getAssignmentTypePolicy,
} = require("./lib/papyrus-assignment-types.cjs");
const {
  findCorpusConfigByPath,
  loadSteeringConfig,
  requireCorpusConfig,
  requireSteeringConfig,
  resolveClassifierForCorpus,
} = require("./lib/papyrus-steering-config.cjs");
const { PapyrusGraphQLAuthoringClient } = require("./lib/papyrus-graphql-authoring.cjs");
const { getArticleImageAssets, getMarkdownArticle, loadEditionConfig, loadMarkdownArticles } = require("./lib/papyrus-markdown.cjs");

const OPTIONAL_SCHEMA_MODELS = new Set(["CategoryKeyword", "LexicalSteeringRule", "ModelAttachment"]);
const MODEL_ATTACHMENT_OWNER_MODELS = {
  assignment: "Assignment",
  assignmentEvent: "AssignmentEvent",
  knowledgeRawPayload: "KnowledgeRawPayload",
  message: "Message",
  reference: "Reference",
};
const REQUIRED_PROCEDURES_CONFIG_PATH = path.join(PROJECT_ROOT, "corpora", "papyrus-required-procedures.json");

const GET_PROCEDURE_DEFINITION_QUERY = `
  query GetProcedureDefinition($procedureKey: String!) {
    getNewsroomProcedureDefinition(procedureKey: $procedureKey)
  }
`;

const START_PROCEDURE_RUN_MUTATION = `
  mutation StartProcedureRun(
    $procedureKey: String
    $procedureVersionId: ID
    $title: String
    $summary: String
    $actorLabel: String
    $input: AWSJSON
  ) {
    startNewsroomProcedureRun(
      procedureKey: $procedureKey
      procedureVersionId: $procedureVersionId
      title: $title
      summary: $summary
      actorLabel: $actorLabel
      input: $input
    )
  }
`;

const UPDATE_PROCEDURE_RUN_MUTATION = `
  mutation UpdateProcedureRun($input: UpdateProcedureRunInput!) {
    updateProcedureRun(input: $input) {
      id
      procedureId
      procedureKey
      procedureVersionId
      procedureVersionNumber
      assignmentId
      runStatus
      requestedBy
      requestedAt
      startedAt
      finishedAt
      input
      normalizedInput
      resultSummary
      errorSummary
      output
      error
      attempt
      newsroomFeedKey
    }
  }
`;

function runPythonContentCommand(args) {
  if (process.env.PAPYRUS_CONTENT_SKIP_PYTHON === "1") return false;
  const [group, command] = args;
  const route = `${group}:${command}`;
  if (!PYTHON_PORTED_COMMANDS.has(route)) return false;
  const pythonArgs = ["run", "papyrus-content", group, command, ...args.slice(2)];
  const result = spawnSync("poetry", pythonArgs, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
  return true;
}

async function main() {
  loadDotEnv();

  const args = process.argv.slice(2);
  const [group, command, value] = args;
  if (runPythonContentCommand(args)) return;
  if (group !== "content" && group !== "categories" && group !== "assignments" && group !== "editions" && group !== "relations" && group !== "references" && group !== "messages" && group !== "analysis" && group !== "newsroom" && group !== "corpora") {
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
    case "content:schema-check":
      await checkGraphqlSchema(args.slice(2));
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
    case "corpora:status":
      await corpusStatus(args.slice(2));
      return;
    case "corpora:sync-from-cloud":
      await syncCorpusFromCloud(args.slice(2));
      return;
    case "corpora:sync-to-cloud":
      await syncCorpusToCloud(args.slice(2));
      return;
    case "corpora:worker-bootstrap":
      await corpusWorkerBootstrap(args.slice(2));
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
    case "categories:review-proposal":
      await reviewSteeringProposalFromCli(args.slice(2));
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
    case "references:register-catalog-split":
      await registerReferenceCatalogSplit(args.slice(2));
      return;
    case "references:make-catalog":
      await makeReferenceCatalogFromText(args.slice(2));
      return;
    case "references:discover-citation-led":
      await discoverCitationLedReferences(args.slice(2));
      return;
    case "references:prepare-catalog":
      await prepareReferenceCatalog(args.slice(2));
      return;
    case "references:curate-recent":
      await curateRecentReferences(args.slice(2));
      return;
    case "references:source-status":
      await referenceSourceStatus(args.slice(2));
      return;
    case "references:create-accession-assignments":
      await createReferenceAccessionAssignments(args.slice(2));
      return;
    case "references:accession-now":
      await accessionReferenceNow(args.slice(2));
      return;
    case "references:extract-text-now":
      await extractReferenceTextNow(args.slice(2));
      return;
    case "references:attach-extracted-text":
      await attachExtractedTextReferences(args.slice(2));
      return;
    case "references:create-doi-backfill-assignment":
      await createReferenceDoiBackfillAssignment(args.slice(2));
      return;
    case "references:doi-backfill-now":
      await runReferenceDoiBackfillNow(args.slice(2));
      return;
    case "references:execute-doi-backfill":
      await executeReferenceDoiBackfillAssignment(args.slice(2));
      return;
    case "references:create-identifier-backfill-assignment":
      await createReferenceIdentifierBackfillAssignment(args.slice(2));
      return;
    case "references:identifier-backfill-now":
      await runReferenceIdentifierBackfillNow(args.slice(2));
      return;
    case "references:execute-identifier-backfill":
      await executeReferenceIdentifierBackfillAssignment(args.slice(2));
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
    case "assignments:create-research":
      await createResearchAssignment(args.slice(2));
      return;
    case "assignments:run-research":
      await runResearchAssignment(args.slice(2));
      return;
    case "assignments:apply-research-packet":
      await applyResearchPacket(args.slice(2));
      return;
    case "assignments:intake-proposals":
      await intakeAssignmentResearchProposals(args.slice(2));
      return;
    case "assignments:research-intake-now":
      await runResearchIntakeNow(args.slice(2));
      return;
    case "assignments:run-story-cycle":
      await runStoryCycle(args.slice(2));
      return;
    case "assignments:story-cycle-output":
      await showStoryCycleOutput(args.slice(2));
      return;
    case "assignments:orphan-research-packets":
      await listOrphanResearchPackets(args.slice(2));
      return;
    case "assignments:backfill-section-indexes":
      await backfillAssignmentSectionIndexes(args.slice(2));
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
    case "assignments:review-reporting-packet":
      await reviewReportingPacket(args.slice(2));
      return;
    case "assignments:run-copywriting":
      await runCopywritingAssignment(args.slice(2));
      return;
    case "assignments:copywriting-output":
      await showCopywritingOutput(args.slice(2));
      return;
    case "assignments:events":
      await listAssignmentEvents(args.slice(2));
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
    case "analysis:graph-artifacts":
      await listGraphArtifacts(args.slice(2));
      return;
    case "analysis:import-graph-artifact":
      await importGraphArtifact(args.slice(2));
      return;
    case "newsroom:recount-summary":
      await recountNewsroomSummary(args.slice(2));
      return;
    case "newsroom:prune-attachments":
      await pruneModelAttachments(args.slice(2));
      return;
    case "newsroom:backfill-feed-fields":
      await backfillNewsroomFeedFields(args.slice(2));
      return;
    case "newsroom:backfill-operational-indexes":
      await backfillOperationalIndexes(args.slice(2));
      return;
    case "newsroom:import-sections":
      await importNewsroomSections(args.slice(2));
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
    case "editions:dispatch-reporting":
      await dispatchEditionReporting(args.slice(2));
      return;
    case "editions:purge":
      await purgeEditions(args.slice(2));
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

let requiredProcedureConfigCache = null;

function loadRequiredCliProcedureConfig() {
  if (requiredProcedureConfigCache) return requiredProcedureConfigCache;
  const parsed = JSON.parse(fs.readFileSync(REQUIRED_PROCEDURES_CONFIG_PATH, "utf8"));
  const requiredCliProcedures = parsed?.requiredCliProcedures;
  if (!requiredCliProcedures || typeof requiredCliProcedures !== "object") {
    throw new Error(`Invalid required procedures config at ${REQUIRED_PROCEDURES_CONFIG_PATH}.`);
  }
  requiredProcedureConfigCache = {
    map: requiredCliProcedures,
    keys: Array.from(new Set(Object.values(requiredCliProcedures).map((value) => String(value ?? "").trim()).filter(Boolean))),
  };
  return requiredProcedureConfigCache;
}

function requiredProcedureKeyFor(alias) {
  const config = loadRequiredCliProcedureConfig();
  const key = config.map[alias];
  const normalized = String(key ?? "").trim();
  if (!normalized) throw new Error(`Required procedure alias '${alias}' is not configured in ${REQUIRED_PROCEDURES_CONFIG_PATH}.`);
  return normalized;
}

function normalizeGraphqlJsonValue(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

async function getCloudProcedureDefinitionByKey(client, procedureKey) {
  const data = await client.graphql(GET_PROCEDURE_DEFINITION_QUERY, { procedureKey });
  const definition = normalizeGraphqlJsonValue(data?.getNewsroomProcedureDefinition);
  if (!definition || typeof definition !== "object" || !definition.id) return null;
  return definition;
}

function missingRequiredProcedureError(alias, procedureKey) {
  return new Error(
    `Missing required cloud procedure '${procedureKey}' for ${alias}. Run npm run seed:amplify to preload standard procedures.`,
  );
}

function currentCloudProcedureVersion(definition) {
  const current = normalizeGraphqlJsonValue(definition?.currentVersion);
  if (current && typeof current === "object" && current.id) return current;
  const versions = Array.isArray(definition?.versions) ? definition.versions.map(normalizeGraphqlJsonValue) : [];
  return versions.find((version) => version?.id && version.id === definition.currentVersionId)
    ?? versions.find((version) => version?.isCurrent)
    ?? versions[0]
    ?? null;
}

function cloudProcedureSourceOrThrow(alias, procedureKey, version) {
  const source = typeof version?.tactusSource === "string" ? version.tactusSource.trim() : "";
  if (!source) {
    throw new Error(`Cloud procedure '${procedureKey}' for ${alias} has no Tactus source. Run npm run seed:amplify to preload standard procedures.`);
  }
  if (!/\bProcedure\s*\{/m.test(source)) {
    throw new Error(`Cloud procedure '${procedureKey}' for ${alias} does not contain executable Tactus Procedure source. Run npm run seed:amplify to refresh stale procedure seeds.`);
  }
  return `${source}\n`;
}

function tactusParamValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (typeof value === "object") return encodeInlineAssignmentParam(value);
  return String(value);
}

function normalizeCloudProcedureInput(input) {
  return Object.fromEntries(
    Object.entries(input ?? {}).filter(([, value]) => value !== undefined && value !== null),
  );
}

function cloudProcedureTactusCommand(sourcePath, input) {
  const params = [];
  for (const [key, value] of Object.entries(input ?? {})) {
    const encoded = tactusParamValue(value);
    if (encoded === undefined) continue;
    params.push("--param", `${key}=${encoded}`);
  }
  return [
    "tactus",
    "run",
    sourcePath,
    "--no-sandbox",
    "--real-all",
    ...params,
    "--log-format",
    "raw",
  ];
}

async function updateCloudProcedureRunRecord(client, input) {
  const data = await client.graphql(UPDATE_PROCEDURE_RUN_MUTATION, {
    input: {
      id: input.id,
      runStatus: input.runStatus,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      resultSummary: input.resultSummary ?? null,
      errorSummary: input.errorSummary ?? null,
      output: input.output === undefined || input.output === null ? null : JSON.stringify(input.output),
      error: input.error === undefined || input.error === null ? null : JSON.stringify(input.error),
      attempt: input.attempt ?? null,
    },
  });
  return normalizeGraphqlJsonValue(data?.updateProcedureRun);
}

async function startCloudProcedureRun({ client, alias, actorLabel, title, summary, input, runDir, stdoutPath, stderrPath, sourcePath }) {
  const procedureKey = requiredProcedureKeyFor(alias);
  const procedureInput = normalizeCloudProcedureInput(input);
  let definition = null;
  try {
    definition = await getCloudProcedureDefinitionByKey(client, procedureKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (message.toLowerCase().includes("not found")) throw missingRequiredProcedureError(alias, procedureKey);
    throw error;
  }
  if (!definition) throw missingRequiredProcedureError(alias, procedureKey);
  const version = currentCloudProcedureVersion(definition);
  if (!version?.id) throw new Error(`Cloud procedure '${procedureKey}' has no current version. Run npm run seed:amplify to preload standard procedures.`);
  const tactusSource = cloudProcedureSourceOrThrow(alias, procedureKey, version);
  const startData = await client.graphql(START_PROCEDURE_RUN_MUTATION, {
    procedureKey,
    procedureVersionId: version.id,
    title,
    summary,
    actorLabel: actorLabel ?? null,
    input: JSON.stringify({
      ...procedureInput,
      __papyrusExecutionMode: "external_cli",
    }),
  });
  const started = normalizeGraphqlJsonValue(startData?.startNewsroomProcedureRun);
  const runId = normalizeCliString(started?.runId);
  if (!runId) {
    throw new Error(`Cloud procedure '${procedureKey}' did not return runId.`);
  }
  const startedAt = new Date().toISOString();
  const effectiveRunDir = runDir ?? path.join(process.cwd(), ".papyrus-runs", runId);
  const effectiveSourcePath = sourcePath ?? path.join(effectiveRunDir, `${safeId(procedureKey)}.cloud.tac`);
  const effectiveStdoutPath = stdoutPath ?? path.join(effectiveRunDir, `${safeId(procedureKey)}.stdout.log`);
  const effectiveStderrPath = stderrPath ?? path.join(effectiveRunDir, `${safeId(procedureKey)}.stderr.log`);
  fs.mkdirSync(path.dirname(effectiveSourcePath), { recursive: true });
  fs.mkdirSync(path.dirname(effectiveStdoutPath), { recursive: true });
  fs.mkdirSync(path.dirname(effectiveStderrPath), { recursive: true });
  fs.writeFileSync(effectiveSourcePath, tactusSource, "utf8");
  const command = cloudProcedureTactusCommand(effectiveSourcePath, procedureInput);
  const proc = await spawnBuffered(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONPATH: prependPathList(["../Tactus", "src"], process.env.PYTHONPATH),
    },
  });
  fs.writeFileSync(effectiveStdoutPath, proc.stdout ?? "", "utf8");
  fs.writeFileSync(effectiveStderrPath, proc.stderr ?? "", "utf8");
  const finishedAt = new Date().toISOString();
  const parsed = extractResearchRunPayload(proc.stdout);
  const executionOutput = parsed && typeof parsed === "object"
    ? {
      procedureKey,
      procedureVersionId: version.id,
      procedureVersionNumber: version.versionNumber ?? null,
      executedAt: finishedAt,
      mode: "cli_tactus_source",
      source: "ProcedureVersion.tactusSource",
      input: procedureInput,
      ...parsed,
    }
    : null;
  const error = proc.status === 0 && executionOutput
    ? null
    : {
      message: proc.status === 0 ? "Tactus procedure completed without a JSON procedure payload." : `Tactus procedure exited with status ${proc.status}.`,
      exitStatus: proc.status,
      signal: proc.signal ?? null,
      stdoutPath: effectiveStdoutPath,
      stderrPath: effectiveStderrPath,
    };
  const updated = await updateCloudProcedureRunRecord(client, {
    id: runId,
    runStatus: error ? "failed" : "completed",
    startedAt,
    finishedAt,
    resultSummary: error ? null : `Completed cloud Tactus procedure ${procedureKey} v${version.versionNumber ?? ""}.`,
    errorSummary: error?.message ?? null,
    output: executionOutput,
    error,
    attempt: 1,
  });
  return {
    ...(updated ?? {}),
    id: runId,
    procedureKey,
    procedureVersionId: version.id,
    procedureVersionNumber: version.versionNumber ?? null,
    runStatus: error ? "failed" : "completed",
    output: executionOutput,
    error,
    exitStatus: proc.status,
    signal: proc.signal ?? null,
    commandLine: command,
    sourcePath: effectiveSourcePath,
    stdoutPath: effectiveStdoutPath,
    stderrPath: effectiveStderrPath,
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

async function checkGraphqlSchema(flags) {
  const options = parseOptions(flags);
  const typeName = normalizeCliString(options.type) ?? "Assignment";
  const requiredFields = parseCommaList(options.fields) ?? parseCommaList(options.field) ?? [];
  const { client } = createAuthoringClient();
  const fields = await graphqlTypeFieldNames(client, typeName);
  const missing = requiredFields.filter((field) => !fields.includes(field));
  console.log(`schema-check\ttype\t${typeName}`);
  console.log(`schema-check\tfields\t${fields.length}`);
  if (requiredFields.length) console.log(`schema-check\trequired\t${requiredFields.join(",")}`);
  if (missing.length) {
    console.log(`schema-check\tmissing\t${missing.join(",")}`);
    process.exitCode = 1;
    return;
  }
  console.log("schema-check\tok\ttrue");
}

async function graphqlTypeFieldNames(client, typeName) {
  const result = await client.graphql(`
    query PapyrusSchemaCheck($type: String!) {
      __type(name: $type) {
        name
        fields { name }
      }
    }
  `, { type: typeName });
  const type = result.__type;
  if (!type) throw new Error(`GraphQL type '${typeName}' was not found.`);
  return (type.fields ?? []).map((field) => field.name).sort();
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

  const options = parseOptions(flags.filter((flag) => flag !== "--yes"));
  const { client } = createAuthoringClient();
  const result = await deleteAllContent(client, {
    deleteAttachments: Boolean(options["delete-attachments"] ?? options["purge-attachments"]),
    bucket: normalizeCliString(options.bucket),
  });
  if (options.json) {
    printCompactJson(deleteAllJsonResult(result));
  } else {
    printDeleteSummary(result);
  }
}

async function corpusStatus(flags) {
  const options = parseOptions(flags);
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpora = selectedCorpusConfigs(steeringConfig, options["corpus-key"]);
  const { endpoint, client } = createAuthoringClient();
  const graphState = await loadCorpusGraphState(client);
  const statuses = corpora.map((corpus) => buildCorpusStatus(corpus, {
    graphState,
    endpoint,
    force: Boolean(options.force),
  }));
  const payload = {
    ok: statuses.every((status) => status.readiness.readyForWorker),
    command: "corpora status",
    endpoint,
    expectedBucket: storageBucketFromAmplifyOutputsLocal(),
    configPath: steeringConfig.configPath,
    corpora: statuses,
  };
  if (options.json) {
    printCompactJson(payload);
  } else {
    printCorpusStatus(payload);
  }
}

async function corpusWorkerBootstrap(flags) {
  const options = parseOptions(flags);
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpora = selectedCorpusConfigs(steeringConfig, options["corpus-key"]);
  const { endpoint, client } = createAuthoringClient();
  const graphState = await loadCorpusGraphState(client);
  const statuses = corpora.map((corpus) => buildCorpusStatus(corpus, {
    graphState,
    endpoint,
    force: Boolean(options.force),
  }));
  const payload = {
    ok: statuses.every((status) => status.target.ok && status.local.exists),
    command: "corpora worker-bootstrap",
    endpoint,
    expectedBucket: storageBucketFromAmplifyOutputsLocal(),
    configPath: steeringConfig.configPath,
    corpora: statuses.map((status) => ({
      ...status,
      next: nextCorpusBootstrapCommand(status),
    })),
  };
  if (options.json) {
    printCompactJson(payload);
  } else {
    printCorpusWorkerBootstrap(payload);
  }
}

async function syncCorpusFromCloud(flags) {
  const options = parseOptions(flags);
  if (!options["corpus-key"]) throw new Error("corpora sync-from-cloud requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpus = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const plan = buildCorpusSyncPlan(corpus, { direction: "from-cloud", options });
  runOrPrintCorpusSyncPlan(plan, options);
}

async function syncCorpusToCloud(flags) {
  const options = parseOptions(flags);
  if (!options["corpus-key"]) throw new Error("corpora sync-to-cloud requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpus = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const plan = buildCorpusSyncPlan(corpus, { direction: "to-cloud", options });
  runOrPrintCorpusSyncPlan(plan, options);
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

async function importNewsroomSections(flags) {
  const options = parseOptions(flags);
  const configPath = options.config || DEFAULT_NEWSROOM_SECTIONS_PATH;
  const sections = loadNewsroomSectionSeeds(configPath);
  const { client } = createAuthoringClient();
  const records = buildNewsroomSectionRecords(sections);
  const changes = [];
  for (const record of records) {
    const action = await client.putById(record.modelName, record.expected);
    changes.push({ ...record, action });
  }
  printCategoryImportSummary("newsroom-sections", path.basename(configPath), changes);
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
  const { client } = createAuthoringClient();
  const result = await planReferenceCatalogRegistration(client, {
    catalogPath: options.catalog,
    configPath: options.config,
    corpusKey: options["corpus-key"],
    classifier: options.classifier,
    status: options.status,
    reasonCode: options["reason-code"] ?? options.reasonCode,
    note: options.note,
    ingestionRationale: options["ingestion-rationale"] ?? options.ingestionRationale,
    actor: options.actor ?? "Papyrus content CLI",
    skipExisting: options["skip-existing"],
    apply: Boolean(options.apply),
    quiet: Boolean(options.json),
  });
  printReferenceRegistrationSummary(result.plan, result.changes, { apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("references\tregister-catalog\tapply\tskipped\tpass --apply to write Reference visibility records");
    return;
  }
  const vectorSync = await applyReferenceCatalogRegistration(client, result);
  for (const line of vectorSync.lines || []) console.log(line);
}

async function planReferenceCatalogRegistration(client, options) {
  const startedAt = Date.now();
  const status = normalizeReferenceCurationStatus(options.status, "pending");
  const reasonCode = normalizeReferenceRejectionReasonCode(options.reasonCode, { required: status === "rejected" });
  const targetedRegistration = Boolean(options.targeted);
  const diagnostics = {
    registrationMode: targetedRegistration ? "targeted" : "scan",
    fetchedByModel: {},
    elapsedMs: 0,
  };
  const steeringConfig = loadSteeringConfig({ configPath: options.configPath });
  const corpusConfig = requireCorpusConfig(steeringConfig, options.corpusKey, "--corpus-key");
  const sourceCatalog = await maybeEnrichReferenceCatalogTitleSubtitle({
    catalog: options.catalog ?? loadJsonFile(options.catalogPath),
    catalogPath: options.catalogPath,
    options,
    persist: Boolean(options.apply && options.catalogPath),
  });
  const catalog = {
    ...sourceCatalog,
    items: [...catalogItemsForSummary(sourceCatalog)],
  };
  const planOptions = {
    corpusConfig,
    corpusId: knowledgeCorpusId(corpusConfig),
    classifierId: options.classifier ?? resolveClassifierForCorpus(steeringConfig, corpusConfig),
    status,
    reasonCode,
    note: options.note,
    ingestionRationale: options.ingestionRationale,
    actor: options.actor ?? "Papyrus content CLI",
  };

  let skippedDuplicateCount = 0;
  const skipExisting = targetedRegistration
    ? false
    : options.skipExisting === undefined
    ? true
    : String(options.skipExisting).toLowerCase() !== "false";
  if (skipExisting) {
    const existingReferences = await client.listRecords("Reference");
    diagnostics.fetchedByModel.Reference = existingReferences.length;
    const existingExternalIds = new Set(
      existingReferences
        .filter((ref) => ref.corpusId === planOptions.corpusId)
        .map((ref) => ref.externalItemId)
        .filter(Boolean),
    );
    const items = catalogItemsForSummary(catalog);
    const filtered = items.filter((item) => {
      const externalItemId = item.item_id ?? item.externalItemId ?? item.id;
      return externalItemId ? !existingExternalIds.has(externalItemId) : true;
    });
    skippedDuplicateCount = items.length - filtered.length;
    if (skippedDuplicateCount && !options.quiet) {
      console.log(`references\tregister-catalog\tskip-existing\t${skippedDuplicateCount} duplicates`);
    }
    catalog.items = filtered;
  }

  let plan = buildReferenceCatalogRegistrationRecords(catalog, planOptions);
  // If we have already registered this exact batch, reuse its importedAt timestamp so reruns are true noops.
  const existingRun = await client.getRecord("KnowledgeImportRun", plan.importRunId);
  if (existingRun?.importedAt) {
    plan = buildReferenceCatalogRegistrationRecords(catalog, {
      ...planOptions,
      importedAt: existingRun.importedAt,
    });
  }
  // The raw catalog snapshot is a write-once transparency artifact for the import run.
  // If it already exists, do not update it on reruns (avoid noisy diffs as snapshot compaction evolves).
  if (existingRun) {
    const rawPayloadRecord = plan.records.find((entry) => entry.modelName === "KnowledgeRawPayload");
    if (rawPayloadRecord?.expected?.id) {
      const existingPayload = await client.getRecord("KnowledgeRawPayload", rawPayloadRecord.expected.id);
      if (existingPayload) {
        plan.records = plan.records.filter((entry) => !(entry.modelName === "KnowledgeRawPayload" && entry.expected.id === rawPayloadRecord.expected.id));
      }
    }
  }
  assertReferenceCatalogPlanSafety(plan);
  const changes = targetedRegistration
    ? await buildRecordChangesTargetedByIdToleratingOptionalModels(client, plan.records, {
      prepareVersioned: false,
      diagnostics,
    })
    : await buildRecordChangesToleratingOptionalModels(client, plan.records);
  diagnostics.elapsedMs = Date.now() - startedAt;
  return {
    plan,
    changes,
    corpusConfig,
    corpusId: planOptions.corpusId,
    status,
    reasonCode,
    skippedDuplicateCount,
    diagnostics,
    options,
  };
}

async function applyReferenceCatalogRegistration(client, result) {
  await applyRecordChanges(client, result.changes);
  if (result.changes.some((record) => record.action !== "noop")) {
    await updateNewsroomSummaryAfterReferenceRegistration(client, result.changes, result.plan);
  }
  return syncReferenceVectorsAfterRegistration(result, { options: result.options ?? {} });
}

function changedReferenceIdsFromChanges(changes = []) {
  return Array.from(new Set(
    (changes || [])
      .filter((change) => change?.modelName === "Reference")
      .filter((change) => change.action === "create" || change.action === "update")
      .map((change) => change.expected?.lineageId || change.expected?.id)
      .filter(Boolean),
  ));
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function syncReferenceVectorsAfterRegistration(result, { options = {} } = {}) {
  const vectorSyncEnabled = parseBooleanOption(options["vector-sync"], true, "--vector-sync");
  const referenceIds = changedReferenceIdsFromChanges(result?.changes);
  const lines = [];
  if (!vectorSyncEnabled) {
    const payload = {
      requested: referenceIds.length,
      synced: 0,
      skipped: referenceIds.length,
      failed: 0,
      skippedReason: "vector_sync_disabled",
      results: [],
    };
    lines.push("references\tvector-sync\tdisabled");
    return { payload, lines };
  }
  if (!referenceIds.length) {
    const payload = {
      requested: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      skippedReason: "no_graphql_reference_changes",
      results: [],
    };
    lines.push("references\tvector-sync\tskipped\tno GraphQL Reference changes");
    return { payload, lines };
  }
  const batches = chunkValues(referenceIds, 100);
  const payload = {
    requested: referenceIds.length,
    synced: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };
  for (const batch of batches) {
    const args = [
      "run",
      "papyrus-newsroom",
      "knowledge-vector-index",
      "--action",
      "sync",
      "--force",
      "--progress-every",
      "0",
    ];
    for (const referenceId of batch) args.push("--reference-id", referenceId);
    const run = spawnSync("poetry", args, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      env: process.env,
    });
    let stdoutPayload = null;
    if (run.stdout && run.stdout.trim()) {
      try {
        stdoutPayload = JSON.parse(run.stdout);
      } catch {
        stdoutPayload = null;
      }
    }
    if (run.status !== 0) {
      const nextSuggestedCommand = `poetry run papyrus-newsroom knowledge-vector-index --action sync --force --progress-every 0 ${batch.map((referenceId) => `--reference-id ${referenceId}`).join(" ")}`.trim();
      const errorMessage = stdoutPayload?.message
        || run.stderr?.trim()
        || run.stdout?.trim()
        || "Unknown vector sync failure";
      payload.failed += batch.length;
      payload.results.push({
        referenceIds: batch,
        failed: true,
        message: errorMessage,
        nextSuggestedCommand,
      });
      lines.push(`references\tvector-sync\tfailed\t${batch.length}\t${errorMessage}`);
      lines.push(`references\tvector-sync\tnext\t${nextSuggestedCommand}`);
      const error = new Error(`Reference registration updated local/GraphQL state but vector sync failed. Retry with: ${nextSuggestedCommand}. ${errorMessage}`);
      error.vectorSync = payload;
      throw error;
    }
    const referenceResults = Array.isArray(stdoutPayload?.referenceResults) ? stdoutPayload.referenceResults : [];
    const indexed = referenceResults.filter((entry) => entry?.status === "indexed").length;
    const skipped = Math.max(batch.length - indexed, 0);
    payload.synced += indexed;
    payload.skipped += skipped;
    payload.results.push({
      referenceIds: batch,
      synced: indexed,
      skipped,
      payload: stdoutPayload,
    });
    lines.push(`references\tvector-sync\tsynced\t${indexed}\tskipped\t${skipped}`);
  }
  return { payload, lines };
}

function inferReferenceCorpusBucket(item) {
  const sourceUri = normalizeCliString(item.source_uri ?? item.sourceUri ?? item.url ?? item.uri) ?? "";
  const mediaType = normalizeCliString(item.media_type ?? item.mediaType) ?? "";
  let host = "";
  let pathname = "";
  try {
    const parsed = new URL(sourceUri);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    // ignore
  }
  const uri = sourceUri.toLowerCase();

  if (mediaType === "application/pdf" || uri.endsWith(".pdf") || pathname.endsWith(".pdf")) return "research";

  // Common scholarly sources / paper landing pages.
  if (host === "arxiv.org") return "research";
  if (host === "aclanthology.org") return "research";
  if (host === "openreview.net") return "research";
  if (host === "proceedings.neurips.cc" || host === "neurips.cc") return "research";
  if (host === "dl.acm.org" || host === "doi.org") return "research";
  if (host.endsWith(".ijcai.org") || host === "www.ijcai.org") return "research";
  if (host === "pmc.ncbi.nlm.nih.gov" || host.endsWith("pubmed.ncbi.nlm.nih.gov")) return "research";
  if (host === "drops.dagstuhl.de") return "research";
  if (host.endsWith("nature.com") && pathname.includes("/articles/")) return "research";
  if (host === "www.science.org" && pathname.includes("/doi/")) return "research";
  if (host.endsWith("sciencedirect.com") && pathname.includes("/science/article")) return "research";
  if (host.endsWith("tandfonline.com") && pathname.includes("/doi/")) return "research";
  if (host.endsWith("frontiersin.org") && pathname.includes("/articles/")) return "research";

  // Everything else defaults to news / non-canonical sources.
  return "news";
}

async function registerReferenceCatalogSplit(flags) {
  const options = parseOptions(flags);
  if (!options.catalog) throw new Error("references register-catalog-split requires --catalog <catalog.json>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const researchCorpusKey = options["research-corpus-key"] ?? steeringConfig.canonicalTopicSet?.corpusKey ?? "AI-ML-research";
  const newsCorpusKey = options["news-corpus-key"] ?? "AI-ML-journalism";
  const status = normalizeReferenceCurationStatus(options.status, "pending");
  const reasonCode = normalizeReferenceRejectionReasonCode(options["reason-code"] ?? options.reasonCode, { required: status === "rejected" });
  const catalog = await maybeEnrichReferenceCatalogTitleSubtitle({
    catalog: loadJsonFile(options.catalog),
    catalogPath: options.catalog,
    options,
    persist: Boolean(options.apply),
  });
  const items = catalogItemsForSummary(catalog);
  const researchItems = [];
  const newsItems = [];
  for (const item of items) {
    (inferReferenceCorpusBucket(item) === "research" ? researchItems : newsItems).push(item);
  }

  const preparedCatalog = { ...catalog, items };
  const { client } = createAuthoringClient();
  const skipExisting = options["skip-existing"] === undefined
    ? true
    : String(options["skip-existing"]).toLowerCase() !== "false";
  let existingByCorpusId = null;
  if (skipExisting) {
    const existingReferences = await client.listRecords("Reference");
    existingByCorpusId = new Map();
    for (const ref of existingReferences) {
      if (!ref?.corpusId || !ref?.externalItemId) continue;
      const bucket = existingByCorpusId.get(ref.corpusId) ?? new Set();
      bucket.add(ref.externalItemId);
      existingByCorpusId.set(ref.corpusId, bucket);
    }
  }

  const plans = [];
  for (const [bucket, corpusKey, bucketItems] of [
    ["research", researchCorpusKey, researchItems],
    ["news", newsCorpusKey, newsItems],
  ]) {
    if (!bucketItems.length) continue;
    const corpusConfig = requireCorpusConfig(steeringConfig, corpusKey, `--${bucket}-corpus-key`);
    const corpusId = knowledgeCorpusId(corpusConfig);
    const filteredItems = skipExisting && existingByCorpusId
      ? bucketItems.filter((item) => {
        const externalItemId = item.item_id ?? item.externalItemId ?? item.id;
        return externalItemId ? !(existingByCorpusId.get(corpusId)?.has(externalItemId)) : true;
      })
      : bucketItems;
    if (!filteredItems.length) {
      console.log(`references\tregister-catalog-split\tskip-existing\tbucket\t${bucket}\t0 new items`);
      continue;
    }
    if (filteredItems.length !== bucketItems.length) {
      console.log(`references\tregister-catalog-split\tskip-existing\tbucket\t${bucket}\t${bucketItems.length - filteredItems.length} duplicates`);
    }
    const prepared = buildPreparedReferenceCatalog({ ...preparedCatalog, items: filteredItems }, {
      corpusConfig,
      corpusKey,
      steeringConfig,
      publicationName: steeringConfig.publication?.name,
    });
    const planOptions = {
      corpusConfig,
      corpusId,
      classifierId: options.classifier ?? resolveClassifierForCorpus(steeringConfig, corpusConfig),
      status,
      reasonCode,
      note: options.note,
      ingestionRationale: options["ingestion-rationale"] ?? options.ingestionRationale,
      actor: options.actor ?? "Papyrus content CLI",
    };

    let plan = buildReferenceCatalogRegistrationRecords(prepared, planOptions);
    const existingRun = await client.getRecord("KnowledgeImportRun", plan.importRunId);
    if (existingRun?.importedAt) {
      plan = buildReferenceCatalogRegistrationRecords(prepared, {
        ...planOptions,
        importedAt: existingRun.importedAt,
      });
    }
    if (existingRun) {
      const rawPayloadRecord = plan.records.find((entry) => entry.modelName === "KnowledgeRawPayload");
      if (rawPayloadRecord?.expected?.id) {
        const existingPayload = await client.getRecord("KnowledgeRawPayload", rawPayloadRecord.expected.id);
        if (existingPayload) {
          plan.records = plan.records.filter((entry) => !(entry.modelName === "KnowledgeRawPayload" && entry.expected.id === rawPayloadRecord.expected.id));
        }
      }
    }
    assertReferenceCatalogPlanSafety(plan);
    plans.push({ bucket, corpusKey, plan });
  }

  if (!plans.length) {
    console.log("references\tregister-catalog-split\t0 items");
    return;
  }

  const apply = Boolean(options.apply);
  for (const entry of plans) {
    const changes = await buildRecordChangesToleratingOptionalModels(client, entry.plan.records);
    console.log(`references\tregister-catalog-split\tbucket\t${entry.bucket}\tcorpus\t${entry.corpusKey}\titems\t${entry.plan.itemCount}\tapply\t${apply ? "yes" : "no"}`);
    printReferenceRegistrationSummary(entry.plan, changes, { apply });
    if (!apply) continue;
    await applyRecordChanges(client, changes);
    await updateNewsroomSummaryAfterReferenceRegistration(client, changes, entry.plan);
    const vectorSync = syncReferenceVectorsAfterRegistration({ changes, options });
    for (const line of vectorSync.lines || []) console.log(line);
  }
}

async function makeReferenceCatalogFromText(flags) {
  const options = parseOptions(flags);
  if (!options.input) throw new Error("references make-catalog requires --input <sources.txt|sources.md>.");
  if (!options.output) throw new Error("references make-catalog requires --output <catalog.json>.");

  const text = fs.readFileSync(options.input, "utf8");
  const lines = text.split(/\r?\n/);
  const urlRegex = /(https?:\/\/[^\s)]+)(?:\))?/g;

  const seen = new Set();
  const items = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const matches = [...line.matchAll(urlRegex)].map((match) => match[1]);
    if (!matches.length) continue;
    for (const url of matches) {
      const normalizedUrl = String(url ?? "").trim();
      if (!normalizedUrl || seen.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);

      const before = line.split(normalizedUrl)[0] ?? "";
      const title = before
        .replace(/^[\\s>*-]+/, "")
        .replace(/^\\d+\\.\\s+/, "")
        .replace(/\\s*—\\s*$/, "")
        .replace(/\\s*:\\s*$/, "")
        .trim() || null;

      const id = `web-${hashShort(normalizedUrl)}`;
      items.push({
        id,
        item_id: id,
        title,
        source_uri: normalizedUrl,
      });
    }
  }

  writeJsonFile(options.output, {
    schema_version: 1,
    catalog_kind: "papyrus-reference-intake",
    generated_at: options["generated-at"] ?? new Date().toISOString(),
    items,
  });
  console.log(`references\tmake-catalog\t${options.output}\t${items.length} items`);
}

async function discoverCitationLedReferences(flags) {
  const options = parseOptions(flags);
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const anchorCorpusKey = options["anchor-corpus-key"]
    ?? options["corpus-key"]
    ?? steeringConfig.canonicalTopicSet?.corpusKey
    ?? "AI-ML-research";
  const anchorCorpus = requireCorpusConfig(steeringConfig, anchorCorpusKey, "--anchor-corpus-key");
  const anchorCorpusPath = path.resolve(anchorCorpus.path);
  const queryTerms = parseRepeatedOption(flags, "query");
  const discovery = await runCitationLedDiscovery({
    runId: normalizeCliString(options["run-id"]),
    anchorCorpusPath,
    fromYear: normalizeCliNonNegativeInteger(options["from-year"], "--from-year") ?? 2023,
    toYear: normalizeCliNonNegativeInteger(options["to-year"], "--to-year") ?? 2026,
    anchorLimit: normalizeCliPositiveInteger(options["anchor-limit"], "--anchor-limit") ?? 40,
    citationsPerAnchor: normalizeCliPositiveInteger(options["citations-per-anchor"], "--citations-per-anchor") ?? 12,
    feedLimit: normalizeCliPositiveInteger(options["feed-limit"], "--feed-limit") ?? 20,
    queryTerms: queryTerms.length ? queryTerms : DEFAULT_QUERY_TERMS,
  });

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.copyFileSync(discovery.files.rankedCatalog, options.output);
  }

  console.log(`references\tdiscover-citation-led\trun-id\t${discovery.runId}`);
  console.log(`references\tdiscover-citation-led\tanchors\t${discovery.anchorsCount}`);
  console.log(`references\tdiscover-citation-led\traw\t${discovery.rawCount}`);
  console.log(`references\tdiscover-citation-led\tscored\t${discovery.scoredCount}`);
  console.log(`references\tdiscover-citation-led\tranked\t${discovery.rankedCount}`);
  console.log(`references\tdiscover-citation-led\tresearch\t${discovery.report.counts_by_route_corpus["AI-ML-research"] ?? 0}`);
  console.log(`references\tdiscover-citation-led\tjournalism\t${discovery.report.counts_by_route_corpus["AI-ML-journalism"] ?? 0}`);
  console.log(`references\tdiscover-citation-led\thigh\t${discovery.report.counts_by_confidence_tier.high ?? 0}`);
  console.log(`references\tdiscover-citation-led\tmedium\t${discovery.report.counts_by_confidence_tier.medium ?? 0}`);
  console.log(`references\tdiscover-citation-led\tlow\t${discovery.report.counts_by_confidence_tier.low ?? 0}`);
  console.log(`references\tdiscover-citation-led\terrors\t${discovery.report.totals.errors}`);
  console.log(`references\tdiscover-citation-led\tanchors-file\t${discovery.files.anchors}`);
  console.log(`references\tdiscover-citation-led\traw-file\t${discovery.files.raw}`);
  console.log(`references\tdiscover-citation-led\tscored-file\t${discovery.files.scored}`);
  console.log(`references\tdiscover-citation-led\tranked-file\t${discovery.files.rankedCatalog}`);
  console.log(`references\tdiscover-citation-led\treport-file\t${discovery.files.report}`);
  if (options.output) {
    console.log(`references\tdiscover-citation-led\toutput\t${options.output}`);
  }
}

async function prepareReferenceCatalog(flags) {
  const options = parseOptions(flags);
  if (!options.catalog) throw new Error("references prepare-catalog requires --catalog <catalog.json>.");
  if (!options.output) throw new Error("references prepare-catalog requires --output <prepared-catalog.json>.");
  if (!options["corpus-key"]) throw new Error("references prepare-catalog requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const catalog = await maybeEnrichReferenceCatalogTitleSubtitle({
    catalog: loadJsonFile(options.catalog),
    catalogPath: options.catalog,
    options,
    persist: false,
  });
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

async function curateRecentReferences(flags) {
  const options = parseOptions(flags);
  const references = parseRepeatedOption(flags, "reference");
  const apply = parseBooleanOption(options.apply, false, "--apply");
  const dryRun = parseBooleanOption(options["dry-run"], false, "--dry-run");
  const jsonOutput = parseBooleanOption(options.json, false, "--json");
  if (apply && dryRun) throw new Error("references curate-recent does not allow --apply with --dry-run.");
  if (!options["corpus-key"]) throw new Error("references curate-recent requires --corpus-key <key>.");

  const args = [
    "references",
    "curate-recent",
    "--corpus-key",
    options["corpus-key"],
    "--model",
    normalizeCliString(options.model) ?? "gpt-5.4-mini",
    "--summary-max-tokens",
    String(normalizeCliPositiveInteger(options["summary-max-tokens"], "--summary-max-tokens") ?? 500),
    "--since-hours",
    String(normalizeCliNonNegativeInteger(options["since-hours"], "--since-hours") ?? 48),
    "--max-count",
    String(normalizeCliNonNegativeInteger(options["max-count"], "--max-count") ?? 0),
    "--scan-limit",
    String(normalizeCliPositiveInteger(options["scan-limit"], "--scan-limit") ?? 1000),
    "--max-parallel",
    String(normalizeCliPositiveInteger(options["max-parallel"], "--max-parallel") ?? 1),
  ];
  const since = normalizeCliString(options.since);
  if (since) args.push("--since", since);
  const resume = normalizeCliString(options.resume);
  if (resume) args.push("--resume", resume);
  for (const referenceId of references) args.push("--reference", referenceId);
  if (parseBooleanOption(options["refresh-summary"], false, "--refresh-summary")) args.push("--refresh-summary");
  if (parseBooleanOption(options["refresh-quality"], false, "--refresh-quality")) args.push("--refresh-quality");
  if (apply && !dryRun) args.push("--apply");
  if (dryRun) args.push("--dry-run");

  const result = spawnSync("poetry", ["run", "papyrus-newsroom", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const payload = extractLastJsonObject(result.stdout || "");
  if (!payload || typeof payload !== "object") {
    throw new Error(`Papyrus newsroom references curate-recent returned invalid JSON: ${result.stderr || result.stdout || "unknown error"}`);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    const summary = payload.summary ?? {};
    console.log(`references\tcurate-recent\trun\t${payload.runId ?? "-"}`);
    console.log(`references\tcurate-recent\tmanifest\t${payload.manifestPath ?? "-"}`);
    console.log(`references\tcurate-recent\tapply\t${payload.apply ? "yes" : "no"}`);
    console.log(`references\tcurate-recent\tok\t${payload.ok ? "yes" : "no"}`);
    console.log(`references\tcurate-recent\tdegraded\t${payload.degraded ? "yes" : "no"}`);
    console.log(`references\tcurate-recent\tselected\t${summary.selectedCount ?? 0}`);
    console.log(`references\tcurate-recent\tprocessed\t${summary.processedCount ?? 0}`);
    console.log(`references\tcurate-recent\tsucceeded\t${summary.succeededCount ?? 0}`);
    console.log(`references\tcurate-recent\tfailed\t${summary.failedCount ?? 0}`);
    for (const failure of payload.selectionFailures ?? []) {
      console.log(`reference-curation\tselection-failed\t${failure.referenceId ?? "-"}\t${failure.failureReason ?? "selection failed"}`);
    }
    for (const item of payload.items ?? []) {
      const reference = item.reference ?? {};
      const stages = item.stages ?? {};
      const prepassStatus = stages.identifierPrepass?.status ?? "-";
      const titleStatus = stages.titleSubtitle?.status ?? "-";
      const summaryStatus = stages.summary?.status ?? "-";
      const qualityStatus = stages.quality?.status ?? "-";
      console.log([
        "reference-curation",
        item.failed ? "failed" : "ok",
        reference.id ?? item.referenceId ?? "-",
        prepassStatus,
        titleStatus,
        summaryStatus,
        qualityStatus,
        (item.failureReasons ?? []).join("; ") || "-",
        reference.title ?? "-",
      ].join("\t"));
    }
    for (const warning of payload.warnings ?? []) {
      console.log(`references\tcurate-recent\twarning\t${warning}`);
    }
  }

  if (result.status && result.status !== 0) {
    process.exitCode = result.status;
    return;
  }
}

async function maybeEnrichReferenceCatalogTitleSubtitle({ catalog, catalogPath = null, options = {}, persist = false }) {
  if (parseBooleanOption(options["title-subtitle-enrichment"], true, "--title-subtitle-enrichment") === false) {
    return catalog;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "papyrus-title-subtitle-"));
  const inputPath = path.join(tempDir, "catalog-input.json");
  const outputPath = path.join(tempDir, "catalog-output.json");
  fs.writeFileSync(inputPath, `${JSON.stringify(catalog ?? {}, null, 2)}\n`, "utf8");
  const webSearch = parseBooleanOption(options["title-subtitle-web-search"], true, "--title-subtitle-web-search");
  const onlyMissing = parseBooleanOption(options["title-subtitle-only-missing"], true, "--title-subtitle-only-missing");
  const model = normalizeCliString(options["title-subtitle-model"]) ?? "gpt-5.4-mini";
  const maxCount = normalizeCliNonNegativeInteger(options["title-subtitle-max-count"], "--title-subtitle-max-count") ?? 0;
  const args = [
    "run",
    "papyrus-newsroom",
    "references",
    "title-subtitle",
    "enrich-catalog",
    "--catalog",
    inputPath,
    "--output",
    outputPath,
    "--model",
    model,
    "--web-search",
    String(webSearch),
    "--only-missing",
    String(onlyMissing),
  ];
  if (maxCount) args.push("--max-count", String(maxCount));
  const result = spawnSync("poetry", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Reference title/subtitle enrichment failed: ${result.stderr || result.stdout}`);
  }
  const summary = JSON.parse(result.stdout || "{}");
  if (summary.updated || summary.unresolved) {
    console.error(`references\ttitle-subtitle-enrichment\tupdated=${summary.updated ?? 0}\tunresolved=${summary.unresolved ?? 0}\tnoop=${summary.noop ?? 0}\tweb=${webSearch}`);
  }
  const enriched = loadJsonFile(outputPath);
  if (persist && catalogPath) {
    writeJsonFile(catalogPath, enriched);
    console.error(`references\ttitle-subtitle-enrichment\tpersisted\t${catalogPath}`);
  }
  return enriched;
}

async function referenceSourceStatus(flags) {
  const options = parseOptions(flags);
  if (!options["corpus-key"]) throw new Error("references source-status requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const status = normalizeSourceStatusFilter(options.status);
  const { client } = createAuthoringClient();
  const [references, attachments] = await Promise.all([
    client.listRecords("Reference"),
    client.listRecords("ReferenceAttachment"),
  ]);
  const extractionIndex = buildExtractionIndex(corpusConfig.path);
  const rows = buildReferenceSourceStatusRows({
    references,
    attachments,
    corpusId,
    curationStatus: status,
    extractionIndex,
  });
  const counts = rows.reduce((memo, row) => {
    memo[row.state] = (memo[row.state] ?? 0) + 1;
    return memo;
  }, {});
  const textCounts = rows.reduce((memo, row) => {
    const state = row.readiness.textState ?? SOURCE_TEXT_STATES.NOT_APPLICABLE;
    memo[state] = (memo[state] ?? 0) + 1;
    return memo;
  }, {});
  const limit = options.limit === undefined ? 50 : normalizeCliNonNegativeInteger(options.limit, "--limit");
  const selected = limit === 0 ? [] : rows.slice(0, limit);
  console.log(`references\tsource-status\tcorpus\t${corpusId}`);
  console.log(`references\tsource-status\tstatus\t${status}`);
  for (const state of Object.values(SOURCE_READINESS_STATES)) {
    console.log(`references\tsource-status\t${state}\t${counts[state] ?? 0}`);
  }
  for (const state of Object.values(SOURCE_TEXT_STATES)) {
    console.log(`references\tsource-status\t${state}\t${textCounts[state] ?? 0}`);
  }
  console.log(`references\tsource-status\textraction-snapshots\t${extractionIndex.snapshotIds.length}`);
  console.log(`references\tsource-status\trows\t${rows.length}`);
  for (const row of selected) {
    const reference = row.reference;
    console.log([
      "reference-source",
      row.state,
      row.readiness.textState ?? SOURCE_TEXT_STATES.NOT_APPLICABLE,
      reference.curationStatus ?? "-",
      reference.id,
      reference.externalItemId ?? "-",
      row.readiness.storagePath ?? "-",
      row.readiness.textStoragePath ?? "-",
      reference.sourceUri ?? "-",
      nextReferenceSourceCommand(row),
      reference.title ?? "-",
    ].join("\t"));
  }
  if (rows.length > selected.length) {
    console.log(`references\tsource-status\tomitted\t${rows.length - selected.length}\tpass --limit ${rows.length} to print every row`);
  }
}

async function createReferenceAccessionAssignments(flags) {
  const options = parseOptions(flags);
  if (!options["corpus-key"]) throw new Error("references create-accession-assignments requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const status = normalizeSourceStatusFilter(options.status ?? "pending");
  if (status === "all") throw new Error("references create-accession-assignments requires --status pending|accepted|rejected|archived, not all.");
  const now = new Date().toISOString();
  const actorLabel = options.actor || "Papyrus content CLI";
  const { client } = createAuthoringClient();
  const [references, attachments, assignments] = await Promise.all([
    client.listRecords("Reference"),
    client.listRecords("ReferenceAttachment"),
    client.listRecords("Assignment"),
  ]);
  const rows = buildReferenceSourceStatusRows({
    references,
    attachments,
    corpusId,
    curationStatus: status,
    extractionIndex: null,
  }).filter((row) => row.state === SOURCE_READINESS_STATES.URL_ONLY);
  const records = buildReferenceAccessionAssignmentRecords(rows, {
    corpusConfig,
    corpusId,
    assignments,
    actorLabel,
    now,
  });
  const changes = await buildRecordChanges(client, records);
  printReferenceAccessionAssignmentSummary(rows, changes, { apply: Boolean(options.apply) });
  if (!options.apply) {
    console.log("references\tcreate-accession-assignments\tapply\tskipped\tpass --apply to write Assignment records");
    return;
  }
  await applyRecordChanges(client, changes);
  await updateNewsroomSummaryAfterAssignmentCreates(client, changes, {
    actorLabel,
    reason: `references create-accession-assignments ${corpusId}`,
  });
}

async function accessionReferenceNow(flags) {
  const options = parseOptions(flags);
  const referenceSelector = options.reference;
  if (!referenceSelector) throw new Error("references accession-now requires --reference <reference-id>.");
  const { auth, client } = createAuthoringClient();
  const references = await client.listRecords("Reference");
  const reference = findReferenceForSourceAccession(references, referenceSelector);
  if (!reference) throw new Error(`Reference ${referenceSelector} was not found.`);
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfigByIdOrKey(steeringConfig, reference.corpusId, options["corpus-key"]);
  const corpusId = knowledgeCorpusId(corpusConfig);
  const [attachments, assignments] = await Promise.all([
    client.listRecords("ReferenceAttachment"),
    client.listRecords("Assignment"),
  ]);
  const readiness = referenceSourceReadiness(reference, attachments, null);
  if (readiness.state !== SOURCE_READINESS_STATES.URL_ONLY) {
    throw new Error(`Reference ${reference.id} is ${readiness.state}, not url_only; accession is only needed for URL-only source material.`);
  }
  const rows = [{ reference, readiness, state: readiness.state, reason: readiness.reason }];
  const now = new Date().toISOString();
  const actorLabel = options["assignee-key"] ?? options.assignee ?? options.actor ?? "Papyrus content CLI";
  const records = buildReferenceAccessionAssignmentRecords(rows, {
    corpusConfig,
    corpusId,
    assignments,
    actorLabel,
    now,
  });
  const changes = await buildRecordChanges(client, records);
  if (changes.some((change) => change.action !== "noop")) {
    await applyRecordChanges(client, changes);
    await updateNewsroomSummaryAfterAssignmentCreates(client, changes, {
      actorLabel,
      reason: `references accession-now create ${reference.id}`,
    });
  }
  const assignmentId = referenceAccessionAssignmentId(reference, corpusId);
  await applyAssignmentAction({
    client,
    authClaims: auth.claims,
    action: "claim",
    assignmentId,
    options,
    actorLabel,
  });
  try {
    const executionResult = await executeAssignmentByType({
      client,
      assignmentId,
      options,
    });
    await applyAssignmentAction({
      client,
      authClaims: auth.claims,
      action: "complete",
      assignmentId,
      options,
      actorLabel,
    });
    console.log(`reference-accession-now\tassignment\t${assignmentId}`);
    console.log(`reference-accession-now\trun\t${executionResult.runId}`);
    console.log(`reference-accession-now\tmanifest\t${executionResult.manifestPath}`);
    console.log(`reference-accession-now\tstorage-path\t${executionResult.storagePath ?? "-"}`);
  } catch (error) {
    const assignment = await client.getRecord("Assignment", assignmentId);
    const failure = normalizeError(error);
    const artifacts = analysisFailureArtifactsFromError(error);
    await appendAssignmentFailedEvent({
      client,
      assignmentId,
      assignmentTypeKey: assignment?.assignmentTypeKey ?? "reference.corpus-accession",
      queueKey: assignment?.queueKey ?? null,
      fromStatus: assignment?.status ?? "claimed",
      toStatus: assignment?.status ?? "claimed",
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
    throw error;
  }
}

async function extractReferenceTextNow(flags) {
  const options = parseOptions(flags);
  if (!options["corpus-key"]) throw new Error("references extract-text-now requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const { auth, client } = createAuthoringClient();
  const now = new Date().toISOString();
  const actorLabel = options["assignee-key"] ?? options.assignee ?? options.actor ?? "Papyrus content CLI";
  const runId = options["run-id"] || `reference-text-extraction-${timestampForPath(now)}-${hashShort([corpusId, options.stage, options.configuration, options.force])}`;
  const assignment = referenceTextExtractionAssignmentRecord({
    corpusConfig,
    corpusId,
    actorLabel,
    now,
    options,
    runId,
  });
  const records = [
    { modelName: "Assignment", expected: assignment },
    { modelName: "AssignmentEvent", expected: assignmentCreatedEventRecord(assignment, actorLabel, now) },
    { modelName: "SemanticRelation", expected: localSemanticRelationRecord({
      predicate: "requests_work_on",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      subjectVersionNumber: null,
      objectKind: "knowledge_corpus",
      objectId: corpusId,
      objectLineageId: corpusId,
      objectVersionNumber: null,
      rank: 1,
      importRunId: null,
      importedAt: now,
      metadata: {
        kind: "reference.text-extraction.requests_work_on",
        corpusKey: corpusConfig.key,
      },
    }) },
  ];
  const changes = await buildRecordChanges(client, records);
  await applyRecordChanges(client, changes);
  await updateNewsroomSummaryAfterAssignmentCreates(client, changes, {
    actorLabel,
    reason: `references extract-text-now create ${corpusId}`,
  });
  await applyAssignmentAction({
    client,
    authClaims: auth.claims,
    action: "claim",
    assignmentId: assignment.id,
    options,
    actorLabel,
  });
  try {
    const executionResult = await executeAssignmentByType({
      client,
      assignmentId: assignment.id,
      options,
    });
    await applyAssignmentAction({
      client,
      authClaims: auth.claims,
      action: "complete",
      assignmentId: assignment.id,
      options,
      actorLabel,
    });
    console.log(`reference-text-extraction-now\tassignment\t${assignment.id}`);
    console.log(`reference-text-extraction-now\trun\t${executionResult.runId}`);
    console.log(`reference-text-extraction-now\tmanifest\t${executionResult.manifestPath}`);
    console.log(`reference-text-extraction-now\tattachments\t${executionResult.importSummary?.importedRecords ?? 0}`);
  } catch (error) {
    const currentAssignment = await client.getRecord("Assignment", assignment.id);
    const failure = normalizeError(error);
    const artifacts = analysisFailureArtifactsFromError(error);
    await appendAssignmentFailedEvent({
      client,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      queueKey: assignment.queueKey,
      fromStatus: currentAssignment?.status ?? "claimed",
      toStatus: currentAssignment?.status ?? "claimed",
      actorLabel,
      note: failure.message,
      metadata: {
        kind: "assignment.execution.failed",
        runId: artifacts.runId ?? runId,
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

async function attachExtractedTextReferences(flags) {
  const options = parseOptions(flags);
  if (!options["corpus-key"]) throw new Error("references attach-extracted-text requires --corpus-key <key>.");
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const actorLabel = options.actor || "Papyrus content CLI";
  const { client } = createAuthoringClient();
  const [references, attachments] = await Promise.all([
    client.listRecords("Reference"),
    client.listRecords("ReferenceAttachment"),
  ]);
  const extractionIndex = buildExtractionIndex(corpusConfig.path);
  const allPlans = buildExtractedTextAttachmentPlans({
    corpusConfig,
    corpusId,
    references,
    attachments,
    extractionIndex,
  });
  const maxCount = normalizeCliPositiveInteger(options["max-count"], "--max-count");
  const plans = maxCount ? allPlans.slice(0, maxCount) : allPlans;
  const records = plans.map((plan) => plan.record).filter(Boolean);
  const changes = await buildRecordChanges(client, records);
  console.log(`references\tattach-extracted-text\tcorpus\t${corpusId}`);
  console.log(`references\tattach-extracted-text\tsnapshots\t${extractionIndex.snapshotIds.length}`);
  console.log(`references\tattach-extracted-text\teligible\t${allPlans.length}`);
  if (maxCount) console.log(`references\tattach-extracted-text\tmax-count\t${maxCount}`);
  console.log(`references\tattach-extracted-text\tsnapshot_attachments\t${plans.length}`);
  console.log(`references\tattach-extracted-text\tplanned\t${records.length}`);
  const changed = changes.filter((entry) => entry.action !== "noop");
  const printLimit = options.limit === undefined ? 25 : normalizeCliNonNegativeInteger(options.limit, "--limit");
  console.log(`references\tattach-extracted-text\tchanges\t${changed.length}`);
  for (const change of changed.slice(0, printLimit)) {
    console.log(`${change.action}\t${change.modelName}\t${change.expected.id}`);
  }
  if (changed.length > printLimit) {
    console.log(`references\tattach-extracted-text\tomitted\t${changed.length - printLimit}\tpass --limit ${changed.length} to print every planned change`);
  }
  if (!options.apply) {
    console.log("references\tattach-extracted-text\tapply\tskipped\tpass --apply to write snapshot-backed ReferenceAttachment records");
    return;
  }
  await applyRecordChanges(client, changes);
  await updateNewsroomSummaryAfterExtractedTextAttachments(client, changes, {
    actorLabel,
    reason: `references attach-extracted-text ${corpusId}`,
  });
  console.log(`references\tattach-extracted-text\tattached\t${changes.filter((entry) => entry.action === "create").length}`);
}

async function createReferenceDoiBackfillAssignment(flags) {
  return createReferenceIdentifierBackfillAssignment(doiBackfillCompatibilityFlags(flags));
}

async function runReferenceDoiBackfillNow(flags) {
  return runReferenceIdentifierBackfillNow(doiBackfillCompatibilityFlags(flags));
}

async function executeReferenceDoiBackfillAssignment(flags) {
  return executeReferenceIdentifierBackfillAssignment(flags);
}

function doiBackfillCompatibilityFlags(flags) {
  const next = [];
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--only-missing-doi") {
      next.push("--only-missing");
      if (index + 1 < flags.length && !String(flags[index + 1]).startsWith("--")) {
        next.push(flags[index + 1]);
        index += 1;
      }
      continue;
    }
    next.push(flag);
  }
  if (!next.includes("--types")) next.push("--types", "doi");
  return next;
}

async function createReferenceIdentifierBackfillAssignment(flags) {
  const options = parseOptions(flags);
  if (!options["corpus-key"]) throw new Error("references create-identifier-backfill-assignment requires --corpus-key <key>.");
  const actorLabel = options.actor || "papyrus-content-cli";
  const now = new Date().toISOString();
  const types = normalizeIdentifierTypes(options.types, { defaultTypes: ["doi"] });
  const runId = options["run-id"] || `reference-identifier-backfill-${timestampForPath(now)}-${hashShort([options["corpus-key"], types.join(",")])}`;
  const { client } = createAuthoringClient();
  const assignmentPlan = buildReferenceIdentifierBackfillAssignmentPlan({
    options,
    actorLabel,
    now,
    runId,
    types,
  });
  const changes = await buildRecordChangesTargetedById(client, assignmentPlan.records);
  console.log(`references\tcreate-identifier-backfill-assignment\tassignment\t${assignmentPlan.assignment.id}`);
  console.log(`references\tcreate-identifier-backfill-assignment\tcorpus\t${assignmentPlan.corpusId}`);
  console.log(`references\tcreate-identifier-backfill-assignment\ttypes\t${types.join(",")}`);
  console.log(`references\tcreate-identifier-backfill-assignment\trun\t${runId}`);
  for (const change of changes) {
    console.log(`${change.action}\t${change.modelName}\t${change.expected.id}`);
  }
  if (!options.apply) {
    console.log("references\tcreate-identifier-backfill-assignment\tapply\tskipped\tpass --apply to write Assignment records");
    return;
  }
  await applyRecordChanges(client, changes);
  await updateNewsroomSummaryAfterAssignmentCreates(client, changes, {
    actorLabel,
    reason: `references create-identifier-backfill-assignment ${assignmentPlan.assignment.id}`,
  });
}

async function runReferenceIdentifierBackfillNow(flags) {
  const options = parseOptions(flags);
  if (!options["corpus-key"]) throw new Error("references identifier-backfill-now requires --corpus-key <key>.");
  const now = new Date().toISOString();
  const types = normalizeIdentifierTypes(options.types, { defaultTypes: ["doi"] });
  const runNowOptions = {
    ...options,
    apply: true,
    "run-id": options["run-id"] || `reference-identifier-backfill-now-${timestampForPath(now)}`,
    types: types.join(","),
  };
  const actorLabel = runNowOptions["assignee-key"] ?? runNowOptions.assignee ?? runNowOptions.actor ?? "papyrus-content-cli";
  const { auth, client } = createAuthoringClient();
  assertJwtUsableForLongRun(auth.claims, "identifier resolver scan");
  const assignmentPlan = buildReferenceIdentifierBackfillAssignmentPlan({
    options: runNowOptions,
    actorLabel,
    now,
    runId: runNowOptions["run-id"],
    types,
  });
  runNowOptions.__assignmentMetadata = assignmentPlan.metadata;
  const assignmentChanges = await buildRecordChangesTargetedById(client, assignmentPlan.records);
  await applyRecordChanges(client, assignmentChanges);
  await updateNewsroomSummaryAfterAssignmentCreates(client, assignmentChanges, {
    actorLabel,
    reason: `references identifier-backfill-now create ${assignmentPlan.assignment.id}`,
  });
  await applyAssignmentAction({
    client,
    authClaims: auth.claims,
    action: "claim",
    assignmentId: assignmentPlan.assignment.id,
    options: runNowOptions,
    actorLabel,
  });
  try {
    const executionResult = await executeAssignmentByType({
      client,
      assignmentId: assignmentPlan.assignment.id,
      options: runNowOptions,
    });
    await applyAssignmentAction({
      client,
      authClaims: auth.claims,
      action: "complete",
      assignmentId: assignmentPlan.assignment.id,
      options: runNowOptions,
      actorLabel,
    });
    console.log(`references-identifier-backfill-now\tassignment\t${assignmentPlan.assignment.id}`);
    console.log(`references-identifier-backfill-now\trun\t${executionResult.runId}`);
    console.log(`references-identifier-backfill-now\tmanifest\t${executionResult.manifestPath}`);
    console.log(`references-identifier-backfill-now\tresolved\t${executionResult.summary.resolved}`);
    console.log(`references-identifier-backfill-now\tunresolved\t${executionResult.summary.unresolved}`);
  } catch (error) {
    const failure = normalizeError(error);
    const artifacts = analysisFailureArtifactsFromError(error);
    const currentAssignment = await client.getRecord("Assignment", assignmentPlan.assignment.id);
    await appendAssignmentFailedEvent({
      client,
      assignmentId: assignmentPlan.assignment.id,
      assignmentTypeKey: assignmentPlan.assignment.assignmentTypeKey,
      queueKey: assignmentPlan.assignment.queueKey,
      fromStatus: currentAssignment?.status ?? "claimed",
      toStatus: currentAssignment?.status ?? "claimed",
      actorLabel,
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

async function executeReferenceIdentifierBackfillAssignment(flags) {
  const options = parseOptions(flags);
  const assignmentId = options.assignment;
  if (!assignmentId) throw new Error("references execute-identifier-backfill requires --assignment <id>.");
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
      assignmentTypeKey: assignment?.assignmentTypeKey ?? "reference.identifier-backfill",
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

function buildReferenceIdentifierBackfillAssignmentPlan({ options, actorLabel, now, runId, types = null }) {
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const assignmentTypeKey = "reference.identifier-backfill";
  const queueKey = `${assignmentTypeKey}#${corpusId}`;
  const policy = getAssignmentTypePolicy(assignmentTypeKey);
  const useLlm = parseBooleanOption(options["use-llm"], false, "--use-llm");
  const maxCount = normalizeCliPositiveInteger(options["max-count"], "--max-count");
  const selectedTypes = types ?? normalizeIdentifierTypes(options.types, { defaultTypes: ["doi"] });
  const onlyMissing = parseBooleanOption(options["only-missing"], false, "--only-missing");
  const progressEvery = normalizeCliPositiveInteger(options["progress-every"], "--progress-every");
  const writeChunkSize = normalizeCliPositiveInteger(options["write-chunk-size"], "--write-chunk-size") ?? 100;
  const metadata = {
    kind: "reference.identifier-backfill.requested",
    runId,
    corpusKey: corpusConfig.key,
    corpusId,
    types: selectedTypes,
    scope: {
      versionState: "current",
      curationStatus: "all",
    },
    resolverMode: "deterministic-first",
    useLlm,
    llmModel: normalizeCliString(options["llm-model"]) ?? "gpt-5.4-mini",
    llmReasoningEffort: normalizeCliString(options["llm-reasoning-effort"]) ?? "low",
    sidecarPersistenceMode: parseBooleanOption(options["persist-sidecars"], true, "--persist-sidecars") ? "enabled" : "disabled",
    onlyMissing,
    progressEvery: progressEvery ?? null,
    writeChunkSize,
    maxCount: maxCount ?? null,
    steeringConfigPath: steeringConfig?.configPath ?? options.config ?? null,
    corpusPath: corpusConfig.path,
    assignmentTypePolicy: policy,
  };
  const assignment = {
    id: `assignment-reference-identifier-backfill-${hashShort([corpusId, runId])}`,
    assignmentTypeKey,
    queueKey,
    queueStatusKey: `${queueKey}#open`,
    status: "open",
    priority: 45,
    title: `Identifier backfill for ${corpusConfig.key}`,
    brief: `Resolve ${selectedTypes.join(", ")} identifiers for current references, write semantic identifier relations, and persist provenance to metadata and sidecars.`,
    instructions: "Use deterministic identifier resolution first, use LLM adjudication only when ambiguous, create identifier semantic relations, and run one corpus reindex after sidecar updates.",
    assigneeType: null,
    assigneeId: null,
    assigneeKey: null,
    claimedAt: null,
    claimExpiresAt: null,
    completedAt: null,
    canceledAt: null,
    corpusId,
    categorySetId: null,
    classifierId: null,
    sourceSnapshotId: null,
    importRunId: null,
    createdBy: actorLabel ?? "papyrus-content-cli",
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: "assignments",
    metadata: JSON.stringify(metadata),
  };
  const records = [
    { modelName: "Assignment", expected: assignment },
    { modelName: "AssignmentEvent", expected: assignmentCreatedEventRecord(assignment, actorLabel, now) },
    { modelName: "SemanticRelation", expected: localSemanticRelationRecord({
      predicate: "requests_work_on",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      subjectVersionNumber: null,
      objectKind: "knowledge_corpus",
      objectId: corpusId,
      objectLineageId: corpusId,
      objectVersionNumber: null,
      rank: 1,
      importRunId: null,
      importedAt: now,
      metadata: {
        kind: "reference.identifier-backfill.requests_work_on",
        corpusKey: corpusConfig.key,
        types: selectedTypes,
      },
    }) },
  ];
  return {
    assignment,
    records,
    metadata,
    corpusId,
    corpusConfig,
  };
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
  const hydratedMessages = await hydrateReferenceCurationMessages(client, messages, relations);
  const hydratedReferences = await hydrateRejectedReferenceMetadata(client, references);
  const payload = buildReferenceScopeTrainingExport({
    corpusConfig,
    corpusId,
    references: hydratedReferences,
    attachments,
    messages: hydratedMessages,
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

async function reviewSteeringProposalFromCli(flags) {
  const options = parseOptions(flags);
  const proposalId = options.proposal ?? options["proposal-id"];
  const action = String(options.action ?? "").toLowerCase();
  if (!proposalId) throw new Error("categories review-proposal requires --proposal <steering-proposal-id>.");
  if (action !== "accept" && action !== "reject") throw new Error("categories review-proposal requires --action accept|reject.");
  const actor = options.actor ?? "Papyrus content CLI";
  const now = new Date().toISOString();
  const { client } = createAuthoringClient();
  const [proposal, categorySets, categories] = await Promise.all([
    client.getRecord("SteeringProposal", proposalId),
    client.listRecords("CategorySet"),
    client.listRecords("Category"),
  ]);
  if (!proposal) throw new Error(`SteeringProposal ${proposalId} was not found.`);
  if (proposal.status === "accepted" || proposal.status === "rejected") {
    console.log(`categories\treview-proposal\t${proposal.id}\t${proposal.status}\tidempotent`);
    return;
  }

  const decision = {
    id: `decision-${proposal.id}-${timestampForPath(now)}-${crypto.randomUUID().slice(0, 8)}`,
    proposalId: proposal.id,
    categorySetId: options["target-category-set"] ?? proposal.categorySetId ?? null,
    action,
    actorSub: null,
    actorLabel: actor,
    note: options.note ?? null,
    selectedCategoryKey: proposal.categoryKey ?? null,
    createdAt: now,
  };
  const updatedProposal = {
    ...proposal,
    status: action === "accept" ? "accepted" : "rejected",
    reviewedAt: now,
    reviewedBy: actor,
    updatedAt: now,
  };
  const records = [
    { modelName: "SteeringDecision", expected: decision },
    { modelName: "SteeringProposal", expected: updatedProposal },
  ];

  let category = null;
  let categorySetUpdate = null;
  if (action === "accept") {
    const targetCategorySetId = options["target-category-set"] ?? proposal.categorySetId;
    if (!targetCategorySetId) throw new Error(`SteeringProposal ${proposal.id} has no categorySetId; pass --target-category-set.`);
    const categorySet = categorySets.find((entry) => entry.id === targetCategorySetId);
    if (!categorySet) throw new Error(`CategorySet ${targetCategorySetId} was not found.`);
    const categoryKey = proposal.categoryKey ?? deriveCategoryKeyFromText(proposal.displayName ?? proposal.title ?? proposal.id);
    const targetCategories = categories.filter((entry) => entry.categorySetId === categorySet.id);
    const existing = targetCategories.find((entry) => entry.categoryKey === categoryKey && entry.versionState === "current");
    if (existing) throw new Error(`Category ${categoryKey} already exists in ${categorySet.id}; refusing duplicate proposal accept.`);
    const parentCategoryKey = proposal.targetCategoryKey ?? null;
    const parent = parentCategoryKey
      ? targetCategories.find((entry) => entry.categoryKey === parentCategoryKey && entry.versionState === "current") ?? null
      : null;
    const lineageId = `category-${slugify(categorySet.id)}-${slugify(categoryKey)}`;
    category = withVersionFields({
      id: `${lineageId}-v1`,
      lineageId,
      versionNumber: 1,
      previousVersionId: null,
      versionState: "current",
      categorySetId: categorySet.id,
      corpusId: proposal.corpusId ?? categorySet.corpusId ?? null,
      categoryKey,
      parentCategoryId: parent?.id ?? null,
      parentCategoryKey,
      displayName: options["display-name"] ?? proposal.displayName ?? proposal.title ?? categoryKey,
      shortTitle: options["short-title"] ?? proposal.shortTitle ?? deriveShortTitleFromText(proposal.displayName ?? proposal.title ?? categoryKey),
      subtitle: options.subtitle ?? proposal.subtitle ?? null,
      description: options.description ?? proposal.description ?? proposal.summary ?? "",
      aliases: [],
      status: "accepted",
      seedItemIds: normalizeStringList(proposal.suggestedSeedItemIds),
      holdoutItemIds: normalizeStringList(proposal.suggestedHoldoutItemIds),
      rank: targetCategories.filter((entry) => (entry.parentCategoryKey ?? null) === parentCategoryKey).length + 1,
      depth: parent ? (Number(parent.depth) || 0) + 1 : parentCategoryKey ? 1 : 0,
      isPinned: false,
      importRunId: proposal.importRunId ?? null,
      updatedAt: now,
    }, {
      now,
      actor,
      reason: `proposal:${proposal.id}`,
    });
    const nextCount = targetCategories
      .filter((entry) => entry.versionState === "current" && entry.status !== "archived" && entry.status !== "deprecated")
      .length + 1;
    categorySetUpdate = {
      ...categorySet,
      categoryCount: nextCount,
      changeReason: `proposal:${proposal.id}`,
      contentHash: hashShort({ ...categorySet, categoryCount: nextCount, updatedAt: now }),
    };
    records.push({ modelName: "Category", expected: category });
    records.push({ modelName: "CategorySet", expected: categorySetUpdate });
  }

  console.log(`categories\treview-proposal\tmode\t${options.apply ? "apply" : "dry-run"}`);
  console.log(`categories\treview-proposal\tproposal\t${proposal.id}\t${action}\t${proposal.categoryKey ?? ""}\t${proposal.targetCategoryKey ?? ""}`);
  if (category) console.log(`categories\treview-proposal\tcategory\t${category.id}\t${category.categoryKey}\t${category.parentCategoryKey ?? ""}\tdepth=${category.depth}`);
  if (!options.apply) {
    console.log("categories\treview-proposal\tapply\tskipped\tpass --apply to write the proposal decision");
    return;
  }
  for (const record of records) await client.upsert(record.modelName, record.expected);
  const countDeltas = {
    openProposals: proposal.status === "proposed" ? -1 : 0,
    ...(category ? { categories: 1 } : {}),
  };
  await updateNewsroomSummaryDelta(client, { countDeltas }, `categories review-proposal ${proposal.id} ${action}`);
  console.log(`categories\treview-proposal\t${proposal.id}\t${action}\t${category?.id ?? ""}`);
  if (category) {
    console.log(`categories\treview-proposal\tnext\tnpm run content -- categories export-category-set --category-set ${category.categorySetId} --output .papyrus-runs/${timestampForPath(now)}-${category.categorySetId}.json`);
  } else {
    console.log("categories\treview-proposal\tnext\tnpm run content -- newsroom recount-summary");
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
  if (options.section) assignments = assignments.filter((assignment) => assignmentSectionKey(assignment) === options.section);
  assignments.sort((left, right) => assignmentSortKey(left).localeCompare(assignmentSortKey(right)));
  for (const assignment of assignments) {
    console.log(`${assignment.status}\t${assignment.id}\t${assignment.assignmentTypeKey}\t${assignment.queueKey}\tsection=${assignmentSectionKey(assignment) ?? ""}\t${assignment.title}`);
  }
}

async function createResearchAssignment(flags) {
  const options = parseOptions(flags);
  const title = normalizeCliString(options.title);
  if (!title) throw new Error("assignments create-research requires --title <text>.");
  const sectionKey = normalizeCliString(options.section);
  const corpusKey = normalizeCliString(options["corpus-key"]) ?? "AI-ML-research";
  const researchMode = normalizeResearchModeOption(options["research-mode"] ?? options.researchMode ?? "source_discovery");
  const now = new Date().toISOString();
  const assignmentTypeKey = normalizeCliString(options.type) ?? "research.edition-candidate";
  const status = normalizeCliString(options.status) ?? "open";
  const priority = normalizeCliNonNegativeInteger(options.priority, "--priority") ?? 50;
  const queueKey = normalizeCliString(options.queue) ?? `research:${sectionKey ?? "unsectioned"}:exploratory`;
  const summary = normalizeCliString(options.summary) ?? normalizeCliString(options.brief) ?? title;
  const brief = normalizeCliString(options.brief) ?? summary;
  const instructions = normalizeCliString(options.instructions) ?? normalizeCliString(options["research-questions"]) ?? "";
  const topicScopeCategoryKeys = parseCommaList(options["topic-scope"] ?? options["topic-scope-category-keys"]) ?? [];
  const primaryFocusCategoryKey = normalizeCliString(options["primary-focus-category-key"]) ?? normalizeCliString(options["primary-focus"]);
  const { client } = createAuthoringClient();
  let section = null;
  if (sectionKey) {
    section = await client.getRecord("NewsroomSection", sectionKey);
    if (!section) throw new Error(`Unknown NewsroomSection for --section ${sectionKey}. Run: npm run content -- newsroom import-sections --config corpora/papyrus-newsroom-sections.yml`);
  }
  const assignmentId = normalizeCliString(options.id) ?? `assignment-research-${safeId(title).slice(0, 80)}-${timestampForPath(now)}`;
  const assignment = {
    id: assignmentId,
    assignmentTypeKey,
    queueKey,
    queueStatusKey: `${queueKey}#${status}`,
    status,
    priority,
    title,
    summary,
    brief,
    instructions,
    metadata: JSON.stringify({
      kind: "research.assignment.created",
      researchMode,
      corpusKey,
      sectionKey: sectionKey ?? null,
      sectionTitle: section?.title ?? section?.displayName ?? sectionKey ?? null,
      sectionType: normalizeSectionTypeForAssignment(section?.type ?? options["section-type"]),
      topicScopeCategoryKeys,
      primaryFocusCategoryKey,
      contextProfile: "researcher",
      createdBy: "assignments create-research",
    }),
    corpusId: normalizeCliString(options["corpus-id"]) ?? `knowledge-corpus-${safeId(corpusKey)}`,
    categorySetId: normalizeCliString(options["category-set"]),
    sectionId: section?.id ?? sectionKey ?? null,
    sectionKey: sectionKey ?? null,
    sectionType: normalizeSectionTypeForAssignment(section?.type ?? options["section-type"]),
    sectionStatusKey: sectionKey ? `${sectionKey}#${status}` : null,
    sectionQueueStatusKey: sectionKey ? `${sectionKey}#${queueKey}#${status}` : null,
    primaryFocusCategoryKey,
    topicScopeCategoryKeys,
    createdBy: normalizeCliString(options["actor-label"]) ?? "papyrus-content-cli",
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: `assignment#${status}`,
  };
  const event = {
    id: `assignment-event-${assignmentId}-created`,
    assignmentId,
    assignmentTypeKey,
    queueKey,
    eventType: "created",
    fromStatus: null,
    toStatus: status,
    actorSub: normalizeCliString(options["actor-sub"]),
    actorLabel: normalizeCliString(options["actor-label"]) ?? "Papyrus content CLI",
    note: normalizeCliString(options.note) ?? `Created research assignment: ${title}`,
    createdAt: now,
  };
  const records = [
    { modelName: "Assignment", expected: assignment },
    { modelName: "AssignmentEvent", expected: event },
  ];
  const changes = await buildRecordChangesTargetedById(client, records);
  const actionCounts = countDelta(changes, "action", "unknown");
  const result = {
    ok: true,
    command: "assignments create-research",
    action: options.apply ? "apply" : "dry-run",
    assignmentId,
    assignmentTypeKey,
    status,
    sectionKey: sectionKey ?? null,
    queueKey,
    researchMode,
    changedRecords: changes.filter((change) => change.action !== "noop").length,
    changes: actionCounts,
    next: options.apply
      ? `npm run content -- assignments run-research --assignment ${assignmentId} --corpus-key ${corpusKey} --research-mode ${researchMode}`
      : `npm run content -- assignments create-research --title ${JSON.stringify(title)} --section ${sectionKey ?? "<section-key>"} --corpus-key ${corpusKey} --research-mode ${researchMode} --apply`,
  };
  if (!options.apply) {
    if (options.json) {
      printCompactJson(result);
      return;
    }
    printResearchAssignmentCreateSummary(result, changes);
    console.log("assignments\tcreate-research\tapply\tskipped\tpass --apply to write Assignment records");
    console.log(`assignments\tcreate-research\tnext\t${result.next}`);
    return;
  }
  await applyRecordChanges(client, changes);
  await updateNewsroomSummaryAfterAssignmentCreates(client, changes, {
    actorLabel: event.actorLabel,
    reason: `assignments create-research ${assignmentId}`,
  });
  if (options.json) {
    printCompactJson(result);
    return;
  }
  printResearchAssignmentCreateSummary(result, changes);
  console.log(`assignments\tcreate-research\tnext\t${result.next}`);
}

function printResearchAssignmentCreateSummary(result, changes) {
  const modelCounts = countDelta(changes.filter((change) => change.action !== "noop"), "modelName", "unknown");
  console.log(`assignments\tcreate-research\taction\t${result.action}`);
  console.log(`assignments\tcreate-research\tassignment\t${result.assignmentId}`);
  console.log(`assignments\tcreate-research\tstatus\t${result.status}`);
  console.log(`assignments\tcreate-research\ttype\t${result.assignmentTypeKey}`);
  console.log(`assignments\tcreate-research\tresearch-mode\t${result.researchMode}`);
  console.log(`assignments\tcreate-research\tsection\t${result.sectionKey ?? ""}`);
  console.log(`assignments\tcreate-research\tqueue\t${result.queueKey}`);
  console.log(`assignments\tcreate-research\tmodels\t${Object.entries(modelCounts).sort(([left], [right]) => left.localeCompare(right)).map(([model, count]) => `${model}=${count}`).join(" ")}`);
  console.log(`assignments\tcreate-research\tchanges\tcreate=${result.changes.create ?? 0}\tupdate=${result.changes.update ?? 0}\tnoop=${result.changes.noop ?? 0}`);
}

function normalizeResearchModeOption(value) {
  const normalized = normalizeCliString(value)?.replace(/-/g, "_") ?? "source_discovery";
  const allowed = new Set(["internal_brief", "source_discovery", "full_research"]);
  if (!allowed.has(normalized)) {
    throw new Error(`Invalid --research-mode ${value}. Expected one of: internal_brief, source_discovery, full_research.`);
  }
  return normalized;
}

async function applyResearchPacket(flags) {
  const options = parseOptions(flags);
  const assignmentId = normalizeCliString(options.assignment);
  if (!assignmentId) throw new Error("assignments apply-research-packet requires --assignment <id>.");
  const research = readResearchPacketInput(options);
  const summary = normalizeCliString(research.summary ?? research.synthesis?.summary);
  if (!summary) throw new Error("assignments apply-research-packet requires research.summary.");
  const { client } = createAuthoringClient();
  const assignment = await client.getRecord("Assignment", assignmentId);
  if (!assignment) throw new Error(`Assignment not found: ${assignmentId}.`);
  if (!assignment.assignmentTypeKey) throw new Error(`Assignment ${assignmentId} is missing assignmentTypeKey.`);
  if (!assignment.queueKey) throw new Error(`Assignment ${assignmentId} is missing queueKey.`);
  const assignmentMeta = await assignmentMetadata(client, assignment);
  const now = new Date().toISOString();
  const researchMode = normalizeResearchModeOption(
    research.research_mode ?? research.researchMode ?? assignmentMeta.researchMode ?? assignmentMeta.research_mode ?? options["research-mode"] ?? "source_discovery",
  );
  const packet = normalizeResearchPacketBundle(research, {
    assignment,
    assignmentMeta,
    researchMode,
  });
  validateResearchPacketMode(packet);
  const packetHash = researchPacketHash({ assignmentId, researchMode, packet });
  const messageId = normalizeCliString(options.id) ?? `message-research-packet-${packetHash}`;
  const message = {
    id: messageId,
    messageKind: "research_packet",
    messageDomain: "assignment_work",
    status: "active",
    summary,
    body: researchPacketBody(packet),
    metadata: JSON.stringify({
      kind: "research.packet.created",
      assignmentId,
      assignmentTypeKey: assignment.assignmentTypeKey,
      queueKey: assignment.queueKey,
      research: packet,
    }),
    source: "assignments apply-research-packet",
    importRunId: assignment.importRunId ?? null,
    authorLabel: normalizeCliString(options["actor-label"]) ?? "Papyrus content CLI",
    createdAt: now,
    updatedAt: now,
  };
  const relation = localSemanticRelationRecord({
    predicate: "produces",
    subjectKind: "assignment",
    subjectId: assignmentId,
    subjectLineageId: assignmentId,
    objectKind: "message",
    objectId: messageId,
    objectLineageId: messageId,
    rank: 1,
    confidence: 1,
    reviewRecommended: false,
    importRunId: assignment.importRunId ?? null,
    importedAt: now,
    metadata: {
      lifecycle: "assignment-research-packet",
      messageKind: "research_packet",
      metadataKind: "research.packet.created",
      assignmentTypeKey: assignment.assignmentTypeKey,
      queueKey: assignment.queueKey,
      researchMode,
      workProductKind: "research_packet",
    },
  });
  const records = [
    { modelName: "Message", expected: message },
    { modelName: "SemanticRelation", expected: relation },
  ];
  const changes = await buildRecordChangesTargetedById(client, records);
  validateResearchPacketPlannedChanges(changes, { assignmentId, messageId });
  const result = {
    ok: true,
    command: "assignments apply-research-packet",
    action: options.apply ? "apply" : "dry-run",
    assignmentId,
    messageId,
    packetHash,
    researchMode,
    changedRecords: changes.filter((change) => change.action !== "noop").length,
    changes: countDelta(changes, "action", "unknown"),
    proposedReferenceCount: packet.proposedReferences.length,
    sourceSnapshotCount: packet.sourceSnapshots.length,
    evidenceItemCount: packet.evidenceItemIds.length,
  };
  if (!options.apply) {
    if (options.json) {
      printCompactJson(result);
      return;
    }
    printResearchPacketApplySummary(result);
    console.log("assignments\tapply-research-packet\tapply\tskipped\tpass --apply to write Message records");
    return;
  }
  await applyRecordChanges(client, changes);
  await updateNewsroomSummaryAfterResearchPacketCreates(client, changes, {
    actorLabel: message.authorLabel,
    reason: `assignments apply-research-packet ${assignmentId}`,
  });
  if (options.json) {
    printCompactJson(result);
    return;
  }
  printResearchPacketApplySummary(result);
}

async function runResearchAssignment(flags) {
  const options = parseOptions(flags);
  const assignmentId = normalizeCliString(options.assignment);
  if (!assignmentId) throw new Error("assignments run-research requires --assignment <id>.");
  const corpusKey = normalizeCliString(options["corpus-key"]) ?? "AI-ML-research";
  const researchMode = normalizeResearchModeOption(options["research-mode"] ?? options.researchMode ?? "source_discovery");
  const runId = normalizeCliString(options["run-id"]) ?? `research-${safeId(assignmentId).slice(0, 60)}-${timestampForPath()}`;
  const runDir = path.join(process.cwd(), ".papyrus-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const resultPath = path.join(runDir, "research-result.json");
  const sourcePath = path.join(runDir, "research.cloud.tac");
  const stdoutPath = path.join(runDir, "research.stdout.log");
  const stderrPath = path.join(runDir, "research.stderr.log");
  const question = normalizeCliString(options["research-questions"] ?? options.question) ?? "";
  const contextProfile = normalizeCliString(options["context-profile"]) ?? "researcher";
  const maxEvidenceItems = normalizeCliNonNegativeInteger(options["max-evidence-items"], "--max-evidence-items") ?? 20;
  const startedAt = new Date().toISOString();
  const { client } = createAuthoringClient();
  const run = await startCloudProcedureRun({
    client,
    alias: "assignments.run-research",
    actorLabel: normalizeCliString(options.actor) ?? "papyrus-content-cli",
    title: `Run research assignment ${assignmentId}`,
    summary: "Triggered by assignments run-research via cloud procedure dispatch.",
    runDir,
    sourcePath,
    stdoutPath,
    stderrPath,
    input: {
      assignment_item_id: assignmentId,
      corpus_key: corpusKey,
      context_profile: contextProfile,
      research_mode: researchMode,
      research_questions: question,
      max_evidence_items: maxEvidenceItems,
    },
  });
  const finishedAt = new Date().toISOString();
  const parsed = normalizeGraphqlJsonValue(run.output);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Cloud procedure output for assignment ${assignmentId} did not return a JSON object payload.`);
  }
  let research = parsed?.research_packet ?? parsed?.researchPacket ?? null;
  if (!research) {
    throw new Error(`Cloud procedure output for assignment ${assignmentId} is missing research_packet. Run npm run seed:amplify if procedure seeds are stale.`);
  }
  let packet = research ? normalizeResearchPacketBundle(research, {
    assignment: { id: assignmentId, assignmentTypeKey: "research.edition-candidate", queueKey: "" },
    assignmentMeta: { researchMode, corpusKey },
    researchMode,
  }) : null;
  if (!packet) throw new Error(`Cloud procedure output for assignment ${assignmentId} returned an invalid research packet shape.`);
  validateResearchPacketMode(packet);
  const trace = packet?.researchTrace ?? {};
  const retryCountRaw = Number(
    parsed?.retry_count ?? parsed?.retryCount ?? trace.retryCount ?? trace.retry_count ?? 0
  );
  const retryCount = Number.isFinite(retryCountRaw) && retryCountRaw >= 0 ? retryCountRaw : 0;
  const validationFailuresRaw =
    parsed?.validation_failures
    ?? parsed?.validationFailures
    ?? trace.validationFailures
    ?? trace.validation_failures;
  const validationFailures = Array.isArray(validationFailuresRaw) ? validationFailuresRaw.map((entry) => String(entry)) : [];
  const result = {
    ok: true,
    command: "assignments run-research",
    action: options.apply ? "apply" : "dry-run",
    runId,
    assignmentId,
    researchMode,
    corpusKey,
    startedAt,
    finishedAt,
    exitStatus: 0,
    signal: null,
    stdoutPath,
    stderrPath,
    fallback: null,
    resultPath,
    parsed: Boolean(parsed),
    packet: packet ? {
      summary: packet.summary,
      proposedReferenceCount: packet.proposedReferences.length,
      sourceSnapshotCount: packet.sourceSnapshots.length,
      evidenceItemCount: packet.evidenceItemIds.length,
      blockedReason: packet.sourceDiscovery?.blockedReason ?? null,
      firstProposalUrl: packet.proposedReferences[0]?.url ?? null,
      attempts: retryCount + 1,
      recoveryPath: normalizeCliString(
        parsed?.recovery_path ?? parsed?.recoveryPath ?? trace.recoveryPath ?? trace.recovery_path
      ) ?? null,
      firstValidationError: validationFailures[0] ?? null,
      lastValidationError: validationFailures.length ? validationFailures[validationFailures.length - 1] : null,
    } : null,
    next: null,
  };
  if (!options.apply) {
    result.next = `npm run content -- assignments apply-research-packet --assignment ${assignmentId} --research-json ${resultPath} --apply`;
  }
  writeJsonFile(resultPath, {
    ...result,
    cloudProcedure: {
      runId: run.id ?? null,
      procedureKey: run.procedureKey ?? null,
      procedureVersionId: run.procedureVersionId ?? null,
      procedureVersionNumber: run.procedureVersionNumber ?? null,
      runStatus: run.runStatus ?? null,
      sourcePath: run.sourcePath ?? null,
    },
    commandLine: run.commandLine ?? null,
    value: parsed,
  });
  if (options.apply) {
    if (!research) throw new Error(`assignments run-research --apply could not find research_packet in ${resultPath}.`);
    await applyResearchPacket([
      "--assignment", assignmentId,
      "--research-json", JSON.stringify(research),
      "--research-mode", researchMode,
      "--apply",
      ...(options.json ? ["--json"] : []),
    ]);
    return;
  }
  if (options.json) {
    printCompactJson(result);
    return;
  }
  printResearchRunSummary(result);
}

async function runResearchIntakeNow(flags) {
  const options = parseOptions(flags);
  const assignmentId = normalizeCliString(options.assignment);
  if (!assignmentId) throw new Error("assignments research-intake-now requires --assignment <id>.");
  if (!options.config) throw new Error("assignments research-intake-now requires --config <steering.yml>.");
  const corpusKey = normalizeCliString(options["corpus-key"]);
  if (!corpusKey) throw new Error("assignments research-intake-now requires --corpus-key <key>.");
  const researchMode = normalizeResearchModeOption(options["research-mode"] ?? options.researchMode ?? "source_discovery");
  const apply = Boolean(options.apply);
  const asJson = Boolean(options.json);
  const runId = normalizeCliString(options["run-id"]) ?? `research-intake-${safeId(assignmentId).slice(0, 60)}-${timestampForPath()}`;
  const runDir = path.join(process.cwd(), ".papyrus-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  const researchRun = runContentCliJson([
    "assignments",
    "run-research",
    "--assignment", assignmentId,
    "--corpus-key", corpusKey,
    "--research-mode", researchMode,
    "--max-evidence-items", String(normalizeCliNonNegativeInteger(options["max-evidence-items"], "--max-evidence-items") ?? 20),
    "--run-id", `${runId}-research`,
    "--json",
    ...(options["research-questions"] ? ["--research-questions", String(options["research-questions"])] : []),
    ...(options.question ? ["--question", String(options.question)] : []),
    ...(options["context-profile"] ? ["--context-profile", String(options["context-profile"])] : []),
  ]);
  if (!researchRun.ok || !researchRun.payload?.parsed) {
    const result = {
      ok: false,
      command: "assignments research-intake-now",
      action: apply ? "apply" : "dry-run",
      assignmentId,
      researchMode,
      corpusKey,
      runId,
      researchRun: compactResearchRunChildResult(researchRun),
      messageId: null,
      catalogPath: null,
      proposedReferenceCount: 0,
      registeredReferenceCount: 0,
      skippedDuplicateCount: 0,
      curationAssignmentCount: 0,
      references: [],
      diagnostics: null,
      next: researchRun.payload?.next ?? `Inspect .papyrus-runs/${runId}-research`,
    };
    if (asJson) {
      printCompactJson(result);
      return;
    }
    printResearchIntakeNowSummary(result);
    return;
  }

  const resultPath = researchRun.payload.resultPath;
  const researchPayload = loadJsonFile(resultPath);
  const research = researchPayload.value?.research_packet ?? researchPayload.value?.researchPacket ?? null;
  if (!research) throw new Error(`assignments research-intake-now could not find research_packet in ${resultPath}.`);

  let messageId = null;
  let intakeResult = null;
  if (apply) {
    const applyRun = runContentCliJson([
      "assignments",
      "apply-research-packet",
      "--assignment", assignmentId,
      "--research-json", resultPath,
      "--research-mode", researchMode,
      "--apply",
      "--json",
    ]);
    if (!applyRun.ok || !applyRun.payload?.messageId) {
      const result = {
        ok: false,
        command: "assignments research-intake-now",
        action: "apply",
        assignmentId,
        researchMode,
        corpusKey,
        runId,
        researchRun: compactResearchRunChildResult(researchRun),
        applyResearchPacket: applyRun.payload ?? null,
        messageId: null,
        catalogPath: null,
        proposedReferenceCount: researchRun.payload.packet?.proposedReferenceCount ?? 0,
        registeredReferenceCount: 0,
        skippedDuplicateCount: 0,
        curationAssignmentCount: 0,
        references: [],
        diagnostics: null,
        next: `Inspect ${resultPath}`,
      };
      if (asJson) {
        printCompactJson(result);
        return;
      }
      printResearchIntakeNowSummary(result);
      return;
    }
    messageId = applyRun.payload.messageId;
    intakeResult = await intakeResearchPacketProposals({
      assignmentId,
      messageId,
      configPath: options.config,
      corpusKey,
      status: normalizeProposalIntakeStatus(options.status),
      reasonCode: options["reason-code"] ?? options.reasonCode,
      note: options.note,
      apply: true,
      runId,
      actor: options.actor ?? "Papyrus content CLI",
    });
  } else {
    const { client } = createAuthoringClient();
    const assignment = await client.getRecord("Assignment", assignmentId);
    if (!assignment) throw new Error(`Assignment not found: ${assignmentId}.`);
    const assignmentMeta = await assignmentMetadata(client, assignment);
    const packet = normalizeResearchPacketBundle(research, { assignment, assignmentMeta, researchMode });
    intakeResult = await planResearchPacketProposalIntake({
      client,
      assignment,
      message: null,
      packet,
      configPath: options.config,
      corpusKey,
      status: normalizeProposalIntakeStatus(options.status),
      reasonCode: options["reason-code"] ?? options.reasonCode,
      note: options.note,
      apply: false,
      runId,
      actor: options.actor ?? "Papyrus content CLI",
    });
  }

  const result = {
    ok: true,
    command: "assignments research-intake-now",
    action: apply ? "apply" : "dry-run",
    assignmentId,
    messageId,
    researchMode,
    corpusKey,
    runId,
    catalogPath: intakeResult.catalogPath,
    proposedReferenceCount: intakeResult.proposedReferenceCount,
    registeredReferenceCount: intakeResult.registeredReferenceCount,
    skippedDuplicateCount: intakeResult.skippedDuplicateCount,
    curationAssignmentCount: intakeResult.curationAssignmentCount,
    importRunId: intakeResult.importRunId,
    references: intakeResult.references ?? [],
    diagnostics: intakeResult.diagnostics ?? null,
    blockedReason: intakeResult.blockedReason,
    next: intakeResult.next,
  };
  if (asJson) {
    printCompactJson(result);
    return;
  }
  printResearchIntakeNowSummary(result);
}

async function runStoryCycle(flags) {
  const options = parseOptions(flags);
  const date = normalizeCliString(options.date);
  const topic = normalizeCliString(options.topic);
  if (!date) throw new Error("assignments run-story-cycle requires --date YYYY-MM-DD.");
  if (!topic) throw new Error("assignments run-story-cycle requires --topic <text>.");
  const apply = Boolean(options.apply);
  const asJson = Boolean(options.json);
  const planOnly = Boolean(options["plan-only"]);
  const through = normalizeStoryCycleThrough(planOnly ? "plan" : options.through);
  const requireAgentSuccess = Boolean(options["require-agent-success"]) || (apply && !options["allow-fallback"]);
  const allowFallback = Boolean(options["allow-fallback"]) || (!apply && !requireAgentSuccess);
  const refreshPackets = Boolean(options["refresh-packets"]);
  const forceRefreshSelected = Boolean(options["force-refresh-selected"]);
  const corpusKey = normalizeCliString(options["corpus-key"]) ?? "AI-ML-research";
  const categoryKey = normalizeCliString(options.category) ?? corpusKey;
  const coverageKey = normalizeCliString(options["coverage-key"]) ?? `coverage.${safeId(topic).replace(/-/g, ".")}`;
  const runId = normalizeCliString(options["run-id"]) ?? `story-cycle-${safeId(topic)}-${timestampForPath()}`;
  const runDir = path.resolve(options.output ?? path.join(".papyrus-runs", runId));
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, "research"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "reporting"), { recursive: true });

  const { client } = createAuthoringClient();
  const context = await loadStoryCyclePlanningContext(client, {
    corpusKey,
    categoryKey,
  });
  const plan = buildStoryCyclePlan({
    date,
    topic,
    corpusKey,
    categoryKey,
    coverageKey,
    runId,
    researchMode: options["research-mode"] ?? options.researchMode,
    overassignmentRatio: options.ratio,
    sections: parseCommaList(options.sections),
    sectionBudgets: parseCommaList(options["section-budgets"]),
    anglesBySection: parseCommaList(options.angles),
    newsroomSections: context.newsroomSections,
    categorySet: context.categorySet,
    category: context.category,
  });
  const assignmentChanges = await buildRecordChangesTargetedByIdToleratingOptionalModels(client, plan.records, {
    prepareVersioned: false,
  });
  if (apply) {
    await applyRecordChanges(client, assignmentChanges);
    await updateNewsroomSummaryAfterAssignmentCreates(client, assignmentChanges, {
      actorLabel: "Papyrus content CLI",
      reason: `assignments run-story-cycle ${runId}`,
    });
  }

  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = {
    schemaVersion: 1,
    command: "assignments run-story-cycle",
    workflowName: "Coverage Theme",
    runId,
    action: apply ? "apply" : "dry-run",
    through,
    requireAgentSuccess,
    allowFallback,
    refreshPackets,
    forceRefreshSelected,
    date,
    topic,
    corpusKey,
    categoryKey,
    coverageKey,
    coverageNodeId: plan.coverageNode.id,
    runDir,
    manifestPath,
    createdAt: new Date().toISOString(),
    sections: plan.sections,
    assignmentChangeCounts: changeCounts(assignmentChanges),
    planSummary: plan.summary,
    researchAssignments: plan.researchAssignments.map(storyCycleAssignmentSummary),
    reportingAssignments: plan.reportingAssignments.map(storyCycleAssignmentSummary),
    researchRuns: [],
    reportingRuns: [],
    failures: [],
    next: null,
  };
  writeJsonFile(manifestPath, manifest);

  if (through === "research" || through === "reporting") {
    const maxParallelResearch = normalizeCliNonNegativeInteger(options["max-parallel-research"], "--max-parallel-research") ?? 2;
    manifest.researchRuns = await runStoryCycleJobs(plan.researchAssignments, maxParallelResearch, async (assignment) => (
      runStoryCycleResearchJob({
        client,
        assignment,
        apply,
        allowFallback,
        requireAgentSuccess,
        refreshPackets,
        forceRefreshSelected,
        runDir,
        corpusKey,
        researchMode: plan.researchMode,
        topic,
        coverageKey,
        maxEvidenceItems: normalizeCliNonNegativeInteger(options["max-evidence-items"], "--max-evidence-items") ?? 20,
      })
    ));
    writeJsonFile(manifestPath, manifest);
  }

  const researchBySection = new Map(manifest.researchRuns.map((run) => [run.sectionKey, run]));
  if (through === "reporting") {
    const maxParallelReporting = normalizeCliNonNegativeInteger(options["max-parallel-reporting"], "--max-parallel-reporting") ?? 3;
    manifest.reportingRuns = await runStoryCycleJobs(plan.reportingAssignments, maxParallelReporting, async (assignment) => (
      runStoryCycleReportingJobOrBlocked({
        client,
        assignment,
        apply,
        allowFallback,
        requireAgentSuccess,
        refreshPackets,
        forceRefreshSelected,
        runDir,
        corpusKey,
        topic,
        coverageKey,
        researchRun: researchBySection.get(assignment.sectionKey) ?? null,
      })
    ));
  }

  const output = buildStoryCycleOutput({
    ...manifest,
    manifestPath,
  });
  const outputPath = path.join(runDir, "story-cycle-output.json");
  writeJsonFile(outputPath, output);
  manifest.failures = output.failures;
  manifest.degraded = output.degraded;
  manifest.degradedCount = output.degraded.length;
  manifest.outputPath = outputPath;
  manifest.next = `npm run content -- assignments story-cycle-output --run-id ${runId}${asJson ? " --json" : ""}`;
  writeJsonFile(manifestPath, manifest);

  const result = {
    ok: output.failures.length === 0 && !(requireAgentSuccess && output.degraded.length > 0),
    command: "assignments run-story-cycle",
    action: apply ? "apply" : "dry-run",
    runId,
    date,
    topic,
    through,
    coverageKey,
    categoryKey,
    sections: plan.sections.map((section) => section.key),
    researchAssignments: manifest.researchAssignments,
    reportingAssignments: manifest.reportingAssignments,
    researchPackets: output.sections.flatMap((section) => section.researchPackets.map((packet) => ({ sectionKey: section.sectionKey, ...packet }))),
    reportingPackets: output.sections.flatMap((section) => section.reportingPackets.map((packet) => ({ sectionKey: section.sectionKey, ...packet }))),
    failures: output.failures,
    degraded: output.degraded,
    degradedCount: output.degraded.length,
    manifestPath,
    outputPath,
    next: manifest.next,
  };
  if (asJson) {
    printCompactJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  printStoryCycleSummary(result);
  if (!result.ok) process.exitCode = 1;
}

async function showStoryCycleOutput(flags) {
  const options = parseOptions(flags);
  const filters = {
    runId: normalizeCliString(options["run-id"]),
    coverageKey: normalizeCliString(options["coverage-key"]),
    date: normalizeCliString(options.date),
    assignmentId: normalizeCliString(options.assignment),
  };
  const manifestPath = findStoryCycleManifestPath(filters);
  const manifest = manifestPath ? loadJsonFile(manifestPath) : null;
  let liveError = null;
  let output = null;
  if (!options["local-only"]) {
    try {
      const { client } = createAuthoringClient();
      const liveManifest = await loadAppliedStoryCycleManifestFromGraph(client, {
        ...filters,
        manifest,
        manifestPath,
      });
      if (liveManifest) {
        output = buildStoryCycleOutput(liveManifest, {
          section: normalizeCliString(options.section),
        });
      }
    } catch (error) {
      liveError = normalizeError(error);
      if (!manifest) throw error;
    }
  }
  if (!output) {
    if (!manifest) throw new Error("No story-cycle manifest or applied Coverage Theme records matched the requested filters.");
    output = buildStoryCycleOutput({
      ...manifest,
      manifestPath,
    }, {
      section: normalizeCliString(options.section),
    });
  }
  if (liveError) output.warnings = [...(output.warnings ?? []), `Live Coverage Theme rediscovery failed; used local manifest: ${liveError.message}`];
  if (options.json) {
    printCompactJson(output);
    return;
  }
  printStoryCycleOutput(output);
}

async function loadAppliedStoryCycleManifestFromGraph(client, { runId, coverageKey, date, assignmentId, manifest = null, manifestPath = null }) {
  const assignments = await client.listRecords("Assignment");
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const manifestAssignmentIds = new Set([
    ...(manifest?.researchAssignments ?? []).map((assignment) => assignment.id),
    ...(manifest?.reportingAssignments ?? []).map((assignment) => assignment.id),
  ].filter(Boolean));
  if (assignmentId) manifestAssignmentIds.add(assignmentId);
  const candidates = assignments
    .filter((assignment) => assignment.assignmentTypeKey === "research.edition-candidate" || assignment.assignmentTypeKey === "reporting.edition-candidate")
    .filter((assignment) => {
      const metadata = parseJsonish(assignment.metadata);
      return (
        (!runId || metadata.storyCycleRunId === runId || metadata.coverageThemeRunId === runId || manifestAssignmentIds.has(assignment.id))
        && (!coverageKey || metadata.coverageConceptKey === coverageKey)
        && (!date || metadata.storyCycleDate === date || metadata.editionDate === date)
        && (!assignmentId || assignment.id === assignmentId || metadata.sourceResearchAssignmentId === assignmentId)
      );
    });
  if (!candidates.length) return null;

  const relationsByAssignment = new Map();
  await Promise.all(candidates.map(async (assignment) => {
    relationsByAssignment.set(assignment.id, await client.listSemanticRelationsBySubjectState(semanticStateKey("assignment", assignment.id)));
  }));
  const producedMessageIds = Array.from(new Set(Array.from(relationsByAssignment.values())
    .flat()
    .filter((relation) => relation.relationState !== "superseded")
    .filter((relation) => (relation.relationTypeKey ?? relation.predicate) === "produces")
    .filter((relation) => relation.objectKind === "message")
    .map((relation) => relation.objectId)
    .filter(Boolean)));
  const messageMap = await client.getRecordsById("Message", producedMessageIds);
  const messages = Array.from(messageMap.values()).filter(Boolean);
  const payloadByMessageId = new Map();
  await Promise.all(messages.map(async (message) => {
    payloadByMessageId.set(message.id, await readJsonModelPayloadOptional(client, "message", message.id, "metadata", "metadata"));
  }));

  const diagnosticsByAssignment = new Map([
    ...(manifest?.researchRuns ?? []),
    ...(manifest?.reportingRuns ?? []),
  ].map((run) => [run.assignmentId, run]));
  const researchRuns = [];
  const reportingRuns = [];
  for (const assignment of candidates.sort(compareAssignmentsForStoryCycleOutput)) {
    const metadata = parseJsonish(assignment.metadata);
    const relations = relationsByAssignment.get(assignment.id) ?? [];
    const linkedMessages = relations
      .filter((relation) => relation.relationState !== "superseded")
      .filter((relation) => (relation.relationTypeKey ?? relation.predicate) === "produces")
      .filter((relation) => relation.objectKind === "message")
      .map((relation) => messageMap.get(relation.objectId))
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    const diagnostic = diagnosticsByAssignment.get(assignment.id) ?? {};
    if (assignment.assignmentTypeKey === "research.edition-candidate") {
      const message = linkedMessages.find((entry) => entry.messageKind === "research_packet") ?? null;
      const payload = message ? payloadByMessageId.get(message.id) : null;
      const packet = storyCyclePacketPayload(payload, "research") ?? {};
      const messageDiagnostic = message && diagnostic?.messageId === message.id ? diagnostic : (!message ? diagnostic : {});
      researchRuns.push({
        ok: Boolean(message),
        phase: "research",
        sectionKey: assignment.sectionKey ?? metadata.sectionKey ?? "unsectioned",
        assignmentId: assignment.id,
        messageId: message?.id ?? null,
        packet,
        degraded: storyCyclePacketDegraded(packet, messageDiagnostic),
        fallbackReason: storyCyclePacketFallbackReason(packet, messageDiagnostic),
        fallbackKind: storyCyclePacketFallbackKind(packet, messageDiagnostic),
        agentExitStatus: messageDiagnostic.agentExitStatus ?? messageDiagnostic.exitStatus ?? null,
        exitStatus: messageDiagnostic.exitStatus ?? null,
        stderrPath: messageDiagnostic.stderrPath ?? null,
        packetPath: messageDiagnostic.packetPath ?? null,
        error: messageDiagnostic.error ?? null,
        persistenceSkippedReason: messageDiagnostic.persistenceSkippedReason ?? null,
        refreshSkippedReason: messageDiagnostic.refreshSkippedReason ?? null,
        protectedBy: messageDiagnostic.protectedBy ?? null,
      });
    } else if (assignment.assignmentTypeKey === "reporting.edition-candidate") {
      const message = linkedMessages.find((entry) => entry.messageKind === "reporting_context_packet") ?? null;
      const payload = message ? payloadByMessageId.get(message.id) : null;
      const packet = storyCyclePacketPayload(payload, "reporting") ?? {};
      const messageDiagnostic = message && diagnostic?.messageId === message.id ? diagnostic : (!message ? diagnostic : {});
      reportingRuns.push({
        ok: Boolean(message),
        phase: "reporting",
        sectionKey: assignment.sectionKey ?? metadata.sectionKey ?? "unsectioned",
        assignmentId: assignment.id,
        messageId: message?.id ?? null,
        angle: storyCycleAssignmentAngle({ assignment, metadata, diagnostic }),
        packet,
        degraded: storyCyclePacketDegraded(packet, messageDiagnostic),
        fallbackReason: storyCyclePacketFallbackReason(packet, messageDiagnostic),
        fallbackKind: storyCyclePacketFallbackKind(packet, messageDiagnostic),
        agentExitStatus: messageDiagnostic.agentExitStatus ?? messageDiagnostic.exitStatus ?? null,
        exitStatus: messageDiagnostic.exitStatus ?? null,
        stderrPath: messageDiagnostic.stderrPath ?? null,
        packetPath: messageDiagnostic.packetPath ?? null,
        error: messageDiagnostic.error ?? null,
        persistenceSkippedReason: messageDiagnostic.persistenceSkippedReason ?? null,
        refreshSkippedReason: messageDiagnostic.refreshSkippedReason ?? null,
        protectedBy: messageDiagnostic.protectedBy ?? null,
      });
    }
  }

  const firstMetadata = parseJsonish(candidates[0]?.metadata);
  const sections = storyCycleSectionsFromAssignments({ assignments: candidates, manifest, newsroomSections: await loadStoryCycleNewsroomSections(client) });
  return {
    schemaVersion: 1,
    command: "assignments story-cycle-output",
    workflowName: "Coverage Theme",
    runId: runId ?? manifest?.runId ?? firstMetadata.storyCycleRunId ?? firstMetadata.coverageThemeRunId ?? null,
    action: "apply",
    through: manifest?.through ?? (reportingRuns.length ? "reporting" : researchRuns.length ? "research" : "plan"),
    date: date ?? manifest?.date ?? firstMetadata.storyCycleDate ?? firstMetadata.editionDate ?? null,
    topic: manifest?.topic ?? firstMetadata.topic ?? firstMetadata.coverageThemeLabel ?? null,
    categoryKey: manifest?.categoryKey ?? firstMetadata.categoryKey ?? firstMetadata.focusCategoryKey ?? null,
    coverageKey: coverageKey ?? manifest?.coverageKey ?? firstMetadata.coverageConceptKey ?? null,
    manifestPath,
    sections,
    researchAssignments: candidates.filter((assignment) => assignment.assignmentTypeKey === "research.edition-candidate").map(storyCycleAssignmentSummary),
    reportingAssignments: candidates.filter((assignment) => assignment.assignmentTypeKey === "reporting.edition-candidate").map(storyCycleAssignmentSummary),
    researchRuns,
    reportingRuns,
  };
}

function storyCyclePacketPayload(payload, kind) {
  const parsed = parseJsonish(payload);
  if (!parsed || typeof parsed !== "object") return null;
  if (kind === "research") {
    const nested = parseJsonish(parsed.research ?? parsed.research_packet ?? parsed.researchPacket);
    return Object.keys(nested).length ? nested : parsed;
  }
  if (kind === "reporting") {
    const nested = parseJsonish(parsed.reporting ?? parsed.reporting_context_packet ?? parsed.reportingContextPacket);
    return Object.keys(nested).length ? nested : parsed;
  }
  return parsed;
}

function storyCyclePacketDegraded(packet, diagnostic) {
  const trace = parseJsonish(packet?.researchTrace ?? packet?.research_trace);
  const unresolvedGaps = parseArrayValue(trace.unresolvedGaps ?? trace.unresolved_gaps);
  const riskFlags = parseArrayValue(packet?.risk_flags ?? packet?.riskFlags);
  const coverageGaps = parseArrayValue(packet?.coverage_gaps ?? packet?.coverageGaps);
  const degradationText = [...riskFlags, ...coverageGaps].map((entry) => String(entry).toLowerCase()).join(" ");
  return Boolean(
    diagnostic?.degraded
    || diagnostic?.fallback
    || packet?.degraded
    || packet?.fallback
    || packet?.recoveryPath
    || packet?.recovery_path
    || packet?.fallbackReason
    || packet?.fallback_reason
    || packet?.blockedReason
    || packet?.blocked_reason
    || packet?.evidenceSanitized
    || packet?.evidence_sanitized
    || trace?.recoveryPath
    || trace?.recovery_path
    || trace?.fallbackReason
    || trace?.fallback_reason
    || unresolvedGaps.includes("agent_output_not_structured")
    || unresolvedGaps.includes("web_search_failed_after_retry")
    || degradationText.includes("live context unavailable")
    || degradationText.includes("live context helper")
    || degradationText.includes("live assignment context helper failed")
    || degradationText.includes("live assignment context unavailable")
    || degradationText.includes("live assignment context was unavailable")
    || degradationText.includes("could not load live assignment context")
    || degradationText.includes("assignment_context_json was unavailable")
    || degradationText.includes("inline assignment_json only")
  );
}

function storyCyclePacketFallbackReason(packet, diagnostic) {
  const fallback = parseJsonish(packet?.fallback);
  const trace = parseJsonish(packet?.researchTrace ?? packet?.research_trace);
  const unresolvedGaps = parseArrayValue(trace.unresolvedGaps ?? trace.unresolved_gaps);
  const riskFlags = parseArrayValue(packet?.risk_flags ?? packet?.riskFlags);
  const coverageGaps = parseArrayValue(packet?.coverage_gaps ?? packet?.coverageGaps);
  const degradationText = [...riskFlags, ...coverageGaps].map((entry) => String(entry).toLowerCase()).join(" ");
  return normalizeCliString(diagnostic?.fallbackReason)
    ?? normalizeCliString(packet?.fallbackReason ?? packet?.fallback_reason)
    ?? normalizeCliString(packet?.blockedReason ?? packet?.blocked_reason)
    ?? (packet?.evidenceSanitized || packet?.evidence_sanitized ? "accepted_evidence_sanitized" : null)
    ?? normalizeCliString(fallback.reason)
    ?? normalizeCliString(trace.fallbackReason ?? trace.fallback_reason)
    ?? (unresolvedGaps.includes("web_search_failed_after_retry") ? "web_search_failed_after_retry" : null)
    ?? (unresolvedGaps.includes("agent_output_not_structured") ? "agent_output_not_structured" : null)
    ?? (degradationText.includes("live context unavailable")
      || degradationText.includes("live context helper")
      || degradationText.includes("live assignment context helper failed")
      || degradationText.includes("live assignment context unavailable")
      || degradationText.includes("live assignment context was unavailable")
      || degradationText.includes("could not load live assignment context")
      || degradationText.includes("assignment_context_json was unavailable")
      || degradationText.includes("inline assignment_json only")
      ? "live_context_unavailable"
      : null)
    ?? null;
}

function storyCyclePacketFallbackKind(packet, diagnostic) {
  const fallback = parseJsonish(packet?.fallback);
  return normalizeCliString(diagnostic?.fallbackKind)
    ?? normalizeCliString(fallback.kind)
    ?? null;
}

function storyCycleAssignmentAngle({ assignment, metadata, diagnostic }) {
  return normalizeCliString(metadata?.angleDiversity?.lensLabel)
    ?? normalizeCliString(metadata?.angleDiversity?.lensKey)
    ?? normalizeCliString(diagnostic?.angle)
    ?? normalizeCliString(String(assignment?.title ?? "").split(":").slice(1).join(":"))
    ?? null;
}

function compareAssignmentsForStoryCycleOutput(left, right) {
  const leftMeta = parseJsonish(left.metadata);
  const rightMeta = parseJsonish(right.metadata);
  return (
    String(left.sectionKey ?? leftMeta.sectionKey ?? "").localeCompare(String(right.sectionKey ?? rightMeta.sectionKey ?? ""))
    || String(left.assignmentTypeKey ?? "").localeCompare(String(right.assignmentTypeKey ?? ""))
    || Number(leftMeta.slotTarget?.candidateRank ?? 0) - Number(rightMeta.slotTarget?.candidateRank ?? 0)
    || String(left.id).localeCompare(String(right.id))
  );
}

function storyCycleSectionsFromAssignments({ assignments, manifest, newsroomSections }) {
  if (Array.isArray(manifest?.sections) && manifest.sections.length) return manifest.sections;
  const sectionsById = new Map((newsroomSections ?? []).map((section) => [section.id, section]));
  const seen = new Set();
  return assignments
    .map((assignment) => {
      const metadata = parseJsonish(assignment.metadata);
      const key = assignment.sectionKey ?? metadata.sectionKey ?? assignment.sectionId ?? metadata.sectionId ?? "unsectioned";
      if (seen.has(key)) return null;
      seen.add(key);
      const section = sectionsById.get(key);
      return {
        key,
        title: section?.title ?? metadata.sectionTitle ?? key,
        researchLens: metadata.researchLens ?? null,
        slots: metadata.slotTarget?.slots ?? section?.defaultPageBudget ?? 1,
      };
    })
    .filter(Boolean);
}

async function loadStoryCyclePlanningContext(client, { corpusKey, categoryKey }) {
  const [categorySets, categories, newsroomSections] = await Promise.all([
    client.listRecords("CategorySet"),
    client.listRecords("Category"),
    loadStoryCycleNewsroomSections(client),
  ]);
  const categorySet = selectStoryCycleCategorySet(categorySets, corpusKey);
  const category = selectStoryCycleCategory(categories, categoryKey, categorySet);
  return {
    categorySet,
    category,
    newsroomSections,
  };
}

async function loadStoryCycleNewsroomSections(client) {
  const seededSections = loadNewsroomSectionSeeds(DEFAULT_NEWSROOM_SECTIONS_PATH);
  try {
    const sections = await client.listRecords("NewsroomSection");
    if (sections.length) {
      const byId = new Map(seededSections.map((section) => [section.id, section]));
      for (const section of sections) byId.set(section.id, section);
      return Array.from(byId.values());
    }
  } catch (error) {
    if (!isMissingGraphQLModelError(error, "NewsroomSection") && !isDynamoResourceNotFoundError(error)) throw error;
  }
  return seededSections;
}

function selectStoryCycleCategorySet(categorySets, corpusKey) {
  const corpusId = `knowledge-corpus-${safeId(corpusKey)}`;
  const candidates = (categorySets ?? [])
    .filter((categorySet) => categorySet.status === "accepted")
    .filter((categorySet) => !categorySet.versionState || categorySet.versionState === "current")
    .filter((categorySet) => categorySet.corpusId === corpusId || categorySet.corpusKey === corpusKey || !corpusKey);
  candidates.sort((left, right) => String(right.generatedAt ?? right.versionCreatedAt ?? "").localeCompare(String(left.generatedAt ?? left.versionCreatedAt ?? "")));
  return candidates[0] ?? null;
}

function selectStoryCycleCategory(categories, categoryKey, categorySet) {
  const matches = (categories ?? [])
    .filter((category) => !categorySet || category.categorySetId === categorySet.id)
    .filter((category) => !category.versionState || category.versionState === "current")
    .filter((category) => category.status !== "archived")
    .filter((category) => (
      category.id === categoryKey
      || category.lineageId === categoryKey
      || category.categoryKey === categoryKey
      || category.displayName === categoryKey
    ));
  return matches[0] ?? null;
}

async function runStoryCycleJobs(items, maxParallel, worker) {
  const limit = Math.max(1, maxParallel);
  const results = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = {
          ok: false,
          phase: "unknown",
          assignmentId: items[index]?.id ?? null,
          sectionKey: items[index]?.sectionKey ?? null,
          error: error instanceof Error ? error.message : String(error ?? ""),
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
  return results;
}

function storyCycleHasBlockingFailures(runs, { requireAgentSuccess }) {
  return Boolean(requireAgentSuccess && (runs ?? []).some((run) => !run.ok || run.degraded));
}

function storyCyclePacketMessageId(assignment, messageKind) {
  const suffix = messageKind === "research_packet" ? "research_packet" : "reporting_context_packet";
  return `message-${messageKind.replace(/_/g, "-")}-${hashShort([assignment.id, suffix])}`;
}

async function loadExistingStoryCyclePacket(client, assignment, messageKind) {
  const messageId = storyCyclePacketMessageId(assignment, messageKind);
  const message = await client.getRecord("Message", messageId);
  if (!message) return null;
  const metadata = await readJsonModelPayloadOptional(client, "message", message.id, "metadata", "metadata")
    ?? parseJsonish(message.metadata);
  const packet = storyCyclePacketPayload(metadata, messageKind === "research_packet" ? "research" : "reporting");
  if (!packet || !Object.keys(packet).length) return null;
  return { message, metadata, packet };
}

const REPORTING_REVIEW_EVENT_TYPES = new Set([
  "reporting_select",
  "reporting_merge",
  "reporting_brief",
  "reporting_hold",
  "reporting_kill",
]);

async function loadReportingPacketRefreshProtection(client, { assignment, message }) {
  const [events, downstreamProtection] = await Promise.all([
    client.listAssignmentEventsByAssignmentAndCreatedAt(assignment.id).catch(() => []),
    loadMessageDownstreamLineageProtection(client, { assignment, message }),
  ]);
  const reviewEvent = (events ?? [])
    .filter((event) => REPORTING_REVIEW_EVENT_TYPES.has(event.eventType))
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))[0] ?? null;
  if (reviewEvent) {
    return {
      protected: true,
      reason: `protected_by_${reviewEvent.eventType}`,
      protectedBy: {
        kind: "assignment_event",
        id: reviewEvent.id,
        eventType: reviewEvent.eventType,
        createdAt: reviewEvent.createdAt ?? null,
      },
    };
  }
  if (downstreamProtection.protected) return downstreamProtection;
  return { protected: false, reason: null, protectedBy: null };
}

async function loadMessageDownstreamLineageProtection(client, { assignment, message }) {
  const messageObjectRelations = await client.listSemanticRelationsByObjectState(semanticStateKey("message", message.id)).catch(() => []);
  const downstreamRelation = (messageObjectRelations ?? []).find((relation) => (
    relation.relationState !== "superseded"
    && (relation.subjectKind === "assignment" || relation.subjectKind === "message")
    && relation.subjectId !== assignment.id
    && relation.subjectId !== message.id
    && relation.objectKind === "message"
    && relation.objectId === message.id
    && (relation.relationTypeKey ?? relation.predicate) === "derived_from"
  ));
  if (downstreamRelation) {
    return {
      protected: true,
      reason: "protected_by_downstream_lineage",
      protectedBy: {
        kind: "semantic_relation",
        id: downstreamRelation.id,
        subjectKind: downstreamRelation.subjectKind,
        subjectId: downstreamRelation.subjectId,
        relationTypeKey: downstreamRelation.relationTypeKey ?? downstreamRelation.predicate ?? null,
      },
    };
  }
  return { protected: false, reason: null, protectedBy: null };
}

async function runStoryCycleResearchJob({ client, assignment, apply, allowFallback, requireAgentSuccess, refreshPackets, forceRefreshSelected, runDir, corpusKey, researchMode, topic, coverageKey, maxEvidenceItems }) {
  const sectionKey = assignment.sectionKey ?? "unsectioned";
  const basePath = path.join(runDir, "research", `${safeId(sectionKey)}-${safeId(assignment.id)}`);
  const stdoutPath = `${basePath}.stdout.log`;
  const stderrPath = `${basePath}.stderr.log`;
  const sourcePath = `${basePath}.cloud.tac`;
  const resultPath = `${basePath}.result.json`;
  const packetPath = `${basePath}.packet.json`;
  if (apply && refreshPackets && !forceRefreshSelected) {
    const existing = await loadExistingStoryCyclePacket(client, assignment, "research_packet");
    if (existing) {
      const protection = await loadMessageDownstreamLineageProtection(client, { assignment, message: existing.message });
      if (protection.protected) {
        writeJsonFile(packetPath, existing.packet);
        writeJsonFile(resultPath, {
          resumed: true,
          messageId: existing.message.id,
          packetPath,
          refreshSkippedReason: protection.reason,
          protectedBy: protection.protectedBy,
        });
        return {
          ok: true,
          degraded: storyCyclePacketDegraded(existing.packet, null),
          fallbackReason: storyCyclePacketFallbackReason(existing.packet, null),
          fallbackKind: storyCyclePacketFallbackKind(existing.packet, null),
          agentExitStatus: null,
          persistenceSkippedReason: protection.reason,
          phase: "research",
          assignmentId: assignment.id,
          sectionKey,
          messageId: existing.message.id,
          packetPath,
          resultPath,
          stdoutPath: null,
          stderrPath: null,
          exitStatus: null,
          signal: null,
          packet: existing.packet,
          fallback: null,
          recordPlan: null,
          applyResult: { messageId: existing.message.id, changes: { noop: 1 } },
          resumed: true,
          refreshSkippedReason: protection.reason,
          protectedBy: protection.protectedBy,
        };
      }
    }
  }
  if (apply && !refreshPackets) {
    const existing = await loadExistingStoryCyclePacket(client, assignment, "research_packet");
    if (existing) {
      writeJsonFile(packetPath, existing.packet);
      writeJsonFile(resultPath, { resumed: true, messageId: existing.message.id, packetPath });
      return {
        ok: true,
        degraded: storyCyclePacketDegraded(existing.packet, null),
        fallbackReason: storyCyclePacketFallbackReason(existing.packet, null),
        fallbackKind: storyCyclePacketFallbackKind(existing.packet, null),
        agentExitStatus: null,
        persistenceSkippedReason: null,
        phase: "research",
        assignmentId: assignment.id,
        sectionKey,
        messageId: existing.message.id,
        packetPath,
        resultPath,
        stdoutPath: null,
        stderrPath: null,
        exitStatus: null,
        signal: null,
        packet: existing.packet,
        fallback: null,
        recordPlan: null,
        applyResult: { messageId: existing.message.id, changes: { noop: 1 } },
        resumed: true,
      };
    }
  }
  const cloudRun = await startCloudProcedureRun({
    client,
    alias: "story-cycle.research",
    actorLabel: "papyrus-content-cli",
    title: `Story-cycle research ${assignment.id}`,
    summary: "Triggered by story-cycle research phase via cloud procedure dispatch.",
    runDir,
    sourcePath,
    stdoutPath,
    stderrPath,
    input: {
      assignment_item_id: apply ? assignment.id : null,
      assignment_json: assignment,
      corpus_key: corpusKey,
      context_profile: "researcher",
      research_mode: researchMode,
      research_questions: storyCycleResearchQuestion({ topic, sectionKey, coverageKey }),
      max_evidence_items: maxEvidenceItems,
    },
  });
  const parsed = normalizeGraphqlJsonValue(cloudRun.output);
  let packet = parsed?.research_packet ?? parsed?.researchPacket ?? null;
  let fallback = null;
  if (!packet) {
    if (allowFallback) {
      fallback = buildStoryCycleResearchFallbackPacket({
        assignment,
        topic,
        coverageKey,
        researchMode,
        reason: "missing_research_packet",
      });
      packet = fallback.packet;
    } else {
      throw new Error(`Cloud procedure output is missing research_packet for assignment ${assignment.id}. Run npm run seed:amplify if procedure seeds are stale.`);
    }
  }
  if (packet) writeJsonFile(packetPath, packet);
  writeJsonFile(resultPath, {
    cloudProcedure: {
      runId: cloudRun.id ?? null,
      procedureKey: cloudRun.procedureKey ?? null,
      procedureVersionId: cloudRun.procedureVersionId ?? null,
      procedureVersionNumber: cloudRun.procedureVersionNumber ?? null,
      runStatus: cloudRun.runStatus ?? null,
      sourcePath: cloudRun.sourcePath ?? null,
    },
    commandLine: cloudRun.commandLine ?? null,
    parsed,
    fallback,
    stdoutPath,
    stderrPath,
  });
  const detectedDegraded = packet ? storyCyclePacketDegraded(packet, null) : false;
  const detectedFallbackReason = packet ? storyCyclePacketFallbackReason(packet, null) : null;
  const procedureFailed = String(cloudRun.runStatus ?? "").toLowerCase() === "failed";
  const degraded = Boolean(fallback) || procedureFailed || detectedDegraded;
  const persistenceBlocked = Boolean(requireAgentSuccess && degraded);
  const recordPlan = packet
    ? buildStoryCycleResearchRecordPlan({ assignment, packet })
    : null;
  let messageId = null;
  let applyResult = null;
  if (apply && recordPlan && !persistenceBlocked) {
    applyResult = await applyStoryCycleTactusPlan(client, recordPlan);
    messageId = applyResult.messageId;
  }
  return {
    ok: Boolean(packet) && (!apply || (Boolean(recordPlan) && !persistenceBlocked)),
    degraded,
    fallbackReason: fallback?.reason ?? (procedureFailed ? "research_procedure_failed" : detectedFallbackReason ?? (!packet ? "missing_research_packet" : null)),
    fallbackKind: fallback?.kind ?? null,
    agentExitStatus: cloudRun.exitStatus ?? (procedureFailed ? 1 : 0),
    persistenceSkippedReason: persistenceBlocked ? "require_agent_success" : (!recordPlan && apply ? "missing_record_plan" : null),
    phase: "research",
    assignmentId: assignment.id,
    sectionKey,
    messageId,
    packetPath: packet ? packetPath : null,
    resultPath,
    stdoutPath,
    stderrPath,
    exitStatus: cloudRun.exitStatus ?? (procedureFailed ? 1 : 0),
    signal: cloudRun.signal ?? null,
    packet,
    fallback,
    recordPlan,
    applyResult,
  };
}

async function runStoryCycleReportingJobOrBlocked(options) {
  const { assignment, researchRun, requireAgentSuccess } = options;
  if (requireAgentSuccess && (!researchRun || !researchRun.ok || researchRun.degraded)) {
    return {
      ok: false,
      degraded: false,
      phase: "reporting",
      sectionKey: assignment.sectionKey ?? null,
      assignmentId: assignment.id,
      angle: storyCycleAssignmentSummary(assignment).angle,
      messageId: null,
      packetPath: null,
      resultPath: null,
      stdoutPath: null,
      stderrPath: null,
      exitStatus: null,
      signal: null,
      sourceResearchAssignmentId: researchRun?.assignmentId ?? null,
      sourceResearchPacketId: researchRun?.messageId ?? null,
      error: researchRun ? "blocked_by_degraded_research" : "blocked_by_missing_research",
      persistenceSkippedReason: "require_agent_success",
    };
  }
  return runStoryCycleReportingJob(options);
}

async function runStoryCycleReportingJob({ client, assignment, apply, allowFallback, requireAgentSuccess, refreshPackets, forceRefreshSelected, runDir, corpusKey, topic, coverageKey, researchRun }) {
  const sectionKey = assignment.sectionKey ?? "unsectioned";
  const assignmentMeta = parseJsonish(assignment.metadata);
  const angle = assignmentMeta.angleDiversity?.lensLabel ?? assignmentMeta.angleDiversity?.lensKey ?? null;
  const assignmentForAgent = compactAssignmentForAgent({
    assignment,
    metadata: {
      storyCycleRunId: assignmentMeta.storyCycleRunId ?? null,
      storyCycleDate: assignmentMeta.storyCycleDate ?? null,
      topic: assignmentMeta.topic ?? topic ?? null,
      coverageConceptKey: assignmentMeta.coverageConceptKey ?? coverageKey ?? null,
      categoryKey: assignmentMeta.categoryKey ?? null,
      sectionKey: assignmentMeta.sectionKey ?? sectionKey,
      sectionTitle: assignmentMeta.sectionTitle ?? null,
      sectionMission: assignmentMeta.sectionMission ?? null,
      angleDiversity: assignmentMeta.angleDiversity ?? null,
      slotTarget: assignmentMeta.slotTarget ?? null,
      sourceResearchAssignmentId: researchRun?.assignmentId ?? assignmentMeta.sourceResearchAssignmentId ?? null,
      sourceResearchPacketId: researchRun?.messageId ?? assignmentMeta.sourceResearchPacketId ?? null,
      sourceResearchPacketPath: researchRun?.packetPath ?? null,
    },
  });
  const basePath = path.join(runDir, "reporting", `${safeId(sectionKey)}-${safeId(assignment.id)}`);
  const stdoutPath = `${basePath}.stdout.log`;
  const stderrPath = `${basePath}.stderr.log`;
  const sourcePath = `${basePath}.cloud.tac`;
  const resultPath = `${basePath}.result.json`;
  const packetPath = `${basePath}.packet.json`;
  if (apply && refreshPackets && !forceRefreshSelected) {
    const existing = await loadExistingStoryCyclePacket(client, assignment, "reporting_context_packet");
    if (existing) {
      const protection = await loadReportingPacketRefreshProtection(client, { assignment, message: existing.message });
      if (protection.protected) {
        writeJsonFile(packetPath, existing.packet);
        writeJsonFile(resultPath, {
          resumed: true,
          messageId: existing.message.id,
          packetPath,
          refreshSkippedReason: protection.reason,
          protectedBy: protection.protectedBy,
        });
        return {
          ok: true,
          degraded: storyCyclePacketDegraded(existing.packet, null),
          fallbackReason: storyCyclePacketFallbackReason(existing.packet, null),
          fallbackKind: storyCyclePacketFallbackKind(existing.packet, null),
          agentExitStatus: null,
          persistenceSkippedReason: protection.reason,
          phase: "reporting",
          assignmentId: assignment.id,
          sectionKey,
          angle,
          messageId: existing.message.id,
          packetPath,
          resultPath,
          stdoutPath: null,
          stderrPath: null,
          exitStatus: null,
          signal: null,
          sourceResearchAssignmentId: researchRun?.assignmentId ?? null,
          sourceResearchPacketId: researchRun?.messageId ?? null,
          packet: existing.packet,
          fallback: null,
          applyResult: { messageId: existing.message.id, changes: { noop: 1 } },
          resumed: true,
          refreshSkippedReason: protection.reason,
          protectedBy: protection.protectedBy,
        };
      }
    }
  }
  if (apply && !refreshPackets) {
    const existing = await loadExistingStoryCyclePacket(client, assignment, "reporting_context_packet");
    if (existing) {
      writeJsonFile(packetPath, existing.packet);
      writeJsonFile(resultPath, { resumed: true, messageId: existing.message.id, packetPath });
      return {
        ok: true,
        degraded: storyCyclePacketDegraded(existing.packet, null),
        fallbackReason: storyCyclePacketFallbackReason(existing.packet, null),
        fallbackKind: storyCyclePacketFallbackKind(existing.packet, null),
        agentExitStatus: null,
        persistenceSkippedReason: null,
        phase: "reporting",
        assignmentId: assignment.id,
        sectionKey,
        angle,
        messageId: existing.message.id,
        packetPath,
        resultPath,
        stdoutPath: null,
        stderrPath: null,
        exitStatus: null,
        signal: null,
        sourceResearchAssignmentId: researchRun?.assignmentId ?? null,
        sourceResearchPacketId: researchRun?.messageId ?? null,
        packet: existing.packet,
        fallback: null,
        applyResult: { messageId: existing.message.id, changes: { noop: 1 } },
        resumed: true,
      };
    }
  }
  const cloudRun = await startCloudProcedureRun({
    client,
    alias: "story-cycle.reporting",
    actorLabel: "papyrus-content-cli",
    title: `Story-cycle reporting ${assignment.id}`,
    summary: "Triggered by story-cycle reporting phase via cloud procedure dispatch.",
    runDir,
    sourcePath,
    stdoutPath,
    stderrPath,
    input: {
      assignment_item_id: apply ? assignment.id : null,
      assignment_json: assignmentForAgent,
      corpus_key: corpusKey,
      context_profile: "reporting",
      source_research_assignment_id: researchRun?.assignmentId ?? "",
      source_research_packet_id: researchRun?.messageId ?? "",
      source_research_packet_path: researchRun?.packetPath ?? "",
    },
  });
  const parsed = normalizeGraphqlJsonValue(cloudRun.output);
  let packet = parsed?.reporting_context_packet ?? parsed?.reportingContextPacket ?? null;
  let recordPlan = parsed?.reporting_record_plan ?? parsed?.reportingRecordPlan ?? null;
  let fallback = null;
  if (!packet) {
    if (allowFallback) {
      fallback = buildStoryCycleReportingFallbackPacket({
        assignment,
        assignmentMeta,
        topic,
        coverageKey,
        researchRun,
        reason: "missing_reporting_context_packet",
      });
      packet = fallback.packet;
      recordPlan = fallback.reportingRecordPlan;
    }
  }
  if (packet) {
    packet = enrichStoryCycleReportingPacket({
      packet,
      assignment,
      assignmentMeta,
      topic,
      coverageKey,
      sectionKey,
      angle,
      researchRun,
    });
    packet = sanitizeStoryCycleReportingPacketEvidence({ packet, researchRun });
    const missingContractFields = reportingPacketMissingContractFields(packet);
    if (missingContractFields.length) {
      if (allowFallback) {
        fallback = buildStoryCycleReportingFallbackPacket({
          assignment,
          assignmentMeta,
          topic,
          coverageKey,
          researchRun,
          reason: `missing_reporting_packet_fields:${missingContractFields.join(",")}`,
        });
        packet = fallback.packet;
        recordPlan = fallback.reportingRecordPlan;
      } else {
        throw new Error(`Cloud reporting packet is missing required fields (${missingContractFields.join(", ")}) for assignment ${assignment.id}.`);
      }
    }
  }
  if (packet && !recordPlan) {
    recordPlan = buildStoryCycleReportingFallbackRecordPlan({
      assignment,
      packet,
      sourceResearchPacketId: researchRun?.messageId ?? assignmentMeta.sourceResearchPacketId ?? null,
      warning: "reporting context packet generated by reporter procedure; persistence plan generated by story-cycle CLI",
    });
  }
  if (packet) writeJsonFile(packetPath, packet);
  writeJsonFile(resultPath, {
    cloudProcedure: {
      runId: cloudRun.id ?? null,
      procedureKey: cloudRun.procedureKey ?? null,
      procedureVersionId: cloudRun.procedureVersionId ?? null,
      procedureVersionNumber: cloudRun.procedureVersionNumber ?? null,
      runStatus: cloudRun.runStatus ?? null,
      sourcePath: cloudRun.sourcePath ?? null,
    },
    commandLine: cloudRun.commandLine ?? null,
    parsed,
    fallback,
    stdoutPath,
    stderrPath,
  });
  const detectedDegraded = packet ? storyCyclePacketDegraded(packet, null) : false;
  const detectedFallbackReason = packet ? storyCyclePacketFallbackReason(packet, null) : null;
  const procedureFailed = String(cloudRun.runStatus ?? "").toLowerCase() === "failed";
  const degraded = Boolean(fallback) || procedureFailed || detectedDegraded;
  const persistenceBlocked = Boolean(requireAgentSuccess && degraded);
  let messageId = null;
  let applyResult = null;
  if (apply && recordPlan && !persistenceBlocked) {
    applyResult = await applyStoryCycleTactusPlan(client, recordPlan);
    messageId = applyResult.messageId;
  }
  return {
    ok: Boolean(packet) && (!apply || (Boolean(recordPlan) && !persistenceBlocked)),
    degraded,
    fallbackReason: fallback?.reason ?? (procedureFailed ? "reporting_procedure_failed" : detectedFallbackReason ?? (!packet ? "missing_reporting_context_packet" : null)),
    fallbackKind: fallback?.kind ?? null,
    agentExitStatus: cloudRun.exitStatus ?? (procedureFailed ? 1 : 0),
    persistenceSkippedReason: persistenceBlocked ? "require_agent_success" : (!recordPlan && apply ? "missing_record_plan" : null),
    phase: "reporting",
    assignmentId: assignment.id,
    sectionKey,
    angle,
    messageId,
    packetPath: packet ? packetPath : null,
    resultPath,
    stdoutPath,
    stderrPath,
    exitStatus: cloudRun.exitStatus ?? (procedureFailed ? 1 : 0),
    signal: cloudRun.signal ?? null,
    sourceResearchAssignmentId: researchRun?.assignmentId ?? null,
    sourceResearchPacketId: researchRun?.messageId ?? null,
    packet,
    fallback,
    applyResult,
  };
}

function enrichStoryCycleReportingPacket({ packet, assignment, assignmentMeta, topic, coverageKey, sectionKey, angle, researchRun }) {
  if (!packet || typeof packet !== "object") return packet;
  const metadata = assignmentMeta ?? parseJsonish(assignment?.metadata);
  const coverageConceptKey = normalizeCliString(packet.coverageConceptKey ?? packet.coverage_concept_key)
    ?? normalizeCliString(packet.coverageConcept?.key ?? packet.coverage_concept?.key)
    ?? normalizeCliString(metadata.coverageConceptKey ?? coverageKey);
  const storyCycleRunId = normalizeCliString(packet.storyCycleRunId ?? packet.story_cycle_run_id)
    ?? normalizeCliString(metadata.storyCycleRunId ?? metadata.coverageThemeRunId);
  const editionId = normalizeCliString(packet.editionId ?? packet.edition_id)
    ?? normalizeCliString(metadata.editionId)
    ?? (metadata.storyCycleDate ? `edition-${metadata.storyCycleDate}` : null);
  const next = {
    ...packet,
    topic: normalizeCliString(packet.topic) ?? normalizeCliString(metadata.topic ?? topic) ?? null,
    section_key: normalizeCliString(packet.section_key ?? packet.sectionKey) ?? normalizeCliString(sectionKey) ?? null,
    sectionKey: normalizeCliString(packet.sectionKey ?? packet.section_key) ?? normalizeCliString(sectionKey) ?? null,
    angle: normalizeCliString(packet.angle) ?? normalizeCliString(angle) ?? null,
    edition_id: editionId,
    editionId,
    story_cycle_run_id: storyCycleRunId,
    storyCycleRunId,
    coverage_concept_key: coverageConceptKey,
    coverageConceptKey,
    source_research_assignment_id: normalizeCliString(packet.source_research_assignment_id ?? packet.sourceResearchAssignmentId)
      ?? normalizeCliString(researchRun?.assignmentId ?? metadata.sourceResearchAssignmentId),
    sourceResearchAssignmentId: normalizeCliString(packet.sourceResearchAssignmentId ?? packet.source_research_assignment_id)
      ?? normalizeCliString(researchRun?.assignmentId ?? metadata.sourceResearchAssignmentId),
    source_research_packet_id: normalizeCliString(packet.source_research_packet_id ?? packet.sourceResearchPacketId)
      ?? normalizeCliString(researchRun?.messageId ?? metadata.sourceResearchPacketId),
    sourceResearchPacketId: normalizeCliString(packet.sourceResearchPacketId ?? packet.source_research_packet_id)
      ?? normalizeCliString(researchRun?.messageId ?? metadata.sourceResearchPacketId),
  };
  if (coverageConceptKey && (!next.coverage_concept || typeof next.coverage_concept !== "object")) {
    next.coverage_concept = {
      key: coverageConceptKey,
      lineage_id: metadata.coverageConceptLineageId ?? null,
      label: metadata.coverageConceptTitle ?? metadata.topic ?? topic ?? coverageConceptKey,
    };
  }
  if (coverageConceptKey && (!next.coverageConcept || typeof next.coverageConcept !== "object")) {
    next.coverageConcept = {
      key: coverageConceptKey,
      lineageId: metadata.coverageConceptLineageId ?? null,
      label: metadata.coverageConceptTitle ?? metadata.topic ?? topic ?? coverageConceptKey,
    };
  }
  return next;
}

function sanitizeStoryCycleReportingPacketEvidence({ packet, researchRun }) {
  if (!packet || typeof packet !== "object") return packet;
  const allowed = new Set([
    ...parseArrayValue(researchRun?.packet?.acceptedReferenceIds),
    ...parseArrayValue(researchRun?.packet?.accepted_reference_ids),
    ...parseArrayValue(researchRun?.packet?.evidenceItemIds),
    ...parseArrayValue(researchRun?.packet?.evidence_item_ids),
  ].map((value) => String(value)).filter(Boolean));
  const claimed = [
    ...parseArrayValue(packet.accepted_reference_ids),
    ...parseArrayValue(packet.acceptedReferenceIds),
  ].map((value) => String(value)).filter(Boolean);
  if (!claimed.length) return packet;
  const accepted = claimed.filter((id) => allowed.has(id));
  if (accepted.length === claimed.length) return packet;
  const rejected = claimed.filter((id) => !allowed.has(id));
  const riskFlags = [
    ...parseArrayValue(packet.risk_flags ?? packet.riskFlags),
    `Removed unverified accepted reference ids: ${rejected.join(", ")}`,
  ];
  const coverageGaps = [
    ...parseArrayValue(packet.coverage_gaps ?? packet.coverageGaps),
    "Accepted evidence ids must come from source research packets or accepted Reference rows.",
  ];
  return {
    ...packet,
    accepted_reference_ids: accepted,
    acceptedReferenceIds: accepted,
    risk_flags: riskFlags,
    riskFlags,
    coverage_gaps: coverageGaps,
    coverageGaps,
    evidenceSanitized: true,
    evidence_sanitized: true,
  };
}

function reportingPacketMissingContractFields(packet) {
  const missing = [];
  const hasText = (value) => normalizeCliString(value) !== null;
  const hasArray = (value) => parseArrayValue(value).length > 0;
  if (!hasText(packet.editor_recommendation ?? packet.editorRecommendation)) missing.push("editor_recommendation");
  if (!hasText(packet.recommended_angle ?? packet.recommendedAngle)) missing.push("recommended_angle");
  if (!hasArray(packet.risk_flags ?? packet.riskFlags)) missing.push("risk_flags");
  if (!hasArray(packet.coverage_gaps ?? packet.coverageGaps)) missing.push("coverage_gaps");
  if (!hasArray(packet.open_questions ?? packet.openQuestions)) missing.push("open_questions");
  if (!hasText(packet.copywriter_brief ?? packet.copywriterBrief) && typeof (packet.copywriter_brief ?? packet.copywriterBrief) !== "object") {
    missing.push("copywriter_brief");
  }
  return missing;
}

function buildStoryCycleResearchFallbackPacket({ assignment, topic, coverageKey, researchMode, reason }) {
  const metadata = parseJsonish(assignment.metadata);
  const sectionKey = metadata.sectionKey ?? assignment.sectionKey ?? assignment.sectionId ?? "unsectioned";
  const sectionTitle = metadata.sectionTitle ?? sectionKey;
  const researchLens = metadata.researchLens ?? null;
  const summary = `Deterministic fallback research packet for ${topic} through the ${sectionTitle} section lens.`;
  const packet = {
    researchMode: researchMode ?? metadata.researchMode ?? "internal_brief",
    summary,
    corpusKey: metadata.corpusKey ?? assignment.corpusKey ?? null,
    categoryKey: metadata.categoryKey ?? assignment.primaryFocusCategoryKey ?? null,
    coverageConceptKey: metadata.coverageConceptKey ?? coverageKey ?? null,
    sectionKey,
    sectionLens: researchLens,
    queries: [
      [topic, sectionTitle, researchLens].filter(Boolean).join(" "),
    ],
    evidenceItemIds: [],
    acceptedReferenceIds: [],
    sourceSnapshots: [],
    proposedReferences: [],
    recommendedAngle: researchLens
      ? `Frame ${topic} through ${researchLens}.`
      : `Frame ${topic} through the ${sectionTitle} section lens.`,
    openQuestions: [
      "Which accepted references can support this section lens?",
      "Which fresh source prospects need reference intake before reporting?",
    ],
    coverageGaps: [
      "Agent research output was unavailable or malformed during this dry run.",
      "Run source discovery or accepted-reference intake before using this for reader-facing claims.",
    ],
    researchTrace: {
      recoveryPath: "content_cli_story_cycle_fallback",
      fallbackReason: reason,
      knowledgeQueries: [],
      papyrusUrisInspected: [],
      webSearches: [],
      acceptedEvidenceIds: [],
      unresolvedGaps: ["agent_output_unavailable"],
    },
    privateUseOnly: true,
  };
  return { kind: "story-cycle.research.fallback", reason, packet };
}

function buildStoryCycleResearchRecordPlan({ assignment, packet, warning }) {
  const now = new Date().toISOString();
  const summary = packet.summary ?? "Research packet";
  const messageId = `message-research-packet-${hashShort([assignment.id, "research_packet"])}`;
  const message = {
    id: messageId,
    messageKind: "research_packet",
    messageDomain: "assignment_work",
    status: "active",
    summary,
    source: "scripts/content-cli.cjs",
    importRunId: assignment.importRunId ?? null,
    authorLabel: "papyrus-content-cli",
    createdAt: now,
    updatedAt: now,
  };
  const bodyAttachment = attachmentRecord(buildTextModelPayloadAttachment({
    ownerKind: "message",
    ownerId: messageId,
    ownerLineageId: messageId,
    role: "message_body",
    sortKey: "message",
    filename: "message.txt",
    mediaType: "text/plain",
    content: researchPacketBody(packet),
    importRunId: assignment.importRunId ?? null,
    now,
  }));
  const metadataAttachment = attachmentRecord(buildJsonModelPayloadAttachment({
    ownerKind: "message",
    ownerId: messageId,
    ownerLineageId: messageId,
    role: "metadata",
    sortKey: "metadata",
    filename: "metadata.json",
    content: {
      kind: "research.packet.created",
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      queueKey: assignment.queueKey,
      research: packet,
    },
    importRunId: assignment.importRunId ?? null,
    now,
  }));
  const records = [
    { modelName: "Message", action: "create", input: message },
    { modelName: "ModelAttachment", action: "create", input: bodyAttachment.expected, body: bodyAttachment.attachmentBody },
    { modelName: "ModelAttachment", action: "create", input: metadataAttachment.expected, body: metadataAttachment.attachmentBody },
    { modelName: "SemanticRelation", action: "create", input: localSemanticRelationRecord({
      predicate: "produces",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      objectKind: "message",
      objectId: messageId,
      objectLineageId: messageId,
      rank: 1,
      classifierId: assignment.classifierId ?? null,
      reviewRecommended: false,
      sourceSnapshotId: assignment.sourceSnapshotId ?? null,
      importRunId: assignment.importRunId ?? null,
      importedAt: now,
      metadata: {
        lifecycle: "assignment-research-packet",
        messageKind: "research_packet",
        metadataKind: "research.packet.created",
        assignmentTypeKey: assignment.assignmentTypeKey,
        queueKey: assignment.queueKey,
        workProductKind: "research_packet",
      },
    }) },
  ];
  return {
    dryRun: true,
    lifecycle: "assignment-research-packet",
    assignmentId: assignment.id,
    message,
    records,
    warnings: [warning ?? "research packet persistence plan generated by story-cycle CLI"],
  };
}

function buildStoryCycleReportingFallbackPacket({ assignment, assignmentMeta, topic, coverageKey, researchRun, reason }) {
  const metadata = assignmentMeta ?? parseJsonish(assignment.metadata);
  const sectionKey = metadata.sectionKey ?? assignment.sectionKey ?? assignment.sectionId ?? "unsectioned";
  const sectionTitle = metadata.sectionTitle ?? sectionKey;
  const angleMeta = metadata.angleDiversity && typeof metadata.angleDiversity === "object" ? metadata.angleDiversity : {};
  const angle = angleMeta.lensLabel ?? angleMeta.lensKey ?? "reader impact";
  const lensPrompt = angleMeta.lensPrompt ?? angle;
  const slotTarget = metadata.slotTarget && typeof metadata.slotTarget === "object" ? metadata.slotTarget : null;
  const sourceResearchAssignmentId = researchRun?.assignmentId ?? metadata.sourceResearchAssignmentId ?? null;
  const sourceResearchPacketId = researchRun?.messageId ?? metadata.sourceResearchPacketId ?? null;
  const sourceResearchPacketPath = researchRun?.packetPath ?? metadata.sourceResearchPacketPath ?? null;
  const acceptedReferenceIds = [
    ...(researchRun?.packet?.acceptedReferenceIds ?? []),
    ...(researchRun?.packet?.evidenceItemIds ?? []),
  ].filter(Boolean);
  const proposedReferences = Array.isArray(researchRun?.packet?.proposedReferences)
    ? researchRun.packet.proposedReferences
    : [];
  const summary = `Reporting context packet for ${topic} / ${sectionTitle} / ${angle}.`;
  const editionId = metadata.editionId ?? (metadata.storyCycleDate ? `edition-${metadata.storyCycleDate}` : null);
  const packet = {
    summary,
    section_key: sectionKey,
    sectionKey,
    edition_id: editionId,
    editionId,
    candidate_rank: slotTarget?.candidateRank ?? null,
    candidateRank: slotTarget?.candidateRank ?? null,
    slot_target: slotTarget,
    slotTarget,
    why_now: "This story-cycle dry run needs a private reporting context packet for editor selection.",
    whyNow: "This story-cycle dry run needs a private reporting context packet for editor selection.",
    nut_graf_candidate: `The ${sectionTitle} desk can evaluate ${topic} through ${lensPrompt}, but accepted evidence still needs review before copywriting.`,
    nutGrafCandidate: `The ${sectionTitle} desk can evaluate ${topic} through ${lensPrompt}, but accepted evidence still needs review before copywriting.`,
    recommended_angle: angle,
    recommendedAngle: angle,
    confirmed_facts: [],
    confirmedFacts: [],
    source_trail: [],
    sourceTrail: [],
    accepted_reference_ids: acceptedReferenceIds,
    acceptedReferenceIds,
    proposed_references: proposedReferences,
    proposedReferences,
    recent_desk_memory_used: [],
    recentDeskMemoryUsed: [],
    coverage_gaps: [
      ...(Array.isArray(researchRun?.packet?.coverageGaps) ? researchRun.packet.coverageGaps : []),
      "Reporter procedure output was unavailable or malformed; this fallback packet needs editor review.",
    ],
    coverageGaps: [
      ...(Array.isArray(researchRun?.packet?.coverageGaps) ? researchRun.packet.coverageGaps : []),
      "Reporter procedure output was unavailable or malformed; this fallback packet needs editor review.",
    ],
    open_questions: [
      ...(Array.isArray(researchRun?.packet?.openQuestions) ? researchRun.packet.openQuestions : []),
      "Which accepted references should anchor this angle?",
    ],
    openQuestions: [
      ...(Array.isArray(researchRun?.packet?.openQuestions) ? researchRun.packet.openQuestions : []),
      "Which accepted references should anchor this angle?",
    ],
    risk_flags: [
      "Do not treat proposed references as accepted evidence.",
      "Do not copy private doctrine, desk memory, or source notes directly into reader-facing fields.",
    ],
    riskFlags: [
      "Do not treat proposed references as accepted evidence.",
      "Do not copy private doctrine, desk memory, or source notes directly into reader-facing fields.",
    ],
    verification_needs: [
      "Run reference intake for fresh prospects before copywriting.",
      "Confirm accepted evidence ids before editor selection.",
    ],
    verificationNeeds: [
      "Run reference intake for fresh prospects before copywriting.",
      "Confirm accepted evidence ids before editor selection.",
    ],
    source_diversity_notes: [],
    sourceDiversityNotes: [],
    copywriter_brief: `Private handoff only: use this packet to decide whether the ${sectionTitle} desk should pursue ${topic} from the ${angle} angle. Do not create reader-facing copy until an editor selects or briefs it.`,
    copywriterBrief: `Private handoff only: use this packet to decide whether the ${sectionTitle} desk should pursue ${topic} from the ${angle} angle. Do not create reader-facing copy until an editor selects or briefs it.`,
    editor_recommendation: "hold",
    editorRecommendation: "hold",
    coverage_concept_key: metadata.coverageConceptKey ?? coverageKey ?? null,
    coverageConceptKey: metadata.coverageConceptKey ?? coverageKey ?? null,
    source_research_assignment_id: sourceResearchAssignmentId,
    sourceResearchAssignmentId,
    source_research_packet_id: sourceResearchPacketId,
    sourceResearchPacketId,
    doctrine_context: {
      sourceResearchPacketPath,
      fallbackReason: reason,
    },
    doctrineContext: {
      sourceResearchPacketPath,
      fallbackReason: reason,
    },
    privateUseOnly: true,
    fallback: {
      kind: "story-cycle.reporting.fallback",
      reason,
    },
  };
  const reportingRecordPlan = buildStoryCycleReportingFallbackRecordPlan({
    assignment,
    packet,
    sourceResearchPacketId,
  });
  return { kind: "story-cycle.reporting.fallback", reason, packet, reportingRecordPlan };
}

function buildStoryCycleReportingFallbackRecordPlan({ assignment, packet, sourceResearchPacketId, warning }) {
  const now = new Date().toISOString();
  const summary = packet.summary;
  const messageId = `message-reporting-context-packet-${hashShort([assignment.id, "reporting_context_packet"])}`;
  const message = {
    id: messageId,
    messageKind: "reporting_context_packet",
    messageDomain: "assignment_work",
    status: "active",
    summary,
    source: "scripts/content-cli.cjs",
    importRunId: assignment.importRunId ?? null,
    authorLabel: "papyrus-content-cli",
    createdAt: now,
    updatedAt: now,
  };
  const body = reportingPacketBody(packet);
  const bodyAttachment = attachmentRecord(buildTextModelPayloadAttachment({
    ownerKind: "message",
    ownerId: messageId,
    ownerLineageId: messageId,
    role: "message_body",
    sortKey: "message",
    filename: "message.txt",
    mediaType: "text/plain",
    content: body,
    importRunId: assignment.importRunId ?? null,
    now,
  }));
  const metadataAttachment = attachmentRecord(buildJsonModelPayloadAttachment({
    ownerKind: "message",
    ownerId: messageId,
    ownerLineageId: messageId,
    role: "metadata",
    sortKey: "metadata",
    filename: "metadata.json",
    content: {
      kind: "reporting.context_packet.created",
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      queueKey: assignment.queueKey,
      reporting: packet,
    },
    importRunId: assignment.importRunId ?? null,
    now,
  }));
  const records = [
    { modelName: "Message", action: "create", input: message },
    { modelName: "ModelAttachment", action: "create", input: bodyAttachment.expected, body: bodyAttachment.attachmentBody },
    { modelName: "ModelAttachment", action: "create", input: metadataAttachment.expected, body: metadataAttachment.attachmentBody },
    { modelName: "SemanticRelation", action: "create", input: localSemanticRelationRecord({
      predicate: "produces",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      objectKind: "message",
      objectId: messageId,
      objectLineageId: messageId,
      rank: 1,
      classifierId: assignment.classifierId ?? null,
      reviewRecommended: false,
      sourceSnapshotId: assignment.sourceSnapshotId ?? null,
      importRunId: assignment.importRunId ?? null,
      importedAt: now,
      metadata: {
        lifecycle: "assignment-reporting-context-packet",
        messageKind: "reporting_context_packet",
        metadataKind: "reporting.context_packet.created",
        assignmentTypeKey: assignment.assignmentTypeKey,
        queueKey: assignment.queueKey,
        editorRecommendation: packet.editorRecommendation ?? packet.editor_recommendation,
        workProductKind: "reporting_context_packet",
      },
    }) },
  ];
  if (sourceResearchPacketId) {
    records.push({ modelName: "SemanticRelation", action: "create", input: localSemanticRelationRecord({
      predicate: "derived_from",
      subjectKind: "message",
      subjectId: messageId,
      subjectLineageId: messageId,
      objectKind: "message",
      objectId: sourceResearchPacketId,
      objectLineageId: sourceResearchPacketId,
      rank: 1,
      classifierId: assignment.classifierId ?? null,
      reviewRecommended: false,
      importRunId: assignment.importRunId ?? null,
      importedAt: now,
      metadata: {
        lifecycle: "assignment-reporting-context-packet",
        sourceKind: "section_research_packet",
        workProductKind: "reporting_context_packet",
      },
    }) });
  }
  return {
    dryRun: true,
    lifecycle: "assignment-reporting-context-packet",
    assignmentId: assignment.id,
    message,
    records,
    warnings: [warning ?? "reporting context packet generated by deterministic story-cycle fallback"],
  };
}

function reportingPacketBody(packet) {
  const lines = [
    packet.summary ?? "Reporting context packet",
    "",
    `Section: ${packet.sectionKey ?? packet.section_key ?? "unknown"}`,
    `Editor recommendation: ${packet.editorRecommendation ?? packet.editor_recommendation ?? "hold"}`,
    `Why now: ${packet.whyNow ?? packet.why_now ?? ""}`,
    `Recommended angle: ${packet.recommendedAngle ?? packet.recommended_angle ?? ""}`,
    `Nut graf candidate: ${packet.nutGrafCandidate ?? packet.nut_graf_candidate ?? ""}`,
    "",
    "Copywriter brief:",
    packet.copywriterBrief ?? packet.copywriter_brief ?? "",
  ];
  for (const [label, values] of [
    ["Confirmed facts", packet.confirmedFacts ?? packet.confirmed_facts],
    ["Accepted references", packet.acceptedReferenceIds ?? packet.accepted_reference_ids],
    ["Verification needs", packet.verificationNeeds ?? packet.verification_needs],
    ["Open questions", packet.openQuestions ?? packet.open_questions],
  ]) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!items.length) continue;
    lines.push("", `${label}:`, ...items.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`));
  }
  return lines.join("\n");
}

function encodeInlineAssignmentParam(assignment) {
  return `@urljson:${encodeURIComponent(JSON.stringify(assignment))}`;
}

function compactAssignmentForAgent({ assignment, metadata }) {
  return {
    id: assignment.id,
    assignmentTypeKey: assignment.assignmentTypeKey,
    queueKey: assignment.queueKey ?? null,
    queueStatusKey: assignment.queueStatusKey ?? null,
    status: assignment.status ?? null,
    priority: assignment.priority ?? null,
    title: assignment.title ?? null,
    summary: assignment.summary ?? null,
    brief: assignment.brief ?? null,
    instructions: assignment.instructions ?? null,
    sectionId: assignment.sectionId ?? assignment.sectionKey ?? null,
    sectionKey: assignment.sectionKey ?? null,
    sectionType: assignment.sectionType ?? null,
    categorySetId: assignment.categorySetId ?? null,
    classifierId: assignment.classifierId ?? null,
    metadata: JSON.stringify(metadata ?? {}),
  };
}

async function applyStoryCycleTactusPlan(client, plan) {
  const records = (plan.records ?? [])
    .filter((record) => record?.modelName && record.input)
    .map((record) => ({
      modelName: record.modelName,
      expected: record.input,
      attachmentBody: record.body,
    }));
  const changes = await buildRecordChangesTargetedByIdToleratingOptionalModels(client, records, {
    prepareVersioned: false,
  });
  await applyRecordChanges(client, changes);
  const message = records.find((record) => record.modelName === "Message")?.expected ?? null;
  return {
    messageId: message?.id ?? null,
    changes: changeCounts(changes),
  };
}

function spawnBuffered(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({
        status: 127,
        signal: null,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
      });
    });
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function storyCycleResearchQuestion({ topic, sectionKey, coverageKey }) {
  return `Research ${topic} for the ${sectionKey} section. Shared coverage concept: ${coverageKey}. Return accepted evidence separately from proposed source prospects.`;
}

function storyCycleAssignmentSummary(assignment) {
  const metadata = parseJsonish(assignment.metadata);
  return {
    id: assignment.id,
    assignmentTypeKey: assignment.assignmentTypeKey,
    sectionKey: assignment.sectionKey ?? null,
    queueKey: assignment.queueKey,
    title: assignment.title,
    angle: metadata.angleDiversity?.lensLabel ?? metadata.angleDiversity?.lensKey ?? null,
    sourceResearchAssignmentId: metadata.sourceResearchAssignmentId ?? null,
  };
}

function findStoryCycleManifestPath({ runId, coverageKey, date, assignmentId }) {
  if (runId) {
    const direct = path.resolve(runId);
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
    const runPath = path.join(process.cwd(), ".papyrus-runs", runId, "manifest.json");
    if (fs.existsSync(runPath)) return runPath;
  }
  const root = path.join(process.cwd(), ".papyrus-runs");
  if (!fs.existsSync(root)) return null;
  const manifests = fs.readdirSync(root)
    .filter((entry) => entry.startsWith("story-cycle-"))
    .map((entry) => path.join(root, entry, "manifest.json"))
    .filter((entry) => fs.existsSync(entry))
    .map((entry) => ({ filepath: entry, manifest: loadJsonFile(entry) }))
    .filter(({ manifest }) => !coverageKey || manifest.coverageKey === coverageKey)
    .filter(({ manifest }) => !date || manifest.date === date)
    .filter(({ manifest }) => !assignmentId || [
      ...(manifest.researchAssignments ?? []),
      ...(manifest.reportingAssignments ?? []),
    ].some((assignment) => assignment.id === assignmentId))
    .sort((left, right) => String(right.manifest.createdAt ?? "").localeCompare(String(left.manifest.createdAt ?? "")));
  return manifests[0]?.filepath ?? null;
}

function printStoryCycleSummary(result) {
  console.log(`assignments\trun-story-cycle\taction\t${result.action}`);
  console.log(`assignments\trun-story-cycle\trun\t${result.runId}`);
  console.log(`assignments\trun-story-cycle\tworkflow\tCoverage Theme`);
  console.log(`assignments\trun-story-cycle\tthrough\t${result.through ?? "reporting"}`);
  console.log(`assignments\trun-story-cycle\ttopic\t${result.topic}`);
  console.log(`assignments\trun-story-cycle\tcoverage\t${result.coverageKey}`);
  console.log(`assignments\trun-story-cycle\tsections\t${result.sections.join(",")}`);
  console.log(`assignments\trun-story-cycle\tresearch-assignments\t${result.researchAssignments.length}`);
  console.log(`assignments\trun-story-cycle\treporting-assignments\t${result.reportingAssignments.length}`);
  console.log(`assignments\trun-story-cycle\tresearch-packets\t${result.researchPackets.length}`);
  console.log(`assignments\trun-story-cycle\treporting-packets\t${result.reportingPackets.length}`);
  console.log(`assignments\trun-story-cycle\tfailures\t${result.failures.length}`);
  console.log(`assignments\trun-story-cycle\tdegraded\t${result.degradedCount ?? result.degraded?.length ?? 0}`);
  console.log(`assignments\trun-story-cycle\tmanifest\t${result.manifestPath}`);
  console.log(`assignments\trun-story-cycle\toutput\t${result.outputPath}`);
  console.log(`assignments\trun-story-cycle\tnext\t${result.next}`);
}

function printStoryCycleOutput(output) {
  console.log(`assignments\tstory-cycle-output\trun\t${output.runId}`);
  console.log(`assignments\tstory-cycle-output\ttopic\t${output.topic}`);
  console.log(`assignments\tstory-cycle-output\tcoverage\t${output.coverageKey}`);
  for (const section of output.sections) {
    console.log(`section\t${section.sectionKey}\t${section.sectionTitle}\tresearch=${section.researchPackets.length}\treporting=${section.reportingPackets.length}`);
    for (const packet of section.researchPackets) {
      console.log(`research\t${section.sectionKey}\t${packet.assignmentId}\t${packet.messageId ?? packet.packetPath ?? "-"}\tevidence=${packet.acceptedEvidenceCount}\tproposals=${packet.proposedReferenceCount}\tdegraded=${packet.degraded ? "true" : "false"}\t${packet.summary ?? ""}`);
    }
    for (const packet of section.reportingPackets) {
      console.log(`reporting\t${section.sectionKey}\t${packet.assignmentId}\t${packet.messageId ?? packet.packetPath ?? "-"}\tangle=${packet.angle ?? ""}\trecommendation=${packet.editorRecommendation ?? ""}\trisks=${packet.riskFlags.length}\tgaps=${packet.coverageGaps.length}\tdegraded=${packet.degraded ? "true" : "false"}`);
    }
  }
  if (output.degraded?.length) {
    for (const degraded of output.degraded) {
      console.log(`degraded\t${degraded.phase}\t${degraded.sectionKey ?? ""}\t${degraded.assignmentId ?? ""}\texit=${degraded.exitStatus ?? ""}\t${degraded.fallbackReason ?? degraded.fallbackKind ?? ""}`);
    }
  }
  if (output.failures.length) {
    for (const failure of output.failures) {
      console.log(`failure\t${failure.phase}\t${failure.sectionKey ?? ""}\t${failure.assignmentId ?? ""}\t${failure.error ?? failure.stderrPath ?? ""}`);
    }
  }
}

function runContentCliJson(args) {
  const proc = spawnSync(process.execPath, [path.relative(process.cwd(), __filename), ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });
  const payload = extractLastJsonObject(proc.stdout);
  return {
    ok: proc.status === 0 && Boolean(payload?.ok),
    status: proc.status,
    signal: proc.signal ?? null,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    payload,
  };
}

function compactResearchRunChildResult(run) {
  return {
    ok: run.ok,
    status: run.status,
    signal: run.signal,
    runId: run.payload?.runId ?? null,
    resultPath: run.payload?.resultPath ?? null,
    parsed: Boolean(run.payload?.parsed),
    packet: run.payload?.packet ?? null,
  };
}

function extractLastJsonObject(text) {
  const lines = String(text ?? "").trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const value = line.trim();
    if (!value.startsWith("{") || !value.endsWith("}")) continue;
    try {
      return JSON.parse(value);
    } catch {
      // Continue looking for a compact JSON line.
    }
  }
  return null;
}

function printResearchIntakeNowSummary(result) {
  console.log(`assignments\tresearch-intake-now\taction\t${result.action}`);
  console.log(`assignments\tresearch-intake-now\tassignment\t${result.assignmentId}`);
  console.log(`assignments\tresearch-intake-now\tphase\tpacket-selected`);
  if (result.messageId) console.log(`assignments\tresearch-intake-now\tmessage\t${result.messageId}`);
  console.log(`assignments\tresearch-intake-now\tphase\tproposals-extracted`);
  if (result.catalogPath) console.log(`assignments\tresearch-intake-now\tcatalog\t${result.catalogPath}`);
  console.log(`assignments\tresearch-intake-now\tproposals\t${result.proposedReferenceCount}`);
  console.log(`assignments\tresearch-intake-now\tphase\treferences-registered`);
  console.log(`assignments\tresearch-intake-now\tregistered\t${result.registeredReferenceCount}`);
  console.log(`assignments\tresearch-intake-now\tskipped-duplicates\t${result.skippedDuplicateCount}`);
  console.log(`assignments\tresearch-intake-now\tcuration-assignments\t${result.curationAssignmentCount}`);
  printResearchIntakeReferenceRows("research-intake-now", result.references);
  if (result.blockedReason) console.log(`assignments\tresearch-intake-now\tblocked\t${result.blockedReason}`);
  if (result.next) console.log(`assignments\tresearch-intake-now\tnext\t${result.next}`);
}

function printResearchRunSummary(result) {
  console.log(`assignments\trun-research\taction\t${result.action}`);
  console.log(`assignments\trun-research\trun\t${result.runId}`);
  console.log(`assignments\trun-research\tassignment\t${result.assignmentId}`);
  console.log(`assignments\trun-research\tstatus\t${result.exitStatus ?? ""}`);
  console.log(`assignments\trun-research\tparsed\t${result.parsed}`);
  if (result.packet) {
    console.log(`assignments\trun-research\tcounts\tevidence=${result.packet.evidenceItemCount}\tsources=${result.packet.sourceSnapshotCount}\tproposals=${result.packet.proposedReferenceCount}`);
    console.log(`assignments\trun-research\tattempts\t${result.packet.attempts}`);
    if (result.packet.recoveryPath) console.log(`assignments\trun-research\trecovery\t${result.packet.recoveryPath}`);
    if (result.packet.firstValidationError) console.log(`assignments\trun-research\tfirst-validation-error\t${result.packet.firstValidationError}`);
    if (result.packet.lastValidationError) console.log(`assignments\trun-research\tlast-validation-error\t${result.packet.lastValidationError}`);
    if (result.packet.firstProposalUrl) console.log(`assignments\trun-research\tfirst-proposal\t${result.packet.firstProposalUrl}`);
    if (result.packet.blockedReason) console.log(`assignments\trun-research\tblocked\t${result.packet.blockedReason}`);
  }
  console.log(`assignments\trun-research\tresult\t${result.resultPath}`);
  console.log(`assignments\trun-research\tstdout\t${result.stdoutPath}`);
  console.log(`assignments\trun-research\tstderr\t${result.stderrPath}`);
  if (result.next) console.log(`assignments\trun-research\tnext\t${result.next}`);
}

function extractResearchRunPayload(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  const direct = tryParseJson(text);
  const directPayload = normalizeRunPayloadCandidate(direct);
  if (directPayload) return directPayload;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJson(lines[index]);
    const payload = normalizeRunPayloadCandidate(parsed);
    if (payload) return payload;
  }
  const payloadMatches = extractLikelyJsonPayloadObjects(text);
  for (let index = payloadMatches.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJson(payloadMatches[index]);
    const payload = normalizeRunPayloadCandidate(parsed);
    if (payload) return payload;
  }
  const objectMatches = extractBalancedJsonObjects(text);
  for (let index = objectMatches.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJson(objectMatches[index]);
    const payload = normalizeRunPayloadCandidate(parsed);
    if (payload) return payload;
  }
  return null;
}

function extractLikelyJsonPayloadObjects(text) {
  const matches = [];
  const pattern = /\n\{\s*\n\s*"(assignment_item_id|dry_run|work_product_kind|research_packet|researchPacket|reporting_context_packet|reportingContextPacket|draft_record_plan|draftRecordPlan)"/g;
  let match = pattern.exec(text);
  while (match) {
    const start = match.index + 1;
    const objectText = extractBalancedJsonObjectAt(text, start);
    if (objectText) matches.push(objectText);
    match = pattern.exec(text);
  }
  return matches;
}

function extractBalancedJsonObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function normalizeRunPayloadCandidate(value) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) && value.value && typeof value.value === "object"
    ? value.value
    : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  if (typeof candidate.reason === "string") {
    const reasonPayload = normalizeRunPayloadCandidate(tryParseJson(candidate.reason));
    if (reasonPayload) return reasonPayload;
  }
  return (
    candidate.research_packet
    || candidate.researchPacket
    || candidate.reporting_context_packet
    || candidate.reportingContextPacket
    || candidate.draft_record_plan
    || candidate.draftRecordPlan
    || candidate.work_product_kind
    || candidate.assignment_item_id
  ) ? candidate : null;
}

function extractBalancedJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function prependPathList(entries, existing) {
  return [...entries, existing].filter(Boolean).join(path.delimiter);
}

function printResearchPacketApplySummary(result) {
  console.log(`assignments\tapply-research-packet\taction\t${result.action}`);
  console.log(`assignments\tapply-research-packet\tassignment\t${result.assignmentId}`);
  console.log(`assignments\tapply-research-packet\tmessage\t${result.messageId}`);
  console.log(`assignments\tapply-research-packet\tresearch-mode\t${result.researchMode}`);
  console.log(`assignments\tapply-research-packet\tcounts\tevidence=${result.evidenceItemCount}\tsources=${result.sourceSnapshotCount}\tproposals=${result.proposedReferenceCount}`);
}

function readResearchPacketInput(options) {
  const raw = options["research-json"] ?? options.research ?? options.input;
  if (!raw) throw new Error("assignments apply-research-packet requires --research-json <path-or-json>.");
  const text = fs.existsSync(String(raw)) ? fs.readFileSync(String(raw), "utf8") : String(raw);
  const parsed = JSON.parse(text);
  const value = parsed.value ?? parsed;
  return value.research_packet ?? value.researchPacket ?? value.research ?? value;
}

function normalizeResearchPacketBundle(research, { assignment, assignmentMeta, researchMode }) {
  const evidenceItemIds = parseStringArray(research.evidence_item_ids ?? research.evidenceItemIds);
  const queries = parseArrayValue(research.queries);
  const sourceSnapshots = parseArrayValue(research.source_snapshots ?? research.sourceSnapshots);
  const proposedReferences = parseArrayValue(research.proposed_references ?? research.proposedReferences);
  const trace = parseObjectValue(research.researchTrace ?? research.research_trace);
  if (!trace.recoveryPath && research.recoveryPath) trace.recoveryPath = research.recoveryPath;
  if (trace.retryCount === undefined && trace.retry_count === undefined && research.retryCount !== undefined) trace.retryCount = research.retryCount;
  if (!trace.validationFailures && !trace.validation_failures && Array.isArray(research.validationFailures)) {
    trace.validationFailures = research.validationFailures;
  }
  const internalFindings = parseObjectValue(research.internalFindings ?? research.internal_findings);
  const sourceDiscovery = parseObjectValue(research.sourceDiscovery ?? research.source_discovery);
  const synthesis = parseObjectValue(research.synthesis);
  const summary = normalizeCliString(research.summary ?? synthesis.summary) ?? "";
  const recommendedAngle = normalizeCliString(research.recommended_angle ?? research.recommendedAngle ?? synthesis.recommendedAngle ?? synthesis.recommended_angle) ?? "";
  const openQuestions = parseArrayValue(research.open_questions ?? research.openQuestions ?? synthesis.openQuestions ?? synthesis.open_questions);
  const coverageGaps = parseArrayValue(research.coverage_gaps ?? research.coverageGaps ?? synthesis.coverageGaps ?? synthesis.coverage_gaps);
  return {
    researchMode,
    status: "researched",
    summary,
    corpusKey: research.corpus_key ?? research.corpusKey ?? assignmentMeta.corpusKey ?? assignment.corpusId ?? null,
    categoryKey: research.category_key ?? research.categoryKey ?? assignmentMeta.focusCategoryKey ?? assignmentMeta.deskCategoryKey ?? null,
    evidenceItemIds,
    queries,
    sourceSnapshots,
    proposedReferences,
    internalFindings: {
      summary: internalFindings.summary ?? research.internalSummary ?? summary,
      evidenceItemIds: parseStringArray(internalFindings.evidenceItemIds ?? internalFindings.evidence_item_ids ?? evidenceItemIds),
      queries: parseArrayValue(internalFindings.queries ?? queries),
      papyrusUrisInspected: parseArrayValue(internalFindings.papyrusUrisInspected ?? internalFindings.papyrus_uris_inspected ?? trace.papyrusUrisInspected),
    },
    sourceDiscovery: {
      webSearches: parseArrayValue(sourceDiscovery.webSearches ?? sourceDiscovery.web_searches ?? trace.webSearches),
      sourceSnapshots: parseArrayValue(sourceDiscovery.sourceSnapshots ?? sourceDiscovery.source_snapshots ?? sourceSnapshots),
      proposedReferences: parseArrayValue(sourceDiscovery.proposedReferences ?? sourceDiscovery.proposed_references ?? proposedReferences),
      blockedReason: sourceDiscovery.blockedReason ?? sourceDiscovery.blocked_reason ?? research.blockedReason ?? research.blocked_reason ?? null,
    },
    synthesis: {
      summary,
      recommendedAngle,
      openQuestions,
      coverageGaps,
    },
    researchTrace: {
      ...trace,
      knowledgeQueries: parseArrayValue(trace.knowledgeQueries ?? trace.knowledge_queries ?? queries),
      papyrusUrisInspected: parseArrayValue(trace.papyrusUrisInspected ?? trace.papyrus_uris_inspected),
      webSearches: parseArrayValue(trace.webSearches ?? trace.web_searches ?? sourceDiscovery.webSearches),
      acceptedEvidenceIds: parseStringArray(trace.acceptedEvidenceIds ?? trace.accepted_evidence_ids ?? evidenceItemIds),
      unresolvedGaps: parseArrayValue(trace.unresolvedGaps ?? trace.unresolved_gaps),
    },
    openQuestions,
    coverageGaps,
    recommendedAngle,
  };
}

function validateResearchPacketMode(packet) {
  if (packet.researchMode === "internal_brief") return;
  const hasWebSearch = parseArrayValue(packet.sourceDiscovery?.webSearches).length > 0
    || parseArrayValue(packet.researchTrace?.webSearches).length > 0;
  const hasSourceSnapshot = parseArrayValue(packet.sourceDiscovery?.sourceSnapshots).length > 0
    || parseArrayValue(packet.sourceSnapshots).length > 0;
  const hasProposedReference = parseArrayValue(packet.sourceDiscovery?.proposedReferences).length > 0
    || parseArrayValue(packet.proposedReferences).length > 0;
  const blockedReason = normalizeCliString(packet.sourceDiscovery?.blockedReason);
  if (!hasWebSearch && !hasSourceSnapshot && !hasProposedReference && !blockedReason) {
    throw new Error(`research mode ${packet.researchMode} requires web discovery fields or blockedReason before persistence.`);
  }
}

function researchPacketHash({ assignmentId, researchMode, packet }) {
  return hashShort(stableJson({
    assignmentId,
    researchMode,
    packet: normalizeResearchPacketForHash(packet),
  }));
}

function normalizeResearchPacketForHash(packet) {
  return parseAnyJsonish(stableJson({
    researchMode: packet.researchMode,
    summary: packet.summary,
    corpusKey: packet.corpusKey,
    categoryKey: packet.categoryKey,
    evidenceItemIds: packet.evidenceItemIds,
    queries: packet.queries,
    sourceSnapshots: packet.sourceSnapshots,
    proposedReferences: packet.proposedReferences,
    internalFindings: packet.internalFindings,
    sourceDiscovery: packet.sourceDiscovery,
    synthesis: packet.synthesis,
    researchTrace: packet.researchTrace,
    openQuestions: packet.openQuestions,
    coverageGaps: packet.coverageGaps,
    recommendedAngle: packet.recommendedAngle,
  }));
}

function validateResearchPacketPlannedChanges(changes, { assignmentId, messageId }) {
  const expectedRecords = changes.map((change) => ({ modelName: change.modelName, expected: change.expected }));
  const byModelAndId = new Map(expectedRecords.map((record) => [`${record.modelName}:${record.expected?.id}`, record.expected]));
  const message = byModelAndId.get(`Message:${messageId}`);
  const relation = changes
    .map((change) => change.expected)
    .find((record) => isAssignmentPacketRelation(record, assignmentId, messageId));
  if (!message) throw new Error(`Research packet preflight failed: planned Message ${messageId} is missing.`);
  if (!relation) throw new Error(`Research packet preflight failed: planned packet relation for ${assignmentId} -> ${messageId} is missing.`);
  assertRequiredFields("Message", message, ["id", "messageKind", "messageDomain", "status", "summary", "createdAt", "updatedAt"]);
  assertRequiredFields("SemanticRelation", relation, [
    "id",
    "relationState",
    "predicate",
    "relationTypeKey",
    "relationDomain",
    "subjectKind",
    "subjectId",
    "subjectLineageId",
    "objectKind",
    "objectId",
    "objectLineageId",
    "subjectStateKey",
    "objectStateKey",
    "objectSubjectStateKey",
    "predicateObjectStateKey",
    "subjectVersionKey",
    "objectVersionKey",
  ]);
  const attachments = changes
    .filter((change) => change.modelName === "ModelAttachment")
    .map((change) => change.expected)
    .filter((record) => record?.ownerKind === "message" && record.ownerId === messageId);
  const roles = new Set(attachments.map((attachment) => attachment.role));
  if (!roles.has("message_body")) throw new Error(`Research packet preflight failed: Message ${messageId} is missing message_body attachment.`);
  if (!roles.has("metadata")) throw new Error(`Research packet preflight failed: Message ${messageId} is missing metadata attachment.`);
  for (const attachment of attachments) {
    assertRequiredFields("ModelAttachment", attachment, ["id", "ownerKind", "ownerId", "role", "sortKey", "storagePath", "filename", "mediaType", "byteSize", "sha256", "status"]);
  }
}

function isAssignmentPacketRelation(relation, assignmentId, messageId = null) {
  if (!relation || relation.relationState === "superseded") return false;
  const relationType = relation.relationTypeKey ?? relation.predicate;
  const newProducesLink = relationType === "produces"
    && relation.subjectKind === "assignment"
    && relation.subjectId === assignmentId
    && relation.objectKind === "message"
    && (!messageId || relation.objectId === messageId);
  const legacyCommentLink = relationType === "comment"
    && relation.subjectKind === "message"
    && (!messageId || relation.subjectId === messageId)
    && relation.objectKind === "assignment"
    && relation.objectId === assignmentId;
  return newProducesLink || legacyCommentLink;
}

function assertRequiredFields(modelName, record, fields) {
  const missing = fields.filter((field) => record[field] === undefined || record[field] === null || record[field] === "");
  if (missing.length) {
    throw new Error(`${modelName} ${record?.id ?? "<missing-id>"} is missing required research packet preflight field(s): ${missing.join(", ")}.`);
  }
}

function researchPacketBody(packet) {
  const flatLines = [
    packet.sectionKey || packet.section_key ? `Section: ${packet.sectionKey ?? packet.section_key}` : "",
    packet.researchMode || packet.research_mode ? `Research mode: ${packet.researchMode ?? packet.research_mode}` : "",
    packet.coverageConceptKey || packet.coverage_concept_key ? `Coverage concept: ${packet.coverageConceptKey ?? packet.coverage_concept_key}` : "",
    packet.recommendedAngle || packet.recommended_angle ? `Recommended angle: ${packet.recommendedAngle ?? packet.recommended_angle}` : "",
    ...arrayTextLines("Accepted references", packet.acceptedReferenceIds ?? packet.accepted_reference_ids),
    ...arrayTextLines("Evidence items", packet.evidenceItemIds ?? packet.evidence_item_ids),
    ...arrayTextLines("Proposed references", packet.proposedReferences ?? packet.proposed_references),
    ...arrayTextLines("Open questions", packet.openQuestions ?? packet.open_questions),
    ...arrayTextLines("Coverage gaps", packet.coverageGaps ?? packet.coverage_gaps),
  ];
  const lines = [
    packet.summary,
    ...flatLines,
    "",
    "Internal findings",
    packet.internalFindings?.summary ?? "",
    ...arrayTextLines("Accepted evidence", packet.internalFindings?.evidenceItemIds),
    ...arrayTextLines("Papyrus URIs inspected", packet.internalFindings?.papyrusUrisInspected),
    "",
    "Source discovery",
    ...arrayTextLines("Web searches", packet.sourceDiscovery?.webSearches),
    ...arrayTextLines("Proposed references", (packet.sourceDiscovery?.proposedReferences ?? []).map((entry) => entry.title ?? entry.url)),
    packet.sourceDiscovery?.blockedReason ? `Blocked reason: ${packet.sourceDiscovery.blockedReason}` : "",
    "",
    "Synthesis",
    packet.synthesis?.recommendedAngle ? `Recommended angle: ${packet.synthesis.recommendedAngle}` : "",
    ...arrayTextLines("Open questions", packet.synthesis?.openQuestions),
    ...arrayTextLines("Coverage gaps", packet.synthesis?.coverageGaps),
  ];
  return lines.filter((line) => String(line ?? "").trim()).join("\n");
}

function arrayTextLines(label, values) {
  const items = parseArrayValue(values).map((value) => typeof value === "string" ? value : value?.title ?? value?.url ?? stableJson(value)).filter(Boolean);
  if (!items.length) return [];
  return [`${label}:`, ...items.map((item) => `- ${item}`)];
}

function parseObjectValue(value) {
  const parsed = parseAnyJsonish(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function parseArrayValue(value) {
  const parsed = parseAnyJsonish(value);
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function parseStringArray(value) {
  return parseArrayValue(value).map((entry) => normalizeCliString(entry)).filter(Boolean);
}

function parseAnyJsonish(value) {
  if (value === undefined || value === null || value === "") return value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function backfillAssignmentSectionIndexes(flags) {
  const options = parseOptions(flags);
  const { client } = createAuthoringClient();
  await assertAssignmentSectionSchemaReady(client);
  const targetSection = normalizeCliString(options.section);
  const validSectionKeys = await loadValidNewsroomSectionKeys(client);
  const assignments = await client.listRecords("Assignment");
  const changes = [];
  let skippedInvalidSectionKeys = 0;
  for (const assignment of assignments) {
    const rawSectionKey = assignmentSectionKey(assignment);
    const patch = assignmentSectionIndexPatch(assignment, { validSectionKeys });
    if (rawSectionKey && !validSectionKeys.has(rawSectionKey)) skippedInvalidSectionKeys += 1;
    if (targetSection && patch.sectionKey !== targetSection) continue;
    const expected = { ...assignment, ...patch };
    if (!assignmentSectionIndexChanged(assignment, expected)) continue;
    changes.push({ current: assignment, expected });
  }
  changes.sort((left, right) => compareAssignmentQueueOrder(left.expected, right.expected));
  console.log(`assignments\tbackfill-section-indexes\tplanned\t${changes.length}`);
  if (targetSection) console.log(`assignments\tbackfill-section-indexes\tsection\t${targetSection}`);
  if (skippedInvalidSectionKeys) console.log(`assignments\tbackfill-section-indexes\tskipped-invalid-section-keys\t${skippedInvalidSectionKeys}`);
  for (const change of changes.slice(0, 25)) {
    console.log([
      "assignment-section-index",
      change.expected.id,
      change.current.status ?? "",
      `section=${change.expected.sectionKey ?? ""}`,
      `sectionStatusKey=${change.expected.sectionStatusKey ?? ""}`,
      `sectionQueueStatusKey=${change.expected.sectionQueueStatusKey ?? ""}`,
      `primaryFocus=${change.expected.primaryFocusCategoryKey ?? ""}`,
      `topicScope=${(change.expected.topicScopeCategoryKeys ?? []).join(",")}`,
    ].join("\t"));
  }
  if (changes.length > 25) console.log(`assignments\tbackfill-section-indexes\tpreview-truncated\t${changes.length - 25} more`);
  if (!options.apply) {
    console.log("assignments\tbackfill-section-indexes\tapply\tskipped\tpass --apply to write Assignment index fields");
    console.log("assignments\tbackfill-section-indexes\tnext\tnpm run content -- newsroom recount-summary --apply");
    return;
  }
  let updated = 0;
  for (const change of changes) {
    await client.upsert("Assignment", change.expected);
    updated += 1;
    if (updated === changes.length || updated % 100 === 0) console.error(`assignments\tbackfill-section-indexes\tprogress\t${updated}/${changes.length}`);
  }
  console.log(`assignments\tbackfill-section-indexes\tupdated\t${updated}`);
  console.log("assignments\tbackfill-section-indexes\tnext\tnpm run content -- newsroom recount-summary --apply");
}

async function backfillOperationalIndexes(flags) {
  const options = parseOptions(flags);
  const startedAt = Date.now();
  const apply = Boolean(options.apply);
  const asJson = Boolean(options.json);
  const { client } = createAuthoringClient();
  await assertOperationalIndexSchemaReady(client);
  const [assignments, importRuns] = await Promise.all([
    client.listRecords("Assignment"),
    client.listRecords("KnowledgeImportRun"),
  ]);
  const assignmentChanges = [];
  for (const assignment of assignments) {
    const expected = {
      ...assignment,
      ...assignmentOperationalIndexPatch(assignment),
    };
    if (assignmentOperationalIndexChanged(assignment, expected)) {
      assignmentChanges.push({ modelName: "Assignment", current: assignment, expected });
    }
  }
  const importRunChanges = [];
  for (const importRun of importRuns) {
    const expected = {
      ...importRun,
      corpusImportKindKey: knowledgeImportRunCorpusKindKey(importRun),
    };
    if ((importRun.corpusImportKindKey ?? null) !== (expected.corpusImportKindKey ?? null)) {
      importRunChanges.push({ modelName: "KnowledgeImportRun", current: importRun, expected });
    }
  }
  const changes = [...assignmentChanges, ...importRunChanges];
  changes.sort((left, right) => String(left.modelName).localeCompare(String(right.modelName)) || String(left.expected.id).localeCompare(String(right.expected.id)));
  if (apply) {
    let updated = 0;
    for (const change of changes) {
      await client.upsert(change.modelName, change.expected);
      updated += 1;
      if (updated === changes.length || updated % 100 === 0) console.error(`newsroom\tbackfill-operational-indexes\tprogress\t${updated}/${changes.length}`);
    }
  }
  const result = {
    ok: true,
    command: "newsroom backfill-operational-indexes",
    action: apply ? "apply" : "dry-run",
    indexes: [
      "Assignment.sectionStatusKey",
      "Assignment.sectionQueueStatusKey",
      "KnowledgeImportRun.corpusImportKindKey",
    ],
    scanned: {
      assignments: assignments.length,
      importRuns: importRuns.length,
    },
    changedByModel: {
      Assignment: assignmentChanges.length,
      KnowledgeImportRun: importRunChanges.length,
    },
    changedRecords: changes.length,
    elapsedMs: Date.now() - startedAt,
    next: apply ? "npm run content -- newsroom recount-summary --apply" : "npm run content -- newsroom backfill-operational-indexes --apply",
  };
  if (asJson) {
    printCompactJson(result);
    return;
  }
  console.log(`newsroom\tbackfill-operational-indexes\taction\t${result.action}`);
  console.log(`newsroom\tbackfill-operational-indexes\tchanged\t${changes.length}`);
  console.log(`newsroom\tbackfill-operational-indexes\tassignments\t${assignmentChanges.length}`);
  console.log(`newsroom\tbackfill-operational-indexes\timport-runs\t${importRunChanges.length}`);
  for (const change of changes.slice(0, 25)) {
    console.log([
      "operational-index",
      change.modelName,
      change.expected.id,
      change.expected.corpusImportKindKey ?? change.expected.sectionStatusKey ?? "",
      change.expected.sectionQueueStatusKey ?? "",
    ].join("\t"));
  }
  if (changes.length > 25) console.log(`newsroom\tbackfill-operational-indexes\tpreview-truncated\t${changes.length - 25} more`);
  if (!apply) console.log(`newsroom\tbackfill-operational-indexes\tnext\t${result.next}`);
}

async function assertOperationalIndexSchemaReady(client) {
  const assignmentFields = await graphqlTypeFieldNames(client, "Assignment");
  const importRunFields = await graphqlTypeFieldNames(client, "KnowledgeImportRun");
  const missing = [
    ...["sectionStatusKey", "sectionQueueStatusKey"].filter((field) => !assignmentFields.includes(field)).map((field) => `Assignment.${field}`),
    ...["corpusImportKindKey"].filter((field) => !importRunFields.includes(field)).map((field) => `KnowledgeImportRun.${field}`),
  ];
  if (missing.length) {
    throw new Error(`Operational index fields are not deployed yet. Missing GraphQL fields: ${missing.join(", ")}.`);
  }
}

async function loadValidNewsroomSectionKeys(client) {
  const sections = await client.listRecords("NewsroomSection");
  return new Set(sections
    .filter((section) => section.enabled !== false && section.enabledStatus !== "disabled")
    .flatMap((section) => [
      normalizeCliString(section.id),
      normalizeCliString(section.sectionKey),
    ])
    .filter(Boolean));
}

async function assertAssignmentSectionSchemaReady(client) {
  const required = [
    "sectionId",
    "sectionKey",
    "sectionType",
    "sectionStatusKey",
    "sectionQueueStatusKey",
    "primaryFocusCategoryKey",
    "topicScopeCategoryKeys",
  ];
  const fields = await graphqlTypeFieldNames(client, "Assignment");
  const missing = required.filter((field) => !fields.includes(field));
  if (missing.length) {
    throw new Error(`Assignment section indexes are not deployed yet. Missing GraphQL fields: ${missing.join(", ")}. Wait for the schema deploy, then run: npm run content -- content schema-check --type Assignment --fields ${required.join(",")}`);
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
  console.log(`assignment-context\tsection\t${context.sectionKey || "unknown"}\tprimaryFocus=${context.primaryFocusCategoryKey || context.focusCategoryKey || "unknown"}`);
  console.log(`assignment-context\tblocks\tincluded=${(context.includedBlocks || []).length}\tdropped=${(context.droppedBlocks || []).length}`);
  console.log(`assignment-context\ttokens\t${context.totalTokens || 0}`);
  console.log(`assignment-context\toutput\t${outputPath}`);
}

async function listAssignmentResearchPackets(flags) {
  const options = parseOptions(flags);
  const assignmentId = options.assignment;
  if (!assignmentId) throw new Error("assignments research-packets requires --assignment.");
  const { client } = createAuthoringClient();
  const packets = await loadAssignmentResearchPacketEntries(client, assignmentId);
  if (options.json) {
    printCompactJson({
      ok: true,
      command: "assignments research-packets",
      assignmentId,
      count: packets.length,
      packets: packets.map((entry) => ({
        messageId: entry.message.id,
        createdAt: entry.message.createdAt ?? null,
        summary: entry.message.summary ?? null,
        proposedReferenceCount: entry.packet.proposedReferences.length,
        sourceSnapshotCount: entry.packet.sourceSnapshots.length,
        blockedReason: entry.packet.sourceDiscovery?.blockedReason ?? null,
      })),
    });
    return;
  }
  for (const entry of packets) {
    const { message, packet } = entry;
    const sources = Array.isArray(packet.sourceSnapshots) ? packet.sourceSnapshots : [];
    const proposals = Array.isArray(packet.proposedReferences) ? packet.proposedReferences : [];
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
      message.summary ?? "Stored research packet",
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

async function loadAssignmentResearchPacketEntries(client, assignmentId) {
  const assignment = await client.getRecord("Assignment", assignmentId);
  if (!assignment) throw new Error(`Assignment not found: ${assignmentId}.`);
  const assignmentMeta = await assignmentMetadata(client, assignment);
  const objectStateKey = semanticStateKey("assignment", assignmentId);
  const subjectStateKey = semanticStateKey("assignment", assignmentId);
  const [incomingRelations, outgoingRelations] = await Promise.all([
    client.listSemanticRelationsByObjectState(objectStateKey),
    client.listSemanticRelationsBySubjectState(subjectStateKey),
  ]);
  const relations = [...incomingRelations, ...outgoingRelations];
  const packetRelations = relations
    .filter((relation) => relation.relationState === "current")
    .filter((relation) => isAssignmentPacketRelation(relation, assignmentId));
  const messageIds = packetRelations.map((relation) => (relation.objectKind === "message" ? relation.objectId : relation.subjectId));
  const messageById = await client.getRecordsById("Message", messageIds);
  const entries = [];
  for (const relation of packetRelations) {
    const messageId = relation.objectKind === "message" ? relation.objectId : relation.subjectId;
    const message = messageById.get(messageId);
    if (!message || message.messageKind !== "research_packet") continue;
    let metadata = {};
    try {
      metadata = await readJsonModelPayload(client, "message", message.id, "metadata", "metadata") ?? parseJsonish(message.metadata);
    } catch {
      metadata = parseJsonish(message.metadata);
    }
    const research = parseJsonish(metadata.research);
    const researchMode = normalizeResearchModeOption(
      research.researchMode ?? research.research_mode ?? metadata.researchMode ?? assignmentMeta.researchMode ?? "source_discovery",
    );
    const packet = normalizeResearchPacketBundle(research, { assignment, assignmentMeta, researchMode });
    entries.push({ assignment, message, metadata, relation, packet });
  }
  return entries.sort((left, right) => String(right.message.createdAt ?? "").localeCompare(String(left.message.createdAt ?? "")));
}

async function intakeAssignmentResearchProposals(flags) {
  const options = parseOptions(flags);
  const assignmentId = normalizeCliString(options.assignment);
  if (!assignmentId) throw new Error("assignments intake-proposals requires --assignment <id>.");
  if (!options.config) throw new Error("assignments intake-proposals requires --config <steering.yml>.");
  const corpusKey = normalizeCliString(options["corpus-key"]);
  if (!corpusKey) throw new Error("assignments intake-proposals requires --corpus-key <key>.");
  const result = await intakeResearchPacketProposals({
    assignmentId,
    messageId: normalizeCliString(options.message),
    configPath: options.config,
    corpusKey,
    status: normalizeProposalIntakeStatus(options.status),
    reasonCode: options["reason-code"] ?? options.reasonCode,
    note: options.note,
    apply: Boolean(options.apply),
    runId: normalizeCliString(options["run-id"]),
    actor: options.actor ?? "Papyrus content CLI",
  });
  if (options.json) {
    printCompactJson(result);
    return;
  }
  printResearchProposalIntakeSummary(result);
}

async function intakeResearchPacketProposals({ assignmentId, messageId, configPath, corpusKey, status, reasonCode, note, apply, runId, actor }) {
  const { client } = createAuthoringClient();
  const entries = await loadAssignmentResearchPacketEntries(client, assignmentId);
  const selected = messageId
    ? entries.find((entry) => entry.message.id === messageId)
    : entries[0];
  if (!selected) {
    throw new Error(messageId
      ? `Research packet message ${messageId} is not linked to assignment ${assignmentId}.`
      : `No persisted research_packet message is linked to assignment ${assignmentId}.`);
  }
  return await planResearchPacketProposalIntake({
    client,
    assignment: selected.assignment,
    message: selected.message,
    packet: selected.packet,
    configPath,
    corpusKey,
    status,
    reasonCode,
    note,
    apply,
    runId,
    actor,
  });
}

async function planResearchPacketProposalIntake({ client, assignment, message, packet, configPath, corpusKey, status, reasonCode, note, apply, runId, actor }) {
  const command = "assignments intake-proposals";
  const effectiveRunId = normalizeCliString(runId) ?? `research-proposals-${safeId(assignment.id).slice(0, 60)}-${timestampForPath()}`;
  const runDir = path.join(process.cwd(), ".papyrus-runs", effectiveRunId);
  fs.mkdirSync(runDir, { recursive: true });
  const catalogPath = path.join(runDir, "research-proposals-catalog.json");
  const proposals = extractResearchPacketProposals(packet);
  const catalogItems = buildResearchProposalCatalogItems(proposals, {
    assignment,
    message,
    packet,
  });
  const blockedReason = normalizeCliString(packet.sourceDiscovery?.blockedReason);
  const generatedAt = message?.createdAt
    ?? normalizeCliString(packet.researchTrace?.generatedAt ?? packet.researchTrace?.generated_at)
    ?? assignment.createdAt
    ?? new Date().toISOString();
  const catalog = {
    schema_version: 1,
    catalog_kind: "papyrus-research-proposed-references",
    generated_at: generatedAt,
    assignment_id: assignment.id,
    research_packet_message_id: message?.id ?? null,
    research_mode: packet.researchMode ?? null,
    blocked_reason: blockedReason ?? null,
    items: catalogItems,
  };
  writeJsonFile(catalogPath, catalog);

  if (!catalogItems.length) {
    return {
      ok: true,
      command,
      action: apply ? "apply" : "dry-run",
      assignmentId: assignment.id,
      messageId: message?.id ?? null,
      catalogPath,
      proposedReferenceCount: proposals.length,
      dedupedProposalCount: 0,
      registeredReferenceCount: 0,
      skippedDuplicateCount: 0,
      curationAssignmentCount: 0,
      importRunId: null,
      references: [],
      diagnostics: {
        registrationMode: "targeted",
        fetchedByModel: {},
        elapsedMs: 0,
      },
      blockedReason: blockedReason ?? null,
      next: blockedReason
        ? `Review blocked reason on research packet ${message?.id ?? "<dry-run>"}`
        : `Run npm run content -- assignments run-research --assignment ${assignment.id} --research-mode source_discovery --max-evidence-items 20`,
    };
  }

  const registration = await planReferenceCatalogRegistration(client, {
    catalog,
    configPath,
    corpusKey,
    status,
    reasonCode,
    note,
    actor,
    quiet: true,
    targeted: true,
  });
  if (apply) {
    await applyReferenceCatalogRegistration(client, registration);
  }
  const references = researchProposalIntakeReferenceRows(registration.changes);
  const changedReferences = registration.changes.filter((change) => change.modelName === "Reference" && change.action !== "noop").length;
  const changedAssignments = registration.changes.filter((change) => change.modelName === "Assignment" && change.action !== "noop").length;
  const duplicateNoopReferences = registration.changes.filter((change) => change.modelName === "Reference" && change.action === "noop").length;
  const skippedDuplicateCount = registration.skippedDuplicateCount + duplicateNoopReferences;
  return {
    ok: true,
    command,
    action: apply ? "apply" : "dry-run",
    assignmentId: assignment.id,
    messageId: message?.id ?? null,
    catalogPath,
    proposedReferenceCount: proposals.length,
    dedupedProposalCount: catalogItems.length,
    registeredReferenceCount: changedReferences,
    skippedDuplicateCount,
    curationAssignmentCount: changedAssignments,
    importRunId: registration.plan.importRunId,
    references,
    diagnostics: registration.diagnostics,
    blockedReason: blockedReason ?? null,
    next: `npm run content -- references source-status --config ${configPath} --corpus-key ${corpusKey} --status ${normalizeReferenceCurationStatus(status, "pending")}`,
  };
}

function extractResearchPacketProposals(packet) {
  const proposals = [
    ...parseArrayValue(packet.proposedReferences),
    ...parseArrayValue(packet.sourceDiscovery?.proposedReferences),
  ];
  const byUrl = new Map();
  for (const proposal of proposals) {
    const normalized = normalizeProposalUrl(proposal?.url ?? proposal?.source_uri ?? proposal?.sourceUri ?? proposal?.uri);
    if (!normalized) continue;
    if (!byUrl.has(normalized)) byUrl.set(normalized, { ...proposal, url: normalized });
  }
  return Array.from(byUrl.values());
}

function buildResearchProposalCatalogItems(proposals, { assignment, message, packet }) {
  return proposals.map((proposal) => {
    const url = normalizeProposalUrl(proposal.url ?? proposal.source_uri ?? proposal.sourceUri ?? proposal.uri);
    if (!url) return null;
    const sourceDomain = normalizeCliString(proposal.source_domain ?? proposal.sourceDomain) ?? domainFromUrl(url);
    const title = normalizeCliString(proposal.title ?? proposal.name) ?? null;
    const evidenceCandidateId = normalizeCliString(proposal.evidence_candidate_id ?? proposal.evidenceCandidateId ?? proposal.id);
    const itemId = `research-proposal-${hashShort(url)}`;
    const ingestionRationale = normalizeCliString(
      proposal.ingestion_rationale
      ?? proposal.ingestionRationale
      ?? proposal.rationale
      ?? proposal.ingestion_rationale_text
    ) ?? fallbackResearchProposalRationale({ proposal, title, url, assignment, message, packet });
    return {
      id: itemId,
      item_id: itemId,
      title,
      source_uri: url,
      media_type: normalizeCliString(proposal.media_type ?? proposal.mediaType) ?? "text/html",
      ingestion_rationale: ingestionRationale,
      metadata: {
        source_domain: sourceDomain,
        evidence_candidate_id: evidenceCandidateId,
        research_assignment_id: assignment.id,
        research_packet_message_id: message?.id ?? null,
        research_mode: packet.researchMode ?? null,
        research_packet_summary: packet.summary ?? message?.summary ?? null,
        proposed_reference: proposal,
      },
    };
  }).filter(Boolean);
}

function fallbackResearchProposalRationale({ title, url, assignment, message, packet }) {
  const summary = normalizeCliString(packet.summary ?? message?.summary);
  const titleClause = title ? `${title} was proposed` : "This source was proposed";
  const assignmentTitle = normalizeCliString(assignment.title) ?? assignment.id;
  const summaryClause = summary ? ` Packet summary: ${summary}` : "";
  return `${titleClause} by research assignment ${assignmentTitle}. Source: ${url}.${summaryClause} Review during reference intake before using as evidence.`;
}

function normalizeProposalUrl(value) {
  const text = normalizeCliString(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) parsed.port = "";
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/g, "");
    return parsed.toString();
  } catch {
    return null;
  }
}

function researchProposalIntakeReferenceRows(changes) {
  const recordsForModel = (modelName) => changes
    .filter((change) => change.modelName === modelName)
    .map((change) => ({ change, record: change.expected ?? change.current }))
    .filter((entry) => entry.record);
  const attachmentRecords = recordsForModel("ReferenceAttachment").map((entry) => entry.record);
  const attachmentsByReference = new Map();
  for (const attachment of attachmentRecords) {
    const referenceId = normalizeCliString(attachment.referenceId);
    if (!referenceId) continue;
    if (!attachmentsByReference.has(referenceId)) attachmentsByReference.set(referenceId, []);
    attachmentsByReference.get(referenceId).push(attachment);
  }
  const curationAssignmentByReference = new Map();
  for (const { record: relation } of recordsForModel("SemanticRelation")) {
    const relationType = normalizeCliString(relation.relationTypeKey ?? relation.predicate);
    if (relationType !== "requests_work_on") continue;
    if (relation.subjectKind !== "assignment" || relation.objectKind !== "reference") continue;
    const referenceId = normalizeCliString(relation.objectId);
    const assignmentId = normalizeCliString(relation.subjectId);
    if (referenceId && assignmentId) curationAssignmentByReference.set(referenceId, assignmentId);
  }
  return recordsForModel("Reference")
    .map(({ change, record: reference }) => {
      const attachments = attachmentsByReference.get(reference.id) ?? [];
      const readiness = referenceSourceReadiness(reference, attachments);
      const row = {
        reference,
        readiness,
        state: readiness.state,
      };
      return {
        referenceId: reference.id,
        externalItemId: reference.externalItemId ?? null,
        title: reference.title ?? null,
        url: reference.sourceUri ?? null,
        sourceDomain: domainFromUrl(reference.sourceUri) ?? null,
        status: reference.curationStatus ?? null,
        sourceReadiness: readiness.state,
        curationAssignmentId: curationAssignmentByReference.get(reference.id) ?? null,
        action: change.action,
        next: nextReferenceSourceCommand(row),
      };
    })
    .sort((left, right) => (
      String(left.url ?? "").localeCompare(String(right.url ?? ""))
      || String(left.referenceId).localeCompare(String(right.referenceId))
    ));
}

function domainFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function printResearchProposalIntakeSummary(result) {
  console.log(`assignments\tintake-proposals\taction\t${result.action}`);
  console.log(`assignments\tintake-proposals\tassignment\t${result.assignmentId}`);
  console.log(`assignments\tintake-proposals\tphase\tpacket-selected`);
  console.log(`assignments\tintake-proposals\tmessage\t${result.messageId ?? ""}`);
  console.log(`assignments\tintake-proposals\tphase\tproposals-extracted`);
  console.log(`assignments\tintake-proposals\tcatalog\t${result.catalogPath}`);
  console.log(`assignments\tintake-proposals\tproposals\t${result.proposedReferenceCount}`);
  console.log(`assignments\tintake-proposals\tdeduped\t${result.dedupedProposalCount}`);
  console.log(`assignments\tintake-proposals\tphase\treferences-registered`);
  console.log(`assignments\tintake-proposals\tregistered\t${result.registeredReferenceCount}`);
  console.log(`assignments\tintake-proposals\tskipped-duplicates\t${result.skippedDuplicateCount}`);
  console.log(`assignments\tintake-proposals\tcuration-assignments\t${result.curationAssignmentCount}`);
  printResearchIntakeReferenceRows("intake-proposals", result.references);
  if (result.blockedReason) console.log(`assignments\tintake-proposals\tblocked\t${result.blockedReason}`);
  if (result.next) console.log(`assignments\tintake-proposals\tnext\t${result.next}`);
}

function printResearchIntakeReferenceRows(commandSuffix, references = []) {
  const rows = Array.isArray(references) ? references : [];
  const limit = 25;
  for (const reference of rows.slice(0, limit)) {
    console.log([
      "assignments",
      commandSuffix,
      "reference",
      reference.action ?? "-",
      reference.status ?? "-",
      reference.sourceReadiness ?? "-",
      reference.referenceId ?? "-",
      reference.curationAssignmentId ?? "-",
      reference.url ?? "-",
      reference.title ?? "-",
    ].join("\t"));
  }
  if (rows.length > limit) {
    console.log(`assignments\t${commandSuffix}\treferences-omitted\t${rows.length - limit}`);
  }
}

function normalizeProposalIntakeStatus(value) {
  const status = normalizeReferenceCurationStatus(value, "pending");
  if (status !== "pending" && status !== "rejected") {
    throw new Error(`Research proposal intake supports --status pending|rejected, not ${status}.`);
  }
  return status;
}

async function listOrphanResearchPackets(flags) {
  const options = parseOptions(flags);
  const asJson = Boolean(options.json);
  const { client } = createAuthoringClient();
  const [messages, relations] = await Promise.all([
    client.listRecords("Message"),
    client.listRecords("SemanticRelation"),
  ]);
  const linkedMessageIds = new Set(relations
    .filter((relation) => relation.relationState === "current")
    .filter((relation) => (
      ((relation.relationTypeKey ?? relation.predicate) === "comment" && relation.subjectKind === "message" && relation.objectKind === "assignment")
      || ((relation.relationTypeKey ?? relation.predicate) === "produces" && relation.subjectKind === "assignment" && relation.objectKind === "message")
    ))
    .map((relation) => (relation.objectKind === "message" ? relation.objectId : relation.subjectId))
    .filter(Boolean));
  const orphans = messages
    .filter((message) => message.messageKind === "research_packet")
    .filter((message) => !linkedMessageIds.has(message.id))
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
  const rows = orphans.map((message) => ({
    id: message.id,
    createdAt: message.createdAt ?? null,
    status: message.status ?? null,
    summary: message.summary ?? null,
  }));
  if (asJson) {
    printCompactJson({
      ok: true,
      command: "assignments orphan-research-packets",
      count: rows.length,
      orphans: rows,
    });
    return;
  }
  if (!rows.length) {
    console.log("assignment-research-packet-orphans\t0");
    return;
  }
  for (const row of rows) {
    console.log([
      row.createdAt ?? "-",
      row.id,
      row.status ?? "-",
      row.summary ?? "Stored research packet",
    ].join("\t"));
  }
}

async function listAssignmentEvents(flags) {
  const options = parseOptions(flags);
  const assignmentId = options.assignment;
  if (!assignmentId) throw new Error("assignments events requires --assignment.");
  const { client } = createAuthoringClient();
  const events = (await client.listRecords("AssignmentEvent"))
    .filter((event) => event.assignmentId === assignmentId)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  for (const event of events) {
    const metadata = await readJsonModelPayload(client, "assignmentEvent", event.id, "metadata", "metadata") ?? {};
    const runId = metadata && typeof metadata === "object" ? metadata.runId ?? "" : "";
    const commandLabel = metadata && typeof metadata === "object" ? metadata.commandLabel ?? "" : "";
    console.log([
      event.createdAt,
      event.eventType,
      `${event.fromStatus ?? ""}->${event.toStatus ?? ""}`,
      runId,
      commandLabel,
      event.note ?? "",
    ].join("\t"));
  }
  console.log(`assignments\tevents\t${assignmentId}\t${events.length}`);
}

async function reviewReportingPacket(flags) {
  const options = parseOptions(flags);
  const assignmentId = normalizeCliString(options.assignment);
  const messageId = normalizeCliString(options.message);
  const decision = normalizeReportingReviewDecision(options.decision);
  if (options.apply && options["dry-run"]) throw new Error("assignments review-reporting-packet accepts --apply or --dry-run, not both.");
  const apply = Boolean(options.apply);
  if (!assignmentId) throw new Error("assignments review-reporting-packet requires --assignment.");
  if (!messageId) throw new Error("assignments review-reporting-packet requires --message.");
  const { auth, client } = createAuthoringClient();
  const assignment = await client.getRecord("Assignment", assignmentId);
  if (!assignment) throw new Error(`Assignment ${assignmentId} was not found.`);
  const message = await client.getRecord("Message", messageId);
  if (!message) throw new Error(`Message ${messageId} was not found.`);
  const messageMetadata = await readJsonModelPayloadOptional(client, "message", message.id, "metadata", "metadata")
    ?? parseJsonish(message.metadata);
  const targetItemId = normalizeCliString(options["target-item"]);
  const targetItem = targetItemId ? await client.getRecord("Item", targetItemId) : null;
  if (targetItemId && !targetItem) throw new Error(`Target Item ${targetItemId} was not found.`);
  const semanticRelations = await loadReportingPacketReviewRelations(client, { assignmentId, messageId });
  const actorLabel = normalizeCliString(options["actor-label"]) ?? normalizeCliString(auth.claims.email) ?? normalizeCliString(auth.claims.sub) ?? "papyrus-content-cli";
  const plan = buildReportingPacketReviewPlan({
    assignment,
    message: { ...message, metadata: messageMetadata },
    decision,
    note: options.note ?? "",
    targetItem,
    actorLabel,
    actorSub: auth.claims.sub ?? null,
    semanticRelations,
  });
  const changes = await buildRecordChangesTargetedByIdToleratingOptionalModels(client, plan.records, {
    prepareVersioned: false,
  });
  const report = writeReportingPacketReviewReport(plan, changes, {
    outputDir: options.output,
  });
  if (apply) {
    await applyRecordChanges(client, changes);
    await updateNewsroomSummaryAfterAssignmentCreates(client, changes, {
      actorLabel,
      reason: `assignments review-reporting-packet ${assignment.id}`,
    });
  }
  if (options.json) {
    printCompactJson({
      ok: true,
      command: "assignments review-reporting-packet",
      applied: apply,
      report: report.filepath,
      ...plan.summary,
      changes: changeCounts(changes),
    });
    return;
  }
  printReportingPacketReviewSummary(plan, changes, { apply, report });
}

async function loadReportingPacketReviewRelations(client, { assignmentId, messageId }) {
  const [assignmentRelations, messageRelations] = await Promise.all([
    client.listSemanticRelationsBySubjectState(semanticStateKey("assignment", assignmentId)),
    client.listSemanticRelationsBySubjectState(semanticStateKey("message", messageId)),
  ]);
  const seen = new Set();
  return [...assignmentRelations, ...messageRelations].filter((relation) => {
    const key = relation?.id ?? JSON.stringify(relation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function writeReportingPacketReviewReport(plan, changes, options = {}) {
  const outputDir = path.resolve(options.outputDir ?? path.join(".papyrus-runs", `reporting-packet-review-${safeId(plan.assignmentId).slice(0, 60)}-${timestampForPath()}`));
  fs.mkdirSync(outputDir, { recursive: true });
  const filepath = path.join(outputDir, "reporting-packet-review-report.json");
  const serializableChanges = changes.map((change) => ({
    modelName: change.modelName,
    action: change.action,
    id: change.expected?.id ?? null,
  }));
  fs.writeFileSync(filepath, `${JSON.stringify({ plan, changes: serializableChanges }, null, 2)}\n`, "utf8");
  return { outputDir, filepath };
}

function printReportingPacketReviewSummary(plan, changes, { apply, report }) {
  console.log(`reporting-packet-review\tmode\t${apply ? "apply" : "dry-run"}`);
  console.log(`reporting-packet-review\tassignment\t${plan.assignmentId}`);
  console.log(`reporting-packet-review\tmessage\t${plan.messageId}`);
  console.log(`reporting-packet-review\tdecision\t${plan.decision}`);
  if (plan.summary.copywritingAssignmentId) console.log(`reporting-packet-review\tcopywriting-assignment\t${plan.summary.copywritingAssignmentId}`);
  if (plan.summary.draftItemId) console.log(`reporting-packet-review\tdraft-item\t${plan.summary.draftItemId}`);
  if (plan.summary.targetItemId) console.log(`reporting-packet-review\ttarget-item\t${plan.summary.targetItemId}`);
  console.log(`reporting-packet-review\tedition-item\tcreated=false`);
  console.log(`reporting-packet-review\treport\t${report.filepath}`);
  console.log(`reporting-packet-review\tchanges\t${formatChangeCounts(changeCounts(changes))}`);
  if (!apply) console.log("reporting-packet-review\tapply\tskipped\tpass --apply to write review records");
}

async function runCopywritingAssignment(flags) {
  const options = parseOptions(flags);
  const assignmentId = normalizeCliString(options.assignment);
  if (options.apply && options["dry-run"]) throw new Error("assignments run-copywriting accepts --apply or --dry-run, not both.");
  const apply = Boolean(options.apply);
  if (!assignmentId) throw new Error("assignments run-copywriting requires --assignment.");
  const { auth, client } = createAuthoringClient();
  const assignment = await client.getRecord("Assignment", assignmentId);
  if (!assignment) throw new Error(`Assignment ${assignmentId} was not found.`);
  if (!COPYWRITING_ASSIGNMENT_TYPES.has(assignment.assignmentTypeKey)) {
    throw new Error(`Assignment ${assignmentId} must be copywriting.article-draft or copywriting.brief-draft.`);
  }
  const [assignmentMeta, semanticRelations] = await Promise.all([
    assignmentMetadata(client, assignment),
    client.listSemanticRelationsBySubjectState(semanticStateKey("assignment", assignment.id)),
  ]);
  const itemIds = producedItemIdsFromRelations(semanticRelations);
  const itemMap = await client.getRecordsById("Item", itemIds);
  const items = Array.from(itemMap.values()).filter(Boolean);
  const packetMessageId = normalizeCliString(options.message)
    ?? normalizeCliString(assignmentMeta.sourceReportingPacketMessageId)
    ?? findSourceReportingPacketMessageId(semanticRelations, assignment.id);
  if (!packetMessageId) throw new Error(`Copywriting Assignment ${assignment.id} is missing a source reporting packet Message.`);
  const reportingPacketMessage = await client.getRecord("Message", packetMessageId);
  if (!reportingPacketMessage) throw new Error(`Reporting packet Message ${packetMessageId} was not found.`);
  const reportingPacketPayload = await readJsonModelPayloadOptional(client, "message", reportingPacketMessage.id, "metadata", "metadata")
    ?? parseJsonish(reportingPacketMessage.metadata);
  const actorLabel = normalizeCliString(options["actor-label"]) ?? normalizeCliString(auth.claims.email) ?? normalizeCliString(auth.claims.sub) ?? "papyrus-content-cli";
  const plan = buildCopywritingRunPlan({
    assignment,
    assignmentMetadata: assignmentMeta,
    reportingPacketMessage: { ...reportingPacketMessage, metadata: reportingPacketPayload },
    reportingPacketPayload,
    semanticRelations,
    existingItems: items,
    actorLabel,
    actorSub: auth.claims.sub ?? null,
  });
  const changes = await buildRecordChangesTargetedByIdToleratingOptionalModels(client, plan.records, {
    prepareVersioned: false,
  });
  const report = writeCopywritingRunReport(plan, changes, {
    outputDir: options.output,
  });
  if (apply) await applyRecordChanges(client, changes);
  if (options.json) {
    printCompactJson({
      ok: true,
      command: "assignments run-copywriting",
      applied: apply,
      report: report.filepath,
      ...plan.summary,
      changes: changeCounts(changes),
    });
    return;
  }
  printCopywritingRunSummary(plan, changes, { apply, report });
}

function findSourceReportingPacketMessageId(relations, assignmentId) {
  const relation = (relations ?? []).find((entry) => (
    entry.relationState !== "superseded"
    && entry.subjectKind === "assignment"
    && entry.subjectId === assignmentId
    && entry.objectKind === "message"
    && (entry.relationTypeKey ?? entry.predicate) === "derived_from"
  ));
  return normalizeCliString(relation?.objectId);
}

function producedItemIdsFromRelations(relations) {
  return Array.from(new Set((relations ?? [])
    .filter((relation) => relation.relationState !== "superseded")
    .filter((relation) => relation.objectKind === "item")
    .filter((relation) => (relation.relationTypeKey ?? relation.predicate) === "produces")
    .map((relation) => relation.objectId)
    .filter(Boolean)));
}

function writeCopywritingRunReport(plan, changes, options = {}) {
  const outputDir = path.resolve(options.outputDir ?? path.join(".papyrus-runs", `copywriting-${safeId(plan.assignmentId).slice(0, 60)}-${timestampForPath()}`));
  fs.mkdirSync(outputDir, { recursive: true });
  const filepath = path.join(outputDir, "copywriting-report.json");
  const serializableChanges = changes.map((change) => ({
    modelName: change.modelName,
    action: change.action,
    id: change.expected?.id ?? null,
  }));
  fs.writeFileSync(filepath, `${JSON.stringify({ plan, changes: serializableChanges }, null, 2)}\n`, "utf8");
  return { outputDir, filepath };
}

function printCopywritingRunSummary(plan, changes, { apply, report }) {
  console.log(`copywriting\tmode\t${apply ? "apply" : "dry-run"}`);
  console.log(`copywriting\tassignment\t${plan.assignmentId}`);
  console.log(`copywriting\tsource-packet\t${plan.sourceReportingPacketMessageId}`);
  console.log(`copywriting\ttarget-type\t${plan.targetItemType}`);
  console.log(`copywriting\tdraft-item\t${plan.summary.draftItemId}`);
  console.log(`copywriting\tlineage\t${plan.summary.draftItemLineageId}`);
  console.log(`copywriting\tversion\t${plan.summary.versionNumber}`);
  console.log(`copywriting\tedition-item\tcreated=false`);
  console.log(`copywriting\treport\t${report.filepath}`);
  console.log(`copywriting\tchanges\t${formatChangeCounts(changeCounts(changes))}`);
  if (!apply) console.log("copywriting\tapply\tskipped\tpass --apply to write draft Item records");
}

async function showCopywritingOutput(flags) {
  const options = parseOptions(flags);
  const asJson = Boolean(options.json);
  const { client } = createAuthoringClient();
  const requestedAssignmentId = normalizeCliString(options.assignment);
  if (requestedAssignmentId) {
    const assignment = await client.getRecord("Assignment", requestedAssignmentId);
    const rows = assignment && COPYWRITING_ASSIGNMENT_TYPES.has(assignment.assignmentTypeKey)
      ? [await copywritingOutputRowForAssignment(client, assignment)]
      : [];
    const output = {
      ok: true,
      command: "assignments copywriting-output",
      count: rows.length,
      copywritingAssignments: rows,
    };
    if (asJson) {
      printCompactJson(output);
      return;
    }
    printCopywritingOutputRows(rows);
    return;
  }
  const copywritingAssignments = await loadCopywritingAssignments(client);
  const assignmentMetadataRows = await Promise.all(copywritingAssignments.map(async (assignment) => ({
    assignment,
    metadata: await assignmentMetadata(client, assignment),
  })));
  const filteredAssignments = assignmentMetadataRows
    .filter(({ assignment }) => !options.assignment || assignment.id === normalizeCliString(options.assignment))
    .filter(({ assignment, metadata }) => !options["run-id"] || normalizeCliString(options["run-id"]) === (
      metadata.storyCycleRunId
      ?? metadata.coverageThemeRunId
      ?? metadata.runId
      ?? assignment.importRunId
    ))
    .filter(({ metadata }) => !options["coverage-key"] || normalizeCliString(options["coverage-key"]) === (
      metadata.coverageConceptKey
      ?? metadata.coverageKey
    ))
    .filter(({ assignment, metadata }) => !options.section || (assignment.sectionKey ?? metadata.sectionKey) === normalizeCliString(options.section));
  const filtered = (await Promise.all(filteredAssignments.map(({ assignment, metadata }) => copywritingOutputRowForAssignment(client, assignment, metadata))))
    .sort((left, right) => (
      String(left.storyCycleRunId ?? "").localeCompare(String(right.storyCycleRunId ?? ""))
      || String(left.sectionKey ?? "").localeCompare(String(right.sectionKey ?? ""))
      || left.assignmentId.localeCompare(right.assignmentId)
    ));
  const output = {
    ok: true,
    command: "assignments copywriting-output",
    count: filtered.length,
    copywritingAssignments: filtered,
  };
  if (asJson) {
    printCompactJson(output);
    return;
  }
  printCopywritingOutputRows(filtered);
}

async function loadCopywritingAssignments(client) {
  const groups = await Promise.all(Array.from(COPYWRITING_ASSIGNMENT_TYPES).map(async (assignmentTypeKey) => {
    try {
      return await client.listAssignmentsByTypeStatusAndCreatedAt(assignmentTypeKey);
    } catch {
      return [];
    }
  }));
  const assignments = groups.flat().filter((assignment) => COPYWRITING_ASSIGNMENT_TYPES.has(assignment.assignmentTypeKey));
  const byId = new Map();
  for (const assignment of assignments) byId.set(assignment.id, assignment);
  if (byId.size) return Array.from(byId.values());
  return (await client.listRecords("Assignment"))
    .filter((assignment) => COPYWRITING_ASSIGNMENT_TYPES.has(assignment.assignmentTypeKey));
}

async function copywritingOutputRowForAssignment(client, assignment, metadataOverride = null) {
  const [metadata, semanticRelations, assignmentEvents] = await Promise.all([
    metadataOverride ?? assignmentMetadata(client, assignment),
    client.listSemanticRelationsBySubjectState(semanticStateKey("assignment", assignment.id)),
    client.listAssignmentEventsByAssignmentAndCreatedAt(assignment.id),
  ]);
  const itemById = await client.getRecordsById("Item", producedItemIdsFromRelations(semanticRelations));
  const producedItems = semanticRelations
    .filter((relation) => relation.relationState !== "superseded")
    .filter((relation) => relation.subjectKind === "assignment" && relation.subjectId === assignment.id)
    .filter((relation) => relation.objectKind === "item" && (relation.relationTypeKey ?? relation.predicate) === "produces")
    .map((relation) => itemById.get(relation.objectId))
    .filter(Boolean)
    .sort((left, right) => Number(right.versionNumber ?? 0) - Number(left.versionNumber ?? 0));
  const latestEvent = assignmentEvents
    .filter((event) => event.eventType.startsWith("copywriting_"))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] ?? null;
  return {
    assignmentId: assignment.id,
    assignmentTypeKey: assignment.assignmentTypeKey,
    status: assignment.status,
    sectionKey: assignment.sectionKey ?? metadata.sectionKey ?? null,
    storyCycleRunId: metadata.storyCycleRunId ?? metadata.coverageThemeRunId ?? metadata.runId ?? assignment.importRunId ?? null,
    coverageConceptKey: metadata.coverageConceptKey ?? metadata.coverageKey ?? null,
    sourceReportingAssignmentId: metadata.sourceReportingAssignmentId ?? null,
    sourceReportingPacketMessageId: metadata.sourceReportingPacketMessageId ?? null,
    targetItemType: metadata.targetItemType ?? (assignment.assignmentTypeKey === "copywriting.brief-draft" ? "brief" : "article"),
    draftItemId: producedItems[0]?.id ?? null,
    draftItemLineageId: producedItems[0]?.lineageId ?? null,
    draftVersionNumber: producedItems[0]?.versionNumber ?? null,
    latestEventType: latestEvent?.eventType ?? null,
    latestEventAt: latestEvent?.createdAt ?? null,
  };
}

function printCopywritingOutputRows(rows) {
  if (!rows.length) {
    console.log("assignments\tcopywriting-output\t0");
    return;
  }
  for (const row of rows) {
    console.log([
      row.storyCycleRunId ?? "-",
      row.sectionKey ?? "-",
      row.assignmentId,
      row.status ?? "-",
      row.targetItemType ?? "-",
      row.sourceReportingPacketMessageId ?? "-",
      row.draftItemId ?? "-",
      row.draftVersionNumber ?? "-",
    ].join("\t"));
  }
  console.log(`assignments\tcopywriting-output\t${rows.length}`);
}

function changeCounts(changes) {
  return changes.reduce((memo, change) => {
    memo[change.action] = (memo[change.action] ?? 0) + 1;
    return memo;
  }, {});
}

function formatChangeCounts(counts) {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\t");
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
  if (options.json) {
    printCompactJson({
      ok: true,
      command: `assignments ${action}`,
      assignmentId,
      previousStatus: result.fromStatus,
      status: result.toStatus,
      eventId: result.eventId,
      assigneeKey: result.assignment.assigneeKey ?? null,
      claimExpiresAt: result.assignment.claimExpiresAt ?? null,
    });
  } else {
    console.log(`assignment\t${action}\t${assignmentId}\t${result.fromStatus}->${result.toStatus}`);
  }
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

async function dispatchEditionReporting(flags) {
  const options = parseOptions(flags);
  options["assignment-type"] = "reporting";
  const dryRunOnly = !options.apply;
  const { client, plan, report } = await buildEditionPlanningCommandPlan(options);
  if (dryRunOnly) {
    printEditionPlanningSummary(plan, report, "dry-run");
    console.log("edition-planning\tapply\tskipped\tpass --apply to write reporting Assignment and SemanticRelation records");
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
    filename: "dispatch-reporting-report.json",
  });
  writeEditionPlanningReport(plan, verification, {
    outputDir: report.outputDir,
    filename: "reporting-verification.json",
  });
  printEditionPlanningSummary(plan, applyReport, "apply");
  console.log(`edition-planning\tapplied\t${applyResult.applied}`);
  console.log(`edition-planning\tverification\t${verification.ok ? "ok" : "failed"}`);
  if (verification.failures.length) {
    for (const failure of verification.failures) console.log(`failure\t${failure}`);
    throw new Error("Reporting edition planning verification failed.");
  }
}

async function purgeEditions(flags) {
  const options = parseOptions(flags);
  const mode = normalizeCliString(options.mode);
  if (mode !== "edition-only" && mode !== "edition-and-items") {
    throw new Error("editions purge requires --mode edition-only|edition-and-items.");
  }
  const purgeAll = Boolean(options.all);
  const editionSelector = normalizeCliString(options.edition);
  if (purgeAll && editionSelector) throw new Error("editions purge accepts either --all or --edition, not both.");
  if (!purgeAll && !editionSelector) throw new Error("editions purge requires --edition <id|slug|date> or --all.");

  const { client } = createAuthoringClient();
  const plan = await buildEditionPurgePlan(client, { mode, purgeAll, editionSelector });
  const result = await applyEditionPurgePlan(client, plan);
  if (options.json) {
    printCompactJson({
      ok: true,
      command: "editions purge",
      mode,
      selector: purgeAll ? "all" : editionSelector,
      targetedEditionLineages: Array.from(plan.targetEditionLineageIds).sort(),
      deleted: result.deleted,
      skipped: result.skipped,
    });
    return;
  }

  console.log(`editions-purge\tmode\t${mode}`);
  console.log(`editions-purge\tselector\t${purgeAll ? "all" : editionSelector}`);
  console.log(`editions-purge\ttargeted-lineages\t${plan.targetEditionLineageIds.size}`);
  for (const [modelName, deleted] of Object.entries(result.deleted)) {
    console.log(`editions-purge\tdeleted\t${modelName}\t${deleted}`);
  }
  for (const [modelName, reason] of Object.entries(result.skipped)) {
    console.log(`editions-purge\tskipped\t${modelName}\t${reason}`);
  }
}

async function buildEditionPurgePlan(client, { mode, purgeAll, editionSelector }) {
  const [editions, publishedEditions, editionItems, publishedEditionItems] = await Promise.all([
    safeListRecordsForPurge(client, "Edition"),
    safeListRecordsForPurge(client, "PublishedEdition"),
    safeListRecordsForPurge(client, "EditionItem"),
    safeListRecordsForPurge(client, "PublishedEditionItem"),
  ]);

  const normalizedEditions = editions.map((record) => ({
    id: normalizeCliString(record.id),
    lineageId: normalizeCliString(record.lineageId) ?? normalizeCliString(record.id),
    slug: normalizeCliString(record.slug),
    editionDate: normalizeCliString(record.editionDate),
  })).filter((record) => record.id && record.lineageId);
  const normalizedPublishedEditions = publishedEditions.map((record) => ({
    id: normalizeCliString(record.id),
    sourceEditionId: normalizeCliString(record.sourceEditionId),
    lineageId: normalizeCliString(record.editionLineageId) ?? normalizeCliString(record.sourceEditionId),
    slug: normalizeCliString(record.slug),
    editionDate: normalizeCliString(record.editionDate),
  })).filter((record) => record.id && record.lineageId);

  const targetEditionLineageIds = resolveEditionPurgeLineages({
    editions: normalizedEditions,
    publishedEditions: normalizedPublishedEditions,
    purgeAll,
    editionSelector,
  });
  if (targetEditionLineageIds.size === 0) {
    return {
      mode,
      targetEditionLineageIds,
      ids: {},
    };
  }

  const targetEditionIds = new Set(
    normalizedEditions
      .filter((record) => targetEditionLineageIds.has(record.lineageId))
      .map((record) => record.id),
  );
  const targetPublishedEditionIds = new Set(
    normalizedPublishedEditions
      .filter((record) => targetEditionLineageIds.has(record.lineageId) || (record.sourceEditionId && targetEditionIds.has(record.sourceEditionId)))
      .map((record) => record.id),
  );
  const targetEditionItemRows = editionItems.filter((record) =>
    targetEditionIds.has(normalizeCliString(record.editionId))
    || targetEditionLineageIds.has(normalizeCliString(record.editionLineageId)),
  );
  const targetPublishedEditionItemRows = publishedEditionItems.filter((record) =>
    targetPublishedEditionIds.has(normalizeCliString(record.publishedEditionId))
    || targetEditionLineageIds.has(normalizeCliString(record.editionLineageId))
    || targetEditionIds.has(normalizeCliString(record.sourceEditionId)),
  );

  const targetItemLineages = new Set(
    targetEditionItemRows
      .map((record) => normalizeCliString(record.itemLineageId) ?? normalizeCliString(record.itemId))
      .concat(targetPublishedEditionItemRows.map((record) => normalizeCliString(record.itemLineageId) ?? normalizeCliString(record.sourceItemId)))
      .filter(Boolean),
  );

  const ids = {
    Edition: new Set(Array.from(targetEditionIds).filter(Boolean)),
    PublishedEdition: new Set(Array.from(targetPublishedEditionIds).filter(Boolean)),
    EditionItem: new Set(targetEditionItemRows.map((record) => normalizeCliString(record.id)).filter(Boolean)),
    PublishedEditionItem: new Set(targetPublishedEditionItemRows.map((record) => normalizeCliString(record.id)).filter(Boolean)),
    Item: new Set(),
    PublishedItem: new Set(),
    MediaAsset: new Set(),
    PublishedMediaAsset: new Set(),
    ItemTag: new Set(),
    Tag: new Set(),
  };

  if (mode === "edition-only") {
    return {
      mode,
      targetEditionLineageIds,
      ids,
    };
  }

  const [items, publishedItems, mediaAssets, publishedMediaAssets, itemTags, tags] = await Promise.all([
    safeListRecordsForPurge(client, "Item"),
    safeListRecordsForPurge(client, "PublishedItem"),
    safeListRecordsForPurge(client, "MediaAsset"),
    safeListRecordsForPurge(client, "PublishedMediaAsset"),
    safeListRecordsForPurge(client, "ItemTag"),
    safeListRecordsForPurge(client, "Tag"),
  ]);

  const survivingItemLineages = new Set(
    editionItems
      .filter((record) => !ids.EditionItem.has(normalizeCliString(record.id)))
      .map((record) => normalizeCliString(record.itemLineageId) ?? normalizeCliString(record.itemId))
      .concat(
        publishedEditionItems
          .filter((record) => !ids.PublishedEditionItem.has(normalizeCliString(record.id)))
          .map((record) => normalizeCliString(record.itemLineageId) ?? normalizeCliString(record.sourceItemId)),
      )
      .filter(Boolean),
  );
  const purgeItemLineages = new Set(Array.from(targetItemLineages).filter((lineageId) => !survivingItemLineages.has(lineageId)));
  const itemRowsToDelete = items.filter((record) => {
    const lineageId = normalizeCliString(record.lineageId) ?? normalizeCliString(record.id);
    return lineageId && purgeItemLineages.has(lineageId);
  });
  const publishedItemRowsToDelete = publishedItems.filter((record) => {
    const lineageId = normalizeCliString(record.itemLineageId) ?? normalizeCliString(record.sourceItemId);
    return lineageId && purgeItemLineages.has(lineageId);
  });
  const itemIdsToDelete = new Set(itemRowsToDelete.map((record) => normalizeCliString(record.id)).filter(Boolean));
  const publishedItemIdsToDelete = new Set(publishedItemRowsToDelete.map((record) => normalizeCliString(record.id)).filter(Boolean));
  const sourceItemIdsFromPublished = new Set(publishedItemRowsToDelete.map((record) => normalizeCliString(record.sourceItemId)).filter(Boolean));
  for (const sourceItemId of sourceItemIdsFromPublished) itemIdsToDelete.add(sourceItemId);

  const mediaAssetIdsToDelete = new Set(
    mediaAssets
      .filter((record) => itemIdsToDelete.has(normalizeCliString(record.itemId)))
      .map((record) => normalizeCliString(record.id))
      .filter(Boolean),
  );
  const publishedMediaAssetIdsToDelete = new Set(
    publishedMediaAssets
      .filter((record) => {
        const sourceItemId = normalizeCliString(record.sourceItemId);
        const itemLineageId = normalizeCliString(record.itemLineageId);
        const publishedItemId = normalizeCliString(record.publishedItemId);
        return itemIdsToDelete.has(sourceItemId)
          || purgeItemLineages.has(itemLineageId)
          || publishedItemIdsToDelete.has(publishedItemId);
      })
      .map((record) => normalizeCliString(record.id))
      .filter(Boolean),
  );
  const itemTagRowsToDelete = itemTags.filter((record) => itemIdsToDelete.has(normalizeCliString(record.itemId)));
  const itemTagIdsToDelete = new Set(itemTagRowsToDelete.map((record) => normalizeCliString(record.id)).filter(Boolean));
  const candidateTagIds = new Set(itemTagRowsToDelete.map((record) => normalizeCliString(record.tagId)).filter(Boolean));
  const tagIdsStillLinked = new Set(
    itemTags
      .filter((record) => !itemTagIdsToDelete.has(normalizeCliString(record.id)))
      .map((record) => normalizeCliString(record.tagId))
      .filter(Boolean),
  );
  const tagIdsToDelete = new Set(
    tags
      .map((record) => normalizeCliString(record.id))
      .filter((tagId) => candidateTagIds.has(tagId) && !tagIdsStillLinked.has(tagId)),
  );

  ids.Item = new Set(itemIdsToDelete);
  ids.PublishedItem = new Set(publishedItemIdsToDelete);
  ids.MediaAsset = mediaAssetIdsToDelete;
  ids.PublishedMediaAsset = publishedMediaAssetIdsToDelete;
  ids.ItemTag = itemTagIdsToDelete;
  ids.Tag = tagIdsToDelete;

  return {
    mode,
    targetEditionLineageIds,
    ids,
  };
}

function resolveEditionPurgeLineages({ editions, publishedEditions, purgeAll, editionSelector }) {
  if (purgeAll) {
    return new Set(
      editions.map((record) => record.lineageId).concat(publishedEditions.map((record) => record.lineageId)).filter(Boolean),
    );
  }
  const selector = normalizeCliString(editionSelector);
  if (!selector) return new Set();
  const matches = [
    ...editions.filter((record) => record.id === selector || record.slug === selector || record.editionDate === selector || record.lineageId === selector),
    ...publishedEditions.filter((record) => record.id === selector || record.slug === selector || record.editionDate === selector || record.lineageId === selector || record.sourceEditionId === selector),
  ];
  return new Set(matches.map((record) => record.lineageId).filter(Boolean));
}

async function safeListRecordsForPurge(client, modelName) {
  try {
    return await client.listRecords(modelName);
  } catch (error) {
    if (!isMissingGraphQLModelError(error, modelName) && !isDynamoResourceNotFoundError(error)) throw error;
    return [];
  }
}

async function applyEditionPurgePlan(client, plan) {
  const deleted = {};
  const skipped = {};
  if (!plan || !plan.ids || plan.targetEditionLineageIds.size === 0) {
    return { deleted, skipped };
  }

  const deleteOrder = plan.mode === "edition-and-items"
    ? ["PublishedMediaAsset", "MediaAsset", "ItemTag", "PublishedEditionItem", "EditionItem", "PublishedItem", "Item", "Tag", "PublishedEdition", "Edition"]
    : ["PublishedEditionItem", "EditionItem", "PublishedEdition", "Edition"];

  for (const modelName of deleteOrder) {
    const ids = plan.ids[modelName] ? Array.from(plan.ids[modelName]).filter(Boolean) : [];
    if (ids.length === 0) {
      deleted[modelName] = 0;
      continue;
    }
    try {
      const result = await deleteRecordsForModel(client, modelName, ids.map((id) => ({ id })));
      deleted[modelName] = result.deleted;
    } catch (error) {
      if (!isMissingGraphQLModelError(error, modelName) && !isDynamoResourceNotFoundError(error)) throw error;
      skipped[modelName] = normalizeError(error).message;
      deleted[modelName] = 0;
    }
  }
  return { deleted, skipped };
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
  const [categorySets, newsroomSections] = await Promise.all([
    client.listRecords("CategorySet"),
    client.listRecords("NewsroomSection"),
  ]);
  const categorySet = selectAnalysisCategorySet(categorySets, plan, options["category-set"]);
  const sectionTarget = resolveNewsroomSectionTarget(newsroomSections, options.section);
  const assignmentPlan = buildAnalysisReindexAssignmentRecords(plan, {
    categorySet,
    sectionTarget,
    actorLabel: options.actor || "papyrus-content-cli",
  });
  if (options.output) writeJsonFile(options.output, { plan, assignment: assignmentPlan.assignment, records: assignmentPlan.records });
  printAnalysisReindexPlan(plan);
  const assignmentChanges = await buildRecordChangesTargetedByIdToleratingOptionalModels(client, assignmentPlan.records.map(plannedRecordInput));
  for (const record of assignmentChanges) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
  }
  if (!options.apply) {
    console.log("analysis\tcreate-reindex-assignment\tapply\tskipped\tpass --apply to write Assignment records");
    return;
  }
  await applyRecordChanges(client, assignmentChanges);
  await updateNewsroomSummaryAfterAssignmentCreates(client, assignmentChanges, {
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
  const [categorySets, newsroomSections] = await Promise.all([
    client.listRecords("CategorySet"),
    client.listRecords("NewsroomSection"),
  ]);
  const categorySet = selectAnalysisCategorySet(categorySets, plan, runNowOptions["category-set"]);
  const sectionTarget = resolveNewsroomSectionTarget(newsroomSections, runNowOptions.section);
  const assignmentPlan = buildAnalysisReindexAssignmentRecords(plan, {
    categorySet,
    sectionTarget,
    actorLabel: runNowOptions.actor || "papyrus-content-cli",
  });
  runNowOptions.__assignmentMetadata = assignmentPlan.metadata;
  const assignmentChanges = await buildRecordChangesTargetedByIdToleratingOptionalModels(client, assignmentPlan.records.map(plannedRecordInput));
  await applyRecordChanges(client, assignmentChanges);
  await updateNewsroomSummaryAfterAssignmentCreates(client, assignmentChanges, {
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
  if (assignment.assignmentTypeKey === "reference.corpus-accession") {
    return executeReferenceAccessionAssignmentInternal({
      client,
      assignment,
      options,
    });
  }
  if (assignment.assignmentTypeKey === "reference.text-extraction") {
    return executeReferenceTextExtractionAssignmentInternal({
      client,
      assignment,
      options,
    });
  }
  if (assignment.assignmentTypeKey === "reference.doi-backfill") {
    return executeReferenceIdentifierBackfillAssignmentInternal({
      client,
      assignment,
      options,
    });
  }
  if (assignment.assignmentTypeKey === "reference.identifier-backfill") {
    return executeReferenceIdentifierBackfillAssignmentInternal({
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

  const inlineMetadata = options.__assignmentMetadata && typeof options.__assignmentMetadata === "object"
    ? options.__assignmentMetadata
    : null;
  const metadata = inlineMetadata ?? await assignmentMetadata(client, assignment);
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
      graphExportPath: artifacts.graphExportPath ?? null,
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
      graphExportPath: artifacts.graphExportPath ?? null,
    });
    throw error;
  }
}

async function executeReferenceAccessionAssignmentInternal({ client, assignment, options = {} }) {
  if (assignment.assignmentTypeKey !== "reference.corpus-accession") {
    throw new Error(`Assignment ${assignment.id} is ${assignment.assignmentTypeKey}; expected reference.corpus-accession.`);
  }
  if (assignment.status !== "claimed") {
    throw new Error(`Assignment ${assignment.id} must be claimed before execution (current=${assignment.status}).`);
  }
  const metadata = await assignmentMetadata(client, assignment);
  if (metadata.kind !== "reference.corpus-accession.requested") {
    throw new Error(`Assignment ${assignment.id} metadata is not reference.corpus-accession.requested.`);
  }
  const actorLabel = options.actor || options["assignee-key"] || "papyrus-content-cli";
  const runId = options["run-id"] || `reference-accession-${hashShort([assignment.id, new Date().toISOString()])}`;
  const runDir = path.join(process.cwd(), ".papyrus-runs", runId);
  const manifestPath = path.join(runDir, "execution-manifest.json");
  fs.mkdirSync(runDir, { recursive: true });

  const referenceRecord = await client.getRecord("Reference", metadata.referenceId);
  const reference = referenceRecord
    ? { ...referenceRecord, metadata: await readJsonModelPayload(client, "reference", referenceRecord.id, "metadata", "metadata") ?? {} }
    : null;
  if (!reference) {
    throw createReferenceAccessionError(`Reference ${metadata.referenceId} was not found.`, {
      runId,
      manifestPath,
      kind: "missing_reference",
    });
  }
  if (!reference.sourceUri) {
    throw createReferenceAccessionError(`Reference ${reference.id} has no sourceUri to accession.`, {
      runId,
      manifestPath,
      kind: "missing_source_material",
    });
  }
  const steeringConfig = loadSteeringConfig({ configPath: options.config || metadata.steeringConfigPath || undefined });
  const corpusConfig = requireCorpusConfig(steeringConfig, metadata.corpusKey, "assignment.metadata.corpusKey");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const corpusPath = path.resolve(corpusConfig.path);
  const biblicusWorkdir = resolveBiblicusWorkdir(options);

  await appendAssignmentPhaseEvent({
    client,
    assignment,
    eventType: "executing",
    actorLabel,
    note: `Accessioning source material for ${reference.externalItemId}.`,
    metadata: {
      kind: "reference.corpus-accession.executing",
      runId,
      manifestPath,
      referenceId: reference.id,
      sourceUri: reference.sourceUri,
      corpusPath,
    },
  });

  try {
    const sourceMaterial = await downloadReferenceSourceMaterial(reference, {
      biblicusItemId: metadata.biblicusItemId,
      runDir,
    });
    if (!isExtractableMediaType(sourceMaterial.mediaType)) {
      throw createReferenceAccessionError(`Unsupported media type for extraction: ${sourceMaterial.mediaType}.`, {
        runId,
        manifestPath,
        kind: "unsupported_media_type",
      });
    }
    const accession = writeReferenceSourceAccession({
      reference,
      sourceMaterial,
      corpusConfig,
      corpusPath,
      biblicusItemId: metadata.biblicusItemId,
      actorLabel,
    });
    const reindexResult = runBiblicusReindexForAccession({
      corpusPath,
      biblicusWorkdir,
      runDir,
    });
    const s3SyncResult = maybeSyncAccessionToS3({
      corpusConfig,
      corpusPath,
      runDir,
      options,
    });
    const importRunId = `knowledge-import-${safeId(corpusId)}-reference-accession-${hashShort([reference.lineageId, accession.sha256])}`;
    const records = buildReferenceAccessionGraphqlRecords({
      reference,
      corpusConfig,
      corpusId,
      importRunId,
      accession,
      sourceMaterial,
      metadata,
      actorLabel,
    });
    const changes = await buildRecordChanges(client, records);
    const augmentedChanges = augmentReferenceAccessionChangesForReplacement(changes, {
      reference,
      accession,
      metadata,
    });
    await applyRecordChanges(client, augmentedChanges);
    await updateNewsroomSummaryAfterReferenceAccession(client, augmentedChanges, {
      actorLabel,
      reason: `references accession ${assignment.id}`,
    });
    const importSummary = {
      importedRecords: augmentedChanges.filter((change) => change.action !== "noop").length,
      importRuns: [importRunId],
    };
    const manifest = {
      runId,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      status: "executed",
      referenceId: reference.id,
      sourceUri: reference.sourceUri,
      storagePath: accession.storagePath,
      localPath: accession.localPath,
      sidecarPath: accession.sidecarPath,
      mediaType: accession.mediaType,
      sha256: accession.sha256,
      biblicusItemId: accession.biblicusItemId,
      reindex: reindexResult,
      s3Sync: s3SyncResult,
      importSummary,
    };
    writeJsonFile(manifestPath, manifest);
    await appendAssignmentPhaseEvent({
      client,
      assignment,
      eventType: "executed",
      actorLabel,
      note: `Accessioned source material to ${accession.storagePath}.`,
      metadata: {
        kind: "reference.corpus-accession.executed",
        runId,
        manifestPath,
        referenceId: reference.id,
        storagePath: accession.storagePath,
        sidecarPath: accession.sidecarPath,
        importRuns: importSummary.importRuns,
        importedRecords: importSummary.importedRecords,
      },
    });
    return {
      assignmentId: assignment.id,
      runId,
      runDir,
      manifestPath,
      storagePath: accession.storagePath,
      importSummary,
      commandResults: [reindexResult].filter(Boolean),
    };
  } catch (error) {
    const failure = normalizeError(error);
    const artifacts = analysisFailureArtifactsFromError(error);
    const failureManifest = {
      runId,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      failedAt: new Date().toISOString(),
      status: "failed",
      referenceId: reference.id,
      sourceUri: reference.sourceUri,
      error: failure,
      stdoutLogPaths: artifacts.stdoutLogPaths,
      stderrLogPaths: artifacts.stderrLogPaths,
      nextSuggestedCommand: `npm run content -- references source-status --corpus-key ${metadata.corpusKey} --status all`,
    };
    writeJsonFile(manifestPath, failureManifest);
    attachAnalysisFailureArtifacts(error, {
      runId,
      manifestPath,
      kind: failure.kind ?? "reference_accession_failed",
      stdoutLogPaths: artifacts.stdoutLogPaths,
      stderrLogPaths: artifacts.stderrLogPaths,
    });
    throw error;
  }
}

async function executeReferenceTextExtractionAssignmentInternal({ client, assignment, options = {} }) {
  if (assignment.assignmentTypeKey !== "reference.text-extraction") {
    throw new Error(`Assignment ${assignment.id} is ${assignment.assignmentTypeKey}; expected reference.text-extraction.`);
  }
  if (assignment.status !== "claimed") {
    throw new Error(`Assignment ${assignment.id} must be claimed before execution (current=${assignment.status}).`);
  }
  const metadata = await assignmentMetadata(client, assignment);
  if (metadata.kind !== "reference.text-extraction.requested") {
    throw new Error(`Assignment ${assignment.id} metadata is not reference.text-extraction.requested.`);
  }
  const actorLabel = options.actor || options["assignee-key"] || "papyrus-content-cli";
  const runId = options["run-id"] || metadata.runId || `reference-text-extraction-${hashShort([assignment.id, Date.now()])}`;
  const runDir = path.join(".papyrus-runs", runId);
  const manifestPath = path.join(runDir, "execution-manifest.json");
  fs.mkdirSync(runDir, { recursive: true });
  const steeringConfig = loadSteeringConfig({ configPath: options.config || metadata.steeringConfigPath || undefined });
  const corpusConfig = requireCorpusConfig(steeringConfig, metadata.corpusKey, "assignment.metadata.corpusKey");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const corpusPath = path.resolve(corpusConfig.path);
  const biblicusWorkdir = resolveBiblicusWorkdir(options);

  await appendAssignmentPhaseEvent({
    client,
    assignment,
    eventType: "executing",
    actorLabel,
    note: `Running Biblicus text extraction for ${corpusConfig.key}.`,
    metadata: {
      kind: "reference.text-extraction.executing",
      runId,
      manifestPath,
      corpusId,
      corpusPath,
    },
  });

  try {
    const extractionResult = runBiblicusTextExtractionForCorpus({
      corpusPath,
      biblicusWorkdir,
      runDir,
      options: {
        ...metadata.options,
        ...options,
      },
    });
    const [references, attachments] = await Promise.all([
      client.listRecords("Reference"),
      client.listRecords("ReferenceAttachment"),
    ]);
    const extractionIndex = buildExtractionIndex(corpusConfig.path);
    const plans = buildExtractedTextAttachmentPlans({
      corpusConfig,
      corpusId,
      references,
      attachments,
      extractionIndex,
    });
    const records = plans.map((plan) => plan.record).filter(Boolean);
    const changes = await buildRecordChanges(client, records);
    await applyRecordChanges(client, changes);
    await updateNewsroomSummaryAfterExtractedTextAttachments(client, changes, {
      actorLabel,
      reason: `references text extraction ${assignment.id}`,
    });
    const importSummary = {
      importedRecords: changes.filter((change) => change.action !== "noop").length,
      importRuns: [],
    };
    const manifest = {
      runId,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      status: "executed",
      corpusId,
      corpusPath,
      extraction: extractionResult,
      extractionSnapshots: extractionIndex.snapshotIds,
      plannedTextAttachments: records.length,
      importSummary,
      textStoragePolicy: "ReferenceAttachment.role=extracted_text points at corpora/<corpus>/extracted/pipeline/<snapshot-id>/text/<item-id>.txt; raw text is not stored in GraphQL.",
    };
    writeJsonFile(manifestPath, manifest);
    await appendAssignmentPhaseEvent({
      client,
      assignment,
      eventType: "executed",
      actorLabel,
      note: `Registered ${importSummary.importedRecords} extracted text attachment records.`,
      metadata: {
        kind: "reference.text-extraction.executed",
        runId,
        manifestPath,
        corpusId,
        importRuns: importSummary.importRuns,
        importedRecords: importSummary.importedRecords,
        extractionSnapshotIds: extractionIndex.snapshotIds,
      },
    });
    return {
      assignmentId: assignment.id,
      runId,
      runDir,
      manifestPath,
      importSummary,
      commandResults: [extractionResult],
    };
  } catch (error) {
    const failure = normalizeError(error);
    const artifacts = analysisFailureArtifactsFromError(error);
    const failureManifest = {
      runId,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      failedAt: new Date().toISOString(),
      status: "failed",
      corpusId,
      error: failure,
      stdoutLogPaths: artifacts.stdoutLogPaths,
      stderrLogPaths: artifacts.stderrLogPaths,
      nextSuggestedCommand: `npm run content -- references source-status --corpus-key ${metadata.corpusKey} --status accepted`,
    };
    writeJsonFile(manifestPath, failureManifest);
    attachAnalysisFailureArtifacts(error, {
      runId,
      manifestPath,
      kind: failure.kind ?? "reference_text_extraction_failed",
      stdoutLogPaths: artifacts.stdoutLogPaths,
      stderrLogPaths: artifacts.stderrLogPaths,
    });
    throw error;
  }
}

async function executeReferenceIdentifierBackfillAssignmentInternal({ client, assignment, options = {} }) {
  if (!["reference.identifier-backfill", "reference.doi-backfill"].includes(assignment.assignmentTypeKey)) {
    throw new Error(`Assignment ${assignment.id} is ${assignment.assignmentTypeKey}; expected reference.identifier-backfill.`);
  }
  if (assignment.status !== "claimed") {
    throw new Error(`Assignment ${assignment.id} must be claimed before execution (current=${assignment.status}).`);
  }
  const inlineMetadata = options.__assignmentMetadata && typeof options.__assignmentMetadata === "object"
    ? options.__assignmentMetadata
    : null;
  const rawMetadata = inlineMetadata ?? await assignmentMetadata(client, assignment);
  const metadata = normalizeIdentifierAssignmentMetadata(rawMetadata);
  if (metadata.kind !== "reference.identifier-backfill.requested") {
    throw new Error(`Assignment ${assignment.id} metadata is not reference.identifier-backfill.requested.`);
  }
  const actorLabel = options.actor || options["assignee-key"] || "papyrus-content-cli";
  const runId = options["run-id"] || metadata.runId || `reference-identifier-backfill-${hashShort([assignment.id, Date.now()])}`;
  const runDir = path.join(process.cwd(), ".papyrus-runs", runId);
  const manifestPath = path.join(runDir, "execution-manifest.json");
  fs.mkdirSync(runDir, { recursive: true });
  const resumeManifestPath = normalizeCliString(options.resume);
  const resumeManifest = resumeManifestPath ? loadJsonFile(resumeManifestPath) : null;

  const steeringConfig = loadSteeringConfig({ configPath: options.config || metadata.steeringConfigPath || undefined });
  const corpusConfig = requireCorpusConfig(steeringConfig, metadata.corpusKey, "assignment.metadata.corpusKey");
  const corpusId = knowledgeCorpusId(corpusConfig);
  const corpusPath = path.resolve(corpusConfig.path);
  const maxCount = normalizeCliPositiveInteger(options["max-count"], "--max-count")
    ?? normalizeCliPositiveInteger(metadata.maxCount, "assignment.metadata.maxCount");
  const useLlm = parseBooleanOption(options["use-llm"], Boolean(metadata.useLlm), "--use-llm");
  const llmModel = normalizeCliString(options["llm-model"]) ?? normalizeCliString(metadata.llmModel) ?? "gpt-5.4-mini";
  const llmReasoningEffort = normalizeCliString(options["llm-reasoning-effort"]) ?? normalizeCliString(metadata.llmReasoningEffort) ?? "low";
  const persistSidecars = parseBooleanOption(
    options["persist-sidecars"],
    (metadata.sidecarPersistenceMode ?? "enabled") === "enabled",
    "--persist-sidecars",
  );
  const selectedTypes = normalizeIdentifierTypes(options.types ?? metadata.types, { defaultTypes: ["doi"] });
  const onlyMissing = parseBooleanOption(options["only-missing"], Boolean(metadata.onlyMissing), "--only-missing");
  const progressEvery = normalizeCliPositiveInteger(options["progress-every"], "--progress-every")
    ?? normalizeCliPositiveInteger(metadata.progressEvery, "assignment.metadata.progressEvery")
    ?? 25;
  const writeChunkSize = normalizeCliPositiveInteger(options["write-chunk-size"], "--write-chunk-size")
    ?? normalizeCliPositiveInteger(metadata.writeChunkSize, "assignment.metadata.writeChunkSize")
    ?? 100;
  const openaiApiKey = normalizeCliString(options["openai-api-key"]) ?? normalizeCliString(process.env.OPENAI_API_KEY);
  assertCurrentJwtUsableForLongRun("identifier backfill scan");

  await appendAssignmentPhaseEvent({
    client,
    assignment,
    eventType: "executing",
    actorLabel,
    note: `Resolving ${selectedTypes.join(", ")} identifiers for current references in ${metadata.corpusKey}.`,
      metadata: {
        kind: "reference.identifier-backfill.executing",
        runId,
        manifestPath,
        corpusId,
        corpusPath,
        types: selectedTypes,
        maxCount: maxCount ?? null,
        useLlm,
        persistSidecars,
        onlyMissing,
        progressEvery,
        writeChunkSize,
      },
    });

  try {
    const [references, attachments, semanticNodes, semanticRelations] = await Promise.all([
      client.listRecords("Reference"),
      client.listRecords("ReferenceAttachment"),
      client.listRecords("SemanticNode"),
      client.listRecords("SemanticRelation"),
    ]);
    const dedupedReferences = latestRecordsById(references);
    const dedupedSemanticNodes = latestRecordsById(semanticNodes);
    const dedupedSemanticRelations = latestRecordsById(semanticRelations);
    const catalogIndex = parseCatalogItems(corpusPath);
    const now = new Date().toISOString();
    const resolved = Array.isArray(resumeManifest?.resolved) ? resumeManifest.resolved : [];
    const unresolved = Array.isArray(resumeManifest?.unresolved) ? resumeManifest.unresolved : [];
    const sidecarOperations = [];
    const plannedRecords = [];
    const metadataPatchesByReferenceId = new Map();
    const referencesInScope = dedupedReferences
      .filter((reference) => reference.corpusId === corpusId)
      .filter((reference) => reference.versionState === "current")
      .sort((left, right) => (
        String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? ""))
        || String(left.externalItemId ?? left.id).localeCompare(String(right.externalItemId ?? right.id))
      ));
    const currentRelationsByTypeAndLineage = currentIdentifierRelationsByTypeAndLineage(dedupedSemanticRelations, Object.keys(IDENTIFIER_TYPE_CONFIG));
    const filteredReferences = onlyMissing
      ? referencesInScope.filter((reference) => selectedTypes.some((type) => referenceMissingIdentifierType(reference, type, currentRelationsByTypeAndLineage)))
      : referencesInScope;
    const scopedReferences = resumeManifest ? [] : (maxCount ? filteredReferences.slice(0, maxCount) : filteredReferences);
    const currentIdentifierNodesByKey = new Map(
      dedupedSemanticNodes
        .filter((node) => node.versionState === "current")
        .filter((node) => node.nodeKind === "identifier")
        .map((node) => [node.nodeKey, node]),
    );
    for (let index = 0; index < scopedReferences.length; index += 1) {
      const reference = scopedReferences[index];
      if (progressEvery > 0 && (index === 0 || (index + 1) % progressEvery === 0 || index + 1 === scopedReferences.length)) {
        const byType = identifierSummaryByType(selectedTypes, resolved, unresolved);
        const typeSummary = selectedTypes.map((type) => `${type}:${byType[type].resolved}/${byType[type].unresolved}`).join(",");
        console.log(`identifier-backfill\tprogress\t${index + 1}/${scopedReferences.length}\tresolved=${resolved.length}\tunresolved=${unresolved.length}\ttypes=${typeSummary}`);
      }
      const resolverErrors = [];
      let referenceMetadata = parseJsonish(reference.metadata);
      try {
        const attachmentMetadata = await readJsonModelPayload(client, "reference", reference.id, "metadata", "metadata");
        if (attachmentMetadata && typeof attachmentMetadata === "object") {
          referenceMetadata = attachmentMetadata;
        }
      } catch (error) {
        resolverErrors.push({
          stage: "reference_metadata_attachment",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const sourceStoragePath = sourceStoragePathForReference(reference, attachments);
      const localSource = resolveLocalSourcePathForStoragePath(sourceStoragePath, corpusPath);
      const localSidecarPath = localSource ? `${localSource}.biblicus.yml` : null;
      const catalogEntry = reference.externalItemId ? catalogIndex.byItemId.get(reference.externalItemId) ?? null : null;
      let hasPrimaryIdentifier = referenceHasPrimaryIdentifier(reference, {
        referenceMetadata,
        catalogEntry,
        localSidecarPath,
        currentRelationsByTypeAndLineage,
      });
      for (const type of selectedTypes) {
        if (type === "publisher_item" && hasPrimaryIdentifier) continue;
        if (onlyMissing && !referenceMissingIdentifierType(reference, type, currentRelationsByTypeAndLineage)) continue;
        const resolutionErrors = [...resolverErrors];
        const resolution = await resolveIdentifierForReference({
          type,
          reference,
          metadata: referenceMetadata,
          catalogEntry,
          sidecarValue: sidecarIdentifier(localSidecarPath, type),
          useLlm,
          openaiModel: llmModel,
          openaiReasoningEffort: llmReasoningEffort,
          openaiApiKey,
          errors: resolutionErrors,
        });
        if (resolution.status !== "resolved" || !resolution.value) {
          unresolved.push(identifierUnresolvedEntry(reference, type, resolution, resolutionErrors));
          continue;
        }
        if (["doi", "arxiv_id", "isbn13"].includes(type)) hasPrimaryIdentifier = true;
        resolved.push(identifierResolvedEntry(reference, resolution, {
          sidecarPath: localSidecarPath,
          sourceStoragePath,
        }));
        appendIdentifierPlanningRecords({
          reference,
          referenceMetadata,
          type,
          resolution,
          currentIdentifierNodesByKey,
          currentRelationsByTypeAndLineage,
          plannedRecords,
          metadataPatchesByReferenceId,
          sidecarOperations,
          sidecarPath: localSidecarPath,
          sourceStoragePath,
          actorLabel,
          now,
          runId,
        });
      }
    }
    for (const entry of resolved) {
      if (!entry.referenceId || !entry.type || !entry.value) continue;
      if (scopedReferences.length) continue;
      const reference = dedupedReferences.find((candidate) => candidate.id === entry.referenceId);
      if (!reference) continue;
      appendIdentifierPlanningRecords({
        reference,
        referenceMetadata: parseJsonish(reference.metadata),
        type: entry.type,
        resolution: {
          status: "resolved",
          type: entry.type,
          value: entry.value,
          source: entry.source,
          confidence: entry.confidence,
          llmUsed: Boolean(entry.llmUsed),
          candidates: entry.candidates ?? [],
          rationale: entry.rationale ?? "resumed from manifest",
        },
        currentIdentifierNodesByKey,
        currentRelationsByTypeAndLineage,
        plannedRecords,
        metadataPatchesByReferenceId,
        sidecarOperations,
        sidecarPath: entry.sidecarPath ?? null,
        sourceStoragePath: entry.sourceStoragePath ?? null,
        actorLabel,
        now,
        runId,
      });
    }
    for (const patch of metadataPatchesByReferenceId.values()) plannedRecords.push(patch);

    let dedupedPlannedRecords = null;
    try {
      dedupedPlannedRecords = dedupePlannedRecords(plannedRecords);
    } catch (error) {
      const duplicateRelations = [];
      const relationGroups = new Map();
      for (const record of plannedRecords) {
        if (record.modelName !== "SemanticRelation") continue;
        const id = normalizeCliString(record.expected?.id);
        if (!id) continue;
        const entries = relationGroups.get(id) ?? [];
        entries.push(record.expected);
        relationGroups.set(id, entries);
      }
      for (const [id, entries] of relationGroups.entries()) {
        if (entries.length < 2) continue;
        duplicateRelations.push({ id, entries });
      }
      const debugPath = path.join(runDir, "identifier-planned-records-debug.json");
      writeJsonFile(debugPath, {
        assignmentId: assignment.id,
        runId,
        error: error instanceof Error ? error.message : String(error),
        duplicates: duplicateRelations,
      });
      throw createReferenceAccessionError(
        `Failed to dedupe identifier planned records: ${error instanceof Error ? error.message : String(error)}. See ${debugPath}.`,
        {
          runId,
          manifestPath,
          kind: "identifier_planning_conflict",
        },
      );
    }
    const plannedManifest = {
      runId,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      status: "planned",
      corpusId,
      corpusKey: metadata.corpusKey,
      corpusPath,
      plannedAt: now,
      types: selectedTypes,
      useLlm,
      llmModel,
      llmReasoningEffort,
      resolved,
      unresolved,
      plannedRecordCount: dedupedPlannedRecords.length,
      writeChunkSize,
      chunks: [],
      catalogPath: catalogIndex.catalogPath,
    };
    writeJsonFile(manifestPath, plannedManifest);
    assertCurrentJwtUsableForLongRun("identifier backfill write phase");
    const writeResult = await applyIdentifierBackfillRecordChunks({
      client,
      records: dedupedPlannedRecords,
      chunkSize: writeChunkSize,
      manifestPath,
      manifest: plannedManifest,
      actorLabel,
      assignmentId: assignment.id,
    });

    const sidecarManifest = persistSidecars
      ? applyIdentifierSidecarUpdates(sidecarOperations, { runId, actorLabel })
      : {
          created: [],
          updated: [],
          skipped: sidecarOperations.map((entry) => ({
            referenceId: entry.reference.id,
            sidecarPath: entry.sidecarPath,
            reason: "sidecar_persistence_disabled",
          })),
          errors: [],
        };
    if (sidecarManifest.errors.length) {
      throw createReferenceAccessionError(
        `Identifier sidecar updates failed for ${sidecarManifest.errors.length} reference(s).`,
        {
          runId,
          manifestPath,
          kind: "identifier_sidecar_write_failed",
        },
      );
    }

    let reindexResult = null;
    if (persistSidecars && (sidecarManifest.created.length || sidecarManifest.updated.length)) {
      reindexResult = runBiblicusReindexForDoiBackfill({
        corpusPath,
        biblicusWorkdir: resolveBiblicusWorkdir(options),
        runDir,
      });
    }

    const importSummary = {
      importedRecords: writeResult.importedRecords,
      importRuns: [],
    };
    const summary = {
      processed: resumeManifest ? Number(resumeManifest.summary?.processed ?? 0) : scopedReferences.length,
      resolved: resolved.length,
      unresolved: unresolved.length,
      semanticNodesCreated: writeResult.semanticNodesCreated,
      semanticRelationsCreated: writeResult.semanticRelationsCreated,
      semanticRelationsSuperseded: writeResult.semanticRelationsSuperseded,
      referenceMetadataPatched: writeResult.referenceMetadataPatched,
      sidecarsCreated: sidecarManifest.created.length,
      sidecarsUpdated: sidecarManifest.updated.length,
      sidecarsSkipped: sidecarManifest.skipped.length,
      sidecarErrors: sidecarManifest.errors.length,
      byType: identifierSummaryByType(selectedTypes, resolved, unresolved),
    };
    const manifest = {
      runId,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      status: "executed",
      corpusId,
      corpusKey: metadata.corpusKey,
      corpusPath,
      executedAt: now,
      types: selectedTypes,
      useLlm,
      llmModel,
      llmReasoningEffort,
      importSummary,
      summary,
      resolved,
      unresolved,
      sidecars: sidecarManifest,
      reindex: reindexResult,
      onlyMissing,
      progressEvery,
      writeChunkSize,
      chunks: writeResult.chunks,
      catalogPath: catalogIndex.catalogPath,
    };
    writeJsonFile(manifestPath, manifest);
    await appendAssignmentPhaseEvent({
      client,
      assignment,
      eventType: "executed",
      actorLabel,
      note: `Resolved ${summary.resolved} identifiers and left ${summary.unresolved} unresolved.`,
      metadata: {
        kind: "reference.identifier-backfill.executed",
        runId,
        manifestPath,
        types: selectedTypes,
        importRuns: importSummary.importRuns,
        importedRecords: importSummary.importedRecords,
        resolved: summary.resolved,
        unresolved: summary.unresolved,
        sidecarsCreated: summary.sidecarsCreated,
        sidecarsUpdated: summary.sidecarsUpdated,
        sidecarErrors: summary.sidecarErrors,
        stdoutLogPaths: reindexResult?.stdoutLogPath ? [reindexResult.stdoutLogPath] : [],
        stderrLogPaths: reindexResult?.stderrLogPath ? [reindexResult.stderrLogPath] : [],
      },
    });
    return {
      assignmentId: assignment.id,
      runId,
      runDir,
      manifestPath,
      importSummary,
      summary,
      commandResults: [reindexResult].filter(Boolean),
    };
  } catch (error) {
    const failure = normalizeError(error);
    const artifacts = analysisFailureArtifactsFromError(error);
    const existingManifest = fs.existsSync(manifestPath) ? loadJsonFile(manifestPath) : {};
    const failureManifest = {
      ...existingManifest,
      runId,
      assignmentId: assignment.id,
      assignmentTypeKey: assignment.assignmentTypeKey,
      failedAt: new Date().toISOString(),
      status: "failed",
      corpusId,
      error: failure,
      stdoutLogPaths: artifacts.stdoutLogPaths,
      stderrLogPaths: artifacts.stderrLogPaths,
      nextSuggestedCommand: `npm run content -- references execute-identifier-backfill --assignment ${assignment.id} --resume ${manifestPath}`,
    };
    writeJsonFile(manifestPath, failureManifest);
    attachAnalysisFailureArtifacts(error, {
      runId,
      manifestPath,
      kind: failure.kind ?? "reference_identifier_backfill_failed",
      stdoutLogPaths: artifacts.stdoutLogPaths,
      stderrLogPaths: artifacts.stderrLogPaths,
    });
    throw error;
  }
}

function normalizeIdentifierAssignmentMetadata(metadata) {
  if (metadata?.kind === "reference.identifier-backfill.requested") return metadata;
  if (metadata?.kind === "reference.doi-backfill.requested") {
    return {
      ...metadata,
      kind: "reference.identifier-backfill.requested",
      types: ["doi"],
      onlyMissing: Boolean(metadata.onlyMissingDoi),
      writeChunkSize: metadata.writeChunkSize ?? 100,
    };
  }
  return metadata ?? {};
}

function currentIdentifierRelationsByTypeAndLineage(relations, types) {
  const result = new Map(types.map((type) => [type, new Map()]));
  const relationKeys = new Map(types.map((type) => [IDENTIFIER_TYPE_CONFIG[type].relationTypeKey, type]));
  for (const relation of relations) {
    if (relation.relationState !== "current") continue;
    const type = relationKeys.get(relation.relationTypeKey ?? relation.predicate);
    if (!type) continue;
    const byLineage = result.get(type);
    const entries = byLineage.get(relation.subjectLineageId) ?? [];
    entries.push(relation);
    byLineage.set(relation.subjectLineageId, entries);
  }
  return result;
}

function referenceMissingIdentifierType(reference, type, currentRelationsByTypeAndLineage) {
  const byLineage = currentRelationsByTypeAndLineage.get(type);
  if (byLineage?.has(reference.lineageId)) return false;
  const identifiers = identifiersFromObject(parseJsonish(reference.metadata));
  return !identifiers[type];
}

function referenceHasPrimaryIdentifier(reference, {
  referenceMetadata,
  catalogEntry,
  localSidecarPath,
  currentRelationsByTypeAndLineage,
}) {
  const metadataIdentifiers = identifiersFromObject(referenceMetadata);
  for (const type of ["doi", "arxiv_id", "isbn13"]) {
    if (!referenceMissingIdentifierType(reference, type, currentRelationsByTypeAndLineage)) return true;
    if (metadataIdentifiers[type]) return true;
    if (catalogEntry?.identifiers?.[type]) return true;
    if (sidecarIdentifier(localSidecarPath, type)) return true;
  }
  return false;
}

function identifierResolvedEntry(reference, resolution, local = {}) {
  return {
    referenceId: reference.id,
    referenceLineageId: reference.lineageId,
    externalItemId: reference.externalItemId ?? null,
    title: reference.title ?? null,
    type: resolution.type,
    value: resolution.value,
    doi: resolution.type === "doi" ? resolution.value : null,
    source: resolution.source,
    confidence: resolution.confidence,
    llmUsed: Boolean(resolution.llmUsed),
    rationale: resolution.rationale ?? null,
    version: resolution.version ?? null,
    sidecarPath: local.sidecarPath ?? null,
    sourceStoragePath: local.sourceStoragePath ?? null,
  };
}

function identifierUnresolvedEntry(reference, type, resolution, errors) {
  return {
    referenceId: reference.id,
    referenceLineageId: reference.lineageId,
    externalItemId: reference.externalItemId ?? null,
    title: reference.title ?? null,
    type,
    reason: resolution.rationale ?? "unresolved",
    errors,
    candidateCount: Array.isArray(resolution.candidates) ? resolution.candidates.length : 0,
  };
}

function appendIdentifierPlanningRecords({
  reference,
  referenceMetadata,
  type,
  resolution,
  currentIdentifierNodesByKey,
  currentRelationsByTypeAndLineage,
  plannedRecords,
  metadataPatchesByReferenceId,
  sidecarOperations,
  sidecarPath,
  sourceStoragePath,
  actorLabel,
  now,
  runId,
}) {
  const normalizedValue = normalizeIdentifier(type, resolution.value);
  if (!normalizedValue) return;
  const node = ensureIdentifierNode({ type, value: normalizedValue, currentByNodeKey: currentIdentifierNodesByKey, actorLabel, now });
  if (node.record) plannedRecords.push(node.record);
  const relation = referenceIdentifierSemanticRelationRecord({ reference, node: node.node, type, now, runId, resolution: { ...resolution, value: normalizedValue } });
  plannedRecords.push({ modelName: "SemanticRelation", expected: relation });
  const staleRelations = currentRelationsByTypeAndLineage.get(type)?.get(reference.lineageId) ?? [];
  for (const stale of staleRelations) {
    if (stale.id === relation.id) continue;
    plannedRecords.push({
      modelName: "SemanticRelation",
      expected: {
        id: stale.id,
        relationState: "superseded",
        updatedAt: now,
        metadata: JSON.stringify({
          ...parseJsonish(stale.metadata),
          kind: "reference.identifier-backfill.superseded",
          identifierType: type,
          supersededByRelationId: relation.id,
          runId,
        }),
      },
    });
  }
  currentRelationsByTypeAndLineage.get(type)?.set(reference.lineageId, [relation]);
  metadataPatchesByReferenceId.set(reference.id, identifierReferenceMetadataPatch({
    existingPatch: metadataPatchesByReferenceId.get(reference.id),
    reference,
    referenceMetadata,
    type,
    value: normalizedValue,
    resolution,
    runId,
    now,
  }));
  sidecarOperations.push({ reference, type, value: normalizedValue, sidecarPath, sourceStoragePath, resolution });
}

function ensureIdentifierNode({ type, value, currentByNodeKey, actorLabel, now }) {
  const config = IDENTIFIER_TYPE_CONFIG[type];
  const nodeKey = `${config.nodePrefix}:${value}`;
  const existing = currentByNodeKey.get(nodeKey);
  if (existing) return { node: existing, record: null };
  const lineageId = `semantic-node-identifier-${config.nodePrefix}-${safeId(value)}`;
  const id = `${lineageId}-v1`;
  const next = withVersionFields({
    id,
    lineageId,
    nodeKey,
    nodeKind: "identifier",
    corpusId: null,
    categorySetId: null,
    categoryLineageId: null,
    categoryKey: null,
    displayName: value,
    description: `${config.label} ${value}`,
    aliases: [],
    status: "active",
    importRunId: null,
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: "semanticNodes",
  }, {
    now,
    actor: actorLabel ?? "papyrus-content-cli",
    reason: "reference-identifier-backfill",
  });
  currentByNodeKey.set(nodeKey, next);
  return { node: next, record: { modelName: "SemanticNode", expected: next } };
}

function referenceIdentifierSemanticRelationRecord({ reference, node, type, now, runId, resolution }) {
  const predicate = IDENTIFIER_TYPE_CONFIG[type].relationTypeKey;
  const subjectStateKey = semanticStateKey("reference", reference.lineageId ?? reference.id);
  const objectStateKey = semanticStateKey("semanticNode", node.lineageId ?? node.id);
  const subjectVersionKey = semanticVersionKey("reference", reference.id);
  const objectVersionKey = semanticVersionKey("semanticNode", node.id);
  return {
    id: `semantic-relation-${hashShort([subjectStateKey, predicate, objectStateKey])}`,
    relationState: "current",
    predicate,
    ...semanticRelationTypeFieldsForPredicate(predicate),
    subjectKind: "reference",
    subjectId: reference.id,
    subjectLineageId: reference.lineageId ?? reference.id,
    subjectVersionNumber: reference.versionNumber ?? null,
    objectKind: "semanticNode",
    objectId: node.id,
    objectLineageId: node.lineageId ?? node.id,
    objectVersionNumber: node.versionNumber ?? null,
    subjectStateKey,
    objectStateKey,
    objectSubjectStateKey: `${objectStateKey}#reference`,
    predicateObjectStateKey: `${predicate}#${objectStateKey}`,
    subjectVersionKey,
    objectVersionKey,
    score: 1,
    confidence: resolution.confidence ?? null,
    rank: 1,
    classifierId: null,
    modelVersion: null,
    reviewRecommended: false,
    sourceSnapshotId: null,
    importRunId: null,
    importedAt: now,
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: "semanticRelations",
    metadata: JSON.stringify({
      kind: "reference.identifier-backfill.linked",
      runId,
      identifierType: type,
      source: resolution.source ?? null,
      confidence: resolution.confidence ?? null,
      llmUsed: Boolean(resolution.llmUsed),
    }),
  };
}

function identifierReferenceMetadataPatch({ existingPatch, reference, referenceMetadata, type, value, resolution, runId, now }) {
  const currentMetadata = existingPatch ? parseJsonish(existingPatch.expected.metadata) : referenceMetadata;
  const identifiers = {
    ...(currentMetadata.identifiers && typeof currentMetadata.identifiers === "object" ? currentMetadata.identifiers : {}),
    [IDENTIFIER_TYPE_CONFIG[type].metadataKey]: value,
  };
  const identifierResolution = {
    ...(currentMetadata.identifier_resolution && typeof currentMetadata.identifier_resolution === "object" ? currentMetadata.identifier_resolution : {}),
    [type]: pruneUndefined({
      run_id: runId,
      resolved_at: now,
      source: resolution.source,
      confidence: resolution.confidence,
      llm_used: Boolean(resolution.llmUsed),
      llm: resolution.llm ?? null,
      rationale: resolution.rationale ?? null,
      candidate_count: Array.isArray(resolution.candidates) ? resolution.candidates.length : 0,
      top_candidates: Array.isArray(resolution.candidates)
        ? resolution.candidates.slice(0, 5).map((candidate) => ({
            value: candidate.value,
            score: candidate.score,
            sources: candidate.sources ?? [candidate.source],
          }))
        : [],
      version: resolution.version ?? null,
    }),
  };
  const nextMetadata = {
    ...currentMetadata,
    identifiers,
    identifier_resolution: identifierResolution,
  };
  if (type === "doi") {
    nextMetadata.doi = value;
    nextMetadata.doi_resolution = identifierResolution[type];
  }
  return {
    modelName: "Reference",
    expected: {
      id: reference.id,
      metadata: JSON.stringify(nextMetadata),
      updatedAt: now,
    },
  };
}

async function applyIdentifierBackfillRecordChunks({ client, records, chunkSize, manifestPath, manifest, actorLabel, assignmentId }) {
  const chunks = [];
  const totals = {
    importedRecords: 0,
    semanticNodesCreated: 0,
    semanticRelationsCreated: 0,
    semanticRelationsSuperseded: 0,
    referenceMetadataPatched: 0,
  };
  for (let index = 0; index < records.length; index += chunkSize) {
    const chunkNumber = Math.floor(index / chunkSize) + 1;
    const chunkRecords = records.slice(index, index + chunkSize);
    console.log(`identifier-backfill\twrite-chunk\t${chunkNumber}\trecords=${chunkRecords.length}`);
    const changes = await buildRecordChangesTargetedById(client, chunkRecords);
    await applyRecordChanges(client, changes);
    await updateNewsroomSummaryAfterAnalysisImport(client, changes, {
      actorLabel,
      reason: `references identifier-backfill ${assignmentId} chunk ${chunkNumber}`,
    });
    const chunk = {
      chunk: chunkNumber,
      records: chunkRecords.length,
      importedRecords: changes.filter((change) => change.action !== "noop").length,
      semanticNodesCreated: changes.filter((change) => change.modelName === "SemanticNode" && change.action === "create").length,
      semanticRelationsCreated: changes.filter((change) => change.modelName === "SemanticRelation" && change.action === "create").length,
      semanticRelationsSuperseded: changes.filter((change) => change.modelName === "SemanticRelation" && change.action === "update" && change.expected?.relationState === "superseded").length,
      referenceMetadataPatched: changes.filter((change) => change.modelName === "Reference" && change.action === "update").length,
    };
    chunks.push(chunk);
    totals.importedRecords += chunk.importedRecords;
    totals.semanticNodesCreated += chunk.semanticNodesCreated;
    totals.semanticRelationsCreated += chunk.semanticRelationsCreated;
    totals.semanticRelationsSuperseded += chunk.semanticRelationsSuperseded;
    totals.referenceMetadataPatched += chunk.referenceMetadataPatched;
    writeJsonFile(manifestPath, {
      ...manifest,
      status: "writing",
      chunks,
      lastChunkCompletedAt: new Date().toISOString(),
    });
  }
  return { ...totals, chunks };
}

function applyIdentifierSidecarUpdates(operations, { runId, actorLabel }) {
  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];
  const now = new Date().toISOString();
  for (const operation of operations) {
    const { reference, type, value, sidecarPath, sourceStoragePath, resolution } = operation;
    if (!sidecarPath) {
      skipped.push({ referenceId: reference.id, type, sourceStoragePath, reason: "missing_local_source_path" });
      continue;
    }
    try {
      const existed = fs.existsSync(sidecarPath);
      const parsed = existed ? parseYamlSidecar(sidecarPath) : {};
      const currentValue = normalizeIdentifier(type, parsed.identifiers?.[IDENTIFIER_TYPE_CONFIG[type].metadataKey] ?? parsed[type] ?? parsed.metadata?.[type] ?? "");
      if (currentValue === value) {
        skipped.push({ referenceId: reference.id, type, sidecarPath, reason: "identifier_already_present" });
        continue;
      }
      parsed.identifiers = {
        ...(parsed.identifiers && typeof parsed.identifiers === "object" ? parsed.identifiers : {}),
        [IDENTIFIER_TYPE_CONFIG[type].metadataKey]: value,
      };
      if (type === "doi") parsed.doi = value;
      parsed.papyrus = {
        ...(parsed.papyrus && typeof parsed.papyrus === "object" ? parsed.papyrus : {}),
        identifier_backfill: {
          ...(parsed.papyrus?.identifier_backfill && typeof parsed.papyrus.identifier_backfill === "object" ? parsed.papyrus.identifier_backfill : {}),
          [type]: pruneUndefined({
            run_id: runId,
            resolved_at: now,
            source: resolution.source ?? null,
            confidence: resolution.confidence ?? null,
            llm_used: Boolean(resolution.llmUsed),
            updated_by: actorLabel ?? "papyrus-content-cli",
          }),
        },
      };
      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.writeFileSync(sidecarPath, YAML.stringify(pruneUndefined(parsed)), "utf8");
      (existed ? updated : created).push({ referenceId: reference.id, type, sidecarPath, value });
    } catch (error) {
      errors.push({ referenceId: reference.id, type, sidecarPath, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { created, updated, skipped, errors };
}

function identifierSummaryByType(types, resolved, unresolved) {
  const summary = {};
  for (const type of types) {
    summary[type] = {
      resolved: resolved.filter((entry) => entry.type === type).length,
      unresolved: unresolved.filter((entry) => entry.type === type).length,
    };
  }
  return summary;
}

function resolveLocalSourcePathForStoragePath(sourceStoragePath, corpusPath) {
  const storagePath = normalizeCliString(sourceStoragePath);
  if (!storagePath) return null;
  const normalized = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const basename = path.basename(path.resolve(corpusPath));
  const prefixed = `corpora/${basename}/`;
  if (normalized.startsWith(prefixed)) {
    return path.join(corpusPath, normalized.slice(prefixed.length));
  }
  if (normalized.startsWith(`${basename}/`)) {
    return path.join(corpusPath, normalized.slice(`${basename}/`.length));
  }
  return null;
}

function parseYamlSidecar(filepath) {
  try {
    const parsed = YAML.parse(fs.readFileSync(filepath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function runBiblicusReindexForDoiBackfill({ corpusPath, biblicusWorkdir, runDir }) {
  const stdoutLogPath = path.join(runDir, "biblicus-reindex-doi-backfill.stdout.log");
  const stderrLogPath = path.join(runDir, "biblicus-reindex-doi-backfill.stderr.log");
  const result = spawnSync("uv", ["run", "biblicus", "reindex", "--corpus", corpusPath], {
    cwd: biblicusWorkdir,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
  });
  fs.writeFileSync(stdoutLogPath, result.stdout ?? "", "utf8");
  fs.writeFileSync(stderrLogPath, result.stderr ?? "", "utf8");
  if (result.error || result.status !== 0) {
    throw createReferenceAccessionError(`Biblicus reindex failed after DOI sidecar updates for ${corpusPath}. See ${stderrLogPath}.`, {
      kind: "biblicus_reindex_failed",
      commandResult: {
        label: "biblicus-reindex-doi-backfill",
        stdoutLogPath,
        stderrLogPath,
        exitStatus: result.status,
        signal: result.signal ?? null,
      },
      stdoutLogPaths: [stdoutLogPath],
      stderrLogPaths: [stderrLogPath],
    });
  }
  return {
    label: "biblicus-reindex-doi-backfill",
    stdoutLogPath,
    stderrLogPath,
    exitStatus: result.status,
    signal: result.signal ?? null,
  };
}

async function processAssignmentQueue(flags) {
  const options = parseOptions(flags);
  const startedAt = Date.now();
  const asJson = Boolean(options.json);
  const { auth, client } = createAuthoringClient();
  const assignmentTypeKey = normalizeCliString(options.type);
  if (!assignmentTypeKey) throw new Error("assignments process-queue requires --type <assignment-type-key>.");
  const queueKey = normalizeCliString(options.queue);
  const sectionKey = normalizeCliString(options.section);
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

  const queryPlan = assignmentQueueQueryPlan({ assignmentTypeKey, queueKey, sectionKey, status: targetStatus });
  const fetched = await fetchAssignmentQueueCandidates(client, queryPlan);
  const candidates = fetched.records
    .filter((assignment) => assignment.assignmentTypeKey === assignmentTypeKey)
    .filter((assignment) => !queueKey || assignment.queueKey === queueKey)
    .filter((assignment) => !sectionKey || assignmentSectionKey(assignment) === sectionKey)
    .filter((assignment) => assignment.status === targetStatus)
    .sort(compareAssignmentQueueOrder);

  const selected = candidates.slice(0, maxCount);
  const diagnostics = {
    indexName: queryPlan.indexName,
    key: queryPlan.key,
    postFilter: queryPlan.postFilter ?? null,
    fetchedCount: fetched.records.length,
    candidateCount: candidates.length,
    selectedCount: selected.length,
    elapsedMs: null,
  };
  if (dryRun) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    if (asJson) {
      printCompactJson({
        ok: true,
        command: "assignments process-queue",
        mode: "dry-run",
        type: assignmentTypeKey,
        sectionKey,
        queueKey,
        status: targetStatus,
        maxCount,
        query: diagnostics,
        assignments: selected.map(compactAssignmentQueueRow),
      });
      return;
    }
    console.log(`assignment-process-queue\tdry-run\ttrue`);
    console.log(`assignment-process-queue\tindex\t${queryPlan.indexName}\t${queryPlan.key}`);
    console.log(`assignment-process-queue\ttype\t${assignmentTypeKey}`);
    console.log(`assignment-process-queue\tsection\t${sectionKey ?? ""}`);
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

  diagnostics.elapsedMs = Date.now() - startedAt;
  if (asJson) {
    printCompactJson({
      ok: summary.failed === 0,
      command: "assignments process-queue",
      mode: "apply",
      type: assignmentTypeKey,
      sectionKey,
      queueKey,
      status: targetStatus,
      maxCount,
      query: diagnostics,
      summary,
      results,
    });
    return;
  }
  console.log(`assignment-process-queue\ttype\t${assignmentTypeKey}`);
  console.log(`assignment-process-queue\tindex\t${queryPlan.indexName}\t${queryPlan.key}`);
  console.log(`assignment-process-queue\tsection\t${sectionKey ?? ""}`);
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

function assignmentQueueQueryPlan({ assignmentTypeKey, queueKey, sectionKey, status }) {
  if (queueKey) {
    return {
      indexName: "listAssignmentsByQueueStatusAndPriority",
      key: `${queueKey}#${status}`,
      execute: (client) => client.listAssignmentsByQueueStatusAndPriority(`${queueKey}#${status}`),
    };
  }
  if (sectionKey) {
    return {
      indexName: "listAssignmentsByTypeStatusAndCreatedAt",
      key: assignmentTypeKey,
      execute: (client) => client.listAssignmentsByTypeStatusAndCreatedAt(assignmentTypeKey),
      postFilter: "status,sectionKey",
    };
  }
  return {
    indexName: "listAssignmentsByTypeStatusAndCreatedAt",
    key: assignmentTypeKey,
    execute: (client) => client.listAssignmentsByTypeStatusAndCreatedAt(assignmentTypeKey),
    postFilter: "status",
  };
}

async function fetchAssignmentQueueCandidates(client, queryPlan) {
  const records = await queryPlan.execute(client);
  return { records };
}

function compactAssignmentQueueRow(assignment) {
  return {
    id: assignment.id,
    status: assignment.status,
    type: assignment.assignmentTypeKey,
    queueKey: assignment.queueKey,
    sectionKey: assignmentSectionKey(assignment),
    priority: assignment.priority ?? null,
    createdAt: assignment.createdAt ?? null,
    title: assignment.title ?? null,
  };
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
    modelAttachments,
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
    client.listRecords("ModelAttachment"),
    client.listRecords("SemanticRelation"),
    client.listRecords("Assignment"),
    client.listRecords("AssignmentEvent"),
  ]);
  const summaryAttachmentId = modelAttachmentId("knowledgeRawPayload", NEWSROOM_SUMMARY_PAYLOAD_ID, "raw_payload", "summary-snapshot");
  const modelAttachmentsForRecount = modelAttachments.some((attachment) => attachment.id === summaryAttachmentId)
    ? modelAttachments
    : [
        ...modelAttachments,
        {
          id: summaryAttachmentId,
          ownerKind: "knowledgeRawPayload",
          ownerId: NEWSROOM_SUMMARY_PAYLOAD_ID,
          role: "raw_payload",
          sortKey: "summary-snapshot",
          mediaType: "application/json",
          status: "active",
        },
      ];
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
    modelAttachments: modelAttachmentsForRecount,
    semanticRelations,
    assignments,
    assignmentEvents,
    now,
    source: "recount",
  });
  const expected = buildNewsroomSummaryPayloadRecord(payload, now);
  const summaryAttachment = buildJsonModelPayloadAttachment({
    ownerKind: "knowledgeRawPayload",
    ownerId: expected.id,
    role: "raw_payload",
    sortKey: "summary-snapshot",
    filename: "summary-snapshot.json",
    content: payload,
    importRunId: expected.importRunId,
    now,
  });
  const current = await client.getRecord("KnowledgeRawPayload", NEWSROOM_SUMMARY_PAYLOAD_ID);
  const currentPayload = await readJsonModelPayload(client, "knowledgeRawPayload", NEWSROOM_SUMMARY_PAYLOAD_ID, "raw_payload", "summary-snapshot");
  if (current?.createdAt) expected.createdAt = current.createdAt;
  const change = buildRecordChangeFromCurrent("KnowledgeRawPayload", expected, current);
  const summaryDiff = newsroomSummaryDiff(currentPayload, payload);
  if (!options.json) printNewsroomSummaryRecount(currentPayload, payload, change);
  if (options.output) writeJsonFile(options.output, { current, currentPayload, expected, attachment: summaryAttachment.attachment, action: change.action, payload });
  if (!options.apply) {
    if (options.json) {
      printCompactJson({
        ok: true,
        command: "newsroom recount-summary",
        action: "dry-run",
        countsChanged: summaryDiff.countsChanged,
        facetSectionsChanged: summaryDiff.facetSectionsChanged,
        attachmentUpdated: false,
      });
    } else {
      console.log("newsroom\trecount-summary\tapply\tskipped\tpass --apply to write KnowledgeRawPayload snapshot");
    }
    return;
  }
  await client.upsert("KnowledgeRawPayload", expected);
  await uploadAttachmentBody(summaryAttachment.attachment, summaryAttachment.body, { client });
  await client.upsert("ModelAttachment", summaryAttachment.attachment);
  if (options.json) {
    printCompactJson({
      ok: true,
      command: "newsroom recount-summary",
      action: change.action,
      countsChanged: summaryDiff.countsChanged,
      facetSectionsChanged: summaryDiff.facetSectionsChanged,
      attachmentUpdated: true,
    });
  } else {
    console.log(`newsroom\trecount-summary\t${change.action}\t${expected.id}`);
  }
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

function printNewsroomSummaryRecount(currentPayloadValue, expectedPayloadValue, change) {
  const currentPayload = normalizeNewsroomSummaryPayload(currentPayloadValue);
  const expectedPayload = normalizeNewsroomSummaryPayload(expectedPayloadValue);
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

function selectedCorpusConfigs(steeringConfig, corpusKey) {
  if (corpusKey) return [requireCorpusConfig(steeringConfig, corpusKey, "--corpus-key")];
  return steeringConfig.corpora ?? [];
}

async function loadCorpusGraphState(client) {
  const [
    corpora,
    references,
    referenceAttachments,
    importRuns,
  ] = await Promise.all([
    client.listRecords("KnowledgeCorpus"),
    client.listRecords("Reference"),
    client.listRecords("ReferenceAttachment"),
    client.listRecords("KnowledgeImportRun"),
  ]);
  return { corpora, references, referenceAttachments, importRuns };
}

function buildCorpusStatus(corpus, { graphState, endpoint, force = false }) {
  const corpusId = knowledgeCorpusId(corpus);
  const s3Prefix = parseS3Uri(corpus.s3Prefix);
  const localCatalog = readLocalCorpusCatalogSummary(corpus);
  const s3Catalog = readS3CorpusCatalogSummary(corpus);
  const graph = graphCorpusSummary(corpus, corpusId, graphState);
  const expectedBucket = storageBucketFromAmplifyOutputsLocal();
  const target = {
    endpoint,
    expectedBucket,
    configuredBucket: s3Prefix?.bucket ?? null,
    ok: Boolean(force || !expectedBucket || !s3Prefix?.bucket || expectedBucket === s3Prefix.bucket),
  };
  const issues = [];
  if (!target.ok) issues.push("wrong_bucket_for_endpoint");
  if (!localCatalog.exists) issues.push("missing_local_catalog");
  if (!s3Catalog.exists) issues.push("missing_s3_catalog");
  if (localCatalog.exists && s3Catalog.exists && localCatalog.sha256 !== s3Catalog.sha256) issues.push("local_not_synced_to_s3");
  if (s3Catalog.exists && graph.references.total !== s3Catalog.items) issues.push("s3_not_registered_in_graphql");
  if (graph.references.accepted === 0) issues.push("accepted_manifest_not_ready");
  if (graph.references.accepted > 0 && graph.acceptedWithExtractedText < graph.references.accepted) issues.push("missing_extracted_text");
  return {
    key: corpus.key,
    corpusId,
    role: corpus.role,
    localPath: corpus.path ?? null,
    s3Prefix: corpus.s3Prefix ?? null,
    target,
    local: localCatalog,
    s3: s3Catalog,
    graph,
    issues,
    readiness: {
      readyForWorker: issues.length === 0,
      readyForGraphqlRegistration: target.ok && localCatalog.exists && s3Catalog.exists && localCatalog.sha256 === s3Catalog.sha256,
      readyForAcceptedAnalysis: graph.references.accepted > 0 && graph.acceptedWithExtractedText === graph.references.accepted,
    },
  };
}

function graphCorpusSummary(corpus, corpusId, graphState) {
  const corpusRecord = graphState.corpora.find((entry) => entry.id === corpusId) ?? null;
  const references = graphState.references.filter((reference) => reference.corpusId === corpusId);
  const importRuns = graphState.importRuns.filter((run) => run.corpusId === corpusId);
  const currentReferences = references.filter((reference) => reference.versionState === "current");
  const referenceIds = new Set(currentReferences.map((reference) => reference.id));
  const referenceLineageIds = new Set(currentReferences.map((reference) => reference.lineageId).filter(Boolean));
  const attachments = graphState.referenceAttachments.filter((attachment) => (
    referenceIds.has(attachment.referenceId)
    || referenceLineageIds.has(attachment.referenceLineageId)
  ));
  const accepted = currentReferences.filter(isCurrentAcceptedReference);
  const acceptedWithExtractedText = accepted.filter((reference) => textStoragePathForReference(reference, attachments)).length;
  const byStatus = {};
  for (const reference of currentReferences) {
    const status = normalizeReferenceCurationStatus(reference.curationStatus, "pending");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return {
    corpusExists: Boolean(corpusRecord),
    itemCount: corpusRecord?.itemCount ?? null,
    importRuns: importRuns.length,
    latestImportRunId: [...importRuns].sort((left, right) => String(right.importedAt ?? "").localeCompare(String(left.importedAt ?? "")))[0]?.id ?? null,
    references: {
      total: currentReferences.length,
      byStatus,
      accepted: accepted.length,
    },
    referenceAttachments: attachments.length,
    acceptedWithExtractedText,
  };
}

function readLocalCorpusCatalogSummary(corpus) {
  const catalogPath = path.join(corpus.path ?? `corpora/${corpus.key}`, "metadata", "catalog.json");
  if (!fs.existsSync(catalogPath)) {
    return { exists: false, path: catalogPath, items: 0, bytes: 0, sha256: null, updatedAt: null };
  }
  const body = fs.readFileSync(catalogPath);
  const parsed = JSON.parse(body.toString("utf8"));
  return {
    exists: true,
    path: catalogPath,
    items: catalogItemsForSummary(parsed).length,
    bytes: body.length,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
    updatedAt: fs.statSync(catalogPath).mtime.toISOString(),
  };
}

function readS3CorpusCatalogSummary(corpus) {
  const parsedPrefix = parseS3Uri(corpus.s3Prefix);
  if (!parsedPrefix) return { exists: false, uri: null, items: 0, bytes: 0, sha256: null, updatedAt: null };
  const key = `${parsedPrefix.key.replace(/\/+$/g, "")}/metadata/catalog.json`.replace(/^\/+/, "");
  const uri = `s3://${parsedPrefix.bucket}/${key}`;
  const result = spawnSync("aws", ["s3", "cp", uri, "-"], {
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return { exists: false, uri, items: 0, bytes: 0, sha256: null, updatedAt: null, error: String(result.stderr || result.stdout || "").trim() || "s3_catalog_unavailable" };
  }
  const body = result.stdout;
  const parsed = JSON.parse(body.toString("utf8"));
  return {
    exists: true,
    uri,
    items: catalogItemsForSummary(parsed).length,
    bytes: body.length,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
    updatedAt: s3ObjectLastModified(parsedPrefix.bucket, key),
  };
}

function s3ObjectLastModified(bucket, key) {
  const result = spawnSync("aws", ["s3api", "head-object", "--bucket", bucket, "--key", key, "--query", "LastModified", "--output", "text"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function buildCorpusSyncPlan(corpus, { direction, options }) {
  const parsedPrefix = parseS3Uri(corpus.s3Prefix);
  if (!parsedPrefix) throw new Error(`Corpus ${corpus.key} does not define a valid s3Prefix.`);
  const localPath = corpus.path ?? `corpora/${corpus.key}`;
  const s3Uri = normalizedS3Uri(corpus.s3Prefix);
  const expectedBucket = storageBucketFromAmplifyOutputsLocal();
  if (!options.force && expectedBucket && parsedPrefix.bucket !== expectedBucket) {
    throw new Error(`Refusing ${direction}: corpus ${corpus.key} points at bucket ${parsedPrefix.bucket}, but amplify_outputs.json expects ${expectedBucket}. Generate a sandbox steering config or pass --force.`);
  }
  const args = ["s3", "sync"];
  if (direction === "from-cloud") {
    args.push(s3Uri, localPath);
  } else {
    args.push(localPath, s3Uri);
  }
  args.push("--exclude", ".DS_Store", "--exclude", "*/.DS_Store");
  if (!options["include-analysis"]) args.push("--exclude", "analysis/*", "--exclude", "*/analysis/*");
  if (options.delete) args.push("--delete");
  if (options["dry-run"] !== false && options.apply !== true) args.push("--dryrun");
  return {
    command: `corpora ${direction === "from-cloud" ? "sync-from-cloud" : "sync-to-cloud"}`,
    corpusKey: corpus.key,
    localPath,
    s3Uri,
    expectedBucket,
    configuredBucket: parsedPrefix.bucket,
    mode: args.includes("--dryrun") ? "dry-run" : "apply",
    args,
  };
}

function runOrPrintCorpusSyncPlan(plan, options) {
  if (options.json) {
    if (plan.mode === "apply") {
      const result = spawnSync("aws", plan.args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1024 * 1024 * 256,
      });
      printCompactJson({
        ok: result.status === 0,
        command: plan.command,
        corpusKey: plan.corpusKey,
        mode: plan.mode,
        localPath: plan.localPath,
        s3Uri: plan.s3Uri,
        status: result.status,
        stdoutLines: lineCount(result.stdout),
        stderrLines: lineCount(result.stderr),
      });
      if (result.status !== 0) process.exitCode = result.status ?? 1;
      return;
    }
    printCompactJson({
      ok: true,
      command: plan.command,
      corpusKey: plan.corpusKey,
      mode: plan.mode,
      localPath: plan.localPath,
      s3Uri: plan.s3Uri,
      args: ["aws", ...plan.args],
    });
    return;
  }
  console.log(`corpora\t${plan.command.split(" ")[1]}\tcorpus\t${plan.corpusKey}`);
  console.log(`corpora\t${plan.command.split(" ")[1]}\tmode\t${plan.mode}`);
  console.log(`corpora\t${plan.command.split(" ")[1]}\tlocal\t${plan.localPath}`);
  console.log(`corpora\t${plan.command.split(" ")[1]}\ts3\t${plan.s3Uri}`);
  console.log(`corpora\t${plan.command.split(" ")[1]}\tcommand\taws ${plan.args.map(shellQuote).join(" ")}`);
  const result = spawnSync("aws", plan.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 256,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`aws ${plan.args.join(" ")} failed with status ${result.status}.`);
}

function lineCount(value) {
  const text = String(value ?? "").trim();
  return text ? text.split(/\r?\n/).length : 0;
}

function printCorpusStatus(payload) {
  console.log(`corpora\tstatus\tendpoint\t${payload.endpoint}`);
  console.log(`corpora\tstatus\texpected-bucket\t${payload.expectedBucket ?? "-"}`);
  for (const status of payload.corpora) {
    console.log(`corpus\t${status.key}\t${status.corpusId}\trole=${status.role}\tready=${status.readiness.readyForWorker ? "yes" : "no"}`);
    console.log(`corpus\t${status.key}\tlocal\titems=${status.local.items}\tsha256=${status.local.sha256 ?? "-"}\tpath=${status.local.path}`);
    console.log(`corpus\t${status.key}\ts3\titems=${status.s3.items}\tsha256=${status.s3.sha256 ?? "-"}\turi=${status.s3.uri ?? "-"}`);
    console.log(`corpus\t${status.key}\tgraphql\treferences=${status.graph.references.total}\taccepted=${status.graph.references.accepted}\tattachments=${status.graph.referenceAttachments}\timports=${status.graph.importRuns}`);
    if (status.issues.length) console.log(`corpus\t${status.key}\tissues\t${status.issues.join(",")}`);
  }
}

function printCorpusWorkerBootstrap(payload) {
  console.log(`corpora\tworker-bootstrap\tendpoint\t${payload.endpoint}`);
  console.log(`corpora\tworker-bootstrap\texpected-bucket\t${payload.expectedBucket ?? "-"}`);
  for (const status of payload.corpora) {
    console.log(`corpus\t${status.key}\ttarget\t${status.target.ok ? "ok" : "mismatch"}\tconfigured=${status.target.configuredBucket ?? "-"}\texpected=${status.target.expectedBucket ?? "-"}`);
    console.log(`corpus\t${status.key}\tlocal\t${status.local.exists ? "present" : "missing"}\t${status.local.path}`);
    console.log(`corpus\t${status.key}\ts3\t${status.s3.exists ? "present" : "missing"}\t${status.s3.uri ?? "-"}`);
    console.log(`corpus\t${status.key}\tgraphql\treferences=${status.graph.references.total}\taccepted=${status.graph.references.accepted}`);
    if (status.issues.length) console.log(`corpus\t${status.key}\tissues\t${status.issues.join(",")}`);
    console.log(`corpus\t${status.key}\tnext\t${status.next}`);
  }
}

function nextCorpusBootstrapCommand(status) {
  if (!status.target.ok) return "generate a sandbox steering config or pass the correct --config for this endpoint";
  if (!status.local.exists || status.local.sha256 !== status.s3.sha256) {
    return `npm run content -- corpora sync-from-cloud --config <steering.yml> --corpus-key ${status.key} --dry-run`;
  }
  if (status.graph.references.total !== status.s3.items) {
    return `npm run content -- references prepare-catalog --config <steering.yml> --corpus-key ${status.key} --catalog ${status.local.path} --output .papyrus-runs/<run>/${status.key}-prepared-catalog.json`;
  }
  if (!status.readiness.readyForAcceptedAnalysis) {
    return `npm run content -- references source-status --config <steering.yml> --corpus-key ${status.key} --status accepted`;
  }
  return `npm run content -- analysis create-reindex-assignment --config <steering.yml> --corpus-key ${status.key} --profile <profile> --apply`;
}

function parseS3Uri(value) {
  const raw = normalizeCliString(value);
  if (!raw?.startsWith("s3://")) return null;
  const withoutScheme = raw.slice("s3://".length);
  const slash = withoutScheme.indexOf("/");
  const bucket = slash >= 0 ? withoutScheme.slice(0, slash) : withoutScheme;
  const key = slash >= 0 ? withoutScheme.slice(slash + 1) : "";
  if (!bucket) return null;
  return { bucket, key };
}

function normalizedS3Uri(value) {
  const parsed = parseS3Uri(value);
  if (!parsed) throw new Error(`Invalid S3 URI: ${value}`);
  return `s3://${parsed.bucket}/${parsed.key.replace(/\/+$/g, "")}/`;
}

function storageBucketFromAmplifyOutputsLocal(filepath = "amplify_outputs.json") {
  const fullPath = path.resolve(filepath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    return parsed.storage?.bucket_name ?? parsed.storage?.bucketName ?? null;
  } catch {
    return null;
  }
}

function shellQuote(value) {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(raw)) return raw;
  return `'${raw.replace(/'/g, "'\\''")}'`;
}

function newsroomSummaryDiff(currentPayloadValue, expectedPayloadValue) {
  const currentPayload = normalizeNewsroomSummaryPayload(currentPayloadValue);
  const expectedPayload = normalizeNewsroomSummaryPayload(expectedPayloadValue);
  const countKeys = new Set([
    ...Object.keys(currentPayload.counts ?? {}),
    ...Object.keys(expectedPayload.counts ?? {}),
  ]);
  let countsChanged = 0;
  for (const key of countKeys) {
    if ((currentPayload.counts?.[key] ?? 0) !== (expectedPayload.counts?.[key] ?? 0)) countsChanged += 1;
  }
  const facetKeys = new Set([
    ...Object.keys(currentPayload.facets ?? {}),
    ...Object.keys(expectedPayload.facets ?? {}),
  ]);
  let facetSectionsChanged = 0;
  for (const key of facetKeys) {
    if (stableJson(currentPayload.facets?.[key] ?? {}) !== stableJson(expectedPayload.facets?.[key] ?? {})) {
      facetSectionsChanged += 1;
    }
  }
  return { countsChanged, facetSectionsChanged };
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

function resolveNewsroomSectionTarget(newsroomSections, sectionKey) {
  const normalized = normalizeCliString(sectionKey);
  if (!normalized) return null;
  const section = newsroomSections.find((entry) => (
    entry.id === normalized
    || entry.sectionKey === normalized
    || safeId(entry.title) === normalized
  ));
  if (!section) throw new Error(`Unknown NewsroomSection '${normalized}'.`);
  if (section.enabled === false || section.enabledStatus === "disabled") throw new Error(`NewsroomSection '${normalized}' is disabled.`);
  return {
    id: section.id,
    title: section.title,
    type: section.type === "rotating" ? "floating" : section.type,
    editorialMission: section.editorialMission ?? null,
    editorialPolicy: section.editorialPolicy ?? null,
    assignmentGuidance: section.assignmentGuidance ?? null,
    killCriteria: section.killCriteria ?? null,
    visualGuidance: section.visualGuidance ?? null,
  };
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
  const graphExports = [];

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

    if (command.label === "graph-extract") {
      const graphImport = await importGraphCommandOutput({
        client,
        assignment,
        metadata,
        corpusConfig,
        classifierId,
        command,
        runDir,
      });
      importRuns.push(graphImport.importRunId);
      importedRecords += graphImport.importedRecords;
      graphExports.push(graphImport);
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
      const steeringRecords = command.label === "taxonomy-discover"
        ? await scopedTopicDiscoveryImportRecords(client, steeringPlan.records, {
          metadata,
          corpusId: knowledgeCorpusId(corpusConfig),
          classifierId,
        })
        : steeringPlan.records;
      const changes = await buildRecordChangesToleratingOptionalModels(client, steeringRecords);
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
    graphExports,
  };
}

async function listGraphArtifacts(flags) {
  const options = parseOptions(flags);
  const startedAt = Date.now();
  const asJson = Boolean(options.json);
  const { client } = createAuthoringClient();
  const corpusId = graphArtifactCorpusIdFromOptions(options);
  const { rows: unsortedRows, diagnostics } = await fetchGraphArtifactRowsIndexed(client, { corpusId });
  const rows = unsortedRows
    .sort((left, right) => String(right.importedAt ?? "").localeCompare(String(left.importedAt ?? "")) || String(left.importRunId).localeCompare(String(right.importRunId)));
  diagnostics.elapsedMs = Date.now() - startedAt;

  if (asJson) {
    console.log(JSON.stringify({
      ok: true,
      command: "analysis graph-artifacts",
      corpusId,
      query: diagnostics,
      count: rows.length,
      artifacts: rows.map(compactGraphArtifactRow),
    }));
    return;
  }

  console.log(`graph-artifacts\tcount\t${rows.length}`);
  for (const row of rows) {
    console.log([
      "graph-artifact",
      row.importRunId,
      row.corpusId,
      row.artifactId ?? row.sourceSnapshotId ?? "-",
      row.importedAt ?? "-",
      row.attachment?.storagePath ?? "-",
      row.attachment?.byteSize ?? "-",
    ].join("\t"));
  }
}

async function fetchGraphArtifactRowsIndexed(client, { corpusId = null } = {}) {
  const importRunKey = corpusId ? `${corpusId}#graph-export` : "graph-export";
  const importRuns = corpusId
    ? await client.listKnowledgeImportRunsByCorpusKindAndImportedAt(importRunKey)
    : await client.listKnowledgeImportRunsByKindAndImportedAt("graph-export");
  const artifactLists = await Promise.all(importRuns.map((run) => client.listKnowledgeArtifactsByImportRunAndKind(run.id)));
  const rows = [];
  let artifactCount = 0;
  let payloadFetched = 0;
  let attachmentFetched = 0;
  for (let index = 0; index < importRuns.length; index += 1) {
    const run = importRuns[index];
    const artifacts = (artifactLists[index] ?? []).filter((artifact) => artifact.artifactKind === "graph-export" || artifact.artifactKind === "graph-snapshot");
    artifactCount += artifacts.length;
    const artifact = artifacts[0] ?? null;
    const rawPayloadId = graphExportSummaryPayloadId(run.id);
    const [rawPayload, rawPayloadAttachment, graphExportAttachment] = await Promise.all([
      client.getRecord("KnowledgeRawPayload", rawPayloadId),
      client.getRecord("ModelAttachment", modelAttachmentId("knowledgeRawPayload", rawPayloadId, "raw_payload", "graph-export-summary")),
      client.getRecord("ModelAttachment", modelAttachmentId("knowledgeRawPayload", rawPayloadId, "graph_export", "graph-export")),
    ]);
    payloadFetched += rawPayload ? 1 : 0;
    attachmentFetched += (rawPayloadAttachment ? 1 : 0) + (graphExportAttachment ? 1 : 0);
    rows.push({
      importRunId: run.id,
      corpusId: run.corpusId,
      classifierId: run.classifierId ?? null,
      sourceSnapshotId: run.sourceSnapshotId ?? null,
      importedAt: run.importedAt ?? null,
      status: run.status ?? null,
      artifact,
      artifactId: artifact?.artifactId ?? null,
      rawPayload,
      rawPayloadAttachment,
      attachment: graphExportAttachment,
    });
  }
  return {
    rows,
    diagnostics: {
      importRunIndex: corpusId ? "listKnowledgeImportRunsByCorpusKindAndImportedAt" : "listKnowledgeImportRunsByKindAndImportedAt",
      importRunKey,
      artifactIndex: "listKnowledgeArtifactsByImportRunAndKind",
      importRunsFetched: importRuns.length,
      artifactsFetched: artifactCount,
      payloadsFetched: payloadFetched,
      attachmentsFetched: attachmentFetched,
      elapsedMs: null,
    },
  };
}

function graphArtifactCorpusIdFromOptions(options) {
  if (!options["corpus-key"]) return null;
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const corpusConfig = requireCorpusConfig(steeringConfig, options["corpus-key"], "--corpus-key");
  return knowledgeCorpusId(corpusConfig);
}

function graphArtifactRows({ importRuns, artifacts, payloads, attachments }) {
  const artifactByImportRun = new Map((artifacts ?? [])
    .filter((artifact) => artifact.artifactKind === "graph-export" || artifact.artifactKind === "graph-snapshot")
    .map((artifact) => [artifact.importRunId, artifact]));
  const payloadById = new Map((payloads ?? []).map((payload) => [payload.id, payload]));
  const attachmentByOwnerRole = new Map((attachments ?? []).map((attachment) => [
    `${attachment.ownerKind}\n${attachment.ownerId}\n${attachment.role}\n${attachment.sortKey}`,
    attachment,
  ]));
  return (importRuns ?? [])
    .filter((run) => run.importKind === "graph-export" || artifactByImportRun.has(run.id))
    .map((run) => {
      const rawPayloadId = graphExportSummaryPayloadId(run.id);
      const graphExportAttachment = attachmentByOwnerRole.get(`knowledgeRawPayload\n${rawPayloadId}\ngraph_export\ngraph-export`) ?? null;
      const rawPayloadAttachment = attachmentByOwnerRole.get(`knowledgeRawPayload\n${rawPayloadId}\nraw_payload\ngraph-export-summary`) ?? null;
      return {
        importRunId: run.id,
        corpusId: run.corpusId,
        classifierId: run.classifierId ?? null,
        sourceSnapshotId: run.sourceSnapshotId ?? null,
        importedAt: run.importedAt ?? null,
        status: run.status ?? null,
        artifact: artifactByImportRun.get(run.id) ?? null,
        artifactId: artifactByImportRun.get(run.id)?.artifactId ?? null,
        rawPayload: payloadById.get(rawPayloadId) ?? null,
        rawPayloadAttachment,
        attachment: graphExportAttachment,
      };
    });
}

function compactGraphArtifactRow(row) {
  return {
    importRunId: row.importRunId,
    corpusId: row.corpusId,
    classifierId: row.classifierId,
    artifactId: row.artifactId,
    sourceSnapshotId: row.sourceSnapshotId,
    importedAt: row.importedAt,
    status: row.status,
    attachmentId: row.attachment?.id ?? null,
    storagePath: row.attachment?.storagePath ?? null,
    mediaType: row.attachment?.mediaType ?? null,
    byteSize: row.attachment?.byteSize ?? null,
    sha256: row.attachment?.sha256 ?? null,
  };
}

async function importGraphArtifact(flags) {
  const options = parseOptions(flags);
  const importRunId = normalizeCliString(options["import-run"]);
  if (!importRunId) throw new Error("analysis import-graph-artifact requires --import-run <id>.");
  const apply = Boolean(options.apply);
  const asJson = Boolean(options.json);
  const { client } = createAuthoringClient();
  const importRun = await client.getRecord("KnowledgeImportRun", importRunId);
  if (!importRun) throw new Error(`KnowledgeImportRun ${importRunId} was not found.`);
  if (importRun.importKind !== "graph-export") throw new Error(`KnowledgeImportRun ${importRunId} is ${importRun.importKind}; expected graph-export.`);

  const rawPayloadId = graphExportSummaryPayloadId(importRunId);
  const attachment = await client.getRecord("ModelAttachment", modelAttachmentId("knowledgeRawPayload", rawPayloadId, "graph_export", "graph-export"));
  if (!attachment) throw new Error(`Graph export attachment was not found for import run ${importRunId}.`);
  const graphExportArtifact = await loadGraphExportPayloadFromAttachment(attachment, client);
  const payload = graphExportArtifact.payload;
  const importedAt = importRun.importedAt ?? importRun.generatedAt ?? new Date().toISOString();
  const referenceByExternalItemId = await hydrateGraphReferenceMap(client, importRun.corpusId);
  const plan = buildGraphExportImportRecords(payload, {
    corpusId: importRun.corpusId,
    classifierId: importRun.classifierId,
    importedAt,
    referenceByExternalItemId,
  });
  if (plan.importRunId !== importRun.id) {
    throw new Error(`Graph export artifact resolves to import run ${plan.importRunId}, not requested import run ${importRun.id}.`);
  }
  setGraphExportSummaryPayload(plan, {
    attachmentId: attachment.id,
    storagePath: attachment.storagePath,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    byteSize: attachment.byteSize,
    sourceByteSize: graphExportArtifact.sourceByteSize,
    sha256: attachment.sha256,
    compressed: attachment.mediaType === "application/gzip" || String(attachment.filename ?? "").endsWith(".gz"),
  });
  if (plan.mentionEdgeCount > 0 && plan.mentionRelationCount === 0) {
    throw new Error(`Graph import could not resolve any accepted References for ${plan.mentionEdgeCount} reference-to-entity edge(s).`);
  }

  const now = new Date().toISOString();
  const supersessionChanges = shouldSupersedeGeneratedGraph(plan)
    ? await buildGeneratedGraphSupersessionChanges(client, {
      corpusId: importRun.corpusId,
      extractorId: plan.extractorId,
      importRunId: plan.importRunId,
      now,
    })
    : [];
  const importChanges = await buildRecordChangesTargetedByIdToleratingOptionalModels(client, plan.records);
  const changes = [...supersessionChanges, ...importChanges];
  const changedRecords = changes.filter((record) => record.action !== "noop").length;
  const queryDiagnostics = {
    graphAttachment: "getModelAttachment",
    recordPlanning: "targeted getRecord by planned id",
    plannedRecordLookups: plan.records.length,
    supersession: supersessionChanges.queryDiagnostics ?? null,
  };

  if (!apply) {
    const result = {
      ok: true,
      command: "analysis import-graph-artifact",
      mode: "dry-run",
      importRunId,
      snapshot: plan.snapshotRef,
      storagePath: attachment.storagePath,
      plannedRecords: plan.records.length,
      changedRecords,
      query: queryDiagnostics,
      next: `npm run content -- analysis import-graph-artifact --import-run ${importRunId} --apply`,
    };
    if (asJson) console.log(JSON.stringify(result));
    else {
      console.log(`graph-artifact-import\tmode\tdry-run`);
      console.log(`graph-artifact-import\timport-run\t${importRunId}`);
      console.log(`graph-artifact-import\tsnapshot\t${plan.snapshotRef}`);
      console.log(`graph-artifact-import\tchanged-records\t${changedRecords}`);
      console.log(`graph-artifact-import\tnext\t${result.next}`);
    }
    return;
  }

  await applyRecordChanges(client, changes);
  await updateNewsroomSummaryAfterAnalysisImport(client, changes, {
    actorLabel: "papyrus-content-cli",
    reason: `analysis reimport graph artifact ${plan.importRunId}`,
  });
  const result = {
    ok: true,
    command: "analysis import-graph-artifact",
    mode: "apply",
    importRunId,
    snapshot: plan.snapshotRef,
    storagePath: attachment.storagePath,
    changedRecords,
    semanticNodes: plan.semanticNodeCount,
    semanticRelations: plan.semanticRelationCount,
    query: queryDiagnostics,
  };
  if (asJson) console.log(JSON.stringify(result));
  else {
    printCategoryImportSummary("graph-artifact", plan.importRunId, changes);
    console.log(`graph-artifact-import\timport-run\t${importRunId}`);
    console.log(`graph-artifact-import\tsnapshot\t${plan.snapshotRef}`);
    console.log(`graph-artifact-import\tchanged-records\t${changedRecords}`);
  }
}

async function loadGraphExportPayloadFromAttachment(attachment, client) {
  const buffer = await downloadAttachmentBuffer(attachment, { client });
  if (!buffer) throw new Error(`Graph export attachment ${attachment.id} is empty.`);
  const payloadBuffer = attachment.mediaType === "application/gzip" || String(attachment.filename ?? "").endsWith(".gz")
    ? zlib.gunzipSync(buffer)
    : buffer;
  return {
    payload: JSON.parse(payloadBuffer.toString("utf8")),
    sourceByteSize: payloadBuffer.length,
  };
}

async function importGraphCommandOutput({
  client,
  assignment,
  metadata,
  corpusConfig,
  classifierId,
  command,
  runDir,
}) {
  const graphExport = runGraphExportForCommand({
    command,
    metadata,
    corpusConfig,
    runDir,
  });
  const corpusId = knowledgeCorpusId(corpusConfig);
  const now = new Date().toISOString();
  const referenceByExternalItemId = await hydrateGraphReferenceMap(client, corpusId);
  const plan = buildGraphExportImportRecords(graphExport.payload, {
    corpusId,
    classifierId,
    importedAt: now,
    referenceByExternalItemId,
  });
  const graphExportArtifact = buildGraphExportArtifactAttachment(graphExport.outputPath, plan, {
    importedAt: now,
  });
  attachGraphExportArtifactToPlan(plan, graphExportArtifact);
  if (plan.mentionEdgeCount > 0 && plan.mentionRelationCount === 0) {
    throw createAnalysisCommandError(`Graph import could not resolve any accepted References for ${plan.mentionEdgeCount} reference-to-entity edge(s).`, {
      kind: "graph_import_unresolved_references",
      graphExportPath: graphExport.outputPath,
      stdoutLogPaths: [],
      stderrLogPaths: [],
    });
  }
  const supersessionChanges = shouldSupersedeGeneratedGraph(plan)
    ? await buildGeneratedGraphSupersessionChanges(client, {
      corpusId,
      extractorId: plan.extractorId,
      importRunId: plan.importRunId,
      now,
    })
    : [];
  const artifactRecords = plan.records.filter(isGraphArtifactImportRecord);
  const projectionRecords = plan.records.filter((record) => !isGraphArtifactImportRecord(record));
  const artifactChanges = await buildRecordChangesTargetedByIdToleratingOptionalModels(client, artifactRecords);
  await applyRecordChanges(client, artifactChanges);
  await updateNewsroomSummaryAfterAnalysisImport(client, artifactChanges, {
    actorLabel: "papyrus-content-cli",
    reason: `analysis store graph artifact ${plan.importRunId}`,
  });
  const importChanges = await buildRecordChangesTargetedByIdToleratingOptionalModels(client, projectionRecords);
  const projectionChanges = [...supersessionChanges, ...importChanges];
  await applyRecordChanges(client, projectionChanges);
  await updateNewsroomSummaryAfterAnalysisImport(client, projectionChanges, {
    actorLabel: "papyrus-content-cli",
    reason: `analysis import graph ${plan.importRunId}`,
  });
  const changes = [...artifactChanges, ...projectionChanges];
  printCategoryImportSummary("graph", plan.importRunId, changes);
  return {
    assignmentId: assignment.id,
    importRunId: plan.importRunId,
    importedRecords: changes.filter((record) => record.action !== "noop").length,
    graphExportPath: graphExport.outputPath,
    graphExportArtifactPath: graphExportArtifact.localPath,
    graphExportStoragePath: graphExportArtifact.attachment.storagePath,
    graphExportAttachmentId: graphExportArtifact.attachment.id,
    graphExportByteSize: graphExportArtifact.attachment.byteSize,
    graphExportSha256: graphExportArtifact.attachment.sha256,
    snapshot: plan.snapshotRef,
    nodes: plan.semanticNodeCount,
    relations: plan.semanticRelationCount,
    skippedItemNodes: plan.skippedItemNodes,
    unresolvedReferences: plan.unresolvedReferences,
    mentionRelations: plan.mentionRelationCount,
    supersededRecords: supersessionChanges.filter((record) => record.action !== "noop").length,
  };
}

function isGraphArtifactImportRecord(record) {
  return record.modelName === "KnowledgeImportRun"
    || record.modelName === "KnowledgeArtifact"
    || record.modelName === "KnowledgeRawPayload"
    || record.modelName === "ModelAttachment";
}

function shouldSupersedeGeneratedGraph(plan) {
  const stats = plan?.stats ?? {};
  const itemsTotal = Number(stats.items_total ?? stats.itemsTotal ?? 0) || 0;
  const itemsAvailable = Number(stats.items_available ?? stats.itemsAvailable ?? 0) || 0;
  if (itemsAvailable > 0 && itemsTotal > 0 && itemsTotal < itemsAvailable) return false;
  return true;
}

function runGraphExportForCommand({ command, metadata, corpusConfig, runDir }) {
  const snapshotRef = graphSnapshotRefFromCommand(command);
  const outputPath = path.join(runDir, `${command.label}-export.json`);
  const logPrefix = path.join(runDir, `${command.label}-export`);
  const cwd = normalizeCliString(command.cwd)
    || normalizeCliString(metadata.biblicusWorkdir)
    || process.env.BIBLICUS_WORKDIR
    || DEFAULT_BIBLICUS_WORKDIR;
  const rawArgs = [
    "run",
    "--extra",
    "topic-modeling",
    "biblicus",
    "graph",
    "export",
    "--corpus",
    corpusConfig.path,
    "--snapshot",
    snapshotRef,
    "--output",
    outputPath,
  ];
  const args = ensureUvBiblicusExtras(rawArgs, ["topic-modeling", "openai", "neo4j", "ner"]);
  const result = spawnSync("uv", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
  });
  const stdoutLogPath = `${logPrefix}.stdout.log`;
  const stderrLogPath = `${logPrefix}.stderr.log`;
  fs.writeFileSync(stdoutLogPath, result.stdout ?? "", "utf8");
  fs.writeFileSync(stderrLogPath, result.stderr ?? "", "utf8");
  if (result.status !== 0) {
    throw createAnalysisCommandError(`Analysis command ${command.label} graph export failed. See ${stderrLogPath}`, {
      kind: "graph_export_failed",
      commandResult: {
        label: `${command.label}-export`,
        executable: "uv",
        args,
        cwd,
        outputPath,
        stdoutLogPath,
        stderrLogPath,
        exitStatus: result.status,
        signal: result.signal ?? null,
        timedOut: false,
      },
      stdoutLogPaths: [stdoutLogPath],
      stderrLogPaths: [stderrLogPath],
    });
  }
  return {
    outputPath,
    payload: loadJsonFile(outputPath),
  };
}

function buildGraphExportArtifactAttachment(outputPath, plan, { importedAt }) {
  const rawPayloadId = graphExportSummaryPayloadId(plan.importRunId);
  const sourceBuffer = fs.readFileSync(outputPath);
  const gzipBuffer = zlib.gzipSync(sourceBuffer, { level: 9 });
  const localPath = outputPath.endsWith(".json")
    ? outputPath.replace(/\.json$/u, ".json.gz")
    : `${outputPath}.gz`;
  fs.writeFileSync(localPath, gzipBuffer);
  const entry = buildBinaryModelPayloadAttachment({
    ownerKind: "knowledgeRawPayload",
    ownerId: rawPayloadId,
    role: "graph_export",
    sortKey: "graph-export",
    filename: "graph-export.json.gz",
    mediaType: "application/gzip",
    content: gzipBuffer,
    importRunId: plan.importRunId,
    now: importedAt,
  });
  return {
    localPath,
    attachment: entry.attachment,
    body: entry.body,
    sourceByteSize: sourceBuffer.length,
  };
}

function attachGraphExportArtifactToPlan(plan, graphExportArtifact) {
  setGraphExportSummaryPayload(plan, {
    attachmentId: graphExportArtifact.attachment.id,
    storagePath: graphExportArtifact.attachment.storagePath,
    filename: graphExportArtifact.attachment.filename,
    mediaType: graphExportArtifact.attachment.mediaType,
    byteSize: graphExportArtifact.attachment.byteSize,
    sourceByteSize: graphExportArtifact.sourceByteSize,
    sha256: graphExportArtifact.attachment.sha256,
    compressed: true,
  });
  plan.records.push({
    modelName: "ModelAttachment",
    expected: graphExportArtifact.attachment,
    attachmentBody: graphExportArtifact.body,
  });
}

function setGraphExportSummaryPayload(plan, graphExport) {
  const summary = graphExportSummaryFromPlan(plan);
  summary.graphExport = graphExport;
  const summaryRecord = plan.records.find((record) => (
    record.modelName === "KnowledgeRawPayload"
    && record.expected?.id === graphExportSummaryPayloadId(plan.importRunId)
  ));
  if (summaryRecord) summaryRecord.expected.payload = JSON.stringify(summary);
}

function graphExportSummaryPayloadId(importRunId) {
  return `raw-import-run-${safeId(importRunId)}-graph-export-summary`;
}

function graphExportSummaryFromPlan(plan) {
  return {
    snapshot: plan.snapshotRef,
    graphId: plan.graphId,
    extractorId: plan.extractorId,
    extractionSnapshot: plan.extractionSnapshot,
    stats: plan.stats ?? {},
    nodeCount: plan.nodeCount,
    edgeCount: plan.edgeCount,
    semanticNodeCount: plan.semanticNodeCount,
    semanticRelationCount: plan.semanticRelationCount,
    skippedItemNodes: plan.skippedItemNodes,
    unresolvedReferences: plan.unresolvedReferences,
  };
}

function graphSnapshotRefFromCommand(command) {
  const payload = command.outputJson ?? {};
  const snapshotId = normalizeCliString(payload.snapshot_id);
  const extractorId = normalizeCliString(payload.configuration?.extractor_id)
    || graphCommandArgValue(command.args, "--extractor");
  if (!snapshotId || !extractorId) {
    throw createAnalysisCommandError(`Analysis command ${command.label} did not return a graph snapshot id and extractor id.`, {
      kind: "graph_snapshot_missing",
      commandResult: command,
      stdoutLogPaths: [command.stdoutLogPath],
      stderrLogPaths: [command.stderrLogPath],
    });
  }
  return `${extractorId}:${snapshotId}`;
}

function graphCommandArgValue(args, key) {
  const normalized = Array.isArray(args) ? args.map(String) : [];
  const index = normalized.findIndex((entry) => entry === key);
  return index >= 0 && normalized[index + 1] ? normalizeCliString(normalized[index + 1]) : null;
}

function buildGraphExportImportRecords(payload, { corpusId, classifierId, importedAt, referenceByExternalItemId }) {
  const snapshot = payload.snapshot ?? {};
  const manifest = payload.manifest ?? {};
  const extractorId = normalizeCliString(snapshot.extractor_id ?? manifest.configuration?.extractor_id) ?? "graph";
  const snapshotId = normalizeCliString(snapshot.snapshot_id ?? manifest.snapshot_id);
  if (!snapshotId) throw new Error("Graph export is missing snapshot.snapshot_id.");
  const snapshotRef = `${extractorId}:${snapshotId}`;
  const graphId = normalizeCliString(manifest.graph_id) ?? normalizeCliString(payload.graph_id) ?? snapshotRef;
  const extractionSnapshot = normalizeCliString(manifest.extraction_snapshot);
  const importRunId = `knowledge-import-${safeId(corpusId)}-graph-${safeId(extractorId)}-${hashShort(snapshotRef)}`;
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const records = [];
  const materializedNodeByGraphNodeId = new Map();
  let skippedItemNodes = 0;

  for (const node of nodes) {
    const nodeId = normalizeCliString(node.node_id);
    if (!nodeId) continue;
    if (isGraphItemNode(node)) {
      skippedItemNodes += 1;
      continue;
    }
    if (materializedNodeByGraphNodeId.has(nodeId)) continue;
    const lineageId = `semantic-node-graph-${safeId(corpusId)}-${safeId(extractorId)}-${safeId(snapshotId)}-${hashShort(nodeId)}`;
    const semanticNode = withVersionFields({
      id: `${lineageId}-v1`,
      lineageId,
      nodeKey: `${extractorId}:${snapshotId}:${nodeId}`,
      nodeKind: normalizeGraphNodeKind(node.node_type),
      corpusId,
      categorySetId: null,
      categoryLineageId: null,
      categoryKey: null,
      displayName: normalizeCliString(node.label) ?? nodeId,
      description: graphNodeDescription(node),
      aliases: graphNodeAliases(node),
      status: "generated",
      importRunId,
      createdAt: importedAt,
      newsroomFeedKey: "semanticNodes",
      updatedAt: importedAt,
    }, {
      now: importedAt,
      actor: "biblicus-graph-export",
      reason: `graph-import:${snapshotRef}`,
    });
    materializedNodeByGraphNodeId.set(nodeId, semanticNode);
    records.push({ modelName: "SemanticNode", expected: semanticNode });
  }

  const relationRecords = buildGraphExportRelationRecords({
    edges,
    nodes,
    materializedNodeByGraphNodeId,
    corpusId,
    classifierId,
    importRunId,
    importedAt,
    snapshotRef,
    graphId,
    extractorId,
    extractionSnapshot,
    referenceByExternalItemId,
  });

  records.push(recordKnowledgeImportRun({
    importRunId,
    corpusId,
    classifierId,
    sourceSnapshotId: snapshotId,
    importedAt,
    itemCount: Number(payload.stats?.items_processed ?? payload.stats?.items_total ?? 0) || 0,
    artifactCount: 1,
    relationCount: relationRecords.records.length,
  }));
  records.push({
    modelName: "KnowledgeArtifact",
    expected: {
      id: `knowledge-artifact-${safeId(corpusId)}-${safeId(extractorId)}-${safeId(snapshotId)}`,
      corpusId,
      artifactKind: "graph-export",
      artifactId: snapshotRef,
      snapshotId,
      displayName: `Graph export ${snapshotRef}`,
      createdAt: importedAt,
      importRunId,
    },
  });
  records.push({
    modelName: "KnowledgeRawPayload",
    expected: {
      id: graphExportSummaryPayloadId(importRunId),
      ownerType: "importRun",
      ownerId: importRunId,
      payloadKind: "graph-export-summary",
      importRunId,
      payload: JSON.stringify({
        snapshot: snapshotRef,
        graphId,
        extractorId,
        extractionSnapshot,
        stats: payload.stats ?? {},
        nodeCount: nodes.length,
        edgeCount: edges.length,
        semanticNodeCount: materializedNodeByGraphNodeId.size,
        semanticRelationCount: relationRecords.records.length,
        skippedItemNodes,
        unresolvedReferences: relationRecords.unresolvedReferences,
      }),
      createdAt: importedAt,
      updatedAt: importedAt,
    },
  });
  records.push(...relationRecords.records);

  return {
    importRunId,
    extractorId,
    snapshotId,
    snapshotRef,
    graphId,
    extractionSnapshot,
    stats: payload.stats ?? {},
    nodeCount: nodes.length,
    edgeCount: edges.length,
    records,
    semanticNodeCount: materializedNodeByGraphNodeId.size,
    semanticRelationCount: relationRecords.records.length,
    skippedItemNodes,
    unresolvedReferences: relationRecords.unresolvedReferences,
    mentionEdgeCount: relationRecords.mentionEdgeCount,
    mentionRelationCount: relationRecords.mentionRelationCount,
  };
}

function buildGraphExportRelationRecords({
  edges,
  nodes,
  materializedNodeByGraphNodeId,
  corpusId,
  classifierId,
  importRunId,
  importedAt,
  snapshotRef,
  graphId,
  extractorId,
  extractionSnapshot,
  referenceByExternalItemId,
}) {
  const graphNodeById = new Map(nodes.map((node) => [normalizeCliString(node.node_id), node]).filter(([key]) => key));
  const referencesByExternalId = referenceByExternalItemId instanceof Map ? referenceByExternalItemId : new Map();
  const relationTypes = new Set(loadSemanticRelationTypeSeeds().map((type) => type.key));
  const records = [];
  const seen = new Set();
  let unresolvedReferences = 0;
  let mentionEdgeCount = 0;
  let mentionRelationCount = 0;

  for (const edge of edges) {
    const src = normalizeCliString(edge.src);
    const dst = normalizeCliString(edge.dst);
    const edgeId = normalizeCliString(edge.edge_id) ?? hashShort(edge);
    if (!src || !dst) continue;
    const srcNode = graphNodeById.get(src) ?? {};
    const dstNode = graphNodeById.get(dst) ?? {};
    const srcSemantic = materializedNodeByGraphNodeId.get(src);
    const dstSemantic = materializedNodeByGraphNodeId.get(dst);
    const sourceItemId = normalizeCliString(edge.item_id) ?? graphItemIdFromNode(srcNode) ?? graphItemIdFromNode(dstNode);
    const metadata = graphRelationMetadata({
      edge,
      snapshotRef,
      graphId,
      extractorId,
      extractionSnapshot,
      sourceItemId,
    });

    if (isGraphItemNode(srcNode) || isGraphItemNode(dstNode)) {
      mentionEdgeCount += 1;
      const entityNode = srcSemantic ?? dstSemantic;
      if (!entityNode) continue;
      const reference = sourceItemId ? referencesByExternalId.get(sourceItemId) : null;
      if (!reference) {
        unresolvedReferences += 1;
        continue;
      }
      const relation = graphSemanticRelationRecord({
        idParts: [snapshotRef, sourceItemId, edgeId, "mentions"],
        predicate: "mentions",
        subjectKind: "reference",
        subjectId: reference.id,
        subjectLineageId: reference.lineageId ?? reference.id,
        subjectVersionNumber: reference.versionNumber ?? null,
        objectKind: "semanticNode",
        objectId: entityNode.id,
        objectLineageId: entityNode.lineageId,
        objectVersionNumber: entityNode.versionNumber ?? 1,
        score: numberOrNull(edge.weight),
        rank: 1,
        classifierId,
        sourceSnapshotId: snapshotRef,
        importRunId,
        importedAt,
        metadata,
      });
      const key = relation.id;
      if (!seen.has(key)) {
        records.push({ modelName: "SemanticRelation", expected: relation });
        seen.add(key);
        mentionRelationCount += 1;
      }
      continue;
    }

    if (!srcSemantic || !dstSemantic) continue;
    const normalizedEdgeType = normalizeRelationTypeKey(edge.edge_type);
    const predicate = relationTypes.has(normalizedEdgeType) ? normalizedEdgeType : "related_to";
    const relation = graphSemanticRelationRecord({
      idParts: [snapshotRef, sourceItemId, edgeId, predicate],
      predicate,
      subjectKind: "semanticNode",
      subjectId: srcSemantic.id,
      subjectLineageId: srcSemantic.lineageId,
      subjectVersionNumber: srcSemantic.versionNumber ?? 1,
      objectKind: "semanticNode",
      objectId: dstSemantic.id,
      objectLineageId: dstSemantic.lineageId,
      objectVersionNumber: dstSemantic.versionNumber ?? 1,
      score: numberOrNull(edge.weight),
      rank: 1,
      classifierId,
      sourceSnapshotId: snapshotRef,
      importRunId,
      importedAt,
      metadata,
    });
    const key = relation.id;
    if (!seen.has(key)) {
      records.push({ modelName: "SemanticRelation", expected: relation });
      seen.add(key);
    }
  }
  return { records, unresolvedReferences, mentionEdgeCount, mentionRelationCount };
}

async function buildGeneratedGraphSupersessionChanges(client, { corpusId, extractorId, importRunId, now }) {
  const prefix = `knowledge-import-${safeId(corpusId)}-graph-${safeId(extractorId)}-`;
  const graphRuns = (await client.listKnowledgeImportRunsByCorpusKindAndImportedAt(`${corpusId}#graph-export`))
    .filter((run) => run.id !== importRunId)
    .filter((run) => String(run.id ?? "").startsWith(prefix));
  const nodeLists = await Promise.all(graphRuns.map((run) => client.listSemanticNodesByImportRunAndNodeKey(run.id)));
  const relationLists = await Promise.all(graphRuns.map((run) => client.listSemanticRelationsByImportRunAndImportedAt(run.id)));
  const nodes = nodeLists.flat();
  const relations = relationLists.flat();
  const changes = [];
  for (const node of nodes) {
    if (node.importRunId === importRunId || !String(node.importRunId ?? "").startsWith(prefix)) continue;
    if (node.versionState !== "current") continue;
    const expected = {
      ...node,
      versionState: "superseded",
      status: "superseded",
      changeReason: `superseded-by-graph-import:${importRunId}`,
      updatedAt: now,
    };
    expected.contentHash = hashShort(normalizeRecord(expected));
    changes.push(buildRecordChangeFromCurrent("SemanticNode", expected, node));
  }
  for (const relation of relations) {
    if (relation.importRunId === importRunId || !String(relation.importRunId ?? "").startsWith(prefix)) continue;
    if (relation.relationState !== "current") continue;
    const expected = {
      ...relation,
      relationState: "superseded",
      updatedAt: now,
    };
    changes.push(buildRecordChangeFromCurrent("SemanticRelation", expected, relation));
  }
  changes.queryDiagnostics = {
    importRunIndex: "listKnowledgeImportRunsByCorpusKindAndImportedAt",
    importRunKey: `${corpusId}#graph-export`,
    semanticNodeIndex: "listSemanticNodesByImportRunAndNodeKey",
    semanticRelationIndex: "listSemanticRelationsByImportRunAndImportedAt",
    priorImportRunsFetched: graphRuns.length,
    semanticNodesFetched: nodes.length,
    semanticRelationsFetched: relations.length,
  };
  return changes;
}

async function hydrateGraphReferenceMap(client, corpusId) {
  const references = await client.listRecords("Reference");
  return new Map(references
    .filter((reference) => reference.corpusId === corpusId)
    .filter(isCurrentAcceptedReference)
    .map((reference) => [reference.externalItemId, reference])
    .filter(([key]) => key));
}

function recordKnowledgeImportRun({
  importRunId,
  corpusId,
  classifierId,
  sourceSnapshotId,
  importedAt,
  itemCount,
  artifactCount,
  relationCount,
}) {
  return {
    modelName: "KnowledgeImportRun",
    expected: {
      id: importRunId,
      corpusId,
      importKind: "graph-export",
      corpusImportKindKey: `${corpusId}#graph-export`,
      classifierId,
      sourceSnapshotId,
      status: "imported",
      generatedAt: importedAt,
      importedAt,
      itemCount,
      categoryCount: 0,
      proposalCount: 0,
      artifactCount,
      referenceCount: 0,
      relationCount,
      warningCount: 0,
    },
  };
}

function graphSemanticRelationRecord(input) {
  const subjectStateKey = semanticStateKey(input.subjectKind, input.subjectLineageId);
  const objectStateKey = semanticStateKey(input.objectKind, input.objectLineageId);
  const subjectVersionKey = semanticVersionKey(input.subjectKind, input.subjectId);
  const objectVersionKey = semanticVersionKey(input.objectKind, input.objectId);
  return {
    id: `semantic-relation-${hashShort(input.idParts)}`,
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
    score: input.score,
    confidence: null,
    rank: input.rank ?? 1,
    classifierId: input.classifierId ?? null,
    modelVersion: null,
    reviewRecommended: false,
    sourceSnapshotId: input.sourceSnapshotId,
    importRunId: input.importRunId,
    importedAt: input.importedAt,
    createdAt: input.importedAt,
    updatedAt: input.importedAt,
    newsroomFeedKey: "semanticRelations",
    metadata: JSON.stringify(input.metadata ?? {}),
  };
}

function graphRelationMetadata({ edge, snapshotRef, graphId, extractorId, extractionSnapshot, sourceItemId }) {
  return {
    kind: "graph.imported_relation",
    graphSnapshot: snapshotRef,
    graphId,
    extractorId,
    extractionSnapshot,
    sourceItemId,
    edgeId: edge.edge_id ?? null,
    edgeType: edge.edge_type ?? null,
    properties: edge.properties && typeof edge.properties === "object" ? edge.properties : {},
  };
}

function isGraphItemNode(node) {
  const nodeType = normalizeCliString(node?.node_type);
  const nodeId = normalizeCliString(node?.node_id);
  return nodeType === "item"
    || nodeType === "reference"
    || nodeId?.startsWith("item:")
    || nodeId?.startsWith("reference:");
}

function graphItemIdFromNode(node) {
  const properties = node?.properties && typeof node.properties === "object" ? node.properties : {};
  return normalizeCliString(properties.item_id)
    || normalizeCliString(properties.reference_id)
    || stripGraphNodePrefix(node?.node_id, "item:")
    || stripGraphNodePrefix(node?.node_id, "reference:");
}

function stripGraphNodePrefix(value, prefix) {
  const normalized = normalizeCliString(value);
  return normalized?.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

function normalizeGraphNodeKind(value) {
  const normalized = normalizeRelationTypeKey(value);
  if (!normalized) return "entity";
  if (normalized === "item" || normalized === "reference") return "entity";
  return normalized;
}

function graphNodeDescription(node) {
  const entityType = normalizeCliString(node.properties?.entity_type ?? node.properties?.kind);
  const nodeType = normalizeCliString(node.node_type);
  return [nodeType, entityType].filter(Boolean).join(": ") || null;
}

function graphNodeAliases(node) {
  const aliases = new Set();
  const canonical = normalizeCliString(node.properties?.canonical);
  if (canonical && canonical !== node.label) aliases.add(canonical);
  return Array.from(aliases);
}

async function buildEditionPlanningCommandPlan(options) {
  const editionDate = options.date;
  if (!editionDate) throw new Error("editions plan/dispatch-research requires --date YYYY-MM-DD.");
  const { client } = createAuthoringClient();
  const state = await loadEditionPlanningState(client);
  const plan = buildEditionPlanningPlan(state, {
    editionDate,
    editionSlug: options.slug,
    assignmentTypeKey: options["assignment-type"] === "reporting" ? REPORTING_EDITION_ASSIGNMENT_TYPE : options["assignment-type"],
    topDeskCount: options["top-desks"],
    publicationSlots: options.slots,
    overassignmentRatio: options.ratio,
    maxAssignments: options["max-assignments"],
    rotatingSectionCount: options["rotating-sections"],
    focusCategories: parseCommaList(options["focus-categories"] ?? options["track-lenses"]),
    sectionTargets: parseCommaList(options["section-targets"]),
    sectionBudgets: parseCommaList(options["section-budgets"]),
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

async function deleteAllContent(client, options = {}) {
  const deleteAttachments = Boolean(options.deleteAttachments);
  const bucket = options.bucket ?? null;
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
    "ModelAttachment",
    "KnowledgeRawPayload",
    "SteeringDecision",
    "SteeringProposal",
    "SemanticRelation",
    "SemanticRelationType",
    "AssignmentEvent",
    "Assignment",
    "NewsroomSection",
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
    let attachmentObjectsDeleted = 0;
    let attachmentDeleteBucket = null;
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
        result.push({ modelName, deleted: totalDeleted, attachmentObjectsDeleted, bucket: attachmentDeleteBucket });
        break;
      }
      if (modelName === "ModelAttachment" && deleteAttachments) {
        const storagePaths = records.map((record) => record.storagePath).filter(Boolean);
        const deleteResult = deleteAttachmentStoragePaths(storagePaths, { bucket });
        attachmentObjectsDeleted += deleteResult.deleted ?? 0;
        attachmentDeleteBucket = deleteResult.bucket ?? attachmentDeleteBucket;
        if (deleteResult.attempted) {
          console.error(`delete\tattachment-objects\tpass=${pass}\tattempted=${deleteResult.attempted}\tdeleted=${deleteResult.deleted}\tchunks=${deleteResult.chunks}`);
        }
      }
      const deletedRecords = await deleteRecordsForModel(client, modelName, records);
      totalDeleted += deletedRecords.deleted;
      if (pass >= 20) throw new Error(`delete all did not drain ${modelName} after ${pass} passes.`);
    }
  }

  return result;
}

async function deleteRecordsForModel(client, modelName, records) {
  const concurrency = deleteConcurrency();
  if (records.length > 1 && concurrency > 1) console.error(`delete\tconcurrency\t${modelName}\t${concurrency}`);
  let deleted = 0;
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, records.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= records.length) return;
      const record = records[index];
      try {
        await client.deleteRecord(modelName, record.id);
        deleted += 1;
      } catch (error) {
        if (!isDynamoResourceNotFoundError(error)) throw error;
        console.error(`delete\tskip-record\t${modelName}\t${record.id}\t${normalizeError(error).message}`);
      }
    }
  });
  await Promise.all(workers);
  return { deleted };
}

function deleteConcurrency() {
  const raw = process.env.PAPYRUS_DELETE_CONCURRENCY;
  if (!raw) return 8;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("PAPYRUS_DELETE_CONCURRENCY must be a positive integer.");
  }
  return Math.min(parsed, 24);
}

async function pruneModelAttachments(flags) {
  const options = parseOptions(flags);
  const apply = Boolean(options.apply);
  const asJson = Boolean(options.json);
  const bucket = normalizeCliString(options.bucket);
  const prefix = normalizeCliString(options.prefix) ?? "newsroom/payloads/";
  const { client } = createAuthoringClient();

  let attachments = [];
  try {
    attachments = await client.listRecords("ModelAttachment");
  } catch (error) {
    if (isMissingGraphQLModelError(error, "ModelAttachment") || isDynamoResourceNotFoundError(error)) {
      if (asJson) {
        printCompactJson({
          ok: false,
          command: "newsroom prune-attachments",
          mode: apply ? "apply" : "dry-run",
          error: "missing_model",
        });
      } else {
        console.log(`attachment-prune\tmissing-model\tModelAttachment\t${normalizeError(error).message}`);
      }
      return;
    }
    throw error;
  }

  const ownerIdsByKind = await loadModelAttachmentOwnerIds(client, attachments);
  const orphanAttachmentRecords = attachments.filter((attachment) => {
    const ownerModel = MODEL_ATTACHMENT_OWNER_MODELS[attachment.ownerKind];
    if (!ownerModel) return true;
    return !ownerIdsByKind.get(attachment.ownerKind)?.has(attachment.ownerId);
  });
  const orphanAttachmentIds = new Set(orphanAttachmentRecords.map((attachment) => attachment.id));
  const validAttachmentStoragePaths = new Set(attachments
    .filter((attachment) => !orphanAttachmentIds.has(attachment.id))
    .map((attachment) => attachment.storagePath)
    .filter(Boolean));
  const attachmentStoragePaths = new Set(attachments.map((attachment) => attachment.storagePath).filter(Boolean));
  const storageListing = listAttachmentStoragePaths({ bucket, prefix });
  const orphanStoragePaths = storageListing.keys.filter((storagePath) => !attachmentStoragePaths.has(storagePath));
  const recordStoragePathsToDelete = orphanAttachmentRecords
    .map((attachment) => attachment.storagePath)
    .filter((storagePath) => storagePath && !validAttachmentStoragePaths.has(storagePath));
  const deleted = {
    attachmentRecords: 0,
    attachmentRecordObjects: 0,
    orphanStorageObjects: 0,
  };

  if (!asJson) {
    console.log(`attachment-prune\tmode\t${apply ? "apply" : "dry-run"}`);
    console.log(`attachment-prune\tbucket\t${storageListing.bucket}`);
    console.log(`attachment-prune\tprefix\t${storageListing.prefix}`);
    console.log(`attachment-prune\tmodelAttachments\t${attachments.length}`);
    console.log(`attachment-prune\torphanAttachmentRecords\t${orphanAttachmentRecords.length}`);
    console.log(`attachment-prune\torphanStorageObjects\t${orphanStoragePaths.length}`);
  }

  if (apply && recordStoragePathsToDelete.length) {
    const deleteResult = deleteAttachmentStoragePaths(recordStoragePathsToDelete, { bucket: storageListing.bucket });
    deleted.attachmentRecordObjects += deleteResult.deleted ?? 0;
  }

  for (const attachment of orphanAttachmentRecords) {
    const ownerModel = MODEL_ATTACHMENT_OWNER_MODELS[attachment.ownerKind] ?? "unknown-owner-kind";
    if (!asJson) console.log(`attachment-prune\torphan-record\t${attachment.id}\t${attachment.ownerKind}\t${ownerModel}\t${attachment.ownerId}\t${attachment.storagePath}`);
    if (!apply) continue;
    await client.deleteRecord("ModelAttachment", attachment.id);
    deleted.attachmentRecords += 1;
  }

  if (apply && orphanStoragePaths.length) {
    const deleteResult = deleteAttachmentStoragePaths(orphanStoragePaths, { bucket: storageListing.bucket });
    deleted.orphanStorageObjects += deleteResult.deleted ?? 0;
  }

  for (const storagePath of orphanStoragePaths) {
    if (!asJson) console.log(`attachment-prune\torphan-object\t${storagePath}`);
  }

  if (asJson) {
    printCompactJson({
      ok: true,
      command: "newsroom prune-attachments",
      mode: apply ? "apply" : "dry-run",
      bucket: storageListing.bucket,
      prefix: storageListing.prefix,
      counts: {
        modelAttachments: attachments.length,
        orphanAttachmentRecords: orphanAttachmentRecords.length,
        orphanStorageObjects: orphanStoragePaths.length,
      },
      deleted,
      next: apply ? null : "npm run content -- newsroom prune-attachments --apply",
    });
  } else if (!apply) {
    console.log("attachment-prune\tnext\tnpm run content -- newsroom prune-attachments --apply");
  }
}

async function loadModelAttachmentOwnerIds(client, attachments) {
  const ownerKinds = Array.from(new Set(attachments.map((attachment) => attachment.ownerKind).filter(Boolean)));
  const result = new Map();
  for (const ownerKind of ownerKinds) {
    const modelName = MODEL_ATTACHMENT_OWNER_MODELS[ownerKind];
    if (!modelName) {
      result.set(ownerKind, new Set());
      continue;
    }
    try {
      const rows = await client.listRecords(modelName);
      result.set(ownerKind, new Set(rows.map((row) => row.id).filter(Boolean)));
    } catch (error) {
      if (!isMissingGraphQLModelError(error, modelName) && !isDynamoResourceNotFoundError(error)) throw error;
      result.set(ownerKind, new Set());
    }
  }
  return result;
}

async function buildRecordChanges(client, records, options = {}) {
  const skippedModels = options.skippedModels instanceof Set ? options.skippedModels : new Set();
  const skipModelAttachments = skippedModels.has("ModelAttachment");
  console.error(`prepare\trecords\t${records.length}`);
  const prepared = await prepareVersionedKnowledgeRecords(client, records);
  console.error(`prepare\tplanned\t${prepared.records.length}\tpostChanges\t${prepared.postChanges.length}`);
  const changes = [];
  const indexedRecords = prepared.records.map(normalizeOperationalIndexRecord);
  const expandedRecords = expandPrivatePayloadRecords(indexedRecords, {
    skipModelAttachments,
  });
  const plannedRecords = dedupePlannedRecords(expandedRecords);
  if (plannedRecords.length !== prepared.records.length) {
    console.error(`prepare\tdeduped\t${prepared.records.length - plannedRecords.length}`);
  }
  const filteredPlanned = plannedRecords.filter((record) => !skippedModels.has(record.modelName));
  const existingByModel = await listExistingRecordsByModel(client, filteredPlanned);
  for (const record of filteredPlanned) {
    const change = buildRecordChangeFromCurrent(
      record.modelName,
      record.expected,
      existingByModel.get(record.modelName)?.get(record.expected.id) ?? null,
      { skipModelAttachments },
    );
    if (record.attachmentBody !== undefined) change.attachmentBody = record.attachmentBody;
    changes.push(change);
  }
  changes.push(...prepared.postChanges.filter((change) => !skippedModels.has(change.modelName)));
  return changes;
}

function normalizeOperationalIndexRecord(record) {
  if (!record || !record.expected || typeof record.expected !== "object") return record;
  if (record.modelName === "Assignment") {
    return {
      ...record,
      expected: {
        ...record.expected,
        sectionStatusKey: assignmentSectionStatusKey(record.expected),
        sectionQueueStatusKey: assignmentSectionQueueStatusKey(record.expected),
      },
    };
  }
  if (record.modelName === "KnowledgeImportRun") {
    return {
      ...record,
      expected: {
        ...record.expected,
        corpusImportKindKey: knowledgeImportRunCorpusKindKey(record.expected),
      },
    };
  }
  return record;
}

function plannedRecordInput(record) {
  return {
    modelName: record.modelName,
    expected: record.expected,
  };
}

function expandPrivatePayloadRecords(records, options = {}) {
  const skipModelAttachments = Boolean(options.skipModelAttachments);
  const expanded = [];
  for (const record of records) {
    const expected = record.expected ?? {};
    const now = expected.updatedAt ?? expected.createdAt ?? new Date().toISOString();
    const attachments = [];
    if (!skipModelAttachments && record.modelName === "Message") {
      if (expected.body !== undefined) {
        attachments.push(attachmentRecord(buildTextModelPayloadAttachment({
          ownerKind: "message",
          ownerId: expected.id,
          ownerLineageId: expected.id,
          role: "message_body",
          sortKey: "message",
          filename: expected.body && String(expected.body).trim().startsWith("{") ? "message.json" : "message.txt",
          mediaType: expected.body && String(expected.body).trim().startsWith("{") ? "application/json" : "text/plain",
          content: String(expected.body ?? ""),
          importRunId: expected.importRunId,
          now,
        })));
      }
      if (expected.metadata !== undefined) {
        attachments.push(attachmentRecord(buildJsonModelPayloadAttachment({
          ownerKind: "message",
          ownerId: expected.id,
          ownerLineageId: expected.id,
          role: "metadata",
          sortKey: "metadata",
          filename: "metadata.json",
          content: parseJsonish(expected.metadata),
          importRunId: expected.importRunId,
          now,
        })));
      }
    } else if (!skipModelAttachments && record.modelName === "Reference" && expected.metadata !== undefined) {
      attachments.push(attachmentRecord(buildJsonModelPayloadAttachment({
        ownerKind: "reference",
        ownerId: expected.id,
        ownerLineageId: expected.lineageId ?? expected.id,
        ownerVersionNumber: expected.versionNumber ?? null,
        ownerVersionKey: semanticVersionKey("reference", expected.id),
        role: "metadata",
        sortKey: "metadata",
        filename: "metadata.json",
        content: parseJsonish(expected.metadata),
        importRunId: expected.importRunId,
        now,
      })));
    } else if (!skipModelAttachments && record.modelName === "Assignment") {
      if (expected.brief !== undefined) attachments.push(attachmentRecord(buildTextModelPayloadAttachment({
        ownerKind: "assignment",
        ownerId: expected.id,
        ownerLineageId: expected.id,
        role: "assignment_brief",
        sortKey: "brief",
        filename: "brief.txt",
        content: String(expected.brief ?? ""),
        importRunId: expected.importRunId,
        now,
      })));
      if (expected.instructions !== undefined) attachments.push(attachmentRecord(buildTextModelPayloadAttachment({
        ownerKind: "assignment",
        ownerId: expected.id,
        ownerLineageId: expected.id,
        role: "assignment_instructions",
        sortKey: "instructions",
        filename: "instructions.txt",
        content: String(expected.instructions ?? ""),
        importRunId: expected.importRunId,
        now,
      })));
      if (expected.metadata !== undefined) attachments.push(attachmentRecord(buildJsonModelPayloadAttachment({
        ownerKind: "assignment",
        ownerId: expected.id,
        ownerLineageId: expected.id,
        role: "metadata",
        sortKey: "metadata",
        filename: "metadata.json",
        content: parseJsonish(expected.metadata),
        importRunId: expected.importRunId,
        now,
      })));
    } else if (!skipModelAttachments && record.modelName === "AssignmentEvent" && expected.metadata !== undefined) {
      attachments.push(attachmentRecord(buildJsonModelPayloadAttachment({
        ownerKind: "assignmentEvent",
        ownerId: expected.id,
        ownerLineageId: expected.id,
        role: "metadata",
        sortKey: "metadata",
        filename: "metadata.json",
        content: parseJsonish(expected.metadata),
        now,
      })));
    } else if (!skipModelAttachments && record.modelName === "KnowledgeRawPayload" && expected.payload !== undefined) {
      attachments.push(attachmentRecord(buildJsonModelPayloadAttachment({
        ownerKind: "knowledgeRawPayload",
        ownerId: expected.id,
        role: "raw_payload",
        sortKey: expected.payloadKind ?? "payload",
        filename: `${safeId(expected.payloadKind ?? "payload")}.json`,
        content: parseJsonish(expected.payload),
        importRunId: expected.importRunId,
        now,
      })));
    }
    // If ModelAttachment is not deployed, we must keep payload fields inline on their parent models.
    const nextExpected = skipModelAttachments ? expected : stripPrivatePayloadFields(record.modelName, expected);
    expanded.push({ ...record, expected: nextExpected });
    expanded.push(...attachments);
  }
  return expanded;
}

async function readJsonModelPayload(client, ownerKind, ownerId, role, sortKey = role) {
  const attachment = await client.getRecord("ModelAttachment", modelAttachmentId(ownerKind, ownerId, role, sortKey));
  if (!attachment) return null;
  const body = await downloadAttachmentBody(attachment, { client });
  if (!body) return null;
  return parseJsonish(body);
}

async function readJsonModelPayloadOptional(client, ownerKind, ownerId, role, sortKey = role) {
  try {
    return await readJsonModelPayload(client, ownerKind, ownerId, role, sortKey);
  } catch (error) {
    if (isMissingGraphQLModelError(error, "ModelAttachment") || isDynamoResourceNotFoundError(error)) return null;
    return null;
  }
}

async function readTextModelPayload(client, ownerKind, ownerId, role, sortKey = role) {
  const attachment = await client.getRecord("ModelAttachment", modelAttachmentId(ownerKind, ownerId, role, sortKey));
  if (!attachment) return null;
  return await downloadAttachmentBody(attachment, { client }) ?? null;
}

async function assignmentMetadata(client, assignment) {
  try {
    const payload = await readJsonModelPayload(client, "assignment", assignment.id, "metadata", "metadata");
    if (payload && typeof payload === "object") return payload;
  } catch {
    // Fall back to inline metadata when ModelAttachment storage is unavailable.
  }
  const inline = parseJsonish(assignment?.metadata);
  return inline && typeof inline === "object" ? inline : {};
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
    if (stableJson(existing.expected) !== stableJson(record.expected)) {
      const semanticResolved = resolveSemanticRelationPlannedConflict(
        record.modelName,
        existing.expected,
        record.expected,
      );
      if (semanticResolved) {
        byKey.set(key, { ...record, expected: semanticResolved });
        continue;
      }
      if (!isBenignPlannedDuplicate(record.modelName, existing.expected, record.expected)) {
        throw new Error(
          `Conflicting planned records for ${key}.`
          + ` left=${plannedRecordConflictSnippet(existing.expected)}`
          + ` right=${plannedRecordConflictSnippet(record.expected)}`,
        );
      }
    }
  }
  return Array.from(byKey.values());
}

function latestRecordsById(records) {
  const byId = new Map();
  for (const record of records ?? []) {
    const id = normalizeCliString(record?.id);
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, record);
      continue;
    }
    const existingTimestamp = String(existing.updatedAt ?? existing.createdAt ?? "");
    const nextTimestamp = String(record.updatedAt ?? record.createdAt ?? "");
    if (nextTimestamp.localeCompare(existingTimestamp) > 0) {
      byId.set(id, record);
    }
  }
  return Array.from(byId.values());
}

function isBenignPlannedDuplicate(modelName, left, right) {
  if (modelName === "ModelAttachment") {
    const normalize = (record) => ({
      id: record?.id ?? null,
      ownerKind: record?.ownerKind ?? null,
      ownerId: record?.ownerId ?? null,
      ownerLineageId: record?.ownerLineageId ?? null,
      role: record?.role ?? null,
      sortKey: record?.sortKey ?? null,
      storagePath: record?.storagePath ?? null,
      filename: record?.filename ?? null,
      mediaType: record?.mediaType ?? null,
      byteSize: record?.byteSize ?? null,
      sha256: record?.sha256 ?? null,
      status: record?.status ?? null,
    });
    return stableJson(normalize(left)) === stableJson(normalize(right));
  }
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

function resolveSemanticRelationPlannedConflict(modelName, left, right) {
  if (modelName !== "SemanticRelation") return null;
  if (!left || !right) return null;
  if (!left.id || left.id !== right.id) return null;
  const keys = [
    "predicate",
    "subjectKind",
    "subjectId",
    "subjectLineageId",
    "objectKind",
    "objectId",
    "objectLineageId",
  ];
  for (const key of keys) {
    const leftValue = normalizeCliString(left[key]) ?? null;
    const rightValue = normalizeCliString(right[key]) ?? null;
    if (leftValue !== rightValue) return null;
  }
  const priority = (state) => {
    switch (state) {
      case "current":
        return 3;
      case "historical":
        return 2;
      case "superseded":
        return 1;
      default:
        return 0;
    }
  };
  return priority(left.relationState) >= priority(right.relationState) ? left : right;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function plannedRecordConflictSnippet(record) {
  if (!record || typeof record !== "object") return String(record);
  return stableJson({
    id: record.id ?? null,
    relationState: record.relationState ?? null,
    predicate: record.predicate ?? null,
    subjectId: record.subjectId ?? null,
    subjectLineageId: record.subjectLineageId ?? null,
    objectId: record.objectId ?? null,
    objectLineageId: record.objectLineageId ?? null,
    metadata: record.metadata ?? null,
  });
}

async function buildRecordChangesToleratingOptionalModels(client, records) {
  let pendingRecords = records;
  const skippedModels = new Set();
  for (;;) {
    try {
      return await buildRecordChanges(client, pendingRecords, { skippedModels });
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

async function buildRecordChangesTargetedById(client, records, options = {}) {
  const skippedModels = options.skippedModels instanceof Set ? options.skippedModels : new Set();
  const skipModelAttachments = skippedModels.has("ModelAttachment");
  const shouldPrepareVersioned = options.prepareVersioned !== false;
  console.error(`prepare-targeted\trecords\t${records.length}`);
  const prepared = shouldPrepareVersioned
    ? await prepareVersionedKnowledgeRecords(client, records)
    : { records, postChanges: [] };
  const indexedRecords = prepared.records.map(normalizeOperationalIndexRecord);
  const expandedRecords = expandPrivatePayloadRecords(indexedRecords, {
    skipModelAttachments,
  });
  const plannedRecords = dedupePlannedRecords(expandedRecords);
  const filteredPlanned = plannedRecords.filter((record) => !skippedModels.has(record.modelName));
  const existingByModel = await getExistingRecordsByPlannedId(client, filteredPlanned, {
    diagnostics: options.diagnostics,
  });
  const changes = [];
  for (const record of filteredPlanned) {
    const change = buildRecordChangeFromCurrent(
      record.modelName,
      record.expected,
      existingByModel.get(record.modelName)?.get(record.expected.id) ?? null,
      { skipModelAttachments },
    );
    if (record.attachmentBody !== undefined) change.attachmentBody = record.attachmentBody;
    changes.push(change);
  }
  changes.push(...prepared.postChanges.filter((change) => !skippedModels.has(change.modelName)));
  return changes;
}

async function buildRecordChangesTargetedByIdToleratingOptionalModels(client, records, options = {}) {
  let pendingRecords = records;
  const skippedModels = new Set();
  for (;;) {
    try {
      return await buildRecordChangesTargetedById(client, pendingRecords, {
        ...options,
        skippedModels,
      });
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

async function getExistingRecordsByPlannedId(client, records, options = {}) {
  const idsByModel = new Map();
  for (const record of records) {
    const id = normalizeCliString(record.expected?.id);
    if (!id) continue;
    const ids = idsByModel.get(record.modelName) ?? [];
    ids.push(id);
    idsByModel.set(record.modelName, ids);
  }
  const existingByModel = new Map();
  for (const [modelName, ids] of idsByModel.entries()) {
    const uniqueIds = Array.from(new Set(ids));
    console.error(`targeted-prefetch\t${modelName}\t${uniqueIds.length}`);
    const results = await client.getRecordsById(modelName, uniqueIds);
    if (options.diagnostics?.fetchedByModel) {
      options.diagnostics.fetchedByModel[modelName] = (options.diagnostics.fetchedByModel[modelName] ?? 0) + uniqueIds.length;
    }
    existingByModel.set(modelName, results);
  }
  return existingByModel;
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
      if (expected.lineageId && expected.versionNumber != null) {
        referenceIdMap.set(expected.id, expected);
      }
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
      metadata: toAwsJson(mediaAssetMetadata(asset)),
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

function buildRecordChangeFromCurrent(modelName, expected, current, options = {}) {
  const skipModelAttachments = Boolean(options.skipModelAttachments);
  expected = skipModelAttachments ? expected : stripPrivatePayloadFields(modelName, expected);
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
  const hasAttachmentUploads = actionable.some((record) => record.modelName === "ModelAttachment" && record.attachmentBody !== undefined);
  console.error(`apply\tchanges\t${actionable.length}`);

  if (hasAttachmentUploads) {
    const ownerRecords = actionable.filter((record) => !(record.modelName === "ModelAttachment" && record.attachmentBody !== undefined));
    const attachmentRecords = actionable.filter((record) => record.modelName === "ModelAttachment" && record.attachmentBody !== undefined);
    const concurrency = applyConcurrency(8);
    console.error(`apply\tstage\towners\t${ownerRecords.length}`);
    console.error(`apply\tconcurrency\t${concurrency}`);
    await applyRecordsConcurrently(client, ownerRecords, {
      concurrency,
      label: "owners",
      applyRecord: async (record) => client.upsert(record.modelName, record.expected),
    });
    console.error(`apply\tstage\tattachments\t${attachmentRecords.length}`);
    await applyRecordsConcurrently(client, attachmentRecords, {
      concurrency,
      label: "attachments",
      applyRecord: async (record) => uploadAttachmentBody(record.expected, record.attachmentBody, { client }),
    });
    return;
  }

  const concurrency = applyConcurrency(1);
  if (concurrency > 1) console.error(`apply\tconcurrency\t${concurrency}`);
  await applyRecordsConcurrently(client, actionable, {
    concurrency,
    label: "records",
    applyRecord: async (record) => client.upsert(record.modelName, record.expected),
  });
}

async function applyRecordsConcurrently(client, records, options) {
  const concurrency = options.concurrency;
  const applyRecord = options.applyRecord;
  const label = options.label ?? "records";
  let applied = 0;
  let nextIndex = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < records.length) {
      const record = records[nextIndex];
      nextIndex += 1;
      try {
        await applyRecord(record);
      } catch (error) {
        const failure = normalizeError(error);
        throw new Error(`Failed to apply ${record.action} ${record.modelName} ${record.expected?.id ?? "<missing-id>"}: ${failure.message}`);
      }
      applied += 1;
      if (applied === records.length || applied % 100 === 0) {
        console.error(`apply\tprogress\t${label}\t${applied}/${records.length}`);
      }
    }
  });
  await Promise.all(workers);
}

async function upsertModelPayloadForExistingRecord(client, record) {
  const expanded = expandPrivatePayloadRecords([record]).filter((entry) => entry.modelName === "ModelAttachment");
  for (const attachment of expanded) {
    await uploadAttachmentBody(attachment.expected, attachment.attachmentBody, { client });
    await client.upsert("ModelAttachment", attachment.expected);
  }
}

function applyConcurrency(defaultValue = 1) {
  const raw = process.env.PAPYRUS_APPLY_CONCURRENCY;
  if (!raw) return defaultValue;
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

function printCompactJson(payload) {
  console.log(JSON.stringify(payload));
}

function deleteAllJsonResult(result) {
  const deletedByModel = {};
  const skippedModels = [];
  let attachmentObjectsDeleted = 0;
  let bucket = null;
  for (const record of result) {
    deletedByModel[record.modelName] = record.deleted ?? 0;
    attachmentObjectsDeleted += record.attachmentObjectsDeleted ?? 0;
    if (record.skipped) skippedModels.push(record.modelName);
    if (record.bucket) bucket = record.bucket;
  }
  return {
    ok: true,
    command: "content delete all",
    deletedByModel,
    attachmentObjectsDeleted,
    skippedModels,
    bucket,
  };
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
  const allowedModels = new Set(["KnowledgeCorpus", "KnowledgeImportRun", "KnowledgeRawPayload", "ModelAttachment", "Reference", "ReferenceAttachment", "Message", "Assignment", "SemanticRelation"]);
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
  const createdAssignmentFacets = assignmentsWithSummarySection(createdAssignments);
  const createdMessages = createdByModel.get("Message") ?? [];
  const createdModelAttachments = createdByModel.get("ModelAttachment") ?? [];
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
      modelAttachments: createdModelAttachments.length,
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
        bySection: countDelta(createdAssignmentFacets, "summarySectionKey", "unsectioned"),
        statusBySection: nestedCountDelta(createdAssignmentFacets, "summarySectionKey", "status", "unsectioned", "unknown"),
        typeBySection: nestedCountDelta(createdAssignmentFacets, "summarySectionKey", "assignmentTypeKey", "unsectioned", "unknown"),
      },
      messages: {
        byKind: countDelta(createdMessages, "messageKind", "unknown"),
        byDomain: countDelta(createdMessages, "messageDomain", "unknown"),
        byStatus: countDelta(createdMessages, "status", "unknown"),
        domainByKind: nestedCountDelta(createdMessages, "messageKind", "messageDomain", "unknown", "unknown"),
      },
      modelAttachments: modelAttachmentFacetDelta(createdModelAttachments),
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
  console.error(`newsroom\tsummary-snapshot\tincremental\t${created.length} created records`);
}

async function updateNewsroomSummaryAfterAssignmentCreates(client, changes, { actorLabel = "Papyrus content CLI", reason = "assignment create" } = {}) {
  const createdByModel = new Map();
  for (const record of changes.filter((entry) => entry.action === "create")) {
    if (!createdByModel.has(record.modelName)) createdByModel.set(record.modelName, []);
    createdByModel.get(record.modelName).push(record.expected);
  }
  const createdAssignments = createdByModel.get("Assignment") ?? [];
  const createdAssignmentFacets = assignmentsWithSummarySection(createdAssignments);
  const createdEvents = createdByModel.get("AssignmentEvent") ?? [];
  const createdAttachments = createdByModel.get("ModelAttachment") ?? [];
  const createdRelations = createdByModel.get("SemanticRelation") ?? [];
  if (!createdAssignments.length && !createdEvents.length && !createdAttachments.length && !createdRelations.length) return;
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      assignments: createdAssignments.length,
      assignmentEvents: createdEvents.length,
      modelAttachments: createdAttachments.length,
      semanticRelations: createdRelations.length,
    },
    assignmentStatusDeltas: countDelta(createdAssignments, "status", "unknown"),
    assignmentTypeDeltas: countDelta(createdAssignments, "assignmentTypeKey", "unknown"),
    facetDeltas: {
      assignments: {
        byType: countDelta(createdAssignments, "assignmentTypeKey", "unknown"),
        statusByType: nestedCountDelta(createdAssignments, "assignmentTypeKey", "status", "unknown", "unknown"),
        bySection: countDelta(createdAssignmentFacets, "summarySectionKey", "unsectioned"),
        statusBySection: nestedCountDelta(createdAssignmentFacets, "summarySectionKey", "status", "unsectioned", "unknown"),
        typeBySection: nestedCountDelta(createdAssignmentFacets, "summarySectionKey", "assignmentTypeKey", "unsectioned", "unknown"),
      },
      semanticRelations: {
        byRelationTypeKey: countDelta(createdRelations, "relationTypeKey", "unknown"),
        byRelationDomain: countDelta(createdRelations, "relationDomain", "unknown"),
        bySubjectKind: countDelta(createdRelations, "subjectKind", "unknown"),
        byObjectKind: countDelta(createdRelations, "objectKind", "unknown"),
      },
      modelAttachments: modelAttachmentFacetDelta(createdAttachments),
    },
  }, {
    actorLabel,
    reason,
  });
  console.error(`newsroom\tsummary-snapshot\tincremental\tassignments=${createdAssignments.length}\tevents=${createdEvents.length}\trelations=${createdRelations.length}`);
}

async function updateNewsroomSummaryAfterResearchPacketCreates(client, changes, { actorLabel = "Papyrus content CLI", reason = "research packet create" } = {}) {
  const createdByModel = new Map();
  for (const record of changes.filter((entry) => entry.action === "create")) {
    if (!createdByModel.has(record.modelName)) createdByModel.set(record.modelName, []);
    createdByModel.get(record.modelName).push(record.expected);
  }
  const createdMessages = createdByModel.get("Message") ?? [];
  const createdAttachments = createdByModel.get("ModelAttachment") ?? [];
  const createdRelations = createdByModel.get("SemanticRelation") ?? [];
  if (!createdMessages.length && !createdAttachments.length && !createdRelations.length) return;
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      messages: createdMessages.length,
      modelAttachments: createdAttachments.length,
      semanticRelations: createdRelations.length,
    },
    facetDeltas: {
      messages: {
        byKind: countDelta(createdMessages, "messageKind", "unknown"),
        byDomain: countDelta(createdMessages, "messageDomain", "unknown"),
        byStatus: countDelta(createdMessages, "status", "unknown"),
        domainByKind: nestedCountDelta(createdMessages, "messageKind", "messageDomain", "unknown", "unknown"),
      },
      semanticRelations: {
        byRelationTypeKey: countDelta(createdRelations, "relationTypeKey", "unknown"),
        byRelationDomain: countDelta(createdRelations, "relationDomain", "unknown"),
        bySubjectKind: countDelta(createdRelations, "subjectKind", "unknown"),
        byObjectKind: countDelta(createdRelations, "objectKind", "unknown"),
      },
      modelAttachments: modelAttachmentFacetDelta(createdAttachments),
    },
  }, {
    actorLabel,
    reason,
  });
  console.error(`newsroom\tsummary-snapshot\tincremental\tmessages=${createdMessages.length}\trelations=${createdRelations.length}`);
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
  const createdArtifacts = createdByModel.get("KnowledgeArtifact") ?? [];
  const createdAttachments = createdByModel.get("ModelAttachment") ?? [];
  const semanticNodeDelta = currentSemanticNodeDeltaFromChanges(changes);
  const semanticRelationDelta = currentSemanticRelationDeltaFromChanges(changes);
  if (!createdImportRuns.length
    && !createdCategorySets.length
    && !createdCategories.length
    && !createdProposals.length
    && !createdArtifacts.length
    && !createdAttachments.length
    && !semanticNodeDelta.count
    && !semanticRelationDelta.count) {
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
      artifacts: createdArtifacts.length,
      modelAttachments: createdAttachments.length,
      semanticNodes: semanticNodeDelta.count,
      semanticRelations: semanticRelationDelta.count,
    },
    facetDeltas: {
      imports: {
        byCorpus: countDelta(createdImportRuns, "corpusId", "unknown"),
      },
      modelAttachments: modelAttachmentFacetDelta(createdAttachments),
      semanticNodes: semanticNodeDelta.facets,
      semanticRelations: semanticRelationDelta.facets,
    },
  }, {
    actorLabel,
    reason,
  });
  console.log(`newsroom\tsummary-snapshot\tincremental\tanalysis-import\truns=${createdImportRuns.length}\tartifacts=${createdArtifacts.length}\tproposals=${createdProposals.length}\tnodes=${semanticNodeDelta.count}\trelations=${semanticRelationDelta.count}`);
}

function currentSemanticNodeDeltaFromChanges(changes = []) {
  const delta = {
    count: 0,
    facets: { byNodeKind: {}, byStatus: {}, byCorpus: {}, byCategorySet: {} },
  };
  for (const change of changes.filter((entry) => entry.modelName === "SemanticNode" && entry.action !== "noop")) {
    applySemanticNodeContribution(delta, change.current, -1);
    applySemanticNodeContribution(delta, change.expected, 1);
  }
  return delta;
}

function applySemanticNodeContribution(delta, node, amount) {
  if (!node || node.versionState !== "current") return;
  delta.count += amount;
  incrementObject(delta.facets.byNodeKind, stringFacetValue(node.nodeKind, "unknown"), amount);
  incrementObject(delta.facets.byStatus, stringFacetValue(node.status, "unknown"), amount);
  incrementObject(delta.facets.byCorpus, stringFacetValue(node.corpusId, "unknown"), amount);
  incrementObject(delta.facets.byCategorySet, stringFacetValue(node.categorySetId, "unknown"), amount);
}

function currentSemanticRelationDeltaFromChanges(changes = []) {
  const delta = {
    count: 0,
    facets: { byRelationTypeKey: {}, byRelationDomain: {}, bySubjectKind: {}, byObjectKind: {} },
  };
  for (const change of changes.filter((entry) => entry.modelName === "SemanticRelation" && entry.action !== "noop")) {
    applySemanticRelationContribution(delta, change.current, -1);
    applySemanticRelationContribution(delta, change.expected, 1);
  }
  return delta;
}

function applySemanticRelationContribution(delta, relation, amount) {
  if (!relation || relation.relationState !== "current") return;
  delta.count += amount;
  incrementObject(delta.facets.byRelationTypeKey, stringFacetValue(relation.relationTypeKey ?? relation.predicate, "unknown"), amount);
  incrementObject(delta.facets.byRelationDomain, stringFacetValue(relation.relationDomain, "unknown"), amount);
  incrementObject(delta.facets.bySubjectKind, stringFacetValue(relation.subjectKind, "unknown"), amount);
  incrementObject(delta.facets.byObjectKind, stringFacetValue(relation.objectKind, "unknown"), amount);
}

function incrementObject(target, key, amount) {
  target[key] = (target[key] ?? 0) + amount;
}

function stringFacetValue(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

function modelAttachmentFacetDelta(attachments) {
  return {
    byOwnerKind: countDelta(attachments, "ownerKind", "unknown"),
    byRole: countDelta(attachments, "role", "unknown"),
    byMediaType: countDelta(attachments, "mediaType", "unknown"),
    byStatus: countDelta(attachments, "status", "unknown"),
  };
}

function assignmentEventMetadataAttachmentFacetDelta() {
  return {
    byOwnerKind: { assignmentEvent: 1 },
    byRole: { metadata: 1 },
    byMediaType: { "application/json": 1 },
    byStatus: { active: 1 },
  };
}

function assignmentsWithSummarySection(assignments) {
  return assignments.map((assignment) => ({
    ...assignment,
    summarySectionKey: assignmentSectionKey(assignment) ?? "unsectioned",
  }));
}

function buildReferenceAnalysisManifest({ corpusConfig, corpusId, references, attachments }) {
  const acceptedReferences = references
    .filter((reference) => reference.corpusId === corpusId)
    .filter(isCurrentAcceptedReference)
    .sort(compareReferencesForExport);
  const missingSource = acceptedReferences.filter((reference) => !sourceStoragePathForReference(reference, attachments));
  if (missingSource.length) {
    const examples = missingSource.slice(0, 5).map((reference) => `${reference.id}:${reference.sourceUri ?? "no-source-uri"}`).join(", ");
    throw new Error(`Cannot export analysis manifest: ${missingSource.length} accepted current references in ${corpusId} lack corpus source material. Run references source-status and accession URL-only references first. Examples: ${examples}`);
  }
  const missingText = acceptedReferences.filter((reference) => !textStoragePathForReference(reference, attachments));
  if (missingText.length) {
    const examples = missingText.slice(0, 5).map((reference) => `${reference.id}:${reference.externalItemId ?? "no-item-id"}`).join(", ");
    throw new Error(`Cannot export analysis manifest: ${missingText.length} accepted current references in ${corpusId} lack snapshot-backed extracted_text attachments. Run references source-status, references extract-text-now, or references attach-extracted-text first. Examples: ${examples}`);
  }
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

function normalizeSourceStatusFilter(value) {
  const normalized = String(value ?? "all").trim().toLowerCase();
  if (["pending", "accepted", "rejected", "archived", "all"].includes(normalized)) return normalized;
  throw new Error("--status must be pending, accepted, rejected, archived, or all.");
}

function nextReferenceSourceCommand(row) {
  if (row.state === SOURCE_READINESS_STATES.URL_ONLY) {
    return `npm run content -- references accession-now --reference ${row.reference.id}`;
  }
  if (row.readiness.textState === SOURCE_TEXT_STATES.SNAPSHOT_EXTRACTED) {
    return "run references attach-extracted-text for this corpus";
  }
  if (row.state === SOURCE_READINESS_STATES.EXTRACTABLE) {
    return "run references extract-text-now for this corpus";
  }
  if (row.state === SOURCE_READINESS_STATES.BLOCKED) {
    return "add sourceUri or corpus storagePath before extraction";
  }
  return "-";
}

function printReferenceAccessionAssignmentSummary(rows, changes, { apply }) {
  const modelCounts = changes.reduce((memo, record) => {
    memo[record.modelName] = (memo[record.modelName] ?? 0) + 1;
    return memo;
  }, {});
  const actionCounts = changes.reduce((memo, record) => {
    memo[record.action] = (memo[record.action] ?? 0) + 1;
    return memo;
  }, {});
  console.log(`references\tcreate-accession-assignments\tcandidates\t${rows.length}`);
  console.log(`references\tcreate-accession-assignments\tmodels\t${Object.entries(modelCounts).sort(([left], [right]) => left.localeCompare(right)).map(([model, count]) => `${model}=${count}`).join(" ")}`);
  console.log(`references\tcreate-accession-assignments\tsummary\tcreate=${actionCounts.create ?? 0}\tupdate=${actionCounts.update ?? 0}\tnoop=${actionCounts.noop ?? 0}`);
  console.log(`references\tcreate-accession-assignments\tapply\t${apply ? "yes" : "no"}`);
  const changed = changes.filter((entry) => entry.action !== "noop");
  const printLimit = 25;
  for (const change of changed.slice(0, printLimit)) {
    console.log(`${change.action}\t${change.modelName}\t${change.expected.id}`);
  }
  if (changed.length > printLimit) {
    console.log(`references\tcreate-accession-assignments\tomitted\t${changed.length - printLimit}\tshowing first ${printLimit} planned changes`);
  }
}

function findReferenceForSourceAccession(references, selector) {
  const selected = String(selector ?? "");
  return references.find((reference) => reference.id === selected)
    ?? references.find((reference) => reference.lineageId === selected && reference.versionState === "current")
    ?? references.find((reference) => reference.externalItemId === selected && reference.versionState === "current")
    ?? null;
}

function requireCorpusConfigByIdOrKey(steeringConfig, corpusId, corpusKey) {
  if (corpusKey) return requireCorpusConfig(steeringConfig, corpusKey, "--corpus-key");
  const match = (steeringConfig.corpora ?? []).find((corpus) => knowledgeCorpusId(corpus) === corpusId);
  if (!match) throw new Error(`Could not resolve corpus config for ${corpusId}; pass --corpus-key.`);
  return match;
}

function buildReferenceAccessionAssignmentRecords(rows, { corpusConfig, corpusId, assignments = [], actorLabel, now }) {
  const records = [];
  for (const row of rows) {
    const reference = row.reference;
    if (row.state !== SOURCE_READINESS_STATES.URL_ONLY) continue;
    if (activeReferenceAccessionAssignment(assignments, reference, corpusId)) continue;
    const assignment = referenceAccessionAssignmentRecord(reference, row.readiness, {
      corpusConfig,
      corpusId,
      actorLabel,
      now,
    });
    records.push(
      { modelName: "Assignment", expected: assignment },
      { modelName: "AssignmentEvent", expected: assignmentCreatedEventRecord(assignment, actorLabel, now) },
      { modelName: "SemanticRelation", expected: localSemanticRelationRecord({
        predicate: "requests_work_on",
        subjectKind: "assignment",
        subjectId: assignment.id,
        subjectLineageId: assignment.id,
        subjectVersionNumber: null,
        objectKind: "reference",
        objectId: reference.id,
        objectLineageId: reference.lineageId,
        objectVersionNumber: reference.versionNumber,
        rank: 1,
        importRunId: null,
        importedAt: now,
        metadata: {
          kind: "reference.corpus-accession.requests_work_on",
          sourceReadinessBefore: row.readiness.state,
        },
      }) },
    );
  }
  return records;
}

function referenceTextExtractionAssignmentRecord({ corpusConfig, corpusId, actorLabel, now, options, runId }) {
  const assignmentTypeKey = "reference.text-extraction";
  const queueKey = `${assignmentTypeKey}#${corpusId}`;
  const policy = getAssignmentTypePolicy(assignmentTypeKey);
  const stages = normalizeExtractionStages(options.stage);
  const metadata = {
    kind: "reference.text-extraction.requested",
    runId,
    corpusKey: corpusConfig.key,
    corpusId,
    corpusPath: corpusConfig.path,
    expectedStoragePrefix: corpusConfig.s3Prefix ?? null,
    extractionPipeline: options.configuration ? null : stages,
    extractionConfigurationPath: options.configuration ?? null,
    options: pruneUndefined({
      configuration: options.configuration,
      stage: stages,
      force: parseBooleanOption(options.force, false, "--force"),
      "max-workers": normalizeCliPositiveInteger(options["max-workers"], "--max-workers"),
    }),
    instructions: "Run Biblicus text extraction against accessioned corpus source files, then register snapshot-backed extracted_text ReferenceAttachment rows. Do not copy extracted text into GraphQL.",
    assignmentTypePolicy: policy,
  };
  return {
    id: `assignment-reference-text-extraction-${hashShort([corpusId, runId])}`,
    assignmentTypeKey,
    queueKey,
    queueStatusKey: `${queueKey}#open`,
    status: "open",
    priority: 0,
    title: `Extract reference text for ${corpusConfig.key}`,
    brief: `Run Biblicus extraction for ${corpusConfig.key} and register extracted text attachments.`,
    instructions: metadata.instructions,
    metadata: JSON.stringify(metadata),
    assigneeType: null,
    assigneeId: null,
    assigneeKey: null,
    claimedAt: null,
    claimExpiresAt: null,
    completedAt: null,
    canceledAt: null,
    corpusId,
    categorySetId: null,
    classifierId: null,
    sourceSnapshotId: null,
    importRunId: null,
    createdBy: actorLabel ?? "papyrus-content-cli",
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: "assignments",
  };
}

function activeReferenceAccessionAssignment(assignments, reference, corpusId) {
  const expectedId = referenceAccessionAssignmentId(reference, corpusId);
  return assignments.some((assignment) => (
    assignment.id === expectedId
  ));
}

function referenceAccessionAssignmentId(reference, corpusId) {
  return `assignment-reference-corpus-accession-${hashShort([corpusId, reference.lineageId])}`;
}

function referenceAccessionAssignmentRecord(reference, readiness, { corpusConfig, corpusId, actorLabel, now }) {
  const assignmentTypeKey = "reference.corpus-accession";
  const queueKey = `${assignmentTypeKey}#${corpusId}`;
  const policy = getAssignmentTypePolicy(assignmentTypeKey);
  const biblicusItemId = isUuidString(reference.externalItemId)
    ? reference.externalItemId
    : deterministicUuid(`papyrus-reference-accession:${reference.lineageId}`);
  const accessionMode = isUuidString(reference.externalItemId)
    ? "update-current-lineage"
    : "create-uuid-replacement";
  return {
    id: referenceAccessionAssignmentId(reference, corpusId),
    assignmentTypeKey,
    queueKey,
    queueStatusKey: `${queueKey}#open`,
    status: "open",
    priority: 60,
    title: reference.title ? `Accession source: ${reference.title}` : `Accession source ${reference.externalItemId}`,
    brief: "Materialize this URL-only reference prospect into the configured Biblicus corpus so extraction and analysis can use durable source material.",
    instructions: "Download the source URI into the corpus accession, write a Biblicus sidecar, run Biblicus reindex, update Reference source metadata, and do not copy source text into GraphQL.",
    assigneeType: null,
    assigneeId: null,
    assigneeKey: null,
    claimedAt: null,
    claimExpiresAt: null,
    completedAt: null,
    canceledAt: null,
    corpusId,
    categorySetId: null,
    classifierId: null,
    sourceSnapshotId: null,
    importRunId: null,
    createdBy: actorLabel ?? "papyrus-content-cli",
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: "assignments",
    metadata: JSON.stringify({
      kind: "reference.corpus-accession.requested",
      referenceId: reference.id,
      referenceLineageId: reference.lineageId,
      sourceUri: reference.sourceUri,
      corpusKey: corpusConfig.key,
      corpusId,
      corpusPath: corpusConfig.path,
      expectedStoragePrefix: `${String(corpusConfig.path ?? "").replace(/\/+$/g, "")}/imports/`,
      s3Prefix: corpusConfig.s3Prefix ?? null,
      accessionMode,
      biblicusItemId,
      sourceReadinessBefore: readiness.state,
      assignmentTypePolicy: policy,
    }),
  };
}

function assignmentCreatedEventRecord(assignment, actorLabel, now) {
  return {
    id: `assignment-event-${assignment.id}-created`,
    assignmentId: assignment.id,
    assignmentTypeKey: assignment.assignmentTypeKey,
    queueKey: assignment.queueKey,
    eventType: "created",
    fromStatus: null,
    toStatus: assignment.status,
    actorSub: null,
    actorLabel: actorLabel ?? "papyrus-content-cli",
    note: assignment.brief ?? null,
    createdAt: now,
    metadata: JSON.stringify({
      kind: `${assignment.assignmentTypeKey}.created`,
      source: "content-cli",
    }),
  };
}

function localSemanticRelationRecord(input) {
  const subjectStateKey = semanticStateKey(input.subjectKind, input.subjectLineageId);
  const objectStateKey = semanticStateKey(input.objectKind, input.objectLineageId);
  const subjectVersionKey = `${input.subjectKind}#${input.subjectId}`;
  const objectVersionKey = `${input.objectKind}#${input.objectId}`;
  return {
    id: `semantic-relation-${hashShort([
      subjectVersionKey,
      input.predicate,
      objectVersionKey,
      input.rank ?? "",
      input.classifierId ?? "",
      input.modelVersion ?? "",
    ])}`,
    relationState: "current",
    predicate: input.predicate,
    ...semanticRelationTypeFieldsForPredicate(input.predicate),
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    subjectLineageId: input.subjectLineageId,
    subjectVersionNumber: input.subjectVersionNumber ?? null,
    objectKind: input.objectKind,
    objectId: input.objectId,
    objectLineageId: input.objectLineageId,
    objectVersionNumber: input.objectVersionNumber ?? null,
    subjectStateKey,
    objectStateKey,
    objectSubjectStateKey: `${objectStateKey}#${input.subjectKind}`,
    predicateObjectStateKey: `${input.predicate}#${objectStateKey}`,
    subjectVersionKey,
    objectVersionKey,
    score: input.score ?? input.confidence ?? 1,
    confidence: input.confidence ?? null,
    rank: input.rank ?? null,
    classifierId: input.classifierId ?? null,
    modelVersion: input.modelVersion ?? null,
    reviewRecommended: Boolean(input.reviewRecommended),
    sourceSnapshotId: input.sourceSnapshotId ?? null,
    importRunId: input.importRunId ?? null,
    importedAt: input.importedAt ?? null,
    createdAt: input.createdAt ?? input.importedAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? input.importedAt ?? new Date().toISOString(),
    newsroomFeedKey: "semanticRelations",
    metadata: JSON.stringify(input.metadata ?? {}),
  };
}

async function downloadReferenceSourceMaterial(reference, { biblicusItemId, runDir }) {
  const downloadUri = sourceDownloadUriForReference(reference);
  const response = await fetch(downloadUri, {
    headers: {
      "user-agent": "papyrus-reference-accession/1",
    },
  });
  if (!response.ok) {
    throw createReferenceAccessionError(`Failed to download ${downloadUri}: ${response.status} ${response.statusText}.`, {
      kind: "download_failed",
    });
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || mediaTypeFromUrl(downloadUri) || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw createReferenceAccessionError(`Downloaded source for ${reference.id} was empty.`, {
      kind: "download_empty",
    });
  }
  const filename = referenceAccessionFilename({
    itemId: biblicusItemId,
    sourceUri: downloadUri,
    title: reference.title,
    mediaType: contentType,
  });
  const downloadPath = path.join(runDir, filename);
  fs.writeFileSync(downloadPath, buffer);
  return {
    buffer,
    downloadPath,
    filename,
    downloadUri,
    mediaType: contentType,
    byteSize: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function writeReferenceSourceAccession({ reference, sourceMaterial, corpusConfig, corpusPath, biblicusItemId, actorLabel }) {
  const importsDir = path.join(corpusPath, "imports");
  fs.mkdirSync(importsDir, { recursive: true });
  const localPath = path.join(importsDir, sourceMaterial.filename);
  fs.copyFileSync(sourceMaterial.downloadPath, localPath);
  const relpath = path.relative(corpusPath, localPath).split(path.sep).join("/");
  const storagePath = `${String(corpusConfig.path).replace(/\/+$/g, "")}/${relpath}`;
  const sidecarPath = `${localPath}.biblicus.yml`;
  const sidecar = {
    title: reference.title ?? undefined,
    authors: Array.isArray(reference.authors) ? reference.authors : undefined,
    media_type: sourceMaterial.mediaType,
    biblicus: {
      id: biblicusItemId,
      source: reference.sourceUri,
    },
    dates: {
      published_at: reference.sourcePublishedAt ?? undefined,
      updated_at: reference.sourceUpdatedAt ?? undefined,
      retrieved_at: reference.retrievedAt ?? new Date().toISOString(),
    },
    papyrus: {
      reference_id: reference.id,
      reference_lineage_id: reference.lineageId,
      download_uri: sourceMaterial.downloadUri,
      accessioned_by: actorLabel ?? "papyrus-content-cli",
      accessioned_at: new Date().toISOString(),
    },
  };
  fs.writeFileSync(sidecarPath, YAML.stringify(pruneUndefined(sidecar)), "utf8");
  return {
    biblicusItemId,
    localPath,
    sidecarPath,
    relpath,
    storagePath,
    sourceUri: reference.sourceUri,
    mediaType: sourceMaterial.mediaType,
    byteSize: sourceMaterial.byteSize,
    sha256: sourceMaterial.sha256,
  };
}

function runBiblicusReindexForAccession({ corpusPath, biblicusWorkdir, runDir }) {
  const stdoutLogPath = path.join(runDir, "biblicus-reindex.stdout.log");
  const stderrLogPath = path.join(runDir, "biblicus-reindex.stderr.log");
  const result = spawnSync("uv", ["run", "biblicus", "reindex", "--corpus", corpusPath], {
    cwd: biblicusWorkdir,
    encoding: "utf8",
  });
  fs.writeFileSync(stdoutLogPath, result.stdout ?? "", "utf8");
  fs.writeFileSync(stderrLogPath, result.stderr ?? "", "utf8");
  if (result.error || result.status !== 0) {
    throw createReferenceAccessionError(`Biblicus reindex failed for ${corpusPath}. See ${stderrLogPath}.`, {
      kind: "biblicus_reindex_failed",
      commandResult: {
        label: "biblicus-reindex",
        stdoutLogPath,
        stderrLogPath,
        exitStatus: result.status,
        signal: result.signal ?? null,
      },
      stdoutLogPaths: [stdoutLogPath],
      stderrLogPaths: [stderrLogPath],
    });
  }
  return {
    label: "biblicus-reindex",
    stdoutLogPath,
    stderrLogPath,
    exitStatus: result.status,
    signal: result.signal ?? null,
  };
}

function maybeSyncAccessionToS3({ corpusConfig, corpusPath, runDir, options }) {
  return maybeSyncCorpusToS3({
    corpusConfig,
    corpusPath,
    runDir,
    options,
    reason: "source accession material",
  });
}

function maybeSyncCorpusToS3({ corpusConfig, corpusPath, runDir, options, reason = "corpus material" }) {
  if (!options["sync-s3"] && !options["sync-s3-apply"]) {
    return {
      skipped: true,
      reason: "pass --sync-s3 for dry-run and --sync-s3-apply for actual sync",
    };
  }
  if (!corpusConfig.s3Prefix) throw new Error(`Corpus ${corpusConfig.key} does not define s3Prefix.`);
  fs.mkdirSync(runDir, { recursive: true });
  const dryRunLogPath = path.join(runDir, "s3-sync-dryrun.stdout.log");
  const dryRun = spawnSync("aws", [
    "s3", "sync",
    corpusPath,
    corpusConfig.s3Prefix,
    "--exclude", ".DS_Store",
    "--exclude", "*/.DS_Store",
    "--dryrun",
  ], { encoding: "utf8" });
  fs.writeFileSync(dryRunLogPath, dryRun.stdout ?? "", "utf8");
  if (dryRun.error || dryRun.status !== 0) {
    throw createReferenceAccessionError(`S3 sync dry-run failed. See ${dryRunLogPath}.`, {
      kind: "s3_sync_dryrun_failed",
    });
  }
  if (!options["sync-s3-apply"]) {
    return {
      skipped: true,
      dryRunLogPath,
      reason: `dry-run completed; pass --sync-s3-apply to sync ${reason}`,
    };
  }
  const stdoutLogPath = path.join(runDir, "s3-sync.stdout.log");
  const stderrLogPath = path.join(runDir, "s3-sync.stderr.log");
  const result = spawnSync("aws", [
    "s3", "sync",
    corpusPath,
    corpusConfig.s3Prefix,
    "--exclude", ".DS_Store",
    "--exclude", "*/.DS_Store",
  ], { encoding: "utf8" });
  fs.writeFileSync(stdoutLogPath, result.stdout ?? "", "utf8");
  fs.writeFileSync(stderrLogPath, result.stderr ?? "", "utf8");
  if (result.error || result.status !== 0) {
    throw createReferenceAccessionError(`S3 sync failed. See ${stderrLogPath}.`, {
      kind: "s3_sync_failed",
      stdoutLogPaths: [stdoutLogPath],
      stderrLogPaths: [stderrLogPath],
    });
  }
  return {
    skipped: false,
    dryRunLogPath,
    stdoutLogPath,
    stderrLogPath,
  };
}

function buildReferenceAccessionGraphqlRecords({ reference, corpusConfig, corpusId, importRunId, accession, sourceMaterial, metadata, actorLabel }) {
  const now = new Date().toISOString();
  const replacementMode = metadata.accessionMode === "create-uuid-replacement";
  const nextReference = replacementMode
    ? newReferenceForAccessionReplacement(reference, corpusId, importRunId, accession, actorLabel, now)
    : nextReferenceVersionForAccession(reference, importRunId, accession, actorLabel, now);
  const records = [
    { modelName: "KnowledgeImportRun", expected: {
      id: importRunId,
      corpusId,
      importKind: "reference-corpus-accession",
      classifierId: null,
      sourceSnapshotId: null,
      status: "imported",
      generatedAt: now,
      importedAt: now,
      itemCount: 1,
      categoryCount: 0,
      proposalCount: 0,
      artifactCount: 0,
      referenceCount: 1,
      relationCount: replacementMode ? 1 : 0,
      warningCount: 0,
    } },
    { modelName: "KnowledgeRawPayload", expected: {
      id: `knowledge-raw-payload-${safeId(importRunId)}-reference-accession`,
      ownerType: "importRun",
      ownerId: importRunId,
      payloadKind: "reference-corpus-accession",
      importRunId,
      payload: JSON.stringify({
        snapshot_kind: "papyrus-reference-corpus-accession",
        reference_id: reference.id,
        reference_lineage_id: reference.lineageId,
        source_uri: reference.sourceUri,
        storage_path: accession.storagePath,
        media_type: accession.mediaType,
        byte_size: accession.byteSize,
        sha256: accession.sha256,
        biblicus_item_id: accession.biblicusItemId,
      }),
      createdAt: now,
      updatedAt: now,
    } },
    { modelName: "Reference", expected: nextReference },
    { modelName: "ReferenceAttachment", expected: referenceAttachmentForAccession(nextReference, accession, importRunId, now) },
  ];
  if (replacementMode) {
    records.push({ modelName: "SemanticRelation", expected: localSemanticRelationRecord({
      predicate: "derived_from",
      subjectKind: "reference",
      subjectId: nextReference.id,
      subjectLineageId: nextReference.lineageId,
      subjectVersionNumber: nextReference.versionNumber,
      objectKind: "reference",
      objectId: reference.id,
      objectLineageId: reference.lineageId,
      objectVersionNumber: reference.versionNumber,
      rank: 1,
      importRunId,
      importedAt: now,
      metadata: {
        kind: "reference.corpus-accession.replacement",
        replacedExternalItemId: reference.externalItemId,
      },
    }) });
  }
  return records;
}

function nextReferenceVersionForAccession(reference, importRunId, accession, actorLabel, now) {
  const metadata = {
    ...parseJsonish(reference.metadata),
    source_readiness: "accessioned",
    accessioned_at: now,
    accessioned_by: actorLabel,
    accession_import_run_id: importRunId,
  };
  return {
    ...reference,
    id: `${reference.lineageId}-v1`,
    importRunId,
    importedAt: now,
    storagePath: accession.storagePath,
    mediaType: accession.mediaType,
    byteSize: accession.byteSize,
    sha256: accession.sha256,
    retrievedAt: reference.retrievedAt ?? now,
    metadata: JSON.stringify(metadata),
    updatedAt: now,
    contentHash: hashShort({
      referenceId: reference.id,
      storagePath: accession.storagePath,
      mediaType: accession.mediaType,
      byteSize: accession.byteSize,
      sha256: accession.sha256,
      curationStatus: reference.curationStatus,
    }),
    versionCreatedAt: now,
    versionCreatedBy: actorLabel,
    changeReason: "reference-corpus-accession",
  };
}

function newReferenceForAccessionReplacement(reference, corpusId, importRunId, accession, actorLabel, now) {
  const lineageId = `reference-${safeId(corpusId)}-${safeId(accession.biblicusItemId)}`;
  const metadata = {
    ...parseJsonish(reference.metadata),
    source_readiness: "accessioned",
    accessioned_at: now,
    accessioned_by: actorLabel,
    accession_import_run_id: importRunId,
    replaced_reference_id: reference.id,
    replaced_reference_lineage_id: reference.lineageId,
    replaced_external_item_id: reference.externalItemId,
  };
  const next = {
    ...reference,
    id: `${lineageId}-v1`,
    lineageId,
    versionNumber: 1,
    previousVersionId: null,
    versionState: "current",
    versionCreatedAt: now,
    versionCreatedBy: actorLabel,
    changeReason: "reference-corpus-accession-replacement",
    externalItemId: accession.biblicusItemId,
    corpusId,
    importRunId,
    importedAt: now,
    storagePath: accession.storagePath,
    mediaType: accession.mediaType,
    byteSize: accession.byteSize,
    sha256: accession.sha256,
    retrievedAt: reference.retrievedAt ?? now,
    curationStatus: reference.curationStatus ?? "pending",
    curationStatusKey: `${corpusId}#${reference.curationStatus ?? "pending"}`,
    metadata: JSON.stringify(metadata),
    updatedAt: now,
  };
  next.contentHash = hashShort({
    referenceId: next.id,
    storagePath: next.storagePath,
    mediaType: next.mediaType,
    byteSize: next.byteSize,
    sha256: next.sha256,
    curationStatus: next.curationStatus,
  });
  return next;
}

function referenceAttachmentForAccession(reference, accession, importRunId, now) {
  const referenceVersionKey = `reference#${reference.id}`;
  return {
    id: `reference-attachment-${hashShort([referenceVersionKey, "source", "001-source", accession.storagePath])}`,
    referenceId: reference.id,
    referenceLineageId: reference.lineageId,
    referenceVersionNumber: reference.versionNumber,
    referenceVersionKey,
    role: "source",
    sortKey: "001-source",
    storagePath: accession.storagePath,
    sourceUri: accession.sourceUri,
    filename: path.basename(accession.localPath),
    mediaType: accession.mediaType,
    byteSize: accession.byteSize,
    sha256: accession.sha256,
    etag: null,
    importRunId,
    importedAt: now,
    metadata: JSON.stringify({
      source: "reference.corpus-accession",
      localPath: accession.localPath,
      sidecarPath: accession.sidecarPath,
      biblicusItemId: accession.biblicusItemId,
    }),
  };
}

function buildExtractedTextAttachmentRecords({ corpusConfig, corpusId, references, attachments, extractionIndex }) {
  return buildExtractedTextAttachmentPlans({
    corpusConfig,
    corpusId,
    references,
    attachments,
    extractionIndex,
  })
    .map((plan) => plan.record)
    .filter(Boolean);
}

function buildExtractedTextAttachmentPlans({ corpusConfig, corpusId, references, attachments, extractionIndex }) {
  const now = new Date().toISOString();
  const plans = [];
  const seenLineages = new Set();
  const currentReferences = references
    .filter((entry) => entry.corpusId === corpusId)
    .filter((entry) => entry.versionState === "current")
    .filter((entry) => entry.externalItemId && extractionIndex.textByItemId?.has(entry.externalItemId))
    .sort(compareReferenceVersionsByFreshness);
  for (const reference of currentReferences) {
    if (seenLineages.has(reference.lineageId)) continue;
    seenLineages.add(reference.lineageId);
    const extracted = extractionIndex.textByItemId.get(reference.externalItemId);
    const storagePath = extracted.storagePath;
    if (!storagePath) continue;
    const existingTextAttachment = selectExtractedTextAttachment(reference, attachments);
    const key = [reference.lineageId, "extracted_text"].join("\n");
    let byteSize = null;
    let sha256 = null;
    try {
      const bytes = fs.readFileSync(extracted.localPath);
      byteSize = bytes.length;
      sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    } catch {
      // The row is skipped if the file disappears between scan and plan.
      continue;
    }
    const record = { modelName: "ReferenceAttachment", expected: {
        id: existingTextAttachment?.id ?? `reference-attachment-${hashShort(key)}`,
        referenceId: reference.id,
        referenceLineageId: reference.lineageId,
        referenceVersionNumber: reference.versionNumber,
        referenceVersionKey: `reference#${reference.id}`,
        role: "extracted_text",
        sortKey: "900-extracted-text",
        storagePath,
        sourceUri: null,
        filename: path.basename(extracted.localPath),
        mediaType: "text/plain",
        byteSize,
        sha256,
        etag: null,
        importRunId: null,
        importedAt: now,
        metadata: JSON.stringify({
          source: "biblicus-extraction-snapshot",
          extractorId: extracted.extractorId ?? "pipeline",
          snapshotId: extracted.snapshotId,
          extractionSnapshotId: extracted.snapshotId,
          finalTextRelpath: extracted.finalTextRelpath ?? null,
          finalMetadataRelpath: extracted.finalMetadataRelpath ?? null,
          configurationId: extracted.configurationId ?? null,
          configurationName: extracted.configurationName ?? null,
          finalProducerExtractorId: extracted.finalProducerExtractorId ?? null,
          finalStageExtractorId: extracted.finalStageExtractorId ?? null,
          finalStageIndex: extracted.finalStageIndex ?? null,
          finalSourceStageIndex: extracted.finalSourceStageIndex ?? null,
          textCharacters: extracted.textCharacters ?? null,
          extractionStatus: extracted.status ?? null,
          errorType: extracted.errorType ?? null,
          errorMessage: extracted.errorMessage ?? null,
          snapshotLocalPath: extracted.localPath,
        }),
      } };
    plans.push({
      reference,
      extracted,
      storagePath,
      byteSize,
      sha256,
      record,
    });
  }
  return plans;
}

function compareReferenceVersionsByFreshness(left, right) {
  return (Number(right.versionNumber) || 0) - (Number(left.versionNumber) || 0)
    || String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? ""))
    || String(right.id ?? "").localeCompare(String(left.id ?? ""));
}

function normalizeExtractionStages(value) {
  if (Array.isArray(value) && value.length) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return ["pass-through-text", "pdf-text", "metadata-text"];
}

function runBiblicusTextExtractionForCorpus({ corpusPath, biblicusWorkdir, runDir, options = {} }) {
  const stdoutLogPath = path.join(runDir, "biblicus-extract.stdout.log");
  const stderrLogPath = path.join(runDir, "biblicus-extract.stderr.log");
  const args = ["run", "--extra", "topic-modeling", "biblicus", "extract", "build", "--corpus", corpusPath];
  if (options.configuration) {
    args.push("--configuration", String(options.configuration));
  } else {
    for (const stage of normalizeExtractionStages(options.stage)) {
      args.push("--stage", stage);
    }
  }
  if (parseBooleanOption(options.force, false, "--force")) args.push("--force");
  const maxWorkers = normalizeCliPositiveInteger(options["max-workers"], "--max-workers");
  if (maxWorkers) args.push("--max-workers", String(maxWorkers));
  const uvArgs = ensureUvBiblicusExtras(args, ["topic-modeling"]);
  const result = spawnSync("uv", uvArgs, {
    cwd: biblicusWorkdir,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
  });
  fs.writeFileSync(stdoutLogPath, result.stdout ?? "", "utf8");
  fs.writeFileSync(stderrLogPath, result.stderr ?? "", "utf8");
  if (result.status !== 0) {
    throw createReferenceAccessionError(`Biblicus text extraction failed for ${corpusPath}. See ${stderrLogPath}.`, {
      runId: path.basename(runDir),
      manifestPath: path.join(runDir, "execution-manifest.json"),
      kind: "biblicus_text_extraction_failed",
      commandResult: {
        label: "biblicus-extract-build",
        executable: "uv",
        args: uvArgs,
        cwd: biblicusWorkdir,
        stdoutLogPath,
        stderrLogPath,
        exitStatus: result.status,
        signal: result.signal ?? null,
        timedOut: false,
      },
      stdoutLogPaths: [stdoutLogPath],
      stderrLogPaths: [stderrLogPath],
    });
  }
  return {
    label: "biblicus-extract-build",
    executable: "uv",
    args: uvArgs,
    cwd: biblicusWorkdir,
    stdoutLogPath,
    stderrLogPath,
    exitStatus: result.status,
    signal: result.signal ?? null,
    timedOut: false,
  };
}

function augmentReferenceAccessionChangesForReplacement(changes, { reference, accession, metadata }) {
  if (metadata.accessionMode !== "create-uuid-replacement") return changes;
  const now = new Date().toISOString();
  return [
    ...changes,
    {
      modelName: "Reference",
      current: reference,
      expected: {
        id: reference.id,
        curationStatus: "archived",
        curationStatusKey: `${reference.corpusId}#archived`,
        curationStatusUpdatedAt: now,
        curationStatusUpdatedBy: "papyrus-content-cli",
        curationStatusReason: `Replaced by corpus accession reference ${accession.biblicusItemId}.`,
        updatedAt: now,
      },
      action: "update",
    },
  ];
}

async function updateNewsroomSummaryAfterReferenceAccession(client, changes, { actorLabel = "Papyrus content CLI", reason = "reference accession" } = {}) {
  const createdByModel = new Map();
  for (const record of changes.filter((entry) => entry.action === "create")) {
    if (!createdByModel.has(record.modelName)) createdByModel.set(record.modelName, []);
    createdByModel.get(record.modelName).push(record.expected);
  }
  const createdRelations = createdByModel.get("SemanticRelation") ?? [];
  const createdModelAttachments = createdByModel.get("ModelAttachment") ?? [];
  const referenceDelta = computeCurrentReferenceDeltaFromChanges(changes);
  await client.updateNewsroomSummary({
    source: "incremental",
    latestImportRun: createdByModel.get("KnowledgeImportRun")?.[0] ?? null,
    countDeltas: {
      importRuns: createdByModel.get("KnowledgeImportRun")?.length ?? 0,
      referenceAttachments: createdByModel.get("ReferenceAttachment")?.length ?? 0,
      references: referenceDelta.countDelta,
      modelAttachments: createdModelAttachments.length,
      semanticRelations: createdRelations.length,
    },
    referenceStatusDeltas: referenceDelta.statusDeltas,
    facetDeltas: {
      references: {
        byCurationStatus: referenceDelta.statusDeltas,
        byCorpus: referenceDelta.corpusDeltas,
        statusByCorpus: referenceDelta.statusByCorpusDeltas,
      },
      modelAttachments: modelAttachmentFacetDelta(createdModelAttachments),
      semanticRelations: {
        byRelationTypeKey: countDelta(createdRelations, "relationTypeKey", "unknown"),
        byRelationDomain: countDelta(createdRelations, "relationDomain", "unknown"),
        bySubjectKind: countDelta(createdRelations, "subjectKind", "unknown"),
        byObjectKind: countDelta(createdRelations, "objectKind", "unknown"),
      },
      imports: {
        byCorpus: countDelta(createdByModel.get("KnowledgeImportRun") ?? [], "corpusId", "unknown"),
      },
    },
  }, {
    actorLabel,
    reason,
  });
  console.log(`newsroom\tsummary-snapshot\tincremental\treference-accession\treferences=${referenceDelta.countDelta}\tattachments=${createdByModel.get("ReferenceAttachment")?.length ?? 0}`);
}

async function updateNewsroomSummaryAfterExtractedTextAttachments(client, changes, { actorLabel = "Papyrus content CLI", reason = "extracted text attachments" } = {}) {
  const createdAttachments = changes
    .filter((entry) => entry.modelName === "ReferenceAttachment" && entry.action === "create")
    .map((entry) => entry.expected);
  if (!createdAttachments.length) return;
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      referenceAttachments: createdAttachments.length,
    },
  }, {
    actorLabel,
    reason,
  });
  console.log(`newsroom\tsummary-snapshot\tincremental\textracted-text-attachments=${createdAttachments.length}`);
}

function createReferenceAccessionError(message, artifacts = {}) {
  const error = new Error(message);
  attachAnalysisFailureArtifacts(error, artifacts);
  return error;
}

function resolveBiblicusWorkdir(options = {}) {
  const configured = normalizeCliString(options["biblicus-workdir"]) ?? normalizeCliString(process.env.BIBLICUS_WORKDIR);
  return path.resolve(configured ?? path.join(process.cwd(), "..", "Biblicus"));
}

function referenceAccessionFilename({ itemId, sourceUri, title, mediaType }) {
  const parsed = safeUrl(sourceUri);
  const uriPart = encodeURIComponent(sourceUri).slice(0, 100);
  const titlePart = safeId(title || parsed?.pathname?.split("/").filter(Boolean).pop() || "source").slice(0, 80);
  const ext = extensionForMediaType(mediaType, parsed?.pathname);
  return `${itemId}--${uriPart}--${titlePart}${ext}`;
}

function sourceDownloadUriForReference(reference) {
  const sourceUri = String(reference.sourceUri ?? "");
  const parsed = safeUrl(sourceUri);
  if (!parsed) return sourceUri;
  if ((parsed.hostname === "arxiv.org" || parsed.hostname === "www.arxiv.org") && parsed.pathname.startsWith("/abs/")) {
    const arxivId = parsed.pathname.replace(/^\/abs\//, "").replace(/\/+$/g, "");
    if (arxivId) return `https://arxiv.org/pdf/${arxivId}.pdf`;
  }
  return sourceUri;
}

function extensionForMediaType(mediaType, pathname = "") {
  const suffix = pathname ? path.extname(pathname).toLowerCase() : "";
  if (suffix && suffix.length <= 8) return suffix;
  const normalized = String(mediaType ?? "").toLowerCase();
  if (normalized === "application/pdf") return ".pdf";
  if (normalized === "text/html") return ".html";
  if (normalized === "text/markdown") return ".md";
  if (normalized.startsWith("text/")) return ".txt";
  if (normalized === "audio/mpeg" || normalized === "audio/mp3") return ".mp3";
  if (normalized === "audio/ogg") return ".ogg";
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return ".wav";
  if (normalized === "video/mp4") return ".mp4";
  return "";
}

function mediaTypeFromUrl(sourceUri) {
  const parsed = safeUrl(sourceUri);
  const suffix = parsed ? path.extname(parsed.pathname).toLowerCase() : "";
  if (suffix === ".pdf") return "application/pdf";
  if (suffix === ".html" || suffix === ".htm") return "text/html";
  if (suffix === ".md" || suffix === ".markdown") return "text/markdown";
  if (suffix === ".txt") return "text/plain";
  if (suffix === ".mp3") return "audio/mpeg";
  if (suffix === ".wav") return "audio/x-wav";
  if (suffix === ".ogg") return "audio/ogg";
  return null;
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function deterministicUuid(value) {
  const bytes = crypto.createHash("sha256").update(String(value)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function isUuidString(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function pruneUndefined(value) {
  if (Array.isArray(value)) return value.map(pruneUndefined).filter((entry) => entry !== undefined);
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      const pruned = pruneUndefined(entry);
      if (pruned !== undefined) next[key] = pruned;
    }
    return next;
  }
  return value === undefined || value === null ? undefined : value;
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

async function hydrateReferenceCurationMessages(client, messages, relations) {
  const curationMessageIds = new Set();
  for (const relation of relations) {
    if (relation.relationState !== "current") continue;
    if ((relation.relationTypeKey ?? relation.predicate) !== "comment") continue;
    if (relation.subjectKind !== "message" || relation.objectKind !== "reference") continue;
    curationMessageIds.add(relation.subjectId);
  }
  return Promise.all(messages.map(async (message) => {
    if (!curationMessageIds.has(message.id)) return message;
    const metadata = await readJsonModelPayload(client, "message", message.id, "metadata", "metadata");
    return metadata ? { ...message, metadata } : message;
  }));
}

async function hydrateRejectedReferenceMetadata(client, references) {
  return Promise.all(references.map(async (reference) => {
    if (normalizeReferenceCurationStatus(reference.curationStatus, "pending") !== "rejected") return reference;
    const metadata = await readJsonModelPayload(client, "reference", reference.id, "metadata", "metadata");
    return metadata ? { ...reference, metadata } : reference;
  }));
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

function deriveCategoryKeyFromText(value) {
  return slugify(String(value ?? "topic")).replace(/-/g, "_") || `topic_${hashShort(value).slice(0, 8)}`;
}

function deriveShortTitleFromText(value) {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ") || null;
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
    .filter((categorySet) => categorySet.status === "accepted")
    .filter((categorySet) => !categorySet.versionState || categorySet.versionState === "current");
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

async function scopedTopicDiscoveryImportRecords(client, records, { metadata, corpusId, classifierId }) {
  const categorySet = await resolveAcceptedCategorySet(client, {
    categorySetId: metadata.categorySetId || null,
    corpusId,
    classifierId,
  });
  if (!categorySet) return records;
  const categorySetId = categorySet.id;
  const remapped = [];
  for (const record of records) {
    if (record.modelName === "CategorySet" || record.modelName === "Category" || record.modelName === "SemanticNode") continue;
    const expected = record.expected ?? {};
    if (record.modelName === "KnowledgeRawPayload") {
      const ownerType = expected.ownerType ?? "";
      const payloadKind = expected.payloadKind ?? "";
      if (ownerType === "categorySet"
        || ownerType === "category"
        || ownerType === "categoryTree"
        || payloadKind === "biblicus-category-set"
        || payloadKind === "biblicus-category"
        || payloadKind === "biblicus-category-tree") {
        continue;
      }
    }
    if (record.modelName === "SteeringProposal") {
      remapped.push({
        ...record,
        expected: {
          ...expected,
          categorySetId,
        },
      });
      continue;
    }
    if (record.modelName === "CategoryKeyword") {
      const categoryKey = expected.categoryKey ?? "";
      const categoryLineageId = `category-${slugify(categorySetId)}-${slugify(categoryKey)}`;
      remapped.push({
        ...record,
        expected: {
          ...expected,
          id: `category-keyword-${slugify(categorySetId)}-${slugify(categoryKey)}-${slugify(expected.source ?? "source")}-${String(expected.rank ?? 999999).padStart(4, "0")}-${hashShort([expected.normalizedKeyword ?? expected.keyword ?? "", expected.sourceTopicId ?? ""])}`,
          categorySetId,
          categoryLineageId,
          categoryId: `${categoryLineageId}-v1`,
        },
      });
      continue;
    }
    remapped.push(record);
  }
  return remapped;
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
  const currentMetadata = await assignmentMetadata(client, current);
  const update = {
    id: assignmentId,
    assignmentTypeKey: current.assignmentTypeKey,
    queueKey: current.queueKey,
    status: nextStatus,
    queueStatusKey: `${current.queueKey}#${nextStatus}`,
    sectionId: current.sectionId ?? currentMetadata.sectionId ?? assignmentSectionKey(current) ?? null,
    sectionKey: assignmentSectionKey(current),
    sectionType: current.sectionType ?? currentMetadata.sectionType ?? null,
    sectionStatusKey: assignmentSectionStatusKey(current, nextStatus),
    sectionQueueStatusKey: assignmentSectionQueueStatusKey(current, nextStatus),
    primaryFocusCategoryKey: current.primaryFocusCategoryKey ?? currentMetadata.primaryFocusCategoryKey ?? currentMetadata.focusCategoryKey ?? null,
    topicScopeCategoryKeys: Array.isArray(current.topicScopeCategoryKeys) ? current.topicScopeCategoryKeys : Array.isArray(currentMetadata.topicScopeCategoryKeys) ? currentMetadata.topicScopeCategoryKeys : [],
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
  const eventId = `assignment-event-${assignmentId}-${now.replace(/[^0-9TZ]/g, "")}`;
  await client.upsert("AssignmentEvent", {
    id: eventId,
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
  });
  await upsertModelPayloadForExistingRecord(client, {
    modelName: "AssignmentEvent",
    expected: {
      id: eventId,
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
    },
  });
  const statusDeltas = current.status === nextStatus
    ? {}
    : { [current.status]: -1, [nextStatus]: 1 };
  const sectionKey = assignmentSectionKey(current) ?? "unsectioned";
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      assignmentEvents: 1,
      modelAttachments: 1,
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
        statusBySection: current.status === nextStatus
          ? {}
          : {
              [sectionKey]: {
                [current.status]: -1,
                [nextStatus]: 1,
              },
            },
      },
      modelAttachments: assignmentEventMetadataAttachmentFacetDelta(),
    },
  }, {
    actorLabel: actorLabel ?? options["assignee-key"] ?? options.assignee ?? authClaims.email ?? authClaims.sub ?? "jwt-worker",
    reason: `assignments ${action} ${assignmentId}`,
  });
  return {
    assignment: update,
    eventId,
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
  });
  await upsertModelPayloadForExistingRecord(client, {
    modelName: "AssignmentEvent",
    expected: {
      id: `assignment-event-${assignmentId}-failed-${timestampForPath(now)}`,
      createdAt: now,
      metadata: JSON.stringify({
        source: "content-cli",
        ...metadata,
      }),
    },
  });
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      assignmentEvents: 1,
      modelAttachments: 1,
    },
    facetDeltas: {
      modelAttachments: assignmentEventMetadataAttachmentFacetDelta(),
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
  const eventId = `assignment-event-${assignment.id}-${eventType}-${timestampForPath(now)}`;
  await client.upsert("AssignmentEvent", {
    id: eventId,
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
  });
  await upsertModelPayloadForExistingRecord(client, {
    modelName: "AssignmentEvent",
    expected: {
      id: eventId,
      createdAt: now,
      metadata: JSON.stringify({
        source: "content-cli",
        ...metadata,
      }),
    },
  });
  await client.updateNewsroomSummary({
    source: "incremental",
    countDeltas: {
      assignmentEvents: 1,
      modelAttachments: 1,
    },
    facetDeltas: {
      modelAttachments: assignmentEventMetadataAttachmentFacetDelta(),
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

function assignmentSectionKey(assignment) {
  return normalizeCliString(assignment?.sectionKey)
    ?? normalizeCliString(assignment?.sectionId)
    ?? null;
}

function assignmentSectionStatusKey(assignment, status = assignment?.status) {
  const sectionKey = assignmentSectionKey(assignment);
  const normalizedStatus = normalizeCliString(status) ?? "open";
  return sectionKey ? `${sectionKey}#${normalizedStatus}` : null;
}

function assignmentSectionQueueStatusKey(assignment, status = assignment?.status) {
  const sectionKey = assignmentSectionKey(assignment);
  const queueKey = normalizeCliString(assignment?.queueKey);
  const normalizedStatus = normalizeCliString(status) ?? "open";
  return sectionKey && queueKey ? `${sectionKey}#${queueKey}#${normalizedStatus}` : null;
}

function knowledgeImportRunCorpusKindKey(importRun) {
  const corpusId = normalizeCliString(importRun?.corpusId);
  const importKind = normalizeCliString(importRun?.importKind);
  return corpusId && importKind ? `${corpusId}#${importKind}` : null;
}

function assignmentSectionIndexPatch(assignment, { validSectionKeys = null } = {}) {
  let sectionKey = assignmentSectionKey(assignment);
  if (sectionKey && validSectionKeys && !validSectionKeys.has(sectionKey)) sectionKey = null;
  const status = normalizeCliString(assignment?.status) ?? "open";
  const queueKey = normalizeCliString(assignment?.queueKey);
  const topicScopeCategoryKeys = Array.isArray(assignment?.topicScopeCategoryKeys)
    ? assignment.topicScopeCategoryKeys.map((entry) => normalizeCliString(entry)).filter(Boolean)
    : [];
  return {
    sectionId: sectionKey ? (normalizeCliString(assignment?.sectionId) ?? sectionKey) : null,
    sectionKey,
    sectionType: normalizeSectionTypeForAssignment(assignment?.sectionType),
    sectionStatusKey: sectionKey ? `${sectionKey}#${status}` : null,
    sectionQueueStatusKey: sectionKey && queueKey ? `${sectionKey}#${queueKey}#${status}` : null,
    primaryFocusCategoryKey: normalizeCliString(assignment?.primaryFocusCategoryKey),
    topicScopeCategoryKeys,
  };
}

function normalizeSectionTypeForAssignment(value) {
  const normalized = normalizeCliString(value)?.toLowerCase() ?? null;
  if (normalized === "rotating") return "floating";
  return normalized;
}

function assignmentOperationalIndexPatch(assignment) {
  return assignmentSectionIndexPatch(assignment);
}

function assignmentOperationalIndexChanged(current, expected) {
  for (const key of ["sectionId", "sectionKey", "sectionType", "sectionStatusKey", "sectionQueueStatusKey", "primaryFocusCategoryKey"]) {
    if ((current[key] ?? null) !== (expected[key] ?? null)) return true;
  }
  const currentScope = Array.isArray(current.topicScopeCategoryKeys) ? current.topicScopeCategoryKeys.filter(Boolean) : [];
  const expectedScope = Array.isArray(expected.topicScopeCategoryKeys) ? expected.topicScopeCategoryKeys.filter(Boolean) : [];
  return stableJson(currentScope) !== stableJson(expectedScope);
}

function assignmentSectionIndexChanged(current, expected) {
  return assignmentOperationalIndexChanged(current, expected);
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

function normalizeCliNonNegativeInteger(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be zero or a positive integer.`);
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
  "ModelAttachment",
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
  "etag",
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

function safeId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140) || hashShort(value);
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

function mediaAssetMetadata(asset) {
  return {
    sourceUrl: asset.src,
    ...(asset.layout?.inlineFloat ? { inlineFloat: asset.layout.inlineFloat } : {}),
  };
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
  console.log("  npm run content -- content schema-check --type Assignment --fields sectionKey,sectionStatusKey,sectionQueueStatusKey");
  console.log("  npm run content -- content list articles");
  console.log("  npm run content -- content diff edition <edition-slug>");
  console.log("  npm run content -- content sync article <slug>");
  console.log("  npm run content -- content sync edition <edition-slug>");
  console.log("  npm run content -- content delete all --yes");
  console.log("  npm run content -- content delete all --yes --delete-attachments [--json]");
  console.log("  npm run content -- corpora status --config <steering.yml> [--corpus-key <key>] [--json]");
  console.log("  npm run content -- corpora worker-bootstrap --config <steering.yml> [--corpus-key <key>] [--json]");
  console.log("  npm run content -- corpora sync-from-cloud --config <steering.yml> --corpus-key <key> [--dry-run|--apply] [--include-analysis]");
  console.log("  npm run content -- corpora sync-to-cloud --config <steering.yml> --corpus-key <key> [--dry-run|--apply] [--include-analysis]");
  console.log("  npm run content -- newsroom prune-attachments [--apply] [--bucket <bucket>] [--prefix newsroom/payloads/] [--json]");
  console.log("  npm --silent run content -- newsroom prune-attachments --json");
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
  console.log("  npm run content -- categories review-proposal --proposal <steering-proposal-id> --action accept|reject --target-category-set <id> --apply");
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
  console.log("  npm run content -- references make-catalog --input <sources.md> --output <catalog.json>");
  console.log("  npm run content -- references discover-citation-led --config corpora/papyrus-steering.yml --anchor-corpus-key AI-ML-research --from-year 2023 --to-year 2026 --anchor-limit 40 --citations-per-anchor 12 --feed-limit 20");
  console.log("  npm run content -- references prepare-catalog --config <steering.yml> --corpus-key <key> --catalog <catalog.json> --output <prepared.json>");
  console.log("  npm run content -- references curate-recent --corpus-key <key> [--since-hours 48|--since 2026-05-20T00:00:00Z] [--reference <id> ...] [--max-count 25] [--scan-limit 1000] [--summary-max-tokens 500] [--refresh-summary] [--refresh-quality] [--dry-run|--apply] [--resume .papyrus-runs/reference-curation-<run>/manifest.json] [--json]");
  console.log("  npm run content -- references register-catalog --config <steering.yml> --corpus-key <key> --catalog <catalog.json> --status pending --ingestion-rationale <text> --apply");
  console.log("  npm run content -- references register-catalog --config <steering.yml> --corpus-key <key> --catalog <catalog.json> --status rejected --reason-code out_of_scope --note <text> --apply");
  console.log("  npm run content -- references register-catalog-split --config <steering.yml> --catalog <catalog.json> --research-corpus-key <key> --news-corpus-key <key> --status pending --apply");
  console.log("  npm run content -- references source-status --config <steering.yml> --corpus-key <key> --status all");
  console.log("  npm run content -- references create-accession-assignments --config <steering.yml> --corpus-key <key> --status pending --apply");
  console.log("  npm run content -- references accession-now --reference <reference-id> --assignee-key <worker-run-id>");
  console.log("  npm run content -- references extract-text-now --config <steering.yml> --corpus-key <key> --assignee-key <worker-run-id> --stage pass-through-text,pdf-text,metadata-text");
  console.log("  npm run content -- references attach-extracted-text --config <steering.yml> --corpus-key <key> --max-count 10 --apply");
  console.log("  npm run content -- references create-identifier-backfill-assignment --config <steering.yml> --corpus-key AI-ML-research --types doi,arxiv_id,isbn13,publisher_item --apply");
  console.log("  npm run content -- references identifier-backfill-now --config <steering.yml> --corpus-key AI-ML-research --types doi,arxiv_id --only-missing true --progress-every 25 --write-chunk-size 100 --use-llm false");
  console.log("  npm run content -- references execute-identifier-backfill --assignment <assignment-id> [--resume .papyrus-runs/<run>/execution-manifest.json]");
  console.log("  npm run content -- references create-doi-backfill-assignment --config <steering.yml> --corpus-key AI-ML-research --apply");
  console.log("  npm run content -- references doi-backfill-now --config <steering.yml> --corpus-key AI-ML-research --only-missing-doi true --progress-every 25 --use-llm false");
  console.log("  npm run content -- references execute-doi-backfill --assignment <assignment-id>");
  console.log("  npm run content -- references export-analysis-manifest --config <steering.yml> --corpus-key <key> --output <accepted-manifest.json>");
  console.log("  npm run content -- references export-scope-training --config <steering.yml> --corpus-key <key> --output <scope-training.json>");
  console.log("  npm run content -- references review-curation --reference <id> --action accept|reject|reopen|archive --reason-code out_of_scope --note <text>");
  console.log("  npm run content -- references list-predictions --corpus-key <key> --category-set <id> --status current --limit 200");
  console.log("  npm run content -- references review-classification --relation <semantic-relation-id> --action accept|reject --note <text>");
  console.log("  npm run content -- references label --reference <reference-id|item-id> --category <category-key|lineage-id> --category-set <id> --note <text> --apply");
  console.log("  npm run content -- references unlabel --relation <authoritative-label-relation-id> --apply");
  console.log("  npm run content -- references labels --reference <reference-id|item-id>");
  console.log("  npm run content -- assignments list --queue <queue-key> --status open");
  console.log("  npm run content -- assignments create-research --title <text> --summary <text> --section <section-key> --corpus-key <key> --research-mode source_discovery --topic-scope <keys> --apply [--json]");
  console.log("  npm run content -- assignments run-research --assignment <id> --corpus-key <key> --research-mode source_discovery [--max-evidence-items 20] [--apply] [--json]");
  console.log("  npm run content -- assignments apply-research-packet --assignment <id> --research-json <packet.json> --apply [--json]");
  console.log("  npm run content -- assignments intake-proposals --assignment <id> --config <steering.yml> --corpus-key <key> --status pending [--message <message-id>] [--apply] [--json]");
  console.log("  npm run content -- assignments research-intake-now --assignment <id> --config <steering.yml> --corpus-key <key> --research-mode source_discovery --max-evidence-items 20 [--apply] [--json]");
  console.log("  npm run content -- assignments run-story-cycle --date YYYY-MM-DD --topic <text> --category <category-key> --coverage-key <coverage.key> --sections culture,methods,business,law --section-budgets culture:2,methods:1,business:1,law:1 [--through plan|research|reporting] [--allow-fallback|--require-agent-success] [--refresh-packets] [--force-refresh-selected] [--apply] [--json]");
  console.log("  npm run content -- assignments story-cycle-output --run-id <story-cycle-run-id> [--section <key>] [--json]");
  console.log("  npm run content -- assignments orphan-research-packets [--json]");
  console.log("  npm run content -- assignments backfill-section-indexes --apply");
  console.log("  npm run content -- assignments for-object --kind reference --lineage <reference-lineage-id>");
  console.log("  npm run content -- assignments build-context --assignment <id> --context-profile reporting");
  console.log("  npm run content -- assignments research-packets --assignment <id>");
  console.log("  npm run content -- assignments review-reporting-packet --assignment <id> --message <message-id> --decision select|merge|brief|hold|kill --note <text> [--target-item <id>] [--dry-run|--apply] [--json]");
  console.log("  npm run content -- assignments run-copywriting --assignment <copywriting-assignment-id> [--dry-run|--apply] [--json]");
  console.log("  npm run content -- assignments copywriting-output [--assignment <id>|--run-id <id>|--coverage-key <key>|--section <key>] [--json]");
  console.log("  npm run content -- assignments events --assignment <id>");
  console.log("  npm run content -- assignments process-queue --type analysis.reindex --section technology --status open --max-count 10 --dry-run");
  console.log("  npm run content -- assignments process-queue --type analysis.reindex --section technology --status open --max-count 10 --max-runtime-seconds 3600 --stop-on-error false");
  console.log("  npm run content -- assignments claim --assignment <id> --assignee-key <worker-run-id> --claim-ttl-seconds 3600 [--json]");
  console.log("  npm run content -- assignments complete --assignment <id> --note <text> [--json]");
  console.log("  npm run content -- analysis profiles --profiles corpora/papyrus-analysis-profiles.yml");
  console.log("  npm run content -- analysis validate-profiles --profiles corpora/papyrus-analysis-profiles.yml");
  console.log("  npm run content -- analysis reindex-plan --profile canonical-topic-classifier --corpus-key AI-ML-research --override bertopic_analysis.parameters.nr_topics=12");
  console.log("  npm run content -- analysis preview-reindex --profile canonical-topic-classifier --corpus-key AI-ML-research --override bertopic_analysis.parameters.nr_topics=12");
  console.log("  npm run content -- analysis create-reindex-assignment --profile canonical-topic-classifier --corpus-key AI-ML-research --apply");
  console.log("  npm run content -- analysis run-now --profile canonical-topic-classifier --corpus-key AI-ML-research --section science --max-runtime-seconds 3600 --override bertopic_analysis.parameters.nr_topics=12");
  console.log("  npm run content -- analysis execute-assignment --assignment <analysis-assignment-id> --max-runtime-seconds 3600");
  console.log("  npm run content -- analysis graph-artifacts --corpus-key AI-ML-research [--json]");
  console.log("  npm run content -- analysis import-graph-artifact --import-run <graph-import-run-id> --apply");
  console.log("  npm run content -- newsroom recount-summary --apply [--json]");
  console.log("  npm run content -- newsroom backfill-operational-indexes --apply [--json]");
  console.log("  npm run content -- newsroom backfill-feed-fields --apply");
  console.log("  npm run content -- newsroom import-sections --config corpora/papyrus-newsroom-sections.yml");
  console.log("  npm run content -- editions plan --date YYYY-MM-DD --section-targets desk.key:news,other.desk:history --dry-run");
  console.log("  npm run content -- editions plan --date YYYY-MM-DD --assignment-type reporting --section-budgets news:2,business:1 --rotating-sections 2 --dry-run");
  console.log("  npm run content -- editions plan --date YYYY-MM-DD --focus-categories automated-publication-systems,agentic-workflows --section-targets automated-publication-systems:methods,agentic-workflows:technology --context-profile analysis --dry-run");
  console.log("  npm run content -- editions dispatch-research --date YYYY-MM-DD --section-targets desk.key:news --apply");
  console.log("  npm run content -- editions dispatch-reporting --date YYYY-MM-DD --section-budgets news:2,business:1 --rotating-sections 2 --apply");
  console.log("  npm run content -- editions dispatch-research --date YYYY-MM-DD --focus-categories agentic-workflows,evaluation-qa --section-targets agentic-workflows:technology,evaluation-qa:methods --context-profile reporting --apply");
  console.log("  npm run content -- editions purge --edition <id|slug|date> --mode edition-only");
  console.log("  npm run content -- editions purge --edition <id|slug|date> --mode edition-and-items");
  console.log("  npm run content -- editions purge --all --mode edition-and-items");
}

function printEditionPlanningSummary(plan, report, mode) {
  console.log(`edition-planning\tmode\t${mode}`);
  console.log(`edition-planning\tedition\t${plan.edition.id}\t${plan.edition.slug}\t${plan.edition.status}`);
  console.log(`edition-planning\tassignment-type\t${plan.summary.assignmentTypeKey}`);
  console.log(`edition-planning\tcategory-set\t${plan.categorySet.id}\t${plan.categorySet.displayName}`);
  console.log(`edition-planning\tdesks\t${plan.desks.length}`);
  console.log(`edition-planning\tsections\t${(plan.sections ?? []).join(",") || "none"}`);
  console.log(`edition-planning\tassignments\t${plan.assignments.length}`);
  console.log(`edition-planning\tcontext-backed\t${plan.summary.contextBackedAssignmentCount}`);
  console.log(`edition-planning\trecords\tcreate=${plan.summary.createCount}\tupdate=${plan.summary.updateCount}\tnoop=${plan.summary.noopCount}`);
  console.log(`edition-planning\treport\t${report.filepath}`);
  for (const warning of plan.warnings || []) {
    console.log(`edition-planning\twarning\t${warning}`);
  }
  for (const budget of plan.summary.sectionBudgets || []) {
    console.log(`section-budget\t${budget.section.id}\tslots=${budget.slots}\ttype=${budget.section.type}`);
  }
  for (const coverage of plan.focusCoverage || []) {
    console.log(`focus-coverage\t${coverage.deskCategoryKey}\t${coverage.laneKey}\t${coverage.focusCategoryKey}\t${coverage.count}\tqueue=${coverage.queueKey ?? "-"}`);
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
      graphExportPath: attached.graphExportPath ?? null,
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
      graphExportPath: null,
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
    graphExportPath: null,
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

function assertJwtUsableForLongRun(claims, label, minRemainingSeconds = 15 * 60) {
  if (!claims || typeof claims.exp !== "number") return;
  const remainingSeconds = claims.exp - Math.floor(Date.now() / 1000);
  if (remainingSeconds <= minRemainingSeconds) {
    throw new Error(`PAPYRUS_GRAPHQL_JWT expires too soon for ${label}: ${remainingSeconds}s remaining. Refresh it before running.`);
  }
}

function assertCurrentJwtUsableForLongRun(label, minRemainingSeconds = 15 * 60) {
  assertJwtUsableForLongRun(decodeJwtClaims(getJwtToken()), label, minRemainingSeconds);
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
