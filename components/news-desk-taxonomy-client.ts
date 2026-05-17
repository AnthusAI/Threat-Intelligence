"use client";

import { fetchAuthSession } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import type { NewsDeskAppendix, NewsDeskTaxonomyNode } from "../lib/content-types";
import type {
  TopicSteeringArtifact,
  TopicSteeringCorpus,
  TopicSteeringDashboard,
  TopicSteeringImportRun,
  TopicSteeringProjection,
  TopicSteeringProposal,
  TopicSteeringTaxonomy,
  TopicSteeringTaxonomyNode,
  TopicSteeringTopic,
  TopicSteeringTopicSet,
} from "../lib/curation-repository";
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

export type EditorTaxonomyState = {
  isEditor: boolean;
  appendix: NewsDeskAppendix | null;
  taxonomies: TopicSteeringTaxonomy[];
  taxonomyNodes: TopicSteeringTaxonomyNode[];
  error: string | null;
};

export type EditorNewsDeskState =
  | { status: "loading"; dashboard: null; error: null }
  | { status: "signedOut"; dashboard: null; error: null }
  | { status: "forbidden"; dashboard: null; error: null }
  | { status: "ready"; dashboard: TopicSteeringDashboard; error: null }
  | { status: "error"; dashboard: null; error: string };

export async function loadEditorAccessState(): Promise<{ isEditor: boolean; status: EditorAuthState["status"]; error: string | null }> {
  const auth = await getEditorAuthState();
  return { isEditor: auth.isEditor, status: auth.status, error: auth.error };
}

type EditorAuthState =
  | { status: "signedOut"; isEditor: false; error: null }
  | { status: "forbidden"; isEditor: false; error: null }
  | { status: "ready"; isEditor: true; error: null }
  | { status: "error"; isEditor: false; error: string };

export async function loadEditorNewsDeskState(): Promise<EditorNewsDeskState> {
  const auth = await getEditorAuthState();
  if (auth.status === "signedOut" || auth.status === "forbidden") return { status: auth.status, dashboard: null, error: null };
  if (auth.status === "error") return { status: "error", dashboard: null, error: auth.error };

  try {
    const [
      corpora,
      importRuns,
      topicSets,
      topics,
      taxonomies,
      taxonomyNodes,
      proposals,
      artifacts,
      projections,
    ] = await Promise.all([
      listUserPoolModel<TopicSteeringCorpus>("CurationCorpus"),
      listUserPoolModel<TopicSteeringImportRun>("CurationImportRun"),
      listUserPoolModel<TopicSteeringTopicSet>("CurationTopicSet"),
      listUserPoolModel<TopicSteeringTopic>("CurationTopic"),
      listUserPoolModel<TopicSteeringTaxonomy>("CurationTaxonomy"),
      listUserPoolModel<TopicSteeringTaxonomyNode>("CurationTaxonomyNode"),
      listUserPoolModel<TopicSteeringProposal>("CurationProposal"),
      listUserPoolModel<TopicSteeringArtifact>("CurationArtifact"),
      listUserPoolModel<TopicSteeringProjection>("CurationProjection"),
    ]);

    const sortedCorpora = corpora.sort((left, right) => left.name.localeCompare(right.name));
    const sortedImportRuns = importRuns.sort((left, right) => right.importedAt.localeCompare(left.importedAt));
    const sortedTopicSets = sortTopicSets(topicSets, sortedImportRuns);
    const canonicalTopicSet = selectCanonicalTopicSet(sortedCorpora, sortedTopicSets);
    return {
      status: "ready",
      dashboard: {
        canonicalCorpusId: canonicalTopicSet?.corpusId ?? selectCanonicalCorpus(sortedCorpora)?.id ?? null,
        canonicalTopicSetId: canonicalTopicSet?.id ?? null,
        corpora: sortedCorpora,
        importRuns: sortedImportRuns,
        topicSets: sortedTopicSets,
        topics: sortTopics(topics),
        taxonomies: sortTaxonomies(taxonomies),
        taxonomyNodes: sortTaxonomyNodes(taxonomyNodes),
        proposals: sortProposals(proposals),
        artifacts: artifacts.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "")),
        projections: projections.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)),
        loadError: null,
      },
      error: null,
    };
  } catch (error) {
    return {
      status: "error",
      dashboard: null,
      error: error instanceof Error ? error.message : "Could not load News Desk data.",
    };
  }
}

export async function loadEditorTaxonomyState(options?: {
  scenarioAppendix?: NewsDeskAppendix | null;
  allowScenarioEditorOverride?: boolean;
}): Promise<EditorTaxonomyState> {
  configureAmplifyClient();

  if (options?.allowScenarioEditorOverride && hasTestEditorOverride()) {
    const appendix = options.scenarioAppendix ?? null;
    return {
      isEditor: true,
      appendix,
      taxonomies: appendix ? [taxonomyFromAppendix(appendix)] : [],
      taxonomyNodes: appendix ? appendix.nodes.map(taxonomyNodeFromAppendixNode) : [],
      error: null,
    };
  }

  const auth = await getEditorAuthState();
  if (!auth.isEditor) {
    return { isEditor: false, appendix: null, taxonomies: [], taxonomyNodes: [], error: auth.error };
  }

  try {
    const [taxonomies, taxonomyNodes] = await Promise.all([
      listUserPoolModel<TopicSteeringTaxonomy>("CurationTaxonomy"),
      listUserPoolModel<TopicSteeringTaxonomyNode>("CurationTaxonomyNode"),
    ]);
    const sortedTaxonomies = sortTaxonomies(taxonomies);
    const sortedNodes = sortTaxonomyNodes(taxonomyNodes);
    const selectedTaxonomy = selectCurrentAcceptedTaxonomy(sortedTaxonomies);
    return {
      isEditor: true,
      appendix: selectedTaxonomy ? appendixFromTaxonomy(selectedTaxonomy, sortedNodes) : null,
      taxonomies: sortedTaxonomies,
      taxonomyNodes: sortedNodes,
      error: null,
    };
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return { isEditor: false, appendix: null, taxonomies: [], taxonomyNodes: [], error: null };
    }
    return {
      isEditor: false,
      appendix: null,
      taxonomies: [],
      taxonomyNodes: [],
      error: error instanceof Error ? error.message : "Could not load editor taxonomy state.",
    };
  }
}

async function getEditorAuthState(): Promise<EditorAuthState> {
  configureAmplifyClient();
  try {
    const session = await fetchAuthSession();
    if (!session.tokens?.accessToken) return { status: "signedOut", isEditor: false, error: null };
    if (!hasEditorGroup(session)) return { status: "forbidden", isEditor: false, error: null };
    return { status: "ready", isEditor: true, error: null };
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

function hasEditorGroup(session: Awaited<ReturnType<typeof fetchAuthSession>>): boolean {
  const groups = [
    ...readGroups(session.tokens?.accessToken.payload["cognito:groups"]),
    ...readGroups(session.tokens?.idToken?.payload["cognito:groups"]),
  ];
  return groups.includes("editor") || groups.includes("admin");
}

function readGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function appendixFromTaxonomy(taxonomy: TopicSteeringTaxonomy, nodes: TopicSteeringTaxonomyNode[]): NewsDeskAppendix {
  return {
    taxonomyId: taxonomy.id,
    corpusId: taxonomy.corpusId,
    topicSetId: taxonomy.topicSetId,
    displayName: taxonomy.displayName,
    description: taxonomy.description,
    generatedAt: taxonomy.generatedAt,
    nodes: nodes
      .filter((node) => node.taxonomyId === taxonomy.id)
      .map((node) => ({
        id: node.id,
        taxonomyId: node.taxonomyId,
        topicUid: node.topicUid,
        parentTopicUid: node.parentTopicUid,
        displayName: node.displayName,
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

function taxonomyFromAppendix(appendix: NewsDeskAppendix): TopicSteeringTaxonomy {
  const roots = appendix.nodes.filter((node) => node.status === "accepted" && !node.parentTopicUid);
  return {
    id: appendix.taxonomyId,
    corpusId: appendix.corpusId,
    topicSetId: appendix.topicSetId,
    taxonomyId: appendix.taxonomyId,
    displayName: appendix.displayName,
    description: appendix.description,
    status: "accepted",
    generatedAt: appendix.generatedAt,
    nodeCount: appendix.nodes.length,
    rootCount: roots.length,
  };
}

function taxonomyNodeFromAppendixNode(node: NewsDeskTaxonomyNode): TopicSteeringTaxonomyNode {
  return {
    id: node.id,
    taxonomyId: node.taxonomyId,
    corpusId: "",
    topicSetId: "",
    topicUid: node.topicUid,
    parentTopicUid: node.parentTopicUid,
    displayName: node.displayName,
    subtitle: node.subtitle,
    description: node.description,
    status: node.status,
    seedItemIds: node.seedItemIds,
    holdoutItemIds: node.holdoutItemIds,
    rank: node.rank,
    depth: node.depth,
  };
}

function selectCurrentAcceptedTaxonomy(taxonomies: TopicSteeringTaxonomy[]): TopicSteeringTaxonomy | null {
  return taxonomies.find((taxonomy) => taxonomy.status === "accepted") ?? taxonomies[0] ?? null;
}

function selectCanonicalTopicSet(corpora: TopicSteeringCorpus[], topicSets: TopicSteeringTopicSet[]): TopicSteeringTopicSet | null {
  const canonicalCorpus = selectCanonicalCorpus(corpora);
  const candidates = topicSets.filter((topicSet) => topicSet.status !== "deprecated");
  const canonicalCandidates = canonicalCorpus ? candidates.filter((topicSet) => topicSet.corpusId === canonicalCorpus.id) : candidates;
  return canonicalCandidates[0] ?? candidates[0] ?? null;
}

function selectCanonicalCorpus(corpora: TopicSteeringCorpus[]): TopicSteeringCorpus | null {
  return corpora.find((corpus) => corpus.role === "canonical")
    ?? corpora.find((corpus) => corpus.role === "authority")
    ?? corpora[0]
    ?? null;
}

function sortTopicSets(topicSets: TopicSteeringTopicSet[], importRuns: TopicSteeringImportRun[]): TopicSteeringTopicSet[] {
  const importRunById = new Map(importRuns.map((importRun) => [importRun.id, importRun]));
  return [...topicSets].sort((left, right) => {
    const statusDiff = topicSetStatusRank(left.status) - topicSetStatusRank(right.status);
    if (statusDiff !== 0) return statusDiff;
    const dateDiff = topicSetSortDate(right, importRunById).localeCompare(topicSetSortDate(left, importRunById));
    if (dateDiff !== 0) return dateDiff;
    return left.displayName.localeCompare(right.displayName);
  });
}

function topicSetSortDate(topicSet: TopicSteeringTopicSet, importRunById: Map<string, TopicSteeringImportRun>): string {
  return topicSet.generatedAt ?? (topicSet.importRunId ? importRunById.get(topicSet.importRunId)?.importedAt : null) ?? "";
}

function topicSetStatusRank(status: string): number {
  if (status === "accepted") return 0;
  if (status === "draft") return 1;
  if (status === "proposed") return 2;
  if (status === "deprecated") return 8;
  return 5;
}

function sortTopics(topics: TopicSteeringTopic[]): TopicSteeringTopic[] {
  return [...topics].sort((left, right) => {
    const rankDiff = (left.rank ?? 999999) - (right.rank ?? 999999);
    if (rankDiff !== 0) return rankDiff;
    return left.topicUid.localeCompare(right.topicUid);
  });
}

function sortProposals(proposals: TopicSteeringProposal[]): TopicSteeringProposal[] {
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

function sortTaxonomies(taxonomies: TopicSteeringTaxonomy[]): TopicSteeringTaxonomy[] {
  return [...taxonomies].sort((left, right) => {
    const statusDiff = taxonomyStatusRank(left.status) - taxonomyStatusRank(right.status);
    if (statusDiff !== 0) return statusDiff;
    const dateDiff = taxonomyDate(right).localeCompare(taxonomyDate(left));
    if (dateDiff !== 0) return dateDiff;
    return left.displayName.localeCompare(right.displayName);
  });
}

function sortTaxonomyNodes(nodes: TopicSteeringTaxonomyNode[]): TopicSteeringTaxonomyNode[] {
  return [...nodes].sort((left, right) => {
    const depthDiff = (left.depth ?? 0) - (right.depth ?? 0);
    if (depthDiff !== 0) return depthDiff;
    const rankDiff = (left.rank ?? 999999) - (right.rank ?? 999999);
    if (rankDiff !== 0) return rankDiff;
    return left.topicUid.localeCompare(right.topicUid);
  });
}

function taxonomyStatusRank(status: string): number {
  if (status === "accepted") return 0;
  if (status === "draft") return 1;
  if (status === "proposed") return 2;
  if (status === "deprecated") return 8;
  return 5;
}

function taxonomyDate(taxonomy: TopicSteeringTaxonomy): string {
  return taxonomy.generatedAt ?? taxonomy.updatedAt ?? taxonomy.createdAt ?? "";
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
