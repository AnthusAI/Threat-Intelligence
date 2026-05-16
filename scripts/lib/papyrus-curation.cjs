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

function proposalRecords(proposal, context) {
  const externalProposalId = proposal.proposal_id ?? hashShort(proposal);
  const proposalId = `curation-proposal-${safeId(externalProposalId)}`;
  const proposalKind = proposal.kind ?? proposal.proposal_kind ?? "unknown";
  const proposalPayload = proposal.payload && typeof proposal.payload === "object" ? proposal.payload : {};
  const evidence = proposal.evidence && typeof proposal.evidence === "object" ? proposal.evidence : {};
  const steeringDomain = proposal.domain ?? inferSteeringDomain(proposalKind);
  const topicUid = proposal.topic_uid ?? proposalPayload.topic_uid ?? null;
  const targetTopicUid = proposal.target_topic_uid ?? proposalPayload.target_topic_uid ?? null;
  const graphEntityId = proposal.graph_entity_id ?? proposalPayload.graph_entity_id ?? proposalPayload.entity_id ?? null;
  const relationshipType = proposal.relationship_type ?? proposalPayload.relationship_type ?? null;
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
      evidenceItemIds: compactArray(evidence.item_ids ?? evidence.evidence_item_ids ?? proposal.evidence_item_ids),
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

function inferSteeringDomain(kind) {
  if (GRAPH_PROPOSAL_KINDS.has(kind)) return "graph";
  if (String(kind ?? "").includes("graph") || String(kind ?? "").includes("entity") || String(kind ?? "").includes("relationship")) return "graph";
  return "topic";
}

function latestSnapshotId(artifacts, kind) {
  return (artifacts ?? []).filter((artifact) => artifact.kind === kind).at(-1)?.snapshot_id ?? null;
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

module.exports = {
  buildAcceptedTopicSetPayload,
  buildSteeringConfigRecords,
  buildProjectionImportRecords,
  buildSteeringImportRecords,
  curationCorpusId,
  loadJsonFile,
  loadSteeringBundleFromBiblicus,
  writeJsonFile,
};
