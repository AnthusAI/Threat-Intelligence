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
  const corpusId = options.corpusId ?? curationCorpusId(corpusContext);
  const classifierId = bundle.topic_set?.classifier_id ?? options.classifierId ?? "unknown-classifier";
  const importRunId = `curation-import-${safeId(corpusId)}-${safeId(classifierId)}-${hashShort([
    bundle.generated_at,
    bundle.proposals?.length ?? 0,
    bundle.artifacts?.length ?? 0,
  ])}`;
  const topicSetId = curationTopicSetId(classifierId, corpusId);
  const records = [];

  records.push(record("CurationCorpus", {
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

  records.push(record("CurationImportRun", {
    id: importRunId,
    corpusId,
    importKind: "steering-export",
    classifierId,
    sourceSnapshotId: latestSnapshotId(bundle.artifacts, "topic-governance"),
    status: "imported",
    generatedAt: dateOrNull(bundle.generated_at),
    importedAt: now,
    itemCount: bundle.items?.length ?? 0,
    topicCount: bundle.topic_set?.topics?.length ?? 0,
    proposalCount: bundle.proposals?.length ?? 0,
    artifactCount: bundle.artifacts?.length ?? 0,
    projectionCount: 0,
    warningCount: bundle.warnings?.length ?? 0,
  }));
  records.push(rawPayloadRecord("importRun", importRunId, "warnings", { warnings: bundle.warnings ?? [] }, importRunId, now));

  if (bundle.topic_set) {
    records.push(...topicSetRecords(bundle.topic_set, { corpusId, importRunId, topicSetId, now, generatedAt: bundle.generated_at }));
    records.push(...taxonomyRecords(bundle, {
      corpusId,
      corpusPath: options.corpusPath ?? options.corpusConfig?.path ?? options.corpus?.path ?? null,
      importRunId,
      now,
      topicSetId,
    }));
  }

  for (const artifact of bundle.artifacts ?? []) {
    records.push(...artifactRecords(artifact, { corpusId, importRunId, now }));
  }

  for (const proposal of bundle.proposals ?? []) {
    records.push(...proposalRecords(proposal, { corpusId, importRunId, topicSetId, now }));
  }

  return {
    corpusId,
    importRunId,
    topicSetId,
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
  const targetCorpusId = options.targetCorpusId ?? curationCorpusId(targetCorpus);
  const authorityCorpusId = options.authorityCorpusId ?? curationCorpusId(authorityCorpus);
  const classifierId = payload.classifier_id ?? firstItem.classifier_id ?? options.classifierId ?? "unknown-classifier";
  const importRunId = `curation-import-${safeId(targetCorpusId)}-${safeId(classifierId)}-projection-${hashShort(payload.summary ?? items)}`;
  const records = [
    record("CurationCorpus", {
      id: targetCorpusId,
      name: targetCorpus.name,
      role: targetCorpus.role,
      itemCount: null,
      generatedAt: null,
      latestImportRunId: importRunId,
      createdAt: now,
      updatedAt: now,
    }),
    record("CurationImportRun", {
      id: importRunId,
      corpusId: targetCorpusId,
      importKind: "topic-projection",
      classifierId,
      sourceSnapshotId: firstItem.extraction_snapshot?.snapshot_id ?? null,
      status: "imported",
      generatedAt: null,
      importedAt: now,
      itemCount: 0,
      topicCount: 0,
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
    records.push(record("CurationProjection", {
      id: projectionId,
      targetCorpusId,
      authorityCorpusId,
      classifierId,
      modelVersion: item.model_version ?? null,
      externalItemId,
      topicUid: item.topic_uid ?? null,
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
  return (config.corpora ?? []).map((corpus) => record("CurationCorpus", {
    id: curationCorpusId(corpus),
    name: corpus.name,
    role: corpus.role,
    createdAt: now,
    updatedAt: now,
  }));
}

function buildAcceptedTopicSetPayload(topicSet, topics) {
  const sortedTopics = [...topics].sort((left, right) => {
    const rankDiff = (left.rank ?? 999999) - (right.rank ?? 999999);
    if (rankDiff !== 0) return rankDiff;
    return String(left.topicUid).localeCompare(String(right.topicUid));
  });
  return {
    schema_version: 1,
    classifier_id: requiredString(topicSet.classifierId, "topicSet.classifierId"),
    display_name: requiredString(topicSet.displayName, "topicSet.displayName"),
    description: topicSet.description ?? "",
    topics: sortedTopics.map((topic) => ({
      topic_uid: requiredString(topic.topicUid, "topic.topicUid"),
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

function buildAcceptedTaxonomyPayload(taxonomy, nodes) {
  const sortedNodes = sortTaxonomyNodes(nodes);
  return {
    schema_version: 1,
    taxonomy_id: requiredString(taxonomy.taxonomyId ?? taxonomy.id, "taxonomy.taxonomyId"),
    display_name: requiredString(taxonomy.displayName, "taxonomy.displayName"),
    description: taxonomy.description ?? "",
    generated_at: taxonomy.generatedAt ?? taxonomy.updatedAt ?? taxonomy.createdAt ?? new Date().toISOString(),
    ...(taxonomy.snapshotId ? { snapshot_id: taxonomy.snapshotId } : {}),
    nodes: sortedNodes.map((node) => ({
      topic_uid: requiredString(node.topicUid, "node.topicUid"),
      parent_topic_uid: node.parentTopicUid ?? null,
      display_name: requiredString(node.displayName, "node.displayName"),
      description: node.description ?? node.subtitle ?? "",
      status: node.status === "archived" ? "archived" : "accepted",
      seed_item_ids: compactArray(node.seedItemIds),
      holdout_item_ids: compactArray(node.holdoutItemIds),
      source: {
        papyrus_taxonomy_id: taxonomy.id,
        papyrus_taxonomy_node_id: node.id,
      },
    })),
    source: {
      system: "papyrus",
      topic_set_id: taxonomy.topicSetId,
      corpus_id: taxonomy.corpusId,
    },
  };
}

function topicSetRecords(topicSet, context) {
  const topics = topicSet.topics ?? [];
  const acceptedRevisionId = `revision-${safeId(context.topicSetId)}-accepted-${hashShort(topicSet)}`;
  const records = [
    record("CurationTopicSet", {
      id: context.topicSetId,
      corpusId: context.corpusId,
      classifierId: topicSet.classifier_id,
      displayName: topicSet.display_name,
      description: topicSet.description ?? null,
      status: "accepted",
      acceptedRevisionId,
      latestDraftRevisionId: null,
      generatedAt: dateOrNull(context.generatedAt),
      topicCount: topics.length,
      importRunId: context.importRunId,
    }),
    record("CurationTopicRevision", {
      id: acceptedRevisionId,
      topicSetId: context.topicSetId,
      corpusId: context.corpusId,
      revisionKind: "accepted",
      status: "accepted",
      contentHash: hashStable(topicSet),
      sourceImportRunId: context.importRunId,
      sourceDecisionId: null,
      topicCount: topics.length,
      createdAt: context.now,
      acceptedAt: context.now,
      acceptedBy: "biblicus-import",
    }),
    rawPayloadRecord("topicSet", context.topicSetId, "biblicus-topic-set", topicSet, context.importRunId, context.now),
  ];

  for (const [index, topic] of topics.entries()) {
    const topicId = curationTopicId(context.topicSetId, topic.topic_uid);
    records.push(record("CurationTopic", {
      id: topicId,
      topicSetId: context.topicSetId,
      corpusId: context.corpusId,
      topicUid: topic.topic_uid,
      displayName: topic.display_name,
      subtitle: topic.subheading ?? topic.subtitle ?? null,
      description: topic.description ?? null,
      aliases: compactArray(topic.aliases),
      status: "accepted",
      seedItemIds: compactArray(topic.seed_item_ids),
      holdoutItemIds: compactArray(topic.holdout_item_ids),
      rank: index + 1,
      isPinned: Boolean(topic.ranking_hints?.pinned),
      importRunId: context.importRunId,
      updatedAt: context.now,
    }));
    records.push(rawPayloadRecord("topic", topicId, "biblicus-topic", topic, context.importRunId, context.now));
  }
  return records;
}

function artifactRecords(artifact, context) {
  const artifactId = `curation-artifact-${safeId(context.corpusId)}-${hashShort(`${artifact.kind}:${artifact.artifact_id}`)}`;
  return [
    record("CurationArtifact", {
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
    ?? rootTaxonomyManifestFromTopicSet(bundle.topic_set, context);
  const manifestNodes = Array.isArray(manifest.nodes) ? manifest.nodes : [];
  const taxonomyId = curationTaxonomyId(context.topicSetId, manifest.taxonomy_id ?? manifest.snapshot_id ?? "accepted-taxonomy");
  const generatedAt = dateOrNull(manifest.generated_at ?? bundle.generated_at) ?? context.now;
  const activeNodes = manifestNodes.filter((node) => normalizeTaxonomyNodeStatus(node.status) !== "archived");
  const rootCount = activeNodes.filter((node) => !node.parent_topic_uid).length;
  const records = [
    record("CurationTaxonomy", {
      id: taxonomyId,
      corpusId: context.corpusId,
      topicSetId: context.topicSetId,
      taxonomyId: manifest.taxonomy_id ?? taxonomyId,
      displayName: manifest.display_name ?? bundle.topic_set.display_name ?? "Accepted Taxonomy",
      description: manifest.description ?? bundle.topic_set.description ?? null,
      status: "accepted",
      snapshotId: manifest.snapshot_id ?? latestSnapshotId(bundle.artifacts, "taxonomy"),
      generatedAt,
      nodeCount: manifestNodes.length,
      rootCount,
      importRunId: context.importRunId,
      createdAt: context.now,
      updatedAt: context.now,
    }),
    rawPayloadRecord("taxonomy", taxonomyId, "biblicus-taxonomy", manifest, context.importRunId, context.now),
  ];

  const nodeRanks = rankTaxonomyNodes(manifestNodes);
  for (const node of manifestNodes) {
    const topicUid = requiredString(node.topic_uid, "taxonomy node topic_uid");
    const taxonomyNodeId = curationTaxonomyNodeId(taxonomyId, topicUid);
    const depth = taxonomyNodeDepth(topicUid, manifestNodes);
    const rank = nodeRanks.get(topicUid) ?? null;
    records.push(record("CurationTaxonomyNode", {
      id: taxonomyNodeId,
      taxonomyId,
      corpusId: context.corpusId,
      topicSetId: context.topicSetId,
      topicUid,
      parentTopicUid: node.parent_topic_uid ?? null,
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
    }));
    records.push(rawPayloadRecord("taxonomyNode", taxonomyNodeId, "biblicus-taxonomy-node", node, context.importRunId, context.now));
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

function rootTaxonomyManifestFromTopicSet(topicSet, context) {
  const topics = topicSet.topics ?? [];
  const taxonomyIdentity = `${topicSet.classifier_id}-accepted-taxonomy`;
  return {
    schema_version: 1,
    taxonomy_id: taxonomyIdentity,
    display_name: `${topicSet.display_name ?? topicSet.classifier_id} Taxonomy`,
    description: topicSet.description ?? "Root-only taxonomy derived from the accepted canonical topic set.",
    generated_at: context.now,
    snapshot_id: `root-only-${hashShort(topicSet)}`,
    nodes: topics.map((topic) => ({
      topic_uid: topic.topic_uid,
      parent_topic_uid: null,
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
      topic_set_id: context.topicSetId,
    },
  };
}

function rankTaxonomyNodes(nodes) {
  const rankByUid = new Map();
  const childrenByParent = new Map();
  for (const node of nodes) {
    const parent = node.parent_topic_uid ?? "__root__";
    const children = childrenByParent.get(parent) ?? [];
    children.push(node);
    childrenByParent.set(parent, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => String(left.display_name ?? left.topic_uid).localeCompare(String(right.display_name ?? right.topic_uid)));
    children.forEach((node, index) => rankByUid.set(node.topic_uid, index + 1));
  }
  return rankByUid;
}

function taxonomyNodeDepth(topicUid, nodes) {
  const parentByUid = new Map(nodes.map((node) => [node.topic_uid, node.parent_topic_uid ?? null]));
  let depth = 0;
  let current = parentByUid.get(topicUid) ?? null;
  const seen = new Set([topicUid]);
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
  const proposalId = `curation-proposal-${safeId(externalProposalId)}`;
  const proposalKind = proposal.kind ?? proposal.proposal_kind ?? "unknown";
  const proposalPayload = proposal.payload && typeof proposal.payload === "object" ? proposal.payload : {};
  const evidence = proposal.evidence && typeof proposal.evidence === "object" ? proposal.evidence : {};
  const steeringDomain = proposal.domain ?? inferSteeringDomain(proposalKind);
  const topicUid = proposal.topic_uid ?? proposalPayload.topic_uid ?? null;
  const targetTopicUid = proposal.target_topic_uid
    ?? proposalPayload.target_topic_uid
    ?? proposalPayload.parent_topic_uid
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
    ?? (proposalPayload.parent_topic_uid ? "subtopic_of" : null);
  const displayName = proposal.display_name ?? proposalPayload.display_name ?? proposalPayload.name ?? null;
  const subtitle = proposal.subheading ?? proposal.subtitle ?? proposalPayload.subheading ?? proposalPayload.subtitle ?? null;
  const description = proposal.description ?? proposalPayload.description ?? null;
  return [
    record("CurationProposal", {
      id: proposalId,
      topicSetId: context.topicSetId,
      corpusId: context.corpusId,
      importRunId: context.importRunId,
      proposalKind,
      steeringDomain,
      status: proposal.status ?? "proposed",
      title: proposal.title ?? displayName ?? topicUid ?? proposalKind ?? "Steering proposal",
      summary: proposal.rationale ?? proposal.description ?? null,
      topicUid,
      targetTopicUid,
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
  return record("CurationRawPayload", {
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

function curationCorpusId(corpus) {
  return `curation-corpus-${safeId(corpus.key ?? corpus.name ?? corpus.corpus_uri ?? "unknown")}`;
}

function curationTopicSetId(classifierId, corpusId) {
  return `curation-topic-set-${safeId(corpusId)}-${safeId(classifierId)}`;
}

function curationTopicId(topicSetId, topicUid) {
  return `topic-${safeId(topicSetId)}-${safeId(topicUid)}`;
}

function curationTaxonomyId(topicSetId, taxonomyId) {
  return `taxonomy-${safeId(topicSetId)}-${safeId(taxonomyId)}`;
}

function curationTaxonomyNodeId(taxonomyId, topicUid) {
  return `taxonomy-node-${safeId(taxonomyId)}-${safeId(topicUid)}`;
}

function inferSteeringDomain(kind) {
  if (GRAPH_PROPOSAL_KINDS.has(kind)) return "graph";
  if (String(kind ?? "").includes("graph") || String(kind ?? "").includes("entity") || String(kind ?? "").includes("relationship")) return "graph";
  return "topic";
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
    return String(left.topicUid).localeCompare(String(right.topicUid));
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

function dateOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
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
  buildAcceptedTaxonomyPayload,
  buildAcceptedTopicSetPayload,
  buildSteeringConfigRecords,
  buildProjectionImportRecords,
  buildSteeringImportRecords,
  curationCorpusId,
  loadJsonFile,
  loadSteeringBundleFromBiblicus,
  mergeReviewedProposalState,
  writeJsonFile,
};
