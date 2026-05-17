"use client";

import { fetchAuthSession } from "aws-amplify/auth";
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
  KnowledgeCommentRecord,
  AssignmentEventRecord,
  AssignmentRecord,
  ReferenceAttachmentRecord,
  ReferenceRecord,
  SemanticNodeRecord,
  SemanticRelationRecord,
  UserDirectoryEntry,
} from "../lib/category-repository";
import { configureAmplifyClient } from "./amplify-client-provider";

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

export async function loadEditorAccessState(): Promise<{ isEditor: boolean; status: EditorAuthState["status"]; error: string | null }> {
  const auth = await getEditorAuthState();
  return { isEditor: auth.isEditor, status: auth.status, error: auth.error };
}

type EditorAuthState =
  | { status: "signedOut"; isEditor: false; error: null }
  | { status: "forbidden"; isEditor: false; error: null }
  | { status: "ready"; isEditor: true; isAdmin: boolean; error: null }
  | { status: "error"; isEditor: false; error: string };

export async function loadEditorNewsDeskState(): Promise<EditorNewsDeskState> {
  const auth = await getEditorAuthState();
  if (auth.status === "signedOut" || auth.status === "forbidden") return { status: auth.status, dashboard: null, error: null };
  if (auth.status === "error") return { status: "error", dashboard: null, error: auth.error };

  try {
    const [
      corpora,
      importRuns,
      categorySets,
      categorys,
      categoryTrees,
      categoryNodes,
      proposals,
      artifacts,
      references,
      referenceAttachments,
      semanticNodes,
      knowledgeComments,
      semanticRelations,
      assignments,
      assignmentEvents,
      userDirectory,
    ] = await Promise.all([
      listUserPoolModel<CategorySteeringCorpus>("KnowledgeCorpus"),
      listUserPoolModel<CategorySteeringImportRun>("KnowledgeImportRun"),
      listUserPoolModel<CategorySteeringCategorySet>("CategorySet"),
      listUserPoolModel<CategorySteeringCategory>("Category"),
      listUserPoolModel<CategorySteeringCategoryTree>("CategorySet"),
      listUserPoolModel<CategorySteeringCategoryTreeNode>("Category"),
      listUserPoolModel<CategorySteeringProposal>("SteeringProposal"),
      listUserPoolModel<CategorySteeringArtifact>("KnowledgeArtifact"),
      listUserPoolModel<ReferenceRecord>("Reference"),
      listUserPoolModel<ReferenceAttachmentRecord>("ReferenceAttachment"),
      listUserPoolModel<SemanticNodeRecord>("SemanticNode"),
      listUserPoolModel<KnowledgeCommentRecord>("KnowledgeComment"),
      listUserPoolModel<SemanticRelationRecord>("SemanticRelation"),
      listOptionalUserPoolModel<AssignmentRecord>("Assignment"),
      listOptionalUserPoolModel<AssignmentEventRecord>("AssignmentEvent"),
      auth.isAdmin ? loadUserDirectory() : Promise.resolve([]),
    ]);

    const sortedCorpora = corpora.sort((left, right) => left.name.localeCompare(right.name));
    const sortedImportRuns = importRuns.sort((left, right) => right.importedAt.localeCompare(left.importedAt));
    const sortedCategorySets = sortCategorySets(categorySets, sortedImportRuns);
    const canonicalCategorySet = selectCanonicalCategorySet(sortedCorpora, sortedCategorySets);
    return {
      status: "ready",
      dashboard: {
        canonicalCorpusId: canonicalCategorySet?.corpusId ?? selectCanonicalCorpus(sortedCorpora)?.id ?? null,
        canonicalCategorySetId: canonicalCategorySet?.id ?? null,
        canManageUsers: auth.isAdmin,
        userDirectory,
        corpora: sortedCorpora,
        importRuns: sortedImportRuns,
        categorySets: sortedCategorySets,
        categorys: sortCategorys(categorys),
        categoryTrees: sortTaxonomies(categoryTrees),
        categoryNodes: sortCategoryTreeNodes(categoryNodes),
        proposals: sortProposals(proposals),
        artifacts: artifacts.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "")),
        references: references.sort((left, right) => (right.importedAt ?? "").localeCompare(left.importedAt ?? "")),
        referenceAttachments: referenceAttachments.sort((left, right) => left.sortKey.localeCompare(right.sortKey)),
        semanticNodes: semanticNodes.sort((left, right) => (left.displayName ?? left.nodeKey).localeCompare(right.displayName ?? right.nodeKey)),
        knowledgeComments: knowledgeComments.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        semanticRelations: semanticRelations.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)),
        assignments: assignments.sort((left, right) => assignmentSortKey(left).localeCompare(assignmentSortKey(right))),
        assignmentEvents: assignmentEvents.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        loadError: null,
      },
      error: null,
    };
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

  const auth = await getEditorAuthState();
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

async function getEditorAuthState(): Promise<EditorAuthState> {
  configureAmplifyClient();
  try {
    const session = await fetchAuthSession();
    if (!session.tokens?.accessToken) return { status: "signedOut", isEditor: false, error: null };
    const groups = getSessionGroups(session);
    if (!groups.includes("editor") && !groups.includes("admin")) return { status: "forbidden", isEditor: false, error: null };
    return { status: "ready", isEditor: true, isAdmin: groups.includes("admin"), error: null };
  } catch (error) {
    if (isUnauthenticatedError(error)) return { status: "signedOut", isEditor: false, error: null };
    return {
      status: "error",
      isEditor: false,
      error: error instanceof Error ? error.message : "Could not verify editor session.",
    };
  }
}

function isUnauthenticatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unauth|not authenticated|no current user|not signed in/i.test(message);
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

async function loadUserDirectory(): Promise<UserDirectoryEntry[]> {
  const client = generateClient<Schema>();
  const response = await client.queries.listUserDirectory({ authMode: USER_POOL_AUTH_MODE });
  assertNoGraphQLErrors(response.errors);
  return ((response.data?.entries ?? []).filter(Boolean) as UserDirectoryEntry[])
    .sort((left, right) => (left.displayName ?? left.email ?? left.userSub ?? "").localeCompare(right.displayName ?? right.email ?? right.userSub ?? ""));
}

function getSessionGroups(session: Awaited<ReturnType<typeof fetchAuthSession>>): string[] {
  return [
    ...readGroups(session.tokens?.accessToken.payload["cognito:groups"]),
    ...readGroups(session.tokens?.idToken?.payload["cognito:groups"]),
  ];
}

function readGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
  return [];
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
