const LIST_EDITIONS_QUERY = `
  query ListEditionsByStatusAndEditionDate($status: String!, $limit: Int, $nextToken: String) {
    listEditionsByStatusAndEditionDate(status: $status, limit: $limit, nextToken: $nextToken) {
      items {
        id
        slug
        title
        editionDate
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
          items { id slug type status headline title }
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
          description
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
};

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
