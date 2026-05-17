const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_BIBLICUS_WORKDIR = "/Users/ryan/Projects/Biblicus";
const GRAPH_PROPOSAL_KINDS = new Set([
  "topic-becomes-graph-entity",
  "topic-maps-to-existing-graph-entity",
  "entity-alias-edit",
  "entity-description-edit",
  "relationship-proposal",
  "merge-graph-entity",
  "deprecate-graph-entity",
]);

function loadJsonFile(filepath) {
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function writeJsonFile(filepath, payload) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function loadSteeringBundleFromBiblicus({ corpus, classifier, topicGovernanceSnapshot }) {
  if (!corpus) throw new Error("--corpus is required when --bundle is omitted.");
  if (!classifier) throw new Error("--classifier is required when --bundle is omitted.");

  const args = ["run", "biblicus", "steering", "export", "--corpus", corpus, "--classifier", classifier];
  if (topicGovernanceSnapshot) args.push("--topic-governance-snapshot", topicGovernanceSnapshot);

  const result = spawnSync("uv", args, {
    cwd: process.env.BIBLICUS_WORKDIR ?? DEFAULT_BIBLICUS_WORKDIR,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });
  if (result.status !== 0) {
    throw new Error(`Biblicus steering export failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function buildSteeringImportRecords(bundle, options = {}) {
  const now = options.importedAt ?? new Date().toISOString();
  const corpus = bundle.corpus ?? {};
  const corpusContext = normalizeCorpusContext(corpus, options.corpusConfig ?? options.corpus);
  const corpusId = options.corpusId ?? categoryCorpusId(corpusContext);
  const classifierId = bundle.topic_set?.classifier_id ?? options.classifierId ?? "unknown-classifier";
  const importRunId = `category-import-${safeId(corpusId)}-${safeId(classifierId)}-${hashShort([
    bundle.generated_at,
    bundle.proposals?.length ?? 0,
    bundle.artifacts?.length ?? 0,
  ])}`;
  const categorySetId = categorySetIdFor(classifierId, corpusId);
  const records = [];

  records.push(record("CategoryCorpus", {
    id: corpusId,
    name: corpusContext.name,
    role: corpusContext.role,
    itemCount: numberOrNull(corpus.item_count),
    generatedAt: dateOrNull(corpus.generated_at ?? bundle.generated_at),
    latestImportRunId: importRunId,
    createdAt: now,
    updatedAt: now,
  }));
  records.push(rawPayloadRecord("corpus", corpusId, "biblicus-corpus", corpus, importRunId, now));

  records.push(record("CategoryImportRun", {
    id: importRunId,
    corpusId,
    importKind: "steering-export",
    classifierId,
    sourceSnapshotId: latestSnapshotId(bundle.artifacts, "topic-governance"),
    status: "imported",
    generatedAt: dateOrNull(bundle.generated_at),
    importedAt: now,
    itemCount: bundle.items?.length ?? 0,
      categoryCount: bundle.topic_set?.topics?.length ?? 0,
    proposalCount: bundle.proposals?.length ?? 0,
    artifactCount: bundle.artifacts?.length ?? 0,
    projectionCount: 0,
    warningCount: bundle.warnings?.length ?? 0,
  }));
  records.push(rawPayloadRecord("importRun", importRunId, "warnings", { warnings: bundle.warnings ?? [] }, importRunId, now));

  if (bundle.topic_set) {
    records.push(...categorySetRecords(bundle.topic_set, { corpusId, importRunId, categorySetId, now, generatedAt: bundle.generated_at }));
    records.push(...taxonomyRecords(bundle, {
      corpusId,
      corpusPath: options.corpusPath ?? options.corpusConfig?.path ?? options.corpus?.path ?? null,
      importRunId,
      now,
      categorySetId,
    }));
  }

  for (const artifact of bundle.artifacts ?? []) {
    records.push(...artifactRecords(artifact, { corpusId, importRunId, now }));
  }

  for (const proposal of bundle.proposals ?? []) {
    records.push(...proposalRecords(proposal, { corpusId, importRunId, categorySetId, now }));
  }

  return {
    corpusId,
    importRunId,
    categorySetId,
    records,
  };
}

function buildProjectionImportRecords(payload, options = {}) {
  const now = options.importedAt ?? new Date().toISOString();
  const items = payload.items ?? payload.predictions ?? [];
  const firstItem = items[0] ?? {};
  const targetCorpus = normalizeCorpusContext({
    name: corpusNameFromUri(firstItem.target_corpus_uri),
    corpus_uri: firstItem.target_corpus_uri,
  }, options.targetCorpusConfig ?? options.targetCorpus);
  const authorityCorpus = normalizeCorpusContext({
    name: corpusNameFromUri(firstItem.classifier_corpus_uri),
    corpus_uri: firstItem.classifier_corpus_uri,
  }, options.authorityCorpusConfig ?? options.authorityCorpus, { role: "canonical" });
  const targetCorpusId = options.targetCorpusId ?? categoryCorpusId(targetCorpus);
  const authorityCorpusId = options.authorityCorpusId ?? categoryCorpusId(authorityCorpus);
  const classifierId = payload.classifier_id ?? firstItem.classifier_id ?? options.classifierId ?? "unknown-classifier";
  const importRunId = `category-import-${safeId(targetCorpusId)}-${safeId(classifierId)}-projection-${hashShort(payload.summary ?? items)}`;
  const records = [
    record("CategoryCorpus", {
      id: targetCorpusId,
      name: targetCorpus.name,
      role: targetCorpus.role,
      itemCount: null,
      generatedAt: null,
      latestImportRunId: importRunId,
      createdAt: now,
      updatedAt: now,
    }),
    record("CategoryImportRun", {
      id: importRunId,
      corpusId: targetCorpusId,
      importKind: "topic-projection",
      classifierId,
      sourceSnapshotId: firstItem.extraction_snapshot?.snapshot_id ?? null,
      status: "imported",
      generatedAt: null,
      importedAt: now,
      itemCount: 0,
      categoryCount: 0,
      proposalCount: 0,
      artifactCount: 0,
      projectionCount: items.length,
      warningCount: 0,
    }),
    rawPayloadRecord("importRun", importRunId, "projection-summary", payload.summary ?? {}, importRunId, now),
  ];

  for (const item of items) {
    const externalItemId = requiredString(item.item_id, "projection item_id");
    const projectionId = `projection-${safeId(targetCorpusId)}-${safeId(classifierId)}-${safeId(externalItemId)}-${hashShort(item.model_version ?? "")}`;
    records.push(record("CategoryProjection", {
      id: projectionId,
      targetCorpusId,
      authorityCorpusId,
      classifierId,
      modelVersion: item.model_version ?? null,
      externalItemId,
      categoryKey: item.category_key ?? item.topic_uid ?? null,
      displayName: item.display_name ?? null,
      score: numberOrNull(item.score),
      reviewRecommended: Boolean(item.review_recommended),
      importedAt: now,
      importRunId,
    }));
    records.push(rawPayloadRecord("projection", projectionId, "biblicus-projection", item, importRunId, now));
  }

  return { importRunId, records };
}

function buildSteeringConfigRecords(config, options = {}) {
  const now = options.importedAt ?? new Date().toISOString();
  return (config.corpora ?? []).map((corpus) => record("CategoryCorpus", {
    id: categoryCorpusId(corpus),
    name: corpus.name,
    role: corpus.role,
    createdAt: now,
    updatedAt: now,
  }));
}

function buildAcceptedCategorySetPayload(categorySet, topics) {
  const sortedTopics = [...topics].sort((left, right) => {
    const rankDiff = (left.rank ?? 999999) - (right.rank ?? 999999);
    if (rankDiff !== 0) return rankDiff;
    return String(left.categoryKey).localeCompare(String(right.categoryKey));
  });
  return {
    schema_version: 1,
    classifier_id: requiredString(categorySet.classifierId, "categorySet.classifierId"),
    display_name: requiredString(categorySet.displayName, "categorySet.displayName"),
    description: categorySet.description ?? "",
    topics: sortedTopics.map((topic) => ({
      category_key: requiredString(topic.categoryKey, "topic.categoryKey"),
      display_name: requiredString(topic.displayName, "topic.displayName"),
      description: topic.description ?? "",
      seed_item_ids: compactArray(topic.seedItemIds),
      holdout_item_ids: compactArray(topic.holdoutItemIds),
      ...(topic.subtitle ? { subheading: topic.subtitle } : {}),
      ...(compactArray(topic.aliases).length ? { aliases: compactArray(topic.aliases) } : {}),
      ranking_hints: {
        pinned: Boolean(topic.isPinned),
        rank: topic.rank ?? null,
      },
    })),
    unlabeled_policy: "use_minus_one",
  };
}

function buildAcceptedCategoryTreePayload(taxonomy, nodes) {
  const sortedNodes = sortTaxonomyNodes(nodes);
  return {
    schema_version: 1,
    taxonomy_id: requiredString(taxonomy.taxonomyId ?? taxonomy.id, "taxonomy.taxonomyId"),
    display_name: requiredString(taxonomy.displayName, "taxonomy.displayName"),
    description: taxonomy.description ?? "",
    generated_at: taxonomy.generatedAt ?? taxonomy.updatedAt ?? taxonomy.createdAt ?? new Date().toISOString(),
    ...(taxonomy.snapshotId ? { snapshot_id: taxonomy.snapshotId } : {}),
    nodes: sortedNodes.map((node) => ({
      category_key: requiredString(node.categoryKey, "node.categoryKey"),
      parent_category_key: node.parentCategoryKey ?? null,
      display_name: requiredString(node.displayName, "node.displayName"),
      description: node.description ?? node.subtitle ?? "",
      status: node.status === "archived" ? "archived" : "accepted",
      seed_item_ids: compactArray(node.seedItemIds),
      holdout_item_ids: compactArray(node.holdoutItemIds),
      source: {
        papyrus_category_set_id: taxonomy.id,
        papyrus_category_id: node.id,
      },
    })),
    source: {
      system: "papyrus",
      category_set_id: taxonomy.categorySetId ?? taxonomy.id,
      corpus_id: taxonomy.corpusId,
    },
  };
}

function buildSteeringFeedbackPayload(categorySet, proposals, decisions, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const inScopeProposals = proposals
    .filter((proposal) => proposal.categorySetId === categorySet.id)
    .sort(compareById);
  const proposalIds = new Set(inScopeProposals.map((proposal) => proposal.id));
  const inScopeDecisions = decisions
    .filter((decision) => proposalIds.has(decision.proposalId) || decision.categorySetId === categorySet.id)
    .sort(compareByCreatedAt);
  const latestDecisionByProposalId = new Map();
  for (const decision of inScopeDecisions) {
    if (!decision.proposalId) continue;
    latestDecisionByProposalId.set(decision.proposalId, decision);
  }
  const reviewedProposals = inScopeProposals
    .filter((proposal) => proposal.status === "accepted" || proposal.status === "rejected")
    .map((proposal) => reviewedProposalFeedback(proposal, latestDecisionByProposalId.get(proposal.id)))
    .sort(compareFeedback);
  const acceptedProposals = reviewedProposals.filter((proposal) => proposal.human_action === "accept" || proposal.status === "accepted");
  const rejectedProposals = reviewedProposals.filter((proposal) => proposal.human_action === "reject" || proposal.status === "rejected");

  return {
    schema_version: 1,
    export_kind: "papyrus-steering-feedback",
    generated_at: generatedAt,
    source: {
      system: "papyrus",
      category_set_id: categorySet.id,
      corpus_id: categorySet.corpusId ?? null,
      classifier_id: categorySet.classifierId ?? null,
    },
    category_set: {
      category_set_id: categorySet.id,
      corpus_id: categorySet.corpusId ?? null,
      classifier_id: categorySet.classifierId ?? null,
      display_name: categorySet.displayName ?? null,
      description: categorySet.description ?? null,
    },
    decisions: inScopeDecisions.map(decisionFeedbackRecord),
    accepted_proposals: acceptedProposals,
    rejected_proposals: rejectedProposals,
    suppressions: rejectedProposals.map((proposal) => suppressionFromRejectedProposal(proposal, categorySet)),
  };
}

function reviewedProposalFeedback(proposal, decision) {
  const humanAction = decisionAction(decision, proposal);
  return {
    proposal_id: proposal.id,
    proposal_kind: proposal.proposalKind ?? "unknown",
    steering_domain: proposal.steeringDomain ?? null,
    status: proposal.status,
    human_action: humanAction,
    decided_at: decision?.createdAt ?? proposal.reviewedAt ?? proposal.updatedAt ?? null,
    decided_by: decision?.actorLabel ?? proposal.reviewedBy ?? decision?.actorSub ?? null,
    decision_id: decision?.id ?? null,
    category_set_id: proposal.categorySetId ?? null,
    corpus_id: proposal.corpusId ?? null,
    category_key: proposal.categoryKey ?? null,
    target_category_key: proposal.targetCategoryKey ?? null,
    graph_entity_id: proposal.graphEntityId ?? null,
    relationship_type: proposal.relationshipType ?? null,
    display_name: proposal.displayName ?? proposal.title ?? null,
    subtitle: proposal.subtitle ?? null,
    description: proposal.description ?? null,
    summary: proposal.summary ?? null,
    evidence_item_ids: compactArray(proposal.evidenceItemIds),
    suggested_seed_item_ids: compactArray(proposal.suggestedSeedItemIds),
    suggested_holdout_item_ids: compactArray(proposal.suggestedHoldoutItemIds),
    source_snapshot_id: proposal.sourceSnapshotId ?? null,
  };
}

function decisionAction(decision, proposal) {
  if (decision?.action === "accept" || decision?.action === "reject" || decision?.action === "edit") return decision.action;
  if (proposal.status === "accepted") return "accept";
  if (proposal.status === "rejected") return "reject";
  return decision?.action ?? null;
}

function decisionFeedbackRecord(decision) {
  return {
    decision_id: decision.id,
    proposal_id: decision.proposalId,
    category_set_id: decision.categorySetId ?? null,
    action: decision.action,
    selected_category_key: decision.selectedCategoryKey ?? null,
    note: decision.note ?? null,
    actor_label: decision.actorLabel ?? null,
    actor_sub: decision.actorSub ?? null,
    created_at: decision.createdAt ?? null,
  };
}

function suppressionFromRejectedProposal(proposal, categorySet) {
  return {
    suppression_id: `suppression-${safeId(proposal.proposal_id)}`,
    proposal_id: proposal.proposal_id,
    proposal_kind: proposal.proposal_kind,
    steering_domain: proposal.steering_domain,
    reason: proposal.summary ?? proposal.description ?? null,
    decided_at: proposal.decided_at,
    decided_by: proposal.decided_by,
    scope: {
      category_set_id: categorySet.id,
      corpus_id: categorySet.corpusId ?? proposal.corpus_id ?? null,
      classifier_id: categorySet.classifierId ?? null,
      root_category_key: proposal.target_category_key ?? null,
    },
    match: {
      category_key: proposal.category_key ?? null,
      display_name: proposal.display_name ?? null,
      normalized_display_name: normalizeMatchText(proposal.display_name),
      relationship_type: proposal.relationship_type ?? null,
      graph_entity_id: proposal.graph_entity_id ?? null,
    },
    evidence_item_ids: compactArray(proposal.evidence_item_ids),
  };
}

function categorySetRecords(categorySet, context) {
  const topics = categorySet.topics ?? [];
  const records = [
    record("CategorySet", versionedRecord({
      id: context.categorySetId,
      lineageId: context.categorySetId,
      corpusId: context.corpusId,
      classifierId: categorySet.classifier_id,
      displayName: categorySet.display_name,
      description: categorySet.description ?? null,
      status: "accepted",
      generatedAt: dateOrNull(context.generatedAt),
      categoryCount: topics.length,
      importRunId: context.importRunId,
    }, { now: context.now, actor: "biblicus-import", reason: "category-set-import", content: categorySet })),
    rawPayloadRecord("categorySet", context.categorySetId, "biblicus-category-set", categorySet, context.importRunId, context.now),
  ];

  for (const [index, topic] of topics.entries()) {
    const categoryKey = readCategoryKey(topic);
    const categoryLineageId = categoryLineageIdFor(context.categorySetId, categoryKey);
    const categoryId = `${categoryLineageId}-v1`;
    records.push(record("Category", versionedRecord({
      id: categoryId,
      lineageId: categoryLineageId,
      categorySetId: context.categorySetId,
      corpusId: context.corpusId,
      categoryKey,
      parentCategoryId: null,
      parentCategoryKey: null,
      displayName: topic.display_name,
      subtitle: topic.subheading ?? topic.subtitle ?? null,
      description: topic.description ?? null,
      aliases: compactArray(topic.aliases),
      status: "accepted",
      seedItemIds: compactArray(topic.seed_item_ids),
      holdoutItemIds: compactArray(topic.holdout_item_ids),
      rank: index + 1,
      depth: 0,
      isPinned: Boolean(topic.ranking_hints?.pinned),
      importRunId: context.importRunId,
      updatedAt: context.now,
    }, { now: context.now, actor: "biblicus-import", reason: "category-import", content: topic })));
    records.push(rawPayloadRecord("category", categoryId, "biblicus-category", topic, context.importRunId, context.now));
  }
  return records;
}

function artifactRecords(artifact, context) {
  const artifactId = `category-artifact-${safeId(context.corpusId)}-${hashShort(`${artifact.kind}:${artifact.artifact_id}`)}`;
  return [
    record("CategoryArtifact", {
      id: artifactId,
      corpusId: context.corpusId,
      artifactKind: artifact.kind,
      artifactId: artifact.artifact_id,
      snapshotId: artifact.snapshot_id ?? null,
      displayName: artifact.metadata?.name ?? artifact.metadata?.configuration_id ?? artifact.artifact_id,
      createdAt: dateOrNull(artifact.created_at),
      importRunId: context.importRunId,
    }),
    rawPayloadRecord("artifact", artifactId, "biblicus-artifact", artifact, context.importRunId, context.now),
  ];
}

function taxonomyRecords(bundle, context) {
  const manifest = loadAcceptedTaxonomyManifest(bundle, context)
    ?? rootTaxonomyManifestFromCategorySet(bundle.topic_set, context);
  const manifestNodes = Array.isArray(manifest.nodes) ? manifest.nodes : [];
  const records = [
    rawPayloadRecord("categoryTree", context.categorySetId, "biblicus-category-tree", manifest, context.importRunId, context.now),
  ];

  const nodeRanks = rankTaxonomyNodes(manifestNodes);
  for (const node of manifestNodes) {
    const categoryKey = readCategoryKey(node);
    const categoryLineageId = categoryLineageIdFor(context.categorySetId, categoryKey);
    const categoryId = `${categoryLineageId}-v1`;
    const depth = taxonomyNodeDepth(categoryKey, manifestNodes);
    const rank = nodeRanks.get(categoryKey) ?? null;
    records.push(record("Category", versionedRecord({
      id: categoryId,
      lineageId: categoryLineageId,
      corpusId: context.corpusId,
      categorySetId: context.categorySetId,
      categoryKey,
      parentCategoryId: null,
      parentCategoryKey: readParentCategoryKey(node),
      displayName: node.display_name,
      subtitle: node.subheading ?? node.subtitle ?? null,
      description: node.description ?? null,
      status: normalizeTaxonomyNodeStatus(node.status),
      seedItemIds: compactArray(node.seed_item_ids),
      holdoutItemIds: compactArray(node.holdout_item_ids),
      rank,
      depth,
      importRunId: context.importRunId,
      updatedAt: context.now,
    }, { now: context.now, actor: "biblicus-import", reason: "category-tree-import", content: node })));
    records.push(rawPayloadRecord("category", categoryId, "biblicus-category-tree-node", node, context.importRunId, context.now));
  }
  return records;
}

function loadAcceptedTaxonomyManifest(bundle, context) {
  const artifact = latestArtifact(bundle.artifacts, "taxonomy");
  if (!artifact || !context.corpusPath) return null;
  for (const candidate of taxonomyArtifactCandidates(artifact, context.corpusPath)) {
    const manifest = readTaxonomyManifestCandidate(candidate);
    if (manifest) return manifest;
  }
  return null;
}

function taxonomyArtifactCandidates(artifact, corpusPath) {
  const paths = compactArray([
    artifact.path,
    artifact.artifact_paths?.taxonomy,
    artifact.artifact_paths?.manifest,
    artifact.metadata?.artifact_paths?.taxonomy,
    artifact.metadata?.artifact_paths?.manifest,
  ]);
  if (artifact.snapshot_id) {
    paths.push(path.join("analysis", "taxonomy", artifact.snapshot_id, "taxonomy.json"));
    paths.push(path.join("analysis", "taxonomy", artifact.snapshot_id, "manifest.json"));
  }
  const candidates = [];
  for (const artifactPath of paths) {
    if (artifactPath.startsWith("s3://")) continue;
    const resolved = path.isAbsolute(artifactPath) ? artifactPath : path.join(corpusPath, artifactPath);
    candidates.push(resolved);
    if (path.basename(resolved) === "manifest.json") candidates.push(path.join(path.dirname(resolved), "taxonomy.json"));
  }
  return Array.from(new Set(candidates));
}

function readTaxonomyManifestCandidate(candidatePath) {
  if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) return null;
  const payload = loadJsonFile(candidatePath);
  if (Array.isArray(payload.nodes) && payload.taxonomy_id) return payload;
  const artifactPaths = payload.artifact_paths && typeof payload.artifact_paths === "object" ? payload.artifact_paths : {};
  const taxonomyPath = artifactPaths.taxonomy;
  if (typeof taxonomyPath !== "string" || taxonomyPath.startsWith("s3://")) return null;
  const resolved = path.isAbsolute(taxonomyPath) ? taxonomyPath : path.join(path.dirname(candidatePath), taxonomyPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  const taxonomy = loadJsonFile(resolved);
  return Array.isArray(taxonomy.nodes) && taxonomy.taxonomy_id ? taxonomy : null;
}

function rootTaxonomyManifestFromCategorySet(categorySet, context) {
  const topics = categorySet.topics ?? [];
  const taxonomyIdentity = `${categorySet.classifier_id}-accepted-taxonomy`;
  return {
    schema_version: 1,
    taxonomy_id: taxonomyIdentity,
    display_name: `${categorySet.display_name ?? categorySet.classifier_id} Taxonomy`,
    description: categorySet.description ?? "Root-only taxonomy derived from the accepted canonical topic set.",
    generated_at: context.now,
    snapshot_id: `root-only-${hashShort(categorySet)}`,
    nodes: topics.map((topic) => ({
      category_key: readCategoryKey(topic),
      parent_category_key: null,
      display_name: topic.display_name,
      description: topic.description ?? topic.subheading ?? topic.subtitle ?? "Accepted root topic.",
      status: "accepted",
      seed_item_ids: compactArray(topic.seed_item_ids),
      holdout_item_ids: compactArray(topic.holdout_item_ids),
      source: {
        papyrus_fallback: "accepted-topic-set",
      },
    })),
    source: {
      system: "papyrus",
      fallback: "accepted-topic-set",
      category_set_id: context.categorySetId,
    },
  };
}

function rankTaxonomyNodes(nodes) {
  const rankByUid = new Map();
  const childrenByParent = new Map();
  for (const node of nodes) {
    const parent = readParentCategoryKey(node) ?? "__root__";
    const children = childrenByParent.get(parent) ?? [];
    children.push(node);
    childrenByParent.set(parent, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => String(left.display_name ?? readCategoryKey(left)).localeCompare(String(right.display_name ?? readCategoryKey(right))));
    children.forEach((node, index) => rankByUid.set(readCategoryKey(node), index + 1));
  }
  return rankByUid;
}

function taxonomyNodeDepth(categoryKey, nodes) {
  const parentByUid = new Map(nodes.map((node) => [readCategoryKey(node), readParentCategoryKey(node)]));
  let depth = 0;
  let current = parentByUid.get(categoryKey) ?? null;
  const seen = new Set([categoryKey]);
  while (current) {
    if (seen.has(current)) return depth;
    seen.add(current);
    depth += 1;
    current = parentByUid.get(current) ?? null;
  }
  return depth;
}

function normalizeTaxonomyNodeStatus(status) {
  return status === "archived" ? "archived" : "accepted";
}

function proposalRecords(proposal, context) {
  const externalProposalId = proposal.proposal_id ?? hashShort(proposal);
  const proposalId = `category-proposal-${safeId(externalProposalId)}`;
  const proposalKind = normalizeProposalKind(proposal.kind ?? proposal.proposal_kind ?? "unknown");
  const proposalPayload = proposal.payload && typeof proposal.payload === "object" ? proposal.payload : {};
  const evidence = proposal.evidence && typeof proposal.evidence === "object" ? proposal.evidence : {};
  const steeringDomain = normalizeSteeringDomain(proposal.domain ?? inferSteeringDomain(proposalKind));
  const categoryKey = proposal.category_key ?? proposal.topic_uid ?? proposalPayload.category_key ?? proposalPayload.topic_uid ?? null;
  const targetCategoryKey = proposal.target_category_key
    ?? proposal.target_topic_uid
    ?? proposalPayload.target_category_key
    ?? proposalPayload.target_topic_uid
    ?? proposalPayload.parent_category_key
    ?? proposalPayload.parent_topic_uid
    ?? proposalPayload.proposed_parent_category_key
    ?? proposalPayload.proposed_parent_topic_uid
    ?? proposalPayload.target_ref
    ?? null;
  const graphEntityId = proposal.graph_entity_id
    ?? proposalPayload.graph_entity_id
    ?? proposalPayload.entity_id
    ?? proposalPayload.assertion_id
    ?? proposalPayload.source_ref
    ?? null;
  const relationshipType = proposal.relationship_type
    ?? proposalPayload.relationship_type
    ?? proposalPayload.relationship_uid
    ?? (proposalPayload.parent_category_key || proposalPayload.parent_topic_uid ? "subcategory_of" : null);
  const displayName = proposal.display_name ?? proposalPayload.display_name ?? proposalPayload.name ?? null;
  const subtitle = proposal.subheading ?? proposal.subtitle ?? proposalPayload.subheading ?? proposalPayload.subtitle ?? null;
  const description = proposal.description ?? proposalPayload.description ?? null;
  return [
    record("CategoryProposal", {
      id: proposalId,
      categorySetId: context.categorySetId,
      corpusId: context.corpusId,
      importRunId: context.importRunId,
      proposalKind,
      steeringDomain,
      status: proposal.status ?? "proposed",
      title: proposal.title ?? displayName ?? categoryKey ?? proposalKind ?? "Steering proposal",
      summary: proposal.rationale ?? proposal.description ?? null,
      categoryKey,
      targetCategoryKey,
      graphEntityId,
      relationshipType,
      displayName,
      subtitle,
      description,
      evidenceItemIds: compactArray(evidence.item_ids ?? evidence.evidence_item_ids ?? proposal.evidence_item_ids ?? proposalPayload.evidence_item_ids ?? proposalPayload.document_ids),
      suggestedSeedItemIds: compactArray(proposal.suggested_seed_item_ids),
      suggestedHoldoutItemIds: compactArray(proposal.suggested_holdout_item_ids),
      sourceSnapshotId: proposal.snapshot_id ?? proposalPayload.graph_snapshot ?? null,
      proposedAt: dateOrNull(proposal.proposed_at ?? proposal.generated_at) ?? context.now,
      reviewedAt: null,
      reviewedBy: null,
      updatedAt: context.now,
    }),
    rawPayloadRecord("proposal", proposalId, "biblicus-proposal", proposal, context.importRunId, context.now),
  ];
}

function rawPayloadRecord(ownerType, ownerId, payloadKind, payload, importRunId, now) {
  return record("CategoryRawPayload", {
    id: `raw-${safeId(ownerType)}-${safeId(ownerId)}-${safeId(payloadKind)}`,
    ownerType,
    ownerId,
    payloadKind,
    importRunId,
    payload: JSON.stringify(payload ?? {}),
    createdAt: now,
    updatedAt: now,
  });
}

function record(modelName, expected) {
  return { modelName, expected };
}

function versionedRecord(record, { now, actor, reason, content }) {
  const withoutHash = {
    ...record,
    versionNumber: record.versionNumber ?? 1,
    previousVersionId: record.previousVersionId ?? null,
    versionState: record.versionState ?? "current",
    versionCreatedAt: record.versionCreatedAt ?? now,
    versionCreatedBy: record.versionCreatedBy ?? actor,
    changeReason: record.changeReason ?? reason,
  };
  return {
    ...withoutHash,
    contentHash: record.contentHash ?? hashStable(content ?? withoutHash),
  };
}

function readCategoryKey(value) {
  return requiredString(value.category_key ?? value.topic_uid ?? value.categoryKey, "category key");
}

function readParentCategoryKey(value) {
  return value.parent_category_key ?? value.parent_topic_uid ?? value.parentCategoryKey ?? null;
}

function categoryCorpusId(corpus) {
  return `category-corpus-${safeId(corpus.key ?? corpus.name ?? corpus.corpus_uri ?? "unknown")}`;
}

function categorySetIdFor(classifierId, corpusId) {
  return `category-set-${safeId(corpusId)}-${safeId(classifierId)}`;
}

function categoryLineageIdFor(categorySetId, categoryKey) {
  return `category-${safeId(categorySetId)}-${safeId(categoryKey)}`;
}

function normalizeProposalKind(kind) {
  const normalized = String(kind ?? "unknown");
  const replacements = new Map([
    ["new-topic", "new-category"],
    ["rename-topic", "rename-category"],
    ["merge-topic", "merge-category"],
    ["deprecate-topic", "deprecate-category"],
    ["create-taxonomy-node", "create-category"],
    ["move-taxonomy-node", "move-category"],
    ["archive-taxonomy-node", "archive-category"],
    ["merge-taxonomy-nodes", "merge-categories"],
    ["split-taxonomy-node", "split-category"],
    ["add-topic-relationship-edge", "relationship-proposal"],
  ]);
  return replacements.get(normalized) ?? normalized
    .replaceAll("topic", "category")
    .replaceAll("taxonomy-node", "category")
    .replaceAll("taxonomy", "category-tree");
}

function normalizeSteeringDomain(domain) {
  return domain === "topic" ? "category" : String(domain ?? "category");
}

function inferSteeringDomain(kind) {
  if (GRAPH_PROPOSAL_KINDS.has(kind)) return "graph";
  if (String(kind ?? "").includes("graph") || String(kind ?? "").includes("entity") || String(kind ?? "").includes("relationship")) return "graph";
  return "category";
}

function latestSnapshotId(artifacts, kind) {
  return (artifacts ?? []).filter((artifact) => artifact.kind === kind).at(-1)?.snapshot_id ?? null;
}

function latestArtifact(artifacts, kind) {
  return (artifacts ?? []).filter((artifact) => artifact.kind === kind).at(-1) ?? null;
}

function sortTaxonomyNodes(nodes) {
  return [...nodes].sort((left, right) => {
    const depthDiff = (left.depth ?? 0) - (right.depth ?? 0);
    if (depthDiff !== 0) return depthDiff;
    const rankDiff = (left.rank ?? 999999) - (right.rank ?? 999999);
    if (rankDiff !== 0) return rankDiff;
    return String(left.categoryKey).localeCompare(String(right.categoryKey));
  });
}

function corpusNameFromUri(uri) {
  if (!uri) return null;
  try {
    const parsed = new URL(uri);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.at(-1) ?? null;
  } catch {
    return null;
  }
}

function normalizeCorpusContext(corpus, configuredCorpus, defaults = {}) {
  const key = configuredCorpus?.key ?? null;
  const name = configuredCorpus?.name ?? corpus.name ?? key ?? corpusNameFromUri(corpus.corpus_uri) ?? "Unknown corpus";
  return {
    key,
    name,
    corpus_uri: corpus.corpus_uri ?? configuredCorpus?.s3Prefix ?? configuredCorpus?.path ?? null,
    role: configuredCorpus?.role ?? corpus.role ?? defaults.role ?? "source",
  };
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function compactArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compareById(left, right) {
  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function compareByCreatedAt(left, right) {
  const timeDiff = String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
  if (timeDiff !== 0) return timeDiff;
  return compareById(left, right);
}

function compareFeedback(left, right) {
  const rootDiff = String(left.target_category_key ?? "").localeCompare(String(right.target_category_key ?? ""));
  if (rootDiff !== 0) return rootDiff;
  const kindDiff = String(left.proposal_kind ?? "").localeCompare(String(right.proposal_kind ?? ""));
  if (kindDiff !== 0) return kindDiff;
  return String(left.proposal_id ?? "").localeCompare(String(right.proposal_id ?? ""));
}

function dateOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeMatchText(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : null;
}

function safeId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140) || hashShort(value);
}

function hashShort(value) {
  return hashStable(value).slice(0, 16);
}

function hashStable(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

const REVIEWED_PROPOSAL_STATUSES = new Set(["accepted", "rejected", "deferred"]);

function mergeReviewedProposalState(expected, current) {
  if (!current || !REVIEWED_PROPOSAL_STATUSES.has(current.status)) return expected;
  return {
    ...expected,
    status: current.status,
    reviewedAt: current.reviewedAt ?? null,
    reviewedBy: current.reviewedBy ?? null,
  };
}

module.exports = {
  buildAcceptedCategoryTreePayload,
  buildAcceptedCategorySetPayload,
  buildSteeringFeedbackPayload,
  buildSteeringConfigRecords,
  buildProjectionImportRecords,
  buildSteeringImportRecords,
  categoryCorpusId,
  loadJsonFile,
  loadSteeringBundleFromBiblicus,
  mergeReviewedProposalState,
  writeJsonFile,
};
