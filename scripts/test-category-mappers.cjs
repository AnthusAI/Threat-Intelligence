#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildAcceptedCategorySetPayload,
  buildAcceptedCategoryTreePayload,
  buildLexicalSteeringConfigRecords,
  buildLexicalSteeringPayload,
  buildPreparedReferenceCatalog,
  buildProjectionImportRecords,
  buildReferenceCatalogRegistrationRecords,
  buildSteeringConfigRecords,
  buildSteeringFeedbackPayload,
  buildSteeringImportRecords,
  loadLexicalSteeringConfig,
  loadSemanticConceptSeeds,
  mergeReviewedProposalState,
} = require("./lib/papyrus-categories.cjs");
const {
  buildCurationCyclePlan,
} = require("./lib/papyrus-curation-cycle.cjs");
const {
  buildAnalysisReindexAssignmentRecords,
  buildAnalysisReindexPlan,
  loadAnalysisProfiles,
  mapExistingRecords,
  parseAnalysisOverrides,
} = require("./lib/papyrus-analysis-profiles.cjs");
const {
  DEFAULT_LANES,
  buildEditionPlanningPlan,
  verifyEditionPlanningPlan,
} = require("./lib/papyrus-edition-planning.cjs");
const {
  buildSemanticRelationBackfillRecords,
  buildSemanticRelationTypeRecords,
  loadSemanticRelationTypeSeeds,
  semanticRelationTypeFieldsForPredicate,
  semanticRelationTypeIdFor,
} = require("./lib/papyrus-relation-types.cjs");
const {
  loadSteeringConfig,
  requireCorpusConfig,
  resolveClassifierForCorpus,
} = require("./lib/papyrus-steering-config.cjs");
const {
  isEvidenceEligibleReference,
  normalizeReferenceCurationStatus,
  scopeTrainingLabelForReference,
} = require("./lib/papyrus-reference-policy.cjs");
const {
  getAssignmentTypePolicy,
} = require("./lib/papyrus-assignment-types.cjs");
const {
  NEWSROOM_SUMMARY_PAYLOAD_ID,
  applySummaryDeltas,
  buildNewsroomSummaryPayload,
  buildNewsroomSummaryPayloadRecord,
  computeCurrentReferenceDeltaFromChanges,
  normalizeNewsroomSummaryPayload,
} = require("./lib/papyrus-newsroom-summary.cjs");
const {
  SOURCE_READINESS_STATES,
  SOURCE_TEXT_STATES,
  buildExtractionIndex,
  buildReferenceSourceStatusRows,
  referenceSourceReadiness,
} = require("./lib/papyrus-reference-source-readiness.cjs");

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
        keywords: [
          { keyword: "scaling laws", weight: 0.91 },
          { keyword: "et", weight: 0.12 },
        ],
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
      storage_path: "s3://example/corpora/canonical-corpus/research-001.md",
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
const semanticConceptSeeds = loadSemanticConceptSeeds();
assert.equal(semanticConceptSeeds.filter((concept) => concept.nodeKind === "editorialForm").length, 4);
assert.equal(semanticConceptSeeds.find((concept) => concept.nodeKey === "editorial.form.reporting")?.scope, "global");
assert.equal(semanticConceptSeeds.find((concept) => concept.nodeKey === "comment.ingestion_rationale")?.scope, "corpus");
assert.equal(semanticConceptSeeds.find((concept) => concept.nodeKey === "editorial.form.briefs")?.displayName, "Briefs");
assert.deepEqual(DEFAULT_LANES.map((lane) => lane.laneKey), ["reporting", "analysis", "briefs"]);
const lexicalConfig = loadLexicalSteeringConfig();
assert.equal(lexicalConfig.keywordDisplay.preview_count, 6);
assert.equal(lexicalConfig.ignoredTerms.find((rule) => rule.term === "et")?.normalizedTerm, "et");
assert.equal(lexicalConfig.ignoredTerms.find((rule) => rule.term === "al")?.scope, "publication");
const lexicalConfigRecords = buildLexicalSteeringConfigRecords(lexicalConfig, { importedAt: "2026-05-16T12:16:00.000Z" });
const etRule = findRecord(lexicalConfigRecords, "LexicalSteeringRule", (record) => record.normalizedTerm === "et");
assert.equal(etRule.ruleKind, "ignored_keyword");
assert.equal(etRule.status, "active");
assert.equal(etRule.scope, "publication");
const canonicalCorpusConfig = requireCorpusConfig(steeringConfig, "canonical-corpus");
const sourceCorpusConfig = requireCorpusConfig(steeringConfig, "source-corpus");
assert.equal(resolveClassifierForCorpus(steeringConfig, canonicalCorpusConfig), "canonical-classifier");
assert.equal(resolveClassifierForCorpus(steeringConfig, sourceCorpusConfig), "source-classifier");
const configRecords = buildSteeringConfigRecords(steeringConfig, { importedAt: "2026-05-16T12:15:00.000Z" });
assert.equal(findRecord(configRecords, "KnowledgeCorpus", (record) => record.id === "knowledge-corpus-canonical-corpus").role, "canonical");
assert.equal(findRecord(configRecords, "KnowledgeCorpus", (record) => record.id === "knowledge-corpus-source-corpus").name, "Source Corpus");
const cyclePlan = buildCurationCyclePlan(steeringConfig, {
  runId: "test-run",
  outputDir: "/tmp/papyrus-cycle-test",
  biblicusWorkdir: "/tmp/biblicus",
});
assert.equal(cyclePlan.canonical.corpus.key, "canonical-corpus");
assert.equal(cyclePlan.canonical.classifierId, "canonical-classifier");
assert.equal(cyclePlan.sourceProjections.length, 1);
assert.equal(cyclePlan.sourceProjections[0].targetCorpus.key, "source-corpus");
assert.equal(cyclePlan.sourceProjections[0].classifierId, "canonical-classifier");
assert.equal(cyclePlan.canonical.seedManifestPath, "/tmp/biblicus/corpora/canonical-corpus/metadata/topic-classifiers/canonical-classifier/seed-manifest.json");
assert.equal(cyclePlan.canonical.lexicalSteeringPath, "/tmp/papyrus-cycle-test/canonical-corpus-lexical-steering.json");

const steeringPlan = buildSteeringImportRecords(steeringBundle, {
  classifierId: "canonical-classifier",
  corpusConfig: canonicalCorpusConfig,
  importedAt: "2026-05-16T12:30:00.000Z",
});
const configuredCorpus = findRecord(steeringPlan.records, "KnowledgeCorpus", (record) => record.id === "knowledge-corpus-canonical-corpus");
assert.equal(configuredCorpus.name, "Canonical Corpus");
assert.equal(configuredCorpus.role, "canonical");

const topic = findRecord(steeringPlan.records, "Category", (record) => record.categoryKey === "topic.scaling");
assert.equal(topic.subtitle, "Compute, data, and capability curves");
assert.equal(topic.categoryKey, "topic.scaling");
assert.equal(topic.displayName, "Scaling Laws");
const scalingKeyword = findRecord(steeringPlan.records, "CategoryKeyword", (record) => record.categoryKey === "topic.scaling" && record.normalizedKeyword === "scaling laws");
assert.equal(scalingKeyword.keyword, "scaling laws");
assert.equal(scalingKeyword.weight, 0.91);
assert.equal(scalingKeyword.source, "accepted-category-set");

const fallbackTaxonomy = findRecord(steeringPlan.records, "CategorySet", (record) => record.id === steeringPlan.categorySetId);
assert.equal(fallbackTaxonomy.status, "accepted");
const fallbackTaxonomyNode = findRecord(steeringPlan.records, "Category", (record) => record.categoryKey === "topic.scaling");
assert.equal(fallbackTaxonomyNode.parentCategoryKey, null);
assert.equal(fallbackTaxonomyNode.displayName, "Scaling Laws");

assert.equal(steeringPlan.records.some((record) => record.modelName === "Reference"), false);
assert.equal(steeringPlan.records.some((record) => record.modelName === "ReferenceAttachment"), false);
assert.equal(steeringPlan.records.some((record) => record.modelName === "Assignment"), false);
const reportingConcept = findRecord(steeringPlan.records, "SemanticNode", (record) => record.nodeKey === "editorial.form.reporting");
assert.equal(reportingConcept.id, "semantic-node-editorial-form-reporting-v1");
assert.equal(reportingConcept.lineageId, "semantic-node-editorial-form-reporting");
assert.equal(reportingConcept.nodeKind, "editorialForm");
assert.equal(reportingConcept.displayName, "Reporting");
assert.equal(reportingConcept.corpusId, null);
assert.equal(reportingConcept.categorySetId, null);
assert.equal(reportingConcept.categoryLineageId, null);
assert.equal(reportingConcept.categoryKey, null);
assert.deepEqual(reportingConcept.aliases, ["reported story", "news report"]);
const briefsConcept = findRecord(steeringPlan.records, "SemanticNode", (record) => record.nodeKey === "editorial.form.briefs");
assert.equal(briefsConcept.displayName, "Briefs");
assert.equal(steeringPlan.records.filter((record) => record.modelName === "SemanticNode" && record.expected.nodeKind === "editorialForm").length, 4);
assert.equal(
  steeringPlan.records.some((record) => record.modelName === "KnowledgeRawPayload" && record.expected.ownerType === "item"),
  false,
  "Biblicus item raw payloads stay out of Papyrus GraphQL",
);

const renameProposal = findRecord(steeringPlan.records, "SteeringProposal", (record) => record.id.includes("proposal-rename-scaling"));
assert.equal(renameProposal.proposalKind, "rename-category");
assert.equal(renameProposal.steeringDomain, "category");
assert.equal(renameProposal.subtitle, "Compute, data, and benchmark saturation");
assert.equal(renameProposal.source_notes, undefined);

const graphProposal = findRecord(steeringPlan.records, "SteeringProposal", (record) => record.id.includes("proposal-graph-relationship"));
assert.equal(graphProposal.steeringDomain, "graph");
assert.equal(graphProposal.relationshipType, "influences");

const categoryProposal = findRecord(steeringPlan.records, "SteeringProposal", (record) => record.id.includes("proposal-taxonomy-node"));
assert.equal(categoryProposal.proposalKind, "create-category");
assert.equal(categoryProposal.steeringDomain, "category");
assert.equal(categoryProposal.categoryKey, "topic.scaling-memory");
assert.equal(categoryProposal.targetCategoryKey, "topic.scaling");
assert.equal(categoryProposal.relationshipType, "subcategory_of");
assert.equal(categoryProposal.displayName, "Scaling Memory");
const proposalKeyword = findRecord(steeringPlan.records, "CategoryKeyword", (record) => record.categoryKey === "topic.scaling-memory" && record.normalizedKeyword === "memory");
assert.equal(proposalKeyword.source, "steering-proposal");
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

const ontologyProposal = findRecord(steeringPlan.records, "SteeringProposal", (record) => record.id.includes("proposal-ontology-assertion"));
assert.equal(ontologyProposal.proposalKind, "add-ontology-relationship");
assert.equal(ontologyProposal.steeringDomain, "graph");
assert.equal(ontologyProposal.graphEntityId, "assertion-scaling-history");
assert.equal(ontologyProposal.relationshipType, "historical_context_for");
assert.equal(ontologyProposal.targetCategoryKey, "topic:topic.scaling-memory");

const rawProposal = findRecord(steeringPlan.records, "KnowledgeRawPayload", (record) => record.ownerId === renameProposal.id);
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
      keywords: [
        { keyword: "memory systems", weight: 0.84 },
      ],
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
const importedTaxonomyPayload = findRecord(taxonomyPlan.records, "KnowledgeRawPayload", (record) => record.ownerType === "categoryTree");
assert.equal(JSON.parse(importedTaxonomyPayload.payload).snapshot_id, "taxonomy-snapshot");
const importedChildNode = findRecord(taxonomyPlan.records, "Category", (record) => record.categoryKey === "topic.memory");
assert.equal(importedChildNode.parentCategoryKey, "topic.scaling");
assert.equal(importedChildNode.depth, 1);
const taxonomyKeyword = findRecord(taxonomyPlan.records, "CategoryKeyword", (record) => record.categoryKey === "topic.memory" && record.normalizedKeyword === "memory systems");
assert.equal(taxonomyKeyword.source, "accepted-category-tree");

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
assert.equal(acceptedExport.topics[0].topic_uid, "topic.scaling");
assert.equal(Object.hasOwn(acceptedExport.topics[0], "short_title"), false);
assert.deepEqual(acceptedExport.topics[0].seed_item_ids, ["research-001"]);

const acceptedTaxonomyExport = buildAcceptedCategoryTreePayload(
  {
    id: "taxonomy-test",
    taxonomyId: "canonical-taxonomy",
    corpusId: "knowledge-corpus-canonical-corpus",
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
assert.equal(acceptedTaxonomyExport.nodes[0].topic_uid, "topic.scaling");
assert.equal(acceptedTaxonomyExport.nodes[1].parent_topic_uid, "topic.scaling");
assert.equal(Object.hasOwn(acceptedTaxonomyExport.nodes[0], "short_title"), false);
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
assert.equal(steeringFeedbackExport.topic_set.topic_set_id, steeringPlan.categorySetId);
assert.equal(steeringFeedbackExport.suppressions[0].scope.root_topic_uid, "topic.scaling");
assert.equal(steeringFeedbackExport.suppressions[0].match.topic_uid, "topic.scaling-memory");
assert.equal(steeringFeedbackExport.suppressions[0].match.normalized_display_name, "scaling memory");
assert.equal(steeringFeedbackExport.decisions.length, 2);
const lexicalExport = buildLexicalSteeringPayload([
  etRule,
  {
    id: "lexical-rule-archived",
    ruleKind: "ignored_keyword",
    term: "draft",
    normalizedTerm: "draft",
    scope: "publication",
    status: "archived",
    createdAt: "2026-05-16T12:16:00.000Z",
  },
], {
  config: lexicalConfig,
  generatedAt: "2026-05-16T13:11:00.000Z",
});
assert.equal(lexicalExport.export_kind, "papyrus-lexical-steering");
assert.equal(lexicalExport.ignored_terms.length, 1);
assert.equal(lexicalExport.ignored_terms[0].normalized_term, "et");
assert.equal(lexicalExport.keyword_display.expanded_limit, 120);

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
      storage_path: "s3://example/corpora/source-corpus/source-001.md",
      ingestion_rationale: "Projected into the source corpus because the classifier found a strong scaling match.",
      attachments: [
        {
          role: "transcript",
          path: "s3://example/corpora/source-corpus/source-001.transcript.txt",
          media_type: "text/plain",
          sha256: "transcript-sha",
        },
        {
          role: "deepgram",
          path: "s3://example/corpora/source-corpus/source-001.deepgram.json",
          media_type: "application/json",
        },
        {
          role: "external",
          path: "s3://outside-bucket/not-corpora/source-001.pdf",
        },
      ],
    },
  ],
}, {
  authorityCorpusConfig: canonicalCorpusConfig,
  targetCorpusConfig: sourceCorpusConfig,
  categorySetId: steeringPlan.categorySetId,
});
assert.equal(projectionPlan.categorySetId, steeringPlan.categorySetId);
assert.equal(projectionPlan.records.some((record) => record.modelName === "Reference"), false);
assert.equal(projectionPlan.records.some((record) => record.modelName === "ReferenceAttachment"), false);
assert.equal(projectionPlan.records.some((record) => record.modelName === "Message"), false);
assert.equal(projectionPlan.records.some((record) => record.modelName === "Assignment"), false);
const projectionRelation = findRecord(projectionPlan.records, "SemanticRelation", (record) => record.subjectKind === "reference" && record.subjectLineageId.endsWith("source-001"));
const projectedReference = {
  id: projectionRelation.subjectId,
  lineageId: projectionRelation.subjectLineageId,
  versionNumber: projectionRelation.subjectVersionNumber,
  versionState: "current",
  corpusId: "knowledge-corpus-source-corpus",
  externalItemId: "source-001",
  title: null,
  storagePath: "corpora/source-corpus/source-001.md",
  curationStatus: "accepted",
  curationStatusKey: "knowledge-corpus-source-corpus#accepted",
  metadata: JSON.stringify({}),
};
assert.equal(projectionRelation.predicate, "classified_as");
assert.equal(projectionRelation.relationTypeId, semanticRelationTypeIdFor("classified_as"));
assert.equal(projectionRelation.relationTypeKey, "classified_as");
assert.equal(projectionRelation.relationDomain, "knowledge");
assert.equal(projectionRelation.objectKind, "category");
assert.equal(projectionRelation.objectLineageId, fallbackTaxonomyNode.lineageId);
assert.equal(JSON.parse(projectionRelation.metadata).categorySetId, steeringPlan.categorySetId);
assert.equal(projectionRelation.score, 0.82);
assert.equal(projectionRelation.reviewRecommended, true);
const projectionCorpus = findRecord(projectionPlan.records, "KnowledgeCorpus", (record) => record.id === "knowledge-corpus-source-corpus");
assert.equal(projectionCorpus.role, "source");
const projectedEditorialConcept = findRecord(projectionPlan.records, "SemanticNode", (record) => record.nodeKey === "editorial.form.analysis");
assert.equal(projectedEditorialConcept.id, "semantic-node-editorial-form-analysis-v1");
assert.equal(projectedEditorialConcept.nodeKind, "editorialForm");
assert.equal(projectedEditorialConcept.corpusId, null);
assert.equal(projectionPlan.records.filter((record) => record.modelName === "SemanticNode" && record.expected.nodeKind === "editorialForm").length, 4);
assert.equal(
  projectionPlan.records.some((record) => JSON.stringify(record.expected).includes("AI-ML-research") || JSON.stringify(record.expected).includes("AI-ML-history")),
  false,
  "projection imports should use configured corpus ids without AI/ML name fallbacks",
);

assert.equal(normalizeReferenceCurationStatus("trusted"), "accepted");
assert.equal(isEvidenceEligibleReference(projectedReference), true);
assert.equal(isEvidenceEligibleReference({ ...projectedReference, curationStatus: "pending" }), false);
assert.equal(isEvidenceEligibleReference({ ...projectedReference, versionState: "superseded" }), false);
assert.equal(scopeTrainingLabelForReference(projectedReference), "positive");
assert.equal(
  scopeTrainingLabelForReference({ ...projectedReference, curationStatus: "rejected", metadata: JSON.stringify({ reasonCode: "out_of_scope" }) }),
  "negative",
);
assert.equal(
  scopeTrainingLabelForReference({ ...projectedReference, curationStatus: "rejected", metadata: JSON.stringify({ reasonCode: "duplicate" }) }),
  null,
);

const preparedCatalog = buildPreparedReferenceCatalog({
  schema_version: 2,
  generated_at: "2026-05-18T12:00:00.000Z",
  items: {
    "catalog-needs-rationale": {
      id: "catalog-needs-rationale",
      relpath: "imports/catalog-needs-rationale.pdf",
      media_type: "application/pdf",
      title: "Prepared Reference Prospect",
      source_uri: "https://example.com/prepared",
      metadata: {
        abstract: "This abstract should inform the derived rationale but remain out of sanitized GraphQL metadata.",
        title: "Prepared Reference Prospect",
      },
    },
  },
}, {
  corpusKey: "source-corpus",
  publicationName: "Test Publication",
  preparedAt: "2026-05-18T12:00:00.000Z",
});
const preparedCatalogItem = preparedCatalog.items["catalog-needs-rationale"];
assert.match(preparedCatalogItem.ingestion_rationale, /Prepared Reference Prospect/);
assert.match(preparedCatalogItem.ingestion_rationale, /source-corpus/);
assert.match(preparedCatalogItem.ingestion_rationale, /This abstract should inform/);

const pendingCatalogPlan = buildReferenceCatalogRegistrationRecords({
  schema_version: 2,
  generated_at: "2026-05-18T12:00:00.000Z",
  items: {
    "catalog-001": {
      id: "catalog-001",
      relpath: "imports/catalog-001.pdf",
      sha256: "catalog-sha",
      bytes: 1234,
      media_type: "application/pdf",
      title: "Reference Prospect",
      source_uri: "https://example.com/catalog-001",
      metadata: {
        body: "This source body must not be copied into GraphQL raw payload snapshots.",
        source_uri: "https://example.com/catalog-001",
      },
      ingestion_rationale: "Summarizes a candidate source for the current focus and explains why it fits the publication mission.",
    },
  },
}, {
  corpusConfig: sourceCorpusConfig,
  corpusId: "knowledge-corpus-source-corpus",
  status: "pending",
  importedAt: "2026-05-18T12:00:00.000Z",
});
assert.ok(pendingCatalogPlan.importRunId);
const pendingCatalogImportRun = findRecord(pendingCatalogPlan.records, "KnowledgeImportRun", (record) => record.id === pendingCatalogPlan.importRunId);
assert.equal(pendingCatalogImportRun.importKind, "reference-catalog-registration");
assert.equal(pendingCatalogImportRun.referenceCount, 1);
const pendingCatalogRawPayload = findRecord(pendingCatalogPlan.records, "KnowledgeRawPayload", (record) => record.ownerId === pendingCatalogPlan.importRunId && record.payloadKind === "reference-intake-catalog");
const pendingCatalogSnapshot = JSON.parse(pendingCatalogRawPayload.payload);
assert.equal(pendingCatalogSnapshot.item_count, 1);
assert.equal(pendingCatalogSnapshot.snapshot_policy, "bounded-summary");
assert.equal(pendingCatalogSnapshot.items[0].id, "catalog-001");
assert.equal(pendingCatalogSnapshot.items[0].metadata, undefined);
assert.deepEqual(pendingCatalogSnapshot.items[0].metadata_keys, ["source_uri"]);
const pendingCatalogReference = findRecord(pendingCatalogPlan.records, "Reference", (record) => record.externalItemId === "catalog-001");
assert.equal(pendingCatalogReference.curationStatus, "pending");
assert.equal(pendingCatalogReference.importRunId, pendingCatalogPlan.importRunId);
assert.equal(pendingCatalogReference.storagePath, "corpora/source-corpus/imports/catalog-001.pdf");
const pendingCatalogAttachments = pendingCatalogPlan.records.filter((record) => record.modelName === "ReferenceAttachment" && record.expected.referenceId === pendingCatalogReference.id);
assert.ok(pendingCatalogAttachments.length >= 1);
assert.equal(pendingCatalogAttachments[0].expected.importRunId, pendingCatalogPlan.importRunId);
const pendingCatalogAssignments = pendingCatalogPlan.records.filter((record) => record.modelName === "Assignment");
assert.equal(pendingCatalogAssignments.length, 1);
assert.equal(pendingCatalogAssignments[0].expected.assignmentTypeKey, "curation.reference-intake");
assert.equal(pendingCatalogAssignments[0].expected.queueKey, "curation.reference-intake#knowledge-corpus-source-corpus");
assert.equal(pendingCatalogAssignments[0].expected.importRunId, pendingCatalogPlan.importRunId);
const pendingCatalogRationale = findRecord(pendingCatalogPlan.records, "Message", (record) => record.messageKind === "ingestion_rationale");
assert.equal(pendingCatalogRationale.importRunId, pendingCatalogPlan.importRunId);
assert.equal(pendingCatalogPlan.records.some((record) => record.modelName === "SemanticRelation" && record.expected.predicate === "ingestion_rationale" && record.expected.importRunId === pendingCatalogPlan.importRunId), true);
assert.equal(pendingCatalogPlan.records.some((record) => record.modelName === "SemanticRelation" && record.expected.predicate === "requests_work_on" && record.expected.importRunId === pendingCatalogPlan.importRunId), true);
assert.equal(pendingCatalogPlan.records.some((record) => record.modelName === "Item"), false);
assert.equal(pendingCatalogPlan.records.some((record) => record.modelName === "EditionItem"), false);
assert.equal(pendingCatalogPlan.records.some((record) => record.modelName === "SemanticRelation" && ["classified_as", "uses_evidence"].includes(record.expected.predicate)), false);
const urlOnlyReference = {
  ...pendingCatalogReference,
  id: "reference-url-only-v1",
  lineageId: "reference-url-only",
  externalItemId: "url-only",
  sourceUri: "https://example.com/url-only.pdf",
  storagePath: null,
};
assert.equal(referenceSourceReadiness(urlOnlyReference, []).state, SOURCE_READINESS_STATES.URL_ONLY);
assert.equal(referenceSourceReadiness(pendingCatalogReference, pendingCatalogAttachments.map((entry) => entry.expected)).state, SOURCE_READINESS_STATES.EXTRACTABLE);
const snapshotOnlyReadiness = referenceSourceReadiness(pendingCatalogReference, [
  ...pendingCatalogAttachments.map((entry) => entry.expected),
  {
    referenceLineageId: pendingCatalogReference.lineageId,
    role: "extracted_text",
    storagePath: "corpora/source-corpus/extracted/pipeline/snapshot/text/catalog-001.txt",
    filename: "catalog-001.txt",
    mediaType: "text/plain",
  },
]);
assert.equal(snapshotOnlyReadiness.state, SOURCE_READINESS_STATES.EXTRACTED);
assert.equal(snapshotOnlyReadiness.textState, SOURCE_TEXT_STATES.TEXT_READY);
const extractionTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "papyrus-extraction-index-"));
const extractionTextDir = path.join(extractionTempRoot, "extracted", "pipeline", "snapshot-001", "text");
fs.mkdirSync(extractionTextDir, { recursive: true });
fs.writeFileSync(path.join(extractionTextDir, `${pendingCatalogReference.externalItemId}.txt`), "Extracted text snapshot.", "utf8");
const snapshotIndex = buildExtractionIndex(extractionTempRoot);
const snapshotReadiness = referenceSourceReadiness(
  pendingCatalogReference,
  pendingCatalogAttachments.map((entry) => entry.expected),
  snapshotIndex,
);
assert.equal(snapshotReadiness.state, SOURCE_READINESS_STATES.EXTRACTABLE);
assert.equal(snapshotReadiness.textState, SOURCE_TEXT_STATES.SNAPSHOT_EXTRACTED);
const snapshotTextStoragePath = snapshotIndex.textByItemId.get(pendingCatalogReference.externalItemId).storagePath;
const snapshotTextReadiness = referenceSourceReadiness(pendingCatalogReference, [
  ...pendingCatalogAttachments.map((entry) => entry.expected),
  {
    referenceLineageId: pendingCatalogReference.lineageId,
    role: "extracted_text",
    storagePath: snapshotTextStoragePath,
    filename: `${pendingCatalogReference.externalItemId}.txt`,
    mediaType: "text/plain",
  },
], snapshotIndex);
assert.equal(snapshotTextReadiness.state, SOURCE_READINESS_STATES.EXTRACTED);
assert.equal(snapshotTextReadiness.textState, SOURCE_TEXT_STATES.TEXT_READY);
const legacyImportsTextReadiness = referenceSourceReadiness(pendingCatalogReference, [
  ...pendingCatalogAttachments.map((entry) => entry.expected),
  {
    referenceLineageId: pendingCatalogReference.lineageId,
    role: "extracted_text",
    storagePath: `corpora/source-corpus/imports/${pendingCatalogReference.externalItemId}/text.txt`,
    filename: "text.txt",
    mediaType: "text/plain",
  },
], snapshotIndex);
assert.equal(legacyImportsTextReadiness.state, SOURCE_READINESS_STATES.EXTRACTABLE);
assert.equal(legacyImportsTextReadiness.textState, SOURCE_TEXT_STATES.SNAPSHOT_EXTRACTED);
const sourceRows = buildReferenceSourceStatusRows({
  corpusId: "knowledge-corpus-source-corpus",
  curationStatus: "pending",
  references: [pendingCatalogReference, urlOnlyReference],
  attachments: pendingCatalogAttachments.map((entry) => entry.expected),
});
assert.deepEqual(sourceRows.map((row) => row.state).sort(), [SOURCE_READINESS_STATES.EXTRACTABLE, SOURCE_READINESS_STATES.URL_ONLY].sort());
assert.throws(
  () => buildReferenceCatalogRegistrationRecords({ items: [{ id: "catalog-no-rationale" }] }, {
    corpusConfig: sourceCorpusConfig,
    corpusId: "knowledge-corpus-source-corpus",
    status: "pending",
    importedAt: "2026-05-18T12:00:00.000Z",
  }),
  /requires ingestion_rationale/,
);

const rejectedCatalogPlan = buildReferenceCatalogRegistrationRecords({
  schema_version: 2,
  generated_at: "2026-05-18T12:00:00.000Z",
  items: [
    {
      id: "catalog-002",
      relpath: "imports/catalog-002.pdf",
      media_type: "application/pdf",
      title: "Rejected Prospect",
      source_uri: "https://example.com/catalog-002",
    },
  ],
}, {
  corpusConfig: sourceCorpusConfig,
  corpusId: "knowledge-corpus-source-corpus",
  status: "rejected",
  reasonCode: "out_of_scope",
  note: "Outside the editorial mission.",
  importedAt: "2026-05-18T12:00:00.000Z",
});
const rejectedCatalogReference = findRecord(rejectedCatalogPlan.records, "Reference", (record) => record.externalItemId === "catalog-002");
assert.equal(rejectedCatalogReference.curationStatus, "rejected");
assert.equal(rejectedCatalogReference.importRunId, rejectedCatalogPlan.importRunId);
assert.equal(JSON.parse(rejectedCatalogReference.metadata).curation_reason_code, undefined);
assert.equal(rejectedCatalogPlan.records.some((record) => record.modelName === "Assignment"), false);
const rejectionMessage = findRecord(rejectedCatalogPlan.records, "Message", (record) => record.messageKind === "reference_curation");
assert.equal(JSON.parse(rejectionMessage.metadata).reasonCode, "out_of_scope");
assert.equal(rejectionMessage.importRunId, rejectedCatalogPlan.importRunId);
assert.equal(rejectedCatalogPlan.records.some((record) => record.modelName === "SemanticRelation" && record.expected.predicate === "comment" && record.expected.importRunId === rejectedCatalogPlan.importRunId), true);
assert.throws(
  () => buildReferenceCatalogRegistrationRecords({ items: [{ id: "catalog-003" }] }, {
    corpusConfig: sourceCorpusConfig,
    corpusId: "knowledge-corpus-source-corpus",
    status: "rejected",
    importedAt: "2026-05-18T12:00:00.000Z",
  }),
  /reason-code is required/,
);

const analysisProfilesConfig = loadAnalysisProfiles();
const classifierAnalysisProfile = analysisProfilesConfig.profiles.find((profile) => profile.key === "canonical-topic-classifier");
assert.ok(classifierAnalysisProfile);
assert.ok(classifierAnalysisProfile.allowedOverrides.includes("bertopic_analysis.parameters.nr_topics"));
assert.ok(classifierAnalysisProfile.allowedOverrides.includes("seedManifestPath"));
assert.throws(
  () => parseAnalysisOverrides(["unsafe.parameter=1"], classifierAnalysisProfile),
  /not allowed/,
);
const testAnalysisProfile = {
  ...classifierAnalysisProfile,
  corpusKey: "canonical-corpus",
  classifierId: "canonical-classifier",
  defaults: {
    ...classifierAnalysisProfile.defaults,
    extractionSnapshot: "snapshot-canonical-text",
    seedManifestPath: "corpora/canonical-corpus/metadata/topic-classifiers/canonical-classifier/seed-manifest.json",
  },
};
const testAnalysisProfilesConfig = {
  ...analysisProfilesConfig,
  profiles: [testAnalysisProfile],
};
const analysisOverrides = parseAnalysisOverrides(["bertopic_analysis.parameters.nr_topics=14"], testAnalysisProfile);
const analysisPlan = buildAnalysisReindexPlan({
  profilesConfig: testAnalysisProfilesConfig,
  steeringConfig,
  profileKey: "canonical-topic-classifier",
  corpusKey: "canonical-corpus",
  overrides: analysisOverrides,
  now: "2026-05-18T12:00:00.000Z",
  biblicusWorkdir: "/tmp/biblicus",
});
assert.equal(analysisPlan.profile.scope, "topic-classifier-train");
assert.equal(analysisPlan.mode, "classifier-retrain");
assert.equal(analysisPlan.corpus.id, "knowledge-corpus-canonical-corpus");
assert.equal(analysisPlan.classifierId, "canonical-classifier");
assert.equal(analysisPlan.destructivePlan.mutatesGraphqlNow, false);
assert.equal(analysisPlan.destructivePlan.executesBiblicusNow, false);
assert.equal(analysisPlan.commandPlan.length, 1);
assert.deepEqual(
  analysisPlan.commandPlan[0].args.filter((entry) => entry === "--override").length,
  1,
);
assert.ok(analysisPlan.commandPlan[0].args.includes("bertopic_analysis.parameters.nr_topics=14"));
const analysisPlanRerun = buildAnalysisReindexPlan({
  profilesConfig: testAnalysisProfilesConfig,
  steeringConfig,
  profileKey: "canonical-topic-classifier",
  corpusKey: "canonical-corpus",
  overrides: analysisOverrides,
  now: "2026-05-18T12:00:00.000Z",
  biblicusWorkdir: "/tmp/biblicus",
});
assert.deepEqual(analysisPlanRerun.commandPlan, analysisPlan.commandPlan);
const analysisAssignmentPlan = buildAnalysisReindexAssignmentRecords(analysisPlan, {
  categorySet: fallbackTaxonomy,
  existing: mapExistingRecords({}),
  now: "2026-05-18T12:00:00.000Z",
  actorLabel: "test-operator",
});
assert.equal(getAssignmentTypePolicy("analysis.reindex").claimPolicy, "exclusive");
assert.equal(getAssignmentTypePolicy("research.edition-candidate").claimPolicy, "optional");
assert.equal(getAssignmentTypePolicy("reference.corpus-accession").claimPolicy, "exclusive");
assert.equal(getAssignmentTypePolicy("reference.text-extraction").claimPolicy, "exclusive");
assert.equal(getAssignmentTypePolicy("reference.doi-backfill").claimPolicy, "exclusive");
assert.equal(getAssignmentTypePolicy("reference.identifier-backfill").claimPolicy, "exclusive");
const analysisAssignment = findRecord(analysisAssignmentPlan.records, "Assignment", (record) => record.assignmentTypeKey === "analysis.reindex");
assert.equal(analysisAssignment.status, "open");
assert.equal(analysisAssignment.queueKey, "analysis:reindex:canonical-corpus:topic-classifier-train");
const analysisAssignmentMetadata = JSON.parse(analysisAssignment.metadata);
assert.equal(analysisAssignmentMetadata.analysisProfileKey, "canonical-topic-classifier");
assert.equal(analysisAssignmentMetadata.reindexMode, "classifier-retrain");
assert.equal(analysisAssignmentMetadata.parameterOverrides["bertopic_analysis.parameters.nr_topics"], 14);
assert.equal(analysisAssignmentMetadata.destructivePlan.mutatesGraphqlNow, false);
assert.equal(analysisAssignmentMetadata.commandPlan[0].label, "topic-classifier-train");
assert.equal(analysisAssignmentMetadata.assignmentTypePolicy.claimPolicy, "exclusive");
assert.equal(analysisAssignmentMetadata.assignmentTypePolicy.defaultClaimTtlSeconds, 21600);
const analysisAssignmentEvent = findRecord(analysisAssignmentPlan.records, "AssignmentEvent", (record) => record.assignmentId === analysisAssignment.id);
assert.equal(analysisAssignmentEvent.eventType, "created");
const analysisAssignmentRelation = findRecord(analysisAssignmentPlan.records, "SemanticRelation", (record) => record.subjectId === analysisAssignment.id);
assert.equal(analysisAssignmentRelation.predicate, "requests_work_on");
assert.equal(analysisAssignmentRelation.relationTypeKey, "requests_work_on");
assert.equal(analysisAssignmentRelation.objectKind, "categorySet");
assert.equal(analysisAssignmentPlan.records.some((record) => record.modelName === "Item"), false);
assert.equal(analysisAssignmentPlan.records.some((record) => record.modelName === "EditionItem"), false);
assert.equal(analysisAssignmentPlan.records.some((record) => record.modelName === "Reference"), false);
assert.equal(analysisAssignmentPlan.records.some((record) => record.modelName === "SemanticRelation" && ["classified_as", "uses_evidence"].includes(record.expected.predicate)), false);

const focusCategoryAlpha = {
  ...fallbackTaxonomyNode,
  id: "category-topic-scaling-agents-v1",
  lineageId: "category-topic-scaling-agents",
  categoryKey: "topic.scaling-agents",
  parentCategoryKey: fallbackTaxonomyNode.categoryKey,
  depth: 1,
  displayName: "Scaling Agents",
  shortTitle: "Agents",
  rank: 1,
  isPinned: true,
};
const focusCategoryBeta = {
  ...fallbackTaxonomyNode,
  id: "category-topic-scaling-evals-v1",
  lineageId: "category-topic-scaling-evals",
  categoryKey: "topic.scaling-evals",
  parentCategoryKey: fallbackTaxonomyNode.categoryKey,
  depth: 1,
  displayName: "Scaling Evaluations",
  shortTitle: "Evaluations",
  rank: 2,
  isPinned: false,
};

const editionPlanningState = {
  editions: [],
  publishedEditions: [],
  editionItems: [],
  categorySets: [fallbackTaxonomy],
  categories: [fallbackTaxonomyNode, focusCategoryAlpha, focusCategoryBeta],
  references: [
    projectedReference,
    { ...projectedReference, id: "source-002-v1", lineageId: "source-002", externalItemId: "source-002", curationStatus: "pending", curationStatusKey: "knowledge-corpus-source-corpus#pending" },
    { ...projectedReference, id: "source-003-v1", lineageId: "source-003", externalItemId: "source-003", curationStatus: "rejected", curationStatusKey: "knowledge-corpus-source-corpus#rejected" },
  ],
  semanticRelations: [
    projectionRelation,
    { ...projectionRelation, id: "projection-pending", subjectId: "source-002-v1", subjectLineageId: "source-002", subjectVersionKey: "reference#source-002-v1" },
    { ...projectionRelation, id: "projection-rejected", subjectId: "source-003-v1", subjectLineageId: "source-003", subjectVersionKey: "reference#source-003-v1" },
  ],
  semanticNodes: projectionPlan.records.filter((record) => record.modelName === "SemanticNode").map((record) => record.expected),
  assignments: [],
  assignmentEvents: [],
  newsroomSections: [
    {
      id: "technology",
      title: "Technology",
      type: "canonical",
      editorialMission: "Cover tools and systems.",
      editorialPolicy: "Prioritize practical capabilities.",
      enabled: true,
      sortOrder: 1,
    },
  ],
};
const editionPlan = buildEditionPlanningPlan(editionPlanningState, {
  editionDate: "2026-05-19",
  now: "2026-05-18T12:00:00.000Z",
  topDeskCount: 1,
  publicationSlots: 1,
  sectionTargets: [`${fallbackTaxonomyNode.categoryKey}:technology`],
});
const sectionTargets = [`${fallbackTaxonomyNode.categoryKey}:technology`];
assert.equal(editionPlan.edition.slug, "edition-2026-05-19");
assert.equal(editionPlan.edition.status, "planning");
assert.equal(editionPlan.records.some((record) => record.modelName === "PublishedEdition"), false);
assert.equal(editionPlan.records.some((record) => record.modelName === "EditionItem"), false);
assert.equal(editionPlan.assignments.length, 6);
assert.equal(new Set(editionPlan.assignments.map((assignment) => assignment.id)).size, 6);
assert.equal(new Set(editionPlan.assignments.map((assignment) => JSON.parse(assignment.metadata).laneKey)).size, 3);
const reportingAssignment = editionPlan.assignments.find((assignment) => JSON.parse(assignment.metadata).laneKey === "reporting");
assert.ok(reportingAssignment);
assert.equal(reportingAssignment.assignmentTypeKey, "research.edition-candidate");
assert.equal(reportingAssignment.queueKey, `edition:edition-2026-05-19:desk:${fallbackTaxonomyNode.categoryKey.replace(/[^a-z0-9]+/g, "-")}:lane:reporting`);
const reportingMetadata = JSON.parse(reportingAssignment.metadata);
assert.equal(reportingMetadata.referenceLineageIds[0], projectedReference.lineageId);
assert.deepEqual(reportingMetadata.referenceLineageIds, [projectedReference.lineageId]);
assert.equal(reportingMetadata.deskCategoryKey, fallbackTaxonomyNode.categoryKey);
assert.equal(reportingMetadata.focusCategoryKey, focusCategoryAlpha.categoryKey);
assert.equal(reportingMetadata.focusCategoryTitle, "Scaling Agents");
assert.equal(reportingMetadata.contextProfile, "reporting");
assert.equal(reportingMetadata.contextTokenBudget, 4000);
assert.deepEqual(reportingMetadata.contextSources, ["doctrine", "focus-category", "desk-memory", "fresh-evidence"]);
assert.equal(reportingMetadata.sectionId, "technology");
assert.equal(reportingMetadata.sectionTitle, "Technology");
assert.equal(reportingMetadata.sectionType, "canonical");
assert.equal(reportingAssignment.sectionKey, "technology");
assert.equal(reportingAssignment.sectionStatusKey, "technology#open");
assert.equal(reportingAssignment.sectionQueueStatusKey, `${reportingAssignment.sectionKey}#${reportingAssignment.queueKey}#open`);
assert.equal(reportingAssignment.primaryFocusCategoryKey, focusCategoryAlpha.categoryKey);
assert.ok(reportingAssignment.topicScopeCategoryKeys.includes(fallbackTaxonomyNode.categoryKey));
assert.ok(reportingAssignment.topicScopeCategoryKeys.includes(focusCategoryAlpha.categoryKey));
assert.equal(reportingMetadata.researchTrackKey, "live-desk-context");
assert.equal(reportingMetadata.researchLens, focusCategoryAlpha.categoryKey);
const editionRelation = findRecord(editionPlan.records, "SemanticRelation", (record) => record.subjectId === reportingAssignment.id && record.predicate === "planned_for_edition");
assert.equal(editionRelation.relationTypeKey, "planned_for_edition");
assert.equal(editionRelation.relationDomain, "publication");
assert.equal(editionRelation.objectKind, "edition");
assert.equal(editionRelation.objectLineageId, editionPlan.edition.lineageId);
const laneRelation = findRecord(editionPlan.records, "SemanticRelation", (record) => record.subjectId === reportingAssignment.id && record.predicate === "targets_lane");
assert.equal(laneRelation.relationTypeKey, "targets_lane");
assert.equal(laneRelation.relationDomain, "editorial");
assert.equal(laneRelation.objectKind, "semanticNode");
assert.equal(JSON.parse(laneRelation.metadata).laneNodeKey, "editorial.form.reporting");
const sectionRelation = findRecord(editionPlan.records, "SemanticRelation", (record) => record.subjectId === reportingAssignment.id && record.predicate === "targets_section");
assert.equal(sectionRelation.relationTypeKey, "targets_section");
assert.equal(sectionRelation.relationDomain, "editorial");
assert.equal(sectionRelation.objectKind, "newsroomSection");
assert.equal(sectionRelation.objectLineageId, "technology");
const topicRelation = findRecord(editionPlan.records, "SemanticRelation", (record) => record.subjectId === reportingAssignment.id && record.predicate === "targets_topic");
assert.equal(topicRelation.relationTypeKey, "targets_topic");
assert.equal(topicRelation.objectKind, "category");
assert.equal(topicRelation.objectLineageId, reportingMetadata.focusCategoryLineageId);
const deskRelation = findRecord(editionPlan.records, "SemanticRelation", (record) => record.subjectId === reportingAssignment.id && record.predicate === "requests_work_on");
assert.equal(deskRelation.relationTypeKey, "requests_work_on");
assert.equal(deskRelation.objectKind, "category");
assert.equal(deskRelation.objectLineageId, reportingMetadata.focusCategoryLineageId);
const evidenceRelation = findRecord(editionPlan.records, "SemanticRelation", (record) => record.subjectId === reportingAssignment.id && record.predicate === "uses_evidence");
assert.equal(evidenceRelation.relationTypeKey, "uses_evidence");
assert.equal(evidenceRelation.relationDomain, "evidence");
assert.equal(evidenceRelation.objectLineageId, projectedReference.lineageId);
assert.deepEqual(
  editionPlan.assignments.map((assignment) => JSON.parse(assignment.metadata).focusCategoryKey),
  [
    "topic.scaling-agents",
    "topic.scaling-evals",
    "topic.scaling-agents",
    "topic.scaling-evals",
    "topic.scaling-agents",
    "topic.scaling-evals",
  ],
);
assert.deepEqual(
  editionPlan.focusCoverage.map((entry) => entry.focusCategoryKey),
  ["topic.scaling-agents", "topic.scaling-evals", "topic.scaling-agents", "topic.scaling-evals", "topic.scaling-agents", "topic.scaling-evals"],
);

const relationTypeSeeds = loadSemanticRelationTypeSeeds();
assert.ok(relationTypeSeeds.some((type) => type.key === "classified_as" && type.domain === "knowledge"));
assert.ok(relationTypeSeeds.some((type) => type.key === "authoritative_label" && type.domain === "classification"));
assert.ok(relationTypeSeeds.some((type) => type.key === "digital_object_identifier_is" && type.domain === "ontology" && type.allowedObjectKinds.includes("semanticNode")));
assert.ok(relationTypeSeeds.some((type) => type.key === "arxiv_identifier_is" && type.domain === "ontology" && type.allowedObjectKinds.includes("semanticNode")));
assert.ok(relationTypeSeeds.some((type) => type.key === "isbn_identifier_is" && type.domain === "ontology" && type.allowedObjectKinds.includes("semanticNode")));
assert.ok(relationTypeSeeds.some((type) => type.key === "publisher_item_identifier_is" && type.domain === "ontology" && type.allowedObjectKinds.includes("semanticNode")));
assert.ok(relationTypeSeeds.some((type) => type.key === "comment" && type.domain === "commentary" && type.allowedSubjectKinds.includes("message")));
assert.ok(relationTypeSeeds.some((type) => type.key === "ingestion_rationale" && type.domain === "commentary" && type.allowedObjectKinds.includes("reference")));
assert.ok(relationTypeSeeds.some((type) => type.key === "planned_for_edition" && type.domain === "publication"));
assert.ok(relationTypeSeeds.some((type) => type.key === "targets_lane" && type.contextPackTags.includes("assignment_context")));
assert.ok(relationTypeSeeds.some((type) => type.key === "targets_section" && type.allowedObjectKinds.includes("newsroomSection")));
assert.ok(relationTypeSeeds.some((type) => type.key === "targets_topic" && type.allowedObjectKinds.includes("category")));
const relationTypeRecords = buildSemanticRelationTypeRecords(relationTypeSeeds, { now: "2026-05-18T12:00:00.000Z" });
const usesEvidenceType = findRecord(relationTypeRecords, "SemanticRelationType", (record) => record.key === "uses_evidence");
assert.equal(usesEvidenceType.id, semanticRelationTypeIdFor("uses_evidence"));
assert.equal(usesEvidenceType.domain, "evidence");
assert.ok(usesEvidenceType.contextPackTags.includes("reference_graph"));
assert.deepEqual(semanticRelationTypeFieldsForPredicate("CLASSIFIED AS"), {
  relationTypeId: semanticRelationTypeIdFor("classified_as"),
  relationTypeKey: "classified_as",
  relationDomain: "knowledge",
});
assert.deepEqual(semanticRelationTypeFieldsForPredicate("authoritative_label"), {
  relationTypeId: semanticRelationTypeIdFor("authoritative_label"),
  relationTypeKey: "authoritative_label",
  relationDomain: "classification",
});
assert.deepEqual(semanticRelationTypeFieldsForPredicate("digital_object_identifier_is"), {
  relationTypeId: semanticRelationTypeIdFor("digital_object_identifier_is"),
  relationTypeKey: "digital_object_identifier_is",
  relationDomain: "ontology",
});
assert.deepEqual(semanticRelationTypeFieldsForPredicate("arxiv_identifier_is"), {
  relationTypeId: semanticRelationTypeIdFor("arxiv_identifier_is"),
  relationTypeKey: "arxiv_identifier_is",
  relationDomain: "ontology",
});
const backfillRecords = buildSemanticRelationBackfillRecords([
  { id: "relation-a", predicate: "classified_as" },
  { id: "relation-b", predicate: "mystery_predicate" },
], relationTypeSeeds);
assert.equal(backfillRecords[0].expected.relationTypeKey, "classified_as");
assert.equal(backfillRecords[0].expected.relationDomain, "knowledge");
assert.equal(backfillRecords[0].action, "update");
assert.equal(backfillRecords[1].expected.relationTypeKey, "mystery_predicate");
assert.equal(backfillRecords[1].expected.relationDomain, "generic");
assert.equal(backfillRecords[1].unknownType, true);
const persistedEditionPlanState = {
  ...editionPlanningState,
  editions: [editionPlan.edition],
  semanticNodes: editionPlan.records.filter((record) => record.modelName === "SemanticNode").map((record) => record.expected),
  assignments: editionPlan.records.filter((record) => record.modelName === "Assignment").map((record) => record.expected),
  assignmentEvents: editionPlan.records.filter((record) => record.modelName === "AssignmentEvent").map((record) => record.expected),
  semanticRelations: editionPlan.records.filter((record) => record.modelName === "SemanticRelation").map((record) => record.expected),
};
const editionVerification = verifyEditionPlanningPlan(persistedEditionPlanState, editionPlan);
assert.equal(editionVerification.ok, true);
const editionPlanRerun = buildEditionPlanningPlan(persistedEditionPlanState, {
  editionDate: "2026-05-19",
  now: "2026-05-18T12:00:00.000Z",
  topDeskCount: 1,
  publicationSlots: 1,
  sectionTargets,
});
assert.equal(editionPlanRerun.records.filter((record) => record.modelName === "Assignment" && record.action === "create").length, 0);
const cappedEditionPlan = buildEditionPlanningPlan(editionPlanningState, {
  editionDate: "2026-05-19",
  now: "2026-05-18T12:00:00.000Z",
  topDeskCount: 1,
  publicationSlots: 1,
  maxAssignments: 2,
  sectionTargets,
});
assert.equal(cappedEditionPlan.assignments.length, 2);
const focusedEditionPlan = buildEditionPlanningPlan(editionPlanningState, {
  editionDate: "2026-05-20",
  now: "2026-05-18T12:00:00.000Z",
  topDeskCount: 1,
  publicationSlots: 1,
  sectionTargets,
  contextProfile: "analysis",
  targetSystemType: "research newsroom",
});
assert.equal(focusedEditionPlan.summary.contextBackedAssignmentCount, focusedEditionPlan.assignments.length);
assert.equal(focusedEditionPlan.focusCoverage.length, 6);
assert.deepEqual(
  focusedEditionPlan.assignments.map((assignment) => JSON.parse(assignment.metadata).focusCategoryKey),
  ["topic.scaling-agents", "topic.scaling-evals", "topic.scaling-agents", "topic.scaling-evals", "topic.scaling-agents", "topic.scaling-evals"],
);
assert.equal(JSON.parse(focusedEditionPlan.assignments[0].metadata).contextProfile, "analysis");
assert.equal(JSON.parse(focusedEditionPlan.assignments[0].metadata).contextTokenBudget, 6000);
assert.equal(JSON.parse(focusedEditionPlan.assignments[0].metadata).targetSystemType, "research newsroom");
const focusedEditionPlanRerun = buildEditionPlanningPlan(editionPlanningState, {
  editionDate: "2026-05-20",
  now: "2026-05-18T12:00:00.000Z",
  topDeskCount: 1,
  publicationSlots: 1,
  sectionTargets,
  contextProfile: "analysis",
  targetSystemType: "research newsroom",
});
assert.deepEqual(
  focusedEditionPlanRerun.assignments.map((assignment) => JSON.parse(assignment.metadata).focusCategoryKey),
  focusedEditionPlan.assignments.map((assignment) => JSON.parse(assignment.metadata).focusCategoryKey),
);
const focusedSubsetPlan = buildEditionPlanningPlan(editionPlanningState, {
  editionDate: "2026-05-21",
  now: "2026-05-18T12:00:00.000Z",
  topDeskCount: 1,
  publicationSlots: 1,
  focusCategories: ["topic.scaling-evals"],
  sectionTargets,
});
assert.deepEqual(
  focusedSubsetPlan.assignments.map((assignment) => JSON.parse(assignment.metadata).focusCategoryKey),
  ["topic.scaling-evals", "topic.scaling-evals", "topic.scaling-evals", "topic.scaling-evals", "topic.scaling-evals", "topic.scaling-evals"],
);
assert.throws(
  () => buildEditionPlanningPlan(editionPlanningState, {
    editionDate: "2026-05-22",
    now: "2026-05-18T12:00:00.000Z",
    topDeskCount: 1,
    publicationSlots: 1,
    focusCategories: ["topic.not-real"],
    sectionTargets,
  }),
  /Unknown focus category/,
);

const schemaSource = fs.readFileSync(path.join(__dirname, "..", "amplify", "data", "resource.ts"), "utf8");
const authoringClientSource = fs.readFileSync(path.join(__dirname, "lib", "papyrus-graphql-authoring.cjs"), "utf8");
assert.match(schemaSource, /ReferenceAttachment:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /Message:\s*a\s*\n\s*\.model/);
assert.doesNotMatch(schemaSource, /KnowledgeComment:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /Assignment:\s*a\s*\n\s*\.model/);
assert.match(schemaSource.match(/Assignment:\s*a[\s\S]*?AssignmentEvent:/)?.[0] ?? "", /sectionStatusKey/);
assert.match(schemaSource.match(/Assignment:\s*a[\s\S]*?AssignmentEvent:/)?.[0] ?? "", /listAssignmentsBySectionStatusAndPriority/);
assert.match(schemaSource.match(/Assignment:\s*a[\s\S]*?AssignmentEvent:/)?.[0] ?? "", /listAssignmentsBySectionQueueStatusAndPriority/);
assert.match(schemaSource.match(/Assignment:\s*a[\s\S]*?AssignmentEvent:/)?.[0] ?? "", /listAssignmentsByTypeStatusAndCreatedAt/);
assert.match(authoringClientSource.match(/const ASSIGNMENT_FIELDS = [^;]+;/)?.[0] ?? "", /sectionStatusKey/);
assert.match(authoringClientSource, /assignmentsByTypeStatusAndCreatedAt/);
assert.match(authoringClientSource.match(/const ASSIGNMENT_FIELDS = [^;]+;/)?.[0] ?? "", /topicScopeCategoryKeys/);
assert.match(schemaSource, /AssignmentEvent:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /NewsroomSection:\s*a\s*\n\s*\.model/);
const claimAssignmentSource = schemaSource.match(/claimAssignment:[\s\S]*?releaseAssignment:/)?.[0] ?? "";
assert.match(claimAssignmentSource, /assigneeKey:\s*a\.string\(\)/);
assert.match(claimAssignmentSource, /claimExpiresAt:\s*a\.datetime\(\)/);
assert.match(claimAssignmentSource, /claimTtlSeconds:\s*a\.integer\(\)/);
assert.match(schemaSource, /CategoryKeyword:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /LexicalSteeringRule:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /SemanticRelationType:\s*a\s*\n\s*\.model/);
assert.match(schemaSource.match(/SemanticRelation:\s*a[\s\S]*?Item:/)?.[0] ?? "", /relationTypeId/);
assert.match(schemaSource.match(/SemanticRelation:\s*a[\s\S]*?Item:/)?.[0] ?? "", /relationTypeKey/);
assert.match(schemaSource.match(/SemanticRelation:\s*a[\s\S]*?Item:/)?.[0] ?? "", /relationDomain/);
assert.match(schemaSource, /listSemanticRelationsByTypeAndImportedAt/);
assert.match(schemaSource, /listAssignmentsForObject:\s*a\s*\n\s*\.query/);
assert.match(schemaSource, /listAssignmentQueue:\s*a\s*\n\s*\.query/);
assert.match(schemaSource, /UserIdentity:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /listUserDirectory:\s*a\s*\n\s*\.query/);
assert.match(schemaSource, /mergeUserProfiles:\s*a\s*\n\s*\.mutation/);
assert.match(schemaSource.match(/UserProfile:[\s\S]*?UserIdentity:/)?.[0] ?? "", /mergedIntoProfileId/);
assert.match(schemaSource, /listUserIdentitiesByProfileAndLinkedAt/);
assert.match(schemaSource, /listUserRoleAssignmentsByProfileAndRole/);
assert.match(schemaSource, /listReferenceAttachmentsByReferenceVersionAndSortKey/);
assert.match(schemaSource, /listMessagesByAuthorSubAndCreatedAt/);
assert.match(schemaSource, /curationStatusKey/);
assert.match(schemaSource, /reasonCode:\s*a\.string\(\)/);
assert.match(schemaSource, /listReferencesByCurationStatusKeyAndUpdatedAt/);
assert.doesNotMatch(schemaSource.match(/Reference:[\s\S]*?ReferenceAttachment:/)?.[0] ?? "", /a\.boolean\(\)[\s\S]*curation/);
assert.match(schemaSource, /listAssignmentsByQueueStatusAndPriority/);
assert.match(schemaSource, /listKnowledgeImportRunsByCorpusKindAndImportedAt/);
assert.match(schemaSource, /listKnowledgeArtifactsByImportRunAndKind/);
assert.match(schemaSource, /listSemanticNodesByImportRunAndNodeKey/);
assert.match(authoringClientSource, /listAssignmentsByTypeStatusAndCreatedAt/);
assert.match(authoringClientSource, /listKnowledgeImportRunsByCorpusKindAndImportedAt/);
assert.match(authoringClientSource, /listKnowledgeArtifactsByImportRunAndKind/);
assert.match(authoringClientSource, /listSemanticNodesByImportRunAndNodeKey/);
assert.match(authoringClientSource, /getRecordsById/);
assert.match(schemaSource, /listAssignmentsByNewsroomFeedAndCreatedAt/);
assert.match(schemaSource, /listMessagesByNewsroomFeedAndCreatedAt/);
assert.match(schemaSource, /listReferencesByNewsroomFeedAndCreatedAt/);
assert.match(schemaSource, /listSemanticNodesByNewsroomFeedAndCreatedAt/);
assert.match(schemaSource, /listSemanticRelationsByNewsroomFeedAndCreatedAt/);
assert.match(schemaSource, /NewsroomSummary:\s*a\.customType/);
assert.match(schemaSource, /facets:\s*a\.json\(\)/);
assert.match(schemaSource, /getNewsroomSummary:\s*a\s*\n\s*\.query/);
assert.match(schemaSource, /updateNewsroomSummary:\s*a\s*\n\s*\.mutation/);
assert.match(schemaSource, /ModelAttachmentUploadSlot:\s*a\.customType/);
assert.match(schemaSource, /ModelAttachmentDownloadSlot:\s*a\.customType/);
assert.match(schemaSource, /createModelAttachmentUpload:\s*a\s*\n\s*\.mutation/);
assert.match(schemaSource, /completeModelAttachmentUpload:\s*a\s*\n\s*\.mutation/);
assert.match(schemaSource, /abortModelAttachmentUpload:\s*a\s*\n\s*\.mutation/);
assert.match(schemaSource, /createModelAttachmentDownload:\s*a\s*\n\s*\.mutation/);
assert.match(schemaSource, /allow\.groups\(categoryWriteGroups\)\.to\(categoryAppendOnlyOperations\)/);
assert.doesNotMatch(schemaSource.match(/UserIdentity:[\s\S]*?UserRoleAssignment:/)?.[0] ?? "", /publicApiKey/);
assert.doesNotMatch(schemaSource.match(/CategoryKeyword:[\s\S]*?SteeringProposal:/)?.[0] ?? "", /publicApiKey/);
assert.doesNotMatch(schemaSource.match(/Reference:[\s\S]*?Item:/)?.[0] ?? "", /publicApiKey/);
const semanticGraphSource = fs.readFileSync(path.join(__dirname, "..", "lib", "semantic-graph.ts"), "utf8");
assert.match(semanticGraphSource, /has_editorial_form/);
assert.match(semanticGraphSource, /items by editorial form/);
assert.match(semanticGraphSource, /ingestion_rationale/);
assert.match(semanticGraphSource, /planned_for_edition/);
assert.match(semanticGraphSource, /targets_lane/);
assert.match(semanticGraphSource, /uses_signal/);

const roleHandlerSource = fs.readFileSync(path.join(__dirname, "..", "amplify", "functions", "manage-user-role", "handler.ts"), "utf8");
assert.match(roleHandlerSource, /operation === "mergeUserProfiles"/);
assert.match(roleHandlerSource, /archive source UserProfile/);
assert.match(roleHandlerSource, /mirrorRolesToCognitoUsers/);

const summaryHandlerSource = fs.readFileSync(path.join(__dirname, "..", "amplify", "functions", "newsroom-summary", "handler.ts"), "utf8");
assert.match(summaryHandlerSource, /KnowledgeRawPayload\.get/);
assert.match(summaryHandlerSource, /updateNewsroomSummary/);
assert.match(summaryHandlerSource, /applySummaryDelta/);
assert.match(summaryHandlerSource, /applyFacetDeltas/);
assert.doesNotMatch(summaryHandlerSource, /listAll\(/);
assert.doesNotMatch(summaryHandlerSource, /client\.models\.Reference\.list/);
assert.doesNotMatch(summaryHandlerSource, /client\.models\.Message\.list/);
assert.doesNotMatch(summaryHandlerSource, /client\.models\.Assignment\.list/);

const authoringSource = fs.readFileSync(path.join(__dirname, "lib", "papyrus-graphql-authoring.cjs"), "utf8");
assert.match(authoringSource, /mutation UpdateNewsroomSummary/);
assert.match(authoringSource, /updateNewsroomSummary\(delta/);
assert.match(authoringSource, /mutation CreateModelAttachmentUpload/);
assert.match(authoringSource, /createModelAttachmentUpload\(attachment/);
assert.match(authoringSource, /mutation CompleteModelAttachmentUpload/);
assert.match(authoringSource, /mutation CreateModelAttachmentDownload/);
assert.match(authoringSource, /createModelAttachmentDownload\(attachmentId/);

const attachmentHelperSource = fs.readFileSync(path.join(__dirname, "lib", "papyrus-model-attachments.cjs"), "utf8");
const uploadAttachmentBodySource = attachmentHelperSource.match(/async function uploadAttachmentBody[\s\S]*?\n}\n/)?.[0] ?? "";
assert.match(uploadAttachmentBodySource, /createModelAttachmentUpload/);
assert.match(uploadAttachmentBodySource, /completeModelAttachmentUpload/);
assert.doesNotMatch(uploadAttachmentBodySource, /spawnSync\("aws"/);
const downloadAttachmentBufferSource = attachmentHelperSource.match(/async function downloadAttachmentBuffer[\s\S]*?\n}\n/)?.[0] ?? "";
assert.match(downloadAttachmentBufferSource, /createModelAttachmentDownload/);

const summaryPayload = buildNewsroomSummaryPayload({
  categorySets: [
    { id: "set-1-v2", lineageId: "set-1", versionNumber: 2, versionState: "current" },
    { id: "set-1-v1", lineageId: "set-1", versionNumber: 1, versionState: "superseded" },
  ],
  categories: [
    { id: "cat-1-v2", lineageId: "cat-1", versionNumber: 2, versionState: "current" },
    { id: "cat-1-v1", lineageId: "cat-1", versionNumber: 1, versionState: "superseded" },
  ],
  references: [
    { id: "reference-1-v2", lineageId: "reference-1", versionNumber: 2, versionState: "current", curationStatus: "accepted", corpusId: "corpus-1" },
    { id: "reference-1-v1", lineageId: "reference-1", versionNumber: 1, versionState: "superseded", curationStatus: "pending", corpusId: "corpus-1" },
    { id: "reference-2-v1", lineageId: "reference-2", versionNumber: 1, versionState: "current", curationStatus: "rejected", corpusId: "corpus-2" },
  ],
  semanticNodes: [
    { id: "node-1-v2", lineageId: "node-1", versionNumber: 2, versionState: "current", nodeKind: "concept", status: "accepted" },
    { id: "node-1-v1", lineageId: "node-1", versionNumber: 1, versionState: "superseded", nodeKind: "concept", status: "accepted" },
  ],
  messages: [
    { messageKind: "ingestion_rationale", messageDomain: "reference_intake" },
    { messageKind: "reference_curation", messageDomain: "commentary" },
  ],
  assignments: [
    { status: "open", assignmentTypeKey: "curation.reference-intake" },
    { status: "claimed", assignmentTypeKey: "analysis.reindex" },
  ],
  semanticRelations: [{ relationState: "current" }, { relationState: "superseded" }],
  importRuns: [{ id: "older", importedAt: "2026-05-18T10:00:00.000Z" }, { id: "newer", importedAt: "2026-05-18T11:00:00.000Z" }],
  now: "2026-05-18T12:00:00.000Z",
});
assert.equal(summaryPayload.counts.categorySets, 1);
assert.equal(summaryPayload.counts.categories, 1);
assert.equal(summaryPayload.counts.references, 2);
assert.equal(summaryPayload.counts.semanticNodes, 1);
assert.equal(summaryPayload.counts.semanticRelations, 1);
assert.equal(summaryPayload.referenceStatusCounts.accepted, 1);
assert.equal(summaryPayload.referenceStatusCounts.pending ?? 0, 0);
assert.equal(summaryPayload.referenceStatusCounts.rejected, 1);
assert.equal(summaryPayload.assignmentStatusCounts.open, 1);
assert.equal(summaryPayload.facets.assignments.statusByType["curation.reference-intake"].open, 1);
assert.equal(summaryPayload.facets.messages.domainByKind.ingestion_rationale.reference_intake, 1);
assert.equal(summaryPayload.latestImportRun.id, "newer");
const summaryRecord = buildNewsroomSummaryPayloadRecord(summaryPayload, "2026-05-18T12:00:00.000Z");
assert.equal(summaryRecord.id, NEWSROOM_SUMMARY_PAYLOAD_ID);
assert.equal(summaryRecord.ownerType, "newsroom");
assert.equal(summaryRecord.payloadKind, "summary-snapshot");
const deltaPayload = applySummaryDeltas(summaryPayload, {
  now: "2026-05-18T12:01:00.000Z",
  countDeltas: { messages: 1 },
  messageKindDeltas: { reference_curation: 1 },
  referenceStatusDeltas: { pending: -1, accepted: 1 },
  facetDeltas: {
    assignments: {
      byStatus: { open: -1, claimed: 1 },
      statusByType: { "curation.reference-intake": { open: -1, claimed: 1 } },
    },
  },
});
assert.equal(deltaPayload.counts.messages, 3);
assert.equal(deltaPayload.messageKindCounts.reference_curation, 2);
assert.equal(deltaPayload.referenceStatusCounts.pending ?? 0, 0);
assert.equal(deltaPayload.referenceStatusCounts.accepted, 2);
assert.equal(deltaPayload.facets.assignments.byStatus.claimed, 2);
assert.equal(deltaPayload.facets.assignments.statusByType["curation.reference-intake"].claimed, 1);
assert.equal(normalizeNewsroomSummaryPayload(JSON.stringify(deltaPayload)).source, "incremental");
const referenceNetZeroDelta = computeCurrentReferenceDeltaFromChanges([
  {
    modelName: "Reference",
    action: "create",
    expected: {
      id: "reference-1-v2",
      lineageId: "reference-1",
      versionState: "current",
      curationStatus: "accepted",
      corpusId: "knowledge-corpus-ai-ml-journalism",
    },
    current: null,
  },
  {
    modelName: "Reference",
    action: "update",
    expected: { id: "reference-1-v1", versionState: "superseded" },
    current: {
      id: "reference-1-v1",
      lineageId: "reference-1",
      versionState: "current",
      curationStatus: "accepted",
      corpusId: "knowledge-corpus-ai-ml-journalism",
    },
  },
]);
assert.equal(referenceNetZeroDelta.countDelta, 0);
assert.equal(referenceNetZeroDelta.statusDeltas.accepted ?? 0, 0);
assert.equal(referenceNetZeroDelta.corpusDeltas["knowledge-corpus-ai-ml-journalism"] ?? 0, 0);
const referenceStatusTransitionDelta = computeCurrentReferenceDeltaFromChanges([
  {
    modelName: "Reference",
    action: "update",
    expected: {
      id: "reference-2-v1",
      lineageId: "reference-2",
      versionState: "current",
      curationStatus: "accepted",
      corpusId: "knowledge-corpus-ai-ml-research",
    },
    current: {
      id: "reference-2-v1",
      lineageId: "reference-2",
      versionState: "current",
      curationStatus: "pending",
      corpusId: "knowledge-corpus-ai-ml-research",
    },
  },
]);
assert.equal(referenceStatusTransitionDelta.countDelta, 0);
assert.equal(referenceStatusTransitionDelta.statusDeltas.pending ?? 0, -1);
assert.equal(referenceStatusTransitionDelta.statusDeltas.accepted ?? 0, 1);
assert.equal(referenceStatusTransitionDelta.statusByCorpusDeltas["knowledge-corpus-ai-ml-research"].pending ?? 0, -1);
assert.equal(referenceStatusTransitionDelta.statusByCorpusDeltas["knowledge-corpus-ai-ml-research"].accepted ?? 0, 1);

const sandboxJwtResult = spawnSync(process.execPath, ["scripts/refresh-jwt.cjs", "--no-discover-ssm-param"], {
  cwd: path.join(__dirname, ".."),
  encoding: "utf8",
  env: {
    ...process.env,
    PAPYRUS_SANDBOX_JWT_SECRET: "unit-test-sandbox-secret",
    PAPYRUS_JWT_SECRET: "",
    PAPYRUS_JWT_SECRET_SSM_PARAM: "",
  },
});
assert.equal(sandboxJwtResult.status, 0, sandboxJwtResult.stderr || sandboxJwtResult.stdout);
const sandboxJwtPayload = JSON.parse(Buffer.from(sandboxJwtResult.stdout.trim().split(".")[1], "base64url").toString("utf8"));
assert.equal(sandboxJwtPayload.iss, "papyrus-cli");
assert.equal(sandboxJwtPayload.scope, "papyrus:write");

console.log("category mapper tests passed");

function findRecord(records, modelName, predicate) {
  const record = records.find((entry) => entry.modelName === modelName && predicate(entry.expected));
  assert.ok(record, `Expected ${modelName} record`);
  return record.expected;
}
