"use client";

import { generateClient } from "aws-amplify/data";
import { downloadData, getUrl } from "aws-amplify/storage";
import type { Schema } from "../amplify/data/resource";
import type { NewsDeskAppendix, NewsDeskCategoryTreeNode } from "../lib/content-types";
import { createEmptyCategorySteeringDashboard } from "../lib/category-dashboard";
import type {
  CategorySteeringArtifact,
  CategorySteeringCorpus,
  CategorySteeringDashboard,
  CategorySteeringImportRun,
  CategorySteeringProposal,
  CategorySteeringCategoryTree,
  CategorySteeringCategoryTreeNode,
  CategorySteeringCategory,
  CategorySteeringCategorySet,
  CategoryKeywordRecord,
  MessageRecord,
  ModelAttachmentRecord,
  HydratedModelPayload,
  NewsroomSummaryRecord,
  LexicalSteeringRuleRecord,
  AssignmentEventRecord,
  AssignmentRecord,
  DoctrineRecord,
  NewsroomSectionRecord,
  ProcedureDefinitionRecord,
  ProcedureVersionRecord,
  ProcedureRunRecord,
  ReferenceAttachmentRecord,
  ReferenceRecord,
  SemanticNodeRecord,
  SemanticRelationRecord,
  UserDirectoryEntry,
} from "../lib/category-repository";
import { relationTypeKey } from "../lib/semantic-graph";
import { DOCTRINE_DEFINITIONS, getCategoryDoctrineDefinitions, type DoctrineCategory } from "../lib/doctrine";
import { configureAmplifyClient } from "./amplify-client-provider";
import { isUnauthenticatedError, loadReaderSessionSnapshot, type ReaderAuthSnapshot } from "./reader-auth-state";

const USER_POOL_AUTH_MODE = "userPool";
const USER_POOL_LIST_LIMIT = 500;
const USER_POOL_PAGE_LIMIT = 50;
const TEST_EDITOR_STORAGE_KEY = "papyrus:test-editor";
const TEST_EDITOR_NEWSROOM_MOCK_STORAGE_KEY = "papyrus:test-newsroom-mock";
const NEWSROOM_PAGE_LIMIT = 50;

const NEWSROOM_MESSAGE_FEED_QUERY = `
  query ListMessagesByNewsroomFeedAndCreatedAt($newsroomFeedKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelMessageFilterInput) {
    listMessagesByNewsroomFeedAndCreatedAt(newsroomFeedKey: $newsroomFeedKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id messageKind messageDomain status summary source importRunId authorSub authorUserProfileId authorLabel threadId parentMessageId sequenceNumber role messageType content semanticLayer searchVisibility responseTarget responseStatus responseOwner responseStartedAt responseCompletedAt responseError metadata createdAt updatedAt newsroomFeedKey }
      nextToken
    }
  }
`;

const NEWSROOM_ASSIGNMENT_FEED_QUERY = `
  query ListAssignmentsByNewsroomFeedAndCreatedAt($newsroomFeedKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelAssignmentFilterInput) {
    listAssignmentsByNewsroomFeedAndCreatedAt(newsroomFeedKey: $newsroomFeedKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id assignmentTypeKey queueKey queueStatusKey status priority title summary assigneeType assigneeId assigneeKey claimedAt claimExpiresAt completedAt canceledAt corpusId categorySetId classifierId sectionId sectionKey sectionType sectionStatusKey sectionQueueStatusKey primaryFocusCategoryKey topicScopeCategoryKeys sourceSnapshotId importRunId createdBy createdAt updatedAt newsroomFeedKey }
      nextToken
    }
  }
`;

const NEWSROOM_REFERENCE_FEED_QUERY = `
  query ListReferencesByNewsroomFeedAndCreatedAt($newsroomFeedKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelReferenceFilterInput) {
    listReferencesByNewsroomFeedAndCreatedAt(newsroomFeedKey: $newsroomFeedKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id lineageId versionNumber previousVersionId versionState versionCreatedAt versionCreatedBy changeReason contentHash corpusId externalItemId title authors sourceUri storagePath mediaType byteSize sha256 sourcePublishedAt sourceUpdatedAt retrievedAt inboundCitationCount outboundCitationCount importRunId importedAt createdAt curationStatus curationStatusKey curationStatusUpdatedAt curationStatusUpdatedBy curationStatusReason newsroomFeedKey updatedAt }
      nextToken
    }
  }
`;

const NEWSROOM_SEMANTIC_NODE_FEED_QUERY = `
  query ListSemanticNodesByNewsroomFeedAndCreatedAt($newsroomFeedKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelSemanticNodeFilterInput) {
    listSemanticNodesByNewsroomFeedAndCreatedAt(newsroomFeedKey: $newsroomFeedKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id lineageId versionNumber previousVersionId versionState versionCreatedAt versionCreatedBy changeReason contentHash nodeKey nodeKind corpusId categorySetId categoryLineageId categoryKey displayName description aliases authorityScore authorityRank acceptedReferenceMentionCount distinctSourceKindCount relationCount status importRunId createdAt newsroomFeedKey updatedAt }
      nextToken
    }
  }
`;

const NEWSROOM_SEMANTIC_RELATION_FEED_QUERY = `
  query ListSemanticRelationsByNewsroomFeedAndCreatedAt($newsroomFeedKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelSemanticRelationFilterInput) {
    listSemanticRelationsByNewsroomFeedAndCreatedAt(newsroomFeedKey: $newsroomFeedKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id relationState predicate relationTypeId relationTypeKey relationDomain subjectKind subjectId subjectLineageId subjectVersionNumber objectKind objectId objectLineageId objectVersionNumber subjectStateKey objectStateKey objectSubjectStateKey predicateObjectStateKey subjectVersionKey objectVersionKey score confidence rank classifierId modelVersion reviewRecommended sourceSnapshotId importRunId importedAt createdAt updatedAt newsroomFeedKey metadata }
      nextToken
    }
  }
`;

const LIST_SEMANTIC_RELATIONS_BY_SUBJECT_STATE_QUERY = `
  query ListSemanticRelationsBySubjectState($subjectStateKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelSemanticRelationFilterInput) {
    listSemanticRelationsBySubjectState(subjectStateKey: $subjectStateKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id relationState predicate relationTypeId relationTypeKey relationDomain subjectKind subjectId subjectLineageId subjectVersionNumber objectKind objectId objectLineageId objectVersionNumber subjectStateKey objectStateKey objectSubjectStateKey predicateObjectStateKey subjectVersionKey objectVersionKey score confidence rank classifierId modelVersion reviewRecommended sourceSnapshotId importRunId importedAt createdAt updatedAt newsroomFeedKey metadata }
      nextToken
    }
  }
`;

const LIST_SEMANTIC_RELATIONS_BY_OBJECT_STATE_QUERY = `
  query ListSemanticRelationsByObjectState($objectStateKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelSemanticRelationFilterInput) {
    listSemanticRelationsByObjectState(objectStateKey: $objectStateKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id relationState predicate relationTypeId relationTypeKey relationDomain subjectKind subjectId subjectLineageId subjectVersionNumber objectKind objectId objectLineageId objectVersionNumber subjectStateKey objectStateKey objectSubjectStateKey predicateObjectStateKey subjectVersionKey objectVersionKey score confidence rank classifierId modelVersion reviewRecommended sourceSnapshotId importRunId importedAt createdAt updatedAt newsroomFeedKey metadata }
      nextToken
    }
  }
`;

const NEWSROOM_SECTION_LIST_QUERY = `
  query ListNewsroomSections($limit: Int, $nextToken: String) {
    listNewsroomSections(limit: $limit, nextToken: $nextToken) {
      items {
        id
        title
        shortTitle
        type
        editorialMission
        editorialPolicy
        enabled
        enabledStatus
        sortOrder
        defaultArticleTypes
        defaultPageBudget
        assignmentGuidance
        killCriteria
        visualGuidance
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;

const LIST_STEERING_PROPOSALS_QUERY = `
  query ListSteeringProposals($limit: Int, $nextToken: String) {
    listSteeringProposals(limit: $limit, nextToken: $nextToken) {
      items {
        id
        categorySetId
        corpusId
        importRunId
        proposalKind
        steeringDomain
        status
        title
        summary
        categoryKey
        targetCategoryKey
        graphEntityId
        relationshipType
        displayName
        shortTitle
        subtitle
        description
        evidenceItemIds
        suggestedSeedItemIds
        suggestedHoldoutItemIds
        sourceSnapshotId
        proposedAt
        reviewedAt
        reviewedBy
        updatedAt
      }
      nextToken
    }
  }
`;

const MODEL_ATTACHMENTS_BY_OWNER_QUERY = `
  query ListModelAttachmentsByOwnerRoleAndSortKey($ownerId: ID!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String) {
    listModelAttachmentsByOwnerRoleAndSortKey(ownerId: $ownerId, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken) {
      items {
        id
        ownerKind
        ownerId
        ownerLineageId
        ownerVersionNumber
        ownerVersionKey
        role
        sortKey
        storagePath
        filename
        mediaType
        byteSize
        sha256
        etag
        importRunId
        createdAt
        updatedAt
        status
      }
      nextToken
    }
  }
`;

const GET_REFERENCE_QUERY = `
  query GetReference($id: ID!) {
    getReference(id: $id) {
      id
      lineageId
      versionNumber
      previousVersionId
      versionState
      versionCreatedAt
      versionCreatedBy
      changeReason
      contentHash
      corpusId
      externalItemId
      title
      authors
      sourceUri
      storagePath
      mediaType
      byteSize
      sha256
      sourcePublishedAt
      sourceUpdatedAt
      retrievedAt
      inboundCitationCount
      outboundCitationCount
      importRunId
      importedAt
      createdAt
      curationStatus
      curationStatusKey
      curationStatusUpdatedAt
      curationStatusUpdatedBy
      curationStatusReason
      newsroomFeedKey
      metadata
      updatedAt
    }
  }
`;

const LIST_REFERENCE_ATTACHMENTS_BY_REFERENCE_LINEAGE_AND_SORT_KEY_QUERY = `
  query ListReferenceAttachmentsByReferenceLineageAndSortKey($referenceLineageId: ID!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String) {
    listReferenceAttachmentsByReferenceLineageAndSortKey(referenceLineageId: $referenceLineageId, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken) {
      items {
        id
        referenceId
        referenceLineageId
        referenceVersionNumber
        referenceVersionKey
        role
        sortKey
        storagePath
        sourceUri
        filename
        mediaType
        byteSize
        sha256
        etag
        importRunId
        importedAt
        metadata
      }
      nextToken
    }
  }
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
      ok uploadId attachmentId ownerKind ownerId role sortKey method uploadUrl storagePath mediaType byteSize sha256 expiresAt requiredHeaders
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

const LIST_PROCEDURE_DEFINITIONS_QUERY = `
  query ListProcedureDefinitions {
    listNewsroomProcedureDefinitions
  }
`;

const GET_PROCEDURE_DEFINITION_QUERY = `
  query GetProcedureDefinition($id: ID, $procedureKey: String) {
    getNewsroomProcedureDefinition(id: $id, procedureKey: $procedureKey)
  }
`;

const SAVE_PROCEDURE_DEFINITION_MUTATION = `
  mutation SaveProcedureDefinition($input: AWSJSON!) {
    saveNewsroomProcedureDefinition(input: $input)
  }
`;

const SAVE_PROCEDURE_VERSION_DRAFT_MUTATION = `
  mutation SaveProcedureVersionDraft($input: AWSJSON!) {
    saveNewsroomProcedureVersionDraft(input: $input)
  }
`;

const PUBLISH_PROCEDURE_VERSION_MUTATION = `
  mutation PublishProcedureVersion($versionId: ID!) {
    publishNewsroomProcedureVersion(versionId: $versionId)
  }
`;

const START_PROCEDURE_RUN_MUTATION = `
  mutation StartProcedureRun(
    $procedureId: ID
    $procedureKey: String
    $procedureVersionId: ID
    $title: String
    $summary: String
    $input: AWSJSON
    $actorLabel: String
  ) {
    startNewsroomProcedureRun(
      procedureId: $procedureId
      procedureKey: $procedureKey
      procedureVersionId: $procedureVersionId
      title: $title
      summary: $summary
      input: $input
      actorLabel: $actorLabel
    )
  }
`;

type GraphQLListResponse<T> = {
  data?: T[] | null;
  nextToken?: string | null;
  errors?: unknown[] | null;
};

type ListableModel<T> = {
  list: (input?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<GraphQLListResponse<T>>;
};

export type NewsroomRecordPage<T> = {
  items: T[];
  nextToken?: string | null;
  hasMore: boolean;
};

type GraphQLConnectionResponse<T> = {
  data?: Record<string, { items?: Array<T | null> | null; nextToken?: string | null } | null> | null;
  errors?: unknown[] | null;
};

type ModelAttachmentUploadSlot = {
  ok: boolean;
  uploadId: string;
  requiredHeaders?: Record<string, string> | string | null;
  method?: string | null;
  uploadUrl: string;
};

type NewsroomPageOptions = {
  limit?: number;
  nextToken?: string | null;
};

type NewsroomMessagePageOptions = NewsroomPageOptions & {
  kind?: string;
  domain?: string;
  status?: string;
};

type NewsroomAssignmentPageOptions = NewsroomPageOptions & {
  type?: string;
  status?: string;
};

type NewsroomReferencePageOptions = NewsroomPageOptions & {
  status?: string;
  excludePending?: boolean;
  corpusId?: string;
};

type NewsroomSemanticNodePageOptions = NewsroomPageOptions & {
  nodeKind?: string;
  status?: string;
};

type NewsroomSemanticRelationPageOptions = NewsroomPageOptions & {
  relationTypeKey?: string;
  relationDomain?: string;
};

type SlugQueryableModel<T> = {
  itemBySlug?: (args: { slug: string }, options: Record<string, unknown>) => Promise<GraphQLListResponse<T>>;
};

type NewsroomSummaryResponse = {
  data?: unknown;
  errors?: unknown[] | null;
};

export type KnowledgeQueryResponse = {
  structured?: unknown;
  context?: {
    format?: string;
    text?: string;
    maxTokens?: number | null;
    totalTokens?: number | null;
    tokenizer?: unknown;
  } | null;
  warnings?: string[];
  provenance?: Record<string, unknown>;
  debug?: Record<string, unknown>;
};

export type EditorCategoryTreeState = {
  isEditor: boolean;
  appendix: NewsDeskAppendix | null;
  categoryTrees: CategorySteeringCategoryTree[];
  categoryNodes: CategorySteeringCategoryTreeNode[];
  error: string | null;
};

export type EditorNewsDeskState =
  | { status: "loading"; dashboard: null; error: null }
  | { status: "signedOut"; dashboard: null; error: null }
  | { status: "forbidden"; dashboard: null; error: null }
  | { status: "ready"; dashboard: CategorySteeringDashboard; error: null }
  | { status: "error"; dashboard: null; error: string };

export async function loadEditorAccessState(): Promise<{ isEditor: boolean; status: EditorAccessState["status"]; error: string | null }> {
  const auth = await loadEditorResolvedAccessState();
  return { isEditor: auth.isEditor, status: auth.status, error: auth.error };
}

export type EditorAccessState =
  | { status: "signedOut"; isEditor: false; isAdmin: false; auth: ReaderAuthSnapshot; error: null }
  | { status: "forbidden"; isEditor: false; isAdmin: false; auth: ReaderAuthSnapshot; error: null }
  | { status: "ready"; isEditor: true; isAdmin: boolean; auth: ReaderAuthSnapshot; error: null }
  | { status: "error"; isEditor: false; isAdmin: false; auth: ReaderAuthSnapshot; error: string };

export async function loadEditorNewsDeskState(): Promise<EditorNewsDeskState> {
  const auth = await loadEditorResolvedAccessState();
  if (auth.status === "signedOut" || auth.status === "forbidden") return { status: auth.status, dashboard: null, error: null };
  if (auth.status === "error") return { status: "error", dashboard: null, error: auth.error };

  try {
    return { status: "ready", dashboard: await loadEditorNewsDeskDashboard({ isAdmin: auth.isAdmin }), error: null };
  } catch (error) {
    return {
      status: "error",
      dashboard: null,
      error: error instanceof Error ? error.message : "Could not load Newsroom data.",
    };
  }
}

export async function loadEditorCategoryTreeState(options?: {
  scenarioAppendix?: NewsDeskAppendix | null;
  allowScenarioEditorOverride?: boolean;
}): Promise<EditorCategoryTreeState> {
  configureAmplifyClient();

  if (options?.allowScenarioEditorOverride && hasTestEditorOverride()) {
    const appendix = options.scenarioAppendix ?? null;
    return {
      isEditor: true,
      appendix,
      categoryTrees: appendix ? [categoryTreeFromAppendix(appendix)] : [],
      categoryNodes: appendix ? appendix.nodes.map(categoryTreeNodeFromAppendixNode) : [],
      error: null,
    };
  }

  const auth = await loadEditorResolvedAccessState();
  if (!auth.isEditor) {
    return { isEditor: false, appendix: null, categoryTrees: [], categoryNodes: [], error: auth.error };
  }

  try {
    const [categoryTrees, categoryNodes] = await Promise.all([
      listUserPoolModel<CategorySteeringCategoryTree>("CategorySet"),
      listUserPoolModel<CategorySteeringCategoryTreeNode>("Category"),
    ]);
    const sortedTaxonomies = sortTaxonomies(categoryTrees);
    const sortedNodes = sortCategoryTreeNodes(categoryNodes);
    const selectedCategoryTree = selectCurrentAcceptedCategoryTree(sortedTaxonomies);
    return {
      isEditor: true,
      appendix: selectedCategoryTree ? appendixFromCategoryTree(selectedCategoryTree, sortedNodes) : null,
      categoryTrees: sortedTaxonomies,
      categoryNodes: sortedNodes,
      error: null,
    };
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return { isEditor: false, appendix: null, categoryTrees: [], categoryNodes: [], error: null };
    }
    return {
      isEditor: false,
      appendix: null,
      categoryTrees: [],
      categoryNodes: [],
      error: error instanceof Error ? error.message : "Could not load editor categoryTree state.",
    };
  }
}

export async function loadEditorResolvedAccessState(): Promise<EditorAccessState> {
  if (hasTestEditorOverride()) {
    return {
      status: "ready",
      isEditor: true,
      isAdmin: true,
      auth: { status: "signedIn", label: "Test Editor" },
      error: null,
    };
  }
  try {
    const snapshot = await loadReaderSessionSnapshot();
    if (!snapshot.hasSession || snapshot.auth.status === "signedOut") {
      return { status: "signedOut", isEditor: false, isAdmin: false, auth: snapshot.auth, error: null };
    }
    const groups = snapshot.groups;
    if (!groups.includes("editor") && !groups.includes("admin")) {
      return { status: "forbidden", isEditor: false, isAdmin: false, auth: snapshot.auth, error: null };
    }
    return { status: "ready", isEditor: true, isAdmin: groups.includes("admin"), auth: snapshot.auth, error: null };
  } catch (error) {
    return {
      status: "error",
      isEditor: false,
      isAdmin: false,
      auth: { status: "signedOut", label: "Signed out" },
      error: error instanceof Error ? error.message : "Could not verify editor session.",
    };
  }
}

export async function loadEditorNewsDeskDashboard({ isAdmin }: { isAdmin: boolean }): Promise<CategorySteeringDashboard> {
  const testMock = getTestEditorNewsroomMock();
  if (testMock?.summary) {
    return {
      ...createSummaryCategorySteeringDashboard(normalizeNewsroomSummary(testMock.summary)),
      canManageUsers: isAdmin,
      userDirectory: [],
      loadError: null,
    };
  }
  const [summaryResult, userDirectoryResult] = await Promise.allSettled([
    loadNewsroomSummary(),
    isAdmin ? loadUserDirectory() : Promise.resolve([]),
  ]);
  const summaryError = summaryResult.status === "rejected" ? summaryResult.reason : null;
  if (summaryError && isUnauthenticatedError(summaryError)) {
    throw summaryError;
  }
  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const userDirectory = userDirectoryResult.status === "fulfilled" ? userDirectoryResult.value : [];

  if (summaryError || newsroomSummaryIsMissing(summary)) {
    return {
      ...createEmptyCategorySteeringDashboard(),
      isPublicSkeleton: false,
      summaryStatus: "missing",
      canManageUsers: isAdmin,
      userDirectory,
      loadError: null,
    };
  }

  return {
    ...createSummaryCategorySteeringDashboard(summary!),
    canManageUsers: isAdmin,
    userDirectory,
    loadError: null,
  };
}

export async function loadEditorFullNewsDeskDashboard({ isAdmin }: { isAdmin: boolean }): Promise<CategorySteeringDashboard> {
  const procedureDataPromise = isAdmin
    ? loadEditorProcedureData().catch(() => ({ definitions: [], versions: [], runs: [] }))
    : Promise.resolve<{ definitions: ProcedureDefinitionRecord[]; versions: ProcedureVersionRecord[]; runs: ProcedureRunRecord[] }>({
      definitions: [],
      versions: [],
      runs: [],
    });
  const [
    corpora,
    importRuns,
    categorySets,
    categorys,
    categoryKeywords,
    lexicalSteeringRules,
    proposals,
    artifacts,
    references,
    referenceAttachments,
    semanticNodes,
    messages,
    semanticRelations,
    assignmentState,
    newsroomSections,
    procedureData,
    userDirectory,
  ] = await Promise.all([
    loadDashboardSlice("KnowledgeCorpus", () => listUserPoolModel<CategorySteeringCorpus>("KnowledgeCorpus"), [] as CategorySteeringCorpus[]),
    loadDashboardSlice("KnowledgeImportRun", () => listUserPoolModel<CategorySteeringImportRun>("KnowledgeImportRun"), [] as CategorySteeringImportRun[]),
    loadDashboardSlice("CategorySet", () => listUserPoolModel<CategorySteeringCategorySet>("CategorySet"), [] as CategorySteeringCategorySet[]),
    loadDashboardSlice("Category", () => listUserPoolModel<CategorySteeringCategory>("Category"), [] as CategorySteeringCategory[]),
    loadDashboardSlice("CategoryKeyword", () => listOptionalUserPoolModel<CategoryKeywordRecord>("CategoryKeyword"), [] as CategoryKeywordRecord[]),
    loadDashboardSlice("LexicalSteeringRule", () => listOptionalUserPoolModel<LexicalSteeringRuleRecord>("LexicalSteeringRule"), [] as LexicalSteeringRuleRecord[]),
    loadDashboardSlice("SteeringProposal", () => listSteeringProposalsViaGraphql(), [] as CategorySteeringProposal[]),
    loadDashboardSlice("KnowledgeArtifact", () => listUserPoolModel<CategorySteeringArtifact>("KnowledgeArtifact"), [] as CategorySteeringArtifact[]),
    loadDashboardSlice("Reference", () => listUserPoolModel<ReferenceRecord>("Reference"), [] as ReferenceRecord[]),
    loadDashboardSlice("ReferenceAttachment", () => listUserPoolModel<ReferenceAttachmentRecord>("ReferenceAttachment"), [] as ReferenceAttachmentRecord[]),
    loadDashboardSlice("SemanticNode", () => listUserPoolModel<SemanticNodeRecord>("SemanticNode"), [] as SemanticNodeRecord[]),
    loadDashboardSlice("Message", () => listUserPoolModel<MessageRecord>("Message"), [] as MessageRecord[]),
    loadDashboardSlice("SemanticRelation", () => listUserPoolModel<SemanticRelationRecord>("SemanticRelation"), [] as SemanticRelationRecord[]),
    loadDashboardSlice("Assignments", () => loadEditorAssignmentsData(), { assignments: [], assignmentEvents: [] }),
    loadDashboardSlice("NewsroomSection", () => listOptionalUserPoolModel<NewsroomSectionRecord>("NewsroomSection"), [] as NewsroomSectionRecord[]),
    procedureDataPromise,
    loadDashboardSlice("UserDirectory", () => (isAdmin ? loadUserDirectory() : Promise.resolve([])), [] as UserDirectoryEntry[]),
  ]);

  const sortedCorpora = corpora.sort((left, right) => left.name.localeCompare(right.name));
  const sortedImportRuns = importRuns.sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  const sortedCategorySets = sortCategorySets(categorySets, sortedImportRuns);
  const canonicalCategorySet = selectCanonicalCategorySet(sortedCorpora, sortedCategorySets);
  const sortedCategorys = sortCategorys(categorys);
  const sortedCategoryNodes = sortCategoryTreeNodes(categorys);
  const acceptedDoctrineCategories = selectAcceptedCategoriesForDoctrine({
    categorys: sortedCategorys,
    categoryNodes: sortedCategoryNodes,
    categorySetId: canonicalCategorySet?.id ?? null,
  });
  const doctrineRecords = await loadDoctrineRecords(acceptedDoctrineCategories);
  const sortedNewsroomSections = sortNewsroomSections(newsroomSections);

  return {
    canonicalCorpusId: canonicalCategorySet?.corpusId ?? selectCanonicalCorpus(sortedCorpora)?.id ?? null,
    canonicalCategorySetId: canonicalCategorySet?.id ?? null,
    canManageUsers: isAdmin,
    userDirectory,
    corpora: sortedCorpora,
    importRuns: sortedImportRuns,
    categorySets: sortedCategorySets,
    categorys: sortedCategorys,
    categoryTrees: sortTaxonomies(categorySets),
    categoryNodes: sortedCategoryNodes,
    categoryKeywords: categoryKeywords.sort((left, right) => keywordSortKey(left).localeCompare(keywordSortKey(right))),
    lexicalSteeringRules: lexicalSteeringRules.sort((left, right) => lexicalRuleSortKey(left).localeCompare(lexicalRuleSortKey(right))),
    proposals: sortProposals(proposals),
    artifacts: artifacts.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "")),
    references: references.sort((left, right) => (right.importedAt ?? "").localeCompare(left.importedAt ?? "")),
    referenceAttachments: referenceAttachments.sort((left, right) => left.sortKey.localeCompare(right.sortKey)),
    semanticNodes: semanticNodes.sort((left, right) => (left.displayName ?? left.nodeKey).localeCompare(right.displayName ?? right.nodeKey)),
    messages: messages.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    semanticRelations: semanticRelations.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)),
    assignments: assignmentState.assignments,
    assignmentEvents: assignmentState.assignmentEvents,
    doctrineRecords,
    newsroomSections: sortedNewsroomSections,
    procedureDefinitions: procedureData.definitions,
    procedureVersions: procedureData.versions,
    procedureRuns: procedureData.runs,
    loadError: null,
  };
}

async function loadDashboardSlice<T>(label: string, loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    console.warn(`Newsroom dashboard slice failed: ${label}`, error);
    return fallback;
  }
}

export async function loadEditorProcedureData(): Promise<{
  definitions: ProcedureDefinitionRecord[];
  versions: ProcedureVersionRecord[];
  runs: ProcedureRunRecord[];
}> {
  const dataClient = generateClient<Schema>();
  const graphClient = dataClient as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> | null; errors?: unknown[] | null }>;
  };
  const response = await graphClient.graphql({
    query: LIST_PROCEDURE_DEFINITIONS_QUERY,
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(response.errors);
  const payload = normalizeJsonValue(response.data?.listNewsroomProcedureDefinitions);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const definitions: ProcedureDefinitionRecord[] = [];
  const versions: ProcedureVersionRecord[] = [];
  const runs: ProcedureRunRecord[] = [];
  const versionIds = new Set<string>();
  const runIds = new Set<string>();
  const hydrateDefinitionIds: string[] = [];

  const pushVersion = (value: unknown) => {
    const normalized = normalizeJsonValue(value);
    if (!normalized?.id || !normalized?.procedureId) return;
    const id = String(normalized.id);
    if (versionIds.has(id)) return;
    versionIds.add(id);
    versions.push(normalized as ProcedureVersionRecord);
  };

  const pushRun = (value: unknown) => {
    const normalized = normalizeJsonValue(value);
    if (!normalized?.id || !normalized?.procedureId) return;
    const id = String(normalized.id);
    if (runIds.has(id)) return;
    runIds.add(id);
    runs.push(normalized as ProcedureRunRecord);
  };

  for (const item of items) {
    const row = normalizeJsonValue(item);
    if (!row || !row.id || !row.procedureKey) continue;
    definitions.push(row as ProcedureDefinitionRecord);
    pushVersion(row.currentVersion);
    const rowVersions = Array.isArray(row.versions) ? row.versions : [];
    for (const version of rowVersions) pushVersion(version);
    if (rowVersions.length === 0) hydrateDefinitionIds.push(String(row.id));
    const rowRuns = Array.isArray(row.recentRuns) ? row.recentRuns : [];
    for (const run of rowRuns) pushRun(run);
  }

  if (hydrateDefinitionIds.length > 0) {
    await Promise.all(hydrateDefinitionIds.map(async (definitionId) => {
      const detailResponse = await graphClient.graphql({
        query: GET_PROCEDURE_DEFINITION_QUERY,
        variables: { id: definitionId },
        authMode: USER_POOL_AUTH_MODE,
      });
      assertNoGraphQLErrors(detailResponse.errors);
      const detail = normalizeJsonValue(detailResponse.data?.getNewsroomProcedureDefinition);
      if (!detail) return;
      pushVersion(detail.currentVersion);
      const detailVersions = Array.isArray(detail.versions) ? detail.versions : [];
      for (const version of detailVersions) pushVersion(version);
      const detailRuns = Array.isArray(detail.recentRuns) ? detail.recentRuns : [];
      for (const run of detailRuns) pushRun(run);
    }));
  }

  return {
    definitions: definitions.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")),
    versions: versions.sort((left, right) => (right.versionNumber ?? 0) - (left.versionNumber ?? 0)),
    runs: runs.sort((left, right) => (right.requestedAt ?? "").localeCompare(left.requestedAt ?? "")),
  };
}

export async function saveProcedureDefinitionRecord(input: Record<string, unknown>) {
  const dataClient = generateClient<Schema>();
  const graphClient = dataClient as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> | null; errors?: unknown[] | null }>;
  };
  const response = await graphClient.graphql({
    query: SAVE_PROCEDURE_DEFINITION_MUTATION,
    variables: { input },
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(response.errors);
  return normalizeJsonValue(response.data?.saveNewsroomProcedureDefinition);
}

export async function saveProcedureVersionDraftRecord(input: Record<string, unknown>) {
  const dataClient = generateClient<Schema>();
  const graphClient = dataClient as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> | null; errors?: unknown[] | null }>;
  };
  const response = await graphClient.graphql({
    query: SAVE_PROCEDURE_VERSION_DRAFT_MUTATION,
    variables: { input },
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(response.errors);
  return normalizeJsonValue(response.data?.saveNewsroomProcedureVersionDraft);
}

export async function publishProcedureVersionRecord(versionId: string) {
  const dataClient = generateClient<Schema>();
  const graphClient = dataClient as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> | null; errors?: unknown[] | null }>;
  };
  const response = await graphClient.graphql({
    query: PUBLISH_PROCEDURE_VERSION_MUTATION,
    variables: { versionId },
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(response.errors);
  return normalizeJsonValue(response.data?.publishNewsroomProcedureVersion);
}

export async function startProcedureRunRecord(input: {
  procedureId?: string;
  procedureKey?: string;
  procedureVersionId?: string;
  title?: string;
  summary?: string;
  actorLabel?: string;
  parameters?: Record<string, unknown>;
}) {
  const dataClient = generateClient<Schema>();
  const graphClient = dataClient as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> | null; errors?: unknown[] | null }>;
  };
  const response = await graphClient.graphql({
    query: START_PROCEDURE_RUN_MUTATION,
    variables: {
      procedureId: input.procedureId,
      procedureKey: input.procedureKey,
      procedureVersionId: input.procedureVersionId,
      title: input.title,
      summary: input.summary,
      actorLabel: input.actorLabel,
      input: input.parameters ?? {},
    },
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(response.errors);
  return normalizeJsonValue(response.data?.startNewsroomProcedureRun);
}

export async function loadEditorMessagesData(): Promise<MessageRecord[]> {
  const testMock = getTestEditorNewsroomMock();
  if (testMock?.messages) return testMock.messages;
  const page = await loadNewsroomMessagePage();
  return page.items;
}

export async function loadNewsroomMessagePage(options: NewsroomMessagePageOptions = {}): Promise<NewsroomRecordPage<MessageRecord>> {
  return loadNewsroomFeedPage<MessageRecord>({
    query: NEWSROOM_MESSAGE_FEED_QUERY,
    field: "listMessagesByNewsroomFeedAndCreatedAt",
    newsroomFeedKey: "messages",
    limit: options.limit,
    nextToken: options.nextToken,
    matches: equalityMatcher({
      messageKind: options.kind,
      messageDomain: options.domain,
      status: options.status,
    }),
  });
}

export async function loadEditorReferencesData(): Promise<{
  references: ReferenceRecord[];
  referenceAttachments: ReferenceAttachmentRecord[];
}> {
  const testMock = getTestEditorNewsroomMock();
  if (testMock?.references || testMock?.referenceAttachments) {
    const referenceAttachments = (testMock.referenceAttachments ?? [])
      .slice()
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    if (testMock.references) {
      return {
        references: testMock.references,
        referenceAttachments,
      };
    }
    const referencePage = await loadNewsroomReferencePage();
    return {
      references: referencePage.items,
      referenceAttachments,
    };
  }
  const [referencePage, referenceAttachments] = await Promise.all([
    loadNewsroomReferencePage(),
    listUserPoolModel<ReferenceAttachmentRecord>("ReferenceAttachment"),
  ]);
  return {
    references: referencePage.items,
    referenceAttachments: referenceAttachments.sort((left, right) => left.sortKey.localeCompare(right.sortKey)),
  };
}

export async function loadNewsroomReferencePage(options: NewsroomReferencePageOptions = {}): Promise<NewsroomRecordPage<ReferenceRecord>> {
  return loadNewsroomFeedPage<ReferenceRecord>({
    query: NEWSROOM_REFERENCE_FEED_QUERY,
    field: "listReferencesByNewsroomFeedAndCreatedAt",
    newsroomFeedKey: "references",
    limit: options.limit,
    nextToken: options.nextToken,
    matches: (item) => {
      const status = String(item.curationStatus ?? "").trim() || "pending";
      if (options.status && status !== options.status) return false;
      if (options.excludePending && status === "pending") return false;
      if (options.corpusId && item.corpusId !== options.corpusId) return false;
      return true;
    },
  });
}

export async function loadEditorSemanticRelationsData(): Promise<SemanticRelationRecord[]> {
  const testMock = getTestEditorNewsroomMock();
  if (testMock?.semanticRelations) return testMock.semanticRelations;
  const rows: SemanticRelationRecord[] = [];
  const seenIds = new Set<string>();
  let nextToken: string | null | undefined = null;
  let pageCount = 0;

  do {
    const page = await loadNewsroomSemanticRelationPage({ nextToken });
    for (const relation of page.items) {
      if (!relation?.id || seenIds.has(relation.id)) continue;
      seenIds.add(relation.id);
      rows.push(relation);
    }
    nextToken = page.nextToken;
    pageCount += 1;
  } while (nextToken && pageCount < 40);

  return rows;
}

export async function loadNewsroomSemanticRelationPage(options: NewsroomSemanticRelationPageOptions = {}): Promise<NewsroomRecordPage<SemanticRelationRecord>> {
  return loadNewsroomFeedPage<SemanticRelationRecord>({
    query: NEWSROOM_SEMANTIC_RELATION_FEED_QUERY,
    field: "listSemanticRelationsByNewsroomFeedAndCreatedAt",
    newsroomFeedKey: "semanticRelations",
    limit: options.limit,
    nextToken: options.nextToken,
    matches: equalityMatcher({
      relationTypeKey: options.relationTypeKey,
      relationDomain: options.relationDomain,
    }),
  });
}

export async function loadReferenceCitationRelations(reference: {
  id?: string | null;
  lineageId?: string | null;
}): Promise<{
  incoming: SemanticRelationRecord[];
  outgoing: SemanticRelationRecord[];
}> {
  const referenceKeys = Array.from(new Set([
    String(reference.lineageId || "").trim(),
    String(reference.id || "").trim(),
  ].filter(Boolean)));
  const stateKeys = referenceKeys.map((value) => `reference#${value}#current`);
  const [outgoingPages, incomingPages] = await Promise.all([
    Promise.all(stateKeys.map((stateKey) => loadSemanticRelationsByState({
      field: "listSemanticRelationsBySubjectState",
      keyName: "subjectStateKey",
      keyValue: stateKey,
      query: LIST_SEMANTIC_RELATIONS_BY_SUBJECT_STATE_QUERY,
    }))),
    Promise.all(stateKeys.map((stateKey) => loadSemanticRelationsByState({
      field: "listSemanticRelationsByObjectState",
      keyName: "objectStateKey",
      keyValue: stateKey,
      query: LIST_SEMANTIC_RELATIONS_BY_OBJECT_STATE_QUERY,
    }))),
  ]);
  const outgoing = dedupeSemanticRelationsById(outgoingPages.flat());
  const incoming = dedupeSemanticRelationsById(incomingPages.flat());
  return {
    outgoing: outgoing.filter((relation) => (
      relation.subjectKind === "reference"
      && relation.objectKind === "reference"
      && relationTypeKey(relation) === "cites"
      && relation.relationState === "current"
    )),
    incoming: incoming.filter((relation) => (
      relation.subjectKind === "reference"
      && relation.objectKind === "reference"
      && relationTypeKey(relation) === "cites"
      && relation.relationState === "current"
    )),
  };
}

export async function loadEditorAssignmentsData(): Promise<{
  assignments: AssignmentRecord[];
  assignmentEvents: AssignmentEventRecord[];
}> {
  const [assignmentPage, assignmentEvents] = await Promise.all([
    loadNewsroomAssignmentPage(),
    listOptionalUserPoolModelPage<AssignmentEventRecord>("AssignmentEvent", USER_POOL_PAGE_LIMIT),
  ]);
  return {
    assignments: assignmentPage.items,
    assignmentEvents: assignmentEvents.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}

export async function loadNewsroomAssignmentPage(options: NewsroomAssignmentPageOptions = {}): Promise<NewsroomRecordPage<AssignmentRecord>> {
  return loadNewsroomFeedPage<AssignmentRecord>({
    query: NEWSROOM_ASSIGNMENT_FEED_QUERY,
    field: "listAssignmentsByNewsroomFeedAndCreatedAt",
    newsroomFeedKey: "assignments",
    limit: options.limit,
    nextToken: options.nextToken,
    matches: equalityMatcher({
      assignmentTypeKey: options.type,
      status: options.status,
    }),
  });
}

export async function loadModelPayloadsForOwner(
  ownerKind: string,
  ownerId: string,
  roles?: string[],
): Promise<HydratedModelPayload[]> {
  const testMock = getTestEditorNewsroomMock();
  const mockPayloads = testMock?.payloads?.[`${ownerKind}:${ownerId}`];
  if (mockPayloads) {
    const allowedRoles = new Set((roles ?? []).filter(Boolean));
    return mockPayloads.filter((payload) => !allowedRoles.size || allowedRoles.has(payload.attachment.role));
  }
  configureAmplifyClient();
  const client = generateClient<Schema>() as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<GraphQLConnectionResponse<ModelAttachmentRecord>>;
  };
  const allowedRoles = new Set((roles ?? []).filter(Boolean));
  const attachments: ModelAttachmentRecord[] = [];
  let nextToken: string | null | undefined = null;

  do {
    const response = await client.graphql({
      query: MODEL_ATTACHMENTS_BY_OWNER_QUERY,
      variables: {
        ownerId,
        sortDirection: "ASC",
        limit: USER_POOL_PAGE_LIMIT,
        nextToken,
      },
      authMode: USER_POOL_AUTH_MODE,
    });
    assertNoGraphQLErrors(response.errors);
    const connection = response.data?.listModelAttachmentsByOwnerRoleAndSortKey;
    attachments.push(...((connection?.items ?? []).filter(Boolean) as ModelAttachmentRecord[])
      .filter((attachment) => attachment.ownerKind === ownerKind)
      .filter((attachment) => !allowedRoles.size || allowedRoles.has(attachment.role)));
    nextToken = connection?.nextToken ?? null;
  } while (nextToken);

  return Promise.all(attachments.map(hydrateModelAttachment));
}

export async function loadReferenceRecordById(id: string): Promise<ReferenceRecord | null> {
  const testMock = getTestEditorNewsroomMock();
  if (testMock?.references) {
    return testMock.references.find((reference) => reference.id === id || reference.lineageId === id) ?? null;
  }
  configureAmplifyClient();
  const client = generateClient<Schema>() as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<{
      data?: { getReference?: ReferenceRecord | null } | null;
      errors?: unknown[] | null;
    }>;
  };
  const response = await client.graphql({
    query: GET_REFERENCE_QUERY,
    variables: { id },
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(response.errors);
  return response.data?.getReference ?? null;
}

export async function loadReferenceAttachmentsForLineageId(referenceLineageId: string): Promise<ReferenceAttachmentRecord[]> {
  if (!referenceLineageId) return [];
  const testMock = getTestEditorNewsroomMock();
  if (testMock?.referenceAttachments) {
    return testMock.referenceAttachments
      .filter((attachment) => attachment.referenceLineageId === referenceLineageId)
      .slice()
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  }
  configureAmplifyClient();
  const client = generateClient<Schema>() as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<{
      data?: {
        listReferenceAttachmentsByReferenceLineageAndSortKey?: {
          items?: ReferenceAttachmentRecord[] | null;
          nextToken?: string | null;
        } | null;
      } | null;
      errors?: unknown[] | null;
    }>;
  };
  const attachments: ReferenceAttachmentRecord[] = [];
  let nextToken: string | null | undefined = null;
  do {
    const response = await client.graphql({
      query: LIST_REFERENCE_ATTACHMENTS_BY_REFERENCE_LINEAGE_AND_SORT_KEY_QUERY,
      variables: {
        referenceLineageId,
        sortDirection: "ASC",
        limit: USER_POOL_PAGE_LIMIT,
        nextToken,
      },
      authMode: USER_POOL_AUTH_MODE,
    });
    assertNoGraphQLErrors(response.errors);
    const connection = response.data?.listReferenceAttachmentsByReferenceLineageAndSortKey;
    attachments.push(...((connection?.items ?? []).filter(Boolean) as ReferenceAttachmentRecord[]));
    nextToken = connection?.nextToken ?? null;
  } while (nextToken);
  return attachments.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

export async function uploadModelPayloadForOwner(input: {
  ownerKind: string;
  ownerId: string;
  ownerLineageId?: string | null;
  ownerVersionNumber?: number | null;
  ownerVersionKey?: string | null;
  role: string;
  sortKey?: string | null;
  filename: string;
  mediaType: string;
  content: string | Blob | ArrayBuffer | Uint8Array;
  importRunId?: string | null;
  status?: string | null;
}): Promise<ModelAttachmentRecord> {
  configureAmplifyClient();
  const client = generateClient<Schema>() as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<{
      data?: {
        createModelAttachmentUpload?: ModelAttachmentUploadSlot | null;
        completeModelAttachmentUpload?: ModelAttachmentRecord | null;
      } | null;
      errors?: unknown[] | null;
    }>;
  };
  const uploadBody = await normalizeUploadBody(input.content);
  const variables = {
    ownerKind: input.ownerKind,
    ownerId: input.ownerId,
    ownerLineageId: input.ownerLineageId ?? null,
    ownerVersionNumber: input.ownerVersionNumber ?? null,
    ownerVersionKey: input.ownerVersionKey ?? null,
    role: input.role,
    sortKey: input.sortKey ?? input.role,
    filename: input.filename,
    mediaType: input.mediaType,
    byteSize: uploadBody.byteSize,
    sha256: await sha256Hex(uploadBody.body),
    importRunId: input.importRunId ?? null,
    status: input.status ?? "active",
  };
  const slotResponse = await client.graphql({
    query: CREATE_MODEL_ATTACHMENT_UPLOAD_MUTATION,
    variables,
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(slotResponse.errors);
  const slot = slotResponse.data?.createModelAttachmentUpload;
  if (!slot?.uploadUrl) throw new Error("Attachment upload slot did not include an upload URL.");
  const uploadResponse = await fetch(slot.uploadUrl, {
    method: slot.method ?? "PUT",
    headers: normalizeUploadHeaders(slot.requiredHeaders),
    body: uploadBody.body,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Attachment upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }
  const completeResponse = await client.graphql({
    query: COMPLETE_MODEL_ATTACHMENT_UPLOAD_MUTATION,
    variables: { uploadId: slot.uploadId, ...variables },
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(completeResponse.errors);
  const attachment = completeResponse.data?.completeModelAttachmentUpload;
  if (!attachment) throw new Error("Attachment upload completed without a ModelAttachment record.");
  return attachment;
}

async function hydrateModelAttachment(attachment: ModelAttachmentRecord): Promise<HydratedModelPayload> {
  try {
    const text = attachment.storagePath?.startsWith("newsroom/payloads/")
      ? await downloadModelAttachmentText(attachment)
      : await downloadStoragePathTextRaw(attachment.storagePath);
    const json = text && isJsonMediaType(attachment.mediaType) ? parseAttachmentJson(text) : null;
    return { attachment, text, json, error: null };
  } catch (error) {
    return {
      attachment,
      text: null,
      json: null,
      error: error instanceof Error ? error.message : "Could not hydrate attachment payload.",
    };
  }
}

export async function loadStoragePathText(path: string | null | undefined): Promise<{ error: string | null; text: string | null }> {
  if (!path) {
    return { error: "Extracted text attachment is missing a storage path.", text: null };
  }
  const testMock = getTestEditorNewsroomMock();
  const mockText = testMock?.storageTextByPath?.[path];
  if (typeof mockText === "string") {
    return { error: null, text: mockText };
  }
  try {
    const text = await downloadStoragePathTextRaw(path);
    return { error: null, text };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not load extracted text.",
      text: null,
    };
  }
}

export async function loadStoragePathUrl(path: string | null | undefined): Promise<{ error: string | null; url: string | null }> {
  if (!path) {
    return { error: "Attachment is missing a storage path.", url: null };
  }
  const testMock = getTestEditorNewsroomMock();
  const mockUrl = testMock?.storageUrlByPath?.[path];
  if (typeof mockUrl === "string" && mockUrl.trim().length > 0) {
    return { error: null, url: mockUrl };
  }
  try {
    configureAmplifyClient();
    const signed = await getUrl({
      path,
      options: { validateObjectExistence: true },
    });
    const url = signed?.url ? signed.url.toString() : null;
    if (!url) {
      return { error: "Could not resolve attachment URL.", url: null };
    }
    return { error: null, url };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not resolve attachment URL.",
      url: null,
    };
  }
}

async function downloadStoragePathTextRaw(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const downloaded = await downloadData({ path }).result;
  const body = downloaded.body as { text?: () => Promise<string> };
  return typeof body.text === "function" ? await body.text() : null;
}

async function downloadModelAttachmentText(attachment: ModelAttachmentRecord): Promise<string | null> {
  if (!attachment.id) return null;
  configureAmplifyClient();
  const client = generateClient<Schema>() as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<{
      data?: {
        createModelAttachmentDownload?: {
          downloadUrl?: string | null;
          method?: string | null;
          requiredHeaders?: Record<string, string> | string | null;
        } | null;
      } | null;
      errors?: unknown[] | null;
    }>;
  };
  const response = await client.graphql({
    query: CREATE_MODEL_ATTACHMENT_DOWNLOAD_MUTATION,
    variables: { attachmentId: attachment.id },
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(response.errors);
  const slot = response.data?.createModelAttachmentDownload;
  const downloadUrl = slot?.downloadUrl;
  if (!downloadUrl) return downloadStoragePathTextRaw(attachment.storagePath);
  const fetchResponse = await fetch(downloadUrl, {
    method: slot?.method ?? "GET",
    headers: normalizeUploadHeaders(slot?.requiredHeaders),
    cache: "no-store",
  });
  if (!fetchResponse.ok) {
    throw new Error(`Attachment download failed: ${fetchResponse.status} ${fetchResponse.statusText}`);
  }
  return fetchResponse.text();
}

async function normalizeUploadBody(content: string | Blob | ArrayBuffer | Uint8Array): Promise<{ body: Blob; byteSize: number }> {
  if (typeof content === "string") {
    const body = new Blob([content]);
    return { body, byteSize: body.size };
  }
  if (content instanceof Blob) return { body: content, byteSize: content.size };
  const body = new Blob([content instanceof Uint8Array ? content.slice() : content]);
  return { body, byteSize: body.size };
}

async function sha256Hex(body: Blob): Promise<string> {
  const bytes = await body.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeUploadHeaders(value: Record<string, string> | string | null | undefined): Record<string, string> {
  const parsed = typeof value === "string" ? parseAttachmentJson(value) : value;
  const headers: Record<string, string> = {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return headers;
  for (const [key, entry] of Object.entries(parsed)) {
    if (entry !== undefined && entry !== null) headers[key] = String(entry);
  }
  return headers;
}

function isJsonMediaType(mediaType: string | null | undefined): boolean {
  const normalized = (mediaType ?? "").toLowerCase();
  return normalized.includes("json") || normalized.endsWith("+json");
}

function parseAttachmentJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function loadNewsroomSemanticNodePage(options: NewsroomSemanticNodePageOptions = {}): Promise<NewsroomRecordPage<SemanticNodeRecord>> {
  return loadNewsroomFeedPage<SemanticNodeRecord>({
    query: NEWSROOM_SEMANTIC_NODE_FEED_QUERY,
    field: "listSemanticNodesByNewsroomFeedAndCreatedAt",
    newsroomFeedKey: "semanticNodes",
    limit: options.limit,
    nextToken: options.nextToken,
    matches: equalityMatcher({
      nodeKind: options.nodeKind,
      status: options.status,
    }),
  });
}

export async function loadEditorDoctrineRecordsData(options?: {
  dashboard?: Pick<CategorySteeringDashboard, "categorys" | "categoryNodes" | "canonicalCategorySetId"> | null;
  doctrineCategories?: DoctrineCategory[];
}): Promise<DoctrineRecord[]> {
  const doctrineCategories = options?.doctrineCategories
    ?? (options?.dashboard
      ? selectAcceptedCategoriesForDoctrine({
        categorys: options.dashboard.categorys,
        categoryNodes: options.dashboard.categoryNodes,
        categorySetId: options.dashboard.canonicalCategorySetId ?? null,
      })
      : []);
  return loadDoctrineRecords(doctrineCategories);
}

export async function loadEditorUserDirectoryData(): Promise<UserDirectoryEntry[]> {
  return loadUserDirectory();
}

export async function runNewsroomKnowledgeQuery(input: Record<string, unknown>): Promise<KnowledgeQueryResponse> {
  const client = generateClient<Schema>();
  const query = client.queries.knowledgeQuery as unknown as (
    args: { input: string },
    options: { authMode: typeof USER_POOL_AUTH_MODE },
  ) => Promise<{ data?: unknown; errors?: unknown[] | null }>;
  const response = await query({ input: JSON.stringify(input) }, { authMode: USER_POOL_AUTH_MODE });
  assertNoGraphQLErrors(response.errors);
  return normalizeKnowledgeQueryResponse(response.data);
}

export function hasTestEditorOverride(): boolean {
  if (typeof window === "undefined") return false;
  const allowOverride = process.env.NODE_ENV === "test"
    || process.env.NEXT_PUBLIC_ENABLE_TEST_EDITOR_OVERRIDE === "true";
  if (!allowOverride) return false;
  return window.localStorage.getItem(TEST_EDITOR_STORAGE_KEY) === "true";
}

type TestEditorNewsroomMock = {
  messages?: MessageRecord[];
  payloads?: Record<string, HydratedModelPayload[]>;
  referenceAttachments?: ReferenceAttachmentRecord[];
  references?: ReferenceRecord[];
  semanticRelations?: SemanticRelationRecord[];
  storageTextByPath?: Record<string, string>;
  storageUrlByPath?: Record<string, string>;
  summary?: unknown;
};

function getTestEditorNewsroomMock(): TestEditorNewsroomMock | null {
  if (!hasTestEditorOverride() || typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(TEST_EDITOR_NEWSROOM_MOCK_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as TestEditorNewsroomMock;
  } catch {
    return null;
  }
}

function normalizeKnowledgeQueryResponse(value: unknown): KnowledgeQueryResponse {
  let parsed = value;
  if (typeof parsed === "string") {
    const rawText = parsed;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { warnings: ["knowledgeQuery returned non-JSON text"], context: { format: "markdown", text: rawText } };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { warnings: ["knowledgeQuery returned an empty response"], context: null };
  }
  const record = parsed as KnowledgeQueryResponse;
  return {
    structured: record.structured,
    context: record.context ?? null,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((warning): warning is string => typeof warning === "string") : [],
    provenance: record.provenance && typeof record.provenance === "object" && !Array.isArray(record.provenance) ? record.provenance as Record<string, unknown> : {},
    debug: record.debug && typeof record.debug === "object" && !Array.isArray(record.debug) ? record.debug as Record<string, unknown> : {},
  };
}

async function loadNewsroomSummary(): Promise<NewsroomSummaryRecord> {
  const client = generateClient<Schema>();
  const response = await (client.queries.getNewsroomSummary as unknown as (
    args: Record<string, never>,
    options: { authMode: typeof USER_POOL_AUTH_MODE },
  ) => Promise<NewsroomSummaryResponse>)({}, { authMode: USER_POOL_AUTH_MODE });
  assertNoGraphQLErrors(response.errors);
  return normalizeNewsroomSummary(response.data);
}

function createSummaryCategorySteeringDashboard(summary: NewsroomSummaryRecord): CategorySteeringDashboard {
  const latestImportRun = summary.latestImportRun;
  return {
    ...createEmptyCategorySteeringDashboard(),
    isPublicSkeleton: false,
    summaryStatus: "ready",
    summary,
    importRuns: latestImportRun ? [latestImportRun] : [],
    loadError: null,
  };
}

function newsroomSummaryIsMissing(summary: NewsroomSummaryRecord | null | undefined): boolean {
  return (summary?.source ?? "").trim().toLowerCase() === "missing";
}

function normalizeNewsroomSummary(value: unknown): NewsroomSummaryRecord {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : new Date().toISOString(),
    staleAt: typeof record.staleAt === "string" ? record.staleAt : null,
    source: typeof record.source === "string" ? record.source : null,
    latestImportRun: normalizeLatestImportRun(record.latestImportRun),
    counts: numberRecord(record.counts),
    facets: normalizeSummaryFacets(record.facets, record),
    assignmentStatusCounts: numberRecord(record.assignmentStatusCounts),
    assignmentTypeCounts: numberRecord(record.assignmentTypeCounts),
    referenceStatusCounts: numberRecord(record.referenceStatusCounts),
    messageKindCounts: numberRecord(record.messageKindCounts),
    messageDomainCounts: numberRecord(record.messageDomainCounts),
  };
}

function normalizeSummaryFacets(value: unknown, legacy: Record<string, unknown>) {
  const parsed = parseJsonish(value);
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  return {
    assignments: {
      byStatus: { ...numberRecord(legacy.assignmentStatusCounts), ...sectionCounts(record.assignments, "byStatus") },
      byType: { ...numberRecord(legacy.assignmentTypeCounts), ...sectionCounts(record.assignments, "byType") },
      statusByType: nestedCounts(record.assignments, "statusByType"),
    },
    messages: {
      byKind: { ...numberRecord(legacy.messageKindCounts), ...sectionCounts(record.messages, "byKind") },
      byDomain: { ...numberRecord(legacy.messageDomainCounts), ...sectionCounts(record.messages, "byDomain") },
      byStatus: sectionCounts(record.messages, "byStatus"),
      domainByKind: nestedCounts(record.messages, "domainByKind"),
    },
    references: {
      byCurationStatus: { ...numberRecord(legacy.referenceStatusCounts), ...sectionCounts(record.references, "byCurationStatus") },
      byCorpus: sectionCounts(record.references, "byCorpus"),
      statusByCorpus: nestedCounts(record.references, "statusByCorpus"),
    },
    semanticNodes: {
      byNodeKind: sectionCounts(record.semanticNodes, "byNodeKind"),
      byStatus: sectionCounts(record.semanticNodes, "byStatus"),
      byCorpus: sectionCounts(record.semanticNodes, "byCorpus"),
      byCategorySet: sectionCounts(record.semanticNodes, "byCategorySet"),
    },
    semanticRelations: {
      byRelationTypeKey: sectionCounts(record.semanticRelations, "byRelationTypeKey"),
      byRelationDomain: sectionCounts(record.semanticRelations, "byRelationDomain"),
      bySubjectKind: sectionCounts(record.semanticRelations, "bySubjectKind"),
      byObjectKind: sectionCounts(record.semanticRelations, "byObjectKind"),
    },
    imports: {
      byCorpus: sectionCounts(record.imports, "byCorpus"),
    },
  };
}

function sectionCounts(section: unknown, key: string): Record<string, number> {
  const record = parseJsonish(section);
  return record && typeof record === "object" && !Array.isArray(record)
    ? numberRecord((record as Record<string, unknown>)[key])
    : {};
}

function nestedCounts(section: unknown, key: string): Record<string, Record<string, number>> {
  const record = parseJsonish(section);
  const value = record && typeof record === "object" && !Array.isArray(record) ? (record as Record<string, unknown>)[key] : null;
  const parsed = parseJsonish(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: Record<string, Record<string, number>> = {};
  for (const [outerKey, inner] of Object.entries(parsed as Record<string, unknown>)) {
    result[outerKey] = numberRecord(inner);
  }
  return result;
}

function normalizeLatestImportRun(value: unknown): CategorySteeringImportRun | null {
  const parsed = parseJsonish(value);
  return parsed && typeof parsed === "object" && typeof (parsed as { id?: unknown }).id === "string"
    ? parsed as CategorySteeringImportRun
    : null;
}

function numberRecord(value: unknown): Record<string, number> {
  const parsed = parseJsonish(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const entries = Object.entries(parsed as Record<string, unknown>)
    .map(([key, entry]) => [key, Number(entry)] as const)
    .filter(([, entry]) => Number.isFinite(entry));
  return Object.fromEntries(entries);
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function listUserPoolModel<T>(modelName: string): Promise<T[]> {
  const client = generateClient<Schema>();
  const model = (client.models as Record<string, ListableModel<T>>)[modelName];
  if (!model) throw new Error(`GraphQL model ${modelName} is not available in the deployed schema.`);
  const list = model.list as (input?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<GraphQLListResponse<T>>;

  const items: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const response = await list({
      limit: USER_POOL_LIST_LIMIT,
      nextToken,
    }, {
      authMode: USER_POOL_AUTH_MODE,
    });
    assertNoGraphQLErrors(response.errors);
    items.push(...((response.data ?? []).filter(Boolean) as T[]));
    nextToken = response.nextToken;
  } while (nextToken);
  return items;
}

async function listOptionalUserPoolModel<T>(modelName: string): Promise<T[]> {
  const client = generateClient<Schema>();
  const model = (client.models as Record<string, ListableModel<T>>)[modelName];
  if (!model) {
    if (modelName === "NewsroomSection") {
      return (await listNewsroomSectionsViaGraphql(client)) as T[];
    }
    return [];
  }
  return listUserPoolModel<T>(modelName);
}

async function listUserPoolModelPage<T>(modelName: string, limit: number): Promise<T[]> {
  const client = generateClient<Schema>();
  const model = (client.models as Record<string, ListableModel<T>>)[modelName];
  if (!model) throw new Error(`GraphQL model ${modelName} is not available in the deployed schema.`);
  const list = model.list as (input?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<GraphQLListResponse<T>>;
  const response = await list({
    limit,
  }, {
    authMode: USER_POOL_AUTH_MODE,
  });
  assertNoGraphQLErrors(response.errors);
  return (response.data ?? []).filter(Boolean) as T[];
}

async function listOptionalUserPoolModelPage<T>(modelName: string, limit: number): Promise<T[]> {
  const client = generateClient<Schema>();
  const model = (client.models as Record<string, ListableModel<T>>)[modelName];
  if (!model) return [];
  return listUserPoolModelPage<T>(modelName, limit);
}

async function loadNewsroomFeedPage<T>({
  query,
  field,
  newsroomFeedKey,
  matches,
  limit = NEWSROOM_PAGE_LIMIT,
  nextToken,
}: {
  query: string;
  field: string;
  newsroomFeedKey: string;
  matches?: ((item: T) => boolean) | null;
  limit?: number;
  nextToken?: string | null;
}): Promise<NewsroomRecordPage<T>> {
  const client = generateClient<Schema>() as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<GraphQLConnectionResponse<T>>;
  };
  const items: T[] = [];
  let cursor = nextToken ?? null;
  let pageCount = 0;
  let connectionNextToken: string | null = null;

  do {
    pageCount += 1;
    let response: GraphQLConnectionResponse<T>;
    try {
      response = await client.graphql({
        query,
        variables: {
          newsroomFeedKey,
          sortDirection: "DESC",
          limit,
          nextToken: cursor,
          filter: null,
        },
        authMode: USER_POOL_AUTH_MODE,
      });
    } catch (error) {
      throw new Error(normalizeUnknownErrorMessage(error, `Failed to load ${field}`));
    }
    const connection = response.data?.[field];
    if (!connection) {
      assertNoGraphQLErrors(response.errors);
      throw new Error(`Missing GraphQL connection payload for ${field}.`);
    }
    if (response.errors?.length) {
      // Preserve list rendering when AppSync returns partial data and per-row errors.
      console.warn(`GraphQL returned partial data for ${field}.`, response.errors);
    }
    connectionNextToken = connection?.nextToken ?? null;
    const pageItems = ((connection?.items ?? []).filter(Boolean) as T[])
      .filter((item) => matches ? matches(item) : true);
    items.push(...pageItems);
    cursor = connectionNextToken;
  } while (items.length < limit && cursor && pageCount < 10);

  return {
    items: items.slice(0, limit),
    nextToken: connectionNextToken,
    hasMore: Boolean(connectionNextToken),
  };
}

async function loadSemanticRelationsByState({
  field,
  keyName,
  keyValue,
  query,
}: {
  field: "listSemanticRelationsByObjectState" | "listSemanticRelationsBySubjectState";
  keyName: "objectStateKey" | "subjectStateKey";
  keyValue: string;
  query: string;
}): Promise<SemanticRelationRecord[]> {
  const client = generateClient<Schema>() as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<GraphQLConnectionResponse<SemanticRelationRecord>>;
  };
  const rows: SemanticRelationRecord[] = [];
  const seenIds = new Set<string>();
  let nextToken: string | null = null;
  let pageCount = 0;
  do {
    pageCount += 1;
    const response = await client.graphql({
      query,
      variables: {
        [keyName]: keyValue,
        sortDirection: "DESC",
        limit: 200,
        nextToken,
        filter: null,
      },
      authMode: USER_POOL_AUTH_MODE,
    });
    assertNoGraphQLErrors(response.errors);
    const connection = response.data?.[field];
    if (!connection) break;
    for (const item of (connection.items ?? []).filter(Boolean) as SemanticRelationRecord[]) {
      if (!item.id || seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      rows.push(item);
    }
    nextToken = connection.nextToken ?? null;
  } while (nextToken && pageCount < 200);
  return rows;
}

function dedupeSemanticRelationsById(relations: SemanticRelationRecord[]): SemanticRelationRecord[] {
  const seen = new Set<string>();
  const deduped: SemanticRelationRecord[] = [];
  for (const relation of relations) {
    if (!relation.id || seen.has(relation.id)) continue;
    seen.add(relation.id);
    deduped.push(relation);
  }
  return deduped;
}

async function listNewsroomSectionsViaGraphql(client: ReturnType<typeof generateClient<Schema>>): Promise<NewsroomSectionRecord[]> {
  const graphClient = client as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<GraphQLConnectionResponse<NewsroomSectionRecord>>;
  };
  const rows: NewsroomSectionRecord[] = [];
  let nextToken: string | null | undefined = null;
  do {
    const response = await graphClient.graphql({
      query: NEWSROOM_SECTION_LIST_QUERY,
      variables: { limit: USER_POOL_LIST_LIMIT, nextToken },
      authMode: USER_POOL_AUTH_MODE,
    });
    assertNoGraphQLErrors(response.errors);
    const connection = response.data?.listNewsroomSections;
    rows.push(...((connection?.items ?? []).filter(Boolean) as NewsroomSectionRecord[]));
    nextToken = connection?.nextToken ?? null;
  } while (nextToken);
  return rows;
}

async function listSteeringProposalsViaGraphql(): Promise<CategorySteeringProposal[]> {
  const client = generateClient<Schema>() as unknown as {
    graphql: (options: Record<string, unknown>) => Promise<GraphQLConnectionResponse<CategorySteeringProposal>>;
  };
  const rows: CategorySteeringProposal[] = [];
  let nextToken: string | null | undefined = null;
  do {
    const response = await client.graphql({
      query: LIST_STEERING_PROPOSALS_QUERY,
      variables: { limit: USER_POOL_LIST_LIMIT, nextToken },
      authMode: USER_POOL_AUTH_MODE,
    });
    assertNoGraphQLErrors(response.errors);
    const connection = response.data?.listSteeringProposals;
    rows.push(...((connection?.items ?? []).filter(Boolean) as CategorySteeringProposal[]));
    nextToken = connection?.nextToken ?? null;
  } while (nextToken);
  return rows;
}

function equalityMatcher<T extends Record<string, unknown>>(values: Record<string, string | null | undefined>): ((item: T) => boolean) | null {
  const entries = Object.entries(values)
    .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  if (!entries.length) return null;
  return (item: T) => entries.every(([key, value]) => item[key] === value);
}

export function selectRootDeskCategoriesForDoctrine({
  categorys,
  categoryNodes,
  categorySetId,
}: {
  categorys: CategorySteeringCategory[];
  categoryNodes: CategorySteeringCategoryTreeNode[];
  categorySetId: string | null;
}): CategorySteeringCategory[] {
  const categorySetFilter = (category: { categorySetId: string }) => !categorySetId || category.categorySetId === categorySetId;
  const currentCategorys = categorys.filter((category) => (
    categorySetFilter(category)
    && category.status !== "deprecated"
    && category.versionState !== "superseded"
  ));
  const categoryByKey = new Map(currentCategorys.map((category) => [category.categoryKey, category]));
  const rootNodes = categoryNodes
    .filter((node) => (
      categorySetFilter(node)
      && node.status === "accepted"
      && node.versionState !== "superseded"
      && !node.parentCategoryKey
    ))
    .sort((left, right) => categorySortKey(left).localeCompare(categorySortKey(right)));

  if (rootNodes.length) {
    return rootNodes.map((node) => mergeRootNodeWithCategory(node, categoryByKey.get(node.categoryKey)));
  }

  return currentCategorys
    .filter((category) => category.status === "accepted" && category.versionState !== "superseded" && !category.parentCategoryKey)
    .sort((left, right) => categorySortKey(left).localeCompare(categorySortKey(right)));
}

export function selectAcceptedCategoriesForDoctrine({
  categorys,
  categoryNodes,
  categorySetId,
}: {
  categorys: CategorySteeringCategory[];
  categoryNodes: CategorySteeringCategoryTreeNode[];
  categorySetId: string | null;
}): DoctrineCategory[] {
  const categorySetFilter = (category: { categorySetId: string }) => !categorySetId || category.categorySetId === categorySetId;
  const currentCategorys = categorys.filter((category) => (
    categorySetFilter(category)
    && category.status !== "deprecated"
    && category.versionState !== "superseded"
  ));
  const categoryByKey = new Map(currentCategorys.map((category) => [category.categoryKey, category]));
  return categoryNodes
    .filter((node) => (
      categorySetFilter(node)
      && node.status === "accepted"
      && node.versionState !== "superseded"
    ))
    .sort((left, right) => categorySortKey(left).localeCompare(categorySortKey(right)))
    .map((node) => mergeRootNodeWithCategory(node, categoryByKey.get(node.categoryKey)));
}

async function loadDoctrineRecords(doctrineCategories: DoctrineCategory[] = []): Promise<DoctrineRecord[]> {
  const definitions = uniqueDoctrineDefinitions([
    ...DOCTRINE_DEFINITIONS,
    ...doctrineCategories.flatMap((category) => getCategoryDoctrineDefinitions(category)),
  ]);
  const records = await Promise.all(
    definitions.map((definition) => getDoctrineRecordBySlug(definition.slug)),
  );
  return records.filter((record): record is DoctrineRecord => record !== null);
}

async function getDoctrineRecordBySlug(slug: string): Promise<DoctrineRecord | null> {
  const client = generateClient<Schema>();
  const model = client.models.Item as unknown as SlugQueryableModel<DoctrineRecord>;
  if (typeof model.itemBySlug !== "function") {
    throw new Error("GraphQL Item.itemBySlug is not available in the deployed schema.");
  }

  const records: DoctrineRecord[] = [];
  let nextToken: string | null | undefined;
  do {
    const response = await model.itemBySlug(
      { slug },
      {
        authMode: USER_POOL_AUTH_MODE,
        limit: 100,
        nextToken,
      },
    );
    assertNoGraphQLErrors(response.errors);
    records.push(...((response.data ?? []).filter(Boolean) as DoctrineRecord[]));
    nextToken = response.nextToken;
  } while (nextToken);

  const doctrine = records.find((record) => record.type === "doctrine") ?? records[0] ?? null;
  return doctrine;
}

function uniqueDoctrineDefinitions(definitions: typeof DOCTRINE_DEFINITIONS): typeof DOCTRINE_DEFINITIONS {
  const bySlug = new Map<string, (typeof DOCTRINE_DEFINITIONS)[number]>();
  for (const definition of definitions) bySlug.set(definition.slug, definition);
  return Array.from(bySlug.values());
}

function mergeRootNodeWithCategory(
  node: CategorySteeringCategoryTreeNode,
  category?: CategorySteeringCategory,
): CategorySteeringCategory {
  return {
    ...node,
    ...category,
    id: category?.id ?? node.id,
    lineageId: category?.lineageId ?? node.lineageId ?? category?.id ?? node.id,
    versionNumber: category?.versionNumber ?? node.versionNumber,
    previousVersionId: category?.previousVersionId ?? node.previousVersionId,
    versionState: category?.versionState ?? node.versionState,
    versionCreatedAt: category?.versionCreatedAt ?? node.versionCreatedAt,
    versionCreatedBy: category?.versionCreatedBy ?? node.versionCreatedBy,
    changeReason: category?.changeReason ?? node.changeReason,
    contentHash: category?.contentHash ?? node.contentHash,
    categorySetId: category?.categorySetId ?? node.categorySetId,
    corpusId: category?.corpusId ?? node.corpusId,
    categoryKey: node.categoryKey,
    parentCategoryId: null,
    parentCategoryKey: null,
    displayName: category?.displayName ?? node.displayName,
    shortTitle: category?.shortTitle ?? node.shortTitle,
    subtitle: category?.subtitle ?? node.subtitle,
    description: category?.description ?? node.description,
    aliases: category?.aliases ?? node.aliases,
    status: category?.status ?? node.status,
    seedItemIds: category?.seedItemIds ?? node.seedItemIds,
    holdoutItemIds: category?.holdoutItemIds ?? node.holdoutItemIds,
    rank: category?.rank ?? node.rank,
    depth: 0,
    isPinned: category?.isPinned ?? node.isPinned,
    importRunId: category?.importRunId ?? node.importRunId,
    updatedAt: category?.updatedAt ?? node.updatedAt,
  };
}

function categorySortKey(category: Pick<CategorySteeringCategory, "rank" | "categoryKey">): string {
  return `${String(category.rank ?? 999999).padStart(6, "0")}#${category.categoryKey}`;
}

async function loadUserDirectory(): Promise<UserDirectoryEntry[]> {
  const client = generateClient<Schema>();
  const response = await client.queries.listUserDirectory({ authMode: USER_POOL_AUTH_MODE });
  assertNoGraphQLErrors(response.errors);
  return ((response.data?.entries ?? []).filter(Boolean) as UserDirectoryEntry[])
    .sort((left, right) => (left.displayName ?? left.email ?? left.userSub ?? "").localeCompare(right.displayName ?? right.email ?? right.userSub ?? ""));
}

function appendixFromCategoryTree(categoryTree: CategorySteeringCategoryTree, nodes: CategorySteeringCategoryTreeNode[]): NewsDeskAppendix {
  return {
    categorySetId: categoryTree.id,
    corpusId: categoryTree.corpusId,
    displayName: categoryTree.displayName,
    description: categoryTree.description,
    generatedAt: categoryTree.generatedAt,
    nodes: nodes
      .filter((node) => node.categorySetId === categoryTree.id)
      .map((node) => ({
        id: node.id,
        categorySetId: node.categorySetId,
        categoryKey: node.categoryKey,
        parentCategoryKey: node.parentCategoryKey,
        displayName: node.displayName,
        shortTitle: node.shortTitle,
        subtitle: node.subtitle,
        description: node.description,
        status: node.status,
        seedItemIds: node.seedItemIds,
        holdoutItemIds: node.holdoutItemIds,
        rank: node.rank,
        depth: node.depth,
      })),
  };
}

function categoryTreeFromAppendix(appendix: NewsDeskAppendix): CategorySteeringCategoryTree {
  const roots = appendix.nodes.filter((node) => node.status === "accepted" && !node.parentCategoryKey);
  return {
    id: appendix.categorySetId,
    corpusId: appendix.corpusId,
    classifierId: "scenario",
    displayName: appendix.displayName,
    description: appendix.description,
    status: "accepted",
    generatedAt: appendix.generatedAt,
    nodeCount: appendix.nodes.length,
    rootCount: roots.length,
  };
}

function categoryTreeNodeFromAppendixNode(node: NewsDeskCategoryTreeNode): CategorySteeringCategoryTreeNode {
  return {
    id: node.id,
    categorySetId: node.categorySetId,
    corpusId: "",
    categoryKey: node.categoryKey,
    parentCategoryKey: node.parentCategoryKey,
    displayName: node.displayName,
    shortTitle: node.shortTitle,
    subtitle: node.subtitle,
    description: node.description,
    status: node.status,
    seedItemIds: node.seedItemIds,
    holdoutItemIds: node.holdoutItemIds,
    rank: node.rank,
    depth: node.depth,
  };
}

function selectCurrentAcceptedCategoryTree(categoryTrees: CategorySteeringCategoryTree[]): CategorySteeringCategoryTree | null {
  return categoryTrees.find(isCurrentAcceptedCategorySet) ?? null;
}

function selectCanonicalCategorySet(corpora: CategorySteeringCorpus[], categorySets: CategorySteeringCategorySet[]): CategorySteeringCategorySet | null {
  const canonicalCorpus = selectCanonicalCorpus(corpora);
  const candidates = categorySets.filter(isCurrentAcceptedCategorySet);
  const canonicalCandidates = canonicalCorpus ? candidates.filter((categorySet) => categorySet.corpusId === canonicalCorpus.id) : candidates;
  return canonicalCandidates[0] ?? candidates[0] ?? null;
}

function isCurrentAcceptedCategorySet(categorySet: CategorySteeringCategorySet | CategorySteeringCategoryTree): boolean {
  return categorySet.versionState === "current" && categorySet.status === "accepted";
}

function selectCanonicalCorpus(corpora: CategorySteeringCorpus[]): CategorySteeringCorpus | null {
  return corpora.find((corpus) => corpus.role === "canonical")
    ?? corpora.find((corpus) => corpus.role === "authority")
    ?? corpora[0]
    ?? null;
}

function sortCategorySets(categorySets: CategorySteeringCategorySet[], importRuns: CategorySteeringImportRun[]): CategorySteeringCategorySet[] {
  const importRunById = new Map(importRuns.map((importRun) => [importRun.id, importRun]));
  return [...categorySets].sort((left, right) => {
    const statusDiff = categorySetStatusRank(left.status) - categorySetStatusRank(right.status);
    if (statusDiff !== 0) return statusDiff;
    const dateDiff = categorySetSortDate(right, importRunById).localeCompare(categorySetSortDate(left, importRunById));
    if (dateDiff !== 0) return dateDiff;
    return left.displayName.localeCompare(right.displayName);
  });
}

function categorySetSortDate(categorySet: CategorySteeringCategorySet, importRunById: Map<string, CategorySteeringImportRun>): string {
  return categorySet.generatedAt ?? (categorySet.importRunId ? importRunById.get(categorySet.importRunId)?.importedAt : null) ?? "";
}

function categorySetStatusRank(status: string): number {
  if (status === "accepted") return 0;
  if (status === "draft") return 1;
  if (status === "proposed") return 2;
  if (status === "deprecated") return 8;
  return 5;
}

function sortCategorys(categorys: CategorySteeringCategory[]): CategorySteeringCategory[] {
  return [...categorys].sort((left, right) => {
    const rankDiff = (left.rank ?? 999999) - (right.rank ?? 999999);
    if (rankDiff !== 0) return rankDiff;
    return left.categoryKey.localeCompare(right.categoryKey);
  });
}

function normalizeNewsroomSectionType(value: string | null | undefined): "canonical" | "floating" {
  return value === "floating" || value === "rotating" ? "floating" : "canonical";
}

function sortNewsroomSections(sections: NewsroomSectionRecord[]): NewsroomSectionRecord[] {
  return [...sections]
    .map((section) => ({ ...section, type: normalizeNewsroomSectionType(section.type) }))
    .sort((left, right) => {
      const typeDiff = (left.type === "canonical" ? 0 : 1) - (right.type === "canonical" ? 0 : 1);
      if (typeDiff !== 0) return typeDiff;
      const sortDiff = (left.sortOrder ?? 999999) - (right.sortOrder ?? 999999);
      if (sortDiff !== 0) return sortDiff;
      return left.title.localeCompare(right.title);
    });
}

function sortProposals(proposals: CategorySteeringProposal[]): CategorySteeringProposal[] {
  const statusWeight = new Map([
    ["proposed", 0],
    ["deferred", 1],
    ["accepted", 2],
    ["rejected", 3],
  ]);
  return [...proposals].sort((left, right) => {
    const statusDiff = (statusWeight.get(left.status) ?? 9) - (statusWeight.get(right.status) ?? 9);
    if (statusDiff !== 0) return statusDiff;
    return (right.proposedAt ?? right.updatedAt ?? "").localeCompare(left.proposedAt ?? left.updatedAt ?? "");
  });
}

function keywordSortKey(keyword: CategoryKeywordRecord): string {
  return `${keyword.categorySetId}#${keyword.categoryKey}#${String(keyword.rank ?? 999999).padStart(6, "0")}#${keyword.normalizedKeyword}`;
}

function lexicalRuleSortKey(rule: LexicalSteeringRuleRecord): string {
  return `${rule.status === "active" ? "0" : "1"}#${rule.scope}#${rule.normalizedTerm}#${rule.id}`;
}

function assignmentSortKey(assignment: AssignmentRecord): string {
  return `${String(assignment.priority ?? 999999).padStart(6, "0")}#${assignment.createdAt}#${assignment.id}`;
}

function sortTaxonomies(categoryTrees: CategorySteeringCategoryTree[]): CategorySteeringCategoryTree[] {
  return [...categoryTrees].sort((left, right) => {
    const statusDiff = categoryTreeStatusRank(left.status) - categoryTreeStatusRank(right.status);
    if (statusDiff !== 0) return statusDiff;
    const dateDiff = categoryTreeDate(right).localeCompare(categoryTreeDate(left));
    if (dateDiff !== 0) return dateDiff;
    return left.displayName.localeCompare(right.displayName);
  });
}

function sortCategoryTreeNodes(nodes: CategorySteeringCategoryTreeNode[]): CategorySteeringCategoryTreeNode[] {
  return [...nodes].sort((left, right) => {
    const depthDiff = (left.depth ?? 0) - (right.depth ?? 0);
    if (depthDiff !== 0) return depthDiff;
    const rankDiff = (left.rank ?? 999999) - (right.rank ?? 999999);
    if (rankDiff !== 0) return rankDiff;
    return left.categoryKey.localeCompare(right.categoryKey);
  });
}

function categoryTreeStatusRank(status: string): number {
  if (status === "accepted") return 0;
  if (status === "draft") return 1;
  if (status === "proposed") return 2;
  if (status === "deprecated") return 8;
  return 5;
}

function categoryTreeDate(categoryTree: CategorySteeringCategoryTree): string {
  return categoryTree.generatedAt ?? categoryTree.updatedAt ?? categoryTree.createdAt ?? "";
}

function normalizeJsonValue(value: unknown): Record<string, any> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, any> : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  return null;
}

function assertNoGraphQLErrors(errors?: unknown[] | null) {
  if (!errors?.length) return;
  const details = errors
    .map((error) => {
      if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
      return String(error);
    })
    .join("; ");
  throw new Error(details);
}

function normalizeUnknownErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (!error || typeof error !== "object") return fallback;
  const record = error as Record<string, unknown>;
  const directMessage = typeof record.message === "string" ? record.message.trim() : "";
  if (directMessage) return directMessage;
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const nestedMessages = errors
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const message = (entry as { message?: unknown }).message;
      return typeof message === "string" ? message.trim() : "";
    })
    .filter(Boolean);
  if (nestedMessages.length) return nestedMessages.join("; ");
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}
