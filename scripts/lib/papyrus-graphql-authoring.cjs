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
const PROPOSAL_FIELDS = "id categorySetId corpusId importRunId proposalKind steeringDomain status title summary categoryKey targetCategoryKey graphEntityId relationshipType displayName shortTitle subtitle description evidenceItemIds suggestedSeedItemIds suggestedHoldoutItemIds sourceSnapshotId proposedAt reviewedAt reviewedBy updatedAt";
const DECISION_FIELDS = "id proposalId categorySetId action actorSub actorLabel note selectedCategoryKey createdAt";
const KNOWLEDGE_CORPUS_FIELDS = "id name role itemCount generatedAt latestImportRunId createdAt updatedAt";
const KNOWLEDGE_IMPORT_RUN_FIELDS = "id corpusId importKind classifierId sourceSnapshotId status generatedAt importedAt itemCount categoryCount proposalCount artifactCount referenceCount relationCount warningCount";
const KNOWLEDGE_RAW_PAYLOAD_FIELDS = "id ownerType ownerId payloadKind importRunId payload createdAt updatedAt";
const KNOWLEDGE_ARTIFACT_FIELDS = "id corpusId artifactKind artifactId snapshotId displayName createdAt importRunId";
const ASSIGNMENT_FIELDS = "id assignmentTypeKey queueKey queueStatusKey status priority title brief instructions assigneeType assigneeId assigneeKey claimedAt claimExpiresAt completedAt canceledAt corpusId categorySetId classifierId sourceSnapshotId importRunId createdBy createdAt updatedAt metadata";
const ASSIGNMENT_EVENT_FIELDS = "id assignmentId assignmentTypeKey queueKey eventType fromStatus toStatus actorSub actorLabel note createdAt metadata";
const REFERENCE_FIELDS = `${VERSION_FIELDS} id corpusId externalItemId title authors sourceUri storagePath mediaType byteSize sha256 sourcePublishedAt sourceUpdatedAt retrievedAt importRunId importedAt metadata updatedAt`;
const REFERENCE_ATTACHMENT_FIELDS = "id referenceId referenceLineageId referenceVersionNumber referenceVersionKey role sortKey storagePath sourceUri filename mediaType byteSize sha256 etag importRunId importedAt metadata";
const SEMANTIC_NODE_FIELDS = `${VERSION_FIELDS} id nodeKey nodeKind corpusId categorySetId categoryLineageId categoryKey displayName description aliases status importRunId updatedAt`;
const KNOWLEDGE_COMMENT_FIELDS = "id subjectKind subjectId subjectLineageId subjectVersionNumber subjectVersionKey subjectStateKey commentKind body status source importRunId authorSub authorUserProfileId authorLabel metadata createdAt";
const SEMANTIC_RELATION_FIELDS = "id relationState predicate subjectKind subjectId subjectLineageId subjectVersionNumber objectKind objectId objectLineageId objectVersionNumber subjectStateKey objectStateKey objectSubjectStateKey predicateObjectStateKey subjectVersionKey objectVersionKey score confidence rank classifierId modelVersion reviewRecommended sourceSnapshotId importRunId importedAt metadata";

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
  Assignment: listDefinition("listAssignments", ASSIGNMENT_FIELDS),
  AssignmentEvent: listDefinition("listAssignmentEvents", ASSIGNMENT_EVENT_FIELDS),
  CategorySet: listDefinition("listCategorySets", CATEGORY_SET_FIELDS),
  Category: listDefinition("listCategories", CATEGORY_FIELDS),
  CategoryKeyword: listDefinition("listCategoryKeywords", CATEGORY_KEYWORD_FIELDS),
  LexicalSteeringRule: listDefinition("listLexicalSteeringRules", LEXICAL_STEERING_RULE_FIELDS),
  SteeringProposal: listDefinition("listSteeringProposals", PROPOSAL_FIELDS),
  SteeringDecision: listDefinition("listSteeringDecisions", DECISION_FIELDS),
  Reference: listDefinition("listReferences", REFERENCE_FIELDS),
  ReferenceAttachment: listDefinition("listReferenceAttachments", REFERENCE_ATTACHMENT_FIELDS),
  SemanticNode: listDefinition("listSemanticNodes", SEMANTIC_NODE_FIELDS),
  KnowledgeComment: listDefinition("listKnowledgeComments", KNOWLEDGE_COMMENT_FIELDS),
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
  Assignment: getDefinition("getAssignment", ASSIGNMENT_FIELDS),
  AssignmentEvent: getDefinition("getAssignmentEvent", ASSIGNMENT_EVENT_FIELDS),
  CategorySet: getDefinition("getCategorySet", CATEGORY_SET_FIELDS),
  Category: getDefinition("getCategory", CATEGORY_FIELDS),
  CategoryKeyword: getDefinition("getCategoryKeyword", CATEGORY_KEYWORD_FIELDS),
  LexicalSteeringRule: getDefinition("getLexicalSteeringRule", LEXICAL_STEERING_RULE_FIELDS),
  SteeringProposal: getDefinition("getSteeringProposal", PROPOSAL_FIELDS),
  SteeringDecision: getDefinition("getSteeringDecision", DECISION_FIELDS),
  Reference: getDefinition("getReference", REFERENCE_FIELDS),
  ReferenceAttachment: getDefinition("getReferenceAttachment", REFERENCE_ATTACHMENT_FIELDS),
  SemanticNode: getDefinition("getSemanticNode", SEMANTIC_NODE_FIELDS),
  KnowledgeComment: getDefinition("getKnowledgeComment", KNOWLEDGE_COMMENT_FIELDS),
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

  async getRecord(modelName, id) {
    const definition = GETTERS[modelName];
    if (!definition) throw new Error(`Unsupported model for get: ${modelName}`);
    const result = await this.graphql(definition.query, { id });
    return result[definition.field] ?? null;
  }

  async upsert(modelName, input) {
    const current = await this.getRecord(modelName, input.id);
    const mutation = current ? MUTATIONS[modelName].update : MUTATIONS[modelName].create;
    await this.graphql(mutation, { input });
    return current ? "updated" : "created";
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

function toLambdaAuthToken(token) {
  return `PapyrusJwt ${token.replace(/^Bearer\s+/i, "").trim()}`;
}

module.exports = {
  PapyrusGraphQLAuthoringClient,
};
