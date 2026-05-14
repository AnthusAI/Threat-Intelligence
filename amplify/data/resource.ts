import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { graphqlJwtAuthorizer } from "../functions/graphql-jwt-authorizer/resource";

const authoringOperations: ("read" | "create" | "update" | "delete")[] = [
  "read",
  "create",
  "update",
  "delete",
];

const schema = a.schema({
  Item: a
    .model({
      id: a.id().required(),
      type: a.string().required(),
      status: a.string().required(),
      typeStatus: a.string().required(),
      slug: a.string().required(),
      section: a.string(),
      sectionStatus: a.string(),
      title: a.string(),
      headline: a.string(),
      deck: a.string(),
      body: a.string().array(),
      byline: a.string(),
      dateline: a.string(),
      publishedAt: a.datetime(),
      editionDate: a.string(),
      sortTitle: a.string(),
      pullQuotes: a.string().array(),
      layout: a.json(),
      editorial: a.json(),
      tags: a.hasMany("ItemTag", "itemId"),
      mediaAssets: a.hasMany("MediaAsset", "itemId"),
      editionItems: a.hasMany("EditionItem", "itemId"),
    })
    .secondaryIndexes((index) => [
      index("slug").queryField("itemBySlug"),
      index("typeStatus").sortKeys(["publishedAt"]).queryField("listItemsByTypeStatusAndPublishedAt"),
      index("sectionStatus").sortKeys(["publishedAt"]).queryField("listItemsBySectionStatusAndPublishedAt"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.group("editor"),
      allow.custom().to(authoringOperations),
    ]),

  Tag: a
    .model({
      id: a.id().required(),
      slug: a.string().required(),
      label: a.string().required(),
      type: a.string(),
      description: a.string(),
      items: a.hasMany("ItemTag", "tagId"),
    })
    .secondaryIndexes((index) => [
      index("slug").queryField("tagBySlug"),
      index("type").sortKeys(["label"]).queryField("listTagsByTypeAndLabel"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.group("editor"),
      allow.custom().to(authoringOperations),
    ]),

  ItemTag: a
    .model({
      id: a.id().required(),
      itemId: a.id().required(),
      tagId: a.id().required(),
      itemType: a.string().required(),
      itemStatus: a.string().required(),
      tagSlug: a.string().required(),
      publishedAt: a.datetime(),
      item: a.belongsTo("Item", "itemId"),
      tag: a.belongsTo("Tag", "tagId"),
    })
    .secondaryIndexes((index) => [
      index("itemId").sortKeys(["tagSlug"]).queryField("listItemTagsByItemAndTag"),
      index("tagId").sortKeys(["publishedAt"]).queryField("listItemTagsByTagAndPublishedAt"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.group("editor"),
      allow.custom().to(authoringOperations),
    ]),

  MediaAsset: a
    .model({
      id: a.id().required(),
      itemId: a.id().required(),
      type: a.string().required(),
      role: a.string().required(),
      sortKey: a.string().required(),
      storagePath: a.string(),
      externalUrl: a.string(),
      alt: a.string().required(),
      caption: a.string(),
      credit: a.string(),
      width: a.integer(),
      height: a.integer(),
      aspectRatio: a.float(),
      focalX: a.float(),
      focalY: a.float(),
      minHeight: a.integer(),
      preferredHeight: a.integer(),
      maxHeight: a.integer(),
      crop: a.string(),
      wrapsText: a.boolean(),
      metadata: a.json(),
      item: a.belongsTo("Item", "itemId"),
    })
    .secondaryIndexes((index) => [
      index("itemId").sortKeys(["sortKey"]).queryField("listMediaAssetsByItemAndSortKey"),
      index("role").sortKeys(["itemId"]).queryField("listMediaAssetsByRoleAndItem"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.group("editor"),
      allow.custom().to(authoringOperations),
    ]),

  Edition: a
    .model({
      id: a.id().required(),
      slug: a.string().required(),
      title: a.string().required(),
      status: a.string().required(),
      editionDate: a.string().required(),
      description: a.string(),
      layoutPlan: a.json(),
      metadata: a.json(),
      items: a.hasMany("EditionItem", "editionId"),
    })
    .secondaryIndexes((index) => [
      index("slug").queryField("editionBySlug"),
      index("status").sortKeys(["editionDate"]).queryField("listEditionsByStatusAndEditionDate"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.group("editor"),
      allow.custom().to(authoringOperations),
    ]),

  EditionItem: a
    .model({
      id: a.id().required(),
      editionId: a.id().required(),
      itemId: a.id().required(),
      placementKey: a.string().required(),
      sortKey: a.string().required(),
      pageNumber: a.integer(),
      priority: a.integer(),
      metadata: a.json(),
      edition: a.belongsTo("Edition", "editionId"),
      item: a.belongsTo("Item", "itemId"),
    })
    .secondaryIndexes((index) => [
      index("editionId").sortKeys(["sortKey"]).queryField("listEditionItemsByEditionAndSortKey"),
      index("itemId").sortKeys(["editionId"]).queryField("listEditionItemsByItemAndEdition"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.group("editor"),
      allow.custom().to(authoringOperations),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  name: "PapyrusCmsApi",
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
    lambdaAuthorizationMode: {
      function: graphqlJwtAuthorizer,
      timeToLiveInSeconds: 300,
    },
  },
});
