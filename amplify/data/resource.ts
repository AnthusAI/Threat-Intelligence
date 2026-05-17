import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { assignmentAction } from "../functions/assignment-action/resource";
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
      status: a.string(),
      mergedIntoProfileId: a.id(),
      mergedAt: a.datetime(),
      mergedBy: a.string(),
      mergeReason: a.string(),
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group(adminGroup),
    ]),

  UserIdentity: a
    .model({
      id: a.id().required(),
      userProfileId: a.id().required(),
      cognitoSub: a.string().required(),
      provider: a.string(),
      email: a.email(),
      status: a.string().required(),
      linkedAt: a.datetime().required(),
      lastSeenAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("userProfileId").sortKeys(["linkedAt"]).queryField("listUserIdentitiesByProfileAndLinkedAt"),
      index("cognitoSub").queryField("userIdentityByCognitoSub"),
      index("email").sortKeys(["status"]).queryField("listUserIdentitiesByEmailAndStatus"),
    ])
    .authorization((allow) => [
      allow.group(adminGroup),
    ]),

  UserRoleAssignment: a
    .model({
      id: a.id().required(),
      userProfileId: a.id().required(),
      userSub: a.string(),
      email: a.email(),
      role: a.string().required(),
      status: a.string().required(),
      grantedBy: a.string().required(),
      grantedAt: a.datetime().required(),
      revokedAt: a.datetime(),
      notes: a.string(),
    })
    .secondaryIndexes((index) => [
      index("userProfileId").sortKeys(["role"]).queryField("listUserRoleAssignmentsByProfileAndRole"),
      index("userSub").sortKeys(["role"]).queryField("listUserRoleAssignmentsByUserAndRole"),
      index("role").sortKeys(["status"]).queryField("listUserRoleAssignmentsByRoleAndStatus"),
    ])
    .authorization((allow) => [
      allow.group(adminGroup),
    ]),

  UserRoleMutationResult: a.customType({
    ok: a.boolean().required(),
    userProfileId: a.id(),
    userSub: a.string(),
    username: a.string(),
    role: a.string().required(),
    userSubs: a.string().array(),
    usernames: a.string().array(),
    activeRoles: a.string().array().required(),
  }),

  UserDirectoryIdentity: a.customType({
    id: a.id().required(),
    userProfileId: a.id().required(),
    cognitoSub: a.string().required(),
    provider: a.string(),
    email: a.email(),
    status: a.string().required(),
    linkedAt: a.datetime().required(),
    lastSeenAt: a.datetime(),
  }),

  UserDirectoryEntry: a.customType({
    userProfileId: a.id(),
    userSub: a.string(),
    username: a.string(),
    email: a.email(),
    displayName: a.string(),
    provider: a.string(),
    enabled: a.boolean(),
    cognitoStatus: a.string(),
    profileStatus: a.string(),
    mergedIntoProfileId: a.id(),
    identityStatus: a.string(),
    activeRoles: a.string().array().required(),
    identities: a.ref("UserDirectoryIdentity").array().required(),
  }),

  UserDirectoryResult: a.customType({
    entries: a.ref("UserDirectoryEntry").array().required(),
    profileCount: a.integer().required(),
    identityCount: a.integer().required(),
    cognitoUserCount: a.integer().required(),
  }),

  listUserDirectory: a
    .query()
    .returns(a.ref("UserDirectoryResult"))
    .authorization((allow) => [allow.group(adminGroup)])
    .handler(a.handler.function(manageUserRole)),

  grantUserRole: a
    .mutation()
    .arguments({
      userProfileId: a.id(),
      userSub: a.string(),
      cognitoSubs: a.string().array(),
      role: a.string().required(),
    })
    .returns(a.ref("UserRoleMutationResult"))
    .authorization((allow) => [allow.group(adminGroup)])
    .handler(a.handler.function(manageUserRole)),

  revokeUserRole: a
    .mutation()
    .arguments({
      userProfileId: a.id(),
      userSub: a.string(),
      cognitoSubs: a.string().array(),
      role: a.string().required(),
    })
    .returns(a.ref("UserRoleMutationResult"))
    .authorization((allow) => [allow.group(adminGroup)])
    .handler(a.handler.function(manageUserRole)),

  mergeUserProfiles: a
    .mutation()
    .arguments({
      targetUserProfileId: a.id(),
      targetUserSub: a.string(),
      sourceUserProfileId: a.id(),
      sourceUserSub: a.string(),
      reason: a.string(),
    })
    .returns(a.ref("UserDirectoryEntry"))
    .authorization((allow) => [allow.group(adminGroup)])
    .handler(a.handler.function(manageUserRole)),

  SteeringActionResult: a.customType({
    ok: a.boolean().required(),
    action: a.string().required(),
    proposalId: a.id(),
    categorySetId: a.id(),
    categoryId: a.id(),
    decisionId: a.id(),
    status: a.string(),
  }),

  reviewSteeringProposal: a
    .mutation()
    .arguments({
      proposalId: a.id().required(),
      action: a.string().required(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
      displayName: a.string(),
      shortTitle: a.string(),
      subtitle: a.string(),
      description: a.string(),
      aliases: a.string().array(),
      seedItemIds: a.string().array(),
      holdoutItemIds: a.string().array(),
    })
    .returns(a.ref("SteeringActionResult"))
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(categoryAction)),

  AssignmentActionResult: a.customType({
    ok: a.boolean().required(),
    assignmentId: a.id(),
    eventId: a.id(),
    status: a.string(),
    action: a.string().required(),
  }),

  AssignmentTargetSummary: a.customType({
    kind: a.string().required(),
    id: a.id().required(),
    lineageId: a.id().required(),
    label: a.string(),
    detail: a.string(),
  }),

  AssignmentSummary: a.customType({
    id: a.id().required(),
    assignmentTypeKey: a.string().required(),
    queueKey: a.string().required(),
    queueStatusKey: a.string().required(),
    status: a.string().required(),
    priority: a.integer(),
    title: a.string().required(),
    brief: a.string(),
    instructions: a.string(),
    assigneeType: a.string(),
    assigneeId: a.string(),
    assigneeKey: a.string(),
    claimedAt: a.datetime(),
    claimExpiresAt: a.datetime(),
    completedAt: a.datetime(),
    canceledAt: a.datetime(),
    corpusId: a.id(),
    categorySetId: a.id(),
    classifierId: a.string(),
    sourceSnapshotId: a.string(),
    importRunId: a.id(),
    createdBy: a.string(),
    createdAt: a.datetime().required(),
    updatedAt: a.datetime().required(),
    metadata: a.json(),
  }),

  AssignmentEventSummary: a.customType({
    id: a.id().required(),
    assignmentId: a.id().required(),
    assignmentTypeKey: a.string().required(),
    queueKey: a.string().required(),
    eventType: a.string().required(),
    fromStatus: a.string(),
    toStatus: a.string(),
    actorSub: a.string(),
    actorLabel: a.string(),
    note: a.string(),
    createdAt: a.datetime().required(),
    metadata: a.json(),
  }),

  AssignmentContext: a.customType({
    assignment: a.ref("AssignmentSummary"),
    targets: a.ref("AssignmentTargetSummary").array().required(),
    events: a.ref("AssignmentEventSummary").array().required(),
  }),

  listAssignmentsForObject: a
    .query()
    .arguments({
      objectKind: a.string().required(),
      objectLineageId: a.id().required(),
      status: a.string(),
      limit: a.integer(),
    })
    .returns(a.ref("AssignmentContext").array().required())
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(assignmentAction)),

  listAssignmentQueue: a
    .query()
    .arguments({
      queueKey: a.string().required(),
      status: a.string(),
      limit: a.integer(),
    })
    .returns(a.ref("AssignmentContext").array().required())
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(assignmentAction)),

  getAssignmentContext: a
    .query()
    .arguments({
      assignmentId: a.id().required(),
    })
    .returns(a.ref("AssignmentContext"))
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(assignmentAction)),

  claimAssignment: a
    .mutation()
    .arguments({
      assignmentId: a.id().required(),
      assigneeType: a.string(),
      assigneeId: a.string(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
    })
    .returns(a.ref("AssignmentActionResult"))
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(assignmentAction)),

  releaseAssignment: a
    .mutation()
    .arguments({
      assignmentId: a.id().required(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
    })
    .returns(a.ref("AssignmentActionResult"))
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(assignmentAction)),

  completeAssignment: a
    .mutation()
    .arguments({
      assignmentId: a.id().required(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
    })
    .returns(a.ref("AssignmentActionResult"))
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(assignmentAction)),

  cancelAssignment: a
    .mutation()
    .arguments({
      assignmentId: a.id().required(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
    })
    .returns(a.ref("AssignmentActionResult"))
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(assignmentAction)),

  reopenAssignment: a
    .mutation()
    .arguments({
      assignmentId: a.id().required(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
    })
    .returns(a.ref("AssignmentActionResult"))
    .authorization((allow) => [allow.groups(categoryWriteGroups)])
    .handler(a.handler.function(assignmentAction)),

  Assignment: a
    .model({
      id: a.id().required(),
      assignmentTypeKey: a.string().required(),
      queueKey: a.string().required(),
      queueStatusKey: a.string().required(),
      status: a.string().required(),
      priority: a.integer(),
      title: a.string().required(),
      brief: a.string(),
      instructions: a.string(),
      assigneeType: a.string(),
      assigneeId: a.string(),
      assigneeKey: a.string(),
      claimedAt: a.datetime(),
      claimExpiresAt: a.datetime(),
      completedAt: a.datetime(),
      canceledAt: a.datetime(),
      corpusId: a.id(),
      categorySetId: a.id(),
      classifierId: a.string(),
      sourceSnapshotId: a.string(),
      importRunId: a.id(),
      createdBy: a.string(),
      createdAt: a.datetime().required(),
      updatedAt: a.datetime().required(),
      metadata: a.json(),
    })
    .secondaryIndexes((index) => [
      index("queueStatusKey").sortKeys(["priority", "createdAt"]).queryField("listAssignmentsByQueueStatusAndPriority"),
      index("assignmentTypeKey").sortKeys(["status", "createdAt"]).queryField("listAssignmentsByTypeStatusAndCreatedAt"),
      index("status").sortKeys(["updatedAt"]).queryField("listAssignmentsByStatusAndUpdatedAt"),
      index("assigneeKey").sortKeys(["status", "updatedAt"]).queryField("listAssignmentsByAssigneeStatusAndUpdatedAt"),
      index("importRunId").sortKeys(["createdAt"]).queryField("listAssignmentsByImportRunAndCreatedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  AssignmentEvent: a
    .model({
      id: a.id().required(),
      assignmentId: a.id().required(),
      assignmentTypeKey: a.string().required(),
      queueKey: a.string().required(),
      eventType: a.string().required(),
      fromStatus: a.string(),
      toStatus: a.string(),
      actorSub: a.string(),
      actorLabel: a.string(),
      note: a.string(),
      createdAt: a.datetime().required(),
      metadata: a.json(),
    })
    .secondaryIndexes((index) => [
      index("assignmentId").sortKeys(["createdAt"]).queryField("listAssignmentEventsByAssignmentAndCreatedAt"),
      index("eventType").sortKeys(["createdAt"]).queryField("listAssignmentEventsByTypeAndCreatedAt"),
      index("queueKey").sortKeys(["createdAt"]).queryField("listAssignmentEventsByQueueAndCreatedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(categoryAppendOnlyOperations),
      allow.custom().to(categoryAppendOnlyOperations),
    ]),

  KnowledgeCorpus: a
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
      index("role").sortKeys(["name"]).queryField("listKnowledgeCorporaByRoleAndName"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  KnowledgeImportRun: a
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
      referenceCount: a.integer(),
      relationCount: a.integer(),
      warningCount: a.integer(),
    })
    .secondaryIndexes((index) => [
      index("corpusId").sortKeys(["importedAt"]).queryField("listKnowledgeImportRunsByCorpusAndImportedAt"),
      index("importKind").sortKeys(["importedAt"]).queryField("listKnowledgeImportRunsByKindAndImportedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  KnowledgeRawPayload: a
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
      index("ownerId").sortKeys(["payloadKind"]).queryField("listKnowledgeRawPayloadsByOwnerAndKind"),
      index("importRunId").sortKeys(["ownerType"]).queryField("listKnowledgeRawPayloadsByImportRunAndOwner"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups),
      allow.custom().to(authoringOperations),
    ]),

  KnowledgeArtifact: a
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
      index("corpusId").sortKeys(["artifactKind"]).queryField("listKnowledgeArtifactsByCorpusAndKind"),
      index("artifactKind").sortKeys(["createdAt"]).queryField("listKnowledgeArtifactsByKindAndCreatedAt"),
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
      shortTitle: a.string(),
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

  SteeringProposal: a
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
      shortTitle: a.string(),
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
      index("status").sortKeys(["proposedAt"]).queryField("listSteeringProposalsByStatusAndProposedAt"),
      index("categorySetId").sortKeys(["status"]).queryField("listSteeringProposalsBySetAndStatus"),
      index("corpusId").sortKeys(["proposalKind"]).queryField("listSteeringProposalsByCorpusAndKind"),
      index("steeringDomain").sortKeys(["status"]).queryField("listSteeringProposalsByDomainAndStatus"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  SteeringDecision: a
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
      index("proposalId").sortKeys(["createdAt"]).queryField("listSteeringDecisionsByProposalAndCreatedAt"),
      index("categorySetId").sortKeys(["createdAt"]).queryField("listSteeringDecisionsBySetAndCreatedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(categoryAppendOnlyOperations),
      allow.custom().to(categoryAppendOnlyOperations),
    ]),

  Reference: a
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
      externalItemId: a.string().required(),
      title: a.string(),
      authors: a.string().array(),
      sourceUri: a.string(),
      storagePath: a.string(),
      mediaType: a.string(),
      byteSize: a.integer(),
      sha256: a.string(),
      sourcePublishedAt: a.string(),
      sourceUpdatedAt: a.string(),
      retrievedAt: a.string(),
      importRunId: a.id(),
      importedAt: a.datetime(),
      metadata: a.json(),
      updatedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("lineageId").sortKeys(["versionNumber"]).queryField("listReferencesByLineageAndVersion"),
      index("corpusId").sortKeys(["externalItemId"]).queryField("listReferencesByCorpusAndExternalItem"),
      index("versionState").sortKeys(["updatedAt"]).queryField("listReferencesByVersionStateAndUpdatedAt"),
      index("importRunId").sortKeys(["externalItemId"]).queryField("listReferencesByImportRunAndExternalItem"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  ReferenceAttachment: a
    .model({
      id: a.id().required(),
      referenceId: a.id().required(),
      referenceLineageId: a.id().required(),
      referenceVersionNumber: a.integer(),
      referenceVersionKey: a.string().required(),
      role: a.string().required(),
      sortKey: a.string().required(),
      storagePath: a.string(),
      sourceUri: a.string(),
      filename: a.string(),
      mediaType: a.string(),
      byteSize: a.integer(),
      sha256: a.string(),
      etag: a.string(),
      importRunId: a.id(),
      importedAt: a.datetime(),
      metadata: a.json(),
    })
    .secondaryIndexes((index) => [
      index("referenceVersionKey").sortKeys(["sortKey"]).queryField("listReferenceAttachmentsByReferenceVersionAndSortKey"),
      index("referenceLineageId").sortKeys(["sortKey"]).queryField("listReferenceAttachmentsByReferenceLineageAndSortKey"),
      index("storagePath").queryField("referenceAttachmentByStoragePath"),
      index("importRunId").sortKeys(["sortKey"]).queryField("listReferenceAttachmentsByImportRunAndSortKey"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  SemanticNode: a
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
      nodeKey: a.string().required(),
      nodeKind: a.string().required(),
      corpusId: a.id(),
      categorySetId: a.id(),
      categoryLineageId: a.id(),
      categoryKey: a.string(),
      displayName: a.string(),
      description: a.string(),
      aliases: a.string().array(),
      status: a.string().required(),
      importRunId: a.id(),
      updatedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("lineageId").sortKeys(["versionNumber"]).queryField("listSemanticNodesByLineageAndVersion"),
      index("nodeKey").sortKeys(["versionNumber"]).queryField("listSemanticNodesByNodeKeyAndVersion"),
      index("corpusId").sortKeys(["nodeKey"]).queryField("listSemanticNodesByCorpusAndNodeKey"),
      index("versionState").sortKeys(["updatedAt"]).queryField("listSemanticNodesByVersionStateAndUpdatedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(["read"]),
      allow.custom().to(authoringOperations),
    ]),

  KnowledgeComment: a
    .model({
      id: a.id().required(),
      subjectKind: a.string().required(),
      subjectId: a.id().required(),
      subjectLineageId: a.id().required(),
      subjectVersionNumber: a.integer(),
      subjectVersionKey: a.string().required(),
      subjectStateKey: a.string().required(),
      commentKind: a.string().required(),
      body: a.string().required(),
      status: a.string().required(),
      source: a.string(),
      importRunId: a.id(),
      authorSub: a.string(),
      authorUserProfileId: a.id(),
      authorLabel: a.string(),
      metadata: a.json(),
      createdAt: a.datetime().required(),
    })
    .secondaryIndexes((index) => [
      index("subjectStateKey").sortKeys(["createdAt"]).queryField("listKnowledgeCommentsBySubjectStateAndCreatedAt"),
      index("subjectVersionKey").sortKeys(["createdAt"]).queryField("listKnowledgeCommentsBySubjectVersionAndCreatedAt"),
      index("commentKind").sortKeys(["createdAt"]).queryField("listKnowledgeCommentsByKindAndCreatedAt"),
      index("authorSub").sortKeys(["createdAt"]).queryField("listKnowledgeCommentsByAuthorSubAndCreatedAt"),
      index("authorUserProfileId").sortKeys(["createdAt"]).queryField("listKnowledgeCommentsByAuthorProfileAndCreatedAt"),
      index("importRunId").sortKeys(["createdAt"]).queryField("listKnowledgeCommentsByImportRunAndCreatedAt"),
    ])
    .authorization((allow) => [
      allow.groups(categoryWriteGroups).to(categoryAppendOnlyOperations),
      allow.custom().to(categoryAppendOnlyOperations),
    ]),

  SemanticRelation: a
    .model({
      id: a.id().required(),
      relationState: a.string().required(),
      predicate: a.string().required(),
      subjectKind: a.string().required(),
      subjectId: a.id().required(),
      subjectLineageId: a.id().required(),
      subjectVersionNumber: a.integer(),
      objectKind: a.string().required(),
      objectId: a.id().required(),
      objectLineageId: a.id().required(),
      objectVersionNumber: a.integer(),
      subjectStateKey: a.string().required(),
      objectStateKey: a.string().required(),
      objectSubjectStateKey: a.string().required(),
      predicateObjectStateKey: a.string().required(),
      subjectVersionKey: a.string().required(),
      objectVersionKey: a.string().required(),
      score: a.float(),
      confidence: a.float(),
      rank: a.integer(),
      classifierId: a.string(),
      modelVersion: a.string(),
      reviewRecommended: a.boolean(),
      sourceSnapshotId: a.string(),
      importRunId: a.id(),
      importedAt: a.datetime(),
      metadata: a.json(),
    })
    .secondaryIndexes((index) => [
      index("subjectStateKey").sortKeys(["predicateObjectStateKey"]).queryField("listSemanticRelationsBySubjectState"),
      index("objectStateKey").sortKeys(["predicate"]).queryField("listSemanticRelationsByObjectState"),
      index("objectSubjectStateKey").sortKeys(["score"]).queryField("listSemanticRelationsByObjectSubjectStateAndScore"),
      index("predicateObjectStateKey").sortKeys(["score"]).queryField("listSemanticRelationsByPredicateObjectStateAndScore"),
      index("subjectVersionKey").sortKeys(["predicateObjectStateKey"]).queryField("listSemanticRelationsBySubjectVersion"),
      index("importRunId").sortKeys(["importedAt"]).queryField("listSemanticRelationsByImportRunAndImportedAt"),
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
      shortTitle: a.string(),
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
  allow.resource(manageUserRole),
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
