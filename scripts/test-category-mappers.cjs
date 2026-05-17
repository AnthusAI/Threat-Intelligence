#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildAcceptedCategorySetPayload,
  buildAcceptedCategoryTreePayload,
  buildProjectionImportRecords,
  buildSteeringConfigRecords,
  buildSteeringFeedbackPayload,
  buildSteeringImportRecords,
  mergeReviewedProposalState,
} = require("./lib/papyrus-categories.cjs");
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
        category_key: "topic.scaling",
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
      category_key: "topic.scaling",
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
        category_key: "topic.scaling",
        graph_entity_id: "entity.benchmark-saturation",
        relationship_type: "influences",
      },
      rationale: "Graph steering row.",
    },
    {
      proposal_id: "proposal-taxonomy-node",
      proposal_kind: "create-category",
      domain: "topic",
      recommendation: "needs_clarification",
      status: "proposed",
      evidence: { item_ids: ["research-001"] },
      rationale: "Scoped discovery found a possible child topic.",
      payload: {
        category_key: "topic.scaling-memory",
        parent_category_key: "topic.scaling",
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
assert.equal(findRecord(configRecords, "CategoryCorpus", (record) => record.id === "category-corpus-canonical-corpus").role, "canonical");
assert.equal(findRecord(configRecords, "CategoryCorpus", (record) => record.id === "category-corpus-source-corpus").name, "Source Corpus");

const steeringPlan = buildSteeringImportRecords(steeringBundle, {
  classifierId: "canonical-classifier",
  corpusConfig: canonicalCorpusConfig,
  importedAt: "2026-05-16T12:30:00.000Z",
});
const configuredCorpus = findRecord(steeringPlan.records, "CategoryCorpus", (record) => record.id === "category-corpus-canonical-corpus");
assert.equal(configuredCorpus.name, "Canonical Corpus");
assert.equal(configuredCorpus.role, "canonical");

const topic = findRecord(steeringPlan.records, "Category", (record) => record.categoryKey === "topic.scaling");
assert.equal(topic.subtitle, "Compute, data, and capability curves");
assert.equal(topic.categoryKey, "topic.scaling");
assert.equal(topic.displayName, "Scaling Laws");

const fallbackTaxonomy = findRecord(steeringPlan.records, "CategorySet", (record) => record.id === steeringPlan.categorySetId);
assert.equal(fallbackTaxonomy.status, "accepted");
const fallbackTaxonomyNode = findRecord(steeringPlan.records, "Category", (record) => record.categoryKey === "topic.scaling");
assert.equal(fallbackTaxonomyNode.parentCategoryKey, null);
assert.equal(fallbackTaxonomyNode.displayName, "Scaling Laws");

assert.equal(
  steeringPlan.records.some((record) => record.modelName === "CategoryCorpusItem"),
  false,
  "Biblicus corpus items stay external and are not mirrored into Papyrus GraphQL",
);
assert.equal(
  steeringPlan.records.some((record) => record.modelName === "CategoryRawPayload" && record.expected.ownerType === "item"),
  false,
  "Biblicus item raw payloads stay out of Papyrus GraphQL",
);

const renameProposal = findRecord(steeringPlan.records, "CategoryProposal", (record) => record.id.includes("proposal-rename-scaling"));
assert.equal(renameProposal.proposalKind, "rename-category");
assert.equal(renameProposal.steeringDomain, "category");
assert.equal(renameProposal.subtitle, "Compute, data, and benchmark saturation");
assert.equal(renameProposal.source_notes, undefined);

const graphProposal = findRecord(steeringPlan.records, "CategoryProposal", (record) => record.id.includes("proposal-graph-relationship"));
assert.equal(graphProposal.steeringDomain, "graph");
assert.equal(graphProposal.relationshipType, "influences");

const categoryProposal = findRecord(steeringPlan.records, "CategoryProposal", (record) => record.id.includes("proposal-taxonomy-node"));
assert.equal(categoryProposal.proposalKind, "create-category");
assert.equal(categoryProposal.steeringDomain, "category");
assert.equal(categoryProposal.categoryKey, "topic.scaling-memory");
assert.equal(categoryProposal.targetCategoryKey, "topic.scaling");
assert.equal(categoryProposal.relationshipType, "subcategory_of");
assert.equal(categoryProposal.displayName, "Scaling Memory");
const preservedRejectedProposal = mergeReviewedProposalState(categoryProposal, {
  ...categoryProposal,
  status: "rejected",
  reviewedAt: "2026-05-16T13:00:00.000Z",
  reviewedBy: "editor@example.com",
});
assert.equal(preservedRejectedProposal.status, "rejected");
assert.equal(preservedRejectedProposal.reviewedAt, "2026-05-16T13:00:00.000Z");
assert.equal(preservedRejectedProposal.reviewedBy, "editor@example.com");
const openProposalReimport = mergeReviewedProposalState(categoryProposal, {
  ...categoryProposal,
  status: "proposed",
  reviewedAt: null,
  reviewedBy: null,
});
assert.equal(openProposalReimport.status, "proposed");

const ontologyProposal = findRecord(steeringPlan.records, "CategoryProposal", (record) => record.id.includes("proposal-ontology-assertion"));
assert.equal(ontologyProposal.proposalKind, "add-ontology-relationship");
assert.equal(ontologyProposal.steeringDomain, "graph");
assert.equal(ontologyProposal.graphEntityId, "assertion-scaling-history");
assert.equal(ontologyProposal.relationshipType, "historical_context_for");
assert.equal(ontologyProposal.targetCategoryKey, "topic:topic.scaling-memory");

const rawProposal = findRecord(steeringPlan.records, "CategoryRawPayload", (record) => record.ownerId === renameProposal.id);
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
      category_key: "topic.scaling",
      parent_category_key: null,
      display_name: "Scaling Laws",
      description: "Root topic.",
      status: "accepted",
      seed_item_ids: ["research-001"],
      holdout_item_ids: ["research-002"],
    },
    {
      category_key: "topic.memory",
      parent_category_key: "topic.scaling",
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
const importedTaxonomyPayload = findRecord(taxonomyPlan.records, "CategoryRawPayload", (record) => record.ownerType === "categoryTree");
assert.equal(JSON.parse(importedTaxonomyPayload.payload).snapshot_id, "taxonomy-snapshot");
const importedChildNode = findRecord(taxonomyPlan.records, "Category", (record) => record.categoryKey === "topic.memory");
assert.equal(importedChildNode.parentCategoryKey, "topic.scaling");
assert.equal(importedChildNode.depth, 1);

const acceptedExport = buildAcceptedCategorySetPayload(
  {
    classifierId: "canonical-classifier",
    displayName: "Canonical Topic Set",
    description: "Accepted topics",
  },
  [
    {
      categoryKey: "topic.scaling",
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
assert.equal(acceptedExport.topics[0].category_key, "topic.scaling");
assert.deepEqual(acceptedExport.topics[0].seed_item_ids, ["research-001"]);

const acceptedTaxonomyExport = buildAcceptedCategoryTreePayload(
  {
    id: "taxonomy-test",
    taxonomyId: "canonical-taxonomy",
    corpusId: "category-corpus-canonical-corpus",
    categorySetId: "category-set-test",
    displayName: "Canonical Taxonomy",
    description: "Accepted hierarchy",
    generatedAt: "2026-05-16T12:31:00.000Z",
  },
  [
    {
      id: "taxonomy-node-root",
      taxonomyId: "taxonomy-test",
      categoryKey: "topic.scaling",
      parentCategoryKey: null,
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
      categoryKey: "topic.memory",
      parentCategoryKey: "topic.scaling",
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
assert.equal(acceptedTaxonomyExport.nodes[1].parent_category_key, "topic.scaling");
assert.deepEqual(acceptedTaxonomyExport.nodes[0].seed_item_ids, ["research-001"]);

const steeringFeedbackExport = buildSteeringFeedbackPayload(
  {
    id: steeringPlan.categorySetId,
    corpusId: steeringPlan.corpusId,
    classifierId: "canonical-classifier",
    displayName: "Canonical Topic Set",
    description: "Accepted topics",
  },
  [
    {
      ...categoryProposal,
      status: "rejected",
      reviewedAt: "2026-05-16T13:00:00.000Z",
      reviewedBy: "editor@example.com",
    },
    {
      ...ontologyProposal,
      status: "accepted",
      reviewedAt: "2026-05-16T13:05:00.000Z",
      reviewedBy: "editor@example.com",
    },
  ],
  [
    {
      id: "decision-reject-taxonomy-node",
      proposalId: categoryProposal.id,
      categorySetId: steeringPlan.categorySetId,
      action: "reject",
      actorLabel: "editor@example.com",
      actorSub: "editor-sub",
      note: "Too broad.",
      selectedCategoryKey: categoryProposal.categoryKey,
      createdAt: "2026-05-16T13:00:00.000Z",
    },
    {
      id: "decision-accept-ontology",
      proposalId: ontologyProposal.id,
      categorySetId: steeringPlan.categorySetId,
      action: "accept",
      actorLabel: "editor@example.com",
      actorSub: "editor-sub",
      note: null,
      selectedCategoryKey: ontologyProposal.categoryKey,
      createdAt: "2026-05-16T13:05:00.000Z",
    },
  ],
  { generatedAt: "2026-05-16T13:10:00.000Z" },
);
assert.equal(steeringFeedbackExport.export_kind, "papyrus-steering-feedback");
assert.equal(steeringFeedbackExport.rejected_proposals.length, 1);
assert.equal(steeringFeedbackExport.accepted_proposals.length, 1);
assert.equal(steeringFeedbackExport.suppressions[0].proposal_id, categoryProposal.id);
assert.equal(steeringFeedbackExport.suppressions[0].scope.root_category_key, "topic.scaling");
assert.equal(steeringFeedbackExport.suppressions[0].match.category_key, "topic.scaling-memory");
assert.equal(steeringFeedbackExport.suppressions[0].match.normalized_display_name, "scaling memory");
assert.equal(steeringFeedbackExport.decisions.length, 2);

const projectionPlan = buildProjectionImportRecords({
  classifier_id: "canonical-classifier",
  summary: { source: "projection-test" },
  items: [
    {
      item_id: "source-001",
      target_corpus_uri: "s3://example/corpora/source-corpus",
      classifier_corpus_uri: "s3://example/corpora/canonical-corpus",
      category_key: "topic.scaling",
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
const projection = findRecord(projectionPlan.records, "CategoryProjection", (record) => record.externalItemId === "source-001");
assert.equal(projection.categoryKey, "topic.scaling");
assert.equal(projection.reviewRecommended, true);
const projectionCorpus = findRecord(projectionPlan.records, "CategoryCorpus", (record) => record.id === "category-corpus-source-corpus");
assert.equal(projectionCorpus.role, "source");
assert.equal(
  projectionPlan.records.some((record) => JSON.stringify(record.expected).includes("AI-ML-research") || JSON.stringify(record.expected).includes("AI-ML-history")),
  false,
  "projection imports should use configured corpus ids without AI/ML name fallbacks",
);

console.log("category mapper tests passed");

function findRecord(records, modelName, predicate) {
  const record = records.find((entry) => entry.modelName === modelName && predicate(entry.expected));
  assert.ok(record, `Expected ${modelName} record`);
  return record.expected;
}
