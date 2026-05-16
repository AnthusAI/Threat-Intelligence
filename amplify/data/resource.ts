import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { curationAction } from "../functions/curation-action/resource";
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
const curationWriteGroups = ["editor", "admin"];
const curationAppendOnlyOperations: ("read" | "create")[] = ["read", "create"];

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

  CurationActionResult: a.customType({
    ok: a.boolean().required(),
    action: a.string().required(),
    proposalId: a.id(),
    revisionId: a.id(),
    topicId: a.id(),
    decisionId: a.id(),
    status: a.string(),
  }),

  reviewCurationProposal: a
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
    .returns(a.ref("CurationActionResult"))
    .authorization((allow) => [allow.groups(curationWriteGroups)])
    .handler(a.handler.function(curationAction)),

  promoteCurationTopicRevision: a
    .mutation()
    .arguments({
      revisionId: a.id().required(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
    })
    .returns(a.ref("CurationActionResult"))
    .authorization((allow) => [allow.groups(curationWriteGroups)])
    .handler(a.handler.function(curationAction)),

  CurationCorpus: a
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
      index("role").sortKeys(["name"]).queryField("listCurationCorporaByRoleAndName"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(curationWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  CurationImportRun: a
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
      topicCount: a.integer(),
      proposalCount: a.integer(),
      artifactCount: a.integer(),
      projectionCount: a.integer(),
      warningCount: a.integer(),
    })
    .secondaryIndexes((index) => [
      index("corpusId").sortKeys(["importedAt"]).queryField("listCurationImportRunsByCorpusAndImportedAt"),
      index("importKind").sortKeys(["importedAt"]).queryField("listCurationImportRunsByKindAndImportedAt"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(curationWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  CurationRawPayload: a
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
      index("ownerId").sortKeys(["payloadKind"]).queryField("listCurationRawPayloadsByOwnerAndKind"),
      index("importRunId").sortKeys(["ownerType"]).queryField("listCurationRawPayloadsByImportRunAndOwner"),
    ])
    .authorization((allow) => [
      allow.groups(curationWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  CurationArtifact: a
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
      index("corpusId").sortKeys(["artifactKind"]).queryField("listCurationArtifactsByCorpusAndKind"),
      index("artifactKind").sortKeys(["createdAt"]).queryField("listCurationArtifactsByKindAndCreatedAt"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(curationWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  CurationTopicSet: a
    .model({
      id: a.id().required(),
      corpusId: a.id().required(),
      classifierId: a.string().required(),
      displayName: a.string().required(),
      description: a.string(),
      status: a.string().required(),
      acceptedRevisionId: a.id(),
      latestDraftRevisionId: a.id(),
      generatedAt: a.datetime(),
      topicCount: a.integer(),
      importRunId: a.id(),
    })
    .secondaryIndexes((index) => [
      index("corpusId").sortKeys(["classifierId"]).queryField("listCurationTopicSetsByCorpusAndClassifier"),
      index("status").sortKeys(["displayName"]).queryField("listCurationTopicSetsByStatusAndName"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(curationWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  CurationTopic: a
    .model({
      id: a.id().required(),
      topicSetId: a.id().required(),
      corpusId: a.id().required(),
      topicUid: a.string().required(),
      displayName: a.string().required(),
      subtitle: a.string(),
      description: a.string(),
      aliases: a.string().array(),
      status: a.string().required(),
      seedItemIds: a.string().array(),
      holdoutItemIds: a.string().array(),
      rank: a.integer(),
      isPinned: a.boolean(),
      importRunId: a.id(),
      updatedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("topicSetId").sortKeys(["topicUid"]).queryField("listCurationTopicsByTopicSetAndTopicUid"),
      index("corpusId").sortKeys(["displayName"]).queryField("listCurationTopicsByCorpusAndName"),
      index("status").sortKeys(["displayName"]).queryField("listCurationTopicsByStatusAndName"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(curationWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  CurationTopicRevision: a
    .model({
      id: a.id().required(),
      topicSetId: a.id().required(),
      corpusId: a.id().required(),
      revisionKind: a.string().required(),
      status: a.string().required(),
      contentHash: a.string(),
      sourceImportRunId: a.id(),
      sourceDecisionId: a.id(),
      topicCount: a.integer(),
      createdAt: a.datetime().required(),
      acceptedAt: a.datetime(),
      acceptedBy: a.string(),
    })
    .secondaryIndexes((index) => [
      index("topicSetId").sortKeys(["createdAt"]).queryField("listCurationTopicRevisionsByTopicSetAndCreatedAt"),
      index("status").sortKeys(["createdAt"]).queryField("listCurationTopicRevisionsByStatusAndCreatedAt"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(curationWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  CurationProposal: a
    .model({
      id: a.id().required(),
      topicSetId: a.id(),
      corpusId: a.id().required(),
      importRunId: a.id(),
      proposalKind: a.string().required(),
      steeringDomain: a.string().required(),
      status: a.string().required(),
      title: a.string().required(),
      summary: a.string(),
      topicUid: a.string(),
      targetTopicUid: a.string(),
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
      index("status").sortKeys(["proposedAt"]).queryField("listCurationProposalsByStatusAndProposedAt"),
      index("topicSetId").sortKeys(["status"]).queryField("listCurationProposalsByTopicSetAndStatus"),
      index("corpusId").sortKeys(["proposalKind"]).queryField("listCurationProposalsByCorpusAndKind"),
      index("steeringDomain").sortKeys(["status"]).queryField("listCurationProposalsByDomainAndStatus"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(curationWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  CurationDecision: a
    .model({
      id: a.id().required(),
      proposalId: a.id().required(),
      topicSetId: a.id(),
      action: a.string().required(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
      selectedTopicUid: a.string(),
      createdAt: a.datetime().required(),
    })
    .secondaryIndexes((index) => [
      index("proposalId").sortKeys(["createdAt"]).queryField("listCurationDecisionsByProposalAndCreatedAt"),
      index("topicSetId").sortKeys(["createdAt"]).queryField("listCurationDecisionsByTopicSetAndCreatedAt"),
    ])
    .authorization((allow) => [
      allow.groups(curationWriteGroups).to(curationAppendOnlyOperations),
      allow.custom().to(curationAppendOnlyOperations),
    ]),

  CurationProjection: a
    .model({
      id: a.id().required(),
      targetCorpusId: a.id().required(),
      authorityCorpusId: a.id(),
      classifierId: a.string().required(),
      modelVersion: a.string(),
      externalItemId: a.string().required(),
      topicUid: a.string(),
      displayName: a.string(),
      score: a.float(),
      reviewRecommended: a.boolean(),
      importedAt: a.datetime().required(),
      importRunId: a.id(),
    })
    .secondaryIndexes((index) => [
      index("targetCorpusId").sortKeys(["externalItemId"]).queryField("listCurationProjectionsByTargetCorpusAndItem"),
      index("classifierId").sortKeys(["importedAt"]).queryField("listCurationProjectionsByClassifierAndImportedAt"),
      index("topicUid").sortKeys(["score"]).queryField("listCurationProjectionsByTopicAndScore"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(curationWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  Item: a
    .model({
      id: a.id().required(),
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
      allow.publicApiKey().to(["read"]),
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
      allow.publicApiKey().to(["read"]),
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
      allow.publicApiKey().to(["read"]),
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  Edition: a
    .model({
      id: a.id().required(),
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
      index("slug").queryField("editionBySlug"),
      index("status").sortKeys(["editionDate"]).queryField("listEditionsByStatusAndEditionDate"),
      index("status").sortKeys(["publishedAt"]).queryField("listEditionsByStatusAndPublishedAt"),
    ])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
      allow.groups(contentWriteGroups),
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
      allow.groups(contentWriteGroups),
      allow.custom().to(authoringOperations),
    ]),
}).authorization((allow) => [
  allow.resource(curationAction),
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
