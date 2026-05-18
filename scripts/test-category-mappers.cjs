#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildAcceptedCategorySetPayload,
  buildAcceptedCategoryTreePayload,
  buildLexicalSteeringConfigRecords,
  buildLexicalSteeringPayload,
  buildProjectionImportRecords,
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
assert.equal(semanticConceptSeeds.filter((concept) => concept.nodeKind === "editorialForm").length, 3);
assert.equal(semanticConceptSeeds.find((concept) => concept.nodeKey === "editorial.form.reporting")?.scope, "global");
assert.equal(semanticConceptSeeds.find((concept) => concept.nodeKey === "comment.import_rationale")?.scope, "corpus");
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

const reference = findRecord(steeringPlan.records, "Reference", (record) => record.externalItemId === "research-001");
assert.equal(reference.title, "Scaling Laws For Neural Language Models");
assert.equal(reference.sourceUri, "https://arxiv.org/abs/2001.08361");
assert.equal(reference.storagePath, "corpora/canonical-corpus/research-001.md");
assert.equal(JSON.parse(reference.metadata).source_notes, undefined);
assert.equal(JSON.parse(reference.metadata).abstract, undefined);
const steeringAttachment = findRecord(steeringPlan.records, "ReferenceAttachment", (record) => record.referenceId === reference.id);
assert.equal(steeringAttachment.role, "source");
assert.equal(steeringAttachment.storagePath, "corpora/canonical-corpus/research-001.md");
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
assert.equal(steeringPlan.records.filter((record) => record.modelName === "SemanticNode" && record.expected.nodeKind === "editorialForm").length, 3);
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
      import_rationale: "Projected into the source corpus because the classifier found a strong scaling match.",
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
const projectedReference = findRecord(projectionPlan.records, "Reference", (record) => record.externalItemId === "source-001");
assert.equal(projectionPlan.categorySetId, steeringPlan.categorySetId);
assert.equal(projectedReference.title, null);
assert.equal(projectedReference.storagePath, "corpora/source-corpus/source-001.md");
assert.equal(JSON.parse(projectedReference.metadata).abstract, undefined);
const projectionRelation = findRecord(projectionPlan.records, "SemanticRelation", (record) => record.subjectId === projectedReference.id);
assert.equal(projectionRelation.predicate, "classified_as");
assert.equal(projectionRelation.objectKind, "category");
assert.equal(projectionRelation.objectLineageId, fallbackTaxonomyNode.lineageId);
assert.equal(JSON.parse(projectionRelation.metadata).categorySetId, steeringPlan.categorySetId);
assert.equal(projectionRelation.score, 0.82);
assert.equal(projectionRelation.reviewRecommended, true);
const projectedAttachments = projectionPlan.records
  .filter((record) => record.modelName === "ReferenceAttachment" && record.expected.referenceId === projectedReference.id)
  .map((record) => record.expected);
assert.equal(projectedAttachments.length, 4);
assert.equal(projectedAttachments[0].storagePath, "corpora/source-corpus/source-001.md");
assert.equal(projectedAttachments[1].role, "transcript");
assert.equal(projectedAttachments[1].storagePath, "corpora/source-corpus/source-001.transcript.txt");
assert.equal(projectedAttachments[2].role, "deepgram");
assert.equal(projectedAttachments[2].storagePath, "corpora/source-corpus/source-001.deepgram.json");
assert.equal(projectedAttachments[3].storagePath, null);
assert.equal(projectedAttachments[3].sourceUri, "s3://outside-bucket/not-corpora/source-001.pdf");
assert.equal(JSON.parse(projectedAttachments[3].metadata).body, undefined);
const importRationaleComment = findRecord(projectionPlan.records, "KnowledgeComment", (record) => record.subjectId === projectedReference.id);
assert.equal(importRationaleComment.commentKind, "import_rationale");
assert.equal(importRationaleComment.body, "Projected into the source corpus because the classifier found a strong scaling match.");
assert.equal(JSON.parse(importRationaleComment.metadata).body, undefined);
const rationaleRelation = findRecord(projectionPlan.records, "SemanticRelation", (record) => record.subjectKind === "knowledgeComment" && record.subjectId === importRationaleComment.id);
assert.equal(rationaleRelation.predicate, "about");
assert.equal(rationaleRelation.objectKind, "semanticNode");
const referenceAssignment = findRecord(projectionPlan.records, "Assignment", (record) => record.metadata.includes(projectedReference.lineageId));
assert.equal(referenceAssignment.assignmentTypeKey, "curation.reference-intake");
assert.equal(referenceAssignment.status, "open");
const assignmentRelation = findRecord(projectionPlan.records, "SemanticRelation", (record) => record.subjectKind === "assignment" && record.subjectId === referenceAssignment.id);
assert.equal(assignmentRelation.predicate, "requests_work_on");
assert.equal(assignmentRelation.objectKind, "reference");
assert.equal(assignmentRelation.objectLineageId, projectedReference.lineageId);
const projectionCorpus = findRecord(projectionPlan.records, "KnowledgeCorpus", (record) => record.id === "knowledge-corpus-source-corpus");
assert.equal(projectionCorpus.role, "source");
const projectedEditorialConcept = findRecord(projectionPlan.records, "SemanticNode", (record) => record.nodeKey === "editorial.form.analysis");
assert.equal(projectedEditorialConcept.id, "semantic-node-editorial-form-analysis-v1");
assert.equal(projectedEditorialConcept.nodeKind, "editorialForm");
assert.equal(projectedEditorialConcept.corpusId, null);
assert.equal(projectionPlan.records.filter((record) => record.modelName === "SemanticNode" && record.expected.nodeKind === "editorialForm").length, 3);
assert.equal(
  projectionPlan.records.some((record) => JSON.stringify(record.expected).includes("AI-ML-research") || JSON.stringify(record.expected).includes("AI-ML-history")),
  false,
  "projection imports should use configured corpus ids without AI/ML name fallbacks",
);

const schemaSource = fs.readFileSync(path.join(__dirname, "..", "amplify", "data", "resource.ts"), "utf8");
assert.match(schemaSource, /ReferenceAttachment:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /KnowledgeComment:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /Assignment:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /AssignmentEvent:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /CategoryKeyword:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /LexicalSteeringRule:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /listAssignmentsForObject:\s*a\s*\n\s*\.query/);
assert.match(schemaSource, /listAssignmentQueue:\s*a\s*\n\s*\.query/);
assert.match(schemaSource, /UserIdentity:\s*a\s*\n\s*\.model/);
assert.match(schemaSource, /listUserDirectory:\s*a\s*\n\s*\.query/);
assert.match(schemaSource, /mergeUserProfiles:\s*a\s*\n\s*\.mutation/);
assert.match(schemaSource.match(/UserProfile:[\s\S]*?UserIdentity:/)?.[0] ?? "", /mergedIntoProfileId/);
assert.match(schemaSource, /listUserIdentitiesByProfileAndLinkedAt/);
assert.match(schemaSource, /listUserRoleAssignmentsByProfileAndRole/);
assert.match(schemaSource, /listReferenceAttachmentsByReferenceVersionAndSortKey/);
assert.match(schemaSource, /listKnowledgeCommentsByAuthorSubAndCreatedAt/);
assert.match(schemaSource, /listAssignmentsByQueueStatusAndPriority/);
assert.match(schemaSource, /allow\.groups\(categoryWriteGroups\)\.to\(categoryAppendOnlyOperations\)/);
assert.doesNotMatch(schemaSource.match(/UserIdentity:[\s\S]*?UserRoleAssignment:/)?.[0] ?? "", /publicApiKey/);
assert.doesNotMatch(schemaSource.match(/CategoryKeyword:[\s\S]*?SteeringProposal:/)?.[0] ?? "", /publicApiKey/);
assert.doesNotMatch(schemaSource.match(/Reference:[\s\S]*?Item:/)?.[0] ?? "", /publicApiKey/);
const semanticGraphSource = fs.readFileSync(path.join(__dirname, "..", "lib", "semantic-graph.ts"), "utf8");
assert.match(semanticGraphSource, /has_editorial_form/);
assert.match(semanticGraphSource, /items by editorial form/);

const roleHandlerSource = fs.readFileSync(path.join(__dirname, "..", "amplify", "functions", "manage-user-role", "handler.ts"), "utf8");
assert.match(roleHandlerSource, /operation === "mergeUserProfiles"/);
assert.match(roleHandlerSource, /archive source UserProfile/);
assert.match(roleHandlerSource, /mirrorRolesToCognitoUsers/);

console.log("category mapper tests passed");

function findRecord(records, modelName, predicate) {
  const record = records.find((entry) => entry.modelName === modelName && predicate(entry.expected));
  assert.ok(record, `Expected ${modelName} record`);
  return record.expected;
}
