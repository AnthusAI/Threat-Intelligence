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
  const corpusId = options.corpusId ?? knowledgeCorpusId(corpusContext);
  const classifierId = bundle.topic_set?.classifier_id ?? options.classifierId ?? "unknown-classifier";
  const sourceSnapshotId = latestSnapshotId(bundle.artifacts, "topic-governance");
  const importRunId = `knowledge-import-${safeId(corpusId)}-${safeId(classifierId)}-${hashShort([
    bundle.generated_at,
    bundle.proposals?.length ?? 0,
    bundle.artifacts?.length ?? 0,
  ])}`;
  const categorySetId = categorySetIdFor(classifierId, corpusId);
  const records = [];

  records.push(record("KnowledgeCorpus", {
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

  records.push(record("KnowledgeImportRun", {
    id: importRunId,
    corpusId,
    importKind: "steering-export",
    classifierId,
    sourceSnapshotId,
    status: "imported",
    generatedAt: dateOrNull(bundle.generated_at),
    importedAt: now,
    itemCount: bundle.items?.length ?? 0,
      categoryCount: bundle.topic_set?.topics?.length ?? 0,
    proposalCount: bundle.proposals?.length ?? 0,
    artifactCount: bundle.artifacts?.length ?? 0,
    referenceCount: (bundle.items ?? []).length,
    relationCount: 0,
    warningCount: bundle.warnings?.length ?? 0,
  }));
  records.push(rawPayloadRecord("importRun", importRunId, "warnings", { warnings: bundle.warnings ?? [] }, importRunId, now));
  records.push(...commentConceptNodeRecords({ corpusId, importRunId, now }));

  for (const item of bundle.items ?? []) {
    records.push(...referenceRecords(item, {
      corpusId,
      categorySetId,
      classifierId,
      sourceSnapshotId,
      importRunId,
      now,
    }));
  }

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
    records.push(...semanticRecordsFromProposal(proposal, { corpusId, importRunId, categorySetId, now }));
  }
  const importRun = records.find((entry) => entry.modelName === "KnowledgeImportRun");
  if (importRun) {
    importRun.expected.relationCount = records.filter((entry) => entry.modelName === "SemanticRelation").length;
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
  const targetCorpusId = options.targetCorpusId ?? knowledgeCorpusId(targetCorpus);
  const authorityCorpusId = options.authorityCorpusId ?? knowledgeCorpusId(authorityCorpus);
  const classifierId = payload.classifier_id ?? firstItem.classifier_id ?? options.classifierId ?? "unknown-classifier";
  const importRunId = `knowledge-import-${safeId(targetCorpusId)}-${safeId(classifierId)}-projection-${hashShort(payload.summary ?? items)}`;
  const relationRecords = projectionRelationRecords(items, {
    targetCorpusId,
    authorityCorpusId,
    classifierId,
    importRunId,
    now,
  });
  const categorySetId = categorySetIdFor(classifierId, authorityCorpusId);
  const records = [
    record("KnowledgeCorpus", {
      id: targetCorpusId,
      name: targetCorpus.name,
      role: targetCorpus.role,
      itemCount: null,
      generatedAt: null,
      latestImportRunId: importRunId,
      createdAt: now,
      updatedAt: now,
    }),
    record("KnowledgeImportRun", {
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
      referenceCount: items.length,
      relationCount: relationRecords.length,
      warningCount: 0,
    }),
    rawPayloadRecord("importRun", importRunId, "projection-summary", payload.summary ?? {}, importRunId, now),
    ...commentConceptNodeRecords({ corpusId: targetCorpusId, importRunId, now }),
    ...relationRecords,
  ];

  for (const item of items) {
    const referenceRecordsForItem = referenceRecords(item, {
      corpusId: targetCorpusId,
      categorySetId,
      classifierId,
      sourceSnapshotId: item.extraction_snapshot?.snapshot_id ?? firstItem.extraction_snapshot?.snapshot_id ?? null,
      importRunId,
      now,
    });
    const reference = referenceRecordsForItem.find((entry) => entry.modelName === "Reference");
    records.push(...referenceRecordsForItem);
    records.push(rawPayloadRecord("projection", reference.expected.id, "biblicus-projection", sanitizeProjectionPayload(item), importRunId, now));
  }
  const importRun = records.find((entry) => entry.modelName === "KnowledgeImportRun");
  if (importRun) {
    importRun.expected.relationCount = records.filter((entry) => entry.modelName === "SemanticRelation").length;
  }

  return { importRunId, records };
}

function buildSteeringConfigRecords(config, options = {}) {
  const now = options.importedAt ?? new Date().toISOString();
  return (config.corpora ?? []).map((corpus) => record("KnowledgeCorpus", {
    id: knowledgeCorpusId(corpus),
    name: corpus.name,
    role: corpus.role,
    createdAt: now,
    updatedAt: now,
  }));
}

function referenceRecord(item, context) {
  const externalItemId = requiredString(item.item_id ?? item.id ?? item.externalItemId, "reference item_id");
  const lineageId = referenceLineageIdFor(context.corpusId, externalItemId);
  const metadata = sanitizeReferenceMetadata(item.metadata ?? item);
  const pathValue = item.storage_path ?? item.storagePath ?? item.relpath ?? item.path;
  const normalizedPath = normalizeStoragePath(pathValue);
  const reference = {
    id: `${lineageId}-v1`,
    lineageId,
    corpusId: context.corpusId,
    externalItemId,
    title: stringOrNull(item.title ?? metadata.title),
    authors: stringArrayFrom(item.authors ?? metadata.authors),
    sourceUri: stringOrNull(item.source_uri ?? item.sourceUri ?? metadata.source_uri ?? metadata.sourceUri) ?? normalizedPath.sourceUri,
    storagePath: normalizedPath.storagePath,
    mediaType: stringOrNull(item.media_type ?? item.mediaType),
    byteSize: integerOrNull(item.bytes ?? item.byte_size ?? item.byteSize),
    sha256: stringOrNull(item.sha256 ?? item.checksum),
    sourcePublishedAt: stringOrNull(item.dates?.published_at ?? item.dates?.publishedAt ?? item.published_at ?? item.publishedAt),
    sourceUpdatedAt: stringOrNull(item.dates?.updated_at ?? item.dates?.updatedAt ?? item.updated_at ?? item.updatedAt),
    retrievedAt: stringOrNull(item.dates?.retrieved_at ?? item.dates?.retrievedAt ?? item.retrieved_at ?? item.retrievedAt),
    importRunId: context.importRunId,
    importedAt: context.now,
    metadata: JSON.stringify(metadata),
    updatedAt: context.now,
  };
  return record("Reference", versionedRecord(reference, {
    now: context.now,
    actor: "biblicus-import",
    reason: "reference-import",
    content: sanitizeReferenceContent(reference),
  }));
}

function referenceRecords(item, context) {
  const reference = referenceRecord(item, context);
  return [
    reference,
    ...referenceAttachmentRecords(item, reference.expected, context),
    ...referenceCommentRecords(item, reference.expected, context),
    ...referenceCurationAssignmentRecords(item, reference.expected, context),
  ];
}

function referenceCurationAssignmentRecords(item, reference, context) {
  const assignment = referenceCurationAssignmentRecord(item, reference, context);
  return [
    assignment,
    referenceCurationAssignmentRelationRecord(item, reference, assignment.expected, context),
  ];
}

function referenceCurationAssignmentRecord(item, reference, context) {
  const assignmentTypeKey = "curation.reference-intake";
  const queueKey = `${assignmentTypeKey}#${context.corpusId}`;
  const assignmentId = `assignment-${safeId(assignmentTypeKey)}-${hashShort([
    context.corpusId,
    reference.lineageId,
    reference.contentHash ?? "",
  ])}`;
  const title = reference.title
    ? `Curate reference: ${reference.title}`
    : `Curate reference ${reference.externalItemId}`;
  return record("Assignment", {
    id: assignmentId,
    assignmentTypeKey,
    queueKey,
    queueStatusKey: `${queueKey}#open`,
    status: "open",
    priority: integerOrNull(item.priority) ?? 50,
    title,
    brief: "Review this knowledge-base reference and add any useful curation notes, semantic links, category evidence, or follow-up proposals.",
    instructions: "Inspect the linked Reference metadata and private corpus attachments. Do not copy source contents into Papyrus; write durable findings as KnowledgeComment, SemanticRelation, or SteeringProposal records.",
    assigneeType: null,
    assigneeId: null,
    assigneeKey: null,
    claimedAt: null,
    claimExpiresAt: null,
    completedAt: null,
    canceledAt: null,
    corpusId: context.corpusId,
    categorySetId: context.categorySetId ?? null,
    classifierId: context.classifierId ?? null,
    sourceSnapshotId: context.sourceSnapshotId ?? null,
    importRunId: context.importRunId,
    createdBy: "biblicus-import",
    createdAt: context.now,
    updatedAt: context.now,
    metadata: JSON.stringify({
      referenceLineageId: reference.lineageId,
      referenceId: reference.id,
      externalItemId: reference.externalItemId,
      sourceUri: reference.sourceUri,
      storagePath: reference.storagePath,
      contentHash: reference.contentHash,
    }),
  });
}

function referenceCurationAssignmentRelationRecord(item, reference, assignment, context) {
  return semanticRelationRecord({
    predicate: "requests_work_on",
    subjectKind: "assignment",
    subjectId: assignment.id,
    subjectLineageId: assignment.id,
    subjectVersionNumber: null,
    objectKind: "reference",
    objectId: reference.id,
    objectLineageId: reference.lineageId,
    objectVersionNumber: reference.versionNumber,
    score: null,
    confidence: null,
    rank: 1,
    classifierId: context.classifierId ?? null,
    modelVersion: null,
    reviewRecommended: true,
    sourceSnapshotId: context.sourceSnapshotId ?? null,
    importRunId: context.importRunId,
    importedAt: context.now,
    metadata: {
      assignmentTypeKey: assignment.assignmentTypeKey,
      queueKey: assignment.queueKey,
      externalItemId: reference.externalItemId,
      title: reference.title ?? item.title ?? null,
    },
  });
}

const COMMENT_CONCEPTS = [
  {
    nodeKey: "comment.general",
    displayName: "General Comment",
    description: "A general note about a private knowledge or content object.",
  },
  {
    nodeKey: "comment.import_rationale",
    displayName: "Import Rationale",
    description: "A note explaining why a reference or content item was imported.",
  },
  {
    nodeKey: "comment.ai_slop_assessment",
    displayName: "AI Slop Assessment",
    description: "A note assessing whether a reference or content item is low-quality generated material.",
  },
];

function commentConceptNodeRecords(context) {
  return COMMENT_CONCEPTS.map((concept) => {
    const lineageId = semanticNodeLineageIdFor(concept.nodeKey);
    return record("SemanticNode", versionedRecord({
      id: `${lineageId}-v1`,
      lineageId,
      nodeKey: concept.nodeKey,
      nodeKind: "commentConcept",
      corpusId: context.corpusId,
      categorySetId: null,
      categoryLineageId: null,
      categoryKey: null,
      displayName: concept.displayName,
      description: concept.description,
      aliases: [],
      status: "accepted",
      importRunId: context.importRunId,
      updatedAt: context.now,
    }, {
      now: context.now,
      actor: "biblicus-import",
      reason: "comment-concept-seed",
      content: concept,
    }));
  });
}

function referenceAttachmentRecords(item, reference, context) {
  const attachments = referenceAttachmentInputs(item, reference);
  return attachments.map((attachment, index) => {
    const role = safeAttachmentRole(attachment.role ?? (index === 0 ? "source" : "attachment"));
    const sortKey = `${String(index + 1).padStart(3, "0")}-${role}`;
    const referenceVersionKey = semanticVersionKey("reference", reference.id);
    const metadata = sanitizeReferenceMetadata({
      ...(attachment.metadata ?? {}),
      ...(attachment.warning ? { warning: attachment.warning } : {}),
    });
    return record("ReferenceAttachment", {
      id: `reference-attachment-${hashShort([
        referenceVersionKey,
        role,
        sortKey,
        attachment.storagePath ?? "",
        attachment.sourceUri ?? "",
      ])}`,
      referenceId: reference.id,
      referenceLineageId: reference.lineageId,
      referenceVersionNumber: reference.versionNumber,
      referenceVersionKey,
      role,
      sortKey,
      storagePath: attachment.storagePath,
      sourceUri: attachment.sourceUri,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
      etag: attachment.etag,
      importRunId: context.importRunId,
      importedAt: context.now,
      metadata: JSON.stringify(metadata),
    });
  });
}

function referenceAttachmentInputs(item, reference) {
  const inputs = [];
  const addAttachment = (candidate, fallbackRole) => {
    const normalized = normalizeAttachmentInput(candidate, fallbackRole);
    if (!normalized) return;
    const key = `${normalized.storagePath ?? ""}\n${normalized.sourceUri ?? ""}\n${normalized.role ?? ""}`;
    if (inputs.some((entry) => `${entry.storagePath ?? ""}\n${entry.sourceUri ?? ""}\n${entry.role ?? ""}` === key)) return;
    inputs.push(normalized);
  };

  addAttachment({
    role: "source",
    storagePath: reference.storagePath,
    sourceUri: reference.sourceUri,
    mediaType: reference.mediaType,
    byteSize: reference.byteSize,
    sha256: reference.sha256,
  }, "source");

  for (const field of ["attachments", "files", "source_files", "sourceFiles"]) {
    const value = item[field];
    if (!Array.isArray(value)) continue;
    for (const entry of value) addAttachment(entry, "attachment");
  }

  addAttachment(item.source_file ?? item.sourceFile, "source");
  addAttachment(item.transcript_file ?? item.transcriptFile ?? item.transcript_path ?? item.transcriptPath, "transcript");
  addAttachment(item.deepgram_file ?? item.deepgramFile ?? item.deepgram_json_path ?? item.deepgramJsonPath ?? item.deepgram_path ?? item.deepgramPath, "deepgram");
  addAttachment(item.raw_file ?? item.rawFile ?? item.raw_path ?? item.rawPath, "raw");

  return inputs;
}

function normalizeAttachmentInput(candidate, fallbackRole) {
  if (!candidate) return null;
  const entry = typeof candidate === "string" ? { path: candidate } : candidate;
  if (!entry || typeof entry !== "object") return null;
  const pathValue = stringOrNull(
    entry.storage_path
    ?? entry.storagePath
    ?? entry.path
    ?? entry.s3_path
    ?? entry.s3Path
    ?? entry.uri
    ?? entry.url
    ?? entry.source_uri
    ?? entry.sourceUri,
  );
  const normalizedPath = normalizeStoragePath(pathValue);
  const storagePath = normalizedPath.storagePath;
  const sourceUri = stringOrNull(entry.source_uri ?? entry.sourceUri ?? entry.uri ?? entry.url)
    ?? normalizedPath.sourceUri
    ?? (storagePath ? null : pathValue);
  if (!storagePath && !sourceUri) return null;
  return {
    role: entry.role ?? entry.kind ?? entry.type ?? fallbackRole,
    storagePath,
    sourceUri,
    filename: stringOrNull(entry.filename ?? entry.name) ?? filenameFromPath(storagePath ?? sourceUri),
    mediaType: stringOrNull(entry.media_type ?? entry.mediaType ?? entry.contentType),
    byteSize: integerOrNull(entry.bytes ?? entry.byte_size ?? entry.byteSize ?? entry.size),
    sha256: stringOrNull(entry.sha256 ?? entry.checksum),
    etag: stringOrNull(entry.etag ?? entry.eTag),
    metadata: entry.metadata ?? entry,
    warning: normalizedPath.warning,
  };
}

function normalizeStoragePath(value) {
  const raw = stringOrNull(value);
  if (!raw) return { storagePath: null, sourceUri: null, warning: null };
  if (raw.startsWith("corpora/")) return { storagePath: raw, sourceUri: null, warning: null };
  if (raw.startsWith("/")) {
    const marker = "/corpora/";
    const markerIndex = raw.indexOf(marker);
    if (markerIndex >= 0) return { storagePath: raw.slice(markerIndex + 1), sourceUri: raw, warning: null };
    return { storagePath: null, sourceUri: raw, warning: "external-local-path" };
  }
  if (!raw.startsWith("s3://")) return { storagePath: raw.includes("/") ? raw : null, sourceUri: raw.includes("/") ? null : raw, warning: null };
  try {
    const parsed = new URL(raw);
    const storagePath = parsed.pathname.replace(/^\/+/, "");
    if (storagePath.startsWith("corpora/")) return { storagePath, sourceUri: raw, warning: null };
    return { storagePath: null, sourceUri: raw, warning: "external-s3-path" };
  } catch {
    return { storagePath: null, sourceUri: raw, warning: "unparseable-path" };
  }
}

function filenameFromPath(value) {
  const normalized = stringOrNull(value);
  if (!normalized) return null;
  return normalized.split(/[/?#]/).filter(Boolean).at(-1) ?? null;
}

function safeAttachmentRole(value) {
  return safeId(value || "attachment");
}

function referenceCommentRecords(item, reference, context) {
  const rationale = importRationaleFrom(item);
  if (!rationale) return [];
  const comment = knowledgeCommentRecord({
    subjectKind: "reference",
    subjectId: reference.id,
    subjectLineageId: reference.lineageId,
    subjectVersionNumber: reference.versionNumber,
    commentKind: "import_rationale",
    body: rationale,
    source: "biblicus-import",
    importRunId: context.importRunId,
    createdAt: context.now,
    metadata: {
      externalItemId: reference.externalItemId,
      corpusId: reference.corpusId,
    },
  });
  const conceptLineageId = semanticNodeLineageIdFor("comment.import_rationale");
  return [
    comment,
    semanticRelationRecord({
      predicate: "about",
      subjectKind: "knowledgeComment",
      subjectId: comment.expected.id,
      subjectLineageId: comment.expected.id,
      subjectVersionNumber: 1,
      objectKind: "semanticNode",
      objectId: `${conceptLineageId}-v1`,
      objectLineageId: conceptLineageId,
      objectVersionNumber: 1,
      score: null,
      confidence: null,
      rank: 1,
      classifierId: null,
      modelVersion: null,
      reviewRecommended: false,
      sourceSnapshotId: null,
      importRunId: context.importRunId,
      importedAt: context.now,
      metadata: {
        commentKind: "import_rationale",
      },
    }),
  ];
}

function knowledgeCommentRecord(input) {
  const subjectVersionKey = semanticVersionKey(input.subjectKind, input.subjectId);
  const subjectStateKey = semanticStateKey(input.subjectKind, input.subjectLineageId);
  const metadata = sanitizeReferenceMetadata(input.metadata ?? {});
  return record("KnowledgeComment", {
    id: `knowledge-comment-${hashShort([
      subjectVersionKey,
      input.commentKind ?? "comment",
      input.body,
      input.createdAt,
      input.source ?? "",
    ])}`,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    subjectLineageId: input.subjectLineageId,
    subjectVersionNumber: input.subjectVersionNumber,
    subjectVersionKey,
    subjectStateKey,
    commentKind: input.commentKind ?? "comment",
    body: input.body,
    status: input.status ?? "active",
    source: input.source ?? null,
    importRunId: input.importRunId ?? null,
    authorSub: input.authorSub ?? null,
    authorUserProfileId: input.authorUserProfileId ?? null,
    authorLabel: input.authorLabel ?? null,
    metadata: JSON.stringify(metadata),
    createdAt: input.createdAt,
  });
}

function importRationaleFrom(item) {
  return stringOrNull(
    item.import_rationale
    ?? item.importRationale
    ?? item.metadata?.import_rationale
    ?? item.metadata?.importRationale
    ?? item.provenance?.import_rationale
    ?? item.provenance?.importRationale,
  );
}

function projectionRelationRecords(items, context) {
  const records = [];
  const categorySetId = categorySetIdFor(context.classifierId, context.authorityCorpusId);
  for (const item of items) {
    const externalItemId = requiredString(item.item_id, "projection item_id");
    const referenceLineageId = referenceLineageIdFor(context.targetCorpusId, externalItemId);
    const referenceId = `${referenceLineageId}-v1`;
    const candidates = projectionCandidates(item);
    for (const candidate of candidates) {
      const categoryKey = candidate.categoryKey;
      if (!categoryKey) continue;
      const categoryLineageId = categoryLineageIdFor(categorySetId, categoryKey);
      const categoryId = `${categoryLineageId}-v1`;
      records.push(semanticRelationRecord({
        predicate: "classified_as",
        subjectKind: "reference",
        subjectId: referenceId,
        subjectLineageId: referenceLineageId,
        subjectVersionNumber: 1,
        objectKind: "category",
        objectId: categoryId,
        objectLineageId: categoryLineageId,
        objectVersionNumber: 1,
        score: numberOrNull(candidate.score),
        confidence: numberOrNull(candidate.confidence),
        rank: integerOrNull(candidate.rank),
        classifierId: context.classifierId,
        modelVersion: item.model_version ?? null,
        reviewRecommended: Boolean(item.review_recommended ?? candidate.reviewRecommended),
        sourceSnapshotId: item.extraction_snapshot?.snapshot_id ?? null,
        importRunId: context.importRunId,
        importedAt: context.now,
        metadata: {
          categoryKey,
          displayName: candidate.displayName,
          bertopicTopicId: integerOrNull(candidate.bertopicTopicId),
          authorityCorpusId: context.authorityCorpusId,
        },
      }));
    }
  }
  return records;
}

function semanticRecordsFromProposal(proposal, context) {
  const status = proposal.status ?? "proposed";
  if (status !== "accepted") return [];
  const proposalPayload = proposal.payload && typeof proposal.payload === "object" ? proposal.payload : {};
  const nodeKey = proposal.graph_entity_id
    ?? proposalPayload.graph_entity_id
    ?? proposalPayload.entity_id
    ?? proposalPayload.assertion_id
    ?? proposalPayload.source_ref
    ?? null;
  if (!nodeKey) return [];

  const records = [];
  const nodeLineageId = semanticNodeLineageIdFor(nodeKey);
  const nodeId = `${nodeLineageId}-v1`;
  records.push(record("SemanticNode", versionedRecord({
    id: nodeId,
    lineageId: nodeLineageId,
    nodeKey,
    nodeKind: inferSemanticNodeKind(nodeKey, proposal.proposal_kind ?? proposal.kind),
    corpusId: context.corpusId,
    categorySetId: context.categorySetId,
    categoryLineageId: null,
    categoryKey: proposalPayload.topic_uid ?? proposalPayload.category_key ?? null,
    displayName: proposalPayload.display_name ?? proposal.display_name ?? proposal.title ?? nodeKey,
    description: proposalPayload.description ?? proposal.description ?? proposal.rationale ?? null,
    aliases: stringArrayFrom(proposalPayload.aliases),
    status: "accepted",
    importRunId: context.importRunId,
    updatedAt: context.now,
  }, { now: context.now, actor: "biblicus-import", reason: "semantic-node-import", content: proposalPayload })));

  const targetRef = proposalPayload.target_ref ?? proposal.target_category_key ?? proposalPayload.target_topic_uid ?? null;
  const relationshipType = proposal.relationship_type ?? proposalPayload.relationship_type ?? proposalPayload.relationship_uid ?? null;
  if (targetRef && relationshipType) {
    const target = semanticObjectRef(targetRef, context);
    records.push(semanticRelationRecord({
      predicate: relationshipType,
      subjectKind: "semanticNode",
      subjectId: nodeId,
      subjectLineageId: nodeLineageId,
      subjectVersionNumber: 1,
      objectKind: target.kind,
      objectId: target.id,
      objectLineageId: target.lineageId,
      objectVersionNumber: target.versionNumber,
      score: numberOrNull(proposal.score),
      confidence: numberOrNull(proposal.confidence),
      rank: null,
      classifierId: null,
      modelVersion: null,
      reviewRecommended: proposal.recommendation === "recommend",
      sourceSnapshotId: proposal.snapshot_id ?? proposalPayload.graph_snapshot ?? null,
      importRunId: context.importRunId,
      importedAt: context.now,
      metadata: {
        proposalId: proposal.proposal_id ?? null,
        sourceRef: nodeKey,
        targetRef,
      },
    }));
  }
  return records;
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
    record("KnowledgeArtifact", {
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
  const proposalId = `steering-proposal-${safeId(externalProposalId)}`;
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
    record("SteeringProposal", {
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
  return record("KnowledgeRawPayload", {
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

function referenceLineageIdFor(corpusId, externalItemId) {
  return `reference-${safeId(corpusId)}-${safeId(externalItemId)}`;
}

function semanticNodeLineageIdFor(nodeKey) {
  return `semantic-node-${safeId(nodeKey)}`;
}

function knowledgeCorpusId(corpus) {
  return `knowledge-corpus-${safeId(corpus.key ?? corpus.name ?? corpus.corpus_uri ?? "unknown")}`;
}

function categorySetIdFor(classifierId, corpusId) {
  return `category-set-${safeId(corpusId)}-${safeId(classifierId)}`;
}

function categoryLineageIdFor(categorySetId, categoryKey) {
  return `category-${safeId(categorySetId)}-${safeId(categoryKey)}`;
}

function semanticRelationRecord(input) {
  const subjectStateKey = semanticStateKey(input.subjectKind, input.subjectLineageId);
  const objectStateKey = semanticStateKey(input.objectKind, input.objectLineageId);
  const objectSubjectStateKey = `${objectStateKey}#${input.subjectKind}`;
  const predicateObjectStateKey = `${input.predicate}#${objectStateKey}`;
  const subjectVersionKey = semanticVersionKey(input.subjectKind, input.subjectId);
  const objectVersionKey = semanticVersionKey(input.objectKind, input.objectId);
  return record("SemanticRelation", {
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
    objectSubjectStateKey,
    predicateObjectStateKey,
    subjectVersionKey,
    objectVersionKey,
    score: numberOrNull(input.score),
    confidence: numberOrNull(input.confidence),
    rank: integerOrNull(input.rank),
    classifierId: input.classifierId ?? null,
    modelVersion: input.modelVersion ?? null,
    reviewRecommended: Boolean(input.reviewRecommended),
    sourceSnapshotId: input.sourceSnapshotId ?? null,
    importRunId: input.importRunId,
    importedAt: input.importedAt,
    metadata: JSON.stringify(input.metadata ?? {}),
  });
}

function semanticStateKey(kind, lineageId) {
  return `${kind}#${lineageId}#current`;
}

function semanticVersionKey(kind, versionId) {
  return `${kind}#${versionId}`;
}

function projectionCandidates(item) {
  const candidates = [];
  if (Array.isArray(item.topic_candidates)) {
    for (const candidate of item.topic_candidates) {
      candidates.push({
        rank: candidate.rank,
        categoryKey: candidate.category_key ?? candidate.topic_uid ?? null,
        displayName: candidate.display_name ?? null,
        score: candidate.score,
        confidence: candidate.confidence,
        bertopicTopicId: candidate.bertopic_topic_id,
        reviewRecommended: candidate.review_recommended,
      });
    }
  }
  const topLevelCategoryKey = item.category_key ?? item.topic_uid ?? null;
  if (topLevelCategoryKey && !candidates.some((candidate) => candidate.categoryKey === topLevelCategoryKey)) {
    candidates.unshift({
      rank: item.rank ?? 1,
      categoryKey: topLevelCategoryKey,
      displayName: item.display_name ?? null,
      score: item.score,
      confidence: item.confidence,
      bertopicTopicId: item.bertopic_topic_id,
      reviewRecommended: item.review_recommended,
    });
  }
  return candidates;
}

function semanticObjectRef(ref, context) {
  if (String(ref).startsWith("topic:")) {
    const categoryKey = String(ref).replace(/^topic:/, "");
    const categorySetId = context.categorySetId ?? categorySetIdFor("unknown-classifier", context.corpusId);
    const categoryLineageId = categoryLineageIdFor(categorySetId, categoryKey);
    return {
      kind: "category",
      id: `${categoryLineageId}-v1`,
      lineageId: categoryLineageId,
      versionNumber: 1,
    };
  }
  const nodeLineageId = semanticNodeLineageIdFor(ref);
  return {
    kind: "semanticNode",
    id: `${nodeLineageId}-v1`,
    lineageId: nodeLineageId,
    versionNumber: 1,
  };
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

function stringArrayFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

const STRICT_REFERENCE_METADATA_DENY_KEYS = new Set([
  "abstract",
  "body",
  "content",
  "excerpt",
  "extracted_text",
  "extractedText",
  "full_text",
  "fullText",
  "markdown",
  "raw_text",
  "rawText",
  "source_notes",
  "summary",
  "text",
  "transcript",
]);

function sanitizeReferenceMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (STRICT_REFERENCE_METADATA_DENY_KEYS.has(key)) continue;
    if (entry === undefined) continue;
    if (Array.isArray(entry)) {
      sanitized[key] = entry
        .map((item) => sanitizeReferenceMetadataValue(item))
        .filter((item) => item !== undefined);
      continue;
    }
    const normalized = sanitizeReferenceMetadataValue(entry);
    if (normalized !== undefined) sanitized[key] = normalized;
  }
  return sanitized;
}

function sanitizeReferenceMetadataValue(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeReferenceMetadataValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") return sanitizeReferenceMetadata(value);
  return undefined;
}

function sanitizeReferenceContent(reference) {
  return {
    corpusId: reference.corpusId,
    externalItemId: reference.externalItemId,
    title: reference.title,
    authors: reference.authors,
    sourceUri: reference.sourceUri,
    storagePath: reference.storagePath,
    mediaType: reference.mediaType,
    byteSize: reference.byteSize,
    sha256: reference.sha256,
    sourcePublishedAt: reference.sourcePublishedAt,
    sourceUpdatedAt: reference.sourceUpdatedAt,
    retrievedAt: reference.retrievedAt,
    metadata: reference.metadata,
  };
}

function sanitizeProjectionPayload(item) {
  return {
    ...sanitizeReferenceMetadata(item),
    item_id: item.item_id,
    title: item.title ?? null,
    source_uri: item.source_uri ?? null,
    classifier_id: item.classifier_id ?? null,
    model_version: item.model_version ?? null,
    classifier_corpus_uri: item.classifier_corpus_uri ?? null,
    target_corpus_uri: item.target_corpus_uri ?? null,
    extraction_snapshot: item.extraction_snapshot ?? null,
    topic_candidates: Array.isArray(item.topic_candidates) ? item.topic_candidates.map((candidate) => sanitizeReferenceMetadata(candidate)) : [],
  };
}

function inferSemanticNodeKind(nodeKey, proposalKind) {
  if (String(nodeKey).startsWith("topic:")) return "topic";
  if (String(proposalKind ?? "").includes("assertion")) return "assertion";
  return "entity";
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
  knowledgeCorpusId,
  loadJsonFile,
  loadSteeringBundleFromBiblicus,
  mergeReviewedProposalState,
  writeJsonFile,
};
