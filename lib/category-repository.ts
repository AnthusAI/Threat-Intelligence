import {
  buildAssignmentDesk,
  createEmptyAssignmentDesk,
  type NewsDeskAssignmentDesk,
  type NewsDeskAssignmentEdition,
  type NewsDeskAssignmentEditionItem,
  type NewsDeskAssignmentItem,
} from "./news-desk-assignments";

export type CategorySteeringCorpus = {
  id: string;
  name: string;
  role: string;
  itemCount?: number | null;
  generatedAt?: string | null;
  latestImportRunId?: string | null;
};

export type CategorySteeringImportRun = {
  id: string;
  corpusId: string;
  importKind: string;
  classifierId?: string | null;
  status: string;
  importedAt: string;
  itemCount?: number | null;
  categoryCount?: number | null;
  proposalCount?: number | null;
  projectionCount?: number | null;
  warningCount?: number | null;
};

export type CategorySteeringCategorySet = {
  id: string;
  lineageId?: string | null;
  versionNumber?: number | null;
  versionState?: string | null;
  corpusId: string;
  classifierId: string;
  displayName: string;
  description?: string | null;
  status: string;
  generatedAt?: string | null;
  categoryCount?: number | null;
  importRunId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  nodeCount?: number | null;
  rootCount?: number | null;
};

export type CategorySteeringCategory = {
  id: string;
  lineageId?: string | null;
  versionNumber?: number | null;
  previousVersionId?: string | null;
  versionState?: string | null;
  versionCreatedAt?: string | null;
  versionCreatedBy?: string | null;
  changeReason?: string | null;
  contentHash?: string | null;
  categorySetId: string;
  corpusId: string;
  categoryKey: string;
  parentCategoryId?: string | null;
  parentCategoryKey?: string | null;
  displayName: string;
  subtitle?: string | null;
  description?: string | null;
  aliases?: Array<string | null> | null;
  status: string;
  seedItemIds?: Array<string | null> | null;
  holdoutItemIds?: Array<string | null> | null;
  rank?: number | null;
  depth?: number | null;
  isPinned?: boolean | null;
  importRunId?: string | null;
  updatedAt?: string | null;
};

export type CategorySteeringCategoryTree = CategorySteeringCategorySet;

export type CategorySteeringCategoryTreeNode = CategorySteeringCategory;

export type CategorySteeringProposal = {
  id: string;
  categorySetId?: string | null;
  corpusId: string;
  proposalKind: string;
  steeringDomain: string;
  status: string;
  title: string;
  summary?: string | null;
  categoryKey?: string | null;
  targetCategoryKey?: string | null;
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

export type CategorySteeringArtifact = {
  id: string;
  corpusId: string;
  artifactKind: string;
  artifactId: string;
  snapshotId?: string | null;
  displayName?: string | null;
  createdAt?: string | null;
};

export type CategorySteeringProjection = {
  id: string;
  targetCorpusId: string;
  authorityCorpusId?: string | null;
  classifierId: string;
  externalItemId: string;
  categoryKey?: string | null;
  displayName?: string | null;
  score?: number | null;
  reviewRecommended?: boolean | null;
  importedAt: string;
};

export type CategorySteeringDashboard = {
  isDemo?: boolean;
  canonicalCorpusId?: string | null;
  canonicalCategorySetId?: string | null;
  assignmentDesk: NewsDeskAssignmentDesk;
  corpora: CategorySteeringCorpus[];
  importRuns: CategorySteeringImportRun[];
  categorySets: CategorySteeringCategorySet[];
  categorys: CategorySteeringCategory[];
  categoryTrees: CategorySteeringCategoryTree[];
  categoryNodes: CategorySteeringCategoryTreeNode[];
  proposals: CategorySteeringProposal[];
  artifacts: CategorySteeringArtifact[];
  projections: CategorySteeringProjection[];
  loadError?: string | null;
};

export async function loadCategorySteeringDashboard(options?: { demo?: boolean }): Promise<CategorySteeringDashboard> {
  if (options?.demo) return createDemoCategorySteeringDashboard();
  return {
    ...createEmptyCategorySteeringDashboard(),
    loadError: "News Desk canonical records require an editor user-pool session.",
  };
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

function createEmptyCategorySteeringDashboard(): CategorySteeringDashboard {
  return {
    canonicalCorpusId: null,
    canonicalCategorySetId: null,
    assignmentDesk: createEmptyAssignmentDesk(),
    corpora: [],
    importRuns: [],
    categorySets: [],
    categorys: [],
    categoryTrees: [],
    categoryNodes: [],
    proposals: [],
    artifacts: [],
    projections: [],
    loadError: null,
  };
}

function createDemoCategorySteeringDashboard(): CategorySteeringDashboard {
  const importedAt = "2026-05-16T12:00:00.000Z";
  const corpusId = "category-corpus-demo-canonical";
  const sourceCorpusId = "category-corpus-demo-source";
  const categorySetId = "category-set-demo-canonical";
  const sourceCategorySetId = "category-set-demo-source";

  return {
    isDemo: true,
    canonicalCorpusId: corpusId,
    canonicalCategorySetId: categorySetId,
    assignmentDesk: createDemoAssignmentDesk(importedAt),
    corpora: [
      {
        id: corpusId,
        name: "Canonical Demo Corpus",
        role: "canonical",
        itemCount: 3,
        latestImportRunId: "category-import-demo-steering",
      },
      {
        id: sourceCorpusId,
        name: "Source Demo Corpus",
        role: "source",
        itemCount: 2,
        latestImportRunId: "category-import-demo-projection",
      },
    ],
    importRuns: [
      {
        id: "category-import-demo-steering",
        corpusId,
        importKind: "steering-export",
        classifierId: "demo-canonical-classifier",
        status: "imported",
        importedAt,
        itemCount: 3,
        categoryCount: 1,
        proposalCount: 5,
        projectionCount: 0,
        warningCount: 0,
      },
      {
        id: "category-import-demo-projection",
        corpusId: sourceCorpusId,
        importKind: "category-projection",
        classifierId: "demo-canonical-classifier",
        status: "imported",
        importedAt,
        itemCount: 2,
        categoryCount: 0,
        proposalCount: 0,
        projectionCount: 2,
        warningCount: 0,
      },
    ],
    categorySets: [
      {
        id: categorySetId,
        lineageId: categorySetId,
        versionNumber: 1,
        versionState: "current",
        corpusId,
        classifierId: "demo-canonical-classifier",
        displayName: "Canonical Demo Categories",
        description: "Accepted category set imported from Biblicus artifacts.",
        status: "accepted",
        generatedAt: importedAt,
        categoryCount: 1,
        importRunId: "category-import-demo-steering",
      },
      {
        id: sourceCategorySetId,
        lineageId: sourceCategorySetId,
        versionNumber: 1,
        versionState: "current",
        corpusId: sourceCorpusId,
        classifierId: "demo-source-classifier",
        displayName: "Source Demo Categories",
        description: "Local category set discovered inside the source corpus.",
        status: "accepted",
        generatedAt: importedAt,
        categoryCount: 1,
        importRunId: "category-import-demo-projection",
      },
    ],
    categorys: [
      {
        id: "category-foundation-model-scaling",
        categorySetId,
        corpusId,
        categoryKey: "category.foundation-model-scaling",
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
        id: "category-symbolic-connectionist-history",
        categorySetId: sourceCategorySetId,
        corpusId: sourceCorpusId,
        categoryKey: "category.symbolic-connectionist-history",
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
    categoryTrees: [
      {
        id: categorySetId,
        lineageId: categorySetId,
        versionNumber: 1,
        versionState: "current",
        corpusId,
        classifierId: "demo-canonical-classifier",
        displayName: "Canonical Demo Category Tree",
        description: "Accepted category tree imported from Biblicus category artifacts.",
        status: "accepted",
        generatedAt: importedAt,
        categoryCount: 3,
        nodeCount: 3,
        rootCount: 1,
        importRunId: "category-import-demo-steering",
        createdAt: importedAt,
        updatedAt: importedAt,
      },
    ],
    categoryNodes: [
      {
        id: "category-demo-foundation-model-scaling",
        corpusId,
        categorySetId,
        categoryKey: "category.foundation-model-scaling",
        parentCategoryKey: null,
        displayName: "Foundation Model Scaling",
        subtitle: "Capability curves, benchmark saturation, and training-compute effects",
        description: "Accepted root category for model size, data mixtures, compute budgets, and emergent benchmark behavior.",
        status: "accepted",
        seedItemIds: ["research-001", "research-002"],
        holdoutItemIds: ["research-003"],
        rank: 1,
        depth: 0,
        importRunId: "category-import-demo-steering",
        updatedAt: importedAt,
      },
      {
        id: "category-demo-agent-memory",
        corpusId,
        categorySetId,
        categoryKey: "category.agent-memory",
        parentCategoryKey: "category.foundation-model-scaling",
        displayName: "Agent Memory",
        subtitle: "Retrieval, persistence, and episodic context for agent systems",
        description: "Accepted subcategory covering long-running memory, retrieval augmentation, and context persistence in agent workflows.",
        status: "accepted",
        seedItemIds: ["research-001"],
        holdoutItemIds: [],
        rank: 1,
        depth: 1,
        importRunId: "category-import-demo-steering",
        updatedAt: importedAt,
      },
      {
        id: "category-demo-benchmark-saturation",
        corpusId,
        categorySetId,
        categoryKey: "category.benchmark-saturation",
        parentCategoryKey: "category.foundation-model-scaling",
        displayName: "Benchmark Saturation",
        subtitle: "Evaluation plateaus, leakage, and capability measurement stress",
        description: "Accepted subcategory covering benchmark exhaustion and the need for new evaluation signals.",
        status: "accepted",
        seedItemIds: ["research-002"],
        holdoutItemIds: ["research-003"],
        rank: 2,
        depth: 1,
        importRunId: "category-import-demo-steering",
        updatedAt: importedAt,
      },
    ],
    proposals: [
      {
        id: "category-proposal-demo-rename",
        categorySetId,
        corpusId,
        proposalKind: "rename-category",
        steeringDomain: "category",
        status: "proposed",
        title: "Rename scaling category",
        summary: "Several seed items use foundation model scaling terminology more consistently than generic scaling laws.",
        categoryKey: "category.foundation-model-scaling",
        displayName: "Foundation Model Scaling",
        subtitle: "Capability curves, benchmark saturation, and training-compute effects",
        evidenceItemIds: ["research-001", "research-002"],
        suggestedSeedItemIds: ["research-001"],
        proposedAt: importedAt,
      },
      {
        id: "category-proposal-demo-relationship",
        categorySetId,
        corpusId,
        proposalKind: "relationship-proposal",
        steeringDomain: "graph",
        status: "proposed",
        title: "Link scaling category to benchmark entity",
        summary: "Evidence suggests the category should relate to the benchmark-saturation entity.",
        categoryKey: "category.foundation-model-scaling",
        graphEntityId: "graph-entity-benchmark-saturation",
        relationshipType: "influences",
        evidenceItemIds: ["research-002"],
        proposedAt: importedAt,
      },
      {
        id: "category-proposal-demo-create-category",
        categorySetId,
        corpusId,
        proposalKind: "create-category",
        steeringDomain: "category",
        status: "proposed",
        title: "Create agent memory subcategory",
        summary: "Discovery found a possible child category under the foundation model scaling area.",
        categoryKey: "category.agent-memory",
        targetCategoryKey: "category.foundation-model-scaling",
        relationshipType: "subcategory_of",
        displayName: "Agent Memory",
        description: "Candidate subcategory covering memory, retrieval, and persistence in agent systems.",
        evidenceItemIds: ["research-001"],
        proposedAt: importedAt,
      },
      {
        id: "category-proposal-demo-ontology-relationship",
        categorySetId,
        corpusId,
        proposalKind: "add-ontology-relationship",
        steeringDomain: "graph",
        status: "proposed",
        title: "Add ontology assertion",
        summary: "The evidence supports a historical context relationship between two category nodes.",
        categoryKey: "category.symbolic-connectionist-history",
        targetCategoryKey: "category.agent-memory",
        graphEntityId: "assertion-agent-memory-history",
        relationshipType: "historical_context_for",
        evidenceItemIds: ["history-001"],
        proposedAt: importedAt,
      },
      {
        id: "category-proposal-demo-seeds",
        categorySetId,
        corpusId,
        proposalKind: "seed-change",
        steeringDomain: "category",
        status: "deferred",
        title: "Add history article as holdout",
        summary: "The item is useful as a negative example for modern scaling categories.",
        categoryKey: "category.foundation-model-scaling",
        suggestedHoldoutItemIds: ["history-002"],
        evidenceItemIds: ["history-002"],
        proposedAt: importedAt,
      },
    ],
    artifacts: [
      {
        id: "category-artifact-demo-category-set",
        corpusId,
        artifactKind: "accepted-category-set",
        artifactId: "s3://papyrus-demo/accepted-category-set.json",
        snapshotId: "snapshot-demo-category-set",
        displayName: "Accepted Category Set JSON",
        createdAt: importedAt,
      },
    ],
    projections: [
      {
        id: "projection-demo-history-001",
        targetCorpusId: sourceCorpusId,
        authorityCorpusId: corpusId,
        classifierId: "demo-canonical-classifier",
        externalItemId: "history-001",
        categoryKey: "category.symbolic-connectionist-history",
        displayName: "Symbolic And Connectionist History",
        score: 0.91,
        reviewRecommended: false,
        importedAt,
      },
      {
        id: "projection-demo-history-002",
        targetCorpusId: sourceCorpusId,
        authorityCorpusId: corpusId,
        classifierId: "demo-canonical-classifier",
        externalItemId: "history-002",
        categoryKey: "category.foundation-model-scaling",
        displayName: "Foundation Model Scaling",
        score: 0.58,
        reviewRecommended: true,
        importedAt,
      },
    ],
    loadError: null,
  };
}

function createDemoAssignmentDesk(importedAt: string): NewsDeskAssignmentDesk {
  const edition: NewsDeskAssignmentEdition = {
    id: "edition-demo-assignments",
    slug: "demo-assignments",
    title: "Demo Assignment Edition",
    status: "planning",
    editionDate: "2026-05-16",
    publishedAt: importedAt,
    description: "Assignment candidates for the next Papyrus issue.",
  };
  const editionItems: NewsDeskAssignmentEditionItem[] = [
    createDemoAssignmentEditionItem(edition.id, "assignment-demo-agent-lab", "assignment:0001:ai-agents-enter-the-lab"),
    createDemoAssignmentEditionItem(edition.id, "assignment-demo-benchmark-cull", "assignment:0002:benchmark-saturation-watch"),
    createDemoAssignmentEditionItem(edition.id, "assignment-demo-history-cull", "assignment:0003:connectionist-history-sidebar"),
    createDemoAssignmentEditionItem(edition.id, "assignment-demo-infra-restore", "assignment:0004:agent-infra-costs"),
  ];
  const items: NewsDeskAssignmentItem[] = [
    {
      id: "assignment-demo-agent-lab",
      type: "assignment",
      status: "dispatched",
      typeStatus: "assignment#dispatched",
      slug: "ai-agents-enter-the-lab",
      section: "Research",
      sectionStatus: "research#dispatched",
      title: "AI Agents Enter the Lab",
      deck: "A reporting pass on autonomous systems inside scientific workflows.",
      editorial: {
        newsroom: {
          assignment: {
            brief: "Find concrete examples of agent systems changing lab work without overstating maturity.",
            angle: "Focus on places where agents make research teams faster, then name the supervision cost.",
            corpusKey: "AI-ML-research",
            categoryKey: "category.agent-memory",
            targetArticleSlots: 2,
            evidenceItemIds: ["research-001", "research-002", "research-003"],
          },
        },
      },
    },
    {
      id: "assignment-demo-benchmark-cull",
      type: "assignment",
      status: "drafted",
      typeStatus: "assignment#drafted",
      slug: "benchmark-saturation-watch",
      section: "Research",
      sectionStatus: "research#drafted",
      title: "Benchmark Saturation Watch",
      deck: "A candidate on evaluation plateaus and leakage in model benchmarks.",
      editorial: {
        newsroom: {
          assignment: {
            brief: "Turn the benchmark-saturation category into a concise inside-page article.",
            angle: "Explain why old benchmarks stop working as a newspaper-style accountability story.",
            corpusKey: "AI-ML-research",
            categoryKey: "category.benchmark-saturation",
            targetArticleSlots: 2,
            evidenceItemIds: ["research-002"],
          },
          draft: {
            articleItemId: "article-demo-benchmark-cull",
          },
        },
      },
    },
    {
      id: "article-demo-benchmark-cull",
      type: "article",
      status: "draft",
      typeStatus: "article#draft",
      slug: "benchmark-saturation-watch-draft",
      section: "Research",
      sectionStatus: "research#draft",
      title: "Benchmarks Struggle To Keep Up",
      headline: "Benchmarks Struggle To Keep Up",
      deck: "Draft copy linked to the benchmark assignment.",
      body: ["Draft body for the benchmark saturation assignment."],
      editorial: {
        newsroom: {
          assignmentItemId: "assignment-demo-benchmark-cull",
        },
      },
    },
    {
      id: "assignment-demo-history-cull",
      type: "assignment",
      status: "culled",
      typeStatus: "assignment#culled",
      slug: "connectionist-history-sidebar",
      section: "History",
      sectionStatus: "history#culled",
      title: "Connectionist History Sidebar",
      deck: "A weaker sidebar candidate already removed from the edition pool.",
      editorial: {
        newsroom: {
          assignment: {
            brief: "Consider a short context piece on the symbolic-to-connectionist swing.",
            angle: "Make the history useful to readers following current agent systems.",
            corpusKey: "AI-ML-history",
            categoryKey: "category.symbolic-connectionist-history",
            targetArticleSlots: 1,
            evidenceItemIds: ["history-001"],
          },
          culling: {
            status: "culled",
            source: "manual-news-desk",
            culledAt: importedAt,
            culledBy: "Papyrus news desk",
            reason: "Too thin for the current edition mix.",
            previousStatus: "dispatched",
            previousTypeStatus: "assignment#dispatched",
            previousSectionStatus: "history#dispatched",
          },
        },
      },
    },
    {
      id: "assignment-demo-infra-restore",
      type: "assignment",
      status: "researched",
      typeStatus: "assignment#researched",
      slug: "agent-infra-costs",
      section: "Operations",
      sectionStatus: "operations#researched",
      title: "Agent Infrastructure Costs",
      deck: "A candidate on the operational costs of long-running agent systems.",
      editorial: {
        newsroom: {
          assignment: {
            brief: "Collect evidence on compute, tool-call, and supervision costs in agent operations.",
            angle: "Treat the story as an operations ledger rather than a product roundup.",
            corpusKey: "AI-ML-research",
            categoryKey: "category.foundation-model-scaling",
            targetArticleSlots: 1,
            evidenceItemIds: ["research-001", "history-002"],
          },
        },
      },
    },
  ];

  return buildAssignmentDesk([edition], editionItems, items);
}

function createDemoAssignmentEditionItem(
  editionId: string,
  itemId: string,
  sortKey: string,
): NewsDeskAssignmentEditionItem {
  return {
    id: `edition-item-${itemId}`,
    editionId,
    itemId,
    placementKey: `assignment:${itemId}`,
    sortKey,
    metadata: {
      newsroom: {
        role: "assignment",
      },
    },
  };
}
