import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { categoryAction } from "../functions/category-action/resource";
import { graphqlJwtAuthorizer } from "../functions/graphql-jwt-authorizer/resource";
import { manageUserRole } from "../functions/manage-user-role/resource";

const authoringOperations: ("read" | "create" | "update" | "delete")[] = [
  "read",
  "create",
  "update",
  "delete",
];
const contentWriteGroups = ["editor", "admin"];
const adminGroup = "admin";
const categoryWriteGroups = ["editor", "admin"];
const categoryAppendOnlyOperations: ("read" | "create")[] = ["read", "create"];

const schema = a.schema({
  UserProfile: a
    .model({
      id: a.id().required(),
      email: a.email(),
      displayName: a.string(),
      avatarUrl: a.url(),
      preferences: a.json(),
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group(adminGroup),
    ]),

  UserRoleAssignment: a
    .model({
      id: a.id().required(),
      userSub: a.string().required(),
      email: a.email(),
      role: a.string().required(),
      status: a.string().required(),
      grantedBy: a.string().required(),
      grantedAt: a.datetime().required(),
      revokedAt: a.datetime(),
      notes: a.string(),
    })
    .secondaryIndexes((index) => [
      index("userSub").sortKeys(["role"]).queryField("listUserRoleAssignmentsByUserAndRole"),
      index("role").sortKeys(["status"]).queryField("listUserRoleAssignmentsByRoleAndStatus"),
    ])
    .authorization((allow) => [
      allow.group(adminGroup),
    ]),

  UserRoleMutationResult: a.customType({
    ok: a.boolean().required(),
    userSub: a.string().required(),
    username: a.string().required(),
    role: a.string().required(),
    activeRoles: a.string().array().required(),
  }),

  grantUserRole: a
    .mutation()
    .arguments({
      userSub: a.string().required(),
      role: a.string().required(),
    })
    .returns(a.ref("UserRoleMutationResult"))
    .authorization((allow) => [allow.group(adminGroup)])
    .handler(a.handler.function(manageUserRole)),

  revokeUserRole: a
    .mutation()
    .arguments({
      userSub: a.string().required(),
      role: a.string().required(),
    })
    .returns(a.ref("UserRoleMutationResult"))
    .authorization((allow) => [allow.group(adminGroup)])
    .handler(a.handler.function(manageUserRole)),

  CategoryActionResult: a.customType({
    ok: a.boolean().required(),
    action: a.string().required(),
    proposalId: a.id(),
    categorySetId: a.id(),
    categoryId: a.id(),
    decisionId: a.id(),
    status: a.string(),
  }),

  reviewCategoryProposal: a
    .mutation()
    .arguments({
      proposalId: a.id().required(),
      action: a.string().required(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
      displayName: a.string(),
      subtitle: a.string(),
      description: a.string(),
      aliases: a.string().array(),
      seedItemIds: a.string().array(),
      holdoutItemIds: a.string().array(),
    })
    .returns(a.ref("CategoryActionResult"))
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(categoryAction)),

  CategoryCorpus: a
    .model({
      id: a.id().required(),
      name: a.string().required(),
      role: a.string().required(),
      itemCount: a.integer(),
      generatedAt: a.datetime(),
      latestImportRunId: a.id(),
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("role").sortKeys(["name"]).queryField("listCategoryCorporaByRoleAndName"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  CategoryImportRun: a
    .model({
      id: a.id().required(),
      corpusId: a.id().required(),
      importKind: a.string().required(),
      classifierId: a.string(),
      sourceSnapshotId: a.string(),
      status: a.string().required(),
      generatedAt: a.datetime(),
      importedAt: a.datetime().required(),
      itemCount: a.integer(),
      categoryCount: a.integer(),
      proposalCount: a.integer(),
      artifactCount: a.integer(),
      projectionCount: a.integer(),
      warningCount: a.integer(),
    })
    .secondaryIndexes((index) => [
      index("corpusId").sortKeys(["importedAt"]).queryField("listCategoryImportRunsByCorpusAndImportedAt"),
      index("importKind").sortKeys(["importedAt"]).queryField("listCategoryImportRunsByKindAndImportedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  CategoryRawPayload: a
    .model({
      id: a.id().required(),
      ownerType: a.string().required(),
      ownerId: a.id().required(),
      payloadKind: a.string().required(),
      importRunId: a.id(),
      payload: a.json(),
      createdAt: a.datetime().required(),
      updatedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("ownerId").sortKeys(["payloadKind"]).queryField("listCategoryRawPayloadsByOwnerAndKind"),
      index("importRunId").sortKeys(["ownerType"]).queryField("listCategoryRawPayloadsByImportRunAndOwner"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  CategoryArtifact: a
    .model({
      id: a.id().required(),
      corpusId: a.id().required(),
      artifactKind: a.string().required(),
      artifactId: a.string().required(),
      snapshotId: a.string(),
      displayName: a.string(),
      createdAt: a.datetime(),
      importRunId: a.id(),
    })
    .secondaryIndexes((index) => [
      index("corpusId").sortKeys(["artifactKind"]).queryField("listCategoryArtifactsByCorpusAndKind"),
      index("artifactKind").sortKeys(["createdAt"]).queryField("listCategoryArtifactsByKindAndCreatedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  CategorySet: a
    .model({
      id: a.id().required(),
      lineageId: a.id().required(),
      versionNumber: a.integer().required(),
      previousVersionId: a.id(),
      versionState: a.string().required(),
      versionCreatedAt: a.datetime().required(),
      versionCreatedBy: a.string(),
      changeReason: a.string(),
      contentHash: a.string(),
      corpusId: a.id().required(),
      classifierId: a.string().required(),
      displayName: a.string().required(),
      description: a.string(),
      status: a.string().required(),
      generatedAt: a.datetime(),
      categoryCount: a.integer(),
      importRunId: a.id(),
    })
    .secondaryIndexes((index) => [
      index("lineageId").sortKeys(["versionNumber"]).queryField("listCategorySetsByLineageAndVersion"),
      index("corpusId").sortKeys(["classifierId"]).queryField("listCategorySetsByCorpusAndClassifier"),
      index("status").sortKeys(["displayName"]).queryField("listCategorySetsByStatusAndName"),
      index("versionState").sortKeys(["generatedAt"]).queryField("listCategorySetsByVersionStateAndGeneratedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  Category: a
    .model({
      id: a.id().required(),
      lineageId: a.id().required(),
      versionNumber: a.integer().required(),
      previousVersionId: a.id(),
      versionState: a.string().required(),
      versionCreatedAt: a.datetime().required(),
      versionCreatedBy: a.string(),
      changeReason: a.string(),
      contentHash: a.string(),
      categorySetId: a.id().required(),
      corpusId: a.id().required(),
      categoryKey: a.string().required(),
      parentCategoryId: a.id(),
      parentCategoryKey: a.string(),
      displayName: a.string().required(),
      subtitle: a.string(),
      description: a.string(),
      aliases: a.string().array(),
      status: a.string().required(),
      seedItemIds: a.string().array(),
      holdoutItemIds: a.string().array(),
      rank: a.integer(),
      depth: a.integer(),
      isPinned: a.boolean(),
      importRunId: a.id(),
      updatedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("lineageId").sortKeys(["versionNumber"]).queryField("listCategoriesByLineageAndVersion"),
      index("categorySetId").sortKeys(["categoryKey"]).queryField("listCategoriesBySetAndKey"),
      index("parentCategoryId").sortKeys(["rank"]).queryField("listCategoriesByParentAndRank"),
      index("parentCategoryKey").sortKeys(["rank"]).queryField("listCategoriesByParentKeyAndRank"),
      index("corpusId").sortKeys(["displayName"]).queryField("listCategoriesByCorpusAndName"),
      index("status").sortKeys(["displayName"]).queryField("listCategoriesByStatusAndName"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  CategoryProposal: a
    .model({
      id: a.id().required(),
      categorySetId: a.id(),
      corpusId: a.id().required(),
      importRunId: a.id(),
      proposalKind: a.string().required(),
      steeringDomain: a.string().required(),
      status: a.string().required(),
      title: a.string().required(),
      summary: a.string(),
      categoryKey: a.string(),
      targetCategoryKey: a.string(),
      graphEntityId: a.string(),
      relationshipType: a.string(),
      displayName: a.string(),
      subtitle: a.string(),
      description: a.string(),
      evidenceItemIds: a.string().array(),
      suggestedSeedItemIds: a.string().array(),
      suggestedHoldoutItemIds: a.string().array(),
      sourceSnapshotId: a.string(),
      proposedAt: a.datetime(),
      reviewedAt: a.datetime(),
      reviewedBy: a.string(),
      updatedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("status").sortKeys(["proposedAt"]).queryField("listCategoryProposalsByStatusAndProposedAt"),
      index("categorySetId").sortKeys(["status"]).queryField("listCategoryProposalsBySetAndStatus"),
      index("corpusId").sortKeys(["proposalKind"]).queryField("listCategoryProposalsByCorpusAndKind"),
      index("steeringDomain").sortKeys(["status"]).queryField("listCategoryProposalsByDomainAndStatus"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  CategoryDecision: a
    .model({
      id: a.id().required(),
      proposalId: a.id().required(),
      categorySetId: a.id(),
      action: a.string().required(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
      selectedCategoryKey: a.string(),
      createdAt: a.datetime().required(),
    })
    .secondaryIndexes((index) => [
      index("proposalId").sortKeys(["createdAt"]).queryField("listCategoryDecisionsByProposalAndCreatedAt"),
      index("categorySetId").sortKeys(["createdAt"]).queryField("listCategoryDecisionsBySetAndCreatedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(categoryAppendOnlyOperations),
      allow.custom().to(categoryAppendOnlyOperations),
    ]),

  CategoryProjection: a
    .model({
      id: a.id().required(),
      targetCorpusId: a.id().required(),
      authorityCorpusId: a.id(),
      classifierId: a.string().required(),
      modelVersion: a.string(),
      externalItemId: a.string().required(),
      categoryKey: a.string(),
      displayName: a.string(),
      score: a.float(),
      reviewRecommended: a.boolean(),
      importedAt: a.datetime().required(),
      importRunId: a.id(),
    })
    .secondaryIndexes((index) => [
      index("targetCorpusId").sortKeys(["externalItemId"]).queryField("listCategoryProjectionsByTargetCorpusAndItem"),
      index("classifierId").sortKeys(["importedAt"]).queryField("listCategoryProjectionsByClassifierAndImportedAt"),
      index("categoryKey").sortKeys(["score"]).queryField("listCategoryProjectionsByCategoryAndScore"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  Item: a
    .model({
      id: a.id().required(),
      lineageId: a.id().required(),
      versionNumber: a.integer().required(),
      previousVersionId: a.id(),
      versionState: a.string().required(),
      versionCreatedAt: a.datetime().required(),
      versionCreatedBy: a.string(),
      changeReason: a.string(),
      contentHash: a.string(),
      type: a.string().required(),
      status: a.string().required(),
      typeStatus: a.string().required(),
      slug: a.string().required(),
      shortSlug: a.string(),
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
      updatedAt: a.datetime(),
      tags: a.hasMany("ItemTag", "itemId"),
      mediaAssets: a.hasMany("MediaAsset", "itemId"),
      editionItems: a.hasMany("EditionItem", "itemId"),
    })
    .secondaryIndexes((index) => [
      index("lineageId").sortKeys(["versionNumber"]).queryField("listItemsByLineageAndVersion"),
      index("slug").queryField("itemBySlug"),
      index("typeStatus").sortKeys(["publishedAt"]).queryField("listItemsByTypeStatusAndPublishedAt"),
      index("sectionStatus").sortKeys(["publishedAt"]).queryField("listItemsBySectionStatusAndPublishedAt"),
      index("versionState").sortKeys(["updatedAt"]).queryField("listItemsByVersionStateAndUpdatedAt"),
    ])
    .authorization((allow) => [
      allow.groups(contentWriteGroups),
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
      allow.groups(contentWriteGroups),
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
      allow.groups(contentWriteGroups),
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
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  Edition: a
    .model({
      id: a.id().required(),
      lineageId: a.id().required(),
      versionNumber: a.integer().required(),
      previousVersionId: a.id(),
      versionState: a.string().required(),
      versionCreatedAt: a.datetime().required(),
      versionCreatedBy: a.string(),
      changeReason: a.string(),
      contentHash: a.string(),
      slug: a.string().required(),
      title: a.string().required(),
      status: a.string().required(),
      editionDate: a.string().required(),
      publishedAt: a.datetime(),
      description: a.string(),
      layoutPlan: a.json(),
      metadata: a.json(),
      items: a.hasMany("EditionItem", "editionId"),
    })
    .secondaryIndexes((index) => [
      index("lineageId").sortKeys(["versionNumber"]).queryField("listEditionsByLineageAndVersion"),
      index("slug").queryField("editionBySlug"),
      index("status").sortKeys(["editionDate"]).queryField("listEditionsByStatusAndEditionDate"),
      index("status").sortKeys(["publishedAt"]).queryField("listEditionsByStatusAndPublishedAt"),
      index("versionState").sortKeys(["publishedAt"]).queryField("listEditionsByVersionStateAndPublishedAt"),
    ])
    .authorization((allow) => [
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  EditionItem: a
    .model({
      id: a.id().required(),
      editionId: a.id().required(),
      editionLineageId: a.id(),
      itemId: a.id().required(),
      itemLineageId: a.id(),
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
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  PublishedItem: a
    .model({
      id: a.id().required(),
      sourceItemId: a.id().required(),
      itemLineageId: a.id().required(),
      versionNumber: a.integer().required(),
      type: a.string().required(),
      status: a.string().required(),
      typeStatus: a.string().required(),
      slug: a.string().required(),
      shortSlug: a.string(),
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
    })
    .secondaryIndexes((index) => [
      index("slug").queryField("publishedItemBySlug"),
      index("typeStatus").sortKeys(["publishedAt"]).queryField("listPublishedItemsByTypeStatusAndPublishedAt"),
      index("sectionStatus").sortKeys(["publishedAt"]).queryField("listPublishedItemsBySectionStatusAndPublishedAt"),
      index("itemLineageId").sortKeys(["versionNumber"]).queryField("listPublishedItemsByLineageAndVersion"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  PublishedMediaAsset: a
    .model({
      id: a.id().required(),
      sourceMediaAssetId: a.id().required(),
      publishedItemId: a.id().required(),
      sourceItemId: a.id().required(),
      itemLineageId: a.id().required(),
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
    })
    .secondaryIndexes((index) => [
      index("publishedItemId").sortKeys(["sortKey"]).queryField("listPublishedMediaAssetsByItemAndSortKey"),
      index("role").sortKeys(["publishedItemId"]).queryField("listPublishedMediaAssetsByRoleAndItem"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  PublishedEdition: a
    .model({
      id: a.id().required(),
      sourceEditionId: a.id().required(),
      editionLineageId: a.id().required(),
      versionNumber: a.integer().required(),
      slug: a.string().required(),
      title: a.string().required(),
      status: a.string().required(),
      editionDate: a.string().required(),
      publishedAt: a.datetime(),
      description: a.string(),
      layoutPlan: a.json(),
      metadata: a.json(),
    })
    .secondaryIndexes((index) => [
      index("slug").queryField("publishedEditionBySlug"),
      index("status").sortKeys(["editionDate"]).queryField("listPublishedEditionsByStatusAndEditionDate"),
      index("status").sortKeys(["publishedAt"]).queryField("listPublishedEditionsByStatusAndPublishedAt"),
      index("editionLineageId").sortKeys(["versionNumber"]).queryField("listPublishedEditionsByLineageAndVersion"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  PublishedEditionItem: a
    .model({
      id: a.id().required(),
      publishedEditionId: a.id().required(),
      publishedItemId: a.id().required(),
      sourceEditionItemId: a.id().required(),
      sourceEditionId: a.id().required(),
      sourceItemId: a.id().required(),
      editionLineageId: a.id().required(),
      itemLineageId: a.id().required(),
      placementKey: a.string().required(),
      sortKey: a.string().required(),
      pageNumber: a.integer(),
      priority: a.integer(),
      metadata: a.json(),
    })
    .secondaryIndexes((index) => [
      index("publishedEditionId").sortKeys(["sortKey"]).queryField("listPublishedEditionItemsByEditionAndSortKey"),
      index("publishedItemId").sortKeys(["publishedEditionId"]).queryField("listPublishedEditionItemsByItemAndEdition"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  PublishedCategorySet: a
    .model({
      id: a.id().required(),
      sourceCategorySetId: a.id().required(),
      categorySetLineageId: a.id().required(),
      versionNumber: a.integer().required(),
      corpusId: a.id().required(),
      classifierId: a.string().required(),
      displayName: a.string().required(),
      description: a.string(),
      status: a.string().required(),
      generatedAt: a.datetime(),
      publishedAt: a.datetime(),
      categoryCount: a.integer(),
      metadata: a.json(),
    })
    .secondaryIndexes((index) => [
      index("status").sortKeys(["displayName"]).queryField("listPublishedCategorySetsByStatusAndName"),
      index("classifierId").sortKeys(["displayName"]).queryField("listPublishedCategorySetsByClassifierAndName"),
      index("categorySetLineageId").sortKeys(["versionNumber"]).queryField("listPublishedCategorySetsByLineageAndVersion"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  PublishedCategory: a
    .model({
      id: a.id().required(),
      sourceCategoryId: a.id().required(),
      publishedCategorySetId: a.id().required(),
      categoryLineageId: a.id().required(),
      categorySetLineageId: a.id().required(),
      versionNumber: a.integer().required(),
      corpusId: a.id().required(),
      categoryKey: a.string().required(),
      parentCategoryId: a.id(),
      parentCategoryKey: a.string(),
      displayName: a.string().required(),
      subtitle: a.string(),
      description: a.string(),
      aliases: a.string().array(),
      status: a.string().required(),
      seedItemIds: a.string().array(),
      holdoutItemIds: a.string().array(),
      rank: a.integer(),
      depth: a.integer(),
      isPinned: a.boolean(),
      metadata: a.json(),
    })
    .secondaryIndexes((index) => [
      index("publishedCategorySetId").sortKeys(["categoryKey"]).queryField("listPublishedCategoriesBySetAndKey"),
      index("parentCategoryId").sortKeys(["rank"]).queryField("listPublishedCategoriesByParentAndRank"),
      index("parentCategoryKey").sortKeys(["rank"]).queryField("listPublishedCategoriesByParentKeyAndRank"),
      index("categoryKey").sortKeys(["publishedCategorySetId"]).queryField("listPublishedCategoriesByKeyAndSet"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),
}).authorization((allow) => [
  allow.resource(categoryAction),
]);

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
