#!/usr/bin/env node

const crypto = require("node:crypto");

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
  buildSteeringFeedbackPayload,
  buildSteeringConfigRecords,
  buildProjectionImportRecords,
  buildSteeringImportRecords,
  knowledgeCorpusId,
  loadJsonFile,
  loadSteeringBundleFromBiblicus,
  mergeReviewedProposalState,
  writeJsonFile,
} = require("./lib/papyrus-categories.cjs");
const {
  findCorpusConfigByPath,
  loadSteeringConfig,
  requireCorpusConfig,
  requireSteeringConfig,
  resolveClassifierForCorpus,
} = require("./lib/papyrus-steering-config.cjs");
const { PapyrusGraphQLAuthoringClient } = require("./lib/papyrus-graphql-authoring.cjs");
const { getArticleImageAssets, getMarkdownArticle, loadEditionConfig, loadMarkdownArticles } = require("./lib/papyrus-markdown.cjs");

async function main() {
  loadDotEnv();

  const args = process.argv.slice(2);
  const [group, command, value] = args;
  if (group !== "content" && group !== "categories" && group !== "assignments") {
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
    case "categories:import-projection":
      await importProjection(args.slice(2));
      return;
    case "assignments:list":
      await listAssignments(args.slice(2));
      return;
    case "assignments:for-object":
      await listAssignmentsForObject(args.slice(2));
      return;
    case "assignments:claim":
    case "assignments:release":
    case "assignments:complete":
    case "assignments:cancel":
    case "assignments:reopen":
      await mutateAssignment(command, args.slice(2));
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
  const changes = await buildRecordChanges(client, plan.records);
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
}

async function importProjection(flags) {
  const options = parseOptions(flags);
  if (!options.bundle) throw new Error("categories import-projection requires --bundle.");
  const payload = loadJsonFile(options.bundle);
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const resolvedProjection = resolveProjectionImportCorpora(steeringConfig, options);
  const { client } = createAuthoringClient();
  const plan = buildProjectionImportRecords(payload, {
    authorityCorpusConfig: resolvedProjection.authorityCorpus,
    authorityCorpusId: resolvedProjection.authorityCorpusId,
    targetCorpusConfig: resolvedProjection.targetCorpus,
    targetCorpusId: resolvedProjection.targetCorpusId,
    classifierId: resolvedProjection.classifierId,
  });
  const changes = await buildRecordChanges(client, plan.records);
  await applyRecordChanges(client, changes);
  printCategoryImportSummary("projection", plan.importRunId, changes);
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
    .filter((relation) => relation.predicate === "requests_work_on");
  const assignmentIds = new Set(relations.map((relation) => relation.subjectId));
  const assignments = (await client.listRecords("Assignment")).filter((assignment) => assignmentIds.has(assignment.id));
  assignments.sort((left, right) => assignmentSortKey(left).localeCompare(assignmentSortKey(right)));
  for (const assignment of assignments) {
    console.log(`${assignment.status}\t${assignment.id}\t${assignment.assignmentTypeKey}\t${assignment.title}`);
  }
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
    status: nextStatus,
    queueStatusKey: `${current.queueKey}#${nextStatus}`,
    updatedAt: now,
  };
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
    "AssignmentEvent",
    "Assignment",
    "SemanticNode",
    "KnowledgeComment",
    "ReferenceAttachment",
    "Reference",
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
  const prepared = await prepareVersionedKnowledgeRecords(client, records);
  const changes = [];
  for (const record of prepared.records) {
    changes.push(await buildRecordChange(client, record.modelName, record.expected));
  }
  changes.push(...prepared.postChanges);
  return changes;
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
    if (record.modelName === "KnowledgeComment") {
      return { ...record, expected: remapKnowledgeComment(record.expected, referenceIdMap) };
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

function remapKnowledgeComment(comment, referenceIdMap) {
  if (comment.subjectKind !== "reference") return comment;
  const reference = referenceIdMap.get(comment.subjectId);
  if (!reference) return comment;
  const subjectVersionKey = `reference#${reference.id}`;
  const subjectStateKey = `reference#${reference.lineageId}#current`;
  const next = {
    ...comment,
    subjectId: reference.id,
    subjectLineageId: reference.lineageId,
    subjectVersionNumber: reference.versionNumber,
    subjectVersionKey,
    subjectStateKey,
  };
  return {
    ...next,
    id: `knowledge-comment-${hashShort([
      subjectVersionKey,
      next.commentKind,
      next.body,
      next.createdAt,
      next.source ?? "",
    ])}`,
  };
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
  const nextExpected = modelName === "SteeringProposal" ? mergeReviewedProposalState(expected, current) : expected;
  const action = !current ? "create" : recordsEqual(current, nextExpected) ? "noop" : "update";
  return { modelName, expected: nextExpected, current, action };
}

async function applyRecordChanges(client, records) {
  for (const record of records) {
    if (record.action === "noop") continue;
    await client.upsert(record.modelName, record.expected);
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
  for (const record of changes) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
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
  return stableStringify(normalizeRecord(left)) === stableStringify(normalizeRecord(right));
}

const AWS_JSON_FIELDS = new Set(["layout", "editorial", "metadata", "layoutPlan", "payload"]);

function normalizeRecord(record, keyName = "") {
  if (Array.isArray(record)) return record.map(normalizeRecord);
  if (typeof record === "string" && AWS_JSON_FIELDS.has(keyName)) {
    return normalizeRecord(parseAwsJson(record), keyName);
  }
  if (!record || typeof record !== "object") return record;

  const normalized = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined || record[key] === null) continue;
    normalized[key] = normalizeRecord(record[key], key);
  }
  return normalized;
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function hashShort(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);
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
  console.log("  npm run content -- categories import-projection --bundle <projection.json>");
  console.log("  npm run content -- categories import-projection --config <steering.yml> --target-corpus-key <key> --authority-corpus-key <key> --bundle <projection.json>");
  console.log("  npm run content -- assignments list --queue <queue-key> --status open");
  console.log("  npm run content -- assignments for-object --kind reference --lineage <reference-lineage-id>");
  console.log("  npm run content -- assignments claim --assignment <id> --assignee <agent-id>");
  console.log("  npm run content -- assignments complete --assignment <id> --note <text>");
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
    const classifierId = options.classifier ?? targetCorpus.canonicalProjection?.classifierId ?? requiredConfig.canonicalCategorySet.classifierId;
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
