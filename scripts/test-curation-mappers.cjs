#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  buildAcceptedTopicSetPayload,
  buildProjectionImportRecords,
  buildSteeringImportRecords,
} = require("./lib/papyrus-curation.cjs");

const steeringBundle = {
  generated_at: "2026-05-16T12:00:00.000Z",
  corpus: {
    name: "AI-ML-research",
    item_count: 2,
    generated_at: "2026-05-16T11:59:00.000Z",
  },
  topic_set: {
    classifier_id: "ai-ml-topic-classifier",
    display_name: "AI/ML Topic Set",
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
      kind: "relationship-proposal",
      topic_uid: "topic.scaling",
      graph_entity_id: "entity.benchmark-saturation",
      relationship_type: "influences",
      rationale: "Graph steering row.",
    },
  ],
  warnings: [],
};

const steeringPlan = buildSteeringImportRecords(steeringBundle, {
  classifierId: "ai-ml-topic-classifier",
  importedAt: "2026-05-16T12:30:00.000Z",
});

const topic = findRecord(steeringPlan.records, "CurationTopic", (record) => record.topicUid === "topic.scaling");
assert.equal(topic.subtitle, "Compute, data, and capability curves");
assert.equal(topic.topicUid, "topic.scaling");
assert.equal(topic.displayName, "Scaling Laws");

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

const rawProposal = findRecord(steeringPlan.records, "CurationRawPayload", (record) => record.ownerId === topicProposal.id);
assert.equal(rawProposal.payloadKind, "biblicus-proposal");
assert.ok(JSON.parse(rawProposal.payload).source_notes);

const acceptedExport = buildAcceptedTopicSetPayload(
  {
    classifierId: "ai-ml-topic-classifier",
    displayName: "AI/ML Topic Set",
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

const projectionPlan = buildProjectionImportRecords({
  classifier_id: "ai-ml-topic-classifier",
  summary: { source: "projection-test" },
  items: [
    {
      item_id: "history-001",
      target_corpus_uri: "s3://papyrus-corpora/AI-ML-history",
      classifier_corpus_uri: "s3://papyrus-corpora/AI-ML-research",
      topic_uid: "topic.scaling",
      display_name: "Foundation Model Scaling",
      score: 0.82,
      review_recommended: true,
      model_version: "classifier-v1",
    },
  ],
});
const projection = findRecord(projectionPlan.records, "CurationProjection", (record) => record.externalItemId === "history-001");
assert.equal(projection.topicUid, "topic.scaling");
assert.equal(projection.reviewRecommended, true);
const projectionCorpus = findRecord(projectionPlan.records, "CurationCorpus", (record) => record.id === "curation-corpus-ai-ml-history");
assert.equal(projectionCorpus.role, "projection");

console.log("curation mapper tests passed");

function findRecord(records, modelName, predicate) {
  const record = records.find((entry) => entry.modelName === modelName && predicate(entry.expected));
  assert.ok(record, `Expected ${modelName} record`);
  return record.expected;
}
