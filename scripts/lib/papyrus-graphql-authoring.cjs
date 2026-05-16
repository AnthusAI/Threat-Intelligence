const LIST_EDITIONS_QUERY = `
  query ListEditionsByStatusAndEditionDate($status: String!, $limit: Int, $nextToken: String) {
    listEditionsByStatusAndEditionDate(status: $status, limit: $limit, nextToken: $nextToken) {
      items {
        id
        slug
        title
        editionDate
        publishedAt
        description
      }
      nextToken
    }
  }
`;

const LIST_ARTICLES_QUERY = `
  query ListItemsByTypeStatusAndPublishedAt($typeStatus: String!, $limit: Int, $nextToken: String) {
    listItemsByTypeStatusAndPublishedAt(typeStatus: $typeStatus, limit: $limit, nextToken: $nextToken) {
      items {
        id
        slug
        shortSlug
        headline
        title
        publishedAt
      }
      nextToken
    }
  }
`;

const LIST_RECORDS = {
  Edition: {
    field: "listEditions",
    query: `
      query ListEditions($limit: Int, $nextToken: String) {
        listEditions(limit: $limit, nextToken: $nextToken) {
          items { id slug title }
          nextToken
        }
      }
    `,
  },
  EditionItem: {
    field: "listEditionItems",
    query: `
      query ListEditionItems($limit: Int, $nextToken: String) {
        listEditionItems(limit: $limit, nextToken: $nextToken) {
          items { id editionId itemId sortKey }
          nextToken
        }
      }
    `,
  },
  Item: {
    field: "listItems",
    query: `
      query ListItems($limit: Int, $nextToken: String) {
        listItems(limit: $limit, nextToken: $nextToken) {
          items { id slug shortSlug type status headline title }
          nextToken
        }
      }
    `,
  },
  ItemTag: {
    field: "listItemTags",
    query: `
      query ListItemTags($limit: Int, $nextToken: String) {
        listItemTags(limit: $limit, nextToken: $nextToken) {
          items { id itemId tagId }
          nextToken
        }
      }
    `,
  },
  MediaAsset: {
    field: "listMediaAssets",
    query: `
      query ListMediaAssets($limit: Int, $nextToken: String) {
        listMediaAssets(limit: $limit, nextToken: $nextToken) {
          items { id itemId type role }
          nextToken
        }
      }
    `,
  },
  Tag: {
    field: "listTags",
    query: `
      query ListTags($limit: Int, $nextToken: String) {
        listTags(limit: $limit, nextToken: $nextToken) {
          items { id slug label type }
          nextToken
        }
      }
    `,
  },
  CurationCorpus: {
    field: "listCurationCorpora",
    query: `
      query ListCurationCorpora($limit: Int, $nextToken: String) {
        listCurationCorpora(limit: $limit, nextToken: $nextToken) {
          items { id name role itemCount generatedAt latestImportRunId }
          nextToken
        }
      }
    `,
  },
  CurationImportRun: {
    field: "listCurationImportRuns",
    query: `
      query ListCurationImportRuns($limit: Int, $nextToken: String) {
        listCurationImportRuns(limit: $limit, nextToken: $nextToken) {
          items { id corpusId importKind classifierId status importedAt itemCount topicCount proposalCount artifactCount projectionCount warningCount }
          nextToken
        }
      }
    `,
  },
  CurationRawPayload: {
    field: "listCurationRawPayloads",
    query: `
      query ListCurationRawPayloads($limit: Int, $nextToken: String) {
        listCurationRawPayloads(limit: $limit, nextToken: $nextToken) {
          items { id ownerType ownerId payloadKind importRunId }
          nextToken
        }
      }
    `,
  },
  CurationItem: {
    field: "listCurationItems",
    query: `
      query ListCurationItems($limit: Int, $nextToken: String) {
        listCurationItems(limit: $limit, nextToken: $nextToken) {
          items { id corpusId externalItemId title mediaType sourceDomain publishedAt intakeStatus tags importRunId }
          nextToken
        }
      }
    `,
  },
  CurationArtifact: {
    field: "listCurationArtifacts",
    query: `
      query ListCurationArtifacts($limit: Int, $nextToken: String) {
        listCurationArtifacts(limit: $limit, nextToken: $nextToken) {
          items { id corpusId artifactKind artifactId snapshotId displayName createdAt importRunId }
          nextToken
        }
      }
    `,
  },
  CurationTopicSet: {
    field: "listCurationTopicSets",
    query: `
      query ListCurationTopicSets($limit: Int, $nextToken: String) {
        listCurationTopicSets(limit: $limit, nextToken: $nextToken) {
          items { id corpusId classifierId displayName description status acceptedRevisionId latestDraftRevisionId generatedAt topicCount importRunId }
          nextToken
        }
      }
    `,
  },
  CurationTopic: {
    field: "listCurationTopics",
    query: `
      query ListCurationTopics($limit: Int, $nextToken: String) {
        listCurationTopics(limit: $limit, nextToken: $nextToken) {
          items { id topicSetId corpusId topicUid displayName subtitle description aliases status seedItemIds holdoutItemIds rank isPinned importRunId updatedAt }
          nextToken
        }
      }
    `,
  },
  CurationTopicRevision: {
    field: "listCurationTopicRevisions",
    query: `
      query ListCurationTopicRevisions($limit: Int, $nextToken: String) {
        listCurationTopicRevisions(limit: $limit, nextToken: $nextToken) {
          items { id topicSetId corpusId revisionKind status contentHash sourceImportRunId sourceDecisionId topicCount createdAt acceptedAt acceptedBy }
          nextToken
        }
      }
    `,
  },
  CurationProposal: {
    field: "listCurationProposals",
    query: `
      query ListCurationProposals($limit: Int, $nextToken: String) {
        listCurationProposals(limit: $limit, nextToken: $nextToken) {
          items { id topicSetId corpusId importRunId proposalKind steeringDomain status title summary topicUid targetTopicUid graphEntityId relationshipType displayName subtitle description evidenceItemIds suggestedSeedItemIds suggestedHoldoutItemIds sourceSnapshotId proposedAt reviewedAt reviewedBy updatedAt }
          nextToken
        }
      }
    `,
  },
  CurationDecision: {
    field: "listCurationDecisions",
    query: `
      query ListCurationDecisions($limit: Int, $nextToken: String) {
        listCurationDecisions(limit: $limit, nextToken: $nextToken) {
          items { id proposalId topicSetId action actorSub actorLabel note selectedTopicUid createdAt }
          nextToken
        }
      }
    `,
  },
  CurationProjection: {
    field: "listCurationProjections",
    query: `
      query ListCurationProjections($limit: Int, $nextToken: String) {
        listCurationProjections(limit: $limit, nextToken: $nextToken) {
          items { id targetCorpusId authorityCorpusId classifierId modelVersion externalItemId topicUid displayName score reviewRecommended importedAt importRunId }
          nextToken
        }
      }
    `,
  },
};

const GETTERS = {
  Edition: {
    field: "getEdition",
    query: `
      query GetEdition($id: ID!) {
        getEdition(id: $id) {
          id
          slug
          title
          status
          editionDate
          publishedAt
          description
          layoutPlan
          metadata
        }
      }
    `,
  },
  Item: {
    field: "getItem",
    query: `
      query GetItem($id: ID!) {
        getItem(id: $id) {
          id
          type
          status
          typeStatus
          slug
          shortSlug
          section
          sectionStatus
          title
          headline
          deck
          body
          byline
          dateline
          publishedAt
          editionDate
          sortTitle
          pullQuotes
          layout
          editorial
        }
      }
    `,
  },
  Tag: {
    field: "getTag",
    query: `
      query GetTag($id: ID!) {
        getTag(id: $id) {
          id
          slug
          label
          type
          description
        }
      }
    `,
  },
  ItemTag: {
    field: "getItemTag",
    query: `
      query GetItemTag($id: ID!) {
        getItemTag(id: $id) {
          id
          itemId
          tagId
          itemType
          itemStatus
          tagSlug
          publishedAt
        }
      }
    `,
  },
  MediaAsset: {
    field: "getMediaAsset",
    query: `
      query GetMediaAsset($id: ID!) {
        getMediaAsset(id: $id) {
          id
          itemId
          type
          role
          sortKey
          storagePath
          externalUrl
          alt
          caption
          credit
          width
          height
          aspectRatio
          focalX
          focalY
          minHeight
          preferredHeight
          maxHeight
          crop
          wrapsText
          metadata
        }
      }
    `,
  },
  EditionItem: {
    field: "getEditionItem",
    query: `
      query GetEditionItem($id: ID!) {
        getEditionItem(id: $id) {
          id
          editionId
          itemId
          placementKey
          sortKey
          pageNumber
          priority
          metadata
        }
      }
    `,
  },
  CurationCorpus: {
    field: "getCurationCorpus",
    query: `query GetCurationCorpus($id: ID!) { getCurationCorpus(id: $id) { id name role itemCount generatedAt latestImportRunId createdAt updatedAt } }`,
  },
  CurationImportRun: {
    field: "getCurationImportRun",
    query: `query GetCurationImportRun($id: ID!) { getCurationImportRun(id: $id) { id corpusId importKind classifierId sourceSnapshotId status generatedAt importedAt itemCount topicCount proposalCount artifactCount projectionCount warningCount } }`,
  },
  CurationRawPayload: {
    field: "getCurationRawPayload",
    query: `query GetCurationRawPayload($id: ID!) { getCurationRawPayload(id: $id) { id ownerType ownerId payloadKind importRunId payload createdAt updatedAt } }`,
  },
  CurationItem: {
    field: "getCurationItem",
    query: `query GetCurationItem($id: ID!) { getCurationItem(id: $id) { id corpusId externalItemId title mediaType sourceDomain publishedAt intakeStatus tags createdAt importRunId } }`,
  },
  CurationArtifact: {
    field: "getCurationArtifact",
    query: `query GetCurationArtifact($id: ID!) { getCurationArtifact(id: $id) { id corpusId artifactKind artifactId snapshotId displayName createdAt importRunId } }`,
  },
  CurationTopicSet: {
    field: "getCurationTopicSet",
    query: `query GetCurationTopicSet($id: ID!) { getCurationTopicSet(id: $id) { id corpusId classifierId displayName description status acceptedRevisionId latestDraftRevisionId generatedAt topicCount importRunId } }`,
  },
  CurationTopic: {
    field: "getCurationTopic",
    query: `query GetCurationTopic($id: ID!) { getCurationTopic(id: $id) { id topicSetId corpusId topicUid displayName subtitle description aliases status seedItemIds holdoutItemIds rank isPinned importRunId updatedAt } }`,
  },
  CurationTopicRevision: {
    field: "getCurationTopicRevision",
    query: `query GetCurationTopicRevision($id: ID!) { getCurationTopicRevision(id: $id) { id topicSetId corpusId revisionKind status contentHash sourceImportRunId sourceDecisionId topicCount createdAt acceptedAt acceptedBy } }`,
  },
  CurationProposal: {
    field: "getCurationProposal",
    query: `query GetCurationProposal($id: ID!) { getCurationProposal(id: $id) { id topicSetId corpusId importRunId proposalKind steeringDomain status title summary topicUid targetTopicUid graphEntityId relationshipType displayName subtitle description evidenceItemIds suggestedSeedItemIds suggestedHoldoutItemIds sourceSnapshotId proposedAt reviewedAt reviewedBy updatedAt } }`,
  },
  CurationDecision: {
    field: "getCurationDecision",
    query: `query GetCurationDecision($id: ID!) { getCurationDecision(id: $id) { id proposalId topicSetId action actorSub actorLabel note selectedTopicUid createdAt } }`,
  },
  CurationProjection: {
    field: "getCurationProjection",
    query: `query GetCurationProjection($id: ID!) { getCurationProjection(id: $id) { id targetCorpusId authorityCorpusId classifierId modelVersion externalItemId topicUid displayName score reviewRecommended importedAt importRunId } }`,
  },
};

const MUTATIONS = {
  Edition: {
    create: `
      mutation CreateEdition($input: CreateEditionInput!) {
        createEdition(input: $input) { id }
      }
    `,
    update: `
      mutation UpdateEdition($input: UpdateEditionInput!) {
        updateEdition(input: $input) { id }
      }
    `,
    delete: `
      mutation DeleteEdition($input: DeleteEditionInput!) {
        deleteEdition(input: $input) { id }
      }
    `,
  },
  Item: {
    create: `
      mutation CreateItem($input: CreateItemInput!) {
        createItem(input: $input) { id }
      }
    `,
    update: `
      mutation UpdateItem($input: UpdateItemInput!) {
        updateItem(input: $input) { id }
      }
    `,
    delete: `
      mutation DeleteItem($input: DeleteItemInput!) {
        deleteItem(input: $input) { id }
      }
    `,
  },
  Tag: {
    create: `
      mutation CreateTag($input: CreateTagInput!) {
        createTag(input: $input) { id }
      }
    `,
    update: `
      mutation UpdateTag($input: UpdateTagInput!) {
        updateTag(input: $input) { id }
      }
    `,
    delete: `
      mutation DeleteTag($input: DeleteTagInput!) {
        deleteTag(input: $input) { id }
      }
    `,
  },
  ItemTag: {
    create: `
      mutation CreateItemTag($input: CreateItemTagInput!) {
        createItemTag(input: $input) { id }
      }
    `,
    update: `
      mutation UpdateItemTag($input: UpdateItemTagInput!) {
        updateItemTag(input: $input) { id }
      }
    `,
    delete: `
      mutation DeleteItemTag($input: DeleteItemTagInput!) {
        deleteItemTag(input: $input) { id }
      }
    `,
  },
  MediaAsset: {
    create: `
      mutation CreateMediaAsset($input: CreateMediaAssetInput!) {
        createMediaAsset(input: $input) { id }
      }
    `,
    update: `
      mutation UpdateMediaAsset($input: UpdateMediaAssetInput!) {
        updateMediaAsset(input: $input) { id }
      }
    `,
    delete: `
      mutation DeleteMediaAsset($input: DeleteMediaAssetInput!) {
        deleteMediaAsset(input: $input) { id }
      }
    `,
  },
  EditionItem: {
    create: `
      mutation CreateEditionItem($input: CreateEditionItemInput!) {
        createEditionItem(input: $input) { id }
      }
    `,
    update: `
      mutation UpdateEditionItem($input: UpdateEditionItemInput!) {
        updateEditionItem(input: $input) { id }
      }
    `,
    delete: `
      mutation DeleteEditionItem($input: DeleteEditionItemInput!) {
        deleteEditionItem(input: $input) { id }
      }
    `,
  },
  CurationCorpus: modelMutations("CurationCorpus"),
  CurationImportRun: modelMutations("CurationImportRun"),
  CurationRawPayload: modelMutations("CurationRawPayload"),
  CurationItem: modelMutations("CurationItem"),
  CurationArtifact: modelMutations("CurationArtifact"),
  CurationTopicSet: modelMutations("CurationTopicSet"),
  CurationTopic: modelMutations("CurationTopic"),
  CurationTopicRevision: modelMutations("CurationTopicRevision"),
  CurationProposal: modelMutations("CurationProposal"),
  CurationDecision: modelMutations("CurationDecision"),
  CurationProjection: modelMutations("CurationProjection"),
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
      const connection = result.listItemsByTypeStatusAndPublishedAt;
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
