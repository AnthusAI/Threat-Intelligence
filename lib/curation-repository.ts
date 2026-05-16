import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import { getAmplifyServerRuntime, hasAmplifyOutputs } from "./amplify-server-runtime";

const AUTH_MODE = "apiKey";

type DataClient = ReturnType<typeof generateClient<Schema>>;
type GraphQLListResponse<T> = {
  data?: T[] | null;
  nextToken?: string | null;
  errors?: unknown[] | null;
};

export type TopicSteeringCorpus = {
  id: string;
  name: string;
  role: string;
  itemCount?: number | null;
  generatedAt?: string | null;
  latestImportRunId?: string | null;
};

export type TopicSteeringImportRun = {
  id: string;
  corpusId: string;
  importKind: string;
  classifierId?: string | null;
  status: string;
  importedAt: string;
  itemCount?: number | null;
  topicCount?: number | null;
  proposalCount?: number | null;
  projectionCount?: number | null;
  warningCount?: number | null;
};

export type TopicSteeringTopicSet = {
  id: string;
  corpusId: string;
  classifierId: string;
  displayName: string;
  description?: string | null;
  status: string;
  acceptedRevisionId?: string | null;
  latestDraftRevisionId?: string | null;
  generatedAt?: string | null;
  topicCount?: number | null;
};

export type TopicSteeringTopic = {
  id: string;
  topicSetId: string;
  corpusId: string;
  topicUid: string;
  displayName: string;
  subtitle?: string | null;
  description?: string | null;
  aliases?: Array<string | null> | null;
  status: string;
  seedItemIds?: Array<string | null> | null;
  holdoutItemIds?: Array<string | null> | null;
  rank?: number | null;
  isPinned?: boolean | null;
  updatedAt?: string | null;
};

export type TopicSteeringProposal = {
  id: string;
  topicSetId?: string | null;
  corpusId: string;
  proposalKind: string;
  steeringDomain: string;
  status: string;
  title: string;
  summary?: string | null;
  topicUid?: string | null;
  targetTopicUid?: string | null;
  graphEntityId?: string | null;
  relationshipType?: string | null;
  displayName?: string | null;
  subtitle?: string | null;
  description?: string | null;
  evidenceItemIds?: Array<string | null> | null;
  suggestedSeedItemIds?: Array<string | null> | null;
  suggestedHoldoutItemIds?: Array<string | null> | null;
  sourceSnapshotId?: string | null;
  proposedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  updatedAt?: string | null;
};

export type TopicSteeringArtifact = {
  id: string;
  corpusId: string;
  artifactKind: string;
  artifactId: string;
  snapshotId?: string | null;
  displayName?: string | null;
  createdAt?: string | null;
};

export type TopicSteeringProjection = {
  id: string;
  targetCorpusId: string;
  authorityCorpusId?: string | null;
  classifierId: string;
  externalItemId: string;
  topicUid?: string | null;
  displayName?: string | null;
  score?: number | null;
  reviewRecommended?: boolean | null;
  importedAt: string;
};

export type TopicSteeringDashboard = {
  isDemo?: boolean;
  corpora: TopicSteeringCorpus[];
  importRuns: TopicSteeringImportRun[];
  topicSets: TopicSteeringTopicSet[];
  topics: TopicSteeringTopic[];
  proposals: TopicSteeringProposal[];
  artifacts: TopicSteeringArtifact[];
  projections: TopicSteeringProjection[];
  loadError?: string | null;
};

let cachedClient: DataClient | null = null;

export async function loadTopicSteeringDashboard(options?: { demo?: boolean }): Promise<TopicSteeringDashboard> {
  if (options?.demo) return createDemoTopicSteeringDashboard();
  if (!hasAmplifyOutputs()) {
    return {
      ...createEmptyTopicSteeringDashboard(),
      loadError: "amplify_outputs.json is not available. Run or deploy the Amplify backend before loading steering data.",
    };
  }

  try {
    const [
      corpora,
      importRuns,
      topicSets,
      topics,
      proposals,
      artifacts,
      projections,
    ] = await Promise.all([
      listModel<TopicSteeringCorpus>("CurationCorpus"),
      listModel<TopicSteeringImportRun>("CurationImportRun"),
      listModel<TopicSteeringTopicSet>("CurationTopicSet"),
      listModel<TopicSteeringTopic>("CurationTopic"),
      listModel<TopicSteeringProposal>("CurationProposal"),
      listModel<TopicSteeringArtifact>("CurationArtifact"),
      listModel<TopicSteeringProjection>("CurationProjection"),
    ]);

    return {
      corpora: corpora.sort((left, right) => left.name.localeCompare(right.name)),
      importRuns: importRuns.sort((left, right) => right.importedAt.localeCompare(left.importedAt)),
      topicSets: topicSets.sort((left, right) => left.displayName.localeCompare(right.displayName)),
      topics: sortTopics(topics),
      proposals: sortProposals(proposals),
      artifacts: artifacts.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "")),
      projections: projections.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)),
      loadError: null,
    };
  } catch (error) {
    return {
      ...createEmptyTopicSteeringDashboard(),
      loadError: error instanceof Error ? error.message : "Could not load topic steering data.",
    };
  }
}

function getClient(): DataClient {
  if (cachedClient) return cachedClient;
  getAmplifyServerRuntime();
  cachedClient = generateClient<Schema>({ authMode: AUTH_MODE });
  return cachedClient;
}

async function listModel<T>(modelName: string): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | null | undefined;
  const model = (getClient().models as Record<string, { list: (options: Record<string, unknown>) => Promise<GraphQLListResponse<T>> }>)[modelName];
  if (!model) throw new Error(`GraphQL model ${modelName} is not available in the deployed schema.`);

  do {
    const response = await model.list({
      authMode: AUTH_MODE,
      limit: 100,
      nextToken,
    });
    assertNoGraphQLErrors(response.errors);
    items.push(...((response.data ?? []).filter(Boolean) as T[]));
    nextToken = response.nextToken;
  } while (nextToken);

  return items;
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

function createEmptyTopicSteeringDashboard(): TopicSteeringDashboard {
  return {
    corpora: [
      {
        id: "curation-corpus-ai-ml-research",
        name: "AI-ML-research",
        role: "authority",
      },
      {
        id: "curation-corpus-ai-ml-history",
        name: "AI-ML-history",
        role: "projection",
      },
    ],
    importRuns: [],
    topicSets: [],
    topics: [],
    proposals: [],
    artifacts: [],
    projections: [],
    loadError: null,
  };
}

function createDemoTopicSteeringDashboard(): TopicSteeringDashboard {
  const importedAt = "2026-05-16T12:00:00.000Z";
  const corpusId = "curation-corpus-ai-ml-research";
  const historyCorpusId = "curation-corpus-ai-ml-history";
  const topicSetId = "curation-topic-set-ai-ml-research";

  return {
    isDemo: true,
    corpora: [
      {
        id: corpusId,
        name: "AI-ML-research",
        role: "authority",
        itemCount: 3,
        latestImportRunId: "curation-import-demo-steering",
      },
      {
        id: historyCorpusId,
        name: "AI-ML-history",
        role: "projection",
        itemCount: 2,
        latestImportRunId: "curation-import-demo-projection",
      },
    ],
    importRuns: [
      {
        id: "curation-import-demo-steering",
        corpusId,
        importKind: "steering-export",
        classifierId: "ai-ml-topic-classifier",
        status: "imported",
        importedAt,
        itemCount: 3,
        topicCount: 2,
        proposalCount: 3,
        projectionCount: 0,
        warningCount: 0,
      },
      {
        id: "curation-import-demo-projection",
        corpusId: historyCorpusId,
        importKind: "topic-projection",
        classifierId: "ai-ml-topic-classifier",
        status: "imported",
        importedAt,
        itemCount: 2,
        topicCount: 0,
        proposalCount: 0,
        projectionCount: 2,
        warningCount: 0,
      },
    ],
    topicSets: [
      {
        id: topicSetId,
        corpusId,
        classifierId: "ai-ml-topic-classifier",
        displayName: "AI/ML Research Topics",
        description: "Accepted topic set imported from Biblicus artifacts.",
        status: "accepted",
        acceptedRevisionId: "revision-demo-accepted",
        latestDraftRevisionId: "revision-demo-draft",
        generatedAt: importedAt,
        topicCount: 2,
      },
    ],
    topics: [
      {
        id: "topic-foundation-model-scaling",
        topicSetId,
        corpusId,
        topicUid: "topic.foundation-model-scaling",
        displayName: "Foundation Model Scaling",
        subtitle: "Capability curves, benchmark saturation, and training-compute effects",
        description: "Research on model size, data mixtures, compute budgets, and emergent benchmark behavior.",
        aliases: ["scaling laws", "compute scaling"],
        status: "accepted",
        seedItemIds: ["research-001", "research-002"],
        holdoutItemIds: ["research-003"],
        rank: 1,
        isPinned: true,
        updatedAt: importedAt,
      },
      {
        id: "topic-symbolic-connectionist-history",
        topicSetId,
        corpusId,
        topicUid: "topic.symbolic-connectionist-history",
        displayName: "Symbolic And Connectionist History",
        subtitle: "Shifts between rule systems, neural nets, and hybrid AI programs",
        description: "Historical coverage of symbolic AI, neural network winters, and later hybrid systems.",
        aliases: ["AI winters", "connectionism"],
        status: "accepted",
        seedItemIds: ["history-001"],
        holdoutItemIds: ["history-002"],
        rank: 2,
        isPinned: false,
        updatedAt: importedAt,
      },
    ],
    proposals: [
      {
        id: "curation-proposal-demo-rename",
        topicSetId,
        corpusId,
        proposalKind: "rename-topic",
        steeringDomain: "topic",
        status: "proposed",
        title: "Rename scaling topic",
        summary: "Several seed items use foundation model scaling terminology more consistently than generic scaling laws.",
        topicUid: "topic.foundation-model-scaling",
        displayName: "Foundation Model Scaling",
        subtitle: "Capability curves, benchmark saturation, and training-compute effects",
        evidenceItemIds: ["research-001", "research-002"],
        suggestedSeedItemIds: ["research-001"],
        proposedAt: importedAt,
      },
      {
        id: "curation-proposal-demo-relationship",
        topicSetId,
        corpusId,
        proposalKind: "relationship-proposal",
        steeringDomain: "graph",
        status: "proposed",
        title: "Link scaling topic to benchmark entity",
        summary: "Evidence suggests the topic should relate to the benchmark-saturation entity.",
        topicUid: "topic.foundation-model-scaling",
        graphEntityId: "graph-entity-benchmark-saturation",
        relationshipType: "influences",
        evidenceItemIds: ["research-002"],
        proposedAt: importedAt,
      },
      {
        id: "curation-proposal-demo-seeds",
        topicSetId,
        corpusId,
        proposalKind: "seed-change",
        steeringDomain: "topic",
        status: "deferred",
        title: "Add history article as holdout",
        summary: "The item is useful as a negative example for modern scaling topics.",
        topicUid: "topic.foundation-model-scaling",
        suggestedHoldoutItemIds: ["history-002"],
        evidenceItemIds: ["history-002"],
        proposedAt: importedAt,
      },
    ],
    artifacts: [
      {
        id: "curation-artifact-demo-topic-set",
        corpusId,
        artifactKind: "accepted-topic-set",
        artifactId: "s3://papyrus-demo/accepted-topic-set.json",
        snapshotId: "snapshot-demo-topic-set",
        displayName: "Accepted Topic Set JSON",
        createdAt: importedAt,
      },
    ],
    projections: [
      {
        id: "projection-demo-history-001",
        targetCorpusId: historyCorpusId,
        authorityCorpusId: corpusId,
        classifierId: "ai-ml-topic-classifier",
        externalItemId: "history-001",
        topicUid: "topic.symbolic-connectionist-history",
        displayName: "Symbolic And Connectionist History",
        score: 0.91,
        reviewRecommended: false,
        importedAt,
      },
      {
        id: "projection-demo-history-002",
        targetCorpusId: historyCorpusId,
        authorityCorpusId: corpusId,
        classifierId: "ai-ml-topic-classifier",
        externalItemId: "history-002",
        topicUid: "topic.foundation-model-scaling",
        displayName: "Foundation Model Scaling",
        score: 0.58,
        reviewRecommended: true,
        importedAt,
      },
    ],
    loadError: null,
  };
}
