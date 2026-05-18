"use client";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import type { NewsDeskAppendix, NewsDeskCategoryTreeNode } from "../lib/content-types";
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
  LexicalSteeringRuleRecord,
  AssignmentEventRecord,
  AssignmentRecord,
  DoctrineRecord,
  ReferenceAttachmentRecord,
  ReferenceRecord,
  SemanticNodeRecord,
  SemanticRelationRecord,
  UserDirectoryEntry,
} from "../lib/category-repository";
import { DOCTRINE_DEFINITIONS, getDeskDoctrineDefinitions } from "../lib/doctrine";
import { configureAmplifyClient } from "./amplify-client-provider";
import { isUnauthenticatedError, loadReaderSessionSnapshot, type ReaderAuthSnapshot } from "./reader-auth-state";

const USER_POOL_AUTH_MODE = "userPool";
const TEST_EDITOR_STORAGE_KEY = "papyrus:test-editor";

type GraphQLListResponse<T> = {
  data?: T[] | null;
  nextToken?: string | null;
  errors?: unknown[] | null;
};

type ListableModel<T> = {
  list: (options: Record<string, unknown>) => Promise<GraphQLListResponse<T>>;
};

type SlugQueryableModel<T> = {
  itemBySlug?: (args: { slug: string }, options: Record<string, unknown>) => Promise<GraphQLListResponse<T>>;
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
  const [
    corpora,
    importRuns,
    categorySets,
    categorys,
    categoryTrees,
    categoryNodes,
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
    userDirectory,
  ] = await Promise.all([
    listUserPoolModel<CategorySteeringCorpus>("KnowledgeCorpus"),
    listUserPoolModel<CategorySteeringImportRun>("KnowledgeImportRun"),
    listUserPoolModel<CategorySteeringCategorySet>("CategorySet"),
    listUserPoolModel<CategorySteeringCategory>("Category"),
    listUserPoolModel<CategorySteeringCategoryTree>("CategorySet"),
    listUserPoolModel<CategorySteeringCategoryTreeNode>("Category"),
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
    isAdmin ? loadUserDirectory() : Promise.resolve([]),
  ]);

  const sortedCorpora = corpora.sort((left, right) => left.name.localeCompare(right.name));
  const sortedImportRuns = importRuns.sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  const sortedCategorySets = sortCategorySets(categorySets, sortedImportRuns);
  const canonicalCategorySet = selectCanonicalCategorySet(sortedCorpora, sortedCategorySets);
  const sortedCategorys = sortCategorys(categorys);
  const sortedCategoryNodes = sortCategoryTreeNodes(categoryNodes);
  const rootDeskCategories = selectRootDeskCategoriesForDoctrine({
    categorys: sortedCategorys,
    categoryNodes: sortedCategoryNodes,
    categorySetId: canonicalCategorySet?.id ?? null,
  });
  const doctrineRecords = await loadDoctrineRecords(rootDeskCategories);

  return {
    canonicalCorpusId: canonicalCategorySet?.corpusId ?? selectCanonicalCorpus(sortedCorpora)?.id ?? null,
    canonicalCategorySetId: canonicalCategorySet?.id ?? null,
    canManageUsers: isAdmin,
    userDirectory,
    corpora: sortedCorpora,
    importRuns: sortedImportRuns,
    categorySets: sortedCategorySets,
    categorys: sortedCategorys,
    categoryTrees: sortTaxonomies(categoryTrees),
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
    loadError: null,
  };
}

export async function loadEditorAssignmentsData(): Promise<{
  assignments: AssignmentRecord[];
  assignmentEvents: AssignmentEventRecord[];
}> {
  const [assignments, assignmentEvents] = await Promise.all([
    listOptionalUserPoolModel<AssignmentRecord>("Assignment"),
    listOptionalUserPoolModel<AssignmentEventRecord>("AssignmentEvent"),
  ]);
  return {
    assignments: assignments.sort((left, right) => assignmentSortKey(left).localeCompare(assignmentSortKey(right))),
    assignmentEvents: assignmentEvents.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}

export async function loadEditorDoctrineRecordsData(options?: {
  dashboard?: Pick<CategorySteeringDashboard, "categorys" | "categoryNodes" | "canonicalCategorySetId"> | null;
  rootCategories?: CategorySteeringCategory[];
}): Promise<DoctrineRecord[]> {
  const rootCategories = options?.rootCategories
    ?? (options?.dashboard
      ? selectRootDeskCategoriesForDoctrine({
        categorys: options.dashboard.categorys,
        categoryNodes: options.dashboard.categoryNodes,
        categorySetId: options.dashboard.canonicalCategorySetId ?? null,
      })
      : []);
  return loadDoctrineRecords(rootCategories);
}

export async function loadEditorUserDirectoryData(): Promise<UserDirectoryEntry[]> {
  return loadUserDirectory();
}

export function hasTestEditorOverride(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TEST_EDITOR_STORAGE_KEY) === "true";
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
      limit: 100,
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
  if (!model) return [];
  return listUserPoolModel<T>(modelName);
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

async function loadDoctrineRecords(rootCategories: CategorySteeringCategory[] = []): Promise<DoctrineRecord[]> {
  const definitions = uniqueDoctrineDefinitions([
    ...DOCTRINE_DEFINITIONS,
    ...rootCategories.flatMap((category) => getDeskDoctrineDefinitions(category)),
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
  return categoryTrees.find((categoryTree) => categoryTree.status === "accepted") ?? categoryTrees[0] ?? null;
}

function selectCanonicalCategorySet(corpora: CategorySteeringCorpus[], categorySets: CategorySteeringCategorySet[]): CategorySteeringCategorySet | null {
  const canonicalCorpus = selectCanonicalCorpus(corpora);
  const candidates = categorySets.filter((categorySet) => categorySet.status !== "deprecated");
  const canonicalCandidates = canonicalCorpus ? candidates.filter((categorySet) => categorySet.corpusId === canonicalCorpus.id) : candidates;
  return canonicalCandidates[0] ?? candidates[0] ?? null;
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
