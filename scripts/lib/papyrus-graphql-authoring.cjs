const LIST_EDITIONS_QUERY = `
  query ListPublishedEditionsByStatusAndEditionDate($status: String!, $limit: Int, $nextToken: String) {
    listPublishedEditionsByStatusAndEditionDate(status: $status, limit: $limit, nextToken: $nextToken) {
      items { id slug title editionDate publishedAt description }
      nextToken
    }
  }
`;

const LIST_ARTICLES_QUERY = `
  query ListPublishedItemsByTypeStatusAndPublishedAt($typeStatus: String!, $limit: Int, $nextToken: String) {
    listPublishedItemsByTypeStatusAndPublishedAt(typeStatus: $typeStatus, limit: $limit, nextToken: $nextToken) {
      items { id slug shortSlug headline title publishedAt }
      nextToken
    }
  }
`;

const UPDATE_NEWSROOM_SUMMARY_MUTATION = `
  mutation UpdateNewsroomSummary($delta: AWSJSON!, $actorLabel: String, $reason: String) {
    updateNewsroomSummary(delta: $delta, actorLabel: $actorLabel, reason: $reason) {
      generatedAt
      staleAt
      source
      counts
      facets
      assignmentStatusCounts
      assignmentTypeCounts
      referenceStatusCounts
      messageKindCounts
      messageDomainCounts
    }
  }
`;

const MODEL_ATTACHMENT_UPLOAD_FIELDS = `
  ok
  uploadId
  attachmentId
  ownerKind
  ownerId
  role
  sortKey
  method
  uploadUrl
  storagePath
  mediaType
  byteSize
  sha256
  expiresAt
  requiredHeaders
`;

const CREATE_MODEL_ATTACHMENT_UPLOAD_MUTATION = `
  mutation CreateModelAttachmentUpload(
    $ownerKind: String!
    $ownerId: ID!
    $ownerLineageId: ID
    $ownerVersionNumber: Int
    $ownerVersionKey: String
    $role: String!
    $sortKey: String
    $filename: String!
    $mediaType: String!
    $byteSize: Int!
    $sha256: String
    $importRunId: ID
    $status: String
  ) {
    createModelAttachmentUpload(
      ownerKind: $ownerKind
      ownerId: $ownerId
      ownerLineageId: $ownerLineageId
      ownerVersionNumber: $ownerVersionNumber
      ownerVersionKey: $ownerVersionKey
      role: $role
      sortKey: $sortKey
      filename: $filename
      mediaType: $mediaType
      byteSize: $byteSize
      sha256: $sha256
      importRunId: $importRunId
      status: $status
    ) {
      ${MODEL_ATTACHMENT_UPLOAD_FIELDS}
    }
  }
`;

const COMPLETE_MODEL_ATTACHMENT_UPLOAD_MUTATION = `
  mutation CompleteModelAttachmentUpload(
    $uploadId: String!
    $ownerKind: String!
    $ownerId: ID!
    $ownerLineageId: ID
    $ownerVersionNumber: Int
    $ownerVersionKey: String
    $role: String!
    $sortKey: String
    $filename: String!
    $mediaType: String!
    $byteSize: Int!
    $sha256: String
    $importRunId: ID
    $status: String
  ) {
    completeModelAttachmentUpload(
      uploadId: $uploadId
      ownerKind: $ownerKind
      ownerId: $ownerId
      ownerLineageId: $ownerLineageId
      ownerVersionNumber: $ownerVersionNumber
      ownerVersionKey: $ownerVersionKey
      role: $role
      sortKey: $sortKey
      filename: $filename
      mediaType: $mediaType
      byteSize: $byteSize
      sha256: $sha256
      importRunId: $importRunId
      status: $status
    ) {
      id ownerKind ownerId ownerLineageId ownerVersionNumber ownerVersionKey role sortKey storagePath filename mediaType byteSize sha256 etag importRunId createdAt updatedAt status
    }
  }
`;

const CREATE_MODEL_ATTACHMENT_DOWNLOAD_MUTATION = `
  mutation CreateModelAttachmentDownload($attachmentId: ID!) {
    createModelAttachmentDownload(attachmentId: $attachmentId) {
      ok
      attachmentId
      method
      downloadUrl
      storagePath
      mediaType
      byteSize
      sha256
      expiresAt
      requiredHeaders
    }
  }
`;

const VERSION_FIELDS = "lineageId versionNumber previousVersionId versionState versionCreatedAt versionCreatedBy changeReason contentHash";
const ITEM_FIELDS = `${VERSION_FIELDS} id type status typeStatus slug shortSlug section sectionStatus title headline deck body byline dateline publishedAt editionDate sortTitle pullQuotes layout editorial updatedAt`;
const PUBLISHED_ITEM_FIELDS = "id sourceItemId itemLineageId versionNumber type status typeStatus slug shortSlug section sectionStatus title headline deck body byline dateline publishedAt editionDate sortTitle pullQuotes layout editorial";
const MEDIA_FIELDS = "id itemId type role sortKey storagePath externalUrl alt caption credit width height aspectRatio focalX focalY minHeight preferredHeight maxHeight crop wrapsText metadata";
const PUBLISHED_MEDIA_FIELDS = "id sourceMediaAssetId publishedItemId sourceItemId itemLineageId type role sortKey storagePath externalUrl alt caption credit width height aspectRatio focalX focalY minHeight preferredHeight maxHeight crop wrapsText metadata";
const EDITION_FIELDS = `${VERSION_FIELDS} id slug title status editionDate publishedAt description layoutPlan metadata`;
const PUBLISHED_EDITION_FIELDS = "id sourceEditionId editionLineageId versionNumber slug title status editionDate publishedAt description layoutPlan metadata";
const EDITION_ITEM_FIELDS = "id editionId editionLineageId itemId itemLineageId placementKey sortKey pageNumber priority metadata";
const PUBLISHED_EDITION_ITEM_FIELDS = "id publishedEditionId publishedItemId sourceEditionItemId sourceEditionId sourceItemId editionLineageId itemLineageId placementKey sortKey pageNumber priority metadata";
const CATEGORY_SET_FIELDS = `${VERSION_FIELDS} id corpusId classifierId displayName description status generatedAt categoryCount importRunId`;
const CATEGORY_FIELDS = `${VERSION_FIELDS} id categorySetId corpusId categoryKey parentCategoryId parentCategoryKey displayName shortTitle subtitle description aliases status seedItemIds holdoutItemIds rank depth isPinned importRunId updatedAt`;
const CATEGORY_KEYWORD_FIELDS = "id categorySetId corpusId categoryKey categoryLineageId categoryId keyword normalizedKeyword weight rank source sourceTopicId importRunId metadata createdAt updatedAt";
const LEXICAL_STEERING_RULE_FIELDS = "id ruleKind term normalizedTerm scope status corpusId classifierId categorySetId categoryKey note source createdBy createdAt updatedAt metadata";
const NEWSROOM_SECTION_FIELDS = "id title shortTitle type editorialMission editorialPolicy enabled enabledStatus sortOrder defaultArticleTypes defaultPageBudget assignmentGuidance killCriteria visualGuidance createdAt updatedAt";
const PROPOSAL_FIELDS = "id categorySetId corpusId importRunId proposalKind steeringDomain status title summary categoryKey targetCategoryKey graphEntityId relationshipType displayName shortTitle subtitle description evidenceItemIds suggestedSeedItemIds suggestedHoldoutItemIds sourceSnapshotId proposedAt reviewedAt reviewedBy updatedAt";
const DECISION_FIELDS = "id proposalId categorySetId action actorSub actorLabel note selectedCategoryKey createdAt";
const KNOWLEDGE_CORPUS_FIELDS = "id name role itemCount generatedAt latestImportRunId createdAt updatedAt";
const KNOWLEDGE_IMPORT_RUN_FIELDS = "id corpusId importKind corpusImportKindKey classifierId sourceSnapshotId status generatedAt importedAt itemCount categoryCount proposalCount artifactCount referenceCount relationCount warningCount";
const KNOWLEDGE_RAW_PAYLOAD_FIELDS = "id ownerType ownerId payloadKind importRunId createdAt updatedAt";
const KNOWLEDGE_ARTIFACT_FIELDS = "id corpusId artifactKind artifactId snapshotId displayName createdAt importRunId";
const MODEL_ATTACHMENT_FIELDS = "id ownerKind ownerId ownerLineageId ownerVersionNumber ownerVersionKey role sortKey storagePath filename mediaType byteSize sha256 etag importRunId createdAt updatedAt status";
const ASSIGNMENT_FIELDS = [
  "id",
  "assignmentTypeKey",
  "queueKey",
  "queueStatusKey",
  "status",
  "priority",
  "title",
  "assigneeType",
  "assigneeId",
  "assigneeKey",
  "claimedAt",
  "claimExpiresAt",
  "completedAt",
  "canceledAt",
  "corpusId",
  "categorySetId",
  "classifierId",
  "sourceSnapshotId",
  "importRunId",
  "sectionId",
  "sectionKey",
  "sectionType",
  "sectionStatusKey",
  "sectionQueueStatusKey",
  "primaryFocusCategoryKey",
  "topicScopeCategoryKeys",
  "createdBy",
  "createdAt",
  "updatedAt",
].join(" ");
const ASSIGNMENT_EVENT_FIELDS = "id assignmentId assignmentTypeKey queueKey eventType fromStatus toStatus actorSub actorLabel note createdAt";
const REFERENCE_FIELDS = `${VERSION_FIELDS} id corpusId externalItemId title authors sourceUri storagePath mediaType byteSize sha256 sourcePublishedAt sourceUpdatedAt retrievedAt importRunId importedAt createdAt curationStatus curationStatusKey curationStatusUpdatedAt curationStatusUpdatedBy curationStatusReason newsroomFeedKey updatedAt`;
const REFERENCE_ATTACHMENT_FIELDS = "id referenceId referenceLineageId referenceVersionNumber referenceVersionKey role sortKey storagePath sourceUri filename mediaType byteSize sha256 etag importRunId importedAt metadata";
const SEMANTIC_NODE_FIELDS = `${VERSION_FIELDS} id nodeKey nodeKind corpusId categorySetId categoryLineageId categoryKey displayName description aliases status importRunId createdAt updatedAt newsroomFeedKey`;
const MESSAGE_FIELDS = "id messageKind messageDomain status summary source importRunId authorSub authorUserProfileId authorLabel newsroomFeedKey createdAt updatedAt";
const SEMANTIC_RELATION_TYPE_FIELDS = "id key label inverseLabel description domain status allowedSubjectKinds allowedObjectKinds isDirectional isSymmetric isTransitive contextPackTags createdAt updatedAt metadata";
const SEMANTIC_RELATION_FIELDS = "id relationState predicate relationTypeId relationTypeKey relationDomain subjectKind subjectId subjectLineageId subjectVersionNumber objectKind objectId objectLineageId objectVersionNumber subjectStateKey objectStateKey objectSubjectStateKey predicateObjectStateKey subjectVersionKey objectVersionKey score confidence rank classifierId modelVersion reviewRecommended sourceSnapshotId importRunId importedAt createdAt updatedAt newsroomFeedKey metadata";

const LIST_RECORDS = {
  Edition: listDefinition("listEditions", EDITION_FIELDS),
  EditionItem: listDefinition("listEditionItems", EDITION_ITEM_FIELDS),
  Item: listDefinition("listItems", ITEM_FIELDS),
  ItemTag: listDefinition("listItemTags", "id itemId tagId itemType itemStatus tagSlug publishedAt"),
  MediaAsset: listDefinition("listMediaAssets", MEDIA_FIELDS),
  Tag: listDefinition("listTags", "id slug label type description"),
  PublishedEdition: listDefinition("listPublishedEditions", PUBLISHED_EDITION_FIELDS),
  PublishedEditionItem: listDefinition("listPublishedEditionItems", PUBLISHED_EDITION_ITEM_FIELDS),
  PublishedItem: listDefinition("listPublishedItems", PUBLISHED_ITEM_FIELDS),
  PublishedMediaAsset: listDefinition("listPublishedMediaAssets", PUBLISHED_MEDIA_FIELDS),
  PublishedCategorySet: listDefinition("listPublishedCategorySets", "id sourceCategorySetId categorySetLineageId versionNumber corpusId classifierId displayName description status generatedAt publishedAt categoryCount metadata"),
  PublishedCategory: listDefinition("listPublishedCategories", "id sourceCategoryId publishedCategorySetId categoryLineageId categorySetLineageId versionNumber corpusId categoryKey parentCategoryId parentCategoryKey displayName shortTitle subtitle description aliases status seedItemIds holdoutItemIds rank depth isPinned metadata"),
  KnowledgeCorpus: listDefinition("listKnowledgeCorpuses", KNOWLEDGE_CORPUS_FIELDS),
  KnowledgeImportRun: listDefinition("listKnowledgeImportRuns", KNOWLEDGE_IMPORT_RUN_FIELDS),
  KnowledgeRawPayload: listDefinition("listKnowledgeRawPayloads", "id ownerType ownerId payloadKind importRunId"),
  KnowledgeArtifact: listDefinition("listKnowledgeArtifacts", KNOWLEDGE_ARTIFACT_FIELDS),
  ModelAttachment: listDefinition("listModelAttachments", MODEL_ATTACHMENT_FIELDS),
  Assignment: listDefinition("listAssignments", ASSIGNMENT_FIELDS),
  AssignmentEvent: listDefinition("listAssignmentEvents", ASSIGNMENT_EVENT_FIELDS),
  CategorySet: listDefinition("listCategorySets", CATEGORY_SET_FIELDS),
  Category: listDefinition("listCategories", CATEGORY_FIELDS),
  CategoryKeyword: listDefinition("listCategoryKeywords", CATEGORY_KEYWORD_FIELDS),
  LexicalSteeringRule: listDefinition("listLexicalSteeringRules", LEXICAL_STEERING_RULE_FIELDS),
  NewsroomSection: listDefinition("listNewsroomSections", NEWSROOM_SECTION_FIELDS),
  SteeringProposal: listDefinition("listSteeringProposals", PROPOSAL_FIELDS),
  SteeringDecision: listDefinition("listSteeringDecisions", DECISION_FIELDS),
  Reference: listDefinition("listReferences", REFERENCE_FIELDS),
  ReferenceAttachment: listDefinition("listReferenceAttachments", REFERENCE_ATTACHMENT_FIELDS),
  SemanticNode: listDefinition("listSemanticNodes", SEMANTIC_NODE_FIELDS),
  Message: listDefinition("listMessages", MESSAGE_FIELDS),
  SemanticRelationType: listDefinition("listSemanticRelationTypes", SEMANTIC_RELATION_TYPE_FIELDS),
  SemanticRelation: listDefinition("listSemanticRelations", SEMANTIC_RELATION_FIELDS),
};

const GETTERS = {
  Edition: getDefinition("getEdition", EDITION_FIELDS),
  EditionItem: getDefinition("getEditionItem", EDITION_ITEM_FIELDS),
  Item: getDefinition("getItem", ITEM_FIELDS),
  ItemTag: getDefinition("getItemTag", "id itemId tagId itemType itemStatus tagSlug publishedAt"),
  MediaAsset: getDefinition("getMediaAsset", MEDIA_FIELDS),
  Tag: getDefinition("getTag", "id slug label type description"),
  PublishedEdition: getDefinition("getPublishedEdition", PUBLISHED_EDITION_FIELDS),
  PublishedEditionItem: getDefinition("getPublishedEditionItem", PUBLISHED_EDITION_ITEM_FIELDS),
  PublishedItem: getDefinition("getPublishedItem", PUBLISHED_ITEM_FIELDS),
  PublishedMediaAsset: getDefinition("getPublishedMediaAsset", PUBLISHED_MEDIA_FIELDS),
  PublishedCategorySet: getDefinition("getPublishedCategorySet", "id sourceCategorySetId categorySetLineageId versionNumber corpusId classifierId displayName description status generatedAt publishedAt categoryCount metadata"),
  PublishedCategory: getDefinition("getPublishedCategory", "id sourceCategoryId publishedCategorySetId categoryLineageId categorySetLineageId versionNumber corpusId categoryKey parentCategoryId parentCategoryKey displayName shortTitle subtitle description aliases status seedItemIds holdoutItemIds rank depth isPinned metadata"),
  KnowledgeCorpus: getDefinition("getKnowledgeCorpus", KNOWLEDGE_CORPUS_FIELDS),
  KnowledgeImportRun: getDefinition("getKnowledgeImportRun", KNOWLEDGE_IMPORT_RUN_FIELDS),
  KnowledgeRawPayload: getDefinition("getKnowledgeRawPayload", KNOWLEDGE_RAW_PAYLOAD_FIELDS),
  KnowledgeArtifact: getDefinition("getKnowledgeArtifact", KNOWLEDGE_ARTIFACT_FIELDS),
  ModelAttachment: getDefinition("getModelAttachment", MODEL_ATTACHMENT_FIELDS),
  Assignment: getDefinition("getAssignment", ASSIGNMENT_FIELDS),
  AssignmentEvent: getDefinition("getAssignmentEvent", ASSIGNMENT_EVENT_FIELDS),
  CategorySet: getDefinition("getCategorySet", CATEGORY_SET_FIELDS),
  Category: getDefinition("getCategory", CATEGORY_FIELDS),
  CategoryKeyword: getDefinition("getCategoryKeyword", CATEGORY_KEYWORD_FIELDS),
  LexicalSteeringRule: getDefinition("getLexicalSteeringRule", LEXICAL_STEERING_RULE_FIELDS),
  NewsroomSection: getDefinition("getNewsroomSection", NEWSROOM_SECTION_FIELDS),
  SteeringProposal: getDefinition("getSteeringProposal", PROPOSAL_FIELDS),
  SteeringDecision: getDefinition("getSteeringDecision", DECISION_FIELDS),
  Reference: getDefinition("getReference", REFERENCE_FIELDS),
  ReferenceAttachment: getDefinition("getReferenceAttachment", REFERENCE_ATTACHMENT_FIELDS),
  SemanticNode: getDefinition("getSemanticNode", SEMANTIC_NODE_FIELDS),
  Message: getDefinition("getMessage", MESSAGE_FIELDS),
  SemanticRelationType: getDefinition("getSemanticRelationType", SEMANTIC_RELATION_TYPE_FIELDS),
  SemanticRelation: getDefinition("getSemanticRelation", SEMANTIC_RELATION_FIELDS),
};

const MUTATIONS = Object.fromEntries(Object.keys(GETTERS).map((modelName) => [modelName, modelMutations(modelName)]));

function listDefinition(field, fields) {
  const modelName = field.replace(/^list/, "").replace(/s$/, "");
  return {
    field,
    query: `
      query ${field[0].toUpperCase()}${field.slice(1)}($limit: Int, $nextToken: String) {
        ${field}(limit: $limit, nextToken: $nextToken) {
          items { ${fields} }
          nextToken
        }
      }
    `,
    modelName,
  };
}

function getDefinition(field, fields) {
  return {
    field,
    query: `
      query ${field[0].toUpperCase()}${field.slice(1)}($id: ID!) {
        ${field}(id: $id) { ${fields} }
      }
    `,
  };
}

function indexDefinition(field, partitionKey, fields, partitionType = "String") {
  return {
    field,
    partitionKey,
    query: `
      query ${field[0].toUpperCase()}${field.slice(1)}($${partitionKey}: ${partitionType}!, $limit: Int, $nextToken: String) {
        ${field}(${partitionKey}: $${partitionKey}, limit: $limit, nextToken: $nextToken) {
          items { ${fields} }
          nextToken
        }
      }
    `,
  };
}

const INDEX_QUERIES = {
  assignmentsByQueueStatusAndPriority: indexDefinition("listAssignmentsByQueueStatusAndPriority", "queueStatusKey", ASSIGNMENT_FIELDS),
  assignmentsByTypeStatusAndCreatedAt: indexDefinition("listAssignmentsByTypeStatusAndCreatedAt", "assignmentTypeKey", ASSIGNMENT_FIELDS),
  assignmentsBySectionQueueStatusAndPriority: indexDefinition("listAssignmentsBySectionQueueStatusAndPriority", "sectionQueueStatusKey", ASSIGNMENT_FIELDS),
  assignmentEventsByAssignmentAndCreatedAt: indexDefinition("listAssignmentEventsByAssignmentAndCreatedAt", "assignmentId", ASSIGNMENT_EVENT_FIELDS, "ID"),
  knowledgeImportRunsByCorpusKindAndImportedAt: indexDefinition("listKnowledgeImportRunsByCorpusKindAndImportedAt", "corpusImportKindKey", KNOWLEDGE_IMPORT_RUN_FIELDS),
  knowledgeImportRunsByKindAndImportedAt: indexDefinition("listKnowledgeImportRunsByKindAndImportedAt", "importKind", KNOWLEDGE_IMPORT_RUN_FIELDS),
  knowledgeArtifactsByImportRunAndKind: indexDefinition("listKnowledgeArtifactsByImportRunAndKind", "importRunId", KNOWLEDGE_ARTIFACT_FIELDS, "ID"),
  semanticNodesByImportRunAndNodeKey: indexDefinition("listSemanticNodesByImportRunAndNodeKey", "importRunId", SEMANTIC_NODE_FIELDS, "ID"),
  semanticRelationsByImportRunAndImportedAt: indexDefinition("listSemanticRelationsByImportRunAndImportedAt", "importRunId", SEMANTIC_RELATION_FIELDS, "ID"),
  semanticRelationsByObjectState: indexDefinition("listSemanticRelationsByObjectState", "objectStateKey", SEMANTIC_RELATION_FIELDS),
  semanticRelationsBySubjectState: indexDefinition("listSemanticRelationsBySubjectState", "subjectStateKey", SEMANTIC_RELATION_FIELDS),
};

function modelMutations(modelName) {
  return {
    create: `
      mutation Create${modelName}($input: Create${modelName}Input!) {
        create${modelName}(input: $input) { id }
      }
    `,
    update: `
      mutation Update${modelName}($input: Update${modelName}Input!) {
        update${modelName}(input: $input) { id }
      }
    `,
    delete: `
      mutation Delete${modelName}($input: Delete${modelName}Input!) {
        delete${modelName}(input: $input) { id }
      }
    `,
  };
}

class PapyrusGraphQLAuthoringClient {
  constructor({ endpoint, authToken }) {
    this.endpoint = endpoint;
    this.authToken = authToken;
  }

  async inspectReachability() {
    return this.graphql(LIST_EDITIONS_QUERY, { status: "published", limit: 1 });
  }

  async listPublishedArticles() {
    const items = [];
    let nextToken = null;

    do {
      const result = await this.graphql(LIST_ARTICLES_QUERY, {
        typeStatus: "article#published",
        limit: 100,
        nextToken,
      });
      const connection = result.listPublishedItemsByTypeStatusAndPublishedAt;
      items.push(...(connection?.items ?? []));
      nextToken = connection?.nextToken ?? null;
    } while (nextToken);

    return items;
  }

  async listRecords(modelName) {
    const definition = LIST_RECORDS[modelName];
    if (!definition) throw new Error(`Unsupported model for listing: ${modelName}`);
    return this.listRecordsWithDefinition(definition);
  }

  async listRecordsWithDefinition(definition) {
    const items = [];
    let nextToken = null;

    do {
      const result = await this.graphql(definition.query, {
        limit: 100,
        nextToken,
      });
      const connection = result[definition.field];
      items.push(...(connection?.items ?? []).filter(Boolean));
      nextToken = connection?.nextToken ?? null;
    } while (nextToken);

    return items;
  }

  async listByIndex(indexName, keyValue, options = {}) {
    const definition = INDEX_QUERIES[indexName];
    if (!definition) throw new Error(`Unsupported index query: ${indexName}`);
    const items = [];
    let nextToken = null;
    const limit = options.limit ?? 100;

    do {
      const result = await this.graphql(definition.query, {
        [definition.partitionKey]: keyValue,
        limit,
        nextToken,
      });
      const connection = result[definition.field];
      items.push(...(connection?.items ?? []).filter(Boolean));
      nextToken = connection?.nextToken ?? null;
    } while (nextToken);

    return items;
  }

  async listAssignmentsByQueueStatusAndPriority(queueStatusKey) {
    return this.listByIndex("assignmentsByQueueStatusAndPriority", queueStatusKey);
  }

  async listAssignmentsByTypeStatusAndCreatedAt(assignmentTypeKey) {
    return this.listByIndex("assignmentsByTypeStatusAndCreatedAt", assignmentTypeKey);
  }

  async listAssignmentsBySectionQueueStatusAndPriority(sectionQueueStatusKey) {
    return this.listByIndex("assignmentsBySectionQueueStatusAndPriority", sectionQueueStatusKey);
  }

  async listAssignmentEventsByAssignmentAndCreatedAt(assignmentId) {
    return this.listByIndex("assignmentEventsByAssignmentAndCreatedAt", assignmentId);
  }

  async listKnowledgeImportRunsByCorpusKindAndImportedAt(corpusImportKindKey) {
    return this.listByIndex("knowledgeImportRunsByCorpusKindAndImportedAt", corpusImportKindKey);
  }

  async listKnowledgeImportRunsByKindAndImportedAt(importKind) {
    return this.listByIndex("knowledgeImportRunsByKindAndImportedAt", importKind);
  }

  async listKnowledgeArtifactsByImportRunAndKind(importRunId) {
    return this.listByIndex("knowledgeArtifactsByImportRunAndKind", importRunId);
  }

  async listSemanticNodesByImportRunAndNodeKey(importRunId) {
    return this.listByIndex("semanticNodesByImportRunAndNodeKey", importRunId);
  }

  async listSemanticRelationsByImportRunAndImportedAt(importRunId) {
    return this.listByIndex("semanticRelationsByImportRunAndImportedAt", importRunId);
  }

  async listSemanticRelationsByObjectState(objectStateKey) {
    return this.listByIndex("semanticRelationsByObjectState", objectStateKey);
  }

  async listSemanticRelationsBySubjectState(subjectStateKey) {
    return this.listByIndex("semanticRelationsBySubjectState", subjectStateKey);
  }

  async getRecord(modelName, id) {
    const definition = GETTERS[modelName];
    if (!definition) throw new Error(`Unsupported model for get: ${modelName}`);
    return this.getRecordWithDefinition(definition, id);
  }

  async getRecordWithDefinition(definition, id) {
    const result = await this.graphql(definition.query, { id });
    return result[definition.field] ?? null;
  }

  async getRecordsById(modelName, ids, options = {}) {
    const uniqueIds = Array.from(new Set((ids ?? []).filter(Boolean)));
    const concurrency = Math.max(1, Math.min(Number(options.concurrency ?? 20) || 20, 50));
    const results = new Map();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, uniqueIds.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= uniqueIds.length) return;
        const id = uniqueIds[index];
        results.set(id, await this.getRecord(modelName, id));
      }
    });
    await Promise.all(workers);
    return results;
  }

  async updateNewsroomSummary(delta, options = {}) {
    const result = await this.graphql(UPDATE_NEWSROOM_SUMMARY_MUTATION, {
      delta: JSON.stringify(delta),
      actorLabel: options.actorLabel ?? null,
      reason: options.reason ?? null,
    });
    return result.updateNewsroomSummary;
  }

  async createModelAttachmentUpload(attachment) {
    const result = await this.graphql(CREATE_MODEL_ATTACHMENT_UPLOAD_MUTATION, modelAttachmentUploadVariables(attachment));
    return normalizeModelAttachmentUploadSlot(result.createModelAttachmentUpload);
  }

  async completeModelAttachmentUpload(uploadId, attachment) {
    const result = await this.graphql(COMPLETE_MODEL_ATTACHMENT_UPLOAD_MUTATION, {
      uploadId,
      ...modelAttachmentUploadVariables(attachment),
    });
    return result.completeModelAttachmentUpload;
  }

  async createModelAttachmentDownload(attachmentId) {
    const result = await this.graphql(CREATE_MODEL_ATTACHMENT_DOWNLOAD_MUTATION, { attachmentId });
    return normalizeModelAttachmentDownloadSlot(result.createModelAttachmentDownload);
  }

  async upsert(modelName, input) {
    const preparedInput = stripUnsupportedPayloadFields(modelName, addOperationalIndexFields(modelName, input));
    const current = await this.getRecord(modelName, preparedInput.id);
    const mutation = current ? MUTATIONS[modelName].update : MUTATIONS[modelName].create;
    await this.graphql(mutation, { input: preparedInput });
    return current ? "updated" : "created";
  }

  async putById(modelName, input) {
    const mutations = MUTATIONS[modelName];
    if (!mutations) throw new Error(`Unsupported model for put: ${modelName}`);
    const preparedInput = stripUnsupportedPayloadFields(modelName, addOperationalIndexFields(modelName, input));
    try {
      await this.graphql(mutations.update, { input: preparedInput });
      return "update";
    } catch (error) {
      if (!isMissingRecordForUpdateError(error)) throw error;
      await this.graphql(mutations.create, { input: preparedInput });
      return "create";
    }
  }

  async deleteRecord(modelName, id) {
    const mutation = MUTATIONS[modelName]?.delete;
    if (!mutation) throw new Error(`Unsupported model for deletion: ${modelName}`);
    await this.graphql(mutation, { input: { id } });
  }

  async graphql(query, variables) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: toLambdaAuthToken(this.authToken),
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }

    return payload.data;
  }
}

function addOperationalIndexFields(modelName, input) {
  if (!input || typeof input !== "object") return input;
  if (modelName === "Assignment") {
    const status = cleanString(input.status) ?? "open";
    const queueKey = cleanString(input.queueKey);
    const sectionKey = cleanString(input.sectionKey) ?? cleanString(input.sectionId);
    return {
      ...input,
      queueStatusKey: queueKey ? `${queueKey}#${status}` : input.queueStatusKey ?? null,
      sectionStatusKey: sectionKey ? `${sectionKey}#${status}` : null,
      sectionQueueStatusKey: sectionKey && queueKey ? `${sectionKey}#${queueKey}#${status}` : null,
    };
  }
  if (modelName === "KnowledgeImportRun") {
    const corpusId = cleanString(input.corpusId);
    const importKind = cleanString(input.importKind);
    return {
      ...input,
      corpusImportKindKey: corpusId && importKind ? `${corpusId}#${importKind}` : null,
    };
  }
  return input;
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMissingRecordForUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("The conditional request failed")
    || message.includes("ConditionalCheckFailedException")
    || message.includes("not found")
    || message.includes("NotFound");
}

function modelAttachmentUploadVariables(attachment) {
  return {
    ownerKind: attachment.ownerKind,
    ownerId: attachment.ownerId,
    ownerLineageId: attachment.ownerLineageId ?? null,
    ownerVersionNumber: attachment.ownerVersionNumber ?? null,
    ownerVersionKey: attachment.ownerVersionKey ?? null,
    role: attachment.role,
    sortKey: attachment.sortKey ?? null,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    byteSize: attachment.byteSize,
    sha256: attachment.sha256 ?? null,
    importRunId: attachment.importRunId ?? null,
    status: attachment.status ?? null,
  };
}

function normalizeModelAttachmentUploadSlot(slot) {
  if (!slot) return slot;
  return {
    ...slot,
    requiredHeaders: parseGraphqlJson(slot.requiredHeaders),
  };
}

function normalizeModelAttachmentDownloadSlot(slot) {
  if (!slot) return slot;
  return {
    ...slot,
    requiredHeaders: parseGraphqlJson(slot.requiredHeaders),
  };
}

function parseGraphqlJson(value) {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function stripUnsupportedPayloadFields(modelName, input) {
  const preparedInput = { ...input };
  if (modelName === "Message") {
    delete preparedInput.body;
    delete preparedInput.metadata;
  } else if (modelName === "Reference") {
    delete preparedInput.metadata;
  } else if (modelName === "Assignment") {
    delete preparedInput.sectionTypeStatusKey;
    delete preparedInput.brief;
    delete preparedInput.instructions;
    delete preparedInput.metadata;
  } else if (modelName === "AssignmentEvent") {
    delete preparedInput.metadata;
  } else if (modelName === "KnowledgeRawPayload") {
    delete preparedInput.payload;
  }
  return preparedInput;
}

function toLambdaAuthToken(token) {
  return `PapyrusJwt ${token.replace(/^Bearer\s+/i, "").trim()}`;
}

module.exports = {
  PapyrusGraphQLAuthoringClient,
};
