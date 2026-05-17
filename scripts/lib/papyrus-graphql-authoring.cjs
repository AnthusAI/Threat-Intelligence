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
const CATEGORY_FIELDS = `${VERSION_FIELDS} id categorySetId corpusId categoryKey parentCategoryId parentCategoryKey displayName subtitle description aliases status seedItemIds holdoutItemIds rank depth isPinned importRunId updatedAt`;
const PROPOSAL_FIELDS = "id categorySetId corpusId importRunId proposalKind steeringDomain status title summary categoryKey targetCategoryKey graphEntityId relationshipType displayName subtitle description evidenceItemIds suggestedSeedItemIds suggestedHoldoutItemIds sourceSnapshotId proposedAt reviewedAt reviewedBy updatedAt";
const DECISION_FIELDS = "id proposalId categorySetId action actorSub actorLabel note selectedCategoryKey createdAt";

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
  PublishedCategory: listDefinition("listPublishedCategories", "id sourceCategoryId publishedCategorySetId categoryLineageId categorySetLineageId versionNumber corpusId categoryKey parentCategoryId parentCategoryKey displayName subtitle description aliases status seedItemIds holdoutItemIds rank depth isPinned metadata"),
  CategoryCorpus: listDefinition("listCategoryCorpuses", "id name role itemCount generatedAt latestImportRunId createdAt updatedAt"),
  CategoryImportRun: listDefinition("listCategoryImportRuns", "id corpusId importKind classifierId status importedAt itemCount categoryCount proposalCount artifactCount projectionCount warningCount"),
  CategoryRawPayload: listDefinition("listCategoryRawPayloads", "id ownerType ownerId payloadKind importRunId"),
  CategoryArtifact: listDefinition("listCategoryArtifacts", "id corpusId artifactKind artifactId snapshotId displayName createdAt importRunId"),
  CategorySet: listDefinition("listCategorySets", CATEGORY_SET_FIELDS),
  Category: listDefinition("listCategories", CATEGORY_FIELDS),
  CategoryProposal: listDefinition("listCategoryProposals", PROPOSAL_FIELDS),
  CategoryDecision: listDefinition("listCategoryDecisions", DECISION_FIELDS),
  CategoryProjection: listDefinition("listCategoryProjections", "id targetCorpusId authorityCorpusId classifierId modelVersion externalItemId categoryKey displayName score reviewRecommended importedAt importRunId"),
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
  PublishedCategory: getDefinition("getPublishedCategory", "id sourceCategoryId publishedCategorySetId categoryLineageId categorySetLineageId versionNumber corpusId categoryKey parentCategoryId parentCategoryKey displayName subtitle description aliases status seedItemIds holdoutItemIds rank depth isPinned metadata"),
  CategoryCorpus: getDefinition("getCategoryCorpus", "id name role itemCount generatedAt latestImportRunId createdAt updatedAt"),
  CategoryImportRun: getDefinition("getCategoryImportRun", "id corpusId importKind classifierId sourceSnapshotId status generatedAt importedAt itemCount categoryCount proposalCount artifactCount projectionCount warningCount"),
  CategoryRawPayload: getDefinition("getCategoryRawPayload", "id ownerType ownerId payloadKind importRunId payload createdAt updatedAt"),
  CategoryArtifact: getDefinition("getCategoryArtifact", "id corpusId artifactKind artifactId snapshotId displayName createdAt importRunId"),
  CategorySet: getDefinition("getCategorySet", CATEGORY_SET_FIELDS),
  Category: getDefinition("getCategory", CATEGORY_FIELDS),
  CategoryProposal: getDefinition("getCategoryProposal", PROPOSAL_FIELDS),
  CategoryDecision: getDefinition("getCategoryDecision", DECISION_FIELDS),
  CategoryProjection: getDefinition("getCategoryProjection", "id targetCorpusId authorityCorpusId classifierId modelVersion externalItemId categoryKey displayName score reviewRecommended importedAt importRunId"),
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
