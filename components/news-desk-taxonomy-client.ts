"use client";

import { generateClient } from "aws-amplify/data";
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
  NewsroomSummaryRecord,
  LexicalSteeringRuleRecord,
  AssignmentEventRecord,
  AssignmentRecord,
  DoctrineRecord,
  NewsroomSectionRecord,
  ReferenceAttachmentRecord,
  ReferenceRecord,
  SemanticNodeRecord,
  SemanticRelationRecord,
  UserDirectoryEntry,
} from "../lib/category-repository";
import { DOCTRINE_DEFINITIONS, getCategoryDoctrineDefinitions, type DoctrineCategory } from "../lib/doctrine";
import { configureAmplifyClient } from "./amplify-client-provider";
import { isUnauthenticatedError, loadReaderSessionSnapshot, type ReaderAuthSnapshot } from "./reader-auth-state";

const USER_POOL_AUTH_MODE = "userPool";
const USER_POOL_LIST_LIMIT = 500;
const USER_POOL_PAGE_LIMIT = 50;
const TEST_EDITOR_STORAGE_KEY = "papyrus:test-editor";
const NEWSROOM_PAGE_LIMIT = 50;

const NEWSROOM_MESSAGE_FEED_QUERY = `
  query ListMessagesByNewsroomFeedAndCreatedAt($newsroomFeedKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelMessageFilterInput) {
    listMessagesByNewsroomFeedAndCreatedAt(newsroomFeedKey: $newsroomFeedKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id messageKind messageDomain status body summary source importRunId authorSub authorUserProfileId authorLabel createdAt updatedAt newsroomFeedKey metadata }
      nextToken
    }
  }
`;

const NEWSROOM_ASSIGNMENT_FEED_QUERY = `
  query ListAssignmentsByNewsroomFeedAndCreatedAt($newsroomFeedKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelAssignmentFilterInput) {
    listAssignmentsByNewsroomFeedAndCreatedAt(newsroomFeedKey: $newsroomFeedKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id assignmentTypeKey queueKey queueStatusKey status priority title brief instructions assigneeType assigneeId assigneeKey claimedAt claimExpiresAt completedAt canceledAt corpusId categorySetId classifierId sourceSnapshotId importRunId createdBy createdAt updatedAt newsroomFeedKey metadata }
      nextToken
    }
  }
`;

const NEWSROOM_REFERENCE_FEED_QUERY = `
  query ListReferencesByNewsroomFeedAndCreatedAt($newsroomFeedKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelReferenceFilterInput) {
    listReferencesByNewsroomFeedAndCreatedAt(newsroomFeedKey: $newsroomFeedKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id lineageId versionNumber previousVersionId versionState versionCreatedAt versionCreatedBy changeReason contentHash corpusId externalItemId title authors sourceUri storagePath mediaType byteSize sha256 sourcePublishedAt sourceUpdatedAt retrievedAt importRunId importedAt createdAt curationStatus curationStatusKey curationStatusUpdatedAt curationStatusUpdatedBy curationStatusReason newsroomFeedKey metadata updatedAt }
      nextToken
    }
  }
`;

const NEWSROOM_SEMANTIC_NODE_FEED_QUERY = `
  query ListSemanticNodesByNewsroomFeedAndCreatedAt($newsroomFeedKey: String!, $sortDirection: ModelSortDirection, $limit: Int, $nextToken: String, $filter: ModelSemanticNodeFilterInput) {
    listSemanticNodesByNewsroomFeedAndCreatedAt(newsroomFeedKey: $newsroomFeedKey, sortDirection: $sortDirection, limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id lineageId versionNumber previousVersionId versionState versionCreatedAt versionCreatedBy changeReason contentHash nodeKey nodeKind corpusId categorySetId categoryLineageId categoryKey displayName description aliases status importRunId createdAt newsroomFeedKey updatedAt }
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

const NEWSROOM_SECTION_LIST_QUERY = `
  query ListNewsroomSections($limit: Int, $nextToken: String) {
    listNewsroomSections(limit: $limit, nextToken: $nextToken) {
      items {
        id
        title
        type
        editorialMission
        editorialPolicy
        enabled
        enabledStatus
        sortOrder
        shortDescription
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

type GraphQLListResponse<T> = {
  data?: T[] | null;
  nextToken?: string | null;
  errors?: unknown[] | null;
};

type ListableModel<T> = {
  list: (options: Record<string, unknown>) => Promise<GraphQLListResponse<T>>;
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
  const [summary, userDirectory] = await Promise.all([
    loadNewsroomSummary(),
    isAdmin ? loadUserDirectory() : Promise.resolve([]),
  ]);

  return {
    ...createSummaryCategorySteeringDashboard(summary),
    canManageUsers: isAdmin,
    userDirectory,
  };
}

export async function loadEditorFullNewsDeskDashboard({ isAdmin }: { isAdmin: boolean }): Promise<CategorySteeringDashboard> {
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
    userDirectory,
  ] = await Promise.all([
    listUserPoolModel<CategorySteeringCorpus>("KnowledgeCorpus"),
    listUserPoolModel<CategorySteeringImportRun>("KnowledgeImportRun"),
    listUserPoolModel<CategorySteeringCategorySet>("CategorySet"),
    listUserPoolModel<CategorySteeringCategory>("Category"),
    listOptionalUserPoolModel<CategoryKeywordRecord>("CategoryKeyword"),
    listOptionalUserPoolModel<LexicalSteeringRuleRecord>("LexicalSteeringRule"),
    listUserPoolModel<CategorySteeringProposal>("SteeringProposal"),
    listUserPoolModel<CategorySteeringArtifact>("KnowledgeArtifact"),
    listUserPoolModel<ReferenceRecord>("Reference"),
    listUserPoolModel<ReferenceAttachmentRecord>("ReferenceAttachment"),
    listUserPoolModel<SemanticNodeRecord>("SemanticNode"),
    listUserPoolModel<MessageRecord>("Message"),
    listUserPoolModel<SemanticRelationRecord>("SemanticRelation"),
    loadEditorAssignmentsData(),
    listOptionalUserPoolModel<NewsroomSectionRecord>("NewsroomSection"),
    isAdmin ? loadUserDirectory() : Promise.resolve([]),
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
    loadError: null,
  };
}

export async function loadEditorMessagesData(): Promise<MessageRecord[]> {
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
  const [referencePage, referenceAttachments] = await Promise.all([
    loadNewsroomReferencePage(),
    listUserPoolModelPage<ReferenceAttachmentRecord>("ReferenceAttachment", USER_POOL_PAGE_LIMIT),
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
    matches: equalityMatcher({
      curationStatus: options.status,
      corpusId: options.corpusId,
    }),
  });
}

export async function loadEditorSemanticRelationsData(): Promise<SemanticRelationRecord[]> {
  const page = await loadNewsroomSemanticRelationPage();
  return page.items;
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

export function hasTestEditorOverride(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TEST_EDITOR_STORAGE_KEY) === "true";
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
    summary,
    importRuns: latestImportRun ? [latestImportRun] : [],
    loadError: null,
  };
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

  const items: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const response = await model.list({
      authMode: USER_POOL_AUTH_MODE,
      limit: USER_POOL_LIST_LIMIT,
      nextToken,
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
  const response = await model.list({
    authMode: USER_POOL_AUTH_MODE,
    limit,
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
    const response = await client.graphql({
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
    assertNoGraphQLErrors(response.errors);
    const connection = response.data?.[field];
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

function normalizeNewsroomSectionType(value: string | null | undefined): "canonical" | "rotating" {
  return value === "rotating" ? "rotating" : "canonical";
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
