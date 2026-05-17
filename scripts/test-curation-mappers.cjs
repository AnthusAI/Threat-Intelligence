#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildAcceptedTopicSetPayload,
  buildAcceptedTaxonomyPayload,
  buildProjectionImportRecords,
  buildSteeringConfigRecords,
  buildSteeringImportRecords,
  mergeReviewedProposalState,
} = require("./lib/papyrus-curation.cjs");
const {
  loadSteeringConfig,
  requireCorpusConfig,
  resolveClassifierForCorpus,
} = require("./lib/papyrus-steering-config.cjs");

const steeringBundle = {
  generated_at: "2026-05-16T12:00:00.000Z",
  corpus: {
    name: "Knowledge Base Canonical",
    item_count: 2,
    generated_at: "2026-05-16T11:59:00.000Z",
  },
  topic_set: {
    classifier_id: "canonical-classifier",
    display_name: "Canonical Topic Set",
    description: "Accepted topics",
    topics: [
      {
        topic_uid: "topic.scaling",
        display_name: "Scaling Laws",
        subheading: "Compute, data, and capability curves",
        description: "Model scaling research.",
        aliases: ["foundation scaling"],
        seed_item_ids: ["research-001"],
        holdout_item_ids: ["research-002"],
        ranking_hints: { pinned: true },
      },
    ],
  },
  items: [
    {
      item_id: "research-001",
      title: "Scaling Laws For Neural Language Models",
      media_type: "paper",
      source_uri: "https://arxiv.org/abs/2001.08361",
      dates: { published_at: "2020-01-01" },
      intake_status: "ready",
      tags: ["scaling"],
      source_notes: "private notes stay in raw payload",
    },
  ],
  artifacts: [
    {
      kind: "topic-governance",
      artifact_id: "s3://example/topic-set.json",
      snapshot_id: "snapshot-topic-set",
      metadata: { name: "Topic governance" },
      created_at: "2026-05-16T12:00:00.000Z",
    },
  ],
  proposals: [
    {
      proposal_id: "proposal-rename-scaling",
      kind: "rename-topic",
      topic_uid: "topic.scaling",
      display_name: "Foundation Model Scaling",
      subheading: "Compute, data, and benchmark saturation",
      rationale: "The evidence uses this newer name.",
      evidence: { item_ids: ["research-001"] },
      suggested_seed_item_ids: ["research-001"],
      source_notes: "private proposal note",
    },
    {
      proposal_id: "proposal-graph-relationship",
      proposal_kind: "add-topic-relationship-edge",
      domain: "graph",
      payload: {
        topic_uid: "topic.scaling",
        graph_entity_id: "entity.benchmark-saturation",
        relationship_type: "influences",
      },
      rationale: "Graph steering row.",
    },
    {
      proposal_id: "proposal-taxonomy-node",
      proposal_kind: "create-taxonomy-node",
      domain: "topic",
      recommendation: "needs_clarification",
      status: "proposed",
      evidence: { item_ids: ["research-001"] },
      rationale: "Scoped discovery found a possible child topic.",
      payload: {
        topic_uid: "topic.scaling-memory",
        parent_topic_uid: "topic.scaling",
        display_name: "Scaling Memory",
        description: "Candidate child topic under scaling.",
        document_ids: ["research-001"],
        keywords: ["memory"],
      },
    },
    {
      proposal_id: "proposal-ontology-assertion",
      proposal_kind: "add-ontology-relationship",
      domain: "graph",
      recommendation: "recommend",
      status: "proposed",
      evidence: { item_ids: ["research-001"] },
      rationale: "The evidence supports a typed relationship.",
      payload: {
        assertion_id: "assertion-scaling-history",
        source_ref: "topic:topic.history",
        relationship_uid: "historical_context_for",
        target_ref: "topic:topic.scaling-memory",
        evidence_item_ids: ["research-001"],
      },
    },
  ],
  warnings: [],
};

const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "papyrus-steering-")), "steering.yml");
fs.writeFileSync(configPath, `schemaVersion: 1
publication:
  name: "Mapper Test Publication"
canonicalTopicSet:
  corpusKey: "canonical-corpus"
  classifierId: "canonical-classifier"
corpora:
  - key: "canonical-corpus"
    name: "Canonical Corpus"
    path: "corpora/canonical-corpus"
    s3Prefix: "s3://example/corpora/canonical-corpus/"
    role: "canonical"
    localClassifiers:
      - classifierId: "canonical-classifier"
        label: "Canonical Topics"
  - key: "source-corpus"
    name: "Source Corpus"
    path: "corpora/source-corpus"
    s3Prefix: "s3://example/corpora/source-corpus/"
    role: "source"
    canonicalProjection:
      authorityCorpusKey: "canonical-corpus"
      classifierId: "canonical-classifier"
    localClassifiers:
      - classifierId: "source-classifier"
        label: "Source Topics"
`, "utf8");
const steeringConfig = loadSteeringConfig({ configPath });
const canonicalCorpusConfig = requireCorpusConfig(steeringConfig, "canonical-corpus");
const sourceCorpusConfig = requireCorpusConfig(steeringConfig, "source-corpus");
assert.equal(resolveClassifierForCorpus(steeringConfig, canonicalCorpusConfig), "canonical-classifier");
assert.equal(resolveClassifierForCorpus(steeringConfig, sourceCorpusConfig), "source-classifier");
const configRecords = buildSteeringConfigRecords(steeringConfig, { importedAt: "2026-05-16T12:15:00.000Z" });
assert.equal(findRecord(configRecords, "CurationCorpus", (record) => record.id === "curation-corpus-canonical-corpus").role, "canonical");
assert.equal(findRecord(configRecords, "CurationCorpus", (record) => record.id === "curation-corpus-source-corpus").name, "Source Corpus");

const steeringPlan = buildSteeringImportRecords(steeringBundle, {
  classifierId: "canonical-classifier",
  corpusConfig: canonicalCorpusConfig,
  importedAt: "2026-05-16T12:30:00.000Z",
});
const configuredCorpus = findRecord(steeringPlan.records, "CurationCorpus", (record) => record.id === "curation-corpus-canonical-corpus");
assert.equal(configuredCorpus.name, "Canonical Corpus");
assert.equal(configuredCorpus.role, "canonical");

const topic = findRecord(steeringPlan.records, "CurationTopic", (record) => record.topicUid === "topic.scaling");
assert.equal(topic.subtitle, "Compute, data, and capability curves");
assert.equal(topic.topicUid, "topic.scaling");
assert.equal(topic.displayName, "Scaling Laws");

const fallbackTaxonomy = findRecord(steeringPlan.records, "CurationTaxonomy", (record) => record.topicSetId === steeringPlan.topicSetId);
assert.equal(fallbackTaxonomy.status, "accepted");
const fallbackTaxonomyNode = findRecord(steeringPlan.records, "CurationTaxonomyNode", (record) => record.topicUid === "topic.scaling");
assert.equal(fallbackTaxonomyNode.parentTopicUid, null);
assert.equal(fallbackTaxonomyNode.displayName, "Scaling Laws");

assert.equal(
  steeringPlan.records.some((record) => record.modelName === "CurationItem"),
  false,
  "Biblicus corpus items stay external and are not mirrored into Papyrus GraphQL",
);
assert.equal(
  steeringPlan.records.some((record) => record.modelName === "CurationRawPayload" && record.expected.ownerType === "item"),
  false,
  "Biblicus item raw payloads stay out of Papyrus GraphQL",
);

const topicProposal = findRecord(steeringPlan.records, "CurationProposal", (record) => record.id.includes("proposal-rename-scaling"));
assert.equal(topicProposal.steeringDomain, "topic");
assert.equal(topicProposal.subtitle, "Compute, data, and benchmark saturation");
assert.equal(topicProposal.source_notes, undefined);

const graphProposal = findRecord(steeringPlan.records, "CurationProposal", (record) => record.id.includes("proposal-graph-relationship"));
assert.equal(graphProposal.steeringDomain, "graph");
assert.equal(graphProposal.relationshipType, "influences");

const taxonomyProposal = findRecord(steeringPlan.records, "CurationProposal", (record) => record.id.includes("proposal-taxonomy-node"));
assert.equal(taxonomyProposal.proposalKind, "create-taxonomy-node");
assert.equal(taxonomyProposal.steeringDomain, "topic");
assert.equal(taxonomyProposal.topicUid, "topic.scaling-memory");
assert.equal(taxonomyProposal.targetTopicUid, "topic.scaling");
assert.equal(taxonomyProposal.relationshipType, "subtopic_of");
assert.equal(taxonomyProposal.displayName, "Scaling Memory");
const preservedRejectedProposal = mergeReviewedProposalState(taxonomyProposal, {
  ...taxonomyProposal,
  status: "rejected",
  reviewedAt: "2026-05-16T13:00:00.000Z",
  reviewedBy: "editor@example.com",
});
assert.equal(preservedRejectedProposal.status, "rejected");
assert.equal(preservedRejectedProposal.reviewedAt, "2026-05-16T13:00:00.000Z");
assert.equal(preservedRejectedProposal.reviewedBy, "editor@example.com");
const openProposalReimport = mergeReviewedProposalState(taxonomyProposal, {
  ...taxonomyProposal,
  status: "proposed",
  reviewedAt: null,
  reviewedBy: null,
});
assert.equal(openProposalReimport.status, "proposed");

const ontologyProposal = findRecord(steeringPlan.records, "CurationProposal", (record) => record.id.includes("proposal-ontology-assertion"));
assert.equal(ontologyProposal.proposalKind, "add-ontology-relationship");
assert.equal(ontologyProposal.steeringDomain, "graph");
assert.equal(ontologyProposal.graphEntityId, "assertion-scaling-history");
assert.equal(ontologyProposal.relationshipType, "historical_context_for");
assert.equal(ontologyProposal.targetTopicUid, "topic:topic.scaling-memory");

const rawProposal = findRecord(steeringPlan.records, "CurationRawPayload", (record) => record.ownerId === topicProposal.id);
assert.equal(rawProposal.payloadKind, "biblicus-proposal");
assert.ok(JSON.parse(rawProposal.payload).source_notes);

const taxonomyCorpusPath = fs.mkdtempSync(path.join(os.tmpdir(), "papyrus-taxonomy-corpus-"));
const taxonomyDir = path.join(taxonomyCorpusPath, "analysis", "taxonomy", "taxonomy-snapshot");
fs.mkdirSync(taxonomyDir, { recursive: true });
fs.writeFileSync(path.join(taxonomyDir, "manifest.json"), JSON.stringify({
  schema_version: 1,
  analysis_id: "taxonomy",
  taxonomy_id: "canonical-taxonomy",
  snapshot_id: "taxonomy-snapshot",
  generated_at: "2026-05-16T12:31:00.000Z",
  node_count: 2,
  root_count: 1,
  artifact_paths: {
    taxonomy: path.join(taxonomyDir, "taxonomy.json"),
  },
}, null, 2), "utf8");
fs.writeFileSync(path.join(taxonomyDir, "taxonomy.json"), JSON.stringify({
  schema_version: 1,
  taxonomy_id: "canonical-taxonomy",
  display_name: "Canonical Taxonomy",
  description: "Accepted hierarchy",
  generated_at: "2026-05-16T12:31:00.000Z",
  snapshot_id: "taxonomy-snapshot",
  nodes: [
    {
      topic_uid: "topic.scaling",
      parent_topic_uid: null,
      display_name: "Scaling Laws",
      description: "Root topic.",
      status: "accepted",
      seed_item_ids: ["research-001"],
      holdout_item_ids: ["research-002"],
    },
    {
      topic_uid: "topic.memory",
      parent_topic_uid: "topic.scaling",
      display_name: "Memory Systems",
      description: "Child topic.",
      status: "accepted",
      seed_item_ids: ["research-001"],
      holdout_item_ids: [],
    },
  ],
}, null, 2), "utf8");
const taxonomyPlan = buildSteeringImportRecords({
  ...steeringBundle,
  artifacts: [
    ...steeringBundle.artifacts,
    {
      kind: "taxonomy",
      artifact_id: "taxonomy:taxonomy-snapshot",
      path: "analysis/taxonomy/taxonomy-snapshot/manifest.json",
      snapshot_id: "taxonomy-snapshot",
      created_at: "2026-05-16T12:31:00.000Z",
      metadata: { analysis_id: "taxonomy" },
    },
  ],
}, {
  classifierId: "canonical-classifier",
  corpusConfig: canonicalCorpusConfig,
  corpusPath: taxonomyCorpusPath,
  importedAt: "2026-05-16T12:31:00.000Z",
});
const importedTaxonomy = findRecord(taxonomyPlan.records, "CurationTaxonomy", (record) => record.taxonomyId === "canonical-taxonomy");
assert.equal(importedTaxonomy.snapshotId, "taxonomy-snapshot");
const importedChildNode = findRecord(taxonomyPlan.records, "CurationTaxonomyNode", (record) => record.topicUid === "topic.memory");
assert.equal(importedChildNode.parentTopicUid, "topic.scaling");
assert.equal(importedChildNode.depth, 1);

const acceptedExport = buildAcceptedTopicSetPayload(
  {
    classifierId: "canonical-classifier",
    displayName: "Canonical Topic Set",
    description: "Accepted topics",
  },
  [
    {
      topicUid: "topic.scaling",
      displayName: "Foundation Model Scaling",
      subtitle: "Subtitle written in Papyrus",
      description: "Accepted description",
      aliases: ["scaling laws"],
      seedItemIds: ["research-001"],
      holdoutItemIds: ["research-002"],
      rank: 1,
      isPinned: true,
    },
  ],
);
assert.equal(acceptedExport.topics[0].subheading, "Subtitle written in Papyrus");
assert.equal(acceptedExport.topics[0].topic_uid, "topic.scaling");
assert.deepEqual(acceptedExport.topics[0].seed_item_ids, ["research-001"]);

const acceptedTaxonomyExport = buildAcceptedTaxonomyPayload(
  {
    id: "taxonomy-test",
    taxonomyId: "canonical-taxonomy",
    corpusId: "curation-corpus-canonical-corpus",
    topicSetId: "curation-topic-set-test",
    displayName: "Canonical Taxonomy",
    description: "Accepted hierarchy",
    generatedAt: "2026-05-16T12:31:00.000Z",
  },
  [
    {
      id: "taxonomy-node-root",
      taxonomyId: "taxonomy-test",
      topicUid: "topic.scaling",
      parentTopicUid: null,
      displayName: "Scaling Laws",
      description: "Root topic.",
      status: "accepted",
      seedItemIds: ["research-001"],
      holdoutItemIds: [],
      rank: 1,
      depth: 0,
    },
    {
      id: "taxonomy-node-child",
      taxonomyId: "taxonomy-test",
      topicUid: "topic.memory",
      parentTopicUid: "topic.scaling",
      displayName: "Memory Systems",
      description: "Child topic.",
      status: "accepted",
      seedItemIds: [],
      holdoutItemIds: [],
      rank: 1,
      depth: 1,
    },
  ],
);
assert.equal(acceptedTaxonomyExport.taxonomy_id, "canonical-taxonomy");
assert.equal(acceptedTaxonomyExport.nodes[1].parent_topic_uid, "topic.scaling");
assert.deepEqual(acceptedTaxonomyExport.nodes[0].seed_item_ids, ["research-001"]);

const projectionPlan = buildProjectionImportRecords({
  classifier_id: "canonical-classifier",
  summary: { source: "projection-test" },
  items: [
    {
      item_id: "source-001",
      target_corpus_uri: "s3://example/corpora/source-corpus",
      classifier_corpus_uri: "s3://example/corpora/canonical-corpus",
      topic_uid: "topic.scaling",
      display_name: "Foundation Model Scaling",
      score: 0.82,
      review_recommended: true,
      model_version: "classifier-v1",
    },
  ],
}, {
  authorityCorpusConfig: canonicalCorpusConfig,
  targetCorpusConfig: sourceCorpusConfig,
});
const projection = findRecord(projectionPlan.records, "CurationProjection", (record) => record.externalItemId === "source-001");
assert.equal(projection.topicUid, "topic.scaling");
assert.equal(projection.reviewRecommended, true);
const projectionCorpus = findRecord(projectionPlan.records, "CurationCorpus", (record) => record.id === "curation-corpus-source-corpus");
assert.equal(projectionCorpus.role, "source");
assert.equal(
  projectionPlan.records.some((record) => JSON.stringify(record.expected).includes("AI-ML-research") || JSON.stringify(record.expected).includes("AI-ML-history")),
  false,
  "projection imports should use configured corpus ids without AI/ML name fallbacks",
);

console.log("curation mapper tests passed");

function findRecord(records, modelName, predicate) {
  const record = records.find((entry) => entry.modelName === modelName && predicate(entry.expected));
  assert.ok(record, `Expected ${modelName} record`);
  return record.expected;
}
